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
  ModelProviderInstance
} from '@shared/modelProvider'
import {
  isXaiTextModelId,
  listXaiCatalogModels
} from '@shared/modelProviders/xai/modelCapabilities'
import type { ModelProviderAdapter, VideoPollResult } from '../types'
import {
  createProviderHttpClient,
  formatAuthError,
  isAuthFailure,
  LONG_GENERATE_TIMEOUT_MS,
  readHttpError,
  trimBaseUrl
} from '../http'
import { generateOpenAiCompatibleText } from '../openaiCompat'

function notSupported(feature: string): Promise<never> {
  return Promise.reject(
    new Error(`xAI（Grok）提供商暂未接入${feature}，当前仅支持文本、图片与视频`)
  )
}

function parseGeneratedImages(
  data: { data?: Array<{ b64_json?: string; url?: string }> },
  modelId: string
): GenerateImageResult {
  const images = (data.data ?? [])
    .map((row) => {
      if (row.b64_json) return `data:image/png;base64,${row.b64_json}`
      if (row.url) return row.url
      return ''
    })
    .filter(Boolean)
  if (!images.length) throw new Error('xAI 未返回图片')
  return { images, model: modelId }
}

async function fetchTextCatalog(provider: ModelProviderInstance): Promise<CatalogModel[]> {
  const client = createProviderHttpClient(provider)
  try {
    const { data } = await client.get<{ data?: Array<{ id?: string }> }>('/models')
    return (data.data ?? [])
      .map((m) => String(m.id ?? '').trim())
      .filter(Boolean)
      .filter(isXaiTextModelId)
      .map((id) => ({ id, name: id, modality: 'text' as const }))
  } catch (err) {
    throw new Error(`拉取 xAI 文本模型列表失败: ${await readHttpError(err)}`)
  }
}

export const xaiAdapter: ModelProviderAdapter = {
  kind: 'xai',

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
    if (modality === 'image' || modality === 'video') {
      return listXaiCatalogModels(modality)
    }
    if (modality !== 'text') return []
    return fetchTextCatalog(provider)
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
      throw new Error('xAI 图片生成（Grok Imagine）暂不支持参考图，请使用纯文生图')
    }
    const body: Record<string, unknown> = {
      model: modelId,
      prompt: input.prompt,
      response_format: 'b64_json'
    }
    if (input.aspectRatio?.trim()) body.aspect_ratio = input.aspectRatio.trim()
    if (input.resolution?.trim()) body.resolution = input.resolution.trim()
    if (input.n && input.n >= 1) body.n = Math.min(4, Math.floor(input.n))

    const client = createProviderHttpClient(provider, LONG_GENERATE_TIMEOUT_MS)
    try {
      const { data } = await client.post<{
        data?: Array<{ b64_json?: string; url?: string }>
      }>('/images/generations', body)
      return parseGeneratedImages(data, modelId)
    } catch (err) {
      throw new Error(
        `xAI 图片生成失败: ${formatAuthError(await readHttpError(err), provider)}`
      )
    }
  },

  async submitVideo(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateVideoInput
  ): Promise<GenerateVideoJob> {
    const client = createProviderHttpClient(provider, LONG_GENERATE_TIMEOUT_MS)
    const body: Record<string, unknown> = {
      model: modelId,
      prompt: input.prompt
    }
    if (input.duration != null && Number.isFinite(input.duration)) {
      body.duration = Math.min(15, Math.max(1, Math.round(input.duration)))
    }
    const resolution = (input.resolution ?? '').trim()
    if (/^\d{3,4}p$/i.test(resolution)) body.resolution = resolution.toLowerCase()
    if (input.aspectRatio?.trim()) body.aspect_ratio = input.aspectRatio.trim()
    const firstFrame = input.firstFrameImageUrl?.trim()
    if (firstFrame) body.image = firstFrame

    try {
      const { data } = await client.post<{ request_id?: string; id?: string }>(
        '/videos/generations',
        body
      )
      const jobId = data.request_id ?? data.id
      if (!jobId) throw new Error('xAI 未返回视频任务 request_id')
      return {
        jobId,
        pollingUrl: `${trimBaseUrl(provider.baseUrl)}/videos/${jobId}`,
        status: 'submitted',
        model: modelId
      }
    } catch (err) {
      throw new Error(`提交 xAI 视频生成失败: ${await readHttpError(err)}`)
    }
  },

  async pollVideo(
    provider: ModelProviderInstance,
    job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    const client = createProviderHttpClient(provider)
    try {
      const path = job.pollingUrl.startsWith('http')
        ? job.pollingUrl
        : `/videos/${job.jobId}`
      const { data } = await client.get<{
        status?: string
        video?: { url?: string }
        error?: string | { message?: string }
      }>(path)
      const raw = String(data.status ?? 'processing').toLowerCase()

      let status: VideoPollResult['status'] = 'pending'
      if (raw === 'done' || raw === 'completed' || raw === 'succeeded' || raw === 'success') {
        status = 'completed'
      } else if (raw === 'processing' || raw === 'running' || raw === 'in_progress') {
        status = 'in_progress'
      } else if (raw === 'failed' || raw === 'cancelled' || raw === 'canceled') {
        status = 'failed'
      }

      const error =
        typeof data.error === 'string'
          ? data.error
          : data.error && typeof data.error === 'object'
            ? data.error.message
            : undefined
      let progress = 15
      if (status === 'in_progress') progress = 55
      if (status === 'completed' || status === 'failed') progress = 100

      return {
        status,
        progress,
        error,
        downloadUrl: status === 'completed' ? data.video?.url?.trim() : undefined
      }
    } catch (err) {
      throw new Error(`轮询 xAI 视频任务失败: ${await readHttpError(err)}`)
    }
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
