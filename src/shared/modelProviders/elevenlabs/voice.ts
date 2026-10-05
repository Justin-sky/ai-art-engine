import type { CatalogModel } from '@shared/modelProvider'
import type {
  BodyComposeMusicV1MusicPost,
  BodyTextToDialogueMultiVoiceV1TextToDialoguePost,
  BodyTextToSpeechFull,
  CreateSoundEffectRequest
} from '@elevenlabs/elevenlabs-js/api'
import fallback from './fallbackModels.json'

/**
 * ElevenLabs 的领域知识与纯映射（可单测）。
 *
 * 传输层已改用官方 SDK（`@elevenlabs/elevenlabs-js`），所以这里**不再拼 HTTP 细节**
 * （路径 / query / 请求体字段名都由 SDK 按规范生成）。
 * 本文件保留三类东西：
 * 1. 规范里有硬性取值或范围的常量（输出格式、音效 model_id、音效数值范围）
 * 2. 模型**类别**的判定 —— SDK 与规范都没有「这个模型是 TTS 还是转写」，
 *    只能按 `model_id` 命名约定判断（见 elevenModelKind）
 * 3. SDK 类型 → 我们领域类型的映射（目录条目、音色标签、转写分段）
 *
 * SDK 的响应已经是 **camelCase**（`voiceId` / `languageCode` / `canDoTextToSpeech`），
 * 且会 strip 未知键 —— 所以映射里读的是 camelCase，不再是 snake_case。
 */

/* ── 取值常量（规范/SDK 里是单值或有限枚举） ── */

/** 音效模型的唯一取值：SDK 类型 `SfxModelId = "eleven_text_to_sound_v2"` */
export const ELEVEN_SOUND_MODEL = 'eleven_text_to_sound_v2'
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

/* ── 请求体（SDK 的 camelCase 形状） ── */

/**
 * 语音合成请求体（SDK `textToSpeech.convert`）。
 *
 * **`outputFormat` 放在这里**：SDK 把它定义成请求对象的字段，内部再提取为
 * query 参数（`const { outputFormat } = request, _body = __rest(...)`）。
 * 不要改用 `requestOptions.queryParams` —— 那会覆盖掉 SDK 自己算出的 query，
 * 结果是 URL 上一个参数都不带（踩过这个坑）。
 *
 * 返回值直接用 SDK 的请求体类型：`outputFormat` 在各端点里是不同的受限联合，
 * 让 SDK 兜住比我自己维护一份类型可靠（值本身已由 resolveElevenOutputFormat 白名单校验）。
 */
export function buildElevenTtsRequest(input: {
  text: string
  modelId: string
  outputFormat: ElevenOutputFormat
}): BodyTextToSpeechFull {
  const modelId = input.modelId.trim()
  return {
    text: input.text,
    ...(modelId ? { modelId } : {}),
    outputFormat: input.outputFormat
  }
}

/**
 * 多说话人对话请求体（SDK `textToDialogue.convert`）。
 *
 * SDK 的 `inputs` 元素形状是 `{ text, voiceId }`（camelCase）——
 * 原始 HTTP 字段是 `voice_id`，SDK 负责转换。`outputFormat` 同上走请求对象。
 */
export function buildElevenDialogueRequest(input: {
  inputs: Array<{ text: string; voice: string }>
  modelId?: string
  outputFormat: ElevenOutputFormat
}): BodyTextToDialogueMultiVoiceV1TextToDialoguePost {
  const modelId = input.modelId?.trim()
  return {
    inputs: input.inputs.map((row) => ({ text: row.text, voiceId: row.voice })),
    ...(modelId ? { modelId } : {}),
    outputFormat: input.outputFormat
  }
}

/**
 * 音效生成请求体（SDK `textToSoundEffects.convert`）。
 *
 * 两个数值字段都有**硬范围**（duration 0.5–30、prompt_influence 0–1），
 * 超出去上游直接 422，所以这里夹紧而不是原样透传 —— 用户手填 0.2 或 60 时
 * 应该安静地取到合法值，而不是拿到一条看不懂的上游校验错误。
 *
 * `modelId` 只认唯一取值：SDK 的类型是字面量 `SfxModelId = "eleven_text_to_sound_v2"`，
 * 传别的连编译都过不去（踩过的坑：音效节点复用了声音节点的模型选择器，
 * 用户选的是 TTS 模型，透传过去直接被上游拒）。
 */
