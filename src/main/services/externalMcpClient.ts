import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface, type Interface as ReadlineInterface } from 'node:readline'
import { EXTERNAL_MCP_DEFAULT_TIMEOUT_MS, type ExternalMcpServer } from '@shared/externalMcp'
import type { McpToolDescriptor } from '@shared/mcpProtocol'

/**
 * 外部 MCP 服务的**客户端**（连接、列工具、调工具）。
 *
 * 这个模块负责的方向与 `mcpServerService` 相反：那个是应用**对外**提供工具，
 * 这里是把**外部服务**接进来给面板上的 Agent 用。两者共用 `@shared/mcpProtocol`
 * 的消息形状，所以工具描述符可以直接透传。
 *
 * 支持的两种传输：
 * - `http`：MCP streamable HTTP（POST JSON-RPC；应答可能是 `application/json`，也可能是
 *   只有一帧的 `text/event-stream`）。**不处理需要长连接的 SSE 订阅**——本应用只用
 *   请求/应答两种方法（tools/list、tools/call），没有服务端主动推送的需求。
 * - `stdio`：起子进程，按**换行分隔的 JSON-RPC**通信。这是 local-first MCP 的常见形态。
 *
 * 环境变量口径与 blender 子进程一致：**不继承**主进程杂项 env，只给最小 PATH 与
 * 用户显式声明的项 —— 装了第三方服务等于在本机跑别人的代码，能收窄就收窄。
 */

/** 单次 JSON-RPC 往返的结果 */
type RpcResponse = {
  result?: unknown
  error?: { code?: number; message?: string }
}

/** 连接会话：一个外部服务一条，负责传输细节与生命周期 */
export interface ExternalMcpSession {
  /** 列工具（会带协议版本协商） */
  listTools(): Promise<McpToolDescriptor[]>
  /** 调工具，返回服务端原始结果（content 数组等） */
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>
  /** 关闭会话（stdio 杀子进程）；可重复调用 */
  close(): void
}

/**
 * 原因键：与 locale 的 `marketplace.ext.reason.*` 一一对应。
 *
 * 主进程**不产出成品文案** —— 那会变成第二份文案来源，与 locale 各说各话。
 * 能归类的原因带键上去由渲染层翻译；只有外部服务自己吐的错误才原样透传
 * （那种没法翻译，也不该翻译）。
 */
export const EXTERNAL_MCP_REASON = {
  emptyResponse: 'emptyResponse',
  noSseData: 'noSseData',
  badJson: 'badJson',
  rpcError: 'rpcError',
  noReason: 'noReason',
  httpStatus: 'httpStatus',
  spawnFailed: 'spawnFailed',
  processExited: 'processExited',
  stdinFailed: 'stdinFailed',
  timeout: 'timeout',
  closed: 'closed',
  badToolName: 'badToolName'
} as const

/** 连接失败时抛出的错误：带上服务标识与可翻译的原因键，UI 据此显示是哪一条挂了 */
export class ExternalMcpError extends Error {
  readonly serverId: string
  /** 见 EXTERNAL_MCP_REASON；归不了类的为 undefined（此时 message 是外部服务原文） */
  readonly reasonKey?: string
  constructor(serverId: string, message: string, reasonKey?: string) {
    super(message)
    this.name = 'ExternalMcpError'
    this.serverId = serverId
    this.reasonKey = reasonKey
  }
}

/** 本应用声明支持的协议版本；与服务端那份保持一致 */
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const CLIENT_INFO = { name: 'aiartengine', version: '1.0.0' }

/**
 * 超时包装：超时错误用 `ExternalMcpError` 带上原因键与耗时（UI 翻译成「连接超时（60s）」）。
 *
 * 内层错误原样透传 —— 它已经带了更具体的原因（HTTP 状态 / 子进程 stderr 等），
 * 在外面套一层会把它盖掉。
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  serverId: string,
  reasonKey: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ExternalMcpError(serverId, `${ms}ms`, reasonKey)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    )
  })
}

/**
 * HTTP 形态的一帧应答体解析。
 *
 * MCP 的 streamable HTTP 允许服务端用 `text/event-stream` 回**一帧** `data:`，
 * 也允许直接回 JSON。两种都要认，否则一半以上的现成服务连不上。
 */
