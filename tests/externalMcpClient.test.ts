import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDefaultExternalMcpServer, type ExternalMcpServer } from '../src/shared/externalMcp'
import {
  dropExternalMcpSession,
  probeExternalMcpServer
} from '../src/main/services/externalMcpClient'

/**
 * 外部 MCP 客户端（**真实 HTTP 往返**，不是打桩）。
 *
 * 这是整个「添加第三方 MCP」功能里最容易悄悄坏掉的一环：协议细节（initialize 协商、
 * SSE 单帧应答、token 鉴权头、错误归一）每一条错了都表现为「连不上」，而用户看不出
 * 是哪一层。所以这里起一个真实的 MCP 服务端，把请求/应答真跑一遍。
 */

type FakeOptions = {
  /** 必须收到这个 Authorization 头，否则回 401 */
  requireAuth?: string
  /** 用 text/event-stream 回单帧（真实服务里很常见） */
  sse?: boolean
  /** 工具清单 */
  tools?: Array<{ name: string; description?: string }>
  /** tools/call 是否回一个 JSON-RPC error */
  callError?: string
  /** initialize 时返回会话 id，要求后续请求带上 */
  sessionId?: string
}

function startFakeMcp(opts: FakeOptions = {}): Promise<{ server: Server; port: number }> {
  const tools = opts.tools ?? [{ name: 'geocode', description: '地址转坐标' }]
  let seenSessionId: string | null = null
  /** 记录收到的头，供断言鉴权/模式头真的发出去了 */
  const receivedHeaders: Array<Record<string, string | string[] | undefined>> = []

  const server = createServer((req, res) => {
    const send = (body: unknown, status = 200): void => {
      const payload = JSON.stringify(body)
      const headers: Record<string, string> = {
        'Content-Type': opts.sse ? 'text/event-stream' : 'application/json; charset=utf-8'
      }
      if (opts.sessionId && !seenSessionId) {
        seenSessionId = opts.sessionId
        headers['mcp-session-id'] = opts.sessionId
      }
      res.writeHead(status, headers)
      if (opts.sse && body !== null) {
        res.end(`event: message\ndata: ${payload}\n\n`)
        return
      }
      res.end(payload)
    }

    receivedHeaders.push(req.headers as Record<string, string | string[] | undefined>)

    if (opts.requireAuth && req.headers.authorization !== opts.requireAuth) {
      send({ error: 'unauthorized' }, 401)
      return
    }
    // 会话 id 已发过则后续必须带上
    if (seenSessionId && req.headers['mcp-session-id'] !== seenSessionId) {
      send({ error: 'missing session' }, 400)
      return
    }

    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      const message = JSON.parse(raw) as {
        id?: unknown
        method?: string
        params?: Record<string, unknown>
      }
      if (message.method === 'notifications/initialized') {
        res.writeHead(202)
        res.end()
        return
      }
      const id = message.id ?? null
      switch (message.method) {
        case 'initialize':
          send({
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2025-06-18',
              capabilities: { tools: {} },
              serverInfo: { name: 'fake', version: '1.0.0' }
            }
          })
          return
        case 'tools/list':
          send({ jsonrpc: '2.0', id, result: { tools } })
          return
        case 'tools/call':
          if (opts.callError) {
            send({ jsonrpc: '2.0', id, error: { code: -32000, message: opts.callError } })
            return
          }
          send({
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text: `called ${String(message.params?.name)}` }] }
          })
          return
        default:
          send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'unknown' } })
      }
    })
  })

  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolvePromise({ server, port })
    })
  })
}

function serverFor(port: number, over: Partial<ExternalMcpServer> = {}): ExternalMcpServer {
  return {
    ...createDefaultExternalMcpServer('http'),
    id: 'demo',
    name: 'Demo',
    url: `http://127.0.0.1:${port}/mcp`,
    ...over
  }
}

