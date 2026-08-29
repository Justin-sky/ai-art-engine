/**
 * MCP 协议消息处理（与应用传输层无关）：
 * 主进程的 /mcp 端点（streamable HTTP）用它应答 JSON-RPC 消息；
 * stdio 桥（scripts/mcp-bridge.mjs）为保证单文件分发保留自己的副本。
 */

export interface McpToolDescriptor {
  name: string
  title?: string
  description?: string
  inputSchema: unknown
}

export interface McpToolCallOutcome {
  /** 成功时的返回值（会被 JSON 序列化进 content[0].text） */
  result?: unknown
  /** 失败消息（isError = true） */
  error?: string
}

export interface McpProtocolHandlerOptions {
  serverInfo: { name: string; title?: string; version: string }
  listTools:
    | (() => Promise<McpToolDescriptor[]>)
    | (() => McpToolDescriptor[])
  callTool: (name: string, args: Record<string, unknown>) => Promise<McpToolCallOutcome>
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

  async function handleMessage(message: unknown): Promise<Record<string, unknown> | null> {
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
        case 'notifications/cancelled':
          return null
        case 'tools/list': {
          if (isNotification) return null
          return rpcResult(msg.id, { tools: await options.listTools() })
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
          const outcome = await options.callTool(name, args)
          if (isNotification) return null
          if (outcome.error !== undefined) {
            return rpcResult(msg.id, {
              content: [{ type: 'text', text: `调用失败：${outcome.error}` }],
              isError: true
            })
          }
          return rpcResult(msg.id, {
            content: [{ type: 'text', text: JSON.stringify(outcome.result ?? null, null, 2) }]
          })
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
      return rpcError(
        msg.id,
        -32603,
        err instanceof Error ? err.message : String(err)
      )
    }
  }

  return handleMessage
}
