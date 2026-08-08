import { describe, expect, it } from 'vitest'
import {
  isOpenAiTextModelId,
  listOpenAiCatalogModels,
  resolveOpenAiModelCapabilities
} from '../src/shared/modelProviders/openai/modelCapabilities'

describe('openaiModelCapabilities', () => {
  it('lists static image catalog with GPT Image models', () => {
    const images = listOpenAiCatalogModels('image')
    expect(images.some((m) => m.id === 'gpt-image-1')).toBe(true)
    expect(images.some((m) => m.id === 'gpt-image-2')).toBe(true)
    expect(listOpenAiCatalogModels('text')).toEqual([])
    expect(listOpenAiCatalogModels('video')).toEqual([])
  })

  it('resolves image capabilities from static profile', () => {
    const caps = resolveOpenAiModelCapabilities('gpt-image-1', 'image')
    const sp = caps?.supported_parameters as Record<string, unknown> | undefined
    expect(sp?.quality).toEqual({ values: ['low', 'medium', 'high'] })
    expect(sp?.input_references).toEqual({ max: 1 })
  })

  it('infers image modality from model id', () => {
    const caps = resolveOpenAiModelCapabilities('gpt-image-2')
    expect(caps?.supported_parameters).toBeDefined()
    expect(resolveOpenAiModelCapabilities('gpt-5.5')).toBeNull()
  })

  it('filters OpenAI /models rows to chat-capable text models', () => {
    expect(isOpenAiTextModelId('gpt-5.5')).toBe(true)
    expect(isOpenAiTextModelId('gpt-4o')).toBe(true)
    expect(isOpenAiTextModelId('gpt-4o-mini')).toBe(true)
    expect(isOpenAiTextModelId('o3')).toBe(true)
    expect(isOpenAiTextModelId('chatgpt-4o-latest')).toBe(true)
    expect(isOpenAiTextModelId('gpt-image-1')).toBe(false)
    expect(isOpenAiTextModelId('dall-e-3')).toBe(false)
    expect(isOpenAiTextModelId('gpt-4o-realtime')).toBe(false)
    expect(isOpenAiTextModelId('whisper-1')).toBe(false)
    expect(isOpenAiTextModelId('tts-1')).toBe(false)
    expect(isOpenAiTextModelId('text-embedding-3-large')).toBe(false)
    expect(isOpenAiTextModelId('sora-2')).toBe(false)
  })
})
