import { describe, expect, it } from 'vitest'
import {
  createEmptyModalityMap,
  type ModelProviderInstance,
  type ModelProviderKind
} from '../src/shared/modelProvider'
import { settingsModalitiesFor } from '../src/shared/modelProviders/settingsModalities'

/**
 * 设置页的模态页签。
 *
 * 这条是从组件里提出来才可测的 —— 而「页签凭空消失」正是那种**很难发现**的问题：
 * 用户只会觉得功能没了，测试里也没有断言能挂住。踩过两次：
 * - ElevenLabs 的硬编码 `['audio']` 漏了 `/v1/music`，音乐页签不出现
 * - MiniMax / DashScope 同理，导致这两家的音乐模型在设置里勾不到
 * 根因是「声音 / 音乐」这两类能力被写死在多份列表里，拆出新模态时挨个漏改。
 */
function provider(kind: ModelProviderKind, overrides?: Partial<ModelProviderInstance>) {
  return {
    id: `p-${kind}`,
    providerKind: kind,
    label: kind,
    apiKey: 'k',
    baseUrl: 'https://example.com',
    enabled: true,
    modalities: createEmptyModalityMap(),
    ...overrides
  } satisfies ModelProviderInstance
}

describe('设置页模态页签', () => {
  it('有音乐能力的商家都给出「音乐」页签', () => {
    // OpenRouter 也在此列：它聚合了 Google Lyria 3 音乐生成
    // （走 /audio/speech，没有 /v1/music 端点）
    for (const kind of ['elevenlabs', 'minimax', 'dashscope', 'openrouter'] as const) {
      expect(settingsModalitiesFor(provider(kind)), kind).toContain('music')
    }
  })

  it('没有音乐能力的商家不给「音乐」页签（OpenAI 只有 TTS）', () => {
    for (const kind of ['openai', 'anthropic', 'deepseek', 'google', 'xai', 'custom'] as const) {
      expect(settingsModalitiesFor(provider(kind)), kind).not.toContain('music')
    }
  })

  it('声音页签只在真的支持 TTS 时出现', () => {
    // OpenAI / OpenRouter 走 /audio/speech；ElevenLabs 走自己的 TTS 端点
    for (const kind of ['openai', 'openrouter', 'elevenlabs', 'minimax', 'dashscope'] as const) {
      expect(settingsModalitiesFor(provider(kind)), kind).toContain('audio')
    }
    // Google / xAI / DeepSeek 都没有 TTS
    for (const kind of ['google', 'xai', 'deepseek'] as const) {
      expect(settingsModalitiesFor(provider(kind)), kind).not.toContain('audio')
    }
  })

  it('ElevenLabs 同时有声音与音乐（此前只有声音）', () => {
    const tabs = settingsModalitiesFor(provider('elevenlabs'))
    expect(tabs).toEqual(['audio', 'music'])
  })

  it('OpenRouter 的声音与音乐都在（音乐走 /audio/speech，不是 /v1/music）', () => {
    expect(settingsModalitiesFor(provider('openrouter'))).toEqual([
      'text',
      'image',
      'video',
      'audio',
      'music',
      'decisions'
    ])
  })

  it('页签顺序跟 MODEL_MODALITIES 一致（不因合并而乱序）', () => {
    // MiniMax：文本 / 图片 / 视频 / 声音 / 音乐
    expect(settingsModalitiesFor(provider('minimax'))).toEqual([
      'text',
      'image',
      'video',
      'audio',
      'music'
    ])
    // 方舟没有音乐端点，不该冒出 music
    expect(settingsModalitiesFor(provider('volcengine-ark'))).toEqual([
      'text',
      'image',
      'video',
      'audio'
    ])
  })

  it('不该出现「空页签」：3D / 空间世界 / 决策只给对应商家', () => {
    expect(settingsModalitiesFor(provider('tripo'))).toEqual(['model3d'])
    expect(settingsModalitiesFor(provider('worldlabs'))).toEqual(['spatialWorld'])
    expect(settingsModalitiesFor(provider('typesafe'))).toEqual(['decisions'])
    // 本地 OpenAI 兼容：仅文本
    expect(settingsModalitiesFor(provider('ollama'))).toEqual(['text'])
    // 自定义：OpenAI 兼容给文本 + 图片
    expect(settingsModalitiesFor(provider('custom'))).toEqual(['text', 'image'])
  })

  it('每个页签都在 MODEL_MODALITIES 里（不产生未知模态）', () => {
    const kinds: ModelProviderKind[] = [
      'openrouter',
      'openai',
      'elevenlabs',
      'minimax',
      'dashscope',
      'volcengine-ark',
      'comfyui',
      'custom',
      'tripo',
      'worldlabs',
      'typesafe',
      'kling'
    ]
    for (const kind of kinds) {
      for (const mod of settingsModalitiesFor(provider(kind))) {
        expect(
          ['text', 'image', 'video', 'audio', 'music', 'model3d', 'spatialWorld', 'decisions'],
          `${kind} → ${mod}`
        ).toContain(mod)
      }
    }
  })
})
