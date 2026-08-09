import type { CatalogModel, ModelModality } from '@shared/modelProvider'
import catalog from './modelCapabilities.json'

export interface XaiModelEntry {
  id: string
  name: string
  modality: 'image' | 'video'
  profile: string
}

export interface XaiModelCapabilitiesCatalog {
  meta: {
    console: string
    docs: string[]
    note: string
  }
  models: XaiModelEntry[]
  profiles: Record<
    string,
    {
      modality: 'image' | 'video'
      label: string
      capabilities: Record<string, unknown>
    }
  >
}

const data = catalog as XaiModelCapabilitiesCatalog

export function getXaiModelCapabilitiesCatalog(): XaiModelCapabilitiesCatalog {
  return data
}

function profileCapabilities(profileId: string): Record<string, unknown> | null {
  const profile = data.profiles[profileId]
  if (!profile?.capabilities) return null
  return { ...profile.capabilities }
}

/** 按模型 id 解析静态能力（图片节点用 supported_parameters，视频节点用顶层 supported_*） */
export function resolveXaiModelCapabilities(
  modelId: string,
  modality?: 'image' | 'video'
): Record<string, unknown> | null {
  const id = modelId.trim()
  const entry = data.models.find((m) => m.id === id)
  if (entry) return profileCapabilities(entry.profile)

  const mod = modality ?? (/video/i.test(id) ? 'video' : 'image')
  if (mod === 'video') return profileCapabilities('video-grok')
  return profileCapabilities('image-grok')
}

/** 静态目录：图片 / 视频为唯一来源（文本由远端 GET /models 拉取） */
export function listXaiCatalogModels(modality: ModelModality): CatalogModel[] {
  if (modality !== 'image' && modality !== 'video') return []
  return data.models
    .filter((m) => m.modality === modality)
    .map((m) => ({
      id: m.id,
      name: m.name,
      modality,
      capabilities: resolveXaiModelCapabilities(m.id, modality) ?? undefined
    }))
}

/** 远端 GET /models 文本模型过滤：保留 grok-* 对话模型（含 vision 多模态），排除 imagine 图片/视频与 embedding */
export function isXaiTextModelId(modelId: string): boolean {
  const id = modelId.trim()
  if (!/^grok-/i.test(id)) return false
  if (/(imagine|embedding)/i.test(id)) return false
  return true
}
