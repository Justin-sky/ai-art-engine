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
 *
 * 出卡按「同一批次」聚合（`groupRoundOutputs`）：同一次跑动常在几十毫秒内连出
 * 矢量源 / 烘焙位图 / 帧序列，再叠上节点参数预览的物化副本，逐文件出卡会在对话
 * 流里连排多张几乎相同的图——因此一张卡代表一批产物，成员在卡内展开。
 */

/** 出卡范围内的一级目录名（工程根下，大小写不敏感） */
export const SCANNED_OUTPUT_DIRS = ['Output', 'Cache'] as const

/**
 * 单轮最多出的产物卡数量：批量帧序列动辄上百张，全量出卡会撑爆会话存储
 * （localStorage 单会话上限 600 条）并把对话流冲成瀑布；超出部分只提示数量。
 */
export const MAX_ROUND_OUTPUT_CARDS = 24

/**
 * 单轮最多纳入聚合的产物文件数：卡上限只挡「出几张卡」，一张卡还能折叠多份产物，
 * 因此文件侧另设一道闸，避免极端批量把消息体与渲染成本一起推高（卡上限 × 单卡成员数
 * 已能覆盖正常轮次）。
 */
export const MAX_ROUND_OUTPUT_FILES = 120

/** 单张卡最多折叠的产物文件数（含代表文件）；超出的部分只计数 */
export const MAX_ROUND_OUTPUT_GROUP_FILES = 12

/** 同源产物（同一资产名前缀）之间允许的落盘间隔：一次跑动常在 1 秒内连出矢量源与烘焙位图 */
export const ROUND_OUTPUT_GROUP_GAP_MS = 10_000

/** 无资产名前缀的附带产物（如节点参数预览 `node-<id>_param-preview.svg`）挂进当前批次的时间窗口 */
export const ROUND_OUTPUT_ATTACH_GAP_MS = 2_000

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

/** 一张产物卡：同一批次一起落盘的多份产物合成一条 */
export interface RoundOutputCard {
  /** 代表产物（组内最早写入的一条）：卡片预览与默认保存名用它 */
  primary: ProjectOutputFile
  /** 折叠进同一张卡的其它产物（写入时间升序，不含代表文件） */
  related: ProjectOutputFile[]
}

/** 同批次聚合结果 */
export interface RoundOutputGrouping {
  /** 实际出卡的批次（按写入时间升序） */
  cards: RoundOutputCard[]
  /** 被卡上限 / 单卡成员上限挡下的文件数（界面只提示数量） */
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

/**
 * 从落盘文件名取「同一个资产」聚合键。
 *
 * 生成媒体名固定为 `{资产名}_{节点名}_{yyyyMMdd-HHmmssSSS}[_{序号}]`
 * （见 `buildGeneratedMediaFileKey`）：同一次跑动里不同节点产出的文件共用资产名前缀
 * （矢量源 / 烘焙位图 / 帧序列因此认得出是一批），去掉时间戳与序号、再砍掉节点名即得。
 * 不符合该命名的文件（agent 手写的文件名、节点参数预览副本等）返回 null，交给时间窗口兜底。
 */
export function generatedAssetKeyOf(relativePath: string): string | null {
  const base = normalizeOutputPathKey(relativePath).split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const stamped = /^(.*)_\d{8}-\d{9}(?:_\d+)?$/.exec(stem)
  if (!stamped) return null
  const head = stamped[1]!
  const cut = head.lastIndexOf('_')
  return cut > 0 ? head.slice(0, cut) : null
}

/**
 * 把本轮产物按「同一批次」聚合出卡。
 *
 * 顺序扫描并向后归并：与组内最后一个文件比较——两边都带资产名前缀时必须前缀相同、
 * 间隔在 `ROUND_OUTPUT_GROUP_GAP_MS` 内；任一侧没有前缀（参数预览这类附带产物）时
 * 只要求间隔在 `ROUND_OUTPUT_ATTACH_GAP_MS` 内。间距拉开即开下一张卡。
 *
 * - `limit`：单轮最多几张卡，缺省 `MAX_ROUND_OUTPUT_CARDS`；
 * - `maxMembers`：单卡最多折叠几份文件（含代表文件），缺省 `MAX_ROUND_OUTPUT_GROUP_FILES`；
 * - `hidden`：被卡上限 / 成员上限挡下的文件数。
 *
 * 入参须按写入时间升序（`selectRoundOutputs` 已保证）——聚合是顺序归并，不做全局重排。
 */
export function groupRoundOutputs(
  files: readonly ProjectOutputFile[],
  options: { limit?: number; maxMembers?: number } = {}
): RoundOutputGrouping {
  const limit = Math.max(0, Math.trunc(options.limit ?? MAX_ROUND_OUTPUT_CARDS))
  const maxMembers = Math.max(1, Math.trunc(options.maxMembers ?? MAX_ROUND_OUTPUT_GROUP_FILES))
  const groups: { assetKey: string | null; lastMtimeMs: number; files: ProjectOutputFile[] }[] = []
  for (const file of files) {
    const assetKey = generatedAssetKeyOf(file.relativePath)
    const current = groups[groups.length - 1]
    if (current && joinsGroup(current, file, assetKey)) {
      current.files.push(file)
      current.lastMtimeMs = file.mtimeMs
      // 组内首个文件没有前缀时（附带产物在前）由随后认出的同源产物补上身份
      if (!current.assetKey) current.assetKey = assetKey
      continue
    }
    groups.push({ assetKey, lastMtimeMs: file.mtimeMs, files: [file] })
  }

  const cards: RoundOutputCard[] = []
  let hidden = 0
  for (const group of groups) {
    if (cards.length >= limit) {
      hidden += group.files.length
      continue
    }
    const primary = group.files[0]!
    const related = group.files.slice(1, maxMembers)
    hidden += group.files.length - 1 - related.length
    cards.push({ primary, related })
  }
  return { cards, hidden }
}

/** 顺序归并时的入组判定：同源给宽窗口，附带产物只给紧窗口，间距拉开即开新卡 */
function joinsGroup(
  group: { assetKey: string | null; lastMtimeMs: number },
  file: ProjectOutputFile,
  assetKey: string | null
): boolean {
  const gap = file.mtimeMs - group.lastMtimeMs
  if (!(gap >= 0)) return false
  if (!assetKey || !group.assetKey) return gap <= ROUND_OUTPUT_ATTACH_GAP_MS
  return assetKey === group.assetKey && gap <= ROUND_OUTPUT_GROUP_GAP_MS
}
