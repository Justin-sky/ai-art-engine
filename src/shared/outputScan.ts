/**
 * 对话产物扫盘口径（纯函数）。
 *
 * 用途：AI 对话每轮结束时，把 **agent 直接落盘** 的产物（不经 MCP 活动的那些，
 * 例如脚本写出的 SVG / 帧序列）也搬进对话流的产物卡，避免「文件确实生成了、
 * 对话里一张卡都没有」。
 *
 * 收录范围只限工程根下的 `Output/` 与 `Cache/` 两个产物目录：资产库
 * （`Assets/`）走资产链路、`.aiartengine/graph-outputs/` 走 MCP 活动链路，
 * 都不在这里重复出卡。且只收 **能渲染成卡** 的媒体类型——文本 / JSON 之类的
 * 中间产物在卡里只能显示一行路径，徒增噪音；类型集合与 `ChatAssetPreview`
 * 的预览白名单保持一致。
 */

/** 出卡范围内的一级目录名（工程根下，大小写不敏感） */
export const SCANNED_OUTPUT_DIRS = ['Output', 'Cache'] as const

/**
 * 单轮最多出的产物卡数量：批量帧序列动辄上百张，全量出卡会撑爆会话存储
 * （localStorage 单会话上限 600 条）并把对话流冲成瀑布；超出部分只提示数量。
 */
export const MAX_ROUND_OUTPUT_CARDS = 24

/** 可出卡的媒体扩展名（与 `ChatAssetPreview` 的预览白名单一致） */
const SCANNED_MEDIA_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'mp4',
  'webm',
  'mov',
  'mkv',
  'm4v',
  'mp3',
  'wav',
  'ogg',
  'm4a',
  'aac',
  'flac',
  'glb',
  'gltf'
])

/** 扫盘命中的单个产物文件 */
export interface ProjectOutputFile {
  /** 工程内相对路径（正斜杠） */
  relativePath: string
  /** 最后写入时间（毫秒），用于判定「本轮产出」 */
  mtimeMs: number
  /** 字节数（0 视为半截文件，不出卡） */
  size: number
}

/** 本轮产物筛选结果 */
export interface RoundOutputSelection {
  /** 实际出卡的产物（按写入时间升序，与对话的时间叙事一致） */
  picked: ProjectOutputFile[]
  /** 通过筛选但超出卡上限的数量（界面只提示数量，不再逐条出卡） */
  hidden: number
}

/**
 * 路径比对键：统一正斜杠、去掉前导斜杠与首尾空白。
 * 大小写不折叠——同一来源产出的路径写法一致，折叠反而会在区分大小写的系统上误合并。
 */
export function normalizeOutputPathKey(relativePath: string): string {
  return String(relativePath ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
}

/**
 * 是否属于可出卡的产物路径：位于 `Output/` 或 `Cache/` 下（至少「目录 / 文件」两段）、
 * 不含隐藏路径段、扩展名可预览，且不是元数据文件（`.asset.json` / 缩略图）。
 */
export function isScannedOutputPath(relativePath: string): boolean {
  const posix = normalizeOutputPathKey(relativePath)
  if (!posix) return false
  const segments = posix.split('/').filter(Boolean)
  if (segments.length < 2) return false
  const top = segments[0]!.toLowerCase()
  if (!SCANNED_OUTPUT_DIRS.some((dir) => dir.toLowerCase() === top)) return false
  if (segments.some((segment) => segment.startsWith('.'))) return false
  const base = segments[segments.length - 1]!
  if (base.endsWith('.asset.json')) return false
  if (base.endsWith('.thumbnail.webp')) return false
  const dot = base.lastIndexOf('.')
  if (dot < 0) return false
  return SCANNED_MEDIA_EXTS.has(base.slice(dot + 1).toLowerCase())
}

/**
 * 从扫盘候选里选出本轮真正要出卡的产物。
 *
 * - 只保留写入时间不早于 `sinceMs`（本轮开始时刻）且体积大于 0 的文件；
 * - `exclude` 传入「本次会话已经出过卡」的路径：同一文件不再出第二张卡，
 *   也避免与 MCP 活动卡（生成产物同样落在 `Cache/`）重复；
 * - 按写入时间升序返回，超出 `limit` 的部分只计数（`hidden`）。
 */
export function selectRoundOutputs(
  files: readonly ProjectOutputFile[],
  options: { sinceMs: number; exclude?: Iterable<string>; limit?: number }
): RoundOutputSelection {
  const sinceMs = Number.isFinite(options.sinceMs) ? options.sinceMs : 0
  const limit = Math.max(0, Math.trunc(options.limit ?? MAX_ROUND_OUTPUT_CARDS))
  const exclude = new Set<string>()
  for (const item of options.exclude ?? []) {
    const key = normalizeOutputPathKey(item)
    if (key) exclude.add(key)
  }

  const seen = new Set<string>()
  const matched: ProjectOutputFile[] = []
  for (const file of files) {
    const key = normalizeOutputPathKey(file?.relativePath)
    if (!key || !isScannedOutputPath(key)) continue
    if (seen.has(key) || exclude.has(key)) continue
    if (!(Number(file.mtimeMs) >= sinceMs)) continue
    if (!(Number(file.size) > 0)) continue
    seen.add(key)
    matched.push({ relativePath: key, mtimeMs: Number(file.mtimeMs), size: Number(file.size) })
  }

  matched.sort((a, b) => a.mtimeMs - b.mtimeMs || a.relativePath.localeCompare(b.relativePath))
  return { picked: matched.slice(0, limit), hidden: Math.max(0, matched.length - limit) }
}
