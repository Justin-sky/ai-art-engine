import { describe, expect, it } from 'vitest'
import {
  isOpenAiTextModelId,
  listOpenAiCatalogModels,
  mergeOpenAiCatalogWithBuiltin,
  normalizeOpenAiTextModelId,
  resolveOpenAiModelCapabilities
} from '../src/shared/modelProviders/openai/modelCapabilities'

describe('openaiModelCapabilities', () => {
  it('lists static image and latest text catalogs (including gpt-6.1)', () => {
    const images = listOpenAiCatalogModels('image')
    expect(images.some((m) => m.id === 'gpt-image-1')).toBe(true)
    expect(images.some((m) => m.id === 'gpt-image-2')).toBe(true)

    const text = listOpenAiCatalogModels('text')
    expect(text.some((m) => m.id === 'gpt-6.1-sol')).toBe(true)
    expect(text.some((m) => m.id === 'gpt-6.1-terra')).toBe(true)
    expect(text.some((m) => m.id === 'gpt-6-astra')).toBe(true)
    expect(text.some((m) => m.id === 'gpt-6-luna')).toBe(true)
    expect(text.some((m) => m.id === 'gpt-5.5')).toBe(true)
    expect(listOpenAiCatalogModels('video')).toEqual([])
  })

  it('resolves image capabilities from static profile (16 refs for gpt-image, 0 for dall-e-3)', () => {
    const caps = resolveOpenAiModelCapabilities('gpt-image-1', 'image')
    const sp = caps?.supported_parameters as Record<string, unknown> | undefined
    expect(sp?.quality).toEqual({ values: ['low', 'medium', 'high'] })
    expect(sp?.input_references).toEqual({ max: 16 })

    const dalle3Caps = resolveOpenAiModelCapabilities('dall-e-3', 'image')
    const dalle3Sp = dalle3Caps?.supported_parameters as Record<string, unknown> | undefined
    expect(dalle3Sp?.quality).toEqual({ values: ['standard', 'hd'] })
    expect(dalle3Sp?.input_references).toEqual({ max: 0 })
  })

  it('infers image modality from model id', () => {
    const caps = resolveOpenAiModelCapabilities('gpt-image-2')
    expect(caps?.supported_parameters).toBeDefined()
    expect(resolveOpenAiModelCapabilities('gpt-5.5')).toBeNull()
  })

  it('filters OpenAI /models rows to chat-capable text models', () => {
    expect(isOpenAiTextModelId('gpt-6.1')).toBe(true)
    expect(isOpenAiTextModelId('openai/gpt-6.1')).toBe(true)
    expect(isOpenAiTextModelId('gpt-5.5')).toBe(true)
    expect(isOpenAiTextModelId('gpt-4o')).toBe(true)
    expect(isOpenAiTextModelId('gpt-4o-mini')).toBe(true)
    expect(isOpenAiTextModelId('o3')).toBe(true)
    expect(isOpenAiTextModelId('chatgpt-4o-latest')).toBe(true)
    expect(isOpenAiTextModelId('codex-mini-latest')).toBe(true)
    expect(isOpenAiTextModelId('gpt-image-1')).toBe(false)
    expect(isOpenAiTextModelId('dall-e-3')).toBe(false)
    expect(isOpenAiTextModelId('gpt-4o-realtime')).toBe(false)
    expect(isOpenAiTextModelId('whisper-1')).toBe(false)
    expect(isOpenAiTextModelId('tts-1')).toBe(false)
    expect(isOpenAiTextModelId('text-embedding-3-large')).toBe(false)
    expect(isOpenAiTextModelId('sora-2')).toBe(false)
  })

  it('merges remote models with builtin latest models and sorts newest first', () => {
    const merged = mergeOpenAiCatalogWithBuiltin(
      [{ id: 'gpt-6.1-sol-2026-10-01', name: 'gpt-6.1-sol-2026-10-01', modality: 'text' }],
      'text'
    )
    expect(merged.some((m) => m.id === 'gpt-6.1-sol')).toBe(true)
    expect(merged.some((m) => m.id === 'gpt-6.1-sol-2026-10-01')).toBe(true)
    const idx61 = merged.findIndex((m) => m.id === 'gpt-6.1-sol')
    const idx4o = merged.findIndex((m) => m.id === 'gpt-4o')
    expect(idx61).toBeGreaterThanOrEqual(0)
    expect(idx4o).toBeGreaterThan(idx61)
  })

  it('normalizes OpenAI legacy text aliases and tool-mode reasoning compatibility', () => {
    expect(normalizeOpenAiTextModelId('gpt-6.1')).toBe('gpt-6.1-sol')
    expect(normalizeOpenAiTextModelId('gpt-6.1-mini')).toBe('gpt-6.1-terra')
    expect(normalizeOpenAiTextModelId('gpt-6.1', { hasTools: true })).toBe('gpt-6.1-terra')
    expect(normalizeOpenAiTextModelId('gpt-6.1-sol', { hasTools: true })).toBe('gpt-6.1-terra')
    expect(normalizeOpenAiTextModelId('gpt-6-astra', { hasTools: true })).toBe('gpt-6-sol')
  })
})
