/**
 * Search provider + capability types shared by main/renderer.
 *
 * 与 model provider（@shared/modelProvider）平行：网络搜索 / 抓取是不同领域——
 * 没有"模态"概念，能力维度是 search / fetch / auth。dsh AI 对话工具当前把"联网搜索"
 * 借道 model provider 的 Anthropic 兼容端点（DeepSeek anthropic 网关就是这条），
 * 这里把它正名为独立的 SearchProvider 抽象，避免与文本生成混淆。
 */

/** 内置 search provider 种类。kind 目录用于设置落盘 / UI 列表 / 注册表查找 */
export type SearchProviderKind =
  /** DeepSeek Anthropic 兼容端点（默认 https://api.deepseek.com/anthropic）；
   * 复用现有 model provider 的 custom/anthropic 实现，让模型以 JSON 格式返回搜索结果（LLM 中介） */
  | 'deepseek-search'
  /** Tavily Search API（POST https://api.tavily.com/search，api_key 走 body） */
  | 'tavily'
  /** Brave Search API（GET https://api.search.brave.com/res/v1/web/search，X-Subscription-Token header） */
  | 'brave'
  /** SerpAPI（GET https://serpapi.com/search，api_key 走 query） */
  | 'serpapi'
  /** 单测与本地调试用：固定 hits 数组，不发起任何网络请求 */
  | 'mock-search'

// 后续可按需扩展：'duckduckgo' / 'wikipedia' / 'bing'
// 新增时同步追加 SEARCH_PROVIDER_KINDS、plugin 注册与 i18n 即可

export type SearchCapability = 'search' | 'fetch'

/** 设置 UI / 手册共用的元数据 */
export interface SearchProviderKindMeta {
  id: SearchProviderKind
  label: string
  /** 需本地化的展示名（如「自定义」）走 vue-i18n；品牌名不设此字段 */
  labelKey?: string
  defaultBaseUrl: string
  /** 控制台 / 密钥申请页 */
  credentialsUrl: string
  /** 该 provider 支持的能力；fetch 缺失时上层走 fetch=null 兜底 */
  capabilities: readonly SearchCapability[]
}

/** 文本搜索请求 */
export interface SearchInput {
  /** 用户原始 query；adapter 自行决定是否清洗 / 改写 */
  query: string
  /** 期望返回条数；adapter 不支持时按服务端默认 */
  topK?: number
  /** 时间窗（天）；仅部分 adapter 生效（如 Brave / Tavily） */
  recencyDays?: number
  /** BCP-47 标签，如 'zh-CN' / 'en-US' */
  language?: string
  /** 是否启用安全搜索 */
  safeSearch?: boolean
  /** 透传给上游的额外参数（不同 provider schema 不同；adapter 负责忽略不识别的键） */
  extras?: Record<string, unknown>
}

/** 搜索命中条目 */
export interface SearchHit {
  title: string
  /** 命中 URL（已规范化为 http(s)） */
  url: string
  /** 命中摘要 / 片段 */
  snippet: string
  /** ISO 8601 时间戳；adapter 无法解析时省略 */
  publishedAt?: string
  /** 命中源域名，便于聚合展示 */
  source?: string
  /** 上游相关性分数；0-1，越大越相关 */
  score?: number
  /** 上游原始 payload，便于排障 / 高级用户消费 */
  raw?: Record<string, unknown>
}

/** 搜索响应 */
export interface SearchResult {
  hits: SearchHit[]
  /** 实际使用的 provider（用于日志 / UI 标记） */
  provider: SearchProviderKind
  /** 回传原 query（adapter 改写后） */
  query: string
  /** 上游返回的总量（hit 可能只是分页） */
  total?: number
  /** 上游原始 payload */
  raw?: Record<string, unknown>
}

/** 抓取请求：把 URL 内容拉回来给 LLM 消费 */
export interface FetchInput {
  url: string
  /** 输出字节上限，避免巨型页面撑爆上下文；默认 1 MiB */
  maxBytes?: number
  /** 输出格式：markdown（默认，剥离 HTML）/ text（纯文本）/ html（原始） */
  format?: 'markdown' | 'text' | 'html'
  /** 截取前 N 字符；超过则截断并补 …（truncated）标记 */
  maxChars?: number
}

/** 抓取响应 */
export interface FetchResult {
  url: string
  title?: string
  /** 最终正文（已按 format 处理并截断） */
  content: string
  /** 检测到的 MIME；非文本场景上层应拒绝 */
  contentType?: string
  /** ISO 8601 时间戳 */
  fetchedAt: string
  /** 内容是否被截断（maxBytes / maxChars 触发） */
  truncated?: boolean
  /** 原始 HTTP 状态码，便于排障 */
  status?: number
}

