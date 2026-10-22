import axios from 'axios'
import {
  type CatalogModel,
  type GenerateImageInput,
  type GenerateImageResult,
  type GenerateModel3dInput,
  type GenerateModel3dJob,
  type GenerateSpeechInput,
  type GenerateSpeechResult,
  type GenerateTextInput,
  type GenerateTextResult,
  type GenerateVideoInput,
  type GenerateVideoJob,
  type ModelProviderInstance
} from '@shared/modelProvider'
import {
  GOOGLE_CHAT_FALLBACK_MODELS,
  isGoogleNativeImageModelId,
  isGoogleTextModelId,
  isOfficialGoogleBaseUrl,
  listGoogleCatalogModels,
  normalizeGoogleImageSize,
  normalizeGoogleModelId,
  normalizeGoogleVeoAspectRatio,
  normalizeGoogleVeoResolution,
  resolveGoogleChatModelId,
  resolveGoogleNativeBaseUrl,
  resolveGoogleOpenAiBaseUrl,
  snapGoogleVeoDuration
} from '@shared/modelProviders/google/modelCapabilities'
import {
  b64JsonToImageDataUrl,
  sniffImageMimeFromBase64,
  sniffImageMimeFromBytes
} from '@shared/media/imageMimeSniff'
import { rewriteAtMentionsForImagePrompt } from '@shared/modelProviders/imagePromptMentions'
import type { ModelProviderAdapter, VideoPollResult } from '../types'
import { PROVIDER_ERRORS } from '../catalog'
import { fail, defErr, defErrSimple } from '@shared/errors/appError'
import {
  createProviderHttpClient,
  formatAuthError,
  isAuthFailure,
  LONG_GENERATE_TIMEOUT_MS,
  readHttpError,
  trimBaseUrl
} from '../http'
import { generateOpenAiCompatibleText } from '../openaiCompat'

// ── 本文件错误条目（catalog 未覆盖的个性文案）──
const E_NOT_SUPPORTED = defErrSimple(
  'provider.google.unsupported-speech',
  'Google（Gemini）提供商暂未接入语音合成，当前仅支持文本、图片与视频',
  'Google (Gemini) does not support speech synthesis yet; text, image and video only'
)

const E_GOOGLE_FREE_TIER_IMAGE_QUOTA_ZERO = defErr<{ model: string }>(
  'provider.google.free-tier-image-quota-zero',
  ({ model }) =>
    `Google AI Studio 免费层级（Free Tier）对 Gemini 生图模型（${model}）的免费配额为 0（limit: 0）。` +
    `请前往 https://aistudio.google.com/apikey 为该项目绑定结算账户（升级至 Paid Tier 1），` +
    `或在图片节点切换为其他已配置的生图提供商/模型。`,
  ({ model }) =>
    `Google AI Studio Free Tier has 0 quota (limit: 0) for Gemini image model "${model}". ` +
    `Enable billing (Paid Tier 1) for your project at https://aistudio.google.com/apikey, ` +
    `or switch the Image node to another configured image provider/model.`
)

const E_GOOGLE_FREE_TIER_VIDEO_QUOTA_ZERO = defErr<{ model: string }>(
  'provider.google.free-tier-video-quota-zero',
  ({ model }) =>
    `Google AI Studio 免费层级（Free Tier）对 Veo 视频生成模型（${model}）无免费配额。` +
    `请前往 https://aistudio.google.com/apikey 为该项目绑定结算账户（升级至 Paid Tier 1），` +
    `或在视频节点切换为其他已配置的视频提供商/模型。`,
  ({ model }) =>
    `Google AI Studio Free Tier does not include free quota for Veo video model "${model}". ` +
    `Enable billing (Paid Tier 1) for your project at https://aistudio.google.com/apikey, ` +
    `or switch the Video node to another configured video provider/model.`
)

function notSupported(): Promise<never> {
  return Promise.reject(fail(E_NOT_SUPPORTED))
}

