import {
  isDirectorDeck,
  isCanvasAsset,
  isScreenplayAsset,
  isStoryboardScript,
  isWorldElementAsset,
  type AssetInfo,
  type AssetType,
  type Shot
} from '@shared/domain'
import type { DockviewApi } from 'dockview-vue'
import { useDraftStore } from '../stores/drafts'
import { useProjectStore } from '../stores/project'
import { useWorkspaceStore } from '../stores/workspace'
import { useStudioI18n } from './useStudioI18n'
import { toPlain } from '../utils/toPlain'

export function useDraftSave() {
  const project = useProjectStore()
  const drafts = useDraftStore()
  const workspace = useWorkspaceStore()
  const { t, assetCreateName } = useStudioI18n()

  function openDraftEditor(draftId: string): void {
    workspace.selectAsset(draftId)
    workspace.openEditorForAssetId(draftId)
  }

  function createDraftAndOpen(type: AssetType): string {
    const resolution = project.config?.resolution ?? { w: 1280, h: 720 }
    const draft = drafts.createDraft(type, resolution)
    drafts.updateDraft(draft.id, { name: assetCreateName(type) })
    openDraftEditor(draft.id)
    return draft.id
  }

  function migrateEditor(draftId: string, assetId: string, type: AssetType): void {
    if (isStoryboardScript(type)) {
      workspace.consumeScriptEditor(draftId)
    } else if (isCanvasAsset(type)) {
      workspace.consumeCanvasEditor(draftId)
    } else if (isWorldElementAsset(type)) {
      workspace.consumeWorldEditor(draftId)
    } else if (isDirectorDeck(type)) {
      workspace.consumeDirectorEditor(draftId)
    } else if (isScreenplayAsset(type)) {
      workspace.consumeScreenplayEditor(draftId)
    } else {
      workspace.consumeAssetEditor(draftId)
    }
    workspace.openEditorForAssetId(assetId)
    workspace.selectAsset(assetId)
  }

  async function commitDraft(
    draftId: string,
    name: string,
    folderId: string | null,
    dockApi?: DockviewApi | null
  ): Promise<AssetInfo> {
    const draft = drafts.getDraft(draftId)
    if (!draft) throw new Error(t('draft.error.notFound'))

    const trimmed = name.trim()
    if (!trimmed) throw new Error(t('validation.nameRequired'))

    const created = await window.studio.createAsset(
      toPlain({
        type: draft.type,
        name: trimmed,
        folderId,
        prompt: draft.prompt,
        notes: draft.notes,
        genParams: draft.genParams,
        skipScriptBootstrap: draft.type === 'script'
      })
    )

    let asset = created

    if (draft.pendingFilePath) {
      asset = await window.studio.attachAssetFile({
        assetId: asset.id,
        filePath: draft.pendingFilePath
      })
    }

    if (draft.type === 'script' && draft.shots?.length) {
      for (const draftShot of draft.shots) {
        const shot = await window.studio.createShot({
          scriptAssetId: asset.id,
          title: draftShot.title
        })
        const merged: Shot = {
          ...shot,
          title: draftShot.title,
          status: draftShot.status,
          prompt: draftShot.prompt,
          storyboard: draftShot.storyboard,
          camera: draftShot.camera,
          canvas: draftShot.canvas,
          generations: draftShot.generations ?? [],
          genRefs: draftShot.genRefs,
          audioRefs: draftShot.audioRefs,
          thumbnailPath: draftShot.thumbnailPath,
          scriptAssetId: asset.id
        }
        await window.studio.updateShot(toPlain(merged))
      }
    }

    drafts.removeDraft(draftId)
    await project.refreshLibrary()
    await project.refreshShots()

    if (dockApi) {
      const prefix = isStoryboardScript(draft.type)
        ? 'script-editor-'
        : isCanvasAsset(draft.type)
          ? 'canvas-editor-'
          : isWorldElementAsset(draft.type)
            ? 'world-editor-'
            : isDirectorDeck(draft.type)
              ? 'director-editor-'
              : isScreenplayAsset(draft.type)
                ? 'screenplay-editor-'
                : 'asset-editor-'
      const oldPanel = dockApi.getPanel(`${prefix}${draftId}`)
      if (oldPanel) dockApi.removePanel(oldPanel)
    }

    migrateEditor(draftId, asset.id, draft.type)
    return asset
  }

  function activeDraftId(): string | null {
    const id = workspace.selectedAssetId
    if (id && drafts.isDraft(id)) return id
    const lists = [
      ...workspace.openScriptEditorIds,
      ...workspace.openCanvasEditorIds,
      ...workspace.openWorldEditorIds,
      ...workspace.openDirectorEditorIds,
      ...workspace.openScreenplayEditorIds,
      ...workspace.openAssetEditorIds
    ]
    for (let i = lists.length - 1; i >= 0; i--) {
      if (drafts.isDraft(lists[i])) return lists[i]
    }
    return null
  }

  function defaultSaveName(draftId: string): string {
    const draft = drafts.getDraft(draftId)
    if (!draft) return t('common.unnamed')
    return draft.name.trim() || assetCreateName(draft.type)
  }

  return {
    createDraftAndOpen,
    commitDraft,
    activeDraftId,
    defaultSaveName
  }
}
