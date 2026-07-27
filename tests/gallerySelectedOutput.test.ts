import { describe, expect, it } from 'vitest'
import {
  createNodeFromType,
  resolveGalleryOutputsFromNodeParams,
  runGraph,
  type GraphDocument
} from '../src/shared/graph'

describe('gallery selected output', () => {
  it('resolveGalleryOutputsFromNodeParams prefers selectedImageId', () => {
    const outs = resolveGalleryOutputsFromNodeParams({
      generatedImages: [
        { id: 'a', dataUrl: 'data:a' },
        { id: 'b', dataUrl: 'data:b' }
      ],
      selectedImageId: 'a'
    })
    expect(outs?.out).toMatchObject({ kind: 'image', id: 'a', dataUrl: 'data:a' })
    expect(outs?.['out-all']).toMatchObject({
      kind: 'images',
      items: [
        { id: 'a', dataUrl: 'data:a' },
        { id: 'b', dataUrl: 'data:b' }
      ]
    })
  })

  it('onlyTarget soft-snapshot overlays selected over stale prior out', async () => {
    const imageGen = createNodeFromType('asset.image', { x: 0, y: 0 }, {
      params: {
        generatedImages: [
          { id: 'old', dataUrl: 'data:old' },
          { id: 'pick', dataUrl: 'data:pick' }
        ],
        selectedImageId: 'pick'
      }
    })
    const out = createNodeFromType('output.image', { x: 200, y: 0 }, {
      params: { outputKind: 'image', inputDataType: 'image' }
    })
    const doc: GraphDocument = {
      nodes: [imageGen, out],
      edges: [
        {
          id: 'e1',
          source: imageGen.id,
          target: out.id,
          sourcePort: 'out',
          targetPort: 'in'
        }
      ],
      viewport: { x: 0, y: 0, zoom: 1 }
    }

    const result = await runGraph(doc, {
      stepDelayMs: 1,
      targetNodeId: out.id,
      onlyTargetNode: true,
      priorNodeStates: {
        [imageGen.id]: {
          status: 'done',
          outputs: {
            out: { kind: 'image', id: 'old', dataUrl: 'data:old' },
            'out-all': {
              kind: 'images',
              items: [
                { id: 'old', dataUrl: 'data:old' },
                { id: 'pick', dataUrl: 'data:pick' }
              ]
            }
          }
        }
      }
    })

    expect(result.error).toBeUndefined()
    expect(result.ok).toBe(true)
    const outValue = result.states[out.id]?.outputs?.out
    expect(outValue?.kind).toBe('output')
    if (outValue?.kind === 'output') {
      expect(outValue.images).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'pick', dataUrl: 'data:pick' })
        ])
      )
      expect(outValue.images?.some((img) => img.id === 'old')).toBe(false)
    }
  })
})
