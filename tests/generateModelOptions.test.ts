import { describe, expect, it } from 'vitest'
import {
  buildModelOptions,
  pickDefaultModelKey
} from '../src/renderer/src/features/graph/model/generateModelOptions'
import { createEmptyModalityMap, type ModelProviderInstance } from '../src/shared/modelProvider'

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
  it('includes kling providers with apiKey only', () => {
    const providers = [
      baseProvider({ id: 'k1', providerKind: 'kling', apiKey: '' }),
      baseProvider({ id: 'k2', providerKind: 'kling', apiKey: 'key' })
    ]
    const options = buildModelOptions(providers, 'image')
    expect(options.map((o) => o.providerInstanceId)).toEqual(['k2'])
  })

  it('pickDefaultModelKey uses first kling with apiKey', () => {
    const providers = [
      baseProvider({ id: 'k1', providerKind: 'kling', apiKey: '' }),
      baseProvider({ id: 'k2', providerKind: 'kling', apiKey: 'key' })
    ]
    const options = buildModelOptions(providers, 'image')
    expect(pickDefaultModelKey(providers, 'image', options)).toBe('k2::m1')
  })

  it('includes minimax for text, image, video and audio', () => {
    const modalities = createEmptyModalityMap()
    modalities.text.selectedModelIds = ['MiniMax-M3']
    modalities.text.defaultModelId = 'MiniMax-M3'
    modalities.image.selectedModelIds = ['image-01']
    modalities.image.defaultModelId = 'image-01'
    modalities.video.selectedModelIds = ['MiniMax-Hailuo-2.3']
    modalities.video.defaultModelId = 'MiniMax-Hailuo-2.3'
    modalities.audio.selectedModelIds = ['voice-design']
    modalities.audio.defaultModelId = 'voice-design'
    const providers = [
      baseProvider({
        id: 'mm1',
        providerKind: 'minimax',
        apiKey: 'key',
        modalities
      })
    ]
    expect(buildModelOptions(providers, 'text').map((o) => o.model)).toEqual(['MiniMax-M3'])
    expect(buildModelOptions(providers, 'image').map((o) => o.model)).toEqual(['image-01'])
    expect(buildModelOptions(providers, 'video').map((o) => o.model)).toEqual([
      'MiniMax-Hailuo-2.3'
    ])
    expect(buildModelOptions(providers, 'audio').map((o) => o.model)).toEqual(['voice-design'])
  })
})
