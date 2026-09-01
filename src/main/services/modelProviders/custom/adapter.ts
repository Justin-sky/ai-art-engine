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
import type { ModelProviderAdapter, VideoPollResult } from '../types'
import { PROVIDER_ERRORS } from '../catalog'
import { fail, defErr, defErrSimple } from '@shared/errors/appError'
import {
  createProviderHttpClient,
  formatAuthError,
  isAuthFailure,
  readHttpError
} from '../http'
import {
  generateOpenAiCompatibleImage,
  generateOpenAiCompatibleText
} from '../openaiCompat'
import { assertAnthropicAuth, generateAnthropicText, listAnthropicModels } from './anthropic'

// ── 自定义提供商适配器 ──────────────────────────────────────────────
// 一个 kind（custom）承载多种端点类型，由实例级 apiStyle 决定走哪套协议：
//   - openai   ：OpenAI 兼容（/chat/completions + /models），覆盖中转站 / one-api / vLLM 等
//   - gemini   ：Gemini 兼容（Google 官方 OpenAI 兼容层与多数 Gemini 网关），同 OpenAI 兼容格式
//   - anthropic：Anthropic Messages API（/v1/messages + /v1/models）
// 文本模态全部端点类型可用；图片生成仅 OpenAI 兼容 / Gemini 端点支持（/images/generations），
// Anthropic 端点不支持图片；视频 / 声音 / 3D 明确提示不支持。

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

const FEATURE_LABELS: Record<'image' | 'video' | 'audio' | 'model3d', { zh: string; en: string }> = {
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
      throw fail(PROVIDER_ERRORS.invalidApiKeyListModels, { detail: formatAuthError(raw, provider) })
    }
    throw fail(PROVIDER_ERRORS.connectionTestFailed, { detail: formatAuthError(raw, provider) })
  }
}

/** OpenAI 兼容（openai / gemini）：GET /models 全量返回（自定义网关不过滤模型） */
async function listOpenAiCompatModels(provider: ModelProviderInstance): Promise<CatalogModel[]> {
  requireBaseUrl(provider)
  const client = createProviderHttpClient(provider)
  try {
    const { data } = await client.get<{ data?: Array<{ id?: string }> }>('/models')
    return (data.data ?? [])
      .map((m) => String(m.id ?? '').trim())
      .filter(Boolean)
      .map((id) => ({ id, name: id, modality: 'text' as const }))
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined
    // 网关不提供 /models（如某些纯 chat 代理）时回退空目录（用户可手填模型 id）
    if (status === 404 || status === 405) return []
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
    // 图片模态不自动识别模型（/models 无法区分图片能力），由用户手填图片模型 id
    if (modality === 'image') return []
    if (modality !== 'text') return []
    const style = resolveCustomApiStyle(provider)
    const rows = style === 'anthropic' ? await listAnthropicModels(provider) : await listOpenAiCompatModels(provider)
    // 目录为空但连接正常：给出可操作提示（手填模型 id）
    if (!rows.length && provider.apiKey.trim()) {
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

  pollVideo(_provider: ModelProviderInstance, _job: { jobId: string; pollingUrl: string }): Promise<VideoPollResult> {
    return notSupported('video')
  },

  generateSpeech(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult> {
    return notSupported('audio')
  },

  submitModel3d(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateModel3dInput
  ): Promise<GenerateModel3dJob> {
    return notSupported('model3d')
  },

  pollModel3d(_provider: ModelProviderInstance, _job: { jobId: string; pollingUrl: string }): Promise<VideoPollResult> {
    return notSupported('model3d')
  }
}
