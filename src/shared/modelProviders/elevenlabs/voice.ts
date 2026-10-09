import type { CatalogModel } from '@shared/modelProvider'
import fallback from './fallbackModels.json'

/**
 * ElevenLabs 的领域知识与线格式映射（可单测）。
 *
 * 传输层走直连 HTTP（`xi-api-key` + snake_case JSON），本文件负责：
 * 1. 规范里有硬性取值或范围的常量（输出格式、音效 model_id、音效数值范围）
 * 2. 模型**类别**的判定 —— 规范没有「这个模型是 TTS 还是转写」，
 *    只能按 `model_id` 命名约定判断（见 elevenModelKind）
 * 3. 请求体构造（线格式 snake_case）与响应解析（兼容 snake / camel）
 *
 * `output_format` **不进 body**：官方约定它是 query；适配器经 `elevenPostAudio` 传。
 */

/* ── 取值常量（规范里是单值或有限枚举） ── */

/** 音效模型的唯一取值 */
export const ELEVEN_SOUND_MODEL = 'eleven_text_to_sound_v2'

/**
 * ElevenLabs `/v1/sound-generation` 对中日韩等表意文字描述会**念出原文**
 * （实测：中文「雷声」STT 回「雷声。」；同语义英文才产出雷声音效）。
 * 对话面板之所以正常，是因为 LLM 会先把描述改写成英文再调工具。
 * 节点路径必须在发上游前自己做这件事。
 */
const SOUND_EFFECT_NON_LATIN_RE =
  /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af\u0600-\u06ff\u0400-\u04ff]/

/** 音效描述是否需要先译成英文再交给 sound-generation */
export function soundEffectPromptNeedsEnglish(prompt: string): boolean {
  return SOUND_EFFECT_NON_LATIN_RE.test(prompt)
}
/** 规范里 TTS 的默认模型 */
export const ELEVEN_DEFAULT_MODEL_ID = 'eleven_multilingual_v2'
/** 转写默认模型：规范里 `scribe_v2` 是当前基线 */
export const ELEVEN_DEFAULT_STT_MODEL = 'scribe_v2'
/** 音乐默认模型：规范里 `music_v2_5` 是最新 */
export const ELEVEN_DEFAULT_MUSIC_MODEL = 'music_v2_5'

