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
