import type { AgentState, AgentToolResult, StreamFn } from '@earendil-works/pi-agent-core'
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Model,
  type ModelInputModality,
  type ToolCall
} from '@earendil-works/pi-ai'
import { streamSimple as anthropicStreamSimple } from '@earendil-works/pi-ai/api/anthropic-messages'
import { streamSimple as googleStreamSimple } from '@earendil-works/pi-ai/api/google-generative-ai'
import { streamSimple as openAiStreamSimple } from '@earendil-works/pi-ai/api/openai-completions'
import {
  ANTHROPIC_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_BASE_URL,
  MODEL_PROVIDER_KINDS,
  OPENAI_DEFAULT_BASE_URL,
  isCustomProvider,
  modalityConfig,
  resolveCustomApiStyle,
  type ModelProviderInstance
} from '@shared/modelProvider'
import {
  resolveGoogleChatModelId,
  resolveGoogleOpenAiBaseUrl
} from '@shared/modelProviders/google/modelCapabilities'
import { normalizeOpenAiTextModelId } from '@shared/modelProviders/openai/modelCapabilities'

/** OpenAI 兼容网关对单次请求 tools 数组长度的硬上限 */
export const OPENAI_HARD_MAX_TOOLS = 128

/** 进程内 Pi Agent 工具与返回结果类型（对齐 AgentState['tools']，避免显式 any） */
export type RuntimeAgentTool = AgentState['tools'][number]
export type RuntimeToolResult = AgentToolResult<unknown>

export interface ResolvedPiChatModel {
  model: Model<Api>
  apiKey: string
  provider: ModelProviderInstance
}

/**
 * 判断模型是否具备原生视觉（Image Input）多模态输入能力。
 * 纯文本模型（如 deepseek-chat / deepseek-reasoner）声明为 ['text']，
 * pi-ai 在发送请求前会自动剥离或降级图片块，避免上游报 400 Invalid content type image_url。
 */
export function inferChatModelInputModalities(
  modelId: string,
  provider?: Pick<ModelProviderInstance, 'providerKind' | 'baseUrl'>
): ModelInputModality[] {
  const id = modelId.trim().toLowerCase()
  if (!id) return ['text']

  // DeepSeek 官方 V3 / R1 目前仅支持纯文本对话
  if (
    provider?.providerKind === 'deepseek' ||
    /\bdeepseek-(chat|reasoner|coder|v2|v3|r1)\b/i.test(id)
  ) {
    if (!/\bvl\b|vision|janus/i.test(id)) {
      return ['text']
    }
  }

  // 主流原生多模态家族：GPT-4o/4.1/4.5/5/6、o1/o3/o4、Claude 3/4、Gemini、Qwen-VL/Omni、GLM-4V、Kimi-VL/k2.5、Grok-2-vision/Grok-3/4、Pixtral、Doubao-vision
  if (
    /\b(gpt-4o|gpt-4\.1|gpt-4\.5|gpt-5|gpt-6|chatgpt-4o|o1|o3|o4)\b/i.test(id) ||
    /\bclaude-(3|4|sonnet|opus|haiku)/i.test(id) ||
    /\bgemini\b/i.test(id) ||
    /\b(vl|vision|omni|pixtral|llava|minicpm-v|internvl|QvQ|qwen2\.5-vl|qwen3-vl|glm-4v|glm-4\.5v|kimi-vl|kimi-k2\.5|grok-(2-vision|3|4)|doubao-.*vision|seed-1\.[568])\b/i.test(
      id
    )
  ) {
    return ['text', 'image']
  }

  if (
    provider?.providerKind === 'anthropic' ||
    provider?.providerKind === 'google' ||
    provider?.providerKind === 'openai'
  ) {
    if (!/\b(gpt-3\.5|o1-mini|o3-mini|babbage|davinci)\b/i.test(id)) {
      return ['text', 'image']
    }
  }

  return ['text']
}