function parseGeneratedImages(
  data: { data?: Array<{ b64_json?: string; url?: string }> },
  modelId: string
): GenerateImageResult {
  const images = (data.data ?? [])
    .map((row) => {
      if (row.b64_json) return b64JsonToImageDataUrl(row.b64_json)
      if (row.url) return row.url
      return ''
    })
    .filter(Boolean)
  if (!images.length) throw fail(PROVIDER_ERRORS.noImageResult)
  return { images, model: modelId }
}

interface GeminiInlineDataPart {
  inlineData: {
    mimeType: string
    data: string
  }
}

interface GenerateContentResponseShape {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string
        inlineData?: { mimeType?: string; mime_type?: string; data?: string }
        inline_data?: { mimeType?: string; mime_type?: string; data?: string }
      }>
    }
  }>
  data?: Array<{ b64_json?: string; url?: string }>
}

function createGoogleNativeHttpClient(provider: ModelProviderInstance, timeoutMs = 120_000) {
  const key = provider.apiKey.trim()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }
  if (key) {
    headers['x-goog-api-key'] = key
    // 官方 generativelanguage.googleapis.com 原生 /v1beta 端点只认 x-goog-api-key；
    // 若同时携带 Authorization: Bearer AIza... 会被当成非法 OAuth2 token 并报 401。
    // 非官方中转网关则可能依赖 Bearer，因此仅在自定义域名下附带 Authorization。
    if (!isOfficialGoogleBaseUrl(provider.baseUrl)) {
      headers.Authorization = `Bearer ${key}`
    }
  }
  return axios.create({
    baseURL: resolveGoogleNativeBaseUrl(provider.baseUrl, provider.nativeBaseUrl),
    timeout: timeoutMs,
    headers
  })
}

async function referenceToInlineDataPart(ref: string): Promise<GeminiInlineDataPart | null> {
  const trimmed = ref.trim()
  if (!trimmed) return null
  const dataUrlMatch = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(trimmed)
  if (dataUrlMatch) {
    const declaredMime = dataUrlMatch[1]?.trim() || 'image/png'
    const rawPayload = (dataUrlMatch[2] ?? '').trim()
    if (!rawPayload) return null
    const b64 = trimmed.includes(';base64,')
      ? rawPayload
      : Buffer.from(decodeURIComponent(rawPayload), 'utf8').toString('base64')
    const mimeType = sniffImageMimeFromBase64(b64) ?? declaredMime
    return {
      inlineData: {
        mimeType,
        data: b64
      }
    }
  }
  if (/^https?:\/\//i.test(trimmed)) {
    const { data, headers } = await axios.get<ArrayBuffer>(trimmed, {
      responseType: 'arraybuffer',
      timeout: 60_000
    })
    const buf = Buffer.from(data)
    const headerMime =
      typeof headers?.['content-type'] === 'string'
        ? headers['content-type'].split(';')[0]!.trim()
        : ''
    const mimeType = sniffImageMimeFromBytes(buf) ?? (headerMime || 'image/png')
    return {
      inlineData: {
        mimeType,
        data: buf.toString('base64')
      }
    }
  }
  return null
}

function buildGenerateContentImageBody(
  prompt: string,
  inlineParts: GeminiInlineDataPart[],
  options: {
    aspectRatio?: string
    imageSize?: '1K' | '2K' | '4K'
    includeImageConfig?: boolean
  }
): Record<string, unknown> {
  const parts: Array<GeminiInlineDataPart | { text: string }> = [...inlineParts]
  if (prompt.trim() || !parts.length) {
    parts.push({ text: prompt })
  }
  const imageConfig: Record<string, string> = {}
  if (options.includeImageConfig !== false) {
    if (options.aspectRatio?.trim()) {
      imageConfig.aspectRatio = options.aspectRatio.trim()
    }
    if (options.imageSize) {
      imageConfig.imageSize = options.imageSize
    }
  }
  return {
    contents: [
      {
        role: 'user',
        parts
      }
    ],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      ...(Object.keys(imageConfig).length ? { imageConfig } : {})
    }
  }
}

