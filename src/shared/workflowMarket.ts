/**
 * 远端工作流市场（`ai-art-engine-workflow`）的契约与纯校验逻辑。
 *
 * ## 与技能市场的结构关系
 *
 * 两个市场的管道完全相同（拉索引 → 缓存 → 拉文件 → 校验 → 原子落盘 → 记账），
 * 差别只在**载荷**：技能是 `SKILL.md`，工作流是「元数据 + `GraphPlan`」。
 * 因此这里只负责**格式与兼容性判定**，传输与落盘交给通用管道。
 *
 * ## 为什么 `plan` 要包一层
 *
 * `GraphPlan` 是 LLM 与物化器（`materializeGraphPlan`）共用的**受约束**结构，
 * `pickAllowedParams` 会据 `ALLOWED_PARAM_KEYS` 与节点声明白名单判参。往里塞
 * `id` / `cover` / `author` 会污染这套判断，所以元数据必须在外面单独一层。
 *
 * ## 兼容性是本模块的重点
 *
 * 工作流**引用节点类型**（`typeId`）。旧版应用拿到引用了新节点类型的工作流会落出一个
 * 残图 —— 所以「缺哪些类型」必须在安装/使用前就判定出来，而不是依赖
 * `materializeGraphPlan` 的 warnings 兜底（那时用户已经点了）。
 */

import type { GraphPlan } from './graph'

/** 索引里一条工作流的**展示与兼容信息**（不含 `plan` 本体，控制索引体积） */
export interface WorkflowMarketEntry {
  id: string
  title: string
  titleEn?: string
  summary: string
  category: string
  tags: string[]
  version: string
  author: { name: string; url?: string }
  license: string
  /** 封面相对路径；卡片门面 */
  cover?: string
  requires: WorkflowRequirement
  nodeCount: number
  edgeCount: number
  /** 工作流文件体积（下载前可预判） */
  sizeBytes?: number
}

/** 工作流对应用的要求 */
export interface WorkflowRequirement {
  /** 该工作流用到的全部节点类型（由仓库脚本从 plan 派生，不允许手写） */
  nodeTypes: string[]
  /** 最低应用版本（semver）；缺省表示不限制 */
  appMinVersion?: string
}

/** 索引文件（`index.json`） */
export interface WorkflowMarketIndex {
  schemaVersion: number
  generatedAt?: string
  source?: { repo?: string; ref?: string }
  workflows: WorkflowMarketEntry[]
}

/** 单个工作流包（`workflows/<id>/workflow.json`） */
export interface WorkflowBundle {
  schemaVersion: number
  id: string
  title: string
  summary: string
  category: string
  version: string
  author: { name: string; url?: string }
  license: string
  /** 封面相对路径（包内）；缺省视作 `cover.png` */
  cover?: string
  /** **必填**（解析器总会填上）：兼容性判定的依据 */
  requires: WorkflowRequirement
  plan: GraphPlan
}

/** 分类枚举：与仓库 `validate.mjs` 里的集合必须一致（两侧测试共同钉住） */
export const WORKFLOW_MARKET_CATEGORIES = [
  'film',
  'ad',
  'game',
  'character',
  'comic',
  'utility'
] as const

export type WorkflowMarketCategory = (typeof WORKFLOW_MARKET_CATEGORIES)[number]

/** 索引 schema 版本（应用能读的最大版本） */
export const WORKFLOW_MARKET_SCHEMA_VERSION = 1

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[-0-9A-Za-z.]+)?(?:\+[-0-9A-Za-z.]+)?$/

/** 卡片标题里 summary 只有一行，超长会被截断成没意义的半句 */
export const WORKFLOW_SUMMARY_MAX = 60

// ─────────────────────────────────────────────────────────────
// 基础取值助手（宽容读取：脏字段一律回落，不抛错）
// ─────────────────────────────────────────────────────────────

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0
}

function asAuthor(value: unknown): { name: string; url?: string } | null {
  if (typeof value === 'string') {
    const name = value.trim()
    return name ? { name } : null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const obj = value as Record<string, unknown>
  const name = asString(obj.name)
  if (!name) return null
  const url = asString(obj.url)
  return url ? { name, url } : { name }
}

/** 归一化 `requires`；缺 `nodeTypes` 时给空数组（不当作非法，仅表示未声明） */
function asRequirement(value: unknown): WorkflowRequirement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { nodeTypes: [] }
  const obj = value as Record<string, unknown>
  const appMinVersion = asString(obj.appMinVersion)
  return {
    nodeTypes: [...new Set(asStringArray(obj.nodeTypes))].sort(),
    ...(appMinVersion ? { appMinVersion } : {})
  }
}

