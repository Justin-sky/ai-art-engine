/**
 * 成片时间线导出：系统 ffmpeg 合成视频轨 + 配音/音乐 + 字幕烧录。
 */
import { spawn } from 'child_process'
import { dialog } from 'electron'
import { existsSync, mkdtempSync, copyFileSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, basename, dirname, extname } from 'path'
import type {
  ScriptTimelineTrackKind,
  TimelineExportClip,
  TimelineExportInput,
  TimelineExportResult,
  TimelineMixGains
} from '@shared/graph'
import { IpcChannels } from '@shared/ipc'
import { fail, defErr, defErrSimple } from '@shared/errors/appError'
import { MAIN_ERRORS } from '../errors/messages'
import { projectService } from './projectService'
import { buildPreviewFramePlan } from '@shared/graph/timelinePreview'
import { findFfmpegBin } from './videoFrameService'
import { broadcastToAllWindows } from '../broadcast'

// ── 时间线导出个性错误 ──
// 渲染端 ScriptTimelineEditor 按 code === 'TIMELINE_FFMPEG_MISSING' 分支；zh 文案保留 FFmpeg 关键字
const E_TIMELINE_FFMPEG_MISSING = defErrSimple(
  'TIMELINE_FFMPEG_MISSING',
  '无法启动 ffmpeg：未找到可执行文件。请安装 ffmpeg 并加入 PATH，或设置 FFMPEG_PATH。',
  'FFmpeg executable was not found; install it or configure the path in Settings'
)
const E_TIMELINE_FFMPEG_LAUNCH_FAILED = defErr<{ detail: string }>(
  'timeline.ffmpegLaunchFailed',
  ({ detail }) => `无法启动 ffmpeg：${detail}。请安装 ffmpeg 并加入 PATH，或设置 FFMPEG_PATH。`,
  ({ detail }) => `Could not start ffmpeg: ${detail}. Install ffmpeg onto PATH or set FFMPEG_PATH.`
)
const E_TIMELINE_FFMPEG_EXITED = defErr<{ stderr: string; exitCode: number | null }>(
  'timeline.ffmpegExited',
  ({ stderr, exitCode }) => stderr || `ffmpeg 退出码 ${exitCode}`,
  ({ stderr, exitCode }) => stderr || `ffmpeg exited with code ${exitCode}`
)
const E_TIMELINE_NO_EXPORTABLE_CLIPS = defErrSimple(
  'timeline.noExportableClips',
  '时间线上没有可导出的视频或音频片段',
  'The timeline has no exportable video or audio clips'
)
const E_TIMELINE_CANCELLED = defErrSimple('timeline.cancelled', '已取消', 'Cancelled')
const E_TIMELINE_NO_PREVIEW_FRAMES = defErrSimple(
  'timeline.noPreviewFrames',
  '没有可抽帧的时间点',
  'No timestamps to capture'
)
const E_TIMELINE_PREVIEW_FAILED = defErrSimple(
  'timeline.previewFailed',
  '抽帧失败：ffmpeg 没有产出画面（时间点可能落在成片内容之外）',
  'Frame capture failed: ffmpeg produced no picture'
)

/** 预览帧默认宽度：够看清构图与字幕，又不至于让 base64 响应过大 */
const PREVIEW_FRAME_WIDTH = 640
/** 预览帧 JPEG 质量（ffmpeg -q:v：数值越小质量越高、体积越大） */
const PREVIEW_JPEG_QUALITY = 4

function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/\n/g, ' ')
}

function findDrawtextFont(): string | null {
  const candidates =
    process.platform === 'win32'
      ? [
          'C:/Windows/Fonts/msyh.ttc',
          'C:/Windows/Fonts/msyhbd.ttc',
          'C:/Windows/Fonts/simhei.ttf',
          'C:/Windows/Fonts/simsun.ttc',
          'C:/Windows/Fonts/arial.ttf'
        ]
      : process.platform === 'darwin'
        ? [
            '/System/Library/Fonts/PingFang.ttc',
            '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
            '/Library/Fonts/Arial.ttf'
          ]
        : [
            '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
            '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
            '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
          ]
  return candidates.find((p) => existsSync(p)) ?? null
}

function runFfmpeg(bin: string, args: string[], onTime?: (sec: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true })
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderr += text
      const m = text.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/)
      if (m && onTime) {
        onTime(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]))
      }
    })
    child.on('error', (err) => {
      // 保留原生 spawn 错误（ENOENT 等）作为 cause，文案保留 FFmpeg 关键字供渲染端兜底匹配
      reject(
        Object.assign(fail(E_TIMELINE_FFMPEG_LAUNCH_FAILED, { detail: err.message }), {
          cause: err
        })
      )
    })
    child.on('close', (code) => {
      // stderr 为 ffmpeg 原生输出，原样透传
      if (code === 0) resolve()
      else
        reject(
          fail(E_TIMELINE_FFMPEG_EXITED, { stderr: stderr.trim().slice(-900), exitCode: code })
        )
    })
  })
}

