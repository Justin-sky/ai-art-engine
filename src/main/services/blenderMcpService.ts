/**
 * Blender addon 的**应用内**接入层：直接以官方 addon 的 TCP 协议对话，不带外部运行时。
 *
 * ## 为什么这么改（参考 llama.cpp 式的 sidecar 取向）
 *
 * 旧链路是三层套娃：主进程 spawn 一个 Node 桥脚本 → 桥脚本再 spawn `uvx blender-mcp`
 * （Python）→ Python 进程再反向连 Blender addon。它要求用户机器上有 Python + uv，
 * 且要求 PATH 里正好有 uv 的安装目录（Windows 上 Node spawn 不走 PATHEXT，装好了也可能
 * ENOENT）；任何一环缺失，表现都是「工具面静默消失」，用户只能去看日志。桥与主进程之间还要
 * 靠写 `mcp-blender.json` + 5s 轮询来握手，端口、token 各一套。
 *
 * 现在只保留「一段进程内代码 + 一个 TCP 连接」：
 *
 *     dsh ──HTTP──▶ 主进程 /mcp/blender ──TCP──▶ Blender addon（localhost:9876）
 *
 * 于是 uv / Python / 端口池 / 握手文件 / 子进程崩溃全部消失，剩下的唯一外部前置是
 * **在 Blender 里启用 addon**——这一步无法替代，代码必须在 Blender 进程内执行。
 *
 * ## 与 addon 的协议（务必与 addon.py 对齐，不要凭直觉改）
 *
 * - **裸 JSON 帧，没有分隔符**：addon 侧是 `recv(8192)` 累积 + `json.loads` 成功即切帧，
 *   没有换行、没有长度前缀，所以**不能按行读**。这里按括号配平切帧（`takeJsonFrame`，
 *   纯函数、有单测），顺带处理「TCP 把两条应答粘进同一个 chunk」。
 *   见 `BlenderSocketClient.handleData`。
 * - **一条连接上一次只发一条命令**：addon 的应答没有请求 id，靠顺序对应。并发发命令会让
 *   应答错位，所以 `enqueue` 把请求串成队列。
 * - 超时后必须**丢弃这条连接**：帧边界未知，继续复用会把半截帧粘到下一条应答上。
 * - `execute_code` 失败走 `{"status":"error","message":"<嵌套 JSON>"}`，归一在
 *   `@shared/blenderMcp` 的 `parseBlenderReply`。
 */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createConnection, type Socket } from 'node:net'
import { basename, dirname, join } from 'node:path'
import { app } from 'electron'
import {
  BLENDER_ADDON_DEFAULT_HOST,
  BLENDER_ADDON_DEFAULT_PORT,
  BLENDER_COMMAND_TIMEOUT_MS,
  BLENDER_PING_TIMEOUT_MS,
  BLENDER_SCREENSHOT_MAX_BYTES,
  buildBlenderCommand,
  guardBlenderCode,
  parseBlenderReply,
  takeJsonFrame,
  type BlenderAddonType,
  type BlenderReply,
  type BlenderToolSpec
} from '@shared/blenderMcp'
import { classifyBlenderExportTarget } from '@shared/blenderExportPath'
import { resolveMediaOutputDir } from '@shared/domain'
import type { McpBlenderRestartInput } from '@shared/ipc'
import { uniqueFileName } from '../repositories/assetTreeStore'
import { mcpActivityService } from './mcpActivityService'
import { projectService } from './projectService'
import type { McpToolCallOutcome, McpToolImage } from '@shared/mcpProtocol'
import {
  buildOfficialProbeCode,
  buildOfficialToolCode,
  encodeOfficialExecute,
  officialExecuteStdout,
  takeNullFrame
} from '@shared/blenderOfficialTools'
import { settingsService } from './settingsService'

/** 探活结果缓存有效期：UI 每次拉状态都可能触发探活，5s 内复用缓存 */
const ADDON_PROBE_TTL_MS = 5_000

/** addon 探活用的命令：顺带把版本号取回来（只 ping 的话拿不到版本，UI 说不清「哪一端不对」） */
const ADDON_PROBE_COMMAND = 'get_addon_info'

