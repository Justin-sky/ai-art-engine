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
import type { ModelProviderAdapter, VideoPollResult } from '../types'
import { PROVIDER_ERRORS } from '../catalog'
import { fail, defErr, defErrSimple } from '@shared/errors/appError'
import { createProviderHttpClient, formatAuthError, isAuthFailure, readHttpError } from '../http'
import { generateOpenAiCompatibleImage, generateOpenAiCompatibleText } from '../openaiCompat'
import {
  isNewApiImageModel,
  type NewApiEndpointTable
} from '@shared/modelProviders/newapi/modelCapabilities'

// ── NewAPI 提供商适配器 ─────────────────────────────────────────────
// NewAPI（https://docs.newapi.pro）是自建的 OpenAI 兼容中转网关，一个地址聚合多家渠道。
// 它比通用「自定义提供商」多的东西是**模型端点元数据**：
//   - `GET /v1/models`（令牌鉴权）：令牌可见的模型清单；
//   - `GET /api/pricing`（公开）：端点字典（`image-generation` → `/v1/images/generations` 等）
//     以及每个模型的 `supported_endpoint_types`。
// 于是「哪些模型能出图、该打哪个端点」不必靠 id 命名猜：目录仍以令牌可见清单为准（尊重
// 令牌权限），元数据只用来判定模态与端点路径；拿不到元数据时退回命名启发式。
//
// 与自定义提供商一致：文本 + 图片；视频 / 声音 / 3D 明确提示不支持。

const E_NEWAPI_MISSING_BASE_URL = defErrSimple(
  'provider.newapi.missing-base-url',
  '请先填写 NewAPI 网关地址（形如 https://你的域名/v1）。',
  'Please set the NewAPI gateway Base URL first (for example https://your-host/v1).'
)

const E_NEWAPI_EMPTY_CATALOG = defErrSimple(
  'provider.newapi.empty-catalog',
  '网关未返回模型列表。请确认 Base URL 与令牌正确；目录接口不可用时，可在下方手动填写模型 id 并勾选。',
  'The gateway returned no models. Check the Base URL and token; if the catalog API is unavailable, add model ids manually below.'
)

const FEATURE_LABELS: Record<'image' | 'video' | 'audio' | 'model3d', { zh: string; en: string }> =
  {
    image: { zh: '图片生成', en: 'image generation' },
    video: { zh: '视频生成', en: 'video generation' },
    audio: { zh: '语音合成', en: 'speech synthesis' },
    model3d: { zh: '3D 模型生成', en: '3D model generation' }
  }

const E_NEWAPI_NOT_SUPPORTED = defErr<{ feature: { zh: string; en: string } }>(
  'provider.newapi.not-supported',
  ({ feature }) => `NewAPI 提供商当前仅支持文本与图片，暂不支持${feature.zh}。`,
  ({ feature }) =>
    `The NewAPI provider supports text and image only; ${feature.en} is not supported yet.`
)

function notSupported(feature: keyof typeof FEATURE_LABELS): Promise<never> {
  return Promise.reject(fail(E_NEWAPI_NOT_SUPPORTED, { feature: FEATURE_LABELS[feature] }))
}

/** 网关地址：去掉结尾斜杠；NewAPI 的 OpenAI 兼容入口挂在 `/v1` 下，由用户填进 Base URL */
function requireBaseUrl(provider: ModelProviderInstance): string {
  const base = (provider.baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) throw fail(E_NEWAPI_MISSING_BASE_URL)
  return base
}

/**
 * 网关的**站点根**（用于打 `/api/pricing`）：
 * Base URL 通常带 `/v1`，站点根要去掉它；也容忍用户填成不带 `/v1` 的根地址。
 */
export function resolveNewApiSiteRoot(baseUrl: string): string {
  const base = (baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) return ''
  return base.replace(/\/v1$/i, '')
}

interface RawModelEntry {
  id?: string
  supported_endpoint_types?: string[]
}

/** 一次拉取：令牌可见的模型清单（原始条目，保留端点类型） */
async function fetchTokenModels(
  provider: ModelProviderInstance
): Promise<Array<{ id: string; supported_endpoint_types?: string[] }>> {
  requireBaseUrl(provider)
  const client = createProviderHttpClient(provider)
  try {
    const { data } = await client.get<{ data?: RawModelEntry[] }>('/models')
    return (data.data ?? [])
      .map((m) => ({
        id: String(m.id ?? '').trim(),
        ...(Array.isArray(m.supported_endpoint_types)
          ? { supported_endpoint_types: m.supported_endpoint_types.map((t) => String(t)) }
          : {})
      }))
      .filter((m) => m.id)
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined
    // 网关没实现 /models 时回退空目录（用户可手填模型 id）
    if (status === 404 || status === 405) return []
    throw fail(PROVIDER_ERRORS.actionFailed, {
      action: 'listModels',
      detail: await readHttpError(err)
    })
  }
}

