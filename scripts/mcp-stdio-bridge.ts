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
 * 配置（环境变量，由 spawn 进程注入；不接受 shell env 覆盖）：
 *   AIAE_BLENDER_MCP_CMD            spawn 命令首段（默认 `uvx`）+ 后续参数（空格分隔，默认 `blender-mcp`）
 *   AIAE_BLENDER_MCP_PORT           桥监听端口（默认 43120，自动扫描 43120-43129）
 *   AIAE_BLENDER_MCP_TOKEN          Bearer token（缺省随机生成；写入 mcp-blender.json）
 *   AIAE_BLENDER_MCP_CONFIG         mcp-blender.json 输出路径（默认 <appData>/aiartengine/mcp-blender.json）
 *   AIAE_BLENDER_MCP_SERVER_HOST    透传给 blender-mcp 子进程的 BLENDER_HOST（默认 localhost）
 *   AIAE_BLENDER_MCP_SERVER_PORT    透传给 blender-mcp 子进程的 BLENDER_PORT（默认 9876）
 *   AIAE_BLENDER_MCP_SAFE_MODE      透传给 blender-mcp 子进程的 BLENDER_MCP_SAFE_MODE（默认 1）
 *
 * 以上 7 个 env 由主进程 src/main/services/mcpServerService.ts 翻译
 * settings.blenderMcp 后通过 spawn env 注入，本脚本不读 process.env 兜底。
 * 透传给 blender-mcp 子进程的环境变量（v1.9.x 参考 PyPI 官方页）：
 *   BLENDER_HOST=localhost          → blender-mcp 主动连 Blender Add-on 的 socket 主机
 *   BLENDER_PORT=9876               → blender-mcp 主动连 Blender Add-on 的 socket 端口
 *   BLENDER_MCP_SAFE_MODE=1         → 在 Blender 中执行脚本前做白名单检查（PyPI 推荐）
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
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { createServer, type IncomingMessage } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
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

/**
 * 把 `uvx` 这种 PATH 上的命令解析为绝对路径。
 *
 * Windows 上 Node 的 spawn 不走 PATHEXT（CreateProcessW 只接 .exe / 字面名字），
 * 即便 `where uvx` 找得到 `.bat` shim 也只能跑到 .exe。所以拿到一个 `uvx` 后
 * 必须先 `where` / `which` 转绝对路径，spawn 才有把握。
 *
 * `cmd` 已是绝对 / 相对路径时直接返回——用户显式填了路径就别再二次解析，避免
 * 干扰自定义解析逻辑（比如 .cmd shim 故意不放在 PATH 上）。
 *
 * 找不到 → 返回 null；调用方应该生成 friendly lastError，不要 spawn。
 */
export function resolveExecutable(cmd: string): string | null {
  const trimmed = cmd.trim()
  if (!trimmed) return null
  // 已经显式给路径（含 / 或 \，或 Windows drive letter C:）：直接用
  if (
    isAbsolute(trimmed) ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    /^[a-zA-Z]:/.test(trimmed)
  ) {
    return trimmed
  }
  try {
    if (process.platform === 'win32') {
      // where.exe 自带（Win 7+），成功时 stdout 列出所有匹配；空时 stderr 写
      // "INFO: Could not find files..."，exit code 1。我们靠 stdout 第一行判断。
      // PATHEXT 多匹配时返回多行，取第一行（最高优先级扩展名）。
      const stdout = execFileSync('where.exe', [trimmed], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        encoding: 'utf8'
      })
      const first = stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean)
      return first || null
    }
    // POSIX：which 在 macOS / Linux / WSL 都默认装
    const stdout = execFileSync('which', [trimmed], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8'
    })
    const first = stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean)
    return first || null
  } catch {
    return null
  }
}

const SERVER_HOST_DEFAULT = 'localhost'
const SERVER_PORT_DEFAULT = 9876
const SAFE_MODE_DEFAULT = '1'

/**
 * 收集 blender-mcp 子进程要继承的关键环境变量。
 * 三个变量全部以 `AIAE_BLENDER_MCP_SERVER_*` / `AIAE_BLENDER_MCP_SAFE_MODE` 为入口，
 * 避免用户把 `BLENDER_PORT=9876` 这种 env 前缀塞进 AIAE_BLENDER_MCP_ARGS（空格 split 会
 * 当成 CLI flag 丢给 spawn，子进程会报 unknown arg 立即退出）。
 */
