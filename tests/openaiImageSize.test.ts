import { describe, expect, it } from 'vitest'
import { resolveOpenAiImageSize } from '../src/shared/modelProviders/openai/imageSize'
import {
  b64JsonToImageDataUrl,
  imageExtFromMime,
  sniffImageMimeFromBase64,
  sniffImageMimeFromBytes
} from '../src/shared/media/imageMimeSniff'

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

  it('maps DALL·E 3 aspect ratios to 1792x1024 / 1024x1792', () => {
    expect(resolveOpenAiImageSize(undefined, '16:9', 'dall-e-3')).toBe('1792x1024')
    expect(resolveOpenAiImageSize(undefined, '9:16', 'dall-e-3')).toBe('1024x1792')
    expect(resolveOpenAiImageSize('1792x1024', undefined, 'dall-e-3')).toBe('1792x1024')
  })

  it('clamps size to 512x512 when output format is gif', () => {
    expect(resolveOpenAiImageSize(undefined, '16:9', 'gpt-image-2.6-flare', 'gif')).toBe('512x512')
    expect(resolveOpenAiImageSize('2K', '16:9', 'gpt-image-2.6-flare', 'gif')).toBe('512x512')
    expect(resolveOpenAiImageSize('1536x1024', '16:9', 'gpt-image-2.6-flare', 'gif')).toBe(
      '512x512'
    )
    expect(resolveOpenAiImageSize('1024x1024', '1:1', 'gpt-image-2.6-flare', 'gif')).toBe('512x512')
  })

  it('sniffs SVG XML and base64 payloads to image/svg+xml', () => {
    const rawSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>'
    const svgBytes = Buffer.from(rawSvg, 'utf8')
    expect(sniffImageMimeFromBytes(svgBytes)).toBe('image/svg+xml')

    const svgB64 = Buffer.from(rawSvg, 'utf8').toString('base64')
    expect(sniffImageMimeFromBase64(svgB64)).toBe('image/svg+xml')

    const dataUrlFromB64 = b64JsonToImageDataUrl(svgB64)
    expect(dataUrlFromB64.startsWith('data:image/svg+xml;base64,')).toBe(true)

    const dataUrlFromRaw = b64JsonToImageDataUrl(rawSvg)
    expect(dataUrlFromRaw.startsWith('data:image/svg+xml;base64,')).toBe(true)

    expect(imageExtFromMime('image/svg+xml')).toBe('svg')
  })
})