/** 一个 search provider 实例：每个用户可独立配多份，按 enabled 过滤 */
export interface SearchProviderInstance {
  /** 本地实例 id（与 model provider 体系无关联，独立 UUID） */
  id: string
  providerKind: SearchProviderKind
  /** 显示名，默认等于 provider meta.label */
  label: string
  apiKey: string
  baseUrl: string
  enabled: boolean
}

/** 设置落盘与规范化用的 kind 目录 */
export const SEARCH_PROVIDER_KINDS: readonly SearchProviderKindMeta[] = [
  {
    id: 'deepseek-search',
    label: 'DeepSeek Search',
    defaultBaseUrl: 'https://api.deepseek.com/anthropic',
    credentialsUrl: 'https://platform.deepseek.com/api_keys',
    capabilities: ['search']
  },
  {
    id: 'tavily',
    label: 'Tavily Search',
    defaultBaseUrl: 'https://api.tavily.com',
    credentialsUrl: 'https://tavily.com/',
    capabilities: ['search']
  },
  {
    id: 'brave',
    label: 'Brave Search',
    defaultBaseUrl: 'https://api.search.brave.com',
    credentialsUrl: 'https://brave.com/search/api',
    capabilities: ['search']
  },
  {
    id: 'serpapi',
    label: 'SerpAPI Search',
    defaultBaseUrl: 'https://serpapi.com',
    credentialsUrl: 'https://serpapi.com/dashboard',
    capabilities: ['search']
  },
  {
    id: 'mock-search',
    label: 'Mock Search',
    /** 测试用；无端点；不进设置 UI（labelKey 走 i18n 屏蔽） */
    labelKey: 'settings.search.providerMock',
    defaultBaseUrl: '',
    credentialsUrl: '',
    capabilities: ['search', 'fetch']
  }
] as const

export function searchProviderCredentialsUrl(kind: SearchProviderKind): string {
  return (
    SEARCH_PROVIDER_KINDS.find((p) => p.id === kind)?.credentialsUrl ??
    SEARCH_PROVIDER_KINDS[0]!.credentialsUrl
  )
}

/** provider 是否支持给定能力 */
export function searchProviderSupports(
  kind: SearchProviderKind,
  capability: SearchCapability
): boolean {
  const meta = SEARCH_PROVIDER_KINDS.find((p) => p.id === kind)
  return meta?.capabilities.includes(capability) ?? false
}

export interface SearchSettings {
  providers: SearchProviderInstance[]
}

export function createEmptySearchSettings(): SearchSettings {
  return { providers: [] }
}

export function createSearchProviderInstance(
  kind: SearchProviderKind = 'deepseek-search',
  overrides?: Partial<SearchProviderInstance>
): SearchProviderInstance {
  const meta = SEARCH_PROVIDER_KINDS.find((p) => p.id === kind) ?? SEARCH_PROVIDER_KINDS[0]!
  const base: SearchProviderInstance = {
    id: newSearchLocalId(),
    providerKind: kind,
    label: meta.label,
    apiKey: '',
    baseUrl: meta.defaultBaseUrl,
    enabled: true
  }
  if (!overrides) return base
  return { ...base, ...overrides }
}

/** 兼容空 baseUrl（mock / 自定义 endpoint） */
export function normalizeSearchProviderInstance(
  item: Partial<SearchProviderInstance>
): SearchProviderInstance | null {
  if (!item || typeof item.providerKind !== 'string') return null
  if (!SEARCH_PROVIDER_KINDS.some((p) => p.id === item.providerKind)) return null
  return {
    id: typeof item.id === 'string' && item.id ? item.id : newSearchLocalId(),
    providerKind: item.providerKind,
    label:
      typeof item.label === 'string' && item.label.trim()
        ? item.label.trim()
        : SEARCH_PROVIDER_KINDS.find((p) => p.id === item.providerKind)!.label,
    apiKey: typeof item.apiKey === 'string' ? item.apiKey : '',
    baseUrl: typeof item.baseUrl === 'string' ? item.baseUrl.replace(/\/$/, '') : '',
    enabled: item.enabled !== false
  }
}

export function normalizeSearchSettings(raw?: unknown): SearchSettings {
  if (!raw || typeof raw !== 'object') return createEmptySearchSettings()
  const providers = (raw as { providers?: unknown }).providers
  if (!Array.isArray(providers)) return createEmptySearchSettings()
  return {
    providers: providers
      .map((item) =>
        normalizeSearchProviderInstance((item ?? {}) as Partial<SearchProviderInstance>)
      )
      .filter((item): item is SearchProviderInstance => item != null)
  }
}

/** 默认模型：文本选 DeepSeek-flash（已确认在线模型）；fetch 走 dedicated 工具 */
export const DEEPSEEK_SEARCH_DEFAULT_MODEL = 'deepseek-flash'

function newSearchLocalId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* fall through */
  }
  return `sp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