/**
 * HTTP 应答的解析失败。
 *
 * 抛 `ExternalMcpError` 而不是裸 `Error`：这样调用方拿得到 reasonKey，
 * UI 能显示成「服务返回了空响应」而不是一句英文栈信息。
 */
function httpBodyError(serverId: string, reasonKey: string): ExternalMcpError {
  return new ExternalMcpError(serverId, reasonKey, reasonKey)
}

export function parseMcpHttpBody(body: string, contentType: string, serverId = ''): RpcResponse {
  const text = body.trim()
  if (!text) throw httpBodyError(serverId, EXTERNAL_MCP_REASON.emptyResponse)
  if (contentType.includes('text/event-stream')) {
    // 取最后一帧 data:（多帧时最后一条才是本次应答的结果）
    const dataLines = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim())
      .filter(Boolean)
    const last = dataLines[dataLines.length - 1]
    if (!last) throw httpBodyError(serverId, EXTERNAL_MCP_REASON.noSseData)
    return parseJson(last, serverId)
  }
  return parseJson(text, serverId)
}

function parseJson(text: string, serverId: string): RpcResponse {
  try {
    return JSON.parse(text) as RpcResponse
  } catch {
    // 正文不是 JSON：多半是网关 / 反代吐的 HTML 错误页，归类成 badJson
    throw httpBodyError(serverId, EXTERNAL_MCP_REASON.badJson)
  }
}

/** 应答 → 结果；带 error 时抛出（**保留服务端原文**，那种错误没法翻译也不该翻译） */
function unwrap(id: string, response: RpcResponse): unknown {
  if (response.error) {
    const code = response.error.code ?? 'unknown'
    const message = response.error.message
    throw new ExternalMcpError(
      id,
      `${code}: ${message ?? ''}`.trim(),
      message ? EXTERNAL_MCP_REASON.rpcError : EXTERNAL_MCP_REASON.noReason
    )
  }
  return response.result
}

/** 服务端 tools/list 的归一化：只要 name 是字符串就收，schema 原样透传 */
export function normalizeToolList(raw: unknown): McpToolDescriptor[] {
  const tools = (raw as { tools?: unknown } | null | undefined)?.tools
  if (!Array.isArray(tools)) return []
  const out: McpToolDescriptor[] = []
  for (const item of tools) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    const name = typeof obj.name === 'string' ? obj.name : ''
    if (!name) continue
    out.push({
      name,
      ...(typeof obj.title === 'string' ? { title: obj.title } : {}),
      ...(typeof obj.description === 'string' ? { description: obj.description } : {}),
      inputSchema: obj.inputSchema ?? { type: 'object', properties: {} }
    })
  }
  return out
}

// ─────────────────────────────────────────────────────────────
// stdio 传输
// ─────────────────────────────────────────────────────────────

/**
 * stdio 子进程会话。
 *
 * 用 readline 按行切而不是手写缓冲：**最后一行可能跨 chunk**，手写缓冲是这类实现
 * 最经典的丢消息点（表现是「偶尔少一个工具的响应」，极难复现）。
 */
