import axios, {
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig
} from 'axios'
import { execFile } from 'node:child_process'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import type { Duplex } from 'node:stream'
import tls from 'node:tls'
import * as electron from 'electron'

/**
 * 主进程出站 HTTP/HTTPS 系统代理感知、死代理直连回退与握手闪断重试传输层。
 *
 * 背景：
 * 1. Windows / macOS 桌面代理工具（Clash / Mihomo / v2rayN / Surge 等）通常设置系统代理
 *    （如 Windows WinINET `ProxyEnable=1` + `ProxyServer=127.0.0.1:7890` 或 PAC），而不会注入
 *    Node.js 所需的 `HTTPS_PROXY` / `HTTP_PROXY` 环境变量；
 * 2. Electron 主进程内的 `axios`（默认走 Node `http`/`https`）和 `globalThis.fetch`（`undici`）
 *    默认完全忽略系统代理，导致访问 `api.openai.com`、`generativelanguage.googleapis.com`、
 *    `openrouter.ai` 等海外接口时直连触发 `ECONNRESET | Client network socket disconnected before secure TLS connection was established`；
 * 3. 反过来，若用户关闭代理软件但未关闭注册表 `ProxyEnable=1`（死代理残留），盲目走代理又会导致国内接口报 `ECONNREFUSED`；
 * 4. 网关或代理节点偶发空闲连接回收 / TLS 握手闪断时，请求尚未到达上游，应当自动换新连接重试。
 */

export type ResolvedProxyCandidate =
  | { kind: 'direct' }
  | { kind: 'http'; proxyUrl: string }
  | { kind: 'https'; proxyUrl: string }
  | { kind: 'socks'; proxyUrl: string }

export interface WindowsSystemProxySnapshot {
  enabled: boolean
  httpProxy?: string
  httpsProxy?: string
  socksProxy?: string
  proxyOverride?: string
}

type ElectronNamespaceLike = {
  app?: { isReady?: () => boolean }
  session?: { defaultSession?: { resolveProxy?: (url: string) => Promise<string> } }
  net?: { fetch?: typeof globalThis.fetch }
}

function getElectronRuntime(): ElectronNamespaceLike | null {
  const mod = electron as unknown as ElectronNamespaceLike | string | null
  if (!mod || typeof mod !== 'object') return null
  if (typeof mod.app?.isReady !== 'function') return null
  return mod
}

function isElectronAppReady(): boolean {
  try {
    const rt = getElectronRuntime()
    return Boolean(rt?.app?.isReady?.())
  } catch {
    return false
  }
}

function normalizeProxyEndpoint(raw: string, defaultScheme: 'http' | 'https' | 'socks5'): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed
  return `${defaultScheme}://${trimmed}`
}

/**
 * 解析 Chromium / Electron `session.resolveProxy(url)` 返回的 PAC 指令串。
 * 例如：`"PROXY 127.0.0.1:7890; DIRECT"`、`"HTTPS proxy.corp:443"`、`"SOCKS5 127.0.0.1:7891"`。
 */
