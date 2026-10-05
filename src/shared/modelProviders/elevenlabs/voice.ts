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
 * 模型类别。
 *
 * `GET /v1/models` **不含**「是 TTS 还是转写 / 音乐 / 音效」的能力位 ——
 * 规范里只有 `can_do_text_to_speech` / `can_do_voice_conversion` / `can_use_style`。
 * 所以类别只能按 model_id 约定判断，本文件的 `elevenModelKind` 就是那个约定的唯一登记处。
 */
export type ElevenModelKind = 'tts' | 'stt' | 'music' | 'sfx' | 'other'

/**
 * 按 id 判断模型类别。
 *
 * 依据是官方 openapi.json 里出现过的 model_id 命名：
 * - `scribe_*`（scribe_v2 / _turbo / _medical）→ 语音转文字
 * - `music_*`（music_v1 / v2 / v2_5）→ 音乐生成
 * - `eleven_text_to_sound_*` → 音效
 * - 其余 `eleven_*`（v3 / multilingual_v2 / turbo / flash …）→ TTS
 * 认不出的返回 'other'，由调用方决定要不要收。
 */
export function elevenModelKind(modelId: string): ElevenModelKind {
  const id = modelId.trim().toLowerCase()
  if (!id) return 'other'
  if (id.startsWith('scribe')) return 'stt'
  if (id.startsWith('music_')) return 'music'
  if (id.includes('sound_effects') || id.startsWith('eleven_text_to_sound')) return 'sfx'
  if (id.startsWith('eleven_')) return 'tts'
  return 'other'
}

/**
 * 把 `GET /v1/models` 的响应归一成目录条目。
 *
 * 保留**所有**条目并在 capabilities 里带上类别：各调用点按需分流
 * （声音节点要 tts、时间线转写要 stt、BGM 要 music）。
 * 之前只留 TTS 会让这三条各自缺选项。
 */
export function parseElevenModels(body: unknown): CatalogModel[] {
  // 实测：无 Key 时该端点的响应体不是数组（拿不到目录），这种情况交给兜底表
  const rows = Array.isArray(body) ? body : []
  const out: CatalogModel[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    const id = typeof item.model_id === 'string' ? item.model_id.trim() : ''
    if (!id) continue
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
      capabilities: {
        ...(languages.length ? { languages } : {}),
        elevenKind: elevenModelKind(id),
        // 规范里确实有这一位，用它同时校验 id 约定（认不出的 TTS 才算数）
        ...(item.can_do_text_to_speech === false ? { canDoTextToSpeech: false } : {})
      }
    })
  }
  return out
}

/** 按类别筛模型（选型时用） */
export function filterElevenModelsByKind(
  models: CatalogModel[],
  kind: ElevenModelKind
): CatalogModel[] {
  return models.filter((model) => {
    const declared = model.capabilities?.elevenKind
    if (typeof declared === 'string') return declared === kind
    return elevenModelKind(model.id) === kind
  })
}

/** 语音转文字端点（multipart/form-data；响应是 JSON） */
export const ELEVEN_STT_PATH = '/v1/speech-to-text'
/** 音乐生成端点（JSON；响应是音频字节） */
export const ELEVEN_MUSIC_PATH = '/v1/music'

/** 转写默认模型：规范里 `scribe_v2` 是当前基线 */
export const ELEVEN_DEFAULT_STT_MODEL = 'scribe_v2'
/** 音乐默认模型：规范里 `music_v2_5` 是最新 */
export const ELEVEN_DEFAULT_MUSIC_MODEL = 'music_v2_5'

/**
 * 音乐生成请求体。
 *
 * 规范里 `required: []`（可只给 prompt），字段名与取值都按 openapi.json 来：
 * `prompt` / `lyrics_text` / `force_instrumental` / `model_id`(music_v1|v2|v2_5)。
 */
