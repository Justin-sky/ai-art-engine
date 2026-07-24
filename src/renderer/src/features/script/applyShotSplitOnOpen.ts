import {
  DEFAULT_SHOT_REVIEW_STATUS,
  buildShotGenerationPrompt,
  createDraftShotId,
  createEmptyShot,
  createEmptyStoryboard,
  isDraftAssetId,
  normalizeShotReviewStatus,
  shotScriptAssetId,
  type Shot,
  type ShotStoryboard
} from '@shared/domain'
import {
  extractShotSplitJsonText,
  parseShotSplitJson,
  shotsToShotSplitRows,
  stringifyShotSplitRows,
  type GraphDocument,
  type ShotSplitRow
} from '@shared/graph'
import { toPlain } from '../../utils/toPlain'
import { useDraftStore } from '../../stores/drafts'
import { useProjectStore } from '../../stores/project'

/** 已成功导入的分镜拆分 JSON 指纹，存在剧本资产 genParams */
export const LAST_APPLIED_SHOT_SPLIT_FP_KEY = 'lastAppliedShotSplitFingerprint'

function readScriptGraph(scriptAssetId: string): GraphDocument | null {
  const project = useProjectStore()
  if (isDraftAssetId(scriptAssetId)) {
    const draft = useDraftStore().getDraft(scriptAssetId)
    const raw = draft?.genParams?.graphJson
    return raw && typeof raw === 'object' ? (raw as GraphDocument) : null
  }
  const asset = project.assets.find((item) => item.id === scriptAssetId)
  const raw = asset?.genParams?.graphJson
  return raw && typeof raw === 'object' ? (raw as GraphDocument) : null
}

function orderedScriptShots(scriptAssetId: string): Shot[] {
  const project = useProjectStore()
  if (isDraftAssetId(scriptAssetId)) {
    return [...(useDraftStore().getDraft(scriptAssetId)?.shots ?? [])]
  }
  const asset = project.assets.find((item) => item.id === scriptAssetId)
  const ids = Array.isArray(asset?.genParams?.shotIds)
    ? asset.genParams.shotIds.map(String)
    : []
  const byId = new Map(
    project.shots.filter((s) => shotScriptAssetId(s) === scriptAssetId).map((s) => [s.id, s])
  )
  const ordered: Shot[] = []
  for (const id of ids) {
    const shot = byId.get(id)
    if (shot) {
      ordered.push(shot)
      byId.delete(id)
    }
  }
  for (const shot of byId.values()) ordered.push(shot)
  return ordered
}

function storyboardFromRow(row: ShotSplitRow): ShotStoryboard {
  return {
    ...createEmptyStoryboard(),
    visualDescription: row.visualDescription,
    shotSize: row.shotSize,
    lighting: row.lighting,
    dialogue: row.dialogue,
    soundFx: row.soundFx,
    cameraMove: row.cameraMove
  }
}

function mergeShotWithRow(shot: Shot, row: ShotSplitRow): Shot {
  const storyboard = storyboardFromRow(row)
  return {
    ...shot,
    title: row.title,
    reviewStatus: normalizeShotReviewStatus(row.status),
    storyboard,
    prompt: buildShotGenerationPrompt(storyboard),
    camera: {
      ...shot.camera,
      durationSec: row.durationSec
    }
  }
}

function isReviewedShot(shot: Shot): boolean {
  return normalizeShotReviewStatus(shot.reviewStatus) === '已审核'
}

function buildNextShotsFromRows(
  scriptAssetId: string,
  rows: ShotSplitRow[],
  existing: Shot[],
  resolution: { w: number; h: number }
): Shot[] {
  const draft = isDraftAssetId(scriptAssetId)
  const nextShots: Shot[] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    const base = existing[i]
    if (base && isReviewedShot(base)) {
      nextShots.push(base)
      continue
    }
    if (base) {
      nextShots.push(mergeShotWithRow(base, row))
      continue
    }
    const createdAt = new Date().toISOString()
    const blank: Shot = {
      ...createEmptyShot(row.title, resolution),
      id: draft ? createDraftShotId() : crypto.randomUUID(),
      scriptAssetId,
      reviewStatus: DEFAULT_SHOT_REVIEW_STATUS,
      createdAt,
      updatedAt: createdAt
    }
    nextShots.push(mergeShotWithRow(blank, row))
  }
  for (let i = rows.length; i < existing.length; i++) {
    const shot = existing[i]
    if (shot && isReviewedShot(shot)) nextShots.push(shot)
  }
  return nextShots
}

function sameSplitContent(a: Shot[], b: ShotSplitRow[]): boolean {
  return stringifyShotSplitRows(shotsToShotSplitRows(a)) === stringifyShotSplitRows(b)
}

export function shotSplitRowsFingerprint(rows: ShotSplitRow[]): string {
  return stringifyShotSplitRows(rows)
}

