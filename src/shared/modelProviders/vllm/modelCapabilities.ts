import type { CatalogModel, ModelModality } from '@shared/modelProvider'
import catalog from './modelCapabilities.json'

export interface VllmModelCapabilitiesCatalog {
  meta: {
    console: string
    docs: string[]
    note: string
  }
  profiles: Record<
    string,
    {
      modality: 'text' | 'image' | 'video'
      label: string
      capabilities: Record<string, unknown>
    }
  >
}

const data = catalog as VllmModelCapabilitiesCatalog

/**
 * vLLM-Omni 一个服务实例只跑一个扩散模型，模型 id 以实际部署为准，
 * 因此视频能力按模态整体回退到默认 profile，不按 id 匹配。
 */
export function resolveVllmModelCapabilities(
  _modelId: string,
  modality?: 'text' | 'image' | 'video'
): Record<string, unknown> | null {
  const mod = modality ?? 'video'
  if (mod === 'video') return { ...data.profiles['video-wan']!.capabilities }
  return null
}

/** vLLM 无静态模型目录：视频模型 id 来自 /models 或手动填写 */
export function listVllmCatalogModels(_modality: ModelModality): CatalogModel[] {
  return []
}
