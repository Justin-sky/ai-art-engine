#!/usr/bin/env node
/**
 * AiArtEngine MCP stdio 桥（HTTP client ↔ stdio MCP server）。
 *
 * 用途：把一个 stdio MCP server（典型例子 Blender 官方 blender-mcp addon，
 * 命令 `uvx blender-mcp` 或 `python -m blender_mcp`）暴露为 streamable-http 端点，
 * 让 dsh 的 mcp-client 插件（仅支持 streamable-http）能直接消费。
 *
 * 与 scripts/mcp-bridge.mjs 的区别：
 * - mcp-bridge.mjs 是「stdio（外部 Agent） → POST /mcp（本应用）」，把本应用工具面
 *   暴露给外部 Agent；本脚本是反向：「POST /mcp（本应用内的 dsh） → stdio（blender-mcp）」，
 *   把第三方 stdio server 暴露回应用内的 Agent。
 * - 本脚本自带 spawn 子进程的能力（前者是 client，不需要拉起对端）。
 *
 * 配置（环境变量）：
 *   AIAE_BLENDER_MCP_CMD     覆盖 spawn 命令（默认按 `uvx blender-mcp` 探测）
 *   AIAE_BLENDER_MCP_ARGS    附加参数（空格或逗号分隔）
 *   AIAE_BLENDER_MCP_PORT    强制监听端口（默认 43120，自动扫描 43120-43129）
 *   AIAE_BLENDER_MCP_TOKEN   Bearer token（缺省随机生成；写入 mcp-blender.json）
 *   AIAE_BLENDER_MCP_CONFIG  mcp-blender.json 输出路径（默认 <appData>/aiartengine/mcp-blender.json）
 *
 * 协议边界（streamable-http 最小子集）：
 *   POST /mcp  Content-Type: application/json  body=JSON-RPC  → 200 application/json | 202 空
 *   GET  /mcp  Accept: text/event-stream        → 200 text/event-stream（无主动通知，立即关闭）
 *   其他路径   → 404
 *   /health                                     → 200 { ok, blenderRunning } 探活用
 *
 * 运行要求：Node 22.6+（默认开启 type stripping），Electron 44 内置 Node 24 直接支持。
 * 主进程通过 spawn(process.execPath, ['--experimental-strip-types', script], ...) 拉起。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type IncomingMessage } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

const PORT_BASE = 43120
const PORT_RANGE = 10
const REQUEST_TIMEOUT_MS = 600_000

function log(...args: unknown[]): void {
  console.error('[blender-mcp-bridge]', ...args)
}

/** 应用 userData 目录定位（与 mcp-bridge.mjs 同样的回退链） */
function defaultConfigPath(): string {
  const appData = process.env.APPDATA
  const dir = appData
    ? join(appData, 'aiartengine')
    : process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support', 'aiartengine')
      : join(homedir(), '.config', 'aiartengine')
  return join(dir, 'mcp-blender.json')
}

export function pickCommand(): string[] {
  if (process.env.AIAE_BLENDER_MCP_CMD) {
    return process.env.AIAE_BLENDER_MCP_CMD.split(/[\s,]+/).filter(Boolean)
  }
  return ['uvx', 'blender-mcp']
}

export function parseExtraArgs(): string[] {
  const raw = process.env.AIAE_BLENDER_MCP_ARGS
  if (!raw) return []
  return raw.split(/[\s,]+/).filter(Boolean)
}

export function pickPort(): number {
  if (process.env.AIAE_BLENDER_MCP_PORT) {
    const n = Number(process.env.AIAE_BLENDER_MCP_PORT)
    if (Number.isFinite(n) && n > 0) return n
  }
  return PORT_BASE
}

export function genToken(): string {
  return process.env.AIAE_BLENDER_MCP_TOKEN || randomBytes(24).toString('hex')
}

