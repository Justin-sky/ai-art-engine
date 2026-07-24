import { randomBytes } from 'crypto'
import { copyFileSync, existsSync, rmSync, unlinkSync } from 'fs'
import { renameReplaceSync } from './atomicRename'

export function copyFileAtomic(source: string, destination: string): void {
  const temporary = `${destination}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  copyFileSync(source, temporary)
  try {
    renameReplaceSync(temporary, destination)
  } catch (error) {
    try {
      unlinkSync(temporary)
    } catch {
      /* ignore cleanup failure */
    }
    throw error
  }
}

export function removeIfExists(path: string): void {
  if (existsSync(path)) rmSync(path)
}
