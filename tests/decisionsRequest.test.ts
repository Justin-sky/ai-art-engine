import { describe, expect, it } from 'vitest'
import {
  buildDecisionsRequest,
  normalizeDecisionAnswer,
  normalizeDecisionResponse
} from '../src/main/services/modelProviders/decisions'
import { OPENROUTER_DECISIONS_PATH } from '../src/shared/modelProvider'
import type { GenerateDecisionsInput } from '../src/shared/modelProvider'

const TICKET_INPUT: GenerateDecisionsInput = {
  model: 'typesafe/jev-1.13',
  state: {
    customer_tier: 'enterprise',
    ticket: 'My checkout page shows a blank screen after I click Pay.'
  },
  questions: [
    {
      key: 'is_bug',
      type: 'noul',
      instructions: 'Is the customer reporting a software defect?',
      noulCriteria: { yes: 'Broken behaviour.', no: 'A question or feature request.' }
    },
    {
      key: 'team',
      type: 'choice',
      instructions: 'Which team should own this ticket?',
      choices: [
        { value: 'payments', description: 'Checkout and billing.' },
        { value: 'frontend', description: 'Rendering and layout.' }
      ]
    },
    {
      key: 'urgency',
      type: 'score',
      instructions: 'How urgent is this ticket?',
      scale: [{ label: 'Can wait' }, { label: 'This week' }, { label: 'Blocking revenue' }]
    }
  ]
}

describe('OPENROUTER_DECISIONS_PATH', () => {
  it('is the alpha decisions route appended to the configured base URL', () => {
    expect(OPENROUTER_DECISIONS_PATH).toBe('/alpha/decisions')
  })
})

describe('buildDecisionsRequest', () => {
  it('builds the documented request body', () => {
    const body = buildDecisionsRequest(TICKET_INPUT, 'typesafe/jev-1.13')

    expect(body.model).toBe('typesafe/jev-1.13')
    expect(body.state).toEqual(TICKET_INPUT.state)
    expect(body.questions).toEqual({
      is_bug: {
        type: 'noul',
        instructions: 'Is the customer reporting a software defect?',
        criteria: { true: 'Broken behaviour.', false: 'A question or feature request.' }
      },
      team: {
        type: 'choice',
        instructions: 'Which team should own this ticket?',
        criteria: { payments: 'Checkout and billing.', frontend: 'Rendering and layout.' }
      },
      urgency: {
        type: 'score',
        instructions: 'How urgent is this ticket?',
        criteria: ['Can wait', 'This week', 'Blocking revenue']
      }
    })
  })

  it('joins evidence items into a state text with headers', () => {
    const body = buildDecisionsRequest(
      {
        evidence: [
          { title: 'script.md', path: 'Assets/script.md', text: 'INT. LAB - NIGHT' },
          { path: 'Assets/notes.md', text: 'keep the twist quiet' },
          { path: 'Assets/empty.md', text: '   ' }
        ],
        questions: [
          {
            key: 'ok',
            type: 'noul',
            instructions: 'Ready to shoot?',
            noulCriteria: { yes: 'y', no: 'n' }
          }
        ]
      },
      'liquid/d1'
    )

    expect(body.state).toBe(
      '## script.md · Assets/script.md\nINT. LAB - NIGHT\n\n## Assets/notes.md\nkeep the twist quiet'
    )
    // 空证据被丢弃，不会留下孤立标题
    expect(String(body.state)).not.toContain('empty.md')
  })

  it('rejects a request without state', () => {
    expect(() =>
      buildDecisionsRequest(
        { questions: [{ key: 'ok', type: 'noul', instructions: 'Ready?' }] },
        'liquid/d1'
      )
    ).toThrow(/state is required/)
  })

  it('rejects a request without any complete question', () => {
    expect(() => buildDecisionsRequest({ state: 'text', questions: [] }, 'liquid/d1')).toThrow(
      /at least one complete question/
    )
  })

  it('truncates session and user ids to the documented 256 characters', () => {
    const body = buildDecisionsRequest(
      {
        state: 'text',
        sessionId: 's'.repeat(300),
        user: '  spaced-user  ',
        questions: [{ key: 'ok', type: 'noul', instructions: 'Ready?' }]
      },
      'liquid/d1'
    )
    expect(body.sessionId).toHaveLength(256)
    expect(body.user).toBe('spaced-user')
  })
})