export function parseChromiumProxyDirective(directive: string): ResolvedProxyCandidate[] {
  const text = (directive || '').trim()
  if (!text) return [{ kind: 'direct' }]

  const out: ResolvedProxyCandidate[] = []
  const seen = new Set<string>()
  const push = (item: ResolvedProxyCandidate): void => {
    const key = item.kind === 'direct' ? 'direct' : `${item.kind}:${item.proxyUrl}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(item)
  }

  for (const part of text.split(';')) {
    const seg = part.trim()
    if (!seg) continue
    if (/^DIRECT$/i.test(seg)) {
      push({ kind: 'direct' })
      continue
    }
    const m = /^(PROXY|HTTP|HTTPS|SOCKS5|SOCKS4|SOCKS)\s+(.+)$/i.exec(seg)
    if (!m) continue
    const token = m[1]!.toUpperCase()
    const hostPort = m[2]!.trim()
    if (!hostPort) continue
    if (token === 'HTTPS') {
      const proxyUrl = normalizeProxyEndpoint(hostPort, 'https')
      if (proxyUrl) push({ kind: 'https', proxyUrl })
    } else if (token === 'SOCKS5' || token === 'SOCKS4' || token === 'SOCKS') {
      const proxyUrl = normalizeProxyEndpoint(hostPort, 'socks5')
      if (proxyUrl) push({ kind: 'socks', proxyUrl })
    } else {
      const proxyUrl = normalizeProxyEndpoint(hostPort, 'http')
      if (proxyUrl) push({ kind: 'http', proxyUrl })
    }
  }

  return out.length > 0 ? out : [{ kind: 'direct' }]
}

/**
 * 解析 Windows 注册表 `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings` 输出。
 */
export function parseWindowsRegInternetSettings(regOutput: string): WindowsSystemProxySnapshot {
  const lines = (regOutput || '').split(/\r?\n/)
  let enabled = false
  let rawServer = ''
  let proxyOverride = ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const enableMatch = /^ProxyEnable\s+REG_DWORD\s+(.+)$/i.exec(trimmed)
    if (enableMatch) {
      const num = Number(enableMatch[1]!.trim())
      enabled = Number.isFinite(num) && num !== 0
      continue
    }
    const serverMatch = /^ProxyServer\s+REG_SZ\s+(.+)$/i.exec(trimmed)
    if (serverMatch) {
      rawServer = serverMatch[1]!.trim()
      continue
    }
    const overrideMatch = /^ProxyOverride\s+REG_SZ\s+(.+)$/i.exec(trimmed)
    if (overrideMatch) {
      proxyOverride = overrideMatch[1]!.trim()
    }
  }

  if (!enabled || !rawServer) {
    return { enabled: false }
  }

  const snap: WindowsSystemProxySnapshot = {
    enabled: true,
    ...(proxyOverride ? { proxyOverride } : {})
  }

  if (rawServer.includes('=')) {
    for (const entry of rawServer.split(';')) {
      const eqIdx = entry.indexOf('=')
      if (eqIdx <= 0) continue
      const schemeKey = entry.slice(0, eqIdx).trim().toLowerCase()
      const val = entry.slice(eqIdx + 1).trim()
      if (!val) continue
      if (schemeKey === 'http') {
        snap.httpProxy = normalizeProxyEndpoint(val, 'http')
      } else if (schemeKey === 'https') {
        snap.httpsProxy = normalizeProxyEndpoint(val, 'http')
      } else if (schemeKey === 'socks' || schemeKey === 'socks5' || schemeKey === 'socks4') {
        snap.socksProxy = normalizeProxyEndpoint(val, 'socks5')
      }
    }
  } else {
    if (/^socks/i.test(rawServer)) {
      snap.socksProxy = normalizeProxyEndpoint(rawServer, 'socks5')
    } else {
      const normalized = normalizeProxyEndpoint(rawServer, 'http')
      snap.httpProxy = normalized
      snap.httpsProxy = normalized
    }
  }

  if (!snap.httpProxy && !snap.httpsProxy && !snap.socksProxy) {
    return { enabled: false }
  }
  return snap
}

let cachedWinProxy: { at: number; value: WindowsSystemProxySnapshot | null } | null = null
let pendingWinProxyPromise: Promise<WindowsSystemProxySnapshot | null> | null = null
const WIN_PROXY_CACHE_TTL_MS = 10_000

export function readWindowsSystemProxy(
  ttlMs = WIN_PROXY_CACHE_TTL_MS
): Promise<WindowsSystemProxySnapshot | null> {
  if (process.platform !== 'win32') return Promise.resolve(null)
  const now = Date.now()
  if (cachedWinProxy && now - cachedWinProxy.at < ttlMs) {
    return Promise.resolve(cachedWinProxy.value)
  }
  if (pendingWinProxyPromise) return pendingWinProxyPromise

  pendingWinProxyPromise = new Promise<WindowsSystemProxySnapshot | null>((resolve) => {
    execFile(
      'reg',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],
      { windowsHide: true, timeout: 1500 },
      (err, stdout) => {
        pendingWinProxyPromise = null
        if (err || typeof stdout !== 'string') {
          cachedWinProxy = { at: Date.now(), value: null }
          resolve(null)
          return
        }
        const parsed = parseWindowsRegInternetSettings(stdout)
        cachedWinProxy = { at: Date.now(), value: parsed }
        resolve(parsed)
      }
    )
  })
  return pendingWinProxyPromise
}

function isPrivateOrLoopbackIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  if (a === 127 || a === 10 || a === 0) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}

function matchNoProxyRule(hostname: string, rawRule: string): boolean {
  const rule = rawRule.trim().toLowerCase()
  if (!rule) return false
  if (rule === '*') return true
  if (rule === '<local>') return !hostname.includes('.')

  // 去掉可选端口（如 `example.com:443`）
  const ruleHost = rule.replace(/:\d+$/, '')
  if (!ruleHost) return false

  if (ruleHost.includes('*')) {
    const escaped = ruleHost.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
    return new RegExp(`^${escaped}$`, 'i').test(hostname)
  }

  if (ruleHost.startsWith('.')) {
    const suffix = ruleHost.slice(1)
    return hostname === suffix || hostname.endsWith(ruleHost)
  }

  return hostname === ruleHost || hostname.endsWith(`.${ruleHost}`)
}

/**
 * 判断目标主机是否属于本地环回、局域网私有网段或 `NO_PROXY` / `ProxyOverride` 豁免名单。
 * 本地服务（ComfyUI、Ollama、vLLM、Vitest `127.0.0.1` 测试桩）严禁走代理。
 */
export function isBypassedLocalOrNoProxyHost(hostname: string, noProxyList?: string): boolean {
  const host = (hostname || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
  if (!host) return true
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '::1' ||
    host === '0:0:0:0:0:0:0:1' ||
    isPrivateOrLoopbackIpv4(host)
  ) {
    return true
  }

  if (noProxyList) {
    for (const token of noProxyList.split(/[,;]/)) {
      if (matchNoProxyRule(host, token)) return true
    }
  }
  return false
}

export interface ResolveProxyOptions {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  chromiumResolveProxy?: (url: string) => Promise<string>
  windowsProxyReader?: () => Promise<WindowsSystemProxySnapshot | null>
}

/**
 * 按优先级解析目标 URL 应走的代理候选链：
 * 1. 本地 / 内网 / `NO_PROXY` → `[{ kind: 'direct' }]`
 * 2. 显式环境变量 `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY`（失败可回退 `direct`）
 * 3. Electron Chromium `session.defaultSession.resolveProxy(url)`（支持 PAC / WinINET / macOS 系统代理）
 * 4. Windows 注册表 `Internet Settings` 兜底（非 Electron 进程或窗口尚未就绪时同样生效）
 */
export async function resolveProxyCandidatesForUrl(
  targetUrl: string,
  options: ResolveProxyOptions = {}
): Promise<ResolvedProxyCandidate[]> {
  let parsed: URL
  try {
    parsed = new URL(targetUrl)
  } catch {
    return [{ kind: 'direct' }]
  }

  const protocol = parsed.protocol.toLowerCase()
  if (protocol !== 'http:' && protocol !== 'https:') {
    return [{ kind: 'direct' }]
  }

  const env = options.env ?? process.env
  const noProxy = env.NO_PROXY || env.no_proxy || ''
  if (isBypassedLocalOrNoProxyHost(parsed.hostname, noProxy)) {
    return [{ kind: 'direct' }]
  }

  const envProxyRaw =
    (protocol === 'https:'
      ? env.HTTPS_PROXY || env.https_proxy
      : env.HTTP_PROXY || env.http_proxy) ||
    env.ALL_PROXY ||
    env.all_proxy ||
    ''

  if (envProxyRaw.trim()) {
    const normalized = /^socks/i.test(envProxyRaw.trim())
      ? normalizeProxyEndpoint(envProxyRaw, 'socks5')
      : normalizeProxyEndpoint(envProxyRaw, 'http')
    const kind: ResolvedProxyCandidate['kind'] = /^socks/i.test(normalized)
      ? 'socks'
      : /^https:/i.test(normalized)
        ? 'https'
        : 'http'
    return [{ kind, proxyUrl: normalized } as ResolvedProxyCandidate, { kind: 'direct' }]
  }

  const chromiumResolver =
    options.chromiumResolveProxy ??
    (isElectronAppReady()
      ? (url: string) => {
          const fn = getElectronRuntime()?.session?.defaultSession?.resolveProxy
          return fn ? fn(url) : Promise.resolve('DIRECT')
        }
      : undefined)

  if (chromiumResolver) {
    try {
      const directive = await chromiumResolver(targetUrl)
      const candidates = parseChromiumProxyDirective(directive)
      const hasDirect = candidates.some((c) => c.kind === 'direct')
      return hasDirect ? candidates : [...candidates, { kind: 'direct' }]
    } catch {
      /* fall through to OS fallback */
    }
  }

  const platform = options.platform ?? process.platform
  if (platform === 'win32') {
    const reader = options.windowsProxyReader ?? readWindowsSystemProxy
    const snap = await reader()
    if (snap?.enabled) {
      if (snap.proxyOverride && isBypassedLocalOrNoProxyHost(parsed.hostname, snap.proxyOverride)) {
        return [{ kind: 'direct' }]
      }
      const chosen = protocol === 'https:' ? snap.httpsProxy || snap.httpProxy : snap.httpProxy
      if (chosen) {
        const kind: 'http' | 'https' = /^https:/i.test(chosen) ? 'https' : 'http'
        return [{ kind, proxyUrl: chosen }, { kind: 'direct' }]
      }
      if (snap.socksProxy) {
        return [{ kind: 'socks', proxyUrl: snap.socksProxy }, { kind: 'direct' }]
      }
    }
  }

  return [{ kind: 'direct' }]
}

/** 检测当前 Node 运行时的 `http.Agent` 是否原生支持 Node 22.21+ / 24+ 的 `proxyEnv` 隧道 */
let cachedNativeProxyEnvSupport: boolean | null = null
function supportsNativeAgentProxyEnv(): boolean {
  if (cachedNativeProxyEnvSupport !== null) return cachedNativeProxyEnvSupport
  try {
    const probe = new http.Agent({
      proxyEnv: { HTTP_PROXY: 'http://127.0.0.1:1' }
    } as http.AgentOptions & { proxyEnv: Record<string, string> })
    cachedNativeProxyEnvSupport = Object.getOwnPropertySymbols(probe).some((sym) =>
      String(sym).includes('ProxyConfig')
    )
    probe.destroy()
  } catch {
    cachedNativeProxyEnvSupport = false
  }
  return cachedNativeProxyEnvSupport
}

/**
 * 兼容旧版 Node（无 `proxyEnv` 时）的纯内置 HTTPS `CONNECT` 隧道 Agent。
 */
class FallbackHttpsConnectProxyAgent extends https.Agent {
  private readonly proxyUrl: URL

  constructor(proxyUrl: string, opts: https.AgentOptions) {
    super(opts)
    this.proxyUrl = new URL(proxyUrl)
  }

  override createConnection(
    options: https.RequestOptions,
    callback?: (err: Error | null, stream: Duplex) => void
  ): Duplex | null | undefined {
    const targetHost = String(options.host || options.hostname || 'localhost')
    const targetPort = Number(options.port || 443)
    const proxyPort = Number(this.proxyUrl.port || (this.proxyUrl.protocol === 'https:' ? 443 : 80))
    const proxyHost = this.proxyUrl.hostname
    const proxySocket =
      this.proxyUrl.protocol === 'https:'
        ? tls.connect({ host: proxyHost, port: proxyPort, servername: proxyHost })
        : net.connect({ host: proxyHost, port: proxyPort })

    let settled = false
    const finish = (err: Error | null, tlsSocket?: Duplex): void => {
      if (settled) return
      settled = true
      if (err || !tlsSocket) {
        proxySocket.destroy()
        callback?.(err ?? new Error('Proxy tunnel socket missing'), undefined as unknown as Duplex)
        return
      }
      callback?.(null, tlsSocket)
    }

    proxySocket.once('error', (err) => finish(err))
    proxySocket.once('connect', () => {
      const headers = [
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1`,
        `Host: ${targetHost}:${targetPort}`
      ]
      if (this.proxyUrl.username || this.proxyUrl.password) {
        const rawAuth = `${decodeURIComponent(this.proxyUrl.username)}:${decodeURIComponent(this.proxyUrl.password)}`
        headers.push(
          `Proxy-Authorization: Basic ${Buffer.from(rawAuth, 'utf8').toString('base64')}`
        )
      }
      headers.push('Proxy-Connection: Keep-Alive', '', '')
      proxySocket.write(headers.join('\r\n'))

      let headerBuf = ''
      const onData = (chunk: Buffer): void => {
        headerBuf += chunk.toString('latin1')
        const endIdx = headerBuf.indexOf('\r\n\r\n')
        if (endIdx < 0) return
        proxySocket.removeListener('data', onData)
        const statusLine = headerBuf.slice(0, headerBuf.indexOf('\r\n'))
        const statusMatch = /^HTTP\/1\.[01]\s+(\d{3})/i.exec(statusLine)
        const code = statusMatch ? Number(statusMatch[1]) : 0
        if (code !== 200) {
          const tunnelErr = Object.assign(
            new Error(`Failed to establish tunnel to ${targetHost}:${targetPort}: ${statusLine}`),
            { code: 'ERR_PROXY_TUNNEL', statusCode: code || undefined }
          )
          finish(tunnelErr)
          return
        }
        const tlsOpts = options as tls.ConnectionOptions
        const tlsSocket = tls.connect({
          socket: proxySocket,
          servername: typeof tlsOpts.servername === 'string' ? tlsOpts.servername : targetHost,
          rejectUnauthorized: tlsOpts.rejectUnauthorized !== false
        })
        tlsSocket.once('error', (tlsErr) => finish(tlsErr))
        finish(null, tlsSocket)
      }
      proxySocket.on('data', onData)
    })

    // 标记等待异步 callback，避免 http.Agent.createSocket 同步提前注册未完成握手的原始 socket
    return undefined
  }
}

