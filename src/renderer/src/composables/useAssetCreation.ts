import { isStoryboardScript, type AssetInfo, type AssetType } from '@shared/domain'
import { useProjectStore } from '../stores/project'
import { useWorkspaceStore } from '../stores/workspace'
import { useStudioI18n } from './useStudioI18n'

export function useAssetCreation() {
  const project = useProjectStore()
  const workspace = useWorkspaceStore()
  const { assetCreateName } = useStudioI18n()

  function openAssetEditor(asset: AssetInfo): void {
    workspace.openEditorForAssetId(asset.id)
  }

  async function createAsset(
    type: AssetType,
    folderId: string | null = null,
    options?: { openEditor?: boolean; name?: string; genParams?: Record<string, unknown> }
  ): Promise<AssetInfo> {
    const asset = await window.studio.createAsset({
      type,
      folderId,
      name: options?.name ?? assetCreateName(type),
      ...(options?.genParams ? { genParams: options.genParams } : {})
    })
    await project.refreshAssets()
    if (isStoryboardScript(type)) {
      await project.refreshShots()
    }
    if (options?.openEditor !== false) {
      openAssetEditor(asset)
    }
    return asset
  }

  return {
    createAsset,
    openAssetEditor
  }
}
