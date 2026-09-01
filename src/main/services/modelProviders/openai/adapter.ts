import axios from 'axios'
import type {
  CatalogModel,
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
  ModelProviderInstance,
  TranscribeAudioInput,
  TranscribeAudioResult
} from '@shared/modelProvider'
import {
  isOpenAiTextModelId,
  listOpenAiCatalogModels
} from '@shared/modelProviders/openai/modelCapabilities'
import type { ModelProviderAdapter, VideoPollResult } from '../types'
import { PROVIDER_ERRORS } from '../catalog'
import { fail, defErr, defErrSimple } from '@shared/errors/appError'
import {
  createProviderHttpClient,
  formatAuthError,
  isAuthFailure,
  readHttpError
} from '../http'
import {
  generateOpenAiCompatibleImage,
  generateOpenAiCompatibleText
} from '../openaiCompat'
import { transcribeAudioViaOpenAiCompatible } from '../transcribe'

// ── 本文件错误条目（catalog 未覆盖的个性文案）──
const NOT_SUPPORTED_FEATURES = {
  soraVideo: { zh: '视频（Sora）', en: 'video (Sora)' },
  speech: { zh: '语音合成', en: 'speech synthesis' }
} as const

const E_NOT_SUPPORTED = defErr<{ kind: keyof typeof NOT_SUPPORTED_FEATURES }>(
  'provider.openai.unsupported-modality',
  ({ kind }) => `OpenAI 提供商暂未接入${NOT_SUPPORTED_FEATURES[kind].zh}，当前仅支持文本与图片`,
  ({ kind }) =>
    `OpenAI does not support ${NOT_SUPPORTED_FEATURES[kind].en} yet; text and image only`
)

function notSupported(kind: keyof typeof NOT_SUPPORTED_FEATURES): Promise<never> {
  return Promise.reject(fail(E_NOT_SUPPORTED, { kind }))
}

async function fetchTextCatalog(provider: ModelProviderInstance): Promise<CatalogModel[]> {
  const client = createProviderHttpClient(provider)
  try {
    const { data } = await client.get<{ data?: Array<{ id?: string; created?: number }> }>(
      '/models'
    )
    return (data.data ?? [])
      .map((m) => String(m.id ?? '').trim())
      .filter(Boolean)
      .filter(isOpenAiTextModelId)
      .map((id) => ({ id, name: id, modality: 'text' as const }))
  } catch (err) {
    throw fail(PROVIDER_ERRORS.actionFailed, {
      action: 'listModels',
      detail: await readHttpError(err)
    })
  }
}

export const openAiAdapter: ModelProviderAdapter = {
  kind: 'openai',

  async assertAuth(provider) {
    if (!provider.apiKey.trim()) throw fail(PROVIDER_ERRORS.missingApiKey)
    const client = createProviderHttpClient(provider)
    try {
      await client.get('/models', { timeout: 20_000 })
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined
      const raw = await readHttpError(err)
      if (isAuthFailure(status, raw)) {
        throw fail(PROVIDER_ERRORS.invalidApiKeyListModels, {
          detail: formatAuthError(raw, provider)
        })
      }
      throw fail(PROVIDER_ERRORS.connectionTestFailed, { detail: formatAuthError(raw, provider) })
    }
  },

  async fetchCatalog(provider, modality) {
    if (modality === 'image') return listOpenAiCatalogModels('image')
    if (modality === 'text') return fetchTextCatalog(provider)
    return []
  },

  generateText(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateTextInput
  ): Promise<GenerateTextResult> {
    return generateOpenAiCompatibleText(provider, modelId, input)
  },

  generateImage(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateImageInput
  ): Promise<GenerateImageResult> {
    return generateOpenAiCompatibleImage(provider, modelId, input)
  },

  submitVideo(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateVideoInput
  ): Promise<GenerateVideoJob> {
    return notSupported('soraVideo')
  },

  pollVideo(
    _provider: ModelProviderInstance,
    _job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    return notSupported('soraVideo')
  },

  generateSpeech(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult> {
    return notSupported('speech')
  },

  async transcribeAudio(
    provider: ModelProviderInstance,
    modelId: string,
    input: TranscribeAudioInput
  ): Promise<TranscribeAudioResult> {
    const absPath = input.absPath?.trim()
    if (!absPath) {
      throw fail(
        defErrSimple(
          'provider.openai.transcribeNoFile',
          '音频转写缺少本地文件路径',
          'Audio transcription is missing the local file path'
        )
      )
    }
    return transcribeAudioViaOpenAiCompatible(provider, modelId || 'whisper-1', input, absPath)
  },

  submitModel3d(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateModel3dInput
  ): Promise<GenerateModel3dJob> {
    throw fail(PROVIDER_ERRORS.unsupported3d)
  },

  pollModel3d(
    _provider: ModelProviderInstance,
    _job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    throw fail(PROVIDER_ERRORS.unsupported3d)
  }
}
