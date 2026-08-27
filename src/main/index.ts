import { app, BrowserWindow, Menu, protocol, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc'
import { startMainRuntime } from './runtime'
import { setAppErrorLocaleResolver } from '@shared/errors/appError'
import { settingsService } from './services/settingsService'
import { updateService } from './services/updateService'
import { handleStudioMediaRequest } from './studioMediaProtocol'
import { resolveAppIconPath } from './appIcon'

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
  }
])

function registerMediaProtocol(): void {
  protocol.handle('studio-media', (request) => handleStudioMediaRequest(request))
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
  const mainWindow = new BrowserWindow({
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

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
    mainWindow.focus()
  })

  // Fallback: ensure window becomes visible even if ready-to-show is missed
  setTimeout(() => {
    if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show()
      mainWindow.focus()
    }
  }, 2500)

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[did-fail-load]', code, desc, url)
  })

  mainWindow.webContents.on('console-message', (event) => {
    const level = typeof event.level === 'number' ? event.level : 0
    if (level >= 2) {
      console.error('[renderer]', event.message)
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    // Allow dockview popout windows (about:blank / same-origin)
    const isPopout =
      details.url === 'about:blank' ||
      details.url.startsWith('file:') ||
      (is.dev && !!process.env['ELECTRON_RENDERER_URL'] && details.url.startsWith(process.env['ELECTRON_RENDERER_URL']))

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
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.aiartengine.app')
  Menu.setApplicationMenu(null)
  registerMediaProtocol()
  settingsService.init()
  setAppErrorLocaleResolver(() => settingsService.get().language)
  await startMainRuntime()
  registerIpcHandlers()
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
