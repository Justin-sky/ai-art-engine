/**
 * 语义重建的**本地拼接**服务：把生成的镜头片段接成最终成片。
 *
 * 与旧的"语义编辑"不同：那边是把**原片**按镜头裁开重排；这边素材是**模型新生成的片段**
 * （每段可能编码/分辨率/帧率都不同），所以不能指望 stream copy —— 默认**统一重编码**，
 * 只有"片段参数一致且用户没要求字幕/音轨"时才尝试直拷。
 *
 * 音轨策略（默认）：保留**原片音轨**（口播/音乐是创作的锚点），生成片段自带的声音丢掉；
 * 字幕策略（默认）：用时间线的**转写**生成 SRT 并烧录（与旧的成片管线口径一致）。
 * 两条都能在节点上关掉 —— 关掉后不再引入原片，避免"生成视频里出现原片声音"的意外。
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { runFfmpeg } from '../ffmpegRunner'
import { resolveFfmpegForSemantic, resolveFfprobeForSemantic } from './resolveFfmpeg'

export interface RebuildClipInput {
  /** 片段标识（shotId / full）：写进清单便于定位 */
  key: string
  /** 片段文件（工程相对路径） */
  relativePath: string
}

export interface RebuildSubtitleCue {
  startSec: number
  endSec: number
  text: string
}

export interface RebuildServiceInput {
  timelineId: string
  /** 工程根（片段相对路径据此解析）；由 bridge 注入，服务本身不依赖 projectService */
  projectRoot: string
  clips: RebuildClipInput[]
  /** 最终输出（工程相对路径） */
  outputRelativePath: string
  /** 工作目录（工程相对路径） */
  workDirRelativePath: string
  /** 保留原片音轨（原片相对路径） */
  keepAudio?: boolean
  sourceRelativePath?: string
  burnSubtitles?: boolean
  subtitles?: RebuildSubtitleCue[]
  width?: number
  height?: number
  fps?: number
}

export interface RebuildServiceResult {
  ok: boolean
  outputRelativePath: string
  /** 'concat-copy' | 'reencode' */
  method: 'concat-copy' | 'reencode'
  clipCount: number
  burnedSubtitles: number
  keptAudio: boolean
  notes: string[]
  error?: string
}

function toAbs(root: string, rel: string): string {
  return join(root, ...rel.split('/'))
}

