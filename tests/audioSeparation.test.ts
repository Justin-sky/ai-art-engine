import { describe, expect, it } from 'vitest'
import {
  buildAudioSeparationFilter,
  buildAudioSeparationOutputName,
  INSTRUMENTAL_PAN_FILTER,
  parseThirdPartySeparationResponse,
  VOCAL_PAN_FILTER
} from '../src/shared/graph/audioSeparation'

describe('audioSeparation 内置中置/侧置声道分离', () => {
  it('人声 = 中置声道 (L+R)/2', () => {
    expect(buildAudioSeparationFilter('vocal')).toBe(VOCAL_PAN_FILTER)
    expect(VOCAL_PAN_FILTER).toContain('0.5*c0+0.5*c1')
  })

  it('伴奏 = 侧声道 (L-R)/2，抵消居中的人声', () => {
    expect(buildAudioSeparationFilter('instrumental')).toBe(INSTRUMENTAL_PAN_FILTER)
    expect(INSTRUMENTAL_PAN_FILTER).toContain('0.5*c0-0.5*c1')
  })

  it('输出文件名为 vocal.wav / instrumental.wav', () => {
    expect(buildAudioSeparationOutputName('vocal')).toBe('vocal.wav')
    expect(buildAudioSeparationOutputName('instrumental')).toBe('instrumental.wav')
  })
})

describe('audioSeparation 第三方服务协议解析', () => {
  it('解析合法响应', () => {
    expect(
      parseThirdPartySeparationResponse({
        vocal: 'https://cdn.example/vocal.wav',
        instrumental: 'data:audio/wav;base64,AA=="'
      })
    ).toEqual({
      vocal: 'https://cdn.example/vocal.wav',
      instrumental: 'data:audio/wav;base64,AA=="'
    })
  })

  it('字段缺失 / 空串视为缺失', () => {
    expect(parseThirdPartySeparationResponse({ vocal: 'https://x/v.wav' })).toEqual({
      vocal: 'https://x/v.wav',
      instrumental: undefined
    })
    expect(parseThirdPartySeparationResponse({ vocal: '  ', instrumental: 'x' })).toEqual({
      instrumental: 'x'
    })
  })

  it('非对象 / null 输入返回空', () => {
    expect(parseThirdPartySeparationResponse(null)).toEqual({})
    expect(parseThirdPartySeparationResponse('oops')).toEqual({})
    expect(parseThirdPartySeparationResponse(42)).toEqual({})
  })
})
