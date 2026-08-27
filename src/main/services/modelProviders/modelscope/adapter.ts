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
  classifyModelScopeModelModality,
  MODELSCOPE_DEFAULT_BASE_URL
} from '@shared/modelProvider'
import {
  listModelScopeCatalogModels,
  resolveModelScopeModelCapabilities
} from '@shared/modelProviders/modelscope/modelCapabilities'
import { fail, defErrSimple } from '@shared/errors/appError'
import { PROVIDER_ERRORS } from '../catalog'
import type { ModelProviderAdapter, VideoPollResult } from '../types'
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

// —— 本地双语文案（中文保持原文不变，英文为新增映射）——
const E_MS_MISSING_KEY = defErrSimple(
  'provider.modelscope.missingApiKey',
  '请先填写 API Key（魔塔访问令牌）',
  'Fill in the API Key (ModelScope access token) first'
)
const E_MS_IMAGE_FAILED = defErrSimple(
  'provider.modelscope.imageTaskFailed',
  '图片生成失败',
  'Image generation failed'
)
const E_MS_IMAGE_RESULT_NO_URL = defErrSimple(
  'provider.modelscope.imageResultNoUrl',
  '图片任务已完成但未返回图片 URL',
  'Image task finished but returned no image URLs'
)
/** 不支持模态句式使用的提供商名 */
const MODELSCOPE_NAME = { zh: '魔塔', en: 'ModelScope' } as const

const ASPECT_TO_SIZE: Record<string, string> = {
  '1:1': '1024x1024',
  '16:9': '1280x720',
  '9:16': '720x1280',
  '4:3': '1280x960',
  '3:4': '960x1280'
}

const IMAGE_POLL_INTERVAL_MS = 5_000
const IMAGE_POLL_MAX_ATTEMPTS = 60

function providerClient(provider: ModelProviderInstance, timeoutMs?: number) {
  return createProviderHttpClient(
    {
      ...provider,
      baseUrl: trimBaseUrl(provider.baseUrl || MODELSCOPE_DEFAULT_BASE_URL)
    },
    timeoutMs
  )
}

function extractImageUrls(body: unknown): string[] {
  if (!body || typeof body !== 'object') return []
  const record = body as Record<string, unknown>

  const fromOutput = Array.isArray(record.output_images)
    ? (record.output_images as unknown[])
        .map((row) => {
          if (typeof row === 'string') return row.trim()
          if (row && typeof row === 'object') {
            const url = (row as { url?: string }).url
            return typeof url === 'string' ? url.trim() : ''
          }
          return ''
        })
        .filter(Boolean)
    : []
  if (fromOutput.length) return fromOutput

  const fromImages = Array.isArray(record.images)
    ? (record.images as Array<{ url?: string; b64_json?: string }>)
        .map((row) => {
          if (row.url) return row.url
          if (row.b64_json) return `data:image/png;base64,${row.b64_json}`
          return ''
        })
        .filter(Boolean)
    : []

  if (fromImages.length) return fromImages

  const fromData = Array.isArray(record.data)
    ? (record.data as Array<{ url?: string; b64_json?: string }>)
        .map((row) => {
          if (row.url) return row.url
          if (row.b64_json) return `data:image/png;base64,${row.b64_json}`
          return ''
        })
        .filter(Boolean)
    : []

  return fromData
}

function mapImageTaskStatus(raw: unknown): 'completed' | 'failed' | 'pending' {
  const s = String(raw ?? '')
    .trim()
    .toUpperCase()
  if (s === 'SUCCEED' || s === 'SUCCEEDED' || s === 'SUCCESS' || s === 'COMPLETED') {
    return 'completed'
  }
  if (s === 'FAILED' || s === 'FAIL' || s === 'ERROR') return 'failed'
  return 'pending'
}

/**
 * 上游任务失败原因原文（不经翻译）。返回 undefined 时由调用方落本地兜底文案。
 */
function taskErrorMessage(body: Record<string, unknown>): string | undefined {
  const error = body.error
  if (typeof error === 'string' && error.trim()) return error
  if (error && typeof error === 'object') {
    const msg = (error as { message?: string }).message
    if (typeof msg === 'string' && msg.trim()) return msg
  }
  const errors = body.errors
  if (errors && typeof errors === 'object') {
    const msg = (errors as { message?: string }).message
    if (typeof msg === 'string' && msg.trim()) return msg
  }
  if (typeof body.message === 'string' && body.message.trim()) return body.message
  return undefined
}

