import { isDraftAssetId, normalizeShotReviewStatus } from '@shared/domain'
import {
  emptyWorldElementCatalog,
  extractWorldCatalogJsonText,
  mergeWorldCatalogPreservingReviewed,
  parseWorldElementCatalog,
  readWorldElementGraphFromGenParams,
  readWorldElementIdFromNodeParams,
  stringifyWorldElementCatalog,
  syncWorldElementKindGraph,
  withWorldElementGraph,
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

function graphTopologyKey(doc: GraphDocument | null | undefined): string {
  if (!doc) return ''
  const nodes = doc.nodes
    .map((node) => {
      const elementId = readWorldElementIdFromNodeParams(node.params) ?? ''
      return `${node.id}:${node.typeId}:${elementId}:${node.title ?? ''}`
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
  genParams?: Record<string, unknown> | null
): WorldElementCatalog {
  const catalog = emptyWorldElementCatalog()
  for (const kind of WORLD_ELEMENT_KINDS) {
    const doc = readWorldElementGraphFromGenParams(genParams, kind)
    if (!doc?.nodes?.length) continue
    const byId = new Map<
      string,
      { id: string; name: string; prompt: string; status: ReturnType<typeof normalizeShotReviewStatus> }
    >()
    for (const node of doc.nodes) {
      const id = readWorldElementIdFromNodeParams(node.params)
      if (!id) continue
      const prev = byId.get(id) ?? {
        id,
        name: id,
        prompt: '',
        status: normalizeShotReviewStatus(undefined)
      }
      if (node.typeId === 'play.script') {
        prev.prompt = node.params.text?.trim() || ''
        if (node.title?.trim()) prev.name = node.title.trim()
      } else if (node.typeId === 'asset.image') {
        if (node.title?.trim()) prev.name = node.title.trim()
        prev.status = normalizeShotReviewStatus(node.params.reviewStatus)
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

function readLastAppliedFingerprint(worldAssetId: string): string | null {
  const raw = readWorldGenParams(worldAssetId)?.[LAST_APPLIED_WORLD_CATALOG_FP_KEY]
  return typeof raw === 'string' && raw ? raw : null
}

async function persistCatalog(
  worldAssetId: string,
  catalog: WorldElementCatalog,
  fingerprint: string
): Promise<number> {
  let genParams = { ...(readWorldGenParams(worldAssetId) ?? {}) }
  let changed = false

  for (const kind of WORLD_ELEMENT_KINDS) {
    const prev = readWorldElementGraphFromGenParams(genParams, kind)
    const next = syncWorldElementKindGraph(prev, catalog[kind])
    if (graphTopologyKey(prev) !== graphTopologyKey(next)) {
      genParams = withWorldElementGraph(genParams, kind, toPlain(next) as GraphDocument)
      changed = true
    }
  }

  if (readLastAppliedFingerprint(worldAssetId) !== fingerprint) {
    genParams = {
      ...genParams,
      [LAST_APPLIED_WORLD_CATALOG_FP_KEY]: fingerprint
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
  catalog: WorldElementCatalog
): Promise<number> {
  return persistCatalog(worldAssetId, catalog, stringifyWorldElementCatalog(catalog))
}

/**
 * 将世界元素目录 JSON 同步到四类 elementWorkflow 图
 *（为每条目录创建/更新图片生成节点，并接到共享图片输出）。
 * 在表格/生成节点执行、以及打开世界元素生成侧栏时调用。
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
  return persistCatalog(worldAssetId, catalog, fingerprint)
}

export type { WorldElementCatalog, WorldElementKind }
