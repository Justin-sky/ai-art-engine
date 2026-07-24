import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { resolveAppIconPath } from './appIcon'
import { settingsService } from './services/settingsService'

type ShotEditorWindowEntry = {
  win: BrowserWindow
  scriptAssetId: string
  allowClose: boolean
  closeRequested: boolean
  forceTimer: ReturnType<typeof setTimeout> | null
}

const shotEditorWindows = new Map<string, ShotEditorWindowEntry>()
let mainWindowRef: BrowserWindow | null = null

const CLOSE_SAVE_TIMEOUT_MS = 8000

export function setShotEditorMainWindow(win: BrowserWindow | null): void {
  mainWindowRef = win
}

function shotEditorWindowOptions(): BrowserWindowConstructorOptions {
  return {
    width: 1440,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'AIArtEngine · Shot Editor',
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

function shotEditorHash(scriptAssetId: string): string {
  const params = new URLSearchParams()
  params.set('scriptAssetId', scriptAssetId)
  return `/shot-editor?${params.toString()}`
}

function shotEditorUrl(scriptAssetId: string): string {
  const hash = `#${shotEditorHash(scriptAssetId)}`
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    return `${process.env['ELECTRON_RENDERER_URL']}${hash}`
  }
  return join(__dirname, '../renderer/index.html') + hash
}

function clearForceTimer(entry: ShotEditorWindowEntry): void {
  if (entry.forceTimer) {
    clearTimeout(entry.forceTimer)
    entry.forceTimer = null
  }
}

function forceCloseEntry(key: string, entry: ShotEditorWindowEntry): void {
  entry.allowClose = true
  clearForceTimer(entry)
  if (!entry.win.isDestroyed()) entry.win.close()
  else shotEditorWindows.delete(key)
}

export function openShotEditorWindow(scriptAssetId: string): { ok: true } {
  const existing = shotEditorWindows.get(scriptAssetId)
  if (existing && !existing.win.isDestroyed()) {
    if (existing.win.isMinimized()) existing.win.restore()
    existing.win.focus()
    return { ok: true }
  }

  const win = new BrowserWindow(shotEditorWindowOptions())
  const entry: ShotEditorWindowEntry = {
    win,
    scriptAssetId,
    allowClose: false,
    closeRequested: false,
    forceTimer: null
  }
  shotEditorWindows.set(scriptAssetId, entry)

  win.on('ready-to-show', () => {
    win.show()
    win.focus()
  })

  win.on('close', (event) => {
    const current = shotEditorWindows.get(scriptAssetId)
    if (!current || current.allowClose || current.win.isDestroyed()) return
    event.preventDefault()
    if (current.closeRequested) return
    current.closeRequested = true
    current.win.webContents.send('shot-editor:close-request', { scriptAssetId })
    current.forceTimer = setTimeout(() => {
      forceCloseEntry(scriptAssetId, current)
    }, CLOSE_SAVE_TIMEOUT_MS)
  })

  win.on('closed', () => {
    const current = shotEditorWindows.get(scriptAssetId)
    if (current) clearForceTimer(current)
    shotEditorWindows.delete(scriptAssetId)
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('shot-editor:closed', { scriptAssetId })
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(shotEditorUrl(scriptAssetId))
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: shotEditorHash(scriptAssetId)
    })
  }

  return { ok: true }
}

/** 渲染进程保存完成后调用：允许窗口真正关闭。不传 id 则关闭全部。 */
export function closeShotEditorWindow(scriptAssetId?: string): { ok: true } {
  if (!scriptAssetId) {
    for (const [id, entry] of [...shotEditorWindows.entries()]) {
      forceCloseEntry(id, entry)
    }
    return { ok: true }
  }

  const entry = shotEditorWindows.get(scriptAssetId)
  if (entry) forceCloseEntry(scriptAssetId, entry)
  return { ok: true }
}

export function isShotEditorWindow(webContentsId: number): boolean {
  for (const entry of shotEditorWindows.values()) {
    if (!entry.win.isDestroyed() && entry.win.webContents.id === webContentsId) return true
  }
  return false
}
