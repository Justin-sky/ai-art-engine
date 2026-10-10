/**
 * 语义时间线用的 ffmpeg 解析：只看环境变量与常见路径 / PATH。
 * 不导入 electron，以便 vitest 可跑 L0 往返测试。
 * 应用内 UI 仍可通过 videoFrameService 做更完整的随包探测。
 */
import { existsSync } from 'fs'
import { dirname, join } from 'path'

function firstExisting(candidates: string[]): string | undefined {
  for (const c of candidates) {
    if (c && existsSync(c)) return c
  }
  return undefined
}

export function resolveFfmpegForSemantic(): string {
  const env = process.env.FFMPEG_PATH?.trim()
  if (env && existsSync(env)) return env
  const found = firstExisting([
    join(process.cwd(), 'out', 'ffmpeg', 'win32-x64', 'ffmpeg.exe'),
    join(process.cwd(), 'out', 'ffmpeg', 'ffmpeg.exe'),
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    join(process.env.LOCALAPPDATA || '', 'ai-art-engine', 'ffmpeg', 'bin', 'ffmpeg.exe')
  ])
  if (found) return found
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
}

export function resolveFfprobeForSemantic(): string {
  const env = process.env.FFPROBE_PATH?.trim()
  if (env && existsSync(env)) return env
  const ffmpeg = resolveFfmpegForSemantic()
  const name = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  const sibling = join(dirname(ffmpeg), name)
  if (existsSync(sibling)) return sibling
  const found = firstExisting([
    join(process.cwd(), 'out', 'ffmpeg', 'win32-x64', name),
    join(process.env.LOCALAPPDATA || '', 'ai-art-engine', 'ffmpeg', 'bin', name)
  ])
  if (found) return found
  return name
}
