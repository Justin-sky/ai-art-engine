import { describe, expect, it } from 'vitest'
import {
  DEFAULT_IMAGE_GENERATE_CAPABILITIES,
  DEFAULT_MAX_INPUT_REFERENCES,
  clampImageGenerateParams,
  parseImageGenerateCapabilities,
  parseInputReferencesMax,
  resolveImageGenerateParamsForApi,
  resolveMaxInputReferences,
  supportsGifOutput,
  supportsSvgOutput
} from '../src/shared/graph'

describe('resolveImageGenerateParamsForApi', () => {
  it('fills defaults when node params are empty', () => {
    const resolved = resolveImageGenerateParamsForApi({})
    expect(resolved.aspectRatio).toBe('16:9')
    expect(resolved.resolution).toBe('2K')
    expect(resolved.quality).toBe('medium')
    expect(resolved.count).toBe(1)
  })

  it('keeps explicit node values and defaults transparentBg to true unless explicitly false', () => {
    const resolved = resolveImageGenerateParamsForApi({
      generateAspectRatio: '1:1',
      generateResolution: '4K',
      generateQuality: 'high',
      generateCount: 2
    })
    expect(resolved).toEqual({
      aspectRatio: '1:1',
      resolution: '4K',
      quality: 'high',
      count: 2,
      seedUseGlobal: true,
      transparentBg: true
    })

    const resolvedOff = resolveImageGenerateParamsForApi({
      generateTransparentBg: false
    })
    expect(resolvedOff.transparentBg).toBe(false)
  })

  it('clamps invalid values into capability defaults', () => {
    const resolved = resolveImageGenerateParamsForApi(
      {
        generateAspectRatio: '99:1',
        generateResolution: '8K',
        generateQuality: 'ultra',
        generateCount: 99
      },
      DEFAULT_IMAGE_GENERATE_CAPABILITIES
    )
    expect(resolved.aspectRatio).toBe('16:9')
    expect(resolved.resolution).toBe('2K')
    expect(resolved.quality).toBe('medium')
    expect(resolved.count).toBe(1)
  })
})

describe('parseInputReferencesMax / resolveMaxInputReferences', () => {
  it('reads range max from OpenRouter descriptor', () => {
    expect(parseInputReferencesMax({ type: 'range', min: 0, max: 4 })).toBe(4)
    expect(parseInputReferencesMax({ type: 'range', min: 0, max: 14 })).toBe(14)
  })

  it('treats boolean true as default max and false as 0', () => {
    expect(parseInputReferencesMax(true)).toBe(DEFAULT_MAX_INPUT_REFERENCES)
    expect(parseInputReferencesMax(false)).toBe(0)
    expect(parseInputReferencesMax({ type: 'boolean' })).toBe(DEFAULT_MAX_INPUT_REFERENCES)
  })

  it('parses supported_parameters.input_references into capabilities', () => {
    const caps = parseImageGenerateCapabilities({
      resolution: { type: 'enum', values: ['1K'] },
      input_references: { type: 'range', min: 0, max: 6 }
    })
    expect(caps.maxInputReferences).toBe(6)
    expect(caps.resolutions).toEqual(['1K'])
  })

  it('falls back to default when capability max is missing', () => {
    expect(resolveMaxInputReferences()).toBe(DEFAULT_MAX_INPUT_REFERENCES)
    expect(resolveMaxInputReferences({})).toBe(DEFAULT_MAX_INPUT_REFERENCES)
    expect(resolveMaxInputReferences({ maxInputReferences: 3 })).toBe(3)
    expect(resolveMaxInputReferences({ maxInputReferences: 0 })).toBe(0)
  })
})

describe('outputFormat & GIF direct output capabilities', () => {
  it('parses output_format / outputFormats from supported_parameters', () => {
    const caps = parseImageGenerateCapabilities({
      output_format: { type: 'enum', values: ['png', 'gif', 'jpeg', 'webp'] }
    })
    expect(caps.outputFormats).toEqual(['png', 'gif', 'jpeg', 'webp'])
  })

  it('detects GIF output support from model ID or supported parameters', () => {
    expect(supportsGifOutput('openai/gpt-image-2.6-flare')).toBe(true)
    expect(supportsGifOutput('gpt-image-2.6-sunburst')).toBe(true)
    expect(supportsGifOutput('gpt-image-2.6')).toBe(true)
    expect(supportsGifOutput('gpt-image-1')).toBe(false)
    expect(supportsGifOutput('dall-e-3')).toBe(false)

    expect(
      supportsGifOutput('custom-model', {
        supported_parameters: {
          output_format: { values: ['png', 'gif'] }
        }
      })
    ).toBe(true)
  })

  it('detects SVG output support from model ID or supported parameters', () => {
    expect(supportsSvgOutput('openai/gpt-image-2.6-flare')).toBe(true)
    expect(supportsSvgOutput('gpt-image-2.6-sunburst')).toBe(true)
    expect(supportsSvgOutput('gpt-image-2.6')).toBe(true)
    expect(supportsSvgOutput('gpt-image-1')).toBe(false)
    expect(supportsSvgOutput('dall-e-3')).toBe(false)

    expect(
      supportsSvgOutput('custom-model', {
        supported_parameters: {
          output_format: { values: ['png', 'svg'] }
        }
      })
    ).toBe(true)
  })

  it('clamps outputFormat according to capabilities', () => {
    const capsWithGif = {
      ...DEFAULT_IMAGE_GENERATE_CAPABILITIES,
      outputFormats: ['png', 'gif', 'webp']
    }
    const clamped = clampImageGenerateParams({ outputFormat: 'gif' }, capsWithGif)
    expect(clamped.outputFormat).toBe('gif')

    const clampedInvalid = clampImageGenerateParams({ outputFormat: 'bmp' }, capsWithGif)
    expect(clampedInvalid.outputFormat).toBe('png')
  })

  it('resolves outputFormat in resolveImageGenerateParamsForApi', () => {
    const resolved = resolveImageGenerateParamsForApi({
      generateOutputFormat: 'gif'
    })
    expect(resolved.outputFormat).toBe('gif')
  })
})
