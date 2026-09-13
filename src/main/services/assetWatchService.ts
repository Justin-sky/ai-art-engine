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

  start(root: string, onRefresh: (dirs: string[]) => void): void {
    this.stop()
    this.onRefresh = onRefresh
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
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
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
    this.pendingDirs.clear()
    this.onRefresh = null
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