function readLastAppliedFingerprint(scriptAssetId: string): string | null {
  const project = useProjectStore()
  if (isDraftAssetId(scriptAssetId)) {
    const raw = useDraftStore().getDraft(scriptAssetId)?.genParams?.[LAST_APPLIED_SHOT_SPLIT_FP_KEY]
    return typeof raw === 'string' && raw ? raw : null
  }
  const raw = project.assets.find((item) => item.id === scriptAssetId)?.genParams?.[
    LAST_APPLIED_SHOT_SPLIT_FP_KEY
  ]
  return typeof raw === 'string' && raw ? raw : null
}

/**
 * 执行表格节点导入时是否写回分镜列表。
 * - skip：该拆分已导入过，保留用户表格编辑
 * - mark-only：分镜已与 JSON 一致，只记指纹
 * - apply：拆分结果有更新，需要导入
 */
export function shouldApplyShotSplitImport(opts: {
  fingerprint: string
  lastApplied: string | null | undefined
  contentUnchanged: boolean
}): 'skip' | 'mark-only' | 'apply' {
  if (opts.lastApplied === opts.fingerprint) return 'skip'
  if (opts.contentUnchanged) return 'mark-only'
  return 'apply'
}

async function markShotSplitApplied(scriptAssetId: string, fingerprint: string): Promise<void> {
  const project = useProjectStore()
  const draftStore = useDraftStore()
  if (isDraftAssetId(scriptAssetId)) {
    const draft = draftStore.getDraft(scriptAssetId)
    if (!draft) return
    draftStore.updateDraft(scriptAssetId, {
      genParams: {
        ...(draft.genParams ?? {}),
        [LAST_APPLIED_SHOT_SPLIT_FP_KEY]: fingerprint
      }
    })
    return
  }
  const asset = project.assets.find((item) => item.id === scriptAssetId)
  if (!asset) return
  const updated = await window.studio.updateAsset(
    toPlain({
      ...asset,
      genParams: {
        ...asset.genParams,
        [LAST_APPLIED_SHOT_SPLIT_FP_KEY]: fingerprint
      },
      updatedAt: new Date().toISOString()
    })
  )
  project.patchAssets([updated])
}

/**
 * 将分镜拆分 JSON 写入该剧本的分镜列表。
 * 仅应在「分镜表格」节点执行时调用；打开表格窗口不再导入。
 * @param jsonText 上游拆分文本；缺省时从资产图提取
 */
export async function applyShotSplitJson(
  scriptAssetId: string,
  jsonText?: string | null
): Promise<number> {
  const project = useProjectStore()
  const draftStore = useDraftStore()
  const text = jsonText?.trim() || extractShotSplitJsonText(readScriptGraph(scriptAssetId))
  const rows = parseShotSplitJson(text)
  if (!rows?.length) return 0

  const fingerprint = shotSplitRowsFingerprint(rows)
  const existing = orderedScriptShots(scriptAssetId)
  const decision = shouldApplyShotSplitImport({
    fingerprint,
    lastApplied: readLastAppliedFingerprint(scriptAssetId),
    contentUnchanged: sameSplitContent(existing, rows)
  })

  if (decision === 'skip') return 0
  if (decision === 'mark-only') {
    await markShotSplitApplied(scriptAssetId, fingerprint)
    return 0
  }

  const resolution = project.config?.resolution ?? { w: 1280, h: 720 }
  const nextShots = buildNextShotsFromRows(scriptAssetId, rows, existing, resolution)

  if (isDraftAssetId(scriptAssetId)) {
    const draft = draftStore.getDraft(scriptAssetId)
    if (!draft) return 0
    draftStore.updateDraft(scriptAssetId, {
      shots: nextShots.map((s) => toPlain(s)),
      genParams: {
        ...(draft.genParams ?? {}),
        [LAST_APPLIED_SHOT_SPLIT_FP_KEY]: fingerprint
      }
    })
    project.shots = [
      ...project.shots.filter((s) => shotScriptAssetId(s) !== scriptAssetId),
      ...nextShots
    ]
    return nextShots.length
  }

  const written = await window.studio.syncScriptShots({
    scriptAssetId,
    orderedShots: nextShots.map((s) => toPlain(s))
  })
  project.shots = [
    ...project.shots.filter((s) => shotScriptAssetId(s) !== scriptAssetId),
    ...written
  ]
  const asset = project.assets.find((item) => item.id === scriptAssetId)
  if (asset) {
    const updated = await window.studio.updateAsset(
      toPlain({
        ...asset,
        genParams: {
          ...asset.genParams,
          shotIds: written.map((s) => s.id),
          [LAST_APPLIED_SHOT_SPLIT_FP_KEY]: fingerprint
        },
        updatedAt: new Date().toISOString()
      })
    )
    project.patchAssets([updated])
  }
  return written.length
}