describe('normalizeDecisionAnswer', () => {
  it('keeps the documented noul / choice / score fields', () => {
    expect(normalizeDecisionAnswer('is_bug', { type: 'noul', noul: 0.96 })).toEqual({
      question: 'is_bug',
      type: 'noul',
      noul: 0.96
    })
    expect(
      normalizeDecisionAnswer('team', {
        type: 'choice',
        choice: 'payments',
        confidence: 0.84,
        probabilities: { payments: 0.84, frontend: 0.16 }
      })
    ).toEqual({
      question: 'team',
      type: 'choice',
      choice: 'payments',
      confidence: 0.84,
      probabilities: { payments: 0.84, frontend: 0.16 }
    })
    expect(
      normalizeDecisionAnswer('urgency', {
        type: 'score',
        score: 1.99,
        legend: { '0': 'low', '2': 'high' },
        probabilities: { '0': 0, '2': 0.99 }
      })
    ).toEqual({
      question: 'urgency',
      type: 'score',
      score: 1.99,
      probabilities: { '0': 0, '2': 0.99 },
      legend: { '0': 'low', '2': 'high' }
    })
  })

  it('falls back to the highest probability option when choice is missing', () => {
    const answer = normalizeDecisionAnswer('team', {
      type: 'choice',
      probabilities: { payments: 0.2, frontend: 0.7, account: 0.1 }
    })
    expect(answer).toMatchObject({ type: 'choice', choice: 'frontend' })
  })

  it('breaks probability ties deterministically', () => {
    const answer = normalizeDecisionAnswer('team', {
      type: 'choice',
      probabilities: { b: 0.5, a: 0.5 }
    })
    expect(answer).toMatchObject({ choice: 'a' })
  })

  it('rejects unknown primitives and missing required fields', () => {
    expect(normalizeDecisionAnswer('x', { type: 'ranking', rank: 1 })).toBeNull()
    expect(normalizeDecisionAnswer('x', { type: 'noul' })).toBeNull()
    expect(normalizeDecisionAnswer('x', { type: 'choice', probabilities: {} })).toBeNull()
    expect(normalizeDecisionAnswer('x', { type: 'score' })).toBeNull()
    expect(normalizeDecisionAnswer('x', 'not-an-object')).toBeNull()
  })
})

describe('normalizeDecisionResponse', () => {
  it('normalizes the documented live response', () => {
    const response = normalizeDecisionResponse(
      {
        id: 'gen-dec-1789738314-X5e5eKGQdvR9rblyX250',
        model: 'typesafe/jev-1.13-20260917',
        provider: 'TypeSafe',
        answers: {
          is_bug: { type: 'noul', noul: 0.96 },
          team: {
            type: 'choice',
            choice: 'payments',
            confidence: 0.75,
            probabilities: { account: 0, frontend: 0.16, payments: 0.84 }
          },
          urgency: {
            type: 'score',
            score: 1.99,
            confidence: 0.99,
            legend: { '0': 'Can wait', '2': 'Blocking revenue' },
            probabilities: { '0': 0, '1': 0.01, '2': 0.99 }
          }
        },
        usage: { cost: 0.000019992, input_tokens: 476, output_tokens: 70 }
      },
      'typesafe/jev-1.13'
    )

    expect(response.id).toBe('gen-dec-1789738314-X5e5eKGQdvR9rblyX250')
    expect(response.model).toBe('typesafe/jev-1.13-20260917')
    expect(response.provider).toBe('TypeSafe')
    expect(response.answers.map((a) => a.question)).toEqual(['is_bug', 'team', 'urgency'])
    expect(response.usage).toEqual({ inputTokens: 476, outputTokens: 70, cost: 0.000019992 })
  })

  it('falls back to the requested model and tolerates a missing usage block', () => {
    const response = normalizeDecisionResponse(
      { answers: { ok: { type: 'noul', noul: 0.4 } } },
      'liquid/d1'
    )
    expect(response.model).toBe('liquid/d1')
    expect(response.usage).toBeUndefined()
    expect(response.answers).toHaveLength(1)
  })

  it('returns an empty answer list for malformed payloads', () => {
    expect(normalizeDecisionResponse(null, 'liquid/d1').answers).toEqual([])
    expect(normalizeDecisionResponse({ answers: [] }, 'liquid/d1').answers).toEqual([])
  })
})
