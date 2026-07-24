import { describe, expect, it, vi } from 'vitest'
import {
  materializeRunStateOutputs,
  resolveHostMediaSyncSource
} from '../src/shared/graph/runOutputPersist'
import type { GraphDocument, GraphNodeRunState } from '../src/shared/graph'

describe('run output persist', () => {
  it('materializes image dataUrl to relativePath', async () => {
    const saveMedia = vi.fn(async ({ key }: { key: string }) => `.aiartengine/graph-outputs/${key}.png`)
    const next = await materializeRunStateOutputs(
      {
        n1: {
          status: 'done',
          outputs: {
            out: { kind: 'image', dataUrl: 'data:image/png;base64,aaa', id: 'i1' }
          }
        }
      },
      saveMedia
    )
    expect(saveMedia).toHaveBeenCalled()
    expect(next.n1.outputs?.out).toEqual({
      kind: 'image',
      id: 'i1',
      dataUrl: '',
      relativePath: '.aiartengine/graph-outputs/n1:out:image.png'
    })
  })

  it('resolveHostMediaSyncSource prefers output images then other assets', () => {
    const graph = {
      nodes: [{ id: 'image-output', category: 'output', typeId: 'output.image', position: { x: 0, y: 0 }, params: {} }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    } as GraphDocument
    const runStates: Record<string, GraphNodeRunState> = {
      'image-output': {
        status: 'done',
        outputs: {
          out: {
            kind: 'output',
            outputKind: 'image',
            items: [{ kind: 'asset', assetId: 'other', assetType: 'image' }],
            notes: [],
            params: {},
            images: [{ dataUrl: '', relativePath: '.aiartengine/graph-outputs/x.png' }]
          }
        }
      }
    }
    expect(resolveHostMediaSyncSource(graph, runStates, 'host', 'image')).toEqual({
      kind: 'relativePath',
      relativePath: '.aiartengine/graph-outputs/x.png'
    })
  })
})
