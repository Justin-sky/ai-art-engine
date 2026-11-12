import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

const RUNNER_PATH = resolve('src/main/services/aiartHeadlessRunner.template.mjs')

function makeFnTool(name: string, description = `Tool ${name}`) {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties: {
          assetId: { type: 'string' },
          mode: { type: 'string' }
        },
        required: ['assetId']
      }
    }
  }
}

function buildRealistic162Tools() {
  const dshTools = [
    'read',
    'write',
    'edit',
    'str_replace_editor',
    'glob',
    'grep',
    'pwsh',
    'bash',
    'todo_write',
    'goal',
    'present',
    'schedule',
    'ask_user_question',
    'subagent',
    'subagent_fork',
    'send_message',
    'skill',
    'web_fetch',
    'web_search',
    'jobs',
    'cordis_inspect',
    'ralph_step',
    'workflow_exec',
    'subagent_report'
  ] // 24 tools

  const coreStudio = [
    'mcp__studio__graph_read',
    'mcp__studio__graph_edit',
    'mcp__studio__graph_node_types',
    'mcp__studio__task_run',
    'mcp__studio__task_status',
    'mcp__studio__asset_create',
    'mcp__studio__asset_list',
    'mcp__studio__asset_import',
    'mcp__studio__asset_read_file',
    'mcp__studio__asset_write_text',
    'mcp__studio__project_list',
    'mcp__studio__project_open',
    'mcp__studio__director_stage_read',
    'mcp__studio__director_stage_edit',
    'mcp__studio__timeline_read',
    'mcp__studio__timeline_edit',
    'mcp__studio__render_svg',
    'mcp__studio__game_one_sentence_create'
  ] // 18 core studio

  const nicheStudio = Array.from({ length: 77 }, (_, i) =>
    i === 40
      ? 'mcp__studio__vision_local_ocr'
      : i === 55
        ? 'mcp__studio__voice_profile_list'
        : `mcp__studio__aux_tool_${i + 1}`
  ) // 77 niche studio -> 95 studio total

  const externalMcp = [
    ...Array.from({ length: 20 }, (_, i) => `mcp__blender__op_${i + 1}`),
    ...Array.from({ length: 23 }, (_, i) => `mcp__github__action_${i + 1}`)
  ] // 43 external MCP tools

  return [...dshTools, ...coreStudio, ...nicheStudio, ...externalMcp].map((name) =>
    makeFnTool(name, `Description for ${name}`)
  )
}