/**
 * 本应用与 Blender addon 的连接状态。
 * `connected` 是**缓存值**：主进程侧同步读取（`getMcpServerInfo` 是同步的），
 * 真实探活在后台按 TTL 触发，因此 UI 首次读取多数时候会看到上一次的结果。
 */
export interface BlenderAddonLink {
  enabled: boolean
  host: string
  port: number
  safeMode: boolean
  addonType: BlenderAddonType
  connected: boolean
  blenderVersion: string | null
  addonVersion: string | null
  protocolVersion: string | null
  lastError: string | null
  /** 最近一次探活完成的时刻（ISO 字符串）；从未探活为 null */
  lastCheckedAt: string | null
}

let link: BlenderAddonLink = {
  enabled: true,
  host: BLENDER_ADDON_DEFAULT_HOST,
  port: BLENDER_ADDON_DEFAULT_PORT,
  safeMode: true,
  addonType: 'community',
  connected: false,
  blenderVersion: null,
  addonVersion: null,
  protocolVersion: null,
  lastError: null,
  lastCheckedAt: null
}

/** 探活是否在飞行中：避免 UI 连续刷新时堆出一串探活请求 */
let probeInFlight: Promise<BlenderAddonLink> | null = null
/** 飞行中探活的身份牌：只有它对应的那次探活才允许清空 probeInFlight */
let probeToken: object | null = null
let lastProbeAt = 0
/**
 * 探活世代。设置一变（改端口 / 重连 / 停服）就自增，让**飞行中的旧探活作废**：
 * 否则旧探活会带着「Blender 连接已重置」的失败结果写回 link，用户点完「应用并重连」
 * 反而先看到一个过期报错（要等下一个 TTL 才被覆盖）。
 */
let probeGeneration = 0

// --- TCP 客户端 -----------------------------------------------------------

class BlenderSocketClient {
  private socket: Socket | null = null
  private connecting: Promise<Socket> | null = null
  private buffer = ''
  private pending: {
    resolve: (raw: string) => void
    reject: (err: Error) => void
    timer: NodeJS.Timeout
  } | null = null
  /** 请求队列：addon 的应答没有请求 id，靠顺序对应，必须串行 */
  private chain: Promise<unknown> = Promise.resolve()
  /**
   * 帧方言：community = 括号配平的裸 JSON（addon.py）；official = `\0` 结尾的 execute 帧
   * （Blender Lab 官方扩展）。在每次发出请求前设定，与当次应答的切帧方式保持一致。
   */
  private frameMode: 'community' | 'official' = 'community'

  async request(
    command: string,
    params: Record<string, unknown>,
    timeoutMs: number
  ): Promise<string> {
    return this.enqueue(() => this.exchange(command, params, timeoutMs))
  }

  /** 官方扩展：execute 帧（代码整段下发，由扩展在 Blender 主线程执行后回 JSON） */
  async requestExecute(code: string, timeoutMs: number): Promise<string> {
    return this.enqueue(() => this.exchangeExecute(code, timeoutMs))
  }

