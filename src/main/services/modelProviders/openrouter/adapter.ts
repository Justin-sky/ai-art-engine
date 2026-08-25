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
  ModelProviderInstance,
  OpenRouterImageModel,
  OpenRouterTextModel,
  OpenRouterVideoModel
} from '@shared/modelProvider'
import { isTextCatalogModel, toOpenRouterInputReferenceBody } from '@shared/modelProvider'
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
import {
  generateOpenAiCompatibleSpeech,
  generateOpenAiCompatibleText
} from '../openaiCompat'

/** OpenRouter 目录接口偶发返回裸数组或 { data / models }，统一拆成行列表 */
function asCatalogRows<T extends { id?: string }>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[]
  if (!body || typeof body !== 'object') return []
  const record = body as Record<string, unknown>
  if (Array.isArray(record.data)) return record.data as T[]
  if (Array.isArray(record.models)) return record.models as T[]
  return []
}

export const openRouterAdapter: ModelProviderAdapter = {
  kind: 'openrouter',

  async assertAuth(provider) {
    if (!provider.apiKey.trim()) throw new Error('请先填写 API Key')
    const client = createProviderHttpClient(provider)
    try {
      await client.get('/key', { timeout: 20_000 })
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined
      const raw = await readHttpError(err)

      if (status === 404) {
        try {
          await client.get('/models', { timeout: 20_000, params: { limit: 1 } })
          return
        } catch (probeErr) {
          const probeStatus = axios.isAxiosError(probeErr) ? probeErr.response?.status : undefined
          const probeRaw = await readHttpError(probeErr)
          if (isAuthFailure(probeStatus, probeRaw)) {
            throw new Error(
              formatAuthError(`API Key 无效，已禁止拉取模型：${probeRaw}`, provider)
            )
          }
          throw new Error(`连接测试失败：${formatAuthError(probeRaw, provider)}`)
        }
      }

      if (isAuthFailure(status, raw)) {
        throw new Error(formatAuthError(`API Key 无效，已禁止拉取模型：${raw}`, provider))
      }
      throw new Error(`连接测试失败：${formatAuthError(raw, provider)}`)
    }
  },

  async fetchCatalog(provider, modality) {
    const client = createProviderHttpClient(provider)
    try {
      if (modality === 'image') {
        const { data } = await client.get('/images/models')
        return asCatalogRows<OpenRouterImageModel>(data).map((m) => ({
          id: m.id,
          name: m.name || m.id,
          description: m.description,
          modality: 'image' as const,
          capabilities: {
            supported_parameters: m.supported_parameters,
            architecture: m.architecture,
            supports_streaming: m.supports_streaming
          }
        }))
      }

      if (modality === 'video') {
        const { data } = await client.get('/videos/models')
        return asCatalogRows<OpenRouterVideoModel>(data).map((m) => ({
          id: m.id,
          name: m.name || m.id,
          description: m.description,
          modality: 'video' as const,
          capabilities: {
            supported_resolutions: m.supported_resolutions,
            supported_aspect_ratios: m.supported_aspect_ratios,
            supported_sizes: m.supported_sizes,
            supported_durations: m.supported_durations,
            supported_frame_images: m.supported_frame_images,
            generate_audio: m.generate_audio,
            seed: m.seed,
            allowed_passthrough_parameters: m.allowed_passthrough_parameters
          }
        }))
      }

      if (modality === 'audio') {
        const { data } = await client.get('/models', {
          params: { output_modalities: 'speech' }
        })
        return asCatalogRows<OpenRouterTextModel>(data).map((m) => ({
          id: m.id,
          name: m.name || m.id,
          description: m.description,
          modality: 'audio' as const,
          capabilities: {
            architecture: m.architecture,
            pricing: m.pricing,
            supported_voices: m.supported_voices,
            supported_parameters: m.supported_parameters
          }
        }))
      }

      const { data } = await client.get('/models', {
        params: { output_modalities: 'text' }
      })
      const rows = asCatalogRows<OpenRouterTextModel>(data)
      return rows.filter(isTextCatalogModel).map((m) => ({
        id: m.id,
        name: m.name || m.id,
        description: m.description,
        modality: 'text' as const,
        capabilities: {
          architecture: m.architecture,
          context_length: m.context_length,
          pricing: m.pricing,
          supported_parameters: m.supported_parameters
        }
      }))
    } catch (err) {
      throw new Error(`拉取模型列表失败: ${await readHttpError(err)}`)
    }
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
    const client = createProviderHttpClient(provider, LONG_GENERATE_TIMEOUT_MS)
    const body: Record<string, unknown> = {
      model: modelId,
      // 多参考图（input_references）需用「图n」对齐；应用内统一 @n，此处转换
      prompt: rewriteAtMentionsForImagePrompt(input.prompt)
    }
    if (input.aspectRatio) body.aspect_ratio = input.aspectRatio
    if (input.resolution) body.resolution = input.resolution
    if (input.quality?.trim()) body.quality = input.quality.trim()
    if (input.n && input.n >= 1) body.n = Math.floor(input.n)
    if (input.seed != null) body.seed = input.seed
    if (input.inputReferences?.length) {
      body.input_references = input.inputReferences.map((url) => ({
        type: 'image_url',
        image_url: { url }
      }))
    }

    try {
      const { data } = await client.post<{
        data?: Array<{ b64_json?: string; url?: string; image_url?: { url?: string } }>
        images?: Array<{ b64_json?: string; url?: string; image_url?: { url?: string } }>
        model?: string
      }>('/images', body)

      const rows = data.data ?? data.images ?? []
      const images = rows
        .map((row) => {
          if (row.b64_json) return `data:image/png;base64,${row.b64_json}`
          if (row.url) return row.url
          if (row.image_url?.url) return row.image_url.url
          return ''
        })
        .filter(Boolean)

      if (!images.length) throw new Error('模型未返回图片')
      return { images, model: data.model ?? modelId }
    } catch (err) {
      throw new Error(`图片生成失败: ${await readHttpError(err)}`)
    }
  },

  async submitVideo(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateVideoInput
  ): Promise<GenerateVideoJob> {
    const client = createProviderHttpClient(provider)
    const body: Record<string, unknown> = {
      model: modelId,
      prompt: input.prompt
    }
    if (input.duration != null) body.duration = Math.round(input.duration)
    if (input.resolution) body.resolution = input.resolution
    if (input.aspectRatio) body.aspect_ratio = input.aspectRatio
    if (input.size) body.size = input.size
    if (input.generateAudio != null) body.generate_audio = input.generateAudio
    if (input.seed != null) body.seed = input.seed

    const frameImages: Array<Record<string, unknown>> = []
    if (input.firstFrameImageUrl) {
      frameImages.push({
        type: 'image_url',
        image_url: { url: input.firstFrameImageUrl },
        frame_type: 'first_frame'
      })
    }
    if (input.lastFrameImageUrl) {
      frameImages.push({
        type: 'image_url',
        image_url: { url: input.lastFrameImageUrl },
        frame_type: 'last_frame'
      })
    }
    if (frameImages.length) body.frame_images = frameImages

    if (input.inputReferences?.length) {
      body.input_references = input.inputReferences.map((ref) =>
        toOpenRouterInputReferenceBody(ref)
      )
    }

    try {
      const { data } = await client.post<{
        id: string
        polling_url?: string
        status?: string
      }>('/videos', body, { validateStatus: (s) => s === 200 || s === 202 })

      if (!data?.id) throw new Error('未返回视频任务 id')
      return {
        jobId: data.id,
        pollingUrl: data.polling_url || `${trimBaseUrl(provider.baseUrl)}/videos/${data.id}`,
        status: data.status ?? 'pending',
        model: modelId
      }
    } catch (err) {
      throw new Error(`提交视频生成失败: ${await readHttpError(err)}`)
    }
  },

  async pollVideo(
    provider: ModelProviderInstance,
    job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    const client = createProviderHttpClient(provider)
    try {
      const { data } = await client.get<{
        status?: string
        error?: string | { message?: string }
        unsigned_urls?: string[]
      }>(job.pollingUrl.startsWith('http') ? job.pollingUrl : `/videos/${job.jobId}`)

      const status = (data.status ?? 'pending') as VideoPollResult['status']
      const error =
        typeof data.error === 'string'
          ? data.error
          : data.error && typeof data.error === 'object'
            ? data.error.message
            : undefined

      let progress = 15
      if (status === 'in_progress') progress = 55
      if (status === 'completed') progress = 100
      if (status === 'failed') progress = 100

      return {
        status,
        progress,
        error,
        downloadUrl: data.unsigned_urls?.[0]
      }
    } catch (err) {
      throw new Error(`轮询视频任务失败: ${await readHttpError(err)}`)
    }
  },

  generateSpeech(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult> {
    return generateOpenAiCompatibleSpeech(provider, modelId, input)
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
