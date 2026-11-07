import axios from 'axios'
import {
  providerModelDisplayName,
  type GenerateImageInput,
  GenerateImageResult,
  GenerateModel3dInput,
  GenerateModel3dJob,
  GenerateSpeechInput,
  GenerateSpeechResult,
  GenerateTextInput,
  GenerateTextResult,
  GenerateVideoInput,
  GenerateVideoJob,
  ModelProviderInstance
} from '@shared/modelProvider'
import type { ModelProviderAdapter, VideoPollResult } from '../types'
import { PROVIDER_ERRORS } from '../catalog'
import { fail, defErr } from '@shared/errors/appError'
import { createProviderHttpClient, formatAuthError, isAuthFailure, readHttpError } from '../http'
import { generateOpenAiCompatibleText } from '../openaiCompat'

// ── 本文件错误条目（catalog 未覆盖的个性文案）──
const NOT_SUPPORTED_FEATURES = {
  image: { zh: '图片生成', en: 'image generation' },
  video: { zh: '视频生成', en: 'video generation' },
  speech: { zh: '语音合成', en: 'speech synthesis' }
} as const

const E_NOT_SUPPORTED = defErr<{ kind: keyof typeof NOT_SUPPORTED_FEATURES }>(
  'provider.deepseek.unsupported-modality',
  ({ kind }) => `DeepSeek 提供商仅支持文本，暂未接入${NOT_SUPPORTED_FEATURES[kind].zh}`,
  ({ kind }) =>
    `DeepSeek supports text only; ${NOT_SUPPORTED_FEATURES[kind].en} is not integrated yet`
)

function notSupported(kind: keyof typeof NOT_SUPPORTED_FEATURES): Promise<never> {
  return Promise.reject(fail(E_NOT_SUPPORTED, { kind }))
}

/** DeepSeek 官方对话/多模态模型（deepseek-flash = V4.1 Flash / deepseek-v4-pro；旧别名自动映射至 deepseek-flash） */
function isDeepSeekTextModelId(modelId: string): boolean {
  return /^deepseek/i.test(modelId.trim())
}

export function normalizeDeepSeekOfficialModelId(modelId: string): string {
  const trimmed = modelId.trim()
  if (
    /^(?:deepseek\/)?deepseek-?(?:v4(?:\.1)?-flash(?:-vision(?:-exp)?)?|flash-latest)$/i.test(
      trimmed
    )
  ) {
    return 'deepseek-flash'
  }
  if (/^deepseek\//i.test(trimmed)) {
    return trimmed.replace(/^deepseek\//i, '')
  }
  return trimmed
}

export const deepSeekAdapter: ModelProviderAdapter = {
  kind: 'deepseek',

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
    if (modality !== 'text') return []
    const client = createProviderHttpClient(provider)
    try {
      const { data } = await client.get<{ data?: Array<{ id?: string }> }>('/models')
      return (data.data ?? [])
        .map((m) => String(m.id ?? '').trim())
        .filter(Boolean)
        .filter(isDeepSeekTextModelId)
        .map((id) => ({
          id,
          name: providerModelDisplayName('deepseek', id),
          modality: 'text' as const
        }))
    } catch (err) {
      throw fail(PROVIDER_ERRORS.actionFailed, {
        action: 'listModels',
        detail: await readHttpError(err)
      })
    }
  },

  generateText(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateTextInput
  ): Promise<GenerateTextResult> {
    const resolvedModelId =
      provider.baseUrl && !/api\.deepseek\.com/i.test(provider.baseUrl)
        ? modelId.trim()
        : normalizeDeepSeekOfficialModelId(modelId)
    return generateOpenAiCompatibleText(provider, resolvedModelId, input)
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

  generateSpeech(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult> {
    return notSupported('speech')
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