function rpcError(
  id: unknown,
  code: number,
  message: string
): {
  jsonrpc: '2.0'
  id: unknown
  error: { code: number; message: string }
} {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

/** 异步找空闲端口：从 start 起一个临时 server，拿到可用端口后立刻关掉 */
export function findOpenPort(start: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (p: number): void => {
      const probe = createServer()
      probe.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && p < start + PORT_RANGE) {
          tryPort(p + 1)
        } else {
          reject(err)
        }
      })
      probe.once('listening', () => {
        probe.close(() => resolve(p))
      })
      probe.listen(p, '127.0.0.1')
    }
    tryPort(start)
  })
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.once('error', reject)
  })
}

interface PendingResolver {
  resolve: (msg: unknown) => void
}

export class StdioMcpBackend {
  running = false
  child: ChildProcess | null = null
  private command: string
  private args: string[]
  private stdoutBuffer = ''
  private stderrBuffer = ''
  private pending = new Map<unknown, PendingResolver>()

  constructor(opts: { command: string; args: string[] }) {
    this.command = opts.command
    this.args = opts.args
  }

  spawn(): boolean {
    try {
      this.child = spawn(this.command, this.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
        windowsHide: true
      })
    } catch (err) {
      log('spawn 失败:', err instanceof Error ? err.message : String(err))
      this.running = false
      return false
    }
    this.running = true
    this.child.stdout?.setEncoding('utf8')
    this.child.stderr?.setEncoding('utf8')
    this.child.stdout?.on('data', (chunk: string) => this.onStdout(chunk))
    this.child.stderr?.on('data', (chunk: string) => this.onStderr(chunk))
    this.child.on('exit', (code, signal) => {
      log(`blender-mcp 退出 code=${code} signal=${signal}`)
      this.running = false
      this.child = null
      for (const [id, resolver] of this.pending) {
        resolver.resolve(rpcError(id, -32603, 'blender-mcp 进程已退出'))
      }
      this.pending.clear()
    })
    this.child.on('error', (err) => {
      log('blender-mcp 进程错误:', err.message)
      this.running = false
    })
    log(`已 spawn blender-mcp: ${this.command} ${this.args.join(' ')} (pid=${this.child.pid})`)
    return true
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    let idx = this.stdoutBuffer.indexOf('\n')
    while (idx >= 0) {
      const line = this.stdoutBuffer.slice(0, idx).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(idx + 1)
      if (!line) {
        idx = this.stdoutBuffer.indexOf('\n')
        continue
      }
      let msg: { id?: unknown }
      try {
        msg = JSON.parse(line)
      } catch {
        log('stdout 非 JSON 行:', line.slice(0, 200))
        idx = this.stdoutBuffer.indexOf('\n')
        continue
      }
      if (msg.id === undefined || msg.id === null) {
        idx = this.stdoutBuffer.indexOf('\n')
        continue
      }
      const resolver = this.pending.get(msg.id)
      if (!resolver) {
        log('收到未匹配 id 的响应:', msg.id)
        idx = this.stdoutBuffer.indexOf('\n')
        continue
      }
      this.pending.delete(msg.id)
      resolver.resolve(msg)
      idx = this.stdoutBuffer.indexOf('\n')
    }
  }

  private onStderr(chunk: string): void {
    this.stderrBuffer += chunk
    let idx = this.stderrBuffer.indexOf('\n')
    while (idx >= 0) {
      const line = this.stderrBuffer.slice(0, idx).trim()
      this.stderrBuffer = this.stderrBuffer.slice(idx + 1)
      if (line) log('[blender-mcp]', line)
      idx = this.stderrBuffer.indexOf('\n')
    }
  }

  request(message: { id?: unknown } & Record<string, unknown>): Promise<unknown> {
    if (!this.running || !this.child?.stdin?.writable) {
      return Promise.resolve(
        rpcError(
          message.id ?? null,
          -32603,
          'blender-mcp 未运行（请先安装并启动 blender-mcp addon）'
        )
      )
    }
    return new Promise((resolve) => {
      const id = message.id
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve(rpcError(id, -32603, `blender-mcp 响应超时（>${REQUEST_TIMEOUT_MS / 1000}s）`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, {
        resolve: (msg) => {
          clearTimeout(timer)
          resolve(msg)
        }
      })
      try {
        this.child!.stdin!.write(JSON.stringify(message) + '\n')
      } catch (err) {
        clearTimeout(timer)
        this.pending.delete(id)
        resolve(
          rpcError(
            id,
            -32603,
            `写入 blender-mcp 失败: ${err instanceof Error ? err.message : String(err)}`
          )
        )
      }
    })
  }

  async stop(): Promise<void> {
    if (!this.child) return
    try {
      this.child.kill()
    } catch (err) {
      log('kill 失败:', err instanceof Error ? err.message : String(err))
    }
    this.child = null
    this.running = false
  }
}

