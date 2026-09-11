import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AssetType } from '@shared/domain'
import { isLayeredSourceImageFilePath } from '@shared/import'

/** Typed helpers for common domain labels */
export function useStudioI18n() {
  const { t, te, locale } = useI18n()

  function assetTypeLabel(type: AssetType | string): string {
    const key = `asset.type.${type}`
    return te(key) ? String(t(key)) : String(type)
  }

  /**
   * 展示用类型名：PSD 等分层源文件单独标注，不与可直接解码的图片混为一类——
   * 它的画面要靠主进程合成解码，抠图 / 智能构图 / UI 部件提取等像素级能力一律不开放。
   */
  function assetDisplayTypeLabel(asset: {
    type: AssetType | string
    relativePath?: string | null
  }): string {
    if (isLayeredSourceImageFilePath(asset.relativePath || '')) {
      return String(t('asset.type.psdSource'))
    }
    return assetTypeLabel(asset.type)
  }

  function assetCreateName(type: AssetType): string {
    const key = `asset.create.${type}`
    return te(key) ? String(t(key)) : String(t('asset.create.default'))
  }

  /** 工具栏 / 资产右键新建条目的显示名（按条目 id，支持同类型多入口） */
  function toolbarCreateLabel(itemId: string, assetType: AssetType): string {
    const key = `asset.create.${itemId}`
    if (te(key)) return String(t(key))
    return assetCreateName(assetType)
  }

  function graphTypeLabel(typeId: string): string {
    if (typeId.startsWith('asset.')) {
      const kind = typeId.slice('asset.'.length)
      const key = `graph.types.asset.${kind}`
      if (te(key)) return String(t(key))
      const typeName = assetTypeLabel(kind)
      return `${typeName}${t('graph.nodeRole.generate')}`
    }
    const key = `graph.types.${typeId}`
    return te(key) ? String(t(key)) : typeId
  }

  function graphTitleForAssetType(type: AssetType): string {
    const key = `graph.titles.${type}`
    return te(key) ? String(t(key)) : assetTypeLabel(type)
  }

  const localeRef = computed(() => locale.value)

  return {
    t,
    te,
    locale: localeRef,
    assetTypeLabel,
    assetDisplayTypeLabel,
    assetCreateName,
    toolbarCreateLabel,
    graphTypeLabel,
    graphTitleForAssetType
  }
}
