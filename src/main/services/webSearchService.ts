/**
 * Unified live web search & web page fetch service shared by Pi Agent native tools
 * (`web_search` / `web_fetch`) and Studio MCP server.
 *
 * Search priority:
 *   1) Enabled user-configured real search providers in Settings -> Search (Tavily / Brave / SerpAPI / mock-search)
 *   2) Built-in zero-key public web search fallback (Bing RSS `cn.bing.com` / `www.bing.com` -> DuckDuckGo HTML)
 *   3) Enabled LLM-mediated search provider (`deepseek-search`) when live web is unreachable
 */
import net from 'node:net'
import axios from 'axios'
import type {
  FetchInput,
  FetchResult,
  SearchHit,
  SearchInput,
  SearchProviderInstance
} from '@shared/searchProvider'
import { getBuiltinSearchProvider } from '../plugins/searchProviders'
import { settingsService } from './settingsService'
import { extractWebArticleWithHeadlessBrowser } from './webArticleExtractService'

const PUBLIC_SEARCH_TIMEOUT_MS = 15_000
const PUBLIC_FETCH_TIMEOUT_MS = 20_000
const MAX_FETCH_BYTES = 2 * 1024 * 1024
const DEFAULT_FETCH_MAX_CHARS = 16_000
const HARD_FETCH_MAX_CHARS = 48_000

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const REAL_SEARCH_PROVIDER_ORDER = new Set(['tavily', 'brave', 'serpapi', 'mock-search'])

export interface StudioWebSearchOutcome {
  query: string
  provider: string
  hits: SearchHit[]
  fallbackUsed?: boolean
  warnings?: string[]
}

export function decodeHtmlEntities(input: string): string {
  if (!input) return ''
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const cp = Number.parseInt(hex, 16)
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ''
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const cp = Number.parseInt(dec, 10)
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ''
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
}

function stripTagsToPlainText(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function safeHostname(rawUrl: string): string | undefined {
  try {
    return new URL(rawUrl).hostname || undefined
  } catch {
    return undefined
  }
}

/**
 * SSRF guard: only allow public `http:` / `https:` URLs; block loopback, private LAN, and link-local hosts.
 */
export function isSafePublicHttpUrl(rawUrl: string): { ok: boolean; reason?: string; url?: URL } {
  let parsed: URL
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    return { ok: false, reason: 'Invalid URL: must start with http:// or https://' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      reason: `Unsupported URL protocol ${parsed.protocol}; only http/https are allowed`
    }
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return { ok: false, reason: `Blocked local or internal host: ${host || rawUrl}` }
  }

  const ipVer = net.isIP(host)
  if (ipVer === 4) {
    const parts = host.split('.').map((n) => Number.parseInt(n, 10))
    const [a = 0, b = 0] = parts
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    ) {
      return { ok: false, reason: `Blocked loopback or private IPv4 address: ${host}` }
    }
  } else if (ipVer === 6) {
    if (
      host === '::' ||
      host === '::1' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe80:') ||
      host.startsWith('::ffff:127.') ||
      host.startsWith('::ffff:10.') ||
      host.startsWith('::ffff:192.168.')
    ) {
      return { ok: false, reason: `Blocked loopback or private IPv6 address: ${host}` }
    }
  }

  return { ok: true, url: parsed }
}

export function parseBingRssHits(xml: string, topK = 8): SearchHit[] {
  if (!xml || typeof xml !== 'string') return []
  const hits: SearchHit[] = []
  const seenUrls = new Set<string>()
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi
  let match: RegExpExecArray | null

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1] ?? ''
    const titleRaw = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(block)?.[1] ?? ''
    const linkRaw = /<link\b[^>]*>([\s\S]*?)<\/link>/i.exec(block)?.[1] ?? ''
    const descRaw = /<description\b[^>]*>([\s\S]*?)<\/description>/i.exec(block)?.[1] ?? ''
    const pubRaw = /<pubDate\b[^>]*>([\s\S]*?)<\/pubDate>/i.exec(block)?.[1] ?? ''

    const url = decodeHtmlEntities(linkRaw).trim()
    if (!/^https?:\/\//i.test(url) || seenUrls.has(url)) continue
    seenUrls.add(url)

    const title = stripTagsToPlainText(titleRaw) || url
    const snippet = stripTagsToPlainText(descRaw)
    const source = safeHostname(url)
    let publishedAt: string | undefined
    if (pubRaw.trim()) {
      const parsedMs = Date.parse(decodeHtmlEntities(pubRaw).trim())
      if (!Number.isNaN(parsedMs)) {
        publishedAt = new Date(parsedMs).toISOString()
      }
    }

    hits.push({
      title,
      url,
      snippet,
      ...(source ? { source } : {}),
      ...(publishedAt ? { publishedAt } : {})
    })
    if (hits.length >= topK) break
  }

  return hits
}