  private enqueue(task: () => Promise<string>): Promise<string> {
    const run = this.chain.then(task, task)
    // 队列自身不能因单条命令失败而断掉：吞掉结果，只让调用方看到 reject
    this.chain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  /** 断开并复位：设置变更 / 退出时调用，下一次请求会按新目标重连 */
  reset(): void {
    const socket = this.socket
    this.socket = null
    this.connecting = null
    this.buffer = ''
    this.settlePending(new Error('Blender 连接已重置'))
    socket?.destroy()
  }

  private exchange(
    command: string,
    params: Record<string, unknown>,
    timeoutMs: number
  ): Promise<string> {
    this.frameMode = 'community'
    return this.connect()
      .then(
        (socket) =>
          new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => {
              // 帧边界已不可知，必须弃连接：否则半截帧会粘到下一条应答
              this.reset()
              reject(
                new Error(
                  `等待 ${command} 响应超时（${Math.round(timeoutMs / 1000)}s）：` +
                    'Blender 主线程可能正忙于渲染或执行长脚本，也可能是 addon 未启用。'
                )
              )
            }, timeoutMs)
            this.pending = { resolve, reject, timer }
            this.write(socket, { type: command, params })
          })
      )
      .catch((err: unknown) => {
        throw err instanceof Error ? err : new Error(String(err))
      })
  }

  /** 官方扩展的 exchange：`{"type":"execute","code":...,"strict_json":true}` + `\0` */
  private exchangeExecute(code: string, timeoutMs: number): Promise<string> {
    this.frameMode = 'official'
    return this.connect()
      .then(
        (socket) =>
          new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => {
              this.reset()
              reject(
                new Error(
                  `等待 execute 响应超时（${Math.round(timeoutMs / 1000)}s）：` +
                    'Blender 主线程可能正忙于渲染或执行长脚本；若持续超时，请确认 Blender Lab 官方' +
                    '「MCP Server」扩展已启用且监听端口与本应用设置一致。'
                )
              )
            }, timeoutMs)
            this.pending = { resolve, reject, timer }
            socket.write(encodeOfficialExecute(code), 'utf8', (err) => {
              if (err) this.failConnection(err)
            })
          })
      )
      .catch((err: unknown) => {
        throw err instanceof Error ? err : new Error(String(err))
      })
  }

  private write(socket: Socket, payload: Record<string, unknown>): void {
    socket.write(JSON.stringify(payload), 'utf8', (err) => {
      if (err) this.failConnection(err)
    })
  }

  private connect(): Promise<Socket> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve(this.socket)
    if (this.connecting) return this.connecting
    const target = `[${link.host}]:${link.port}`
    this.connecting = new Promise<Socket>((resolve, reject) => {
      const socket = createConnection({ host: link.host, port: link.port })
      const onError = (err: Error): void => {
        socket.removeAllListeners()
        socket.destroy()
        this.connecting = null
        reject(
          new Error(
            `无法连接 Blender addon（${target}）：${err.message}。` +
              '请确认 Blender 正在运行、已在 Preferences → Add-ons 中启用 MCP addon，且端口一致。'
          )
        )
      }
      // addon 未起时是 ECONNREFUSED；超时多为防火墙 / host 填错
      socket.setTimeout(BLENDER_PING_TIMEOUT_MS, () => onError(new Error('连接超时')))
      socket.once('error', onError)
      socket.once('connect', () => {
        socket.removeListener('error', onError)
        socket.setTimeout(0)
        socket.setEncoding('utf8')
        socket.on('data', (chunk: string) => this.handleData(chunk))
        socket.on('error', (err: Error) => this.failConnection(err))
        socket.on('close', () => this.failConnection(new Error('Blender 主动断开了连接')))
        this.socket = socket
        this.connecting = null
        resolve(socket)
      })
    })
    return this.connecting
  }

  /**
   * 帧累积：社区 addon.py 没有分隔符（既不发换行也不发长度头），只能按括号配平切帧
   * （`takeJsonFrame`，纯函数、有单测）；官方扩展用 `\0` 结尾（`takeNullFrame`）。
   * 保持 setEncoding('utf8') 是必要的——多字节字符被 TCP 拆包时由 StringDecoder 补齐，
   * 否则中文文件名 / print 输出会在帧中间变成乱码，JSON.parse 永远等不到完整帧，
   * 表现为「命令超时但其实 addon 已经回过了」。
   */
  private handleData(chunk: string): void {
    this.buffer += chunk
    for (;;) {
      const taken =
        this.frameMode === 'official' ? takeNullFrame(this.buffer) : takeJsonFrame(this.buffer)
      if (!taken) break // 帧还没收全，继续等
      this.buffer = taken.rest
      if (!this.pending) continue // 上一帧超时后的残留：丢弃，避免污染下一条应答
      let parsed: unknown
      try {
        parsed = JSON.parse(taken.frame)
      } catch {
        continue
      }
      if (
        parsed &&
        typeof parsed === 'object' &&
        (parsed as { status?: unknown }).status === 'progress'
      ) {
        // 进度帧（本应用涉及的命令目前都不发，但协议里留了口子）：不是终帧，继续等
        continue
      }
      const pending = this.pending
      this.pending = null
      clearTimeout(pending.timer)
      pending.resolve(taken.frame)
    }
  }

  private failConnection(err: Error): void {
    this.socket = null
    this.connecting = null
    this.buffer = ''
    this.settlePending(err)
  }

  private settlePending(err: Error): void {
    if (!this.pending) return
    const pending = this.pending
    this.pending = null
    clearTimeout(pending.timer)
    pending.reject(err)
  }
}

