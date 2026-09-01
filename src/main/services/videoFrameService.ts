/**
 * 视频按时间抽帧（供质检等视觉模型多帧理解）。
 * 依赖 ffmpeg / ffprobe：`FFMPEG_PATH` / `FFPROBE_PATH` 环境变量 > resources 内嵌 > 系统 PATH。
 * 任一环节不可用或抽帧失败时返回空数组（调用方回退首帧缩略图）。
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { join } from 'path'
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

function findFfprobeBin(): string {
  const env = process.env.FFPROBE_PATH?.trim()
  if (env && existsSync(env)) return env
  return 'ffprobe'
}

async function probeDurationSec(fileAbs: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      findFfprobeBin(),
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
  } catch {
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

export async function extractVideoFrames(params: {
  projectRoot: string
  relativePath: string
  count: number
}): Promise<string[]> {
  const abs = join(params.projectRoot, params.relativePath)
  if (!existsSync(abs)) return []
  const bin = findFfmpegBin()
  if (!(await probeFfmpegAvailable(bin))) return []
  const durationSec = await probeDurationSec(abs)
  if (!durationSec) return []

  const timestamps = buildVideoFrameTimestamps(durationSec, params.count)
  const frames: string[] = []
  for (const ts of timestamps) {
    try {
      const { stdout } = await execFileAsync(
        bin,
        [
          '-v',
          'error',
          '-ss',
          String(ts),
          '-i',
          abs,
          '-frames:v',
          '1',
          '-vf',
          'scale=480:-2',
          '-f',
          'image2pipe',
          '-vcodec',
          'png',
          'pipe:1'
        ],
        { timeout: 30_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true }
      )
      if (stdout?.length) frames.push(`data:image/png;base64,${Buffer.from(stdout).toString('base64')}`)
    } catch {
      /* 单帧失败跳过，其余帧照常 */
    }
  }
  return frames
}