/**
 * 归一化索引里的一条工作流；缺关键字段（id / title / summary / version / license / author）
 * 返回 null 由调用方丢弃。
 *
 * `license` 与 `author` 是**审核底线**（缺署名的社区内容有法律灰区），所以在解析层就挡住，
 * 而不是靠界面提示。
 */
export function parseWorkflowMarketEntry(raw: unknown): WorkflowMarketEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const id = asString(obj.id)
  if (!ID_RE.test(id)) return null
  const title = asString(obj.title)
  const summary = asString(obj.summary)
  const version = asString(obj.version)
  const license = asString(obj.license)
  const author = asAuthor(obj.author)
  if (!title || !summary || !SEMVER_RE.test(version) || !license || !author) return null

  const category = asString(obj.category)
  const titleEn = asString(obj.titleEn)
  const cover = asString(obj.cover)
  const sizeBytes = asCount(obj.sizeBytes)
  return {
    id,
    title,
    ...(titleEn ? { titleEn } : {}),
    summary,
    // 未知分类不让整条作废：落到 utility，界面仍能显示（分类只是筛选维度）
    category: (WORKFLOW_MARKET_CATEGORIES as readonly string[]).includes(category)
      ? category
      : 'utility',
    tags: asStringArray(obj.tags),
    version,
    author,
    license,
    ...(cover ? { cover } : {}),
    requires: asRequirement(obj.requires),
    nodeCount: asCount(obj.nodeCount),
    edgeCount: asCount(obj.edgeCount),
    ...(sizeBytes > 0 ? { sizeBytes } : {})
  }
}

/**
 * 解析索引文件。
 *
 * 宽容读取、严格拒绝：**单条非法只丢那一条并计数**（一个坏条目不该让整个市场空白），
 * 但整体结构崩坏（不是对象 / `workflows` 不是数组 / schemaVersion 过高）则整体失败，
 * 避免半渲染出一个误导性的空市场。
 */
export function parseWorkflowMarketIndex(
  raw: unknown
): { ok: true; index: WorkflowMarketIndex; dropped: number } | { ok: false; reasonKey: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reasonKey: 'notAnObject' }
  }
  const obj = raw as Record<string, unknown>
  const schemaVersion = typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 0
  if (schemaVersion > WORKFLOW_MARKET_SCHEMA_VERSION) {
    // 新版本索引可能含本应用读不懂的字段：宁可明确报「需要更新应用」
    return { ok: false, reasonKey: 'schemaTooNew' }
  }
  if (!Array.isArray(obj.workflows)) return { ok: false, reasonKey: 'noWorkflows' }

  const seen = new Set<string>()
  const workflows: WorkflowMarketEntry[] = []
  let dropped = 0
  for (const item of obj.workflows) {
    const entry = parseWorkflowMarketEntry(item)
    // 重复 id 视为非法：会让安装目录与卡片互相覆盖
    if (!entry || seen.has(entry.id)) {
      dropped += 1
      continue
    }
    seen.add(entry.id)
    workflows.push(entry)
  }

  const source =
    obj.source && typeof obj.source === 'object' ? (obj.source as Record<string, unknown>) : null
  const generatedAt = asString(obj.generatedAt)
  return {
    ok: true,
    dropped,
    index: {
      schemaVersion: schemaVersion || WORKFLOW_MARKET_SCHEMA_VERSION,
      ...(generatedAt ? { generatedAt } : {}),
      ...(source
        ? {
            source: {
              ...(asString(source.repo) ? { repo: asString(source.repo) } : {}),
              ...(asString(source.ref) ? { ref: asString(source.ref) } : {})
            }
          }
        : {}),
      workflows
    }
  }
}

