import { describe, expect, it } from 'vitest'
import { Agent, type AgentMessage } from '@earendil-works/pi-agent-core'
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Model
} from '@earendil-works/pi-ai'
import type { HarnessTodoItem } from '../src/shared/ipc'
import { McpLazyToolsetManager } from '../src/main/agent/mcpLazyToolsets'
import {
  isPiContextOrPayloadOverflowError,
  isPiTransientUpstreamError,
  isPiUnsupportedImageError,
  type RuntimeAgentTool
} from '../src/main/agent/piModelResolver'
import {
  capSingleToolText,
  guardToolResultBlocks,
  hasBinarySignatureOrNullBytes,
  isSafePlainTextFilePath
} from '../src/main/agent/piPayloadGuard'
import {
  createPiFinishTurnController,
  runPiAgentWithSelfHealing
} from '../src/main/agent/piSelfHealing'
import {
  compactPiContextMessages,
  DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES,
  DEFAULT_MAX_CONTEXT_TEXT_BYTES,
  estimatePiMessagesPayloadBytes,
  stripRuntimeSystemMessages
} from '../src/main/agent/piSessionStore'

const TEST_MODEL: Model<'openai-completions'> = {
  id: 'claude-opus-4-6',
  name: 'Claude Opus 4.6',
  api: 'openai-completions',
  provider: 'custom-relay',
  baseUrl: 'https://relay.example.com/v1',
  input: ['text', 'image'],
  reasoning: true,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 32_768
}

function makeUsage(input = 100, output = 20): AssistantMessage['usage'] {
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  }
}

