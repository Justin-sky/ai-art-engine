import { describe, expect, it } from 'vitest'
import { resolveOpenAiImageSize } from '../src/shared/modelProviders/openai/imageSize'

describe('openaiImageSize', () => {
  it('maps supported aspect ratios to fixed OpenAI sizes', () => {
    expect(resolveOpenAiImageSize(undefined, '1:1')).toBe('1024x1024')
    expect(resolveOpenAiImageSize(undefined, '16:9')).toBe('1536x1024')
    expect(resolveOpenAiImageSize(undefined, '9:16')).toBe('1024x1536')
    expect(resolveOpenAiImageSize(undefined, '3:2')).toBe('1536x1024')
    expect(resolveOpenAiImageSize(undefined, '2:3')).toBe('1024x1536')
    expect(resolveOpenAiImageSize(undefined, '4:3')).toBe('1536x1024')
    expect(resolveOpenAiImageSize(undefined, '3:4')).toBe('1024x1536')
  })

  it('passes through explicit supported pixel sizes', () => {
    expect(resolveOpenAiImageSize('1024x1024', undefined)).toBe('1024x1024')
    expect(resolveOpenAiImageSize('1536x1024', '9:16')).toBe('1536x1024')
  })

  it('returns undefined for unsupported sizes or ratios (API auto)', () => {
    expect(resolveOpenAiImageSize('2048x2048', undefined)).toBeUndefined()
    expect(resolveOpenAiImageSize(undefined, '21:9')).toBeUndefined()
    expect(resolveOpenAiImageSize(undefined, undefined)).toBeUndefined()
    expect(resolveOpenAiImageSize('1K', undefined)).toBeUndefined()
  })
})
