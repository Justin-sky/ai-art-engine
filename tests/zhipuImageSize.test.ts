import { describe, expect, it } from 'vitest'
import { resolveZhipuImageSize } from '../src/shared/modelProviders/zhipu/imageSize'

describe('zhipuImageSize', () => {
  it('maps aspect ratios to official CogView sizes', () => {
    expect(resolveZhipuImageSize(undefined, '1:1')).toBe('1024x1024')
    expect(resolveZhipuImageSize(undefined, '16:9')).toBe('1344x768')
    expect(resolveZhipuImageSize(undefined, '9:16')).toBe('768x1344')
    expect(resolveZhipuImageSize(undefined, '4:3')).toBe('1152x864')
    expect(resolveZhipuImageSize(undefined, '3:4')).toBe('864x1152')
    expect(resolveZhipuImageSize(undefined, '3:2')).toBe('1344x768')
    expect(resolveZhipuImageSize(undefined, '2:3')).toBe('768x1344')
    expect(resolveZhipuImageSize(undefined, '21:9')).toBe('1440x720')
    expect(resolveZhipuImageSize(undefined, '9:21')).toBe('720x1440')
  })

  it('passes through explicit pixel sizes within 512-2048', () => {
    expect(resolveZhipuImageSize('768x1344', undefined)).toBe('768x1344')
    expect(resolveZhipuImageSize('2048x2048', '1:1')).toBe('2048x2048')
  })

  it('returns undefined for out-of-range pixels or unknown ratios', () => {
    expect(resolveZhipuImageSize('256x256', undefined)).toBeUndefined()
    expect(resolveZhipuImageSize('3000x2000', undefined)).toBeUndefined()
    expect(resolveZhipuImageSize(undefined, '5:1')).toBeUndefined()
    expect(resolveZhipuImageSize(undefined, undefined)).toBeUndefined()
  })
})
