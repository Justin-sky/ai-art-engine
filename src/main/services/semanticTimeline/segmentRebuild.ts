/**
 * 语义重建 v2 的本地拼接：**直通原片段 + 生成片段 + 重新配音** → 成片。
 *
 * 流程（全部本地 ffmpeg）：
 * 1. 音轨在**原片时间轴**上先做好：原声（或分离出的伴奏 + 人声）→ 改过台词的时间段里把人声静音
 *    → 把新配音按原句起点叠上去。这样之后不管哪一段直通、哪一段生成，音画都按原片时间对齐。
 * 2. 逐段出规范化的小片段（同分辨率 / 帧率 / 编码 / 音频格式）：
 *    - `source`：原片 `[入点, 出点)` 重编码裁切（帧精确）；
 *    - `generate`：生成片段对齐到原镜头时长（长了截断，短了放慢，差太多就冻结最后一帧补齐）。
 *    每段音频都从第 1 步的原片时间音轨里按入出点裁（没有入出点的整片段按成片时间裁）。
 * 3. concat 直拷，按需烧录字幕（原片时间 → 成片时间映射，删镜的句子自动丢掉）。
 *
 * 零修改时所有段都是 `source`，成片 = 原片按镜头重新拼接（还原原片）。
 */
import { execFile } from 'child_process'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import {
  dubTempo,
  layoutSegments,
  mapCuesToOutput,
  muteVolumeExpression,
  type SemanticRebuildDub,
  type SemanticRebuildSegment,
  type SourceCue
} from '@shared/semanticTimeline'
import { runFfmpeg } from '../ffmpegRunner'
import { probeMediaFacts } from './mediaFacts'
import { resolveFfmpegForSemantic, resolveFfprobeForSemantic } from './resolveFfmpeg'
import { buildSrt } from './rebuildService'

const execFileAsync = promisify(execFile)

export interface SegmentRebuildInput {
  projectRoot: string
  segments: SemanticRebuildSegment[]
  dubs?: SemanticRebuildDub[]
  /** 原片（直通段与音轨的来源；工程相对路径） */
  sourceRelativePath?: string
  /** 原片分离出的人声 / 伴奏（工程相对路径）：配音时只静音人声、保留背景声 */
  stems?: { vocals?: string | null; accompaniment?: string | null }
  keepAudio?: boolean
  burnSubtitles?: boolean
  /** 原片时间的字幕 */
  subtitles?: SourceCue[]
  width?: number
  height?: number
  fps?: number
  outputRelativePath: string
  workDirRelativePath: string
}

export interface SegmentRebuildResult {
  ok: boolean
  outputRelativePath: string
  generatedCount: number
  passthroughCount: number
  dubCount: number
  burnedSubtitles: number
  keptAudio: boolean
  notes: string[]
  error?: string
}

function toAbs(root: string, rel: string): string {
  return join(root, ...rel.split('/'))
}

function listLine(absPath: string): string {
  return `file '${absPath.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`
}

function subtitlesFilter(srtAbs: string): string {
  const escaped = srtAbs.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
  return `subtitles='${escaped}'`
}

async function probeDurationSec(fileAbs: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      resolveFfprobeForSemantic(),
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', fileAbs],
      { timeout: 30_000, windowsHide: true }
    )
    const sec = Number(String(stdout).trim())
    return Number.isFinite(sec) && sec > 0 ? sec : 0
  } catch {
    return 0
  }
}

function even(n: number): number {
  const v = Math.max(2, Math.round(n))
  return v % 2 === 0 ? v : v + 1
}

const SAMPLE_RATE = 48000

