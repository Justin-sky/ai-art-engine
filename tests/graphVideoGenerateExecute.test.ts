import { describe, expect, it, vi } from 'vitest'
import { executeVideoGenerateNode } from '../src/shared/graph'
import type { GraphNode, NodeExecuteContext } from '../src/shared/graph'

function videoNode(overrides?: Partial<GraphNode>): GraphNode {
  return {
    id: 'v1',
    typeId: 'asset.video',
    category: 'asset',
    assetType: 'video',
    title: 'Video Gen',
    position: { x: 0, y: 0 },
    size: { w: 200, h: 140 },
    params: {
      generateInstruction: 'a cat walks',
      generateModel: 'seedance',
      generateProviderInstanceId: 'or1',
      generateDuration: 5,
      generateAspectRatio: '16:9'
    },
    ...overrides
  }
}

describe('executeVideoGenerateNode API', () => {
  it('calls generateVideo and returns videos array output', async () => {
    const generateVideo = vi.fn(async () => ({
      assetId: 'asset-video-1',
      relativePath: 'assets/gen.mp4',
      model: 'seedance'
    }))
    const patchNode = vi.fn()
    const ctx: NodeExecuteContext = {
      node: videoNode(),
      inputs: {},
      generateVideo,
      patchNode
    }
    const out = await executeVideoGenerateNode(ctx)
    expect(generateVideo).toHaveBeenCalledTimes(1)
    expect(generateVideo.mock.calls[0]![0].prompt).toContain('a cat walks')
    expect(generateVideo.mock.calls[0]![0].duration).toBe(5)
    expect(generateVideo.mock.calls[0]![0].aspectRatio).toBe('16:9')
    expect(out.out).toMatchObject({
      kind: 'videos',
      items: [{ id: 'asset-video-1', relativePath: 'assets/gen.mp4' }]
    })
    expect(patchNode).toHaveBeenCalled()
  })

  it('falls back to passthrough text when generateVideo is missing', async () => {
    const ctx: NodeExecuteContext = {
      node: videoNode(),
      inputs: {},
      patchNode: vi.fn()
    }
    const out = await executeVideoGenerateNode(ctx)
    expect(out.out).toMatchObject({ kind: 'text' })
  })
})
