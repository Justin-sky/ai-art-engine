import axios from 'axios'
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
  ModelProviderInstance
} from '@shared/modelProvider'
import {
  isZhipuTextModelId,
  listZhipuCatalogModels
} from '@shared/modelProviders/zhipu/modelCapabilities'
import { resolveZhipuImageSize } from '@shared/modelProviders/zhipu/imageSize'
import type { ModelProviderAdapter, VideoPollResult } from '../types'
import {
  createProviderHttpClient,
  formatAuthError,
  isAuthFailure,
  LONG_GENERATE_TIMEOUT_MS,
  readHttpError
} from '../http'
import { generateOpenAiCompatibleText } from '../openaiCompat'

function notSupported(feature: string): Promise<never> {
  return Promise.reject(new Error(`智谱提供商暂未接入${feature}，当前仅支持文本与图片`))
}

export const zhipuAdapter: ModelProviderAdapter = {
  kind: 'zhipu',

  async assertAuth(provider) {
    if (!provider.apiKey.trim()) throw new Error('请先填写 API Key')
    const client = createProviderHttpClient(provider)
    try {
      await client.get('/models', { timeout: 20_000 })
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined
      const raw = await readHttpError(err)
      if (status === 404) {
        // 部分账号 / 区域不支持 GET /models：能收到 404 说明密钥链路已通
        return
      }
      if (isAuthFailure(status, raw)) {
        throw new Error(formatAuthError(`API Key 无效，已禁止拉取模型: ${raw}`, provider))
      }
      throw new Error(`连接测试失败: ${formatAuthError(raw, provider)}`)
    }
  },

  async fetchCatalog(provider, modality) {
    if (modality === 'image') return listZhipuCatalogModels('image')
    if (modality !== 'text') return []

    const client = createProviderHttpClient(provider)
    try {
      const { data } = await client.get<{ data?: Array<{ id?: string }> }>('/models')
      const rows = (data.data ?? [])
        .map((m) => String(m.id ?? '').trim())
        .filter(Boolean)
        .filter(isZhipuTextModelId)
      if (rows.length) {
        return rows.map((id) => ({ id, name: id, modality: 'text' as const }))
      }
    } catch {
      // GET /models 不可用时回退静态 GLM 列表
    }
    return listZhipuCatalogModels('text')
  },

  generateText(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateTextInput
  ): Promise<GenerateTextResult> {
    return generateOpenAiCompatibleText(provider, modelId, input)
  },

  async generateImage(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateImageInput
  ): Promise<GenerateImageResult> {
    if (input.inputReferences?.length) {
      throw new Error('智谱图片生成（CogView）暂不支持参考图，请使用纯文生图')
    }
    const size = resolveZhipuImageSize(input.resolution, input.aspectRatio)
    const body: Record<string, unknown> = {
      model: modelId,
      prompt: input.prompt
    }
    if (size) body.size = size

    const client = createProviderHttpClient(provider, LONG_GENERATE_TIMEOUT_MS)
    try {
      const { data } = await client.post<{
        data?: Array<{ b64_json?: string; url?: string }>
      }>('/images/generations', body)
      const images = (data.data ?? [])
        .map((row) => {
          if (row.b64_json) return `data:image/png;base64,${row.b64_json}`
          if (row.url) return row.url
          return ''
        })
        .filter(Boolean)
      if (!images.length) throw new Error('智谱未返回图片')
      return { images, model: modelId }
    } catch (err) {
      throw new Error(`智谱图片生成失败: ${formatAuthError(await readHttpError(err), provider)}`)
    }
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
  },

  submitModel3d(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateModel3dInput
  ): Promise<GenerateModel3dJob> {
    throw new Error('该提供商暂不支持 3D 模型生成')
  },

  pollModel3d(
    _provider: ModelProviderInstance,
    _job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    throw new Error('该提供商暂不支持 3D 模型生成')
  }
}
