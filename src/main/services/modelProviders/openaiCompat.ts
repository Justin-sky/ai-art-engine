import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type {
  GenerateSpeechInput,
  GenerateSpeechResult,
  GenerateTextInput,
  GenerateTextResult,
  ModelProviderInstance
} from '@shared/modelProvider'
import { isVolcengineArkProvider } from '@shared/modelProvider'
import axios from 'axios'
import {
  authHeaders,
  createProviderHttpClient,
  formatAuthError,
  LONG_GENERATE_TIMEOUT_MS,
  readHttpError,
  sleep
} from './http'
import { PROVIDER_ERRORS } from './catalog'
import { fail, defErr, defErrSimple } from '@shared/errors/appError'
import { projectService } from '../projectService'

type ChatMessage = { role: string; content: unknown }

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string; content?: string }> | null
      reasoning_content?: string | null
      reasoning?: string | null
      refusal?: string | null
      tool_calls?: Array<{
        function?: { name?: string; arguments?: string | Record<string, unknown> }
      }>
    }
    /** 少数兼容实现把正文放在 choice.text */
    text?: string | null
  }>
  model?: string
}

// ── 本文件错误条目（catalog 未覆盖的个性文案）──
const E_EMPTY_CHAT_TEXT = defErrSimple(
  'provider.openai-compat.empty-chat-text',
  '模型未返回文本内容。可能原因：思考模型只产出了内部推理字段、响应走了 tool_calls、或 choices 为空。请换普通 chat 文本模型重试，并确认接入点支持 /chat/completions。',
  'The model returned no text content. Possible causes: a reasoning model only produced internal reasoning fields, the response took tool_calls, or choices was empty. Try a regular chat text model and confirm the endpoint supports /chat/completions.'
)

const E_CHAT_REFUSAL = defErr<{ refusal: string }>(
  'provider.openai-compat.chat-refused',
  ({ refusal }) => `模型拒绝回答：${refusal}`,
  ({ refusal }) => `The model refused to answer: ${refusal}`
)

const E_TOS_OPENROUTER_DENIED = defErrSimple(
  'provider.openai-compat.tos-openrouter-denied',
  'OpenRouter 拒绝了该请求（provider Terms of Service / 数据策略）。' +
    '常见原因：隐私设置未允许该上游供应商（如 OpenAI），或账号对 openai/* 路由受限。' +
    '请到 https://openrouter.ai/settings/privacy 调整 Provider 与数据策略后重试；' +
    '也可改用非 OpenAI 文本模型，或换用方舟 / 通义等国内文本接入点。',
  'OpenRouter rejected this request (provider Terms of Service / data policy). ' +
    'Common causes: privacy settings do not allow the upstream provider (e.g. OpenAI), or your account restricts openai/* routes. ' +
    'Adjust providers and data policy at https://openrouter.ai/settings/privacy and retry; ' +
    'or switch to a non-OpenAI text model or a domestic endpoint such as Volcengine Ark / Qwen.'
)

const E_TOS_UPSTREAM_DENIED = defErrSimple(
  'provider.openai-compat.tos-upstream-denied',
  '上游模型提供商拒绝了该请求（Terms of Service / 内容或路由策略）。' +
    '请换一个文本模型重试，或检查该提供商控制台的隐私、区域与模型访问权限。',
  'The upstream model provider rejected this request (Terms of Service / content or routing policy). ' +
    'Try another text model, or check privacy, region and model access settings in that provider console.'
)

const E_TEXT_REQUEST_TIMEOUT = defErr<{ sec: number }>(
  'provider.openai-compat.text-request-timeout',
  ({ sec }) => `请求超时（已等待 ${sec} 秒）。长输出可再试一次，或改用更快的文本模型`,
  ({ sec }) => `Request timed out after ${sec}s. Retry for long outputs, or switch to a faster text model`
)

const E_ARK_TEXT_INTERNAL = defErr<{ requestId?: string }>(
  'provider.openai-compat.ark-text-internal-error',
  ({ requestId }) =>
    `火山方舟服务端内部错误${requestId ? `（Request id: ${requestId}）` : ''}。` +
    `这通常是方舟侧瞬时故障或接入点异常，不是本地超时。` +
    `请稍后重试；若持续失败，到方舟控制台核对该文本模型接入点状态/余额，或换一个文本接入点`,
  ({ requestId }) =>
    `Volcengine Ark server-side internal error${requestId ? ` (Request id: ${requestId})` : ''}. ` +
    `This is usually a transient Ark-side failure or endpoint issue, not a local timeout. ` +
    `Retry later; if it persists, verify the text model endpoint status/balance in the Ark console or switch to another endpoint`
)

const E_TEXT_SERVER_INTERNAL = defErr<{ requestId?: string }>(
  'provider.openai-compat.text-server-internal-error',
  ({ requestId }) => `服务端内部错误${requestId ? `（Request id: ${requestId}）` : ''}，请稍后重试`,
  ({ requestId }) =>
    `Server-side internal error${requestId ? ` (Request id: ${requestId})` : ''}; please retry later`
)

