import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { resolveAppIconPath } from './appIcon'
import { settingsService } from './services/settingsService'

type ScriptTimelineWindowEntry = {
  win: BrowserWindow
  scriptAssetId: string
  allowClose: boolean
  closeRequested: boolean
  forceTimer: ReturnType<typeof setTimeout> | null
}

const scriptTimelineWindows = new Map<string, ScriptTimelineWindowEntry>()
let mainWindowRef: BrowserWindow | null = null

const CLOSE_SAVE_TIMEOUT_MS = 8000

export function setScriptTimelineMainWindow(win: BrowserWindow | null): void {
  mainWindowRef = win
}

function scriptTimelineWindowOptions(): BrowserWindowConstructorOptions {
  return {
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'AIArtEngine · Timeline',
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

function scriptTimelineHash(scriptAssetId: string): string {
  const params = new URLSearchParams()
  params.set('scriptAssetId', scriptAssetId)
  return `/script-timeline?${params.toString()}`
}

function scriptTimelineUrl(scriptAssetId: string): string {
  const hash = `#${scriptTimelineHash(scriptAssetId)}`
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    return `${process.env['ELECTRON_RENDERER_URL']}${hash}`
  }
  return join(__dirname, '../renderer/index.html') + hash
}

function clearForceTimer(entry: ScriptTimelineWindowEntry): void {
  if (entry.forceTimer) {
    clearTimeout(entry.forceTimer)
    entry.forceTimer = null
  }
}

function forceCloseEntry(key: string, entry: ScriptTimelineWindowEntry): void {
  entry.allowClose = true
  clearForceTimer(entry)
  if (!entry.win.isDestroyed()) entry.win.close()
  else scriptTimelineWindows.delete(key)
}

export function openScriptTimelineWindow(scriptAssetId: string): { ok: true } {
  const existing = scriptTimelineWindows.get(scriptAssetId)
  if (existing && !existing.win.isDestroyed()) {
    if (existing.win.isMinimized()) existing.win.restore()
    existing.win.focus()
    return { ok: true }
  }

  const win = new BrowserWindow(scriptTimelineWindowOptions())
  const entry: ScriptTimelineWindowEntry = {
    win,
    scriptAssetId,
    allowClose: false,
    closeRequested: false,
    forceTimer: null
  }
  scriptTimelineWindows.set(scriptAssetId, entry)

  win.on('ready-to-show', () => {
    win.show()
    win.focus()
  })

  win.on('close', (event) => {
    const current = scriptTimelineWindows.get(scriptAssetId)
    if (!current || current.allowClose || current.win.isDestroyed()) return
    event.preventDefault()
    if (current.closeRequested) return
    current.closeRequested = true
    current.win.webContents.send('script-timeline:close-request', { scriptAssetId })
    current.forceTimer = setTimeout(() => {
      forceCloseEntry(scriptAssetId, current)
    }, CLOSE_SAVE_TIMEOUT_MS)
  })

  win.on('closed', () => {
    const current = scriptTimelineWindows.get(scriptAssetId)
    if (current) clearForceTimer(current)
    scriptTimelineWindows.delete(scriptAssetId)
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('script-timeline:closed', { scriptAssetId })
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(scriptTimelineUrl(scriptAssetId))
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: scriptTimelineHash(scriptAssetId)
    })
  }

  return { ok: true }
}

/** 渲染进程保存完成后调用：允许窗口真正关闭。不传 id 则关闭全部。 */
export function closeScriptTimelineWindow(scriptAssetId?: string): { ok: true } {
  if (!scriptAssetId) {
    for (const [id, entry] of [...scriptTimelineWindows.entries()]) {
      forceCloseEntry(id, entry)
    }
    return { ok: true }
  }

  const entry = scriptTimelineWindows.get(scriptAssetId)
  if (entry) forceCloseEntry(scriptAssetId, entry)
  return { ok: true }
}

export function isScriptTimelineWindow(webContentsId: number): boolean {
  for (const entry of scriptTimelineWindows.values()) {
    if (!entry.win.isDestroyed() && entry.win.webContents.id === webContentsId) return true
  }
  return false
}
