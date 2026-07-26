import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { resolveAppIconPath } from './appIcon'
import { settingsService } from './services/settingsService'

export type ShotEditorKind = 'image' | 'video'

type ShotEditorWindowEntry = {
  win: BrowserWindow
  scriptAssetId: string
  kind: ShotEditorKind
  allowClose: boolean
  closeRequested: boolean
  forceTimer: ReturnType<typeof setTimeout> | null
}

const shotEditorWindows = new Map<string, ShotEditorWindowEntry>()
let mainWindowRef: BrowserWindow | null = null

const CLOSE_SAVE_TIMEOUT_MS = 8000

function windowKey(scriptAssetId: string, kind: ShotEditorKind): string {
  return `${kind}:${scriptAssetId}`
}

function normalizeKind(kind?: ShotEditorKind | null): ShotEditorKind {
  return kind === 'image' ? 'image' : 'video'
}

export function setShotEditorMainWindow(win: BrowserWindow | null): void {
  mainWindowRef = win
}

function shotEditorWindowOptions(kind: ShotEditorKind): BrowserWindowConstructorOptions {
  const title =
    kind === 'image' ? 'AIArtEngine · Shot Image Editor' : 'AIArtEngine · Shot Video Editor'
  return {
    width: 1440,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title,
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

function shotEditorHash(scriptAssetId: string, kind: ShotEditorKind): string {
  const params = new URLSearchParams()
  params.set('scriptAssetId', scriptAssetId)
  params.set('kind', kind)
  return `/shot-editor?${params.toString()}`
}

function shotEditorUrl(scriptAssetId: string, kind: ShotEditorKind): string {
  const hash = `#${shotEditorHash(scriptAssetId, kind)}`
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

export function openShotEditorWindow(
  scriptAssetId: string,
  kind?: ShotEditorKind
): { ok: true } {
  const resolvedKind = normalizeKind(kind)
  const key = windowKey(scriptAssetId, resolvedKind)
  const existing = shotEditorWindows.get(key)
  if (existing && !existing.win.isDestroyed()) {
    if (existing.win.isMinimized()) existing.win.restore()
    existing.win.focus()
    return { ok: true }
  }

  const win = new BrowserWindow(shotEditorWindowOptions(resolvedKind))
  const entry: ShotEditorWindowEntry = {
    win,
    scriptAssetId,
    kind: resolvedKind,
    allowClose: false,
    closeRequested: false,
    forceTimer: null
  }
  shotEditorWindows.set(key, entry)

  win.on('ready-to-show', () => {
    win.show()
    win.focus()
  })

  win.on('close', (event) => {
    const current = shotEditorWindows.get(key)
    if (!current || current.allowClose || current.win.isDestroyed()) return
    event.preventDefault()
    if (current.closeRequested) return
    current.closeRequested = true
    current.win.webContents.send('shot-editor:close-request', {
      scriptAssetId,
      kind: resolvedKind
    })
    current.forceTimer = setTimeout(() => {
      forceCloseEntry(key, current)
    }, CLOSE_SAVE_TIMEOUT_MS)
  })

  win.on('closed', () => {
    const current = shotEditorWindows.get(key)
    if (current) clearForceTimer(current)
    shotEditorWindows.delete(key)
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('shot-editor:closed', {
        scriptAssetId,
        kind: resolvedKind
      })
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(shotEditorUrl(scriptAssetId, resolvedKind))
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: shotEditorHash(scriptAssetId, resolvedKind)
    })
  }

  return { ok: true }
}

/** 渲染进程保存完成后调用：允许窗口真正关闭。不传 id 则关闭全部；不传 kind 则关闭该脚本下全部种类。 */
export function closeShotEditorWindow(
  scriptAssetId?: string,
  kind?: ShotEditorKind
): { ok: true } {
  if (!scriptAssetId) {
    for (const [id, entry] of [...shotEditorWindows.entries()]) {
      forceCloseEntry(id, entry)
    }
    return { ok: true }
  }

  if (kind) {
    const key = windowKey(scriptAssetId, normalizeKind(kind))
    const entry = shotEditorWindows.get(key)
    if (entry) forceCloseEntry(key, entry)
    return { ok: true }
  }

  for (const [key, entry] of [...shotEditorWindows.entries()]) {
    if (entry.scriptAssetId === scriptAssetId) forceCloseEntry(key, entry)
  }
  return { ok: true }
}

export function isShotEditorWindow(webContentsId: number): boolean {
  for (const entry of shotEditorWindows.values()) {
    if (!entry.win.isDestroyed() && entry.win.webContents.id === webContentsId) return true
  }
  return false
}
