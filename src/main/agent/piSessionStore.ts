import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { capSingleToolText, SINGLE_TOOL_TEXT_MAX_CHARS } from './piPayloadGuard'
import type {
  HarnessGoalView,
  HarnessSessionSearchHit,
  HarnessTodoItem,
  RewindHarnessSessionInput,
  RewindHarnessSessionResult,
  SearchHarnessSessionsInput,
  SearchHarnessSessionsResult
} from '@shared/ipc'

export interface PersistedPiSession {
  version: 1
  sessionId: string
  title?: string
  cwd?: string
  createdAt: string
  updatedAt: string
  loadedToolsets: string[]
  todos: HarnessTodoItem[]
  goal: HarnessGoalView | null
  /** 仅持久化对话体（user / assistant / toolResult），不含临时 system 快照，保证切模型/切模式无历史残留 */
  messages: AgentMessage[]
}

const PI_SESSIONS_SUBDIR = 'pi-sessions'

export function sanitizeSessionId(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 120)
}

export function piSessionsDir(baseDir: string): string {
  return join(baseDir, PI_SESSIONS_SUBDIR)
}

function sessionFilePath(baseDir: string, sessionId: string): string {
  const safe = sanitizeSessionId(sessionId)
  if (!safe) throw new Error('Invalid sessionId')
  return join(piSessionsDir(baseDir), `${safe}.json`)
}

function extractMessageText(msg: AgentMessage): string {
  if (!msg || typeof msg !== 'object') return ''
  const content = (msg as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>
    if (b.type === 'text' && typeof b.text === 'string') {
      parts.push(b.text)
    }
  }
  return parts.join('\n')
}

function deriveSessionTitle(messages: ReadonlyArray<AgentMessage>): string | undefined {
  for (const msg of messages) {
    if (msg.role === 'user') {
      const text = extractMessageText(msg).trim()
      if (text) {
        // 剥离注入的系统附加上下文头，提取真实用户首句
        const cleaned = text
          .replace(/^\[Workspace Canvas & Node Context\][\s\S]*?\n\n/i, '')
          .replace(/^\[Chat Session Scope & Project Directory Context\][\s\S]*?\n\n/i, '')
          .trim()
        const firstLine = (cleaned || text).split(/\r?\n/)[0]?.trim()
        if (firstLine) return firstLine.slice(0, 80)
      }
    }
  }
  return undefined
}

function isEmptyFailedAssistantMessage(msg: AgentMessage): boolean {
  if (!msg || msg.role !== 'assistant') return false
  if (msg.stopReason !== 'error' && msg.stopReason !== 'aborted') return false
  if (!Array.isArray(msg.content) || msg.content.length === 0) return true
  const hasToolCall = msg.content.some((b) => b.type === 'toolCall')
  if (hasToolCall) return false
  const hasText = msg.content.some(
    (b) => b.type === 'text' && typeof b.text === 'string' && b.text.trim().length > 0
  )
  return !hasText
}

/**
 * 过滤掉 `role === 'system'` 的运行时快照消息，以及因上游瞬时报错/中止残留的空壳 `assistant` 错误帧，
 * 只保留有效对话序列（user / assistant / toolResult）。
 * 下次唤醒会话时由新运行轮次按最新模式、最新模型与最新激活工具集重新生成干净的前导 SystemMessage。
 */
export function stripRuntimeSystemMessages(messages: ReadonlyArray<AgentMessage>): AgentMessage[] {
  return messages.filter((m) => m.role !== 'system' && !isEmptyFailedAssistantMessage(m))
}

export function loadPiSession(baseDir: string, sessionId: string): PersistedPiSession | null {
  const safe = sanitizeSessionId(sessionId)
  if (!safe) return null
  const filePath = sessionFilePath(baseDir, safe)
  if (!existsSync(filePath)) return null
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<PersistedPiSession>
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.messages)) return null
    return {
      version: 1,
      sessionId: raw.sessionId || sessionId,
      title: raw.title,
      cwd: raw.cwd,
      createdAt: raw.createdAt || new Date().toISOString(),
      updatedAt: raw.updatedAt || new Date().toISOString(),
      loadedToolsets: Array.isArray(raw.loadedToolsets)
        ? raw.loadedToolsets.filter((x): x is string => typeof x === 'string')
        : [],
      todos: Array.isArray(raw.todos) ? raw.todos : [],
      goal: raw.goal ?? null,
      messages: stripRuntimeSystemMessages(raw.messages)
    }
  } catch {
    return null
  }
}

/**
 * 零文件锁原子落盘：先写临时文件再覆盖，随时允许中途切换任意供应商/模型而绝不占用文件句柄。
 */