const E_TEXT_GENERATE_FAILED = defErr<{ detail: string }>(
  'provider.openai-compat.text-generate-failed',
  ({ detail }) => `文本生成失败: ${detail}`,
  ({ detail }) => `Text generation failed: ${detail}`
)

const E_VOICE_GENERATE_FAILED = defErr<{ detail: string }>(
  'provider.openai-compat.voice-generate-failed',
  ({ detail }) => `语音生成失败: ${detail}`,
  ({ detail }) => `Voice generation failed: ${detail}`
)

function normalizeMessageContent(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (!part || typeof part !== 'object') return ''
      const row = part as { text?: unknown; content?: unknown }
      if (typeof row.text === 'string') return row.text
      if (typeof row.content === 'string') return row.content
      return ''
    })
    .join('')
    .trim()
}

/** 从 chat/completions 响应提取可展示/可解析的文本（供测试与生成共用） */
export function extractChatCompletionText(data: ChatCompletionResponse): string {
  const choice = data.choices?.[0]
  const message = choice?.message
  const fromContent = normalizeMessageContent(message?.content)
  if (fromContent) return fromContent

  if (typeof choice?.text === 'string' && choice.text.trim()) return choice.text.trim()

  const reasoning =
    (typeof message?.reasoning_content === 'string' && message.reasoning_content.trim()) ||
    (typeof message?.reasoning === 'string' && message.reasoning.trim()) ||
    ''
  if (reasoning) return reasoning

  // 部分模型只回 tool_calls；序列化为 JSON，供 AI 姿势等解析器使用
  const toolCall = message?.tool_calls?.[0]?.function
  if (toolCall?.name?.trim()) {
    let args: unknown = toolCall.arguments
    if (typeof args === 'string') {
      const trimmed = args.trim()
      try {
        args = JSON.parse(trimmed)
      } catch {
        args = trimmed
      }
    }
    return JSON.stringify({ name: toolCall.name.trim(), arguments: args ?? {} })
  }

  if (typeof message?.refusal === 'string' && message.refusal.trim()) {
    throw fail(E_CHAT_REFUSAL, { refusal: message.refusal.trim() })
  }

  return ''
}

export type GenerateTextRequestOptions = {
  /** 瞬时 5xx 重试次数（不含首次） */
  retries?: number
}

function buildChatMessages(input: GenerateTextInput): ChatMessage[] {
  const messages: ChatMessage[] = []
  if (input.system?.trim()) {
    messages.push({ role: 'system', content: input.system.trim() })
  }
  const imageUrls = (input.images ?? []).map((url) => url.trim()).filter(Boolean)
  if (imageUrls.length) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: input.prompt },
        ...imageUrls.map((url) => ({
          type: 'image_url',
          image_url: { url }
        }))
      ]
    })
  } else {
    messages.push({ role: 'user', content: input.prompt })
  }
  return messages
}

function isRetryableTextError(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false
  if (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'EAI_AGAIN') {
    return true
  }
  const status = err.response?.status
  if (status === 500 || status === 502 || status === 503 || status === 529) return true
  const raw = err.response?.data as
    | { error?: { code?: string; message?: string } | string; message?: string }
    | undefined
  const code =
    raw?.error && typeof raw.error === 'object' ? String(raw.error.code ?? '') : ''
  const message =
    (raw?.error && typeof raw.error === 'object' ? raw.error.message : undefined) ||
    (typeof raw?.error === 'string' ? raw.error : undefined) ||
    raw?.message ||
    err.message ||
    ''
  return (
    /InternalServiceError/i.test(code) ||
    /internal\s*(service\s*)?error/i.test(message) ||
    /overloaded|temporarily unavailable|try again later/i.test(message)
  )
}

function extractRequestId(message: string): string | null {
  const match = message.match(/Request id:\s*([A-Za-z0-9_-]+)/i)
  return match?.[1] ?? null
}

/** OpenRouter / 上游 ToS、隐私策略拒绝时的可操作说明（供测试与错误格式化共用） */
export function explainProviderTosDenial(raw: string, baseUrl?: string): string | null {
  if (
    !/prohibited due to a violation of provider terms of service/i.test(raw) &&
    !(/terms of service/i.test(raw) && /forbidden|403/i.test(raw))
  ) {
    return null
  }
  if (/openrouter\.ai/i.test(baseUrl || '')) {
    return fail(E_TOS_OPENROUTER_DENIED).message
  }
  return fail(E_TOS_UPSTREAM_DENIED).message
}

