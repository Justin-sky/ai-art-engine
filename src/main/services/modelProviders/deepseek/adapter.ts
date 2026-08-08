import axios from 'axios'
import type {
  GenerateImageInput,
  GenerateImageResult,
  GenerateSpeechInput,
  GenerateSpeechResult,
  GenerateTextInput,
  GenerateTextResult,
  GenerateVideoInput,
  GenerateVideoJob,
  ModelProviderInstance
} from '@shared/modelProvider'
import type { ModelProviderAdapter, VideoPollResult } from '../types'
import {
  createProviderHttpClient,
  formatAuthError,
  isAuthFailure,
  readHttpError
} from '../http'
import { generateOpenAiCompatibleText } from '../openaiCompat'

function notSupported(feature: string): Promise<never> {
  return Promise.reject(new Error(`DeepSeek 提供商仅支持文本，暂未接入${feature}`))
}

/** DeepSeek 官方仅提供对话模型（deepseek-chat / deepseek-reasoner） */
function isDeepSeekTextModelId(modelId: string): boolean {
  return /^deepseek-/i.test(modelId.trim())
}

export const deepSeekAdapter: ModelProviderAdapter = {
  kind: 'deepseek',

  async assertAuth(provider) {
    if (!provider.apiKey.trim()) throw new Error('请先填写 API Key')
    const client = createProviderHttpClient(provider)
    try {
      await client.get('/models', { timeout: 20_000 })
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined
      const raw = await readHttpError(err)
      if (isAuthFailure(status, raw)) {
        throw new Error(formatAuthError(`API Key 无效，已禁止拉取模型: ${raw}`, provider))
      }
      throw new Error(`连接测试失败: ${formatAuthError(raw, provider)}`)
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
        .map((id) => ({ id, name: id, modality: 'text' as const }))
    } catch (err) {
      throw new Error(`拉取 DeepSeek 模型列表失败: ${await readHttpError(err)}`)
    }
  },

  generateText(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateTextInput
  ): Promise<GenerateTextResult> {
    return generateOpenAiCompatibleText(provider, modelId, input)
  },

  generateImage(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateImageInput
  ): Promise<GenerateImageResult> {
    return notSupported('图片生成')
  },

  submitVideo(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateVideoInput
  ): Promise<GenerateVideoJob> {
    return notSupported('视频生成')
  },

  pollVideo(
    _provider: ModelProviderInstance,
    _job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    return notSupported('视频生成')
  },

  generateSpeech(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult> {
    return notSupported('语音合成')
  }
}
