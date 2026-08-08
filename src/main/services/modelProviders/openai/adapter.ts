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
  ModelProviderInstance
} from '@shared/modelProvider'
import {
  isOpenAiTextModelId,
  listOpenAiCatalogModels
} from '@shared/modelProviders/openai/modelCapabilities'
import { resolveOpenAiImageSize } from '@shared/modelProviders/openai/imageSize'
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
  return Promise.reject(
    new Error(`OpenAI 提供商暂未接入${feature}，当前仅支持文本与图片`)
  )
}

async function fetchTextCatalog(provider: ModelProviderInstance): Promise<CatalogModel[]> {
  const client = createProviderHttpClient(provider)
  try {
    const { data } = await client.get<{ data?: Array<{ id?: string; created?: number }> }>(
      '/models'
    )
    return (data.data ?? [])
      .map((m) => String(m.id ?? '').trim())
      .filter(Boolean)
      .filter(isOpenAiTextModelId)
      .map((id) => ({ id, name: id, modality: 'text' as const }))
  } catch (err) {
    throw new Error(`拉取 OpenAI 文本模型列表失败: ${await readHttpError(err)}`)
  }
}

/** data URL / http(s) URL → Blob，供 /images/edits 的 multipart 表单使用 */
async function referenceToBlob(ref: string): Promise<{ blob: Blob; filename: string }> {
  const dataUrl = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(ref.trim())
  if (dataUrl) {
    const mime = dataUrl[1] || 'image/png'
    const isBase64 = Boolean(dataUrl[2])
    const payload = dataUrl[3] ?? ''
    const buf = isBase64
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8')
    const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png'
    return {
      blob: new Blob([new Uint8Array(buf)], { type: mime }),
      filename: `reference-${Date.now()}.${ext}`
    }
  }

  const { data } = await axios.get(ref.trim(), {
    responseType: 'arraybuffer',
    timeout: 60_000
  })
  return {
    blob: new Blob([new Uint8Array(Buffer.from(data as ArrayBuffer))], {
      type: 'image/png'
    }),
    filename: `reference-${Date.now()}.png`
  }
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
  if (!images.length) throw new Error('OpenAI 未返回图片')
  return { images, model: modelId }
}

export const openAiAdapter: ModelProviderAdapter = {
  kind: 'openai',

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
    if (modality === 'image') return listOpenAiCatalogModels('image')
    if (modality === 'text') return fetchTextCatalog(provider)
    return []
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
    const quality = input.quality?.trim().toLowerCase() === 'standard' ? 'medium' : input.quality?.trim()
    const size = resolveOpenAiImageSize(input.resolution, input.aspectRatio)

    try {
      // 有参考图：走 /images/edits（multipart，一次最多 1 张）
      if (input.inputReferences?.length) {
        const { blob, filename } = await referenceToBlob(input.inputReferences[0])
        const form = new FormData()
        form.append('model', modelId)
        form.append('prompt', input.prompt)
        form.append('image', blob, filename)
        if (quality) form.append('quality', quality)
        if (size) form.append('size', size)
        if (input.n && input.n >= 1) form.append('n', String(Math.floor(input.n)))

        const client = createProviderHttpClient(provider, LONG_GENERATE_TIMEOUT_MS)
        const { data } = await client.post<{
          data?: Array<{ b64_json?: string; url?: string }>
        }>('/images/edits', form, { headers: { 'Content-Type': undefined } })
        return parseGeneratedImages(data, modelId)
      }

      const client = createProviderHttpClient(provider, LONG_GENERATE_TIMEOUT_MS)
      const body: Record<string, unknown> = {
        model: modelId,
        prompt: input.prompt
      }
      if (size) body.size = size
      if (quality) body.quality = quality
      if (input.n && input.n >= 1) body.n = Math.floor(input.n)

      const { data } = await client.post<{
        data?: Array<{ b64_json?: string; url?: string }>
      }>('/images/generations', body)
      return parseGeneratedImages(data, modelId)
    } catch (err) {
      throw new Error(`OpenAI 图片生成失败: ${formatAuthError(await readHttpError(err), provider)}`)
    }
  },

  submitVideo(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateVideoInput
  ): Promise<GenerateVideoJob> {
    return notSupported('视频（Sora）')
  },

  pollVideo(
    _provider: ModelProviderInstance,
    _job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    return notSupported('视频（Sora）')
  },

  generateSpeech(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult> {
    return notSupported('语音合成')
  }
}
