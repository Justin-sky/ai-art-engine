import type { CatalogModel, ModelModality } from '@shared/modelProvider'
import catalog from './modelCapabilities.json'

export interface DashScopeModelEntry {
  id: string
  name: string
  modality: 'text' | 'image' | 'video'
  profile: string
}

export interface DashScopeModelCapabilitiesCatalog {
  meta: {
    console: string
    docs: string[]
    note: string
  }
  models: DashScopeModelEntry[]
  profiles: Record<
    string,
    {
      modality: 'text' | 'image' | 'video'
      label: string
      capabilities: Record<string, unknown>
    }
  >
}

const data = catalog as DashScopeModelCapabilitiesCatalog

export function getDashScopeModelCapabilitiesCatalog(): DashScopeModelCapabilitiesCatalog {
  return data
}

function profileCapabilities(profileId: string): Record<string, unknown> | null {
  const profile = data.profiles[profileId]
  if (!profile?.capabilities) return null
  return { ...profile.capabilities }
}

/** 按模型 id 解析静态能力 */
export function resolveDashScopeModelCapabilities(
  modelId: string,
  modality?: 'text' | 'image' | 'video'
): Record<string, unknown> | null {
  const id = modelId.trim()
  const entry = data.models.find((m) => m.id === id)
  if (entry) return profileCapabilities(entry.profile)

  const mod =
    modality ??
    (/wanx|t2i|image/i.test(id)
      ? 'image'
      : /t2v|i2v|video/i.test(id)
        ? 'video'
        : 'text')
  if (mod === 'image') return profileCapabilities('image-t2i')
  if (mod === 'video') {
    if (/^kling\//i.test(id) || /kling-v3.*video/i.test(id)) {
      return profileCapabilities(
        /omni/i.test(id) ? 'video-kling-omni-bailian' : 'video-kling-bailian'
      )
    }
    if (/happyhorse/i.test(id)) {
      if (/video-edit/i.test(id)) return profileCapabilities('video-happyhorse-edit')
      if (/r2v/i.test(id)) return profileCapabilities('video-happyhorse-r2v')
      return profileCapabilities(/i2v/i.test(id) ? 'video-happyhorse-i2v' : 'video-happyhorse-t2v')
    }
    if (/i2v/i.test(id)) {
      if (/2\.2/i.test(id) && /plus/i.test(id)) return profileCapabilities('video-i2v-22-plus')
      if (/2\.2/i.test(id)) return profileCapabilities('video-i2v-22')
      if (/2\.5/i.test(id)) return profileCapabilities('video-i2v-full')
      return profileCapabilities('video-i2v')
    }
    if (/2\.2/i.test(id)) return profileCapabilities('video-t2v-22')
    if (/2\.5/i.test(id)) return profileCapabilities('video-t2v-full')
    return profileCapabilities('video-t2v')
  }
  return profileCapabilities('text-base')
}

export function listDashScopeCatalogModels(modality: ModelModality): CatalogModel[] {
  if (modality !== 'text' && modality !== 'image' && modality !== 'video') return []
  return data.models
    .filter((m) => m.modality === modality)
    .map((m) => ({
      id: m.id,
      name: m.name,
      modality,
      capabilities: resolveDashScopeModelCapabilities(m.id, modality) ?? undefined
    }))
}
