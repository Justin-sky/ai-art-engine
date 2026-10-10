import { execFile } from 'child_process'
import { promisify } from 'util'
import type { MediaFacts } from '@shared/semanticTimeline'
import { resolveFfmpegForSemantic, resolveFfprobeForSemantic } from './resolveFfmpeg'

const execFileAsync = promisify(execFile)

interface FfprobeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  r_frame_rate?: string
  channels?: number
  duration?: string
}

interface FfprobeJson {
  format?: { duration?: string }
  streams?: FfprobeStream[]
}

function parseFps(rate: string | undefined): number {
  if (!rate || rate === '0/0') return 30
  const [a, b] = rate.split('/').map(Number)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 30
  const fps = a / b
  return fps > 0 && fps < 240 ? fps : 30
}

/** 用 ffprobe 读取媒体事实；失败时抛错 */
export async function probeMediaFacts(fileAbs: string): Promise<MediaFacts> {
  const bin = resolveFfprobeForSemantic()
  const { stdout } = await execFileAsync(
    bin,
    ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', fileAbs],
    { timeout: 30_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }
  )
  const json = JSON.parse(stdout) as FfprobeJson
  const video = json.streams?.find((s) => s.codec_type === 'video')
  const audio = json.streams?.find((s) => s.codec_type === 'audio')
  const durationSec = Number(json.format?.duration ?? video?.duration ?? 0)
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error('ffprobe: invalid duration')
  }
  return {
    durationSec,
    fps: parseFps(video?.avg_frame_rate || video?.r_frame_rate),
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    hasAudio: !!audio,
    audioChannels: audio?.channels,
    codec: video?.codec_name
  }
}

/** 生成一段纯色测试视频（fixtures / L0 测试用） */
export async function generateSolidVideoFixture(
  outAbs: string,
  options: {
    durationSec?: number
    fps?: number
    width?: number
    height?: number
    color?: string
  } = {}
): Promise<void> {
  const duration = options.durationSec ?? 3
  const fps = options.fps ?? 30
  const w = options.width ?? 320
  const h = options.height ?? 240
  const color = options.color ?? 'blue'
  const ffmpeg = resolveFfmpegForSemantic()
  await execFileAsync(
    ffmpeg,
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=${color}:s=${w}x${h}:d=${duration}:r=${fps}`,
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:duration=${duration}`,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      outAbs
    ],
    { timeout: 60_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
  )
}

/** 生成带硬切的两段色块视频（第一段 blue，第二段 red） */
export async function generateHardCutFixture(
  outAbs: string,
  options: { partSec?: number; fps?: number } = {}
): Promise<{ cutSec: number; durationSec: number; fps: number }> {
  const part = options.partSec ?? 1.5
  const fps = options.fps ?? 30
  const ffmpeg = resolveFfmpegForSemantic()
  // 用 concat demuxer 前先造两段临时文件太重；用 filter_complex 拼接
  await execFileAsync(
    ffmpeg,
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=blue:s=320x240:d=${part}:r=${fps}`,
      '-f',
      'lavfi',
      '-i',
      `color=c=red:s=320x240:d=${part}:r=${fps}`,
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:duration=${part * 2}`,
      '-filter_complex',
      '[0:v][1:v]concat=n=2:v=1:a=0[v]',
      '-map',
      '[v]',
      '-map',
      '2:a',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      outAbs
    ],
    { timeout: 60_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
  )
  return { cutSec: part, durationSec: part * 2, fps }
}