describe('OpenAI / Chat Completions 128-tool limit compaction & lossless overflow muxing', () => {
  it('leaves tools untouched when tools.length <= 128', async () => {
    const mod = (await import(pathToFileURL(RUNNER_PATH).href)) as {
      sanitizeOpenAiChatPayload: (
        rawBody: string,
        urlStr: string
      ) => { body: string; parsed: { tools: Array<{ function: { name: string } }> } | null }
    }

    const tools100 = Array.from({ length: 100 }, (_, i) => makeFnTool(`tool_${i}`))
    const raw = JSON.stringify({
      model: 'gpt-6.1-sol',
      messages: [{ role: 'user', content: 'hello' }],
      tools: tools100
    })

    const res = mod.sanitizeOpenAiChatPayload(raw, 'https://api.openai.com/v1/chat/completions')
    expect(res.parsed?.tools).toHaveLength(100)
    expect(res.parsed?.tools.some((t) => t.function.name === 'aiart_call_overflow_tool')).toBe(
      false
    )
  })

  it('compacts 162 tools (95 studio + 24 dsh + 43 external MCP) to exactly 128 while boosting history, prompt-matched, core, and external MCP tools', async () => {
    const mod = (await import(pathToFileURL(RUNNER_PATH).href)) as {
      OPENAI_MAX_TOOLS: number
      OVERFLOW_MUX_TOOL_NAME: string
      sanitizeOpenAiChatPayload: (
        rawBody: string,
        urlStr: string
      ) => {
        body: string
        parsed: {
          tools: Array<{
            function: {
              name: string
              description: string
              parameters: { properties: { tool_name?: { enum?: string[] } } }
            }
          }>
          messages: Array<{ role: string; content: unknown }>
        } | null
      }
    }

    const tools162 = buildRealistic162Tools()
    expect(tools162).toHaveLength(162)

    const raw = JSON.stringify({
      model: 'gpt-6.1-sol',
      messages: [
        { role: 'system', content: 'You are AIArtEngine craft agent.' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_hist_1',
              type: 'function',
              function: { name: 'mcp__studio__aux_tool_70', arguments: '{"assetId":"a1"}' }
            }
          ]
        },
        { role: 'tool', tool_call_id: 'call_hist_1', content: '{"ok":true}' },
        { role: 'user', content: '请先用 ocr 识别截图文字，再把策划案写入画布节点' }
      ],
      tools: tools162
    })

    const { parsed } = mod.sanitizeOpenAiChatPayload(
      raw,
      'https://custom-openai-proxy.example.com/v1/chat/completions'
    )
    expect(parsed).not.toBeNull()
    expect(parsed!.tools).toHaveLength(128)

    const directNames = new Set(parsed!.tools.slice(0, 127).map((t) => t.function.name))
    const mux = parsed!.tools[127]!
    expect(mux.function.name).toBe(mod.OVERFLOW_MUX_TOOL_NAME)
    expect(mux.function.description.length).toBeLessThan(500)

    // 1. Historical tool call in session MUST stay in direct slots
    expect(directNames.has('mcp__studio__aux_tool_70')).toBe(true)
    // 2. Prompt-matched niche tool (`ocr` -> `mcp__studio__vision_local_ocr`) MUST jump to direct slots
    expect(directNames.has('mcp__studio__vision_local_ocr')).toBe(true)
    // 3. Core DSH + Core Studio tools MUST stay in direct slots
    expect(directNames.has('read')).toBe(true)
    expect(directNames.has('pwsh')).toBe(true)
    expect(directNames.has('mcp__studio__graph_edit')).toBe(true)
    expect(directNames.has('mcp__studio__task_run')).toBe(true)
    // 4. All 43 external MCP tools (`blender` + `github`) fit in direct slots
    expect(directNames.has('mcp__blender__op_1')).toBe(true)
    expect(directNames.has('mcp__blender__op_20')).toBe(true)
    expect(directNames.has('mcp__github__action_1')).toBe(true)
    expect(directNames.has('mcp__github__action_23')).toBe(true)

    // 5. All remaining 35 tools are losslessly addressable via `aiart_call_overflow_tool` enum + system catalog
    const overflowEnum = mux.function.parameters.properties.tool_name?.enum ?? []
    expect(overflowEnum).toHaveLength(162 - 127)
    expect(overflowEnum).toContain('mcp__studio__voice_profile_list')
    expect(String(parsed!.messages[0]?.content)).toContain('[Overflow Tools Catalog')
    expect(String(parsed!.messages[0]?.content)).toContain(
      'mcp__studio__voice_profile_list(assetId*, mode)'
    )
  })

  it('also compacts >128 tools on official DeepSeek URLs without stripping DeepSeek-native fields', async () => {
    const mod = (await import(pathToFileURL(RUNNER_PATH).href)) as {
      sanitizeOpenAiChatPayload: (
        rawBody: string,
        urlStr: string
      ) => { body: string; parsed: Record<string, unknown> | null }
    }

    const tools162 = buildRealistic162Tools()
    const raw = JSON.stringify({
      model: 'deepseek-chat',
      thinking: { type: 'enabled' },
      dsh_cache_key: 'keep-me',
      messages: [{ role: 'user', content: 'hi' }],
      tools: tools162
    })

    const { body } = mod.sanitizeOpenAiChatPayload(raw, 'https://api.deepseek.com/chat/completions')
    const out = JSON.parse(body) as {
      thinking?: { type: string }
      dsh_cache_key?: string
      tools: unknown[]
    }
    expect(out.tools).toHaveLength(128)
    expect(out.thinking).toEqual({ type: 'enabled' })
    expect(out.dsh_cache_key).toBe('keep-me')
  })

  it('transparently unwraps aiart_call_overflow_tool back into the real MCP tool in wrapDsmlStream and parseDsmlToolCalls', async () => {
    const mod = (await import(pathToFileURL(RUNNER_PATH).href)) as {
      OVERFLOW_MUX_TOOL_NAME: string
      parseDsmlToolCalls: (
        text: string,
        tools?: Array<{ name: string }>
      ) => Array<{ id: string; name: string; arguments: string }>
      wrapDsmlStream: (
        source: AsyncIterable<Record<string, unknown>>,
        options?: { tools?: Array<{ name: string }> },
        getMode?: () => string
      ) => AsyncGenerator<Record<string, unknown>>
    }

    const availableTools = [{ name: 'mcp__studio__voice_profile_list' }]
    const muxPayload = JSON.stringify({
      tool_name: 'mcp__studio__voice_profile_list',
      arguments: { assetId: 'voice_1', mode: 'narrator' }
    })

    async function* fakeNativeStream(): AsyncGenerator<Record<string, unknown>> {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield {
        type: 'tool-call-delta',
        index: 0,
        id: 'call_mux_1',
        name: mod.OVERFLOW_MUX_TOOL_NAME,
        argumentsDelta: muxPayload.slice(0, 30)
      }
      yield {
        type: 'tool-call-delta',
        index: 0,
        id: 'call_mux_1',
        argumentsDelta: muxPayload.slice(30)
      }
      yield {
        type: 'block-end',
        index: 0,
        block: {
          type: 'tool-call',
          id: 'call_mux_1',
          name: mod.OVERFLOW_MUX_TOOL_NAME,
          arguments: muxPayload
        }
      }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }

    const chunks: Array<Record<string, unknown>> = []
    for await (const c of mod.wrapDsmlStream(
      fakeNativeStream(),
      { tools: availableTools },
      () => 'craft'
    )) {
      chunks.push(c)
    }

    // Wrapper tool name MUST never leak downstream to BlockAssembler or UI cards
    const deltaChunks = chunks.filter((c) => c.type === 'tool-call-delta')
    expect(deltaChunks).toHaveLength(1)
    expect(deltaChunks[0]?.name).toBe('mcp__studio__voice_profile_list')
    expect(JSON.parse(String(deltaChunks[0]?.argumentsDelta))).toEqual({
      assetId: 'voice_1',
      mode: 'narrator'
    })

    const endChunk = chunks.find((c) => c.type === 'block-end') as
      { block: { id: string; name: string; arguments: string } } | undefined
    expect(endChunk?.block).toEqual({
      type: 'tool-call',
      id: 'call_mux_1',
      name: 'mcp__studio__voice_profile_list',
      arguments: '{"assetId":"voice_1","mode":"narrator"}'
    })

    // Also verify DSML text tool call unwrapping (including short name resolution)
    const dsmlCalls = mod.parseDsmlToolCalls(
      `<｜DSML｜function_calls><｜DSML｜invoke name="${mod.OVERFLOW_MUX_TOOL_NAME}"><｜DSML｜parameter name="tool_name">voice_profile_list</｜DSML｜parameter><｜DSML｜parameter name="arguments">{"assetId":"voice_2"}</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜function_calls>`,
      availableTools
    )
    expect(dsmlCalls).toHaveLength(1)
    expect(dsmlCalls[0]?.name).toBe('mcp__studio__voice_profile_list')
    expect(JSON.parse(dsmlCalls[0]!.arguments)).toEqual({ assetId: 'voice_2' })
  })

  it('auto-retries with a tighter cap when a stricter custom gateway enforces maximum length 64', async () => {
    const sentToolCounts: number[] = []
    const originalFetch = globalThis.fetch
    const mockBaseFetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body || '{}')) as { tools?: unknown[] }
      const count = parsed.tools?.length ?? 0
      sentToolCounts.push(count)
      if (count > 64) {
        return new Response(
          JSON.stringify({
            message: `Invalid 'tools': array too long. Expected an array with maximum length 64, but got an array with length ${count}.`
          }),
          { status: 400, headers: { 'content-type': 'application/json' } }
        )
      }
      return new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      })
    })

    try {
      const mark = Symbol.for('aiart.openAiCompatFetch.patched')
      globalThis.fetch = mockBaseFetch as unknown as typeof fetch
      delete (globalThis.fetch as unknown as Record<symbol, unknown>)[mark]

      const mod = (await import(pathToFileURL(RUNNER_PATH).href)) as {
        installOpenAiCompatFetchBridge: () => void
      }
      mod.installOpenAiCompatFetchBridge()

      const resp = await globalThis.fetch(
        'https://strict-gateway.example.com/v1/chat/completions',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: 'custom-model',
            messages: [{ role: 'user', content: 'run' }],
            tools: buildRealistic162Tools()
          })
        }
      )

      expect(resp.status).toBe(200)
      // First attempt sent 128 (standard OpenAI cap), gateway asked for max 64, second attempt sent 64!
      expect(sentToolCounts).toEqual([128, 64])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