export function buildElevenSoundRequest(input: {
  text: string
  loop?: boolean
  durationSeconds?: number
  promptInfluence?: number
  outputFormat?: ElevenOutputFormat
}): CreateSoundEffectRequest {
  const request: CreateSoundEffectRequest = {
    text: input.text.trim(),
    modelId: ELEVEN_SOUND_MODEL
  }
  // 显式 false 不写进去（避免用 false 覆盖上游默认）
  if (input.loop) request.loop = true
  if (typeof input.durationSeconds === 'number' && Number.isFinite(input.durationSeconds)) {
    request.durationSeconds = clampNumber(
      input.durationSeconds,
      ELEVEN_SOUND_DURATION_MIN,
      ELEVEN_SOUND_DURATION_MAX
    )
  }
  if (typeof input.promptInfluence === 'number' && Number.isFinite(input.promptInfluence)) {
    request.promptInfluence = clampNumber(
      input.promptInfluence,
      ELEVEN_SOUND_PROMPT_INFLUENCE_MIN,
      ELEVEN_SOUND_PROMPT_INFLUENCE_MAX
    )
  }
  // outputFormat 也是请求对象字段（SDK 内部提为 query）
  if (input.outputFormat) request.outputFormat = input.outputFormat
  return request
}

/** SDK 里音乐模型的合法取值（`MusicModelId` 是受限联合，不是任意字符串） */
export const ELEVEN_MUSIC_MODELS = ['music_v1', 'music_v2', 'music_v2_5'] as const
export type ElevenMusicModel = (typeof ELEVEN_MUSIC_MODELS)[number]

/**
 * 收窄音乐模型：只放行 SDK 认可的取值。
 *
 * 为什么必须收窄：音乐模型**不在音频模态目录里**（它属于「音乐」用途），
 * 所以主进程解析活跃提供商时可能退回到声音页签里勾的 TTS 模型（如 eleven_v3），
 * 原样发出去就是上游 422。认不出就退回默认的 music_v2_5 —— 与「音效恒用唯一
 * model_id」同一个道理，宁可安静地用一个合法值，也不甩一条看不懂的校验错误。
 */
export function resolveElevenMusicModel(modelId?: string): ElevenMusicModel {
  const wanted = modelId?.trim()
  return (ELEVEN_MUSIC_MODELS as readonly string[]).includes(wanted ?? '')
    ? (wanted as ElevenMusicModel)
    : ELEVEN_DEFAULT_MUSIC_MODEL
}

/**
 * 音乐生成请求体（SDK `music.compose`）。
 *
 * 字段名按 SDK：`prompt` / `lyricsText` / `forceInstrumental` / `modelId`。
 * `outputFormat` 不走这里 —— 它是 query 参数，统一由适配器经 `queryParams` 传
 * （SDK 也接受把它放在请求体里，但那依赖内部解构，显式走 query 更清楚）。
 */
export function buildElevenMusicRequest(input: {
  prompt: string
  lyrics?: string
  instrumental?: boolean
  modelId?: string
  outputFormat?: ElevenOutputFormat
}): BodyComposeMusicV1MusicPost {
  const lyrics = input.lyrics?.trim()
  return {
    prompt: input.prompt.trim(),
    ...(lyrics ? { lyricsText: lyrics } : {}),
    // 缺省纯音乐（与 GenerateMusicInput.instrumental 的语义一致）
    forceInstrumental: input.instrumental !== false,
    modelId: resolveElevenMusicModel(input.modelId),
    ...(input.outputFormat ? { outputFormat: input.outputFormat } : {})
  }
}

/* ── 模型类别 ── */

/**
 * 模型类别。
 *
 * SDK 与规范**都不含**「是 TTS 还是转写 / 音乐 / 音效」的能力位 ——
 * 只有 `canDoTextToSpeech` / `canDoVoiceConversion` / `canUseStyle`。
 * 所以类别只能按 model_id 约定判断，本函数就是那个约定的唯一登记处。
 */
