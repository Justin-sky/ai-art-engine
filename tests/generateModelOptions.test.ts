import { describe, expect, it } from 'vitest'
import {
  buildModelOptions,
  pickDefaultModelKey
} from '../src/renderer/src/features/graph/model/generateModelOptions'
import { createEmptyModalityMap, type ModelProviderInstance } from '../src/shared/openrouter'

function baseProvider(
  overrides: Partial<ModelProviderInstance> & Pick<ModelProviderInstance, 'id' | 'providerKind'>
): ModelProviderInstance {
  const modalities = createEmptyModalityMap()
  modalities.image.selectedModelIds = ['m1']
  modalities.image.defaultModelId = 'm1'
  return {
    label: overrides.label ?? overrides.providerKind,
    apiKey: 'ak',
    baseUrl: 'https://example.com',
    enabled: true,
    modalities,
    ...overrides
  }
}

describe('buildModelOptions', () => {
  it('omits kling providers without secretKey', () => {
    const providers = [
      baseProvider({ id: 'k1', providerKind: 'kling', secretKey: '' }),
      baseProvider({ id: 'k2', providerKind: 'kling', secretKey: 'sk' })
    ]
    const options = buildModelOptions(providers, 'image')
    expect(options.map((o) => o.providerInstanceId)).toEqual(['k2'])
  })

  it('pickDefaultModelKey skips kling without secretKey', () => {
    const providers = [
      baseProvider({ id: 'k1', providerKind: 'kling', secretKey: '' }),
      baseProvider({ id: 'k2', providerKind: 'kling', secretKey: 'sk' })
    ]
    const options = buildModelOptions(providers, 'image')
    expect(pickDefaultModelKey(providers, 'image', options)).toBe('k2::m1')
  })
})
