import { isDraftAssetId } from '@shared/domain'
import {
  extractNarrativeUnitJsonText,
  mergeNarrativeUnitRowsPreservingReviewed,
  parseNarrativeUnitJson,
  stringifyNarrativeUnitRows,
  type GraphDocument,
  type NarrativeUnitRow
} from '@shared/graph'
import { toPlain } from '../../utils/toPlain'
import { persistAssetRecord } from '../../composables/useAssetRecord'
import { useDraftStore } from '../../stores/drafts'
import { useProjectStore } from '../../stores/project'

/** 已成功导入的叙事单元目录指纹 */
export const LAST_APPLIED_NARRATIVE_CATALOG_FP_KEY = 'lastAppliedNarrativeCatalogFingerprint'

function readNarrativeAssetGraph(narrativeAssetId: string): GraphDocument | null {
  if (isDraftAssetId(narrativeAssetId)) {
    const draft = useDraftStore().getDraft(narrativeAssetId)
    const raw = draft?.genParams?.graphJson
    return raw && typeof raw === 'object' ? (raw as GraphDocument) : null
  }
  const asset = useProjectStore().assets.find((item) => item.id === narrativeAssetId)
  const raw = asset?.genParams?.graphJson
  return raw && typeof raw === 'object' ? (raw as GraphDocument) : null
}

function readNarrativeGenParams(
  narrativeAssetId: string
): Record<string, unknown> | undefined {
  if (isDraftAssetId(narrativeAssetId)) {
    return useDraftStore().getDraft(narrativeAssetId)?.genParams
  }
  return useProjectStore().assets.find((item) => item.id === narrativeAssetId)?.genParams as
    | Record<string, unknown>
    | undefined
}

function catalogFingerprint(rows: NarrativeUnitRow[]): string {
  return stringifyNarrativeUnitRows(rows)
}

function readStoredCatalog(genParams: Record<string, unknown> | undefined): NarrativeUnitRow[] {
  const raw = genParams?.narrativeCatalog
  if (typeof raw === 'string') {
    return parseNarrativeUnitJson(raw) ?? []
  }
  if (Array.isArray(raw)) {
    return parseNarrativeUnitJson(JSON.stringify(raw)) ?? []
  }
  return []
}

function readLastAppliedFingerprint(narrativeAssetId: string): string {
  return String(readNarrativeGenParams(narrativeAssetId)?.[LAST_APPLIED_NARRATIVE_CATALOG_FP_KEY] ?? '')
}

function syncCatalogTextIntoGraph(
  doc: GraphDocument | null,
  text: string
): GraphDocument | undefined {
  if (!doc?.nodes?.length) return undefined
  return {
    ...doc,
    nodes: doc.nodes.map((node) => {
      if (node.typeId !== 'narrative.table' && node.typeId !== 'narrative.split') {
        return node
      }
      return { ...node, params: { ...node.params, text } }
    })
  }
}

async function writeNarrativeGenParams(
  narrativeAssetId: string,
  genParams: Record<string, unknown>
): Promise<void> {
  if (isDraftAssetId(narrativeAssetId)) {
    useDraftStore().updateDraft(narrativeAssetId, { genParams })
    return
  }
  await persistAssetRecord(narrativeAssetId, { genParams })
}

/** 从资产 genParams / 主图读取叙事单元列表 */
export function loadNarrativeCatalog(narrativeAssetId: string): NarrativeUnitRow[] {
  const stored = readStoredCatalog(readNarrativeGenParams(narrativeAssetId))
  if (stored.length) return stored
  const fromGraph = extractNarrativeUnitJsonText(readNarrativeAssetGraph(narrativeAssetId))
  return parseNarrativeUnitJson(fromGraph) ?? []
}

async function persistCatalog(
  narrativeAssetId: string,
  rows: NarrativeUnitRow[],
  fingerprint: string
): Promise<number> {
  if (readLastAppliedFingerprint(narrativeAssetId) === fingerprint) {
    return rows.length
  }
  const text = stringifyNarrativeUnitRows(rows)
  const graphJson = syncCatalogTextIntoGraph(readNarrativeAssetGraph(narrativeAssetId), text)
  const genParams: Record<string, unknown> = {
    ...(readNarrativeGenParams(narrativeAssetId) ?? {}),
    narrativeCatalog: toPlain(rows),
    [LAST_APPLIED_NARRATIVE_CATALOG_FP_KEY]: fingerprint,
    ...(graphJson ? { graphJson: toPlain(graphJson) } : {})
  }
  await writeNarrativeGenParams(narrativeAssetId, genParams)
  return rows.length
}

/** 保存叙事单元目录到 genParams.narrativeCatalog */
export async function saveNarrativeCatalog(
  narrativeAssetId: string,
  rows: NarrativeUnitRow[]
): Promise<number> {
  return persistCatalog(narrativeAssetId, rows, catalogFingerprint(rows))
}

/** 执行表格/编辑节点时：合并导入上游 JSON */
export async function applyNarrativeCatalog(
  narrativeAssetId: string,
  jsonText?: string | null
): Promise<number> {
  const text =
    jsonText?.trim() || extractNarrativeUnitJsonText(readNarrativeAssetGraph(narrativeAssetId))
  const parsed = parseNarrativeUnitJson(text)
  if (!parsed?.length) return 0

  const previous = loadNarrativeCatalog(narrativeAssetId)
  const merged = mergeNarrativeUnitRowsPreservingReviewed(previous, parsed) ?? parsed
  const fingerprint = catalogFingerprint(merged)
  if (readLastAppliedFingerprint(narrativeAssetId) === fingerprint) return 0
  return persistCatalog(narrativeAssetId, merged, fingerprint)
}
