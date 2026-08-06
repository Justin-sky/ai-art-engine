import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  createDefaultDirectorStage,
  createDraftAssetId,
  defaultAssetName,
  isDraftAssetId,
  normalizeAssetType,
  type AssetInfo,
  type AssetType,
  type Resolution
} from '@shared/domain'
import { createDefaultScopedGraph } from '@shared/graph'
import i18n from '../i18n'

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
}

function nowIso(): string {
  return new Date().toISOString()
}

function emptyDraft(type: AssetType): DraftAssetRecord {
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
  if (type === 'canvas') {
    draft.genParams = {
      canvasKind: 'free',
      graphJson: createDefaultScopedGraph('canvasAsset', 'canvas')
    }
  }
  if (type === 'world') {
    draft.genParams = { graphJson: createDefaultScopedGraph('worldAsset', 'world') }
  }
  if (type === 'beat') {
    draft.genParams = { graphJson: createDefaultScopedGraph('beatAsset', 'beat') }
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

  function createDraft(type: AssetType, _resolution: Resolution): DraftAssetRecord {
    const draft = emptyDraft(type)
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
    isDraft
  }
})