export function savePiSession(
  baseDir: string,
  input: {
    sessionId: string
    cwd?: string
    loadedToolsets?: string[]
    todos?: HarnessTodoItem[]
    goal?: HarnessGoalView | null
    messages: ReadonlyArray<AgentMessage>
  }
): PersistedPiSession {
  const safe = sanitizeSessionId(input.sessionId)
  if (!safe) throw new Error('sessionId is required')
  const dir = piSessionsDir(baseDir)
  mkdirSync(dir, { recursive: true })

  const existing = loadPiSession(baseDir, input.sessionId)
  const nowIso = new Date().toISOString()
  const cleanMessages = stripRuntimeSystemMessages(input.messages)

  const record: PersistedPiSession = {
    version: 1,
    sessionId: input.sessionId,
    title: existing?.title ?? deriveSessionTitle(cleanMessages),
    cwd: input.cwd ?? existing?.cwd,
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
    loadedToolsets: input.loadedToolsets ?? existing?.loadedToolsets ?? [],
    todos: input.todos ?? existing?.todos ?? [],
    goal: input.goal !== undefined ? input.goal : (existing?.goal ?? null),
    messages: cleanMessages
  }

  const targetPath = sessionFilePath(baseDir, safe)
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`
  const serialized = JSON.stringify(record, null, 2)
  writeFileSync(tempPath, serialized, 'utf8')
  try {
    renameSync(tempPath, targetPath)
  } catch {
    writeFileSync(targetPath, serialized, 'utf8')
    rmSync(tempPath, { force: true })
  }
  return record
}

export function deletePiSession(baseDir: string, sessionId: string): boolean {
  const safe = sanitizeSessionId(sessionId)
  if (!safe) return false
  let removed = false
  const targetPath = sessionFilePath(baseDir, safe)
  if (existsSync(targetPath)) {
    rmSync(targetPath, { force: true })
    removed = true
  }
  // 顺带清理同目录下可能存在的旧版孤立文件
  const legacyDir = join(baseDir, 'sessions')
  if (existsSync(legacyDir)) {
    try {
      for (const name of readdirSync(legacyDir)) {
        if (name === safe || name.startsWith(`${safe}.`)) {
          rmSync(join(legacyDir, name), { recursive: true, force: true })
          removed = true
        }
      }
    } catch {
      /* ignore */
    }
  }
  return removed
}

/**
 * 按已完成用户轮次数截断（Rewind）或分叉（Fork）持久化会话。
 */
export function rewindPiSession(
  baseDir: string,
  input: RewindHarnessSessionInput
): RewindHarnessSessionResult {
  const sourceId = String(input?.sessionId ?? '').trim()
  if (!sourceId) return { ok: false, error: 'sessionId 不能为空' }

  const targetId =
    String(input.forkSessionId ?? input.targetSessionId ?? '').trim() ||
    (input.fork ? `${sourceId}-fork-${Date.now().toString(36)}` : sourceId)

  const existing = loadPiSession(baseDir, sourceId)
  const rawKeep =
    typeof input.keepTurns === 'number'
      ? input.keepTurns
      : typeof input.userTurnIndex === 'number'
        ? input.userTurnIndex
        : 0
  const keepTurns = Math.max(0, Math.trunc(rawKeep))

  if (!existing) {
    if (keepTurns === 0) {
      savePiSession(baseDir, { sessionId: targetId, messages: [] })
      return { ok: true, sessionId: targetId, keptEvents: 0 }
    }
    return { ok: false, error: `未找到会话记录：${sourceId}` }
  }

  let keptMessages: AgentMessage[] = []
  if (keepTurns > 0) {
    let seenUserTurns = 0
    for (const msg of existing.messages) {
      if (msg.role === 'user') {
        seenUserTurns += 1
        if (seenUserTurns > keepTurns) {
          break
        }
      }
      keptMessages.push(msg)
    }
  } else {
    keptMessages = []
  }

  savePiSession(baseDir, {
    sessionId: targetId,
    cwd: existing.cwd,
    loadedToolsets: existing.loadedToolsets,
    todos: keepTurns === 0 ? [] : existing.todos,
    goal: keepTurns === 0 ? null : existing.goal,
    messages: keptMessages
  })

  return {
    ok: true,
    sessionId: targetId,
    keptEvents: keptMessages.length
  }
}

/**
 * 跨全部持久化会话执行快速全文检索（无需 SQLite 原生模块或文件锁）。
 */
export function searchPiSessions(
  baseDir: string,
  input: SearchHarnessSessionsInput
): SearchHarnessSessionsResult {
  const query = String(input?.query ?? '').trim()
  if (!query) return { ok: true, hits: [] }

  const dir = piSessionsDir(baseDir)
  if (!existsSync(dir)) return { ok: true, hits: [] }

  const limit = Math.min(100, Math.max(1, Math.trunc(Number(input.limit ?? 30) || 30)))
  const lowerQuery = query.toLowerCase()
  const tokens = lowerQuery.split(/\s+/).filter(Boolean)

  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  } catch {
    return { ok: true, hits: [] }
  }

  const hits: Array<HarnessSessionSearchHit & { sortTime: number }> = []

  for (const file of files) {
    const fullPath = join(dir, file)
    let mtimeMs = 0
    try {
      mtimeMs = statSync(fullPath).mtimeMs
    } catch {
      continue
    }
    let session: PersistedPiSession | null = null
    try {
      session = JSON.parse(readFileSync(fullPath, 'utf8')) as PersistedPiSession
    } catch {
      continue
    }
    if (!session || !Array.isArray(session.messages)) continue

    let matchCount = 0
    let bestSnippet = ''
    let matchedRole: 'user' | 'assistant' = 'user'
    let matchedSeq = 0

    session.messages.forEach((msg, idx) => {
      if (msg.role !== 'user' && msg.role !== 'assistant') return
      const text = extractMessageText(msg)
      if (!text) return
      const lower = text.toLowerCase()
      const hitAllTokens = tokens.every((tok) => lower.includes(tok))
      if (!hitAllTokens && !lower.includes(lowerQuery)) return
      matchCount += 1
      if (!bestSnippet) {
        const pos = lower.indexOf(tokens[0] ?? lowerQuery)
        const start = Math.max(0, pos - 48)
        const end = Math.min(text.length, pos + 132)
        bestSnippet = `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`
        matchedRole = msg.role
        matchedSeq = idx
      }
    })

    if (matchCount > 0) {
      hits.push({
        sessionId: session.sessionId,
        title: session.title,
        snippet: bestSnippet,
        seq: matchedSeq,
        timestamp: session.updatedAt,
        updatedAt: session.updatedAt,
        role: matchedRole,
        cwd: session.cwd,
        matchCount,
        sortTime: Date.parse(session.updatedAt || '') || mtimeMs
      })
    }
  }

  hits.sort((a, b) =>
    b.sortTime !== a.sortTime ? b.sortTime - a.sortTime : (b.matchCount ?? 0) - (a.matchCount ?? 0)
  )
  return {
    ok: true,
    hits: hits.slice(0, limit).map(({ sortTime: _ignored, ...rest }) => rest)
  }
}

/**
 * 将指定会话打包为包含可读 Markdown 对话稿与完整 JSON 消息树的 `.zip` Buffer。
 */
export async function buildPiSessionExportZip(
  baseDir: string,
  sessionId: string
): Promise<{ buffer: Buffer; fileCount: number } | null> {
  const session = loadPiSession(baseDir, sessionId)
  if (!session) return null

  const zip = new JSZip()
  zip.file('session.json', JSON.stringify(session, null, 2))

  const mdLines: string[] = [
    `# Session Export: ${session.title || session.sessionId}`,
    '',
    `- **Session ID**: \`${session.sessionId}\``,
    `- **Created At**: ${session.createdAt}`,
    `- **Updated At**: ${session.updatedAt}`,
    ...(session.cwd ? [`- **Workspace**: \`${session.cwd}\``] : []),
    '',
    '---',
    ''
  ]

  for (const msg of session.messages) {
    if (msg.role === 'user') {
      mdLines.push('## User', '', extractMessageText(msg) || '*(image/media)*', '')
    } else if (msg.role === 'assistant') {
      mdLines.push('## Assistant', '')
      for (const block of msg.content) {
        if (block.type === 'thinking' && block.thinking) {
          mdLines.push(
            '<details><summary>Reasoning</summary>',
            '',
            block.thinking,
            '',
            '</details>',
            ''
          )
        } else if (block.type === 'text' && block.text) {
          mdLines.push(block.text, '')
        } else if (block.type === 'toolCall') {
          mdLines.push(
            `- **Tool Call** \`${block.name}\`: \`${JSON.stringify(block.arguments)}\``,
            ''
          )
        }
      }
    } else if (msg.role === 'toolResult') {
      const preview = extractMessageText(msg).slice(0, 1200)
      mdLines.push(
        `### Tool Result (\`${msg.toolName}\`)${msg.isError ? ' [ERROR]' : ''}`,
        '',
        '```',
        preview,
        '```',
        ''
      )
    }
  }

  zip.file('transcript.md', mdLines.join('\n'))
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  return { buffer, fileCount: 2 }
}