/** 片段在源文件内的取段起点（秒）；无打点选段时为 0（从源头部整段截取） */
function clipSourceOffsetSec(clip: { sourceOffsetSec?: number }): number {
  const n = Number(clip.sourceOffsetSec)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(Math.min(3600, n) * 100) / 100
}

function resolveClipPath(clip: TimelineExportClip): string | null {
  if (clip.absPath && existsSync(clip.absPath)) return clip.absPath
  const rel = clip.relativePath?.trim()
  if (!rel || !projectService.isOpen()) return null
  try {
    const abs = join(projectService.getRoot(), rel)
    return existsSync(abs) ? abs : null
  } catch {
    return null
  }
}

function buildFilterGraph(
  mainVideos: Array<TimelineExportClip & { path: string; inputIndex: number }>,
  overlays: Array<TimelineExportClip & { path: string; inputIndex: number }>,
  audios: Array<TimelineExportClip & { path: string; inputIndex: number }>,
  subs: TimelineExportClip[],
  baseVideoIndex: number,
  baseAudioIndex: number,
  rate: number,
  width: number,
  height: number,
  fps: number,
  subtitleFontSize: number,
  subtitleYOffset: number,
  subtitleColor: string,
  mix?: {
    mixGains?: TimelineMixGains
    mixMasterGain?: number
    mixBassGainDb?: number
    mixTrebleGainDb?: number
    mixCompression?: boolean
    /** 静音轨道：这些轨道的声音不混入成片 */
    mutedTracks?: ScriptTimelineTrackKind[]
  },
  watermark?: {
    inputIndex: number
    opacity: number
    scale: number
    position: 'br' | 'bl' | 'tr' | 'tl'
  }
): { filter: string; mapVideo: string; mapAudio: string } {
  const filterParts: string[] = []
  filterParts.push(`[${baseVideoIndex}:v]format=yuv420p[base]`)

  // ── 主视频轨：逐段拼接（每段独立裁剪，最后一次性 concat），杜绝链式 xfade 的累计漂移 ──
  // 片段时间线转场语义（与预览一致）：相邻片段 A(前) / B(后) 有重叠窗口
  // overlap = A.end − B.start（>0 才可能有转场）。B.transitionInSec 记录生效转场时长，
  // 预览在窗口内把 B 按 progress 叠加在 A 之上。导出同样在该窗口用 xfade 合成。
  const orderedMainVideos = [...mainVideos].sort((a, b) => a.startSec - b.startSec)
  let lastVideo = 'base'
  const mainClipEnd = (c: TimelineExportClip): number => c.startSec + Math.max(0.05, c.durationSec)

  if (orderedMainVideos.length) {
    const count = orderedMainVideos.length
    // 片段间可支持的转场（与 ffmpeg xfade 的类型一一对应；值即 xfade transition 名）
    const xfadeMap: Record<string, string> = {
      dissolve: 'dissolve',
      fade: 'fadeblack',
      fadeout: 'fadeblack',
      fadein: 'fadeblack',
      flash: 'fadewhite',
      slideleft: 'slideleft',
      slideright: 'slideright',
      slideup: 'slideup',
      slidedown: 'slidedown',
      wipeleft: 'wipeleft',
      wiperight: 'wiperight',
      wipeup: 'wipeup',
      wipedown: 'wipedown',
      circleopen: 'circleopen',
      circleclose: 'circleclose'
    }
    const xfadeTransitionName = (type: string | undefined): string | null =>
      xfadeMap[type ?? ''] ?? null

    // 逐对计算：几何重叠量 + 实际生效转场时长
    // （生效时长 = min(重叠量, B.transitionInSec, A/B 各自时长)，type 必须可 xfade）
    const overlapAfter: number[] = []
    const transDur: number[] = []
    for (let i = 0; i < count - 1; i++) {
      const left = orderedMainVideos[i]!
      const right = orderedMainVideos[i + 1]!
      const overlap = Math.max(0, mainClipEnd(left) - right.startSec)
      overlapAfter.push(overlap)
      const inSec = Math.max(0, right.transitionInSec ?? 0)
      const supported =
        overlap > 0.001 && inSec > 0.001 && xfadeTransitionName(right.transitionType) !== null
      transDur.push(
        supported
          ? Math.min(
              overlap,
              inSec,
              Math.max(0.05, left.durationSec),
              Math.max(0.05, right.durationSec)
            )
          : 0
      )
    }

    // 片段内容窗口规划：每个片段可能被切为 头窗(前向转场) / 主体 / 尾窗(后向转场)
    // 三部分互不重叠（主体跳过被转场占用的头尾），几何与片段自身时长严格对齐，杜绝漂移
    type MainWindow = { kind: 'head' | 'body' | 'tail'; start: number; dur: number; port: string }
    const windowPlans: Array<{ wins: MainWindow[] }> = []
    for (let i = 0; i < count; i++) {
      const clip = orderedMainVideos[i]!
      const dur = Math.max(0.05, clip.durationSec)
      const prev = i > 0 ? orderedMainVideos[i - 1]! : null
      const overlapPrev = prev ? Math.max(0, mainClipEnd(prev) - clip.startSec) : 0
      const dPrev = i > 0 ? transDur[i - 1]! : 0
      const overlapNext = i < count - 1 ? overlapAfter[i]! : 0
      const dNext = i < count - 1 ? transDur[i]! : 0

      const wins: MainWindow[] = []
      // 前向转场：本片段头部 [0, dPrev) 在交叉段中被播放
      if (i > 0 && dPrev > 0.001) {
        wins.push({ kind: 'head', start: 0, dur: dPrev, port: '' })
      }
      // 主体（独白部分）：跳过被前转场占用的头部与后转场占用的尾部
      const bodyStart =
        i === 0 ? 0 : overlapPrev > 0.001 ? (dPrev > 0.001 ? dPrev : overlapPrev) : 0
      const bodyEnd = dNext > 0.001 ? Math.max(0, dur - Math.min(overlapNext, dur)) : dur
      if (bodyEnd - bodyStart > 0.001) {
        wins.push({ kind: 'body', start: bodyStart, dur: bodyEnd - bodyStart, port: '' })
      }
      // 后向转场：本片段尾部在交叉段中继续播放到自身结束
      if (i < count - 1 && dNext > 0.001) {
        const tailStart = Math.min(dur, Math.max(0, dur - overlapNext))
        const tailDur = Math.min(dNext, Math.max(0, dur - tailStart))
        if (tailDur > 0.001) {
          wins.push({ kind: 'tail', start: tailStart, dur: tailDur, port: '' })
        }
      }
      windowPlans.push({ wins })
    }

    // 同一源文件可能被裁成多个窗口：先 split 显式分流，避免同输入流被多个 filter 隐式复用
    let srcIdx = 0
    for (let i = 0; i < count; i++) {
      const plan = windowPlans[i]!
      if (!plan.wins.length) continue
      if (plan.wins.length === 1) {
        plan.wins[0]!.port = `${orderedMainVideos[i]!.inputIndex}:v`
        continue
      }
      const ports: string[] = []
      for (let k = 0; k < plan.wins.length; k++) ports.push(`msrc${srcIdx++}`)
      filterParts.push(
        `[${orderedMainVideos[i]!.inputIndex}:v]split=${ports.length}${ports.map((p) => `[${p}]`).join('')}`
      )
      plan.wins.forEach((w, k) => {
        w.port = ports[k]!
      })
    }

    // 待拼接段（按时间先后顺序）：主体段 / 黑场段 / 转场 xfade 段
    const segments: string[] = []
    let segIdx = 0

    const windowPlan = (i: number, kind: MainWindow['kind']): MainWindow | undefined =>
      windowPlans[i]!.wins.find((w) => w.kind === kind)

    const normalizedVideo = (
      srcPort: string,
      srcStart: number,
      segDur: number,
      label: string
    ): void => {
      filterParts.push(
        `[${srcPort}]trim=${srcStart.toFixed(3)}:${(srcStart + segDur).toFixed(3)},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[${label}]`
      )
    }

    /** 从规划窗口中裁一段：srcStart 为该片段在源文件内的绝对时间 */
    const trimWindow = (i: number, kind: MainWindow['kind'], label: string): void => {
      const w = windowPlan(i, kind)
      if (!w) return
      const clip = orderedMainVideos[i]!
      normalizedVideo(w.port, clipSourceOffsetSec(clip) + w.start, w.dur, label)
    }

    /** 相邻两段的重叠转场段：A 的尾窗 + B 的头窗各裁 overlap 窗口后做一次独立 xfade */
    const addCrossSegment = (boundary: number): void => {
      const right = orderedMainVideos[boundary + 1]!
      const tail = windowPlan(boundary, 'tail')
      const head = windowPlan(boundary + 1, 'head')
      if (!tail || !head) return
      const aLabel = `crossa${segIdx}`
      const bLabel = `crossb${segIdx}`
      const outLabel = `cross${segIdx++}`
      trimWindow(boundary, 'tail', aLabel)
      trimWindow(boundary + 1, 'head', bLabel)
      const name = xfadeTransitionName(right.transitionType) ?? 'dissolve'
      const dur = Math.min(tail.dur, head.dur)
      filterParts.push(
        `[${aLabel}][${bLabel}]xfade=transition=${name}:duration=${dur.toFixed(3)}:offset=0[${outLabel}]`
      )
      segments.push(outLabel)
    }

    /** 主体内容段 */
    const addContentSegment = (i: number): void => {
      const w = windowPlan(i, 'body')
      if (!w) return
      const label = `mainseg${segIdx++}`
      trimWindow(i, 'body', label)
      segments.push(label)
    }

    /** 片段之间的黑场（时间线上有间隙时按实际时长补齐，保证后续时间轴不错位） */
    const addBlackSegment = (segDur: number): void => {
      if (segDur <= 0.001) return
      const label = `blackseg${segIdx++}`
      filterParts.push(
        `color=c=black:s=${width}x${height}:r=${fps}:d=${segDur.toFixed(3)},format=yuv420p[${label}]`
      )
      segments.push(label)
    }

    // 按时间顺序输出各段：前段与后段的交叉段（或间隙黑场）→ 后段主体 → …… → 一次 concat
    for (let i = 0; i < count; i++) {
      const clip = orderedMainVideos[i]!
      const prev = i > 0 ? orderedMainVideos[i - 1]! : null
      const overlapPrev = prev ? Math.max(0, mainClipEnd(prev) - clip.startSec) : 0
      const dPrev = i > 0 ? transDur[i - 1]! : 0

      if (i > 0 && dPrev > 0.001) {
        addCrossSegment(i - 1)
      } else if (i > 0 && overlapPrev <= 0.001) {
        const gap = clip.startSec - mainClipEnd(prev!)
        if (gap > 0.001) addBlackSegment(gap)
      }
      addContentSegment(i)
    }

    if (segments.length) {
      const chainLabel =
        segments.length === 1
          ? segments[0]!
          : (() => {
              const label = 'mainconcat'
              filterParts.push(
                `${segments.map((s) => `[${s}]`).join('')}concat=n=${segments.length}:v=1:a=0[${label}]`
              )
              return label
            })()
      // concat 链从 0 起，整体平移到时间线真实起点后再叠到黑色底上
      const firstStart = Math.max(0, orderedMainVideos[0]!.startSec)
      const shiftedMain = 'mainshifted'
      filterParts.push(`[${chainLabel}]setpts=PTS+${firstStart.toFixed(3)}/TB[${shiftedMain}]`)
      filterParts.push(`[base][${shiftedMain}]overlay=0:0[mainbase]`)
      lastVideo = 'mainbase'
    }
  }

  for (const clip of overlays) {
    const start = Math.max(0, clip.startSec)
    const dur = Math.max(0.05, clip.durationSec)
    const opacity = Number.isFinite(clip.opacity) ? Math.min(1, Math.max(0, clip.opacity!)) : 1
    const relX = Number.isFinite(clip.overlayX) ? Math.min(1, Math.max(0, clip.overlayX!)) : 0.12
    const relY = Number.isFinite(clip.overlayY) ? Math.min(1, Math.max(0, clip.overlayY!)) : 0.12
    const relW = Number.isFinite(clip.overlayWidth)
      ? Math.min(1, Math.max(0.05, clip.overlayWidth!))
      : 0.36
    const relH = Number.isFinite(clip.overlayHeight)
      ? Math.min(1, Math.max(0.05, clip.overlayHeight!))
      : 0.36
    const ow = Math.max(2, Math.round(width * relW))
    const oh = Math.max(2, Math.round(height * relH))
    const x = Math.max(0, Math.min(width - ow, Math.round(width * relX)))
    const y = Math.max(0, Math.min(height - oh, Math.round(height * relY)))
    const vLabel = `pip${clip.inputIndex}`
    const ovLabel = `pipov${clip.inputIndex}`
    const prev = lastVideo
    const srcStart = clipSourceOffsetSec(clip)
    filterParts.push(
      `[${clip.inputIndex}:v]trim=${srcStart > 0 ? `${srcStart}:${(srcStart + dur).toFixed(3)}` : `0:${dur}`},setpts=PTS-STARTPTS,scale=${ow}:${oh}:force_original_aspect_ratio=decrease,pad=${ow}:${oh}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=rgba,colorchannelmixer=aa=${opacity.toFixed(3)}[${vLabel}]`
    )
    filterParts.push(
      `[${prev}][${vLabel}]overlay=${x}:${y}:enable='between(t\\,${start.toFixed(3)}\\,${(start + dur).toFixed(3)})'[${ovLabel}]`
    )
    lastVideo = ovLabel
  }

  const font = findDrawtextFont()
  const fontOpt = font ? `:fontfile='${font.replace(/\\/g, '/').replace(/:/g, '\\:')}'` : ''

  for (const [i, sub] of subs.entries()) {
    const text = escapeDrawtext((sub.text || sub.title).trim())
    if (!text) continue
    const start = Math.max(0, sub.startSec)
    const end = start + Math.max(0.05, sub.durationSec)
    const next = `sub${i}`
    filterParts.push(
      `[${lastVideo}]drawtext=text='${text}'${fontOpt}:fontsize=${subtitleFontSize}:fontcolor=${subtitleColor}:borderw=2:bordercolor=black:x=(w-text_w)/2:y=h-${subtitleYOffset}:enable='between(t\\,${start.toFixed(3)}\\,${end.toFixed(3)})'[${next}]`
    )
    lastVideo = next
  }

  if (watermark) {
    const targetW = Math.max(24, Math.round(width * Math.min(0.5, Math.max(0.05, watermark.scale))))
    const wmLabel = 'wm'
    const wmOvLabel = 'wmoverlay'
    const opacity = Math.min(1, Math.max(0.05, watermark.opacity))
    filterParts.push(
      `[${watermark.inputIndex}:v]scale=${targetW}:-1:force_original_aspect_ratio=decrease,format=rgba,colorchannelmixer=aa=${opacity.toFixed(3)}[${wmLabel}]`
    )
    const margin = Math.max(12, Math.round(Math.min(width, height) * 0.03))
    const positionMap: Record<'br' | 'bl' | 'tr' | 'tl', string> = {
      br: `main_w-overlay_w-${margin}:main_h-overlay_h-${margin}`,
      bl: `${margin}:main_h-overlay_h-${margin}`,
      tr: `main_w-overlay_w-${margin}:${margin}`,
      tl: `${margin}:${margin}`
    }
    filterParts.push(
      `[${lastVideo}][${wmLabel}]overlay=${positionMap[watermark.position]}[${wmOvLabel}]`
    )
    lastVideo = wmOvLabel
  }

  const audioMixInputs: string[] = [`[${baseAudioIndex}:a]`]
  for (const clip of audios) {
    const startMs = Math.max(0, Math.round(clip.startSec * 1000))
    const dur = Math.max(0.05, clip.durationSec)
    const clipVolume = Number.isFinite(clip.volume) ? Math.min(1, Math.max(0, clip.volume!)) : 1
    const trackGain = Number.isFinite(mix?.mixGains?.[clip.track])
      ? Math.min(2, Math.max(0, mix!.mixGains![clip.track]!))
      : 1
    // 轨道静音优先级最高：高于片段音量与混音器轨道增益
    const volume = mix?.mutedTracks?.includes(clip.track) ? 0 : Math.min(2, clipVolume * trackGain)
    const fadeIn = Number.isFinite(clip.fadeInSec) ? Math.min(dur, Math.max(0, clip.fadeInSec!)) : 0
    const fadeOut = Number.isFinite(clip.fadeOutSec)
      ? Math.min(dur, Math.max(0, clip.fadeOutSec!))
      : 0
    const aLabel = `a${clip.inputIndex}`
    const chain = [
      'atrim=0:' + dur,
      'asetpts=PTS-STARTPTS',
      Math.abs(volume - 1) > 0.001 ? `volume=${volume.toFixed(3)}` : '',
      fadeIn > 0 ? `afade=t=in:st=0:d=${fadeIn.toFixed(3)}` : '',
      fadeOut > 0
        ? `afade=t=out:st=${Math.max(0, dur - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`
        : '',
      `adelay=${startMs}|${startMs}`
    ]
      .filter(Boolean)
      .join(',')
    filterParts.push(`[${clip.inputIndex}:a]${chain}[${aLabel}]`)
    audioMixInputs.push(`[${aLabel}]`)
  }

  filterParts.push(
    `${audioMixInputs.join('')}amix=inputs=${audioMixInputs.length}:duration=longest:dropout_transition=0:normalize=0[amixout]`
  )

  // 混音器后处理：主输出增益 → 基础 EQ（低频 / 高频）→ 可选动态压缩
  const masterGain = Number.isFinite(mix?.mixMasterGain)
    ? Math.min(2, Math.max(0, mix!.mixMasterGain!))
    : 1
  const bassDb = Number.isFinite(mix?.mixBassGainDb)
    ? Math.min(12, Math.max(-12, mix!.mixBassGainDb!))
    : 0
  const trebleDb = Number.isFinite(mix?.mixTrebleGainDb)
    ? Math.min(12, Math.max(-12, mix!.mixTrebleGainDb!))
    : 0
  const postChain: string[] = []
  if (Math.abs(masterGain - 1) > 0.001) {
    postChain.push(`volume=${masterGain.toFixed(3)}`)
  }
  if (Math.abs(bassDb) > 0.01) {
    postChain.push(`equalizer=f=120:t=q:w=1:g=${bassDb.toFixed(2)}`)
  }
  if (Math.abs(trebleDb) > 0.01) {
    postChain.push(`equalizer=f=8000:t=q:w=1:g=${trebleDb.toFixed(2)}`)
  }
  if (mix?.mixCompression) {
    postChain.push(`acompressor=threshold=0.2:ratio=2:attack=20:release=250:makeup=1`)
  }
  if (postChain.length) {
    const postLabel = 'amixpost'
    filterParts.push(`[amixout]${postChain.join(',')}[${postLabel}]`)
    filterParts.push(`[${postLabel}]anull[aout]`)
  } else {
    filterParts.push(`[amixout]anull[aout]`)
  }

  if (rate !== 1) {
    const clamped = Math.min(2, Math.max(0.5, rate))
    filterParts.push(`[${lastVideo}]setpts=PTS/${clamped}[vout]`)
    filterParts.push(`[aout]atempo=${clamped}[aouts]`)
    return { filter: filterParts.join(';'), mapVideo: '[vout]', mapAudio: '[aouts]' }
  }
  return { filter: filterParts.join(';'), mapVideo: `[${lastVideo}]`, mapAudio: '[aout]' }
}

