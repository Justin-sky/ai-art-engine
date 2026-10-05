import type { CatalogModel } from '@shared/modelProvider'
import catalog from './ttsModels.json'

/**
 * OpenAI 兼容 TTS（`POST /audio/speech`）的静态模型表。
 *
 * 为什么不拉远端：`GET /models` 只给模型 id，不给「这个模型有哪些声音」，
 * 而声音是 TTS 必需的请求字段——没有它设置页只能让用户盲填。
 * 表在本地维护；聚合器上没有列出的模型，用「手填模型 id + 手填声音」照样能用。
 */
export interface OpenAiTtsEntry {
  id: string
  name: string
  voices: string[]
}

export interface OpenAiTtsCatalog {
  meta: {
    endpoint: string
    docs: string[]
    note: string
  }
  models: OpenAiTtsEntry[]
}

const data = catalog as OpenAiTtsCatalog

/**
 * TTS 模型的兜底声音。取静态表里任一模型的首个声音：
 * 各家实现都以 alloy 为首（OpenAI 的默认音色），盲选它最不容易被拒。
 */
export const OPENAI_TTS_FALLBACK_VOICE = data.models.flatMap((model) => model.voices)[0] ?? 'alloy'

export function getOpenAiTtsCatalog(): OpenAiTtsCatalog {
  return data
}

/** 已知 TTS 模型 id 列表（设置页静态目录用） */
export function listOpenAiTtsCatalogModels(): CatalogModel[] {
  return data.models.map((model) => ({
    id: model.id,
    name: model.name,
    modality: 'audio' as const,
    capabilities: { supported_voices: [...model.voices] }
  }))
}

/**
 * 该 TTS 模型支持的声音；未知模型返回空数组。
 * 返回值用于设置页的声音下拉，以及生成时的校验。
 */
export function listOpenAiTtsVoices(modelId: string): string[] {
  const id = modelId.trim()
  if (!id) return []
  return [...(data.models.find((model) => model.id === id)?.voices ?? [])]
}

/**
 * 未指定声音时的兜底：模型已知就用它自己的首个声音，否则用全局兜底。
 * 声音名各家并不通用（OpenAI 是 alloy/nova/…，别家可能是别的），
 * 所以优先取「该模型自己声明的」，而不是硬编码 alloy 送给所有聚合器。
 */
export function resolveOpenAiTtsVoice(modelId: string, requested?: string): string {
  const wanted = requested?.trim()
  if (wanted) return wanted
  return listOpenAiTtsVoices(modelId)[0] ?? OPENAI_TTS_FALLBACK_VOICE
}