const CHARS_PER_TOKEN_ESTIMATE = 3.5
const IMAGE_BLOCK_CHARS_ESTIMATE = 4_800
/** 单次发往网关的纯文本 UTF-8 字节安全上限（3.6 MB，远低于各大网关 8 MB 硬红线，为 systemPrompt 与工具定义预留充足余量） */
export const DEFAULT_MAX_CONTEXT_TEXT_BYTES = 3_600_000
/** 单次发往网关的总消息体（文本 + base64 图片）安全上限（5.2 MB） */
export const DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES = 5_200_000

export interface PiPayloadByteEstimate {
  textBytes: number
  imageBytes: number
  totalBytes: number
}

function estimateSingleMessagePayloadBytes(msg: AgentMessage): PiPayloadByteEstimate {
  if (!msg || typeof msg !== 'object') return { textBytes: 0, imageBytes: 0, totalBytes: 0 }
  let textBytes = 0
  let imageBytes = 0

  if (msg.role === 'system') {
    const sys = msg as unknown as {
      content?: unknown
      toolsAdded?: unknown[]
      toolsRemoved?: unknown[]
    }
    if (typeof sys.content === 'string') textBytes += Buffer.byteLength(sys.content, 'utf8')
    if (Array.isArray(sys.toolsAdded)) {
      textBytes += Buffer.byteLength(JSON.stringify(sys.toolsAdded), 'utf8')
    }
    if (Array.isArray(sys.toolsRemoved)) {
      textBytes += Buffer.byteLength(JSON.stringify(sys.toolsRemoved), 'utf8')
    }
    return { textBytes, imageBytes: 0, totalBytes: textBytes }
  }

  if (msg.role === 'user' || msg.role === 'toolResult') {
    const content = msg.content
    if (typeof content === 'string') {
      textBytes += Buffer.byteLength(content, 'utf8')
    } else if (Array.isArray(content)) {
      for (const b of content) {
        if (b.type === 'text') {
          textBytes += Buffer.byteLength(b.text || '', 'utf8')
        } else if (b.type === 'image') {
          imageBytes += typeof b.data === 'string' ? b.data.length : 0
        }
      }
    }
    return { textBytes, imageBytes, totalBytes: textBytes + imageBytes }
  }

  if (msg.role === 'assistant' && Array.isArray(msg.content)) {
    for (const b of msg.content) {
      if (b.type === 'text') textBytes += Buffer.byteLength(b.text || '', 'utf8')
      else if (b.type === 'thinking') textBytes += Buffer.byteLength(b.thinking || '', 'utf8')
      else if (b.type === 'toolCall') {
        textBytes +=
          Buffer.byteLength(b.name || '', 'utf8') +
          Buffer.byteLength(JSON.stringify(b.arguments ?? {}), 'utf8')
      }
    }
    return { textBytes, imageBytes: 0, totalBytes: textBytes }
  }

  return { textBytes: 0, imageBytes: 0, totalBytes: 0 }
}

