import { describe, expect, it } from 'vitest'
import { dashscopeNativeApiBase } from '../src/main/services/modelProviders/dashscope/nativeBase'

describe('dashscopeNativeApiBase', () => {
  it('derives /api/v1 from compatible-mode base', () => {
    expect(
      dashscopeNativeApiBase('https://dashscope.aliyuncs.com/compatible-mode/v1')
    ).toBe('https://dashscope.aliyuncs.com/api/v1')
  })

  it('keeps existing /api/v1', () => {
    expect(dashscopeNativeApiBase('https://dashscope.aliyuncs.com/api/v1')).toBe(
      'https://dashscope.aliyuncs.com/api/v1'
    )
  })
})
