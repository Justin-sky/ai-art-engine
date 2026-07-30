import { describe, expect, it } from 'vitest'
import {
  boundaryOutputNodeId,
  collectImagesFromCompletedOutputNode,
  isVisualOutputNodeComplete,
  type GraphDocument
} from '../src/shared/graph'

describe('collectImagesFromCompletedOutputNode', () => {
  const boutId = boundaryOutputNodeId('el-1')

  function doc(overrides?: Partial<GraphDocument>): GraphDocument {
    return {
      nodes: [
        {
          id: 'gen',
          typeId: 'asset.image',
          category: 'asset',
          position: { x: 0, y: 0 },
          assetType: 'image',
          params: {
            worldElementId: 'el-1',
            generatedImages: [
              {
                id: 'g1',
                relativePath: 'Cache/Images/scene.png',
                dataUrl: ''
              }
            ],
            selectedImageId: 'g1'
          }
        },
        {
          id: boutId,
          typeId: 'graph.boundary.output',
          category: 'note',
          position: { x: 200, y: 0 },
          params: {
            worldElementId: 'el-1',
            hostBoundaryPort: { portId: 'el-1', dataType: 'image' }
          }
        }
      ],
      edges: [
        { id: 'e1', source: 'gen', target: boutId, sourcePort: 'out', targetPort: 'in' }
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      ...overrides
    }
  }

  it('collects from boundary runStates.out when done', () => {
    const graph = doc({
      runStates: {
        [boutId]: {
          status: 'done',
          outputs: {
            out: { kind: 'image', relativePath: 'Cache/Images/from-run.png' }
          }
        }
      }
    })
    expect(isVisualOutputNodeComplete(graph, boutId)).toBe(true)
    expect(collectImagesFromCompletedOutputNode(graph, graph.nodes[1]!)).toEqual([
      expect.objectContaining({ relativePath: 'Cache/Images/from-run.png' })
    ])
  })

  it('soft-resolves upstream gallery when boundary has no runStates', () => {
    const graph = doc()
    expect(isVisualOutputNodeComplete(graph, boutId)).toBe(true)
    expect(collectImagesFromCompletedOutputNode(graph, graph.nodes[1]!)).toEqual([
      expect.objectContaining({ relativePath: 'Cache/Images/scene.png' })
    ])
  })

  it('reads previewRelativePath on the boundary node', () => {
    const graph = doc()
    graph.nodes[1]!.params.previewRelativePath = 'Cache/Images/preview.png'
    graph.nodes[0]!.params.generatedImages = []
    expect(collectImagesFromCompletedOutputNode(graph, graph.nodes[1]!)).toEqual([
      expect.objectContaining({ relativePath: 'Cache/Images/preview.png' })
    ])
  })
})