function parseGenerateContentImages(
  data: GenerateContentResponseShape,
  modelId: string
): GenerateImageResult {
  const images: string[] = []
  const textCandidates: string[] = []
  for (const candidate of data.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const inline = part.inlineData ?? part.inline_data
      if (inline?.data?.trim()) {
        const mime = inline.mimeType || inline.mime_type || 'image/png'
        images.push(b64JsonToImageDataUrl(inline.data, mime))
      } else if (typeof part.text === 'string' && part.text.trim()) {
        textCandidates.push(part.text.trim())
      }
    }
  }
  if (!images.length && textCandidates.length) {
    const joined = textCandidates.join('\n')
    const mdMatch = /!\[[^\]]*\]\((data:image\/[^)]+|https?:\/\/[^)\s]+)\)/i.exec(joined)
    if (mdMatch?.[1]) {
      images.push(mdMatch[1])
    } else {
      const dataUrlMatch = /(data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)/.exec(joined)
      if (dataUrlMatch?.[1]) images.push(dataUrlMatch[1])
    }
  }
  if (!images.length && Array.isArray(data.data)) {
    return parseGeneratedImages(data, modelId)
  }
  if (!images.length) throw fail(PROVIDER_ERRORS.noImageResult)
  return { images, model: modelId }
}

function formatGoogleImageError(
  raw: string,
  provider: ModelProviderInstance,
  modelId: string
): string {
  if (/generate_content_free_tier_requests/i.test(raw) && /limit:\s*0\b/i.test(raw)) {
    return fail(E_GOOGLE_FREE_TIER_IMAGE_QUOTA_ZERO, { model: modelId }).message
  }
  return formatAuthError(raw, provider)
}

function formatGoogleVideoError(
  raw: string,
  provider: ModelProviderInstance,
  modelId: string
): string {
  if (/exceeded your current quota,\s*please check your plan and billing details/i.test(raw)) {
    return fail(E_GOOGLE_FREE_TIER_VIDEO_QUOTA_ZERO, { model: modelId }).message
  }
  return formatAuthError(raw, provider)
}

async function generateImageViaOpenAiEndpoint(
  provider: ModelProviderInstance,
  modelId: string,
  prompt: string,
  input: GenerateImageInput
): Promise<GenerateImageResult> {
  const official = isOfficialGoogleBaseUrl(provider.baseUrl)
  const buildBody = (stripExtendedFields: boolean): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      model: modelId,
      prompt,
      response_format: 'b64_json'
    }
    if (input.aspectRatio?.trim() && !stripExtendedFields) {
      body.aspect_ratio = input.aspectRatio.trim()
    }
    if (input.n && input.n >= 1) {
      body.n = Math.min(4, Math.floor(input.n))
    }
    // Google 官方 /v1beta/openai/images/generations 的 protobuf schema 不含 resolution 与 image 字段，
    // 传入会立即报 `Invalid JSON payload received. Unknown name "resolution": Cannot find field.`
    if (!official && !stripExtendedFields) {
      if (input.resolution?.trim()) body.resolution = input.resolution.trim()
      const refs = (input.inputReferences ?? []).map((ref) => ref.trim()).filter(Boolean)
      if (refs.length === 1) {
        body.image = refs[0]
      } else if (refs.length > 1) {
        body.image = refs
      }
    }
    return body
  }

  const client = createProviderHttpClient(withGoogleOpenAiBase(provider), LONG_GENERATE_TIMEOUT_MS)
  try {
    const { data } = await client.post<{
      data?: Array<{ b64_json?: string; url?: string }>
    }>('/images/generations', buildBody(false))
    return parseGeneratedImages(data, modelId)
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined
    const raw = await readHttpError(err)
    if (status === 400 && /Unknown name|Cannot find field/i.test(raw)) {
      const { data } = await client.post<{
        data?: Array<{ b64_json?: string; url?: string }>
      }>('/images/generations', buildBody(true))
      return parseGeneratedImages(data, modelId)
    }
    throw err
  }
}

function withGoogleOpenAiBase(provider: ModelProviderInstance): ModelProviderInstance {
  return {
    ...provider,
    baseUrl: resolveGoogleOpenAiBaseUrl(provider.baseUrl)
  }
}

/**
 * 记录因单模型配额耗尽（429 Quota exceeded）或模型下线（404）暂时不可用的 Google 模型冷却截止时间戳。
 * 同一轮精准拆层会连续发起多次 VLM 请求（全图版面 + 容器放大复检），缓存冷却态可避免每次请求都先撞一次 429。
 */
