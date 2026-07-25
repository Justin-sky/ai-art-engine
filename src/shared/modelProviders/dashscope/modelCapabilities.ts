import type { CatalogModel, ModelModality } from '@shared/openrouter'
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
  if (mod === 'image') return profileCapabilities('image-base')
  if (mod === 'video') {
    return profileCapabilities(/i2v/i.test(id) ? 'video-i2v' : 'video-t2v')
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
