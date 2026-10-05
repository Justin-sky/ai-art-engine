import type {
  CatalogModel,
  GenerateImageInput,
  GenerateImageResult,
  GenerateModel3dInput,
  GenerateModel3dJob,
  GenerateMusicInput,
  GenerateMusicResult,
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
import { basename, extname, join } from 'path'
import type { ModelProviderAdapter, VideoPollResult } from '../types'
import { fail, defErr, defErrSimple } from '@shared/errors/appError'
import { PROVIDER_ERRORS } from '../catalog'
import { LONG_GENERATE_TIMEOUT_MS } from '../http'
import { readElevenLabsHttpError } from './httpError'
import {
  ELEVEN_DEFAULT_MUSIC_MODEL,
  ELEVEN_DEFAULT_OUTPUT_FORMAT,
  ELEVEN_DEFAULT_STT_MODEL,
  ELEVEN_MODELS_PATH,
  ELEVEN_MUSIC_PATH,
  ELEVEN_STT_PATH,
  ELEVEN_VOICES_PATH,
  buildElevenMusicBody,
  buildElevenTtsBody,
  elevenFormatOf,
  elevenTtsPath,
  filterElevenModelsByKind,
  listElevenFallbackModels,
  parseElevenModels,
  parseElevenTranscript,
  parseElevenVoices,
  resolveElevenOutputFormat,
  type ElevenVoiceEntry
} from '@shared/modelProviders/elevenlabs/voice'
import { createElevenLabsHttpClient } from './http'

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
 * 音色目录：`GET /v1/voices`。
 *
 * 单独导出给主进程的目录服务用（音色不是模型，不进 CatalogModel）；
 * 无 Key 时该端点也返回 200（实测 21 个 premade），带 Key 会额外带上用户克隆的音色。
 */
export async function fetchElevenVoices(
  provider: ModelProviderInstance
): Promise<ElevenVoiceEntry[]> {
  const client = createElevenLabsHttpClient(provider)
  const { data } = await client.get(ELEVEN_VOICES_PATH, { timeout: 30_000 })
  return parseElevenVoices(data)
}

/**
 * 全量模型目录（不做类别过滤）；拉不到时用本地表兜底。
 * 单独放模块级而不是进适配器接口：接口上多一个方法会污染其它供应商的实现负担。
 */
async function listElevenModels(provider: ModelProviderInstance): Promise<CatalogModel[]> {
  const client = createElevenLabsHttpClient(provider)
  try {
    const { data } = await client.get(ELEVEN_MODELS_PATH, { timeout: 30_000 })
    const models = parseElevenModels(data)
    return models.length ? models : listElevenFallbackModels()
  } catch {
    return listElevenFallbackModels()
  }
}

export const elevenLabsAdapter: ModelProviderAdapter = {
  kind: 'elevenlabs',

  async assertAuth(provider) {
    if (!provider.apiKey.trim()) throw fail(PROVIDER_ERRORS.missingApiKey)
    // 无 Key 也能拿到公开音色，所以必须用**带鉴权**的端点验证密钥有效性
    const client = createElevenLabsHttpClient(provider)
    try {
      await client.get('/v1/user/subscription', { timeout: 20_000 })
    } catch (err) {
      throw fail(E_ELEVEN_CONNECTION_TEST_FAILED, { detail: await readElevenLabsHttpError(err) })
    }
  },

  /**
   * 目录：`GET /v1/models`（官方提供），失败或拿不到数组时退回本地表。
   *
   * 只返回 **TTS** 类模型：该端点同时返回 `scribe_*`（转写）与 `music_*`（音乐），
   * 混进声音节点的下拉会让人选到根本不能合成的模型。
   * 转写 / 音乐各自用自己的模型（见 defaultTranscribeModelId 与 generateMusic）。
   * 其它模态返回空数组 —— 本适配器不支持，避免设置页出现选不了的页签。
   */
  async fetchCatalog(provider: ModelProviderInstance, modality: ModelModality) {
    if (modality !== 'audio') return []
    const all = await listElevenModels(provider)
    return filterElevenModelsByKind(all, 'tts')
  },

  /**
   * 全量音频模型（TTS + 转写 + 音乐），供设置页把能力写进目录快照。
   * 声音节点只用 fetchCatalog（已滤成 TTS），所以 music / scribe 不会漏进它的下拉。
   */
  listAllAudioModels(provider: ModelProviderInstance): Promise<CatalogModel[]> {
    return listElevenModels(provider)
  },

  /**
   * 音色 id → 展示名。ElevenLabs 的 voice_id 是不透明字符串，选择器必须显示名字。
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
   * 语音合成：`POST /v1/text-to-speech/{voice_id}`。
   *
   * 只写临时文件并返回 `filePath`：落盘目录与资产登记由 facade 的
   * generateSpeechAsset 统一负责（与 OpenAI 兼容 / ComfyUI / 方舟 / MiniMax 一致）。
   *
   * `voice` 是 **voice_id**（不透明字符串），不是音色名 —— 目录里的名字只用于展示。
   */
  async generateSpeech(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult> {
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
    const client = createElevenLabsHttpClient(provider)

    try {
      const response = await client.post(
        elevenTtsPath(voiceId),
        buildElevenTtsBody({ text: input.input, modelId }),
        {
          params: { output_format: outputFormat },
          responseType: 'arraybuffer',
          timeout: 180_000
        }
      )

      const buf = Buffer.from(response.data as ArrayBuffer)
      if (!buf.length) throw fail(PROVIDER_ERRORS.noAudioResult)

      const tmpDir = join(process.cwd(), '.aiartengine-tmp', 'tts')
      if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true })
      const filePath = join(tmpDir, `eleven-${Date.now()}.${ext}`)
      writeFileSync(filePath, buf)
      return { model: modelId, voice: voiceId, format, filePath }
    } catch (err) {
      throw fail(E_ELEVEN_SPEECH_FAILED, { detail: await readElevenLabsHttpError(err) })
    }
  },

  /**
   * 语音转文字：`POST /v1/speech-to-text`（multipart/form-data，响应是 JSON 不是音频）。
   *
   * 响应形态：`{ text, language_code, words:[{text,start,end,type}] }`。
   * 我们按**词**聚合成句段交给既有的 TranscribeAudioSegment（时间线要的是分段），
   * 因为规范里 `timestamps_granularity` 取 word 时只给词级时间戳。
   */
  async transcribeAudio(
    provider: ModelProviderInstance,
    modelId: string,
    input: TranscribeAudioInput
  ): Promise<TranscribeAudioResult> {
    const absPath = input.absPath?.trim()
    if (!absPath) throw fail(E_ELEVEN_TRANSCRIBE_NO_FILE)
    const form = new FormData()
    form.append('model_id', modelId || ELEVEN_DEFAULT_STT_MODEL)
    form.append('timestamps_granularity', 'word')
    if (input.language?.trim()) form.append('language_code', input.language.trim())
    try {
      form.append(
        'file',
        new Blob([new Uint8Array(readFileSync(absPath))], { type: audioMimeForPath(absPath) }),
        basename(absPath)
      )
    } catch (err) {
      if (err instanceof Error && (err as Error & { code?: string }).code === 'ENOENT') {
        throw fail(E_ELEVEN_TRANSCRIBE_NO_FILE)
      }
      throw err
    }
    const client = createElevenLabsHttpClient(provider, LONG_GENERATE_TIMEOUT_MS)
    try {
      const { data } = await client.post(ELEVEN_STT_PATH, form, {
        headers: { 'Content-Type': undefined },
        timeout: LONG_GENERATE_TIMEOUT_MS
      })
      return parseElevenTranscript(data, modelId)
    } catch (err) {
      throw fail(E_ELEVEN_TRANSCRIBE_FAILED, { detail: await readElevenLabsHttpError(err) })
    }
  },

  /**
   * 音乐生成：`POST /v1/music`（JSON，响应音频字节）。
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
    const client = createElevenLabsHttpClient(provider, LONG_GENERATE_TIMEOUT_MS)
    try {
      const response = await client.post(
        ELEVEN_MUSIC_PATH,
        buildElevenMusicBody({
          prompt: input.prompt,
          lyrics: input.lyrics,
          instrumental: input.instrumental,
          modelId
        }),
        {
          params: { output_format: ELEVEN_DEFAULT_OUTPUT_FORMAT },
          responseType: 'arraybuffer',
          timeout: LONG_GENERATE_TIMEOUT_MS
        }
      )
      const buf = Buffer.from(response.data as ArrayBuffer)
      if (!buf.length) throw fail(PROVIDER_ERRORS.noAudioResult)
      const tmpDir = join(process.cwd(), '.aiartengine-tmp', 'music')
      if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true })
      const filePath = join(tmpDir, `eleven-music-${Date.now()}.mp3`)
      writeFileSync(filePath, buf)
      return { model: modelId || ELEVEN_DEFAULT_MUSIC_MODEL, filePath }
    } catch (err) {
      throw fail(E_ELEVEN_MUSIC_FAILED, { detail: await readElevenLabsHttpError(err) })
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
