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
  buildAssSubtitles,
  dubTempo,
  layoutSegments,
  mapCuesToOutput,
  muteVolumeExpression,
  type MediaFacts,
  type SemanticPackagingOverlayCue,
  type SemanticRebuildDub,
  type SemanticRebuildLocalMotionClip,
  type SemanticRebuildSegment,
  type SourceCue
} from '@shared/semanticTimeline'
import { runFfmpeg } from '../ffmpegRunner'
import { renderLocalMotionClip, renderSideBySideCompareVideo } from './localRemakeRenderer'
import { probeMediaFacts } from './mediaFacts'
import { resolveFfmpegForSemantic, resolveFfprobeForSemantic } from './resolveFfmpeg'
import { buildSrt } from './rebuildService'
import { detectShots } from './shotDetect'

const execFileAsync = promisify(execFile)

export interface SegmentRebuildInput {
  projectRoot: string
  segments: SemanticRebuildSegment[]
  dubs?: SemanticRebuildDub[]
  /** 零 API 成本本地 FFmpeg 渲染镜头（静态推拉 Ken Burns / 静帧停留） */
  localMotionClips?: SemanticRebuildLocalMotionClip[]
  /** 是否同时输出原片与复刻并排对比视频 compare.mp4 */
  renderCompare?: boolean
  compareRelativePath?: string
  /** 原片（直通段与音轨的来源；工程相对路径） */
  sourceRelativePath?: string
  /** 原片分离出的人声 / 伴奏（工程相对路径）：配音时只静音人声、保留背景声 */
  stems?: { vocals?: string | null; accompaniment?: string | null }
  keepAudio?: boolean
  burnSubtitles?: boolean
  /** 原片时间的字幕 */
  subtitles?: SourceCue[]
  /** 原片时间的纵向包装/花字/顶部标题层（ASS 动态样式还原） */
  packagingOverlays?: SemanticPackagingOverlayCue[]
  width?: number
  height?: number
  fps?: number
  outputRelativePath: string
  workDirRelativePath: string
}

