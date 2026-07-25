import { describe, expect, it } from 'vitest'
import { isTextCatalogModel } from '../src/shared/modelProvider'

describe('isTextCatalogModel', () => {
  it('keeps models without modality metadata', () => {
    expect(isTextCatalogModel({})).toBe(true)
    expect(isTextCatalogModel({ architecture: {} })).toBe(true)
    expect(isTextCatalogModel({ architecture: { output_modalities: [] } })).toBe(true)
  })

  it('keeps models that output text', () => {
    expect(
      isTextCatalogModel({ architecture: { output_modalities: ['text'] } })
    ).toBe(true)
    expect(
      isTextCatalogModel({ architecture: { output_modalities: ['text', 'image'] } })
    ).toBe(true)
  })

  it('drops speech/image/video-only models', () => {
    expect(
      isTextCatalogModel({ architecture: { output_modalities: ['speech'] } })
    ).toBe(false)
    expect(
      isTextCatalogModel({ architecture: { output_modalities: ['image'] } })
    ).toBe(false)
    expect(
      isTextCatalogModel({ architecture: { output_modalities: ['video'] } })
    ).toBe(false)
  })
})