function openStdioSession(server: ExternalMcpServer): ExternalMcpSession {
  const child: ChildProcessWithoutNullStreams = spawn(server.command, server.args, {
    // 收窄环境：只给最小 PATH 与用户显式声明的项，不继承主进程杂项 env
    env: {
      PATH: process.env.PATH ?? '',
      ...(process.platform === 'win32' ? { PATHEXT: process.env.PATHEXT ?? '' } : {}),
      ...server.env
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  })

  let closed = false
  let nextId = 1
  let stderrTail = ''
  const pending = new Map<
    number,
    { resolve: (v: RpcResponse) => void; reject: (e: Error) => void }
  >()
  let reader: ReadlineInterface | null = null

  const failAll = (error: Error): void => {
    for (const [, entry] of pending) entry.reject(error)
    pending.clear()
  }

  child.on('error', (err) => {
    failAll(new ExternalMcpError(server.id, err.message, EXTERNAL_MCP_REASON.spawnFailed))
  })

  child.on('exit', (code, signal) => {
    /**
     * 子进程的 stderr 是最有诊断价值的原文（第三方服务自己的报错），有就透传；
     * 没有才归类成「进程退出了」由 UI 翻译 —— 后者只是退出码，翻译得出来。
     */
    const stderr = stderrTail.trim()
    failAll(
      stderr
        ? new ExternalMcpError(server.id, stderr)
        : new ExternalMcpError(
            server.id,
            `code=${code ?? 'null'}${signal ? ` signal=${signal}` : ''}`,
            EXTERNAL_MCP_REASON.processExited
          )
    )
  })

  // stderr 只留尾部：MCP 服务的报错通常写在最后几行，全留会撑爆内存
  child.stderr.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString('utf8')).slice(-2000)
  })

  reader = createInterface({ input: child.stdout })
  reader.on('line', (line) => {
    const text = line.replace(/\r$/, '').trim()
    if (!text) return
    let parsed: RpcResponse & { id?: unknown }
    try {
      parsed = JSON.parse(text) as RpcResponse & { id?: unknown }
    } catch {
      // 非 JSON 输出（有些服务会往 stdout 打日志）：忽略而不是崩掉整条会话
      return
    }
    const id = typeof parsed.id === 'number' ? parsed.id : null
    if (id === null) return // 通知 / 日志：本应用不订阅
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id)
    entry.resolve(parsed)
  })

  function request(method: string, params: unknown, timeoutMs: number): Promise<RpcResponse> {
    if (closed) {
      return Promise.reject(new ExternalMcpError(server.id, 'closed', EXTERNAL_MCP_REASON.closed))
    }
    const id = nextId++
    const payload = `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`
    return withTimeout(
      new Promise<RpcResponse>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        child.stdin.write(payload, (err) => {
          if (!err) return
          pending.delete(id)
          reject(new ExternalMcpError(server.id, err.message, EXTERNAL_MCP_REASON.stdinFailed))
        })
      }),
      timeoutMs,
      server.id,
      EXTERNAL_MCP_REASON.timeout
    ).catch((err: unknown) => {
      pending.delete(id)
      throw err instanceof Error ? err : new Error(String(err))
    })
  }

  return {
    async listTools(): Promise<McpToolDescriptor[]> {
      await request('initialize', initializeParams(), server.timeoutMs)
      sendNotification(child, 'notifications/initialized')
      return normalizeToolList(unwrap(server.id, await request('tools/list', {}, server.timeoutMs)))
    },
    async callTool(name, args): Promise<unknown> {
      const response = await request(
        'tools/call',
        { name, arguments: args ?? {} },
        server.timeoutMs
      )
      return unwrap(server.id, response)
    },
    close(): void {
      if (closed) return
      closed = true
      reader?.close()
      reader = null
      failAll(new ExternalMcpError(server.id, 'closed', EXTERNAL_MCP_REASON.closed))
      child.kill()
    }
  }
}

function initializeParams(): Record<string, unknown> {
  return {
    protocolVersion: PROTOCOL_VERSIONS[0],
    capabilities: {},
    clientInfo: CLIENT_INFO
  }
}

