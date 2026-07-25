import { describe, expect, it } from 'vitest'
import {
  listModelScopeCatalogModels,
  resolveModelScopeModelCapabilities
} from '../src/shared/modelProviders/modelscope/modelCapabilities'
import { classifyModelScopeModelModality } from '../src/shared/modelProvider'

describe('modelscope modelCapabilities', () => {
  it('lists text and image only', () => {
    expect(listModelScopeCatalogModels('text').length).toBeGreaterThan(0)
    expect(listModelScopeCatalogModels('image').every((m) => m.modality === 'image')).toBe(true)
    expect(listModelScopeCatalogModels('video')).toEqual([])
  })

  it('resolves image capabilities', () => {
    const caps = resolveModelScopeModelCapabilities('MAILAND/majicflus_v1', 'image')
    expect(caps?.supported_parameters).toBeTruthy()
  })

  it('classifies modality', () => {
    expect(classifyModelScopeModelModality({ id: 'Qwen/Qwen2.5-72B-Instruct' })).toBe('text')
    expect(classifyModelScopeModelModality({ id: 'MAILAND/majicflus_v1' })).toBe('image')
  })
})
