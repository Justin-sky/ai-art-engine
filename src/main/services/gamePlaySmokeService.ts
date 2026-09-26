/**
 * 试玩门禁：把 cook 出来的单文件游戏在**隐藏窗口**里真跑几秒，抓硬问题。
 *
 * 为什么值得做：cook 成功 ≠ 能跑。用户点「试玩」看到白屏 / 黑屏时，我们此前只能靠人眼
 * 发现，agent 也拿不到任何反馈；这里把「未捕获异常 / 加载失败 / 渲染进程崩溃 / 黑屏 /
 * 画面静止」折成一份结构化报告，随 `gameplay_job_status` 回到 agent，让它自己决定改一轮。
 *
 * 边界（刻意为之）：
 * - **不做自动修复轮**：报告只描述问题，改不改、改几轮由 agent 与用户决定；
 * - 载入方式是 `file://`（`loadFile`），与产物卡「试玩」用系统浏览器打开同一条路径——
 *   所以 `type="module"` / 相对引用这类「浏览器里白屏」的形态会被如实抓出来；
 * - 截图靠 `capturePage()`：隐藏窗口仍会绘制（Electron 的 `paintWhenInitiallyHidden`
 *   默认为真，配合关闭后台节流即可出帧），拿不到图时按 warn 上报而不是判黑屏，
 *   避免把「我们截不到」说成「游戏是黑的」。
 */
import { BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import {
  evaluateGamePlaySmoke,
  gamePlayJobError,
  type GamePlaySmokeReport,
  type GamePlaySmokeSample
} from '@shared/gamePlayJob'
import { projectService } from './projectService'

/** 采样节奏：首帧多等一点（等首帧渲染与资源初始化），之后每 450ms 采一帧 */
const FIRST_SAMPLE_DELAY_MS = 900
const SAMPLE_INTERVAL_MS = 450
const SAMPLE_COUNT = 5
/** 采样点步长：按像素抽样算亮度与指纹，不逐像素遍历（960×540 下约 5k 个采样点） */
const PIXEL_STRIDE = 101
const MAX_ERROR_LINES = 8
const WINDOW_WIDTH = 960
const WINDOW_HEIGHT = 540

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** BGRA 位图 → 亮度均值 + 采样指纹；拿不到像素返回 null */
function sampleBitmap(bitmap: Buffer): GamePlaySmokeSample | null {
  if (!bitmap || bitmap.length < 4) return null
  let sum = 0
  let count = 0
  let hash = 2166136261 >>> 0
  const step = PIXEL_STRIDE * 4
  for (let offset = 0; offset + 3 < bitmap.length; offset += step) {
    const blue = bitmap[offset] ?? 0
    const green = bitmap[offset + 1] ?? 0
    const red = bitmap[offset + 2] ?? 0
    // ITU-R BT.601 亮度：够用来判「整屏黑」与「画面有没有变」
    sum += 0.299 * red + 0.587 * green + 0.114 * blue
    count += 1
    hash ^= (red << 16) | (green << 8) | blue
    hash = Math.imul(hash, 16777619) >>> 0
  }
  if (!count) return null
  return { meanLuma: sum / count, hash: hash.toString(16), pixels: count }
}

/** 采样期间给一点合成输入：让「等输入才动」的游戏也有机会露出手脚（失败不影响结论） */
function nudgeInput(win: BrowserWindow, index: number): void {
  try {
    const keys = ['w', 'ArrowRight', ' ']
    const keyCode = keys[index % keys.length] ?? 'w'
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode })
  } catch {
    // 隐藏窗口不接受合成输入时忽略即可
  }
}

function describeLoadFailure(errorCode: number, errorDescription: string): string {
  return `加载失败（${errorCode} ${errorDescription || 'unknown'}）：单文件可能不是自包含的（ES 模块 / 相对引用）或 HTML 语法有误`
}

/**
 * 跑一次试玩门禁。`htmlRelativePath` 必须是工程内相对路径（工具入参来自模型，不能当任意路径读取器）。
 */
export async function runGamePlaySmokeTest(input: {
  htmlRelativePath: string
  /** 采样总数覆盖（测试用） */
  sampleCount?: number
}): Promise<GamePlaySmokeReport> {
  const startedAt = Date.now()
  const root = projectService.getRoot()
  const rel = String(input.htmlRelativePath ?? '')
    .trim()
    .replace(/\\/g, '/')
  if (!rel || rel.includes('..')) throw new Error(gamePlayJobError('BAD_PROJECT'))
  const abs = join(root, ...rel.split('/'))
  if (!existsSync(abs)) throw new Error(gamePlayJobError('NO_BUILD'))

  const errors: string[] = []
  const warnings: string[] = []
  const samples: GamePlaySmokeSample[] = []

  const win = new BrowserWindow({
    show: false,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    backgroundColor: '#000000',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // 隐藏窗口也要持续出帧，否则 rAF 被节流、采样全是同一张图
      // （`paintWhenInitiallyHidden` 默认为真，无需显式设置）
      backgroundThrottling: false
    }
  })

  const pushError = (line: string): void => {
    const text = line.trim()
    if (!text || errors.includes(text) || errors.length >= MAX_ERROR_LINES) return
    errors.push(text)
  }

  win.webContents.on('console-message', (event) => {
    const level = typeof event.level === 'number' ? event.level : 0
    if (level >= 2) pushError(event.message)
  })
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    pushError(describeLoadFailure(errorCode, errorDescription))
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    pushError(`渲染进程退出（${details.reason}）：可能是显存 / WebGL 上下文创建失败`)
  })
  win.webContents.on('unresponsive', () => {
    pushError('渲染进程无响应：主循环里可能有死循环或同步阻塞')
  })

  try {
    await win.loadFile(abs)
    const total = Math.max(1, input.sampleCount ?? SAMPLE_COUNT)
    for (let index = 0; index < total; index += 1) {
      await delay(index === 0 ? FIRST_SAMPLE_DELAY_MS : SAMPLE_INTERVAL_MS)
      if (index > 0) nudgeInput(win, index)
      try {
        const image = await win.webContents.capturePage()
        const sample = image.isEmpty() ? null : sampleBitmap(image.toBitmap())
        if (sample) samples.push(sample)
      } catch (error) {
        warnings.push(
          `第 ${index + 1} 帧截图失败：${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
  } catch (error) {
    pushError(`试玩窗口异常：${error instanceof Error ? error.message : String(error)}`)
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }

  if (!samples.length && !errors.length) {
    warnings.push('没能截到任何帧：隐藏窗口截图不可用时无法判断画面，仅报告已采集到的错误')
  }

  return evaluateGamePlaySmoke({
    errors,
    warnings,
    samples,
    durationMs: Date.now() - startedAt,
    htmlRelativePath: rel
  })
}
