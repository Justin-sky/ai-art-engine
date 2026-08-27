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
  ModelModality,
  ModelProviderInstance
} from '@shared/modelProvider'
import {
  classifyDashScopeModelModality,
  DASHSCOPE_DEFAULT_BASE_URL,
  normalizeVideoInputReference
} from '@shared/modelProvider'
import {
  listDashScopeCatalogModels,
  resolveDashScopeModelCapabilities
} from '@shared/modelProviders/dashscope/modelCapabilities'
import type { ModelProviderAdapter, VideoPollResult } from '../types'
import { PROVIDER_ERRORS } from '../catalog'
import { fail, defErrSimple } from '@shared/errors/appError'
import {
  createProviderHttpClient,
  formatAuthError,
  isAuthFailure,
  LONG_GENERATE_TIMEOUT_MS,
  readHttpError,
  sleep,
  trimBaseUrl
} from '../http'
import { generateOpenAiCompatibleText } from '../openaiCompat'
import { dashscopeNativeApiBase } from './nativeBase'

// ── 本文件错误条目（catalog 未覆盖的个性文案）──
const E_NO_TASK_OUTPUT = defErrSimple(
  'provider.dashscope.no-task-output',
  '任务查询未返回 output',
  'Task query returned no output'
)
const E_VIDEO_GEN_FAILED = defErrSimple(
  'provider.dashscope.video-generation-failed',
  '视频生成失败',
  'Video generation failed'
)
const E_HAPPYHORSE_R2V_NEEDS_IMAGE = defErrSimple(
  'provider.dashscope.happyhorse-r2v-needs-image',
  'HappyHorse 参考生视频至少需要 1 张参考图',
  'HappyHorse reference-to-video requires at least 1 reference image'
)
const E_HAPPYHORSE_EDIT_NEEDS_VIDEO = defErrSimple(
  'provider.dashscope.happyhorse-edit-needs-video',
  'HappyHorse 视频编辑需要 1 段输入视频',
  'HappyHorse video editing requires 1 input video'
)

type DashScopeTaskOutput = {
  task_id?: string
  task_status?: string
  message?: string
  code?: string
  video_url?: string
  results?: Array<{ url?: string; code?: string; message?: string }>
}

type DashScopeTaskEnvelope = {
  request_id?: string
  code?: string
  message?: string
  output?: DashScopeTaskOutput
}

const IMAGE_POLL_INTERVAL_MS = 2_500
const IMAGE_POLL_MAX_ATTEMPTS = 120

const ASPECT_TO_SIZE: Record<string, string> = {
  '1:1': '1024*1024',
  '16:9': '1280*720',
  '9:16': '720*1280',
  '4:3': '1280*960',
  '3:4': '960*1280'
}

function mapDashScopeStatus(raw: string | undefined): VideoPollResult['status'] {
  const s = (raw ?? '').toUpperCase()
  if (s === 'SUCCEEDED' || s === 'SUCCESS') return 'completed'
  if (s === 'FAILED' || s === 'CANCELED' || s === 'UNKNOWN') return 'failed'
  if (s === 'RUNNING') return 'in_progress'
  return 'pending'
}

function createNativeClient(provider: ModelProviderInstance, timeoutMs = 120_000) {
  if (!provider.apiKey.trim()) throw fail(PROVIDER_ERRORS.missingApiKey)
  return axios.create({
    baseURL: dashscopeNativeApiBase(provider.baseUrl),
    timeout: timeoutMs,
    headers: {
      Authorization: `Bearer ${provider.apiKey.trim()}`,
      'Content-Type': 'application/json'
    }
  })
}

function snapVideoDuration(seconds: number | undefined): number {
  if (seconds == null || !Number.isFinite(seconds)) return 5
  return Math.abs(seconds - 10) < Math.abs(seconds - 5) ? 10 : 5
}

function normalizeResolution(resolution: string | undefined): string | undefined {
  if (!resolution?.trim()) return undefined
  const r = resolution.trim().toUpperCase().replace(/P$/i, 'P')
  if (r.includes('1080')) return '1080P'
  if (r.includes('720')) return '720P'
  if (r.includes('480')) return '480P'
  return r
}

function modeFromResolution(resolution: string | undefined): 'std' | 'pro' {
  const r = (resolution ?? '').toUpperCase()
  if (r.includes('1080') || r === 'PRO') return 'pro'
  return 'std'
}

async function pollNativeTask(
  provider: ModelProviderInstance,
  taskId: string
): Promise<DashScopeTaskOutput> {
  const client = createNativeClient(provider, LONG_GENERATE_TIMEOUT_MS)
  for (let i = 0; i < IMAGE_POLL_MAX_ATTEMPTS; i++) {
    const { data } = await client.get<DashScopeTaskEnvelope>(`/tasks/${taskId}`)
    if (data.code && data.code !== '' && !data.output) {
      throw new Error(data.message || data.code)
    }
    const output = data.output
    if (!output) throw fail(E_NO_TASK_OUTPUT)
    const status = mapDashScopeStatus(output.task_status)
    if (status === 'completed' || status === 'failed') return output
    await sleep(IMAGE_POLL_INTERVAL_MS)
  }
  throw fail(PROVIDER_ERRORS.imageTimeout)
}

