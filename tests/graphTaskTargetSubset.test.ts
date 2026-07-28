import { describe, expect, it } from 'vitest'
import { createNodeFromType, runGraph } from '../src/shared/graph'
import { boundaryOutputNodeId } from '../src/shared/graph/hostInterface'

function lockedImage(id: string, dataUrl: string) {
  return createNodeFromType('asset.image', { x: 0, y: 0 }, {
    id,
    params: {
      locked: true,
      generatedImages: [{ id: `${id}-pick`, dataUrl }],
      selectedImageId: `${id}-pick`
    }
  })
}

function boundaryOut(portId: string) {
  return createNodeFromType('graph.boundary.output', { x: 200, y: 0 }, {
    id: boundaryOutputNodeId(portId),
    params: { hostBoundaryPort: { portId, dataType: 'image' } }
  })
}

/** 侧栏元素图每项一条链共存一图：入队单个汇点不应带上兄弟链 */
describe('runGraph targetNodeIds subset', () => {
  it('runs only the selected boundary output chain', async () => {
    const outA = boundaryOut('out-a')
    const outB = boundaryOut('out-b')
    const graph = {
      nodes: [lockedImage('img-a', 'data:a'), lockedImage('img-b', 'data:b'), outA, outB],
      edges: [
        { id: 'e-a', source: 'img-a', target: outA.id, sourcePort: 'out', targetPort: 'in' },
        { id: 'e-b', source: 'img-b', target: outB.id, sourcePort: 'out', targetPort: 'in' }
      ],
      viewport: { x: 0, y: 0, zoom: 1 }
    }

    const result = await runGraph(graph, {
      stepDelayMs: 1,
      targetNodeIds: [outA.id]
    })

    expect(result.ok, result.error).toBe(true)
    expect(result.states['img-a']?.status).toBe('done')
    expect(result.states[outA.id]?.status).toBe('done')
    expect(result.states['img-b']?.status).toBe('skipped')
    expect(result.states[outB.id]?.status).toBe('skipped')
    expect(result.order).not.toContain('img-b')
  })

  it('runs every chain when all outputs are targeted', async () => {
    const outA = boundaryOut('out-a')
    const outB = boundaryOut('out-b')
    const graph = {
      nodes: [lockedImage('img-a', 'data:a'), lockedImage('img-b', 'data:b'), outA, outB],
      edges: [
        { id: 'e-a', source: 'img-a', target: outA.id, sourcePort: 'out', targetPort: 'in' },
        { id: 'e-b', source: 'img-b', target: outB.id, sourcePort: 'out', targetPort: 'in' }
      ],
      viewport: { x: 0, y: 0, zoom: 1 }
    }

    const result = await runGraph(graph, {
      stepDelayMs: 1,
      targetNodeIds: [outA.id, outB.id]
    })

    expect(result.ok, result.error).toBe(true)
    expect(result.states['img-a']?.status).toBe('done')
    expect(result.states['img-b']?.status).toBe('done')
  })
})
