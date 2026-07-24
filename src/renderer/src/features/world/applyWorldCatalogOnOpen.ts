import { isDraftAssetId, normalizeShotReviewStatus } from '@shared/domain'
import {
  createNodeFromType,
  emptyWorldElementCatalog,
  extractWorldCatalogJsonText,
  mergeWorldCatalogPreservingReviewed,
  normalizeScopedGraph,
  parseWorldElementCatalog,
  readWorldElementGraphFromGenParams,
  readWorldElementIdFromNodeParams,
  stringifyWorldElementCatalog,
  withWorldElementGraph,
  WORLD_ELEMENT_KINDS,
  type GraphDocument,
  type GraphNode,
  type WorldElementCatalog,
  type WorldElementItem,
  type WorldElementKind
} from '@shared/graph'
import { toPlain } from '../../utils/toPlain'
import { persistAssetRecord } from '../../composables/useAssetRecord'
import { useDraftStore } from '../../stores/drafts'
import { useProjectStore } from '../../stores/project'

/** 已成功导入的世界元素目录指纹，存在世界资产 genParams */
export const LAST_APPLIED_WORLD_CATALOG_FP_KEY = 'lastAppliedWorldCatalogFingerprint'

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

function syncKindGraph(
  existing: GraphDocument | null | undefined,
  items: WorldElementItem[]
): GraphDocument {
  const doc = normalizeScopedGraph('elementWorkflow', existing ?? null, {
    assetType: 'world'
  })
  const managed = new Map<string, GraphNode>()
  for (const node of doc.nodes) {
    const id = readWorldElementIdFromNodeParams(node.params)
    if (id) managed.set(id, node)
  }

  const keepIds = new Set(items.map((item) => item.id))
  const nextNodes: GraphNode[] = doc.nodes.filter((node) => {
    const id = readWorldElementIdFromNodeParams(node.params)
    if (!id) return true
    return keepIds.has(id)
  })

  let col = 0
  let row = 0
  const COLS = 3
  const GAP_X = 200
  const GAP_Y = 160
  const ORIGIN_X = 80
  const ORIGIN_Y = 80

  for (const item of items) {
    const found = managed.get(item.id)
    if (found) {
      const idx = nextNodes.findIndex((n) => n.id === found.id)
      if (idx >= 0) {
        nextNodes[idx] = {
          ...nextNodes[idx]!,
          title: item.name,
          params: {
            ...nextNodes[idx]!.params,
            worldElementId: item.id,
            generateInstruction: item.prompt,
            reviewStatus: normalizeShotReviewStatus(item.status)
          }
        }
      }
      continue
    }
    const position = {
      x: ORIGIN_X + col * GAP_X,
      y: ORIGIN_Y + row * GAP_Y
    }
    col += 1
    if (col >= COLS) {
      col = 0
      row += 1
    }
    nextNodes.push(
      createNodeFromType('asset.image', position, {
        title: item.name,
        params: {
          worldElementId: item.id,
          generateInstruction: item.prompt,
          reviewStatus: normalizeShotReviewStatus(item.status)
        }
      })
    )
  }

  return {
    ...doc,
    nodes: nextNodes
  }
}

function readLastAppliedFingerprint(worldAssetId: string): string | null {
  const raw = readWorldGenParams(worldAssetId)?.[LAST_APPLIED_WORLD_CATALOG_FP_KEY]
  return typeof raw === 'string' && raw ? raw : null
}

/** 从四类子图还原可编辑目录 */
export function catalogFromWorldGenParams(
  genParams?: Record<string, unknown> | null
): WorldElementCatalog {
  const catalog = emptyWorldElementCatalog()
  for (const kind of WORLD_ELEMENT_KINDS) {
    const doc = readWorldElementGraphFromGenParams(genParams, kind)
    if (!doc?.nodes?.length) continue
    for (const node of doc.nodes) {
      const id = readWorldElementIdFromNodeParams(node.params)
      if (!id) continue
      catalog[kind].push({
        id,
        name: node.title?.trim() || id,
        prompt: node.params.generateInstruction?.trim() || '',
        status: normalizeShotReviewStatus(node.params.reviewStatus)
      })
    }
  }
  return catalog
}

export function loadWorldCatalog(worldAssetId: string): WorldElementCatalog {
  const fromGraphs = catalogFromWorldGenParams(readWorldGenParams(worldAssetId))
  const total = WORLD_ELEMENT_KINDS.reduce((sum, kind) => sum + fromGraphs[kind].length, 0)
  if (total > 0) return fromGraphs
  return (
    parseWorldElementCatalog(extractWorldCatalogJsonText(readWorldAssetGraph(worldAssetId))) ??
    emptyWorldElementCatalog()
  )
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

async function persistCatalog(
  worldAssetId: string,
  catalog: WorldElementCatalog,
  fingerprint: string
): Promise<number> {
  if (readLastAppliedFingerprint(worldAssetId) === fingerprint) {
    return WORLD_ELEMENT_KINDS.reduce((sum, kind) => sum + catalog[kind].length, 0)
  }
  let genParams = { ...(readWorldGenParams(worldAssetId) ?? {}) }
  for (const kind of WORLD_ELEMENT_KINDS) {
    const prev = readWorldElementGraphFromGenParams(genParams, kind)
    const next = syncKindGraph(prev, catalog[kind])
    genParams = withWorldElementGraph(genParams, kind, toPlain(next) as GraphDocument)
  }
  genParams = {
    ...genParams,
    [LAST_APPLIED_WORLD_CATALOG_FP_KEY]: fingerprint
  }
  await writeWorldGenParams(worldAssetId, genParams)
  return WORLD_ELEMENT_KINDS.reduce((sum, kind) => sum + catalog[kind].length, 0)
}

/** 表格编辑落盘：同步目录到四类子图；指纹未变则跳过写盘 */
export async function saveWorldCatalog(
  worldAssetId: string,
  catalog: WorldElementCatalog
): Promise<number> {
  return persistCatalog(worldAssetId, catalog, stringifyWorldElementCatalog(catalog))
}

/**
 * 将世界元素目录 JSON 同步到四类 elementWorkflow 图。
 * 仅应在「世界元素表格 / 编辑」节点执行时调用；打开窗口不再导入。
 */
export async function applyWorldCatalog(
  worldAssetId: string,
  jsonText?: string | null
): Promise<number> {
  const text = jsonText?.trim() || extractWorldCatalogJsonText(readWorldAssetGraph(worldAssetId))
  const parsed = parseWorldElementCatalog(text)
  if (!parsed) return 0

  const existing = catalogFromWorldGenParams(readWorldGenParams(worldAssetId))
  const catalog =
    mergeWorldCatalogPreservingReviewed(existing, parsed) ?? parsed

  const fingerprint = stringifyWorldElementCatalog(catalog)
  if (readLastAppliedFingerprint(worldAssetId) === fingerprint) return 0

  return persistCatalog(worldAssetId, catalog, fingerprint)
}

export type { WorldElementCatalog, WorldElementKind }
