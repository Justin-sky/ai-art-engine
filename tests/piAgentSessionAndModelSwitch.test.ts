import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Agent, type AgentMessage } from '@earendil-works/pi-agent-core'
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Model
} from '@earendil-works/pi-ai'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MIN_SAFE_OUTPUT_TOKENS,
  enforceOpenAiToolsLimitPayload,
  inferChatModelInputModalities,
  inferChatModelReasoning,
  isPiQuotaError,
  resolveChatModelContextWindow,
  resolvePiModelFromProviders
} from '../src/main/agent/piModelResolver'
import {
  buildPiSessionExportZip,
  compactPiContextMessages,
  deletePiSession,
  estimatePiMessagesTokens,
  loadPiSession,
  rewindPiSession,
  savePiSession,
  searchPiSessions
} from '../src/main/agent/piSessionStore'
import type { ModelProviderInstance } from '../src/shared/modelProvider'

function makeProvider(overrides: Partial<ModelProviderInstance>): ModelProviderInstance {
  return {
    id: overrides.id ?? 'prov-1',
    name: overrides.name ?? 'Test Provider',
    providerKind: overrides.providerKind ?? 'openai',
    enabled: overrides.enabled ?? true,
    apiKey: overrides.apiKey ?? 'sk-test-123',
    baseUrl: overrides.baseUrl ?? 'https://api.openai.com/v1',
    modalities: overrides.modalities ?? {
      text: {
        enabled: true,
        selectedModelIds: ['gpt-6.1-sol'],
        defaultModelId: 'gpt-6.1-sol'
      }
    },
    ...overrides
  } as ModelProviderInstance
}

