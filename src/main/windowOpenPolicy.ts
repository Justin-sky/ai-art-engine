import { shell, type BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { settingsService } from './services/settingsService'

/**
 * 每个窗口**都**要装的 `window.open` 策略。
 *
 * 为什么要抽出来：原先这段只装在主窗口上，于是插件市场窗口（独立 BrowserWindow）里点
 * 「开发者文档」走的是 Electron 默认行为 —— **在应用内新开一个 BrowserWindow**，
 * 而不是交给系统浏览器。用户看到的是应用里又冒出一个窗口，与预期不符。
 *
 * 现在的策略是两条：
 * - **同源 / about:blank**：放行，作为 dockview 的弹出面板（尺寸位置由调用方 features 决定）
 * - **其它（http/https 等）**：`shell.openExternal` 交给系统浏览器，并拒绝在应用内打开
 */

/** 解析 window.open 的 features，让渲染层能决定弹窗的初始尺寸与位置 */
export function parseWindowFeatures(features: string): {
  width?: number
  height?: number
  left?: number
  top?: number
} {
  const parsed: { width?: number; height?: number; left?: number; top?: number } = {}
  for (const part of features.split(',')) {
    const [rawKey, rawValue] = part.split('=')
    const key = rawKey?.trim().toLowerCase()
    const value = Number(rawValue)
    if (!key || !Number.isFinite(value)) continue
    if (key === 'width' && value > 0) parsed.width = Math.round(value)
    else if (key === 'height' && value > 0) parsed.height = Math.round(value)
    else if (key === 'left') parsed.left = Math.round(value)
    else if (key === 'top') parsed.top = Math.round(value)
  }
  return parsed
}

/** 判定某个 window.open 目标是不是「应用内的弹出面板」（而非该交给系统浏览器的外链） */
function isInAppPopout(url: string): boolean {
  return (
    url === 'about:blank' ||
    url.startsWith('file:') ||
    (is.dev &&
      !!process.env['ELECTRON_RENDERER_URL'] &&
      url.startsWith(process.env['ELECTRON_RENDERER_URL']))
  )
}

/**
 * 给窗口安装 window.open 策略。主窗口与插件市场窗口都调用它 ——
 * 只装一处就会出现「某个窗口里外链开成了应用内窗口」这种按窗口而异的行为。
 */
export function installWindowOpenHandler(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler((details) => {
    if (isInAppPopout(details.url)) {
      const requested = parseWindowFeatures(details.features)
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: requested.width ?? 960,
          height: requested.height ?? 640,
          ...(requested.left == null ? {} : { x: requested.left }),
          ...(requested.top == null ? {} : { y: requested.top }),
          minWidth: 420,
          minHeight: 280,
          autoHideMenuBar: true,
          title: 'AIArtEngine',
          ...settingsService.windowChromeOptions(),
          webPreferences: {
            preload: join(__dirname, '../preload/index.js'),
            sandbox: false,
            contextIsolation: true,
            nodeIntegration: false
          }
        }
      }
    }

    // 外链：交给系统浏览器，不在应用内开窗
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })
}
