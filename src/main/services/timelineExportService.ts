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
import { projectService } from './projectService'
import { broadcastToAllWindows } from '../broadcast'

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
      reject(new Error(`无法启动 ffmpeg：${err.message}。请安装 ffmpeg 并加入 PATH，或设置 FFMPEG_PATH。`))
    })
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim().slice(-900) || `ffmpeg 退出码 ${code}`))
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
  videos: Array<TimelineExportClip & { path: string; inputIndex: number }>,
  audios: Array<TimelineExportClip & { path: string; inputIndex: number }>,
  subs: TimelineExportClip[],
  baseVideoIndex: number,
  baseAudioIndex: number,
  rate: number
): { filter: string; mapVideo: string; mapAudio: string } {
  const filterParts: string[] = []
  filterParts.push(`[${baseVideoIndex}:v]format=yuv420p[base]`)
  const videoLabels: string[] = ['base']

  for (const clip of videos) {
    const start = Math.max(0, clip.startSec)
    const dur = Math.max(0.05, clip.durationSec)
    const vLabel = `v${clip.inputIndex}`
    const ovLabel = `ov${clip.inputIndex}`
    const prev = videoLabels[videoLabels.length - 1]!
    filterParts.push(
      `[${clip.inputIndex}:v]trim=0:${dur},setpts=PTS-STARTPTS,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p[${vLabel}]`
    )
    filterParts.push(
      `[${prev}][${vLabel}]overlay=0:0:enable='between(t\\,${start.toFixed(3)}\\,${(start + dur).toFixed(3)})'[${ovLabel}]`
    )
    videoLabels.push(ovLabel)
  }

  let lastVideo = videoLabels[videoLabels.length - 1]!
  const font = findDrawtextFont()
  const fontOpt = font ? `:fontfile='${font.replace(/\\/g, '/').replace(/:/g, '\\:')}'` : ''

  for (const [i, sub] of subs.entries()) {
    const text = escapeDrawtext((sub.text || sub.title).trim())
    if (!text) continue
    const start = Math.max(0, sub.startSec)
    const end = start + Math.max(0.05, sub.durationSec)
    const next = `sub${i}`
    filterParts.push(
      `[${lastVideo}]drawtext=text='${text}'${fontOpt}:fontsize=36:fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:y=h-80:enable='between(t\\,${start.toFixed(3)}\\,${end.toFixed(3)})'[${next}]`
    )
    lastVideo = next
  }

  const audioMixInputs: string[] = [`[${baseAudioIndex}:a]`]
  for (const clip of audios) {
    const startMs = Math.max(0, Math.round(clip.startSec * 1000))
    const dur = Math.max(0.05, clip.durationSec)
    const aLabel = `a${clip.inputIndex}`
    filterParts.push(
      `[${clip.inputIndex}:a]atrim=0:${dur},asetpts=PTS-STARTPTS,adelay=${startMs}|${startMs}[${aLabel}]`
    )
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

  const videoClips = input.clips.filter((c) => c.track === 'video')
  const audioClips = input.clips.filter((c) => c.track === 'voice' || c.track === 'music')
  const subs = input.clips.filter((c) => c.track === 'subtitle' && (c.text?.trim() || c.title.trim()))

  const args: string[] = ['-y', '-hide_banner', '-loglevel', 'error']
  let inputIndex = 0

  args.push('-f', 'lavfi', '-i', `color=c=black:s=1280x720:d=${duration}:r=30`)
  const baseVideoIndex = inputIndex++
  args.push('-f', 'lavfi', '-i', `anullsrc=channel_layout=stereo:sample_rate=44100:d=${duration}`)
  const baseAudioIndex = inputIndex++

  const videos: Array<TimelineExportClip & { path: string; inputIndex: number }> = []
  for (const clip of videoClips) {
    const path = resolveClipPath(clip)
    if (!path) continue
    args.push('-i', path)
    videos.push({ ...clip, path, inputIndex: inputIndex++ })
  }

  const audios: Array<TimelineExportClip & { path: string; inputIndex: number }> = []
  for (const clip of audioClips) {
    const path = resolveClipPath(clip)
    if (!path) continue
    args.push('-i', path)
    audios.push({ ...clip, path, inputIndex: inputIndex++ })
  }

  if (!videos.length && !audios.length) {
    throw new Error('时间线上没有可导出的视频或音频片段')
  }

  const { filter, mapVideo, mapAudio } = buildFilterGraph(
    videos,
    audios,
    subs,
    baseVideoIndex,
    baseAudioIndex,
    rate
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
      return { ok: false, error: '未打开工程' }
    }

    const bin = findFfmpegBin()
    const hasFfmpeg = await probeFfmpeg(bin)
    if (!hasFfmpeg) {
      return {
        ok: false,
        error: '无法启动 ffmpeg：未找到可执行文件。请安装 ffmpeg 并加入 PATH，或设置 FFMPEG_PATH。'
      }
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
      return { ok: false, canceled: true, error: '已取消' }
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
