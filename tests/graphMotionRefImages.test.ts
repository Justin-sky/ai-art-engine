import { describe, expect, it } from 'vitest'
import {
  executeMotionAssetRefNode,
  resolveMotionImageItems,
  type NodeExecuteContext
} from '../src/shared/graph'

describe('motion asset ref images', () => {
  it('resolveMotionImageItems reads stagesByNodeId cameraShots', () => {
    const items = resolveMotionImageItems(
      {
        stagesByNodeId: {
          'proc-1': {
            cameraShots: [
              { id: 's1', dataUrl: 'data:image/png;base64,aaa', createdAt: '2026-01-01' },
              { id: 's2', dataUrl: 'data:image/png;base64,bbb', createdAt: '2026-01-02' }
            ]
          }
        }
      },
      null,
      'proc-1'
    )
    expect(items).toHaveLength(2)
    expect(items[0]?.id).toBe('s1')
  })

  it('executeMotionAssetRefNode outputs selected image from resolveAssetGenParams', () => {
    const ctx: NodeExecuteContext = {
      node: {
        id: 'ref-1',
        typeId: 'asset.motion',
        category: 'asset',
        assetId: 'motion-1',
        assetType: 'motion',
        position: { x: 0, y: 0 },
        params: { assetRef: true }
      },
      inputs: {},
      resolveAssetGenParams: (assetId) =>
        assetId === 'motion-1'
          ? {
              stagesByNodeId: {
                'ref-1': {
                  cameraShots: [{ id: 'shot-a', dataUrl: 'data:image/png;base64,xyz' }]
                }
              }
            }
          : undefined
    }
    const result = executeMotionAssetRefNode(ctx)
    expect(result.out.kind).toBe('image')
    if (result.out.kind !== 'image') return
    expect(result.out).toMatchObject({
      id: 'shot-a',
      dataUrl: 'data:image/png;base64,xyz'
    })
    expect(result['out-all']).toMatchObject({
      kind: 'images',
      items: [{ id: 'shot-a', dataUrl: 'data:image/png;base64,xyz' }]
    })
  })
})