const googleTextModelCooldownUntil = new Map<string, number>()
const GOOGLE_TEXT_MODEL_COOLDOWN_MS = 10 * 60_000

export function resetGoogleTextModelCooldownsForTest(): void {
  googleTextModelCooldownUntil.clear()
}

function googleModelCooldownKey(provider: ModelProviderInstance, modelId: string): string {
  return `${provider.id || provider.baseUrl || 'google'}:${modelId}`
}

function shouldFallbackGoogleTextModel(err: unknown): {
  fallback: boolean
  cooldown: boolean
} {
  const message = err instanceof Error ? err.message : String(err ?? '')
  if (!message) return { fallback: false, cooldown: false }
  if (
    /API key not valid|invalid api key|UNAUTHENTICATED|\b401\b|Request was aborted|AbortError/i.test(
      message
    )
  ) {
    return { fallback: false, cooldown: false }
  }
  const isQuotaOrNotFound =
    /exceeded your current quota|quota exceeded|resource_exhausted|generate_content_free_tier_requests|not found|is not supported|\b404\b/i.test(
      message
    )
  if (isQuotaOrNotFound) {
    return { fallback: true, cooldown: true }
  }
  const isTransientOrModelError =
    /rate.?limit|too many requests|\b429\b|high demand|overloaded|unavailable|\b503\b|\b502\b|\b504\b|\b500\b|gateway timeout|internal error|returned no text/i.test(
      message
    )
  return { fallback: isTransientOrModelError, cooldown: false }
}

function buildGoogleTextCandidateModels(
  provider: ModelProviderInstance,
  modelId: string
): string[] {
  const primary = resolveGoogleChatModelId(modelId)
  const rawCandidates: string[] = []
  if (primary) rawCandidates.push(primary)
  const selected = provider.modalities?.text?.selectedModelIds ?? []
  for (const id of selected) {
    const resolved = resolveGoogleChatModelId(id)
    if (resolved) rawCandidates.push(resolved)
  }
  if (isOfficialGoogleBaseUrl(provider.baseUrl) || /^gemini-/i.test(primary)) {
    for (const fallback of GOOGLE_CHAT_FALLBACK_MODELS) {
      rawCandidates.push(fallback)
    }
  }
  const unique: string[] = []
  const seen = new Set<string>()
  for (const candidate of rawCandidates) {
    if (!candidate || seen.has(candidate)) continue
    seen.add(candidate)
    unique.push(candidate)
  }
  const now = Date.now()
  const active: string[] = []
  const cooled: string[] = []
  for (const candidate of unique) {
    const until = googleTextModelCooldownUntil.get(googleModelCooldownKey(provider, candidate)) ?? 0
    if (until > now) {
      cooled.push(candidate)
    } else {
      active.push(candidate)
    }
  }
  return [...active, ...cooled]
}

async function generateGoogleTextWithFallback(
  provider: ModelProviderInstance,
  modelId: string,
  input: GenerateTextInput
): Promise<GenerateTextResult> {
  const openAiProvider = withGoogleOpenAiBase(provider)
  const candidates = buildGoogleTextCandidateModels(provider, modelId)
  let lastError: unknown
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!
    const hasMoreCandidates = i < candidates.length - 1
    try {
      return await generateOpenAiCompatibleText(openAiProvider, candidate, input, {
        retries: hasMoreCandidates ? 0 : 1
      })
    } catch (err) {
      lastError = err
      const { fallback, cooldown } = shouldFallbackGoogleTextModel(err)
      if (cooldown) {
        googleTextModelCooldownUntil.set(
          googleModelCooldownKey(provider, candidate),
          Date.now() + GOOGLE_TEXT_MODEL_COOLDOWN_MS
        )
      }
      if (!hasMoreCandidates || !fallback) {
        throw err
      }
    }
  }
  throw lastError
}

interface GoogleModelListRow {
  id?: string
  name?: string
  supportedGenerationMethods?: string[]
}

