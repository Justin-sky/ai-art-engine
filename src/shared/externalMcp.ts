/**
 * 第三方 MCP 服务配置 —— 纯数据与归一化，供设置持久化、市场卡片与控制台表单共用。
 *
 * ## 方向（重要，别搞反）
 *
 * 本应用**自己是一个 MCP 服务端**（`/mcp` 暴露 72 个工具给 Claude Code / Codex 调用）。
 * 本模块描述的是**反过来的那一半**：用户添加的**外部 MCP 服务**，由本应用的 AI 对话面板
 * （dsh 子进程，它是 MCP 客户端）去消费。
 *
 * 之所以需要它：Claude Code / Codex 那些客户端用的是**它们自己**的 mcpServers 配置，
 * 本应用管不到；而面板里的 Agent 想用第三方工具，就必须由本应用把外部服务挂进 dsh 配置。
 *
 * ## 安全边界
 *
 * 挂进来的工具会在**本机执行**（stdio 形态直接起子进程）。因此：
 * - 一律经**本应用自己的端点**中转（`/mcp/ext/<id>`），这样才能沿用既有护栏 ——
 *   dsh 每轮下发的 `X-AIArt-Mode` / `X-AIArt-Run-Id` 在应用侧可见，Ask / Plan 的
 *   工具收窄与拒绝才管得住第三方工具；直连外部服务会绕开这套护栏。
 * - 工具名一律加 `<serverId>__` 前缀，避免与内置 72 个工具撞名（撞名后模型调的是谁不确定）。
 */

/** 传输形态：远程 HTTP 服务，或本机 stdio 子进程 */
export type ExternalMcpTransport = 'http' | 'stdio'

export interface ExternalMcpServer {
  /** 稳定标识，同时用作端点路径 `/mcp/ext/<id>` 与工具名前缀；创建后不变 */
  id: string
  /** 展示名（卡片标题）；空则回落到 id */
  name: string
  transport: ExternalMcpTransport
  enabled: boolean
  /** http：服务端点（如 https://example.com/mcp） */
  url: string
  /**
   * http：随请求下发的头，供需要鉴权的服务使用（如 `Authorization: Bearer …`）。
   * 与 dsh 拿到的凭据**不共用**：外部服务的凭据由用户自己填。
   */
  headers: Record<string, string>
  /** stdio：可执行文件。Windows 上 `npx` 这类 shell 脚本要走 `npx.cmd`，与仓库其余 spawn 同一口径 */
  command: string
  /** stdio：参数列表 */
  args: string[]
  /**
   * stdio：额外环境变量。**不继承**主进程杂项 env（与 blender 子进程同一安全口径），
   * 这里只列用户显式提供的项。
   */
  env: Record<string, string>
  /**
   * 单次工具调用超时（毫秒）。默认 60s 与服务端惯例一致；
   * 生成类外部工具可调大（应用内建那套为长任务调到 2 小时）。
   */
  timeoutMs: number
}

export const EXTERNAL_MCP_TRANSPORTS: readonly ExternalMcpTransport[] = ['http', 'stdio']

/** 超时边界：下限 1s（再低几乎必超时），上限 2 小时（与内建长任务口径对齐） */
export const EXTERNAL_MCP_MIN_TIMEOUT_MS = 1_000
export const EXTERNAL_MCP_MAX_TIMEOUT_MS = 7_200_000
export const EXTERNAL_MCP_DEFAULT_TIMEOUT_MS = 60_000

/**
 * 工具名前缀分隔符。
 *
 * 用双下划线而不是点或斜杠：MCP 工具名要满足 `^[a-zA-Z0-9_-]{1,128}$`，
 * 点和斜杠都不合法，冒号也不是所有客户端都接受。
 */
export const EXTERNAL_MCP_TOOL_SEPARATOR = '__'

/** 端点路径前缀；`/mcp/ext/<id>` 由 mcpServerService 路由 */
export const EXTERNAL_MCP_PATH_PREFIX = '/mcp/ext/'

