/**
 * 成片时间线导出：系统 ffmpeg 合成视频轨 + 配音/音乐 + 字幕烧录。
 */
import { spawn } from 'child_process'
import { dialog } from 'electron'
import { existsSync, mkdtempSync, copyFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, basename, extname } from 'path'
import type { TimelineExportClip, TimelineExportInput, TimelineExportResult } from '@shared/graph'
import { IpcChannels } from '@shared/ipc'
import { fail, defErr, defErrSimple } from '@shared/errors/appError'
import { MAIN_ERRORS } from '../errors/messages'
import { projectService } from './projectService'
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

function findFfmpegBin(): string {
  const env = process.env.FFMPEG_PATH?.trim()
  if (env && existsSync(env)) return env
  const bundled = [
    join(process.resourcesPath || '', 'ffmpeg.exe'),
    join(process.resourcesPath || '', 'ffmpeg'),
    'C:\\ffmpeg\\bin\\ffmpeg.exe'
  ]
  for (const bin of bundled) {
    if (existsSync(bin)) return bin
  }
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
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
      reject(Object.assign(fail(E_TIMELINE_FFMPEG_LAUNCH_FAILED, { detail: err.message }), { cause: err }))
    })
    child.on('close', (code) => {
      // stderr 为 ffmpeg 原生输出，原样透传
      if (code === 0) resolve()
      else reject(fail(E_TIMELINE_FFMPEG_EXITED, { stderr: stderr.trim().slice(-900), exitCode: code }))
    })
  })
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
  subtitleColor: string
): { filter: string; mapVideo: string; mapAudio: string } {
  const filterParts: string[] = []
  filterParts.push(`[${baseVideoIndex}:v]format=yuv420p[base]`)

  const orderedMainVideos = [...mainVideos].sort(
    (a, b) => a.startSec - b.startSec
  )
  let lastVideo = 'base'
  if (orderedMainVideos.length) {
    let currentLabel: string | null = null
    let currentStartSec = 0
    let currentDurationSec = 0

    for (const [index, clip] of orderedMainVideos.entries()) {
      const dur = Math.max(0.05, clip.durationSec)
      const normalizedLabel = `main${index}`
      filterParts.push(
        `[${clip.inputIndex}:v]trim=0:${dur},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[${normalizedLabel}]`
      )

      if (!currentLabel) {
        currentLabel = normalizedLabel
        currentStartSec = Math.max(0, clip.startSec)
        currentDurationSec = dur
        continue
      }

      const clipStart = Math.max(0, clip.startSec)
      const transitionIn = Math.min(
        dur,
        Math.max(0, clip.transitionInSec ?? 0)
      )
      const type = clip.transitionType ?? 'none'
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
      const transitionName = xfadeMap[type] ?? 'fade'

      const currentEnd = currentStartSec + currentDurationSec
      const gap = Math.max(0, clipStart - currentEnd)
      if (gap > 0) {
        const paddedLabel = `${currentLabel}gap${index}`
        filterParts.push(
          `[${currentLabel}]tpad=stop_mode=add:stop_duration=${gap.toFixed(3)}:color=black[${paddedLabel}]`
        )
        currentLabel = paddedLabel
        currentDurationSec += gap
      }

      const offset = Math.max(0, clipStart - currentStartSec)
      const maxTransition = Math.min(
        currentDurationSec - offset,
        dur,
        transitionIn
      )
      const transitionDuration = Math.max(0, maxTransition)
      const xfadeLabel = `xfade${index}`
      if (transitionDuration > 0) {
        filterParts.push(
          `[${currentLabel}][${normalizedLabel}]xfade=transition=${transitionName}:duration=${transitionDuration.toFixed(3)}:offset=${Math.max(0, offset).toFixed(3)}[${xfadeLabel}]`
        )
      } else {
        filterParts.push(
          `[${currentLabel}][${normalizedLabel}]concat=n=2:v=1:a=0[${xfadeLabel}]`
        )
      }
      currentLabel = xfadeLabel
      currentDurationSec =
        currentDurationSec + dur - transitionDuration
    }

    const firstStart = orderedMainVideos[0]!.startSec
    const shiftedMain = 'mainshifted'
    filterParts.push(
      `[${currentLabel}]setpts=PTS+${Math.max(0, firstStart).toFixed(3)}/TB[${shiftedMain}]`
    )
    filterParts.push(
      `[base][${shiftedMain}]overlay=0:0[mainbase]`
    )
    lastVideo = 'mainbase'
  }

  for (const clip of overlays) {
    const start = Math.max(0, clip.startSec)
    const dur = Math.max(0.05, clip.durationSec)
    const opacity = Number.isFinite(clip.opacity)
      ? Math.min(1, Math.max(0, clip.opacity!))
      : 1
    const relX = Number.isFinite(clip.overlayX)
      ? Math.min(1, Math.max(0, clip.overlayX!))
      : 0.12
    const relY = Number.isFinite(clip.overlayY)
      ? Math.min(1, Math.max(0, clip.overlayY!))
      : 0.12
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
    filterParts.push(
      `[${clip.inputIndex}:v]trim=0:${dur},setpts=PTS-STARTPTS,scale=${ow}:${oh}:force_original_aspect_ratio=decrease,pad=${ow}:${oh}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=rgba,colorchannelmixer=aa=${opacity.toFixed(3)}[${vLabel}]`
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

  const audioMixInputs: string[] = [`[${baseAudioIndex}:a]`]
  for (const clip of audios) {
    const startMs = Math.max(0, Math.round(clip.startSec * 1000))
    const dur = Math.max(0.05, clip.durationSec)
    const volume = Number.isFinite(clip.volume) ? Math.min(1, Math.max(0, clip.volume!)) : 1
    const fadeIn = Number.isFinite(clip.fadeInSec)
      ? Math.min(dur, Math.max(0, clip.fadeInSec!))
      : 0
    const fadeOut = Number.isFinite(clip.fadeOutSec)
      ? Math.min(dur, Math.max(0, clip.fadeOutSec!))
      : 0
    const aLabel = `a${clip.inputIndex}`
    const chain = [
      'atrim=0:' + dur,
      'asetpts=PTS-STARTPTS',
      volume !== 1 ? `volume=${volume.toFixed(3)}` : '',
      fadeIn > 0 ? `afade=t=in:st=0:d=${fadeIn.toFixed(3)}` : '',
      fadeOut > 0 ? `afade=t=out:st=${Math.max(0, dur - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}` : '',
      `adelay=${startMs}|${startMs}`
    ]
      .filter(Boolean)
      .join(',')
    filterParts.push(`[${clip.inputIndex}:a]${chain}[${aLabel}]`)
    audioMixInputs.push(`[${aLabel}]`)
  }

  filterParts.push(
    `${audioMixInputs.join('')}amix=inputs=${audioMixInputs.length}:duration=longest:dropout_transition=0:normalize=0[aout]`
  )

  if (rate !== 1) {
    const clamped = Math.min(2, Math.max(0.5, rate))
    filterParts.push(`[${lastVideo}]setpts=PTS/${clamped}[vout]`)
    filterParts.push(`[aout]atempo=${clamped}[aouts]`)
    return { filter: filterParts.join(';'), mapVideo: '[vout]', mapAudio: '[aouts]' }
  }
  return { filter: filterParts.join(';'), mapVideo: `[${lastVideo}]`, mapAudio: '[aout]' }
}

async function encodeTimeline(
  bin: string,
  input: TimelineExportInput,
  outPath: string,
  onProgress?: (ratio: number) => void
): Promise<void> {
  const duration = Math.max(1, input.durationSec)
  const rate = input.playbackRate && input.playbackRate > 0 ? input.playbackRate : 1
  const width = Math.min(7680, Math.max(320, Math.round(input.width ?? 1280)))
  const height = Math.min(4320, Math.max(180, Math.round(input.height ?? 720)))
  const fps = Math.min(60, Math.max(1, Math.round(input.fps ?? 30)))
  const videoBitrateKbps = Math.min(
    200000,
    Math.max(500, Math.round(input.videoBitrateKbps ?? 5000))
  )
  const subtitleFontSize = Math.min(
    200,
    Math.max(12, Math.round(input.subtitleFontSize ?? 36))
  )
  const subtitleYOffset = Math.min(
    1000,
    Math.max(0, Math.round(input.subtitleYOffset ?? 80))
  )
  const subtitleColor =
    input.subtitleColor && /^#[0-9a-fA-F]{6}$/.test(input.subtitleColor.trim())
      ? input.subtitleColor.trim()
      : 'white'

  const mainVideoClips = input.clips.filter((c) => c.track === 'video')
  const overlayClips = input.clips.filter((c) => c.track === 'overlay')
  const voiceMusicClips = input.clips.filter((c) => c.track === 'voice' || c.track === 'music')
  const subs = input.clips.filter((c) => c.track === 'subtitle' && (c.text?.trim() || c.title.trim()))

  const args: string[] = ['-y', '-hide_banner', '-loglevel', 'error']
  let inputIndex = 0

  args.push(
    '-f',
    'lavfi',
    '-i',
    `color=c=black:s=${width}x${height}:d=${duration}:r=${fps}`
  )
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
    subtitleColor
  )

  args.push(
    '-filter_complex',
    filter,
    '-map',
    mapVideo,
    '-map',
    mapAudio,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-b:v',
    `${videoBitrateKbps}k`,
    '-movflags',
    '+faststart',
    '-t',
    String(duration / rate),
    outPath
  )

  await runFfmpeg(bin, args, (sec) => {
    onProgress?.(Math.min(0.99, sec / Math.max(0.1, duration / rate)))
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

    let outPath = save.filePath
    if (!extname(outPath)) outPath = `${outPath}.mp4`

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
