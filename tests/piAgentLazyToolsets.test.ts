import { Agent } from '@earendil-works/pi-agent-core'
import {
  createAssistantMessageEventStream,
  resolveTranscriptTools,
  type AssistantMessage,
  type Model
} from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'
import {
  BUILTIN_LAZY_TOOLSETS,
  MAX_ACTIVE_TOOLS,
  MAX_EXTERNAL_TOOLS_PER_LOAD,
  McpLazyToolsetManager,
  STUDIO_CORE_TOOL_NAMES,
  selectRelevantExternalTools,
  type LazyMcpBackend,
  type LazyMcpToolDescriptor
} from '../src/main/agent/mcpLazyToolsets'
import {
  enforceOpenAiToolsLimitPayload,
  type RuntimeAgentTool
} from '../src/main/agent/piModelResolver'
import { listInProcessStudioAndBlenderTools } from '../src/main/services/mcpServerService'
import { toolAccessOf, type McpAccessView } from '../src/shared/mcpModeAccess'

function makeDummyNativeTools(count = 11): RuntimeAgentTool[] {
  const names = [
    'read',
    'write',
    'edit',
    'search',
    'bash',
    'ask_user',
    'todo_write',
    'present_files',
    'spawn_subagent',
    'goal_manage',
    'schedule_manage'
  ].slice(0, count)
  return names.map((name) => ({
    name,
    label: name,
    description: `Native tool ${name}`,
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ content: [{ type: 'text', text: 'ok' }], details: {} })
  }))
}

function make160ReaExternalTools(): LazyMcpToolDescriptor[] {
  const realLikeNames = [
    'inspect_android_package',
    'search_android_classes',
    'inspect_android_class',
    'decompile_jeb_item',
    'decode_android_resources',
    'inspect_apk_signature',
    'list_procedures',
    'procedure_pseudo_code',
    'xrefs',
    'binary_overview'
  ]
  const list: LazyMcpToolDescriptor[] = realLikeNames.map((raw) => ({
    name: `rea__${raw}`,
    title: raw,
    description: `Reverse engineering tool: ${raw.replace(/_/g, ' ')}`,
    inputSchema: { type: 'object', properties: { target: { type: 'string' } } },
    access: toolAccessOf(`rea__${raw}`),
    source: 'external',
    serverId: 'rea',
    serverName: 'REA'
  }))
  for (let i = list.length; i < 160; i += 1) {
    const raw = `generic_probe_${i}`
    list.push({
      name: `rea__${raw}`,
      title: raw,
      description: `Auxiliary binary probe #${i}`,
      inputSchema: { type: 'object', properties: {} },
      access: 'write',
      source: 'external',
      serverId: 'rea',
      serverName: 'REA'
    })
  }
  return list
}

function makeTestModel(): Model<'openai-completions'> {
  return {
    id: 'gpt-6.1-sol',
    name: 'GPT-6.1 Sol',
    api: 'openai-completions',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_384,
    compat: {
      supportsStore: false,
      supportsMidConvoSystemMessages: false,
      supportsMidConvoToolAdditions: false
    }
  }
}

function makeAssistantResponse(
  model: Model<'openai-completions'>,
  content: AssistantMessage['content'],
  stopReason: AssistantMessage['stopReason']
): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 50,
      output: 20,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 70,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason,
    timestamp: Date.now()
  }
}

