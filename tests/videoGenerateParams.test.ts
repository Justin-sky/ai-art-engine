import { describe, expect, it } from 'vitest'
import {
  hasAnyVideoGenerateCapability,
  parseVideoGenerateParamCapabilities,
  supportedDurationsFromError
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

/**
 * 能力表里没有这个模型时（自建网关 / 新模型），上游的 400 里其实写清了合法档位。
 * 解析出来就能按它重试一次，而不是白丢一镜（实测 9 镜丢 6 镜）。
 */
describe('supportedDurationsFromError', () => {
  it('解析出上游声明的档位（去重、升序、去掉单位）', () => {
    expect(
      supportedDurationsFromError(
        "Error invoking remote method 'gen:video': Error: 提交视频生成失败: HTTP 400: " +
          'Duration 2s is not supported for this model. Supported durations: 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15s'
      )
    ).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
    expect(
      supportedDurationsFromError(
        'Duration 3s is not supported for this model. supported duration: 5'
      )
    ).toEqual([5])
  })

  it('别的错误一律不认（避免在未知失败上盲目重试、白花钱）', () => {
    expect(supportedDurationsFromError('HTTP 400: invalid prompt')).toEqual([])
    expect(
      supportedDurationsFromError('Supported durations: 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15s')
    ).toEqual([])
    // 生成失败（已提交、可能已计费）不属于这一类
    expect(supportedDurationsFromError('视频生成失败：task failed')).toEqual([])
    expect(supportedDurationsFromError('')).toEqual([])
  })
})
