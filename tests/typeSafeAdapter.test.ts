import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createProviderInstance, resolveTypeSafeSystemOneUrl } from '../src/shared/modelProvider'

const getMock = vi.fn()
const postMock = vi.fn()

vi.mock('axios', () => ({
  default: {
    create: () => ({ get: getMock, post: postMock }),
    isAxiosError: () => false
  }
}))

const { typeSafeAdapter } = await import('../src/main/services/modelProviders/typesafe/adapter')

function provider(overrides: Record<string, unknown> = {}) {
  return createProviderInstance('typesafe', {
    id: 'ts1',
    apiKey: 'ts-test-key',
    ...overrides
  })
}

describe('resolveTypeSafeSystemOneUrl', () => {
  it('挂到 API 根的 /v1/systemone（实测端点，OpenAPI 已确认）', () => {
    expect(resolveTypeSafeSystemOneUrl('https://api.typesafe.ai')).toBe(
      'https://api.typesafe.ai/v1/systemone'
    )
  })

  it('容忍尾部斜杠与误填的 /v1（避免 /v1/v1/systemone）', () => {
    expect(resolveTypeSafeSystemOneUrl('https://api.typesafe.ai/')).toBe(
      'https://api.typesafe.ai/v1/systemone'
    )
    expect(resolveTypeSafeSystemOneUrl('https://api.typesafe.ai/v1')).toBe(
      'https://api.typesafe.ai/v1/systemone'
    )
  })

  it('留空时回落默认 API 根', () => {
    expect(resolveTypeSafeSystemOneUrl('')).toBe('https://api.typesafe.ai/v1/systemone')
  })
})

describe('TypeSafe 目录', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('把 { models: [{ name, description, release_date }] } 映射成 decisions 目录', async () => {
    getMock.mockResolvedValue({
      data: {
        models: [
          {
            name: 'jev-latest',
            description: 'General-purpose system one model.',
            release_date: '2026-09-15'
          }
        ]
      }
    })

    const models = await typeSafeAdapter.fetchCatalog(provider(), 'decisions')

    expect(getMock).toHaveBeenCalledWith('/v1/models')
    expect(models).toEqual([
      {
        id: 'jev-latest',
        name: 'jev-latest',
        description: 'General-purpose system one model.',
        modality: 'decisions',
        capabilities: { release_date: '2026-09-15' }
      }
    ])
  })

  it('兼容裸数组返回', async () => {
    getMock.mockResolvedValue({ data: [{ name: 'jev-1.13', description: 'pinned' }] })
    const models = await typeSafeAdapter.fetchCatalog(provider(), 'decisions')
    expect(models.map((m) => m.id)).toEqual(['jev-1.13'])
  })

  it('丢掉没有名字的行', async () => {
    getMock.mockResolvedValue({ data: { models: [{ description: 'no name' }, { name: 'ok' }] } })
    const models = await typeSafeAdapter.fetchCatalog(provider(), 'decisions')
    expect(models.map((m) => m.id)).toEqual(['ok'])
  })

  /** TypeSafe 只是决策模型厂商：别的模态必须返回空，否则设置页会出现无关列表 */
  it('非 decisions 模态一律返回空', async () => {
    for (const modality of ['text', 'image', 'video', 'audio', 'model3d'] as const) {
      expect(await typeSafeAdapter.fetchCatalog(provider(), modality)).toEqual([])
    }
    expect(getMock).not.toHaveBeenCalled()
  })
})

describe('TypeSafe System One 判定', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('POST /v1/systemone，请求体与 OpenRouter 同形（OpenAPI 已确认）', async () => {
    postMock.mockResolvedValue({
      data: {
        model: 'jev-latest',
        answers: {
          is_bug: { type: 'noul', noul: 0.96 },
          team: {
            type: 'choice',
            choice: 'payments',
            confidence: 0.8,
            probabilities: { payments: 0.8 }
          },
          urgency: {
            type: 'score',
            score: 1.7,
            confidence: 0.9,
            legend: { '0': 'low' },
            probabilities: { '0': 0.1 }
          }
        },
        usage: { input_tokens: 476, output_tokens: 70 }
      }
    })

    const result = await typeSafeAdapter.generateDecisions!(provider(), 'jev-latest', {
      state: 'ticket text',
      questions: {
        is_bug: { type: 'noul', instructions: 'Is it a bug?', criteria: { true: 'y', false: 'n' } },
        team: { type: 'choice', instructions: 'Who?', criteria: { payments: 'billing' } },
        urgency: { type: 'score', instructions: 'How urgent?', criteria: ['low', 'mid', 'high'] }
      }
    })

    expect(postMock).toHaveBeenCalledWith('https://api.typesafe.ai/v1/systemone', {
      model: 'jev-latest',
      state: 'ticket text',
      questions: {
        is_bug: { type: 'noul', instructions: 'Is it a bug?', criteria: { true: 'y', false: 'n' } },
        team: { type: 'choice', instructions: 'Who?', criteria: { payments: 'billing' } },
        urgency: { type: 'score', instructions: 'How urgent?', criteria: ['low', 'mid', 'high'] }
      }
    })
    // 复用同一套答案归一化：三种原语都能读出来
    expect(result.model).toBe('jev-latest')
    expect(result.answers).toEqual([
      { question: 'is_bug', type: 'noul', noul: 0.96 },
      {
        question: 'team',
        type: 'choice',
        choice: 'payments',
        confidence: 0.8,
        probabilities: { payments: 0.8 }
      },
      {
        question: 'urgency',
        type: 'score',
        score: 1.7,
        confidence: 0.9,
        probabilities: { '0': 0.1 },
        legend: { '0': 'low' }
      }
    ])
    expect(result.usage).toEqual({ inputTokens: 476, outputTokens: 70 })
  })

  it('上游失败包装成 provider action 错误', async () => {
    postMock.mockRejectedValue(new Error('boom'))
    await expect(
      typeSafeAdapter.generateDecisions!(provider(), 'jev-latest', {
        state: 'x',
        questions: { q: { type: 'noul', instructions: 'ok?', criteria: { true: 'y', false: 'n' } } }
      })
    ).rejects.toThrow()
  })

  it('没有 Key 时不该发起连通性探测', async () => {
    await expect(typeSafeAdapter.assertAuth(provider({ apiKey: '' }))).rejects.toThrow()
    expect(getMock).not.toHaveBeenCalled()
  })

  /** 决策模型厂商没有文本生成能力：误接进文本链路时必须明确拒绝 */
  it('文本生成入口明确拒绝，不静默产出空结果', async () => {
    await expect(
      typeSafeAdapter.generateText(provider(), 'jev-latest', { prompt: 'hi' })
    ).rejects.toThrow()
  })
})
