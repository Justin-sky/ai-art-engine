import { isDraftAssetId } from '@shared/domain'
import {
  extractBeatJsonText,
  mergeBeatRowsPreservingReviewed,
  parseBeatJson,
  stringifyBeatRows,
  type GraphDocument,
  type BeatRow
} from '@shared/graph'
import { toPlain } from '../../utils/toPlain'
import { persistAssetRecord } from '../../composables/useAssetRecord'
import { useDraftStore } from '../../stores/drafts'
import { useProjectStore } from '../../stores/project'

/** 已成功导入的场目录指纹 */
export const LAST_APPLIED_BEAT_CATALOG_FP_KEY = 'lastAppliedBeatCatalogFingerprint'

function readBeatAssetGraph(beatAssetId: string): GraphDocument | null {
  if (isDraftAssetId(beatAssetId)) {
    const draft = useDraftStore().getDraft(beatAssetId)
    const raw = draft?.genParams?.graphJson
    return raw && typeof raw === 'object' ? (raw as GraphDocument) : null
  }
  const asset = useProjectStore().assets.find((item) => item.id === beatAssetId)
  const raw = asset?.genParams?.graphJson
  return raw && typeof raw === 'object' ? (raw as GraphDocument) : null
}

function readBeatGenParams(
  beatAssetId: string
): Record<string, unknown> | undefined {
  if (isDraftAssetId(beatAssetId)) {
    return useDraftStore().getDraft(beatAssetId)?.genParams
  }
  return useProjectStore().assets.find((item) => item.id === beatAssetId)?.genParams as
    | Record<string, unknown>
    | undefined
}

function catalogFingerprint(rows: BeatRow[]): string {
  return stringifyBeatRows(rows)
}

function readStoredCatalog(genParams: Record<string, unknown> | undefined): BeatRow[] {
  const raw = genParams?.beatCatalog
  if (typeof raw === 'string') {
    return parseBeatJson(raw) ?? []
  }
  if (Array.isArray(raw)) {
    return parseBeatJson(JSON.stringify(raw)) ?? []
  }
  return []
}

function readLastAppliedFingerprint(beatAssetId: string): string {
  return String(readBeatGenParams(beatAssetId)?.[LAST_APPLIED_BEAT_CATALOG_FP_KEY] ?? '')
}

function syncCatalogTextIntoGraph(
  doc: GraphDocument | null,
  text: string
): GraphDocument | undefined {
  if (!doc?.nodes?.length) return undefined
  return {
    ...doc,
    nodes: doc.nodes.map((node) => {
      if (node.typeId !== 'beat.table' && node.typeId !== 'beat.split') {
        return node
      }
      return { ...node, params: { ...node.params, text } }
    })
  }
}

async function writeBeatGenParams(
  beatAssetId: string,
  genParams: Record<string, unknown>
): Promise<void> {
  if (isDraftAssetId(beatAssetId)) {
    useDraftStore().updateDraft(beatAssetId, { genParams })
    return
  }
  await persistAssetRecord(beatAssetId, { genParams })
}

/** 从资产 genParams / 主图读取场列表 */
export function loadBeatCatalog(beatAssetId: string): BeatRow[] {
  const stored = readStoredCatalog(readBeatGenParams(beatAssetId))
  if (stored.length) return stored
  const fromGraph = extractBeatJsonText(readBeatAssetGraph(beatAssetId))
  return parseBeatJson(fromGraph) ?? []
}

async function persistCatalog(
  beatAssetId: string,
  rows: BeatRow[],
  fingerprint: string
): Promise<number> {
  if (readLastAppliedFingerprint(beatAssetId) === fingerprint) {
    return rows.length
  }
  const text = stringifyBeatRows(rows)
  const previous = readBeatGenParams(beatAssetId) ?? {}
  // 在已有 genParams 上合并，避免冲掉 beatGraphs 等并行写入字段
  const graphJson = syncCatalogTextIntoGraph(
    (previous.graphJson as GraphDocument | undefined) ??
      readBeatAssetGraph(beatAssetId),
    text
  )
  const genParams: Record<string, unknown> = {
    ...previous,
    beatCatalog: toPlain(rows),
    [LAST_APPLIED_BEAT_CATALOG_FP_KEY]: fingerprint,
    ...(graphJson ? { graphJson: toPlain(graphJson) } : {})
  }
  await writeBeatGenParams(beatAssetId, genParams)
  return rows.length
}

/** 保存场目录到 genParams.beatCatalog */
export async function saveBeatCatalog(
  beatAssetId: string,
  rows: BeatRow[]
): Promise<number> {
  return persistCatalog(beatAssetId, rows, catalogFingerprint(rows))
}

/** 执行表格/编辑节点时：合并导入上游 JSON */
export async function applyBeatCatalog(
  beatAssetId: string,
  jsonText?: string | null
): Promise<number> {
  const text =
    jsonText?.trim() || extractBeatJsonText(readBeatAssetGraph(beatAssetId))
  const parsed = parseBeatJson(text)
  if (!parsed?.length) return 0

  const previous = loadBeatCatalog(beatAssetId)
  const merged = mergeBeatRowsPreservingReviewed(previous, parsed) ?? parsed
  const fingerprint = catalogFingerprint(merged)
  if (readLastAppliedFingerprint(beatAssetId) === fingerprint) return 0
  return persistCatalog(beatAssetId, merged, fingerprint)
}
