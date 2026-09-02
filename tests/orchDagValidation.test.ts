import { describe, expect, it } from 'vitest'
import {
  annotateDagNodes,
  sanitizeDagDependencies,
  validateDagNodes,
  type DagCheckNode
} from '../src/renderer/src/utils/orchDagLayout'

/** 便捷构造：id + agentId 可缺省，dependsOn 可缺省 */
function node(id: string, dependsOn: string[] = [], agentId?: string): DagCheckNode {
  return { id, agentId: agentId ?? `a-${id}`, dependsOn }
}

describe('validateDagNodes', () => {
  it('合法节点集：ok=true 且无错误', () => {
    const nodes = [node('n1'), node('n2', ['n1']), node('n3', ['n1', 'n2'])]
    const check = validateDagNodes(nodes)
    expect(check.ok).toBe(true)
    expect(check.errors).toHaveLength(0)
    expect(check.invalidDeps).toHaveLength(0)
  })

  it('id 非法字符 / 超长 / 空 → bad-id', () => {
    expect(validateDagNodes([node('bad id')]).errors[0]).toEqual({ id: 'bad id', kind: 'bad-id' })
    expect(validateDagNodes([node('')]).errors[0]?.kind).toBe('bad-id')
    expect(validateDagNodes([node('n'.repeat(33))]).errors[0]?.kind).toBe('bad-id')
    // 合法 id 不应误报
    expect(validateDagNodes([node('a1.b-c_d')]).ok).toBe(true)
  })

  it('重复 id → dup-id（仅第二次出现报错）', () => {
    const check = validateDagNodes([node('n1'), node('n2', ['n1']), node('n1')])
    expect(check.ok).toBe(false)
    expect(check.errors).toHaveLength(1)
    expect(check.errors[0]).toEqual({ id: 'n1', kind: 'dup-id' })
  })

  it('显式空 agentId → empty-agent；未提供 agentId 不误报', () => {
    expect(validateDagNodes([{ id: 'n1', agentId: '', dependsOn: [] }]).errors[0]).toEqual({
      id: 'n1',
      kind: 'empty-agent'
    })
    // 不提供 agentId 的纯拓扑节点不应报 empty-agent
    expect(validateDagNodes([{ id: 'n1', dependsOn: [] }]).ok).toBe(true)
  })

  it('依赖自身 → self-dep', () => {
    const check = validateDagNodes([node('n1', ['n1'])])
    expect(check.errors[0]).toEqual({ id: 'n1', kind: 'self-dep' })
    expect(check.invalidDeps).toContainEqual({ id: 'n1', dep: 'n1' })
  })

  it('依赖未定义节点 → missing-dep', () => {
    const check = validateDagNodes([node('n1'), node('n2', ['n1', 'ghost'])])
    expect(check.errors[0]).toEqual({ id: 'n2', kind: 'missing-dep', dep: 'ghost' })
    expect(check.invalidDeps).toContainEqual({ id: 'n2', dep: 'ghost' })
  })

  it('直线链不算环；回环 n1→n2→n3→n1 → cycle 且给出破环候选边', () => {
    const line = [node('n1'), node('n2', ['n1']), node('n3', ['n2'])]
    expect(validateDagNodes(line).ok).toBe(true)

    const cycle = [node('n1', ['n3']), node('n2', ['n1']), node('n3', ['n2'])]
    const check = validateDagNodes(cycle)
    expect(check.ok).toBe(false)
    expect(check.errors.some((e) => e.kind === 'cycle')).toBe(true)
    // 每条环边单独删除都能破环 → 三条边都应进 invalidDeps
    expect(check.invalidDeps).toHaveLength(3)
    // 仅移除候选边本身（不动节点），整图应随之无环
    for (const e of check.invalidDeps) {
      const without = cycle.map((n) => ({
        ...n,
        dependsOn:
          n.id === e.id ? (n.dependsOn ?? []).filter((d) => d !== e.dep) : [...(n.dependsOn ?? [])]
      }))
      expect(validateDagNodes(without).ok).toBe(true)
    }
  })
})

describe('sanitizeDagDependencies', () => {
  it('剔除 self / missing / 破环边，清洗后节点集可提交', () => {
    // n1→n1（self）、n2→ghost（missing）、n3→n4→n3（环）
    const nodes: DagCheckNode[] = [
      node('n1', ['n1']),
      node('n2', ['n1', 'ghost']),
      node('n3', ['n4']),
      node('n4', ['n3'])
    ]
    const removed = sanitizeDagDependencies(nodes)
    expect(removed).toBe(4)
    expect(validateDagNodes(nodes).ok).toBe(true)
    expect(nodes[0]!.dependsOn).toEqual([])
    expect(nodes[1]!.dependsOn).toEqual(['n1'])
    expect(nodes[2]!.dependsOn).toEqual([])
    expect(nodes[3]!.dependsOn).toEqual([])
  })

  it('已合法 → 返回 0 且不改动', () => {
    const nodes = [node('n1'), node('n2', ['n1'])]
    expect(sanitizeDagDependencies(nodes)).toBe(0)
    expect(nodes[1]!.dependsOn).toEqual(['n1'])
  })

  it('多环嵌套仍可逐步破环到无环', () => {
    // n1→n2→n1 与 n2→n3→n2 两个环交叠
    const nodes: DagCheckNode[] = [node('n1', ['n2']), node('n2', ['n1', 'n3']), node('n3', ['n2'])]
    sanitizeDagDependencies(nodes)
    expect(validateDagNodes(nodes).ok).toBe(true)
  })
})