const started: Server[] = []
afterAll(() => {
  for (const item of started) item.close()
  dropExternalMcpSession('demo')
  dropExternalMcpSession('other')
})

describe('外部 MCP 客户端：HTTP 往返', () => {
  it('完成 initialize 协商并取回工具清单', async () => {
    const { server, port } = await startFakeMcp()
    started.push(server)
    const { tools } = await probeExternalMcpServer(serverFor(port))
    expect(tools.map((t) => t.name)).toEqual(['geocode'])
    expect(tools[0]?.description).toBe('地址转坐标')
  })

  it('认得 SSE 单帧应答（一半以上的现成服务这么回）', async () => {
    const { server, port } = await startFakeMcp({ sse: true })
    started.push(server)
    const { tools } = await probeExternalMcpServer(serverFor(port))
    expect(tools.map((t) => t.name)).toEqual(['geocode'])
  })

  it('把用户填的请求头原样发出去（需要鉴权的服务靠它）', async () => {
    const { server, port } = await startFakeMcp({ requireAuth: 'Bearer sekret' })
    started.push(server)
    // 不带凭据 → 归类成 httpStatus，原文里带状态码便于排查
    await expect(probeExternalMcpServer(serverFor(port))).rejects.toMatchObject({
      reasonKey: 'httpStatus',
      message: expect.stringContaining('401')
    })
    // 带上凭据 → 通过
    const ok = await probeExternalMcpServer(
      serverFor(port, { headers: { Authorization: 'Bearer sekret' } })
    )
    expect(ok.tools).toHaveLength(1)
  })

  it('回传 initialize 的会话 id，后续请求带上（否则会被判 400）', async () => {
    const { server, port } = await startFakeMcp({ sessionId: 'sess-123' })
    started.push(server)
    const { tools } = await probeExternalMcpServer(serverFor(port))
    // 能拿到工具清单就说明 initialized 通知与 tools/list 都带了会话 id
    expect(tools).toHaveLength(1)
  })

  it('服务端 JSON-RPC error 变成一句可读原因（含错误码）', async () => {
    const { server, port } = await startFakeMcp({ callError: '工具内部炸了' })
    started.push(server)
    const probe = await probeExternalMcpServer(serverFor(port))
    expect(probe.tools).toHaveLength(1)
    // 直接调工具才会命中 error 分支
    const { getExternalMcpSession } = await import('../src/main/services/externalMcpClient')
    await expect(
      getExternalMcpSession(serverFor(port)).callTool('geocode', { q: 'x' })
    ).rejects.toThrow(/工具内部炸了/)
  })

  it('连不上时给出明确错误而不是挂住（端口没人监听）', async () => {
    // 起一个再关掉，拿到一个确定无人监听的端口
    const { server, port } = await startFakeMcp()
    await new Promise<void>((r) => server.close(() => r()))
    await expect(probeExternalMcpServer(serverFor(port))).rejects.toThrow()
  })

  it('超时按该服务的 timeoutMs 生效', async () => {
    // 服务端永不回应
    const silent = createServer(() => {
      /* 故意不响应 */
    })
    started.push(silent)
    const port = await new Promise<number>((r) =>
      silent.listen(0, '127.0.0.1', () => {
        const address = silent.address()
        r(typeof address === 'object' && address ? address.port : 0)
      })
    )
    await expect(
      probeExternalMcpServer(serverFor(port, { timeoutMs: 1000 }))
    ).rejects.toMatchObject({ reasonKey: 'timeout' })
  }, 15_000)
})

describe('工具名命名空间：与内建工具隔离', () => {
  it('经应用侧命名空间后，外部工具名不会与内建重名', async () => {
    const { server, port } = await startFakeMcp({
      // 故意与内建工具同名（内建也有 asset_list）
      tools: [{ name: 'asset_list' }, { name: 'project_list' }]
    })
    started.push(server)
    const { tools } = await probeExternalMcpServer(serverFor(port))
    const { namespaceExternalMcpTool } = await import('../src/shared/externalMcp')
    const namespaced = tools.map((t) => namespaceExternalMcpTool('demo', t.name))
    expect(namespaced).toEqual(['demo__asset_list', 'demo__project_list'])
    // 都不等于内建名
    expect(namespaced).not.toContain('asset_list')
  })
})

