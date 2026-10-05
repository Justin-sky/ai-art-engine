import { describe, expect, it } from 'vitest'
import {
  createEmptyModalityMap,
  modalityConfig,
  resolveDefaultVoice,
  resolveModelSupportedVoices,
  type ModelProviderInstance
} from '../src/shared/modelProvider'
import {
  isKnownOpenAiTtsModel,
  listOpenAiTtsCatalogModels,
  listOpenAiTtsVoices,
  resolveOpenAiTtsVoice
} from '../src/shared/modelProviders/openai/ttsModels'

/**
 * OpenAI 兼容 TTS（`POST /audio/speech`）。
 *
 * 这条能力的形状是：model + input + voice。model / input 用户总会给，
 * 只有 voice 是「不给也得能用」的字段——各家聚合器的音色名不通用，
 * 所以这组测试盯的是「voice 从哪来、缺省时怎么退」，而不是 HTTP 细节
 * （HTTP 形状在 openaiAdapter.test.ts 里钉）。
 */
function provider(overrides?: Partial<ModelProviderInstance>): ModelProviderInstance {
  return {
    id: 'tts-1',
    providerKind: 'openai',
    label: 'OpenAI',
    apiKey: 'sk-test',
    baseUrl: 'https://api.openai.com/v1',
    enabled: true,
    modalities: createEmptyModalityMap(),
    ...overrides
  }
}

describe('OpenAI TTS 静态目录', () => {
  it('列出 TTS 模型，并带上各自支持的声音', () => {
    const models = listOpenAiTtsCatalogModels()
    expect(models.map((m) => m.id)).toEqual(['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'])
    for (const model of models) {
      expect(model.modality).toBe('audio')
      expect((model.capabilities?.supported_voices as string[]).length).toBeGreaterThan(0)
    }
  })

  it('每个模型的声音列表里都有 alloy（各家默认音色）', () => {
    for (const model of listOpenAiTtsCatalogModels()) {
      expect(model.capabilities?.supported_voices as string[]).toContain('alloy')
    }
  })

  it('未知模型没有声音信息，不编造', () => {
    expect(listOpenAiTtsVoices('aggregator-custom-tts')).toEqual([])
    expect(listOpenAiTtsVoices('')).toEqual([])
  })

  it('未知模型不编造声音：宁可不发 voice，也不要发一个上游不认的名字', () => {
    // 实测踩过：第三方语音把 voice 映射成自己的 speaker 后校验，
    // 收到 alloy 直接 400（speaker alloy not found in speaker_map）
    expect(resolveOpenAiTtsVoice('aggregator-custom-tts')).toBeUndefined()
    expect(isKnownOpenAiTtsModel('aggregator-custom-tts')).toBe(false)
    expect(isKnownOpenAiTtsModel('tts-1')).toBe(true)
  })

  it('已知模型才用兜底音色', () => {
    expect(resolveOpenAiTtsVoice('tts-1')).toBe('alloy')
    expect(resolveOpenAiTtsVoice('gpt-4o-mini-tts')).toBe('alloy')
  })

  it('显式给了就用给的，不做校验：聚合器的音色表我们不可能穷举', () => {
    expect(resolveOpenAiTtsVoice('aggregator-custom-tts', 'zh_female_1')).toBe('zh_female_1')
    expect(resolveOpenAiTtsVoice('tts-1', 'my-custom-voice')).toBe('my-custom-voice')
    expect(resolveOpenAiTtsVoice('tts-1', '  nova  ')).toBe('nova')
  })
})

describe('默认声音解析（设置 → 生成）', () => {
  it('设置里显式选的默认音色优先', () => {
    const p = provider()
    modalityConfig(p, 'audio').defaultVoice = 'shimmer'
    expect(resolveDefaultVoice(p, 'tts-1')).toBe('shimmer')
  })

  it('没显式选就取模型目录快照里声明的第一个声音', () => {
    const p = provider()
    modalityConfig(p, 'audio').catalog = {
      'or-tts': {
        id: 'or-tts',
        name: 'OR TTS',
        capabilities: { supported_voices: ['mika', 'yuki'] }
      }
    }
    expect(resolveDefaultVoice(p, 'or-tts')).toBe('mika')
  })

  it('目录里也没有就返回空串，交给适配器兜底（不在这里硬编码 alloy）', () => {
    expect(resolveDefaultVoice(provider(), 'or-tts')).toBe('')
  })

  it('声音只认该模型自己声明的：别的模型的声音不会串过来', () => {
    const p = provider()
    modalityConfig(p, 'audio').catalog = {
      'or-tts': { id: 'or-tts', name: 'OR TTS', capabilities: { supported_voices: ['mika'] } }
    }
    expect(resolveModelSupportedVoices(p, 'audio', 'or-tts')).toEqual(['mika'])
    expect(resolveModelSupportedVoices(p, 'audio', 'other-tts')).toEqual([])
  })

  it('目录里 supported_voices 脏数据（非数组 / 空串）不进下拉', () => {
    const p = provider()
    modalityConfig(p, 'audio').catalog = {
      'or-tts': {
        id: 'or-tts',
        name: 'OR TTS',
        capabilities: { supported_voices: ['mika', '', '  ', 42, null] }
      },
      broken: { id: 'broken', name: 'broken', capabilities: { supported_voices: 'mika' } }
    }
    expect(resolveModelSupportedVoices(p, 'audio', 'or-tts')).toEqual(['mika'])
    expect(resolveModelSupportedVoices(p, 'audio', 'broken')).toEqual([])
  })
})

describe('默认声音的持久化', () => {
  it('存下来的默认音色读回来还在（设置面板刷新不丢）', async () => {
    const { normalizeModelsSettings } = await import('../src/shared/modelProvider')
    const next = normalizeModelsSettings({
      providers: [
        {
          id: 'p-tts',
          providerKind: 'openrouter',
          label: 'OR',
          apiKey: 'sk-x',
          baseUrl: 'https://openrouter.ai/api/v1',
          enabled: true,
          modalities: {
            audio: {
              selectedModelIds: ['or-tts'],
              defaultModelId: 'or-tts',
              defaultVoice: '  mika  '
            }
          }
        }
      ]
    })
    expect(modalityConfig(next.providers[0]!, 'audio').defaultVoice).toBe('mika')
  })
})
