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
import { resolveCustomApiStyle } from '@shared/modelProvider'
import { isCustomTextModelId } from '@shared/modelProviders/custom/modelCapabilities'
import { isKodikRouterBaseUrl } from '@shared/modelProviders/kodikrouter'
import type { ModelProviderAdapter, VideoPollResult } from '../types'
import { PROVIDER_ERRORS } from '../catalog'
import { fail, defErr, defErrSimple } from '@shared/errors/appError'
import { createProviderHttpClient, formatAuthError, isAuthFailure, readHttpError } from '../http'
import {
  generateOpenAiCompatibleImage,
  generateOpenAiCompatibleSpeech,
  generateOpenAiCompatibleText
} from '../openaiCompat'
import { assertAnthropicAuth, generateAnthropicText, listAnthropicModels } from './anthropic'

// ── 自定义提供商适配器 ──────────────────────────────────────────────
// 一个 kind（custom）承载多种端点类型，由实例级 apiStyle 决定走哪套协议：
//   - openai   ：OpenAI 兼容。文本 /chat/completions，图片 /images/generations，
//                语音 /audio/speech。与官方 OpenAI 提供商同一组能力，不含视频。
//   - gemini   ：Gemini 的 OpenAI 兼容层，请求形状与 openai 相同
//   - anthropic：Anthropic Messages API（/v1/messages），仅文本
// 视频 / 3D 明确不支持。KodikRouter 只在语音上多一条：网关强制 body.voice。

const E_CUSTOM_MISSING_BASE_URL = defErrSimple(
  'provider.custom.missing-base-url',
  '请先填写自定义提供商的 Base URL（端点类型为 Anthropic 时填服务根地址，如 https://api.anthropic.com）',
  'Please set the custom provider Base URL first (for Anthropic endpoints use the service root, e.g. https://api.anthropic.com)'
)

const E_CUSTOM_EMPTY_CATALOG = defErrSimple(
  'provider.custom.empty-catalog',
  '端点未返回模型列表。请确认 Base URL 与 API Key 正确；目录接口不可用时，可在下方手动填写模型 id 并勾选。',
  'The endpoint returned no models. Check the Base URL and API Key; if the catalog API is unavailable, add model ids manually below.'
)

/** 网关目录里只有图片生成模型时的专门提示：不是密钥 / 地址错，重试也不会变 */
const E_CUSTOM_IMAGE_ONLY_CATALOG = defErr<{ count: number }>(
  'provider.custom.image-only-catalog',
  ({ count }) =>
    `端点返回的 ${count} 个模型都是图片生成模型（中转网关会把图片渠道一并列在 /models 里），文本页签没有可用模型。图片模型请在「图片」页签手动填写 id 并勾选。`,
  ({ count }) =>
    `All ${count} models returned by the endpoint are image-generation models (relays list image channels in /models too), so there is no text model to show. Add image models by hand on the Image tab instead.`
)

const FEATURE_LABELS: Record<'image' | 'video' | 'audio' | 'model3d', { zh: string; en: string }> =
  {
    image: { zh: '图片生成', en: 'image generation' },
    video: { zh: '视频生成', en: 'video generation' },
    audio: { zh: '语音合成', en: 'speech synthesis' },
    model3d: { zh: '3D 模型生成', en: '3D model generation' }
  }

const E_CUSTOM_NOT_SUPPORTED = defErr<{ feature: { zh: string; en: string } }>(
  'provider.custom.not-supported',
  ({ feature }) =>
    `自定义提供商当前仅支持文本（多模态理解可在文本节点传图），暂不支持${feature.zh}`,
  ({ feature }) =>
    `Custom providers support text only (multimodal understanding works by passing images to text nodes); ${feature.en} is not supported yet`
)

function notSupported(feature: keyof typeof FEATURE_LABELS): Promise<never> {
  return Promise.reject(fail(E_CUSTOM_NOT_SUPPORTED, { feature: FEATURE_LABELS[feature] }))
}

function requireBaseUrl(provider: ModelProviderInstance): string {
  const base = provider.baseUrl.trim()
  if (!base) throw fail(E_CUSTOM_MISSING_BASE_URL)
  return base
}

/** OpenAI 兼容（openai / gemini）：GET /models 探测认证 */
async function assertOpenAiCompatAuth(provider: ModelProviderInstance): Promise<void> {
  requireBaseUrl(provider)
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
}

/**
 * OpenAI 兼容（openai / gemini）：GET /models 全量返回，再按 id 剔除图片生成模型。
 *
 * 中转网关（NewAPI / one-api 等）会把图片渠道一并列进 /models（实测某网关只返回
 * `gpt-image-*`），这些模型出现在「文本」页签里是误导：勾了拿去对话只会 503 或
 * 返回一段 markdown 图片链接。官方 OpenAI 同样是先过滤（见 isOpenAiTextModelId）。
 *
 * 返回值把「目录命中数」一并带出：全部被过滤时上层要能区分
 * 「网关没配文本模型」和「地址 / 密钥不对」。
 */
