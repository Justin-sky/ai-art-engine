import { isDraftAssetId } from '@shared/domain'
import { normalizeReviewStatus } from '@shared/graph'
import {
  emptyWorldElementCatalog,
  extractWorldCatalogJsonText,
  LEGACY_WORLD_GEN_NODE_ID,
  mergeWorldCatalogPreservingReviewed,
  parseWorldElementCatalog,
  readWorldElementGraphForNode,
  readWorldElementIdFromNodeParams,
  stringifyWorldElementCatalog,
  syncWorldElementKindGraph,
  WORLD_CATALOG_FINGERPRINT_BY_NODE_KEY,
  WORLD_CATALOG_FINGERPRINT_KEY,
  withWorldElementGraphForNode,
  WORLD_ELEMENT_KINDS,
  type GraphDocument,
  type WorldElementCatalog,
  type WorldElementKind
} from '@shared/graph'
import { toPlain } from '../../utils/toPlain'
import { persistAssetRecord } from '../../composables/useAssetRecord'
import { useDraftStore } from '../../stores/drafts'
import { useProjectStore } from '../../stores/project'

/** 已成功导入的世界元素目录指纹，存在世界资产 genParams */
export const LAST_APPLIED_WORLD_CATALOG_FP_KEY = WORLD_CATALOG_FINGERPRINT_KEY

const WORLD_CATALOG_STYLE_KEY = 'worldCatalogStyle'
const WORLD_CATALOG_WORLDVIEW_KEY = 'worldCatalogWorldview'

/** 目录归属节点：未指定 / 旧版默认节点 → 资产级共享图；其它 → 按节点独立图 */
function catalogOwnerNodeId(nodeId?: string): string {
  const id = nodeId?.trim()
  return id && id !== LEGACY_WORLD_GEN_NODE_ID ? id : LEGACY_WORLD_GEN_NODE_ID
}

function readWorldAssetGraph(worldAssetId: string): GraphDocument | null {
  const project = useProjectStore()
  if (isDraftAssetId(worldAssetId)) {
    const draft = useDraftStore().getDraft(worldAssetId)
    const raw = draft?.genParams?.graphJson
    return raw && typeof raw === 'object' ? (raw as GraphDocument) : null
  }
  const asset = project.assets.find((item) => item.id === worldAssetId)
  const raw = asset?.genParams?.graphJson
  return raw && typeof raw === 'object' ? (raw as GraphDocument) : null
}

function readWorldGenParams(worldAssetId: string): Record<string, unknown> | undefined {
  if (isDraftAssetId(worldAssetId)) {
    return useDraftStore().getDraft(worldAssetId)?.genParams
  }
  return useProjectStore().assets.find((item) => item.id === worldAssetId)?.genParams as
    | Record<string, unknown>
    | undefined
}

function graphTopologyKey(doc: GraphDocument | null | undefined): string {
  if (!doc) return ''
  const nodes = doc.nodes
    .map((node) => {
      const elementId = readWorldElementIdFromNodeParams(node.params) ?? ''
      const text = typeof node.params?.text === 'string' ? node.params.text : ''
      const instruction =
        typeof node.params?.generateInstruction === 'string' ? node.params.generateInstruction : ''
      return `${node.id}:${node.typeId}:${elementId}:${node.title ?? ''}:${text}:${instruction}`
    })
    .sort()
    .join('|')
  const edges = doc.edges
    .map(
      (edge) =>
        `${edge.source}:${edge.sourcePort ?? 'out'}->${edge.target}:${edge.targetPort ?? 'in'}`
    )
    .sort()
    .join('|')
  return `${nodes}#${edges}`
}

