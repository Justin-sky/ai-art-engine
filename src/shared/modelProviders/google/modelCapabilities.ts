import {
  GOOGLE_DEFAULT_BASE_URL,
  type CatalogModel,
  type ModelModality
} from '@shared/modelProvider'
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
 * 规范化 Google Gemini OpenAI 兼容层 Base URL：
 * - 空值回退官方 `https://generativelanguage.googleapis.com/v1beta/openai`
 * - 若用户填了官方根域名或 `/v1beta`（漏写 `/openai`），自动补齐 `/v1beta/openai`
 */
export function resolveGoogleOpenAiBaseUrl(rawBaseUrl?: string): string {
  const trimmed = (rawBaseUrl ?? '').trim().replace(/\/+$/, '')
  if (!trimmed) return GOOGLE_DEFAULT_BASE_URL
  if (/^https?:\/\/generativelanguage\.googleapis\.com$/i.test(trimmed)) {
    return `${trimmed}/v1beta/openai`
  }
  if (/^https?:\/\/generativelanguage\.googleapis\.com\/v1(?:beta)?$/i.test(trimmed)) {
    return `${trimmed}/openai`
  }
  return trimmed
}

/**
 * 推导 Google Gemini 原生 REST API 根路径（如 `https://generativelanguage.googleapis.com/v1beta`）：
 * - 供 Gemini / Nano Banana 原生 `:generateContent` 生图与多模态接口使用
 * - 若传入 `nativeBaseUrl` 则优先采用；否则从 `baseUrl` 剥离末尾 `/openai`
 */
