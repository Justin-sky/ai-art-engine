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
  ModelModality,
  ModelProviderInstance
} from '@shared/modelProvider'
import { KLING_DEFAULT_BASE_URL } from '@shared/modelProvider'
import { listKlingCatalogModels } from '@shared/modelProviders/kling/modelCapabilities'
import { resolveAppErrorLocale, fail, defErrSimple } from '@shared/errors/appError'
import { PROVIDER_ERRORS } from '../catalog'
import type { ModelProviderAdapter, VideoPollResult } from '../types'
import { trimBaseUrl } from '../http'
import {
  createKlingHttpClient,
  createKlingLongClient,
  formatKlingError,
  readKlingHttpError,
  unwrapKlingData,
  KLING_ACTIONS,
  type KlingApiEnvelope
} from './http'

// —— 本地双语文案（中文保持原文不变，英文为新增映射）——
const E_KLING_IMAGE_RESULT_NO_URL = defErrSimple(
  'provider.kling.imageResultNoUrl',
  '图片任务已完成但未返回图片 URL',
  'Image task finished but returned no image URLs'
)
const E_KLING_IMAGE_FAILED = defErrSimple(
  'provider.kling.imageGenerationFailed',
  '图片生成失败',
  'Image generation failed'
)
const E_KLING_TEXT_UNSUPPORTED = defErrSimple(
  'provider.kling.textUnsupported',
  '可灵不支持文本生成',
  'Kling does not support text generation'
)
const E_KLING_VOICE_UNSUPPORTED = defErrSimple(
  'provider.kling.voiceUnsupported',
  '可灵不支持语音生成',
  'Kling does not support speech generation'
)

/** 非 throw 场景（结果对象的 error 字段）按当前语言取文案 */
function pickKlingBi(zh: string, en: string): string {
  return resolveAppErrorLocale() === 'en-US' ? en : zh
}

type KlingTaskData = {
  task_id?: string
  task_status?: string
  task_status_msg?: string
  task_result?: {
    images?: Array<{ url?: string; index?: number }>
    videos?: Array<{ url?: string; id?: string }>
  }
}

const IMAGE_POLL_INTERVAL_MS = 2_500
const IMAGE_POLL_MAX_ATTEMPTS = 120

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function mapTaskStatus(raw: string | undefined): VideoPollResult['status'] {
  const s = (raw ?? '').toLowerCase()
  if (s === 'succeed' || s === 'success' || s === 'completed') return 'completed'
  if (s === 'failed' || s === 'fail' || s === 'error') return 'failed'
  if (s === 'processing' || s === 'running' || s === 'in_progress') return 'in_progress'
  return 'pending'
}

function snapDuration(seconds: number | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '5'
  return Math.abs(seconds - 10) < Math.abs(seconds - 5) ? '10' : '5'
}

function modeFromResolution(resolution: string | undefined): string {
  const r = (resolution ?? '').toLowerCase()
  if (r.includes('1080') || r === 'pro') return 'pro'
  return 'std'
}

async function pollImageTask(
  provider: ModelProviderInstance,
  taskId: string
): Promise<string[]> {
  const client = createKlingLongClient(provider)
  for (let i = 0; i < IMAGE_POLL_MAX_ATTEMPTS; i++) {
    const { data: envelope } = await client.get<KlingApiEnvelope<KlingTaskData>>(
      `/v1/images/generations/${taskId}`
    )
    const data = unwrapKlingData(envelope, KLING_ACTIONS.pollImage)
    const status = mapTaskStatus(data.task_status)
    if (status === 'completed') {
      const urls = (data.task_result?.images ?? [])
        .map((img) => img.url?.trim() ?? '')
        .filter(Boolean)
      if (!urls.length) throw fail(E_KLING_IMAGE_RESULT_NO_URL)
      return urls
    }
    if (status === 'failed') {
      throw data.task_status_msg ? new Error(data.task_status_msg) : fail(E_KLING_IMAGE_FAILED)
    }
    await sleep(IMAGE_POLL_INTERVAL_MS)
  }
  throw fail(PROVIDER_ERRORS.imageTimeout)
}

