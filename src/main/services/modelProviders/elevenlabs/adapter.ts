import type {
  CatalogModel,
  GenerateImageInput,
  GenerateImageResult,
  GenerateModel3dInput,
  GenerateModel3dJob,
  GenerateMusicInput,
  GenerateMusicResult,
  GenerateSoundEffectInput,
  GenerateSpeechInput,
  GenerateSpeechResult,
  GenerateTextInput,
  GenerateTextResult,
  GenerateVideoInput,
  GenerateVideoJob,
  ModelModality,
  ModelProviderInstance,
  TranscribeAudioInput,
  TranscribeAudioResult
} from '@shared/modelProvider'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { extname, join } from 'path'
import type { ModelProviderAdapter, VideoPollResult } from '../types'
import { fail, defErr, defErrSimple } from '@shared/errors/appError'
import { PROVIDER_ERRORS } from '../catalog'
import { LONG_GENERATE_TIMEOUT_MS } from '../http'
import {
  ELEVEN_DEFAULT_MUSIC_MODEL,
  ELEVEN_DEFAULT_OUTPUT_FORMAT,
  ELEVEN_DEFAULT_STT_MODEL,
  ELEVEN_SOUND_MODEL,
  buildElevenDialogueRequest,
  buildElevenMusicRequest,
  buildElevenSoundRequest,
  buildElevenTtsRequest,
  elevenFormatOf,
  filterElevenModelsByKind,
  listElevenFallbackModels,
  parseElevenModels,
  parseElevenTranscript,
  parseElevenVoices,
  resolveElevenOutputFormat,
  type ElevenVoiceEntry
} from '@shared/modelProviders/elevenlabs/voice'
import {
  ELEVEN_NO_RETRY,
  collectElevenAudio,
  createElevenClient,
  readElevenErrorDetail
} from './client'

/** 上传音频的 MIME：与 OpenAI 兼容转写同一套映射（按扩展名猜） */
function audioMimeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.wav':
      return 'audio/wav'
    case '.m4a':
      return 'audio/mp4'
    case '.aac':
      return 'audio/aac'
    case '.ogg':
    case '.oga':
      return 'audio/ogg'
    case '.flac':
      return 'audio/flac'
    default:
      return 'audio/mpeg'
  }
}

/**
 * 写 ElevenLabs 返回的音频字节到系统临时目录，返回绝对路径。
 *
 * 统一在这里做：各方法（TTS / 对话 / 音乐 / 音效）都只写临时文件，
 * 落盘目录与资产登记由 facade 负责 —— 与其它供应商的契约一致。
 */
function writeElevenTemp(dir: string, prefix: string, ext: string, buf: Buffer): string {
  const tmpDir = join(process.cwd(), '.aiartengine-tmp', dir)
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true })
  const filePath = join(tmpDir, `${prefix}-${Date.now()}.${ext}`)
  writeFileSync(filePath, buf)
  return filePath
}

const PROVIDER_NAME = 'ElevenLabs'

