import type { CatalogModel, ModelModality } from '@shared/modelProvider'
import catalog from './modelCapabilities.json'

export interface ComfyUiModelEntry {
  id: string
  name: string
  modality: 'image' | 'video' | 'audio'
  profile: string
}

export interface ComfyUiModelCapabilitiesCatalog {
  meta: { docs: string[]; note: string }
  models: ComfyUiModelEntry[]
  profiles: Record<
    string,
    {
      modality: 'image' | 'video' | 'audio'
      label: string
      capabilities: Record<string, unknown>
    }
  >
}

const data = catalog as ComfyUiModelCapabilitiesCatalog

export function getComfyUiModelCapabilitiesCatalog(): ComfyUiModelCapabilitiesCatalog {
  return data
}

function profileCapabilities(profileId: string): Record<string, unknown> | null {
  const profile = data.profiles[profileId]
  if (!profile?.capabilities) return null
  return { ...profile.capabilities }
}

export function inferComfyUiWorkflowModality(
  id: string,
  name?: string
): 'image' | 'video' | 'audio' {
  const text = `${id} ${name ?? ''}`.toLowerCase()
  if (/\b(audio|sfx|music|tts|sound|speech|stable.?audio)\b/.test(text)) return 'audio'
  if (/\b(video|t2v|i2v|wan|svd|animate|ltxv|hunyuan.?video)\b/.test(text)) return 'video'
  return 'image'
}

export function resolveComfyUiModelCapabilities(
  modelId: string,
  modality?: ModelModality
): Record<string, unknown> | null {
  const id = modelId.trim()
  const entry = data.models.find((m) => m.id === id)
  if (entry) return profileCapabilities(entry.profile)

  const inferred = modality === 'video' || modality === 'audio' || modality === 'image'
    ? modality
    : inferComfyUiWorkflowModality(id)
  if (inferred === 'audio') return profileCapabilities('audio-base')
  if (inferred === 'video') {
    return /i2v|img2vid|image.?to.?video|ref/i.test(id)
      ? profileCapabilities('video-ref')
      : profileCapabilities('video-base')
  }
  return /i2i|img2img|image.?to.?image|ref/i.test(id)
    ? profileCapabilities('image-ref')
    : profileCapabilities('image-base')
}

export function listComfyUiCatalogModels(modality: ModelModality): CatalogModel[] {
  if (modality !== 'image' && modality !== 'video' && modality !== 'audio') return []
  return data.models
    .filter((m) => m.modality === modality)
    .map((m) => ({
      id: m.id,
      name: m.name,
      modality,
      capabilities: resolveComfyUiModelCapabilities(m.id, modality) ?? undefined
    }))
}
