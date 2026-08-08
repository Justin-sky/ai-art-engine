import { describe, expect, it } from 'vitest'
import {
  resolveVllmVideoDuration,
  resolveVllmVideoSize
} from '../src/shared/modelProviders/vllm/videoParams'

describe('vllmVideoParams', () => {
  it('maps resolution + aspect ratio to width/height', () => {
    expect(resolveVllmVideoSize('720p', '16:9')).toEqual({ width: 1280, height: 720 })
    expect(resolveVllmVideoSize('720p', '9:16')).toEqual({ width: 720, height: 1280 })
    expect(resolveVllmVideoSize('1080p', '16:9')).toEqual({ width: 1920, height: 1080 })
    expect(resolveVllmVideoSize('480p', '16:9')).toEqual({ width: 854, height: 480 })
    expect(resolveVllmVideoSize('720p', '1:1')).toEqual({ width: 720, height: 720 })
  })

  it('passes through explicit pixel sizes', () => {
    expect(resolveVllmVideoSize('1280x720', undefined)).toEqual({ width: 1280, height: 720 })
    expect(resolveVllmVideoSize('720x1280', '16:9')).toEqual({ width: 720, height: 1280 })
  })

  it('falls back to 720p base when only ratio or resolution is given', () => {
    expect(resolveVllmVideoSize(undefined, '16:9')).toEqual({ width: 1280, height: 720 })
    expect(resolveVllmVideoSize('1080p', undefined)).toEqual({ width: 1920, height: 1080 })
    expect(resolveVllmVideoSize(undefined, undefined)).toBeNull()
  })

  it('maps duration to seconds string', () => {
    expect(resolveVllmVideoDuration(5)).toBe('5')
    expect(resolveVllmVideoDuration(5.4)).toBe('5')
    expect(resolveVllmVideoDuration(undefined)).toBeUndefined()
    expect(resolveVllmVideoDuration(0)).toBeUndefined()
  })
})
