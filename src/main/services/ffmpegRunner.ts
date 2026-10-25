/**
 * 调用系统 / 随包的 ffmpeg：**一处**负责 spawn、收集 stderr、把失败翻译成可读错误。
 *
 * 从 `timelineExportService` 里抽出来（原先是那里的私有函数）：界面录制也要跑 ffmpeg
 * （帧序列 → MP4），而「怎么起进程、失败时说什么」只该有一份 —— 这个仓库反复踩过的
 * 就是同一件事在两处各写一遍，然后慢慢漂移。
 */
import { spawn } from 'child_process'
import { copyFileSync, existsSync, linkSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { extname, join } from 'path'
import { defErr, fail } from '@shared/errors/appError'

/**
 * Windows `CreateProcessW` 命令行硬上限为 32,767 字符；预留安全余量，超过该阈值时将长路径输入短链化。
 */
export const WINDOWS_CMD_SAFE_LIMIT = 24_000

/**
 * 将 FFmpeg 参数中的 `-filter_complex <graph>` 落盘转为 `-filter_complex_script <file>`，
 * 并在命令行总长仍接近 Windows 32KB 限制时将本地 `-i <path>` 输入映射为临时短文件名，
 * 彻底杜绝 `spawn ENAMETOOLONG`。
 */
export function materializeFfmpegFilterComplexArgs(args: string[], tempDir: string): string[] {
  const out: string[] = []
  let scriptIndex = 0
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '-filter_complex' && i + 1 < args.length) {
      const filterGraph = String(args[i + 1] ?? '')
      const scriptPath = join(tempDir, `fc_${scriptIndex++}.txt`)
      writeFileSync(scriptPath, filterGraph, 'utf-8')
      out.push('-filter_complex_script', scriptPath)
      i += 1
      continue
    }
    out.push(arg)
  }

  const estimateCmdLength = (list: string[]): number =>
    list.reduce((sum, item) => sum + item.length + 3, 0)

  if (estimateCmdLength(out) > WINDOWS_CMD_SAFE_LIMIT) {
    const aliasMap = new Map<string, string>()
    let aliasIdx = 0
    for (let i = 0; i < out.length - 1; i += 1) {
      if (out[i] !== '-i') continue
      const origPath = out[i + 1]
      if (!origPath || origPath.includes('=') || !existsSync(origPath)) continue
      let shortPath = aliasMap.get(origPath)
      if (!shortPath) {
        const ext = extname(origPath).slice(0, 10) || '.bin'
        shortPath = join(tempDir, `in_${aliasIdx++}${ext}`)
        try {
          linkSync(origPath, shortPath)
        } catch {
          try {
            copyFileSync(origPath, shortPath)
          } catch {
            shortPath = origPath
          }
        }
        aliasMap.set(origPath, shortPath)
      }
      out[i + 1] = shortPath
    }
  }

  return out
}

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
    const needsScriptTemp =
      args.includes('-filter_complex') ||
      args.reduce((sum, item) => sum + item.length + 3, 0) > WINDOWS_CMD_SAFE_LIMIT
    const scriptTempDir = needsScriptTemp ? mkdtempSync(join(tmpdir(), 'aiart-ffscript-')) : null
    const effectiveArgs = scriptTempDir
      ? materializeFfmpegFilterComplexArgs(args, scriptTempDir)
      : args

    let stderr = ''
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (scriptTempDir) {
        try {
          rmSync(scriptTempDir, { recursive: true, force: true })
        } catch {
          /* ignore */
        }
      }
      fn()
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(bin, effectiveArgs, { windowsHide: true })
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      finish(() =>
        reject(
          Object.assign(fail(E_FFMPEG_LAUNCH_FAILED, { detail: e.message }), {
            cause: e
          })
        )
      )
      return
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
      const cleaned = text.replace(/(?:^|[\r\n])\s*(?:frame|size)=\s*\d+[^\r\n]*/g, '')
      if (cleaned) stderr += cleaned
      if (onTime) {
        const matches = [...text.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)]
        const last = matches[matches.length - 1]
        if (last) {
          onTime(Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]))
        }
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
