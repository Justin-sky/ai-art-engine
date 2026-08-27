import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IpcChannels } from '@shared/ipc'
import type { AppUpdateCheckResult, AppUpdateEvent } from '@shared/update'
import { defErrSimple, fail } from '@shared/errors/appError'

// ── 更新服务个性错误（electron-updater 原生报错保持透传）──
const E_UPDATE_DEV_CHECK_DISABLED = defErrSimple(
  'update.devModeCheckDisabled',
  '开发模式不检查更新',
  'Update checks are disabled in development mode'
)
const E_UPDATE_DEV_INSTALL_BLOCKED = defErrSimple(
  'update.devModeInstallBlocked',
  '开发模式无法安装更新',
  'Updates cannot be installed in development mode'
)

const STARTUP_DELAY_MS = 8_000

class UpdateService {
  private started = false
  private downloading = false

  getCurrentVersion(): string {
    return app.getVersion()
  }

  private broadcast(event: AppUpdateEvent): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IpcChannels.UPDATE_EVENT, event)
      }
    }
  }

  /** 仅打包环境启用；开发模式直接告知 disabled */
  init(): void {
    if (this.started) return
    this.started = true

    if (!app.isPackaged) {
      return
    }

    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () => {
      this.broadcast({ type: 'checking' })
    })

    autoUpdater.on('update-available', (info) => {
      this.broadcast({ type: 'available', version: info.version })
    })

    autoUpdater.on('update-not-available', (info) => {
      this.broadcast({ type: 'not-available', version: info.version })
    })

    autoUpdater.on('download-progress', (progress) => {
      this.downloading = true
      this.broadcast({
        type: 'progress',
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total
      })
    })

    autoUpdater.on('update-downloaded', (info) => {
      this.downloading = false
      this.broadcast({ type: 'downloaded', version: info.version })
    })

    autoUpdater.on('error', (err) => {
      this.downloading = false
      this.broadcast({
        type: 'error',
        message: err?.message || String(err)
      })
    })

    setTimeout(() => {
      void this.checkForUpdates()
    }, STARTUP_DELAY_MS)
  }

  async checkForUpdates(): Promise<AppUpdateCheckResult> {
    const currentVersion = this.getCurrentVersion()
    if (!app.isPackaged) {
      const message = fail(E_UPDATE_DEV_CHECK_DISABLED).message
      this.broadcast({ type: 'disabled', message })
      return { enabled: false, started: false, currentVersion, message }
    }

    try {
      await autoUpdater.checkForUpdates()
      return { enabled: true, started: true, currentVersion }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      this.broadcast({ type: 'error', message })
      return { enabled: true, started: false, currentVersion, message }
    }
  }

  quitAndInstall(): { ok: boolean; message?: string } {
    if (!app.isPackaged) {
      return { ok: false, message: fail(E_UPDATE_DEV_INSTALL_BLOCKED).message }
    }
    // quitAndInstall 会退出进程；若尚未下载完成则失败
    try {
      autoUpdater.quitAndInstall(false, true)
      return { ok: true }
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : String(e)
      }
    }
  }

  isDownloading(): boolean {
    return this.downloading
  }
}

export const updateService = new UpdateService()
