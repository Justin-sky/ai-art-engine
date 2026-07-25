import axios from 'axios'
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
} from '@shared/openrouter'
import {
  classifyModelScopeModelModality,
  MODELSCOPE_DEFAULT_BASE_URL
} from '@shared/openrouter'
import {
  listModelScopeCatalogModels,
  resolveModelScopeModelCapabilities
} from '@shared/modelProviders/modelscope/modelCapabilities'
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

const ASPECT_TO_SIZE: Record<string, string> = {
  '1:1': '1024x1024',
  '16:9': '1280x720',
  '9:16': '720x1280',
  '4:3': '1280x960',
  '3:4': '960x1280'
}

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

export const modelScopeAdapter: ModelProviderAdapter = {
  kind: 'modelscope',

  async assertAuth(provider) {
    if (!provider.apiKey.trim()) throw new Error('请先填写 API Key（魔塔访问令牌）')
    const client = providerClient(provider)
    try {
      await client.get('/models', { timeout: 20_000 })
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined
      const raw = await readHttpError(err)
      if (isAuthFailure(status, raw)) {
        throw new Error(formatAuthError(`API Key 无效，已禁止拉取模型：${raw}`, provider))
      }
      throw new Error(`连接测试失败：${formatAuthError(raw, provider)}`)
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
      const { data } = await client.post('/images/generations', body)
      const images = extractImageUrls(data)
      if (!images.length) throw new Error('模型未返回图片')
      return { images, model: modelId }
    } catch (err) {
      throw new Error(`图片生成失败: ${formatAuthError(await readHttpError(err), provider)}`)
    }
  },

  async submitVideo(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateVideoInput
  ): Promise<GenerateVideoJob> {
    throw new Error('魔塔当前不支持视频生成')
  },

  async pollVideo(
    _provider: ModelProviderInstance,
    _job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    throw new Error('魔塔当前不支持视频生成')
  },

  async generateSpeech(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult> {
    throw new Error('魔塔当前不支持语音生成')
  }
}