export function resolveGoogleNativeBaseUrl(rawBaseUrl?: string, rawNativeBaseUrl?: string): string {
  const nativeTrimmed = (rawNativeBaseUrl ?? '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/openai$/i, '')
  if (nativeTrimmed) {
    if (/^https?:\/\/generativelanguage\.googleapis\.com$/i.test(nativeTrimmed)) {
      return `${nativeTrimmed}/v1beta`
    }
    return nativeTrimmed
  }
  const baseTrimmed = (rawBaseUrl ?? '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/openai$/i, '')
  if (!baseTrimmed) return 'https://generativelanguage.googleapis.com/v1beta'
  if (/^https?:\/\/generativelanguage\.googleapis\.com$/i.test(baseTrimmed)) {
    return `${baseTrimmed}/v1beta`
  }
  if (/\/v1$/i.test(baseTrimmed) && !/\/v1beta$/i.test(baseTrimmed)) {
    return baseTrimmed.replace(/\/v1$/i, '/v1beta')
  }
  return baseTrimmed
}

/** 是否指向 Google 官方 generativelanguage.googleapis.com 端点（空值默认走官方） */
export function isOfficialGoogleBaseUrl(rawBaseUrl?: string): boolean {
  const trimmed = (rawBaseUrl ?? '').trim()
  if (!trimmed) return true
  return /generativelanguage\.googleapis\.com/i.test(trimmed)
}

/**
 * 是否为走原生 `:generateContent` 协议的 Gemini / Nano Banana 生图模型。
 * Google 官方 `/v1beta/openai/images/generations` 仅映射 `predict`（Imagen 系列），
 * 对 `gemini-*-image*` / `nano-banana*` 会报 404（is not supported for predict），
 * 且不接受 `resolution` / `image` 字段。
 */
export function isGoogleNativeImageModelId(modelId: string): boolean {
  const id = normalizeGoogleModelId(modelId)
  if (!id) return false
  if (/^imagen-/i.test(id)) return false
  return /^(?:gemini-|nano-banana)/i.test(id)
}

/**
 * 将节点清晰度（`1K` / `2K` / `4K`）规范化为 Gemini `imageConfig.imageSize` 枚举值；
 * 非标准值（如 `auto` / `1024x1024`）返回 `undefined`，避免上游 schema 校验报错。
 */
export function normalizeGoogleImageSize(resolution?: string): '1K' | '2K' | '4K' | undefined {
  const upper = (resolution ?? '').trim().toUpperCase()
  if (upper === '1K' || upper === '2K' || upper === '4K') return upper
  return undefined
}

/**
 * Veo 3.1 视频时长吸附：
 * 官方 `/v1beta/openai/videos` 与 `:predictLongRunning` 仅接受 `4`、`6`、`8` 秒（传 5 或 7 会报
 * `400 The number value for durationSeconds is out of bound`），且字段名为 `duration_seconds`。
 */
export function snapGoogleVeoDuration(duration?: number): 4 | 6 | 8 {
  if (duration == null || !Number.isFinite(duration)) return 8
  if (duration <= 4) return 4
  if (duration <= 6) return 6
  return 8
}

/**
 * Veo 3.1 视频清晰度规范化：
 * 官方仅接受小写 `'720p'` | `'1080p'` | `'4k'`（传大写 `'4K'` 会报 `The string value '4K' for 'resolution' is invalid`）。
 */
export function normalizeGoogleVeoResolution(
  resolution?: string
): '720p' | '1080p' | '4k' | undefined {
  const lower = (resolution ?? '').trim().toLowerCase()
  if (lower === '720p' || lower === '1080p' || lower === '4k') return lower
  return undefined
}

/**
 * Veo 3.1 视频画幅比例规范化：
 * 官方仅支持 `'16:9'` 与 `'9:16'`（传 `'1:1'` / `'4:3'` / `'3:4'` 会报 `400 aspectRatio does not support ...`）。
 */
export function normalizeGoogleVeoAspectRatio(aspectRatio?: string): '16:9' | '9:16' | undefined {
  const trimmed = (aspectRatio ?? '').trim()
  if (!trimmed) return undefined
  if (trimmed === '9:16' || trimmed === '3:4' || trimmed === '2:3') return '9:16'
  return '16:9'
}

/**
 * 规范化 Google 模型 id：
 * Google 官方 `GET /v1beta/openai/models` 与原生 `GET /v1beta/models` 返回的 id 均带 `models/` 前缀
 * （如 `models/gemini-2.5-flash`），而 `/chat/completions` 与应用内目录统一使用裸模型名 `gemini-2.5-flash`。
 */
export function normalizeGoogleModelId(modelId: string): string {
  return modelId.trim().replace(/^models\//i, '')
}

/**
 * 将用户选中的 Google 文本模型 ID 规范化为可通过 HTTP `/chat/completions` 调用的模型名：
 * - 剥离 `models/` 前缀
 * - 若旧配置中误选了仅支持 WebSocket Live API (`bidiGenerateContent`) 的 `*-live*` 模型
 *   （如 `gemini-3.8-live` / `gemini-3.8-live-extended-thinking` / `gemini-3.1-flash-live-preview`），
 *   自动映射到同代标准 Flash 对话模型，避免 HTTP 400 无响应。
 */
export function resolveGoogleChatModelId(modelId: string): string {
  const id = normalizeGoogleModelId(modelId)
  if (!id) return id
  const versionLiveMatch = /^gemini-(\d+(?:\.\d+)?)-live(?:-.*)?$/i.exec(id)
  if (versionLiveMatch) {
    return `gemini-${versionLiveMatch[1]}-flash`
  }
  if (/live/i.test(id)) {
    return 'gemini-flash-latest'
  }
  return id
}

/**
 * Google 官方端点在高峰期（503 high demand）或旧模型下线（404）时的自动回退候选序列。
 */
export const GOOGLE_CHAT_FALLBACK_MODELS: readonly string[] = [
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-flash-latest',
  'gemini-3-flash-preview'
]

/** 远端 GET /models 文本模型过滤：保留 gemini-* 对话模型，排除图片 / 视频 / 音频 / 向量 / WebSocket Live 模型 */
export function isGoogleTextModelId(modelId: string): boolean {
  const id = normalizeGoogleModelId(modelId)
  if (!/^gemini-/i.test(id)) return false
  if (
    /(image|veo|video|audio|tts|embedding|imagen|speech|aqa|live|transcribe|computer-use|robotics-er-.*-streaming)/i.test(
      id
    )
  ) {
    return false
  }
  return true
}
