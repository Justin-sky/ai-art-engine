import type { CatalogModel, ModelModality } from '@shared/modelProvider'
import catalog from './modelCapabilities.json'

export interface ZhipuModelEntry {
  id: string
  name: string
  modality: 'text' | 'image'
  profile: string
}

export interface ZhipuModelCapabilitiesCatalog {
  meta: {
    console: string
    docs: string[]
    note: string
  }
  models: ZhipuModelEntry[]
  profiles: Record<
    string,
    {
      modality: 'text' | 'image'
      label: string
      capabilities: Record<string, unknown>
    }
  >
}

const data = catalog as ZhipuModelCapabilitiesCatalog

export function getZhipuModelCapabilitiesCatalog(): ZhipuModelCapabilitiesCatalog {
  return data
}

function profileCapabilities(profileId: string): Record<string, unknown> | null {
  const profile = data.profiles[profileId]
  if (!profile?.capabilities) return null
  return { ...profile.capabilities }
}

/** 按模型 id 解析静态能力（图片节点用 supported_parameters） */
export function resolveZhipuModelCapabilities(
  modelId: string,
  modality?: 'text' | 'image'
): Record<string, unknown> | null {
  const id = modelId.trim()
  const entry = data.models.find((m) => m.id === id)
  if (entry) return profileCapabilities(entry.profile)

  const mod = modality ?? (/cogview|glm-image/i.test(id) ? 'image' : 'text')
  if (mod === 'image') return profileCapabilities('image-cogview')
  return profileCapabilities('text-glm')
}

/** 静态目录：文本为 GET /models 失败时的回退，图片为唯一来源 */
export function listZhipuCatalogModels(modality: ModelModality): CatalogModel[] {
  if (modality !== 'text' && modality !== 'image') return []
  return data.models
    .filter((m) => m.modality === modality)
    .map((m) => ({
      id: m.id,
      name: m.name,
      modality,
      ...(modality === 'image'
        ? { capabilities: resolveZhipuModelCapabilities(m.id, 'image') ?? undefined }
        : {})
    }))
}

/** 远端 GET /models 返回的模型过滤：只保留 GLM 系（文本 / 多模态对话） */
export function isZhipuTextModelId(modelId: string): boolean {
  const id = modelId.trim()
  if (!/^glm-/i.test(id)) return false
  if (/glm-image/i.test(id)) return false
  return true
}