/** 推断模型是否支持思维链（reasoning / extended thinking） */
export function inferChatModelReasoning(modelId: string): boolean {
  const id = modelId.trim().toLowerCase()
  return (
    /\b(reasoner|r1|qwq|qvq|o1|o3|o4|gpt-5|gpt-6|thinking)\b/i.test(id) ||
    /\bclaude-(3-7|sonnet-4|opus-4|4)/i.test(id) ||
    /\bgemini-(2\.5|3)/i.test(id) ||
    /\b(glm-z1|qwen3|deepseek-r1|seed-thinking)\b/i.test(id)
  )
}

function normalizeAnthropicBaseUrl(rawBaseUrl: string): string {
  const trimmed = (rawBaseUrl || ANTHROPIC_DEFAULT_BASE_URL).trim().replace(/\/+$/, '')
  // @anthropic-ai/sdk 内部自动拼 `/v1/messages`，若用户填了末尾 `/v1` 需剥掉以防 `/v1/v1/messages`
  return trimmed.replace(/\/v1$/i, '')
}

function normalizeOpenAiBaseUrl(provider: ModelProviderInstance, rawBaseUrl: string): string {
  const trimmed = rawBaseUrl.trim().replace(/\/+$/, '')
  if (provider.providerKind === 'google' || /generativelanguage\.googleapis\.com/i.test(trimmed)) {
    return resolveGoogleOpenAiBaseUrl(trimmed)
  }
  if (provider.providerKind === 'deepseek' || /^https?:\/\/api\.deepseek\.com$/i.test(trimmed)) {
    const base = trimmed || DEEPSEEK_DEFAULT_BASE_URL
    return /\/v\d+$/i.test(base) ? base : `${base}/v1`
  }
  if (!trimmed) return OPENAI_DEFAULT_BASE_URL
  return trimmed
}

/**
 * 从应用已配置的 ModelProviderInstance 列表中解析供 Pi Agent 使用的聊天模型与 API 协议。
 * 同时支持：
 * - Anthropic Messages API（Claude 官方、自定义 Anthropic 代理、DeepSeek `/anthropic` 兼容端点）
 * - OpenAI Chat Completions API（OpenAI、DeepSeek `/v1`、Google Gemini OpenAI 兼容层、OpenRouter、通义、豆包、智谱、Kimi、本地 Ollama/vLLM 及各类中转站）
 */
