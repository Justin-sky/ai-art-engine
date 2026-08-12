import { describe, expect, it } from 'vitest'
import {
  createNodeFromType,
  getNodePortCenter,
  getNodeSize,
  resolveSnapConnectEdges,
  resolveSnapDragPreview,
  snapConnectThresholdWorld,
  snapPortKey,
  SNAP_CONNECT_THRESHOLD_SCREEN_PX
} from '../src/shared/graph'

describe('snapConnectThresholdWorld', () => {
  it('scales screen px by zoom', () => {
    expect(snapConnectThresholdWorld(1)).toBe(SNAP_CONNECT_THRESHOLD_SCREEN_PX)
    expect(snapConnectThresholdWorld(2)).toBe(SNAP_CONNECT_THRESHOLD_SCREEN_PX / 2)
  })
})

describe('resolveSnapConnectEdges', () => {
  it('connects nearby compatible out→in when dragged beside a target', () => {
    const source = createNodeFromType('asset.screenplay', { x: 0, y: 0 }, { id: 'src' })
    const target = createNodeFromType('beat.split', { x: 0, y: 0 }, { id: 'dst' })
    // 把 source 出口贴到 target 入口附近
    const srcSize = getNodeSize(source)
    const inCenter = getNodePortCenter(target, 'left', 'in')
    source.position = {
      x: inCenter.x - srcSize.w - 20,
      y: inCenter.y - getNodePortCenter(source, 'right', 'out').y + source.position.y
    }
    // 重新按当前尺寸对齐 y：出口中心 ≈ 入口中心
    const outY = getNodePortCenter(source, 'right', 'out').y
    source.position.y += inCenter.y - outY

    const hits = resolveSnapConnectEdges({
      nodes: [source, target],
      edges: [],
      draggedNodeIds: [source.id],
      thresholdWorld: 40
    })

    expect(hits).toEqual([
      {
        sourceId: 'src',
        targetId: 'dst',
        sourcePort: 'out',
        targetPort: 'in',
        dist: expect.any(Number)
      }
    ])
    expect(hits[0]!.dist).toBeLessThanOrEqual(40)
  })

  it('connects reverse direction when target sits left of dragged source', () => {
    const left = createNodeFromType('asset.screenplay', { x: 0, y: 0 }, { id: 'left' })
    const right = createNodeFromType('beat.split', { x: 200, y: 0 }, { id: 'right' })
    const leftSize = getNodeSize(left)
    const inCenter = getNodePortCenter(right, 'left', 'in')
    left.position = {
      x: inCenter.x - leftSize.w - 12,
      y: 0
    }
    const outY = getNodePortCenter(left, 'right', 'out').y
    left.position.y += inCenter.y - outY

    const hits = resolveSnapConnectEdges({
      nodes: [left, right],
      edges: [],
      draggedNodeIds: [right.id],
      thresholdWorld: 40
    })

    expect(hits.some((h) => h.sourceId === 'left' && h.targetId === 'right')).toBe(true)
  })

  it('skips incompatible types even when close', () => {
    const image = createNodeFromType('asset.image', { x: 0, y: 0 }, { id: 'img' })
    const split = createNodeFromType('beat.split', { x: 0, y: 0 }, { id: 'split' })
    const imgSize = getNodeSize(image)
    const inCenter = getNodePortCenter(split, 'left', 'in')
    image.position = {
      x: inCenter.x - imgSize.w - 10,
      y: 0
    }
    const outY = getNodePortCenter(image, 'right', 'out').y
    image.position.y += inCenter.y - outY

    const hits = resolveSnapConnectEdges({
      nodes: [image, split],
      edges: [],
      draggedNodeIds: [image.id],
      thresholdWorld: 80
    })

    expect(hits).toEqual([])
  })

  it('skips when an identical edge already exists', () => {
    const source = createNodeFromType('asset.screenplay', { x: 0, y: 0 }, { id: 'src' })
    const target = createNodeFromType('beat.split', { x: 180, y: 0 }, { id: 'dst' })
    const srcSize = getNodeSize(source)
    const inCenter = getNodePortCenter(target, 'left', 'in')
    source.position = { x: inCenter.x - srcSize.w - 16, y: 0 }
    const outY = getNodePortCenter(source, 'right', 'out').y
    source.position.y += inCenter.y - outY

    const hits = resolveSnapConnectEdges({
      nodes: [source, target],
      edges: [
        {
          id: 'e1',
          source: 'src',
          target: 'dst',
          sourcePort: 'out',
          targetPort: 'in'
        }
      ],
      draggedNodeIds: [source.id],
      thresholdWorld: 40
    })

    expect(hits).toEqual([])
  })

  it('allows a second output to connect into an already-fed input port', () => {
    const a = createNodeFromType('asset.screenplay', { x: 0, y: 0 }, { id: 'a' })
    const b = createNodeFromType('asset.screenplay', { x: 0, y: 400 }, { id: 'b' })
    const note = createNodeFromType('graph.boundary.output', { x: 200, y: 0 }, {
      id: 'bout',
      params: {
        hostBoundaryPort: { portId: 'out', dataType: 'text', multiple: false },
        previewCollapsed: false
      }
    })
    const aSize = getNodeSize(a)
    const inCenter = getNodePortCenter(note, 'left', 'in')
    a.position = { x: inCenter.x - aSize.w - 12, y: 0 }
    const outY = getNodePortCenter(a, 'right', 'out').y
    a.position.y += inCenter.y - outY
    // b 远离，但 bout 的输入口已被 b 占用；a 的出口紧贴 bout 入口仍应可连

    const hits = resolveSnapConnectEdges({
      nodes: [a, b, note],
      edges: [
        {
          id: 'e-occupied',
          source: 'b',
          target: 'bout',
          sourcePort: 'out',
          targetPort: 'in'
        }
      ],
      draggedNodeIds: [a.id],
      thresholdWorld: 40
    })

    expect(hits.some((h) => h.sourceId === 'a' && h.targetId === 'bout')).toBe(true)
  })

  it('does not wire nodes that moved together in the same drag', () => {
    const a = createNodeFromType('asset.screenplay', { x: 0, y: 0 }, { id: 'a' })
    const b = createNodeFromType('beat.split', { x: 180, y: 0 }, { id: 'b' })
    const aSize = getNodeSize(a)
    const inCenter = getNodePortCenter(b, 'left', 'in')
    a.position = { x: inCenter.x - aSize.w - 12, y: 0 }
    const outY = getNodePortCenter(a, 'right', 'out').y
    a.position.y += inCenter.y - outY

    const hits = resolveSnapConnectEdges({
      nodes: [a, b],
      edges: [],
      draggedNodeIds: [a.id, b.id],
      thresholdWorld: 40
    })

    expect(hits).toEqual([])
  })

  it('returns empty when ports are farther than threshold', () => {
    const source = createNodeFromType('asset.screenplay', { x: 0, y: 0 }, { id: 'src' })
    const target = createNodeFromType('beat.split', { x: 400, y: 0 }, { id: 'dst' })

    const hits = resolveSnapConnectEdges({
      nodes: [source, target],
      edges: [],
      draggedNodeIds: [source.id],
      thresholdWorld: 20
    })

    expect(hits).toEqual([])
  })

  it('highlights compatible ports when nodes overlap during drag preview', () => {
    const a = createNodeFromType('asset.screenplay', { x: 0, y: 0 }, { id: 'A' })
    const c = createNodeFromType('beat.split', { x: 0, y: 0 }, { id: 'C' })
    a.position = { ...c.position }

    const preview = resolveSnapDragPreview({
      nodes: [a, c],
      edges: [],
      draggedNodeIds: [a.id],
      thresholdWorld: 36
    })

    expect(preview.highlightNodeIds.has('A')).toBe(true)
    expect(preview.highlightNodeIds.has('C')).toBe(true)
    expect(preview.highlightPortKeys.has(snapPortKey('A', 'out'))).toBe(true)
    expect(preview.highlightPortKeys.has(snapPortKey('C', 'in'))).toBe(true)
    // 节点重叠只负责高亮兼容端口；自动连线只看端口距离，
    // 叠放时左右端口相距约一个节点宽，超出阈值 → 不产生连线候选
    expect(preview.connectCandidates).toEqual([])
  })

  it('does not connect when nodes overlap but ports are far apart', () => {
    const a = createNodeFromType('asset.screenplay', { x: 0, y: 0 }, { id: 'A' })
    const b = createNodeFromType('beat.unitGen', { x: 220, y: 0 }, { id: 'B' })
    const c = createNodeFromType('beat.split', { x: 440, y: 0 }, { id: 'C' })
    // A 与 C 完全叠放：左右端口相距约一个节点宽，超出端口阈值
    a.position = { ...c.position }

    const hits = resolveSnapConnectEdges({
      nodes: [a, b, c],
      edges: [
        { id: 'e1', source: 'A', target: 'B', sourcePort: 'out', targetPort: 'in' },
        { id: 'e2', source: 'B', target: 'C', sourcePort: 'out', targetPort: 'in' }
      ],
      draggedNodeIds: [a.id],
      thresholdWorld: 36
    })

    expect(hits.some((h) => h.sourceId === 'A' && h.targetId === 'C')).toBe(false)
    // 把 A 的出口贴到 C 的入口附近时仍可自动连线
    const aSize = getNodeSize(a)
    const inCenter = getNodePortCenter(c, 'left', 'in')
    a.position = {
      x: inCenter.x - aSize.w - 12,
      y: 0
    }
    const outY = getNodePortCenter(a, 'right', 'out').y
    a.position.y += inCenter.y - outY
    const nearHits = resolveSnapConnectEdges({
      nodes: [a, b, c],
      edges: [
        { id: 'e1', source: 'A', target: 'B', sourcePort: 'out', targetPort: 'in' },
        { id: 'e2', source: 'B', target: 'C', sourcePort: 'out', targetPort: 'in' }
      ],
      draggedNodeIds: [a.id],
      thresholdWorld: 36
    })
    expect(nearHits.some((h) => h.sourceId === 'A' && h.targetId === 'C')).toBe(true)
  })
})