/**
 * id → 端点路径。
 *
 * id 已在归一化阶段约束为 `[a-z0-9-]`，这里不再转义 —— 但要**再校验一次**：
 * 直接把用户输入拼进 URL 是路径穿越 / 端点混淆的常见入口。
 */
export function externalMcpPath(id: string): string {
  // 这是**编程错误**（调用方本该先归一化），不是用户输入错误；消息只用于日志，
  // 不带成品文案，故用 ASCII + 原始值，便于定位是哪一处传了脏 id
  if (!isValidExternalMcpId(id)) {
    throw new Error(`invalid external MCP id: ${JSON.stringify(id)}`)
  }
  return `${EXTERNAL_MCP_PATH_PREFIX}${id}`
}

/** 端点路径 → id；不是本前缀的返回 null（调用方据此判断是否该走外部中转） */
export function externalMcpIdFromPath(path: string): string | null {
  if (!path.startsWith(EXTERNAL_MCP_PATH_PREFIX)) return null
  const id = path.slice(EXTERNAL_MCP_PATH_PREFIX.length)
  if (!isValidExternalMcpId(id)) return null
  return id
}

/** 合法的 id：小写字母 / 数字 / 连字符，1–32 位，且不以连字符开头结尾 */
export function isValidExternalMcpId(id: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(id)
}

/**
 * 由展示名 / 命令推导一个合法 id（与既有 id 去重）。
 *
 * 中文名直接取不到 ASCII，这时回落到 `mcp`；去重交给 existing 参数。
 */
export function deriveExternalMcpId(source: string, existing: readonly string[]): string {
  const ascii = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  let base = ascii || 'mcp'
  // 不能以连字符结尾（上面已剥），但截断后可能又出现，再兜一次
  base = base.replace(/-+$/g, '') || 'mcp'
  if (!isValidExternalMcpId(base)) base = 'mcp'
  if (!existing.includes(base)) return base
  for (let n = 2; n < 1000; n += 1) {
    const suffix = `-${n}`
    const candidate = `${base.slice(0, 32 - suffix.length)}${suffix}`
    if (!existing.includes(candidate)) return candidate
  }
  return `mcp-${Date.now().toString(36).slice(-6)}`
}

/** 工具名的命名空间前缀（含分隔符），如 `foo__` */
export function externalMcpToolPrefix(id: string): string {
  return `${id}${EXTERNAL_MCP_TOOL_SEPARATOR}`
}

/** 给外部工具名加命名空间；已带前缀时不重复加 */
export function namespaceExternalMcpTool(id: string, toolName: string): string {
  const prefix = externalMcpToolPrefix(id)
  return toolName.startsWith(prefix) ? toolName : `${prefix}${toolName}`
}

/** 剥掉命名空间前缀；不属于该服务返回 null */
export function stripExternalMcpToolPrefix(id: string, toolName: string): string | null {
  const prefix = externalMcpToolPrefix(id)
  return toolName.startsWith(prefix) ? toolName.slice(prefix.length) : null
}

/** 新建时的默认值（供 UI 的「添加」表单与归一化共用） */
export function createDefaultExternalMcpServer(
  transport: ExternalMcpTransport = 'http'
): ExternalMcpServer {
  return {
    id: '',
    name: '',
    transport,
    enabled: true,
    url: '',
    headers: {},
    command: '',
    args: [],
    env: {},
    timeoutMs: EXTERNAL_MCP_DEFAULT_TIMEOUT_MS
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 字符串字典：只保留非空键值对（Bearer 之类常带空格，只 trim 两端） */
function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== 'string') continue
    const k = key.trim()
    if (!k) continue
    out[k] = raw.trim()
  }
  return out
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeTimeout(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return EXTERNAL_MCP_DEFAULT_TIMEOUT_MS
  return Math.min(
    EXTERNAL_MCP_MAX_TIMEOUT_MS,
    Math.max(EXTERNAL_MCP_MIN_TIMEOUT_MS, Math.trunc(value))
  )
}

