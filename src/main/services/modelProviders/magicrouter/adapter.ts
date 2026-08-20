import type {
  CatalogModel,
  GenerateImageInput,
  GenerateImageResult,
  GenerateSpeechInput,
  GenerateSpeechResult,
  GenerateTextInput,
  GenerateTextResult,
  GenerateVideoInput,
  GenerateVideoJob,
  ModelModality,
  ModelProviderInstance
} from '@shared/modelProvider'
import { normalizeVideoInputReference } from '@shared/modelProvider'
import {
  listMagicRouterCatalogModels,
  toMagicRouterCatalogModels
} from '@shared/modelProviders/magicrouter/modelCapabilities'
import type { ModelProviderAdapter, VideoPollResult } from '../types'
import { LONG_GENERATE_TIMEOUT_MS } from '../http'
import { generateOpenAiCompatibleText } from '../openaiCompat'
import {
  createMagicRouterHttpClient,
  readMagicRouterHttpError
} from './http'

type MagicRouterModelsLive = {
  chat?: string[]
  image?: string[]
  video?: string[]
}

type MagicRouterImageResp = {
  data?: Array<{ url?: string; b64_json?: string }>
}

type MagicRouterVideoSubmitResp = {
  id?: string
  status?: string
  video_url?: string | null
}

type MagicRouterVideoPollResp = {
  id?: string
  status?: string
  video_url?: string | null
  error_code?: string
  error_message?: string
}

function mapVideoStatus(raw: string | undefined): VideoPollResult['status'] {
  const s = (raw ?? '').toLowerCase()
  if (s === 'succeeded' || s === 'success' || s === 'completed') return 'completed'
  if (s === 'failed' || s === 'fail' || s === 'error' || s === 'cancelled' || s === 'expired') {
    return 'failed'
  }
  if (s === 'processing' || s === 'running' || s === 'in_progress') return 'in_progress'
  return 'pending'
}

function normalizeResolution(resolution: string | undefined): string {
  const r = (resolution ?? '').trim().toUpperCase()
  if (r.includes('1080')) return '1080P'
  if (r.includes('480')) return '480P'
  return '720P'
}

function normalizeRatio(aspectRatio: string | undefined): string | undefined {
  const r = (aspectRatio ?? '').trim()
  if (r === '16:9' || r === '9:16' || r === '1:1') return r
  return '16:9'
}

function normalizeDuration(seconds: number | undefined): number {
  if (seconds == null || !Number.isFinite(seconds)) return 5
  return Math.min(15, Math.max(3, Math.round(seconds)))
}

function resolveImageSize(aspectRatio: string | undefined): string | undefined {
  const table: Record<string, string> = {
    '1:1': '1024*1024',
    '16:9': '1280*720',
    '9:16': '720*1280',
    '4:3': '1280*960',
    '3:4': '960*1280'
  }
  return table[(aspectRatio ?? '').trim()]
}

function isVideoEdit(modelId: string): boolean {
  return /videoedit/i.test(modelId)
}

function notSupported(feature: string): Promise<never> {
  return Promise.reject(
    new Error(`MagicRouter 提供商暂未接入${feature}，当前仅支持文本 / 图片 / 视频`)
  )
}

