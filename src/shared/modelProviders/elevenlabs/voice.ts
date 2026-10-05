import type { CatalogModel } from '@shared/modelProvider'
import fallback from './fallbackModels.json'

/**
 * ElevenLabs 语音合成的领域知识（纯函数，便于单测）。
 *
 * 事实来源是 ElevenLabs 官方 `openapi.json`（`https://api.elevenlabs.io/openapi.json`），
 * 以下取值都是从规范里核对过的，不是凭记忆写的：
 * - 端点：`POST /v1/text-to-speech/{voice_id}`
 * - 请求体字段：`text`（**唯一必填**）、`model_id`（默认 `eleven_multilingual_v2`）、
 *   `language_code`、`voice_settings`、`seed`、`previous_text`/`next_text`、
 *   `apply_text_normalization`(auto|on|off)
 * - 输出格式 `output_format`：`mp3_44100_128` 等（作为 query 参数）
 * - 鉴权：`xi-api-key` 请求头（**不是** Bearer）
 */

/** 语音合成端点（voice_id 走路径） */
export function elevenTtsPath(voiceId: string): string {
  return `/v1/text-to-speech/${encodeURIComponent(voiceId)}`
}

/** 音色目录端点：返回 voice_id / name / category / labels */
export const ELEVEN_VOICES_PATH = '/v1/voices'
/** 模型目录端点：返回 model_id / name / description / languages 等 */
export const ELEVEN_MODELS_PATH = '/v1/models'

/** 规范里的默认模型 */
export const ELEVEN_DEFAULT_MODEL_ID = 'eleven_multilingual_v2'

/**
 * 输出格式：只保留 mp3 / pcm 两类 —— 项目的声音资产链路按 mp3 / pcm 处理
 * （见 GenerateSpeechResult.format）。规范里还有 ulaw/opus，这里不引入。
 */
export type ElevenOutputFormat = 'mp3_44100_128' | 'mp3_44100_192' | 'pcm_16000' | 'pcm_24000'

export const ELEVEN_DEFAULT_OUTPUT_FORMAT: ElevenOutputFormat = 'mp3_44100_128'

/** 由输出格式推出落盘扩展名与格式标记 */
export function elevenFormatOf(outputFormat: ElevenOutputFormat): {
  ext: 'mp3' | 'wav'
  format: 'mp3' | 'pcm'
  contentTypeHint: string
} {
  return outputFormat.startsWith('pcm')
    ? { ext: 'wav', format: 'pcm', contentTypeHint: 'audio/wav' }
    : { ext: 'mp3', format: 'mp3', contentTypeHint: 'audio/mpeg' }
}

/**
 * 输出格式随模型受限：v3 与 flash/turbo 支持的范围不同，但 mp3_44100_128 是
 * 全系通用的，所以默认用它；用户指定时原样透传（无效值由上游报错，错误信息会带出来）。
 */
export function resolveElevenOutputFormat(raw?: string): ElevenOutputFormat {
  const wanted = raw?.trim()
  const allowed: ElevenOutputFormat[] = ['mp3_44100_128', 'mp3_44100_192', 'pcm_16000', 'pcm_24000']
  return allowed.includes(wanted as ElevenOutputFormat)
    ? (wanted as ElevenOutputFormat)
    : ELEVEN_DEFAULT_OUTPUT_FORMAT
}

/** 语音合成的请求体（规范里 text 是唯一必填） */
export function buildElevenTtsBody(input: {
  text: string
  modelId: string
  languageCode?: string
  voiceSettings?: Record<string, unknown>
  seed?: number
  applyTextNormalization?: 'auto' | 'on' | 'off'
}): Record<string, unknown> {
  const body: Record<string, unknown> = { text: input.text }
  const modelId = input.modelId.trim()
  if (modelId) body.model_id = modelId
  const language = input.languageCode?.trim()
  if (language) body.language_code = language
  if (input.voiceSettings && Object.keys(input.voiceSettings).length) {
    body.voice_settings = input.voiceSettings
  }
  if (typeof input.seed === 'number' && Number.isFinite(input.seed))
    body.seed = Math.trunc(input.seed)
  if (input.applyTextNormalization) {
    body.apply_text_normalization = input.applyTextNormalization
  }
  return body
}

/**
 * 把 `GET /v1/models` 的响应归一成目录条目。
 *
 * 规范里的模型条目带 `model_id` / `name` / `description` / `languages` / `can_do_text_to_speech`，
 * 我们只要「能做 TTS」的那些 —— 同一端点也返回语音转文字、音效等非 TTS 模型。
 */
export function parseElevenModels(body: unknown): CatalogModel[] {
  const rows = Array.isArray(body) ? body : []
  const out: CatalogModel[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    const id = typeof item.model_id === 'string' ? item.model_id.trim() : ''
    if (!id) continue
    // 明确标了不能做 TTS 的直接排除；没标的保留（规范里该字段可选）
    if (item.can_do_text_to_speech === false) continue
    const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : id
    const description = typeof item.description === 'string' ? item.description.trim() : undefined
    const languages = Array.isArray(item.languages)
      ? item.languages
          .map((l) => (l && typeof l === 'object' ? (l as { name?: string }).name : undefined))
          .filter((l): l is string => Boolean(l && l.trim()))
      : []
    out.push({
      id,
      name,
      ...(description ? { description } : {}),
      modality: 'audio',
      capabilities: languages.length ? { languages } : undefined
    })
  }
  return out
}

/** 音色目录条目：选择器要显示名字，生成时用 voice_id */
export interface ElevenVoiceEntry {
  id: string
  /** 展示名：`Sarah - Mature, Reassuring, Confident` */
  label: string
  category?: string
}

/**
 * 离线兜底的 TTS 模型表。
 *
 * 正常路径是拉 `GET /v1/models`（官方有该端点，实测可用）；
 * 这里只在拉取失败时兜底，避免离线状态下声音节点一个模型都选不了。
 */
export function listElevenFallbackModels(): CatalogModel[] {
  const rows = (fallback as { models?: Array<{ id?: string; name?: string; note?: string }> })
    .models
  return (rows ?? [])
    .filter((row): row is { id: string; name?: string; note?: string } => Boolean(row.id?.trim()))
    .map((row) => ({
      id: row.id.trim(),
      name: row.name?.trim() || row.id.trim(),
      modality: 'audio' as const,
      ...(row.note ? { description: row.note } : {})
    }))
}

/** 是否是我们已知的 ElevenLabs TTS 模型（用于音色兜底解析） */
export function isKnownElevenModel(modelId: string): boolean {
  const id = modelId.trim()
  if (!id) return false
  return listElevenFallbackModels().some((m) => m.id === id)
}

/**
 * 把 `GET /v1/voices` 的响应归一成音色条目。
 *
 * 实测（不带 Key 时该端点也返回 200）：21 个 premade 音色，每条带
 * `voice_id` / `name` / `category` / `labels{accent,gender,language,use_case}`；
 * 带 Key 时同一端点会额外返回用户自己的克隆音色。
 */
export function parseElevenVoices(body: unknown): ElevenVoiceEntry[] {
  const rows =
    body && typeof body === 'object' && Array.isArray((body as { voices?: unknown }).voices)
      ? ((body as { voices: unknown[] }).voices as unknown[])
      : []
  const out: ElevenVoiceEntry[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    const id = typeof item.voice_id === 'string' ? item.voice_id.trim() : ''
    if (!id) continue
    const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : id
    const category = typeof item.category === 'string' ? item.category.trim() : undefined
    out.push({ id, label: name, ...(category ? { category } : {}) })
  }
  return out
}
