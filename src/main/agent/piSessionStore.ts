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

/**
 * 过滤掉 `role === 'system'` 的运行时快照消息，只保留真实对话序列（user / assistant / toolResult）。
 * 下次唤醒会话时由新运行轮次按最新模式、最新模型与最新激活工具集重新生成干净的前导 SystemMessage。
 */
export function stripRuntimeSystemMessages(messages: ReadonlyArray<AgentMessage>): AgentMessage[] {
  return messages.filter((m) => m.role !== 'system')
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
      else chars += IMAGE_BLOCK_CHARS_ESTIMATE
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
}

/**
 * 结构化无损配对的上下文自动压缩器：
 * 1) 始终保留 `role === 'system'` 消息不动（维护 `pi-agent-core` 的 `declareToolChanges` 工具差集一致性）；
 * 2) 第一阶段（原位折叠）：保留最近 N 条消息完整不动，将更早历史中的超大 `toolResult`（如 `bash` / `graph_read` 数万字符输出）
 *    与未签名的长思维链原位折叠为摘要，保持全部 `toolCall <-> toolResult` ID 一一配对，绝不触发 400 孤立 tool 错误；
 * 3) 第二阶段（整轮裁剪）：若仍超水位或用户执行 `/compact`，严格按完整 `user` 轮次边界裁剪最早轮次；
 * 4) 自动推进被折叠前缀消息的 `timestamp`，使 `pi-ai` 的 `estimateContextTokens` 立即感知释放出的窗口空间。
 */
export function compactPiContextMessages(
  messages: ReadonlyArray<AgentMessage>,
  opts: CompactPiContextOptions
): AgentMessage[] {
  const contextWindow = Math.max(8_192, opts.contextWindow || 131_072)
  const triggerRatio = opts.triggerRatio ?? 0.78
  const force = Boolean(opts.force)
  const estimated = estimatePiMessagesTokens(messages)

  if (!force && estimated <= Math.floor(contextWindow * triggerRatio)) {
    return [...messages]
  }

  let maxTs = Date.now()
  for (const m of messages) {
    const ts = typeof (m as { timestamp?: number }).timestamp === 'number' ? m.timestamp : 0
    if (ts > maxTs) maxTs = ts
  }
  const bumpTs = maxTs + 1

  const nonSystemIndices: number[] = []
  for (let i = 0; i < messages.length; i += 1) {
    if (messages[i].role !== 'system') nonSystemIndices.push(i)
  }

  const keepRecent = force ? 6 : (opts.keepRecentMessages ?? 10)
  const protectedStartRank = Math.max(0, nonSystemIndices.length - keepRecent)
  const protectedIndexSet = new Set(nonSystemIndices.slice(protectedStartRank))

  let compactedAny = false
  const working: AgentMessage[] = messages.map((msg, idx) => {
    if (msg.role === 'system' || protectedIndexSet.has(idx)) return msg

    if (msg.role === 'toolResult' && Array.isArray(msg.content)) {
      let localChanged = false
      const nextContent = msg.content.map((block) => {
        if (block.type === 'image') {
          localChanged = true
          return { type: 'text' as const, text: '[历史工具图片已自动折叠]' }
        }
        if (block.type === 'text' && block.text.length > 1_200) {
          localChanged = true
          const omitted = block.text.length - 1_000
          return {
            type: 'text' as const,
            text: `${block.text.slice(0, 600)}\n...[历史工具输出已自动折叠 ${omitted} 字符]...\n${block.text.slice(-400)}`
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

  // 若单轮包含极大量连续工具调用，做二次紧凑折叠（压缩至 220 字符摘要）
  if (!force && estimateCharOnlyTokens(working) > Math.floor(contextWindow * 0.84)) {
    for (let i = 0; i < working.length; i += 1) {
      if (protectedIndexSet.has(i)) continue
      const msg = working[i]
      if (msg.role === 'toolResult' && Array.isArray(msg.content)) {
        const combined = extractMessageText(msg)
        if (combined.length > 260) {
          compactedAny = true
          working[i] = {
            ...msg,
            content: [
              {
                type: 'text',
                text: `[历史工具输出已深度折叠 (${combined.length} 字符)] ${combined.slice(0, 200)}...`
              }
            ],
            timestamp: bumpTs
          }
        }
      }
    }
  }

  // 若强制 /compact 或仍超硬水位，按完整 user 轮次边界整组淘汰最早对话（绝不拆散 assistant.toolCall 与 toolResult）
  const hardCeiling = Math.floor(contextWindow * 0.85)
  if (force || estimateCharOnlyTokens(working) > hardCeiling) {
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
    // 清理可能残留在首条 user 之前的孤立非 user 片段
    if (groups.length > 1 && working[groups[0][0]]?.role !== 'user') {
      for (const idx of groups.shift()!) droppedIndices.add(idx)
    }

    const minKeepGroups = force ? 3 : 2
    while (groups.length > minKeepGroups) {
      const remainingChars = working.reduce(
        (acc, m, idx) => (droppedIndices.has(idx) ? acc : acc + estimateSingleMessageChars(m)),
        0
      )
      const remainingTokens = Math.ceil(remainingChars / CHARS_PER_TOKEN_ESTIMATE)
      if (!force && remainingTokens <= Math.floor(contextWindow * 0.78)) break
      const oldest = groups.shift()!
      for (const idx of oldest) droppedIndices.add(idx)
    }

    if (droppedIndices.size > 0) {
      compactedAny = true
      const pruned = working.filter((_, idx) => !droppedIndices.has(idx))
      if (pruned.length > 0) {
        pruned[0] = { ...pruned[0], timestamp: bumpTs }
      }
      return pruned
    }
  }

  // 一旦发生任何前缀压缩，必须推进队列首条消息（index 0）的 timestamp，
  // 使 pi-ai 的 getLastAssistantUsageInfo 从 i=0 起就识别到前缀已更新，避免沿用压缩前的旧 totalTokens
  if (compactedAny && working.length > 0) {
    working[0] = { ...working[0], timestamp: bumpTs }
  }

  return working
}
