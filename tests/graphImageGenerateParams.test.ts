import { describe, expect, it } from 'vitest'
import {
  DEFAULT_IMAGE_GENERATE_CAPABILITIES,
  DEFAULT_MAX_INPUT_REFERENCES,
  parseImageGenerateCapabilities,
  parseInputReferencesMax,
  resolveImageGenerateParamsForApi,
  resolveMaxInputReferences
} from '../src/shared/graph'

describe('resolveImageGenerateParamsForApi', () => {
  it('fills defaults when node params are empty', () => {
    const resolved = resolveImageGenerateParamsForApi({})
    expect(resolved.aspectRatio).toBe('16:9')
    expect(resolved.resolution).toBe('2K')
    expect(resolved.quality).toBe('medium')
    expect(resolved.count).toBe(1)
  })

  it('keeps explicit node values', () => {
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
      seedUseGlobal: true
    })
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