export const magicRouterAdapter: ModelProviderAdapter = {
  kind: 'magicrouter',

  async assertAuth(provider) {
    const client = createMagicRouterHttpClient(provider, 20_000)
    try {
      await client.get('/models/live', { timeout: 20_000 })
    } catch (err) {
      throw new Error(`连接测试失败：${await readMagicRouterHttpError(err)}`)
    }
  },

  async fetchCatalog(provider, modality: ModelModality): Promise<CatalogModel[]> {
    if (modality !== 'text' && modality !== 'image' && modality !== 'video') return []
    const client = createMagicRouterHttpClient(provider)
    try {
      const { data } = await client.get<MagicRouterModelsLive>('/models/live')
      const key = modality === 'text' ? 'chat' : modality
      const ids = data?.[key]
      if (Array.isArray(ids) && ids.length) {
        return toMagicRouterCatalogModels(modality, ids)
      }
    } catch {
      // fall through to static
    }
    return listMagicRouterCatalogModels(modality)
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
    const client = createMagicRouterHttpClient(provider, LONG_GENERATE_TIMEOUT_MS)
    const body: Record<string, unknown> = {
      model: modelId,
      prompt: input.prompt,
      response_format: 'url'
    }
    const size = resolveImageSize(input.aspectRatio)
    if (size) body.size = size
    if (input.n && input.n >= 1) body.n = Math.min(4, Math.floor(input.n))
    const refs = (input.inputReferences ?? []).map((u) => u.trim()).filter(Boolean)
    if (refs.length === 1) {
      body.image = refs[0]
    } else if (refs.length > 1) {
      body.images = refs.slice(0, 3)
    }

    try {
      const { data } = await client.post<MagicRouterImageResp>('/images/generations', body)
      const images = (data.data ?? [])
        .map((row) =>
          row.url?.trim() || (row.b64_json ? `data:image/png;base64,${row.b64_json}` : '')
        )
        .filter(Boolean)
      if (!images.length) throw new Error('MagicRouter 未返回图片')
      return { images, model: modelId }
    } catch (err) {
      if (err instanceof Error && /未返回图片/.test(err.message)) throw err
      throw new Error(`MagicRouter 图片生成失败: ${await readMagicRouterHttpError(err)}`)
    }
  },

  async submitVideo(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateVideoInput
  ): Promise<GenerateVideoJob> {
    const client = createMagicRouterHttpClient(provider, LONG_GENERATE_TIMEOUT_MS)
    const firstFrame = input.firstFrameImageUrl?.trim()
    const lastFrame = input.lastFrameImageUrl?.trim()
    const refs = (input.inputReferences ?? [])
      .map((ref) => normalizeVideoInputReference(ref))
      .filter((ref) => ref.url.trim())
    const refImages = refs.filter((r) => r.kind === 'image_url').map((r) => r.url.trim())
    const refVideos = refs.filter((r) => r.kind === 'video_url').map((r) => r.url.trim())

    const body: Record<string, unknown> = {
      model: modelId,
      prompt: input.prompt,
      duration: normalizeDuration(input.duration),
      resolution: normalizeResolution(input.resolution),
      watermark: false
    }
    if (input.seed != null && Number.isFinite(input.seed)) body.seed = Math.floor(input.seed)
    if (firstFrame) body.image = firstFrame
    if (lastFrame) body.last_image = lastFrame
    if (refVideos.length) body.input_video = refVideos[0]
    if (refImages.length) body.ref_images = refImages.slice(0, isVideoEdit(modelId) ? 3 : 5)
    // 纯 t2v 才带 ratio（i2v / r2v / videoedit 从参考图派生比例）
    if (!firstFrame && !lastFrame && !refImages.length && !refVideos.length) {
      body.ratio = normalizeRatio(input.aspectRatio)
    }

    try {
      const { data } = await client.post<MagicRouterVideoSubmitResp>('/videos/generations', body)
      const taskId = data.id?.trim()
      if (!taskId) throw new Error('MagicRouter 未返回视频任务 id')
      return {
        jobId: taskId,
        pollingUrl: `/videos/generations/${encodeURIComponent(taskId)}`,
        status: data.status ?? 'processing',
        model: modelId
      }
    } catch (err) {
      if (err instanceof Error && /任务 id/.test(err.message)) throw err
      throw new Error(`MagicRouter 提交视频失败: ${await readMagicRouterHttpError(err)}`)
    }
  },

  async pollVideo(
    provider: ModelProviderInstance,
    job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    const client = createMagicRouterHttpClient(provider)
    try {
      const { data } = await client.get<MagicRouterVideoPollResp>(
        `/videos/generations/${encodeURIComponent(job.jobId)}`
      )
      const status = mapVideoStatus(data.status)
      const error =
        status === 'failed'
          ? data.error_message?.trim() ||
            `视频生成失败${data.error_code ? `（${data.error_code}）` : ''}`
          : undefined

      let progress = 15
      if (status === 'in_progress') progress = 55
      if (status === 'pending' && /queue/i.test(data.status ?? '')) progress = 25
      if (status === 'completed' || status === 'failed') progress = 100

      let downloadUrl: string | undefined
      if (status === 'completed') {
        downloadUrl = data.video_url?.trim()
        if (!downloadUrl) throw new Error('视频任务已完成但未返回下载地址')
      }

      return { status, progress, error, downloadUrl }
    } catch (err) {
      if (err instanceof Error && /下载地址/.test(err.message)) throw err
      throw new Error(`MagicRouter 轮询视频任务失败: ${await readMagicRouterHttpError(err)}`)
    }
  },

  generateSpeech(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult> {
    return notSupported('语音合成')
  }
}