/**
 * 精确统计当前消息序列占用的 UTF-8 文本字节数与 base64 图片字节数，
 * 直接防护 `The total text input size exceeds 8 MB` 与 HTTP 413 Request Entity Too Large。
 */
export function estimatePiMessagesPayloadBytes(
  messages: ReadonlyArray<AgentMessage>
): PiPayloadByteEstimate {
  let textBytes = 0
  let imageBytes = 0
  for (const m of messages) {
    const single = estimateSingleMessagePayloadBytes(m)
    textBytes += single.textBytes
    imageBytes += single.imageBytes
  }
  return { textBytes, imageBytes, totalBytes: textBytes + imageBytes }
}

function estimateSingleMessageChars(msg: AgentMessage): number {
  if (!msg || typeof msg !== 'object') return 0
  if (msg.role === 'system') {
    const sys = msg as unknown as {
      content?: unknown
      toolsAdded?: unknown[]
      toolsRemoved?: unknown[]
    }
    const textLen = typeof sys.content === 'string' ? sys.content.length : 0
    const addedLen = Array.isArray(sys.toolsAdded) ? JSON.stringify(sys.toolsAdded).length : 0
    const removedLen = Array.isArray(sys.toolsRemoved) ? JSON.stringify(sys.toolsRemoved).length : 0
    return textLen + addedLen + removedLen
  }
  if (msg.role === 'user' || msg.role === 'toolResult') {
    const content = msg.content
    if (typeof content === 'string') return content.length
    if (!Array.isArray(content)) return 0
    let chars = 0
    for (const b of content) {
      if (b.type === 'text') chars += b.text.length
      else {
        const b64Len = typeof b.data === 'string' ? b.data.length : 0
        chars += Math.max(IMAGE_BLOCK_CHARS_ESTIMATE, Math.ceil(b64Len / 64))
      }
    }
    return chars
  }
  if (msg.role === 'assistant' && Array.isArray(msg.content)) {
    let chars = 0
    for (const b of msg.content) {
      if (b.type === 'text') chars += b.text.length
      else if (b.type === 'thinking') chars += b.thinking.length
      else if (b.type === 'toolCall') {
        chars += b.name.length + JSON.stringify(b.arguments ?? {}).length
      }
    }
    return chars
  }
  return 0
}