/** 解析单个工作流包；`plan` 形状不合法即整体拒绝 */
export function parseWorkflowBundle(
  raw: unknown
): { ok: true; bundle: WorkflowBundle } | { ok: false; reasonKey: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reasonKey: 'notAnObject' }
  }
  const obj = raw as Record<string, unknown>
  const schemaVersion = typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 0
  if (schemaVersion > WORKFLOW_MARKET_SCHEMA_VERSION) {
    return { ok: false, reasonKey: 'schemaTooNew' }
  }
  const id = asString(obj.id)
  if (!ID_RE.test(id)) return { ok: false, reasonKey: 'badId' }
  const title = asString(obj.title)
  const summary = asString(obj.summary)
  const version = asString(obj.version)
  const license = asString(obj.license)
  const author = asAuthor(obj.author)
  if (!title || !summary || !SEMVER_RE.test(version) || !license || !author) {
    return { ok: false, reasonKey: 'missingMeta' }
  }

  const plan = obj.plan
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return { ok: false, reasonKey: 'noPlan' }
  }
  const planObj = plan as Record<string, unknown>
  const nodes = planObj.nodes
  if (!Array.isArray(nodes) || nodes.length === 0) return { ok: false, reasonKey: 'noNodes' }
  const keys = new Set<string>()
  for (const node of nodes) {
    if (!node || typeof node !== 'object') return { ok: false, reasonKey: 'badNode' }
    const spec = node as Record<string, unknown>
    const key = asString(spec.key)
    const typeId = asString(spec.typeId)
    if (!key || !typeId) return { ok: false, reasonKey: 'badNode' }
    if (keys.has(key)) return { ok: false, reasonKey: 'duplicateNodeKey' }
    keys.add(key)
  }
  const edgesRaw = planObj.edges
  if (edgesRaw !== undefined && !Array.isArray(edgesRaw)) {
    return { ok: false, reasonKey: 'badEdges' }
  }
  for (const edge of (edgesRaw as unknown[] | undefined) ?? []) {
    if (!edge || typeof edge !== 'object') return { ok: false, reasonKey: 'badEdges' }
    const spec = edge as Record<string, unknown>
    const from = asString(spec.from)
    const to = asString(spec.to)
    // 悬空端点会让物化出残图，必须在包层就拒
    if (!from || !to || !keys.has(from) || !keys.has(to)) {
      return { ok: false, reasonKey: 'danglingEdge' }
    }
  }

  const category = asString(obj.category)
  const cover = asString(obj.cover)
  return {
    ok: true,
    bundle: {
      schemaVersion: schemaVersion || WORKFLOW_MARKET_SCHEMA_VERSION,
      id,
      title,
      summary,
      category: (WORKFLOW_MARKET_CATEGORIES as readonly string[]).includes(category)
        ? category
        : 'utility',
      version,
      author,
      license,
      ...(cover ? { cover } : {}),
      requires: asRequirement(obj.requires),
      plan: {
        ...(asString(planObj.title) ? { title: asString(planObj.title) } : {}),
        nodes: nodes as GraphPlan['nodes'],
        edges: ((edgesRaw as unknown[] | undefined) ?? []) as GraphPlan['edges']
      }
    }
  }
}

/**
 * 从 `plan` 派生「用到哪些节点类型」。
 *
 * 仓库侧 `build-index.mjs` 用同一规则生成 `requires.nodeTypes`；应用侧用它做**交叉校验**
 *（索引声称的依赖与 plan 实际用到的是否一致），两边口径必须相同。
 */
export function nodeTypesOfPlan(plan: GraphPlan): string[] {
  const set = new Set<string>()
  for (const node of plan.nodes) {
    if (node && typeof node.typeId === 'string' && node.typeId.trim()) set.add(node.typeId.trim())
  }
  return [...set].sort()
}

// ─────────────────────────────────────────────────────────────
// 兼容性判定
// ─────────────────────────────────────────────────────────────

/**
 * semver 比较（`x.y.z` + 可选 prerelease/build；不引依赖）。
 *
 * 返回 `<0` 表示 a 更旧。刻意实现 semver 的 prerelease 优先级规则，而不是图省事做字符串
 * 比较 —— 字符串比较会得出 `1.0.0-alpha < 1.0.0-1`（因为 `'a' > '1'`），而按规范**恰好相反**
 *（数字标识符优先级低于字母数字标识符）。这类反例正是「以后没人查得出来的错」。
 *
 * build 元数据（`+` 之后）按规范**不参与**比较。
 */
export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a)
  const right = parseSemver(b)
  for (let i = 0; i < 3; i += 1) {
    const l = left.core[i] ?? 0
    const r = right.core[i] ?? 0
    if (l !== r) return l < r ? -1 : 1
  }
  return comparePrerelease(left.pre, right.pre)
}

function parseSemver(value: string): { core: number[]; pre: string[] } {
  // 先剥 build（`+` 之后一律不参与比较），再拆 prerelease
  const withoutBuild = value.split('+')[0] ?? ''
  const dash = withoutBuild.indexOf('-')
  const coreText = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash)
  const preText = dash === -1 ? '' : withoutBuild.slice(dash + 1)
  const core = coreText.split('.').map((part) => {
    const n = Number.parseInt(part, 10)
    return Number.isFinite(n) ? n : 0
  })
  return { core, pre: preText ? preText.split('.') : [] }
}

