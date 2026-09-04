import { describe, expect, it } from 'vitest'
import type { OrchestratorJob, OrchestratorNodeState } from '../src/shared/ipc'
import {
  orchestratorJobToDraft,
  orchestratorJobToRunInput
} from '../src/renderer/src/utils/orchJobReuse'

function node(
  id: string,
  state: OrchestratorNodeState['state'],
  extra: Partial<OrchestratorNodeState> = {}
): OrchestratorNodeState {
  return {
    id,
    agentId: 'planner',
    instruction: `do ${id}`,
    dependsOn: [],
    state,
    attempts: 0,
    ...extra
  }
}

function job(
  state: OrchestratorJob['state'],
  nodes: OrchestratorNodeState[],
  extra: Partial<OrchestratorJob> = {}
): OrchestratorJob {
  return {
    jobId: 'job-x',
    title: 't',
    goal: 'g',
    state,
    createdAt: 1,
    nodes,
    ...extra
  }
}

describe('orchestratorJobToDraft', () => {
  it('goal / title 原样保留，节点静态定义字段完整回流', () => {
    const source = job('done', [node('n1', 'done', { dependsOn: [] })], {
      goal: '做一部短片',
      title: '我的短片'
    })
    const draft = orchestratorJobToDraft(source, 12)
    expect(draft.goal).toBe('做一部短片')
    expect(draft.jobTitle).toBe('我的短片')
    expect(draft.nodes).toEqual([
      { id: 'n1', agentId: 'planner', instruction: 'do n1', dependsOn: [] }
    ])
  })

  it('运行态字段（attempts/finalText/outputFiles/error/时间戳）不回流', () => {
    const source = job('done', [
      node('n1', 'done', {
        attempts: 2,
        finalText: '产出文本',
        outputFiles: ['Cache/a.webp'],
        startedAt: 1,
        finishedAt: 2
      }),
      node('n2', 'skipped', { error: 'x', attempts: 1 })
    ])
    const draft = orchestratorJobToDraft(source, 12)
    for (const n of draft.nodes) {
      expect(Object.keys(n).sort()).toEqual(
        ['agentId', 'dependsOn', 'id', 'instruction'].sort()
      )
    }
    expect(draft.nodes[0]!.instruction).toBe('do n1')
  })

  it('dependsOn 独立浅拷贝，不共享 job 内部数组', () => {
    const deps = ['n2', 'n3']
    const source = job('failed', [
      node('n1', 'done', { dependsOn: deps }),
      node('n2', 'done'),
      node('n3', 'skipped')
    ])
    const draft = orchestratorJobToDraft(source, 12)
    expect(draft.nodes[0]!.dependsOn).toEqual(['n2', 'n3'])
    draft.nodes[0]!.dependsOn.push('n9')
    expect(deps).toEqual(['n2', 'n3'])
  })

  it('超过 maxNodes 时截断保留头部', () => {
    const source = job('done', Array.from({ length: 5 }, (_, i) => node(`n${i + 1}`, 'done')))
    const draft = orchestratorJobToDraft(source, 3)
    expect(draft.nodes.map((n) => n.id)).toEqual(['n1', 'n2', 'n3'])
  })

  it('maxNodes 为 0 时返回空节点集（仍保留 goal/title）', () => {
    const source = job('done', [node('n1', 'done')])
    const draft = orchestratorJobToDraft(source, 0)
    expect(draft.nodes).toEqual([])
    expect(draft.goal).toBe('g')
  })

  it('running 中记录同样可转换（定义快照与运行态无关）', () => {
    const source = job('running', [node('n1', 'running', { startedAt: 1 })])
    const draft = orchestratorJobToDraft(source, 12)
    expect(draft.nodes[0]!.instruction).toBe('do n1')
    expect('startedAt' in draft.nodes[0]!).toBe(false)
  })
})

describe('orchestratorJobToRunInput', () => {
  it('goal / title / 节点静态定义原样转为 runOrchestrator 入参', () => {
    const source = job('done', [
      node('n1', 'done', { dependsOn: [] }),
      node('n2', 'done', { dependsOn: ['n1'] })
    ], {
      goal: '做一部短片',
      title: '我的短片'
    })
    const input = orchestratorJobToRunInput(source)
    expect(input).toEqual({
      goal: '做一部短片',
      title: '我的短片',
      nodes: [
        { id: 'n1', agentId: 'planner', instruction: 'do n1', dependsOn: [] },
        { id: 'n2', agentId: 'planner', instruction: 'do n2', dependsOn: ['n1'] }
      ]
    })
  })

  it('运行态字段不回流，节点全部保留（不截断）', () => {
    const source = job('done', [
      node('n1', 'done', {
        attempts: 2,
        finalText: '产出文本',
        outputFiles: ['Cache/a.webp'],
        startedAt: 1,
        finishedAt: 2
      }),
      node('n2', 'skipped', { error: 'x', attempts: 1 })
    ])
    const input = orchestratorJobToRunInput(source)
    expect(input.nodes).toHaveLength(2)
    for (const n of input.nodes) {
      expect(Object.keys(n).sort()).toEqual(
        ['agentId', 'dependsOn', 'id', 'instruction'].sort()
      )
    }
    expect(input.nodes[0]!.instruction).toBe('do n1')
  })

  it('title 缺省时省略该字段（与表单回填的 jobTitle 语义区分）', () => {
    const source = job('done', [node('n1', 'done')], { title: '' })
    const input = orchestratorJobToRunInput(source)
    expect(input.title).toBeUndefined()
  })
})
