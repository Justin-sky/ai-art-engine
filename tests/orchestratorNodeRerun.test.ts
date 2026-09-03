import { describe, expect, it } from 'vitest'
import {
  canRerunOrchestratorNode,
  resetNodesForNodeRerun
} from '../src/shared/orchestratorNodeRerun'
import type { OrchestratorJob, OrchestratorNodeState } from '../src/shared/ipc'

function node(
  id: string,
  state: OrchestratorNodeState['state'],
  deps: string[] = [],
  extra: Partial<OrchestratorNodeState> = {}
): OrchestratorNodeState {
  return {
    id,
    agentId: 'planner',
    instruction: `do ${id}`,
    dependsOn: deps,
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

describe('canRerunOrchestratorNode', () => {
  it('failed job：上游已完成的 failed 节点可单跑', () => {
    const n1 = node('n1', 'done', [], { finalText: 'x', attempts: 1 })
    const n2 = node('n2', 'failed', ['n1'], { error: 'boom', attempts: 2 })
    expect(canRerunOrchestratorNode(job('failed', [n1, n2]), 'n2')).toBe(true)
  })

  it('aborted job：上游已完成的 skipped 节点（排队中被中止）可单跑', () => {
    const n1 = node('n1', 'done', [], { finalText: 'x' })
    const n2 = node('n2', 'skipped', ['n1'])
    expect(canRerunOrchestratorNode(job('aborted', [n1, n2]), 'n2')).toBe(true)
  })

  it('running / done job 不可单跑', () => {
    expect(canRerunOrchestratorNode(job('running', []), 'n1')).toBe(false)
    const done = node('n1', 'done', [], { finalText: 'x' })
    expect(canRerunOrchestratorNode(job('done', [done]), 'n1')).toBe(false)
  })

  it('done 节点不可单跑（重做整单请用「再来一轮」）', () => {
    const n1 = node('n1', 'done', [], { finalText: 'x' })
    const n2 = node('n2', 'failed', ['n1'])
    expect(canRerunOrchestratorNode(job('failed', [n1, n2]), 'n1')).toBe(false)
  })

  it('依赖未完成的 skipped 节点不可单跑（应先处理上游失败节点）', () => {
    const n1 = node('n1', 'failed', [], { error: 'boom' })
    const n2 = node('n2', 'skipped', ['n1'])
    expect(canRerunOrchestratorNode(job('failed', [n1, n2]), 'n2')).toBe(false)
  })

  it('不存在的节点不可单跑', () => {
    const n1 = node('n1', 'done', [], { finalText: 'x' })
    const n2 = node('n2', 'failed', ['n1'])
    expect(canRerunOrchestratorNode(job('failed', [n1, n2]), 'n9')).toBe(false)
  })
})

describe('resetNodesForNodeRerun', () => {
  it('不可单跑时返回 null', () => {
    const n1 = node('n1', 'done', [], { finalText: 'x' })
    const n2 = node('n2', 'failed', ['n1'])
    expect(resetNodesForNodeRerun(job('done', [n1, n2]), 'n2')).toBeNull()
    expect(resetNodesForNodeRerun(job('failed', [n1, n2]), 'n1')).toBeNull()
  })

  it('failed 目标：仅重置目标与其被阻塞的下游，done 上游与并行分支保留产出', () => {
    // n1(done) → n2(failed) → n3(skipped)；并行 n4(done) 与 n2 无依赖
    const n1 = node('n1', 'done', [], { finalText: 'base', attempts: 1 })
    const n2 = node('n2', 'failed', ['n1'], {
      error: 'boom',
      attempts: 2,
      startedAt: 5,
      finishedAt: 9
    })
    const n3 = node('n3', 'skipped', ['n2'], { finishedAt: 9 })
    const n4 = node('n4', 'done', [], { finalText: 'par', outputFiles: ['b.webp'], attempts: 1 })
    const res = resetNodesForNodeRerun(job('failed', [n1, n2, n3, n4]), 'n2')!

    expect(res).not.toBeNull()
    expect(res.rerunCount).toBe(2)
    expect(res.nodes[0]).toEqual(n1) // 上游 done 保留（含 finalText 等运行痕迹）
    expect(res.nodes[1]).toEqual({
      id: 'n2',
      agentId: 'planner',
      instruction: 'do n2',
      dependsOn: ['n1'],
      state: 'pending',
      attempts: 0
    })
    expect('error' in res.nodes[1]).toBe(false)
    expect('startedAt' in res.nodes[1]).toBe(false)
    expect('finishedAt' in res.nodes[1]).toBe(false)
    expect(res.nodes[2]).toEqual({
      id: 'n3',
      agentId: 'planner',
      instruction: 'do n3',
      dependsOn: ['n2'],
      state: 'pending',
      attempts: 0
    })
    expect('finishedAt' in res.nodes[2]).toBe(false)
    expect(res.nodes[3]).toEqual(n4) // 并行 done 分支不受影响
  })

  it('多级下游 BFS：传递依赖目标的 skipped 节点全部联动重置', () => {
    const n1 = node('n1', 'done', [], { finalText: 'x' })
    const n2 = node('n2', 'failed', ['n1'], { error: 'boom', attempts: 2 })
    const n3 = node('n3', 'skipped', ['n2'])
    const n4 = node('n4', 'skipped', ['n3'])
    const res = resetNodesForNodeRerun(job('failed', [n1, n2, n3, n4]), 'n2')!
    expect(res.rerunCount).toBe(3)
    expect(res.nodes.map((n) => n.state)).toEqual(['done', 'pending', 'pending', 'pending'])
  })

  it('aborted 目标：排队中被中止的 skipped 节点重置为 pending 并联动其下游', () => {
    const n1 = node('n1', 'done', [], { finalText: 'x' })
    const n2 = node('n2', 'skipped', ['n1'])
    const n3 = node('n3', 'skipped', ['n2'])
    const res = resetNodesForNodeRerun(job('aborted', [n1, n2, n3]), 'n2')!
    expect(res.rerunCount).toBe(2)
    expect(res.nodes[1].state).toBe('pending')
    expect(res.nodes[1].attempts).toBe(0)
    expect(res.nodes[2].state).toBe('pending')
    expect(res.nodes[0].state).toBe('done')
  })

  it('重置不修改原 job（纯函数语义）', () => {
    const n1 = node('n1', 'done', [], { finalText: 'x' })
    const n2 = node('n2', 'failed', ['n1'], { error: 'boom', attempts: 2 })
    const n3 = node('n3', 'skipped', ['n2'])
    const source = job('failed', [n1, n2, n3])
    resetNodesForNodeRerun(source, 'n2')
    expect(source.nodes[1].state).toBe('failed')
    expect(source.nodes[1].attempts).toBe(2)
    expect(source.nodes[2].state).toBe('skipped')
  })
})
