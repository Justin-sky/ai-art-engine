/**
 * 视频按时间抽帧（供质检等视觉模型多帧理解 / 素材打标取首帧）。
 * 依赖 ffmpeg / ffprobe：`FFMPEG_PATH` / `FFPROBE_PATH` 环境变量 > 随包内置
 * <resources>/ffmpeg/ > 应用私有安装目录 > 系统 PATH。
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
import { bundledFfmpegDir, ffmpegPrivateBin } from './ffmpegInstallService'

const execFileAsync = promisify(execFile)

export function findFfmpegBin(): string {
  const env = process.env.FFMPEG_PATH?.trim()
  if (env && existsSync(env)) return env
  // 随包内置（打包 = <resources>/ffmpeg；dev = <项目根>/out/ffmpeg/<arch>，开箱即用）→
  // 兼容旧布局 resources 根 → 应用私有安装目录（旧版一键安装残留）→ 系统 PATH
  const devDir = bundledFfmpegDir()
  const bundled = [
    join(process.resourcesPath || '', 'ffmpeg', 'ffmpeg.exe'),
    join(process.resourcesPath || '', 'ffmpeg', 'ffmpeg'),
    join(process.resourcesPath || '', 'ffmpeg.exe'),
    join(process.resourcesPath || '', 'ffmpeg'),
    join(devDir, 'ffmpeg.exe'),
    join(devDir, 'ffmpeg'),
    ffmpegPrivateBin('ffmpeg'),
    'C:\\ffmpeg\\bin\\ffmpeg.exe'
  ]
  for (const bin of bundled) {
    if (existsSync(bin)) return bin
  }
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
}

export function findFfprobeBin(): string {
  const env = process.env.FFPROBE_PATH?.trim()
  const exeName = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'
  const candidates = [
    ...(env && existsSync(env) ? [env] : []),
    join(dirname(findFfmpegBin()), exeName),
    join(process.resourcesPath || '', 'ffmpeg', exeName),
    join(process.resourcesPath || '', exeName),
    ffmpegPrivateBin('ffprobe')
  ]
  for (const bin of candidates) {
    if (existsSync(bin)) return bin
  }
  return exeName
}

async function probeDurationSec(fileAbs: string): Promise<number | null> {
  // ffprobe 首选；缺失 / 失败时退化到 ffmpeg -i 解析容器时长（stderr 的 Duration 行）
  const ffprobeBin = findFfprobeBin()
  try {
    const { stdout } = await execFileAsync(
      ffprobeBin,
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
    if (Number.isFinite(duration) && duration > 0) return duration
    console.warn('[video-frames] duration probe empty:', ffprobeBin, fileAbs)
  } catch (err) {
    console.warn('[video-frames] duration probe failed:', ffprobeBin, fileAbs, errSummary(err))
  }
  return probeDurationViaFfmpeg(fileAbs)
}

/** ffmpeg -i 读输入会以「缺输出」错误码退出，时长信息在 stderr 的 Duration: HH:MM:SS.xx 行 */
async function probeDurationViaFfmpeg(fileAbs: string): Promise<number | null> {
  const ffmpegBin = findFfmpegBin()
  if (!(await probeFfmpegAvailable(ffmpegBin))) return null
  const extract = (text: string): number | null => {
    const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text)
    if (!m) return null
    const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
    return Number.isFinite(sec) && sec > 0 ? sec : null
  }
  try {
    const { stderr } = await execFileAsync(ffmpegBin, ['-i', fileAbs], {
      timeout: 15_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true
    })
    return extract(stderr ?? '')
  } catch (err) {
    // ffmpeg -i 无输出目标必然非零退出，时长仍可从 stderr 解析
    return extract((err as { stderr?: string })?.stderr ?? '')
  }
}

/** ffprobe 是否可用（调用方区分「缺 ffmpeg」与「文件异常」两类失败） */
export async function isFfprobeAvailable(): Promise<boolean> {
  return probeFfmpegAvailable(findFfprobeBin())
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

/** 抓单帧为 PNG dataUrl；tsSec 为 null 时不 seek（取视频首帧）；width 控制输出帧宽（缺省 480，姿态检测等需要更大） */
async function grabFrameAt(
  bin: string,
  fileAbs: string,
  tsSec: number | null,
  width = 480
): Promise<string | null> {
  const safeWidth = Number.isFinite(width) ? Math.max(160, Math.min(1920, Math.floor(width))) : 480
  const args = ['-v', 'error']
  if (tsSec !== null) args.push('-ss', String(tsSec))
  args.push(
    '-i',
    fileAbs,
    '-frames:v',
    '1',
    '-vf',
    `scale=${safeWidth}:-2`,
    '-f',
    'image2pipe',
    '-vcodec',
    'png',
    'pipe:1'
  )
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      encoding: 'buffer' as const,
      timeout: 30_000,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true
    })
    if (stdout?.length) {
      return `data:image/png;base64,${stdout.toString('base64')}`
    }
    console.warn(
      '[video-frames] empty frame output:',
      tsSec ?? 'first',
      fileAbs,
      errSummary({ stderr: stderr?.toString() })
    )
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

/** 探测视频总时长（秒）；ffprobe 缺失 / 文件缺失 / 探测失败返回 null（打点抽帧排程用） */
export async function probeVideoDurationSec(params: {
  projectRoot: string
  relativePath: string
}): Promise<number | null> {
  const abs = join(params.projectRoot, params.relativePath)
  if (!existsSync(abs)) return null
  return probeDurationSec(abs)
}

/**
 * 在指定时间戳逐帧抓取（打点用；单帧分辨率与 `grabFrameAt` 一致，约宽 480）。
 * 返回带 timeSec 的帧，失败帧跳过——调用方以空数组判定整体失败。
 * timestamps 内部按升序重排（`-ss` 升序 seek 更省），重复/负数/非法值被剔除。
 */
export async function grabFramesAtTimestamps(params: {
  projectRoot: string
  relativePath: string
  timestamps: number[]
  /** 输出帧宽（px）；缺省 480。姿态检测等需更清晰人像时传更大值 */
  width?: number
}): Promise<Array<{ timeSec: number; dataUrl: string }>> {
  const abs = join(params.projectRoot, params.relativePath)
  if (!existsSync(abs)) return []
  const timestamps = [...params.timestamps]
    .filter((ts) => Number.isFinite(ts) && ts >= 0)
    .sort((a, b) => a - b)
  if (!timestamps.length) return []
  const bin = findFfmpegBin()
  if (!(await probeFfmpegAvailable(bin))) return []
  const frames: Array<{ timeSec: number; dataUrl: string }> = []
  for (const ts of timestamps) {
    const frame = await grabFrameAt(bin, abs, ts, params.width)
    if (frame) frames.push({ timeSec: ts, dataUrl: frame })
  }
  return frames
}
