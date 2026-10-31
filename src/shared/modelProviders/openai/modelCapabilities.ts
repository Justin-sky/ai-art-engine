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
  if (!profile?.capabilities || Object.keys(profile.capabilities).length === 0) return null
  return { ...profile.capabilities }
}

/** 按模型 id 解析静态能力（图片返回 supported_parameters；文本返回 null） */
export function resolveOpenAiModelCapabilities(
  modelId: string,
  modality?: 'text' | 'image'
): Record<string, unknown> | null {
  const id = modelId.trim()
  const entry = data.models.find((m) => m.id === id)
  if (entry) {
    if (entry.modality !== 'image' && modality !== 'image') return null
    return profileCapabilities(entry.profile)
  }

  const mod = modality ?? (/gpt-image|dall/i.test(id) ? 'image' : 'text')
  if (mod === 'image') {
    if (/dall-?e-?3/i.test(id)) return profileCapabilities('image-dalle3')
    if (/dall-?e-?2/i.test(id)) return profileCapabilities('image-dalle2')
    return profileCapabilities('image-gpt')
  }
  return null
}

/** 内置目录（支持 text 与 image：包含最新 GPT-6.1 / GPT-6 / GPT-5.x / o 系列与 GPT Image 系列） */
export function listOpenAiCatalogModels(modality: ModelModality): CatalogModel[] {
  if (modality !== 'text' && modality !== 'image') return []
  return data.models
    .filter((m) => m.modality === modality)
    .map((m) => ({
      id: m.id,
      name: m.name,
      modality,
      ...(modality === 'image'
        ? { capabilities: resolveOpenAiModelCapabilities(m.id, 'image') ?? undefined }
        : {})
    }))
}

/**
 * OpenAI GET /models 返回所有模型（含图片 / 语音 / 嵌入等），
 * 按 id 过滤出可走 chat/completions 的文本模型（兼容带 openai/ 或 models/ 前缀以及 codex 系列）。
 */
export function isOpenAiTextModelId(modelId: string): boolean {
  const id = modelId.trim()
  if (!/^(?:(?:openai|models)\/)?(?:gpt|o[0-9]|chatgpt|codex)/i.test(id)) return false
  if (
    /(realtime|whisper|tts|embedding|dall|image|audio|speech|moderation|transcription|translation|video|sora)/i.test(
      id
    )
  ) {
    return false
  }
  return true
}

/** 识别远端 /models 中的图片生成模型 */
export function isOpenAiImageModelId(modelId: string): boolean {
  const id = modelId.trim()
  return /(?:gpt-image|chatgpt-image|dall-?e|dalle)/i.test(id)
}

/**
 * OpenAI 常见裸版本号 / 旧别名向真实 API 模型 ID 归一化映射。
 */
const OPENAI_TEXT_MODEL_ALIASES: Readonly<Record<string, string>> = {
  'gpt-6.1': 'gpt-6.1-sol',
  'gpt-6.1-pro': 'gpt-6.1-sol',
  'gpt-6.1-mini': 'gpt-6.1-terra',
  'gpt-6.1-nano': 'gpt-6.1-terra',
  'gpt-6': 'gpt-6-astra',
  'gpt-6-pro': 'gpt-6-astra',
  'gpt-6-mini': 'gpt-6-luna',
  'gpt-5.6': 'gpt-5.6-sol',
  'gpt-5.6-pro': 'gpt-5.6-sol',
  'gpt-5.6-mini': 'gpt-5.6-terra'
}

/**
 * 在 `/v1/chat/completions` 上不支持携带 `tools`（因其不支持 `reasoning_effort: 'none'`）的模型，
 * 在带工具调用（如 AI 对话 dsh-agent）时自动映射到同代支持工具调用的模型。
 */
const OPENAI_CHAT_TOOLS_MODEL_MAP: Readonly<Record<string, string>> = {
  'gpt-6.1-sol': 'gpt-6.1-terra',
  'gpt-6-astra': 'gpt-6-sol'
}