export const dashscopeAdapter: ModelProviderAdapter = {
  kind: 'dashscope',

  async assertAuth(provider) {
    if (!provider.apiKey.trim()) throw fail(PROVIDER_ERRORS.missingApiKey)
    const client = createProviderHttpClient({
      ...provider,
      baseUrl: trimBaseUrl(provider.baseUrl || DASHSCOPE_DEFAULT_BASE_URL)
    })
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

  async fetchCatalog(provider, modality: ModelModality): Promise<CatalogModel[]> {
    if (modality === 'audio') return []

    if (modality === 'image' || modality === 'video') {
      return listDashScopeCatalogModels(modality)
    }

    // 文本：优先远程 /models，失败则回退静态列表
    const client = createProviderHttpClient({
      ...provider,
      baseUrl: trimBaseUrl(provider.baseUrl || DASHSCOPE_DEFAULT_BASE_URL)
    })
    try {
      const { data } = await client.get<{
        data?: Array<{ id?: string; name?: string; owned_by?: string }>
      }>('/models')
      const rows = (data.data ?? [])
        .filter((m) => m.id)
        .map((m) => {
          const id = String(m.id)
          const name = (m.name && String(m.name)) || id
          const modelModality = classifyDashScopeModelModality({ id, name })
          const capabilities =
            resolveDashScopeModelCapabilities(
              id,
              modelModality === 'audio' ? 'text' : modelModality
            ) ?? undefined
          return {
            id,
            name,
            description: m.owned_by ? `owned_by: ${m.owned_by}` : undefined,
            modality: modelModality,
            ...(capabilities ? { capabilities } : {})
          }
        })
        .filter((m) => m.modality === modality)
      if (rows.length) return rows
    } catch {
      // fall through to static
    }
    return listDashScopeCatalogModels('text')
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
    const client = createNativeClient(provider, LONG_GENERATE_TIMEOUT_MS)
    const size =
      (input.resolution?.includes('*') ? input.resolution.trim() : undefined) ||
      (input.aspectRatio?.trim()
        ? ASPECT_TO_SIZE[input.aspectRatio.trim()]
        : undefined) ||
      '1024*1024'

    const bodyInput: Record<string, unknown> = { prompt: input.prompt }
    const refs = (input.inputReferences ?? []).map((u) => u.trim()).filter(Boolean)
    if (refs[0]) bodyInput.ref_image = refs[0]

    const parameters: Record<string, unknown> = {
      size,
      n: input.n && input.n >= 1 ? Math.min(4, Math.floor(input.n)) : 1
    }

    try {
      const { data } = await client.post<DashScopeTaskEnvelope>(
        '/services/aigc/text2image/image-synthesis',
        { model: modelId, input: bodyInput, parameters },
        { headers: { 'X-DashScope-Async': 'enable' } }
      )
      if (data.code && !data.output?.task_id) {
        throw new Error(data.message || data.code)
      }
      const taskId = data.output?.task_id
      if (!taskId) throw fail(PROVIDER_ERRORS.noImageTaskId)

      const output = await pollNativeTask(provider, taskId)
      if (mapDashScopeStatus(output.task_status) === 'failed') {
        // 上游任务失败：message / code 原样透出，由外层统一句式包装
        throw new Error(output.message || output.code || '')
      }
      const images = (output.results ?? [])
        .map((r) => r.url?.trim() ?? '')
        .filter(Boolean)
      if (!images.length) throw fail(PROVIDER_ERRORS.imageResultNoUrl)
      return { images, model: modelId }
    } catch (err) {
      throw fail(PROVIDER_ERRORS.actionFailed, {
        action: 'imageGenerate',
        detail: formatAuthError(await readHttpError(err), provider)
      })
    }
  },

  async submitVideo(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateVideoInput
  ): Promise<GenerateVideoJob> {
    const client = createNativeClient(provider)
    const firstFrame = input.firstFrameImageUrl?.trim()
    const lastFrame = input.lastFrameImageUrl?.trim()
    const refs = (input.inputReferences ?? []).map(normalizeVideoInputReference)
    const imageRefs = refs
      .filter((r) => r.kind === 'image_url')
      .map((r) => r.url.trim())
      .filter(Boolean)
    const videoRefs = refs
      .filter((r) => r.kind === 'video_url')
      .map((r) => r.url.trim())
      .filter(Boolean)

    const bodyInput: Record<string, unknown> = {
      prompt: input.prompt
    }
    const isHappyHorse = /^happyhorse/i.test(modelId)
    const isHappyHorseR2v = isHappyHorse && /r2v/i.test(modelId)
    const isHappyHorseEdit = isHappyHorse && /video-edit/i.test(modelId)
    const isBailianKling = /^kling\//i.test(modelId)

    if (isHappyHorseR2v) {
      if (!imageRefs.length) {
        throw fail(E_HAPPYHORSE_R2V_NEEDS_IMAGE)
      }
      bodyInput.media = imageRefs.slice(0, 9).map((url) => ({
        type: 'reference_image',
        url
      }))
    } else if (isHappyHorseEdit) {
      if (!videoRefs.length) {
        throw fail(E_HAPPYHORSE_EDIT_NEEDS_VIDEO)
      }
      const media: Array<{ type: string; url: string }> = [
        { type: 'video', url: videoRefs[0]! }
      ]
      for (const url of imageRefs.slice(0, 5)) {
        media.push({ type: 'reference_image', url })
      }
      bodyInput.media = media
    } else if (firstFrame || lastFrame) {
      // HappyHorse i2v / 百炼可灵使用 media[]；万相系使用 img_url
      if (isHappyHorse || isBailianKling) {
        const media: Array<{ type: string; url: string }> = []
        if (firstFrame) media.push({ type: 'first_frame', url: firstFrame })
        if (lastFrame && isBailianKling) media.push({ type: 'last_frame', url: lastFrame })
        bodyInput.media = media
      } else if (firstFrame) {
        bodyInput.img_url = firstFrame
      }
    }

    const parameters: Record<string, unknown> = {
      watermark: false
    }

    if (isBailianKling) {
      parameters.duration = snapVideoDuration(input.duration)
      parameters.mode = modeFromResolution(input.resolution)
      if (input.generateAudio != null) parameters.audio = Boolean(input.generateAudio)
      // 文生视频必须传 aspect_ratio；有首帧时宽高比跟随首帧
      if (!firstFrame && input.aspectRatio?.trim()) {
        parameters.aspect_ratio = input.aspectRatio.trim()
      }
    } else if (isHappyHorseEdit) {
      const resolution = normalizeResolution(input.resolution)
      if (resolution) parameters.resolution = resolution
    } else {
      parameters.duration = snapVideoDuration(input.duration)
      const resolution = normalizeResolution(input.resolution)
      if (resolution) parameters.resolution = resolution
      // HappyHorse 图生视频宽高比跟随首帧，不传 ratio；r2v 可传 ratio
      const skipRatio = isHappyHorse && Boolean(firstFrame) && !isHappyHorseR2v
      if (!skipRatio && input.aspectRatio?.trim()) {
        parameters.ratio = input.aspectRatio.trim()
      }
      if (input.size?.includes('*')) parameters.size = input.size.trim()
    }

    try {
      const { data } = await client.post<DashScopeTaskEnvelope>(
        '/services/aigc/video-generation/video-synthesis',
        { model: modelId, input: bodyInput, parameters },
        { headers: { 'X-DashScope-Async': 'enable' } }
      )
      if (data.code && !data.output?.task_id) {
        throw new Error(data.message || data.code)
      }
      const taskId = data.output?.task_id
      if (!taskId) throw fail(PROVIDER_ERRORS.noVideoTaskId)
      const nativeBase = dashscopeNativeApiBase(provider.baseUrl)
      return {
        jobId: taskId,
        pollingUrl: `${nativeBase}/tasks/${taskId}`,
        status: data.output?.task_status ?? 'PENDING',
        model: modelId
      }
    } catch (err) {
      throw fail(PROVIDER_ERRORS.actionFailed, {
        action: 'videoSubmit',
        detail: formatAuthError(await readHttpError(err), provider)
      })
    }
  },

  async pollVideo(
    provider: ModelProviderInstance,
    job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    const client = createNativeClient(provider)
    try {
      const path = job.pollingUrl.startsWith('http')
        ? job.pollingUrl
        : `/tasks/${job.jobId}`
      const { data } = await client.get<DashScopeTaskEnvelope>(path)
      if (data.code && !data.output) {
        throw new Error(data.message || data.code)
      }
      const output = data.output
      const status = mapDashScopeStatus(output?.task_status)
      const downloadUrl = output?.video_url
      const error =
        status === 'failed'
          ? output?.message || output?.code || fail(E_VIDEO_GEN_FAILED).message
          : undefined

      let progress = 15
      if (status === 'in_progress') progress = 55
      if (status === 'completed' || status === 'failed') progress = 100

      return { status, progress, error, downloadUrl }
    } catch (err) {
      throw fail(PROVIDER_ERRORS.actionFailed, {
        action: 'videoPolling',
        detail: formatAuthError(await readHttpError(err), provider)
      })
    }
  },

  async generateSpeech(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult> {
    throw fail(PROVIDER_ERRORS.unsupportedModality, {
      kind: 'voice',
      name: { zh: '通义千问', en: 'Qwen (DashScope)' }
    })
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
