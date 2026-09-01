import { describe, expect, it } from 'vitest'
import {
  buildVideoFrameTimestamps,
  buildVideoReviewFrameBlock,
  buildVideoReviewFrameCaption,
  VIDEO_REVIEW_FRAME_COUNT
} from '../src/shared/graph/videoReview'

describe('videoReview.buildVideoFrameTimestamps', () => {
  it('默认 4 帧，含首帧与末帧', () => {
    expect(buildVideoFrameTimestamps(12)).toEqual([0, 4, 8, 12])
    expect(VIDEO_REVIEW_FRAME_COUNT).toBe(4)
  })

  it('自定义帧数', () => {
    expect(buildVideoFrameTimestamps(10, 3)).toEqual([0, 5, 10])
    expect(buildVideoFrameTimestamps(10, 1)).toEqual([0])
  })

  it('非法输入返回空', () => {
    expect(buildVideoFrameTimestamps(0)).toEqual([])
    expect(buildVideoFrameTimestamps(-5)).toEqual([])
    expect(buildVideoFrameTimestamps(Number.NaN)).toEqual([])
    expect(buildVideoFrameTimestamps(10, 0)).toEqual([])
  })

  it('结果四舍五入到 0.1s', () => {
    const timestamps = buildVideoFrameTimestamps(3.7, 3)
    expect(timestamps[1]).toBeCloseTo(1.85, 1)
  })
})

describe('videoReview 提示词块', () => {
  it('中文块说明多帧来自同一视频', () => {
    const block = buildVideoReviewFrameBlock('zh-CN')
    expect(block).toContain('同一段视频')
    expect(buildVideoReviewFrameCaption('zh-CN')).toContain('视频抽帧')
  })

  it('英文块', () => {
    const block = buildVideoReviewFrameBlock('en-US')
    expect(block).toContain('SAME video')
    expect(buildVideoReviewFrameCaption('en-US')).toContain('Video frames')
  })
})