describe('Pi 无锁会话持久化、回退分叉、全文检索与多供应商中途无锁切换', () => {
  let tempHome = ''

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'pi-session-test-'))
  })

  afterEach(() => {
    if (tempHome) {
      rmSync(tempHome, { recursive: true, force: true })
    }
  })

  it('1. 原子 JSON 会话读写自动剥离临时 system 消息，支持在同一会话内无缝跨供应商切模型（零文件句柄锁）', async () => {
    savePiSession(tempHome, {
      sessionId: 'sess-switch-1',
      cwd: 'F:/project-alpha',
      loadedToolsets: ['director_3d_blender'],
      todos: [{ id: 't1', content: '搭建场景', status: 'completed' }],
      goal: null,
      messages: [
        {
          role: 'system',
          content: 'old system prompt from provider A',
          timestamp: 1
        } as unknown as Parameters<typeof savePiSession>[1]['messages'][number],
        { role: 'user', content: '帮我设计一座赛博朋克灯塔', timestamp: 2 },
        {
          role: 'assistant',
          content: [{ type: 'text', text: '好的，已完成赛博朋克灯塔基础构图。' }],
          api: 'openai-completions',
          provider: 'deepseek',
          model: 'deepseek-chat',
          usage: {
            input: 10,
            output: 20,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 30,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
          },
          stopReason: 'stop',
          timestamp: 3
        },
        { role: 'user', content: '现在切换到 Claude 继续细化材质细节', timestamp: 4 },
        {
          role: 'assistant',
          content: [{ type: 'text', text: '已使用金属拉丝与霓虹体积雾细化灯塔材质。' }],
          api: 'anthropic-messages',
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          usage: {
            input: 30,
            output: 40,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 70,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
          },
          stopReason: 'stop',
          timestamp: 5
        }
      ]
    })

    // 立即覆盖写入（验证不存在 JSONL/zstd 常驻文件句柄锁）
    const loaded = loadPiSession(tempHome, 'sess-switch-1')
    expect(loaded).not.toBeNull()
    expect(loaded!.title).toBe('帮我设计一座赛博朋克灯塔')
    expect(loaded!.loadedToolsets).toEqual(['director_3d_blender'])
    // system 快照已被剥离，仅剩 4 条干净的 user/assistant 消息
    expect(loaded!.messages).toHaveLength(4)
    expect(loaded!.messages.some((m) => m.role === 'system')).toBe(false)

    // 跨会话全文检索
    const hits = searchPiSessions(tempHome, { query: '霓虹体积雾' })
    expect(hits.ok).toBe(true)
    expect(hits.hits).toHaveLength(1)
    expect(hits.hits[0]?.sessionId).toBe('sess-switch-1')

    // 导出 .zip 归档
    const exported = await buildPiSessionExportZip(tempHome, 'sess-switch-1')
    expect(exported).not.toBeNull()
    expect(exported!.fileCount).toBe(2)
    const zip = await JSZip.loadAsync(exported!.buffer)
    expect(Object.keys(zip.files)).toContain('session.json')
    expect(Object.keys(zip.files)).toContain('transcript.md')
    const transcriptMd = await zip.file('transcript.md')!.async('string')
    expect(transcriptMd).toContain('赛博朋克灯塔')

    // 分叉 (Fork) 与原地回退 (Rewind)
    const forked = rewindPiSession(tempHome, {
      sessionId: 'sess-switch-1',
      keepTurns: 1,
      fork: true
    })
    expect(forked.ok).toBe(true)
    expect(forked.sessionId).toBeTruthy()
    expect(forked.sessionId).not.toBe('sess-switch-1')
    expect(loadPiSession(tempHome, forked.sessionId!)?.messages).toHaveLength(2)
    // 原会话仍保留完整 4 条消息
    expect(loadPiSession(tempHome, 'sess-switch-1')?.messages).toHaveLength(4)

    // 原地回退到第 1 轮
    const rewound = rewindPiSession(tempHome, {
      sessionId: 'sess-switch-1',
      keepTurns: 1,
      fork: false
    })
    expect(rewound.ok).toBe(true)
    expect(loadPiSession(tempHome, 'sess-switch-1')?.messages).toHaveLength(2)

    expect(deletePiSession(tempHome, 'sess-switch-1')).toBe(true)
    expect(loadPiSession(tempHome, 'sess-switch-1')).toBeNull()
  })

  it('2. 多协议模型解析器精准映射 OpenAI / Anthropic / DeepSeek (/v1 & /anthropic) / Gemini 并设置 supportsMidConvoToolAdditions: false', () => {
    const providers: ModelProviderInstance[] = [
      makeProvider({
        id: 'ds-1',
        name: 'DeepSeek Official',
        providerKind: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        modalities: {
          text: {
            enabled: true,
            selectedModelIds: ['deepseek-chat', 'deepseek-reasoner'],
            defaultModelId: 'deepseek-chat'
          }
        }
      }),
      makeProvider({
        id: 'anth-1',
        name: 'Anthropic Claude',
        providerKind: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        modalities: {
          text: {
            enabled: true,
            selectedModelIds: ['claude-sonnet-4-5'],
            defaultModelId: 'claude-sonnet-4-5'
          }
        }
      }),
      makeProvider({
        id: 'oai-1',
        name: 'OpenAI Relay',
        providerKind: 'openai',
        baseUrl: 'https://relay.example.com/v1',
        modalities: {
          text: {
            enabled: true,
            selectedModelIds: ['gpt-6.1-sol'],
            defaultModelId: 'gpt-6.1-sol'
          }
        }
      })
    ]

    // DeepSeek 纯文本模型 -> openai-completions, input 仅 ['text']（自动防 image_url 400）
    const dsChat = resolvePiModelFromProviders(providers, {
      providerId: 'ds-1',
      modelId: 'deepseek-chat'
    })
    expect(dsChat?.model.api).toBe('openai-completions')
    expect(dsChat?.model.input).toEqual(['text'])
    expect(dsChat?.model.reasoning).toBe(false)

    // DeepSeek Reasoner -> reasoning: true
    expect(inferChatModelReasoning('deepseek-reasoner')).toBe(true)
    expect(inferChatModelInputModalities('gpt-4o')).toEqual(['text', 'image'])

    // Anthropic -> anthropic-messages, baseUrl 自动去掉末尾 /v1 防 SDK 拼出 /v1/v1/messages
    const claude = resolvePiModelFromProviders(providers, {
      providerId: 'anth-1',
      modelId: 'claude-sonnet-4-5'
    })
    expect(claude?.model.api).toBe('anthropic-messages')
    expect(claude?.model.baseUrl).toBe('https://api.anthropic.com')
    expect(claude?.model.input).toEqual(['text', 'image'])

    // OpenAI Relay -> supportsMidConvoToolAdditions === false, supportsStore === false
    const oai = resolvePiModelFromProviders(providers, {
      providerId: 'oai-1',
      modelId: 'gpt-6.1-sol'
    })
    expect(oai?.model.api).toBe('openai-completions')
    const compat = (oai?.model as Model<'openai-completions'>).compat
    expect(compat?.supportsStore).toBe(false)
    expect(compat?.supportsMidConvoToolAdditions).toBe(false)
  })

  it('3. isPiQuotaError 覆盖中英文余额不足、402 与欠费状态提示', () => {
    expect(isPiQuotaError('QUOTA: Insufficient Balance')).toBe(true)
    expect(isPiQuotaError('HTTP 402 Payment Required')).toBe(true)
    expect(isPiQuotaError('error: insufficient_quota on account')).toBe(true)
    expect(isPiQuotaError('DeepSeek 账户余额不足，请充值')).toBe(true)
    expect(isPiQuotaError('API Key 已欠费，请联系管理员')).toBe(true)
    expect(isPiQuotaError('rate limit exceeded, retry after 30s')).toBe(false)
    expect(isPiQuotaError('network timeout')).toBe(false)
  })

  it('4. 真实上下文窗口读取（OpenRouter catalog + 模型家族兜底）与 onPayload 最小输出 Token 保护（根治 284K 时 max_completion_tokens=1 静默退出）', () => {
    const openRouterProv = makeProvider({
      id: 'or-1',
      name: 'OpenRouter',
      providerKind: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      modalities: {
        text: {
          selectedModelIds: ['deepseek/deepseek-v4.1-flash'],
          defaultModelId: 'deepseek/deepseek-v4.1-flash',
          catalog: {
            'deepseek/deepseek-v4.1-flash': {
              id: 'deepseek/deepseek-v4.1-flash',
              name: 'DeepSeek V4.1 Flash',
              capabilities: {
                context_length: 1_000_000,
                top_provider: { max_completion_tokens: 65_536 }
              }
            }
          }
        }
      } as ModelProviderInstance['modalities']
    })

    const resolved = resolvePiModelFromProviders([openRouterProv], {
      providerId: 'or-1',
      modelId: 'deepseek/deepseek-v4.1-flash'
    })
    expect(resolved).not.toBeNull()
    expect(resolved!.model.contextWindow).toBe(1_000_000)
    expect(resolved!.model.maxTokens).toBe(65_536)
    expect(resolved!.model.reasoning).toBe(true)

    // 即使没有 catalog 缓存，deepseek/deepseek-v4.1-flash 也会命中 1M 家族兜底而非被误压成 128K
    expect(resolveChatModelContextWindow('deepseek/deepseek-v4.1-flash')).toBe(1_048_576)
    expect(resolveChatModelContextWindow('gpt-5.2')).toBe(400_000)

    // 本地 Ollama 允许空 API Key
    const ollama = makeProvider({
      id: 'local-ollama',
      providerKind: 'ollama',
      apiKey: '',
      baseUrl: 'http://localhost:11434/v1',
      modalities: {
        text: {
          selectedModelIds: ['qwen3:14b'],
          defaultModelId: 'qwen3:14b'
        }
      } as ModelProviderInstance['modalities']
    })
    const resolvedLocal = resolvePiModelFromProviders([ollama], { providerId: 'local-ollama' })
    expect(resolvedLocal?.apiKey).toBe('local')

    // onPayload 保护：当 pi-ai 把 max_completion_tokens / max_tokens 压成 1 时自动抬升回 >= 4096
    const chokedPayload = enforceOpenAiToolsLimitPayload({
      model: 'deepseek/deepseek-v4.1-flash',
      max_completion_tokens: 1,
      max_tokens: 12
    }) as { max_completion_tokens: number; max_tokens: number }
    expect(chokedPayload.max_completion_tokens).toBe(MIN_SAFE_OUTPUT_TOKENS)
    expect(chokedPayload.max_tokens).toBe(MIN_SAFE_OUTPUT_TOKENS)

    const healthyPayload = { model: 'gpt-6.1-sol', max_completion_tokens: 16_384 }
    expect(enforceOpenAiToolsLimitPayload(healthyPayload)).toBe(healthyPayload)
  })

  it('5. compactPiContextMessages 原位折叠早期超大工具输出并对齐 user 轮次边界，保持 toolCallId 100% 成对且立即刷新 Token 水位', () => {
    const hugeDump = 'L'.repeat(45_000)
    const messages: AgentMessage[] = [
      {
        role: 'system',
        content: 'studio system prompt',
        toolsAdded: [{ name: 'bash' }, { name: 'graph_read' }],
        timestamp: 10
      } as unknown as AgentMessage,
      { role: 'user', content: '逆向解包并还原画布', timestamp: 20 },
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'call_bash_1', name: 'bash', arguments: { command: 'ls' } }
        ],
        api: 'openai-completions',
        provider: 'openrouter',
        model: 'deepseek/deepseek-v4.1-flash',
        usage: {
          input: 110_000,
          output: 100,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 110_100,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        },
        stopReason: 'toolUse',
        timestamp: 30
      },
      {
        role: 'toolResult',
        toolCallId: 'call_bash_1',
        toolName: 'bash',
        content: [{ type: 'text', text: hugeDump }],
        isError: false,
        timestamp: 40
      }
    ]

    // 再追加 12 条近期消息以构成受保护尾部窗口
    for (let i = 0; i < 6; i += 1) {
      messages.push({
        role: 'assistant',
        content: [{ type: 'toolCall', id: `recent_${i}`, name: 'graph_read', arguments: {} }],
        api: 'openai-completions',
        provider: 'openrouter',
        model: 'deepseek/deepseek-v4.1-flash',
        usage: {
          input: 115_000,
          output: 50,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 115_050,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        },
        stopReason: 'toolUse',
        timestamp: 100 + i * 2
      })
      messages.push({
        role: 'toolResult',
        toolCallId: `recent_${i}`,
        toolName: 'graph_read',
        content: [{ type: 'text', text: `recent output ${i}` }],
        isError: false,
        timestamp: 101 + i * 2
      })
    }

    const beforeTokens = estimatePiMessagesTokens(messages)
    expect(beforeTokens).toBeGreaterThan(110_000)

    const compacted = compactPiContextMessages(messages, {
      contextWindow: 128_000,
      keepRecentMessages: 10
    })

    // system 消息与所有 toolCall <-> toolResult 配对完整保留
    expect(compacted[0]?.role).toBe('system')
    expect(compacted).toHaveLength(messages.length)
    const firstToolResult = compacted[3] as Extract<AgentMessage, { role: 'toolResult' }>
    expect(firstToolResult.toolCallId).toBe('call_bash_1')
    const firstToolText = (firstToolResult.content[0] as { type: 'text'; text: string }).text
    expect(firstToolText.length).toBeLessThan(2_000)
    expect(firstToolText).toContain('历史工具输出已自动折叠')

    // 压缩后最新前缀 timestamp 已推进，估算水位回落到真实字符量级（远低于 10K）
    expect(estimatePiMessagesTokens(compacted)).toBeLessThan(10_000)

    // 强制 /compact 时严格在 user 轮次边界裁剪，首条非 system 消息绝不会是孤立 toolResult
    const multiTurn: AgentMessage[] = []
    for (let t = 1; t <= 5; t += 1) {
      multiTurn.push({ role: 'user', content: `turn ${t}`, timestamp: t * 10 })
      multiTurn.push({
        role: 'assistant',
        content: [{ type: 'toolCall', id: `tc_${t}`, name: 'bash', arguments: {} }],
        api: 'openai-completions',
        provider: 'openai',
        model: 'gpt-4o',
        usage: {
          input: 10,
          output: 10,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 20,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        },
        stopReason: 'toolUse',
        timestamp: t * 10 + 1
      })
      multiTurn.push({
        role: 'toolResult',
        toolCallId: `tc_${t}`,
        toolName: 'bash',
        content: [{ type: 'text', text: `res ${t}` }],
        isError: false,
        timestamp: t * 10 + 2
      })
    }
    const forcePruned = compactPiContextMessages(multiTurn, {
      contextWindow: 128_000,
      force: true
    })
    expect(forcePruned[0]?.role).toBe('user')
    expect(forcePruned).toHaveLength(9) // 精确保留最后 3 个完整 user 轮次（每轮 3 条）
  })

  it('6. 当模型在思维链阶段触发 stopReason="length"（0 工具调用、0 正文）时，finishTurn 自动续写并产出最终答复', async () => {
    const testModel: Model<'openai-completions'> = {
      id: 'deepseek/deepseek-v4.1-flash',
      name: 'DeepSeek V4.1 Flash',
      api: 'openai-completions',
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      input: ['text'],
      reasoning: true,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1_000_000,
      maxTokens: 32_768
    }

    let callIdx = 0
    let lengthContinuations = 0
    let collectedText = ''

    const agent = new Agent({
      initialState: {
        systemPrompt: 'Test agent',
        model: testModel,
        tools: []
      },
      streamFn: () => {
        callIdx += 1
        const stream = createAssistantMessageEventStream()
        queueMicrotask(() => {
          if (callIdx === 1) {
            // 复现 s_mwcye014_16jfwv.json 第 88 条消息：仅吐出 1 个 thinking 块即因 length 截断，无 text、无 toolCall
            const truncatedMsg: AssistantMessage = {
              role: 'assistant',
              content: [{ type: 'thinking', thinking: 'That' }],
              api: 'openai-completions',
              provider: 'openrouter',
              model: testModel.id,
              usage: {
                input: 165_659,
                output: 1,
                cacheRead: 118_400,
                cacheWrite: 0,
                totalTokens: 284_060,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
              },
              stopReason: 'length',
              timestamp: Date.now()
            }
            stream.push({ type: 'done', reason: 'length', message: truncatedMsg })
            stream.end(truncatedMsg)
          } else {
            const finalMsg: AssistantMessage = {
              role: 'assistant',
              content: [{ type: 'text', text: '已完成画布节点与逆向逻辑汇总。' }],
              api: 'openai-completions',
              provider: 'openrouter',
              model: testModel.id,
              usage: {
                input: 165_700,
                output: 24,
                cacheRead: 118_400,
                cacheWrite: 0,
                totalTokens: 284_124,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
              },
              stopReason: 'stop',
              timestamp: Date.now()
            }
            stream.push({ type: 'start', partial: finalMsg })
            stream.push({
              type: 'text_delta',
              contentIndex: 0,
              delta: '已完成画布节点与逆向逻辑汇总。',
              partial: finalMsg
            })
            stream.push({ type: 'done', reason: 'stop', message: finalMsg })
            stream.end(finalMsg)
          }
        })
        return stream
      },
      finishTurn: (turn) => {
        if (turn.message.stopReason === 'length' && turn.toolResults.length === 0) {
          if (lengthContinuations < 3) {
            lengthContinuations += 1
            agent.steer({
              role: 'user',
              content: '[System: Continue directly from where you stopped.]',
              timestamp: Date.now()
            })
            return { action: 'continue' }
          }
        }
        return undefined
      }
    })

    agent.subscribe((ev) => {
      if (ev.type === 'message_update' && ev.assistantMessageEvent.type === 'text_delta') {
        collectedText += ev.assistantMessageEvent.delta
      }
    })

    await agent.prompt('请根据 graph_read 结果给出完整分析')
    expect(callIdx).toBe(2)
    expect(lengthContinuations).toBe(1)
    expect(collectedText).toBe('已完成画布节点与逆向逻辑汇总。')
  })
})
