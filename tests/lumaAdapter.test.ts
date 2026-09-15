import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelProviderInstance } from '../src/shared/modelProvider'
import { createEmptyModalityMap } from '../src/shared/modelProvider'

const getMock = vi.fn()
const postMock = vi.fn()

vi.mock('axios', () => ({
  default: {
    create: () => ({
      get: getMock,
      post: postMock,
      interceptors: { request: { use: () => undefined } }
    }),
    isAxiosError: (err: unknown) =>
      Boolean(err && typeof err === 'object' && (err as { isAxiosError?: boolean }).isAxiosError)
  }
}))

import { lumaAdapter } from '../src/main/services/modelProviders/luma/adapter'

function provider(overrides?: Partial<ModelProviderInstance>): ModelProviderInstance {
  return {
    id: 'luma-1',
    providerKind: 'luma',
    label: 'Luma',
    apiKey: 'lk-test',
    baseUrl: 'https://api.lumalabs.ai/dream-machine/v1',
    enabled: true,
    modalities: createEmptyModalityMap(),
    ...overrides
  }
}

describe('lumaAdapter rigging', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('rejects rig=true because Luma Genie is geometry-only', async () => {
    await expect(
      lumaAdapter.submitModel3d(provider(), 'luma-genie', {
        prompt: 'a robot',
        rig: true
      })
    ).rejects.toThrow(/不支持蒙皮|不支持 rigging|蒙皮/)
  })

  it('still works without rig (preserves the prior non-rigged behaviour)', async () => {
    postMock.mockResolvedValueOnce({ data: { id: 'g-1' } })
    const job = await lumaAdapter.submitModel3d(provider(), 'luma-genie', {
      prompt: 'a chair'
    })
    expect(job).toMatchObject({ jobId: 'g-1', pollingUrl: 'g-1' })
    expect(postMock).toHaveBeenCalledWith(
      '/generations',
      expect.objectContaining({ prompt: 'a chair', format: 'glb' })
    )
    const body = postMock.mock.calls[0]?.[1] as Record<string, unknown>
    // 不应在请求体里塞入 rig 相关字段
    expect(body).not.toHaveProperty('rig')
    expect(body).not.toHaveProperty('rigging')
  })
})
