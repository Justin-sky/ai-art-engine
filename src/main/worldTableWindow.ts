import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { resolveAppIconPath } from './appIcon'
import { settingsService } from './services/settingsService'

type WorldTableWindowEntry = {
  win: BrowserWindow
  worldAssetId: string
  allowClose: boolean
  closeRequested: boolean
  forceTimer: ReturnType<typeof setTimeout> | null
}

const worldTableWindows = new Map<string, WorldTableWindowEntry>()
let mainWindowRef: BrowserWindow | null = null

const CLOSE_SAVE_TIMEOUT_MS = 8000

export function setWorldTableMainWindow(win: BrowserWindow | null): void {
  mainWindowRef = win
}

function worldTableWindowOptions(): BrowserWindowConstructorOptions {
  return {
    width: 1440,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'AIArtEngine · World Table',
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

function worldTableHash(worldAssetId: string): string {
  const params = new URLSearchParams()
  params.set('worldAssetId', worldAssetId)
  return `/world-table?${params.toString()}`
}

function worldTableUrl(worldAssetId: string): string {
  const hash = `#${worldTableHash(worldAssetId)}`
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    return `${process.env['ELECTRON_RENDERER_URL']}${hash}`
  }
  return join(__dirname, '../renderer/index.html') + hash
}

function clearForceTimer(entry: WorldTableWindowEntry): void {
  if (entry.forceTimer) {
    clearTimeout(entry.forceTimer)
    entry.forceTimer = null
  }
}

function forceCloseEntry(key: string, entry: WorldTableWindowEntry): void {
  entry.allowClose = true
  clearForceTimer(entry)
  if (!entry.win.isDestroyed()) entry.win.close()
  else worldTableWindows.delete(key)
}

export function openWorldTableWindow(worldAssetId: string): { ok: true } {
  const existing = worldTableWindows.get(worldAssetId)
  if (existing && !existing.win.isDestroyed()) {
    if (existing.win.isMinimized()) existing.win.restore()
    existing.win.focus()
    return { ok: true }
  }

  const win = new BrowserWindow(worldTableWindowOptions())
  const entry: WorldTableWindowEntry = {
    win,
    worldAssetId,
    allowClose: false,
    closeRequested: false,
    forceTimer: null
  }
  worldTableWindows.set(worldAssetId, entry)

  win.on('ready-to-show', () => {
    win.show()
    win.focus()
  })

  win.on('close', (event) => {
    const current = worldTableWindows.get(worldAssetId)
    if (!current || current.allowClose || current.win.isDestroyed()) return
    event.preventDefault()
    if (current.closeRequested) return
    current.closeRequested = true
    current.win.webContents.send('world-table:close-request', { worldAssetId })
    current.forceTimer = setTimeout(() => {
      forceCloseEntry(worldAssetId, current)
    }, CLOSE_SAVE_TIMEOUT_MS)
  })

  win.on('closed', () => {
    const current = worldTableWindows.get(worldAssetId)
    if (current) clearForceTimer(current)
    worldTableWindows.delete(worldAssetId)
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('world-table:closed', { worldAssetId })
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(worldTableUrl(worldAssetId))
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: worldTableHash(worldAssetId)
    })
  }

  return { ok: true }
}

export function closeWorldTableWindow(worldAssetId?: string): { ok: true } {
  if (!worldAssetId) {
    for (const [id, entry] of [...worldTableWindows.entries()]) {
      forceCloseEntry(id, entry)
    }
    return { ok: true }
  }

  const entry = worldTableWindows.get(worldAssetId)
  if (entry) forceCloseEntry(worldAssetId, entry)
  return { ok: true }
}

export function isWorldTableWindow(webContentsId: number): boolean {
  for (const entry of worldTableWindows.values()) {
    if (!entry.win.isDestroyed() && entry.win.webContents.id === webContentsId) return true
  }
  return false
}