async function pollImageTask(
  provider: ModelProviderInstance,
  taskId: string
): Promise<string[]> {
  const client = providerClient(provider, LONG_GENERATE_TIMEOUT_MS)
  for (let i = 0; i < IMAGE_POLL_MAX_ATTEMPTS; i++) {
    const { data } = await client.get<Record<string, unknown>>(`/tasks/${taskId}`, {
      headers: { 'X-ModelScope-Task-Type': 'image_generation' }
    })
    const status = mapImageTaskStatus(data.task_status ?? data.status)
    if (status === 'completed') {
      const urls = extractImageUrls(data)
      if (!urls.length) throw fail(E_MS_IMAGE_RESULT_NO_URL)
      return urls
    }
    if (status === 'failed') {
      const reason = taskErrorMessage(data)
      throw reason ? new Error(reason) : fail(E_MS_IMAGE_FAILED)
    }
    await sleep(IMAGE_POLL_INTERVAL_MS)
  }
  throw fail(PROVIDER_ERRORS.imageTimeout)
}

export const modelScopeAdapter: ModelProviderAdapter = {
  kind: 'modelscope',

  async assertAuth(provider) {
    if (!provider.apiKey.trim()) throw fail(E_MS_MISSING_KEY)
    const client = providerClient(provider)
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
    if (modality === 'audio' || modality === 'video') return []

    if (modality === 'image') {
      return listModelScopeCatalogModels('image')
    }

    const client = providerClient(provider)
    try {
      const { data } = await client.get<{
        data?: Array<{ id?: string; name?: string; owned_by?: string }>
      }>('/models')
      const rows = (data.data ?? [])
        .filter((m) => m.id)
        .map((m) => {
          const id = String(m.id)
          const name = (m.name && String(m.name)) || id
          const modelModality = classifyModelScopeModelModality({ id, name })
          const capabilities =
            resolveModelScopeModelCapabilities(
              id,
              modelModality === 'image' ? 'image' : 'text'
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
      // fall through
    }
    return listModelScopeCatalogModels('text')
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
    const client = providerClient(provider, LONG_GENERATE_TIMEOUT_MS)
    const size =
      (input.resolution?.includes('x') ? input.resolution.trim() : undefined) ||
      (input.aspectRatio?.trim()
        ? ASPECT_TO_SIZE[input.aspectRatio.trim()]
        : undefined) ||
      '1024x1024'

    const body: Record<string, unknown> = {
      model: modelId,
      prompt: input.prompt,
      size,
      n: input.n && input.n >= 1 ? Math.min(4, Math.floor(input.n)) : 1
    }

    try {
      // 多数魔塔文生图模型仅支持异步：提交 task 后再轮询 /tasks/{id}
      const { data } = await client.post<Record<string, unknown>>('/images/generations', body, {
        headers: { 'X-ModelScope-Async-Mode': 'true' }
      })

      const immediate = extractImageUrls(data)
      if (immediate.length && !data.task_id) {
        return { images: immediate, model: modelId }
      }

      const taskId = typeof data.task_id === 'string' ? data.task_id.trim() : ''
      if (!taskId) {
        if (immediate.length) return { images: immediate, model: modelId }
        const reason = taskErrorMessage(data)
        throw reason ? new Error(reason) : fail(E_MS_IMAGE_FAILED)
      }

      const images = await pollImageTask(provider, taskId)
      return { images, model: modelId }
    } catch (err) {
      if (err instanceof Error && !axios.isAxiosError(err)) throw err
      throw fail(PROVIDER_ERRORS.actionFailed, {
        action: 'imageGenerate',
        detail: formatAuthError(await readHttpError(err), provider)
      })
    }
  },

  async submitVideo(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateVideoInput
  ): Promise<GenerateVideoJob> {
    throw fail(PROVIDER_ERRORS.unsupportedModality, { kind: 'video', name: MODELSCOPE_NAME })
  },

  async pollVideo(
    _provider: ModelProviderInstance,
    _job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    throw fail(PROVIDER_ERRORS.unsupportedModality, { kind: 'video', name: MODELSCOPE_NAME })
  },

  async generateSpeech(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult> {
    throw fail(PROVIDER_ERRORS.unsupportedModality, { kind: 'voice', name: MODELSCOPE_NAME })
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