export const OPENAI_CHAT_FALLBACK_MODELS: readonly string[] = [
  'gpt-6.1-terra',
  'gpt-6-sol',
  'gpt-5.5',
  'gpt-5.4',
  'gpt-4.1',
  'gpt-4o'
]

export function normalizeOpenAiTextModelId(
  modelId: string,
  options?: { hasTools?: boolean }
): string {
  const trimmed = modelId.trim()
  if (!trimmed) return trimmed
  const lower = trimmed.toLowerCase()
  const mapped = OPENAI_TEXT_MODEL_ALIASES[lower] ?? trimmed
  if (options?.hasTools) {
    return OPENAI_CHAT_TOOLS_MODEL_MAP[mapped.toLowerCase()] ?? mapped
  }
  return mapped
}

/**
 * 提取模型版本号用于排序（如 gpt-6.1 → 6.1，gpt-5.5 → 5.5，o4-mini → 4.0），
 * 让高版本模型始终排在前面。
 */
function extractModelVersionScore(modelId: string): number {
  const id = modelId
    .trim()
    .toLowerCase()
    .replace(/^(?:openai|models)\//, '')
  const gptMatch = /^gpt-(\d+(?:\.\d+)?)/.exec(id)
  if (gptMatch) return 100 + parseFloat(gptMatch[1]!)
  const oMatch = /^o(\d+(?:\.\d+)?)/.exec(id)
  if (oMatch) return 80 + parseFloat(oMatch[1]!)
  const imageMatch = /^gpt-image-(\d+(?:\.\d+)?)/.exec(id)
  if (imageMatch) return 90 + parseFloat(imageMatch[1]!)
  if (id.startsWith('chatgpt-')) return 75
  if (id.startsWith('codex-')) return 70
  return 0
}

/**
 * 将远端 GET /models 返回的模型与本地内置最新模型表合并去重：
 * - 内置最新模型（如 gpt-6.1 / gpt-6 / gpt-5.5 等）优先展示在顶部，避免上游 /models 未同步最新模型时缺失
 * - 远端独有的快照或扩展模型紧随其后，并按版本号从高到低排列
 */
export function mergeOpenAiCatalogWithBuiltin(
  remoteModels: readonly CatalogModel[],
  modality: 'text' | 'image'
): CatalogModel[] {
  const builtin = listOpenAiCatalogModels(modality)
  const remoteById = new Map<string, CatalogModel>()
  for (const m of remoteModels) {
    const id = m.id.trim()
    if (!id || remoteById.has(id)) continue
    remoteById.set(id, m)
  }

  const merged: CatalogModel[] = []
  const seen = new Set<string>()

  for (const item of builtin) {
    const remote = remoteById.get(item.id)
    seen.add(item.id)
    merged.push({
      ...item,
      name: item.name || remote?.name || item.id,
      ...(remote?.description ? { description: remote.description } : {}),
      ...(item.capabilities || remote?.capabilities
        ? { capabilities: { ...(remote?.capabilities ?? {}), ...(item.capabilities ?? {}) } }
        : {})
    })
  }

  const extras: CatalogModel[] = []
  for (const [id, remote] of remoteById.entries()) {
    if (seen.has(id)) continue
    seen.add(id)
    extras.push({
      ...remote,
      id,
      name: remote.name?.trim() || id,
      modality,
      ...(modality === 'image' && !remote.capabilities
        ? { capabilities: resolveOpenAiModelCapabilities(id, 'image') ?? undefined }
        : {})
    })
  }

  extras.sort((a, b) => {
    const scoreDiff = extractModelVersionScore(b.id) - extractModelVersionScore(a.id)
    if (scoreDiff !== 0) return scoreDiff
    return b.id.localeCompare(a.id)
  })

  return [...merged, ...extras]
}
