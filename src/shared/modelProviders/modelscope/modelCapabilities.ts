import type { CatalogModel, ModelModality } from '@shared/openrouter'
import catalog from './modelCapabilities.json'

export interface ModelScopeModelEntry {
  id: string
  name: string
  modality: 'text' | 'image'
  profile: string
}

export interface ModelScopeModelCapabilitiesCatalog {
  meta: {
    console: string
    docs: string[]
    note: string
  }
  models: ModelScopeModelEntry[]
  profiles: Record<
    string,
    {
      modality: 'text' | 'image'
      label: string
      capabilities: Record<string, unknown>
    }
  >
}

const data = catalog as ModelScopeModelCapabilitiesCatalog

export function getModelScopeModelCapabilitiesCatalog(): ModelScopeModelCapabilitiesCatalog {
  return data
}

function profileCapabilities(profileId: string): Record<string, unknown> | null {
  const profile = data.profiles[profileId]
  if (!profile?.capabilities) return null
  return { ...profile.capabilities }
}

export function resolveModelScopeModelCapabilities(
  modelId: string,
  modality?: 'text' | 'image'
): Record<string, unknown> | null {
  const id = modelId.trim()
  const entry = data.models.find((m) => m.id === id)
  if (entry) return profileCapabilities(entry.profile)

  const mod =
    modality ??
    (/flux|sdxl|stable.?diffusion|majic|t2i|lora|kolors/i.test(id) ? 'image' : 'text')
  if (mod === 'image') return profileCapabilities('image-base')
  return profileCapabilities('text-base')
}

export function listModelScopeCatalogModels(modality: ModelModality): CatalogModel[] {
  if (modality !== 'text' && modality !== 'image') return []
  return data.models
    .filter((m) => m.modality === modality)
    .map((m) => ({
      id: m.id,
      name: m.name,
      modality,
      capabilities: resolveModelScopeModelCapabilities(m.id, modality) ?? undefined
    }))
}
