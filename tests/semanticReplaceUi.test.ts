import { describe, expect, it } from 'vitest'
import type { YoloBox } from '../src/shared/yolo'
import {
  instancesAtPoint,
  maskBounds,
  rectFromDrag,
  rectMask,
  subtractMasks
} from '../src/renderer/src/features/graph/model/semanticEntityMaskMath'
import {
  buildMentionMenu,
  candidatesFromSourceNode,
  candidatesFromValue,
  resolveInstructionReferences,
  type ReferenceCandidate
} from '../src/renderer/src/features/graph/model/semanticReferenceCandidates'
import type { GraphNode } from '../src/shared/graph/types'

const box = (x: number, y: number, width: number, height: number, label = 'person'): YoloBox => ({
  label,
  confidence: 0.9,
  x,
  y,
  width,
  height
})

describe('实体替换掩码（纯函数）', () => {
  it('点选：只返回包含点击点的实例，按面积从小到大（人手里的商品优先于人）', () => {
    const boxes = [box(0, 0, 100, 200), box(40, 80, 20, 20, 'bottle'), box(300, 0, 100, 200)]
    expect(instancesAtPoint(boxes, { x: 50, y: 90 })).toEqual([1, 0])
    expect(instancesAtPoint(boxes, { x: 350, y: 10 })).toEqual([2])
    expect(instancesAtPoint(boxes, { x: 200, y: 10 })).toEqual([])
  })

  it('扣保护区：重叠部分扣掉，报告剩余覆盖与重叠比例', () => {
    // 4×1 画面：目标占 0..2，保护区占 1..3
    const target = Uint8Array.from([1, 1, 1, 0])
    const protect = Uint8Array.from([0, 1, 1, 1])
    const r = subtractMasks(target, [protect])
    expect([...r.mask]).toEqual([1, 0, 0, 0])
    expect(r.coverage).toBeCloseTo(0.25)
    expect(r.protectedRatio).toBeCloseTo(2 / 3)
    // 完全被盖住：coverage = 0（执行器据此跳过这一遍）
    expect(subtractMasks(Uint8Array.from([0, 1, 0, 0]), [protect]).coverage).toBe(0)
  })

  it('外接框与拖框：归一化、误点（太小）返回 null、矩形掩码覆盖正确的像素', () => {
    const mask = rectMask(10, 10, { x: 0.2, y: 0.3, w: 0.5, h: 0.4 })
    expect(maskBounds(mask, 10, 10)).toEqual({ x: 0.2, y: 0.3, w: 0.5, h: 0.4 })
    expect(maskBounds(new Uint8Array(100), 10, 10)).toBeNull()
    expect(rectFromDrag({ x: 0.8, y: 0.9 }, { x: 0.2, y: 0.1 })).toEqual({
      x: 0.2,
      y: 0.1,
      w: expect.closeTo(0.6),
      h: expect.closeTo(0.8)
    })
    expect(rectFromDrag({ x: 0.5, y: 0.5 }, { x: 0.501, y: 0.6 })).toBeNull()
  })
})

describe('参考图候选与 @ 引用', () => {
  it('端口值：图片 / 图片组 / 图片资产都能当候选；未落盘的 data URL 标记为待落盘', () => {
    expect(
      candidatesFromValue({ kind: 'image', dataUrl: '', relativePath: 'Assets/a.png' }, 'A', 'n1')
    ).toEqual([
      {
        key: 'path:Assets/a.png',
        label: 'A',
        origin: 'port',
        ref: { relativePath: 'Assets/a.png', label: 'A' },
        thumbRelativePath: 'Assets/a.png'
      }
    ])
    const fresh = candidatesFromValue(
      { kind: 'images', items: [{ dataUrl: 'data:image/png;base64,xx' }] },
      'Gen',
      'n2'
    )
    expect(fresh[0]).toMatchObject({
      ref: null,
      dataUrl: 'data:image/png;base64,xx',
      label: 'Gen 1'
    })
    expect(candidatesFromValue({ kind: 'text', text: 'x' }, 'T', 'n3')).toEqual([])
  })

  it('上游节点没运行过：退回节点自身（图片资产节点）', () => {
    const node = {
      id: 'img1',
      category: 'asset',
      assetId: 'asset-9',
      assetType: 'image',
      position: { x: 0, y: 0 },
      params: {},
      title: '女主播'
    } as unknown as GraphNode
    expect(candidatesFromSourceNode(node, null, 'out')).toEqual([
      {
        key: 'asset:asset-9',
        label: '女主播',
        origin: 'port',
        ref: { assetId: 'asset-9', label: '女主播' }
      }
    ])
  })

  it('提交指令：已引用的排最前；按首次出现落成参考图并把编号压实', () => {
    const current = [{ assetId: 'a1', label: '旧' }]
    const others: ReferenceCandidate[] = [
      { key: 'asset:a2', label: '新A', origin: 'asset', ref: { assetId: 'a2' } },
      { key: 'asset:a3', label: '新B', origin: 'asset', ref: { assetId: 'a3' } }
    ]
    const menu = buildMentionMenu(current, others, (n) => `@${n}`)
    expect(menu.map((c) => c.key)).toEqual(['asset:a1', 'asset:a2', 'asset:a3'])

    // 只引用 @3：参考图 = [a3]，文本里的 @3 压成 @1，旧的 @1 被去掉
    const r = resolveInstructionReferences('换成 @3 的样子', menu, current)
    expect(r.instruction).toBe('换成 @1 的样子')
    expect(r.picks.map((p) => p.key)).toEqual(['asset:a3'])

    // 引用两次同一张：只算一张
    expect(resolveInstructionReferences('@2 和 @2', menu, current).picks).toHaveLength(1)
    // 没有任何 @：只改措辞，保留原参考图
    const plain = resolveInstructionReferences('保持动作', menu, current)
    expect(plain.picks.map((p) => p.key)).toEqual(['asset:a1'])
    // 菜单里不存在的编号：原样保留（交给校验报错，不吞用户的字）
    expect(resolveInstructionReferences('@9', menu, current).instruction).toBe('@9')
  })
})