type AgentPair = { httpAgent: http.Agent; httpsAgent: https.Agent }
const pooledProxyAgents = new Map<string, AgentPair>()
const directPooledAgents: AgentPair = {
  httpAgent: new http.Agent({ keepAlive: true, maxSockets: 64 }),
  httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 64 })
}

function buildAgentPair(proxyUrl: string | null, keepAlive: boolean): AgentPair {
  if (!proxyUrl) {
    if (keepAlive) return directPooledAgents
    return {
      httpAgent: new http.Agent({ keepAlive: false }),
      httpsAgent: new https.Agent({ keepAlive: false })
    }
  }

  const cacheKey = `${proxyUrl}::${keepAlive ? 'ka' : 'fresh'}`
  if (keepAlive) {
    const hit = pooledProxyAgents.get(cacheKey)
    if (hit) return hit
  }

  const proxyEnv = {
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    NO_PROXY: 'localhost,127.0.0.1,::1'
  }
  const pair: AgentPair = supportsNativeAgentProxyEnv()
    ? {
        httpAgent: new http.Agent({
          keepAlive,
          maxSockets: 64,
          proxyEnv
        } as http.AgentOptions & { proxyEnv: Record<string, string> }),
        httpsAgent: new https.Agent({
          keepAlive,
          maxSockets: 64,
          proxyEnv
        } as https.AgentOptions & { proxyEnv: Record<string, string> })
      }
    : {
        httpAgent: new http.Agent({ keepAlive }),
        httpsAgent: new FallbackHttpsConnectProxyAgent(proxyUrl, { keepAlive })
      }

  if (keepAlive) {
    pooledProxyAgents.set(cacheKey, pair)
  }
  return pair
}