async function formatTextGenerateFailure(
  err: unknown,
  provider: ModelProviderInstance
): Promise<string> {
  if (axios.isAxiosError(err) && err.code === 'ECONNABORTED') {
    const sec = Math.round(LONG_GENERATE_TIMEOUT_MS / 1000)
    return fail(E_TEXT_REQUEST_TIMEOUT, { sec }).message
  }

  const raw = await readHttpError(err)
  const requestId = extractRequestId(raw)
  const status = axios.isAxiosError(err) ? err.response?.status : undefined
  const data = axios.isAxiosError(err)
    ? (err.response?.data as { error?: { code?: string } } | undefined)
    : undefined
  const code = data?.error?.code ? String(data.error.code) : ''

  const tosHint = explainProviderTosDenial(raw, provider.baseUrl)
  if (tosHint) return tosHint

  if (
    status === 500 ||
    /InternalServiceError/i.test(code) ||
    /internal\s*(service\s*)?error/i.test(raw)
  ) {
    const idHint = requestId ?? undefined
    if (isVolcengineArkProvider(provider)) {
      return fail(E_ARK_TEXT_INTERNAL, { requestId: idHint }).message
    }
    return fail(E_TEXT_SERVER_INTERNAL, { requestId: idHint }).message
  }

  return formatAuthError(raw, provider)
}

/** OpenAI 兼容：POST /chat/completions（OpenRouter / 方舟文本共用） */
export async function generateOpenAiCompatibleText(
  provider: ModelProviderInstance,
  modelId: string,
  input: GenerateTextInput,
  options?: GenerateTextRequestOptions
): Promise<GenerateTextResult> {
  const client = createProviderHttpClient(provider, LONG_GENERATE_TIMEOUT_MS)
  const messages = buildChatMessages(input)
  const retries = Math.max(0, options?.retries ?? (isVolcengineArkProvider(provider) ? 2 : 0))
  const ark = isVolcengineArkProvider(provider)

  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    const body: Record<string, unknown> = {
      model: modelId,
      messages
    }
    // 方舟重试：部分 Seed 思考模型在重负载下易 500，第二次尝试关闭 thinking
    if (ark && attempt > 0) {
      body.thinking = { type: 'disabled' }
    }

    try {
      const { data } = await client.post<ChatCompletionResponse>(
        '/chat/completions',
        body,
        { headers: authHeaders(provider.apiKey) }
      )
      const text = extractChatCompletionText(data)
      if (!text) throw fail(E_EMPTY_CHAT_TEXT)
      return { text, model: data.model ?? modelId }
    } catch (err) {
      lastError = err
      // thinking.disabled 不被该模型接受时，去掉该字段再试一次（仍计在同一 attempt 的补救）
      if (
        ark &&
        attempt > 0 &&
        axios.isAxiosError(err) &&
        err.response?.status === 400 &&
        /thinking/i.test(await readHttpError(err))
      ) {
        try {
          const { data } = await client.post<ChatCompletionResponse>(
            '/chat/completions',
            { model: modelId, messages },
            { headers: authHeaders(provider.apiKey) }
          )
          const text = extractChatCompletionText(data)
          if (!text) throw fail(E_EMPTY_CHAT_TEXT)
          return { text, model: data.model ?? modelId }
        } catch (retryErr) {
          lastError = retryErr
        }
      }

      if (attempt >= retries || !isRetryableTextError(err)) break
      await sleep(800 * (attempt + 1))
    }
  }

  throw fail(E_TEXT_GENERATE_FAILED, {
    detail: await formatTextGenerateFailure(lastError, provider)
  })
}

/** OpenAI 兼容：POST /audio/speech */
export async function generateOpenAiCompatibleSpeech(
  provider: ModelProviderInstance,
  modelId: string,
  input: GenerateSpeechInput
): Promise<GenerateSpeechResult> {
  const format = input.responseFormat ?? 'mp3'
  const voice = input.voice?.trim() || 'alloy'
  const client = createProviderHttpClient(provider)

  try {
    const response = await client.post(
      '/audio/speech',
      {
        model: modelId,
        input: input.input,
        voice,
        response_format: format,
        ...(input.speed != null ? { speed: input.speed } : {})
      },
      { responseType: 'arraybuffer', timeout: 180_000 }
    )

    const buf = Buffer.from(response.data as ArrayBuffer)
    if (!buf.length) throw fail(PROVIDER_ERRORS.noAudioResult)

    const ext = format === 'pcm' ? 'pcm' : 'mp3'
    const stamp = Date.now()

    if (projectService.isOpen()) {
      const root = projectService.getRoot()
      const dir = join(root, 'assets', 'generated', 'voice')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const absPath = join(dir, `tts-${stamp}.${ext}`)
      writeFileSync(absPath, buf)
      const asset = projectService.attachExternalGeneratedFile({
        type: 'voice',
        sourceFilePath: absPath,
        name: input.name ?? `TTS ${new Date().toLocaleString()}`,
        prompt: input.input
      })
      return {
        model: modelId,
        voice,
        format,
        filePath: absPath,
        assetId: asset.id,
        relativePath: asset.relativePath
      }
    }

    const tmpDir = join(process.cwd(), '.aiartengine-tmp', 'tts')
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true })
    const filePath = join(tmpDir, `tts-${stamp}.${ext}`)
    writeFileSync(filePath, buf)
    return { model: modelId, voice, format, filePath }
  } catch (err) {
    throw fail(E_VOICE_GENERATE_FAILED, { detail: await readHttpError(err) })
  }
}
