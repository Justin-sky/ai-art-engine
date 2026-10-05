import { describe, expect, it } from 'vitest'
import {
  buildModelOptions,
  buildModelVoiceOptions,
  pickDefaultModelKey,
  resolveEmptyModelOptionsReason
} from '../src/renderer/src/features/graph/model/generateModelOptions'
import { createEmptyModalityMap, type ModelProviderInstance } from '../src/shared/modelProvider'
function baseProvider(
  overrides: Partial<ModelProviderInstance> & Pick<ModelProviderInstance, 'id' | 'providerKind'>
): ModelProviderInstance {
  const modalities = createEmptyModalityMap()
  modalities.image.selectedModelIds = ['m1']
  modalities.image.defaultModelId = 'm1'
  return {
    label: overrides.label ?? overrides.providerKind,
    apiKey: 'ak',
    baseUrl: 'https://example.com',
    enabled: true,
    modalities,
    ...overrides
  }
}

describe('buildModelOptions', () => {
  it('includes kling providers with apiKey only', () => {
    const providers = [
      baseProvider({ id: 'k1', providerKind: 'kling', apiKey: '' }),
      baseProvider({ id: 'k2', providerKind: 'kling', apiKey: 'key' })
    ]
    const options = buildModelOptions(providers, 'image')
    expect(options.map((o) => o.providerInstanceId)).toEqual(['k2'])
  })

  it('pickDefaultModelKey uses first kling with apiKey', () => {
    const providers = [
      baseProvider({ id: 'k1', providerKind: 'kling', apiKey: '' }),
      baseProvider({ id: 'k2', providerKind: 'kling', apiKey: 'key' })
    ]
    const options = buildModelOptions(providers, 'image')
    expect(pickDefaultModelKey(providers, 'image', options)).toBe('k2::m1')
  })

  it('includes comfyui image/video/audio without api key and hides text', () => {
    const modalities = createEmptyModalityMap()
    modalities.image.selectedModelIds = ['txt2img']
    modalities.image.defaultModelId = 'txt2img'
    modalities.video.selectedModelIds = ['txt2vid']
    modalities.video.defaultModelId = 'txt2vid'
    modalities.audio.selectedModelIds = ['txt2audio']
    modalities.audio.defaultModelId = 'txt2audio'
    const providers = [
      baseProvider({
        id: 'c1',
        providerKind: 'comfyui',
        apiKey: '',
        modalities
      })
    ]
    expect(buildModelOptions(providers, 'text')).toEqual([])
    expect(buildModelOptions(providers, 'image').map((o) => o.model)).toEqual(['txt2img'])
    expect(buildModelOptions(providers, 'video').map((o) => o.model)).toEqual(['txt2vid'])
    expect(buildModelOptions(providers, 'audio').map((o) => o.model)).toEqual(['txt2audio'])
  })

  it('includes lux3d for model3d and carries providerKind', () => {
    const modalities = createEmptyModalityMap()
    modalities.model3d.selectedModelIds = ['G1']
    modalities.model3d.defaultModelId = 'G1'
    const providers = [baseProvider({ id: 'l1', providerKind: 'lux3d', modalities })]
    expect(buildModelOptions(providers, 'model3d')).toEqual([
      {
        key: 'l1::G1',
        label: 'lux3d · G1',
        providerInstanceId: 'l1',
        providerKind: 'lux3d',
        model: 'G1'
      }
    ])
  })

  it('includes worldlabs for world only and carries providerKind', () => {
    const modalities = createEmptyModalityMap()
    modalities.spatialWorld.selectedModelIds = ['marble-1.1-plus']
    modalities.spatialWorld.defaultModelId = 'marble-1.1-plus'
    const providers = [baseProvider({ id: 'wl1', providerKind: 'worldlabs', modalities })]
    expect(buildModelOptions(providers, 'spatialWorld')).toEqual([
      {
        key: 'wl1::marble-1.1-plus',
        label: 'worldlabs · marble-1.1-plus',
        providerInstanceId: 'wl1',
        providerKind: 'worldlabs',
        model: 'marble-1.1-plus'
      }
    ])
    // 空间世界供应商不进 3D / 图片下拉：它的目录只在 world 模态里
    expect(buildModelOptions(providers, 'model3d')).toEqual([])
    expect(buildModelOptions(providers, 'image')).toEqual([])
  })

  it('includes minimax for text, image, video and audio', () => {
    const modalities = createEmptyModalityMap()
    modalities.text.selectedModelIds = ['MiniMax-M3']
    modalities.text.defaultModelId = 'MiniMax-M3'
    modalities.image.selectedModelIds = ['image-01']
    modalities.image.defaultModelId = 'image-01'
    modalities.video.selectedModelIds = ['MiniMax-Hailuo-2.3']
    modalities.video.defaultModelId = 'MiniMax-Hailuo-2.3'
    modalities.audio.selectedModelIds = ['voice-design']
    modalities.audio.defaultModelId = 'voice-design'
    const providers = [
      baseProvider({
        id: 'mm1',
        providerKind: 'minimax',
        apiKey: 'key',
        modalities
      })
    ]
    expect(buildModelOptions(providers, 'text').map((o) => o.model)).toEqual(['MiniMax-M3'])
    expect(buildModelOptions(providers, 'image').map((o) => o.model)).toEqual(['image-01'])
    expect(buildModelOptions(providers, 'video').map((o) => o.model)).toEqual([
      'MiniMax-Hailuo-2.3'
    ])
    expect(buildModelOptions(providers, 'audio').map((o) => o.model)).toEqual(['voice-design'])
  })

  /**
   * 真实踩过的坑：OpenAI 与 OpenRouter 的 TTS 接入（POST /audio/speech）做完、
   * 设置页也勾好了模型，声音生成节点却依然显示「暂无可用模型」——
   * 因为这份白名单没同步，节点侧把这两家直接过滤掉了。
   */
  it('includes OpenAI for audio (it has /audio/speech)', () => {
    const modalities = createEmptyModalityMap()
    modalities.audio.selectedModelIds = ['tts-1']
    modalities.audio.defaultModelId = 'tts-1'
    const providers = [baseProvider({ id: 'oa1', providerKind: 'openai', modalities })]
    expect(buildModelOptions(providers, 'audio').map((o) => o.key)).toEqual(['oa1::tts-1'])
  })

  it('includes OpenRouter for audio (aggregator TTS)', () => {
    const modalities = createEmptyModalityMap()
    modalities.audio.selectedModelIds = ['openai/gpt-4o-mini-tts']
    modalities.audio.defaultModelId = 'openai/gpt-4o-mini-tts'
    const providers = [baseProvider({ id: 'or9', providerKind: 'openrouter', modalities })]
    expect(buildModelOptions(providers, 'audio').map((o) => o.key)).toEqual([
      'or9::openai/gpt-4o-mini-tts'
    ])
  })

  it('does not offer audio for providers that cannot synthesise speech', () => {
    const modalities = createEmptyModalityMap()
    modalities.audio.selectedModelIds = ['whatever']
    modalities.audio.defaultModelId = 'whatever'
    for (const kind of ['deepseek', 'anthropic', 'moonshot', 'kling', 'zhipu'] as const) {
      const providers = [baseProvider({ id: `x-${kind}`, providerKind: kind, modalities })]
      expect(buildModelOptions(providers, 'audio'), kind).toEqual([])
    }
  })
})

