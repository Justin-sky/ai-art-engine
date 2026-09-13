/**
 * MCP 协议消息处理（与应用传输层无关）：
 * 主进程的 /mcp 端点（streamable HTTP）用它应答 JSON-RPC 消息；
 * stdio 桥（scripts/mcp-bridge.mjs）是纯隧道，不处理协议，全部交由本模块。
 */

import type { ChatMode } from './ipc'

/**
 * 单次 MCP 请求的上下文：传输层（HTTP 请求头）解析得到，协议层原样透传给工具面。
 * 授权分级（Ask / Plan 的工具收窄与拒绝）就建立在这两个字段上，见 shared/mcpModeAccess.ts。
 */
export interface McpRequestContext {
  /** 取消信号：HTTP 连接断开、notifications/cancelled 均经此中断进行中的调用 */
  signal?: AbortSignal
  /** 请求方声明的对话模式（请求头 `X-AIArt-Mode`）；缺省 = 外部客户端，不受面板模式约束 */
  mode?: ChatMode
  /** 对话面板某次运行的标识（请求头 `X-AIArt-Run-Id`）：Plan 模式据此查询用户是否已确认计划 */
  runId?: string
}

export interface McpToolDescriptor {
  name: string
  title?: string
  description?: string
  inputSchema: unknown
}

/** 随工具结果回给客户端的图片（MCP image content） */
export interface McpToolImage {
  /** base64 数据（不含 data: 前缀） */
  data: string
  /** 如 image/jpeg、image/png */
  mimeType: string
}

export interface McpToolCallOutcome {
  /** 成功时的返回值（会被 JSON 序列化进 content[0].text） */
  result?: unknown
  /**
   * 随文本一起回给客户端的图片：多模态客户端能直接「看」到画面，
   * 纯文本客户端只会拿到 result 里的文字说明（不会因此失败）。
   * 图片刻意不走 result——base64 会把文本结果撑爆，且会污染审计日志的字节统计。
   */
  images?: McpToolImage[]
  /** 失败消息（isError = true） */
  error?: string
}

export interface McpProtocolHandlerOptions {
  serverInfo: { name: string; title?: string; version: string }
  /** 列工具时带上请求上下文：按模式收窄（Ask 为空、Plan 未确认只给只读） */
  listTools:
    | ((ctx?: McpRequestContext) => Promise<McpToolDescriptor[]>)
    | ((ctx?: McpRequestContext) => McpToolDescriptor[])
  callTool: (
    name: string,
    args: Record<string, unknown>,
    ctx?: McpRequestContext
  ) => Promise<McpToolCallOutcome>
  /** 支持的协议版本；协商时回退到第一项 */
  supportedProtocolVersions?: string[]
}

const DEFAULT_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']

type RpcMessage = {
  jsonrpc?: unknown
  id?: unknown
  method?: unknown
  params?: Record<string, unknown>
}

function rpcResult(id: unknown, result: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id: unknown, code: number, message: string): Record<string, unknown> {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

export function createMcpProtocolHandler(options: McpProtocolHandlerOptions) {
  const versions = options.supportedProtocolVersions ?? DEFAULT_VERSIONS
  const fallbackVersion = versions[0]
  /** 进行中的请求 id → 取消控制器：notifications/cancelled 与外部信号（如 HTTP 连接断开）均经此中断 */
  const pendingRequests = new Map<unknown, AbortController>()

  async function handleMessage(
    message: unknown,
    ctx?: McpRequestContext
  ): Promise<Record<string, unknown> | null> {
    if (!message || typeof message !== 'object') {
      return rpcError(null, -32600, '无效请求：不是 JSON-RPC 消息')
    }
    const msg = message as RpcMessage
    if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return rpcError(msg.id ?? null, -32600, '无效请求：缺少 jsonrpc 或 method')
    }
    const isNotification = msg.id === undefined || msg.id === null
    const params = (msg.params && typeof msg.params === 'object' ? msg.params : {}) as Record<
      string,
      unknown
    >

    try {
      switch (msg.method) {
        case 'initialize': {
          if (isNotification) return null
          const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
          return rpcResult(msg.id, {
            protocolVersion: versions.includes(requested) ? requested : fallbackVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo: options.serverInfo
          })
        }
        case 'ping':
          return isNotification ? null : rpcResult(msg.id, {})
        case 'notifications/initialized':
          return null
        case 'notifications/cancelled': {
          // 按客户端提供的 requestId 中止对应的进行中 tools/call
          const requestId = params.requestId
          if (requestId !== undefined && requestId !== null && pendingRequests.has(requestId)) {
            pendingRequests.get(requestId)?.abort()
          }
          return null
        }
        case 'tools/list': {
          if (isNotification) return null
          return rpcResult(msg.id, { tools: await options.listTools(ctx) })
        }
        case 'tools/call': {
          const name = typeof params.name === 'string' ? params.name : ''
          const args =
            params.arguments && typeof params.arguments === 'object'
              ? (params.arguments as Record<string, unknown>)
              : {}
          if (!name) {
            if (isNotification) return null
            return rpcError(msg.id, -32602, 'tools/call 缺少 name')
          }
          // 带 id 的请求才可取消：登记 AbortController，响应或中止后释放
          let controller: AbortController | null = null
          let onOuterAbort: (() => void) | null = null
          if (!isNotification) {
            controller = new AbortController()
            pendingRequests.set(msg.id, controller)
            onOuterAbort = () => controller?.abort()
            if (ctx?.signal?.aborted) {
              controller.abort()
            } else if (ctx?.signal) {
              ctx.signal.addEventListener('abort', onOuterAbort, { once: true })
            }
          }
          try {
            // 模式 / runId 与取消信号一起带给工具面：前者决定放行与否，后者用于中断长任务
            const signal = controller ? controller.signal : ctx?.signal
            const outcome = await options.callTool(name, args, {
              ...ctx,
              ...(signal ? { signal } : {})
            })
            if (isNotification) return null
            if (outcome.error !== undefined) {
              return rpcResult(msg.id, {
                content: [{ type: 'text', text: `调用失败：${outcome.error}` }],
                isError: true
              })
            }
            const content: Array<Record<string, unknown>> = [
              { type: 'text', text: JSON.stringify(outcome.result ?? null, null, 2) }
            ]
            // 图片排在文本之后：客户端先读到文字说明，再看到画面
            for (const image of outcome.images ?? []) {
              if (image?.data) {
                content.push({ type: 'image', data: image.data, mimeType: image.mimeType })
              }
            }
            return rpcResult(msg.id, { content })
          } finally {
            if (controller) {
              pendingRequests.delete(msg.id)
              if (ctx?.signal && onOuterAbort) {
                ctx.signal.removeEventListener('abort', onOuterAbort)
              }
            }
          }
        }
        case 'resources/list':
          return isNotification ? null : rpcResult(msg.id, { resources: [] })
        case 'prompts/list':
          return isNotification ? null : rpcResult(msg.id, { prompts: [] })
        default:
          if (isNotification) return null
          return rpcError(msg.id, -32601, `未知方法：${msg.method}`)
      }
    } catch (err) {
      if (isNotification) return null
      return rpcError(msg.id, -32603, err instanceof Error ? err.message : String(err))
    }
  }

  return handleMessage
}