/** 死代理负缓存（当本地代理软件已退出但注册表残留 `ProxyEnable=1` 时，15s 内免重复碰壁） */
const deadProxyCooldownUntil = new Map<string, number>()
const DEAD_PROXY_COOLDOWN_MS = 15_000

function isProxyCoolingDown(proxyUrl: string): boolean {
  const until = deadProxyCooldownUntil.get(proxyUrl)
  if (!until) return false
  if (Date.now() < until) return true
  deadProxyCooldownUntil.delete(proxyUrl)
  return false
}

function markProxyDead(proxyUrl: string): void {
  deadProxyCooldownUntil.set(proxyUrl, Date.now() + DEAD_PROXY_COOLDOWN_MS)
}

export function clearProxyTransportCachesForTests(): void {
  deadProxyCooldownUntil.clear()
  cachedWinProxy = null
  for (const pair of pooledProxyAgents.values()) {
    pair.httpAgent.destroy()
    pair.httpsAgent.destroy()
  }
  pooledProxyAgents.clear()
}

function extractErrorCodesAndMessage(err: unknown): { codes: string[]; message: string } {
  if (!err || typeof err !== 'object') {
    return { codes: [], message: String(err ?? '') }
  }
  const obj = err as {
    code?: unknown
    message?: unknown
    cause?: { code?: unknown; message?: unknown }
  }
  const codes: string[] = []
  if (typeof obj.code === 'string' && obj.code) codes.push(obj.code.toUpperCase())
  if (typeof obj.cause?.code === 'string' && obj.cause.code) {
    codes.push(obj.cause.code.toUpperCase())
  }
  const message = [
    typeof obj.message === 'string' ? obj.message : '',
    typeof obj.cause?.message === 'string' ? obj.cause.message : ''
  ]
    .filter(Boolean)
    .join(' | ')
  return { codes, message }
}