// ── 本文件错误条目 ──
const E_ELEVEN_CONNECTION_TEST_FAILED = defErr<{ detail: string }>(
  'provider.elevenlabs.connectionTestFailed',
  ({ detail }) => `ElevenLabs 连接测试失败: ${detail}`,
  ({ detail }) => `ElevenLabs connection test failed: ${detail}`
)
const E_ELEVEN_SPEECH_FAILED = defErr<{ detail: string }>(
  'provider.elevenlabs.speechFailed',
  ({ detail }) => `语音生成失败: ${detail}`,
  ({ detail }) => `Voice generation failed: ${detail}`
)
const E_ELEVEN_TRANSCRIBE_FAILED = defErr<{ detail: string }>(
  'provider.elevenlabs.transcribeFailed',
  ({ detail }) => `音频转写失败: ${detail}`,
  ({ detail }) => `Audio transcription failed: ${detail}`
)
const E_ELEVEN_TRANSCRIBE_NO_FILE = defErrSimple(
  'provider.elevenlabs.transcribeNoFile',
  '音频转写缺少本地文件路径',
  'Audio transcription is missing the local file path'
)
const E_ELEVEN_MUSIC_FAILED = defErr<{ detail: string }>(
  'provider.elevenlabs.musicFailed',
  ({ detail }) => `音乐生成失败: ${detail}`,
  ({ detail }) => `Music generation failed: ${detail}`
)
const E_ELEVEN_MUSIC_NO_PROMPT = defErrSimple(
  'provider.elevenlabs.musicNoPrompt',
  '音乐生成需要提示词（风格 / 情绪 / 场景描述）',
  'Music generation requires a prompt (style / mood / scene description)'
)
const E_ELEVEN_DIALOGUE_FAILED = defErr<{ detail: string }>(
  'provider.elevenlabs.dialogueFailed',
  ({ detail }) => `多说话人对话生成失败: ${detail}`,
  ({ detail }) => `Multi-speaker dialogue generation failed: ${detail}`
)
const E_ELEVEN_SOUND_FAILED = defErr<{ detail: string }>(
  'provider.elevenlabs.soundEffectFailed',
  ({ detail }) => `音效生成失败: ${detail}`,
  ({ detail }) => `Sound effect generation failed: ${detail}`
)
const E_ELEVEN_SOUND_NO_PROMPT = defErrSimple(
  'provider.elevenlabs.soundNoPrompt',
  '音效生成需要描述（如「雨落在铁皮屋顶上」）',
  'Sound effect generation requires a description (e.g. "rain on a tin roof")'
)
// 该供应商只有语音合成，其余模态逐一给明确文案
// （不用拼接的模态名：硬编码中文过不了 CJK 守卫，且各语言语序不同）
const UNSUPPORTED_MODALITIES = {
  text: defErrSimple(
    'provider.elevenlabs.textUnsupported',
    'ElevenLabs 只提供语音合成，不支持文本生成',
    'ElevenLabs only provides speech synthesis; text generation is not supported'
  ),
  image: defErrSimple(
    'provider.elevenlabs.imageUnsupported',
    'ElevenLabs 只提供语音合成，不支持图片生成',
    'ElevenLabs only provides speech synthesis; image generation is not supported'
  ),
  video: defErrSimple(
    'provider.elevenlabs.videoUnsupported',
    'ElevenLabs 只提供语音合成，不支持视频生成',
    'ElevenLabs only provides speech synthesis; video generation is not supported'
  ),
  model3d: defErrSimple(
    'provider.elevenlabs.model3dUnsupported',
    'ElevenLabs 只提供语音合成，不支持 3D 模型生成',
    'ElevenLabs only provides speech synthesis; 3D model generation is not supported'
  )
} as const

function notSupported(modality: keyof typeof UNSUPPORTED_MODALITIES): Promise<never> {
  return Promise.reject(fail(UNSUPPORTED_MODALITIES[modality]))
}

/**
 * 全量模型目录（不做类别过滤）；拉不到时用本地表兜底。
 * 单独放模块级而不是进适配器接口：接口上多一个方法会污染其它供应商的实现负担。
 */
async function listElevenModels(provider: ModelProviderInstance): Promise<CatalogModel[]> {
  try {
    const models = await createElevenClient(provider).models.list({ timeoutInSeconds: 30 })
    const parsed = parseElevenModels(models)
    return parsed.length ? parsed : listElevenFallbackModels()
  } catch {
    return listElevenFallbackModels()
  }
}

/**
 * 音色目录：`SDK voices.getAll()`。
 *
 * 单独导出给主进程的目录服务用（音色不是模型，不进 CatalogModel）；
 * 无 Key 时该端点也返回 200（实测 21 个 premade），带 Key 会额外带上用户克隆的音色。
 */
export async function fetchElevenVoices(
  provider: ModelProviderInstance
): Promise<ElevenVoiceEntry[]> {
  const response = await createElevenClient(provider).voices.getAll({}, { timeoutInSeconds: 30 })
  return parseElevenVoices(response)
}