/** 第 1 步：原片时间轴上的成品音轨（静音被改的人声 + 叠新配音）。返回 wav 绝对路径或 null。 */
async function buildSourceTimeAudio(input: {
  ffmpeg: string
  root: string
  workDirAbs: string
  sourceAbs: string
  stems?: SegmentRebuildInput['stems']
  dubs: Array<SemanticRebuildDub & { abs: string }>
  notes: string[]
}): Promise<string | null> {
  const { ffmpeg, root, workDirAbs, sourceAbs, dubs, notes } = input
  const outAbs = join(workDirAbs, 'audio.source-time.wav')
  const vocalsAbs = input.stems?.vocals ? toAbs(root, input.stems.vocals) : ''
  const accAbs = input.stems?.accompaniment ? toAbs(root, input.stems.accompaniment) : ''
  const useStems =
    dubs.length > 0 && !!vocalsAbs && !!accAbs && existsSync(vocalsAbs) && existsSync(accAbs)
  if (dubs.length > 0 && !useStems) {
    notes.push('没有可用的人声分离结果：改过台词的时间段整段静音后再叠配音（背景声会一起被静音）') // cjk-ok
  }

  const args: string[] = ['-y']
  const fmt = `aformat=sample_rates=${SAMPLE_RATE}:channel_layouts=stereo`
  const filters: string[] = []
  const mute = muteVolumeExpression(
    dubs.map((d) => ({ start: d.sourceStartSec, end: d.sourceEndSec }))
  )
  let baseLabel: string
  let nextInput = 0
  if (useStems) {
    args.push('-i', accAbs, '-i', vocalsAbs)
    filters.push(`[0:a]${fmt}[acc]`)
    filters.push(`[1:a]${fmt},volume='${mute}':eval=frame[voc]`)
    filters.push(`[acc][voc]amix=inputs=2:normalize=0:duration=longest[base]`)
    nextInput = 2
  } else {
    args.push('-i', sourceAbs)
    filters.push(`[0:a]${fmt},volume='${mute}':eval=frame[base]`)
    nextInput = 1
  }
  baseLabel = 'base'

  const dubLabels: string[] = []
  for (const dub of dubs) {
    const index = nextInput++
    args.push('-i', dub.abs)
    const slot = Math.max(0.2, dub.sourceEndSec - dub.sourceStartSec)
    const dubSec = await probeDurationSec(dub.abs)
    const tempo = dubTempo(dubSec, slot)
    const delayMs = Math.max(0, Math.round(dub.sourceStartSec * 1000))
    const label = `d${index}`
    filters.push(
      `[${index}:a]${fmt}${tempo !== 1 ? `,atempo=${tempo}` : ''},atrim=0:${(slot + 0.3).toFixed(3)},adelay=${delayMs}|${delayMs}[${label}]`
    )
    dubLabels.push(`[${label}]`)
  }
  if (dubLabels.length > 0) {
    filters.push(
      `[${baseLabel}]${dubLabels.join('')}amix=inputs=${dubLabels.length + 1}:normalize=0:duration=first[mix]`
    )
    baseLabel = 'mix'
  }
  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    `[${baseLabel}]`,
    '-ar',
    String(SAMPLE_RATE),
    '-ac',
    '2',
    '-c:a',
    'pcm_s16le',
    outAbs
  )
  try {
    await runFfmpeg(ffmpeg, args)
    return existsSync(outAbs) ? outAbs : null
  } catch (e) {
    notes.push(`音轨处理失败，成片改为静音：${e instanceof Error ? e.message : String(e)}`) // cjk-ok
    return null
  }
}