export function resolvePiModelFromProviders(
  providers: ReadonlyArray<ModelProviderInstance>,
  opts?: {
    providerId?: string
    modelId?: string
  }
): ResolvedPiChatModel | null {
  const hasTextModels = (p: ModelProviderInstance): boolean =>
    (modalityConfig(p, 'text').selectedModelIds?.length ?? 0) > 0

  const buildFromProvider = (
    p: ModelProviderInstance,
    explicitModelId?: string
  ): ResolvedPiChatModel | null => {
    const apiKey = p.apiKey?.trim() ?? ''
    if (!apiKey) return null
    const textCfg = modalityConfig(p, 'text')
    const rawModelId =
      explicitModelId?.trim() ||
      (textCfg.defaultModelId?.trim() && textCfg.selectedModelIds.includes(textCfg.defaultModelId)
        ? textCfg.defaultModelId.trim()
        : undefined) ||
      textCfg.selectedModelIds[0]?.trim()
    if (!rawModelId) return null

    const rawBaseUrl =
      p.baseUrl?.trim() ||
      MODEL_PROVIDER_KINDS.find((k) => k.id === p.providerKind)?.defaultBaseUrl ||
      ''

    const isAnthropicProtocol =
      p.providerKind === 'anthropic' ||
      (isCustomProvider(p) && resolveCustomApiStyle(p) === 'anthropic') ||
      /\/anthropic\/?$/i.test(rawBaseUrl)

    const input = inferChatModelInputModalities(rawModelId, p)
    const reasoning = inferChatModelReasoning(rawModelId)

    if (isAnthropicProtocol) {
      const baseUrl = normalizeAnthropicBaseUrl(rawBaseUrl)
      const model: Model<'anthropic-messages'> = {
        id: rawModelId,
        name: rawModelId,
        api: 'anthropic-messages',
        provider: p.providerKind === 'anthropic' ? 'anthropic' : p.id || 'anthropic',
        baseUrl,
        input,
        reasoning,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200_000,
        maxTokens: 16_384
      }
      return { model, apiKey, provider: p }
    }

    const isGoogle =
      p.providerKind === 'google' || /generativelanguage\.googleapis\.com/i.test(rawBaseUrl)
    const isOfficialOpenAi =
      p.providerKind === 'openai' && (!rawBaseUrl || /\bapi\.openai\.com\b/i.test(rawBaseUrl))

    const resolvedModelId = isGoogle
      ? resolveGoogleChatModelId(rawModelId)
      : isOfficialOpenAi
        ? normalizeOpenAiTextModelId(rawModelId, { hasTools: true })
        : rawModelId
    const baseUrl = normalizeOpenAiBaseUrl(p, rawBaseUrl)

    const model: Model<'openai-completions'> = {
      id: resolvedModelId,
      name: rawModelId,
      api: 'openai-completions',
      provider: isOfficialOpenAi
        ? 'openai'
        : p.providerKind === 'openrouter'
          ? 'openrouter'
          : p.providerKind === 'deepseek'
            ? 'deepseek'
            : p.id || p.providerKind,
      baseUrl,
      input: inferChatModelInputModalities(resolvedModelId, p),
      reasoning: inferChatModelReasoning(resolvedModelId),
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 16_384,
      compat: {
        // 禁用第三方网关常拒绝的 store / developer role 字段，并强制每次请求只发送当前激活工具集
        supportsStore: false,
        supportsDeveloperRole: isOfficialOpenAi ? undefined : false,
        supportsMidConvoSystemMessages: false,
        supportsMidConvoToolAdditions: false
      }
    }
    return { model, apiKey, provider: p }
  }

  const enabledPool = providers.filter((p) => p.enabled && Boolean(p.apiKey?.trim()))
  const requestedProviderId = opts?.providerId?.trim()
  const requestedModelId = opts?.modelId?.trim()

  if (requestedProviderId) {
    const exact = enabledPool.find((p) => p.id === requestedProviderId)
    if (exact && (requestedModelId || hasTextModels(exact))) {
      return buildFromProvider(exact, requestedModelId)
    }
  }

  if (requestedModelId) {
    const owner = enabledPool.find((p) =>
      modalityConfig(p, 'text').selectedModelIds.includes(requestedModelId)
    )
    if (owner) {
      return buildFromProvider(owner, requestedModelId)
    }
  }

  const textPool = enabledPool.filter(hasTextModels)
  const preferred =
    textPool.find((p) => p.providerKind === 'deepseek') ??
    textPool.find((p) => p.providerKind === 'openai') ??
    textPool.find((p) => p.providerKind === 'anthropic') ??
    textPool[0]

  return preferred ? buildFromProvider(preferred, requestedModelId) : null
}

/**
 * 统一的多协议流式调度函数：根据 `model.api` 路由到对应 Pi API 适配器。
 */
/** 解析 DeepSeek V3 / R1 偶发在文本流中输出的 `< | DSML | calls>` 标记块 */
export interface ParsedDsmlToolCall {
  name: string
  arguments: string
  args: Record<string, unknown>
}

const DSML_START_RE = /<\s*[|｜]\s*DSML\s*[|｜]/i

export function stripDsmlFromText(text: string): string {
  if (!text) return ''
  let cleaned = text.replace(
    /<\s*[|｜]\s*DSML\s*[|｜]\s*(?:function_)?calls\s*>[\s\S]*?<\/\s*[|｜]\s*DSML\s*[|｜]\s*(?:function_)?calls\s*>/gi,
    ''
  )
  const partialIdx = cleaned.search(DSML_START_RE)
  if (partialIdx >= 0) {
    cleaned = cleaned.slice(0, partialIdx)
  }
  return cleaned.trimEnd()
}

