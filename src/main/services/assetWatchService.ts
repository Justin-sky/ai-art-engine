import { watch, type FSWatcher } from 'chokidar'
import { existsSync } from 'fs'
import { basename, dirname, sep } from 'path'

const DEBOUNCE_MS = 500
const WATCH_STABILITY_MS = 500
const WATCH_POLL_MS = 100

function isIgnoredPath(filePath: string): boolean {
  const base = basename(filePath)
  if (base.startsWith('.')) return true
  if (base.endsWith('.asset.json')) return true
  if (base.endsWith('.thumbnail.webp')) return true
  if (base === 'Cache') return true
  return false
}

/**
 * Watches the project Assets/ directory for external file changes and emits
 * a debounced list of affected parent directories. The consumer can then
 * import any new/orphan media files that appeared outside the app.
 *
 * Designed to be lightweight and non-blocking: chokidar runs in the main
 * process event loop, and the heavy reconciliation is scheduled via a
 * short debounce timer so the watcher callbacks return immediately.
 */
export class AssetWatchService {
  private watcher: FSWatcher | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private pendingDirs = new Set<string>()
  private onRefresh: ((dirs: string[]) => void) | null = null
  private root: string | null = null
  private suspended = false

  start(root: string, onRefresh: (dirs: string[]) => void): void {
    this.stop()
    this.onRefresh = onRefresh
    this.root = root
    const assetsRoot = `${root}${sep}Assets`
    if (!existsSync(assetsRoot)) {
      return
    }

    this.watcher = watch(assetsRoot, {
      ignored: (filePath, stats) =>
        isIgnoredPath(filePath) || ((stats?.isDirectory() ?? false) && isIgnoredPath(filePath)),
      ignoreInitial: true,
      persistent: true,
      followSymlinks: false,
      awaitWriteFinish: {
        stabilityThreshold: WATCH_STABILITY_MS,
        pollInterval: WATCH_POLL_MS
      },
      depth: 99
    })

    this.watcher.on('add', (filePath) => this.mark(dirname(filePath)))
    this.watcher.on('change', (filePath) => this.mark(dirname(filePath)))
    this.watcher.on('unlink', (filePath) => this.mark(dirname(filePath)))
    this.watcher.on('addDir', (dirPath) => this.mark(dirPath))
    this.watcher.on('unlinkDir', (dirPath) => this.mark(dirname(dirPath)))
    this.watcher.on('error', (err) => {
      console.warn('[assetWatch] watcher error:', err)
    })
  }

  stop(): void {
    this.clearPending()
    if (this.watcher) {
      this.watcher
        .close()
        .then(() => {
          /* noop */
        })
        .catch((err) => {
          console.warn('[assetWatch] close error:', err)
        })
      this.watcher = null
    }
    this.onRefresh = null
    this.root = null
    this.suspended = false
  }

  /**
   * 暂停监听并**等到**句柄真正释放。
   *
   * chokidar 会给每层目录开一个 `fs.watch` 句柄。Windows 上搬移 / 删除目录时这些
   * 句柄会让 rename 直接 EPERM，所以动磁盘前必须先 await 这个方法，而不是发个
   * 关闭请求就走。
   */
  async suspend(): Promise<void> {
    if (!this.watcher) return
    this.suspended = true
    const watcher = this.watcher
    this.watcher = null
    this.clearPending()
    try {
      await watcher.close()
    } catch (err) {
      console.warn('[assetWatch] suspend close error:', err)
    }
  }

  /** 恢复监听（`ignoreInitial` 为真，不会补发暂停期间的存量事件） */
  resume(): void {
    if (!this.suspended) return
    this.suspended = false
    const root = this.root
    const onRefresh = this.onRefresh
    if (root && onRefresh) this.start(root, onRefresh)
  }

  private clearPending(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.pendingDirs.clear()
  }

  private mark(dirAbs: string): void {
    this.pendingDirs.add(dirAbs)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      const dirs = this.collectTopLevelDirs()
      this.pendingDirs.clear()
      if (dirs.length && this.onRefresh) {
        this.onRefresh(dirs)
      }
    }, DEBOUNCE_MS)
  }

  private collectTopLevelDirs(): string[] {
    const sorted = Array.from(this.pendingDirs).sort()
    const top: string[] = []
    for (const d of sorted) {
      if (!top.length || !d.startsWith(top[top.length - 1] + sep)) {
        top.push(d)
      }
    }
    return top
  }
}

export const assetWatchService = new AssetWatchService()