/** 通知没有 id，也不需要应答；写失败不影响后续请求 */
function sendNotification(child: ChildProcessWithoutNullStreams, method: string): void {
  try {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`)
  } catch {
    /* 通知丢失不致命：多数服务端不强制要求 initialized */
  }
}

// ─────────────────────────────────────────────────────────────
// HTTP 传输
// ─────────────────────────────────────────────────────────────

function openHttpSession(server: ExternalMcpServer): ExternalMcpSession {
  let closed = false
  let nextId = 1
  /** streamable HTTP 的服务端可能要求回传会话 id（initialize 响应头里给） */
  let sessionId: string | null = null

  async function request(method: string, params: unknown): Promise<RpcResponse> {
    if (closed) {
      throw new ExternalMcpError(server.id, 'closed', EXTERNAL_MCP_REASON.closed)
    }
    const id = nextId++
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      // 两种都要声明：服务端据此决定回 JSON 还是 SSE
      accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      ...server.headers
    }
    const response = await withTimeout(
      fetch(server.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params })
      }),
      server.timeoutMs,
      server.id,
      EXTERNAL_MCP_REASON.timeout
    )
    const returnedSession = response.headers.get('mcp-session-id')
    if (returnedSession) sessionId = returnedSession
    const bodyText = await response.text()
    if (!response.ok) {
      // 401/403 是最常见的配置错误（凭据没填 / 填错）。状态码与响应体是**外部服务原文**，
      // 保留在 message 里便于排查；UI 用 reasonKey 翻译出「连接失败（HTTP 401）」这句。
      throw new ExternalMcpError(
        server.id,
        `${response.status}${bodyText.trim() ? ` ${bodyText.slice(0, 300)}` : ''}`,
        EXTERNAL_MCP_REASON.httpStatus
      )
    }
    return parseMcpHttpBody(bodyText, response.headers.get('content-type') ?? '', server.id)
  }

  return {
    async listTools(): Promise<McpToolDescriptor[]> {
      await request('initialize', initializeParams())
      if (sessionId) {
        // 协议要求初始化后发一次 initialized 通知；失败不致命
        try {
          await fetch(server.url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream',
              'mcp-session-id': sessionId,
              ...server.headers
            },
            body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
          })
        } catch {
          /* 通知失败不致命 */
        }
      }
      return normalizeToolList(unwrap(server.id, await request('tools/list', {})))
    },
    async callTool(name, args): Promise<unknown> {
      return unwrap(server.id, await request('tools/call', { name, arguments: args ?? {} }))
    },
    close(): void {
      closed = true
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 会话注册表
// ─────────────────────────────────────────────────────────────

const sessions = new Map<string, ExternalMcpSession>()

/**
 * 取得（或建立）某外部服务的会话。
 *
 * 会话**按连接形态缓存**：stdio 起子进程有成本，每次调用都重起会让「连续用同一个工具」
 * 变得很慢；HTTP 也会白付一次 initialize。配置一变（url / command / 参数 / 凭据）
 * 就丢弃旧会话，避免用着已失效的连接。
 */
export function getExternalMcpSession(server: ExternalMcpServer): ExternalMcpSession {
  const cached = sessions.get(server.id)
  if (cached) return cached
  const session = server.transport === 'stdio' ? openStdioSession(server) : openHttpSession(server)
  sessions.set(server.id, session)
  return session
}

/** 丢弃某服务的会话（配置变更 / 删除 / 停用 / 单项测试失败后重连） */
export function dropExternalMcpSession(id: string): void {
  const session = sessions.get(id)
  if (!session) return
  sessions.delete(id)
  try {
    session.close()
  } catch {
    /* 关闭失败不影响调用方：会话已从表里摘掉 */
  }
}

/** 关闭全部会话（应用退出 / MCP 服务重启时调用，否则 stdio 子进程会变成孤儿） */
export function closeAllExternalMcpSessions(): void {
  for (const id of [...sessions.keys()]) dropExternalMcpSession(id)
}

/** 连接一次外部服务并取回工具清单（「测试连接」与添加时的预检都用它） */
export async function probeExternalMcpServer(server: ExternalMcpServer): Promise<{
  tools: McpToolDescriptor[]
}> {
  // 预检总是新建会话：复用缓存会让「改了配置却还报旧错」这种误判出现
  dropExternalMcpSession(server.id)
  const session = getExternalMcpSession(server)
  try {
    return { tools: await session.listTools() }
  } catch (err) {
    // 预检失败必须丢弃会话：半开的 stdio 子进程留着只会累积
    dropExternalMcpSession(server.id)
    throw err instanceof Error ? err : new Error(String(err))
  }
}

/** 把任意错误归一成「原文 + 可翻译原因键」，供 IPC 直接回给渲染层 */
export function describeExternalMcpError(err: unknown): {
  error: string
  reasonKey?: string
} {
  if (err instanceof ExternalMcpError) {
    return {
      error: err.message,
      ...(err.reasonKey ? { reasonKey: err.reasonKey } : {})
    }
  }
  return { error: err instanceof Error ? err.message : String(err) }
}

export const __externalMcpTest = {
  PROTOCOL_VERSIONS,
  DEFAULT_TIMEOUT: EXTERNAL_MCP_DEFAULT_TIMEOUT_MS
}