// ─────────────────────────────────────────────────────────────
// stdio 传输（真起子进程）
// ─────────────────────────────────────────────────────────────

/**
 * 最小 stdio MCP 服务端。
 *
 * 写成临时文件而不是内联 `node -e`：内联脚本里全是引号与反斜杠，跨 shell 传递极易
 * 被吃掉一层。临时文件也让「被子进程真实执行」这件事毫无疑问。
 */
const STDIO_SERVER_SOURCE = `
let buffer = ''
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf8')
  const lines = buffer.split('\\n')
  buffer = lines.pop() ?? ''
  for (const line of lines) {
    const text = line.replace(/\\r$/, '').trim()
    if (!text) continue
    const message = JSON.parse(text)
    if (message.id === undefined || message.id === null) continue
    const reply = (result) =>
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n')
    if (message.method === 'initialize') {
      reply({ protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'stdio-fake', version: '1.0.0' } })
    } else if (message.method === 'tools/list') {
      reply({ tools: [{ name: 'local_tool', description: '本地工具' }] })
    } else if (message.method === 'tools/call') {
      reply({ content: [{ type: 'text', text: 'stdio ok: ' + String(message.params && message.params.name) }] })
    } else {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'unknown' } }) + '\\n')
    }
  }
})
`

describe('外部 MCP 客户端：stdio 子进程', () => {
  it('起子进程、列工具、调工具（换行分隔 JSON-RPC）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aae-ext-mcp-'))
    const script = join(dir, 'server.mjs')
    writeFileSync(script, STDIO_SERVER_SOURCE, 'utf8')
    try {
      const stdioServer: ExternalMcpServer = {
        ...createDefaultExternalMcpServer('stdio'),
        id: 'other',
        name: 'Local',
        command: process.execPath,
        args: [script]
      }
      const { tools } = await probeExternalMcpServer(stdioServer)
      expect(tools.map((t) => t.name)).toEqual(['local_tool'])
      expect(tools[0]?.description).toBe('本地工具')

      const { getExternalMcpSession } = await import('../src/main/services/externalMcpClient')
      const result = await getExternalMcpSession(stdioServer).callTool('local_tool', { a: 1 })
      expect(result).toEqual({ content: [{ type: 'text', text: 'stdio ok: local_tool' }] })
    } finally {
      dropExternalMcpSession('other')
      rmSync(dir, { recursive: true, force: true })
    }
  }, 20_000)

  it('命令不存在时给出可读原因（不是只丢一句 ENOENT）', async () => {
    const broken: ExternalMcpServer = {
      ...createDefaultExternalMcpServer('stdio'),
      id: 'other',
      name: 'Broken',
      command: 'definitely-not-a-real-command-xyz'
    }
    await expect(probeExternalMcpServer(broken)).rejects.toThrow(/无法启动|ENOENT|退出/)
    dropExternalMcpSession('other')
  }, 20_000)

  it('预检失败后不留下半开会话（否则每次失败都攒一个子进程）', async () => {
    const broken: ExternalMcpServer = {
      ...createDefaultExternalMcpServer('stdio'),
      id: 'other',
      name: 'Broken',
      command: 'definitely-not-a-real-command-xyz'
    }
    await expect(probeExternalMcpServer(broken)).rejects.toThrow()
    const { getExternalMcpSession } = await import('../src/main/services/externalMcpClient')
    // 会话必须已被摘掉：再取一次是新建的会话并再次失败，而不是复用一个已经死掉的
    await expect(getExternalMcpSession(broken).listTools()).rejects.toThrow()
    dropExternalMcpSession('other')
  }, 20_000)
})
