import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { resolveAppIconPath } from './appIcon'
import { settingsService } from './services/settingsService'

type StageWindowEntry = {
  win: BrowserWindow
  directorAssetId: string
  processingNodeId: string | null
  allowClose: boolean
  closeRequested: boolean
  forceTimer: ReturnType<typeof setTimeout> | null
}

const stageWindows = new Map<string, StageWindowEntry>()
let mainWindowRef: BrowserWindow | null = null

const CLOSE_SAVE_TIMEOUT_MS = 8000

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindowRef = win
}

function stageWindowKey(directorAssetId: string, processingNodeId?: string | null): string {
  return processingNodeId ? `${directorAssetId}::${processingNodeId}` : directorAssetId
}

function stageWindowOptions(): BrowserWindowConstructorOptions {
  return {
    width: 1440,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'AIArtEngine · Stage',
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

function stageHash(directorAssetId: string, processingNodeId?: string | null): string {
  const params = new URLSearchParams()
  params.set('directorAssetId', directorAssetId)
  if (processingNodeId) params.set('processingNodeId', processingNodeId)
  return `/stage?${params.toString()}`
}

function stageUrl(directorAssetId: string, processingNodeId?: string | null): string {
  const hash = `#${stageHash(directorAssetId, processingNodeId)}`
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    return `${process.env['ELECTRON_RENDERER_URL']}${hash}`
  }
  return join(__dirname, '../renderer/index.html') + hash
}

function clearForceTimer(entry: StageWindowEntry): void {
  if (entry.forceTimer) {
    clearTimeout(entry.forceTimer)
    entry.forceTimer = null
  }
}

function forceCloseEntry(key: string, entry: StageWindowEntry): void {
  entry.allowClose = true
  clearForceTimer(entry)
  if (!entry.win.isDestroyed()) entry.win.close()
  else stageWindows.delete(key)
}

export function openStageWindow(
  directorAssetId: string,
  processingNodeId?: string | null
): { ok: true } {
  const key = stageWindowKey(directorAssetId, processingNodeId)
  const existing = stageWindows.get(key)
  if (existing && !existing.win.isDestroyed()) {
    if (existing.win.isMinimized()) existing.win.restore()
    existing.win.focus()
    return { ok: true }
  }

  const win = new BrowserWindow(stageWindowOptions())
  const entry: StageWindowEntry = {
    win,
    directorAssetId,
    processingNodeId: processingNodeId ?? null,
    allowClose: false,
    closeRequested: false,
    forceTimer: null
  }
  stageWindows.set(key, entry)

  win.on('ready-to-show', () => {
    win.show()
    win.focus()
  })

  win.on('close', (event) => {
    const current = stageWindows.get(key)
    if (!current || current.allowClose || current.win.isDestroyed()) return
    event.preventDefault()
    if (current.closeRequested) return
    current.closeRequested = true
    current.win.webContents.send('stage:close-request', {
      directorAssetId,
      processingNodeId: processingNodeId ?? null
    })
    current.forceTimer = setTimeout(() => {
      forceCloseEntry(key, current)
    }, CLOSE_SAVE_TIMEOUT_MS)
  })

  win.on('closed', () => {
    const current = stageWindows.get(key)
    if (current) clearForceTimer(current)
    stageWindows.delete(key)
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('stage:closed', {
        directorAssetId,
        processingNodeId: processingNodeId ?? null
      })
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(stageUrl(directorAssetId, processingNodeId))
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: stageHash(directorAssetId, processingNodeId)
    })
  }

  return { ok: true }
}

/** 渲染进程保存完成后调用：允许窗口真正关闭。不传 nodeId 则关闭该资产全部舞台窗。 */
export function closeStageWindow(
  directorAssetId?: string,
  processingNodeId?: string | null
): { ok: true } {
  if (!directorAssetId) {
    for (const [id, entry] of [...stageWindows.entries()]) {
      forceCloseEntry(id, entry)
    }
    return { ok: true }
  }

  if (processingNodeId) {
    const key = stageWindowKey(directorAssetId, processingNodeId)
    const entry = stageWindows.get(key)
    if (entry) forceCloseEntry(key, entry)
    return { ok: true }
  }

  for (const [key, entry] of [...stageWindows.entries()]) {
    if (entry.directorAssetId === directorAssetId) forceCloseEntry(key, entry)
  }
  return { ok: true }
}

export function broadcastStagePreview(
  directorAssetId: string,
  previewUrl: string,
  processingNodeId?: string | null
): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('stage:preview', {
      directorAssetId,
      previewUrl,
      processingNodeId: processingNodeId ?? null
    })
  }
}

export function isStageWindow(webContentsId: number): boolean {
  for (const entry of stageWindows.values()) {
    if (!entry.win.isDestroyed() && entry.win.webContents.id === webContentsId) return true
  }
  return false
}
