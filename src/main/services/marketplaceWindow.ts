import { BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { settingsService } from './settingsService'

/**
 * 插件市场窗口（单例）。
 *
 * 为什么做成**独立系统窗口**而不是像设置页那样内嵌浮层：市场要同时看着主界面
 * 调设置（对齐 MCP 端点、翻技能目录），盖在工作室上会把要对照的内容挡住。
 *
 * 窗口**外观**分两处，缺一不可：
 * 1. 标题栏样式（`titleBarStyle: 'hidden'` + 叠加标题栏）必须在此处的构造参数里给，
 *    见下面 `windowChromeOptions()` 的注释；
 * 2. 主题色（底色 / 叠加色）由 `browser-window-created` 统一 `applyChromeToWindow` 维护。
 */

let marketplaceWindow: BrowserWindow | null = null

/** 市场窗口的路由（渲染层 hash 路由，与设置页同一套） */
const MARKETPLACE_ROUTE = '/marketplace'

export function openMarketplaceWindow(): void {
  // 单例：已开着就聚焦，不要每点一次多一个窗口
  if (marketplaceWindow && !marketplaceWindow.isDestroyed()) {
    if (marketplaceWindow.isMinimized()) marketplaceWindow.restore()
    marketplaceWindow.show()
    marketplaceWindow.focus()
    return
  }

  const window = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    show: false,
    title: 'AIArtEngine',
    autoHideMenuBar: true,
    /**
     * `titleBarStyle: 'hidden'` 与叠加标题栏**只能在这里给**：
     * `browser-window-created` 里的 `applyChromeToWindow` 只调 `setTitleBarOverlay` /
     * `setBackgroundColor`，而叠加标题栏要求窗口创建时就已经隐藏原生标题栏。
     * 漏掉这一项的后果是窗口顶着**原生标题栏 + 视图内自绘标题栏**两层（实测踩过）。
     */
    ...settingsService.windowChromeOptions(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  marketplaceWindow = window

  window.on('ready-to-show', () => {
    window.show()
    window.focus()
  })

  // 兜底：ready-to-show 万一漏掉，别让用户对着一个看不见的窗口
  setTimeout(() => {
    if (!window.isDestroyed() && !window.isVisible()) {
      window.show()
      window.focus()
    }
  }, 2500)

  window.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[marketplace] did-fail-load', code, desc, url)
  })

  window.on('closed', () => {
    if (marketplaceWindow === window) marketplaceWindow = null
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${MARKETPLACE_ROUTE}`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: MARKETPLACE_ROUTE
    })
  }
}
