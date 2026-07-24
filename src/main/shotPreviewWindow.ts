import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { resolveAppIconPath } from './appIcon'
import { settingsService } from './services/settingsService'

let shotPreviewWindow: BrowserWindow | null = null
let pendingDataUrl: string | null = null

function shotPreviewWindowOptions(): BrowserWindowConstructorOptions {
  return {
    width: 1100,
    height: 760,
    minWidth: 640,
    minHeight: 480,
    show: false,
    title: 'AIArtEngine · 图片预览',
    icon: resolveAppIconPath(),
    autoHideMenuBar: true,
    ...settingsService.windowChromeOptions(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  }
}

function shotPreviewUrl(): string {
  const hash = '#/shot-preview'
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    return `${process.env['ELECTRON_RENDERER_URL']}${hash}`
  }
  return join(__dirname, '../renderer/index.html') + hash
}

function sendShotData(win: BrowserWindow, dataUrl: string): void {
  if (win.isDestroyed()) return
  win.webContents.send('shot-preview:set', { dataUrl })
}

export function openShotPreviewWindow(dataUrl: string): { ok: true } {
  pendingDataUrl = dataUrl
  if (shotPreviewWindow && !shotPreviewWindow.isDestroyed()) {
    sendShotData(shotPreviewWindow, dataUrl)
    if (shotPreviewWindow.isMinimized()) shotPreviewWindow.restore()
    shotPreviewWindow.focus()
    return { ok: true }
  }

  const win = new BrowserWindow(shotPreviewWindowOptions())
  shotPreviewWindow = win

  win.on('ready-to-show', () => {
    win.show()
    win.focus()
  })

  win.webContents.on('did-finish-load', () => {
    if (pendingDataUrl) sendShotData(win, pendingDataUrl)
  })

  win.on('closed', () => {
    if (shotPreviewWindow === win) shotPreviewWindow = null
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(shotPreviewUrl())
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: '/shot-preview'
    })
  }

  return { ok: true }
}

export function getShotPreviewPayload(): { dataUrl: string } | null {
  return pendingDataUrl ? { dataUrl: pendingDataUrl } : null
}

export function closeShotPreviewWindow(): { ok: true } {
  if (shotPreviewWindow && !shotPreviewWindow.isDestroyed()) {
    shotPreviewWindow.close()
  }
  shotPreviewWindow = null
  return { ok: true }
}