function estimateCharOnlyTokens(messages: ReadonlyArray<AgentMessage>): number {
  let tokens = 0
  for (const m of messages) {
    tokens += Math.ceil(estimateSingleMessageChars(m) / CHARS_PER_TOKEN_ESTIMATE)
  }
  return tokens
}

/**
 * 估算当前消息队列占用的上下文 Token 数（对齐 `@earendil-works/pi-ai` 的 `estimateContextTokens` 口径）：
 * 若存在未被前缀压缩失效的最近一轮 `assistant.usage`，优先以其真实 Token 用量为基准叠加后续增量；否则按字符数估算。
 */
export function estimatePiMessagesTokens(messages: ReadonlyArray<AgentMessage>): number {
  let latestPrefixTs = Number.NEGATIVE_INFINITY
  let usageInfo: { tokens: number; index: number } | null = null

  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i]
    const ts = typeof (m as { timestamp?: number }).timestamp === 'number' ? m.timestamp : 0
    if (m.role === 'assistant') {
      const u = m.usage
      const total = u ? u.totalTokens || u.input + u.output + u.cacheRead + u.cacheWrite : 0
      if (
        ts >= latestPrefixTs &&
        m.stopReason !== 'aborted' &&
        m.stopReason !== 'error' &&
        total > 0
      ) {
        usageInfo = { tokens: total, index: i }
      }
    }
    if (ts > latestPrefixTs) latestPrefixTs = ts
  }

  if (usageInfo) {
    let trailing = 0
    for (let i = usageInfo.index + 1; i < messages.length; i += 1) {
      trailing += Math.ceil(estimateSingleMessageChars(messages[i]) / CHARS_PER_TOKEN_ESTIMATE)
    }
    return usageInfo.tokens + trailing
  }

  return estimateCharOnlyTokens(messages)
}

export interface CompactPiContextOptions {
  /** 当前模型上下文窗口大小（token） */
  contextWindow: number
  /** 触发自动软压缩的水位比例（默认 0.78） */
  triggerRatio?: number
  /** 软压缩时完整保留末尾多少条非 system 消息不折叠（默认 10） */
  keepRecentMessages?: number
  /** 强制压缩（用于用户主动执行 `/compact` 或上游返回上下文超限错误后的重试） */
  force?: boolean
  /** 紧急降压等级（0=常规，1=首轮超限自愈，2=深度超限自愈，3=极限单轮自愈） */
  emergencyLevel?: 0 | 1 | 2 | 3
  /** 纯文本字节安全上限（默认 3.6 MB，防 8 MB text limit 400） */
  maxTextBytes?: number
  /** 总载荷字节安全上限（默认 5.2 MB，防多张高清 base64 图片撑爆请求体） */
  maxTotalPayloadBytes?: number
}

function messageContainsOversizedOrBinaryToolText(msg: AgentMessage, capChars: number): boolean {
  if (msg.role !== 'toolResult' || !Array.isArray(msg.content)) return false
  for (const b of msg.content) {
    if (b.type === 'text' && typeof b.text === 'string') {
      if (
        b.text.length > capChars ||
        b.text.includes('\uFFFDPNG') ||
        b.text.includes('\\u0000\\u0000')
      ) {
        return true
      }
    }
  }
  return false
}

function countImageBearingMessages(messages: ReadonlyArray<AgentMessage>): number[] {
  const indices: number[] = []
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i]
    if ((m.role === 'toolResult' || m.role === 'user') && Array.isArray(m.content)) {
      if (m.content.some((b) => b.type === 'image')) {
        indices.push(i)
      }
    }
  }
  return indices
}