export function parseDsmlToolCalls(text: string): ParsedDsmlToolCall[] {
  if (!text || !DSML_START_RE.test(text)) return []
  const results: ParsedDsmlToolCall[] = []
  const invokeRe =
    /<\s*[|｜]\s*DSML\s*[|｜]\s*invoke\s+name="([^"]+)"\s*>([\s\S]*?)<\/\s*[|｜]\s*DSML\s*[|｜]\s*invoke\s*>/gi
  let invMatch: RegExpExecArray | null
  while ((invMatch = invokeRe.exec(text)) !== null) {
    const name = invMatch[1].trim()
    const body = invMatch[2]
    const args: Record<string, unknown> = {}
    const paramRe =
      /<\s*[|｜]\s*DSML\s*[|｜]\s*parameter\s+name="([^"]+)"(?:\s+string="(true|false)")?\s*>([\s\S]*?)<\/\s*[|｜]\s*DSML\s*[|｜]\s*parameter\s*>/gi
    let pMatch: RegExpExecArray | null
    while ((pMatch = paramRe.exec(body)) !== null) {
      const pName = pMatch[1].trim()
      const forceString = pMatch[2] === 'true'
      const rawVal = pMatch[3]
      const trimmedVal = rawVal.trim()
      if (forceString) {
        args[pName] = trimmedVal
      } else {
        try {
          args[pName] = JSON.parse(trimmedVal)
        } catch {
          const repaired = repairMalformedToolJsonString(trimmedVal)
          try {
            args[pName] = JSON.parse(repaired)
          } catch {
            args[pName] = trimmedVal
          }
        }
      }
    }
    results.push({
      name,
      arguments: JSON.stringify(args),
      args
    })
  }
  return results
}

function normalizeDsmlToolName(rawName: string, knownToolNames: ReadonlySet<string>): string {
  if (knownToolNames.has(rawName)) return rawName
  const stripped = rawName.replace(/^mcp__(?:ai[-_]art[-_]engine|studio|blender)__/i, '')
  if (knownToolNames.has(stripped)) return stripped
  return stripped || rawName
}

