import { randomBytes } from 'crypto'
import { readFileSync, unlinkSync, writeFileSync } from 'fs'
import { renameReplaceSync } from '../persistence/atomicRename'

export function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T
}

/** 先写同目录临时文件，再 rename，避免进程中断留下半份 JSON。 */
export function writeJsonAtomic(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf-8')
  try {
    renameReplaceSync(temporary, path)
  } catch (error) {
    try {
      unlinkSync(temporary)
    } catch {
      /* ignore cleanup failure */
    }
    throw error
  }
}
