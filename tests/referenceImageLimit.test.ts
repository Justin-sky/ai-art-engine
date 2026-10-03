import { describe, expect, it } from 'vitest'
import {
  REFERENCE_IMAGE_TARGET_BYTES,
  REFERENCE_IMAGE_TRIGGER_BYTES,
  fitWithinMaxEdge,
  formatBytesHuman,
  needsReferenceImageShrink,
  preferredReferenceImageFormat,
  referenceImageAttempts
} from '../src/shared/media/referenceImage'

/**
 * 参考图超限压缩的**纯策略**：起因是一次真实失败——
 * 拖进一张 20MB 的相机 JPEG 做图生图，被上游用「文件、参数或调用方式不符合要求」拒掉，
 * 而报错里完全看不出是「图太大」。策略部分在这里锁死，编码部分见 referenceImageService。
 */
describe('formatBytesHuman', () => {
  it('把日志里的裸数字变成人读体积', () => {
    expect(formatBytesHuman(640)).toBe('640B')
    expect(formatBytesHuman(1024)).toBe('1.0KB')
    expect(formatBytesHuman(831_488)).toBe('812.0KB')
    expect(formatBytesHuman(2 * 1024 * 1024)).toBe('2.0MB')
  })

  it('还原本例那张图：base64 27,232,535 字符 ≈ 19.5MB', () => {
    const bytes = Math.floor((27_232_535 * 3) / 4)
    expect(formatBytesHuman(bytes)).toBe('19.5MB')
  })

  it('异常输入不产生 NaN 文案', () => {
    expect(formatBytesHuman(0)).toBe('0B')
    expect(formatBytesHuman(-1)).toBe('0B')
    expect(formatBytesHuman(Number.NaN)).toBe('0B')
  })
})

describe('needsReferenceImageShrink', () => {
  it('超过触发阈值才压（小图不白白解码）', () => {
    expect(needsReferenceImageShrink(REFERENCE_IMAGE_TRIGGER_BYTES)).toBe(false)
    expect(needsReferenceImageShrink(REFERENCE_IMAGE_TRIGGER_BYTES + 1)).toBe(true)
    expect(needsReferenceImageShrink(20 * 1024 * 1024)).toBe(true)
    expect(needsReferenceImageShrink(Number.NaN)).toBe(false)
  })
})

describe('fitWithinMaxEdge', () => {
  it('等比缩到长边以内，且永不放大', () => {
    expect(fitWithinMaxEdge(6000, 4000, 4096)).toEqual({ width: 4096, height: 2731 })
    expect(fitWithinMaxEdge(4000, 6000, 4096)).toEqual({ width: 2731, height: 4096 })
    expect(fitWithinMaxEdge(1024, 1024, 4096)).toEqual({ width: 1024, height: 1024 })
    expect(fitWithinMaxEdge(4096, 4096, 4096)).toEqual({ width: 4096, height: 4096 })
  })

  it('极端长宽比不会退化成 0', () => {
    expect(fitWithinMaxEdge(20000, 3, 4096)).toEqual({ width: 4096, height: 1 })
  })
})

describe('preferredReferenceImageFormat', () => {
  it('可能带透明的格式保 PNG，其余走 JPEG', () => {
    expect(preferredReferenceImageFormat('image/png')).toBe('png')
    expect(preferredReferenceImageFormat('image/webp')).toBe('png')
    expect(preferredReferenceImageFormat('image/jpeg')).toBe('jpeg')
    expect(preferredReferenceImageFormat('image/bmp')).toBe('jpeg')
  })
})

describe('referenceImageAttempts — 编码梯度', () => {
  it('JPEG 相机原图：先降到 4096 长边，逐级降质，最后保底 1536', () => {
    const attempts = referenceImageAttempts({ width: 6000, height: 4000, mime: 'image/jpeg' })
    expect(attempts).toEqual([
      { width: 4096, height: 2731, format: 'jpeg', quality: 88 },
      { width: 2560, height: 1707, format: 'jpeg', quality: 84 },
      { width: 2048, height: 1365, format: 'jpeg', quality: 80 },
      { width: 1536, height: 1024, format: 'jpeg', quality: 78 }
    ])
  })

  it('PNG：前两档保格式（透明不丢），后面才退 JPEG', () => {
    const attempts = referenceImageAttempts({ width: 3000, height: 2000, mime: 'image/png' })
    expect(attempts.map((a) => a.format)).toEqual(['png', 'png', 'jpeg', 'jpeg'])
    expect(attempts[0]).toEqual({ width: 3000, height: 2000, format: 'png', quality: 88 })
    expect(attempts[1]).toEqual({ width: 2560, height: 1707, format: 'png', quality: 84 })
  })

  it('小图不放大，只靠质量档区分', () => {
    const attempts = referenceImageAttempts({ width: 800, height: 600, mime: 'image/jpeg' })
    expect(attempts).toHaveLength(4)
    expect(new Set(attempts.map((a) => `${a.width}x${a.height}`)).size).toBe(1)
  })

  it('梯度单调变小（尺寸或质量至少一项在降）', () => {
    const attempts = referenceImageAttempts({ width: 6000, height: 4000, mime: 'image/png' })
    for (let i = 1; i < attempts.length; i++) {
      const prev = attempts[i - 1]!
      const next = attempts[i]!
      const shrunk = next.width < prev.width || next.height < prev.height
      expect(shrunk || next.quality < prev.quality).toBe(true)
    }
    expect(REFERENCE_IMAGE_TARGET_BYTES).toBeLessThan(REFERENCE_IMAGE_TRIGGER_BYTES)
  })
})
