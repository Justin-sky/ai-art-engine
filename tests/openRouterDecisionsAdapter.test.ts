import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createProviderInstance, resolveOpenRouterDecisionsUrl } from '../src/shared/modelProvider'

const getMock = vi.fn()
const postMock = vi.fn()

vi.mock('axios', () => ({
  default: {
    create: () => ({ get: getMock, post: postMock }),
    isAxiosError: () => false
  }
}))

const { openRouterAdapter } = await import('../src/main/services/modelProviders/openrouter/adapter')

function provider() {
  return createProviderInstance('openrouter', {
    id: 'p1',
    apiKey: 'sk-or-v1-test',
    baseUrl: 'https://openrouter.ai/api/v1'
  })
}

describe('openrouter decisions catalog', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('lists decisions models from output_modalities=decisions', async () => {
    getMock.mockResolvedValue({
      data: {
        data: [
          {
            id: 'typesafe/jev-1.13',
            name: 'TypeSafe: Jev 1.13',
            description: 'A System One decision model.',
            architecture: { modality: 'text->decisions', output_modalities: ['decisions'] },
            context_length: 65536,
            supported_parameters: []
          }
        ]
      }
    })

    const models = await openRouterAdapter.fetchCatalog(provider(), 'decisions')

    expect(getMock).toHaveBeenCalledWith('/models', {
      params: { output_modalities: 'decisions' }
    })
    expect(models).toEqual([
      {
        id: 'typesafe/jev-1.13',
        name: 'TypeSafe: Jev 1.13',
        description: 'A System One decision model.',
        modality: 'decisions',
        capabilities: {
          architecture: { modality: 'text->decisions', output_modalities: ['decisions'] },
          context_length: 65536,
          pricing: undefined,
          supported_parameters: []
        }
      }
    ])
  })

  it('does not fall back to the text catalog for decisions', async () => {
    // 文本分支会带 output_modalities=text；decisions 分支必须打自己的 params
    getMock.mockResolvedValue({ data: { data: [] } })

    await openRouterAdapter.fetchCatalog(provider(), 'decisions')

    expect(getMock).toHaveBeenCalledTimes(1)
    expect(getMock.mock.calls[0]![1]).toEqual({ params: { output_modalities: 'decisions' } })
  })
})

describe('resolveOpenRouterDecisionsUrl', () => {
  it('drops the /v1 segment because the alpha route is not under /v1', () => {
    // 实测：POST /api/v1/alpha/decisions → 404；POST /api/alpha/decisions → 401（需鉴权）
    expect(resolveOpenRouterDecisionsUrl('https://openrouter.ai/api/v1')).toBe(
      'https://openrouter.ai/api/alpha/decisions'
    )
  })

  it('handles the bare /api base, trailing slashes and an empty base', () => {
    expect(resolveOpenRouterDecisionsUrl('https://openrouter.ai/api')).toBe(
      'https://openrouter.ai/api/alpha/decisions'
    )
    expect(resolveOpenRouterDecisionsUrl('https://openrouter.ai/api/v1/')).toBe(
      'https://openrouter.ai/api/alpha/decisions'
    )
    expect(resolveOpenRouterDecisionsUrl('')).toBe('https://openrouter.ai/api/alpha/decisions')
  })

  it('keeps a third-party gateway base URL untouched', () => {
    expect(resolveOpenRouterDecisionsUrl('https://gateway.example.com/api/v1')).toBe(
      'https://gateway.example.com/api/v1/alpha/decisions'
    )
    // 形似但不是 openrouter.ai 的域名不应被削掉 /v1
    expect(resolveOpenRouterDecisionsUrl('https://openrouter.ai.evil.test/api/v1')).toBe(
      'https://openrouter.ai.evil.test/api/v1/alpha/decisions'
    )
  })
})

describe('openrouter generateDecisions', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('posts the documented body to the alpha decisions URL and normalizes the response', async () => {
    postMock.mockResolvedValue({
      data: {
        id: 'gen-dec-1',
        model: 'typesafe/jev-1.13-20260917',
        provider: 'TypeSafe',
        answers: {
          is_bug: { type: 'noul', noul: 0.96 },
          team: {
            type: 'choice',
            probabilities: { payments: 0.84, frontend: 0.16 }
          }
        },
        usage: { input_tokens: 476, output_tokens: 70, cost: 0.000019992 }
      }
    })

    const result = await openRouterAdapter.generateDecisions!(provider(), 'typesafe/jev-1.13', {
      state: 'ticket text',
      questions: {
        is_bug: {
          type: 'noul',
          instructions: 'Is it a bug?',
          criteria: { true: 'yes', false: 'no' }
        }
      },
      sessionId: 'session-1'
    })

    expect(postMock).toHaveBeenCalledWith('https://openrouter.ai/api/alpha/decisions', {
      model: 'typesafe/jev-1.13',
      state: 'ticket text',
      questions: {
        is_bug: {
          type: 'noul',
          instructions: 'Is it a bug?',
          criteria: { true: 'yes', false: 'no' }
        }
      },
      session_id: 'session-1'
    })
    expect(result.model).toBe('typesafe/jev-1.13-20260917')
    expect(result.answers).toEqual([
      { question: 'is_bug', type: 'noul', noul: 0.96 },
      // choice 缺失时用最高概率项兜底
      {
        question: 'team',
        type: 'choice',
        choice: 'payments',
        probabilities: { payments: 0.84, frontend: 0.16 }
      }
    ])
    expect(result.usage).toEqual({ inputTokens: 476, outputTokens: 70, cost: 0.000019992 })
  })

  it('surfaces upstream failures as a provider action error', async () => {
    postMock.mockRejectedValue(new Error('boom'))

    await expect(
      openRouterAdapter.generateDecisions!(provider(), 'liquid/d1', {
        state: 'x',
        questions: {
          q: { type: 'noul', instructions: 'ok?', criteria: { true: 'y', false: 'n' } }
        }
      })
    ).rejects.toThrow()
  })
})