/**
 * 指令面板的音色候选来源：模型目录里声明的 supported_voices。
 * 这里只验证「模型 key → 可用音色」的映射；面板本身在组件里。
 */
describe('buildModelVoiceOptions', () => {
  function audioProviderWithVoices(
    id: string,
    model: string,
    voices: unknown
  ): ModelProviderInstance {
    const modalities = createEmptyModalityMap()
    modalities.audio.selectedModelIds = [model]
    modalities.audio.defaultModelId = model
    modalities.audio.catalog = {
      [model]: { id: model, name: model, capabilities: { supported_voices: voices } }
    }
    return baseProvider({ id, providerKind: 'openrouter', modalities })
  }

  it('把模型声明的声音挂到它的选项 key 上', () => {
    const providers = [audioProviderWithVoices('or1', 'or-tts', ['mika', 'yuki'])]
    const options = buildModelOptions(providers, 'audio')
    expect(buildModelVoiceOptions(providers, 'audio', options)).toEqual({
      'or1::or-tts': ['mika', 'yuki']
    })
  })

  it('没有声明声音的模型不进映射（面板此时只给自由输入）', () => {
    const providers = [audioProviderWithVoices('or1', 'or-tts', undefined)]
    const options = buildModelOptions(providers, 'audio')
    expect(buildModelVoiceOptions(providers, 'audio', options)).toEqual({})
  })

  it('非 audio 模态不产出声音映射', () => {
    const providers = [audioProviderWithVoices('or1', 'or-tts', ['mika'])]
    const options = buildModelOptions(providers, 'audio')
    expect(buildModelVoiceOptions(providers, 'text', options)).toEqual({})
  })
})