async function listOpenAiCompatModels(
  provider: ModelProviderInstance
): Promise<{ rows: CatalogModel[]; catalogCount: number }> {
  requireBaseUrl(provider)
  const isGeminiStyle = resolveCustomApiStyle(provider) === 'gemini'
  const client = createProviderHttpClient(provider)
  try {
    const { data } = await client.get<{
      data?: Array<{ id?: string; name?: string }>
      models?: Array<{ id?: string; name?: string }>
    }>('/models')
    const rawList = Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.models)
        ? data.models
        : []
    const ids = rawList
      .map((m) => String(m?.id ?? m?.name ?? '').trim())
      .map((id) => (isGeminiStyle ? id.replace(/^models\//i, '') : id))
      .filter(Boolean)
    const rows = ids
      .filter(isCustomTextModelId)
      .map((id) => ({ id, name: id, modality: 'text' as const }))
    return { rows, catalogCount: ids.length }
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined
    // 网关不提供 /models（如某些纯 chat 代理）时回退空目录（用户可手填模型 id）
    if (status === 404 || status === 405) return { rows: [], catalogCount: 0 }
    throw fail(PROVIDER_ERRORS.actionFailed, {
      action: 'listModels',
      detail: await readHttpError(err)
    })
  }
}

export const customAdapter: ModelProviderAdapter = {
  kind: 'custom',

  async assertAuth(provider) {
    const style = resolveCustomApiStyle(provider)
    if (style === 'anthropic') return assertAnthropicAuth(provider)
    return assertOpenAiCompatAuth(provider)
  },

  async fetchCatalog(provider, modality) {
    // 图片、语音都不从 GET /models 自动识别：官方 OpenAI 的这个接口只给 id，
    // 不标明是出图还是朗读。图片与语音模型 id 由用户在对应页签手填。
    if (modality === 'image' || modality === 'audio') return []
    if (modality !== 'text') return []
    const style = resolveCustomApiStyle(provider)
    const { rows, catalogCount } =
      style === 'anthropic'
        ? { rows: await listAnthropicModels(provider), catalogCount: -1 }
        : await listOpenAiCompatModels(provider)
    // 目录为空但连接正常：给出可操作提示（手填模型 id）
    if (!rows.length && provider.apiKey.trim()) {
      // 目录非空但全是图片模型：不是「地址 / 密钥不对」，重试也不会变，文案要说清楚
      if (catalogCount > 0) throw fail(E_CUSTOM_IMAGE_ONLY_CATALOG, { count: catalogCount })
      throw fail(E_CUSTOM_EMPTY_CATALOG)
    }
    return rows
  },

  generateText(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateTextInput
  ): Promise<GenerateTextResult> {
    const style = resolveCustomApiStyle(provider)
    if (style === 'anthropic') return generateAnthropicText(provider, modelId, input)
    return generateOpenAiCompatibleText(provider, modelId, input)
  },

  async generateImage(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateImageInput
  ): Promise<GenerateImageResult> {
    if (resolveCustomApiStyle(provider) === 'anthropic') return notSupported('image')
    requireBaseUrl(provider)
    if (!provider.apiKey.trim()) throw fail(PROVIDER_ERRORS.missingApiKey)
    return generateOpenAiCompatibleImage(provider, modelId, input)
  },

  submitVideo(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateVideoInput
  ): Promise<GenerateVideoJob> {
    return notSupported('video')
  },

  pollVideo(
    _provider: ModelProviderInstance,
    _job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    return notSupported('video')
  },

  generateSpeech(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult> {
    if (resolveCustomApiStyle(provider) === 'anthropic') return notSupported('audio')
    requireBaseUrl(provider)
    if (!provider.apiKey.trim()) throw fail(PROVIDER_ERRORS.missingApiKey)
    // 与 OpenAI 提供商同一条 POST /audio/speech。
    // Kodik 的网关把 voice 当必填；OpenRouter 上 seed-audio 却要省略该字段。
    // 只在这条地址上改为「有就照发，没有就报错」，其它网关保持原行为。
    return generateOpenAiCompatibleSpeech(provider, modelId, input, {
      requireVoice: isKodikRouterBaseUrl(provider.baseUrl)
    })
  },

  submitModel3d(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateModel3dInput
  ): Promise<GenerateModel3dJob> {
    return notSupported('model3d')
  },

  pollModel3d(
    _provider: ModelProviderInstance,
    _job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    return notSupported('model3d')
  }
}
