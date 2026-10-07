/**
 * 「导出为市场工作流」的**纯逻辑**：画布图 → `GraphPlan` → 可发布的 `workflow.json`。
 *
 * ## 为什么要有这一层
 *
 * 工作流市场（`ai-art-engine-workflow`）的官方那 15 条由 `npm run export:market` 从内置预设
 * 生成，而**第三方工作流只能手写 `plan`** —— 市场仓库的 CONTRIBUTING 把这条记成了已知门槛。
 * 本模块把「画布 → plan」这一步做成纯函数：没有 Electron、没有文件系统，
 * 于是它既能被主进程调用，也能被单测直接跑。
 *
 * ## 与物化（`materializeGraphPlan`）的对称性
 *
 * 导出是物化的逆向，两边必须**同一口径**，否则「导出的包在别人机器上装不出同一张图」：
 *
 * - 可建节点类型：`listAddableNodeTypes(MCP_GRAPH_EDIT_SCOPE)` —— 与 MCP 的 `graph_node_types`
 *   清单工具、`graph_edit` 的白名单、以及 `materializeGraphPlan` 完全同源；
 * - 参数白名单：`isAllowedPlanParamKey` + `declaredParamKeys`（`shared/graph/graphPlan`），
 *   不在别处再抄一份；
 * - `requires.nodeTypes`：`nodeTypesOfPlan`（`shared/workflowMarket`），与市场仓库
 *   `scripts/validate.mjs` 同口径。
 *
 * ## 最要紧的一条：不把「上次运行的产物」当成工作流内容
 *
 * 活文档的 `node.params` 里混着运行时写回字段：`generatedImages`（上次出的图）、
 * `animGifRelativePath` / `animGifFrameCount`（上次合成的 GIF）、`animGridImage`、
 * `episodeReviewStatus` … 它们**既不在 `defaultParams()` 里，也不在 `ALLOWED_PARAM_KEYS` 里**，
 * 所以「只保留节点类型声明的参数」这条规则会自然把它们滤掉 —— 不需要、也不允许
 * 手工维护一份黑名单（黑名单一定会漏：每加一个写回字段就要记得同步一次）。
 *
 * 另有一类**声明过但换台机器就没意义**的参数：以 `AssetId` 结尾的键（`animAssetId` /
 * `uiSplitAssetId` / `poseSourceAssetId` …）存的是本工程内的资产 GUID，导出包里带上它就是
 * 悬空引用（见 `isLocalAssetRefParamKey`）。同样按键名形态判定，不上黑名单。
 */

import { AI_WORKFLOW_PRESET_IDS } from './graph/aiWorkflowPresets'
import {
  declaredParamKeys,
  isAllowedPlanParamKey,
  type GraphPlan,
  type GraphPlanEdgeSpec,
  type GraphPlanNodeSpec
} from './graph/graphPlan'
import { MCP_GRAPH_EDIT_SCOPE } from './graph/mcpGraphEdit'
import { canConnectNodes } from './graph/ports'
import { listAddableNodeTypes, resolveNodeType, type NodeTypeDefinition } from './graph/registry'
import type { GraphAddScope } from './graph/scopes'
import type { GraphDocument, GraphNode, GraphNodeParams } from './graph/types'
import {
  nodeTypesOfPlan,
  WORKFLOW_MARKET_CATEGORIES,
  WORKFLOW_MARKET_SCHEMA_VERSION,
  WORKFLOW_SUMMARY_MAX,
  type WorkflowMarketCategory
} from './workflowMarket'

/** 市场仓库里封面图的固定文件名（`validate.mjs` 缺它即判「缺少封面」） */
export const WORKFLOW_EXPORT_COVER_FILE_NAME = 'cover.png'

/**
 * 市场校验器的上限（与 `ai-art-engine-workflow/scripts/validate.mjs` 的 `LIMITS` 对齐）。
 * 抄在这里是为了**导出前**就给出 warning，而不是等用户推到市场被 CI 拒。
 */
export const WORKFLOW_EXPORT_LIMITS = {
  summaryMax: WORKFLOW_SUMMARY_MAX,
  coverMaxBytes: 300 * 1024,
  nodesMax: 200,
  paramTextMax: 20_000
} as const

/** 封面建议尺寸（CONTRIBUTING 的硬要求；校验器只查存在与体积，所以这里只给 warning） */
export const WORKFLOW_EXPORT_COVER_SIZE = { width: 800, height: 450 } as const

