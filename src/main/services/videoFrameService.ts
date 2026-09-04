/**
 * 视频按时间抽帧（供质检等视觉模型多帧理解 / 素材打标取首帧）。
 * 依赖 ffmpeg / ffprobe：`FFMPEG_PATH` / `FFPROBE_PATH` 环境变量 > resources 内嵌 > 系统 PATH。
 * 任一环节不可用或抽帧失败时返回空数组（调用方回退首帧缩略图）。
 *
 * 单帧（count=1）直接取视频首帧，无需 ffprobe 探测时长——
 * 避免「装了 ffmpeg 但 PATH 没有 ffprobe」导致打标/首帧取帧失败。
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { buildVideoFrameTimestamps } from '@shared/graph/videoReview'

const execFileAsync = promisify(execFile)

export function findFfmpegBin(): string {
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

export function findFfprobeBin(): string {
  const env = process.env.FFPROBE_PATH?.trim()
  if (env && existsSync(env)) return env
  const exeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  // 优先与 ffmpeg 同目录（ffmpeg.exe / ffprobe.exe 通常一起安装），其次 resources
  const candidates = [
    join(dirname(findFfmpegBin()), exeName),
    join(process.resourcesPath || '', exeName)
  ]
  for (const bin of candidates) {
    if (existsSync(bin)) return bin
  }
  return exeName
}

async function probeDurationSec(fileAbs: string): Promise<number | null> {
  const bin = findFfprobeBin()
  try {
    const { stdout } = await execFileAsync(
      bin,
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        fileAbs
      ],
      { timeout: 15_000, maxBuffer: 1024 * 1024, windowsHide: true }
    )
    const duration = Number(stdout.trim())
    return Number.isFinite(duration) && duration > 0 ? duration : null
  } catch (err) {
    console.warn('[video-frames] duration probe failed:', bin, fileAbs, errSummary(err))
    return null
  }
}

async function probeFfmpegAvailable(bin: string): Promise<boolean> {
  try {
    await execFileAsync(bin, ['-version'], { timeout: 5_000, windowsHide: true })
    return true
  } catch {
    return false
  }
}

function errSummary(err: unknown): string {
  if (err && typeof err === 'object') {
    const record = err as { message?: unknown; stderr?: unknown }
    const detail =
      typeof record.stderr === 'string' && record.stderr.trim()
        ? record.stderr.trim().split(/\r?\n/).slice(-3).join(' | ')
        : typeof record.message === 'string'
          ? record.message
          : ''
    return detail.slice(0, 400)
  }
  return String(err)
}

/** 抓单帧为 PNG dataUrl；tsSec 为 null 时不 seek（取视频首帧） */
async function grabFrameAt(
  bin: string,
  fileAbs: string,
  tsSec: number | null
): Promise<string | null> {
  const args = ['-v', 'error']
  if (tsSec !== null) args.push('-ss', String(tsSec))
  args.push(
    '-i',
    fileAbs,
    '-frames:v',
    '1',
    '-vf',
    'scale=480:-2',
    '-f',
    'image2pipe',
    '-vcodec',
    'png',
    'pipe:1'
  )
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout: 30_000,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true
    })
    if (stdout?.length) {
      return `data:image/png;base64,${Buffer.from(stdout).toString('base64')}`
    }
    console.warn('[video-frames] empty frame output:', tsSec ?? 'first', fileAbs, errSummary({ stderr }))
  } catch (err) {
    console.warn('[video-frames] frame grab failed:', tsSec ?? 'first', fileAbs, errSummary(err))
  }
  return null
}

export async function extractVideoFrames(params: {
  projectRoot: string
  relativePath: string
  count: number
}): Promise<string[]> {
  const abs = join(params.projectRoot, params.relativePath)
  if (!existsSync(abs)) {
    console.warn('[video-frames] missing file:', abs)
    return []
  }
  const bin = findFfmpegBin()
  if (!(await probeFfmpegAvailable(bin))) {
    console.warn('[video-frames] ffmpeg unavailable:', bin)
    return []
  }

  const count = Math.floor(params.count)
  if (count === 1) {
    // 单帧（如素材打标首帧）：直接取首帧，不依赖 ffprobe / duration
    const frame = await grabFrameAt(bin, abs, null)
    return frame ? [frame] : []
  }

  const durationSec = await probeDurationSec(abs)
  if (!durationSec) return []
  const timestamps = buildVideoFrameTimestamps(durationSec, count)
  const frames: string[] = []
  for (const ts of timestamps) {
    const frame = await grabFrameAt(bin, abs, ts)
    if (frame) frames.push(frame)
  }
  if (!frames.length) {
    console.warn('[video-frames] no frame extracted:', abs, 'timestamps', timestamps)
  }
  return frames
}
