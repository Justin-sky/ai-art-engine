import { describe, expect, it } from 'vitest'
import {
  SEEDREAM_MIN_PIXELS,
  assertSeedreamResolutionSupported,
  resolveSeedreamImageSize
} from '../src/shared/modelProviders/volcengineArk/imageSize'

describe('resolveSeedreamImageSize', () => {
  it('2K 按官方像素表换算', () => {
    expect(resolveSeedreamImageSize('2K', '1:1')).toBe('2048x2048')
    expect(resolveSeedreamImageSize('2K', '4:3')).toBe('2304x1728')
    expect(resolveSeedreamImageSize('2K', '3:4')).toBe('1728x2304')
    expect(resolveSeedreamImageSize('2K', '3:2')).toBe('2496x1664')
    expect(resolveSeedreamImageSize('2K', '2:3')).toBe('1664x2496')
    expect(resolveSeedreamImageSize('2K', '16:9')).toBe('2560x1440')
    expect(resolveSeedreamImageSize('2K', '9:16')).toBe('1440x2560')
    expect(resolveSeedreamImageSize('2K', '21:9')).toBe('3024x1296')
    expect(resolveSeedreamImageSize('2K', '9:21')).toBe('1296x3024')
  })

  it('4K 按官方像素表换算', () => {
    expect(resolveSeedreamImageSize('4K', '1:1')).toBe('4096x4096')
    expect(resolveSeedreamImageSize('4K', '4:3')).toBe('4694x3520')
    expect(resolveSeedreamImageSize('4K', '3:2')).toBe('4992x3328')
    expect(resolveSeedreamImageSize('4K', '16:9')).toBe('5404x3040')
    expect(resolveSeedreamImageSize('4K', '9:16')).toBe('3040x5404')
    expect(resolveSeedreamImageSize('4K', '21:9')).toBe('6198x2656')
  })

  it('1K / 3K 按 2K 官方表等比缩放', () => {
    expect(resolveSeedreamImageSize('1K', '1:1')).toBe('1024x1024')
    expect(resolveSeedreamImageSize('1K', '16:9')).toBe('1280x720')
    expect(resolveSeedreamImageSize('1K', '4:3')).toBe('1152x864')
    expect(resolveSeedreamImageSize('3K', '1:1')).toBe('3072x3072')
    expect(resolveSeedreamImageSize('3K', '16:9')).toBe('3840x2160')
    expect(resolveSeedreamImageSize('3K', '21:9')).toBe('4536x1944')
  })

  it('仅给宽高比时按 2K 档位换算', () => {
    expect(resolveSeedreamImageSize(undefined, '16:9')).toBe('2560x1440')
    expect(resolveSeedreamImageSize('', '9:16')).toBe('1440x2560')
  })

  it('仅给分辨率时保留关键字', () => {
    expect(resolveSeedreamImageSize('2K', undefined)).toBe('2K')
    expect(resolveSeedreamImageSize('4K', '')).toBe('4K')
  })

  it('分辨率本身是像素值时直接透传', () => {
    expect(resolveSeedreamImageSize('2048x2048', '16:9')).toBe('2048x2048')
    expect(resolveSeedreamImageSize('2048×2048', undefined)).toBe('2048x2048')
    expect(resolveSeedreamImageSize('2560*1440', '21:9')).toBe('2560x1440')
  })

  it('面积不足下限时按比例放大，保持宽高比', () => {
    expect(resolveSeedreamImageSize('1K', '16:9')).toBe('1280x720')
    expect(resolveSeedreamImageSize('1K', '16:9', SEEDREAM_MIN_PIXELS)).toBe('2560x1440')
    expect(resolveSeedreamImageSize('1K', '1:1', SEEDREAM_MIN_PIXELS)).toBe('2048x2048')
    expect(resolveSeedreamImageSize('1024x1024', undefined, SEEDREAM_MIN_PIXELS)).toBe(
      '1920x1920'
    )
  })

  it('面积已达下限时保持不变', () => {
    expect(resolveSeedreamImageSize('2K', '1:1', SEEDREAM_MIN_PIXELS)).toBe('2048x2048')
    expect(resolveSeedreamImageSize('2K', '21:9', SEEDREAM_MIN_PIXELS)).toBe('3024x1296')
    expect(resolveSeedreamImageSize('4K', '16:9', SEEDREAM_MIN_PIXELS)).toBe('5404x3040')
  })

  it('大小写与空白容错', () => {
    expect(resolveSeedreamImageSize(' 2k ', ' 16 : 9 ')).toBe('2560x1440')
    expect(resolveSeedreamImageSize('2k', '16:9')).toBe('2560x1440')
  })

  it('官方表外的比例按档位总像素反推，保持比例', () => {
    expect(resolveSeedreamImageSize('2K', '1:2')).toBe('1448x2896')
    expect(resolveSeedreamImageSize('2K', '2:1')).toBe('2896x1448')
  })

  it('分辨率未识别但有宽高比时回退 2K 档位', () => {
    expect(resolveSeedreamImageSize('custom', '16:9')).toBe('2560x1440')
  })

  it('无任何参数时不下发 size', () => {
    expect(resolveSeedreamImageSize(undefined, undefined)).toBeUndefined()
    expect(resolveSeedreamImageSize('', '')).toBeUndefined()
  })
})

describe('assertSeedreamResolutionSupported', () => {
  const modelId = 'doubao-seedream-5-0-260128'

  it('未指定分辨率或空值时放行', () => {
    expect(() => assertSeedreamResolutionSupported(modelId, undefined)).not.toThrow()
    expect(() => assertSeedreamResolutionSupported(modelId, '')).not.toThrow()
    expect(() => assertSeedreamResolutionSupported(modelId, '  ')).not.toThrow()
  })

  it('像素宽高形式放行', () => {
    expect(() => assertSeedreamResolutionSupported(modelId, '2048x2048')).not.toThrow()
    expect(() => assertSeedreamResolutionSupported(modelId, '1024×1024')).not.toThrow()
    expect(() => assertSeedreamResolutionSupported(modelId, '2560*1440')).not.toThrow()
  })

  it('已知档位放行（模型是否支持由上层宽容抬升）', () => {
    expect(() => assertSeedreamResolutionSupported(modelId, '1K')).not.toThrow()
    expect(() => assertSeedreamResolutionSupported(modelId, '2K')).not.toThrow()
    expect(() => assertSeedreamResolutionSupported(modelId, '4K')).not.toThrow()
    expect(() => assertSeedreamResolutionSupported(modelId, ' 2k ')).not.toThrow()
  })

  it('非法档位（如 512 / low）抛错并列出模型可选档位', () => {
    expect(() => assertSeedreamResolutionSupported(modelId, '512')).toThrowError(
      /不支持分辨率档位 "512"/
    )
    expect(() => assertSeedreamResolutionSupported(modelId, 'low')).toThrowError(
      /不支持分辨率档位 "low"/
    )
    expect(() =>
      assertSeedreamResolutionSupported(modelId, '512', ['2K', '3K', '4K'])
    ).toThrowError(/该模型可选：2K \/ 3K \/ 4K/)
  })
})
