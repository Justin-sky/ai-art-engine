import { describe, expect, it } from 'vitest'
import {
  listDashScopeCatalogModels,
  resolveDashScopeModelCapabilities
} from '../src/shared/modelProviders/dashscope/modelCapabilities'
import { classifyDashScopeModelModality } from '../src/shared/modelProvider'

describe('dashscope modelCapabilities', () => {
  it('lists modalities separately', () => {
    expect(listDashScopeCatalogModels('text').some((m) => m.id === 'qwen3.7-plus')).toBe(true)
    expect(listDashScopeCatalogModels('image').some((m) => m.id === 'wan2.5-t2i-preview')).toBe(
      true
    )
    expect(listDashScopeCatalogModels('image').some((m) => m.id === 'wan2.2-t2i-plus')).toBe(true)
    expect(listDashScopeCatalogModels('video').some((m) => m.id === 'wan3.0-video')).toBe(true)
    expect(listDashScopeCatalogModels('video').some((m) => m.id === 'wan2.7-t2v')).toBe(true)
    expect(listDashScopeCatalogModels('video').some((m) => m.id === 'happyhorse-1.1-t2v')).toBe(
      true
    )
    expect(listDashScopeCatalogModels('video').some((m) => m.id === 'happyhorse-1.1-r2v')).toBe(
      true
    )
    expect(
      listDashScopeCatalogModels('video').some((m) => m.id === 'happyhorse-1.0-video-edit')
    ).toBe(true)
    expect(
      listDashScopeCatalogModels('video').some((m) => m.id === 'kling/kling-v3-video-generation')
    ).toBe(true)
    expect(
      listDashScopeCatalogModels('video').some(
        (m) => m.id === 'kling/kling-v3-omni-video-generation'
      )
    ).toBe(true)
    expect(listDashScopeCatalogModels('video').some((m) => m.id.includes('i2v'))).toBe(true)
    expect(listDashScopeCatalogModels('audio').some((m) => m.id === 'fun-music-v1')).toBe(true)
    expect(listDashScopeCatalogModels('audio').some((m) => m.id === 'fun-music-preview')).toBe(true)
  })

  it('resolves audio music capabilities', () => {
    const music = resolveDashScopeModelCapabilities('fun-music-v1', 'audio')
    expect(music?.music).toBe(true)
    expect(music?.instrumental).toBe(true)
    expect(music?.lyrics).toBe(true)
    const preview = resolveDashScopeModelCapabilities('fun-music-preview', 'audio')
    expect(preview?.music).toBe(true)
  })

  it('resolves image/video capabilities', () => {
    const image = resolveDashScopeModelCapabilities('wanx2.1-t2i-turbo', 'image')
    expect(image?.supported_parameters).toBeTruthy()
    const t2v = resolveDashScopeModelCapabilities('wan2.7-t2v', 'video')
    expect(t2v?.supported_resolutions).toEqual(['720P', '1080P'])
    const i2v = resolveDashScopeModelCapabilities('wan2.2-i2v-flash', 'video')
    expect(i2v?.supported_frame_images).toContain('first_frame')
    expect(i2v?.supported_durations).toEqual([5])
    const r2v = resolveDashScopeModelCapabilities('happyhorse-1.1-r2v', 'video')
    expect(r2v?.max_input_images).toBe(9)
    expect(r2v?.supported_frame_images).toEqual([])
    const edit = resolveDashScopeModelCapabilities('happyhorse-1.0-video-edit', 'video')
    expect(edit?.max_input_videos).toBe(1)
    expect(edit?.max_input_images).toBe(5)
    expect(edit?.supported_durations).toEqual([])
    const wan3 = resolveDashScopeModelCapabilities('wan3.0-video', 'video')
    expect(wan3?.supported_durations).toContain(30)
    expect(wan3?.supported_frame_images).toEqual(['first_frame', 'last_frame'])
    expect(wan3?.generate_audio).toBe(true)
    expect(wan3?.max_input_images).toBe(10)
    expect(wan3?.max_input_videos).toBe(5)
    expect(wan3?.max_input_audios).toBe(5)
    const wan3Variant = resolveDashScopeModelCapabilities('wan3.0-r2v', 'video')
    expect(wan3Variant?.supported_durations).toContain(30)
  })

  it('classifies model modality by id', () => {
    expect(classifyDashScopeModelModality({ id: 'qwen-plus' })).toBe('text')
    expect(classifyDashScopeModelModality({ id: 'wanx2.1-t2i-turbo' })).toBe('image')
    expect(classifyDashScopeModelModality({ id: 'wan2.5-t2i-preview' })).toBe('image')
    expect(classifyDashScopeModelModality({ id: 'wan2.6-t2v' })).toBe('video')
    expect(classifyDashScopeModelModality({ id: 'wan2.7-i2v' })).toBe('video')
    expect(classifyDashScopeModelModality({ id: 'happyhorse-1.1-t2v' })).toBe('video')
    expect(classifyDashScopeModelModality({ id: 'kling/kling-v3-video-generation' })).toBe('video')
    expect(classifyDashScopeModelModality({ id: 'fun-music-v1' })).toBe('audio')
    expect(classifyDashScopeModelModality({ id: 'fun-music-preview' })).toBe('audio')
  })
})
