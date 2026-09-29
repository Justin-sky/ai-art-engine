/**
 * 把 electron-updater 的整包下载换成断点续传：
 * partial 写在 userData/update-resume，失败时 pending 被清空也不丢进度。
 */
import { join } from 'path'
import { app } from 'electron'
import type { AppUpdater } from 'electron-updater'
import type { DownloadOptions } from 'builder-util-runtime'
import { downloadFileResumable } from './resumableHttpDownload'

type HttpExecutorLike = {
  download: (url: URL, destination: string, options: DownloadOptions) => Promise<string>
}

export function installResumableUpdaterDownload(updater: AppUpdater): void {
  const executor = (updater as unknown as { httpExecutor?: HttpExecutorLike | null }).httpExecutor
  if (!executor || typeof executor.download !== 'function') return

  const resumeDir = join(app.getPath('userData'), 'update-resume')

  executor.download = async (url: URL, destination: string, options: DownloadOptions) => {
    return downloadFileResumable({
      url,
      destination,
      resumeDir,
      options
    })
  }
}
