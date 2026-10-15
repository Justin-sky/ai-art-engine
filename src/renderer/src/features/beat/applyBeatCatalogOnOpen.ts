import { isDraftAssetId } from '@shared/domain'
import {
  mergeBeatRowsPreservingReviewed,
  parseBeatJson,
  stringifyBeatRows,
  type BeatRow
} from '@shared/graph'
import { toPlain } from '../../utils/toPlain'
import { persistAssetRecord } from '../../composables/useAssetRecord'
import { useDraftStore } from '../../stores/drafts'
import { useProjectStore } from '../../stores/project'

/** 已成功导入的场目录指纹 */
export const LAST_APPLIED_BEAT_CATALOG_FP_KEY = 'lastAppliedBeatCatalogFingerprint'

function readBeatGenParams(beatAssetId: string): Record<string, unknown> | undefined {
  if (isDraftAssetId(beatAssetId)) {
    return useDraftStore().getDraft(beatAssetId)?.genParams
  }
  return useProjectStore().assets.find((item) => item.id === beatAssetId)?.genParams as
    Record<string, unknown> | undefined
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

/** 从资产 genParams 读取场列表 */
export function loadBeatCatalog(beatAssetId: string): BeatRow[] {
  return readStoredCatalog(readBeatGenParams(beatAssetId))
}

async function persistCatalog(
  beatAssetId: string,
  rows: BeatRow[],
  fingerprint: string
): Promise<number> {
  if (readLastAppliedFingerprint(beatAssetId) === fingerprint) {
    return rows.length
  }
  const previous = readBeatGenParams(beatAssetId) ?? {}
  // 在已有 genParams 上合并，避免冲掉 beatGraphs 等并行写入字段
  const genParams: Record<string, unknown> = {
    ...previous,
    beatCatalog: toPlain(rows),
    [LAST_APPLIED_BEAT_CATALOG_FP_KEY]: fingerprint
  }
  await writeBeatGenParams(beatAssetId, genParams)
  return rows.length
}

/** 保存场目录到 genParams.beatCatalog */
export async function saveBeatCatalog(beatAssetId: string, rows: BeatRow[]): Promise<number> {
  return persistCatalog(beatAssetId, rows, catalogFingerprint(rows))
}

/** 执行表格/编辑节点时：合并导入上游 JSON */
export async function applyBeatCatalog(
  beatAssetId: string,
  jsonText?: string | null
): Promise<number> {
  const parsed = parseBeatJson(jsonText?.trim() ?? '')
  if (!parsed?.length) return 0

  const previous = loadBeatCatalog(beatAssetId)
  const merged = mergeBeatRowsPreservingReviewed(previous, parsed) ?? parsed
  const fingerprint = catalogFingerprint(merged)
  if (readLastAppliedFingerprint(beatAssetId) === fingerprint) return 0
  return persistCatalog(beatAssetId, merged, fingerprint)
}
