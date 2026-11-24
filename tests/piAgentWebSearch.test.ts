import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PiApprovalBroker, PiAskUserBroker, PiTurnGovernance } from '../src/main/agent/piGovernance'
import { buildPiSystemPrompt } from '../src/main/agent/piPersona'
import { createPiWebSearchTools } from '../src/main/agent/piWebSearchTools'
import {
  executeStudioWebFetch,
  executeStudioWebSearch,
  htmlToReadableMarkdown,
  isSafePublicHttpUrl,
  parseBingRssHits,
  parseDuckDuckGoHtmlHits
} from '../src/main/services/webSearchService'
import { toolAccessOf } from '../src/shared/mcpModeAccess'
import {
  extractMcpToolStepsFromArgs,
  formatMcpToolDisplayName
} from '../src/shared/mcpToolOperationSummary'
import { createSearchProviderInstance } from '../src/shared/searchProvider'

describe('Pi Agent 原生联网搜索（web_search）与网页读取（web_fetch）', () => {
  it('1. 解析 Bing RSS 与 DuckDuckGo HTML 搜索结果并正确解码字符实体', () => {
    const sampleRss = `<?xml version="1.0" encoding="utf-8"?>
      <rss version="2.0"><channel>
        <item>
          <title>Seedream 5.5 &amp; Layer Decomposition 官方指南</title>
          <link>https://seed.bytedance.com/zh/seedream5_5?from=rss&amp;v=1</link>
          <description>&lt;b&gt;Seedream 5.5&lt;/b&gt; 支持最高 100 层原生透明图层分离。</description>
          <pubDate>Mon, 23 Nov 2026 20:41:00 GMT</pubDate>
        </item>
        <item>
          <title>重复链接去重校验</title>
          <link>https://seed.bytedance.com/zh/seedream5_5?from=rss&amp;v=1</link>
          <description>duplicate</description>
        </item>
      </channel></rss>`

    const rssHits = parseBingRssHits(sampleRss, 5)
    expect(rssHits).toHaveLength(1)
    expect(rssHits[0]).toMatchObject({
      title: 'Seedream 5.5 & Layer Decomposition 官方指南',
      url: 'https://seed.bytedance.com/zh/seedream5_5?from=rss&v=1',
      source: 'seed.bytedance.com',
      snippet: 'Seedream 5.5 支持最高 100 层原生透明图层分离。'
    })
    expect(rssHits[0]?.publishedAt).toBe('2026-11-23T20:41:00.000Z')

    const sampleDdg = `
      <div class="result">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.godotengine.org%2Fen%2Fstable%2F">Godot 4 UI &amp; Control Docs</a>
        <a class="result__snippet">Official documentation for <b>Godot 4</b> Control nodes.</a>
      </div>`
    const ddgHits = parseDuckDuckGoHtmlHits(sampleDdg, 5)
    expect(ddgHits).toHaveLength(1)
    expect(ddgHits[0]).toMatchObject({
      title: 'Godot 4 UI & Control Docs',
      url: 'https://docs.godotengine.org/en/stable/',
      source: 'docs.godotengine.org',
      snippet: 'Official documentation for Godot 4 Control nodes.'
    })
  })

  it('2. SSRF 安全防线：放行合法公网 http/https，拦截回环、内网 IP 与本地文件协议', () => {
    expect(isSafePublicHttpUrl('https://github.com/Justin-sky/ai-art-engine').ok).toBe(true)
    expect(isSafePublicHttpUrl('http://example.com/docs?page=1').ok).toBe(true)

    expect(isSafePublicHttpUrl('file:///C:/Windows/System32/drivers/etc/hosts').ok).toBe(false)
    expect(isSafePublicHttpUrl('http://localhost:43110/mcp').ok).toBe(false)
    expect(isSafePublicHttpUrl('http://127.0.0.1:43110/mcp').ok).toBe(false)
    expect(isSafePublicHttpUrl('http://192.168.1.10/admin').ok).toBe(false)
    expect(isSafePublicHttpUrl('http://10.0.0.8:8080/internal').ok).toBe(false)
    expect(isSafePublicHttpUrl('http://172.20.0.3/secret').ok).toBe(false)
    expect(isSafePublicHttpUrl('http://169.254.169.254/latest/meta-data/').ok).toBe(false)
    expect(isSafePublicHttpUrl('http://[::1]:3000/').ok).toBe(false)
  })

  it('3. HTML 转可读 Markdown 提取正文并剔除 script/style 噪音', () => {
    const html = `
      <html>
        <head>
          <title>游戏 UI 规范手册</title>
          <style>body { color: red; }</style>
          <script>window.__SECRET__ = 123;</script>
        </head>
        <body>
          <nav>顶部导航噪音</nav>
          <article>
            <h1>九宫格切图原则</h1>
            <p>保持四角像素不被拉伸，详见 <a href="/guide/9slice">九宫格教程</a>。</p>
            <ul><li>顶边可水平平铺</li><li>中心区域双向缩放</li></ul>
          </article>
        </body>
      </html>`
    const parsed = htmlToReadableMarkdown(html, 'https://ui.example.com/docs/intro')
    expect(parsed.title).toBe('游戏 UI 规范手册')
    expect(parsed.markdown).toContain('# 九宫格切图原则')
    expect(parsed.markdown).toContain('[九宫格教程](https://ui.example.com/guide/9slice)')
    expect(parsed.markdown).toContain('- 顶边可水平平铺')
    expect(parsed.markdown).not.toContain('__SECRET__')
    expect(parsed.markdown).not.toContain('顶部导航噪音')
  })

  it('4. executeStudioWebSearch 与 executeStudioWebFetch 对接已启用 SearchProvider', async () => {
    const mockProvider = createSearchProviderInstance('mock-search', { enabled: true })

    const searchRes = await executeStudioWebSearch(
      { query: 'AI Art Engine MCP', topK: 3 },
      { providers: [mockProvider], allowPublicFallback: false }
    )
    expect(searchRes.provider).toBe('mock-search')
    expect(searchRes.hits.length).toBeGreaterThan(0)
    expect(searchRes.hits[0]?.url).toMatch(/^https?:\/\//)

    const fetchRes = await executeStudioWebFetch(
      { url: 'https://example.com/doc' },
      { providers: [mockProvider], fallbackHeadless: false }
    )
    expect(fetchRes.url).toBe('https://example.com/doc')
    expect(fetchRes.content.length).toBeGreaterThan(0)

    await expect(
      executeStudioWebFetch(
        { url: 'http://127.0.0.1:43110/mcp' },
        { providers: [mockProvider], fallbackHeadless: false }
      )
    ).rejects.toThrow(/Blocked loopback or private/i)
  })

  it('5. Plan 模式（未确认前）与 Craft 模式放行只读 web_search / web_fetch，系统提示词与 UI 摘要齐全', async () => {
    const tools = createPiWebSearchTools({ getWorkspaceRoot: () => resolve('/demo') })
    expect(tools.map((t) => t.name)).toEqual(['web_search', 'web_fetch'])

    // 验证空 query 与非法内网 URL 返回友好 isError 而非未捕获崩溃
    const emptySearch = await tools[0]!.execute('c1', { query: '   ' })
    expect(emptySearch.isError).toBe(true)
    const blockedFetch = await tools[1]!.execute('c2', { url: 'http://localhost:43110/mcp' })
    expect(blockedFetch.isError).toBe(true)

    // Plan 模式未确认前：web_search 与 web_fetch 均可见且允许调用
    const gov = new PiTurnGovernance({
      mode: 'plan',
      sandboxMode: 'workspace-write',
      workspaceRoot: resolve('/demo'),
      askUserBroker: new PiAskUserBroker({ emitQuestion: () => undefined }),
      approvalBroker: new PiApprovalBroker({ emitApproval: () => undefined })
    })
    const visibleInPlan = gov.filterNativeTools(tools).map((t) => t.name)
    expect(visibleInPlan).toEqual(['web_search', 'web_fetch'])

    const callCheck = await gov.beforeToolCall({
      assistantMessage: {
        role: 'assistant',
        content: [],
        api: 'openai-completions',
        provider: 'openai',
        model: 'gpt-4o',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        },
        stopReason: 'toolUse',
        timestamp: Date.now()
      },
      toolCall: {
        type: 'toolCall',
        id: 'ws-1',
        name: 'web_search',
        arguments: { query: 'Seedream 5.5' }
      },
      args: { query: 'Seedream 5.5' },
      context: { messages: [] }
    })
    expect(callCheck).toBeUndefined()

    // MCP 访问权限与 UI 操作摘要
    expect(toolAccessOf('web_search')).toBe('read')
    expect(toolAccessOf('web_fetch')).toBe('read')
    expect(formatMcpToolDisplayName('web_search', false)).toBe('联网搜索')
    expect(formatMcpToolDisplayName('web_search', true)).toBe('Web Search')
    expect(extractMcpToolStepsFromArgs('web_search', { query: '星穹铁道 UI' })).toEqual([
      '联网搜索「星穹铁道 UI」'
    ])
    expect(extractMcpToolStepsFromArgs('web_fetch', { url: 'https://example.com/a' })).toEqual([
      '读取网页 https://example.com/a'
    ])

    // 系统提示词包含主动联网搜索指引
    const sysPrompt = buildPiSystemPrompt({
      mode: 'craft',
      sandboxMode: 'workspace-write',
      workspaceRoot: resolve('/demo')
    })
    expect(sysPrompt).toContain('web_search')
    expect(sysPrompt).toContain('web_fetch')
    expect(sysPrompt).toContain('Proactive Live Web Search')
  })
})