export const klingAdapter: ModelProviderAdapter = {
  kind: 'kling',

  async assertAuth(provider) {
    const client = createKlingHttpClient(provider)
    try {
      const { data: envelope } = await client.get<KlingApiEnvelope<unknown>>(
        '/v1/videos/text2video',
        { params: { pageNum: 1, pageSize: 1 } }
      )
      if (typeof envelope?.code === 'number' && envelope.code !== 0) {
        throw new Error(envelope.message || `code=${envelope.code}`)
      }
    } catch (err) {
      throw fail(PROVIDER_ERRORS.connectionTestFailed, {
        detail: formatKlingError(await readKlingHttpError(err))
      })
    }
  },

  async fetchCatalog(_provider, modality: ModelModality): Promise<CatalogModel[]> {
    return listKlingCatalogModels(modality)
  },

  async generateText(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateTextInput
  ): Promise<GenerateTextResult> {
    throw fail(E_KLING_TEXT_UNSUPPORTED)
  },

  async generateImage(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateImageInput
  ): Promise<GenerateImageResult> {
    const client = createKlingLongClient(provider)
    const body: Record<string, unknown> = {
      model_name: modelId,
      prompt: input.prompt
    }
    if (input.n && input.n >= 1) body.n = Math.min(9, Math.floor(input.n))
    if (input.aspectRatio?.trim()) body.aspect_ratio = input.aspectRatio.trim()
    if (input.resolution?.trim()) {
      const res = input.resolution.trim().toLowerCase()
      body.resolution = res.includes('2') ? '2k' : '1k'
    }
    const refs = (input.inputReferences ?? []).map((u) => u.trim()).filter(Boolean)
    if (refs[0]) {
      body.image = refs[0]
      body.image_reference = 'subject'
    }

    try {
      const { data: envelope } = await client.post<KlingApiEnvelope<KlingTaskData>>(
        '/v1/images/generations',
        body
      )
      const data = unwrapKlingData(envelope, KLING_ACTIONS.submitImage)
      const taskId = data.task_id
      if (!taskId) throw fail(PROVIDER_ERRORS.noImageTaskId)

      const immediate = (data.task_result?.images ?? [])
        .map((img) => img.url?.trim() ?? '')
        .filter(Boolean)
      if (immediate.length && mapTaskStatus(data.task_status) === 'completed') {
        return { images: immediate, model: modelId }
      }

      const images = await pollImageTask(provider, taskId)
      return { images, model: modelId }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('可灵')) throw err
      throw fail(PROVIDER_ERRORS.actionFailed, {
        action: 'imageGenerate',
        detail: formatKlingError(await readKlingHttpError(err))
      })
    }
  },

  async submitVideo(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateVideoInput
  ): Promise<GenerateVideoJob> {
    const client = createKlingHttpClient(provider)
    const base = trimBaseUrl(provider.baseUrl || KLING_DEFAULT_BASE_URL)
    const firstFrame = input.firstFrameImageUrl?.trim()
    const lastFrame = input.lastFrameImageUrl?.trim()
    const isImage2Video = Boolean(firstFrame)

    const body: Record<string, unknown> = {
      model_name: modelId,
      prompt: input.prompt,
      duration: snapDuration(input.duration),
      mode: modeFromResolution(input.resolution)
    }
    if (input.aspectRatio?.trim()) body.aspect_ratio = input.aspectRatio.trim()
    if (input.generateAudio != null) body.sound = input.generateAudio ? 'on' : 'off'

    let path: string
    if (isImage2Video) {
      path = '/v1/videos/image2video'
      body.image = firstFrame
      if (lastFrame) body.image_tail = lastFrame
    } else {
      path = '/v1/videos/text2video'
    }

    try {
      const { data: envelope } = await client.post<KlingApiEnvelope<KlingTaskData>>(path, body)
      const data = unwrapKlingData(envelope, KLING_ACTIONS.submitVideo)
      const taskId = data.task_id
      if (!taskId) throw fail(PROVIDER_ERRORS.noVideoTaskId)
      return {
        jobId: taskId,
        pollingUrl: `${base}${path}/${taskId}`,
        status: data.task_status ?? 'submitted',
        model: modelId
      }
    } catch (err) {
      throw fail(PROVIDER_ERRORS.actionFailed, {
        action: 'videoSubmit',
        detail: formatKlingError(await readKlingHttpError(err))
      })
    }
  },

  async pollVideo(
    provider: ModelProviderInstance,
    job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    const client = createKlingHttpClient(provider)
    try {
      const path = job.pollingUrl.startsWith('http')
        ? job.pollingUrl
        : `/v1/videos/text2video/${job.jobId}`
      const { data: envelope } = await client.get<KlingApiEnvelope<KlingTaskData>>(path)
      const data = unwrapKlingData(envelope, KLING_ACTIONS.pollVideo)
      const status = mapTaskStatus(data.task_status)
      const downloadUrl = data.task_result?.videos?.[0]?.url
      const error =
        status === 'failed'
          ? data.task_status_msg || pickKlingBi('视频生成失败', 'Video generation failed')
          : undefined

      let progress = 15
      if (status === 'in_progress') progress = 55
      if (status === 'completed' || status === 'failed') progress = 100

      return { status, progress, error, downloadUrl }
    } catch (err) {
      throw fail(PROVIDER_ERRORS.actionFailed, {
        action: 'videoPolling',
        detail: formatKlingError(await readKlingHttpError(err))
      })
    }
  },

  async generateSpeech(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult> {
    throw fail(E_KLING_VOICE_UNSUPPORTED)
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