async function fetchTextCatalog(provider: ModelProviderInstance): Promise<CatalogModel[]> {
  const client = createProviderHttpClient(withGoogleOpenAiBase(provider))
  try {
    const { data } = await client.get<{
      data?: GoogleModelListRow[]
      models?: GoogleModelListRow[]
    }>('/models')
    const rawList = Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.models)
        ? data.models
        : []
    const seen = new Set<string>()
    const result: CatalogModel[] = []
    for (const m of rawList) {
      if (
        Array.isArray(m?.supportedGenerationMethods) &&
        m.supportedGenerationMethods.length > 0 &&
        !m.supportedGenerationMethods.includes('generateContent')
      ) {
        continue
      }
      const rawId = String(m?.id ?? m?.name ?? '').trim()
      if (!rawId || !isGoogleTextModelId(rawId)) continue
      const id = normalizeGoogleModelId(rawId)
      if (!id || seen.has(id)) continue
      seen.add(id)
      result.push({ id, name: id, modality: 'text' as const })
    }
    return result
  } catch (err) {
    throw fail(PROVIDER_ERRORS.actionFailed, {
      action: 'listModels',
      detail: await readHttpError(err)
    })
  }
}

function extractVideoDownloadUrl(data: Record<string, unknown>): string | undefined {
  const raw = data as Record<string, unknown> & {
    video_url?: unknown
    output?: unknown
    url?: unknown
    result?: unknown
    generatedVideos?: unknown
    response?: {
      generateVideoResponse?: {
        generatedSamples?: Array<{ video?: { uri?: string; url?: string } }>
      }
      generatedVideos?: Array<{
        url?: string
        uri?: string
        video?: { uri?: string; url?: string }
      }>
      videos?: Array<{ url?: string; uri?: string }>
    }
  }
  if (typeof raw.video_url === 'string' && raw.video_url.trim()) return raw.video_url.trim()
  const opSamples = raw.response?.generateVideoResponse?.generatedSamples
  if (Array.isArray(opSamples)) {
    const sampleUrl = opSamples
      .map((item) => item?.video?.uri || item?.video?.url)
      .find((item) => typeof item === 'string' && item.trim())
    if (typeof sampleUrl === 'string') return sampleUrl.trim()
  }
  const opVideos = raw.response?.generatedVideos ?? raw.response?.videos
  if (Array.isArray(opVideos)) {
    const vidUrl = opVideos
      .map((item) => {
        if (!item || typeof item !== 'object') return undefined
        const row = item as { url?: string; uri?: string; video?: { uri?: string; url?: string } }
        return row.url || row.uri || row.video?.uri || row.video?.url
      })
      .find((item) => typeof item === 'string' && item.trim())
    if (typeof vidUrl === 'string') return vidUrl.trim()
  }
  if (Array.isArray(raw.output)) {
    const url = raw.output
      .map((item) =>
        item && typeof item === 'object' ? (item as { url?: unknown }).url : undefined
      )
      .find((item) => typeof item === 'string' && item.trim())
    if (typeof url === 'string') return url.trim()
  }
  if (raw.output && typeof raw.output === 'object') {
    const url = (raw.output as { url?: unknown }).url
    if (typeof url === 'string' && url.trim()) return url.trim()
  }
  if (typeof raw.output === 'string' && raw.output.trim()) return raw.output.trim()
  if (Array.isArray(raw.result)) {
    const url = raw.result
      .map((item) =>
        item && typeof item === 'object' ? (item as { url?: unknown }).url : undefined
      )
      .find((item) => typeof item === 'string' && item.trim())
    if (typeof url === 'string') return url.trim()
  }
  if (Array.isArray(raw.generatedVideos)) {
    const url = raw.generatedVideos
      .map((item) => {
        if (!item || typeof item !== 'object') return undefined
        const row = item as {
          url?: unknown
          uri?: unknown
          video?: { uri?: unknown; url?: unknown }
        }
        return row.url || row.uri || row.video?.uri || row.video?.url
      })
      .find((item) => typeof item === 'string' && item.trim())
    if (typeof url === 'string') return url.trim()
  }
  if (typeof raw.url === 'string' && raw.url.trim()) return raw.url.trim()
  return undefined
}

