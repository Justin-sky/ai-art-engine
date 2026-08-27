/**
 * 广告变体导出：把「入选」单元格的生成图从工程内复制到用户选择目录。
 * 复用 projectService 的工程根 + 目录选择对话框；源文件已落盘，仅做拷贝。
 */
import { copyFileSync, existsSync } from 'fs'
import { basename, extname, join, resolve, sep } from 'path'
import type { ExportAdVariantsInput, ExportAdVariantsResult } from '@shared/ipc'
import { fail, defErrSimple } from '@shared/errors/appError'
import { MAIN_ERRORS } from '../errors/messages'
import { projectService } from './projectService'
import { dialogService } from './dialogService'

// ── 广告变体导出个性错误 ──
const E_AD_VARIANT_NOTHING_TO_EXPORT = defErrSimple(
  'adVariant.nothingToExport',
  '没有可导出的变体',
  'No variants to export'
)

function assertInsideProject(root: string, target: string): string {
  const resolvedRoot = resolve(root) + sep
  const resolvedTarget = resolve(target)
  if (!resolvedTarget.startsWith(resolvedRoot)) {
    throw fail(MAIN_ERRORS.pathOutsideProject)
  }
  return resolvedTarget
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\.+$/g, '')
    .trim()
}

export async function exportAdVariants(
  input: ExportAdVariantsInput
): Promise<ExportAdVariantsResult> {
  try {
    if (!projectService.isOpen()) {
      return { ok: false, error: fail(MAIN_ERRORS.noProject).message }
    }
    const items = (input?.items ?? []).filter((it) => it && it.relativePath?.trim())
    if (!items.length) {
      return { ok: false, error: fail(E_AD_VARIANT_NOTHING_TO_EXPORT).message }
    }

    const directory = await dialogService.selectDirectory()
    if (!directory) {
      return { ok: false, canceled: true }
    }

    const root = projectService.getRoot()
    let copied = 0
    let skipped = 0
    for (const item of items) {
      const rel = item.relativePath.replace(/\\/g, '/').trim()
      if (!rel) {
        skipped += 1
        continue
      }
      let abs: string
      try {
        abs = assertInsideProject(root, join(root, rel))
      } catch {
        skipped += 1
        continue
      }
      if (!existsSync(abs)) {
        skipped += 1
        continue
      }

      const ext = extname(abs)
      const stem = sanitizeFileName(item.fileName || basename(abs, ext)) || 'variant'
      const suffix = ext || '.png'
      let dest = join(directory, `${stem}${suffix}`)
      let i = 2
      while (existsSync(dest)) {
        dest = join(directory, `${stem}-${i}${suffix}`)
        i += 1
      }
      try {
        copyFileSync(abs, dest)
        copied += 1
      } catch {
        skipped += 1
      }
    }

    return { ok: true, directory, copied, skipped }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
}
