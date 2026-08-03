import type { AssetInfo } from '@shared/domain'
import { useProjectStore } from '../stores/project'
import { useWorkspaceStore } from '../stores/workspace'
import { useStudioI18n } from './useStudioI18n'
import { promptAlert, promptText } from './useStudioPrompt'

export function useSeriesCreation() {
  const project = useProjectStore()
  const workspace = useWorkspaceStore()
  const { t, assetCreateName, assetTypeLabel } = useStudioI18n()

  async function createSeriesWithStarter(
    folderId: string | null = null,
    options?: { openEditor?: boolean; name?: string }
  ): Promise<AssetInfo | null> {
    let name = options?.name?.trim() ?? ''
    if (!name) {
      const entered = await promptText({
        title: t('asset.create.seriesNameTitle'),
        message: t('asset.create.seriesNameMessage'),
        defaultValue: assetCreateName('canvas'),
        placeholder: t('asset.create.seriesNamePlaceholder')
      })
      if (entered == null) return null
      name = entered.trim()
      if (!name) {
        await promptAlert({
          title: t('asset.create.seriesNameTitle'),
          message: t('validation.nameRequired')
        })
        return null
      }
    }

    const childNames = {
      screenplay: `${name}${assetTypeLabel('screenplay')}`,
      world: `${name}${assetTypeLabel('world')}`,
      beat: `${name}${assetTypeLabel('beat')}`,
      script: `${name}${assetTypeLabel('script')}`
    }
    const childFolderNames = {
      screenplay: assetTypeLabel('screenplay'),
      world: assetTypeLabel('world'),
      beat: assetTypeLabel('beat'),
      script: assetTypeLabel('script')
    }

    const asset = await window.studio.createSeriesWithStarter({
      name,
      folderId,
      childNames,
      childFolderNames
    })
    await project.refreshAssets()
    await project.refreshFolders()
    await project.refreshShots()
    if (options?.openEditor !== false) {
      workspace.openEditorForAssetId(asset.id)
    }
    return asset
  }

  return { createSeriesWithStarter }
}
