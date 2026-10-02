import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NOUL_YES_THRESHOLD,
  buildDecisionQuestion,
  describeDecisionVerdicts,
  parseDecisionQuestions,
  resolveDecisionVerdicts,
  toDecisionQuestionBodies
} from '../src/shared/decisionQuestion'
import type { DecisionAnswer } from '../src/shared/modelProvider'

describe('parseDecisionQuestions', () => {
  it('parses noul / choice / score lines in order', () => {
    const questions = parseDecisionQuestions(
      [
        '# 工单分诊',
        'is_bug | noul | 这是软件缺陷吗？ | 描述了异常行为 / 只是在提问或提需求',
        'team | choice | 该由哪个团队接手？ | payments:支付; frontend:前端; account:账号',
        'urgency | score | 紧急程度？ | 可等下个版本; 本周修; 正在阻塞收入'
      ].join('\n')
    )

    expect(questions.map((q) => q.key)).toEqual(['is_bug', 'team', 'urgency'])
    expect(questions[0]).toMatchObject({
      type: 'noul',
      instructions: '这是软件缺陷吗？',
      noulCriteria: {
        yes: '描述了异常行为',
        no: '只是在提问或提需求'
      }
    })
    expect(questions[1].choices).toEqual([
      { value: 'payments', label: 'payments', description: '支付' },
      { value: 'frontend', label: 'frontend', description: '前端' },
      { value: 'account', label: 'account', description: '账号' }
    ])
    expect(questions[2].scale?.map((s) => s.label)).toEqual([
      '可等下个版本',
      '本周修',
      '正在阻塞收入'
    ])
  })

  it('skips comments, blank lines and unknown question types', () => {
    const questions = parseDecisionQuestions(
      ['// 注释', '', 'ok | noul | 通过吗？', 'broken | rating | 不支持的类型', '   '].join('\n')
    )
    expect(questions.map((q) => q.key)).toEqual(['ok'])
  })

  it('keeps pipes inside the judgement description', () => {
    const [question] = parseDecisionQuestions('q | noul | 成立吗？ | 说明A | 说明B')
    expect(question.noulCriteria?.yes).toBe('说明A | 说明B')
  })
})

describe('toDecisionQuestionBodies', () => {
  it('maps primitives to the upstream request shape', () => {
    const bodies = toDecisionQuestionBodies(
      parseDecisionQuestions(
        [
          'is_bug | noul | 是缺陷吗？ | 是 / 否',
          'team | choice | 哪个团队？ | payments:支付; frontend:前端',
          'urgency | score | 多紧急？ | 低; 中; 高'
        ].join('\n')
      )
    )

    expect(bodies).toEqual([
      {
        key: 'is_bug',
        body: {
          type: 'noul',
          instructions: '是缺陷吗？',
          criteria: { true: '是', false: '否' }
        }
      },
      {
        key: 'team',
        body: {
          type: 'choice',
          instructions: '哪个团队？',
          criteria: { payments: '支付', frontend: '前端' }
        }
      },
      {
        key: 'urgency',
        body: { type: 'score', instructions: '多紧急？', criteria: ['低', '中', '高'] }
      }
    ])
  })

  it('fills both noul criteria because the protocol requires true and false', () => {
    const [entry] = toDecisionQuestionBodies([{ key: 'k', type: 'noul', instructions: '成立吗？' }])
    const criteria = (entry.body as { criteria: { true: string; false: string } }).criteria
    expect(criteria.true.length).toBeGreaterThan(0)
    expect(criteria.false.length).toBeGreaterThan(0)
  })

  it('drops questions without criteria or instructions', () => {
    expect(
      toDecisionQuestionBodies([
        { key: 'no-choice', type: 'choice', instructions: '选哪个？', choices: [] },
        { key: 'no-scale', type: 'score', instructions: '打分？', scale: [] },
        { key: '', type: 'noul', instructions: '无名问题' },
        { key: 'no-instructions', type: 'noul', instructions: '   ' }
      ])
    ).toEqual([])
  })
})

describe('buildDecisionQuestion', () => {
  it('builds a choice question from a semicolon separated description', () => {
    const question = buildDecisionQuestion({
      key: 'team',
      type: 'choice',
      instructions: '谁接手？',
      detail: 'a:甲; b:乙'
    })
    expect(question.choices).toEqual([
      { value: 'a', label: 'a', description: '甲' },
      { value: 'b', label: 'b', description: '乙' }
    ])
  })

  it('falls back to the key as instructions', () => {
    const question = buildDecisionQuestion({ key: 'is_ok', type: 'noul', instructions: '' })
    expect(question.instructions).toBe('is_ok')
  })
})

describe('resolveDecisionVerdicts', () => {
  const answers: DecisionAnswer[] = [
    { question: 'is_bug', type: 'noul', noul: 0.96 },
    {
      question: 'team',
      type: 'choice',
      choice: 'payments',
      confidence: 0.84,
      probabilities: { payments: 0.84, frontend: 0.16, account: 0 }
    },
    {
      question: 'urgency',
      type: 'score',
      score: 1.99,
      confidence: 0.99,
      probabilities: { '0': 0, '1': 0.01, '2': 0.99 },
      legend: { '0': 'low', '1': 'mid', '2': 'high' }
    }
  ]

  it('applies default thresholds when none are given', () => {
    const verdicts = resolveDecisionVerdicts(answers)
    expect(verdicts[0]).toMatchObject({
      type: 'noul',
      probability: 0.96,
      verdict: true,
      threshold: DEFAULT_NOUL_YES_THRESHOLD
    })
    // 未设阈值时 choice / score 恒判为通过，便于调用方统一读 .confident / .aboveThreshold
    expect(verdicts[1]).toMatchObject({ type: 'choice', choice: 'payments', confident: true })
    expect(verdicts[2]).toMatchObject({ type: 'score', score: 1.99, aboveThreshold: true })
  })

  it('honours explicit thresholds', () => {
    const verdicts = resolveDecisionVerdicts(answers, {
      noulYes: 0.99,
      choiceMinConfidence: 0.9,
      scoreMin: 2
    })
    expect(verdicts[0]).toMatchObject({ verdict: false, threshold: 0.99 })
    expect(verdicts[1]).toMatchObject({ confident: false, threshold: 0.9 })
    expect(verdicts[2]).toMatchObject({ aboveThreshold: false, threshold: 2 })
  })

  it('drops malformed answers instead of emitting unusable verdicts', () => {
    expect(
      resolveDecisionVerdicts([
        { question: 'x', type: 'noul' },
        { question: 'y', type: 'choice' },
        { question: 'z', type: 'score' }
      ])
    ).toEqual([])
  })

  it('summarizes verdicts for logs', () => {
    expect(describeDecisionVerdicts(resolveDecisionVerdicts(answers))).toBe(
      'is_bug=yes(0.96) team=payments(0.84) urgency=1.99'
    )
  })
})
