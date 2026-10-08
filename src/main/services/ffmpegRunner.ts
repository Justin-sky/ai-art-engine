/**
 * 调用系统 / 随包的 ffmpeg：**一处**负责 spawn、收集 stderr、把失败翻译成可读错误。
 *
 * 从 `timelineExportService` 里抽出来（原先是那里的私有函数）：界面录制也要跑 ffmpeg
 * （帧序列 → MP4），而「怎么起进程、失败时说什么」只该有一份 —— 这个仓库反复踩过的
 * 就是同一件事在两处各写一遍，然后慢慢漂移。
 */
import { spawn } from 'child_process'
import { defErr, fail } from '@shared/errors/appError'

/**
 * 起不来（ENOENT / 无执行权限等）。
 *
 * 错误码取中性的 `ffmpeg.*` 而不是沿用抽取前的 `timeline.*`：它已经不只服务于时间线导出。
 * 文案保留 `ffmpeg` 关键字 —— 渲染端对 ffmpeg 类故障有兜底匹配。
 */
const E_FFMPEG_LAUNCH_FAILED = defErr<{ detail: string }>(
  'ffmpeg.launchFailed',
  ({ detail }) => `无法启动 ffmpeg：${detail}。请安装 ffmpeg 并加入 PATH，或设置 FFMPEG_PATH。`,
  ({ detail }) => `Could not start ffmpeg: ${detail}. Install ffmpeg onto PATH or set FFMPEG_PATH.`
)

/** 退出码非 0；stderr 为 ffmpeg 原生输出，原样透传便于定位参数问题 */
const E_FFMPEG_EXITED = defErr<{ stderr: string; exitCode: number | null }>(
  'ffmpeg.exited',
  ({ stderr, exitCode }) => stderr || `ffmpeg 退出码 ${exitCode}`,
  ({ stderr, exitCode }) => stderr || `ffmpeg exited with code ${exitCode}`
)

/**
 * 超时被强制结束。
 *
 * 卡住的 ffmpeg 会把调用方的状态锁死 —— 录制尤其致命：`stopping` 永远为真，
 * 之后 start 一直回「已在录制」、stop 一直回「没有在录制」，只能重启应用。
 */
const E_FFMPEG_TIMEOUT = defErr<{ timeoutMs: number; stderr: string }>(
  'ffmpeg.timeout',
  ({ timeoutMs, stderr }) =>
    `ffmpeg 超时（>${timeoutMs}ms）已被结束：${stderr.slice(-300) || '无输出'}`,
  ({ timeoutMs, stderr }) =>
    `ffmpeg timed out after ${timeoutMs}ms and was killed: ${stderr.slice(-300) || 'no output'}`
)

export interface RunFfmpegOptions {
  /** 超时毫秒；到点 kill 子进程并拒绝。缺省不设上限（与既有调用方行为一致） */
  timeoutMs?: number
}

/**
 * 跑一次 ffmpeg 并等它结束。
 *
 * `onTime` 可选：从 stderr 的 `time=HH:MM:SS.mmm` 里解析进度（ffmpeg 把进度写在 stderr）。
 */
export function runFfmpeg(
  bin: string,
  args: string[],
  onTime?: (sec: number) => void,
  options?: RunFfmpegOptions
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true })
    let stderr = ''
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      fn()
    }

    const timeoutMs = options?.timeoutMs
    if (typeof timeoutMs === 'number' && timeoutMs > 0) {
      timer = setTimeout(() => {
        // 先 kill 再拒绝：进程留着会继续占 CPU，还会锁住临时文件（Windows 上目录都删不掉）
        try {
          child.kill('SIGKILL')
        } catch {
          /* 已经退出 */
        }
        finish(() =>
          reject(fail(E_FFMPEG_TIMEOUT, { timeoutMs, stderr: stderr.trim().slice(-900) }))
        )
      }, timeoutMs)
    }

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
      finish(() =>
        reject(
          Object.assign(fail(E_FFMPEG_LAUNCH_FAILED, { detail: err.message }), {
            cause: err
          })
        )
      )
    })
    child.on('close', (code) => {
      // stderr 为 ffmpeg 原生输出，原样透传
      if (code === 0) finish(resolve)
      else
        finish(() =>
          reject(fail(E_FFMPEG_EXITED, { stderr: stderr.trim().slice(-900), exitCode: code }))
        )
    })
  })
}
