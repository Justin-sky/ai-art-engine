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
  ModelProviderInstance,
  TranscribeAudioInput,
  TranscribeAudioResult
} from '@shared/modelProvider'
import {
  isOpenAiTextModelId,
  listOpenAiCatalogModels
} from '@shared/modelProviders/openai/modelCapabilities'
import { resolveOpenAiImageSize } from '@shared/modelProviders/openai/imageSize'
import type { ModelProviderAdapter, VideoPollResult } from '../types'
import { PROVIDER_ERRORS } from '../catalog'
import { fail, defErr, defErrSimple } from '@shared/errors/appError'
import {
  createProviderHttpClient,
  formatAuthError,
  isAuthFailure,
  LONG_GENERATE_TIMEOUT_MS,
  readHttpError
} from '../http'
import { generateOpenAiCompatibleText } from '../openaiCompat'
import { transcribeAudioViaOpenAiCompatible } from '../transcribe'

// ── 本文件错误条目（catalog 未覆盖的个性文案）──
const NOT_SUPPORTED_FEATURES = {
  soraVideo: { zh: '视频（Sora）', en: 'video (Sora)' },
  speech: { zh: '语音合成', en: 'speech synthesis' }
} as const

const E_NOT_SUPPORTED = defErr<{ kind: keyof typeof NOT_SUPPORTED_FEATURES }>(
  'provider.openai.unsupported-modality',
  ({ kind }) => `OpenAI 提供商暂未接入${NOT_SUPPORTED_FEATURES[kind].zh}，当前仅支持文本与图片`,
  ({ kind }) =>
    `OpenAI does not support ${NOT_SUPPORTED_FEATURES[kind].en} yet; text and image only`
)

function notSupported(kind: keyof typeof NOT_SUPPORTED_FEATURES): Promise<never> {
  return Promise.reject(fail(E_NOT_SUPPORTED, { kind }))
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
    throw fail(PROVIDER_ERRORS.actionFailed, {
      action: 'listModels',
      detail: await readHttpError(err)
    })
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
  if (!images.length) throw fail(PROVIDER_ERRORS.noImageResult)
  return { images, model: modelId }
}

export const openAiAdapter: ModelProviderAdapter = {
  kind: 'openai',

  async assertAuth(provider) {
    if (!provider.apiKey.trim()) throw fail(PROVIDER_ERRORS.missingApiKey)
    const client = createProviderHttpClient(provider)
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
      throw fail(PROVIDER_ERRORS.actionFailed, {
        action: 'imageGenerate',
        detail: formatAuthError(await readHttpError(err), provider)
      })
    }
  },

  submitVideo(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateVideoInput
  ): Promise<GenerateVideoJob> {
    return notSupported('soraVideo')
  },

  pollVideo(
    _provider: ModelProviderInstance,
    _job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    return notSupported('soraVideo')
  },

  generateSpeech(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult> {
    return notSupported('speech')
  },

  async transcribeAudio(
    provider: ModelProviderInstance,
    modelId: string,
    input: TranscribeAudioInput
  ): Promise<TranscribeAudioResult> {
    const absPath = input.absPath?.trim()
    if (!absPath) {
      throw fail(
        defErrSimple(
          'provider.openai.transcribeNoFile',
          '音频转写缺少本地文件路径',
          'Audio transcription is missing the local file path'
        )
      )
    }
    return transcribeAudioViaOpenAiCompatible(provider, modelId || 'whisper-1', input, absPath)
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
