import { describe, expect, it } from 'vitest'
import {
  DAG_CHIP_H,
  DAG_CHIP_W,
  canAddDependency,
  layoutDag,
  type DagNodeLike
} from '../src/renderer/src/utils/orchDagLayout'

describe('layoutDag', () => {
  it('空节点返回空布局', () => {
    const layout = layoutDag([])
    expect(layout.edges).toHaveLength(0)
    expect(layout.canvasWidth).toBeGreaterThan(0)
    expect(layout.canvasHeight).toBeGreaterThan(0)
    expect(layout.columnCount).toBe(0)
    expect(layout.rowCount).toBe(0)
  })

  it('单节点：0 列、无连线', () => {
    const nodes: DagNodeLike[] = [{ id: 'n1', dependsOn: [] }]
    const layout = layoutDag(nodes)
    expect(layout.columnBy.get('n1')).toBe(0)
    expect(layout.edges).toHaveLength(0)
    expect(layout.posBy.get('n1')).toEqual({ x: expect.any(Number), y: expect.any(Number) })
  })

  it('线性链 n1→n2→n3 分层为 0/1/2 列，两条连线都指向右侧', () => {
    const nodes: DagNodeLike[] = [
      { id: 'n1', dependsOn: [] },
      { id: 'n2', dependsOn: ['n1'] },
      { id: 'n3', dependsOn: ['n2'] }
    ]
    const layout = layoutDag(nodes)
    expect(layout.columnBy.get('n1')).toBe(0)
    expect(layout.columnBy.get('n2')).toBe(1)
    expect(layout.columnBy.get('n3')).toBe(2)
    expect(layout.columnCount).toBe(3)
    expect(layout.edges).toHaveLength(2)
    for (const edge of layout.edges) {
      expect(edge.toX).toBeGreaterThan(edge.fromX)
    }
    expect(layout.posBy.get('n3')!.x).toBeGreaterThan(layout.posBy.get('n1')!.x)
  })

  it('菱形 n1→n2/n3→n4：n2 与 n3 同列不同行，n4 在最右', () => {
    const nodes: DagNodeLike[] = [
      { id: 'n1', dependsOn: [] },
      { id: 'n2', dependsOn: ['n1'] },
      { id: 'n3', dependsOn: ['n1'] },
      { id: 'n4', dependsOn: ['n2', 'n3'] }
    ]
    const layout = layoutDag(nodes)
    expect(layout.columnBy.get('n2')).toBe(1)
    expect(layout.columnBy.get('n3')).toBe(1)
    expect(layout.columnBy.get('n4')).toBe(2)
    expect(layout.edges).toHaveLength(4)
    const p1 = layout.posBy.get('n1')!
    const p2 = layout.posBy.get('n2')!
    const p3 = layout.posBy.get('n3')!
    expect(p2.x).toBe(p3.x)
    expect(p2.y).not.toBe(p3.y)
    const p4 = layout.posBy.get('n4')!
    expect(p4.x).toBeGreaterThan(p2.x)
    // 连线端点对齐在卡片边缘（from = 右侧中心，to = 左侧中心）
    const e = edgeTo(layout, 'n1', 'n2')!
    expect(e.fromX).toBe(p1.x + DAG_CHIP_W)
    expect(e.fromY).toBe(p1.y + DAG_CHIP_H / 2)
    expect(e.toX).toBe(p2.x)
    expect(e.toY).toBe(p2.y + DAG_CHIP_H / 2)
  })

  it('重边去重：dependsOn 重复声明同一依赖只产生一条连线', () => {
    const nodes: DagNodeLike[] = [
      { id: 'n1', dependsOn: [] },
      { id: 'n2', dependsOn: ['n1', 'n1'] }
    ]
    const layout = layoutDag(nodes)
    expect(layout.edges).toHaveLength(1)
  })

  it('依赖后置声明也能按固定点迭代收敛出正确层号', () => {
    const nodes: DagNodeLike[] = [
      { id: 'n1', dependsOn: ['n2'] },
      { id: 'n2', dependsOn: [] }
    ]
    const layout = layoutDag(nodes)
    expect(layout.columnBy.get('n2')).toBe(0)
    expect(layout.columnBy.get('n1')).toBe(1)
    expect(layout.edges).toHaveLength(1)
  })

  it('同一列的节点不重叠，且坐标落在画布内', () => {
    const nodes: DagNodeLike[] = Array.from({ length: 6 }, (_, i) => ({
      id: `n${i + 1}`,
      dependsOn: []
    }))
    const layout = layoutDag(nodes)
    const ys = nodes.map((n) => layout.posBy.get(n.id)!.y)
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1] + DAG_CHIP_H)
    }
    for (const [id, pos] of layout.posBy) {
      expect(pos.x).toBeGreaterThanOrEqual(0)
      expect(pos.y).toBeGreaterThanOrEqual(0)
      expect(pos.x + DAG_CHIP_W).toBeLessThanOrEqual(layout.canvasWidth)
      expect(pos.y + DAG_CHIP_H).toBeLessThanOrEqual(layout.canvasHeight)
      expect(id).toBeTruthy()
    }
  })
})

