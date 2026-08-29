import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const BRIDGE_PATH = resolve('scripts/mcp-bridge.mjs')

/** 模拟 AiArtEngine 主进程工具服务的最小上游 */
function startFakeUpstream(): Promise<{
  server: Server
  port: number
  close: () => Promise<void>
}> {
  return new Promise((resolvePromise) => {
    const server = createServer((req, res) => {
      const send = (body: unknown): void => {
        const payload = JSON.stringify(body)
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(payload)
        })
        res.end(payload)
      }
      if (req.url === '/health') return send({ ok: true, app: 'aiartengine' })
      if (req.url === '/tools') {
        return send({
          tools: [
            {
              name: 'echo',
              title: 'Echo',
              description: '回显参数',
              inputSchema: { type: 'object', properties: { text: { type: 'string' } } }
            },
            {
              name: 'fail',
              title: 'Fail',
              description: '始终失败',
              inputSchema: { type: 'object', properties: {} }
            }
          ]
        })
      }
      const readBody = (done: (body: { arguments?: unknown }) => void): void => {
        let raw = ''
        req.on('data', (chunk) => (raw += chunk))
        req.on('end', () => done(JSON.parse(raw || '{}')))
      }
      if (req.url === '/tools/echo') {
        return readBody((body) => send({ ok: true, result: { echo: body.arguments ?? null } }))
      }
      if (req.url === '/tools/fail') {
        return readBody(() => send({ ok: false, error: 'boom' }))
      }
      res.writeHead(404)
      res.end('{}')
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolvePromise({
        server,
        port,
        close: () => new Promise((done) => server.close(() => done()))
      })
    })
  })
}

type RpcResponse = Record<string, unknown>

describe('mcp-bridge（stdio MCP 协议）', () => {
  let upstream: Awaited<ReturnType<typeof startFakeUpstream>>
  let configPath: string
  let child: ChildProcess
  const waiters = new Map<number, { timer: NodeJS.Timeout; resolve: (value: RpcResponse) => void }>()
  const queues = new Map<number, RpcResponse[]>()
  let nextId = 1

  function feed(line: string): void {
    const message = JSON.parse(line) as RpcResponse
    const id = typeof message.id === 'number' ? message.id : -1
    const waiter = waiters.get(id)
    if (waiter) {
      waiters.delete(id)
      waiter.resolve(message)
      return
    }
    const queue = queues.get(id) ?? []
    queue.push(message)
    queues.set(id, queue)
  }

  /** 发送一条 JSON-RPC 请求，按 id 等待桥的应答 */
  function request(method: string, params?: unknown): Promise<RpcResponse> {
    const id = nextId++
    const queued = queues.get(id)
    if (queued?.length) {
      return Promise.resolve(queued.shift()!)
    }
    return new Promise<RpcResponse>((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => rejectPromise(new Error(`等待 ${method} 响应超时`)), 10000)
      waiters.set(id, {
        timer,
        resolve: (value) => {
          clearTimeout(timer)
          resolvePromise(value)
        }
      })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }

  beforeAll(async () => {
    upstream = await startFakeUpstream()
    const dir = mkdtempSync(join(tmpdir(), 'aiae-mcp-'))
    configPath = join(dir, 'mcp.json')
    writeFileSync(
      configPath,
      JSON.stringify({ port: upstream.port, token: 'test-token', pid: process.pid })
    )
    child = spawn(process.execPath, [BRIDGE_PATH], {
      env: { ...process.env, AIAE_MCP_CONFIG: configPath },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      let index: number
      while ((index = stdout.indexOf('\n')) >= 0) {
        const line = stdout.slice(0, index).trim()
        stdout = stdout.slice(index + 1)
        if (line) feed(line)
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', () => {
      /* 桥的 stderr 日志仅用于人工排查 */
    })
  })

  afterAll(async () => {
    child?.kill()
    await upstream.close()
    try {
      rmSync(join(configPath, '..'), { recursive: true, force: true })
    } catch {
      /* 临时目录清理失败可忽略 */
    }
  })

  it('initialize 协商协议版本并返回 serverInfo', async () => {
    const res = await request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '0' }
    })
    const result = res.result as { protocolVersion: string; serverInfo: { name: string }; capabilities: { tools: unknown } }
    expect(result.protocolVersion).toBe('2024-11-05')
    expect(result.serverInfo.name).toBe('aiartengine')
    expect(result.capabilities.tools).toBeTruthy()
  })

  it('notifications/initialized 静默接受（无应答）', () => {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  })

  it('tools/list 返回上游注册的工具', async () => {
    const res = await request('tools/list')
    const result = res.result as { tools: Array<{ name: string; inputSchema: { type: string } }> }
    const names = result.tools.map((tool) => tool.name)
    expect(names).toContain('echo')
    expect(names).toContain('fail')
    expect(result.tools[0].inputSchema.type).toBe('object')
  })

  it('tools/call 成功时返回结构化文本结果', async () => {
    const res = await request('tools/call', { name: 'echo', arguments: { text: '你好' } })
    const result = res.result as { content: Array<{ type: string; text: string }>; isError?: boolean }
    expect(result.isError).toBeUndefined()
    expect(JSON.parse(result.content[0].text)).toEqual({ echo: { text: '你好' } })
  })

  it('tools/call 业务失败时返回 isError 结果', async () => {
    const res = await request('tools/call', { name: 'fail', arguments: {} })
    const result = res.result as { content: Array<{ text: string }>; isError?: boolean }
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('boom')
  })

  it('未知方法返回 -32601', async () => {
    const res = await request('resources/templates/list')
    const error = res.error as { code: number }
    expect(error.code).toBe(-32601)
  })
})
