import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Model } from '@earendil-works/pi-ai'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  inferChatModelInputModalities,
  inferChatModelReasoning,
  isPiQuotaError,
  resolvePiModelFromProviders
} from '../src/main/agent/piModelResolver'
import {
  buildPiSessionExportZip,
  deletePiSession,
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
})