export function parseDuckDuckGoHtmlHits(html: string, topK = 8): SearchHit[] {
  if (!html || typeof html !== 'string') return []
  const hits: SearchHit[] = []
  const seenUrls = new Set<string>()
  const anchorRegex =
    /<a\b[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null

  while ((match = anchorRegex.exec(html)) !== null) {
    let href = decodeHtmlEntities(match[1] ?? '').trim()
    const title = stripTagsToPlainText(match[2] ?? '')
    if (href.startsWith('//')) href = `https:${href}`
    try {
      const u = new URL(href, 'https://duckduckgo.com')
      const uddg = u.searchParams.get('uddg')
      if (uddg) href = uddg
    } catch {
      /* keep raw */
    }
    if (!/^https?:\/\//i.test(href) || seenUrls.has(href)) continue
    seenUrls.add(href)

    const tail = html.slice(match.index, match.index + 1800)
    const snippetRaw =
      /<a\b[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(tail)?.[1] ??
      /<div\b[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(tail)?.[1] ??
      ''
    const snippet = stripTagsToPlainText(snippetRaw)
    const source = safeHostname(href)

    hits.push({
      title: title || href,
      url: href,
      snippet,
      ...(source ? { source } : {})
    })
    if (hits.length >= topK) break
  }

  return hits
}

async function searchViaZeroKeyPublicWeb(
  input: SearchInput,
  topK: number,
  signal?: AbortSignal
): Promise<{ provider: string; hits: SearchHit[] }> {
  const q = encodeURIComponent(input.query.trim())
  const acceptLang =
    input.language?.trim() ||
    (/[\u4e00-\u9fa5]/.test(input.query) ? 'zh-CN,zh;q=0.9,en;q=0.8' : 'en-US,en;q=0.9')

  const bingEndpoints = ['https://cn.bing.com/search', 'https://www.bing.com/search']
  for (const endpoint of bingEndpoints) {
    try {
      const url = `${endpoint}?q=${q}&format=rss&count=${Math.min(15, Math.max(5, topK))}`
      const res = await axios.get<string>(url, {
        responseType: 'text',
        timeout: PUBLIC_SEARCH_TIMEOUT_MS,
        signal,
        headers: {
          'User-Agent': BROWSER_USER_AGENT,
          'Accept-Language': acceptLang,
          Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8'
        }
      })
      const hits = parseBingRssHits(String(res.data ?? ''), topK)
      if (hits.length > 0) {
        return { provider: 'bing-rss', hits }
      }
    } catch {
      if (signal?.aborted) throw new Error('Web search aborted')
    }
  }

  try {
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${q}`
    const res = await axios.get<string>(ddgUrl, {
      responseType: 'text',
      timeout: PUBLIC_SEARCH_TIMEOUT_MS,
      signal,
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        'Accept-Language': acceptLang,
        Accept: 'text/html,application/xhtml+xml'
      }
    })
    const hits = parseDuckDuckGoHtmlHits(String(res.data ?? ''), topK)
    if (hits.length > 0) {
      return { provider: 'duckduckgo-html', hits }
    }
  } catch {
    if (signal?.aborted) throw new Error('Web search aborted')
  }

  return { provider: 'public-web', hits: [] }
}

export async function executeStudioWebSearch(
  input: SearchInput,
  opts?: {
    providers?: ReadonlyArray<SearchProviderInstance>
    signal?: AbortSignal
    allowPublicFallback?: boolean
  }
): Promise<StudioWebSearchOutcome> {
  const query = String(input.query ?? '').trim()
  if (!query) {
    throw new Error('Search query must not be empty')
  }
  const topK = Math.max(1, Math.min(Math.trunc(Number(input.topK ?? 8) || 8), 15))
  const normalizedInput: SearchInput = { ...input, query, topK }

  const rawProviders =
    opts?.providers ??
    (() => {
      try {
        return settingsService.get().search?.providers ?? []
      } catch {
        return []
      }
    })()

  const activeProviders = rawProviders.filter(
    (p) => p.enabled && (p.providerKind === 'mock-search' || Boolean(p.apiKey?.trim()))
  )
  const realProviders = activeProviders.filter((p) =>
    REAL_SEARCH_PROVIDER_ORDER.has(p.providerKind)
  )
  const llmProviders = activeProviders.filter(
    (p) => !REAL_SEARCH_PROVIDER_ORDER.has(p.providerKind)
  )
  const warnings: string[] = []

  // 1) Configured real search APIs first (Tavily / Brave / SerpAPI / mock-search)
  for (const instance of realProviders) {
    const adapter = getBuiltinSearchProvider(instance.providerKind)
    if (!adapter) continue
    try {
      const res = await adapter.search(instance, normalizedInput)
      if (res.hits.length > 0 || instance.providerKind === 'mock-search') {
        return {
          query: res.query || query,
          provider: res.provider,
          hits: res.hits.slice(0, topK),
          ...(warnings.length ? { warnings } : {})
        }
      }
    } catch (err) {
      warnings.push(
        `${instance.label || instance.providerKind}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  // 2) Zero-key live public web search fallback (Bing RSS -> DuckDuckGo HTML)
  if (opts?.allowPublicFallback !== false) {
    const pub = await searchViaZeroKeyPublicWeb(normalizedInput, topK, opts?.signal)
    if (pub.hits.length > 0) {
      return {
        query,
        provider: pub.provider,
        hits: pub.hits.slice(0, topK),
        fallbackUsed: realProviders.length > 0,
        ...(warnings.length ? { warnings } : {})
      }
    }
  }

  // 3) LLM-mediated search fallback (deepseek-search) for restricted environments
  for (const instance of llmProviders) {
    const adapter = getBuiltinSearchProvider(instance.providerKind)
    if (!adapter) continue
    try {
      const res = await adapter.search(instance, normalizedInput)
      if (res.hits.length > 0) {
        return {
          query: res.query || query,
          provider: res.provider,
          hits: res.hits.slice(0, topK),
          fallbackUsed: true,
          ...(warnings.length ? { warnings } : {})
        }
      }
    } catch (err) {
      warnings.push(
        `${instance.label || instance.providerKind}: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  return {
    query,
    provider: activeProviders[0]?.providerKind ?? 'public-web',
    hits: [],
    ...(warnings.length ? { warnings } : {})
  }
}

export function htmlToReadableMarkdown(
  html: string,
  baseUrl?: string
): { title: string; markdown: string } {
  const raw = String(html ?? '')
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(raw)
  const title = stripTagsToPlainText(titleMatch?.[1] ?? '')

  const bodyBlock =
    /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(raw)?.[1] ??
    /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(raw)?.[1] ??
    /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(raw)?.[1] ??
    raw

  let cleaned = bodyBlock
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(
      /<(script|style|noscript|svg|iframe|canvas|nav|footer|header|aside)\b[^>]*>[\s\S]*?<\/\1>/gi,
      '\n'
    )

  cleaned = cleaned
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, code) => {
      const plain = decodeHtmlEntities(String(code).replace(/<[^>]+>/g, '')).trim()
      return plain ? `\n\`\`\`\n${plain}\n\`\`\`\n` : '\n'
    })
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, lvl, inner) => {
      const txt = stripTagsToPlainText(String(inner))
      return txt ? `\n${'#'.repeat(Number(lvl))} ${txt}\n` : '\n'
    })
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, inner) => {
      const txt = stripTagsToPlainText(String(inner))
      return txt ? `\n- ${txt}` : ''
    })
    .replace(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, inner) => {
      const txt = stripTagsToPlainText(String(inner))
      if (!txt) return ''
      let resolved = decodeHtmlEntities(String(href)).trim()
      if (baseUrl) {
        try {
          resolved = new URL(resolved, baseUrl).href
        } catch {
          /* ignore */
        }
      }
      if (/^https?:\/\//i.test(resolved) && resolved !== txt) {
        return `[${txt}](${resolved})`
      }
      return txt
    })
    .replace(/<(?:p|div|section|br|tr|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')

  const lines = decodeHtmlEntities(cleaned)
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)

  return {
    title,
    markdown: lines.join('\n\n')
  }
}

export async function executeStudioWebFetch(
  input: FetchInput & { workspaceRoot?: string },
  opts?: {
    providers?: ReadonlyArray<SearchProviderInstance>
    signal?: AbortSignal
    fallbackHeadless?: boolean
  }
): Promise<FetchResult> {
  const safety = isSafePublicHttpUrl(String(input.url ?? ''))
  if (!safety.ok || !safety.url) {
    throw new Error(safety.reason || 'Invalid public HTTP/HTTPS URL')
  }
  const targetUrl = safety.url.href
  const maxChars = Math.max(
    500,
    Math.min(
      Math.trunc(Number(input.maxChars ?? DEFAULT_FETCH_MAX_CHARS) || DEFAULT_FETCH_MAX_CHARS),
      HARD_FETCH_MAX_CHARS
    )
  )

  const rawProviders =
    opts?.providers ??
    (() => {
      try {
        return settingsService.get().search?.providers ?? []
      } catch {
        return []
      }
    })()
  for (const instance of rawProviders) {
    if (!instance.enabled) continue
    const adapter = getBuiltinSearchProvider(instance.providerKind)
    if (adapter?.fetch) {
      return adapter.fetch(instance, { ...input, url: targetUrl, maxChars })
    }
  }

  let title = ''
  let content = ''
  let contentType = ''
  let status: number | undefined

  try {
    const res = await axios.get<ArrayBuffer>(targetUrl, {
      responseType: 'arraybuffer',
      timeout: PUBLIC_FETCH_TIMEOUT_MS,
      maxContentLength: MAX_FETCH_BYTES,
      signal: opts?.signal,
      headers: {
        'User-Agent': BROWSER_USER_AGENT,
        Accept:
          'text/html,application/xhtml+xml,text/markdown,text/plain,application/json;q=0.9,*/*;q=0.5'
      }
    })
    status = res.status
    contentType = String(res.headers['content-type'] ?? '').toLowerCase()
    if (
      contentType &&
      !/\b(text\/|application\/(?:json|xml|xhtml\+xml|rss\+xml|atom\+xml|javascript)|charset=)/i.test(
        contentType
      )
    ) {
      throw new Error(`Target URL returned non-text content (${contentType})`)
    }

    const rawText = Buffer.from(res.data).toString('utf8')
    if (contentType.includes('application/json')) {
      content = rawText.trim()
    } else if (contentType.includes('text/plain') || contentType.includes('text/markdown')) {
      content = rawText.trim()
    } else {
      const parsed = htmlToReadableMarkdown(rawText, targetUrl)
      title = parsed.title
      content = parsed.markdown
    }
  } catch (err) {
    if (opts?.signal?.aborted) throw new Error('Web fetch aborted')
    if (opts?.fallbackHeadless === false) {
      throw err instanceof Error ? err : new Error(String(err))
    }
  }

  if (content.trim().length < 160 && opts?.fallbackHeadless !== false) {
    try {
      const extracted = await extractWebArticleWithHeadlessBrowser({
        url: targetUrl,
        maxImages: 0,
        ...(input.workspaceRoot ? { projectRootOverride: input.workspaceRoot } : {})
      })
      if (extracted.markdown?.trim()) {
        title = extracted.title || title
        content = extracted.markdown.trim()
        contentType = contentType || 'text/markdown'
      }
    } catch {
      /* keep static content if headless fallback fails */
    }
  }

  if (!content.trim()) {
    throw new Error(`Could not extract readable text from URL: ${targetUrl}`)
  }

  const truncated = content.length > maxChars
  const finalContent = truncated
    ? `${content.slice(0, maxChars)}\n\n... [Content truncated at ${maxChars} chars]`
    : content

  return {
    url: targetUrl,
    ...(title ? { title } : {}),
    content: finalContent,
    ...(contentType ? { contentType } : {}),
    fetchedAt: new Date().toISOString(),
    ...(truncated ? { truncated: true } : {}),
    ...(status !== undefined ? { status } : {})
  }
}