/** 从四类子图还原可编辑目录（按 worldElementId 聚合，避免 script/gen/out 重复） */
export function catalogFromWorldGenParams(
  genParams?: Record<string, unknown> | null,
  nodeId?: string
): WorldElementCatalog {
  const catalog = emptyWorldElementCatalog()
  catalog.style = typeof genParams?.[WORLD_CATALOG_STYLE_KEY] === 'string'
    ? (genParams[WORLD_CATALOG_STYLE_KEY] as string)
    : ''
  catalog.worldview = typeof genParams?.[WORLD_CATALOG_WORLDVIEW_KEY] === 'string'
    ? (genParams[WORLD_CATALOG_WORLDVIEW_KEY] as string)
    : ''
  for (const kind of WORLD_ELEMENT_KINDS) {
    const doc = readWorldElementGraphForNode(genParams, catalogOwnerNodeId(nodeId), kind)
    if (!doc?.nodes?.length) continue
    const byId = new Map<
      string,
  { id: string; name: string; prompt: string; status: ReturnType<typeof normalizeReviewStatus> }
    >()
    for (const node of doc.nodes) {
      const id = readWorldElementIdFromNodeParams(node.params)
      if (!id) continue
      const prev = byId.get(id) ?? {
        id,
        name: id,
        prompt: '',
  status: normalizeReviewStatus(undefined)
      }
      if (node.typeId === 'play.script') {
        prev.prompt = node.params.text?.trim() || ''
        if (node.title?.trim()) prev.name = node.title.trim()
      } else if (node.typeId === 'asset.image') {
        if (node.title?.trim()) prev.name = node.title.trim()
  prev.status = normalizeReviewStatus(node.params.reviewStatus)
      } else if (node.typeId === 'output.image') {
        if (!prev.name || prev.name === id) {
          const title = node.title?.trim()
          if (title) prev.name = title
        }
      }
      byId.set(id, prev)
    }
    catalog[kind].push(...byId.values())
  }
  return catalog
}

export function loadWorldCatalog(worldAssetId: string, nodeId?: string): WorldElementCatalog {
  const fromGraphs = catalogFromWorldGenParams(readWorldGenParams(worldAssetId), nodeId)
  const total = WORLD_ELEMENT_KINDS.reduce((sum, kind) => sum + fromGraphs[kind].length, 0)
  const jsonCatalog = parseWorldElementCatalog(
    extractWorldCatalogJsonText(readWorldAssetGraph(worldAssetId))
  )
  if (total > 0 || fromGraphs.style?.trim() || fromGraphs.worldview?.trim()) {
    // 元素子图存在时，genParams 可能还没写入新的 style/worldview；
    // 从世界元素提取节点的 JSON 文本补齐，避免表格打开后两个设定为空。
    if (!fromGraphs.style?.trim()) fromGraphs.style = jsonCatalog?.style ?? ''
    if (!fromGraphs.worldview?.trim()) fromGraphs.worldview = jsonCatalog?.worldview ?? ''
    return fromGraphs
  }
  return jsonCatalog ?? emptyWorldElementCatalog()
}

async function writeWorldGenParams(
  worldAssetId: string,
  genParams: Record<string, unknown>
): Promise<void> {
  if (isDraftAssetId(worldAssetId)) {
    useDraftStore().updateDraft(worldAssetId, { genParams })
    return
  }
  // persistAssetRecord 已用 updateAsset 回写并更新本地 assets，无需再 listAssets
  await persistAssetRecord(worldAssetId, { genParams })
}

function readLastAppliedFingerprint(worldAssetId: string, nodeId?: string): string | null {
  const genParams = readWorldGenParams(worldAssetId)
  const owner = catalogOwnerNodeId(nodeId)
  if (owner !== LEGACY_WORLD_GEN_NODE_ID) {
    const byNode = genParams?.[WORLD_CATALOG_FINGERPRINT_BY_NODE_KEY]
    if (byNode && typeof byNode === 'object') {
      const raw = (byNode as Record<string, unknown>)[owner]
      if (typeof raw === 'string' && raw) return raw
    }
    return null
  }
  const raw = genParams?.[LAST_APPLIED_WORLD_CATALOG_FP_KEY]
  return typeof raw === 'string' && raw ? raw : null
}