/**
 * 判断错误是否为本地代理自身不可达（如 Clash 已退出导致 `127.0.0.1:7890` `ECONNREFUSED`）。
 */
export function isLocalProxyConnectFailure(err: unknown): boolean {
  if (axios.isAxiosError(err) && err.response) return false
  const { codes, message } = extractErrorCodesAndMessage(err)
  if (codes.includes('ECONNREFUSED') || codes.includes('ERR_PROXY_TUNNEL')) {
    return true
  }
  return /ECONNREFUSED|Failed to establish tunnel|Connection to establish proxy tunnel timed out/i.test(
    message
  )
}

/**
 * 判断错误是否为收到 HTTP 响应之前的瞬时网络 / TLS 握手闪断，可安全换新连接重试。
 */
export function isPreResponseTransientSocketError(err: unknown): boolean {
  if (!err) return false
  if (axios.isAxiosError(err)) {
    if (err.response) return false
    if (err.code === 'ERR_CANCELED') return false
  }
  if (err instanceof Error && err.name === 'AbortError') return false

  const { codes, message } = extractErrorCodesAndMessage(err)
  const retryableCodes = new Set([
    'ECONNRESET',
    'ETIMEDOUT',
    'EAI_AGAIN',
    'EPIPE',
    'ECONNABORTED',
    'UND_ERR_SOCKET',
    'UND_ERR_CONNECT_TIMEOUT'
  ])
  for (const code of codes) {
    if (retryableCodes.has(code)) return true
  }
  return /socket disconnected before secure TLS connection|socket hang up|ECONNRESET|ETIMEDOUT|EAI_AGAIN|TLS handshake|network error|fetch failed/i.test(
    message
  )
}