/** 音效时长范围（规范原文：at least 0.5 and at most 30；超范围上游 422） */
export const ELEVEN_SOUND_DURATION_MIN = 0.5
export const ELEVEN_SOUND_DURATION_MAX = 30
/** 音效提示词影响力范围（规范原文：between 0 and 1，默认 0.3） */
export const ELEVEN_SOUND_PROMPT_INFLUENCE_MIN = 0
export const ELEVEN_SOUND_PROMPT_INFLUENCE_MAX = 1
export const ELEVEN_SOUND_PROMPT_INFLUENCE_DEFAULT = 0.3

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
} {
  return outputFormat.startsWith('pcm')
    ? { ext: 'wav', format: 'pcm' }
    : { ext: 'mp3', format: 'mp3' }
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

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 读字符串字段：优先 snake_case（线格式），兼容 camelCase */
function pickStr(obj: Record<string, unknown>, snake: string, camel: string): string {
  const a = obj[snake]
  if (typeof a === 'string' && a.trim()) return a.trim()
  const b = obj[camel]
  if (typeof b === 'string' && b.trim()) return b.trim()
  return ''
}

/* ── 请求体（线格式 snake_case；output_format 不在此） ── */

/** 语音合成 body：`POST /v1/text-to-speech/{voice_id}` */
export function buildElevenTtsRequest(input: { text: string; modelId: string }): {
  text: string
  model_id?: string
} {
  const modelId = input.modelId.trim()
  return {
    text: input.text,
    ...(modelId ? { model_id: modelId } : {})
  }
}

/** 多说话人对话 body：`POST /v1/text-to-dialogue` */
export function buildElevenDialogueRequest(input: {
  inputs: Array<{ text: string; voice: string }>
  modelId?: string
}): {
  inputs: Array<{ text: string; voice_id: string }>
  model_id?: string
} {
  const modelId = input.modelId?.trim()
  return {
    inputs: input.inputs.map((row) => ({ text: row.text, voice_id: row.voice })),
    ...(modelId ? { model_id: modelId } : {})
  }
}

/**
 * 音效生成 body：`POST /v1/sound-generation`。
 *
 * 两个数值字段都有**硬范围**（duration 0.5–30、prompt_influence 0–1），
 * 超出去上游直接 422，所以这里夹紧而不是原样透传。
 *
 * `model_id` 只认唯一取值：传别的会被上游拒（踩过的坑：音效节点复用了
 * 声音节点的模型选择器，用户选的是 TTS 模型）。
 */
export function buildElevenSoundRequest(input: {
  text: string
  loop?: boolean
  durationSeconds?: number
  promptInfluence?: number
}): {
  text: string
  model_id: string
  loop?: boolean
  duration_seconds?: number
  prompt_influence?: number
} {
  const request: {
    text: string
    model_id: string
    loop?: boolean
    duration_seconds?: number
    prompt_influence?: number
  } = {
    text: input.text.trim(),
    model_id: ELEVEN_SOUND_MODEL
  }
  // 显式 false 不写进去（避免用 false 覆盖上游默认）
  if (input.loop) request.loop = true
  if (typeof input.durationSeconds === 'number' && Number.isFinite(input.durationSeconds)) {
    request.duration_seconds = clampNumber(
      input.durationSeconds,
      ELEVEN_SOUND_DURATION_MIN,
      ELEVEN_SOUND_DURATION_MAX
    )
  }
  if (typeof input.promptInfluence === 'number' && Number.isFinite(input.promptInfluence)) {
    request.prompt_influence = clampNumber(
      input.promptInfluence,
      ELEVEN_SOUND_PROMPT_INFLUENCE_MIN,
      ELEVEN_SOUND_PROMPT_INFLUENCE_MAX
    )
  }
  return request
}

/** 音乐模型的合法取值 */
export const ELEVEN_MUSIC_MODELS = ['music_v1', 'music_v2', 'music_v2_5'] as const
export type ElevenMusicModel = (typeof ELEVEN_MUSIC_MODELS)[number]

/**
 * 收窄音乐模型：只放行规范认可的取值。
 *
 * 音乐模型**不在音频模态目录里**，主进程解析活跃提供商时可能退回到声音页签里勾的
 * TTS 模型（如 eleven_v3），原样发出去就是上游 422。认不出就退回默认 music_v2_5。
 */
export function resolveElevenMusicModel(modelId?: string): ElevenMusicModel {
  const wanted = modelId?.trim()
  return (ELEVEN_MUSIC_MODELS as readonly string[]).includes(wanted ?? '')
    ? (wanted as ElevenMusicModel)
    : ELEVEN_DEFAULT_MUSIC_MODEL
}

/**
 * 音乐生成 body：`POST /v1/music`。
 *
 * 字段：`prompt` / `lyrics_text` / `force_instrumental` / `model_id`。
 */
export function buildElevenMusicRequest(input: {
  prompt: string
  lyrics?: string
  instrumental?: boolean
  modelId?: string
}): {
  prompt: string
  lyrics_text?: string
  force_instrumental: boolean
  model_id: ElevenMusicModel
} {
  const lyrics = input.lyrics?.trim()
  return {
    prompt: input.prompt.trim(),
    ...(lyrics ? { lyrics_text: lyrics } : {}),
    // 缺省纯音乐（与 GenerateMusicInput.instrumental 的语义一致）
    force_instrumental: input.instrumental !== false,
    model_id: resolveElevenMusicModel(input.modelId)
  }
}

/* ── 模型类别 ── */

export type ElevenModelKind = 'tts' | 'stt' | 'music' | 'sfx' | 'other'

/**
 * 按 id 判断模型类别。
 *
 * - `scribe_*` → 语音转文字
 * - `music_*` → 音乐生成
 * - `eleven_text_to_sound_*` → 音效
 * - 其余 `eleven_*` → TTS
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

/** 模型目录条目：`GET /v1/models` → CatalogModel（兼容 snake / camel） */
export function parseElevenModels(models: unknown): CatalogModel[] {
  const list = Array.isArray(models) ? models : []
  const out: CatalogModel[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const id = pickStr(item, 'model_id', 'modelId')
    if (!id) continue
    const languagesRaw = item.languages
    const languages = (Array.isArray(languagesRaw) ? languagesRaw : [])
      .map((language) => {
        if (!language || typeof language !== 'object') return ''
        const name = (language as { name?: unknown }).name
        return typeof name === 'string' ? name.trim() : ''
      })
      .filter(Boolean)
    const name = pickStr(item, 'name', 'name') || id
    const description = pickStr(item, 'description', 'description')
    const canDo =
      item.can_do_text_to_speech === false || item.canDoTextToSpeech === false ? false : undefined
    out.push({
      id,
      name,
      ...(description ? { description } : {}),
      modality: 'audio',
      capabilities: {
        ...(languages.length ? { languages } : {}),
        elevenKind: elevenModelKind(id),
        ...(canDo === false ? { canDoTextToSpeech: false } : {})
      }
    })
  }
  return out
}

/** 按类别筛模型（选型时用）；标注缺失时回退到 id 约定 */
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

/**
 * 取某一类别的模型；**这一类为空时用本地表补齐**（按 id 去重）。
 *
 * `GET /v1/models` 并不列举所有能力 —— 实测账号返回的是 TTS 等模型，
 * **音乐模型不在其中**。只在「整条响应为空」时兜底会让音乐页签永远为空。
 */
export function listElevenModelsOfKind(
  models: CatalogModel[],
  kind: ElevenModelKind
): CatalogModel[] {
  const matched = filterElevenModelsByKind(models, kind)
  if (matched.length) return matched
  const seen = new Set(matched.map((m) => m.id))
  for (const fallbackModel of filterElevenModelsByKind(listElevenFallbackModels(), kind)) {
    if (seen.has(fallbackModel.id)) continue
    seen.add(fallbackModel.id)
    matched.push(fallbackModel)
  }
  return matched
}

/** 离线兜底的模型表（同时是「模型类别」的事实来源） */
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

/** 该 id 是否是本地表里的已知模型 */
export function isKnownElevenModel(modelId: string): boolean {
  const id = modelId.trim()
  if (!id) return false
  return listElevenFallbackModels().some((m) => m.id === id)
}

/* ── 音色 ── */

export interface ElevenVoiceEntry {
  id: string
  /** 展示名：`Sarah - Mature, Reassuring, Confident` */
  label: string
  category?: string
}

/**
 * `GET /v1/voices` 响应 → 音色条目（兼容 snake / camel）。
 *
 * 实测（不带 Key 时该端点也返回 200）：21 个 premade 音色；
 * 带 Key 时同一端点会额外返回用户自己的克隆音色。
 */
export function parseElevenVoices(response: unknown): ElevenVoiceEntry[] {
  const root =
    response && typeof response === 'object' ? (response as Record<string, unknown>) : null
  const voices = Array.isArray(root?.voices) ? root!.voices : []
  const out: ElevenVoiceEntry[] = []
  for (const raw of voices) {
    if (!raw || typeof raw !== 'object') continue
    const voice = raw as Record<string, unknown>
    const id = pickStr(voice, 'voice_id', 'voiceId')
    if (!id) continue
    out.push({
      id,
      label: pickStr(voice, 'name', 'name') || id,
      ...(voice.category != null ? { category: String(voice.category) } : {})
    })
  }
  return out
}

/* ── 转写 ── */

/**
 * `POST /v1/speech-to-text` 响应 → 转写结果（兼容 snake / camel）。
 *
 * 只用 `type === 'word'` 的词：规范里该数组也会混入 `spacing` / `audio_event`。
 * 按**句读**切段（词级时间戳直接当分段会碎成一个个词）。
 */
export function parseElevenTranscript(
  response: unknown,
  modelId: string
): {
  segments: Array<{ startSec: number; endSec: number; text: string }>
  text?: string
  model: string
  language?: string
} {
  const root =
    response && typeof response === 'object' ? (response as Record<string, unknown>) : null
  const words = Array.isArray(root?.words) ? root!.words : []
  const fullText = typeof root?.text === 'string' ? root.text.trim() : ''
  const language = root ? pickStr(root, 'language_code', 'languageCode') : ''
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
  for (const raw of words) {
    if (!raw || typeof raw !== 'object') continue
    const word = raw as Record<string, unknown>
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