export function wrapPiStreamWithDsmlRecovery(
  upstream: AssistantMessageEventStream,
  knownToolNames: ReadonlySet<string> = new Set()
): AssistantMessageEventStream {
  const out = createAssistantMessageEventStream()
  void (async () => {
    const rawTextByIndex = new Map<number, string>()
    const emittedSafeLenByIndex = new Map<number, number>()
    try {
      for await (const ev of upstream) {
        if (ev.type === 'text_start') {
          rawTextByIndex.set(ev.contentIndex, '')
          emittedSafeLenByIndex.set(ev.contentIndex, 0)
          out.push(ev)
          continue
        }
        if (ev.type === 'text_delta') {
          const prev = rawTextByIndex.get(ev.contentIndex) ?? ''
          const next = prev + ev.delta
          rawTextByIndex.set(ev.contentIndex, next)
          const dsmlIdx = next.search(DSML_START_RE)
          // 保留末尾最多 18 个字符防止 `< | DS` 半截标签漏出，仅当存在 `<` 时启用窗口缓冲
          let safeEnd = dsmlIdx >= 0 ? dsmlIdx : next.length
          if (dsmlIdx < 0) {
            const tailLt = next.lastIndexOf('<')
            if (
              tailLt >= 0 &&
              next.length - tailLt <= 20 &&
              /^<\s*[|｜]?\s*(?:d(?:s(?:m(?:l)?)?)?)?$/i.test(next.slice(tailLt))
            ) {
              safeEnd = tailLt
            }
          }
          const already = emittedSafeLenByIndex.get(ev.contentIndex) ?? 0
          if (safeEnd > already) {
            const safeDelta = next.slice(already, safeEnd)
            emittedSafeLenByIndex.set(ev.contentIndex, safeEnd)
            out.push({ ...ev, delta: safeDelta })
          }
          continue
        }
        if (ev.type === 'text_end') {
          const fullRaw = rawTextByIndex.get(ev.contentIndex) ?? ev.content
          const dsmlIdx = fullRaw.search(DSML_START_RE)
          const cleanFull = dsmlIdx >= 0 ? fullRaw.slice(0, dsmlIdx).trimEnd() : fullRaw
          const already = emittedSafeLenByIndex.get(ev.contentIndex) ?? 0
          if (cleanFull.length > already) {
            out.push({
              type: 'text_delta',
              contentIndex: ev.contentIndex,
              delta: cleanFull.slice(already),
              partial: ev.partial
            })
            emittedSafeLenByIndex.set(ev.contentIndex, cleanFull.length)
          }
          out.push({ ...ev, content: cleanFull })
          continue
        }
        if (ev.type === 'done') {
          const msg: AssistantMessage = ev.message
          const hasNativeToolCall = msg.content.some((b) => b.type === 'toolCall')
          const combinedText =
            rawTextByIndex.size > 0
              ? Array.from(rawTextByIndex.values()).join('\n')
              : msg.content
                  .filter((b) => b.type === 'text')
                  .map((b) => b.text)
                  .join('\n')
          const dsmlCalls = !hasNativeToolCall ? parseDsmlToolCalls(combinedText) : []
          if (dsmlCalls.length > 0) {
            const cleanedBlocks = msg.content
              .map((b) => (b.type === 'text' ? { ...b, text: stripDsmlFromText(b.text) } : b))
              .filter((b) => b.type !== 'text' || b.text.length > 0)
            const toolBlocks: ToolCall[] = dsmlCalls.map((call, idx) => ({
              type: 'toolCall',
              id: `dsml_${Date.now()}_${idx}`,
              name: normalizeDsmlToolName(call.name, knownToolNames),
              arguments: call.args as ToolCall['arguments']
            }))
            const patchedMsg: AssistantMessage = {
              ...msg,
              stopReason: 'toolUse',
              content: [...cleanedBlocks, ...toolBlocks]
            }
            toolBlocks.forEach((tb, idx) => {
              const contentIndex = cleanedBlocks.length + idx
              out.push({ type: 'toolcall_start', contentIndex, partial: patchedMsg })
              out.push({
                type: 'toolcall_delta',
                contentIndex,
                delta: JSON.stringify(tb.arguments),
                partial: patchedMsg
              })
              out.push({
                type: 'toolcall_end',
                contentIndex,
                toolCall: tb,
                partial: patchedMsg
              })
            })
            out.push({ type: 'done', reason: 'toolUse', message: patchedMsg })
            out.end(patchedMsg)
            return
          }
          out.push(ev)
          out.end(ev.message)
          return
        }
        if (ev.type === 'error') {
          out.push(ev)
          out.end(ev.error)
          return
        }
        out.push(ev)
      }
      const finalRes = await upstream.result()
      out.end(finalRes)
    } catch (err) {
      const fallbackErr: AssistantMessage = {
        role: 'assistant',
        content: [],
        api: 'openai-completions',
        provider: 'unknown',
        model: 'unknown',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        },
        stopReason: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
        timestamp: Date.now()
      }
      out.push({ type: 'error', reason: 'error', error: fallbackErr })
      out.end(fallbackErr)
    }
  })()
  return out
}

export const piMultiApiStreamFn: StreamFn = (model, context, options) => {
  const knownTools = new Set<string>()
  for (const msg of context.messages) {
    if (msg.role === 'system') {
      const sysTools = (msg as { tools?: Array<{ name?: string }> }).tools
      if (Array.isArray(sysTools)) {
        for (const t of sysTools) {
          if (t?.name) knownTools.add(t.name)
        }
      }
    }
  }
  if (model.api === 'anthropic-messages') {
    return anthropicStreamSimple(model as Model<'anthropic-messages'>, context, options)
  }
  if (model.api === 'google-generative-ai') {
    return googleStreamSimple(model as Model<'google-generative-ai'>, context, options)
  }
  return wrapPiStreamWithDsmlRecovery(
    openAiStreamSimple(model as Model<'openai-completions'>, context, options),
    knownTools
  )
}

