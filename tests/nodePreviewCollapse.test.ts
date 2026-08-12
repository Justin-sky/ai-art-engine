import { describe, expect, it } from 'vitest'
import {
  GRAPH_NODE_COLLAPSED_HEIGHT_PX,
  createNodeFromType,
  getNodeSize,
  nodePortYRatio
} from '../src/shared/graph'

describe('graph node preview collapse', () => {
  it('getNodeSize uses collapsed height when previewCollapsed', () => {
    const node = createNodeFromType('video.lipSync', { x: 0, y: 0 })
    node.size = { w: 200, h: 160 }
    expect(getNodeSize(node).h).toBe(160)

    node.params.previewCollapsed = true
    expect(getNodeSize(node)).toEqual({ w: 200, h: GRAPH_NODE_COLLAPSED_HEIGHT_PX })
  })

  it('keeps expanded size.h after toggle so restore works', () => {
    const node = createNodeFromType('asset.video', { x: 0, y: 0 })
    node.size = { w: 180, h: 140 }
    node.params.previewCollapsed = true
    expect(getNodeSize(node).h).toBe(GRAPH_NODE_COLLAPSED_HEIGHT_PX)
    node.params.previewCollapsed = false
    expect(getNodeSize(node).h).toBe(140)
  })

  it('port ratios stay within card when collapsed height', () => {
    const h = GRAPH_NODE_COLLAPSED_HEIGHT_PX
    for (let i = 0; i < 4; i++) {
      const y = nodePortYRatio(i, 4, h)
      expect(y).toBeGreaterThan(0.1)
      expect(y).toBeLessThan(0.9)
    }
  })

  it('distributes expanded ports across the full card including header', () => {
    expect(nodePortYRatio(0, 2, 180)).toBeCloseTo(1 / 3)
    expect(nodePortYRatio(1, 2, 180)).toBeCloseTo(2 / 3)
  })

  it('image boundary expands when local preview exists unless user collapsed', () => {
    const node = createNodeFromType('graph.boundary.output', { x: 0, y: 0 })
    node.size = { w: 220, h: 124 }
    node.params.hostBoundaryPort = {
      portId: 'out',
      dataType: 'image',
      multiple: false
    }
    node.params.previewCollapsed = true
    expect(getNodeSize(node).h).toBe(GRAPH_NODE_COLLAPSED_HEIGHT_PX)

    node.params.previewRelativePath = 'assets/demo.png'
    // 有预览且未显式折叠（=== true）时展开，便于 soft/cook 后按图片比例自适应
    node.params.previewCollapsed = false
    expect(getNodeSize(node)).toEqual({ w: 220, h: 124 })

    node.params.previewCollapsed = true
    expect(getNodeSize(node).h).toBe(GRAPH_NODE_COLLAPSED_HEIGHT_PX)
  })
})