/** 市场工作流 id 的长度上限：它同时是目录名与会话里的标识，过长在 Windows 上会踩路径长度 */
export const WORKFLOW_EXPORT_ID_MAX = 64

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[-0-9A-Za-z.]+)?(?:\+[-0-9A-Za-z.]+)?$/

/** 一条可翻译的提示：`reasonKey` 由渲染层拼成 i18n 键（主进程不产出成品文案） */
export interface WorkflowExportNote {
  reasonKey: string
  params?: Record<string, string | number>
}

/** 校验失败：`reasonKey` + 插值参数 */
export interface WorkflowExportReason {
  reasonKey: string
  params?: Record<string, string | number>
}

export type WorkflowExportValidation = { ok: true } | ({ ok: false } & WorkflowExportReason)

// ─────────────────────────────────────────────────────────────
// id 校验（含「与内置预设重名」的拒绝）
// ─────────────────────────────────────────────────────────────

/** 预设 id（camelCase）→ 市场 id / 目录名（kebab-case），与 `scripts/export-market-workflows.mjs` 同一口径 */
export function workflowMarketIdOfPreset(presetId: string): string {
  return presetId.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)
}

/**
 * 已占用的市场 id：内置「一键工作流」预设（`custom` 不是一条具体工作流，排除）。
 *
 * 这些 id 对应的市场文件是**导出产物**（`npm run export:market` 只写 `plan` 与
 * `requires.nodeTypes`）。用同名 id 再导一次会让同一个 id 有两个来源，
 * 而失败形态恰恰是两边都不报错（详见 docs/MARKETPLACE.md §2.0）。
 */
export const RESERVED_WORKFLOW_EXPORT_IDS: readonly string[] = AI_WORKFLOW_PRESET_IDS.filter(
  (id) => id !== 'custom'
).map(workflowMarketIdOfPreset)

/**
 * 校验市场工作流 id：kebab-case、长度受限，且**不得与内置预设的市场 id 撞名**。
 *
 * 撞名的处理方式是「改 id」而不是「允许覆盖」：官方工作流的 plan 由内置预设生成，
 * 想改那 15 条工作流的图要改 `src/shared/graph/aiWorkflowPresets.ts` 再导出。
 */
export function validateExportWorkflowId(id: string): WorkflowExportValidation {
  const value = (id ?? '').trim()
  if (!value) return { ok: false, reasonKey: 'idRequired' }
  if (value.length > WORKFLOW_EXPORT_ID_MAX) {
    return { ok: false, reasonKey: 'idTooLong', params: { max: WORKFLOW_EXPORT_ID_MAX } }
  }
  if (!ID_RE.test(value)) return { ok: false, reasonKey: 'idFormat' }
  if (RESERVED_WORKFLOW_EXPORT_IDS.includes(value)) {
    return { ok: false, reasonKey: 'idPresetReserved', params: { presetId: value } }
  }
  return { ok: true }
}

// ─────────────────────────────────────────────────────────────
// 元数据（表单 → 可落盘的归一化形态）
// ─────────────────────────────────────────────────────────────

/** 渲染层表单提交的原始值（宽容：字段缺失 / tags 是一整串都行） */
export interface WorkflowExportMetaInput {
  id: string
  title: string
  titleEn?: string
  summary: string
  category: string
  /** 逗号 / 空白分隔的一整串，或已拆好的数组 */
  tags?: string[] | string
  version: string
  authorName: string
  authorUrl?: string
  license: string
}

/** 归一化后的元数据（`workflow.json` 里除 plan / requires 之外的那部分） */
export interface WorkflowExportMeta {
  id: string
  title: string
  titleEn?: string
  summary: string
  category: WorkflowMarketCategory
  tags: string[]
  version: string
  author: { name: string; url?: string }
  license: string
}

/** 标签：按 ASCII 逗号 / 空白拆分，去空去重（中文标点交给界面在提交前替换，见对话框） */
export function normalizeWorkflowTags(raw: string[] | string | undefined): string[] {
  const list = Array.isArray(raw) ? raw : (raw ?? '').split(/[,\s]+/)
  const seen = new Set<string>()
  for (const item of list) {
    const value = (item ?? '').trim()
    if (value) seen.add(value)
  }
  return [...seen]
}

