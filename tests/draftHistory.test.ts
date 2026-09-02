import { describe, expect, it } from 'vitest'
import {
  DRAFT_HISTORY_LIMIT,
  createDraftHistory,
  draftRedo,
  draftUndo,
  equalsDraftSnapshot,
  pushDraftHistory,
  type DraftNode,
  type DraftSnapshot
} from '../src/renderer/src/utils/draftHistory'

function node(id: string, dependsOn: string[] = [], agentId = 'planner'): DraftNode {
  return { id, agentId, instruction: `do ${id}`, dependsOn }
}

function snap(goal: string, nodes: DraftNode[], jobTitle = ''): DraftSnapshot {
  return { goal, jobTitle, nodes }
}

describe('equalsDraftSnapshot', () => {
  it('相同内容返回 true', () => {
    const a = snap('目标', [node('n1', ['n2'])])
    const b = snap('目标', [node('n1', ['n2'])])
    expect(equalsDraftSnapshot(a, b)).toBe(true)
  })

  it('goal / jobTitle / 节点字段 / 依赖顺序任一不同返回 false', () => {
    const base = snap('目标', [node('n1', ['n2'])], '任务')
    expect(equalsDraftSnapshot(base, snap('别的', [node('n1', ['n2'])], '任务'))).toBe(false)
    expect(equalsDraftSnapshot(base, snap('目标', [node('n1', ['n2'])], '另'))).toBe(false)
    expect(equalsDraftSnapshot(base, snap('目标', [node('n1', ['n3'])], '任务'))).toBe(false)
    expect(equalsDraftSnapshot(base, snap('目标', [node('n1', ['n2', 'n3'])], '任务'))).toBe(false)
    expect(equalsDraftSnapshot(base, snap('目标', [node('n1')], '任务'))).toBe(false)
    expect(equalsDraftSnapshot(base, snap('目标', []), '任务')).toBe(false)
  })
})

describe('pushDraftHistory', () => {
  it('把当前快照压入 past 并清空 future', () => {
    const h = createDraftHistory()
    const s0 = snap('目标', [])
    const s1 = snap('目标', [node('n1')])
    const a = pushDraftHistory(h, s0)
    const b = pushDraftHistory(a, s1)
    expect(b.past).toEqual([s0, s1])
    expect(b.future).toEqual([])
  })

  it('与栈顶相同时不重复入栈', () => {
    const s0 = snap('目标', [node('n1')])
    const h = pushDraftHistory(pushDraftHistory(createDraftHistory(), s0), s0)
    expect(h.past).toEqual([s0])
  })

  it('超过容量时丢弃最旧快照', () => {
    let h = createDraftHistory()
    for (let i = 0; i < DRAFT_HISTORY_LIMIT + 5; i += 1) {
      h = pushDraftHistory(h, snap(`目标${i}`, []))
    }
    expect(h.past).toHaveLength(DRAFT_HISTORY_LIMIT)
    expect(h.past[0].goal).toBe('目标5')
    expect(h.past[h.past.length - 1].goal).toBe(`目标${DRAFT_HISTORY_LIMIT + 4}`)
  })
})

describe('draftUndo / draftRedo', () => {
  it('无历史时返回 null', () => {
    const h = createDraftHistory()
    expect(draftUndo(h, snap('当前', []))).toBeNull()
    expect(draftRedo(h, snap('当前', []))).toBeNull()
  })

  it('撤销恢复到 past 栈顶，当前状态转入 future', () => {
    const s0 = snap('目标', [])
    const s1 = snap('目标', [node('n1')])
    const h = pushDraftHistory(pushDraftHistory(createDraftHistory(), s0), s1)
    const res = draftUndo(h, snap('目标', [node('n1'), node('n2')]))
    expect(res).not.toBeNull()
    expect(res!.snapshot).toEqual(s1)
    expect(res!.history.past).toEqual([s0])
    expect(res!.history.future).toHaveLength(1)
  })

  it('撤销后重做回到刚撤销的状态，且可连续往返', () => {
    const s0 = snap('目标', [])
    const s1 = snap('目标', [node('n1')])
    const s2 = snap('目标', [node('n1'), node('n2')])
    const h = pushDraftHistory(pushDraftHistory(createDraftHistory(), s0), s1)

    const u1 = draftUndo(h, s2)!
    expect(u1.snapshot).toEqual(s1)
    const u2 = draftUndo(u1.history, s1)!
    expect(u2.snapshot).toEqual(s0)
    expect(u2.history.past).toEqual([])

    const r1 = draftRedo(u2.history, s0)!
    expect(r1.snapshot).toEqual(s1)
    const r2 = draftRedo(r1.history, s1)!
    expect(r2.snapshot).toEqual(s2)
    expect(r2.history.future).toEqual([])
    expect(r2.history.past).toHaveLength(2)
  })

  it('撤销到最早后再次入栈会清空 future（新分支）', () => {
    const s0 = snap('目标', [])
    const s1 = snap('目标', [node('n1')])
    const s2 = snap('目标', [node('n1'), node('n2')])
    const h = pushDraftHistory(pushDraftHistory(createDraftHistory(), s0), s1)
    const u1 = draftUndo(h, s2)!
    expect(u1.history.future).toHaveLength(1)

    const s3 = snap('目标', [node('n3')])
    const branched = pushDraftHistory(u1.history, u1.snapshot)
    expect(branched.future).toEqual([])
    expect(branched.past).toHaveLength(2)

    const afterUndo = draftUndo(branched, s3)!
    expect(afterUndo.snapshot).toEqual(s1)
    // 新分支撤销不应再回到旧的 s2
    const afterRedo = draftRedo(afterUndo.history, s1)!
    expect(afterRedo.snapshot).toEqual(s3)
    expect(afterRedo.history.future).toEqual([])
  })

  it('撤销会保护快照不被后续修改（纯值语义）', () => {
    const s0 = snap('目标', [node('n1')])
    const h = pushDraftHistory(createDraftHistory(), s0)
    const cur = snap('目标', [node('n1')])
    // 修改 current 不影响已入栈的 s0
    cur.nodes[0].dependsOn.push('n9')
    expect(h.past[0].nodes[0].dependsOn).toEqual([])
  })
})
