import { describe, expect, it } from 'vitest'
import {
  listDashScopeCatalogModels,
  resolveDashScopeModelCapabilities
} from '../src/shared/modelProviders/dashscope/modelCapabilities'
import { classifyDashScopeModelModality } from '../src/shared/openrouter'

describe('dashscope modelCapabilities', () => {
  it('lists modalities separately', () => {
    expect(listDashScopeCatalogModels('text').some((m) => m.id === 'qwen3.7-plus')).toBe(true)
    expect(listDashScopeCatalogModels('image').some((m) => m.id === 'wan2.5-t2i-preview')).toBe(
      true
    )
    expect(listDashScopeCatalogModels('image').some((m) => m.id === 'wan2.2-t2i-plus')).toBe(true)
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
    expect(listDashScopeCatalogModels('audio')).toEqual([])
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
  })

  it('classifies model modality by id', () => {
    expect(classifyDashScopeModelModality({ id: 'qwen-plus' })).toBe('text')
    expect(classifyDashScopeModelModality({ id: 'wanx2.1-t2i-turbo' })).toBe('image')
    expect(classifyDashScopeModelModality({ id: 'wan2.5-t2i-preview' })).toBe('image')
    expect(classifyDashScopeModelModality({ id: 'wan2.6-t2v' })).toBe('video')
    expect(classifyDashScopeModelModality({ id: 'wan2.7-i2v' })).toBe('video')
    expect(classifyDashScopeModelModality({ id: 'happyhorse-1.1-t2v' })).toBe('video')
    expect(classifyDashScopeModelModality({ id: 'kling/kling-v3-video-generation' })).toBe('video')
  })
})
