import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { resolveAppIconPath } from './appIcon'
import { settingsService } from './services/settingsService'

type ShotTableWindowEntry = {
  win: BrowserWindow
  scriptAssetId: string
  allowClose: boolean
  closeRequested: boolean
  forceTimer: ReturnType<typeof setTimeout> | null
}

const shotTableWindows = new Map<string, ShotTableWindowEntry>()
let mainWindowRef: BrowserWindow | null = null

const CLOSE_SAVE_TIMEOUT_MS = 8000

export function setShotTableMainWindow(win: BrowserWindow | null): void {
  mainWindowRef = win
}

function shotTableWindowOptions(): BrowserWindowConstructorOptions {
  return {
    width: 1440,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'AIArtEngine · Shot Table',
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

function shotTableHash(scriptAssetId: string): string {
  const params = new URLSearchParams()
  params.set('scriptAssetId', scriptAssetId)
  return `/shot-table?${params.toString()}`
}

function shotTableUrl(scriptAssetId: string): string {
  const hash = `#${shotTableHash(scriptAssetId)}`
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    return `${process.env['ELECTRON_RENDERER_URL']}${hash}`
  }
  return join(__dirname, '../renderer/index.html') + hash
}

function clearForceTimer(entry: ShotTableWindowEntry): void {
  if (entry.forceTimer) {
    clearTimeout(entry.forceTimer)
    entry.forceTimer = null
  }
}

function forceCloseEntry(key: string, entry: ShotTableWindowEntry): void {
  entry.allowClose = true
  clearForceTimer(entry)
  if (!entry.win.isDestroyed()) entry.win.close()
  else shotTableWindows.delete(key)
}

export function openShotTableWindow(scriptAssetId: string): { ok: true } {
  const existing = shotTableWindows.get(scriptAssetId)
  if (existing && !existing.win.isDestroyed()) {
    if (existing.win.isMinimized()) existing.win.restore()
    existing.win.focus()
    return { ok: true }
  }

  const win = new BrowserWindow(shotTableWindowOptions())
  const entry: ShotTableWindowEntry = {
    win,
    scriptAssetId,
    allowClose: false,
    closeRequested: false,
    forceTimer: null
  }
  shotTableWindows.set(scriptAssetId, entry)

  win.on('ready-to-show', () => {
    win.show()
    win.focus()
  })

  win.on('close', (event) => {
    const current = shotTableWindows.get(scriptAssetId)
    if (!current || current.allowClose || current.win.isDestroyed()) return
    event.preventDefault()
    if (current.closeRequested) return
    current.closeRequested = true
    current.win.webContents.send('shot-table:close-request', { scriptAssetId })
    current.forceTimer = setTimeout(() => {
      forceCloseEntry(scriptAssetId, current)
    }, CLOSE_SAVE_TIMEOUT_MS)
  })

  win.on('closed', () => {
    const current = shotTableWindows.get(scriptAssetId)
    if (current) clearForceTimer(current)
    shotTableWindows.delete(scriptAssetId)
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('shot-table:closed', { scriptAssetId })
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(shotTableUrl(scriptAssetId))
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: shotTableHash(scriptAssetId)
    })
  }

  return { ok: true }
}

/** 渲染进程保存完成后调用：允许窗口真正关闭。不传 id 则关闭全部。 */
export function closeShotTableWindow(scriptAssetId?: string): { ok: true } {
  if (!scriptAssetId) {
    for (const [id, entry] of [...shotTableWindows.entries()]) {
      forceCloseEntry(id, entry)
    }
    return { ok: true }
  }

  const entry = shotTableWindows.get(scriptAssetId)
  if (entry) forceCloseEntry(scriptAssetId, entry)
  return { ok: true }
}

export function isShotTableWindow(webContentsId: number): boolean {
  for (const entry of shotTableWindows.values()) {
    if (!entry.win.isDestroyed() && entry.win.webContents.id === webContentsId) return true
  }
  return false
}
