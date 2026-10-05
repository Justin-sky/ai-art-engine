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
 * 兜底声音名。**只在模型确实是 OpenAI 官方 TTS 时使用**。
 *
 * 各家 TTS 的音色名完全不通用：OpenAI 是 alloy / nova / …，第三方（火山 Seed Audio
 * 之类）是 speaker_id。把 alloy 当「通用默认值」发给第三方模型，上游会直接拒绝
 * —— 实测报错 `speaker alloy not found in speaker_map, speaker_audio, or mega_info`。
 */
export const OPENAI_TTS_FALLBACK_VOICE = data.models.flatMap((model) => model.voices)[0] ?? 'alloy'

/** 该模型是否是本地表里的 OpenAI 官方 TTS（只有它们才认 alloy 那套音色名） */
export function isKnownOpenAiTtsModel(modelId: string): boolean {
  const id = modelId.trim()
  if (!id) return false
  return data.models.some((model) => model.id === id)
}

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
 * 解析实际要发出去的 voice。
 *
 * 优先级：用户显式指定 → 该模型自己声明的首个声音 → OpenAI 官方 TTS 兜底 → **不发**。
 *
 * 最后那条「不发」是要害：模型未知时我们没有任何可靠信息，硬塞一个 OpenAI 音色名
 * 会被上游直接拒（实测第三方语音：`speaker alloy not found in speaker_map`）。
 * 省略 voice 让上游用自己的默认音色，功能可用；瞎猜一个名字则必然报错。
 */
export function resolveOpenAiTtsVoice(modelId: string, requested?: string): string | undefined {
  const wanted = requested?.trim()
  if (wanted) return wanted
  const declared = listOpenAiTtsVoices(modelId)[0]
  if (declared) return declared
  // 只有确实是 OpenAI 官方 TTS 才认 alloy 这套名字
  return isKnownOpenAiTtsModel(modelId) ? OPENAI_TTS_FALLBACK_VOICE : undefined
}
