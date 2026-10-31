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
  isOpenAiImageModelId,
  isOpenAiTextModelId,
  listOpenAiCatalogModels,
  mergeOpenAiCatalogWithBuiltin
} from '@shared/modelProviders/openai/modelCapabilities'
import {
  isCustomImageModelId,
  isCustomTextModelId
} from '@shared/modelProviders/custom/modelCapabilities'
import { listOpenAiTtsCatalogModels } from '@shared/modelProviders/openai/ttsModels'
import type { ModelProviderAdapter, VideoPollResult } from '../types'
import { PROVIDER_ERRORS } from '../catalog'
import { fail, defErr, defErrSimple } from '@shared/errors/appError'
import { createProviderHttpClient, formatAuthError, isAuthFailure, readHttpError } from '../http'
import {
  generateOpenAiCompatibleImage,
  generateOpenAiCompatibleSpeech,
  generateOpenAiCompatibleText
} from '../openaiCompat'
import { transcribeAudioViaOpenAiCompatible } from '../transcribe'

// ── 本文件错误条目（catalog 未覆盖的个性文案）──
const NOT_SUPPORTED_FEATURES = {
  soraVideo: { zh: '视频（Sora）', en: 'video (Sora)' }
} as const

const E_NOT_SUPPORTED = defErr<{ kind: keyof typeof NOT_SUPPORTED_FEATURES }>(
  'provider.openai.unsupported-modality',
  ({ kind }) => `OpenAI 提供商暂未接入${NOT_SUPPORTED_FEATURES[kind].zh}，当前支持文本、图片与语音`,
  ({ kind }) =>
    `OpenAI does not support ${NOT_SUPPORTED_FEATURES[kind].en} yet; text, image and speech only`
)

function notSupported(kind: keyof typeof NOT_SUPPORTED_FEATURES): Promise<never> {
  return Promise.reject(fail(E_NOT_SUPPORTED, { kind }))
}

function isOfficialOpenAiBaseUrl(baseUrl?: string): boolean {
  const trimmed = (baseUrl ?? '').trim()
  if (!trimmed) return true
  return /(^|\/\/|\.)api\.openai\.com(\/|$)/i.test(trimmed)
}

function extractRawModelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') {
    if (Array.isArray(payload)) {
      return payload
        .map((m) =>
          String((m as { id?: string; name?: string })?.id ?? (m as { name?: string })?.name ?? '')
        )
        .map((id) => id.trim())
        .filter(Boolean)
    }
    return []
  }
  const obj = payload as {
    data?: Array<{ id?: string; name?: string; created?: number }>
    models?: Array<{ id?: string; name?: string; created?: number }>
  }
  const list = Array.isArray(obj.data) ? obj.data : Array.isArray(obj.models) ? obj.models : []
  return list.map((m) => String(m?.id ?? m?.name ?? '').trim()).filter(Boolean)
}

const NON_TEXT_OPENAI_PATTERN =
  /(realtime|whisper|tts|embedding|dall|image|audio|speech|moderation|transcription|translation|video|sora|babbage|davinci|curie|ada)/i

async function fetchTextCatalog(provider: ModelProviderInstance): Promise<CatalogModel[]> {
  const client = createProviderHttpClient(provider)
  const official = isOfficialOpenAiBaseUrl(provider.baseUrl)
  try {
    const resp = await client.get('/models')
    const ids = extractRawModelIds(resp?.data)
    const remoteRows = ids
      .filter((id) => {
        if (isOpenAiTextModelId(id)) return true
        if (!official && isCustomTextModelId(id) && !NON_TEXT_OPENAI_PATTERN.test(id)) return true
        return false
      })
      .map((id) => ({ id, name: id, modality: 'text' as const }))
    return mergeOpenAiCatalogWithBuiltin(remoteRows, 'text')
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined
    if (status === 404 || status === 405) {
      return listOpenAiCatalogModels('text')
    }
    throw fail(PROVIDER_ERRORS.actionFailed, {
      action: 'listModels',
      detail: await readHttpError(err)
    })
  }
}

async function fetchImageCatalog(provider: ModelProviderInstance): Promise<CatalogModel[]> {
  const official = isOfficialOpenAiBaseUrl(provider.baseUrl)
  if (!provider.apiKey?.trim()) {
    return listOpenAiCatalogModels('image')
  }
  const client = createProviderHttpClient(provider)
  try {
    const resp = await client.get('/models')
    const ids = extractRawModelIds(resp?.data)
    const remoteRows = ids
      .filter((id) => isOpenAiImageModelId(id) || (!official && isCustomImageModelId(id)))
      .map((id) => ({ id, name: id, modality: 'image' as const }))
    return mergeOpenAiCatalogWithBuiltin(remoteRows, 'image')
  } catch {
    return listOpenAiCatalogModels('image')
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
    if (modality === 'image') return fetchImageCatalog(provider)
    // TTS：/models 只给 id、不给声音列表，用本地静态表（含 supported_voices）
    if (modality === 'audio') return listOpenAiTtsCatalogModels()
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

  /**
   * 语音合成：走 OpenAI 的 `POST /audio/speech`（model + input + voice）。
   * 同一个形状通用于 OpenAI 官方与所有 OpenAI 兼容聚合器，所以直接复用共享实现。
   */
  generateSpeech(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult> {
    return generateOpenAiCompatibleSpeech(provider, modelId, input)
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
