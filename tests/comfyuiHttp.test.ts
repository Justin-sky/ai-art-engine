import { describe, expect, it } from 'vitest'
import { createEmptyModalityMap, type ModelProviderInstance } from '../src/shared/modelProvider'
import {
  createComfyUiFormClient,
  createComfyUiHttpClient
} from '../src/main/services/modelProviders/comfyui/http'

function provider(): ModelProviderInstance {
  return {
    id: 'comfy-http',
    providerKind: 'comfyui',
    label: 'ComfyUI',
    apiKey: '',
    baseUrl: 'http://127.0.0.1:8189',
    enabled: true,
    modalities: createEmptyModalityMap()
  }
}

describe('comfyui http clients', () => {
  it('keeps the JSON content-type on normal clients', () => {
    const client = createComfyUiHttpClient(provider())
    expect(client.defaults.headers['Content-Type']).toBe('application/json')
  })

  it('leaves form uploads to axios multipart detection', () => {
    const client = createComfyUiFormClient(provider())
    expect(client.defaults.headers['Content-Type']).toBeUndefined()
  })
})
