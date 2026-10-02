import { describe, expect, it, vi } from 'vitest'
import { executeDecisionsJudgeNode } from '../src/shared/graph/execute/decisions'
import { ensureBuiltinNodeTypes, getNodeType, listAddableNodeTypes } from '../src/shared/graph'
import type { NodeExecuteContext } from '../src/shared/graph'
import type { GenerateDecisionsResult } from '../src/shared/modelProvider'

const QUESTIONS = [
  'is_bug | noul | 是缺陷吗？ | 描述了异常行为 / 只是在提问',
  'team | choice | 哪个团队？ | payments:支付; frontend:前端',
  'urgency | score | 多紧急？ | 低; 中; 高'
].join('\n')

function makeResult(overrides: Partial<GenerateDecisionsResult> = {}): GenerateDecisionsResult {
  return {
    model: 'typesafe/jev-1.13-20260917',
    provider: 'TypeSafe',
    answers: [
      { question: 'is_bug', type: 'noul', noul: 0.96 },
      { question: 'team', type: 'choice', choice: 'payments', confidence: 0.84 },
      { question: 'urgency', type: 'score', score: 1.99 }
    ],
    verdicts: [
      { type: 'noul', question: 'is_bug', probability: 0.96, verdict: true, threshold: 0.5 },
      {
        type: 'choice',
        question: 'team',
        choice: 'payments',
        confidence: 0.84,
        confident: true,
        probabilities: {}
      },
      {
        type: 'score',
        question: 'urgency',
        score: 1.99,
        aboveThreshold: true,
        probabilities: {},
        legend: {}
      }
    ],
    summary: 'is_bug=yes(0.96) team=payments(0.84) urgency=1.99',
    ...overrides
  }
}

function makeContext(overrides: {
  params?: Record<string, unknown>
  generateDecisions?: NodeExecuteContext['generateDecisions']
  inputs?: NodeExecuteContext['inputs']
}): { ctx: NodeExecuteContext; patched: Array<Record<string, unknown>> } {
  const patched: Array<Record<string, unknown>> = []
  const node = {
    id: 'n1',
    typeId: 'decisions.judge',
    title: '决策判定',
    params: {
      text: '客户工单：结账页点支付后白屏。',
      decisionQuestions: QUESTIONS,
      ...overrides.params
    }
  }
  const ctx = {
    node,
    inputs: overrides.inputs ?? {},
    locale: 'zh-CN',
    generateDecisions: overrides.generateDecisions,
    patchNode: (patch: { params?: Record<string, unknown> }) => {
      if (patch.params) patched.push(patch.params)
    }
  } as unknown as NodeExecuteContext
  return { ctx, patched }
}

