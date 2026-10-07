import { BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

/**
 * 插件市场窗口（单例）。
 *
 * 为什么做成**独立系统窗口**而不是像设置页那样内嵌浮层：市场要同时看着主界面
 * 调设置（对齐 MCP 端点、翻技能目录），盖在工作室上会把要对照的内容挡住。
 *
 * 窗口外观不在这里设置：`browser-window-created` 已经统一调
 * `settingsService.applyChromeToWindow`，两处各设一次只会让版本漂移。
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
