import { describe, expect, it } from 'vitest'
import {
  hasAnyVideoGenerateCapability,
  parseVideoGenerateParamCapabilities
} from '../src/shared/graph/videoGenerateParams'

describe('parseVideoGenerateParamCapabilities', () => {
  it('parses supported_frame_images alongside resolutions', () => {
    const caps = parseVideoGenerateParamCapabilities({
      supported_resolutions: ['720p', '1080p'],
      supported_durations: [4, 8],
      supported_frame_images: ['first_frame', 'last_frame', 'other'],
      generate_audio: true
    })
    expect(caps.resolutions).toEqual(['720p', '1080p'])
    expect(caps.supportedFrameImages).toEqual(['first_frame', 'last_frame'])
    expect(caps.supportsGenerateAudio).toBe(true)
    expect(hasAnyVideoGenerateCapability(caps)).toBe(true)
  })

  it('treats frame-only capabilities as usable', () => {
    const caps = parseVideoGenerateParamCapabilities({
      supported_frame_images: ['first_frame']
    })
    expect(caps.supportedFrameImages).toEqual(['first_frame'])
    expect(hasAnyVideoGenerateCapability(caps)).toBe(true)
  })
})
