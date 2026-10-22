import type { CatalogModel, ModelModality } from '@shared/modelProvider'
import catalog from './modelCapabilities.json'

export interface GoogleModelEntry {
  id: string
  name: string
  modality: 'image' | 'video'
  profile: string
}

export interface GoogleModelCapabilitiesCatalog {
  meta: {
    console: string
    docs: string[]
    note: string
  }
  models: GoogleModelEntry[]
  profiles: Record<
    string,
    {
      modality: 'image' | 'video'
      label: string
      capabilities: Record<string, unknown>
    }
  >
}

const data = catalog as GoogleModelCapabilitiesCatalog

export function getGoogleModelCapabilitiesCatalog(): GoogleModelCapabilitiesCatalog {
  return data
}

function profileCapabilities(profileId: string): Record<string, unknown> | null {
  const profile = data.profiles[profileId]
  if (!profile?.capabilities) return null
  return { ...profile.capabilities }
}

/** 按模型 id 解析静态能力（图片节点用 supported_parameters，视频节点用顶层 supported_*） */
export function resolveGoogleModelCapabilities(
  modelId: string,
  modality?: 'image' | 'video'
): Record<string, unknown> | null {
  const id = modelId.trim()
  const entry = data.models.find((m) => m.id === id)
  if (entry) return profileCapabilities(entry.profile)

  const mod = modality ?? (/video|veo/i.test(id) ? 'video' : 'image')
  if (mod === 'video') return profileCapabilities('video-veo31')
  return profileCapabilities('image-gemini')
}

/** 静态目录：图片 / 视频为唯一来源（文本由远端 GET /models 拉取） */
export function listGoogleCatalogModels(modality: ModelModality): CatalogModel[] {
  if (modality !== 'image' && modality !== 'video') return []
  return data.models
    .filter((m) => m.modality === modality)
    .map((m) => ({
      id: m.id,
      name: m.name,
      modality,
      capabilities: resolveGoogleModelCapabilities(m.id, modality) ?? undefined
    }))
}

/**
 * 规范化 Google 模型 id：
 * Google 官方 `GET /v1beta/openai/models` 与原生 `GET /v1beta/models` 返回的 id 均带 `models/` 前缀
 * （如 `models/gemini-2.5-flash`），而 `/chat/completions` 与应用内目录统一使用裸模型名 `gemini-2.5-flash`。
 */
export function normalizeGoogleModelId(modelId: string): string {
  return modelId.trim().replace(/^models\//i, '')
}

/** 远端 GET /models 文本模型过滤：保留 gemini-* 对话模型，排除图片 / 视频 / 音频 / 向量生成模型 */
export function isGoogleTextModelId(modelId: string): boolean {
  const id = normalizeGoogleModelId(modelId)
  if (!/^gemini-/i.test(id)) return false
  if (/(image|veo|video|audio|tts|embedding|imagen|speech|aqa)/i.test(id)) return false
  return true
}
