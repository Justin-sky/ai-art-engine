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
  isGoogleTextModelId,
  listGoogleCatalogModels
} from '@shared/modelProviders/google/modelCapabilities'
import { rewriteAtMentionsForImagePrompt } from '@shared/modelProviders/imagePromptMentions'
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
    new Error(`Google（Gemini）提供商暂未接入${feature}，当前仅支持文本、图片与视频`)
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
  if (!images.length) throw new Error('Google 未返回图片')
  return { images, model: modelId }
}

async function fetchTextCatalog(provider: ModelProviderInstance): Promise<CatalogModel[]> {
  const client = createProviderHttpClient(provider)
  try {
    const { data } = await client.get<{ data?: Array<{ id?: string }> }>('/models')
    return (data.data ?? [])
      .map((m) => String(m.id ?? '').trim())
      .filter(Boolean)
      .filter(isGoogleTextModelId)
      .map((id) => ({ id, name: id, modality: 'text' as const }))
  } catch (err) {
    throw new Error(`拉取 Google 文本模型列表失败: ${await readHttpError(err)}`)
  }
}

function extractVideoDownloadUrl(data: Record<string, unknown>): string | undefined {
  const raw = data as Record<string, unknown> & {
    video_url?: unknown
    output?: unknown
    url?: unknown
    result?: unknown
    generatedVideos?: unknown
  }
  if (typeof raw.video_url === 'string' && raw.video_url.trim()) return raw.video_url.trim()
  if (Array.isArray(raw.output)) {
    const url = raw.output
      .map((item) =>
        item && typeof item === 'object' ? (item as { url?: unknown }).url : undefined
      )
      .find((item) => typeof item === 'string' && item.trim())
    if (typeof url === 'string') return url.trim()
  }
  if (raw.output && typeof raw.output === 'object') {
    const url = (raw.output as { url?: unknown }).url
    if (typeof url === 'string' && url.trim()) return url.trim()
  }
  if (typeof raw.output === 'string' && raw.output.trim()) return raw.output.trim()
  if (Array.isArray(raw.result)) {
    const url = raw.result
      .map((item) =>
        item && typeof item === 'object' ? (item as { url?: unknown }).url : undefined
      )
      .find((item) => typeof item === 'string' && item.trim())
    if (typeof url === 'string') return url.trim()
  }
  if (Array.isArray(raw.generatedVideos)) {
    const url = raw.generatedVideos
      .map((item) =>
        item && typeof item === 'object' ? (item as { url?: unknown }).url : undefined
      )
      .find((item) => typeof item === 'string' && item.trim())
    if (typeof url === 'string') return url.trim()
  }
  if (typeof raw.url === 'string' && raw.url.trim()) return raw.url.trim()
  return undefined
}

export const googleAdapter: ModelProviderAdapter = {
  kind: 'google',

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
      return listGoogleCatalogModels(modality)
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
    const body: Record<string, unknown> = {
      model: modelId,
      // Gemini/Nano Banana 用「图n」对齐 image[]；应用内统一 @n，此处转换
      prompt: rewriteAtMentionsForImagePrompt(input.prompt),
      response_format: 'b64_json'
    }
    if (input.aspectRatio?.trim()) body.aspect_ratio = input.aspectRatio.trim()
    if (input.resolution?.trim()) body.resolution = input.resolution.trim()
    if (input.n && input.n >= 1) body.n = Math.min(4, Math.floor(input.n))
    // Nano Banana 系列图生图 / 编辑：参考图走 JSON body 的 image 字段（单图字符串 / 多图数组）
    const refs = (input.inputReferences ?? []).map((ref) => ref.trim()).filter(Boolean)
    if (refs.length === 1) {
      body.image = refs[0]
    } else if (refs.length > 1) {
      body.image = refs
    }

    const client = createProviderHttpClient(provider, LONG_GENERATE_TIMEOUT_MS)
    try {
      const { data } = await client.post<{
        data?: Array<{ b64_json?: string; url?: string }>
      }>('/images/generations', body)
      return parseGeneratedImages(data, modelId)
    } catch (err) {
      throw new Error(
        `Google 图片生成失败: ${formatAuthError(await readHttpError(err), provider)}`
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
      // Veo 3.1：4–8 秒，默认 8 秒
      body.duration = Math.min(8, Math.max(4, Math.round(input.duration)))
    }
    const resolution = (input.resolution ?? '').trim()
    if (/^\d{3,4}p$/i.test(resolution)) body.resolution = resolution.toLowerCase()
    if (input.aspectRatio?.trim()) body.aspect_ratio = input.aspectRatio.trim()
    const firstFrame = input.firstFrameImageUrl?.trim()
    if (firstFrame) body.image = firstFrame

    try {
      const { data } = await client.post<{ id?: string }>('/videos', body)
      const jobId = data.id
      if (!jobId) throw new Error('Google 未返回视频任务 id')
      return {
        jobId,
        pollingUrl: `${trimBaseUrl(provider.baseUrl)}/videos/${jobId}`,
        status: 'submitted',
        model: modelId
      }
    } catch (err) {
      throw new Error(`提交 Google 视频生成失败: ${await readHttpError(err)}`)
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
      const { data } = await client.get<Record<string, unknown>>(path)
      const raw = String(data.status ?? 'in_progress').toLowerCase()

      let status: VideoPollResult['status'] = 'pending'
      if (raw === 'completed' || raw === 'succeeded' || raw === 'success' || raw === 'done') {
        status = 'completed'
      } else if (
        raw === 'processing' ||
        raw === 'running' ||
        raw === 'in_progress' ||
        raw === 'generating'
      ) {
        status = 'in_progress'
      } else if (raw === 'failed' || raw === 'cancelled' || raw === 'canceled') {
        status = 'failed'
      }

      const error =
        typeof data.error === 'string'
          ? data.error
          : data.error && typeof data.error === 'object'
            ? (data.error as { message?: string }).message
            : undefined
      let progress = 15
      if (status === 'in_progress') progress = 55
      if (status === 'completed' || status === 'failed') progress = 100

      return {
        status,
      progress,
        error,
        downloadUrl: status === 'completed' ? extractVideoDownloadUrl(data) : undefined
      }
    } catch (err) {
      throw new Error(`轮询 Google 视频任务失败: ${await readHttpError(err)}`)
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
