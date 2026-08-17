import { describe, expect, it } from 'vitest'
import { authHeaders } from '../src/main/services/modelProviders/http'
import {
  buildModelOptions
} from '../src/renderer/src/features/graph/model/generateModelOptions'
import {
  allowsEmptyApiKey,
  createEmptyModalityMap,
  createProviderInstance,
  pickActiveProvider
} from '../src/shared/modelProvider'

function withTextModel(providerKind: 'vllm' | 'ollama' | 'lmstudio' | 'openrouter') {
  return createProviderInstance(providerKind, {
    id: `${providerKind}-1`,
    apiKey: '',
    modalities: {
      ...createEmptyModalityMap(),
      text: { selectedModelIds: ['local-model'], defaultModelId: 'local-model' }
    }
  })
}

describe('local providers with empty API key', () => {
  it('authHeaders tolerates an empty key (local servers need no auth)', () => {
    const headers = authHeaders('')
    expect(headers.Authorization).toBeUndefined()
    expect(headers['Content-Type']).toBe('application/json')

    const withKey = authHeaders('sk-x')
    expect(withKey.Authorization).toBe('Bearer sk-x')
  })

  it('pickActiveProvider selects local providers without an API key', () => {
    const picked = pickActiveProvider([withTextModel('vllm')], 'text')
    expect(picked?.provider.providerKind).toBe('vllm')
    expect(picked?.modelId).toBe('local-model')
  })

  it('pickActiveProvider still requires a key for cloud providers', () => {
    expect(pickActiveProvider([withTextModel('openrouter')], 'text')).toBeNull()
  })

  it('allows empty API key for ComfyUI image workflows', () => {
    expect(allowsEmptyApiKey('comfyui')).toBe(true)
    const comfy = createProviderInstance('comfyui', {
      id: 'comfy-1',
      apiKey: '',
      modalities: {
        ...createEmptyModalityMap(),
        image: { selectedModelIds: ['txt2img'], defaultModelId: 'txt2img' }
      }
    })
    expect(pickActiveProvider([comfy], 'image')?.modelId).toBe('txt2img')
  })

  it('buildModelOptions includes local providers without a key (text only)', () => {
    const providers = [
      withTextModel('vllm'),
      withTextModel('ollama'),
      withTextModel('lmstudio'),
      withTextModel('openrouter')
    ]
    const text = buildModelOptions(providers, 'text')
    expect(text.map((o) => o.providerInstanceId).sort()).toEqual([
      'lmstudio-1',
      'ollama-1',
      'vllm-1'
    ])
    expect(buildModelOptions(providers, 'image')).toEqual([])
    expect(buildModelOptions(providers, 'video')).toEqual([])
  })
})