export const googleAdapter: ModelProviderAdapter = {
  kind: 'google',

  async assertAuth(provider) {
    if (!provider.apiKey.trim()) throw fail(PROVIDER_ERRORS.missingApiKey)
    const client = createProviderHttpClient(withGoogleOpenAiBase(provider))
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
    if (modality === 'image' || modality === 'video') {
      return listGoogleCatalogModels(modality)
    }
    if (modality !== 'text') return []
    return fetchTextCatalog(provider)
  },

  generateText(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateTextInput
  ): Promise<GenerateTextResult> {
    return generateGoogleTextWithFallback(provider, modelId, input)
  },

  async generateImage(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateImageInput
  ): Promise<GenerateImageResult> {
    const normalizedModelId = normalizeGoogleModelId(modelId)
    // Gemini/Nano Banana 用「图n」对齐参考图顺序；应用内统一 @n，此处转换
    const prompt = rewriteAtMentionsForImagePrompt(input.prompt)
    const refs = (input.inputReferences ?? []).map((ref) => ref.trim()).filter(Boolean)

    try {
      if (isGoogleNativeImageModelId(normalizedModelId)) {
        const inlineParts: GeminiInlineDataPart[] = []
        for (const ref of refs) {
          const part = await referenceToInlineDataPart(ref)
          if (part) inlineParts.push(part)
        }

        const aspectRatio = input.aspectRatio?.trim() || undefined
        const imageSize = normalizeGoogleImageSize(input.resolution)
        const nativeClient = createGoogleNativeHttpClient(provider, LONG_GENERATE_TIMEOUT_MS)
        const endpoint = `/models/${normalizedModelId}:generateContent`

        try {
          const { data } = await nativeClient.post<GenerateContentResponseShape>(
            endpoint,
            buildGenerateContentImageBody(prompt, inlineParts, { aspectRatio, imageSize })
          )
          return parseGenerateContentImages(data, normalizedModelId)
        } catch (nativeErr) {
          const status = axios.isAxiosError(nativeErr) ? nativeErr.response?.status : undefined
          const raw = await readHttpError(nativeErr)

          // 部分模型或代理不支持 imageSize / imageConfig 时，降级去掉对应字段重试
          if (
            status === 400 &&
            (imageSize || aspectRatio) &&
            /imageSize|image_size|imageConfig|image_config|Unknown name|Cannot find field/i.test(
              raw
            )
          ) {
            try {
              const { data } = await nativeClient.post<GenerateContentResponseShape>(
                endpoint,
                buildGenerateContentImageBody(prompt, inlineParts, {
                  aspectRatio,
                  imageSize: undefined
                })
              )
              return parseGenerateContentImages(data, normalizedModelId)
            } catch {
              const { data } = await nativeClient.post<GenerateContentResponseShape>(
                endpoint,
                buildGenerateContentImageBody(prompt, inlineParts, {
                  includeImageConfig: false
                })
              )
              return parseGenerateContentImages(data, normalizedModelId)
            }
          }

          // 第三方 OpenAI 兼容中转（未暴露原生 /models/:generateContent）回退 /images/generations
          if (
            !isOfficialGoogleBaseUrl(provider.baseUrl) &&
            (status === 404 || status === 405 || status === 501)
          ) {
            return await generateImageViaOpenAiEndpoint(provider, normalizedModelId, prompt, input)
          }
          throw nativeErr
        }
      }

      return await generateImageViaOpenAiEndpoint(provider, normalizedModelId, prompt, input)
    } catch (err) {
      throw fail(PROVIDER_ERRORS.actionFailed, {
        action: 'imageGenerate',
        detail: formatGoogleImageError(await readHttpError(err), provider, normalizedModelId)
      })
    }
  },

  async submitVideo(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateVideoInput
  ): Promise<GenerateVideoJob> {
    const normalizedModelId = normalizeGoogleModelId(modelId)
    const openAiProvider = withGoogleOpenAiBase(provider)
    const client = createProviderHttpClient(openAiProvider, LONG_GENERATE_TIMEOUT_MS)
    const durationSeconds =
      input.duration != null && Number.isFinite(input.duration)
        ? snapGoogleVeoDuration(input.duration)
        : undefined
    const resolution = normalizeGoogleVeoResolution(input.resolution)
    const aspectRatio = normalizeGoogleVeoAspectRatio(input.aspectRatio)
    const firstFrame = input.firstFrameImageUrl?.trim()

    const buildBody = (useLegacyDurationKey: boolean): Record<string, unknown> => {
      const body: Record<string, unknown> = {
        model: normalizedModelId,
        prompt: input.prompt
      }
      if (durationSeconds != null) {
        // Google 官方 /v1beta/openai/videos 只认 duration_seconds（传 duration 会报 400 Request contains an invalid argument），
        // 且仅允许 4 / 6 / 8 秒
        if (useLegacyDurationKey) {
          body.duration = durationSeconds
        } else {
          body.duration_seconds = durationSeconds
        }
      }
      if (resolution) body.resolution = resolution
      if (aspectRatio) body.aspect_ratio = aspectRatio
      if (firstFrame) body.image = firstFrame
      return body
    }

    try {
      let data: { id?: string; name?: string }
      try {
        const resp = await client.post<{ id?: string; name?: string }>('/videos', buildBody(false))
        data = resp.data
      } catch (submitErr) {
        const status = axios.isAxiosError(submitErr) ? submitErr.response?.status : undefined
        const raw = await readHttpError(submitErr)
        // 第三方中转网关若只认 duration 而不认 duration_seconds，自动用 duration 重试一次
        if (
          !isOfficialGoogleBaseUrl(provider.baseUrl) &&
          status === 400 &&
          durationSeconds != null &&
          /duration_seconds|Unknown name|invalid argument/i.test(raw)
        ) {
          const retryResp = await client.post<{ id?: string; name?: string }>(
            '/videos',
            buildBody(true)
          )
          data = retryResp.data
        } else {
          throw submitErr
        }
      }
      const jobId = data.id || data.name
      if (!jobId) throw fail(PROVIDER_ERRORS.noVideoTaskId)
      return {
        jobId,
        pollingUrl: `${trimBaseUrl(openAiProvider.baseUrl)}/videos/${jobId}`,
        status: 'submitted',
        model: normalizedModelId
      }
    } catch (err) {
      throw fail(PROVIDER_ERRORS.actionFailed, {
        action: 'videoSubmit',
        detail: formatGoogleVideoError(await readHttpError(err), provider, normalizedModelId)
      })
    }
  },

  async pollVideo(
    provider: ModelProviderInstance,
    job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    const client = createProviderHttpClient(withGoogleOpenAiBase(provider))
    try {
      const path = job.pollingUrl.startsWith('http') ? job.pollingUrl : `/videos/${job.jobId}`
      const { data } = await client.get<Record<string, unknown>>(path)
      const fallbackStatus =
        data.done === true ? (data.error ? 'failed' : 'completed') : 'in_progress'
      const raw = String(data.status ?? fallbackStatus).toLowerCase()

      let status: VideoPollResult['status'] = 'pending'
      if (raw === 'completed' || raw === 'succeeded' || raw === 'success' || raw === 'done') {
        status = 'completed'
      } else if (
        raw === 'processing' ||
        raw === 'running' ||
        raw === 'in_progress' ||
        raw === 'generating'
      ) {
        status = 'in_progress'
      } else if (raw === 'failed' || raw === 'cancelled' || raw === 'canceled') {
        status = 'failed'
      }

      const error =
        typeof data.error === 'string'
          ? data.error
          : data.error && typeof data.error === 'object'
            ? (data.error as { message?: string }).message
            : undefined
      let progress = 15
      if (status === 'in_progress') progress = 55
      if (status === 'completed' || status === 'failed') progress = 100

      return {
        status,
        progress,
        error,
        downloadUrl: status === 'completed' ? extractVideoDownloadUrl(data) : undefined
      }
    } catch (err) {
      throw fail(PROVIDER_ERRORS.actionFailed, {
        action: 'videoPolling',
        detail: await readHttpError(err)
      })
    }
  },

  generateSpeech(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult> {
    return notSupported()
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
