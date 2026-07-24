import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import type { WorldElementKind } from '@shared/graph'
import { resolveAppIconPath } from './appIcon'
import { settingsService } from './services/settingsService'

export type WorldEditorTab = WorldElementKind

type WorldEditorWindowEntry = {
  win: BrowserWindow
  worldAssetId: string
  allowClose: boolean
  closeRequested: boolean
  forceTimer: ReturnType<typeof setTimeout> | null
}

const worldEditorWindows = new Map<string, WorldEditorWindowEntry>()
let mainWindowRef: BrowserWindow | null = null

const CLOSE_SAVE_TIMEOUT_MS = 8000

export function setWorldEditorMainWindow(win: BrowserWindow | null): void {
  mainWindowRef = win
}

function worldEditorWindowOptions(): BrowserWindowConstructorOptions {
  return {
    width: 1440,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'AIArtEngine · World Elements',
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

function worldEditorHash(worldAssetId: string, tab?: WorldEditorTab): string {
  const params = new URLSearchParams()
  params.set('worldAssetId', worldAssetId)
  if (tab && tab !== 'characters') params.set('tab', tab)
  return `/world-editor?${params.toString()}`
}

function worldEditorUrl(worldAssetId: string, tab?: WorldEditorTab): string {
  const hash = `#${worldEditorHash(worldAssetId, tab)}`
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    return `${process.env['ELECTRON_RENDERER_URL']}${hash}`
  }
  return join(__dirname, '../renderer/index.html') + hash
}

function clearForceTimer(entry: WorldEditorWindowEntry): void {
  if (entry.forceTimer) {
    clearTimeout(entry.forceTimer)
    entry.forceTimer = null
  }
}

function forceCloseEntry(key: string, entry: WorldEditorWindowEntry): void {
  entry.allowClose = true
  clearForceTimer(entry)
  if (!entry.win.isDestroyed()) entry.win.close()
  else worldEditorWindows.delete(key)
}

export function openWorldEditorWindow(
  worldAssetId: string,
  tab?: WorldEditorTab
): { ok: true } {
  const existing = worldEditorWindows.get(worldAssetId)
  if (existing && !existing.win.isDestroyed()) {
    if (tab) {
      existing.win.webContents.send('world-editor:set-tab', {
        worldAssetId,
        tab
      })
    }
    if (existing.win.isMinimized()) existing.win.restore()
    existing.win.focus()
    return { ok: true }
  }

  const win = new BrowserWindow(worldEditorWindowOptions())
  const entry: WorldEditorWindowEntry = {
    win,
    worldAssetId,
    allowClose: false,
    closeRequested: false,
    forceTimer: null
  }
  worldEditorWindows.set(worldAssetId, entry)

  win.on('ready-to-show', () => {
    win.show()
    win.focus()
  })

  win.on('close', (event) => {
    const current = worldEditorWindows.get(worldAssetId)
    if (!current || current.allowClose || current.win.isDestroyed()) return
    event.preventDefault()
    if (current.closeRequested) return
    current.closeRequested = true
    current.win.webContents.send('world-editor:close-request', { worldAssetId })
    current.forceTimer = setTimeout(() => {
      forceCloseEntry(worldAssetId, current)
    }, CLOSE_SAVE_TIMEOUT_MS)
  })

  win.on('closed', () => {
    const current = worldEditorWindows.get(worldAssetId)
    if (current) clearForceTimer(current)
    worldEditorWindows.delete(worldAssetId)
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('world-editor:closed', { worldAssetId })
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(worldEditorUrl(worldAssetId, tab))
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: worldEditorHash(worldAssetId, tab)
    })
  }

  return { ok: true }
}

/** 渲染进程保存完成后调用：允许窗口真正关闭。不传 id 则关闭全部。 */
export function closeWorldEditorWindow(worldAssetId?: string): { ok: true } {
  if (!worldAssetId) {
    for (const [id, entry] of [...worldEditorWindows.entries()]) {
      forceCloseEntry(id, entry)
    }
    return { ok: true }
  }

  const entry = worldEditorWindows.get(worldAssetId)
  if (entry) forceCloseEntry(worldAssetId, entry)
  return { ok: true }
}

export function isWorldEditorWindow(webContentsId: number): boolean {
  for (const entry of worldEditorWindows.values()) {
    if (!entry.win.isDestroyed() && entry.win.webContents.id === webContentsId) return true
  }
  return false
}