describe('annotateDagNodes', () => {
  it('合法节点集：hasIssues=false，各节点无标注', () => {
    const nodes = [node('n1'), node('n2', ['n1']), node('n3', ['n1', 'n2'])]
    const ann = annotateDagNodes(nodes)
    expect(ann.hasIssues).toBe(false)
    expect(ann.errorCount).toBe(0)
    expect(ann.badDepCount).toBe(0)
    expect(ann.invalidEdgeKeys.size).toBe(0)
    expect(ann.byIndex.every((a) => a.errors.length === 0 && a.badDeps.length === 0)).toBe(true)
  })

  it('节点级错误按下标归集：bad-id / dup-id / empty-agent / self-dep', () => {
    const nodes: DagCheckNode[] = [
      { id: 'n1', agentId: 'a', dependsOn: ['n1'] }, // idx0：self-dep
      { id: 'n1', agentId: '', dependsOn: [] }, // idx1：dup-id + empty-agent
      { id: 'bad id', agentId: 'a', dependsOn: [] }, // idx2：bad-id
      { id: 'n2', agentId: 'a', dependsOn: [] } // idx3：干净
    ]
    const ann = annotateDagNodes(nodes)
    expect(ann.errorCount).toBe(4)
    expect(ann.byIndex[0]!.errors.map((e) => e.kind)).toEqual(['self-dep'])
    expect(ann.byIndex[1]!.errors.map((e) => e.kind)).toEqual(['dup-id', 'empty-agent'])
    expect(ann.byIndex[2]!.errors.map((e) => e.kind)).toEqual(['bad-id'])
    expect(ann.byIndex[3]!.errors).toHaveLength(0)
  })

  it('未显式提供 agentId 的节点不误报 empty-agent', () => {
    const ann = annotateDagNodes([{ id: 'n1', dependsOn: [] }])
    expect(ann.hasIssues).toBe(false)
  })

  it('missing 依赖归到发出它的节点，并进入 invalidEdgeKeys；self 边不产生连线键', () => {
    const ann = annotateDagNodes([node('n1', ['ghost']), node('n2', ['n1'])])
    expect(ann.byIndex[0]!.badDeps).toEqual([{ dep: 'ghost', kind: 'missing' }])
    expect(ann.byIndex[1]!.badDeps).toHaveLength(0)
    expect(ann.invalidEdgeKeys).toEqual(new Set(['n1\u0000ghost']))
    expect(ann.badDepCount).toBe(1)
  })

  it('环上每个节点都拿到自己的破环候选边（n3→n4→n5→n3）', () => {
    const ann = annotateDagNodes([node('n3', ['n4']), node('n4', ['n5']), node('n5', ['n3'])])
    expect(ann.badDepCount).toBe(3)
    expect(ann.byIndex[0]!.badDeps).toEqual([{ dep: 'n4', kind: 'cycle' }])
    expect(ann.byIndex[1]!.badDeps).toEqual([{ dep: 'n5', kind: 'cycle' }])
    expect(ann.byIndex[2]!.badDeps).toEqual([{ dep: 'n3', kind: 'cycle' }])
    expect(ann.invalidEdgeKeys).toEqual(new Set(['n3\u0000n4', 'n4\u0000n5', 'n5\u0000n3']))
    // 逐条剔除任一边后节点集应无环（与 validate 破环候选口径一致）
    for (const e of ['n3\u0000n4', 'n4\u0000n5', 'n5\u0000n3']) {
      const [id, dep] = e.split('\u0000')
      const stripped = [node('n3', ['n4']), node('n4', ['n5']), node('n5', ['n3'])].map((n) =>
        n.id === id ? { ...n, dependsOn: n.dependsOn.filter((d) => d !== dep) } : n
      )
      expect(validateDagNodes(stripped).ok).toBe(true)
    }
  })

  it('重复 id 与重复依赖不重复计数（边去重）', () => {
    const ann = annotateDagNodes([
      { id: 'n1', agentId: 'a', dependsOn: ['n1', 'ghost', 'ghost'] },
      { id: 'n1', agentId: 'a', dependsOn: [] }
    ])
    expect(ann.byIndex[0]!.errors.map((e) => e.kind)).toEqual(['self-dep'])
    expect(ann.byIndex[1]!.errors.map((e) => e.kind)).toEqual(['dup-id'])
    expect(ann.byIndex[0]!.badDeps).toEqual([{ dep: 'ghost', kind: 'missing' }])
    expect(ann.badDepCount).toBe(1)
  })
})
