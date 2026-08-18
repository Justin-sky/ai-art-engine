import { afterEach, describe, expect, it } from 'vitest'
import { MODEL_PROVIDER_KINDS } from '../src/shared/modelProvider'
import { createProviderPlugin } from '../src/main/plugins/providers'
import type { ModelProviderAdapter } from '../src/main/services/modelProviders/types'
import {
  getProviderAdapter,
  listRegisteredProviderKinds,
  startMainRuntime,
  stopMainRuntime
} from '../src/main/runtime'

describe('main Cordis provider plugins', () => {
  afterEach(async () => {
    await stopMainRuntime()
  })

  it('registers every builtin adapter through ctx.plugin', async () => {
    await startMainRuntime()
    expect(listRegisteredProviderKinds()).toEqual([...MODEL_PROVIDER_KINDS])
    expect(getProviderAdapter('comfyui').kind).toBe('comfyui')
    expect(getProviderAdapter('openrouter').kind).toBe('openrouter')
  })

  it('rejects adapter lookup after the runtime stops', async () => {
    await startMainRuntime()
    await stopMainRuntime()
    expect(() => getProviderAdapter('openai')).toThrow(/has not started/)
  })

  it('requires catalog meta when creating a provider plugin', () => {
    expect(() =>
      createProviderPlugin({ kind: 'not-a-kind' } as unknown as ModelProviderAdapter)
    ).toThrow(/Unknown model provider kind/)
  })
})