async function persistCatalog(
  worldAssetId: string,
  catalog: WorldElementCatalog,
  fingerprint: string,
  nodeId?: string
): Promise<number> {
  let genParams = { ...(readWorldGenParams(worldAssetId) ?? {}) }
  let changed = false
  const owner = catalogOwnerNodeId(nodeId)

  for (const kind of WORLD_ELEMENT_KINDS) {
    const prev = readWorldElementGraphForNode(genParams, owner, kind)
    const next = syncWorldElementKindGraph(prev, catalog[kind], {
      style: catalog.style,
      worldview: catalog.worldview
    })
    if (graphTopologyKey(prev) !== graphTopologyKey(next)) {
      genParams = withWorldElementGraphForNode(genParams, owner, kind, toPlain(next) as GraphDocument)
      changed = true
    }
  }

  const nextStyle = catalog.style?.trim() ?? ''
  const nextWorldview = catalog.worldview?.trim() ?? ''
  if ((genParams[WORLD_CATALOG_STYLE_KEY] ?? '') !== nextStyle) {
    genParams = { ...genParams, [WORLD_CATALOG_STYLE_KEY]: nextStyle }
    changed = true
  }
  if ((genParams[WORLD_CATALOG_WORLDVIEW_KEY] ?? '') !== nextWorldview) {
    genParams = { ...genParams, [WORLD_CATALOG_WORLDVIEW_KEY]: nextWorldview }
    changed = true
  }

  if (readLastAppliedFingerprint(worldAssetId, owner) !== fingerprint) {
    if (owner !== LEGACY_WORLD_GEN_NODE_ID) {
      const byNode =
        genParams[WORLD_CATALOG_FINGERPRINT_BY_NODE_KEY] &&
        typeof genParams[WORLD_CATALOG_FINGERPRINT_BY_NODE_KEY] === 'object'
          ? { ...(genParams[WORLD_CATALOG_FINGERPRINT_BY_NODE_KEY] as Record<string, unknown>) }
          : {}
      genParams = {
        ...genParams,
        [WORLD_CATALOG_FINGERPRINT_BY_NODE_KEY]: {
          ...byNode,
          [owner]: fingerprint
        }
      }
    } else {
      genParams = {
        ...genParams,
        [LAST_APPLIED_WORLD_CATALOG_FP_KEY]: fingerprint
      }
    }
    changed = true
  }

  if (changed) {
    await writeWorldGenParams(worldAssetId, genParams)
  }
  return WORLD_ELEMENT_KINDS.reduce((sum, kind) => sum + catalog[kind].length, 0)
}

/** 表格编辑落盘：同步目录到四类子图（补齐图片生成 + 图片输出）；拓扑未变则跳过写盘 */
export async function saveWorldCatalog(
  worldAssetId: string,
  catalog: WorldElementCatalog,
  nodeId?: string
): Promise<number> {
  return persistCatalog(worldAssetId, catalog, stringifyWorldElementCatalog(catalog), nodeId)
}

/**
 * 将世界元素目录 JSON 同步到四类 elementWorkflow 图
 *（为每条目录创建/更新：play.script → asset.image → boundary.output）。
 * 在表格/生成节点执行、以及打开世界元素生成侧栏时调用。
 */
export async function applyWorldCatalog(
  worldAssetId: string,
  jsonText?: string | null,
  nodeId?: string
): Promise<number> {
  const owner = catalogOwnerNodeId(nodeId)
  // 新节点的子图必须由它自己的目录导入（运行/上游）填充，打开编辑视图不自动播种画布级目录
  if (owner !== LEGACY_WORLD_GEN_NODE_ID && !jsonText?.trim()) {
    return 0
  }
  const text = jsonText?.trim() || extractWorldCatalogJsonText(readWorldAssetGraph(worldAssetId))
  const parsed = parseWorldElementCatalog(text)
  if (!parsed) return 0

  const existing = catalogFromWorldGenParams(readWorldGenParams(worldAssetId), owner)
  const catalog =
    mergeWorldCatalogPreservingReviewed(existing, parsed) ?? parsed

  const fingerprint = stringifyWorldElementCatalog(catalog)
  return persistCatalog(worldAssetId, catalog, fingerprint, owner)
}

export type { WorldElementCatalog, WorldElementKind }