export interface SegmentRebuildResult {
  ok: boolean
  outputRelativePath: string
  compareRelativePath?: string
  generatedCount: number
  localClipCount?: number
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

function assFilter(assAbs: string): string {
  const escaped = assAbs.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
  return `ass='${escaped}'`
}

/**
 * 画幅自适应规范化：画幅方向一致且宽高比接近（对数差 <= 0.36）时采用 `increase,crop` 满屏居中裁切，
 * 消除模型固定比例档位带来的细黑边；横竖屏跨向混排时回退 `decrease,pad` 避免裁掉主体。
 */
export function buildAspectAwareVNorm(
  clipW: number,
  clipH: number,
  outW: number,
  outH: number,
  outFps: number
): string {
  const padNorm = `scale=${outW}:${outH}:force_original_aspect_ratio=decrease,pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${outFps},format=yuv420p`
  if (!(clipW > 0 && clipH > 0 && outW > 0 && outH > 0)) return padNorm
  const logDiff = Math.abs(Math.log(clipW / clipH / (outW / outH)))
  if (logDiff <= 0.36) {
    return `scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},setsar=1,fps=${outFps},format=yuv420p`
  }
  return padNorm
}

/**
 * 将跨镜单元（`G1..Gk`）的比例切片区间 `[propStart, propEnd]` 吸附到实测内部切镜点（`±maxSnapSec` 窗口内），
 * 防止模型生成的实际镜头切换偏离理论比例时在镜头中途切断或带入下一镜残帧。
 */
export function snapSliceBoundsToCuts(
  propStart: number,
  propEnd: number,
  fullClipSec: number,
  cutTimesSec: number[],
  maxSnapSec = 0.85
): { startSec: number; durationSec: number; snapped: boolean } {
  let start = Math.max(0, Math.min(fullClipSec - 0.05, propStart))
  let end = Math.max(start + 0.05, Math.min(fullClipSec, propEnd))
  if (!cutTimesSec.length || fullClipSec <= 0.3) {
    return { startSec: start, durationSec: Math.max(0.05, end - start), snapped: false }
  }

  let snapped = false
  if (start > 0.08) {
    let bestCut: number | undefined
    let bestDist = maxSnapSec
    for (const c of cutTimesSec) {
      const d = Math.abs(c - start)
      if (d <= bestDist && c < end - 0.18) {
        bestDist = d
        bestCut = c
      }
    }
    if (bestCut !== undefined) {
      start = bestCut
      snapped = true
    }
  }

  if (end < fullClipSec - 0.08) {
    let bestCut: number | undefined
    let bestDist = maxSnapSec
    for (const c of cutTimesSec) {
      const d = Math.abs(c - end)
      if (d <= bestDist && c > start + 0.2) {
        bestDist = d
        bestCut = c
      }
    }
    if (bestCut !== undefined) {
      end = bestCut
      snapped = true
    }
  }

  return {
    startSec: Number(start.toFixed(3)),
    durationSec: Number(Math.max(0.05, end - start).toFixed(3)),
    snapped
  }
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

  // 输出画幅：节点给的 > 原片 > 默认竖屏 1080x1920（先定画幅，方便本地 Ken Burns 片段直接按目标分辨率渲染）
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

  // ── 0. 本地零成本镜头渲染（Ken Burns / 静帧停留） ───────────────────────────
  const localClipPathByKey = new Map<string, string>()
  let localClipCount = 0
  for (let idx = 0; idx < (input.localMotionClips?.length ?? 0); idx += 1) {
    const lc = input.localMotionClips![idx]!
    const anchorRel = lc.anchorImageRelativePath?.trim()
    if (!anchorRel) continue
    const anchorAbs = toAbs(root, anchorRel)
    if (!existsSync(anchorAbs)) {
      notes.push(`${lc.key} 缺少锚点帧（${anchorRel}），回退原片或跳过`) // cjk-ok
      continue
    }
    const safeKey = lc.key.replace(/[^\w.-]+/g, '_').slice(0, 32)
    const outRel = `${input.workDirRelativePath}/local.${String(idx).padStart(3, '0')}.${safeKey}.mp4`
    const outAbs = toAbs(root, outRel)
    try {
      await renderLocalMotionClip({
        anchorImageAbs: anchorAbs,
        outputMp4Abs: outAbs,
        durationSec: lc.durationSec,
        width,
        height,
        fps,
        mode: lc.mode,
        zoomPerSec: lc.zoomPerSec,
        panPxPerSec: lc.panPxPerSec,
        panDirDeg: lc.panDirDeg
      })
      if (existsSync(outAbs)) {
        localClipPathByKey.set(lc.key, outRel)
        localClipCount += 1
      }
    } catch (e) {
      notes.push(`${lc.key} 本地动效渲染失败：${e instanceof Error ? e.message : String(e)}`) // cjk-ok
    }
  }

  const requestedLocalKeys = new Set((input.localMotionClips ?? []).map((lc) => lc.key))
  const resolvedSegments: SemanticRebuildSegment[] = input.segments.map((seg) => {
    const localRel = localClipPathByKey.get(seg.key)
    if (localRel && !seg.relativePath) {
      return { ...seg, kind: 'generate', relativePath: localRel }
    }
    if (
      seg.kind === 'generate' &&
      !seg.relativePath &&
      requestedLocalKeys.has(seg.key) &&
      hasSource &&
      seg.sourceStartSec != null &&
      seg.sourceEndSec != null &&
      seg.sourceEndSec > seg.sourceStartSec
    ) {
      return { ...seg, kind: 'source' }
    }
    return seg
  })

  // 能用的段：直通段需要原片，生成段需要片段文件
  const usable = resolvedSegments.filter((seg) => {
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
  const dropped = resolvedSegments.length - usable.length
  if (dropped > 0) {
    notes.push(
      hasSource
        ? `${dropped} 段素材缺失已跳过` // cjk-ok
        : `${dropped} 段需要原片但原片不可用（${sourceRel || '未知路径'}），已跳过` // cjk-ok
    )
  }
  if (usable.length === 0)
    return { ...result, localClipCount, error: 'no usable segments to rebuild' }

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
  const sourceFacts = hasSource ? await probeMediaFacts(sourceAbs).catch(() => null) : null
  const defaultVNorm = buildAspectAwareVNorm(
    sourceFacts?.width ?? width,
    sourceFacts?.height ?? height,
    width,
    height,
    fps
  )
  const clipFactsCache = new Map<string, MediaFacts | null>()
  const clipCutsCache = new Map<string, number[]>()
  const getClipFacts = async (abs: string): Promise<MediaFacts | null> => {
    if (clipFactsCache.has(abs)) return clipFactsCache.get(abs)!
    const probed = await probeMediaFacts(abs).catch(() => null)
    clipFactsCache.set(abs, probed)
    return probed
  }
  const getClipInternalCuts = async (abs: string, fullSec: number): Promise<number[]> => {
    if (clipCutsCache.has(abs)) return clipCutsCache.get(abs)!
    const cf = await getClipFacts(abs)
    try {
      const det = await detectShots(
        abs,
        cf ?? { durationSec: fullSec, fps, width, height, hasAudio: false }
      )
      const cuts = det.shots
        .slice(1)
        .map((s) => s.range.start)
        .filter((t) => t > 0.15 && t < fullSec - 0.15)
        .sort((a, b) => a - b)
      clipCutsCache.set(abs, cuts)
      return cuts
    } catch {
      clipCutsCache.set(abs, [])
      return []
    }
  }

  const partPaths: string[] = []
  for (let i = 0; i < laid.length; i += 1) {
    const seg = laid[i]!
    const dur = seg.durationSec
    const partAbs = join(workDirAbs, `part.${String(i).padStart(3, '0')}.mp4`)
    const args: string[] = ['-y']
    let vNorm = defaultVNorm
    let vFilter = vNorm
    if (seg.kind === 'source') {
      args.push('-ss', seg.sourceStartSec!.toFixed(3), '-t', dur.toFixed(3), '-i', sourceAbs)
      result.passthroughCount += 1
    } else {
      const clipAbs = toAbs(root, seg.relativePath!)
      const clipFacts = await getClipFacts(clipAbs)
      vNorm = buildAspectAwareVNorm(
        clipFacts?.width ?? 0,
        clipFacts?.height ?? 0,
        width,
        height,
        fps
      )
      vFilter = vNorm
      const fullClipSec = clipFacts?.durationSec || (await probeDurationSec(clipAbs))
      const isSliced =
        seg.clipDurationRatio != null &&
        seg.clipDurationRatio > 0 &&
        seg.clipDurationRatio < 0.999 &&
        fullClipSec > 0
      let clipSec = fullClipSec
      if (isSliced) {
        const offsetRatio = Math.max(0, Math.min(0.999, seg.clipOffsetRatio ?? 0))
        const propStart = offsetRatio * fullClipSec
        const propEnd = Math.min(fullClipSec, propStart + seg.clipDurationRatio! * fullClipSec)
        const internalCuts = await getClipInternalCuts(clipAbs, fullClipSec)
        const snapped = snapSliceBoundsToCuts(propStart, propEnd, fullClipSec, internalCuts)
        const sliceOffsetSec = snapped.startSec
        clipSec = snapped.durationSec
        if (snapped.snapped) {
          notes.push(
            `${seg.key} 跨镜切片自动吸附实测切点 [${sliceOffsetSec.toFixed(2)}s..${(sliceOffsetSec + clipSec).toFixed(2)}s]` // cjk-ok
          )
        }
        args.push('-ss', sliceOffsetSec.toFixed(3), '-t', clipSec.toFixed(3), '-i', clipAbs)
      } else {
        args.push('-i', clipAbs)
      }
      if (isSliced && clipSec > 0) {
        const ratio = dur / clipSec
        if (Math.abs(clipSec - dur) <= 0.02) {
          vFilter = `setpts=PTS-STARTPTS,${vNorm}`
        } else if (ratio >= 0.25 && ratio <= 2.5) {
          vFilter = `setpts=${ratio.toFixed(4)}*(PTS-STARTPTS),${vNorm}`
        } else if (clipSec < dur - 0.02) {
          vFilter = `setpts=PTS-STARTPTS,${vNorm},tpad=stop_mode=clone:stop_duration=${(dur - clipSec).toFixed(3)}`
        } else {
          vFilter = `setpts=PTS-STARTPTS,${vNorm}`
        }
      } else if (seg.fitMode === 'stretch' && clipSec > 0 && Math.abs(clipSec - dur) > 0.02) {
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

  // ── 3. 拼接 + ASS 分层字幕/花字烧录 ──────────────────────────────────────────
  const listPath = join(workDirAbs, 'concat.txt')
  writeFileSync(listPath, partPaths.map(listLine).join('\n'), 'utf8')
  const cues =
    input.burnSubtitles !== false && input.subtitles?.length
      ? mapCuesToOutput(input.subtitles, laid)
      : []
  const assBuilt =
    input.burnSubtitles !== false
      ? buildAssSubtitles({
          cues,
          packagingOverlays: input.packagingOverlays,
          laid,
          width,
          height
        })
      : { assText: '', dialogueCount: 0, overlayCount: 0, totalEvents: 0 }
  const assPath = assBuilt.assText ? join(workDirAbs, 'subtitles.ass') : ''
  if (assPath) writeFileSync(assPath, assBuilt.assText, 'utf8')

  const srtText = cues.length ? buildSrt(cues) : ''
  const srtPath = srtText ? join(workDirAbs, 'subtitles.srt') : ''
  if (srtPath) writeFileSync(srtPath, srtText, 'utf8')

  const copyArgs = ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputAbs]
  if (assPath || srtPath) {
    const primaryFilter = assPath ? assFilter(assPath) : subtitlesFilter(srtPath)
    const makeBurnArgs = (vf: string): string[] => [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-vf',
      vf,
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
      await runFfmpeg(ffmpeg, makeBurnArgs(primaryFilter))
      result.burnedSubtitles = assPath ? assBuilt.totalEvents : cues.length
    } catch (e) {
      let recoveredWithSrt = false
      if (assPath && srtPath) {
        try {
          await runFfmpeg(ffmpeg, makeBurnArgs(subtitlesFilter(srtPath)))
          result.burnedSubtitles = cues.length
          notes.push('ASS 花字滤镜不可用，已自动回退为 SRT 字幕烧录') // cjk-ok
          recoveredWithSrt = true
        } catch {
          recoveredWithSrt = false
        }
      }
      if (!recoveredWithSrt) {
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
    }
  } else {
    try {
      await runFfmpeg(ffmpeg, copyArgs)
    } catch (e) {
      return { ...result, keptAudio, error: e instanceof Error ? e.message : String(e) }
    }
  }
  if (!existsSync(outputAbs))
    return { ...result, localClipCount, keptAudio, error: 'output missing after ffmpeg' }

  let compareRelativePath: string | undefined
  if (input.renderCompare && hasSource) {
    const compareRel = input.compareRelativePath || `${input.workDirRelativePath}/compare.mp4`
    const compareAbs = toAbs(root, compareRel)
    const okCompare = await renderSideBySideCompareVideo({
      sourceAbs,
      remakeAbs: outputAbs,
      outputCompareAbs: compareAbs,
      width,
      height,
      fps
    })
    if (okCompare) {
      compareRelativePath = compareRel
    } else {
      notes.push('并排对比视频 compare.mp4 生成失败，不影响主成片') // cjk-ok
    }
  }

  return {
    ...result,
    ok: true,
    keptAudio,
    localClipCount,
    ...(compareRelativePath ? { compareRelativePath } : {})
  }
}
