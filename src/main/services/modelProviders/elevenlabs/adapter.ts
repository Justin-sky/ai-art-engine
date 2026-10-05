import type {
  GenerateImageInput,
  GenerateImageResult,
  GenerateModel3dInput,
  GenerateModel3dJob,
  GenerateSpeechInput,
  GenerateSpeechResult,
  GenerateTextInput,
  GenerateTextResult,
  GenerateVideoInput,
  GenerateVideoJob,
  ModelModality,
  ModelProviderInstance
} from '@shared/modelProvider'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { ModelProviderAdapter, VideoPollResult } from '../types'
import { fail, defErr, defErrSimple } from '@shared/errors/appError'
import { PROVIDER_ERRORS } from '../catalog'
import { readElevenLabsHttpError } from './httpError'
import {
  ELEVEN_MODELS_PATH,
  ELEVEN_VOICES_PATH,
  buildElevenTtsBody,
  elevenFormatOf,
  elevenTtsPath,
  listElevenFallbackModels,
  parseElevenModels,
  parseElevenVoices,
  resolveElevenOutputFormat,
  type ElevenVoiceEntry
} from '@shared/modelProviders/elevenlabs/voice'
import { createElevenLabsHttpClient } from './http'

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
   * 目录：
   * - audio → `GET /v1/models`（官方提供），失败时退回本地兜底表
   * - 其它模态一律空数组（该供应商只有语音合成）
   */
  async fetchCatalog(provider: ModelProviderInstance, modality: ModelModality) {
    if (modality !== 'text' && modality !== 'audio' && modality !== 'image') return []
    // text / image 也走空：本适配器不支持，避免设置页出现选不了的页签
    if (modality !== 'audio') return []
    const client = createElevenLabsHttpClient(provider)
    try {
      const { data } = await client.get(ELEVEN_MODELS_PATH, { timeout: 30_000 })
      const models = parseElevenModels(data)
      // 接口返回空（或全是非 TTS 模型）时也要能选，退回兜底表
      return models.length ? models : listElevenFallbackModels()
    } catch {
      return listElevenFallbackModels()
    }
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