/**
 * 结构化无损配对的上下文与字节双水位自动压缩器：
 * 1) 始终保留 `role === 'system'` 消息不动（维护 `pi-agent-core` 的 `declareToolChanges` 工具差集一致性），并自动剔除空壳报错帧；
 * 2) 零阶段（近期巨型载荷守卫）：即便在受保护的最近消息窗口内，若出现单条 >140K 字符或夹带 PNG 二进制乱码的 `toolResult`
 *    （如旧版 `graph_read` 遗留的 13 MB JSON），也会原位清洗并限制长度，彻底治愈已损坏的持久化会话；
 * 3) 第一阶段（原位折叠）：将较早历史中的超大 `toolResult`、历史视觉图片与未签名的长思维链原位折叠为摘要，保持全部 `toolCall <-> toolResult` ID 100% 配对；
 * 4) 第二阶段（整轮裁剪 + 单轮内紧急瘦身）：若仍超 Token 水位或超字节安全上限（3.6 MB 文本 / 5.2 MB 总载荷），严格按完整 `user` 轮次边界淘汰早期轮次，必要时进一步压缩单轮内早期工具输出；
 * 5) 自动推进被折叠前缀消息的 `timestamp`，使 `pi-ai` 的 `estimateContextTokens` 立即感知释放出的窗口空间。
 */
