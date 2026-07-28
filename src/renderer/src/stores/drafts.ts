import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  createDefaultDirectorStage,
  createDraftAssetId,
  createDraftShotId,
  createEmptyShot,
  defaultAssetName,
  isDraftAssetId,
  normalizeAssetType,
  type AssetInfo,
  type AssetType,
  type Resolution,
  type Shot
} from '@shared/domain'
import { createDefaultScopedGraph } from '@shared/graph'
import i18n from '../i18n'
import { toPlain } from '../utils/toPlain'

export interface DraftAssetRecord {
  id: string
  type: AssetType
  name: string
  folderId: string | null
  relativePath: string
  thumbnailPath?: string
  prompt: string
  notes: string
  genParams?: Record<string, unknown>
  pendingFilePath?: string
  shots?: Shot[]
}

function nowIso(): string {
  return new Date().toISOString()
}

function emptyDraft(type: AssetType, resolution: Resolution): DraftAssetRecord {
  const id = createDraftAssetId()
  const draft: DraftAssetRecord = {
    id,
    type,
    name: '',
    folderId: null,
    relativePath: '',
    prompt: '',
    notes: '',
    genParams: {}
  }
  if (type === 'script') {
    const ts = nowIso()
    draft.genParams = { graphJson: createDefaultScopedGraph('scriptAsset', 'script') }
    draft.shots = [
      {
        ...createEmptyShot(i18n.global.t('shot.defaultName'), resolution),
        id: createDraftShotId(),
        scriptAssetId: id,
        createdAt: ts,
        updatedAt: ts
      }
    ]
  }
  if (type === 'canvas') {
    draft.genParams = { graphJson: createDefaultScopedGraph('canvasAsset', 'canvas') }
  }
  if (type === 'world') {
    draft.genParams = { graphJson: createDefaultScopedGraph('worldAsset', 'world') }
  }
  if (type === 'narrative') {
    draft.genParams = { graphJson: createDefaultScopedGraph('narrativeAsset', 'narrative') }
  }
  if (type === 'motion') {
    draft.genParams = { stage: createDefaultDirectorStage() }
  }
  return draft
}

export function draftToAssetInfo(draft: DraftAssetRecord): AssetInfo {
  const ts = nowIso()
  return {
    id: draft.id,
    type: normalizeAssetType(draft.type),
    name: draft.name || defaultAssetName(normalizeAssetType(draft.type), String(i18n.global.locale.value)),
    relativePath: draft.relativePath,
    folderId: draft.folderId,
    thumbnailPath: draft.thumbnailPath,
    prompt: draft.prompt,
    notes: draft.notes,
    genParams: draft.genParams,
    version: 0,
    createdAt: ts,
    updatedAt: ts
  }
}

export const useDraftStore = defineStore('drafts', () => {
  const drafts = ref<DraftAssetRecord[]>([])

  const draftById = computed(() => new Map(drafts.value.map((d) => [d.id, d])))

  function getDraft(id: string): DraftAssetRecord | null {
    return draftById.value.get(id) ?? null
  }

  function createDraft(type: AssetType, resolution: Resolution): DraftAssetRecord {
    const draft = emptyDraft(type, resolution)
    drafts.value = [...drafts.value, draft]
    return draft
  }

  function updateDraft(id: string, patch: Partial<DraftAssetRecord>): DraftAssetRecord | null {
    const idx = drafts.value.findIndex((d) => d.id === id)
    if (idx < 0) return null
    const next = { ...drafts.value[idx], ...patch }
    drafts.value = [...drafts.value.slice(0, idx), next, ...drafts.value.slice(idx + 1)]
    return next
  }

  function removeDraft(id: string): void {
    drafts.value = drafts.value.filter((d) => d.id !== id)
  }

  function clearAll(): void {
    drafts.value = []
  }

  function listDraftShots(scriptDraftId: string): Shot[] {
    return getDraft(scriptDraftId)?.shots ?? []
  }

  function persistDraftShot(scriptDraftId: string, shot: Shot): void {
    const draft = getDraft(scriptDraftId)
    if (!draft?.shots) return
    const plain = toPlain(shot)
    const idx = draft.shots.findIndex((s) => s.id === plain.id)
    const nextShots =
      idx >= 0
        ? draft.shots.map((s, i) => (i === idx ? { ...plain, updatedAt: nowIso() } : s))
        : [...draft.shots, { ...plain, updatedAt: nowIso() }]
    updateDraft(scriptDraftId, { shots: nextShots })
  }

  function addDraftShot(scriptDraftId: string, resolution: Resolution): Shot | null {
    const draft = getDraft(scriptDraftId)
    if (!draft) return null
    const ts = nowIso()
    const shot: Shot = {
      ...createEmptyShot(i18n.global.t('shot.defaultName'), resolution),
      id: createDraftShotId(),
      scriptAssetId: scriptDraftId,
      createdAt: ts,
      updatedAt: ts
    }
    updateDraft(scriptDraftId, { shots: [...(draft.shots ?? []), shot] })
    return shot
  }

  function deleteDraftShot(scriptDraftId: string, shotId: string): void {
    const draft = getDraft(scriptDraftId)
    if (!draft?.shots) return
    updateDraft(scriptDraftId, {
      shots: draft.shots.filter((s) => s.id !== shotId)
    })
  }

  function isDraft(id: string): boolean {
    return isDraftAssetId(id) && !!getDraft(id)
  }

  return {
    drafts,
    getDraft,
    createDraft,
    updateDraft,
    removeDraft,
    clearAll,
    listDraftShots,
    persistDraftShot,
    addDraftShot,
    deleteDraftShot,
    isDraft
  }
})