function isCallerAborted(config: InternalAxiosRequestConfig): boolean {
  const sig = config.signal as AbortSignal | undefined
  if (sig?.aborted) return true
  const cancelToken = config.cancelToken as { reason?: unknown } | undefined
  return Boolean(cancelToken?.reason)
}

function resolveFullAxiosUrl(config: InternalAxiosRequestConfig): string {
  const rawUrl = (config.url || '').trim()
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rawUrl)) return rawUrl
  const base = (config.baseURL || '').trim()
  if (!base) return rawUrl
  if (!rawUrl) return base
  return `${base.replace(/\/+$/, '')}/${rawUrl.replace(/^\/+/, '')}`
}

function abortableDelay(ms: number, config: InternalAxiosRequestConfig): Promise<void> {
  if (ms <= 0 || isCallerAborted(config)) return Promise.resolve()
  const sig = config.signal as AbortSignal | undefined
  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      sig?.removeEventListener?.('abort', onAbort)
      resolve()
    }, ms)
    sig?.addEventListener?.('abort', onAbort, { once: true })
  })
}

export interface ResilientAdapterOptions extends ResolveProxyOptions {
  retryDelaysMs?: readonly number[]
  fallbackFetchAdapter?: AxiosAdapter | null
}

/**
 * 为 `axios` 构建具备「系统代理隧道 + 死代理自动直连回退 + 握手重置重试」的弹性适配器。
 */
