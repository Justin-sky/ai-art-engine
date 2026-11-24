import {
  prepareLooseToolArguments,
  type RuntimeAgentTool,
  type RuntimeToolResult
} from './piModelResolver'
import { sanitizeInlineBinaryAndDataUrls } from './piPayloadGuard'
import { executeStudioWebFetch, executeStudioWebSearch } from '../services/webSearchService'

export interface PiWebSearchToolsOptions {
  getWorkspaceRoot?: () => string
}

export function createPiWebSearchTools(opts?: PiWebSearchToolsOptions): RuntimeAgentTool[] {
  const webSearchTool: RuntimeAgentTool = {
    name: 'web_search',
    label: 'Web Search',
    description:
      'Search the live public web by keywords to look up up-to-date facts, model/API documentation, game/film/UI design references, news, or real-world entities. Uses configured Search Providers (Tavily / Brave / SerpAPI) when available and automatically falls back to built-in zero-key live web search.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Concise search query keywords (Chinese or English). Avoid pasting entire paragraphs.'
        },
        topK: {
          type: 'integer',
          description: 'Maximum number of search hits to return (default 8, max 15).'
        },
        recencyDays: {
          type: 'integer',
          description: 'Optional recency filter in days when supported by the search provider.'
        },
        language: {
          type: 'string',
          description: 'Optional BCP-47 language preference such as "zh-CN" or "en-US".'
        }
      },
      required: ['query']
    },
    prepareArguments: (raw) => prepareLooseToolArguments(raw),
    execute: async (
      _toolCallId,
      params: Record<string, unknown>,
      signal
    ): Promise<RuntimeToolResult> => {
      const query = String(params.query ?? params.q ?? '').trim()
      if (!query) {
        return {
          content: [{ type: 'text', text: 'web_search requires a non-empty query string' }],
          details: null,
          isError: true
        }
      }

      const topK =
        typeof params.topK === 'number' && Number.isFinite(params.topK)
          ? Math.max(1, Math.min(15, Math.trunc(params.topK)))
          : 8
      const recencyDays =
        typeof params.recencyDays === 'number' && Number.isFinite(params.recencyDays)
          ? Math.max(1, Math.trunc(params.recencyDays))
          : undefined
      const language =
        typeof params.language === 'string' && params.language.trim()
          ? params.language.trim()
          : undefined

      try {
        const outcome = await executeStudioWebSearch(
          {
            query,
            topK,
            ...(recencyDays !== undefined ? { recencyDays } : {}),
            ...(language ? { language } : {})
          },
          { signal }
        )
        const payload = {
          ok: true,
          query: outcome.query,
          provider: outcome.provider,
          count: outcome.hits.length,
          results: outcome.hits.map((hit, idx) => ({
            index: idx + 1,
            title: hit.title,
            url: hit.url,
            ...(hit.source ? { source: hit.source } : {}),
            ...(hit.publishedAt ? { publishedAt: hit.publishedAt } : {}),
            snippet: hit.snippet
          })),
          ...(outcome.warnings?.length ? { warnings: outcome.warnings } : {})
        }
        return {
          content: [
            {
              type: 'text',
              text: sanitizeInlineBinaryAndDataUrls(JSON.stringify(payload, null, 2))
            }
          ],
          details: {
            query: outcome.query,
            provider: outcome.provider,
            count: outcome.hits.length
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return {
          content: [{ type: 'text', text: `Web search failed: ${msg}` }],
          details: { error: msg },
          isError: true
        }
      }
    }
  }

  const webFetchTool: RuntimeAgentTool = {
    name: 'web_fetch',
    label: 'Web Fetch',
    description:
      'Fetch and read the clean Markdown/text content of a public HTTP/HTTPS web page (e.g. from `web_search` results or user links). Automatically falls back to headless browser rendering for dynamic SPA pages. Note: if you also need to download embedded article images into `Cache/imports/` for video/canvas production, load `skills_web_vision` and call `web_extract_article` instead.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Public http:// or https:// URL to fetch.'
        },
        maxChars: {
          type: 'integer',
          description: 'Maximum characters of page content to return (default 16000, max 48000).'
        }
      },
      required: ['url']
    },
    prepareArguments: (raw) => prepareLooseToolArguments(raw),
    execute: async (
      _toolCallId,
      params: Record<string, unknown>,
      signal
    ): Promise<RuntimeToolResult> => {
      const url = String(params.url ?? '').trim()
      if (!url) {
        return {
          content: [{ type: 'text', text: 'web_fetch requires a valid http/https url' }],
          details: null,
          isError: true
        }
      }
      const maxChars =
        typeof params.maxChars === 'number' && Number.isFinite(params.maxChars)
          ? Math.trunc(params.maxChars)
          : undefined

      try {
        const fetched = await executeStudioWebFetch(
          {
            url,
            ...(maxChars !== undefined ? { maxChars } : {}),
            ...(opts?.getWorkspaceRoot ? { workspaceRoot: opts.getWorkspaceRoot() } : {})
          },
          { signal }
        )
        const payload = {
          ok: true,
          url: fetched.url,
          ...(fetched.title ? { title: fetched.title } : {}),
          truncated: Boolean(fetched.truncated),
          content: sanitizeInlineBinaryAndDataUrls(fetched.content)
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
          details: {
            url: fetched.url,
            title: fetched.title,
            truncated: Boolean(fetched.truncated)
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return {
          content: [{ type: 'text', text: `Web fetch failed: ${msg}` }],
          details: { error: msg },
          isError: true
        }
      }
    }
  }

  return [webSearchTool, webFetchTool]
}