/** prerelease 优先级：无 prerelease > 有；逐标识符比较，数字 < 字母数字，数字按数值比 */
function comparePrerelease(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0) return 1 // a 是正式版
  if (b.length === 0) return -1
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i += 1) {
    const l = a[i]
    const r = b[i]
    // 标识符少的优先级更低
    if (l === undefined) return -1
    if (r === undefined) return 1
    if (l === r) continue
    const lNum = /^\d+$/.test(l)
    const rNum = /^\d+$/.test(r)
    if (lNum && rNum) return Number(l) < Number(r) ? -1 : 1
    // 数字标识符优先级低于字母数字标识符
    if (lNum) return -1
    if (rNum) return 1
    return l < r ? -1 : 1
  }
  return 0
}

/** 本条目是否可安装/可使用；不可用时给出**可翻译**的原因键 */
export function workflowEntryBlockReason(
  entry: Pick<WorkflowMarketEntry, 'requires'>,
  context: { knownNodeTypes: readonly string[]; appVersion: string }
): string | null {
  const missing = missingNodeTypes(entry, context.knownNodeTypes)
  if (missing.length > 0) return 'missingNodeTypes'
  if (
    entry.requires.appMinVersion &&
    compareSemver(context.appVersion, entry.requires.appMinVersion) < 0
  ) {
    return 'appTooOld'
  }
  return null
}

/** 该工作流引用了哪些本应用**没有**的节点类型（排序去重） */
export function missingNodeTypes(
  entry: Pick<WorkflowMarketEntry, 'requires'>,
  knownNodeTypes: readonly string[]
): string[] {
  const known = new Set(knownNodeTypes)
  return entry.requires.nodeTypes.filter((typeId) => !known.has(typeId)).sort()
}

/** 分类 → i18n 键（分类文案只在 locale 里） */
export function workflowCategoryKey(category: string): string {
  const known = (WORKFLOW_MARKET_CATEGORIES as readonly string[]).includes(category)
  return `marketplace.workflows.category.${known ? category : 'utility'}`
}

/** 数据源地址 → 索引与包的地址（与仓库目录结构绑定，集中一处便于将来换结构） */
export function workflowMarketUrls(source: string): {
  index: string
  bundle: (id: string) => string
  cover: (entry: Pick<WorkflowMarketEntry, 'id' | 'cover'>) => string | null
} {
  const base = source.replace(/\/+$/, '')
  return {
    index: `${base}/index.json`,
    bundle: (id: string) => `${base}/workflows/${id}/workflow.json`,
    cover: (entry) => (entry.cover ? `${base}/workflows/${entry.id}/${entry.cover}` : null)
  }
}

/**
 * 官方主源与镜像，**按尝试顺序**排列。
 *
 * 为什么需要镜像：`raw.githubusercontent.com` 在部分网络下不可达，而市场打不开这件事
 * 对用户来说和「市场是空的」没有区别。Gitee 的 raw 地址在同类网络下通常可用。
 *
 * 两个仓库的内容必须保持一致（逐字节）—— 不一致会造成「同一版本号、不同内容」，
 * 这是最难排查的一类状态。同步方式见仓库 README。
 */
export const WORKFLOW_MARKET_SOURCES: readonly string[] = [
  'https://raw.githubusercontent.com/Justin-sky/ai-art-engine-workflow/main',
  'https://gitee.com/beijing_blue_whale_era_zhangjian/ai-art-engine-workflow/raw/main'
]

/** 默认数据源（未配置时用主源） */
export const DEFAULT_WORKFLOW_MARKET_SOURCE = WORKFLOW_MARKET_SOURCES[0]!

/**
 * 解析候选数据源。
 *
 * `configured` 可以填**一个或多个**地址（空白 / 换行 / 逗号分隔），按填写顺序依次尝试 ——
 * 于是「自建主源 + 官方镜像」这种组合不需要额外机制。
 * 留空则用官方主源 + 镜像。
 *
 * 显式配置时**只**用配置的地址，不偷偷混入官方源：用户写死了一个源，就应该只打那一个，
 * 否则排查「为什么内容不对」时会被意料之外的回退误导。
 */
export function resolveWorkflowMarketSources(configured: string): string[] {
  const parts = configured
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
  return parts.length > 0 ? parts : [...WORKFLOW_MARKET_SOURCES]
}

/** 把一串地址归一到「主地址」（用于界面展示当前使用的是哪个源） */
export function workflowMarketSourceLabel(source: string): string {
  if (source === WORKFLOW_MARKET_SOURCES[0]) return 'github'
  if (source === WORKFLOW_MARKET_SOURCES[1]) return 'gitee'
  return 'custom'
}
