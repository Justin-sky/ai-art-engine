import { describe, expect, it } from 'vitest'
import {
  clampVideoGenerateParams,
  parseVideoGenerateParamCapabilities,
  readVideoGenerateParamsFromNode,
  videoGenerateParamsToNodePatch
} from '../src/shared/graph'

describe('parseVideoGenerateParamCapabilities', () => {
  it('reads catalog supported_* fields', () => {
    const caps = parseVideoGenerateParamCapabilities({
      supported_durations: [4, 6, 8],
      supported_aspect_ratios: ['16:9', '9:16'],
      supported_resolutions: ['720p', '1080p'],
      generate_audio: true
    })
    expect(caps.durations).toEqual([4, 6, 8])
    expect(caps.aspectRatios).toEqual(['16:9', '9:16'])
    expect(caps.resolutions).toEqual(['720p', '1080p'])
    expect(caps.supportsGenerateAudio).toBe(true)
  })

  it('merges supported_parameters enums', () => {
    const caps = parseVideoGenerateParamCapabilities({
      supported_parameters: {
        aspect_ratio: { type: 'enum', values: ['1:1'] },
        duration: [5, 10]
      }
    })
    expect(caps.aspectRatios).toEqual(['1:1'])
    expect(caps.durations).toEqual([5, 10])
  })
})

describe('clampVideoGenerateParams', () => {
  it('picks preferred defaults within capability lists', () => {
    const clamped = clampVideoGenerateParams(
      {},
      {
        aspectRatios: ['9:16', '16:9', '1:1'],
        resolutions: ['480p', '1080p'],
        durations: [4, 5, 8],
        supportsGenerateAudio: true,
        supportedFrameImages: []
      }
    )
    expect(clamped.aspectRatio).toBe('16:9')
    expect(clamped.resolution).toBe('1080p')
    expect(clamped.duration).toBe(5)
    expect(clamped.generateAudio).toBe(true)
    expect(clamped.frameMode).toBe('none')
  })

  it('clears unsupported fields', () => {
    const clamped = clampVideoGenerateParams(
      { aspectRatio: '16:9', duration: 8, generateAudio: true, frameMode: 'first' },
      {
        aspectRatios: [],
        resolutions: [],
        durations: [],
        supportsGenerateAudio: false,
        supportedFrameImages: []
      }
    )
    expect(clamped.aspectRatio).toBeUndefined()
    expect(clamped.duration).toBeUndefined()
    expect(clamped.generateAudio).toBeUndefined()
    expect(clamped.frameMode).toBe('none')
  })
})

describe('videoGenerateParams node patch', () => {
  it('round-trips through node params', () => {
    const patch = videoGenerateParamsToNodePatch({
      aspectRatio: '9:16',
      resolution: '720p',
      duration: 6,
      generateAudio: false
    })
    expect(patch).toEqual({
      generateAspectRatio: '9:16',
      generateResolution: '720p',
      generateDuration: 6,
      generateAudio: false,
      generateFrameMode: 'none'
    })
    expect(readVideoGenerateParamsFromNode(patch)).toEqual({
      aspectRatio: '9:16',
      resolution: '720p',
      duration: 6,
      generateAudio: false,
      frameMode: 'none'
    })
  })
})