function writeConfig(path: string, info: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(info, null, 2), 'utf8')
}

async function main(): Promise<void> {
  const configPath = process.env.AIAE_BLENDER_MCP_CONFIG || defaultConfigPath()
  const portBase = pickPort()
  const token = genToken()
  const command = pickCommand()
  const args = parseExtraArgs()
  const backend = new StdioMcpBackend({ command: command[0], args: [...command.slice(1), ...args] })
  const spawned = backend.spawn()
  const port = await findOpenPort(portBase)
  const info = {
    port,
    command: command.join(' '),
    args,
    blenderSpawned: spawned,
    token,
    startedAt: Date.now()
  }
  writeConfig(configPath, info)

  const server = createServer(async (req, res) => {
    if (token) {
      const auth = req.headers['authorization']
      if (auth !== `Bearer ${token}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'unauthorized' }))
        return
      }
    }
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, blenderRunning: backend.running }))
      return
    }
    if (req.method === 'GET' && req.url === '/mcp') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache'
      })
      return
    }
    if (req.method !== 'POST' || req.url !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }
    let raw: string
    try {
      raw = await readBody(req)
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify(
          rpcError(
            null,
            -32700,
            `读取请求体失败: ${err instanceof Error ? err.message : String(err)}`
          )
        )
      )
      return
    }
    let msg: { id?: unknown } & Record<string, unknown>
    try {
      msg = JSON.parse(raw)
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(rpcError(null, -32700, '请求体不是合法 JSON')))
      return
    }
    if (msg.id === undefined || msg.id === null) {
      try {
        backend.child?.stdin?.write(JSON.stringify(msg) + '\n')
      } catch (err) {
        log('写 notification 失败:', err instanceof Error ? err.message : String(err))
      }
      res.writeHead(202)
      res.end()
      return
    }
    const response = await backend.request(msg)
    if (!response) {
      res.writeHead(202)
      res.end()
      return
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Mcp-Session-Id': (req.headers['mcp-session-id'] as string) || ''
    })
    res.end(JSON.stringify(response))
  })

  server.listen(port, '127.0.0.1', () => {
    log(`bridge ready → http://127.0.0.1:${port}/mcp  (token ${token ? '已配置' : '未配置'})`)
    writeConfig(configPath, info)
  })

  const shutdown = async (): Promise<void> => {
    log('shutting down')
    await backend.stop()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 1000).unref()
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  String(process.argv[1] || '').endsWith('mcp-stdio-bridge.ts') ||
  String(process.argv[1] || '').endsWith('mcp-stdio-bridge.mjs')
if (isDirectRun && !process.env.AIAE_BRIDGE_TEST_NO_MAIN) {
  main().catch((err) => {
    log('启动失败:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}

// 注意：解析函数、findOpenPort、StdioMcpBackend 已在定义处 export；
// 此处只补 main 与 defaultConfigPath 的对外暴露。
export { main }
export { defaultConfigPath }