describe('声音模态的空列表成因', () => {
  function audioProvider(
    kind: 'openai' | 'openrouter',
    overrides: Partial<ModelProviderInstance> = {}
  ): ModelProviderInstance {
    const modalities = createEmptyModalityMap()
    modalities.audio.selectedModelIds = ['tts-1']
    modalities.audio.defaultModelId = 'tts-1'
    return baseProvider({ id: `p-${kind}`, providerKind: kind, modalities, ...overrides })
  }

  it('配置就绪时不会误报 noProvider（白名单漏了就会误报）', () => {
    expect(resolveEmptyModelOptionsReason([audioProvider('openai')], 'audio')).toBe('noSelection')
    expect(resolveEmptyModelOptionsReason([audioProvider('openrouter')], 'audio')).toBe(
      'noSelection'
    )
  })

  it('仍能分辨停用与缺 Key', () => {
    expect(
      resolveEmptyModelOptionsReason([audioProvider('openai', { enabled: false })], 'audio')
    ).toBe('providerDisabled')
    expect(resolveEmptyModelOptionsReason([audioProvider('openai', { apiKey: '' })], 'audio')).toBe(
      'missingApiKey'
    )
  })

  it('没有支持声音的提供商时报 noProvider', () => {
    // 只配了 DeepSeek（纯文本）：对声音模态而言等于没提供商
    expect(
      resolveEmptyModelOptionsReason(
        [baseProvider({ id: 'ds', providerKind: 'deepseek', apiKey: 'sk-x' })],
        'audio'
      )
    ).toBe('noProvider')
  })
})

/**
 * 空列表成因：决策模型下拉为空时，界面上要能说清是「没添加提供商 / 提供商停用 /
 * 缺 Key / 该模态没勾模型」中的哪一种 —— 这四种都表现为「列表是空的」，
 * 实际踩过的坑是 OpenRouter 卡片处于「停用」状态，选择器只是静默为空。
 */
describe('resolveEmptyModelOptionsReason', () => {
  function decisionsProvider(
    overrides: Partial<ModelProviderInstance> = {}
  ): ModelProviderInstance {
    const modalities = createEmptyModalityMap()
    modalities.decisions.selectedModelIds = ['typesafe/jev-1.13']
    modalities.decisions.defaultModelId = 'typesafe/jev-1.13'
    return baseProvider({ id: 'or1', providerKind: 'openrouter', modalities, ...overrides })
  }

  it('reports noProvider when nothing is configured', () => {
    expect(resolveEmptyModelOptionsReason([], 'decisions')).toBe('noProvider')
  })

  it('reports providerDisabled when the OpenRouter card is switched off', () => {
    // 就是这个场景：决策模型已勾选，但提供商停用 → 选择器为空
    const providers = [decisionsProvider({ enabled: false })]
    expect(buildModelOptions(providers, 'decisions')).toEqual([])
    expect(resolveEmptyModelOptionsReason(providers, 'decisions')).toBe('providerDisabled')
  })

  it('reports missingApiKey when the key is cleared', () => {
    const providers = [decisionsProvider({ apiKey: '' })]
    expect(resolveEmptyModelOptionsReason(providers, 'decisions')).toBe('missingApiKey')
  })

  it('reports noSelection when the provider is ready but nothing is ticked', () => {
    const modalities = createEmptyModalityMap()
    const providers = [
      baseProvider({ id: 'or2', providerKind: 'openrouter', modalities, apiKey: 'sk-or-v1-x' })
    ]
    expect(resolveEmptyModelOptionsReason(providers, 'decisions')).toBe('noSelection')
  })

  it('reports noProvider for modalities no configured provider can serve', () => {
    // 只有一家 OpenAI（不支持 decisions）→ 对 decisions 而言等于没提供商
    const providers = [baseProvider({ id: 'oa', providerKind: 'openai', apiKey: 'sk-x' })]
    expect(resolveEmptyModelOptionsReason(providers, 'decisions')).toBe('noProvider')
  })

  it('does not blame an unrelated provider that merely lacks a key', () => {
    // OpenRouter 本身就绪（只是没勾模型），另一家 DeepSeek 没 Key 不该影响结论
    const modalities = createEmptyModalityMap()
    const providers = [
      baseProvider({
        id: 'or3',
        providerKind: 'openrouter',
        apiKey: 'sk-or-v1-x',
        modalities
      }),
      baseProvider({ id: 'ds', providerKind: 'deepseek', apiKey: '' })
    ]
    expect(resolveEmptyModelOptionsReason(providers, 'decisions')).toBe('noSelection')
  })
})