/** `/api/pricing` 的解析结果：端点字典 + 每个模型的端点类型 */
export interface NewApiPricingMeta {
  endpoints: NewApiEndpointTable
  byModel: Record<string, string[]>
}

/**
 * 解析 `GET /api/pricing` 响应。纯函数，便于单测。
 * 该接口是**公开**的（无需令牌），所以只当成「端点元数据」来源，不当成模型清单。
 */
export function parseNewApiPricing(payload: unknown): NewApiPricingMeta {
  const body = (payload ?? {}) as {
    supported_endpoint?: Record<string, { path?: string; method?: string }>
    data?: Array<{ model_name?: string; supported_endpoint_types?: string[] }>
  }
  const endpoints: NewApiEndpointTable = {}
  for (const [type, def] of Object.entries(body.supported_endpoint ?? {})) {
    if (def && typeof def === 'object') endpoints[type] = { ...def }
  }
  const byModel: Record<string, string[]> = {}
  for (const row of body.data ?? []) {
    const name = String(row.model_name ?? '').trim()
    if (!name) continue
    byModel[name] = Array.isArray(row.supported_endpoint_types)
      ? row.supported_endpoint_types.map((t) => String(t))
      : []
  }
  return { endpoints, byModel }
}

/**
 * 端点元数据缓存：网关升级 / 渠道变动不频繁，按站点根缓存 10 分钟。
 * 拉取失败（老版本没有 /api/pricing、超时等）一律降级为「无元数据」，不影响目录与生成。
 */
const PRICING_TTL_MS = 10 * 60 * 1000
const pricingCache = new Map<string, { at: number; value: NewApiPricingMeta }>()

async function fetchPricingMeta(provider: ModelProviderInstance): Promise<NewApiPricingMeta> {
  const root = resolveNewApiSiteRoot(requireBaseUrl(provider))
  if (!root) return { endpoints: {}, byModel: {} }
  const cached = pricingCache.get(root)
  if (cached && Date.now() - cached.at < PRICING_TTL_MS) return cached.value
  try {
    // 公开接口，不带 Authorization；用独立 axios 实例避免把 /v1 拼进站点根
    const { data } = await axios.get('/api/pricing', { baseURL: root, timeout: 10_000 })
    const meta = parseNewApiPricing(data)
    pricingCache.set(root, { at: Date.now(), value: meta })
    return meta
  } catch {
    const empty: NewApiPricingMeta = { endpoints: {}, byModel: {} }
    pricingCache.set(root, { at: Date.now(), value: empty })
    return empty
  }
}

/** 端点元数据里该模型声明的端点类型（拿不到就是 undefined，判定退回命名启发式） */
function endpointTypesFor(
  modelId: string,
  rawTypes: readonly string[] | undefined,
  meta: NewApiPricingMeta
): string[] | undefined {
  if (rawTypes?.length) return [...rawTypes]
  const fromPricing = meta.byModel[modelId]
  return fromPricing?.length ? fromPricing : undefined
}

async function assertGatewayAuth(provider: ModelProviderInstance): Promise<void> {
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

export const newApiAdapter: ModelProviderAdapter = {
  kind: 'newapi',

  async assertAuth(provider) {
    return assertGatewayAuth(provider)
  },

  async fetchCatalog(provider, modality) {
    if (modality !== 'text' && modality !== 'image') return []
    const models = await fetchTokenModels(provider)
    if (!models.length) {
      if (provider.apiKey.trim()) throw fail(E_NEWAPI_EMPTY_CATALOG)
      return []
    }
    const meta = await fetchPricingMeta(provider)
    const rows: CatalogModel[] = []
    for (const model of models) {
      const types = endpointTypesFor(model.id, model.supported_endpoint_types, meta)
      const isImage = isNewApiImageModel(model.id, types)
      if (modality === 'image' ? !isImage : isImage) continue
      rows.push({ id: model.id, name: model.id, modality })
    }
    return rows
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
    requireBaseUrl(provider)
    if (!provider.apiKey.trim()) throw fail(PROVIDER_ERRORS.missingApiKey)
    // 走标准 OpenAI 出图端点。少数网关上「看起来是图片模型」的条目实际以对话端点返回图片
    // 链接（如 Grok Imagine），那类模型在网关侧会声明 image-generation，届时按声明切换；
    // 目前统一走 /images/generations，与 OpenAI 兼容语义一致。
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

  pollModel3d(
    _provider: ModelProviderInstance,
    _job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    return notSupported('model3d')
  }
}