/**
 * 归一化一条外部服务配置。
 *
 * 与 blenderMcp 同一口径：未知字段忽略、越界回退默认。
 * **id 不合法时返回 null**（由调用方丢弃）—— id 是端点路径与工具名前缀，
 * 放一个非法值进来等于埋一个不可达 / 可穿越的端点。
 */
export function normalizeExternalMcpServer(raw: unknown): ExternalMcpServer | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const id = asString(obj.id).trim().toLowerCase()
  if (!isValidExternalMcpId(id)) return null
  const transport: ExternalMcpTransport = obj.transport === 'stdio' ? 'stdio' : 'http'
  const name = asString(obj.name).trim()
  return {
    id,
    name: name || id,
    transport,
    // 默认启用：用户刚添加完就生效才符合预期
    enabled: typeof obj.enabled === 'boolean' ? obj.enabled : true,
    url: asString(obj.url).trim(),
    headers: asStringRecord(obj.headers),
    command: asString(obj.command).trim(),
    args: asStringArray(obj.args),
    env: asStringRecord(obj.env),
    timeoutMs: normalizeTimeout(obj.timeoutMs)
  }
}

/**
 * 归一化整个列表：丢弃非法条目、**按 id 去重**（首个生效）。
 *
 * 去重是必须的：id 重复会让端点路径与工具名前缀撞在一起，
 * 后加的那条永远收不到请求，而 UI 上看着是两条正常的卡片。
 */
export function normalizeExternalMcpServers(raw: unknown): ExternalMcpServer[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: ExternalMcpServer[] = []
  for (const item of raw) {
    const server = normalizeExternalMcpServer(item)
    if (!server) continue
    if (seen.has(server.id)) continue
    seen.add(server.id)
    out.push(server)
  }
  return out
}

/**
 * 这条配置是否**可用**（能真的挂上去）。
 *
 * 不单独存「已配置」标志：可用性是 url / command 的函数，重复状态会漂移。
 */
export function isExternalMcpServerUsable(server: ExternalMcpServer): boolean {
  if (server.transport === 'http') return isUsableHttpUrl(server.url)
  return server.command.length > 0
}

/**
 * http 端点是否像话。
 *
 * 只接受 http/https：stdio 之外的传输走 fetch，`file:` 之类会被 Node 拒绝，
 * 但**在 UI 上先挡住**比等运行时报错好。
 */
export function isUsableHttpUrl(url: string): boolean {
  const trimmed = url.trim()
  if (!trimmed) return false
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/** 配置为何不可用（写给用户看的原因）；可用时返回 null */
export function externalMcpUnusableReason(server: ExternalMcpServer): string | null {
  if (server.transport === 'http') {
    if (!server.url.trim()) return EXTERNAL_MCP_CONFIG_REASON.missingUrl
    if (!isUsableHttpUrl(server.url)) return EXTERNAL_MCP_CONFIG_REASON.invalidUrl
    return null
  }
  if (!server.command.trim()) return EXTERNAL_MCP_CONFIG_REASON.missingCommand
  return null
}

/**
 * 配置层「不可用」的原因 —— **单一来源**。
 *
 * 这些值会被直接拼成 i18n 键（`marketplace.ext.<reason>`）由渲染层翻译，所以它们
 * 必须与 locale 里的键一一对应。用常量而不是散落的字面量，配合
 * `tests/marketplaceI18nKeys.test.ts` 的全量比对，就不会再出现
 * 「加了一种原因却忘了加文案」→ 界面上显示原始键名的情形（实测踩过一次）。
 */
export const EXTERNAL_MCP_CONFIG_REASON = {
  missingUrl: 'missingUrl',
  invalidUrl: 'invalidUrl',
  missingCommand: 'missingCommand'
} as const

/** 全部配置层原因键（测试与 UI 断言用） */
export const EXTERNAL_MCP_CONFIG_REASONS: readonly string[] = Object.values(
  EXTERNAL_MCP_CONFIG_REASON
)
