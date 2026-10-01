import { app, BrowserWindow, Menu, protocol, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc'
import { startMcpServer, stopMcpServer } from './services/mcpServerService'
import { startMainRuntime } from './runtime'
import { setAppErrorLocaleResolver } from '@shared/errors/appError'
import { settingsService } from './services/settingsService'
import { updateService } from './services/updateService'
import { yoloService } from './yolo/yoloService'
import { handleStudioMediaRequest } from './studioMediaProtocol'
import { handleStudioGameplayRequest } from './studioGameplayProtocol'
import { resolveAppIconPath } from './appIcon'
import { markSmokeRuntimeStarted, signalSmokeReady } from './smokeReady'
import { gpuShaderCacheSwitches } from './services/gpuShaderCachePolicy'

// 必须在 app ready 之前追加，否则 Chromium 已经建完缓存（见 gpuShaderCachePolicy 注释）
for (const gpuSwitch of gpuShaderCacheSwitches()) {
  app.commandLine.appendSwitch(gpuSwitch)
}

/** 当前主窗口；second-instance 时要把它顶到前面，故需在模块级持有 */
let mainWindow: BrowserWindow | null = null

const hasSingleInstanceLock = app.requestSingleInstanceLock()

/**
 * 第二个实例只负责把已有窗口顶到前面，然后自行退出。
 *
 * 不加锁时两个实例会共用同一个 <userData> 抢缓存目录：先启动的实例已经打开并持有
 * Cache / Network / GPU 相关目录，后启动的那个要移动或重建它们，于是刷
 *
 *   Unable to move the cache: 拒绝访问。(0x5)
 *   Unable to create cache / Gpu Cache Creation failed: -2
 *
 * 单实例锁是 Electron 的标准做法，也是桌面应用该有的行为；锁要在 app ready 之前拿，
 * 否则此时第二个实例已经把缓存目录动过一遍了。
 */
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'studio-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true
    }
  },
  {
    // 可玩 HTML iframe：不继承主窗口 script-src 'self'，允许内联试玩脚本
    scheme: 'studio-gameplay',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      corsEnabled: true
    }
  }
])

function registerMediaProtocol(): void {
  protocol.handle('studio-media', (request) => handleStudioMediaRequest(request))
  protocol.handle('studio-gameplay', (request) => handleStudioGameplayRequest(request))
}

/** 解析 window.open 的 features，让渲染层能决定弹出窗的初始尺寸与位置 */
function parseWindowFeatures(features: string): {
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

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'AIArtEngine',
    icon: resolveAppIconPath(),
    ...settingsService.windowChromeOptions(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow = window

  window.on('ready-to-show', () => {
    window.show()
    window.focus()
    signalSmokeReady('window-ready-to-show')
  })

  // Fallback: ensure window becomes visible even if ready-to-show is missed
  setTimeout(() => {
    if (!window.isDestroyed() && !window.isVisible()) {
      window.show()
      window.focus()
    }
  }, 2500)

  window.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[did-fail-load]', code, desc, url)
  })

  // 渲染主文档加载完成即视为可服务（比 ready-to-show 更可靠，headless/CI 下同样触发）
  window.webContents.on('did-finish-load', () => {
    signalSmokeReady('renderer-loaded')
  })

  window.webContents.on('console-message', (event) => {
    const level = typeof event.level === 'number' ? event.level : 0
    if (level >= 2) {
      console.error('[renderer]', event.message)
    }
  })

  window.webContents.setWindowOpenHandler((details) => {
    // Allow dockview popout windows (about:blank / same-origin)
    const isPopout =
      details.url === 'about:blank' ||
      details.url.startsWith('file:') ||
      (is.dev &&
        !!process.env['ELECTRON_RENDERER_URL'] &&
        details.url.startsWith(process.env['ELECTRON_RENDERER_URL']))

    if (isPopout) {
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

    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.aiartengine.app')
  Menu.setApplicationMenu(null)
  registerMediaProtocol()
  settingsService.init()
  setAppErrorLocaleResolver(() => settingsService.get().language)
  await startMainRuntime()
  markSmokeRuntimeStarted()
  registerIpcHandlers()
  await startMcpServer()
  updateService.init()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
    settingsService.applyChromeToWindow(window)
  })

  createWindow()
  settingsService.syncWindowChrome()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  stopMcpServer()
  yoloService.stop()
})
