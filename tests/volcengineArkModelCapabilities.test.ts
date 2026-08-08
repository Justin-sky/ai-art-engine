import { describe, expect, it } from 'vitest'
import {
  resolveVolcengineArkCapabilityProfileId,
  resolveVolcengineArkModelCapabilities
} from '../src/shared/modelProviders/volcengineArk/modelCapabilities'
import { parseImageGenerateCapabilities } from '../src/shared/graph/imageGenerateParams'
import { parseVideoGenerateParamCapabilities } from '../src/shared/graph/videoGenerateParams'
import { resolveVideoGeneratePortLimits } from '../src/shared/graph/portInputLimits'

describe('volcengineArk modelCapabilities', () => {
  it('matches Seedream 5 / 4.5 / 4 profiles', () => {
    expect(resolveVolcengineArkCapabilityProfileId('doubao-seedream-5-0-lite')).toBe('seedream-5')
    expect(resolveVolcengineArkCapabilityProfileId('doubao-seedream-4-5-251128')).toBe(
      'seedream-4.5'
    )
    expect(resolveVolcengineArkCapabilityProfileId('doubao-seedream-4-0-250828')).toBe('seedream-4')
  })

  it('matches Seedance 2 / 1.5 / 1 profiles', () => {
    expect(resolveVolcengineArkCapabilityProfileId('doubao-seedance-2-5-260628')).toBe(
      'seedance-2.5'
    )
    expect(resolveVolcengineArkCapabilityProfileId('seedance-2.5')).toBe('seedance-2.5')
    expect(resolveVolcengineArkCapabilityProfileId('doubao-seedance-2-0-fast-260128')).toBe(
      'seedance-2-fast'
    )
    expect(resolveVolcengineArkCapabilityProfileId('doubao-seedance-2-0-260128')).toBe('seedance-2')
    expect(resolveVolcengineArkCapabilityProfileId('doubao-seedance-1-5-pro-251215')).toBe(
      'seedance-1.5'
    )
    expect(
      resolveVolcengineArkCapabilityProfileId('doubao-seedance-1-0-lite-i2v-250428')
    ).toBe('seedance-1-lite-i2v')
    expect(resolveVolcengineArkCapabilityProfileId('doubao-seedance-1-0-pro-250528')).toBe(
      'seedance-1'
    )
  })

  it('exposes video params and port limits for Seedance 2.5', () => {
    const caps = resolveVolcengineArkModelCapabilities('doubao-seedance-2-5-260628')
    expect(caps).toBeTruthy()
    const params = parseVideoGenerateParamCapabilities(caps)
    expect(params.supportsGenerateAudio).toBe(true)
    expect(params.durations).toEqual(expect.arrayContaining([4, 30]))
    expect(params.resolutions).toContain('720p')
    expect(params.resolutions).not.toContain('1080p')
    expect(params.supportedFrameImages).toEqual(['first_frame', 'last_frame'])
    const ports = resolveVideoGeneratePortLimits('doubao-seedance-2-5-260628', caps)
    expect(ports.maxImages).toBe(30)
    expect(ports.maxVideos).toBe(10)
    expect(ports.maxVoices).toBe(10)
  })

  it('exposes image params consumable by UI parser', () => {
    const caps = resolveVolcengineArkModelCapabilities('doubao-seedream-4-5-251128')
    const parsed = parseImageGenerateCapabilities(caps?.supported_parameters)
    expect(parsed.resolutions).toEqual(expect.arrayContaining(['2K', '4K']))
    expect(parsed.aspectRatios).toContain('16:9')
    expect(parsed.maxInputReferences).toBe(10)
    expect(parsed.counts.length).toBeGreaterThan(0)
  })

  it('exposes video params and port limits for Seedance 2', () => {
    const caps = resolveVolcengineArkModelCapabilities('doubao-seedance-2-0')
    expect(caps).toBeTruthy()
    const params = parseVideoGenerateParamCapabilities(caps)
    expect(params.supportsGenerateAudio).toBe(true)
    expect(params.durations).toEqual(expect.arrayContaining([4, 15]))
    expect(params.resolutions).toContain('1080p')
    expect(params.supportedFrameImages).toEqual(['first_frame', 'last_frame'])
    const ports = resolveVideoGeneratePortLimits('doubao-seedance-2-0', caps)
    expect(ports.maxImages).toBe(9)
    expect(ports.maxVideos).toBe(3)
    expect(ports.maxVoices).toBe(3)
  })

  it('falls back for opaque ep-* endpoint ids by modality', () => {
    expect(resolveVolcengineArkModelCapabilities('ep-20260101-xxxxx', undefined, 'image')).toEqual(
      expect.objectContaining({
        supported_parameters: expect.objectContaining({
          resolution: expect.anything()
        })
      })
    )
    expect(resolveVolcengineArkModelCapabilities('ep-20260101-xxxxx', undefined, 'video')).toEqual(
      expect.objectContaining({
        supported_durations: expect.arrayContaining([4, 15])
      })
    )
    expect(resolveVolcengineArkModelCapabilities('ep-20260101-xxxxx')).toBeNull()
  })

  it('returns null for unrelated models', () => {
    expect(resolveVolcengineArkModelCapabilities('doubao-seed-1-6-flash')).toBeNull()
  })
})
