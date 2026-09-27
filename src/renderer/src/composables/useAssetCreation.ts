import { type AssetInfo, type AssetType } from '@shared/domain'
import { useProjectStore } from '../stores/project'
import { useWorkspaceStore } from '../stores/workspace'
import { openMotion2dActionPreviewDialog } from '../features/media/motion2dActionPreviewDialog'
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
    if (options?.openEditor !== false) {
      openAssetEditor(asset)
    }
    return asset
  }

  /**
   * 2D 动作资产：**没有独立编辑页**（纯 JSON 文档，由 `stage.2d` 节点对话框保存 / 载入），
   * 所以「新建」不能走草稿或编辑页那条路——`createDraftAndOpen` 会给它开一个空编辑页，
   * 而工具栏条目又标了 `openOnCreate: false`，两边都会让点击看起来毫无反应。
   * 这里统一成资产库同款反馈：建好 → 选中 → 在资产库里定位 → 打开预览弹窗（空动作时弹窗自带引导）。
   */
  async function createMotion2dActionAsset(options?: {
    folderId?: string | null
    name?: string
  }): Promise<AssetInfo> {
    const asset = await createAsset('motion2d', options?.folderId ?? null, {
      openEditor: false,
      ...(options?.name ? { name: options.name } : {})
    })
    workspace.selectAsset(asset.id)
    workspace.revealAssetInBrowser(asset.id)
    openMotion2dActionPreviewDialog({ assetId: asset.id, title: asset.name })
    return asset
  }

  return {
    createAsset,
    createMotion2dActionAsset,
    openAssetEditor
  }
}