export function compactPiContextMessages(
  messages: ReadonlyArray<AgentMessage>,
  opts: CompactPiContextOptions
): AgentMessage[] {
  const contextWindow = Math.max(8_192, opts.contextWindow || 131_072)
  const triggerRatio = opts.triggerRatio ?? 0.78
  const emergencyLevel = opts.emergencyLevel ?? 0
  const force = Boolean(opts.force) || emergencyLevel > 0
  const maxTextBytes = Math.max(256_000, opts.maxTextBytes ?? DEFAULT_MAX_CONTEXT_TEXT_BYTES)
  const maxTotalBytes = Math.max(
    maxTextBytes,
    opts.maxTotalPayloadBytes ?? DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES
  )

  const recentToolCapChars =
    emergencyLevel >= 3
      ? 2_400
      : emergencyLevel === 2
        ? 10_000
        : force
          ? 36_000
          : SINGLE_TOOL_TEXT_MAX_CHARS

  const hasDeadFailedFrame = messages.some((m) => isEmptyFailedAssistantMessage(m))
  const baseMessages = hasDeadFailedFrame
    ? messages.filter((m) => !isEmptyFailedAssistantMessage(m))
    : messages

  const estimated = estimatePiMessagesTokens(baseMessages)
  const initialBytes = estimatePiMessagesPayloadBytes(baseMessages)
  const hasCorruptOrOversizedRecent = baseMessages.some((m) =>
    messageContainsOversizedOrBinaryToolText(m, recentToolCapChars)
  )
  const exceedsByteBudget =
    initialBytes.textBytes > maxTextBytes || initialBytes.totalBytes > maxTotalBytes

  if (
    !force &&
    !hasDeadFailedFrame &&
    !hasCorruptOrOversizedRecent &&
    !exceedsByteBudget &&
    estimated <= Math.floor(contextWindow * triggerRatio)
  ) {
    return [...baseMessages]
  }

  let maxTs = Date.now()
  for (const m of baseMessages) {
    const ts = typeof (m as { timestamp?: number }).timestamp === 'number' ? m.timestamp : 0
    if (ts > maxTs) maxTs = ts
  }
  const bumpTs = maxTs + 1

  const nonSystemIndices: number[] = []
  for (let i = 0; i < baseMessages.length; i += 1) {
    if (baseMessages[i].role !== 'system') nonSystemIndices.push(i)
  }

  const keepRecent =
    emergencyLevel >= 3 ? 2 : emergencyLevel === 2 ? 4 : force ? 6 : (opts.keepRecentMessages ?? 10)
  const protectedStartRank = Math.max(0, nonSystemIndices.length - keepRecent)
  const protectedIndexSet = new Set(nonSystemIndices.slice(protectedStartRank))

  // 计算允许保留原图的最近消息集合（常规超字节时最多保留最近 2 条含图消息；emergencyLevel>=2 保留最近 1 条；>=3 全部折叠）
  const imgMsgIndices = countImageBearingMessages(baseMessages)
  const maxKeepImageMsgs =
    emergencyLevel >= 3
      ? 0
      : emergencyLevel === 2
        ? 1
        : exceedsByteBudget || force
          ? 2
          : imgMsgIndices.length
  const allowedImageMsgSet = new Set(
    maxKeepImageMsgs > 0 ? imgMsgIndices.slice(-maxKeepImageMsgs) : []
  )

  let compactedAny = hasDeadFailedFrame
  const working: AgentMessage[] = baseMessages.map((msg, idx) => {
    if (msg.role === 'system') return msg

    if (protectedIndexSet.has(idx)) {
      // 即便在近期保护窗口内，也必须清洗超长/乱码 toolResult 与超额历史图片，防止单轮大产物锁死 8 MB 上限
      if ((msg.role === 'toolResult' || msg.role === 'user') && Array.isArray(msg.content)) {
        let recentChanged = false
        const nextContent = msg.content.map((block) => {
          if (block.type === 'image' && !allowedImageMsgSet.has(idx)) {
            recentChanged = true
            return { type: 'text' as const, text: '[较早视觉自检图片已自动折叠以释放载荷空间]' }
          }
          if (
            msg.role === 'toolResult' &&
            block.type === 'text' &&
            (block.text.length > recentToolCapChars ||
              block.text.includes('\uFFFDPNG') ||
              block.text.includes('\\u0000\\u0000') ||
              block.text.includes(';base64,'))
          ) {
            const cleaned = capSingleToolText(block.text, recentToolCapChars)
            if (cleaned !== block.text) {
              recentChanged = true
              return { type: 'text' as const, text: cleaned }
            }
          }
          return block
        })
        if (recentChanged) {
          compactedAny = true
          return { ...msg, content: nextContent, timestamp: bumpTs }
        }
      }
      return msg
    }

    if (msg.role === 'toolResult' && Array.isArray(msg.content)) {
      let localChanged = false
      const nextContent = msg.content.map((block) => {
        if (block.type === 'image') {
          localChanged = true
          return { type: 'text' as const, text: '[历史工具图片已自动折叠]' }
        }
        if (block.type === 'text') {
          const cleaned = capSingleToolText(block.text, 1_200)
          if (block.text.length > 1_200) {
            localChanged = true
            const omitted = Math.max(0, block.text.length - 1_000)
            return {
              type: 'text' as const,
              text: `${cleaned.slice(0, 600)}\n...[历史工具输出已自动折叠 ${omitted} 字符]...\n${cleaned.slice(-400)}`
            }
          }
          if (cleaned !== block.text) {
            localChanged = true
            return { type: 'text' as const, text: cleaned }
          }
        }
        return block
      })
      if (localChanged) {
        compactedAny = true
        return { ...msg, content: nextContent, timestamp: bumpTs }
      }
      return msg
    }

    if (msg.role === 'user' && Array.isArray(msg.content) && !allowedImageMsgSet.has(idx)) {
      let localChanged = false
      const nextContent = msg.content.map((block) => {
        if (block.type === 'image') {
          localChanged = true
          return { type: 'text' as const, text: '[早期用户附图已自动折叠]' }
        }
        return block
      })
      if (localChanged) {
        compactedAny = true
        return { ...msg, content: nextContent, timestamp: bumpTs }
      }
    }

    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      let localChanged = false
      const nextContent = msg.content.map((block) => {
        if (block.type === 'thinking' && !block.thinkingSignature && block.thinking.length > 600) {
          localChanged = true
          return { ...block, thinking: `${block.thinking.slice(0, 300)}...` }
        }
        return block
      })
      if (localChanged) {
        compactedAny = true
        return { ...msg, content: nextContent }
      }
    }

    return msg
  })

  const isStillOverBudget = (list: ReadonlyArray<AgentMessage>): boolean => {
    const b = estimatePiMessagesPayloadBytes(list)
    if (b.textBytes > maxTextBytes || b.totalBytes > maxTotalBytes) return true
    return estimateCharOnlyTokens(list) > Math.floor(contextWindow * 0.84)
  }

  // 若单轮包含极大量连续工具调用或仍超字节预算，做二次紧凑折叠（压缩至 220 字符摘要）
  if (isStillOverBudget(working)) {
    for (let i = 0; i < working.length; i += 1) {
      if (protectedIndexSet.has(i) && emergencyLevel < 2) continue
      const msg = working[i]
      if (msg.role === 'toolResult' && Array.isArray(msg.content)) {
        const combined = extractMessageText(msg)
        if (combined.length > 260 || msg.content.some((b) => b.type === 'image')) {
          compactedAny = true
          working[i] = {
            ...msg,
            content: [
              {
                type: 'text',
                text: `[历史工具输出已深度折叠 (${combined.length} 字符)] ${capSingleToolText(combined, 1_000).slice(0, 200)}...`
              }
            ],
            timestamp: bumpTs
          }
        }
      }
    }
  }

  // 若强制 /compact 或仍超硬水位/字节上限，按完整 user 轮次边界整组淘汰最早对话（绝不拆散 assistant.toolCall 与 toolResult）
  const hardCeiling = Math.floor(contextWindow * 0.85)
  const overHardOrBytes = (): boolean => {
    const b = estimatePiMessagesPayloadBytes(working)
    return (
      b.textBytes > maxTextBytes ||
      b.totalBytes > maxTotalBytes ||
      estimateCharOnlyTokens(working) > hardCeiling
    )
  }

  let resultList = working
  if (force || overHardOrBytes()) {
    const groups: number[][] = []
    let currentGroup: number[] = []
    for (let i = 0; i < working.length; i += 1) {
      if (working[i].role === 'system') continue
      if (working[i].role === 'user') {
        if (currentGroup.length > 0) groups.push(currentGroup)
        currentGroup = [i]
      } else {
        currentGroup.push(i)
      }
    }
    if (currentGroup.length > 0) groups.push(currentGroup)

    const droppedIndices = new Set<number>()
    if (groups.length > 1 && working[groups[0][0]]?.role !== 'user') {
      for (const idx of groups.shift()!) droppedIndices.add(idx)
    }

    const baseMinKeepGroups = emergencyLevel >= 2 ? 1 : emergencyLevel === 1 ? 2 : force ? 3 : 2
    while (groups.length > baseMinKeepGroups) {
      const remaining = working.filter((_, idx) => !droppedIndices.has(idx))
      const remBytes = estimatePiMessagesPayloadBytes(remaining)
      const remTokens = estimateCharOnlyTokens(remaining)
      if (
        !force &&
        remTokens <= Math.floor(contextWindow * 0.78) &&
        remBytes.textBytes <= maxTextBytes &&
        remBytes.totalBytes <= maxTotalBytes
      ) {
        break
      }
      const oldest = groups.shift()!
      for (const idx of oldest) droppedIndices.add(idx)
    }

    // 若保留 2~3 组后依然超出字节或 Token 硬上限，继续降级淘汰到仅保留最后 1 个完整 user 轮次
    while (groups.length > 1) {
      const remaining = working.filter((_, idx) => !droppedIndices.has(idx))
      const remBytes = estimatePiMessagesPayloadBytes(remaining)
      const remTokens = estimateCharOnlyTokens(remaining)
      if (
        remBytes.textBytes <= maxTextBytes &&
        remBytes.totalBytes <= maxTotalBytes &&
        remTokens <= hardCeiling
      ) {
        break
      }
      const oldest = groups.shift()!
      for (const idx of oldest) droppedIndices.add(idx)
    }

    if (droppedIndices.size > 0) {
      compactedAny = true
      resultList = working.filter((_, idx) => !droppedIndices.has(idx))
    }
  }

  // 终极兜底：若最后一个单独 user 轮次内部因超多连续图片或超大 user 提示词仍超字节上限，逐条收缩最早的图片/工具文本
  let finalBytes = estimatePiMessagesPayloadBytes(resultList)
  if (finalBytes.textBytes > maxTextBytes || finalBytes.totalBytes > maxTotalBytes) {
    resultList = [...resultList]
    for (let i = 0; i < resultList.length; i += 1) {
      if (finalBytes.textBytes <= maxTextBytes && finalBytes.totalBytes <= maxTotalBytes) break
      const msg = resultList[i]
      if (msg.role === 'toolResult' && Array.isArray(msg.content)) {
        const preview = capSingleToolText(extractMessageText(msg), 600).slice(0, 240)
        resultList[i] = {
          ...msg,
          content: [{ type: 'text', text: `[紧急载荷瘦身：${preview}]` }],
          timestamp: bumpTs
        }
        compactedAny = true
        finalBytes = estimatePiMessagesPayloadBytes(resultList)
      } else if (msg.role === 'user' && Array.isArray(msg.content)) {
        const hasImg = msg.content.some((b) => b.type === 'image')
        if (hasImg) {
          resultList[i] = {
            ...msg,
            content: msg.content.map((b) =>
              b.type === 'image' ? { type: 'text' as const, text: '[附图已紧急折叠]' } : b
            ),
            timestamp: bumpTs
          }
          compactedAny = true
          finalBytes = estimatePiMessagesPayloadBytes(resultList)
        }
      }
    }
  }

  // 一旦发生任何前缀压缩，必须推进队列首条消息（index 0）的 timestamp，
  // 使 pi-ai 的 getLastAssistantUsageInfo 从 i=0 起就识别到前缀已更新，避免沿用压缩前的旧 totalTokens
  if (compactedAny && resultList.length > 0) {
    resultList[0] = { ...resultList[0], timestamp: bumpTs }
  }

  return resultList
}
