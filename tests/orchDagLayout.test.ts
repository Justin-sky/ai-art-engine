import { describe, expect, it } from 'vitest'
import {
  DAG_CHIP_H,
  DAG_CHIP_W,
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

function edgeTo(
  layout: ReturnType<typeof layoutDag>,
  from: string,
  to: string
): { fromX: number; fromY: number; toX: number; toY: number } | undefined {
  return layout.edges.find((e) => e.from === from && e.to === to)
}
