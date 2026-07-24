import { computed, type ComputedRef } from 'vue'
import { isDraftAssetId, type AssetInfo } from '@shared/domain'
import {
  draftToAssetInfo,
  useDraftStore,
  type DraftAssetRecord
} from '../stores/drafts'
import { useProjectStore } from '../stores/project'
import { toPlain } from '../utils/toPlain'

export function useAssetRecord(assetId: string): {
  asset: ComputedRef<AssetInfo | null>
  isDraft: ComputedRef<boolean>
  draft: ComputedRef<DraftAssetRecord | null>
} {
  const project = useProjectStore()
  const drafts = useDraftStore()

  const draft = computed(() => (isDraftAssetId(assetId) ? drafts.getDraft(assetId) : null))
  const isDraft = computed(() => !!draft.value)

  const asset = computed(() => {
    if (draft.value) return draftToAssetInfo(draft.value)
    return project.assets.find((a) => a.id === assetId) ?? null
  })

  return { asset, isDraft, draft }
}

export async function persistAssetRecord(
  assetId: string,
  patch: Partial<
    Pick<AssetInfo, 'name' | 'prompt' | 'notes' | 'genParams' | 'relativePath' | 'thumbnailPath' | 'folderId'>
  > & { pendingFilePath?: string },
  options?: { recordCommand?: boolean; label?: string }
): Promise<AssetInfo | null> {
  const project = useProjectStore()
  const drafts = useDraftStore()
  const currentDraft = drafts.getDraft(assetId)

  if (isDraftAssetId(assetId) && currentDraft) {
    const updated = drafts.updateDraft(assetId, {
      name: patch.name ?? currentDraft.name,
      prompt: patch.prompt ?? currentDraft.prompt,
      notes: patch.notes ?? currentDraft.notes,
      genParams:
        patch.genParams !== undefined ? toPlain(patch.genParams) : currentDraft.genParams,
      relativePath: patch.relativePath ?? currentDraft.relativePath,
      thumbnailPath: patch.thumbnailPath ?? currentDraft.thumbnailPath,
      folderId: patch.folderId ?? currentDraft.folderId,
      pendingFilePath: patch.pendingFilePath ?? currentDraft.pendingFilePath
    })
    return updated ? draftToAssetInfo(updated) : null
  }

  const current = project.assets.find((a) => a.id === assetId)
  if (!current) return null
  const next: AssetInfo = {
    ...current,
    ...patch,
    genParams: patch.genParams ?? current.genParams
  }
  if (options?.recordCommand) {
    await project.persistAssetCommand(next, options.label ?? 'Update asset')
    return project.assets.find((asset) => asset.id === assetId) ?? next
  }
  const updated = await window.studio.updateAsset(toPlain(next))
  const idx = project.assets.findIndex((a) => a.id === updated.id)
  if (idx >= 0) project.assets[idx] = updated
  return updated
}