export async function rebuildVideoFromSegments(
  input: SegmentRebuildInput
): Promise<SegmentRebuildResult> {
  const notes: string[] = []
  const root = input.projectRoot
  const result: SegmentRebuildResult = {
    ok: false,
    outputRelativePath: input.outputRelativePath,
    generatedCount: 0,
    passthroughCount: 0,
    dubCount: 0,
    burnedSubtitles: 0,
    keptAudio: false,
    notes
  }
  const ffmpeg = resolveFfmpegForSemantic()
  const workDirAbs = toAbs(root, input.workDirRelativePath)
  const outputAbs = toAbs(root, input.outputRelativePath)
  mkdirSync(workDirAbs, { recursive: true })

  const sourceRel = input.sourceRelativePath?.trim() || ''
  const sourceAbs = sourceRel ? toAbs(root, sourceRel) : ''
  const hasSource = !!sourceAbs && existsSync(sourceAbs)

  // 能用的段：直通段需要原片，生成段需要片段文件
  const usable = input.segments.filter((seg) => {
    if (seg.kind === 'source') {
      if (!hasSource) return false
      return (
        seg.sourceStartSec != null &&
        seg.sourceEndSec != null &&
        seg.sourceEndSec > seg.sourceStartSec
      )
    }
    return !!seg.relativePath && existsSync(toAbs(root, seg.relativePath))
  })
  const dropped = input.segments.length - usable.length
  if (dropped > 0) {
    notes.push(
      hasSource
        ? `${dropped} 段素材缺失已跳过` // cjk-ok
        : `${dropped} 段需要原片但原片不可用（${sourceRel || '未知路径'}），已跳过` // cjk-ok
    )
  }
  if (usable.length === 0) return { ...result, error: 'no usable segments to rebuild' }

  // 输出画幅：节点给的 > 原片 > 首个生成片段
  let width = Number(input.width) || 0
  let height = Number(input.height) || 0
  let fps = Number(input.fps) || 0
  if ((!width || !height || !fps) && hasSource) {
    try {
      const facts = await probeMediaFacts(sourceAbs)
      width ||= facts.width
      height ||= facts.height
      fps ||= facts.fps
    } catch {
      /* 下面兜底 */
    }
  }
  width = even(width || 1080)
  height = even(height || 1920)
  fps = Math.max(1, Math.round(fps || 30))

  // ── 1. 原片时间音轨 ──────────────────────────────────────────────────────────
  const dubs = (input.dubs ?? [])
    .map((d) => ({ ...d, abs: toAbs(root, d.relativePath) }))
    .filter((d) => existsSync(d.abs) && d.sourceEndSec > d.sourceStartSec)
  let audioAbs: string | null = null
  if (input.keepAudio !== false && hasSource) {
    const facts = await probeMediaFacts(sourceAbs).catch(() => null)
    if (facts?.hasAudio) {
      audioAbs = await buildSourceTimeAudio({
        ffmpeg,
        root,
        workDirAbs,
        sourceAbs,
        stems: input.stems,
        dubs,
        notes
      })
    } else {
      notes.push('原片没有音轨') // cjk-ok
    }
  } else if (input.keepAudio !== false) {
    notes.push('原片不可用，成片无原音轨') // cjk-ok
  }
  const keptAudio = !!audioAbs

  // ── 2. 逐段规范化 ────────────────────────────────────────────────────────────
  const laid = layoutSegments(usable)
  const vNorm = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p`
  const partPaths: string[] = []
  for (let i = 0; i < laid.length; i += 1) {
    const seg = laid[i]!
    const dur = seg.durationSec
    const partAbs = join(workDirAbs, `part.${String(i).padStart(3, '0')}.mp4`)
    const args: string[] = ['-y']
    let vFilter = vNorm
    if (seg.kind === 'source') {
      args.push('-ss', seg.sourceStartSec!.toFixed(3), '-t', dur.toFixed(3), '-i', sourceAbs)
      result.passthroughCount += 1
    } else {
      const clipAbs = toAbs(root, seg.relativePath!)
      const clipSec = await probeDurationSec(clipAbs)
      args.push('-i', clipAbs)
      if (seg.fitMode === 'stretch' && clipSec > 0 && Math.abs(clipSec - dur) > 0.02) {
        const ratio = dur / clipSec
        // 首尾帧重拍片段：双向平滑变速贴合 [inSec, outSec]，避免生成 5s 片段被直接截断在 2.5s 而丢失尾帧衔接
        if (ratio >= 0.25 && ratio <= 2.5) {
          vFilter = `setpts=${ratio.toFixed(4)}*PTS,${vNorm}`
        } else if (clipSec < dur - 0.02) {
          vFilter = `${vNorm},tpad=stop_mode=clone:stop_duration=${(dur - clipSec).toFixed(3)}`
        }
      } else if (seg.fitMode === 'trim') {
        if (clipSec > 0 && clipSec < dur - 0.02) {
          vFilter = `${vNorm},tpad=stop_mode=clone:stop_duration=${(dur - clipSec).toFixed(3)}`
        }
      } else if (clipSec > 0 && clipSec < dur - 0.02) {
        const ratio = dur / clipSec
        // 差得不多就放慢对齐；差太多放慢会很假，改为冻结最后一帧补齐
        vFilter =
          ratio <= 1.5
            ? `setpts=${ratio.toFixed(4)}*PTS,${vNorm}`
            : `${vNorm},tpad=stop_mode=clone:stop_duration=${(dur - clipSec).toFixed(3)}`
      }
      result.generatedCount += 1
    }
    // 音频：从原片时间音轨按入出点裁；整片生成段按成片时间裁；没有音轨就补静音（concat 要求轨道一致）
    const audioFrom = seg.sourceStartSec != null ? seg.sourceStartSec : seg.outStartSec
    if (audioAbs) {
      args.push('-ss', audioFrom.toFixed(3), '-t', dur.toFixed(3), '-i', audioAbs)
    } else {
      args.push('-f', 'lavfi', '-t', dur.toFixed(3), '-i', `anullsrc=r=${SAMPLE_RATE}:cl=stereo`)
    }
    args.push(
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-vf',
      vFilter,
      '-af',
      `apad,atrim=0:${dur.toFixed(3)}`,
      '-t',
      dur.toFixed(3),
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '18',
      '-r',
      String(fps),
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ar',
      String(SAMPLE_RATE),
      '-ac',
      '2',
      partAbs
    )
    try {
      await runFfmpeg(ffmpeg, args)
      partPaths.push(partAbs)
    } catch (e) {
      notes.push(`${seg.key} 处理失败已跳过：${e instanceof Error ? e.message : String(e)}`) // cjk-ok
    }
  }
  if (partPaths.length === 0)
    return { ...result, keptAudio, error: 'all segments failed to encode' }
  result.dubCount = audioAbs ? dubs.length : 0

  // ── 3. 拼接 + 字幕 ───────────────────────────────────────────────────────────
  const listPath = join(workDirAbs, 'concat.txt')
  writeFileSync(listPath, partPaths.map(listLine).join('\n'), 'utf8')
  const cues =
    input.burnSubtitles !== false && input.subtitles?.length
      ? mapCuesToOutput(input.subtitles, laid)
      : []
  const srtText = cues.length ? buildSrt(cues) : ''
  const srtPath = srtText ? join(workDirAbs, 'subtitles.srt') : ''
  if (srtPath) writeFileSync(srtPath, srtText, 'utf8')

  const copyArgs = ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputAbs]
  if (srtPath) {
    const burnArgs = [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-vf',
      subtitlesFilter(srtPath),
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'copy',
      outputAbs
    ]
    try {
      await runFfmpeg(ffmpeg, burnArgs)
      result.burnedSubtitles = cues.length
    } catch (e) {
      notes.push(`字幕烧录失败，改为无字幕：${e instanceof Error ? e.message : String(e)}`) // cjk-ok
      try {
        await runFfmpeg(ffmpeg, copyArgs)
      } catch (retry) {
        return {
          ...result,
          keptAudio,
          error: retry instanceof Error ? retry.message : String(retry)
        }
      }
    }
  } else {
    try {
      await runFfmpeg(ffmpeg, copyArgs)
    } catch (e) {
      return { ...result, keptAudio, error: e instanceof Error ? e.message : String(e) }
    }
  }
  if (!existsSync(outputAbs)) return { ...result, keptAudio, error: 'output missing after ffmpeg' }
  return { ...result, ok: true, keptAudio }
}
