import { existsSync, renameSync, unlinkSync } from 'fs'

function sleepSync(ms: number): void {
  const end = Date.now() + ms
  while (Date.now() < end) {
    /* busy wait — main process atomic write path must stay sync */
  }
}

function isRetryableRenameError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY' || code === 'EEXIST'
}

/**
 * Windows 上对已存在目标做 rename 常会 EPERM（文件被占用 / AV 扫描）。
 * 失败时删除目标再重试，并带短暂退避。
 */
export function renameReplaceSync(from: string, to: string, attempts = 10): void {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      renameSync(from, to)
      return
    } catch (error) {
      lastError = error
      if (!isRetryableRenameError(error)) throw error

      if (existsSync(to)) {
        try {
          unlinkSync(to)
        } catch {
          /* destination still locked; retry after backoff */
        }
      }

      sleepSync(15 * (i + 1))
    }
  }
  throw lastError
}