describe('Pi Agent 全链路防中断、8 MB 载荷守卫与故障自愈回归套件', () => {
  it('1. 载荷守卫：阻断 PNG/二进制伪装文本挂载，并将混入 PNG 乱码的数 MB JSON 治愈为合法紧凑 JSON', () => {
    expect(isSafePlainTextFilePath('Cache/gen/frame_01.png')).toBe(false)
    expect(isSafePlainTextFilePath('Cache/gen/clip.mp4')).toBe(false)
    expect(isSafePlainTextFilePath('Output/model.glb')).toBe(false)
    expect(isSafePlainTextFilePath('Assets/story.md')).toBe(true)
    expect(isSafePlainTextFilePath('Assets/economy.json')).toBe(true)

    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])
    expect(hasBinarySignatureOrNullBytes(pngHeader)).toBe(true)
    expect(
      hasBinarySignatureOrNullBytes(Buffer.from('Hello Studio Markdown\nLine 2', 'utf8'))
    ).toBe(false)

    // 复现真实故障：graph_read 节点 params.text 混入 2.6 MB 的 PNG UTF-8 乱码与超长 economy JSON
    const fakeCorruptedPngUtf8 = `\uFFFDPNG\r\n\u001a\n\u0000\u0000\u0000\rIHDR${'A'.repeat(2_600_000)}`
    const giantGraphReadJson = JSON.stringify({
      assetId: 'canvas-1',
      nodeCount: 2,
      nodes: [
        {
          id: 'v-img-1',
          typeId: 'asset.image',
          title: '分镜1',
          params: {
            prompt: 'cyberpunk hero',
            previewRelativePath: 'Cache/frame1.png',
            text: fakeCorruptedPngUtf8
          }
        },
        {
          id: 'econ-1',
          typeId: 'game.economy',
          title: '数值系统',
          params: {
            inlineDataUrl: `data:image/png;base64,${'B'.repeat(50_000)}`,
            bundle: 'X'.repeat(500_000)
          }
        }
      ],
      edges: [{ from: 'v-img-1', to: 'econ-1' }]
    })

    expect(giantGraphReadJson.length).toBeGreaterThan(3_000_000)
    const guarded = capSingleToolText(giantGraphReadJson, 120_000)
    expect(guarded.length).toBeLessThanOrEqual(120_000)

    // 治愈后的字符串仍然是合法 JSON，且保留全部节点 ID 与连线拓扑
    const parsed = JSON.parse(guarded) as {
      assetId: string
      nodes: Array<{ id: string; params: Record<string, string> }>
      edges: Array<{ from: string; to: string }>
    }
    expect(parsed.assetId).toBe('canvas-1')
    expect(parsed.nodes.map((n) => n.id)).toEqual(['v-img-1', 'econ-1'])
    expect(parsed.nodes[0]?.params.text).toContain('binary media payload omitted')
    expect(parsed.nodes[1]?.params.inlineDataUrl).toContain('inline data:image/png;base64 omitted')
    expect(parsed.edges).toEqual([{ from: 'v-img-1', to: 'econ-1' }])

    // 单次工具超过 4 张图片时自动裁剪尾部并给出说明
    const sixSmallImages = Array.from({ length: 6 }, () => ({
      type: 'image' as const,
      data: Buffer.from('tiny-img').toString('base64'),
      mimeType: 'image/png'
    }))
    const guardedBlocks = guardToolResultBlocks([
      { type: 'text', text: '{"ok":true}' },
      ...sixSmallImages
    ])
    expect(guardedBlocks.filter((b) => b.type === 'image')).toHaveLength(4)
  })

  it('2. 会话自愈压缩：复现 s_mwer9473_02gcu8 巨型损坏会话（消息总数 < 10、单轮内 13 MB 载荷 + 空壳 error 帧），恢复后直接降至安全字节线内', () => {
    const corruptedPngText = `\uFFFDPNG\r\n\u001a\n\u0000\u0000\u0000\rIHDR${'P'.repeat(4_500_000)}`
    const brokenMegaSession: AgentMessage[] = [
      { role: 'user', content: '把这个链接做成宣传片', timestamp: 100 },
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'call_run_1', name: 'task_run', arguments: { nodeIds: ['n1'] } }
        ],
        api: 'openai-completions',
        provider: 'custom',
        model: 'claude-opus-4-6',
        usage: makeUsage(2_000, 80),
        stopReason: 'toolUse',
        timestamp: 110
      },
      {
        role: 'toolResult',
        toolCallId: 'call_run_1',
        toolName: 'task_run',
        content: [
          { type: 'text', text: '{"status":"done"}' },
          { type: 'image', data: 'I'.repeat(2_800_000), mimeType: 'image/png' },
          { type: 'image', data: 'J'.repeat(2_800_000), mimeType: 'image/png' }
        ],
        isError: false,
        timestamp: 120
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Frame 2 is excellent. Frame 1 got badly corrupted — let me check and regenerate #1.'
          },
          {
            type: 'toolCall',
            id: 'call_gread_1',
            name: 'graph_read',
            arguments: { includeParams: true }
          }
        ],
        api: 'openai-completions',
        provider: 'custom',
        model: 'claude-opus-4-6',
        usage: makeUsage(6_000, 95),
        stopReason: 'toolUse',
        timestamp: 130
      },
      {
        role: 'toolResult',
        toolCallId: 'call_gread_1',
        toolName: 'graph_read',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              assetId: 'c1',
              nodes: [{ id: 'n1', params: { text: corruptedPngText } }]
            })
          }
        ],
        isError: false,
        timestamp: 140
      },
      {
        role: 'assistant',
        content: [],
        api: 'openai-completions',
        provider: 'custom',
        model: 'claude-opus-4-6',
        usage: makeUsage(0, 0),
        stopReason: 'error',
        errorMessage: '400: {"message":"The total text input size exceeds 8 MB","code":400}',
        timestamp: 150
      }
    ]

    const stripped = stripRuntimeSystemMessages(brokenMegaSession)
    // 空壳 error assistant 消息已被自动剥离
    expect(stripped).toHaveLength(5)

    const beforeBytes = estimatePiMessagesPayloadBytes(stripped)
    expect(beforeBytes.totalBytes).toBeGreaterThan(10_000_000)

    const healed = compactPiContextMessages(stripped, {
      contextWindow: 200_000
    })
    const afterBytes = estimatePiMessagesPayloadBytes(healed)
    expect(afterBytes.textBytes).toBeLessThanOrEqual(DEFAULT_MAX_CONTEXT_TEXT_BYTES)
    expect(afterBytes.totalBytes).toBeLessThanOrEqual(DEFAULT_MAX_CONTEXT_PAYLOAD_BYTES)

    // toolCall <-> toolResult 配对 100% 保持完整
    const callIds = healed
      .filter((m): m is Extract<AgentMessage, { role: 'assistant' }> => m.role === 'assistant')
      .flatMap((m) => m.content.filter((b) => b.type === 'toolCall').map((b) => b.id))
    const resultIds = healed
      .filter((m): m is Extract<AgentMessage, { role: 'toolResult' }> => m.role === 'toolResult')
      .map((m) => m.toolCallId)
    expect(callIds).toEqual(['call_run_1', 'call_gread_1'])
    expect(resultIds).toEqual(['call_run_1', 'call_gread_1'])
  })

  it('3. 错误分类器精准识别 8 MB 字节溢出、多模态图片不支持与瞬时网关断流，并排除 401/402 确定性错误', () => {
    const err8Mb: AssistantMessage = {
      role: 'assistant',
      content: [],
      api: 'openai-completions',
      provider: 'custom',
      model: 'claude-opus-4-6',
      usage: makeUsage(0, 0),
      stopReason: 'error',
      errorMessage: '400: {"message":"The total text input size exceeds 8 MB","code":400}',
      timestamp: Date.now()
    }
    expect(isPiContextOrPayloadOverflowError(err8Mb, 200_000)).toBe(true)
    expect(isPiTransientUpstreamError(err8Mb)).toBe(false)

    const errImg: AssistantMessage = {
      ...err8Mb,
      errorMessage: '400: Invalid content type: image_url is not supported by this model'
    }
    expect(isPiUnsupportedImageError(errImg)).toBe(true)
    expect(isPiTransientUpstreamError(errImg)).toBe(false)

    const err502: AssistantMessage = {
      ...err8Mb,
      errorMessage: '502 Bad Gateway: upstream prematurely closed connection'
    }
    expect(isPiTransientUpstreamError(err502)).toBe(true)

    const err402: AssistantMessage = {
      ...err8Mb,
      errorMessage: '402 Insufficient Balance'
    }
    expect(isPiTransientUpstreamError(err402)).toBe(false)

    const err401: AssistantMessage = {
      ...err8Mb,
      errorMessage: '401 Unauthorized: invalid api key'
    }
    expect(isPiTransientUpstreamError(err401)).toBe(false)
  })

  it('4. runPiAgentWithSelfHealing：遇到 8 MB 文本超限与 502 瞬时断流时自动压缩/重连续跑直至完成，不丢弃已完成工具成果', async () => {
    const priorMessages: AgentMessage[] = [
      { role: 'user', content: '第一轮历史', timestamp: 10 },
      {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'old_tc', name: 'bash', arguments: { command: 'dir' } }],
        api: 'openai-completions',
        provider: 'custom',
        model: TEST_MODEL.id,
        usage: makeUsage(500, 30),
        stopReason: 'toolUse',
        timestamp: 20
      },
      {
        role: 'toolResult',
        toolCallId: 'old_tc',
        toolName: 'bash',
        content: [{ type: 'text', text: 'Z'.repeat(3_200_000) }],
        isError: false,
        timestamp: 30
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: '第一轮已完成' }],
        api: 'openai-completions',
        provider: 'custom',
        model: TEST_MODEL.id,
        usage: makeUsage(800, 20),
        stopReason: 'stop',
        timestamp: 40
      }
    ]

    let streamCalls = 0
    const statusLogs: string[] = []
    let finalOutput = ''

    const agent = new Agent({
      initialState: {
        systemPrompt: 'Studio Pi Agent',
        model: TEST_MODEL,
        tools: [],
        messages: priorMessages
      },
      streamFn: (_model, context) => {
        streamCalls += 1
        const stream = createAssistantMessageEventStream()
        queueMicrotask(() => {
          if (streamCalls === 1) {
            // 第一次请求命中 8 MB 输入大小超限 400
            const fail8Mb: AssistantMessage = {
              role: 'assistant',
              content: [],
              api: 'openai-completions',
              provider: 'custom',
              model: TEST_MODEL.id,
              usage: makeUsage(0, 0),
              stopReason: 'error',
              errorMessage: '400: {"message":"The total text input size exceeds 8 MB","code":400}',
              timestamp: Date.now()
            }
            stream.push({ type: 'error', reason: 'error', error: fail8Mb })
            stream.end(fail8Mb)
            return
          }
          if (streamCalls === 2) {
            // 验证历史 3.2 MB 工具输出已被紧急压缩，且紧接着模拟一次 502 网关闪断
            const totalChars = JSON.stringify(context.messages).length
            expect(totalChars).toBeLessThan(200_000)
            const fail502: AssistantMessage = {
              role: 'assistant',
              content: [],
              api: 'openai-completions',
              provider: 'custom',
              model: TEST_MODEL.id,
              usage: makeUsage(0, 0),
              stopReason: 'error',
              errorMessage: '502 Bad Gateway: fetch failed (socket hang up)',
              timestamp: Date.now()
            }
            stream.push({ type: 'error', reason: 'error', error: fail502 })
            stream.end(fail502)
            return
          }
          const okMsg: AssistantMessage = {
            role: 'assistant',
            content: [{ type: 'text', text: '已自动恢复并完成全部宣传片分镜重绘与合成！' }],
            api: 'openai-completions',
            provider: 'custom',
            model: TEST_MODEL.id,
            usage: makeUsage(1_200, 40),
            stopReason: 'stop',
            timestamp: Date.now()
          }
          stream.push({ type: 'start', partial: okMsg })
          stream.push({
            type: 'text_delta',
            contentIndex: 0,
            delta: '已自动恢复并完成全部宣传片分镜重绘与合成！',
            partial: okMsg
          })
          stream.push({ type: 'done', reason: 'stop', message: okMsg })
          stream.end(okMsg)
        })
        return stream
      }
    })

    agent.subscribe((ev) => {
      if (ev.type === 'message_update' && ev.assistantMessageEvent.type === 'text_delta') {
        finalOutput += ev.assistantMessageEvent.delta
      }
    })

    await runPiAgentWithSelfHealing({
      agent,
      prompt: '继续重绘第 1 帧并合成最终视频',
      retryDelaysMs: [10, 10],
      onStatus: (text) => statusLogs.push(text)
    })

    expect(streamCalls).toBe(3)
    expect(statusLogs).toHaveLength(2)
    expect(statusLogs[0]).toContain('压缩瘦身')
    expect(statusLogs[1]).toContain('自动恢复')
    expect(finalOutput).toBe('已自动恢复并完成全部宣传片分镜重绘与合成！')
    expect(agent.state.errorMessage).toBeUndefined()
  })

  it('5. createPiFinishTurnController：Craft 模式下模型登记 todo_write 后半途口头停下时自动接力推进，全部完成后正常结束', async () => {
    let todos: HarnessTodoItem[] = []
    let agentRef: Agent | null = null

    const finishController = createPiFinishTurnController({
      getAgent: () => agentRef,
      getMode: () => 'craft',
      getTodos: () => todos
    })

    const todoTool: RuntimeAgentTool = {
      name: 'todo_write',
      label: 'Todo',
      description: 'Update todos',
      parameters: { type: 'object', properties: {} },
      execute: async (_id, params: Record<string, unknown>) => {
        todos = (params.todos as HarnessTodoItem[]) ?? []
        finishController.markTodosActivated()
        return { content: [{ type: 'text', text: '{"ok":true}' }], details: null }
      }
    }

    let turnIdx = 0
    const agent = new Agent({
      initialState: {
        systemPrompt: 'Craft Studio Agent',
        model: TEST_MODEL,
        tools: [todoTool]
      },
      streamFn: () => {
        turnIdx += 1
        const stream = createAssistantMessageEventStream()
        queueMicrotask(() => {
          if (turnIdx === 1) {
            // 第 1 轮：登记 2 个任务（1 完成，1 待办）
            const msg1: AssistantMessage = {
              role: 'assistant',
              content: [
                {
                  type: 'toolCall',
                  id: 'tc_todo_1',
                  name: 'todo_write',
                  arguments: {
                    todos: [
                      { id: '1', content: '提取图文素材', status: 'completed' },
                      { id: '2', content: '重绘第 1 帧并合成宣传片', status: 'in_progress' }
                    ]
                  }
                }
              ],
              api: 'openai-completions',
              provider: 'custom',
              model: TEST_MODEL.id,
              usage: makeUsage(400, 40),
              stopReason: 'toolUse',
              timestamp: Date.now()
            }
            stream.push({ type: 'done', reason: 'toolUse', message: msg1 })
            stream.end(msg1)
            return
          }
          if (turnIdx === 2) {
            // 第 2 轮：复现截图 1 —— 模型只说了一句“let me regenerate #1”就意外 stop（未调工具）
            const msg2: AssistantMessage = {
              role: 'assistant',
              content: [
                {
                  type: 'text',
                  text: 'Frame 2 is excellent. Frame 1 got badly corrupted — let me regenerate #1.'
                }
              ],
              api: 'openai-completions',
              provider: 'custom',
              model: TEST_MODEL.id,
              usage: makeUsage(500, 25),
              stopReason: 'stop',
              timestamp: Date.now()
            }
            stream.push({ type: 'done', reason: 'stop', message: msg2 })
            stream.end(msg2)
            return
          }
          if (turnIdx === 3) {
            // 第 3 轮：收到 finishTurn 自动接力提醒，把最后一个 todo 标记为 completed
            const msg3: AssistantMessage = {
              role: 'assistant',
              content: [
                {
                  type: 'toolCall',
                  id: 'tc_todo_2',
                  name: 'todo_write',
                  arguments: {
                    todos: [
                      { id: '1', content: '提取图文素材', status: 'completed' },
                      { id: '2', content: '重绘第 1 帧并合成宣传片', status: 'completed' }
                    ]
                  }
                }
              ],
              api: 'openai-completions',
              provider: 'custom',
              model: TEST_MODEL.id,
              usage: makeUsage(600, 40),
              stopReason: 'toolUse',
              timestamp: Date.now()
            }
            stream.push({ type: 'done', reason: 'toolUse', message: msg3 })
            stream.end(msg3)
            return
          }
          const msg4: AssistantMessage = {
            role: 'assistant',
            content: [{ type: 'text', text: '宣传片已全部合成完毕！' }],
            api: 'openai-completions',
            provider: 'custom',
            model: TEST_MODEL.id,
            usage: makeUsage(700, 20),
            stopReason: 'stop',
            timestamp: Date.now()
          }
          stream.push({ type: 'done', reason: 'stop', message: msg4 })
          stream.end(msg4)
        })
        return stream
      },
      finishTurn: (turn) => finishController.finishTurn(turn)
    })
    agentRef = agent

    await runPiAgentWithSelfHealing({ agent, prompt: '生成完整宣传片' })
    expect(turnIdx).toBe(4)
    expect(todos.every((t) => t.status === 'completed')).toBe(true)
  })

  it('6. McpLazyToolsetManager.prewarmForPrompt：整词边界匹配防止 create/read/stream 误唤醒 ext:rea，且失败后具备冷却保护', async () => {
    let externalProbeCalls = 0
    const manager = new McpLazyToolsetManager({
      backend: {
        listStudioAndBlenderTools: () => [],
        listExternalServers: () => [{ id: 'rea', name: 'Reverse Engineer Anything' }],
        listExternalTools: async () => {
          externalProbeCalls += 1
          return []
        },
        callMcpTool: async () => ({ result: {} })
      },
      getRequestContext: () => ({ mode: 'craft', runId: 'r-rea' }),
      getAccessView: () => ({ mode: 'craft', confirmed: true })
    })

    // 包含 "create" / "read" / "stream" / "area" 等含 rea 子串的日常英文词绝不误触发 ext:rea
    await manager.prewarmForPrompt('Please create a promo video, read the script, and stream audio')
    expect(externalProbeCalls).toBe(0)

    // 明确要求反编译 APK 时触发探测；若外部服务启动失败（返回 []），60s 冷却期内不重复拉起子进程
    await manager.prewarmForPrompt('帮我反编译这个 game.apk')
    expect(externalProbeCalls).toBe(1)

    await manager.prewarmForPrompt('继续反编译分析 libil2cpp.so')
    expect(externalProbeCalls).toBe(1)
  })
})