/**
 * 多说话人对话：`SDK textToDialogue.convert()`。
 *
 * 每段的 voiceId 由执行层解析好后传入（说话人 → 音色），这里只管发请求。
 * 放模块级而不是适配器方法：接口上多一个方法等于给所有供应商加实现负担，
 * 而它与单说话人 TTS 产物同形、落盘与登记完全一致。
 * 返回的 `voice` 是**多段**音色去重后用逗号连起来，便于日志排查。
 */
async function generateDialogueSpeech(
  provider: ModelProviderInstance,
  modelId: string,
  dialogue: Array<{ text: string; voice?: string }>
): Promise<GenerateSpeechResult> {
  const inputs = dialogue.map((line) => ({ text: line.text.trim(), voice: line.voice!.trim() }))
  const outputFormat = resolveElevenOutputFormat(undefined)
  const { ext, format } = elevenFormatOf(outputFormat)
  try {
    const stream = await createElevenClient(provider).textToDialogue.convert(
      buildElevenDialogueRequest({ inputs, modelId, outputFormat }),
      { ...ELEVEN_NO_RETRY }
    )
    const buf = await collectElevenAudio(stream)
    if (!buf.length) throw fail(PROVIDER_ERRORS.noAudioResult)
    return {
      model: modelId,
      voice: [...new Set(inputs.map((row) => row.voice))].join(','),
      format,
      filePath: writeElevenTemp('dialogue', 'eleven-dialogue', ext, buf)
    }
  } catch (err) {
    throw fail(E_ELEVEN_DIALOGUE_FAILED, { detail: readElevenErrorDetail(err) })
  }
}

