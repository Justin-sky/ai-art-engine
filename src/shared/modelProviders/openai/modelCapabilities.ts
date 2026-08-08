import type { CatalogModel, ModelModality } from '@shared/modelProvider'
import catalog from './modelCapabilities.json'

export interface OpenAiModelEntry {
  id: string
  name: string
  modality: 'text' | 'image'
  profile: string
}

export interface OpenAiModelCapabilitiesCatalog {
  meta: {
    console: string
    docs: string[]
    note: string
  }
  models: OpenAiModelEntry[]
  profiles: Record<
    string,
    {
      modality: 'text' | 'image'
      label: string
      capabilities: Record<string, unknown>
    }
  >
}

const data = catalog as OpenAiModelCapabilitiesCatalog

export function getOpenAiModelCapabilitiesCatalog(): OpenAiModelCapabilitiesCatalog {
  return data
}

function profileCapabilities(profileId: string): Record<string, unknown> | null {
  const profile = data.profiles[profileId]
  if (!profile?.capabilities) return null
  return { ...profile.capabilities }
}

/** 按模型 id 解析静态能力（图片）；文本模型从远端 /models 拉取，不在此表 */
export function resolveOpenAiModelCapabilities(
  modelId: string,
  modality?: 'text' | 'image'
): Record<string, unknown> | null {
  const id = modelId.trim()
  const entry = data.models.find((m) => m.id === id)
  if (entry) return profileCapabilities(entry.profile)

  const mod = modality ?? (/gpt-image|dall/i.test(id) ? 'image' : 'text')
  if (mod === 'image') return profileCapabilities('image-gpt')
  return null
}

/** 静态图片目录（设置页 / 图片节点能力回退共用） */
export function listOpenAiCatalogModels(modality: ModelModality): CatalogModel[] {
  if (modality !== 'image') return []
  return data.models
    .filter((m) => m.modality === 'image')
    .map((m) => ({
      id: m.id,
      name: m.name,
      modality,
      capabilities: resolveOpenAiModelCapabilities(m.id, 'image') ?? undefined
    }))
}

/**
 * OpenAI GET /models 返回所有模型（含图片 / 语音 / 嵌入等），
 * 按 id 过滤出可走 chat/completions 的文本模型。
 */
export function isOpenAiTextModelId(modelId: string): boolean {
  const id = modelId.trim()
  if (!/^(gpt|o[0-9]|chatgpt)/i.test(id)) return false
  if (
    /(realtime|whisper|tts|embedding|dall|image|audio|speech|moderation|transcription|translation|video|sora)/i.test(
      id
    )
  ) {
    return false
  }
  return true
}