export function createResilientAxiosAdapter(
  baseHttpAdapter: AxiosAdapter,
  options: ResilientAdapterOptions = {}
): AxiosAdapter {
  const retryDelaysMs = options.retryDelaysMs ?? [450, 1200]

  return async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    // 若调用方已显式注入自定义 Agent，尊重原样不覆盖
    if (config.httpAgent || config.httpsAgent) {
      return baseHttpAdapter(config)
    }

    const fullUrl = resolveFullAxiosUrl(config)
    const candidates = await resolveProxyCandidatesForUrl(fullUrl, options)
    let lastError: unknown

    for (const candidate of candidates) {
      if (isCallerAborted(config)) break

      if (candidate.kind === 'socks') {
        // SOCKS5 代理由 Chromium 原生网络栈（fetch 适配器 + electron.net.fetch）承载
        const fetchAdapter =
          options.fallbackFetchAdapter !== undefined
            ? options.fallbackFetchAdapter
            : isElectronAppReady() &&
                config.responseType !== 'stream' &&
                typeof axios.getAdapter === 'function'
              ? axios.getAdapter('fetch')
              : null
        if (fetchAdapter) {
          try {
            return await fetchAdapter({ ...config, proxy: false })
          } catch (err) {
            lastError = err
            continue
          }
        }
        continue
      }

      const proxyUrl =
        candidate.kind === 'http' || candidate.kind === 'https' ? candidate.proxyUrl : null
      if (proxyUrl && isProxyCoolingDown(proxyUrl) && candidates.length > 1) {
        continue
      }

      const maxAttempts = 1 + retryDelaysMs.length
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (isCallerAborted(config)) break
        const useKeepAlive = attempt === 0
        const agents = buildAgentPair(proxyUrl, useKeepAlive)
        try {
          return await baseHttpAdapter({
            ...config,
            proxy: false,
            httpAgent: agents.httpAgent,
            httpsAgent: agents.httpsAgent
          })
        } catch (err) {
          lastError = err
          // 本地代理端口根本没开（如 Clash 已退出）：立即标记冷却并切到下一个候选（通常是 direct）
          if (proxyUrl && isLocalProxyConnectFailure(err)) {
            markProxyDead(proxyUrl)
            break
          }
          if (!isPreResponseTransientSocketError(err) || isCallerAborted(config)) {
            throw err
          }
          if (attempt + 1 < maxAttempts) {
            await abortableDelay(retryDelaysMs[attempt]!, config)
          }
        }
      }
    }

    // 终极兜底：若在 Electron 主进程内 Node OpenSSL 仍因系统根证书 / PAC / TLS 指纹被重置，
    // 且非流式响应，尝试经由 Chromium 网络栈发一次请求
    const fallbackFetchAdapter =
      options.fallbackFetchAdapter !== undefined
        ? options.fallbackFetchAdapter
        : isElectronAppReady() &&
            config.responseType !== 'stream' &&
            !isCallerAborted(config) &&
            isPreResponseTransientSocketError(lastError) &&
            typeof axios.getAdapter === 'function'
          ? axios.getAdapter('fetch')
          : null

    if (fallbackFetchAdapter) {
      return fallbackFetchAdapter({ ...config, proxy: false })
    }

    throw lastError
  }
}

