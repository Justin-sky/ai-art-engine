import axios from 'axios'
import type {
  CatalogModel,
  GenerateTextInput,
  GenerateTextResult,
  ModelProviderInstance
} from '@shared/modelProvider'
import { fail, defErr, defErrSimple } from '@shared/errors/appError'
import { PROVIDER_ERRORS } from '../catalog'
import {
  createProviderHttpClient,
  formatAuthError,
  isAuthFailure,
  LONG_GENERATE_TIMEOUT_MS,
  readHttpError,
  trimBaseUrl
} from '../http'

// ── Anthropic Messages API（自定义提供商 · anthropic 端点类型）──
// 端点约定：Base URL 通常填 https://api.anthropic.com（也接受已含 /v1 的地址），
// 请求 /v1/messages；模型目录 GET /v1/models。认证头为 x-api-key + anthropic-version。

const ANTHROPIC_API_VERSION = '2023-06-01'
const DEFAULT_MAX_TOKENS = 4096

const E_ANTHROPIC_EMPTY_TEXT = defErrSimple(
  'provider.custom.anthropic.empty-text',
  'Anthropic 模型未返回文本内容，请检查模型 id 是否正确',
  'The Anthropic model returned no text; check the model id'
)

const E_ANTHROPIC_GENERATE_FAILED = defErr<{ detail: string }>(
  'provider.custom.anthropic.generate-failed',
  ({ detail }) => `Anthropic 文本生成失败：${detail}`,
  ({ detail }) => `Anthropic text generation failed: ${detail}`
)

/** 请求路径相对 baseUrl：base 已含 /v1 时不重复拼接 */
function anthropicApiUrl(baseUrl: string, path: string): string {
  const base = trimBaseUrl(baseUrl)
  if (/\/v1$/i.test(base)) {
    return `${base}${path.replace(/^\/v1/i, '')}`
  }
  return `${base}${path}`
}

/** data URL / http(s) URL → Anthropic image content block */
function imageBlockFromUrl(url: string): Record<string, unknown> {
  const dataUrl = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url.trim())
  if (dataUrl) {
    const mime = dataUrl[1] || 'image/png'
    const payload = dataUrl[3] ?? ''
    const data = dataUrl[2]
      ? payload
      : Buffer.from(decodeURIComponent(payload), 'utf8').toString('base64')
    return {
      type: 'image',
      source: { type: 'base64', media_type: mime, data }
    }
  }
  return { type: 'image', source: { type: 'url', url: url.trim() } }
}

/** 从 /v1/messages 响应提取文本（拼接全部 text block） */
function extractAnthropicText(data: { content?: Array<{ type?: string; text?: string }> }): string {
  const content = data.content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .join('')
    .trim()
}

/** 认证探测：GET /v1/models；404 视为不支持目录但端点可达（仍放行，可手填模型） */
export async function assertAnthropicAuth(provider: ModelProviderInstance): Promise<void> {
  if (!provider.apiKey.trim()) throw fail(PROVIDER_ERRORS.missingApiKey)
  const client = createProviderHttpClient(provider, 20_000)
  try {
    await client.get(anthropicApiUrl(provider.baseUrl, '/v1/models'), {
      headers: {
        'x-api-key': provider.apiKey.trim(),
        'anthropic-version': ANTHROPIC_API_VERSION
      }
    })
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined
    if (status === 404) return
    const raw = await readHttpError(err)
    if (isAuthFailure(status, raw)) {
      throw fail(PROVIDER_ERRORS.invalidApiKeyListModels, { detail: formatAuthError(raw, provider) })
    }
    throw fail(PROVIDER_ERRORS.connectionTestFailed, { detail: formatAuthError(raw, provider) })
  }
}

/** 模型目录：GET /v1/models；接口不可用（404）时返回空列表，允许手动填写模型 id */
export async function listAnthropicModels(provider: ModelProviderInstance): Promise<CatalogModel[]> {
  const client = createProviderHttpClient(provider)
  try {
    const { data } = await client.get<{ data?: Array<{ id?: string }> }>(
      anthropicApiUrl(provider.baseUrl, '/v1/models'),
      { headers: { 'x-api-key': provider.apiKey.trim(), 'anthropic-version': ANTHROPIC_API_VERSION } }
    )
    return (data.data ?? [])
      .map((m) => String(m.id ?? '').trim())
      .filter(Boolean)
      .map((id) => ({ id, name: id, modality: 'text' as const }))
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined
    // 网关不提供 /v1/models 时回退空目录（用户可手填模型 id）
    if (status === 404 || status === 405) return []
    throw fail(PROVIDER_ERRORS.actionFailed, {
      action: 'listModels',
      detail: await readHttpError(err)
    })
  }
}

/** 文本生成：POST /v1/messages（system 走顶层字段；images 转 content block；单次不流式） */
export async function generateAnthropicText(
  provider: ModelProviderInstance,
  modelId: string,
  input: GenerateTextInput
): Promise<GenerateTextResult> {
  const client = createProviderHttpClient(provider, LONG_GENERATE_TIMEOUT_MS)
  const imageUrls = (input.images ?? []).map((url) => url.trim()).filter(Boolean)

  const userContent: unknown[] = []
  for (const url of imageUrls) userContent.push(imageBlockFromUrl(url))
  userContent.push({ type: 'text', text: input.prompt })

  const body: Record<string, unknown> = {
    model: modelId,
    max_tokens: DEFAULT_MAX_TOKENS,
    messages: [{ role: 'user', content: userContent }]
  }
  if (input.system?.trim()) body.system = input.system.trim()

  try {
    const { data } = await client.post<{
      content?: Array<{ type?: string; text?: string }>
      model?: string
    }>(anthropicApiUrl(provider.baseUrl, '/v1/messages'), body, {
      headers: {
        'x-api-key': provider.apiKey.trim(),
        'anthropic-version': ANTHROPIC_API_VERSION
      }
    })
    const text = extractAnthropicText(data)
    if (!text) throw fail(E_ANTHROPIC_EMPTY_TEXT)
    return { text, model: data.model ?? modelId }
  } catch (err) {
    throw fail(E_ANTHROPIC_GENERATE_FAILED, {
      detail: formatAuthError(await readHttpError(err), provider)
    })
  }
}
