import { describe, expect, it } from 'vitest'
import {
  isKnownVisionModelId,
  resolveDshChatInputModalities,
  resolveDshChatInputModalitiesForProvider
} from '../src/shared/dshChatModelModalities'
import { createProviderInstance } from '../src/shared/modelProvider'

describe('resolveDshChatInputModalities', () => {
  it('目录声明 image 时放行 text+image', () => {
    expect(resolveDshChatInputModalities('openrouter', 'xiaomi/mimo-v2.6-flash', true)).toEqual([
      'text',
      'image'
    ])
  })

  it('目录明确无 image 时保持纯文本（未知 id）', () => {
    expect(resolveDshChatInputModalities('openrouter', 'some/text-only-model', false)).toEqual([
      'text'
    ])
  })

  it('OpenRouter DeepSeek V4.1 Flash 即使 catalog 误标无图也放行', () => {
    expect(
      resolveDshChatInputModalities('openrouter', 'deepseek/deepseek-v4.1-flash', false)
    ).toEqual(['text', 'image'])
  })

  it('OpenRouter 旧版 deepseek-v4-flash（非 4.1）尊重目录无图', () => {
    expect(
      resolveDshChatInputModalities('openrouter', 'deepseek/deepseek-v4-flash', false)
    ).toEqual(['text'])
  })

  it('OpenRouter 目录未标注时乐观放行图片（避免误拦多模态）', () => {
    expect(resolveDshChatInputModalities('openrouter', 'vendor/unknown-chat', null)).toEqual([
      'text',
      'image'
    ])
  })

  it('DeepSeek 官方仅内置 vision 模型放行', () => {
    expect(resolveDshChatInputModalities('deepseek', 'deepseek-flash', null)).toEqual([
      'text',
      'image'
    ])
    expect(resolveDshChatInputModalities('deepseek', 'deepseek-v4-flash', null)).toEqual(['text'])
  })
})

describe('isKnownVisionModelId', () => {
  it('识别 OpenRouter DeepSeek / MiMo 看图模型', () => {
    expect(isKnownVisionModelId('deepseek/deepseek-v4.1-flash')).toBe(true)
    expect(isKnownVisionModelId('deepseek/deepseek-flash-latest')).toBe(true)
    expect(isKnownVisionModelId('xiaomi/mimo-v2.6-flash')).toBe(true)
    expect(isKnownVisionModelId('deepseek/deepseek-v4-flash')).toBe(false)
  })
})

describe('resolveDshChatInputModalitiesForProvider', () => {
  it('读取 OpenRouter 已保存 catalog 的 architecture.input_modalities', () => {
    const provider = createProviderInstance('openrouter', {
      modalities: {
        text: {
          selectedModelIds: ['deepseek/deepseek-v4.1-flash'],
          defaultModelId: 'deepseek/deepseek-v4.1-flash',
          catalog: {
            'deepseek/deepseek-v4.1-flash': {
              id: 'deepseek/deepseek-v4.1-flash',
              name: 'DeepSeek: DeepSeek V4.1 Flash',
              capabilities: {
                architecture: {
                  input_modalities: ['text', 'image'],
                  modality: 'text+image->text'
                }
              }
            }
          }
        },
        image: { selectedModelIds: [], defaultModelId: '' },
        video: { selectedModelIds: [], defaultModelId: '' },
        audio: { selectedModelIds: [], defaultModelId: '' },
        model3d: { selectedModelIds: [], defaultModelId: '' }
      }
    })
    expect(
      resolveDshChatInputModalitiesForProvider(provider, 'deepseek/deepseek-v4.1-flash')
    ).toEqual(['text', 'image'])
  })

  it('仅有 modality 字符串时也能识别看图', () => {
    const provider = createProviderInstance('openrouter', {
      modalities: {
        text: {
          selectedModelIds: ['deepseek/deepseek-v4.1-flash'],
          defaultModelId: 'deepseek/deepseek-v4.1-flash',
          catalog: {
            'deepseek/deepseek-v4.1-flash': {
              id: 'deepseek/deepseek-v4.1-flash',
              name: 'DeepSeek V4.1 Flash',
              capabilities: {
                architecture: { modality: 'text+image->text' }
              }
            }
          }
        },
        image: { selectedModelIds: [], defaultModelId: '' },
        video: { selectedModelIds: [], defaultModelId: '' },
        audio: { selectedModelIds: [], defaultModelId: '' },
        model3d: { selectedModelIds: [], defaultModelId: '' }
      }
    })
    expect(
      resolveDshChatInputModalitiesForProvider(provider, 'deepseek/deepseek-v4.1-flash')
    ).toEqual(['text', 'image'])
  })
})
