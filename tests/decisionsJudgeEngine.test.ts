import { describe, expect, it, vi } from 'vitest'
import { createNodeFromType, createOutputGraphNode, runGraph } from '../src/shared/graph'
import { graphOutputNodeId } from '../src/shared/graph/types'
import type { GenerateDecisionsResult } from '../src/shared/modelProvider'

/**
 * 决策节点的**引擎级**贯通测试。
 *
 * 为什么必须走 runGraph：这条缝由三处接力（NodeExecuteContext 类型声明 →
 * engine.ts 把 options.generateDecisions 抄进 ctx → 渲染层各注入点提供实现）。
 * 只测 executor（直接手搓 ctx）会绕过第 2 处 —— 实际故障正是 engine.ts 少抄了一行，
 * 症状是节点报 GRAPH_DECISIONS_UNAVAILABLE，而单测全绿。
 */

const QUESTIONS = [
  'is_bug | noul | 是缺陷吗？ | 描述了异常行为 / 只是在提问',
  'team | choice | 哪个团队？ | payments:支付; frontend:前端'
].join('\n')

function makeResult(): GenerateDecisionsResult {
  return {
    model: 'typesafe/jev-1.13-20260917',
    provider: 'TypeSafe',
    answers: [
      { question: 'is_bug', type: 'noul', noul: 0.96 },
      { question: 'team', type: 'choice', choice: 'payments', confidence: 0.84 }
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
      }
    ],
    summary: 'is_bug=yes(0.96) team=payments(0.84)'
  }
}

function buildGraph() {
  const source = createNodeFromType(
    'play.script',
    { x: 0, y: 0 },
    { params: { text: '今天天气怎样' } }
  )
  const judge = createNodeFromType(
    'decisions.judge',
    { x: 200, y: 0 },
    { params: { decisionQuestions: QUESTIONS } }
  )
  // 引擎按「有没有输出节点」判断能不能跑：没有边界输出会直接 GRAPH_NO_OUTPUT
  const output = createOutputGraphNode('text', { x: 400, y: 0 }, { id: graphOutputNodeId('text') })
  return {
    doc: {
      nodes: [source, judge, output],
      edges: [
        {
          id: 'e1',
          source: source.id,
          target: judge.id,
          sourcePort: 'out',
          targetPort: 'in'
        },
        {
          id: 'e2',
          source: judge.id,
          target: output.id,
          sourcePort: 'out',
          targetPort: 'in'
        }
      ],
      viewport: { x: 0, y: 0, zoom: 1 }
    },
    judgeId: judge.id
  }
}

describe('决策节点经引擎贯通', () => {
  it('engine 把 options.generateDecisions 中转进 ctx，节点据此调用决策模型', async () => {
    const { doc, judgeId } = buildGraph()
    const generateDecisions = vi.fn(async () => makeResult())

    const result = await runGraph(doc, { stepDelayMs: 1, generateDecisions })

    expect(result.ok, result.error).toBe(true)
    expect(generateDecisions).toHaveBeenCalledTimes(1)
    const input = generateDecisions.mock.calls[0]![0]!
    // 上游文本被当作判定状态传入
    expect(String(input.state)).toContain('今天天气怎样')
    expect(input.questions.map((q) => q.key)).toEqual(['is_bug', 'team'])
    // 节点状态为完成，且结论摘要进入输出
    expect(result.states?.[judgeId]?.status).toBe('done')
    expect(JSON.stringify(result.states?.[judgeId]?.outputs)).toContain('is_bug=yes')
  })

  it('未注入该缝时报 GRAPH_DECISIONS_UNAVAILABLE（不静默降级成空判定）', async () => {
    const { doc, judgeId } = buildGraph()

    const result = await runGraph(doc, { stepDelayMs: 1 })

    expect(result.ok).toBe(false)
    expect(result.states?.[judgeId]?.status).toBe('error')
    expect(String(result.states?.[judgeId]?.error)).toContain('GRAPH_DECISIONS_UNAVAILABLE')
  })

  it('引擎贯通后只产出文本口，结论摘要可被下游文本节点消费', async () => {
    const { doc, judgeId } = buildGraph()
    const generateDecisions = vi.fn(async () => makeResult())

    const result = await runGraph(doc, { stepDelayMs: 1, generateDecisions })

    const outputs = result.states?.[judgeId]?.outputs as
      Record<string, { kind: string; text?: string }> | undefined
    expect(Object.keys(outputs ?? {}).sort()).toEqual(['out', 'out-all'])
    expect(outputs?.out?.kind).toBe('text')
    expect(String(outputs?.out?.text)).toContain('is_bug=yes')
  })
})