export type ElevenModelKind = 'tts' | 'stt' | 'music' | 'sfx' | 'other'

/**
 * 按 id 判断模型类别。
 *
 * 依据是官方规范里出现过的 model_id 命名：
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
 * SDK 返回类型的**结构化视图**。
 *
 * 只声明我们真正读的字段：既避免耦合 SDK 内部类型路径，也让这些映射函数
 * 在单测里可以喂普通对象字面量（不必造完整的 SDK 类型）。
 */
interface ElevenModelLike {
  modelId: string
  name?: string
  description?: string
  canDoTextToSpeech?: boolean
  languages?: Array<{ name?: string }>
}
interface ElevenVoiceLike {
  voiceId: string
  name?: string
  category?: unknown
}
interface ElevenTranscriptLike {
  text?: string
  languageCode?: string
  words?: Array<{ text?: string; start?: number; end?: number; type?: string }>
}

/** 模型目录条目：SDK `Model` → `CatalogModel`（带类别标注，供各调用点分流） */
export function parseElevenModels(models: ElevenModelLike[] | undefined | null): CatalogModel[] {
  const out: CatalogModel[] = []
  for (const item of Array.isArray(models) ? models : []) {
    const id = typeof item?.modelId === 'string' ? item.modelId.trim() : ''
    if (!id) continue
    const languages = (item.languages ?? [])
      .map((language) => language?.name?.trim())
      .filter((name): name is string => Boolean(name))
    out.push({
      id,
      name: item.name?.trim() || id,
      ...(item.description?.trim() ? { description: item.description.trim() } : {}),
      modality: 'audio',
      capabilities: {
        ...(languages.length ? { languages } : {}),
        elevenKind: elevenModelKind(id),
        // 规范里确实有这一位，用它同时校验 id 约定
        ...(item.canDoTextToSpeech === false ? { canDoTextToSpeech: false } : {})
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

/** 该 id 是否是本地表里的已知模型 */
export function isKnownElevenModel(modelId: string): boolean {
  const id = modelId.trim()
  if (!id) return false
  return listElevenFallbackModels().some((m) => m.id === id)
}

/* ── 音色 ── */

/** 音色目录条目：选择器要显示名字，生成时用 voiceId */
export interface ElevenVoiceEntry {
  id: string
  /** 展示名：`Sarah - Mature, Reassuring, Confident` */
  label: string
  category?: string
}

export interface GetVoicesResponseLike {
  voices: ElevenVoiceLike[]
}

/**
 * SDK `voices.getAll()` 响应 → 音色条目。
 *
 * 实测（不带 Key 时该端点也返回 200）：21 个 premade 音色；
 * 带 Key 时同一端点会额外返回用户自己的克隆音色。
 */
export function parseElevenVoices(
  response: GetVoicesResponseLike | null | undefined
): ElevenVoiceEntry[] {
  const out: ElevenVoiceEntry[] = []
  for (const voice of response?.voices ?? []) {
    const id = typeof voice?.voiceId === 'string' ? voice.voiceId.trim() : ''
    if (!id) continue
    out.push({
      id,
      label: voice.name?.trim() || id,
      ...(voice.category ? { category: String(voice.category) } : {})
    })
  }
  return out
}

/* ── 转写 ── */

/**
 * SDK `speechToText.convert()` 响应 → 既有的转写结果。
 *
 * 只用 `type === 'word'` 的词：规范里该数组也会混入 `spacing` / `audio_event`，
 * 把它们当正文会把「空格」拼进字幕。
 * 按**句读**切段（词级时间戳直接当分段会碎成一个个词，时间线没法用）。
 */
export function parseElevenTranscript(
  response: ElevenTranscriptLike | null | undefined,
  modelId: string
): {
  segments: Array<{ startSec: number; endSec: number; text: string }>
  text?: string
  model: string
  language?: string
} {
  const words = response?.words ?? []
  const fullText = response?.text?.trim() ?? ''
  const language = response?.languageCode?.trim() ?? ''
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
    if (word?.type !== 'word') continue
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