const client = new BlenderSocketClient()

// --- 设置同步 -------------------------------------------------------------

/** 从 settings 同步连接参数：host / port / addon 方言变化时顺带断开旧连接 */
function syncLinkFromSettings(): BlenderAddonLink {
  const cfg = settingsService.get().blenderMcp
  const host = cfg.serverHost.trim() || BLENDER_ADDON_DEFAULT_HOST
  const port = cfg.serverPort || BLENDER_ADDON_DEFAULT_PORT
  const addonType: BlenderAddonType = cfg.addonType === 'official' ? 'official' : 'community'
  const changed = host !== link.host || port !== link.port || addonType !== link.addonType
  link = {
    ...link,
    enabled: cfg.enabled,
    host,
    port,
    safeMode: cfg.safeMode,
    addonType
  }
  if (changed) {
    // 目标变了：旧连接与旧探活都作废，下一次请求重连
    client.reset()
    probeGeneration += 1
    probeInFlight = null
    probeToken = null
    link.connected = false
    link.lastError = null
    link.lastCheckedAt = null
    lastProbeAt = 0
  }
  return link
}

// --- 探活 -----------------------------------------------------------------

function statusFromReply(reply: BlenderReply): void {
  link.lastCheckedAt = new Date().toISOString()
  if (!reply.ok) {
    link.connected = false
    link.blenderVersion = null
    link.addonVersion = null
    link.protocolVersion = null
    link.lastError = reply.error ?? '未知错误'
    return
  }
  const payload = (reply.payload ?? {}) as Record<string, unknown>
  link.connected = true
  link.lastError = null
  link.blenderVersion = typeof payload.blender_version === 'string' ? payload.blender_version : null
  link.addonVersion = typeof payload.addon_version === 'string' ? payload.addon_version : null
  link.protocolVersion =
    typeof payload.protocol_version === 'string' ? payload.protocol_version : null
}

