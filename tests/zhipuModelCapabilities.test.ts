import { describe, expect, it } from 'vitest'
import {
  isZhipuTextModelId,
  listZhipuCatalogModels,
  resolveZhipuModelCapabilities
} from '../src/shared/modelProviders/zhipu/modelCapabilities'

describe('zhipuModelCapabilities', () => {
  it('lists static image catalog with CogView models', () => {
    const images = listZhipuCatalogModels('image')
    expect(images.some((m) => m.id === 'glm-image')).toBe(true)
    expect(images.some((m) => m.id === 'cogview-4-250304')).toBe(true)
    expect(images.some((m) => m.id === 'cogview-4')).toBe(true)
    expect(images.some((m) => m.id === 'cogview-3-flash')).toBe(true)
    expect(listZhipuCatalogModels('video')).toEqual([])
    expect(listZhipuCatalogModels('audio')).toEqual([])
  })

  it('provides static GLM text fallback list', () => {
    const texts = listZhipuCatalogModels('text')
    expect(texts.some((m) => m.id === 'glm-5.2')).toBe(true)
    expect(texts.some((m) => m.id === 'glm-4-flash')).toBe(true)
    expect(texts.some((m) => m.id === 'glm-z1-flash')).toBe(true)
  })

  it('resolves image capabilities (no reference images, single output)', () => {
    const caps = resolveZhipuModelCapabilities('cogview-4', 'image')
    const sp = caps?.supported_parameters as Record<string, unknown> | undefined
    expect(sp?.input_references).toEqual({ max: 0 })
    expect(sp?.n).toEqual({ min: 1, max: 1 })
    expect(resolveZhipuModelCapabilities('glm-image')).not.toBeNull()
  })

  it('filters remote /models rows to GLM text models', () => {
    expect(isZhipuTextModelId('glm-5.2')).toBe(true)
    expect(isZhipuTextModelId('glm-5v-turbo')).toBe(true)
    expect(isZhipuTextModelId('glm-image')).toBe(false)
    expect(isZhipuTextModelId('cogview-4')).toBe(false)
  })
})
