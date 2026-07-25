import { describe, expect, it } from 'vitest'
import {
  listDashScopeCatalogModels,
  resolveDashScopeModelCapabilities
} from '../src/shared/modelProviders/dashscope/modelCapabilities'
import { classifyDashScopeModelModality } from '../src/shared/openrouter'

describe('dashscope modelCapabilities', () => {
  it('lists modalities separately', () => {
    expect(listDashScopeCatalogModels('text').length).toBeGreaterThan(0)
    expect(listDashScopeCatalogModels('image').every((m) => m.modality === 'image')).toBe(true)
    expect(listDashScopeCatalogModels('video').some((m) => m.id.includes('i2v'))).toBe(true)
    expect(listDashScopeCatalogModels('audio')).toEqual([])
  })

  it('resolves image/video capabilities', () => {
    const image = resolveDashScopeModelCapabilities('wanx2.1-t2i-turbo', 'image')
    expect(image?.supported_parameters).toBeTruthy()
    const i2v = resolveDashScopeModelCapabilities('wan2.2-i2v-flash', 'video')
    expect(i2v?.supported_frame_images).toContain('first_frame')
  })

  it('classifies model modality by id', () => {
    expect(classifyDashScopeModelModality({ id: 'qwen-plus' })).toBe('text')
    expect(classifyDashScopeModelModality({ id: 'wanx2.1-t2i-turbo' })).toBe('image')
    expect(classifyDashScopeModelModality({ id: 'wan2.6-t2v' })).toBe('video')
  })
})
