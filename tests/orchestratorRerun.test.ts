import { describe, expect, it } from 'vitest'
import {
  canRerunOrchestratorJob,
  resetNodesForRerun
} from '../src/shared/orchestratorRerun'
import type { OrchestratorJob, OrchestratorNodeState } from '../src/shared/ipc'

function node(
  id: string,
  state: OrchestratorNodeState['state'],
  extra: Partial<OrchestratorNodeState> = {}
): OrchestratorNodeState {
  return { id, agentId: 'planner', instruction: `do ${id}`, dependsOn: [], state, attempts: 0, ...extra }
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

describe('canRerunOrchestratorJob', () => {
  it('failed / aborted 可续跑', () => {
    expect(canRerunOrchestratorJob(job('failed', []))).toBe(true)
    expect(canRerunOrchestratorJob(job('aborted', []))).toBe(true)
  })

  it('running / done 不可续跑', () => {
    expect(canRerunOrchestratorJob(job('running', []))).toBe(false)
    expect(canRerunOrchestratorJob(job('done', []))).toBe(false)
  })
})

describe('resetNodesForRerun', () => {
  it('不可续跑时返回 null', () => {
    expect(resetNodesForRerun(job('running', []))).toBeNull()
    expect(resetNodesForRerun(job('done', []))).toBeNull()
  })

  it('failed job：done 保留产出，failed/skipped 重置为 pending 并清空运行痕迹', () => {
    const done = node('n1', 'done', {
      attempts: 1,
      finalText: 'done text',
      outputFiles: ['a.webp'],
      finishedAt: 10
    })
    const failed = node('n2', 'failed', {
      attempts: 2,
      error: 'boom',
      startedAt: 5,
      finishedAt: 9
    })
    const skipped = node('n3', 'skipped', { finishedAt: 9 })
    const nodes = resetNodesForRerun(job('failed', [done, failed, skipped]))!
    expect(nodes).not.toBeNull()

    expect(nodes[0]).toEqual(done) // done 节点对象原样保留

    expect(nodes[1]).toEqual({
      id: 'n2',
      agentId: 'planner',
      instruction: 'do n2',
      dependsOn: [],
      state: 'pending',
      attempts: 0
    })
    expect('error' in nodes[1]).toBe(false)
    expect('startedAt' in nodes[1]).toBe(false)
    expect('finishedAt' in nodes[1]).toBe(false)

    expect(nodes[2]).toEqual({
      id: 'n3',
      agentId: 'planner',
      instruction: 'do n3',
      dependsOn: [],
      state: 'pending',
      attempts: 0
    })
    expect('finishedAt' in nodes[2]).toBe(false)
  })

  it('aborted job：全部未完成节点重置（无 failed 也可续跑）', () => {
    const done = node('n1', 'done', { finalText: 'x', attempts: 1 })
    const skipped = node('n2', 'skipped')
    const nodes = resetNodesForRerun(job('aborted', [done, skipped]))!
    expect(nodes[0]).toEqual(done)
    expect(nodes[1].state).toBe('pending')
    expect(nodes[1].attempts).toBe(0)
  })

  it('defensive：终态中残留的 running 节点也重置为 pending', () => {
    const running = node('n1', 'running', { startedAt: 3 })
    const nodes = resetNodesForRerun(job('aborted', [running]))!
    expect(nodes[0].state).toBe('pending')
    expect('startedAt' in nodes[0]).toBe(false)
  })

  it('重置不修改原 job（纯函数语义）', () => {
    const failed = node('n2', 'failed', { error: 'boom', attempts: 2 })
    const source = job('failed', [failed])
    resetNodesForRerun(source)
    expect(source.nodes[0].state).toBe('failed')
    expect(source.nodes[0].attempts).toBe(2)
  })
})
