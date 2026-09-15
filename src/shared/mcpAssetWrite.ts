import { type AssetType } from './domain'

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

/**
 * `asset_import` 活动标题：本次提交的路径数（逐条成败由返回值 `imported` / `skipped` 给出）。
 * 导入活动没有 model 可展示，标题要独自说明「这一步在做什么」。
 */
export function assetImportActivityTitle(count: number): string {
  return `导入 ${count} 个素材` // cjk-ok: MCP 活动标题（与 mcpServerService 同域，非 vue-i18n 文案）
}

/**
 * `asset_import` 活动补充说明：首个文件名（多件时带总数），供任务列表副标题展示。
 * 路径都取不到基名时回落到原文，避免出现空白副标题。
 */
export function assetImportActivityDetail(filePaths: string[]): string {
  const first = filePaths[0] ?? ''
  const name = first.replace(/\\/g, '/').split('/').pop() || first
  return filePaths.length > 1 ? `${name} 等 ${filePaths.length} 个文件` : name // cjk-ok: MCP 活动副标题
}

/** 比对用路径归一化：去空白、反斜杠转正斜杠、去掉尾部斜杠 */
function normalizePathForCompare(value: string): string {
  return String(value ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
}

/**
 * `asset_import` 的入参路径是否指向**本工程内任意目录**（含 `Assets/`、`Cache/`、
 * `Output/` 与自定义缓存根）。
 *
 * 为什么要拒：资产入库的正道是用户在对话产物卡上点「保存到资产库」按钮（走
 * `saveProjectAsset`，由用户挑名字与目标文件夹）。Agent 直接 import 会：
 *  - 把 `Cache/` 下的生成产物再复制一份进 `Assets/`——资产库里多一份重复文件，
 *    对话流里再出一张重复卡（上一轮已堵，但仍可能被绕开）；
 *  - 把 `Assets/` 下已入库的资产**再复制一份**为新文件名——同一份媒体占两个资产位、
 *    对话流里再出一张卡；
 * 两者都会让对话流里出现两张内容相同的产物卡。`asset_import` 的本意是收编
 * **工程外的本机素材**（参考图、用户给的照片），工程内的任何素材都不该走它。
 */
export function isProjectInternalPath(
  filePath: string,
  projectRoot: string,
  // 保留形参以维持调用方兼容性；新语义不再按具体目录判定（任何工程内路径都拒）
  _cacheOutputDir?: string | null
): boolean {
  const file = normalizePathForCompare(filePath)
  const root = normalizePathForCompare(projectRoot)
  if (!file || !root) return false

  const lowerFile = file.toLowerCase()
  const lowerRoot = root.toLowerCase()
  let rel: string
  if (lowerFile.startsWith(`${lowerRoot}/`)) {
    // 绝对路径落在工程根下：按工程内路径理解
    rel = file.slice(root.length + 1)
  } else if (!/^[a-z]:/i.test(file) && !file.startsWith('/')) {
    // 非绝对路径（相对路径）：Agent 经常直接回传 Cache/Images/xxx.png 这样的串，
    // 它不可能指向工程外——按工程内路径理解
    rel = file
  } else {
    // 绝对路径且不在本工程内：属外部素材，放行
    return false
  }

  const lowerRel = rel.replace(/^\.\/+/, '').toLowerCase()
  if (!lowerRel) return false
  // 工程根自身（空字符串 / `.`）不算
  if (lowerRel === '.' || lowerRel === '') return false
  return true
}

/**
 * 命中生成产物目录时给 Agent 的错误文案：讲清原因并指明正确入口，
 * 免得它换个写法（改写 outputDir、先拷到别处）反复重试。
 */
export function projectGeneratedOutputImportError(paths: readonly string[]): string {
  const list = paths.slice(0, 5).join('、')
  const more = paths.length > 5 ? ` 等 ${paths.length} 个文件` : '' // cjk-ok: MCP 工具错误文案
  return [
    `不能通过 asset_import 把工程内素材导入资产库：${list}${more}。`, // cjk-ok: MCP 工具错误文案
    `工程内任何素材（含 Cache/ 与 Output/ 的生成产物、Assets/ 下的已入库资产）都不该走本工具：`, // cjk-ok: MCP 工具错误文案
    `生成产物入库请让用户在对话产物卡上点「保存到资产库」按钮；已入库资产请用 asset_list / asset_read 引用，不要重新导入。`, // cjk-ok: MCP 工具错误文案
    `本工具只用于收编工程外的本机素材（参考图、用户给的照片等）。` // cjk-ok: MCP 工具错误文案
  ].join('')
}