/**
 * 最后一道底层请求体安全阀（onPayload）：
 * 即使调用侧出现异常配置，也确保发往 OpenAI 兼容端点的 `tools` 数组永远 <= 128。
 */
export function enforceOpenAiToolsLimitPayload(
  payload: unknown,
  maxTools = OPENAI_HARD_MAX_TOOLS
): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
  const record = payload as Record<string, unknown>
  if (!Array.isArray(record.tools) || record.tools.length <= maxTools) return payload
  return {
    ...record,
    tools: record.tools.slice(0, maxTools)
  }
}

function nextNonWsIndex(str: string, from: number): number {
  let i = from
  while (i < str.length && /\s/.test(str[i])) i += 1
  return i
}

function looksLikeObjectKeyAfterComma(str: string, afterCommaIdx: number): boolean {
  const qStart = nextNonWsIndex(str, afterCommaIdx)
  if (qStart >= str.length) return false
  if (str[qStart] === '}') return true // 尾随逗号 `,}`
  if (str[qStart] !== '"') return false
  let i = qStart + 1
  while (i < str.length) {
    if (str[i] === '\\') {
      i += 2
      continue
    }
    if (str[i] === '"') {
      const colonIdx = nextNonWsIndex(str, i + 1)
      return colonIdx < str.length && str[colonIdx] === ':'
    }
    if (str[i] === '\n' || str[i] === '\r') return false
    i += 1
  }
  return false
}

function looksLikeStructuralCloseChain(str: string, closeIdx: number): boolean {
  let i = closeIdx
  while (i < str.length) {
    const ch = str[i]
    if (ch === '}' || ch === ']' || /\s/.test(ch)) {
      i += 1
      continue
    }
    if (ch === ',') {
      // 关闭子对象/数组后紧跟 `,`：后续必须是合法对象键或下一个数组元素起首
      const next = nextNonWsIndex(str, i + 1)
      if (next >= str.length) return true
      const nch = str[next]
      return (
        nch === '"' ||
        nch === '{' ||
        nch === '[' ||
        nch === '}' ||
        nch === ']' ||
        nch === '-' ||
        (nch >= '0' && nch <= '9') ||
        nch === 't' ||
        nch === 'f' ||
        nch === 'n'
      )
    }
    return false
  }
  return true
}

/**
 * 修复模型在长 Markdown / 嵌套 JSON 工具参数里生成的语法瑕疵
 *（代码块包裹、字符串内部未转义双引号、裸换行/制表符、尾随逗号），返回合法 JSON 文本。
 */