/** 探活一次：取 addon 版本 + 判定连通性；失败原因写进 link.lastError 供 UI 展示 */
export async function probeBlenderAddon(): Promise<BlenderAddonLink> {
  if (probeInFlight) return probeInFlight
  syncLinkFromSettings()
  if (!link.enabled) {
    link.connected = false
    link.lastError = null
    link.lastCheckedAt = new Date().toISOString()
    return { ...link }
  }
  const generation = probeGeneration
  const token = {}
  const task = (async (): Promise<BlenderAddonLink> => {
    try {
      const raw =
        link.addonType === 'official'
          ? await client.requestExecute(buildOfficialProbeCode(), BLENDER_PING_TIMEOUT_MS)
          : await client.request(ADDON_PROBE_COMMAND, {}, BLENDER_PING_TIMEOUT_MS)
      // 世代不符说明期间用户改了设置 / 点了重连：这次结果已经过期，丢掉而不是写回
      if (generation === probeGeneration) statusFromReply(parseBlenderReply(raw))
    } catch (err) {
      if (generation === probeGeneration) {
        statusFromReply({ ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    }
    return { ...link }
  })()
  probeInFlight = task
  probeToken = token
  void task.finally(() => {
    if (probeToken !== token) return // 已被新探活接管，别把它的 in-flight 标记清掉
    probeToken = null
    probeInFlight = null
    if (generation === probeGeneration) lastProbeAt = Date.now()
  })
  return task
}

/** 同步读取连接状态；顺带按 TTL 触发一次后台探活（UI 轮询即自动刷新） */
export function blenderAddonLink(): BlenderAddonLink {
  syncLinkFromSettings()
  if (link.enabled && !probeInFlight && Date.now() - lastProbeAt >= ADDON_PROBE_TTL_MS) {
    void probeBlenderAddon()
  }
  return { ...link }
}

/** dsh 侧是否应挂载 Blender 工具面 */
export function blenderMcpEnabled(): boolean {
  return syncLinkFromSettings().enabled
}

/** 设置面板提交：落盘 + 断开旧连接 + 立即重新探活（否则 UI 要等下一个 TTL 才刷新） */
export async function restartBlenderMcp(input: McpBlenderRestartInput): Promise<BlenderAddonLink> {
  const current = settingsService.get()
  const next = { ...current.blenderMcp }
  if (input?.enabled !== undefined) next.enabled = input.enabled
  if (input?.serverHost !== undefined) {
    const host = String(input.serverHost).trim()
    if (!host) throw new Error('Blender 主机不能为空')
    next.serverHost = host
  }
  if (input?.serverPort !== undefined) {
    const port = Math.trunc(Number(input.serverPort))
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      throw new Error('Blender 端口必须在 1–65535 之间')
    }
    next.serverPort = port
  }
  if (input?.safeMode !== undefined) next.safeMode = input.safeMode
  if (input?.addonType !== undefined) {
    if (input.addonType !== 'community' && input.addonType !== 'official') {
      throw new Error('Unsupported Blender addon type')
    }
    next.addonType = input.addonType
  }
  settingsService.set({ ...current, blenderMcp: next })
  // 旧连接与飞行中的旧探活一起作废，然后立刻探一次：否则用户要等下一个 TTL 才看到新状态
  client.reset()
  probeGeneration += 1
  probeInFlight = null
  probeToken = null
  lastProbeAt = 0
  link.lastCheckedAt = null
  return probeBlenderAddon()
}

/** 应用退出 / 服务关闭：断开 TCP，不留孤儿连接 */
export function stopBlenderMcp(): void {
  client.reset()
  probeGeneration += 1
  probeInFlight = null
  probeToken = null
  lastProbeAt = 0
  link.connected = false
}

// --- 工具执行 -------------------------------------------------------------

/**
 * 截图落盘目录。addon 只负责「往这个路径写文件」，读回 base64 由主进程做——
 * 与上游 Python server 用 tempfile 的做法等价，但不需要 Python 侧存在。
 */
function screenshotDir(): string {
  const dir = join(app.getPath('temp'), 'aiae-blender-shots')
  mkdirSync(dir, { recursive: true })
  return dir
}

function readScreenshot(path: string): {
  image: McpToolImage | null
  bytes: number
  note?: string
} {
  try {
    const size = statSync(path).size
    if (size <= 0) return { image: null, bytes: 0, note: '截图文件为空' }
    if (size > BLENDER_SCREENSHOT_MAX_BYTES) {
      return {
        image: null,
        bytes: size,
        note: `截图 ${size} 字节，超过 ${BLENDER_SCREENSHOT_MAX_BYTES} 字节上限，未随结果回传`
      }
    }
    return {
      image: { mimeType: 'image/png', data: readFileSync(path).toString('base64') },
      bytes: size
    }
  } catch (err) {
    return {
      image: null,
      bytes: 0,
      note: `读取截图失败：${err instanceof Error ? err.message : String(err)}`
    }
  }
}

function prepareExportSceneArgs(args: Record<string, unknown>): {
  args: Record<string, unknown>
  relativePath: string | null
  isJob: boolean
} {
  const requested = String(args.filepath ?? '').trim()
  if (!requested || !projectService.isOpen()) {
    return { args, relativePath: null, isJob: false }
  }
  const root = projectService.getRoot()
  const cacheOutputDir = projectService.getConfig()?.cacheOutputDir
  const classified = classifyBlenderExportTarget({
    requestedPath: requested,
    projectRoot: root,
    cacheOutputDir
  })
  if (classified.action === 'keep') {
    mkdirSync(dirname(join(root, classified.relativePath)), { recursive: true })
    return { args, relativePath: classified.relativePath, isJob: classified.isJob }
  }
  const destDirRel = resolveMediaOutputDir({ cacheOutputDir, kind: 'model' })
  const destDirAbs = join(root, destDirRel)
  mkdirSync(destDirAbs, { recursive: true })
  const fileName = uniqueFileName(destDirAbs, classified.fileName)
  const relativePath = `${destDirRel}/${fileName}`.replace(/\\/g, '/')
  return {
    args: { ...args, filepath: join(root, relativePath) },
    relativePath,
    isJob: false
  }
}

function publishChatModelExport(relativePath: string): void {
  const activityId = mcpActivityService.begin({
    tool: 'blender_export',
    title: basename(relativePath)
  })
  mcpActivityService.end(activityId, { ok: true, relativePath })
}

/**
 * 执行一条 Blender 工具调用：护栏 → addon 命令 → 应答归一 → （截图类）读回图片。
 * 协议层（模式授权、审计、JSON-RPC 包装）留在 mcpServerService。
 */
export async function runBlenderTool(
  spec: BlenderToolSpec,
  args: Record<string, unknown>
): Promise<McpToolCallOutcome> {
  const cfg = syncLinkFromSettings()
  if (!cfg.enabled) {
    return { error: 'Blender 工具已在设置中禁用（设置 → MCP 工具服务 → Blender）' }
  }

  const exportPrepared =
    spec.command === 'export_scene' ? prepareExportSceneArgs(args) : null
  const toolArgs = exportPrepared?.args ?? args

  if (spec.command === 'execute_code' && cfg.safeMode) {
    const verdict = guardBlenderCode(String(toolArgs.code ?? ''))
    if (!verdict.ok) {
      // 拒绝理由写给模型看：它需要据此改写脚本，而不是重试同一段代码
      return { error: `代码护栏拦截：${verdict.reason}` }
    }
  }

  const shotPath = spec.screenshot ? join(screenshotDir(), `viewport-${randomUUID()}.png`) : ''
  let raw: string
  try {
    if (cfg.addonType === 'official') {
      // 官方后端：同一套白名单校验后编成 Python execute 帧
      raw = await client.requestExecute(
        buildOfficialToolCode(spec, toolArgs, { screenshotFilepath: shotPath }),
        BLENDER_COMMAND_TIMEOUT_MS
      )
    } else {
      const { type, params } = buildBlenderCommand(spec, toolArgs, {
        screenshotFilepath: shotPath
      })
      raw = await client.request(type, params, BLENDER_COMMAND_TIMEOUT_MS)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    link.connected = false
    link.lastError = message
    link.lastCheckedAt = new Date().toISOString()
    return { error: message }
  }

  const reply = parseBlenderReply(raw)
  // 真实命令的成败同样入缓存：UI 不必等下一次探活就能看到「连不上」的真实原因
  if (spec.command === ADDON_PROBE_COMMAND) {
    statusFromReply(reply)
  } else if (reply.ok) {
    link.connected = true
    link.lastError = null
    link.lastCheckedAt = new Date().toISOString()
  }

  if (!reply.ok) return { error: reply.error ?? 'Blender 命令失败' }

  // 官方后端的 execute_code：print 输出随应答的 stdout 字段返回，补齐「print 原样返回」契约
  if (cfg.addonType === 'official' && spec.command === 'execute_code') {
    const stdout = officialExecuteStdout(raw)
    const payload =
      reply.payload && typeof reply.payload === 'object' && Object.keys(reply.payload).length
        ? { returned: reply.payload }
        : {}
    return { result: { result: stdout ?? '', ...payload } }
  }

  if (!spec.screenshot) {
    if (
      spec.command === 'export_scene' &&
      exportPrepared?.relativePath &&
      !exportPrepared.isJob
    ) {
      publishChatModelExport(exportPrepared.relativePath)
      const payload =
        reply.payload && typeof reply.payload === 'object'
          ? { ...(reply.payload as Record<string, unknown>) }
          : {}
      return {
        result: {
          ...payload,
          relativePath: exportPrepared.relativePath,
          exportedPath: toolArgs.filepath
        }
      }
    }
    return { result: reply.payload ?? null }
  }

  const payload =
    reply.payload && typeof reply.payload === 'object'
      ? ({ ...(reply.payload as Record<string, unknown>) } as Record<string, unknown>)
      : {}
  // filepath 是主进程的临时文件，对模型没有意义，去掉以免它去猜路径
  delete payload.filepath
  const { image, bytes, note } = existsSync(shotPath)
    ? readScreenshot(shotPath)
    : { image: null, bytes: 0 as number, note: 'addon 未写出截图文件' }
  // 一次性文件：读回 base64 后立刻删，临时目录不会随调用次数堆积（画面只随响应回传）
  try {
    rmSync(shotPath, { force: true })
  } catch {
    // 删不掉也无所谓：文件名带 uuid，不会覆盖下一次截图
  }
  payload.screenshot = { format: 'png', bytes, ...(note ? { note } : {}) }
  return image ? { result: payload, images: [image] } : { result: payload }
}