export const elevenLabsAdapter: ModelProviderAdapter = {
  kind: 'elevenlabs',

  async assertAuth(provider) {
    if (!provider.apiKey.trim()) throw fail(PROVIDER_ERRORS.missingApiKey)
    // 无 Key 也能拿到公开音色，所以必须用**带鉴权**的端点验证密钥有效性
    try {
      await createElevenClient(provider).user.get({ timeoutInSeconds: 20 })
    } catch (err) {
      throw fail(E_ELEVEN_CONNECTION_TEST_FAILED, { detail: readElevenErrorDetail(err) })
    }
  },

  /**
   * 目录：`GET /v1/models`（SDK models.list），失败或拿不到时退回本地表。
   *
   * 按模态分流（同一端点混着三类模型）：
   * - `audio`（语音合成）→ 只给 TTS，否则声音节点的下拉会出现 `music_v2_5` / `scribe_v2`
   * - `music`（音乐生成）→ 只给 `music_*`，设置页的音乐页签才有模型可勾
   * 其它模态返回空数组 —— 本适配器不支持，避免设置页出现选不了的页签。
   */
  async fetchCatalog(provider: ModelProviderInstance, modality: ModelModality) {
    if (modality !== 'audio' && modality !== 'music') return []
    const all = await listElevenModels(provider)
    return filterElevenModelsByKind(all, modality === 'music' ? 'music' : 'tts')
  },

  /**
   * 全量音频模型（TTS + 转写 + 音乐），供设置页把能力写进目录快照。
   * 声音节点只用 fetchCatalog（已滤成 TTS），所以 music / scribe 不会漏进它的下拉。
   */
  listAllAudioModels(provider: ModelProviderInstance): Promise<CatalogModel[]> {
    return listElevenModels(provider)
  },

  /**
   * 音色 id → 展示名。ElevenLabs 的 voiceId 是不透明字符串，选择器必须显示名字。
   * 无 Key 时该端点也返回公开音色（实测 21 个 premade）；带 Key 会带上克隆音色。
   */
  async fetchVoiceLabels(provider: ModelProviderInstance): Promise<Record<string, string>> {
    const entries = await fetchElevenVoices(provider)
    const out: Record<string, string> = {}
    for (const entry of entries) out[entry.id] = entry.label
    return out
  },

  generateText(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateTextInput
  ): Promise<GenerateTextResult> {
    return notSupported('text')
  },

  generateImage(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateImageInput
  ): Promise<GenerateImageResult> {
    return notSupported('image')
  },

  submitVideo(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateVideoInput
  ): Promise<GenerateVideoJob> {
    return notSupported('video')
  },

  pollVideo(
    _provider: ModelProviderInstance,
    _job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    return notSupported('video')
  },

  /**
   * 语音合成：单说话人走 `textToSpeech.convert`，
   * 多说话人（给了 `input.dialogue`）走 `textToDialogue.convert`。
   *
   * 两个端点产物同为音频字节、落盘与登记方式完全一致，所以合在一个方法里按入参分流；
   * 拆成两个适配器方法只会把整条链路复制一遍。
   *
   * 只写临时文件并返回 `filePath`：落盘目录与资产登记由 facade 的
   * generateSpeechAsset 统一负责（与 OpenAI 兼容 / ComfyUI / 方舟 / MiniMax 一致）。
   *
   * `voice` 是 **voiceId**（不透明字符串），不是音色名 —— 目录里的名字只用于展示。
   */
  async generateSpeech(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult> {
    const dialogue = input.dialogue?.filter((line) => line.text.trim() && line.voice?.trim())
    if (dialogue?.length) {
      return generateDialogueSpeech(provider, modelId, dialogue)
    }
    const voiceId = input.voice?.trim()
    if (!voiceId) {
      // 音色走路径参数，没有它连端点都拼不出来 —— 明确报错而不是发一个坏请求
      throw fail(
        defErrSimple(
          'provider.elevenlabs.voiceRequired',
          'ElevenLabs 需要音色（voice_id）：请在声音生成节点的指令面板里选择音色',
          'ElevenLabs requires a voice (voice_id): pick one in the voice node instruction panel'
        )
      )
    }
    const outputFormat = resolveElevenOutputFormat(input.responseFormat)
    const { ext, format } = elevenFormatOf(outputFormat)

    try {
      const stream = await createElevenClient(provider).textToSpeech.convert(
        voiceId,
        buildElevenTtsRequest({ text: input.input, modelId, outputFormat }),
        { ...ELEVEN_NO_RETRY }
      )
      const buf = await collectElevenAudio(stream)
      if (!buf.length) throw fail(PROVIDER_ERRORS.noAudioResult)
      return {
        model: modelId,
        voice: voiceId,
        format,
        filePath: writeElevenTemp('tts', 'eleven', ext, buf)
      }
    } catch (err) {
      throw fail(E_ELEVEN_SPEECH_FAILED, { detail: readElevenErrorDetail(err) })
    }
  },

  /**
   * 语音转文字：`SDK speechToText.convert`（multipart 上传，响应是 JSON 不是音频）。
   *
   * SDK 的响应类型是判别联合（单声道 / 多声道 / webhook）；我们只要单声道那支的
   * `text` 与 `words`。多声道（`useMultiChannel`）我们没开，所以按单声道取用。
   */
  async transcribeAudio(
    provider: ModelProviderInstance,
    modelId: string,
    input: TranscribeAudioInput
  ): Promise<TranscribeAudioResult> {
    const absPath = input.absPath?.trim()
    if (!absPath) throw fail(E_ELEVEN_TRANSCRIBE_NO_FILE)
    let file: Blob
    try {
      file = new Blob([new Uint8Array(readFileSync(absPath))], {
        type: audioMimeForPath(absPath)
      })
    } catch (err) {
      if (err instanceof Error && (err as Error & { code?: string }).code === 'ENOENT') {
        throw fail(E_ELEVEN_TRANSCRIBE_NO_FILE)
      }
      throw err
    }
    try {
      const response = await createElevenClient(
        provider,
        LONG_GENERATE_TIMEOUT_MS
      ).speechToText.convert(
        {
          modelId: modelId || ELEVEN_DEFAULT_STT_MODEL,
          file,
          timestampsGranularity: 'word',
          ...(input.language?.trim() ? { languageCode: input.language.trim() } : {})
        },
        { ...ELEVEN_NO_RETRY }
      )
      // 多声道响应里 text/words 在 channel 里，我们没开多声道时不会走到这支
      const single = 'text' in response ? response : undefined
      return parseElevenTranscript(single, modelId)
    } catch (err) {
      throw fail(E_ELEVEN_TRANSCRIBE_FAILED, { detail: readElevenErrorDetail(err) })
    }
  },

  /**
   * 音乐生成：`SDK music.compose`（响应音频字节）。
   *
   * 与其它供应商不同，ElevenLabs 直接回音频、没有下载地址，所以走
   * `filePath` 而不是 `downloadUrl`（facade 两种都支持）。
   * 仍然遵守既定契约：**只写临时文件**，落盘登记由 generateMusicAsset 负责。
   */
  async generateMusic(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateMusicInput
  ): Promise<GenerateMusicResult> {
    if (!input.prompt.trim()) throw fail(E_ELEVEN_MUSIC_NO_PROMPT)
    const outputFormat = ELEVEN_DEFAULT_OUTPUT_FORMAT
    const { ext } = elevenFormatOf(outputFormat)
    try {
      const stream = await createElevenClient(provider).music.compose(
        buildElevenMusicRequest({
          prompt: input.prompt,
          lyrics: input.lyrics,
          instrumental: input.instrumental,
          modelId,
          outputFormat
        }),
        { ...ELEVEN_NO_RETRY }
      )
      const buf = await collectElevenAudio(stream)
      if (!buf.length) throw fail(PROVIDER_ERRORS.noAudioResult)
      return {
        model: modelId || ELEVEN_DEFAULT_MUSIC_MODEL,
        filePath: writeElevenTemp('music', 'eleven-music', ext, buf)
      }
    } catch (err) {
      throw fail(E_ELEVEN_MUSIC_FAILED, { detail: readElevenErrorDetail(err) })
    }
  },

  /**
   * 音效生成：`SDK textToSoundEffects.convert`（响应音频字节）。
   *
   * 与音乐同形：直接回音频、没有下载地址，所以走 `filePath`。
   * 该端点只能出一个音效，`loop` 控制是否可无缝循环（环境音常用）。
   *
   * **忽略入参 modelId**：音效的模型是 SDK 字面量类型 `SfxModelId`（只有
   * `eleven_text_to_sound_v2`）。节点上那个下拉是选**提供商实例**用的，
   * 它带的模型串（可能是 TTS 模型）不能透传给上游。
   */
  async generateSoundEffect(
    provider: ModelProviderInstance,
    _modelId: string,
    input: GenerateSoundEffectInput
  ): Promise<GenerateMusicResult> {
    if (!input.prompt.trim()) throw fail(E_ELEVEN_SOUND_NO_PROMPT)
    const outputFormat = ELEVEN_DEFAULT_OUTPUT_FORMAT
    const { ext } = elevenFormatOf(outputFormat)
    try {
      const stream = await createElevenClient(provider).textToSoundEffects.convert(
        buildElevenSoundRequest({
          text: input.prompt,
          loop: input.loop,
          durationSeconds: input.durationSeconds,
          promptInfluence: input.promptInfluence,
          outputFormat
        }),
        { ...ELEVEN_NO_RETRY }
      )
      const buf = await collectElevenAudio(stream)
      if (!buf.length) throw fail(PROVIDER_ERRORS.noAudioResult)
      return {
        model: ELEVEN_SOUND_MODEL,
        filePath: writeElevenTemp('sfx', 'eleven-sfx', ext, buf)
      }
    } catch (err) {
      throw fail(E_ELEVEN_SOUND_FAILED, { detail: readElevenErrorDetail(err) })
    }
  },

  submitModel3d(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateModel3dInput
  ): Promise<GenerateModel3dJob> {
    return notSupported('model3d')
  },

  pollModel3d(
    _provider: ModelProviderInstance,
    _job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    return notSupported('model3d')
  }
}

/** 供目录服务使用：ElevenLabs 的展示名（错误文案里用） */
export const ELEVENLABS_PROVIDER_NAME = PROVIDER_NAME