export function buildElevenMusicBody(input: {
  prompt: string
  lyrics?: string
  instrumental?: boolean
  modelId?: string
}): Record<string, unknown> {
  const body: Record<string, unknown> = { prompt: input.prompt.trim() }
  const lyrics = input.lyrics?.trim()
  if (lyrics) body.lyrics_text = lyrics
  // 缺省纯音乐（与 GenerateMusicInput.instrumental 的语义一致）
  body.force_instrumental = input.instrumental !== false
  const modelId = input.modelId?.trim()
  if (modelId) body.model_id = modelId
  return body
}

/** 转写响应里的词级时间戳 */
interface ElevenTranscriptWord {
  text?: unknown
  start?: unknown
  end?: unknown
  type?: unknown
}

/**
 * 把 `POST /v1/speech-to-text` 的响应映射成既有的转写结果。
 *
 * 只用 `type === 'word'` 的词：规范里该数组也会混入 `spacing` / `audio_event`，
 * 把它们当正文会把「空格」拼进字幕。
 * 按**句读**切段（词级时间戳直接当分段会碎成一个个词，时间线没法用）。
 */
export function parseElevenTranscript(
  body: unknown,
  modelId: string
): {
  segments: Array<{ startSec: number; endSec: number; text: string }>
  text?: string
  model: string
  language?: string
} {
  const item = (body ?? {}) as Record<string, unknown>
  const words = (Array.isArray(item.words) ? item.words : []) as ElevenTranscriptWord[]
  const fullText = typeof item.text === 'string' ? item.text.trim() : ''
  const language = typeof item.language_code === 'string' ? item.language_code.trim() : ''
  const segments: Array<{ startSec: number; endSec: number; text: string }> = []
  // 句读边界：中文句号/问号/叹号/分号 + 西文 .!?;
  const boundary = /[。！？；!?;]/

  let bucket = ''
  let startSec = 0
  let endSec = 0
  const flush = (): void => {
    const text = bucket.trim()
    if (text) segments.push({ startSec, endSec, text })
    bucket = ''
  }
  for (const word of words) {
    if (word.type !== 'word') continue
    const text = typeof word.text === 'string' ? word.text : ''
    if (!text) continue
    if (!bucket.trim()) startSec = Number(word.start) || 0
    endSec = Number.isFinite(Number(word.end)) ? Number(word.end) : endSec
    bucket += text
    if (boundary.test(text)) flush()
  }
  flush()

  if (!segments.length && fullText) {
    // 没有词级时间戳（如请求未要 timestamps）时退化为整段
    segments.push({ startSec: 0, endSec: 0, text: fullText })
  }
  return {
    segments,
    ...(fullText || segments.length
      ? { text: fullText || segments.map((s) => s.text).join('') }
      : {}),
    model: modelId,
    ...(language ? { language } : {})
  }
}

/** 音色目录条目：选择器要显示名字，生成时用 voice_id */
export interface ElevenVoiceEntry {
  id: string
  /** 展示名：`Sarah - Mature, Reassuring, Confident` */
  label: string
  category?: string
}

/**
 * 离线兜底的模型表（同时是「模型类别」的事实来源）。
 *
 * 正常路径是拉 `GET /v1/models`（官方有该端点），但该端点不含类别能力位，
 * 所以类别靠 id 约定；这份表把约定显式登记下来，拉取失败时也仍有可用选项。
 */
export function listElevenFallbackModels(): CatalogModel[] {
  const rows = (
    fallback as {
      models?: Array<{ id?: string; name?: string; note?: string; kind?: string }>
    }
  ).models
  return (rows ?? [])
    .filter((row): row is { id: string; name?: string; note?: string; kind?: string } =>
      Boolean(row.id?.trim())
    )
    .map((row) => {
      const id = row.id.trim()
      return {
        id,
        name: row.name?.trim() || id,
        modality: 'audio' as const,
        ...(row.note ? { description: row.note } : {}),
        capabilities: { elevenKind: row.kind ?? elevenModelKind(id) }
      }
    })
}

/** 该 id 是否是本地表里的 TTS 模型（音色兜底解析用） */
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