/**
 * 准备输入参数与滤镜图（导出 MP4 与抽帧预览共用同一条流水线）。
 *
 * 两条链路拿到同一份 filter：预览看到的画面与导出严格一致，
 * 不会出现「预览好看、导出难看」的口径差——转场预览微渲染遵循的也是这条约定。
 */
function prepareTimelinePipeline(input: TimelineExportInput): {
  args: string[]
  filter: string
  mapVideo: string
  mapAudio: string
  duration: number
  rate: number
  width: number
  height: number
  fps: number
  videoBitrateKbps: number
} {
  const duration = Math.max(1, input.durationSec)
  const rate = input.playbackRate && input.playbackRate > 0 ? input.playbackRate : 1
  const width = Math.min(7680, Math.max(320, Math.round(input.width ?? 1280)))
  const height = Math.min(4320, Math.max(180, Math.round(input.height ?? 720)))
  const fps = Math.min(60, Math.max(1, Math.round(input.fps ?? 30)))
  const videoBitrateKbps = Math.min(
    200000,
    Math.max(500, Math.round(input.videoBitrateKbps ?? 5000))
  )
  const subtitleFontSize = Math.min(200, Math.max(12, Math.round(input.subtitleFontSize ?? 36)))
  const subtitleYOffset = Math.min(1000, Math.max(0, Math.round(input.subtitleYOffset ?? 80)))
  const subtitleColor =
    input.subtitleColor && /^#[0-9a-fA-F]{6}$/.test(input.subtitleColor.trim())
      ? input.subtitleColor.trim()
      : 'white'

  const mainVideoClips = input.clips.filter((c) => c.track === 'video')
  const overlayClips = input.clips.filter((c) => c.track === 'overlay')
  const voiceMusicClips = input.clips.filter(
    (c) => c.track === 'voice' || c.track === 'music' || c.track === 'sfx'
  )
  const subs = input.clips.filter(
    (c) => c.track === 'subtitle' && (c.text?.trim() || c.title.trim())
  )

  const args: string[] = ['-y', '-hide_banner', '-loglevel', 'error']
  let inputIndex = 0

  args.push('-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:d=${duration}:r=${fps}`)
  const baseVideoIndex = inputIndex++
  args.push('-f', 'lavfi', '-i', `anullsrc=channel_layout=stereo:sample_rate=44100:d=${duration}`)
  const baseAudioIndex = inputIndex++

  const mainVideos: Array<TimelineExportClip & { path: string; inputIndex: number }> = []
  for (const clip of mainVideoClips) {
    const path = resolveClipPath(clip)
    if (!path) continue
    args.push('-i', path)
    mainVideos.push({ ...clip, path, inputIndex: inputIndex++ })
  }

  const audioOnlyInputs: Array<TimelineExportClip & { path: string; inputIndex: number }> = []
  for (const clip of voiceMusicClips) {
    const path = resolveClipPath(clip)
    if (!path) continue
    args.push('-i', path)
    audioOnlyInputs.push({ ...clip, path, inputIndex: inputIndex++ })
  }

  const overlays: Array<TimelineExportClip & { path: string; inputIndex: number }> = []
  for (const clip of overlayClips) {
    const path = resolveClipPath(clip)
    if (!path) continue
    args.push('-i', path)
    overlays.push({ ...clip, path, inputIndex: inputIndex++ })
  }

  let watermarkInputIndex: number | undefined
  const watermarkSrc = input.watermarkSrc?.trim()
  if (watermarkSrc && existsSync(watermarkSrc)) {
    args.push('-i', watermarkSrc)
    watermarkInputIndex = inputIndex++
  }

  if (!mainVideos.length && !overlays.length && !audioOnlyInputs.length) {
    throw fail(E_TIMELINE_NO_EXPORTABLE_CLIPS)
  }

  const audios = [...audioOnlyInputs, ...overlays]
  const { filter, mapVideo, mapAudio } = buildFilterGraph(
    mainVideos,
    overlays,
    audios,
    subs,
    baseVideoIndex,
    baseAudioIndex,
    rate,
    width,
    height,
    fps,
    subtitleFontSize,
    subtitleYOffset,
    subtitleColor,
    {
      mixGains: input.mixGains,
      mixMasterGain: input.mixMasterGain,
      mixBassGainDb: input.mixBassGainDb,
      mixTrebleGainDb: input.mixTrebleGainDb,
      mixCompression: input.mixCompression,
      mutedTracks: input.mutedTracks
    },
    watermarkInputIndex === undefined
      ? undefined
      : {
          inputIndex: watermarkInputIndex,
          opacity: input.watermarkOpacity ?? 0.8,
          scale: input.watermarkScale ?? 0.1,
          position:
            input.watermarkPosition === 'bl' ||
            input.watermarkPosition === 'tr' ||
            input.watermarkPosition === 'tl'
              ? input.watermarkPosition
              : 'br'
        }
  )

  return { args, filter, mapVideo, mapAudio, duration, rate, width, height, fps, videoBitrateKbps }
}

async function encodeTimeline(
  bin: string,
  input: TimelineExportInput,
  outPath: string,
  onProgress?: (ratio: number) => void
): Promise<void> {
  const pipeline = prepareTimelinePipeline(input)
  pipeline.args.push(
    '-filter_complex',
    pipeline.filter,
    '-map',
    pipeline.mapVideo,
    '-map',
    pipeline.mapAudio,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-b:v',
    `${pipeline.videoBitrateKbps}k`,
    '-movflags',
    '+faststart',
    '-t',
    String(pipeline.duration / pipeline.rate),
    outPath
  )

  await runFfmpeg(bin, pipeline.args, (sec) => {
    onProgress?.(Math.min(0.99, sec / Math.max(0.1, pipeline.duration / pipeline.rate)))
  })
}

function probeFfmpeg(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(bin, ['-version'], { windowsHide: true })
    let settled = false
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      resolve(ok)
    }
    child.on('error', () => done(false))
    child.on('close', (code) => done(code === 0))
    setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      done(false)
    }, 4000)
  })
}

