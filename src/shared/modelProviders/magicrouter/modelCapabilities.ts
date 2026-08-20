import type { CatalogModel, ModelModality } from '@shared/modelProvider'
import catalog from './modelCapabilities.json'

export interface MagicRouterModelEntry {
  id: string
  name: string
  modality: 'text' | 'image' | 'video'
  profile: string
}

export interface MagicRouterModelCapabilitiesCatalog {
  meta: {
    console: string
    docs: string[]
    note: string
  }
  models: MagicRouterModelEntry[]
  profiles: Record<
    string,
    {
      modality: 'text' | 'image' | 'video'
      label: string
      capabilities: Record<string, unknown>
    }
  >
}

const data = catalog as MagicRouterModelCapabilitiesCatalog

export function getMagicRouterModelCapabilitiesCatalog(): MagicRouterModelCapabilitiesCatalog {
  return data
}

function profileCapabilities(profileId: string): Record<string, unknown> | null {
  const profile = data.profiles[profileId]
  if (!profile?.capabilities) return null
  return { ...profile.capabilities }
}

function inferProfile(modelId: string, modality: ModelModality): string {
  const id = modelId.trim().toLowerCase()
  if (modality === 'image') return /edit/.test(id) ? 'image-ref' : 'image-base'
  if (modality === 'video') {
    if (/videoedit/.test(id)) return 'video-videoedit'
    if (/r2v/.test(id)) return 'video-r2v'
    if (/i2v/.test(id)) return 'video-i2v'
    return 'video-t2v'
  }
  return 'text-base'
}

/** 按模型 id 解析静态能力；未收录时按型号/模态启发式回退 */
export function resolveMagicRouterModelCapabilities(
  modelId: string,
  modality?: ModelModality
): Record<string, unknown> | null {
  const id = modelId.trim()
  const entry = data.models.find((m) => m.id === id)
  if (entry) return profileCapabilities(entry.profile)

  const mod: ModelModality =
    modality ??
    (/t2v|i2v|r2v|videoedit|video/i.test(id)
      ? 'video'
      : /image/i.test(id)
        ? 'image'
        : 'text')
  return profileCapabilities(inferProfile(id, mod))
}

/** 设置页「拉取模型」：返回静态目录 */
export function listMagicRouterCatalogModels(modality: ModelModality): CatalogModel[] {
  if (modality !== 'text' && modality !== 'image' && modality !== 'video') return []
  return data.models
    .filter((m) => m.modality === modality)
    .map((m) => ({
      id: m.id,
      name: m.name,
      modality,
      capabilities: resolveMagicRouterModelCapabilities(m.id, modality) ?? undefined
    }))
}

/** /models/live 的 chat / image / video 分类 id → 目录条目 */
export function toMagicRouterCatalogModels(
  modality: ModelModality,
  ids: string[]
): CatalogModel[] {
  const seen = new Set<string>()
  const out: CatalogModel[] = []
  for (const raw of ids) {
    const id = raw.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      name: id,
      modality,
      capabilities: resolveMagicRouterModelCapabilities(id, modality) ?? undefined
    })
  }
  return out
}