/** 校验并归一化表单元数据；失败返回可翻译的 reasonKey（界面用它做行内校验） */
export function normalizeWorkflowExportMeta(
  input: WorkflowExportMetaInput
): { ok: true; meta: WorkflowExportMeta } | ({ ok: false } & WorkflowExportReason) {
  const idCheck = validateExportWorkflowId(input?.id ?? '')
  if (!idCheck.ok) return idCheck

  const title = (input?.title ?? '').trim()
  if (!title) return { ok: false, reasonKey: 'titleRequired' }

  const summary = (input?.summary ?? '').trim()
  if (!summary) return { ok: false, reasonKey: 'summaryRequired' }
  if (summary.length > WORKFLOW_EXPORT_LIMITS.summaryMax) {
    return {
      ok: false,
      reasonKey: 'summaryTooLong',
      params: { max: WORKFLOW_EXPORT_LIMITS.summaryMax }
    }
  }

  const category = (input?.category ?? '').trim()
  if (!(WORKFLOW_MARKET_CATEGORIES as readonly string[]).includes(category)) {
    return {
      ok: false,
      reasonKey: 'categoryInvalid',
      params: { categories: WORKFLOW_MARKET_CATEGORIES.join(' / ') }
    }
  }

  const version = (input?.version ?? '').trim()
  if (!SEMVER_RE.test(version)) return { ok: false, reasonKey: 'versionInvalid' }

  const authorName = (input?.authorName ?? '').trim()
  if (!authorName) return { ok: false, reasonKey: 'authorRequired' }

  const license = (input?.license ?? '').trim()
  if (!license) return { ok: false, reasonKey: 'licenseRequired' }

  const titleEn = (input?.titleEn ?? '').trim()
  const authorUrl = (input?.authorUrl ?? '').trim()
  return {
    ok: true,
    meta: {
      id: (input?.id ?? '').trim(),
      title,
      ...(titleEn ? { titleEn } : {}),
      summary,
      category: category as WorkflowMarketCategory,
      tags: normalizeWorkflowTags(input?.tags),
      version,
      author: { name: authorName, ...(authorUrl ? { url: authorUrl } : {}) },
      license
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 画布图 → GraphPlan
// ─────────────────────────────────────────────────────────────

export interface DocumentToPlanOptions {
  /** 计划标题（通常是资产名）；缺省不写 title */
  title?: string
  /**
   * 可建节点类型的作用域；缺省与 MCP `graph_node_types` / `graph_edit` 同一个作用域
   * （也就是市场工作流物化时用的那一个）。
   */
  scope?: GraphAddScope
}

/** 节点被跳过的原因：类型不可建（含边界 / 输出节点），或自带本工程内的宿主引用 */
export type PlanSkippedNodeReason = 'unavailable' | 'hostBound'

export interface PlanExportDiagnostics {
  skippedNodes: Array<{ nodeId: string; typeId: string; reason: PlanSkippedNodeReason }>
  /** 被丢掉的未声明参数键（去重排序），多为运行时写回字段 */
  droppedParamKeys: string[]
  /** 被丢掉的「指向本工程资产」的参数键（去重排序） */
  localRefParamKeys: string[]
  /** 被丢掉的连线数（端点被跳过 / 端口不兼容） */
  droppedEdges: number
}

export interface PlanExportReport {
  plan: GraphPlan
  /** 可直接交给界面的提示（按 reasonKey 归类，渲染层出文案） */
  warnings: WorkflowExportNote[]
  /** 明细（测试与日志用；不进 UI） */
  diagnostics: PlanExportDiagnostics
}

/** 参数值为「空」的判定：空串 / 空数组 / 空对象一律不写进发布包（落了也会回落默认值） */
function isEmptyParamValue(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length === 0
  return false
}

/**
 * 声明过、但值一定是**本工程内资产 GUID** 的参数键（`animAssetId` / `uiSplitAssetId` /
 * `poseSourceAssetId` / `animationSourceAssetId` …）。
 *
 * 这类键换个工程就是悬空引用：包带到别人机器上，运行时只会表现为「莫名其妙走了兜底分支」。
 * 按**键名形态**（`*AssetId`）判定，而不是列一张黑名单 —— 将来新增同类参数会自动被排除，
 * 不需要有人记得回来改这里（黑名单一定会漏）。
 */
export function isLocalAssetRefParamKey(key: string): boolean {
  return /AssetId$/.test(key)
}

export interface FilteredExportParams {
  params: Record<string, unknown>
  /** 未声明过的键（多为运行时写回字段） */
  dropped: string[]
  /** 声明过但指向本工程资产的键 */
  localRefs: string[]
}

/**
 * 过滤节点参数：只保留「该类型声明过的」与全局通用生成参数，丢掉空值与跨工程无意义的引用。
 * 被丢弃的键**如实上报**——静默丢弃会让导出包悄悄缺内容。
 */
export function filterExportParams(
  raw: GraphNodeParams | undefined,
  def: NodeTypeDefinition
): FilteredExportParams {
  const declared = declaredParamKeys(def)
  const params: Record<string, unknown> = {}
  const dropped: string[] = []
  const localRefs: string[] = []
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (!isAllowedPlanParamKey(key, declared)) {
      dropped.push(key)
      continue
    }
    if (isLocalAssetRefParamKey(key) && !isEmptyParamValue(value)) {
      localRefs.push(key)
      continue
    }
    if (isEmptyParamValue(value)) continue
    params[key] = value
  }
  return { params, dropped, localRefs }
}

/** key 主干：typeId 的最后一段（`asset.image` → `image`）；纯数字段回退到首段拼前缀（`anim.2d` → `anim2d`） */
export function planKeyStem(typeId: string): string {
  const segments = typeId.split('.').filter(Boolean)
  const strip = (value: string): string => value.replace(/[^A-Za-z0-9]/g, '')
  const last = strip(segments[segments.length - 1] ?? '')
  if (/^[A-Za-z]/.test(last)) return last
  const first = strip(segments[0] ?? '')
  return `${first}${last}` || 'node'
}

/** 同一主干内递增编号；真正撞上了再退避（`image1` / `image2` / …） */
function uniquePlanKey(stem: string, used: Set<string>): string {
  let index = 1
  let key = `${stem}${index}`
  while (used.has(key)) {
    index += 1
    key = `${stem}${index}`
  }
  used.add(key)
  return key
}

/**
 * 节点是否「自带本工程内的引用」。
 *
 * 宿主实例（`params.assetHost`）指向的是**本工程里的另一个资产**，接口快照
 * （`hostInterfaceSnapshot`）与边界代理（`hostBoundaryPort` / `hostInputSlot`）同理。
 * 这些字段既不在 `defaultParams` 也不在公共白名单里 —— 导出后节点会变成空壳，
 * 所以直接跳过并上报，而不是发布一张看起来正常、装上却缺内容的图。
 */
function isHostBoundNode(node: GraphNode): boolean {
  const params = (node.params ?? {}) as Record<string, unknown>
  return (
    params.assetHost === true ||
    !!params.hostInterfaceSnapshot ||
    !!params.hostBoundaryPort ||
    !!params.hostInputSlot
  )
}

/** 节点真实类型 id（缺失时按 app 的口径推断），取不到返回空串 */
function exportTypeIdOf(node: GraphNode): string {
  const resolved = resolveNodeType(node)?.typeId ?? node.typeId ?? ''
  return String(resolved).trim()
}

/**
 * 画布图 → 计划 + 诊断。`documentToPlan` 是它的薄封装。
 *
 * 顺序即 key 编号顺序：同一张图每次导出得到同一组 key（稳定、可 diff）。
 */
export function documentToPlanReport(
  doc: GraphDocument | null | undefined,
  options: DocumentToPlanOptions = {}
): PlanExportReport {
  const scope = options.scope ?? MCP_GRAPH_EDIT_SCOPE
  const addable = new Map(listAddableNodeTypes(scope).map((def) => [def.typeId, def] as const))
  const sourceNodes = Array.isArray(doc?.nodes) ? doc!.nodes : []
  const sourceEdges = Array.isArray(doc?.edges) ? doc!.edges : []

  const nodes: GraphPlanNodeSpec[] = []
  const edges: GraphPlanEdgeSpec[] = []
  const keyByNodeId = new Map<string, string>()
  const exportableById = new Map<string, GraphNode>()
  const usedKeys = new Set<string>()
  const droppedParamKeys = new Set<string>()
  const localRefParamKeys = new Set<string>()
  const skippedNodes: PlanExportDiagnostics['skippedNodes'] = []

  for (const node of sourceNodes) {
    if (!node || typeof node !== 'object') continue
    const typeId = exportTypeIdOf(node)
    const def = addable.get(typeId)
    if (!def) {
      skippedNodes.push({ nodeId: node.id, typeId, reason: 'unavailable' })
      continue
    }
    if (isHostBoundNode(node)) {
      skippedNodes.push({ nodeId: node.id, typeId, reason: 'hostBound' })
      continue
    }
    const key = uniquePlanKey(planKeyStem(typeId), usedKeys)
    const { params, dropped, localRefs } = filterExportParams(node.params, def)
    for (const droppedKey of dropped) droppedParamKeys.add(droppedKey)
    for (const localRefKey of localRefs) localRefParamKeys.add(localRefKey)
    const title = (node.title ?? '').trim()
    nodes.push({
      key,
      typeId,
      ...(title ? { title } : {}),
      ...(Object.keys(params).length ? { params } : {})
    })
    keyByNodeId.set(node.id, key)
    exportableById.set(node.id, node)
  }

  let droppedEdges = 0
  for (const edge of sourceEdges) {
    if (!edge || typeof edge !== 'object') continue
    const from = keyByNodeId.get(edge.source)
    const to = keyByNodeId.get(edge.target)
    const source = exportableById.get(edge.source)
    const target = exportableById.get(edge.target)
    if (!from || !to || !source || !target) {
      droppedEdges += 1
      continue
    }
    // 端口**始终**写进计划：多出口节点（out / out-all / out-gif / out-shots…）不写端口时
    // 物化只能猜第一个兼容口，等于悄悄改接线的意图。
    const fromPort = (edge.sourcePort ?? '').trim() || 'out'
    const toPort = (edge.targetPort ?? '').trim() || 'in'
    if (!canConnectNodes(source, target, { sourcePort: fromPort, targetPort: toPort })) {
      droppedEdges += 1
      continue
    }
    edges.push({ from, to, fromPort, toPort })
  }

  const planTitle = (options.title ?? '').trim()
  const plan: GraphPlan = {
    ...(planTitle ? { title: planTitle } : {}),
    nodes,
    edges
  }

  const diagnostics: PlanExportDiagnostics = {
    skippedNodes,
    droppedParamKeys: [...droppedParamKeys].sort(),
    localRefParamKeys: [...localRefParamKeys].sort(),
    droppedEdges
  }
  return { plan, warnings: planExportWarnings(plan, diagnostics), diagnostics }
}

/** `GraphPlan` 本体（不含诊断）；导出链路里真正落盘的是它 */
export function documentToPlan(
  doc: GraphDocument | null | undefined,
  options: DocumentToPlanOptions = {}
): GraphPlan {
  return documentToPlanReport(doc, options).plan
}

/** 把诊断 + 上限检查折成界面能直接渲染的提示列表 */
export function planExportWarnings(
  plan: GraphPlan,
  diagnostics: PlanExportDiagnostics
): WorkflowExportNote[] {
  const warnings: WorkflowExportNote[] = []
  const skipped = diagnostics.skippedNodes
  if (skipped.length) {
    warnings.push({
      reasonKey: 'skippedNodes',
      params: {
        count: skipped.length,
        typeIds: [...new Set(skipped.map((item) => item.typeId || '?'))].sort().join(', ')
      }
    })
  }
  if (diagnostics.droppedParamKeys.length) {
    warnings.push({
      reasonKey: 'droppedParams',
      params: {
        count: diagnostics.droppedParamKeys.length,
        keys: diagnostics.droppedParamKeys.join(', ')
      }
    })
  }
  if (diagnostics.localRefParamKeys.length) {
    warnings.push({
      reasonKey: 'localRefParams',
      params: {
        count: diagnostics.localRefParamKeys.length,
        keys: diagnostics.localRefParamKeys.join(', ')
      }
    })
  }
  if (diagnostics.droppedEdges > 0) {
    warnings.push({ reasonKey: 'droppedEdges', params: { count: diagnostics.droppedEdges } })
  }
  if (plan.nodes.length > WORKFLOW_EXPORT_LIMITS.nodesMax) {
    warnings.push({
      reasonKey: 'tooManyNodes',
      params: { count: plan.nodes.length, max: WORKFLOW_EXPORT_LIMITS.nodesMax }
    })
  }
  const longTextParams = countLongTextParams(plan)
  if (longTextParams > 0) {
    warnings.push({
      reasonKey: 'longTextParams',
      params: { count: longTextParams, max: WORKFLOW_EXPORT_LIMITS.paramTextMax }
    })
  }
  return warnings
}

/** 超过市场校验器单参数长度上限的字符串参数个数 */
export function countLongTextParams(plan: GraphPlan): number {
  let count = 0
  for (const node of plan.nodes) {
    for (const value of Object.values(node.params ?? {})) {
      if (typeof value === 'string' && value.length > WORKFLOW_EXPORT_LIMITS.paramTextMax)
        count += 1
    }
  }
  return count
}

// ─────────────────────────────────────────────────────────────
// 市场工作流包（`workflows/<id>/workflow.json`）
// ─────────────────────────────────────────────────────────────

/**
 * 落盘的 `workflow.json` 形态（字段顺序与市场仓库里手写的那些一致：
 * 元数据 → requires → plan，便于与既有条目做纯文本 diff）。
 */
export interface MarketWorkflowFile {
  schemaVersion: number
  id: string
  title: string
  titleEn?: string
  summary: string
  category: WorkflowMarketCategory
  tags: string[]
  version: string
  author: { name: string; url?: string }
  license: string
  cover: string
  requires: { nodeTypes: string[]; appMinVersion?: string }
  plan: GraphPlan
}

/** plan 引用了调用方给出的节点类型清单之外的类型：发布这种包会被市场校验器拒 */
export class WorkflowExportUnknownTypesError extends Error {
  readonly typeIds: string[]

  constructor(typeIds: string[]) {
    super(`workflow plan references unknown node types: ${typeIds.join(', ')}`)
    this.name = 'WorkflowExportUnknownTypesError'
    this.typeIds = typeIds
  }
}

export interface MarketWorkflowBundleInput {
  meta: WorkflowExportMeta
  plan: GraphPlan
  /**
   * 本版本应用注册的节点类型清单。给了就校验 plan 只引用这些类型 ——
   * 引用未知类型会被市场校验器拒（退回原因 #7），宁可在这层拦。
   */
  nodeTypes?: readonly string[]
  /** 最低应用版本（semver）；缺省不写该字段 */
  appMinVersion?: string
}

/**
 * 组装市场期望的那份 `workflow.json` 对象。
 *
 * `requires.nodeTypes` **总是**由 `nodeTypesOfPlan(plan)` 派生（市场校验器要求它与 plan
 * 逐字一致），因此这里不会去「过滤 plan」，只会在 plan 引用了未知类型时抛错。
 */
export function buildMarketWorkflowBundle(input: MarketWorkflowBundleInput): MarketWorkflowFile {
  const { meta, plan } = input
  const nodeTypes = nodeTypesOfPlan(plan)
  if (input.nodeTypes) {
    const known = new Set(input.nodeTypes)
    const unknown = nodeTypes.filter((typeId) => !known.has(typeId))
    if (unknown.length) throw new WorkflowExportUnknownTypesError(unknown)
  }
  const appMinVersion = (input.appMinVersion ?? '').trim()
  return {
    schemaVersion: WORKFLOW_MARKET_SCHEMA_VERSION,
    id: meta.id,
    title: meta.title,
    ...(meta.titleEn ? { titleEn: meta.titleEn } : {}),
    summary: meta.summary,
    category: meta.category,
    tags: [...meta.tags],
    version: meta.version,
    author: { ...meta.author },
    license: meta.license,
    cover: WORKFLOW_EXPORT_COVER_FILE_NAME,
    requires: { nodeTypes, ...(appMinVersion ? { appMinVersion } : {}) },
    plan
  }
}

/**
 * 序列化成仓库里的文件风格：2 空格缩进、结尾换行、中文按字面量（不转 `\uXXXX`）、LF、无 BOM。
 *
 * `JSON.stringify` 本身就不转义非 ASCII，所以这里只负责缩进与结尾换行；
 * BOM 由写盘方决定（`writeFileSync(..., 'utf8')` 不写 BOM）。
 */
export function serializeWorkflowJson(bundle: MarketWorkflowFile): string {
  return `${JSON.stringify(bundle, null, 2)}\n`
}

// ─────────────────────────────────────────────────────────────
// 封面（PNG 头部读取：只查尺寸，不引入图像库）
// ─────────────────────────────────────────────────────────────

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  )
}

/**
 * 读 PNG 的宽高（只认签名 + 首个 `IHDR` chunk）。
 * 不是 PNG 或头部不全时返回 null —— 调用方据此给「建议 800×450」的软提示。
 */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null
  }
  // 长度(4) + 'IHDR'(4)，紧随签名：12..16 必须是 IHDR
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    return null
  }
  const width = readUint32BE(bytes, 16)
  const height = readUint32BE(bytes, 20)
  if (!width || !height) return null
  return { width, height }
}