export function pickServerEnv(): {
  BLENDER_HOST: string
  BLENDER_PORT: string
  BLENDER_MCP_SAFE_MODE: string
} {
  const hostRaw = process.env.AIAE_BLENDER_MCP_SERVER_HOST
  const portRaw = process.env.AIAE_BLENDER_MCP_SERVER_PORT
  const safeRaw = process.env.AIAE_BLENDER_MCP_SAFE_MODE

  const host = hostRaw && hostRaw.trim() ? hostRaw.trim() : SERVER_HOST_DEFAULT
  let port = String(SERVER_PORT_DEFAULT)
  if (portRaw) {
    const n = Number(portRaw)
    if (Number.isFinite(n) && n > 0 && n <= 65535) port = String(Math.floor(n))
  }
  // safe mode 默认开启：blender-mcp 会在 Blender 中无防护执行 LLM 生成代码，
  // 关闭等于主动绕过 PyPI 文档列出的白名单检查（文件 I/O、subprocess、网络、持久 hook）。
  const safe = safeRaw && /^(0|1)$/.test(safeRaw.trim()) ? safeRaw.trim() : SAFE_MODE_DEFAULT

  return {
    BLENDER_HOST: host,
    BLENDER_PORT: port,
    BLENDER_MCP_SAFE_MODE: safe
  }
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
  /** 解析后的命令绝对路径（spawn 时真正用的那个）；null 表示解析失败 */
  private resolvedCommand: string | null
  /** 不变字段快照，写 mcp-blender.json 时复用，避免每次重新序列化 */
  private infoBase: Record<string, unknown> | null = null
  /** mcp-blender.json 绝对路径；构造时由 main() 注入 */
  private configPath: string | null = null
  /** spawn 失败原因（ENOENT / unknown command / 信号退出等），写盘给 UI 调试 */
  private lastError: string | null = null
  private stdoutBuffer = ''
  private stderrBuffer = ''
  private pending = new Map<unknown, PendingResolver>()

  constructor(opts: {
    command: string
    args: string[]
    /** mcp-blender.json 路径；spawn() 会写两份：尝试 + 终态 */
    configPath: string
    /** 写盘时不变字段的快照（port / token / command / args / serverEnv / addonInstallHint） */
    infoBase: Record<string, unknown>
  }) {
    this.command = opts.command
    this.args = opts.args
    this.configPath = opts.configPath
    // 解析 PATH 上的命令为绝对路径；找不到时保留 null，让 spawn() 走友好报错路径
    // 而不是把 ENOENT 透到 UI。spawn() 写 lastError 时同时把 actionable 提示写进
    // mcp-blender.json 的 serverEnvHint，UI 可以直接渲染给用户看。
    this.resolvedCommand = resolveExecutable(opts.command)
    // 把解析结果回填 infoBase，让主进程 / UI 看到实际命令路径
    this.infoBase = { ...opts.infoBase, resolvedCommand: this.resolvedCommand }
  }

  /**
   * 启动 blender-mcp 子进程。Node 的 spawn 在 ENOENT 等错误时**不抛**而是异步 emit 'error'，
   * 因此 spawn() 返回 true 不代表子进程最终存活——这里把 mcp-blender.json 的写盘权收归
   * backend：先乐观写 spawned=true，on('error') / on('exit') 触发后覆盖写 spawned=false
   * 并附带 lastError。主进程轮询 mcp-blender.json 时读到的是终态值，避免 race。
   *
   * 路径解析失败的分支：构造时 resolveExecutable 已经把 uvx / blender-mcp 转成绝对路径，
   * 找不到时这里立刻 lastError + flushSnapshot + return false，不调用 spawn。
   */
  spawn(): boolean {
    if (!this.resolvedCommand) {
      // 构造时已尝试过 PATH 查找（Windows 不走 PATHEXT，POSIX 走 $PATH）。这里
      // 兜底：用户填的就是 uvx 这种纯名字且 PATH 找不到。给 actionable 提示，比
      // 裸 ENOENT 友好得多——把「去 settings 填绝对路径」的入口直接告诉用户。
      this.lastError =
        `找不到可执行文件 \`${this.command}\`：PATH 上无此命令，spawn 会报 ENOENT。\n` +
        `修复：\n` +
        `  1. 在「设置 → MCP → Blender MCP 桥」把启动命令改成 uvx 的绝对路径（Windows 默认 ` +
        `C:\\Users\\<user>\\.local\\bin\\uvx.exe，macOS / Linux 默认 ~/.local/bin/uv）；或\n` +
        `  2. 确认 PATH 含 .local/bin（uv 安装器一般会自动加，shell 重启后才生效）；或\n` +
        `  3. 装 blender-mcp 后用 pipx / pip：设置启动命令填 blender-mcp 的 Python 模块路径`
      log('spawn 前路径解析失败:', this.lastError.split('\n')[0])
      this.running = false
      this.flushSnapshot()
      return false
    }
    // 先乐观写一份「spawn 尝试了」的快照；后续事件回调再覆盖
    this.flushSnapshot()
    try {
      this.child = spawn(this.resolvedCommand, this.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...pickServerEnv() },
        windowsHide: true
      })
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err)
      log('spawn 失败:', this.lastError)
      this.running = false
      this.flushSnapshot()
      return false
    }
    this.running = true
    this.child.stdout?.setEncoding('utf8')
    this.child.stderr?.setEncoding('utf8')
    this.child.stdout?.on('data', (chunk: string) => this.onStdout(chunk))
    this.child.stderr?.on('data', (chunk: string) => this.onStderr(chunk))
    this.child.on('exit', (code, signal) => {
      // on('error') 已写入失败态时跳过，避免覆盖掉 ENOENT 等更具体原因
      if (this.running) {
        this.lastError = `blender-mcp 进程退出 code=${code} signal=${signal}`
        log(this.lastError)
      }
      this.running = false
      this.child = null
      this.flushSnapshot()
      for (const [id, resolver] of this.pending) {
        resolver.resolve(rpcError(id, -32603, 'blender-mcp 进程已退出'))
      }
      this.pending.clear()
    })
    this.child.on('error', (err) => {
      this.lastError = err.message
      log('blender-mcp 进程错误:', this.lastError)
      this.running = false
      this.flushSnapshot()
    })
    log(`已 spawn blender-mcp: ${this.resolvedCommand} ${this.args.join(' ')} (pid=${this.child.pid})`)
    return true
  }

  /**
   * 把当前状态写到 mcp-blender.json：spawned 由 this.running 决定，lastError 同步写入。
   * 主进程等待 mcp-blender.json 出现；race-free 因为 backend 是唯一写入者。
   */
  /** 公开：手动触发一次写盘（main 在 server.listen 回调里补 endpoint 用） */
  flushSnapshot(): void {
    if (!this.configPath || !this.infoBase) return
    const payload = {
      ...this.infoBase,
      blenderSpawned: this.running,
      lastError: this.lastError
    }
    try {
      mkdirSync(dirname(this.configPath), { recursive: true })
      writeFileSync(this.configPath, JSON.stringify(payload, null, 2), 'utf8')
    } catch (err) {
      log('写 mcp-blender.json 失败:', err instanceof Error ? err.message : String(err))
    }
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

async function main(): Promise<void> {
  const configPath = process.env.AIAE_BLENDER_MCP_CONFIG || defaultConfigPath()
  const portBase = pickPort()
  const token = genToken()
  const command = pickCommand()
  const args = parseExtraArgs()
  const serverEnv = pickServerEnv()
  const port = await findOpenPort(portBase)
  // infoBase 是 mcp-blender.json 中**不变**字段；backend 会在每次写盘时叠加
  // blenderSpawned（this.running 决定）和 lastError（错误信息）。main() 在 server.listen
  // 回调里再调一次 flushSnapshot 把 endpoint 补进去。
  const infoBase: Record<string, unknown> = {
    port,
    command: command.join(' '),
    args,
    token,
    startedAt: Date.now(),
    serverEnv,
    addonInstallHint: 'uvx blender-mcp install-addon'
  }
  const backend = new StdioMcpBackend({
    command: command[0],
    args: [...command.slice(1), ...args],
    configPath,
    infoBase
  })
  backend.spawn()

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
    // listen 成功时再补一字段；主进程轮询 mcp-blender.json 看到完整快照
    infoBase.endpoint = `http://127.0.0.1:${port}/mcp`
    backend.flushSnapshot()
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

// 注意：解析函数、findOpenPort、StdioMcpBackend、pickServerEnv 已在定义处 export；
// 此处只补 main 与 defaultConfigPath 的对外暴露。
export { main }
export { defaultConfigPath }