/** 抽帧预览的单帧：timeSec 是它在成片时间线上的位置 */
export type TimelinePreviewFrame = { timeSec: number; dataUrl: string }

export type TimelinePreviewResult =
  { ok: true; frames: TimelinePreviewFrame[]; width: number } | { ok: false; error: string }

/**
 * 抽帧预览：用导出同一条滤镜图，在指定时间点各取一帧（JPEG）。
 *
 * - 与「先导出 MP4 再抽帧」的区别：不落中间视频、不编码整片，只解码到最晚的那个时间点；
 * - 与逐帧 `-ss` 重跑的区别：一次解码、多路输出（split + trim），抽 6 帧不是跑 6 遍；
 * - 输出 JPEG 而不是 PNG：单帧体积小一个量级，回给 Agent 的响应不至于撑爆。
 *
 * 时间点靠后时要解码到那个位置，长片会慢——调用方（`timeline_preview`）负责提示。
 */
export async function renderTimelineFrames(
  input: TimelineExportInput,
  timestamps: number[],
  options?: { width?: number; quality?: number }
): Promise<TimelinePreviewResult> {
  try {
    if (!projectService.isOpen()) {
      return { ok: false, error: fail(MAIN_ERRORS.noProject).message }
    }
    if (!timestamps.length) {
      return { ok: false, error: fail(E_TIMELINE_NO_PREVIEW_FRAMES).message }
    }

    const bin = findFfmpegBin()
    if (!(await probeFfmpeg(bin))) {
      return { ok: false, error: fail(E_TIMELINE_FFMPEG_MISSING).message }
    }

    const pipeline = prepareTimelinePipeline(input)
    const frameWidth = Math.min(
      1280,
      Math.max(160, Math.round(options?.width ?? PREVIEW_FRAME_WIDTH))
    )
    const quality = Math.min(12, Math.max(2, Math.round(options?.quality ?? PREVIEW_JPEG_QUALITY)))

    const framePlan = buildPreviewFramePlan({
      mapVideo: pipeline.mapVideo,
      timestamps,
      width: frameWidth
    })

    const workDir = mkdtempSync(join(tmpdir(), 'aiart-preview-'))
    try {
      const args = [
        ...pipeline.args,
        '-filter_complex',
        `${pipeline.filter};${framePlan.filterParts.join(';')}`
      ]
      const files = framePlan.outputs.map((_, index) => join(workDir, `frame-${index}.jpg`))
      framePlan.outputs.forEach((output, index) => {
        // -update 1：单文件名输出单帧，明确让 image2 muxer 覆盖同一个文件而不是去找序号
        args.push(
          '-map',
          `[${output.label}]`,
          '-frames:v',
          '1',
          '-update',
          '1',
          '-q:v',
          String(quality),
          files[index]
        )
      })
      // 滤镜图里的音频链末端 pad 必须有人接：未连接的 filter 输出会让 ffmpeg 直接报错。
      // 接到 null muxer 并用 -t 收在最晚的抽帧点上——音频只解码到那一刻，不拖慢抽帧。
      args.push(
        '-map',
        pipeline.mapAudio,
        '-t',
        Math.max(...timestamps).toFixed(3),
        '-f',
        'null',
        '-'
      )

      await runFfmpeg(bin, args)

      const frames: TimelinePreviewFrame[] = []
      files.forEach((file, index) => {
        if (!existsSync(file)) return
        const buf = readFileSync(file)
        if (!buf.length) return
        frames.push({
          timeSec: framePlan.outputs[index].timeSec,
          dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}`
        })
      })
      if (!frames.length) {
        return { ok: false, error: fail(E_TIMELINE_PREVIEW_FAILED).message }
      }
      return { ok: true, frames, width: frameWidth }
    } finally {
      try {
        rmSync(workDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function exportScriptTimeline(
  input: TimelineExportInput
): Promise<TimelineExportResult> {
  try {
    if (!projectService.isOpen()) {
      return { ok: false, error: fail(MAIN_ERRORS.noProject).message }
    }

    const bin = findFfmpegBin()
    const hasFfmpeg = await probeFfmpeg(bin)
    if (!hasFfmpeg) {
      // code = TIMELINE_FFMPEG_MISSING；消息含 FFmpeg 关键字，渲染端正则兜底仍可命中
      return { ok: false, error: fail(E_TIMELINE_FFMPEG_MISSING).message }
    }

    // 目标路径：Agent / 无界面链路直接给绝对路径（不弹对话框），界面上仍走「另存为」
    let outPath: string
    const targetPath = input.targetPath?.trim()
    if (targetPath) {
      outPath = extname(targetPath) ? targetPath : `${targetPath}.mp4`
      try {
        mkdirSync(dirname(outPath), { recursive: true })
      } catch {
        /* 父目录创建失败由后续写入报错暴露 */
      }
    } else {
      const save = await dialog.showSaveDialog({
        title: '导出成片',
        defaultPath: input.defaultFileName || 'timeline-export.mp4',
        filters: [
          { name: 'MP4', extensions: ['mp4'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['createDirectory', 'showOverwriteConfirmation']
      })
      if (save.canceled || !save.filePath) {
        return { ok: false, canceled: true, error: fail(E_TIMELINE_CANCELLED).message }
      }
      outPath = save.filePath
      if (!extname(outPath)) outPath = `${outPath}.mp4`
    }

    broadcastToAllWindows(IpcChannels.TIMELINE_EXPORT_PROGRESS, { progress: 0.02 })

    const workDir = mkdtempSync(join(tmpdir(), 'aiart-timeline-'))
    const tempOut = join(workDir, 'export.mp4')

    try {
      await encodeTimeline(bin, input, tempOut, (ratio) => {
        broadcastToAllWindows(IpcChannels.TIMELINE_EXPORT_PROGRESS, {
          progress: Math.max(0.05, Math.min(0.95, ratio))
        })
      })
      copyFileSync(tempOut, outPath)
    } finally {
      try {
        rmSync(workDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }

    let assetId: string | undefined
    try {
      const asset = projectService.attachExternalGeneratedFile({
        type: 'video',
        sourceFilePath: outPath,
        name: basename(outPath, extname(outPath)) || 'Timeline Export'
      })
      assetId = asset.id
      broadcastToAllWindows(IpcChannels.ASSET_UPDATED, asset)
    } catch {
      /* 另存为成功即可 */
    }

    broadcastToAllWindows(IpcChannels.TIMELINE_EXPORT_PROGRESS, { progress: 1 })
    return { ok: true, filePath: outPath, assetId, engine: 'ffmpeg' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
}