describe('canAddDependency', () => {
  // n1 与 n2 互不依赖（并行），n3 依赖 n1
  const base: DagNodeLike[] = [
    { id: 'n1', dependsOn: [] },
    { id: 'n2', dependsOn: [] },
    { id: 'n3', dependsOn: ['n1'] }
  ]

  it('合法新增：无依赖关系的两节点可建边', () => {
    // 让 n3 额外依赖 n2（n3 此前不依赖 n2）
    expect(canAddDependency(base, 'n2', 'n3')).toEqual({ ok: true })
    // 让 n2 依赖 n1（此前 n2 无依赖）
    expect(canAddDependency(base, 'n1', 'n2')).toEqual({ ok: true })
  })

  it('拒绝依赖自身', () => {
    expect(canAddDependency(base, 'n2', 'n2')).toEqual({ ok: false, reason: 'self' })
  })

  it('拒绝未声明节点（悬空引用）', () => {
    expect(canAddDependency(base, 'ghost', 'n2')).toEqual({ ok: false, reason: 'missing' })
    expect(canAddDependency(base, 'n2', 'ghost')).toEqual({ ok: false, reason: 'missing' })
  })

  it('拒绝重复边：目标节点已依赖来源节点', () => {
    expect(canAddDependency(base, 'n1', 'n3')).toEqual({ ok: false, reason: 'duplicate' })
  })

  it('拒绝直接成环：给已互相依赖的双方反向补边', () => {
    // n2 依赖 n1，再让 n1 依赖 n2 → 环 n1↔n2
    const pair: DagNodeLike[] = [
      { id: 'n1', dependsOn: [] },
      { id: 'n2', dependsOn: ['n1'] }
    ]
    expect(canAddDependency(pair, 'n2', 'n1')).toEqual({ ok: false, reason: 'cycle' })
  })

  it('拒绝传递成环：链上回溯补边', () => {
    // n1→n2→n3（n3 依赖 n2、n2 依赖 n1）；让 n1 依赖 n3 → n1→n3→n2→n1 成环
    const chain: DagNodeLike[] = [
      { id: 'n1', dependsOn: [] },
      { id: 'n2', dependsOn: ['n1'] },
      { id: 'n3', dependsOn: ['n2'] }
    ]
    expect(canAddDependency(chain, 'n3', 'n1')).toEqual({ ok: false, reason: 'cycle' })
  })

  it('深层环也能检出（跨多级回路的反向边）', () => {
    // a→b→c→d；让 a 依赖 d → a→d→c→b→a 成环
    const deep: DagNodeLike[] = [
      { id: 'a', dependsOn: [] },
      { id: 'b', dependsOn: ['a'] },
      { id: 'c', dependsOn: ['b'] },
      { id: 'd', dependsOn: ['c'] }
    ]
    expect(canAddDependency(deep, 'd', 'a')).toEqual({ ok: false, reason: 'cycle' })
    // 对照：新增「中间节点到更下游」的直接依赖是合法的（不产生环）
    expect(canAddDependency(deep, 'b', 'd')).toEqual({ ok: true })
    // c 已直接依赖 b → 重复边
    expect(canAddDependency(deep, 'b', 'c')).toEqual({ ok: false, reason: 'duplicate' })
  })
})

function edgeTo(
  layout: ReturnType<typeof layoutDag>,
  from: string,
  to: string
): { fromX: number; fromY: number; toX: number; toY: number } | undefined {
  return layout.edges.find((e) => e.from === from && e.to === to)
}