export function repairMalformedToolJsonString(raw: string): string {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed) return trimmed

  const unwrapped = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  try {
    JSON.parse(unwrapped)
    return unwrapped
  } catch {
    /* perform structural repair */
  }

  const stack: Array<'{' | '['> = []
  let expectKey = false
  let inString = false
  let stringIsKey = false
  let escaped = false
  let out = ''

  for (let i = 0; i < unwrapped.length; i += 1) {
    const ch = unwrapped[i]
    if (inString) {
      if (escaped) {
        out += ch
        escaped = false
        continue
      }
      if (ch === '\\') {
        out += ch
        escaped = true
        continue
      }
      if (ch === '\n') {
        out += '\\n'
        continue
      }
      if (ch === '\r') {
        continue
      }
      if (ch === '\t') {
        out += '\\t'
        continue
      }
      if (ch === '"') {
        const nextIdx = nextNonWsIndex(unwrapped, i + 1)
        const nextCh = nextIdx < unwrapped.length ? unwrapped[nextIdx] : ''
        let isRealClose = false
        if (stringIsKey) {
          isRealClose = nextCh === ':'
        } else if (!nextCh) {
          isRealClose = true
        } else {
          const top = stack[stack.length - 1]
          if (top === '{') {
            if (nextCh === ',') {
              isRealClose = looksLikeObjectKeyAfterComma(unwrapped, nextIdx + 1)
            } else if (nextCh === '}') {
              isRealClose = looksLikeStructuralCloseChain(unwrapped, nextIdx)
            }
          } else if (top === '[') {
            if (nextCh === ']') {
              isRealClose = looksLikeStructuralCloseChain(unwrapped, nextIdx)
            } else if (nextCh === ',') {
              const afterComma = nextNonWsIndex(unwrapped, nextIdx + 1)
              const elemStart = afterComma < unwrapped.length ? unwrapped[afterComma] : ''
              isRealClose =
                elemStart === '{' ||
                elemStart === '[' ||
                elemStart === ']' ||
                elemStart === '"' ||
                elemStart === '-' ||
                (elemStart >= '0' && elemStart <= '9')
            }
          } else {
            isRealClose = nextCh === ',' || nextCh === '}' || nextCh === ']'
          }
        }

        if (isRealClose) {
          inString = false
          out += '"'
        } else {
          out += '\\"'
        }
        continue
      }
      out += ch
      continue
    }

    if (ch === '"') {
      inString = true
      stringIsKey = expectKey
      out += '"'
      continue
    }
    if (ch === '{') {
      stack.push('{')
      expectKey = true
      out += ch
      continue
    }
    if (ch === '[') {
      stack.push('[')
      expectKey = false
      out += ch
      continue
    }
    if (ch === '}') {
      if (stack[stack.length - 1] === '{') stack.pop()
      expectKey = false
      out += ch
      continue
    }
    if (ch === ']') {
      if (stack[stack.length - 1] === '[') stack.pop()
      expectKey = false
      out += ch
      continue
    }
    if (ch === ':') {
      expectKey = false
      out += ch
      continue
    }
    if (ch === ',') {
      expectKey = stack[stack.length - 1] === '{'
      out += ch
      continue
    }
    out += ch
  }

  // 若输出因 max-tokens 截断导致字符串或括号未闭合，自动补齐尾部结构
  if (inString) {
    out += '"'
  }
  const withoutTrailingCommas = out.replace(/,\s*([}\]])/g, '$1').replace(/,\s*$/, '')
  let balanced = withoutTrailingCommas
  for (let s = stack.length - 1; s >= 0; s -= 1) {
    balanced += stack[s] === '{' ? '}' : ']'
  }
  return balanced.replace(/,\s*([}\]])/g, '$1')
}

export function repairMalformedToolJson(raw: string): Record<string, unknown> | null {
  const repaired = repairMalformedToolJsonString(raw)
  if (!repaired) return null
  try {
    const parsed = JSON.parse(repaired)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    /* ignore */
  }
  return null
}

/** 归一或修复工具入参对象（供 AgentTool.prepareArguments 兜底） */
export function prepareLooseToolArguments(args: unknown): Record<string, unknown> {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    return args as Record<string, unknown>
  }
  if (typeof args === 'string') {
    return repairMalformedToolJson(args) ?? {}
  }
  return {}
}

/** 识别上游模型额度耗尽 / 余额不足报错，便于界面给出明确引导 */
export function isPiQuotaError(message: string): boolean {
  const text = String(message ?? '').toLowerCase()
  if (!text) return false
  return (
    /\b402\b/.test(text) ||
    text.includes('insufficient balance') ||
    text.includes('insufficient_quota') ||
    text.includes('quota exceeded') ||
    text.includes('billing_hard_limit_reached') ||
    text.includes('credit balance is too low') ||
    text.includes('余额不足') ||
    text.includes('额度不足') ||
    text.includes('欠费')
  )
}