describe('executeDecisionsJudgeNode', () => {
  it('passes the parsed questions, state and thresholds to the decisions seam', async () => {
    const generateDecisions = vi.fn(async () => makeResult())
    const { ctx } = makeContext({ generateDecisions })

    const out = await executeDecisionsJudgeNode(ctx)

    expect(generateDecisions).toHaveBeenCalledTimes(1)
    const input = generateDecisions.mock.calls[0]![0]
    expect(input.state).toContain('结账页点支付后白屏')
    expect(input.questions.map((q) => [q.key, q.type])).toEqual([
      ['is_bug', 'noul'],
      ['team', 'choice'],
      ['urgency', 'score']
    ])
    // noul 默认阈值 0.5 恒定下发；choice / score 未配置时不写阈值
    expect(input.thresholds).toEqual({ noulYes: 0.5 })
    expect(input.questions[0]!.noulCriteria).toEqual({
      yes: '描述了异常行为',
      no: '只是在提问'
    })
    expect(input.questions[1]!.choices?.map((c) => c.value)).toEqual(['payments', 'frontend'])
    expect(input.questions[2]!.scale?.map((s) => s.label)).toEqual(['低', '中', '高'])

    // 结论落成文本产物（out / out-all），下游文本链路可直接消费
    expect(out.out).toMatchObject({ kind: 'text' })
    expect(String((out.out as { text: string }).text)).toContain('is_bug=yes(0.96)')
  })

  it('forwards an explicitly configured model and provider', async () => {
    const generateDecisions = vi.fn(async () => makeResult())
    const { ctx } = makeContext({
      generateDecisions,
      params: { generateModel: 'liquid/d1', generateProviderInstanceId: 'p-or' }
    })

    await executeDecisionsJudgeNode(ctx)

    expect(generateDecisions.mock.calls[0]![0]).toMatchObject({
      model: 'liquid/d1',
      providerInstanceId: 'p-or'
    })
  })

  it('sends configured decision thresholds', async () => {
    const generateDecisions = vi.fn(async () => makeResult())
    const { ctx } = makeContext({
      generateDecisions,
      params: {
        decisionNoulYesThreshold: 0.9,
        decisionChoiceMinConfidence: 0.8,
        decisionScoreMin: 2
      }
    })

    await executeDecisionsJudgeNode(ctx)

    expect(generateDecisions.mock.calls[0]![0]!.thresholds).toEqual({
      noulYes: 0.9,
      choiceMinConfidence: 0.8,
      scoreMin: 2
    })
  })

  it('persists verdicts and the serving model on the node params', async () => {
    const { ctx, patched } = makeContext({ generateDecisions: async () => makeResult() })

    await executeDecisionsJudgeNode(ctx)

    const params = patched.at(-1)!
    expect(params.decisionModelUsed).toBe('typesafe/jev-1.13-20260917')
    expect(params.decisionProvider).toBe('TypeSafe')
    expect((params.decisionVerdicts as unknown[]).length).toBe(3)
  })

  it('falls back to local verdict computation when the facade omits verdicts', async () => {
    const { ctx } = makeContext({
      generateDecisions: async () => makeResult({ verdicts: [], summary: '' })
    })

    const out = await executeDecisionsJudgeNode(ctx)

    expect(String((out.out as { text: string }).text)).toContain('is_bug=yes')
  })

  it('fails fast without questions, without a decisions seam, or without state', async () => {
    const noQuestions = makeContext({ params: { decisionQuestions: '' } })
    await expect(executeDecisionsJudgeNode(noQuestions.ctx)).rejects.toThrow(
      'GRAPH_DECISIONS_NO_QUESTIONS'
    )

    const noSeam = makeContext({})
    await expect(executeDecisionsJudgeNode(noSeam.ctx)).rejects.toThrow(
      'GRAPH_DECISIONS_UNAVAILABLE'
    )

    const noState = makeContext({
      generateDecisions: vi.fn(async () => makeResult()),
      params: { text: '' }
    })
    await expect(executeDecisionsJudgeNode(noState.ctx)).rejects.toThrow('GRAPH_PROCESS_NO_INPUT')
  })

  it('reports the missing input before the missing seam (user-fixable error wins)', async () => {
    // 没连上游 + 未注入能力缝同时成立时，应报「请连接输入」而不是「功能没接通」：
    // 接线漏了是开发期问题，忘连线是用户当场能改的
    const { ctx } = makeContext({ params: { text: '' } })
    await expect(executeDecisionsJudgeNode(ctx)).rejects.toThrow('GRAPH_PROCESS_NO_INPUT')
  })

  it('reports a missing result when the model returns no usable verdict', async () => {
    const { ctx } = makeContext({
      generateDecisions: async () => makeResult({ answers: [], verdicts: [], summary: '' })
    })
    await expect(executeDecisionsJudgeNode(ctx)).rejects.toThrow()
  })
})

/**
 * 端口面：决策判定**只出文本**（out / out-all）。
 *
 * 曾经额外出过一条「判定结论 JSON」口，已删除，理由钉在这里防止再加回来：
 * 结论已经在 node.params.decisionVerdicts，Inspector / 卡片直接读；
 * 图引擎没有条件执行，下游拿到 JSON 也无法用字段分支；
 * 而且文本节点在未写 `@` 时会自动追加所有上游正文，挂上 JSON 边会把原文灌进下游 prompt。
 */
describe('决策判定节点的端口面', () => {
  it('只有文本口（in / out / out-all），没有额外的 JSON 口', () => {
    ensureBuiltinNodeTypes()
    const def = getNodeType('decisions.judge')
    expect(def).toBeTruthy()
    expect(def!.ports.map((p) => p.id).sort()).toEqual(['in', 'out', 'out-all'])
    // 端口仍在画布菜单里可添加
    expect(listAddableNodeTypes('workflow').some((d) => d.typeId === 'decisions.judge')).toBe(true)
  })

  it('执行结果只产出文本口，结论则落在 node.params.decisionVerdicts', async () => {
    const generateDecisions = vi.fn(async () => makeResult())
    const { ctx, patched } = makeContext({ generateDecisions })

    const out = await executeDecisionsJudgeNode(ctx)

    expect(Object.keys(out).sort()).toEqual(['out', 'out-all'])
    expect(String((out.out as { text: string }).text)).toContain('is_bug=yes(0.96)')
    // 结构化结论（含各档概率）走节点参数，不占端口
    const verdicts = patched.at(-1)!.decisionVerdicts as Array<Record<string, unknown>>
    expect(verdicts).toHaveLength(3)
    expect(verdicts[0]).toMatchObject({ question: 'is_bug', type: 'noul', verdict: true })
  })
})