/** concat demuxer 需要正斜杠 + 单引号转义 */
function listLine(absPath: string): string {
  const escaped = absPath.replace(/\\/g, '/').replace(/'/g, "'\\''")
  return `file '${escaped}'`
}

/** 拼接过程的提示文案（中英成对，便于日志两种语言都能读） */
const REBUILD_NOTES = {
  missingClips: { zh: '个片段缺失已跳过', en: 'missing clip files skipped' },
  noAudio: { zh: '原片音轨不可用', en: 'original audio unavailable' },
  subtitleFailed: { zh: '字幕烧录失败，改为无字幕重建', en: 'subtitle burn failed, no subs' }
}

/** 秒 → SRT 时间戳 `HH:MM:SS,mmm` */
function srtTime(sec: number): string {
  const total = Math.max(0, sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = Math.floor(total % 60)
  const ms = Math.round((total - Math.floor(total)) * 1000)
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`
}

export function buildSrt(cues: RebuildSubtitleCue[]): string {
  return cues
    .filter((cue) => cue.text?.trim() && cue.endSec > cue.startSec)
    .map((cue, index) => {
      const text = cue.text.trim().replace(/\r?\n/g, ' ')
      return `${index + 1}\n${srtTime(cue.startSec)} --> ${srtTime(cue.endSec)}\n${text}\n`
    })
    .join('\n')
}

/**
 * 烧录字幕的 filter 参数：路径要转义（Windows 盘符的 `:` 与反斜杠是 ffmpeg filter 的雷区）。
 * 手法与仓库其它地方一致：正斜杠 + 转义冒号 + 单引号包裹。
 */
function subtitlesFilter(srtAbs: string): string {
  const escaped = srtAbs.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
  return `subtitles='${escaped}'`
}

export async function rebuildVideo(input: RebuildServiceInput): Promise<RebuildServiceResult> {
  const notes: string[] = []
  const clips = input.clips.filter((clip) => !!clip?.relativePath?.trim())
  const result: RebuildServiceResult = {
    ok: false,
    outputRelativePath: input.outputRelativePath,
    method: 'reencode',
    clipCount: clips.length,
    burnedSubtitles: 0,
    keptAudio: false,
    notes
  }
  if (clips.length === 0) {
    return { ...result, error: 'no clips to rebuild' }
  }

  const root = input.projectRoot
  const workDirAbs = toAbs(root, input.workDirRelativePath)
  const outputAbs = toAbs(root, input.outputRelativePath)
  mkdirSync(workDirAbs, { recursive: true })

  const missing = clips.filter((clip) => !existsSync(toAbs(root, clip.relativePath)))
  if (missing.length === clips.length) {
    return { ...result, error: `no clip files on disk (e.g. ${missing[0]?.relativePath})` }
  }
  if (missing.length > 0) {
    notes.push(
      `${missing.length} ${REBUILD_NOTES.missingClips.zh} / ${missing.length} ${REBUILD_NOTES.missingClips.en}: ${missing
        .map((c) => c.key)
        .join(', ')}`
    )
  }
  const usable = clips.filter((clip) => existsSync(toAbs(root, clip.relativePath)))

  const ffmpeg = resolveFfmpegForSemantic()
  const listPath = join(workDirAbs, 'concat.txt')
  writeFileSync(
    listPath,
    usable.map((clip) => listLine(toAbs(root, clip.relativePath))).join('\n'),
    'utf8'
  )

  // ── 音轨 / 字幕素材 ────────────────────────────────────────────────────────
  const audioAbs =
    input.keepAudio && input.sourceRelativePath?.trim()
      ? toAbs(root, input.sourceRelativePath.trim())
      : ''
  const keptAudio = !!audioAbs && existsSync(audioAbs)
  if (input.keepAudio && !keptAudio) {
    notes.push(`${REBUILD_NOTES.noAudio.zh} / ${REBUILD_NOTES.noAudio.en}`)
  }

  const srtText = input.burnSubtitles && input.subtitles?.length ? buildSrt(input.subtitles) : ''
  const srtPath = srtText ? join(workDirAbs, 'subtitles.srt') : ''
  if (srtPath) writeFileSync(srtPath, srtText, 'utf8')
  const burnedSubtitles = srtText ? (input.subtitles?.length ?? 0) : 0

  const args: string[] = ['-y', '-f', 'concat', '-safe', '0', '-i', listPath]
  if (keptAudio) args.push('-i', audioAbs)

  const filters: string[] = []
  const scale =
    input.width && input.height
      ? `scale=${input.width}:${input.height}:force_original_aspect_ratio=decrease,pad=${input.width}:${input.height}:(ow-iw)/2:(oh-ih)/2`
      : ''
  if (scale) filters.push(scale)
  if (srtPath) filters.push(subtitlesFilter(srtPath))

  args.push(
    '-map',
    '0:v:0',
    ...(keptAudio ? ['-map', '1:a:0?'] : []),
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    ...(input.fps && input.fps > 0 ? ['-r', String(Math.round(input.fps))] : []),
    ...(filters.length ? ['-vf', filters.join(',')] : []),
    ...(keptAudio ? ['-c:a', 'aac', '-b:a', '192k', '-shortest'] : []),
    outputAbs
  )

  try {
    await runFfmpeg(ffmpeg, args)
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    /**
     * 字幕烧录失败是最常见的"环境问题"（缺字体/滤镜不可用）：
     * 退一步**只拼接**再跑一次，让成片仍然产出，同时把原因写进 notes。
     */
    if (srtPath) {
      notes.push(
        `${REBUILD_NOTES.subtitleFailed.zh} / ${REBUILD_NOTES.subtitleFailed.en}: ${reason}`
      )
      const retryArgs = args.filter((arg, index) => {
        const prev = args[index - 1]
        return !(prev === '-vf' && arg.includes('subtitles=')) && arg !== srtPath
      })
      try {
        await runFfmpeg(ffmpeg, retryArgs)
        return { ...result, ok: true, keptAudio, burnedSubtitles: 0, notes }
      } catch (retryError) {
        return {
          ...result,
          keptAudio,
          burnedSubtitles: 0,
          notes,
          error: retryError instanceof Error ? retryError.message : String(retryError)
        }
      }
    }
    return { ...result, keptAudio, error: reason }
  }

  if (!existsSync(outputAbs)) {
    return { ...result, keptAudio, burnedSubtitles, error: 'output missing after ffmpeg' }
  }
  return {
    ...result,
    ok: true,
    method: 'reencode',
    keptAudio,
    burnedSubtitles,
    notes
  }
}

/** 供调用方（bridge）探测 ffprobe 是否可用：缺 ffmpeg 时给出可执行提示 */
export function rebuildFfmpegAvailable(): boolean {
  try {
    return !!resolveFfmpegForSemantic() && !!resolveFfprobeForSemantic()
  } catch {
    return false
  }
}
