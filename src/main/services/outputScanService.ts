/**
 * 工程产物扫盘服务（只读）。
 *
 * 用途：AI 对话每轮结束时，把 agent 直接落盘的产物（脚本写出的 SVG / 帧序列等，
 * 不经 MCP 活动链路）也搬进对话卡。收录范围与筛选口径见 `@shared/outputScan`。
 *
 * 约束与取舍：
 * - 只读：只 readdir / stat，绝不写盘、不建目录；
 * - 只遍历工程根下的 `Output/` 与 `Cache/`（目录名固定，调用方无法用参数把扫描引到工程外）；
 * - 文件数与目录深度都有上限，目录不存在 / 无权限一律当空处理；
 * - 任何失败都返回空清单而不是抛异常——产物卡是旁路展示，不该打断会话。
 */
import { readdirSync, statSync, type Dirent } from 'fs'
import { join } from 'path'
import {
  SCANNED_OUTPUT_DIRS,
  isScannedOutputPath,
  type ProjectOutputFile
} from '@shared/outputScan'
import { projectService } from './projectService'

/** 单次扫描读取的文件数上限（防止超大产物目录把一轮对话拖住） */
const MAX_SCAN_FILES = 4000
/** 目录递归深度上限（帧序列 / 分层导出可能很深） */
const MAX_SCAN_DEPTH = 8

/** 扫描工程 `Output/` 与 `Cache/` 下、不早于 `sinceMs` 写入的可预览媒体 */
export function scanProjectOutputFiles(input: { sinceMs?: number }): ProjectOutputFile[] {
  if (!projectService.isOpen()) return []
  const root = projectService.getRoot()
  if (!root) return []
  const sinceMs = Number.isFinite(input?.sinceMs) ? Number(input?.sinceMs) : 0
  const files: ProjectOutputFile[] = []
  let visited = 0

  const walk = (dirAbs: string, relDir: string, depth: number): void => {
    if (depth > MAX_SCAN_DEPTH || visited >= MAX_SCAN_FILES) return
    let entries: Dirent[]
    try {
      entries = readdirSync(dirAbs, { withFileTypes: true })
    } catch {
      // 目录不存在 / 无权限：当作没有产物
      return
    }
    for (const entry of entries) {
      if (visited >= MAX_SCAN_FILES) return
      const name = entry.name
      if (name.startsWith('.')) continue
      const rel = `${relDir}/${name}`
      if (entry.isDirectory()) {
        walk(join(dirAbs, name), rel, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      // 先按路径口径过滤（媒体类型 + 元数据排除），避免对每个文件都 stat
      if (!isScannedOutputPath(rel)) continue
      let stat
      try {
        stat = statSync(join(dirAbs, name))
      } catch {
        continue
      }
      visited += 1
      if (stat.mtimeMs < sinceMs || stat.size <= 0) continue
      files.push({ relativePath: rel, mtimeMs: stat.mtimeMs, size: stat.size })
    }
  }

  for (const dir of SCANNED_OUTPUT_DIRS) {
    walk(join(root, dir), dir, 1)
  }
  return files
}
