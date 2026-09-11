import type { AssetType } from './domain'

/**
 * MCP `asset_create` 允许创建的资产类型白名单。
 *
 * 只收录「无媒体也能成立」的数据 / 占位型资产：Agent 可以先建空壳，再用
 * `graph_edit` 编排内图、或由后续生成节点产出内容。刻意排除 `motion`（3D
 * 导演台姿势）/ `model3d` / `model` 等需要专用编辑器写入的资产类型，避免造出
 * 界面上无从编辑的空资产。
 */
export const MCP_CREATABLE_ASSET_TYPES: readonly AssetType[] = [
  'screenplay',
  'gameSystem',
  'world',
  'beat',
  'subgraph',
  'canvas',
  'image',
  'video',
  'voice',
  'motion2d'
]

export function isMcpCreatableAssetType(value: string): value is AssetType {
  return MCP_CREATABLE_ASSET_TYPES.includes(value as AssetType)
}

/** 单次 `asset_import` 的路径数量上限：避免一次调用塞进上千路径把主进程卡住 */
export const MCP_ASSET_IMPORT_LIMIT = 50

/**
 * 归一化「工程内相对路径」入参：统一正斜杠，拒绝绝对路径与 `..` 越界。
 * 媒体类工具（转写 / 分离 / 上传）共用，避免 Agent 传进来能逃出工程根目录的路径。
 */
export function normalizeProjectRelativePath(value: string): string | null {
  const trimmed = value.trim().replace(/\\/g, '/')
  if (!trimmed) return null
  if (trimmed.startsWith('/') || /^[a-zA-Z]:/.test(trimmed)) return null
  if (trimmed.split('/').includes('..')) return null
  return trimmed
}

/** 归一化字符串数组入参：剔除非字符串与空串、按原顺序去重 */
export function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const items: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const text = item.trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    items.push(text)
  }
  return items
}

/**
 * 归一化 `asset_import` 的路径入参。
 * 存在性 / 类型支持由主进程导入链路逐条判定并在 `skipped` 中回传。
 */
export function normalizeImportFilePaths(value: unknown): string[] {
  return normalizeStringList(value)
}
