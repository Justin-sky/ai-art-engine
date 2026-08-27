import { dialog } from 'electron'
import { basename, extname, join, resolve, sep } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { importFileFilter } from '@shared/import'
import type { SaveBinaryFilesToDirectoryInput } from '@shared/ipc'
import { defErrSimple, fail } from '@shared/errors/appError'

const E_SELECT_PROJECT_JSON = defErrSimple(
  'dialog.selectProjectJson',
  '请选择工程根目录下的 project.json',
  'Choose project.json inside the project root directory'
)

class DialogService {
  async selectDirectory(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0] ?? null
  }

  async selectProject(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'AIArtEngine Project', extensions: ['json'] }]
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    if (basename(path) !== 'project.json') {
      throw fail(E_SELECT_PROJECT_JSON)
    }
    return path
  }

  async selectFiles(
    filters?: { name: string; extensions: string[] }[]
  ): Promise<string[]> {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: filters ?? importFileFilter()
    })
    return result.canceled ? [] : result.filePaths
  }

  /**
   * 弹出另存为对话框，将文本写入用户选择的路径。
   * @returns 成功写入的绝对路径；用户取消则为 null
   */
  async saveTextFile(input: {
    content: string
    defaultPath?: string
    filters?: { name: string; extensions: string[] }[]
  }): Promise<string | null> {
    const filters = input.filters?.length
      ? input.filters
      : [
          { name: 'Text', extensions: ['txt'] },
          { name: 'All Files', extensions: ['*'] }
        ]
    const result = await dialog.showSaveDialog({
      title: 'Save Text',
      defaultPath: input.defaultPath,
      filters,
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })
    if (result.canceled || !result.filePath) return null

    let filePath = result.filePath
    const preferredExt = filters[0]?.extensions?.[0]
    if (preferredExt && preferredExt !== '*' && !extname(filePath)) {
      filePath = `${filePath}.${preferredExt}`
    }

    writeFileSync(filePath, input.content, 'utf8')
    return filePath
  }

  /**
   * 弹出另存为对话框，将二进制写入用户选择的路径。
   * @returns 成功写入的绝对路径；用户取消则为 null
   */
  async saveBinaryFile(input: {
    data: Uint8Array | ArrayBuffer | Buffer
    defaultPath?: string
    filters?: { name: string; extensions: string[] }[]
  }): Promise<string | null> {
    const filters = input.filters?.length
      ? input.filters
      : [
          { name: 'All Files', extensions: ['*'] }
        ]
    const result = await dialog.showSaveDialog({
      title: 'Save File',
      defaultPath: input.defaultPath,
      filters,
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })
    if (result.canceled || !result.filePath) return null

    let filePath = result.filePath
    const preferredExt = filters[0]?.extensions?.[0]
    if (preferredExt && preferredExt !== '*' && !extname(filePath)) {
      filePath = `${filePath}.${preferredExt}`
    }

    const buf = Buffer.isBuffer(input.data)
      ? input.data
      : Buffer.from(input.data instanceof ArrayBuffer ? new Uint8Array(input.data) : input.data)
    writeFileSync(filePath, buf)
    return filePath
  }

  /**
   * 选择目录后批量写入二进制文件；文件名冲突时自动追加序号。
   * @returns 写入结果；用户取消则为 null
   */
  async saveBinaryFilesToDirectory(
    input: SaveBinaryFilesToDirectoryInput
  ): Promise<{ directory: string; written: number } | null> {
    if (!input.files.length) return null
    const directory = await this.selectDirectory()
    if (!directory) return null

    let written = 0
    const root = resolve(directory)
    for (const file of input.files) {
      const raw = (file.fileName || 'image').normalize('NFC').trim().replace(/\\/g, '/')
      const parts = raw.split('/').filter(Boolean)
      const filePart = parts.pop() || 'image'
      const dirParts = parts
        .map((part) =>
          part
            .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
            .replace(/\.+$/g, '')
            .replace(/^\.+$/g, '_')
        )
        .filter((part) => part && part !== '.' && part !== '..')
      const destDir = resolve(root, ...dirParts)
      if (destDir !== root && !destDir.startsWith(root + sep)) continue
      if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })

      const safeBase = filePart
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
        .replace(/\.+$/g, '')
      const ext = extname(safeBase)
      const stem = ext ? safeBase.slice(0, -ext.length) : safeBase
      const suffix = ext || '.png'
      let dest = join(destDir, `${stem || 'image'}${suffix}`)
      let i = 2
      while (existsSync(dest)) {
        dest = join(destDir, `${stem || 'image'}-${i}${suffix}`)
        i += 1
      }
      const buf = Buffer.isBuffer(file.data)
        ? file.data
        : Buffer.from(
            file.data instanceof ArrayBuffer ? new Uint8Array(file.data) : file.data
          )
      writeFileSync(dest, buf)
      written += 1
    }
    return { directory, written }
  }
}

export const dialogService = new DialogService()
