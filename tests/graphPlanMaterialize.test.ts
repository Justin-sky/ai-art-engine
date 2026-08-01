import { describe, expect, it } from 'vitest'
import {
  materializeGraphPlan,
  parseGraphPlanJson,
  type GraphPlan
} from '../src/shared/graph'

describe('graphPlan materialize', () => {
  it('parses fenced JSON GraphPlan', () => {
    const plan = parseGraphPlanJson(`\`\`\`json
{"title":"UA","nodes":[{"key":"a","typeId":"play.script"}],"edges":[]}
\`\`\``)
    expect(plan.title).toBe('UA')
    expect(plan.nodes[0]?.typeId).toBe('play.script')
  })

  it('materializes a simple script → image → video chain', () => {
    const plan: GraphPlan = {
      title: '买量视频',
      nodes: [
        { key: 'script', typeId: 'play.script', title: '剧本' },
        { key: 'img', typeId: 'asset.image', title: '分镜图' },
        { key: 'vid', typeId: 'asset.video', title: '视频' }
      ],
      edges: [
        { from: 'script', to: 'img' },
        { from: 'img', to: 'vid' }
      ]
    }
    const result = materializeGraphPlan(plan, {
      scope: 'canvasAsset',
      assetType: 'canvas'
    })
    expect(result.ok, result.error).toBe(true)
    expect(result.document).toBeTruthy()
    expect(result.title).toBe('买量视频')
    const typeIds = result.document!.nodes.map((n) => n.typeId)
    expect(typeIds).toContain('play.script')
    expect(typeIds).toContain('asset.image')
    expect(typeIds).toContain('asset.video')
    expect(result.document!.edges.length).toBeGreaterThanOrEqual(2)
  })

  it('skips unknown typeIds and incompatible edges', () => {
    const plan: GraphPlan = {
      nodes: [
        { key: 'a', typeId: 'play.script' },
        { key: 'bad', typeId: 'not.a.real.type' },
        { key: 'b', typeId: 'asset.video' }
      ],
      edges: [
        { from: 'a', to: 'missing' },
        { from: 'a', to: 'b', fromPort: 'out', toPort: 'in' }
      ]
    }
    const result = materializeGraphPlan(plan, { scope: 'canvasAsset', assetType: 'canvas' })
    expect(result.ok).toBe(true)
    expect(result.warnings.some((w) => w.includes('not.a.real.type'))).toBe(true)
    expect(result.warnings.some((w) => w.includes('不存在的节点'))).toBe(true)
    expect(result.document!.nodes.some((n) => n.typeId === 'not.a.real.type')).toBe(false)
  })

  it('fails when no usable nodes remain', () => {
    const result = materializeGraphPlan(
      { nodes: [{ key: 'x', typeId: 'totally.fake' }], edges: [] },
      { scope: 'canvasAsset' }
    )
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/没有可用节点/)
  })
})