describe('Pi MCP 工具按需懒加载引擎（彻底解决 OpenAI <= 128 工具硬上限）', () => {
  it('1. 完整覆盖全部内建 Studio + Blender 工具，且默认常驻激活工具仅 ~24 个（远低于 128）', () => {
    const realDescriptors = listInProcessStudioAndBlenderTools()
    expect(realDescriptors.length).toBeGreaterThanOrEqual(100)

    const assignedSet = new Set<string>([
      ...STUDIO_CORE_TOOL_NAMES,
      ...BUILTIN_LAZY_TOOLSETS.flatMap((g) => g.toolNames)
    ])

    let accessView: McpAccessView = { mode: 'craft', confirmed: false }
    const backend: LazyMcpBackend = {
      listStudioAndBlenderTools: () => realDescriptors,
      listExternalServers: () => [{ id: 'rea', name: 'REA' }],
      listExternalTools: async () => make160ReaExternalTools(),
      callMcpTool: async (name) => ({ result: { called: name } })
    }

    const manager = new McpLazyToolsetManager({
      backend,
      getRequestContext: () => ({ mode: accessView.mode, runId: 'r1' }),
      getAccessView: () => accessView
    })
    const native = [...makeDummyNativeTools(11), manager.createLoadToolsetTool()]
    manager.setNativeToolsProvider(() => (accessView.mode === 'ask' ? [] : native))

    // Craft 默认状态：12 原生 + 12 studio_core = 24 个工具
    const baselineCraft = manager.buildActiveTools()
    expect(baselineCraft.length).toBe(24)
    expect(baselineCraft.length).toBeLessThan(MAX_ACTIVE_TOOLS)
    expect(baselineCraft.some((t) => t.name === 'load_toolset')).toBe(true)
    expect(baselineCraft.some((t) => t.name === 'graph_edit')).toBe(true)
    expect(baselineCraft.some((t) => t.name === 'execute_blender_code')).toBe(false)

    // 即使存在未显式列出的新工具，挂载 project_assets 后也会自动兜底收录，零孤岛工具
    const orphans = realDescriptors.filter((d) => !assignedSet.has(d.name))
    expect(orphans.length).toBe(0)

    // Ask 模式：暴露 0 个工具
    accessView = { mode: 'ask', confirmed: false }
    expect(manager.buildActiveTools()).toEqual([])
  })

  it('2. 同时挂载全部 6 个内建工具包 + 160 工具外部 MCP (rea) 时，LRU 淘汰与关键词相关性筛选严格锁死 <= 96 (< 128)', async () => {
    const realDescriptors = listInProcessStudioAndBlenderTools()
    const reaTools = make160ReaExternalTools()
    const accessView: McpAccessView = { mode: 'craft', confirmed: true }

    const manager = new McpLazyToolsetManager({
      backend: {
        listStudioAndBlenderTools: () => realDescriptors,
        listExternalServers: () => [{ id: 'rea', name: 'REA' }],
        listExternalTools: async () => reaTools,
        callMcpTool: async (name) => ({ result: { ok: true, name } })
      },
      getRequestContext: () => ({ mode: 'craft', runId: 'r2' }),
      getAccessView: () => accessView
    })
    const native = [...makeDummyNativeTools(11), manager.createLoadToolsetTool()]
    manager.setNativeToolsProvider(() => native)

    // 先验证外部超大 MCP 按 query 精准筛选 <= 32 个最相关工具
    const filteredRea = selectRelevantExternalTools(reaTools, 'android apk jeb decompile')
    expect(filteredRea.selected.length).toBeLessThanOrEqual(MAX_EXTERNAL_TOOLS_PER_LOAD)
    expect(filteredRea.selected.some((t) => t.name === 'rea__inspect_android_package')).toBe(true)
    expect(filteredRea.selected.some((t) => t.name === 'rea__decompile_jeb_item')).toBe(true)
    expect(filteredRea.omittedNames.length).toBe(reaTools.length - filteredRea.selected.length)

    // 连续挂载全部 6 个内置域 + 160 工具的 ext:rea，每一步激活工具数都严格 <= 96 < 128
    for (const entry of BUILTIN_LAZY_TOOLSETS) {
      await manager.loadToolsets([entry.id])
      const active = manager.buildActiveTools()
      expect(active.length).toBeLessThanOrEqual(MAX_ACTIVE_TOOLS)
      expect(active.length).toBeLessThan(128)
    }

    const loadExtOutcome = await manager.loadToolsets(
      ['ext:rea'],
      'android apk signature decompile'
    )
    expect(loadExtOutcome.evictedToolsets.length).toBeGreaterThan(0)

    const finalActive = manager.buildActiveTools()
    expect(finalActive.length).toBeLessThanOrEqual(MAX_ACTIVE_TOOLS)
    expect(finalActive.length).toBeLessThan(128)
    expect(finalActive.some((t) => t.name === 'rea__inspect_android_package')).toBe(true)
    // 常驻核心工具永不被淘汰
    for (const coreName of STUDIO_CORE_TOOL_NAMES) {
      expect(finalActive.some((t) => t.name === coreName)).toBe(true)
    }
  })

  it('3. 真实 Pi Agent 多轮回路：第 1 轮调用 load_toolset 动态挂载 Blender + REA，第 2 轮立即调用新工具且 OpenAI 请求体工具数恒 < 128', async () => {
    const realDescriptors = listInProcessStudioAndBlenderTools()
    const reaTools = make160ReaExternalTools()
    const executedMcpCalls: Array<{ name: string; args: Record<string, unknown> }> = []
    const observedRequestToolCounts: number[] = []

    const manager = new McpLazyToolsetManager({
      backend: {
        listStudioAndBlenderTools: () => realDescriptors,
        listExternalServers: () => [{ id: 'rea', name: 'REA' }],
        listExternalTools: async () => reaTools,
        callMcpTool: async (name, args) => {
          executedMcpCalls.push({ name, args })
          return { result: { ok: true, executed: name, args } }
        }
      },
      getRequestContext: () => ({ mode: 'craft', runId: 'run-live' }),
      getAccessView: () => ({ mode: 'craft', confirmed: true })
    })

    const loadToolsetTool = manager.createLoadToolsetTool()
    const native = [...makeDummyNativeTools(11), loadToolsetTool]
    manager.setNativeToolsProvider(() => native)

    const model = makeTestModel()
    let turnIndex = 0

    const agent = new Agent({
      initialState: {
        systemPrompt: 'Studio agent test',
        model,
        tools: manager.buildActiveTools(),
        messages: []
      },
      prepareNextTurnWithContext: (turn) => ({
        context: {
          messages: turn.context.messages,
          tools: manager.buildActiveTools()
        }
      }),
      streamFn: (_m, context) => {
        // 精确复刻 pi-ai OpenAI completions 在 supportsMidConvoToolAdditions: false ('none') 下的顶层 tools 计算
        const resolved = resolveTranscriptTools(context.messages, 'none')
        observedRequestToolCounts.push(resolved.requestTools.length)

        const stream = createAssistantMessageEventStream()
        turnIndex += 1

        if (turnIndex === 1) {
          // 第 1 轮：尚未挂载 Blender 与 REA，模型先调用 load_toolset
          expect(resolved.requestTools.some((t) => t.name === 'execute_blender_code')).toBe(false)
          expect(resolved.requestTools.some((t) => t.name === 'rea__inspect_android_package')).toBe(
            false
          )
          const msg = makeAssistantResponse(
            model,
            [
              {
                type: 'toolCall',
                id: 'call_load_1',
                name: 'load_toolset',
                arguments: {
                  toolsets: ['director_3d_blender', 'ext:rea'],
                  query: 'android apk decompile'
                }
              }
            ],
            'toolUse'
          )
          queueMicrotask(() => {
            stream.push({ type: 'start', partial: msg })
            stream.push({ type: 'done', reason: 'toolUse', message: msg })
            stream.end(msg)
          })
          return stream
        }

        if (turnIndex === 2) {
          // 第 2 轮：prepareNextTurnWithContext + declareToolChanges 已将新工具注入当前轮请求，且总数仍 < 128！
          expect(resolved.requestTools.some((t) => t.name === 'execute_blender_code')).toBe(true)
          expect(resolved.requestTools.some((t) => t.name === 'rea__inspect_android_package')).toBe(
            true
          )
          expect(resolved.requestTools.length).toBeLessThanOrEqual(MAX_ACTIVE_TOOLS)
          expect(resolved.requestTools.length).toBeLessThan(128)

          const msg = makeAssistantResponse(
            model,
            [
              {
                type: 'toolCall',
                id: 'call_blender_2',
                name: 'execute_blender_code',
                arguments: { code: 'import bpy; print(len(bpy.data.objects))' }
              },
              {
                type: 'toolCall',
                id: 'call_rea_2',
                name: 'rea__inspect_android_package',
                arguments: { target: 'game.apk' }
              }
            ],
            'toolUse'
          )
          queueMicrotask(() => {
            stream.push({ type: 'start', partial: msg })
            stream.push({ type: 'done', reason: 'toolUse', message: msg })
            stream.end(msg)
          })
          return stream
        }

        const doneMsg = makeAssistantResponse(
          model,
          [{ type: 'text', text: 'APK 逆向与 Blender 场景建模均已完成。' }],
          'stop'
        )
        queueMicrotask(() => {
          stream.push({ type: 'start', partial: doneMsg })
          stream.push({ type: 'done', reason: 'stop', message: doneMsg })
          stream.end(doneMsg)
        })
        return stream
      }
    })

    await agent.prompt('解包分析这个 APK 并在 Blender 中重建角色白模')

    expect(turnIndex).toBe(3)
    expect(observedRequestToolCounts).toHaveLength(3)
    for (const count of observedRequestToolCounts) {
      expect(count).toBeLessThanOrEqual(MAX_ACTIVE_TOOLS)
      expect(count).toBeLessThan(128)
    }
    expect(executedMcpCalls).toEqual([
      {
        name: 'execute_blender_code',
        args: { code: 'import bpy; print(len(bpy.data.objects))' }
      },
      {
        name: 'rea__inspect_android_package',
        args: { target: 'game.apk' }
      }
    ])
  })

  it('4. 提示词零回合意图预热 (prewarmForPrompt) 与底层 onPayload 128 硬兜底双保险', async () => {
    const realDescriptors = listInProcessStudioAndBlenderTools()
    const manager = new McpLazyToolsetManager({
      backend: {
        listStudioAndBlenderTools: () => realDescriptors,
        listExternalServers: () => [],
        listExternalTools: async () => [],
        callMcpTool: async () => ({ result: {} })
      },
      getRequestContext: () => ({ mode: 'craft', runId: 'r4' }),
      getAccessView: () => ({ mode: 'craft', confirmed: true })
    })
    manager.setNativeToolsProvider(() => makeDummyNativeTools(11))

    const prewarmed = await manager.prewarmForPrompt('帮我用 Blender 搭一个三点布光场景并导出 glb')
    expect(prewarmed).toContain('director_3d_blender')
    expect(manager.buildActiveTools().some((t) => t.name === 'execute_blender_code')).toBe(true)

    // 底层 onPayload 安全阀：即使传入 180 个工具也会在发出 HTTP 请求前截断至 <= 128
    const oversizedPayload = {
      model: 'gpt-6.1-sol',
      tools: Array.from({ length: 180 }, (_, i) => ({
        type: 'function',
        function: { name: `t_${i}` }
      }))
    }
    const capped = enforceOpenAiToolsLimitPayload(oversizedPayload) as { tools: unknown[] }
    expect(capped.tools).toHaveLength(128)
  })
})
