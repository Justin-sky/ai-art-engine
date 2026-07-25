import type { CatalogModel, ModelModality } from '@shared/openrouter'
import catalog from './modelCapabilities.json'

export interface KlingModelEntry {
  id: string
  name: string
  modality: 'image' | 'video'
  profile: string
}

export interface KlingModelCapabilitiesCatalog {
  meta: {
    console: string
    docs: string[]
    note: string
  }
  models: KlingModelEntry[]
  profiles: Record<
    string,
    {
      modality: 'image' | 'video'
      label: string
      capabilities: Record<string, unknown>
    }
  >
}

const data = catalog as KlingModelCapabilitiesCatalog

export function getKlingModelCapabilitiesCatalog(): KlingModelCapabilitiesCatalog {
  return data
}

function profileCapabilities(profileId: string): Record<string, unknown> | null {
  const profile = data.profiles[profileId]
  if (!profile?.capabilities) return null
  return { ...profile.capabilities }
}

/** 按模型 id 解析静态能力；未收录时按模态回退默认 profile */
export function resolveKlingModelCapabilities(
  modelId: string,
  modality?: 'image' | 'video'
): Record<string, unknown> | null {
  const id = modelId.trim()
  const entry = data.models.find((m) => m.id === id)
  if (entry) return profileCapabilities(entry.profile)

  const mod = modality ?? (/image|img|t2i|i2i/i.test(id) ? 'image' : 'video')
  if (mod === 'image') return profileCapabilities('image-base')
  if (/v2-6|v3|omni/i.test(id)) return profileCapabilities('video-audio')
  return profileCapabilities('video-base')
}

/** 设置页「拉取模型」：返回静态目录 */
export function listKlingCatalogModels(modality: ModelModality): CatalogModel[] {
  if (modality !== 'image' && modality !== 'video') return []
  return data.models
    .filter((m) => m.modality === modality)
    .map((m) => ({
      id: m.id,
      name: m.name,
      modality,
      capabilities: resolveKlingModelCapabilities(m.id, modality) ?? undefined
    }))
}