let installed = false

/**
 * 在主进程全局激活系统代理感知与连接闪断自愈（幂等，单测 mock axios 环境下自动跳过）。
 */
export function installMainProcessNetworkResilience(): void {
  if (installed) return
  installed = true

  // 1. 为全局 axios 与所有 axios.create(...) 实例安装弹性代理适配器
  const axiosStatic = axios as unknown as {
    defaults?: typeof axios.defaults
    getAdapter?: typeof axios.getAdapter
  }
  if (axiosStatic?.defaults && typeof axiosStatic.getAdapter === 'function') {
    try {
      const baseHttpAdapter = axiosStatic.getAdapter('http')
      if (typeof baseHttpAdapter === 'function') {
        axiosStatic.defaults.proxy = false
        axiosStatic.defaults.adapter = createResilientAxiosAdapter(baseHttpAdapter)
      }
    } catch {
      /* 单测局部 mock 时安全忽略 */
    }
  }

  // 2. 为 Electron 主进程的 globalThis.fetch（供 @earendil-works/pi-ai 等 SDK 调用）补齐系统代理感知
  const origFetch = globalThis.fetch
  if (typeof origFetch === 'function') {
    const wrappedFetch: typeof globalThis.fetch = async (input, init) => {
      if (!isElectronAppReady()) {
        return origFetch(input, init)
      }
      const electronFetch = getElectronRuntime()?.net?.fetch
      if (typeof electronFetch !== 'function') {
        return origFetch(input, init)
      }

      const rawUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : typeof (input as { url?: unknown })?.url === 'string'
              ? ((input as { url: string }).url ?? '')
              : ''

      if (!/^https?:\/\//i.test(rawUrl)) {
        return origFetch(input, init)
      }

      try {
        const parsed = new URL(rawUrl)
        if (
          isBypassedLocalOrNoProxyHost(
            parsed.hostname,
            process.env.NO_PROXY || process.env.no_proxy
          )
        ) {
          return origFetch(input, init)
        }
      } catch {
        return origFetch(input, init)
      }

      const candidates = await resolveProxyCandidatesForUrl(rawUrl)
      const needsSystemProxy = candidates.some((c) => c.kind !== 'direct')
      if (needsSystemProxy) {
        try {
          return await electronFetch(input as never, init as never)
        } catch (err) {
          if (init?.signal?.aborted) throw err
          // 若系统代理不可达（如本地代理软件已关闭），自动回退 Node 直连 fetch
          return origFetch(input, init)
        }
      }

      try {
        return await origFetch(input, init)
      } catch (err) {
        if (init?.signal?.aborted || !isPreResponseTransientSocketError(err)) {
          throw err
        }
        return electronFetch(input as never, init as never)
      }
    }

    globalThis.fetch = wrappedFetch
  }
}
