import { describe, expect, it } from 'vitest'
import {
  createNodeFromType,
  createOutputGraphNode,
  isGenerateLocked,
  runGraph,
  supportsGenerateLock
} from '../src/shared/graph'
import { graphOutputNodeId } from '../src/shared/graph/types'

const IMAGE_OUTPUT_ID = graphOutputNodeId('image')

describe('generate node lock', () => {
  it('supportsGenerateLock covers processing assets and image editors', () => {
    const image = createNodeFromType('asset.image', { x: 0, y: 0 })
    const select = createNodeFromType('image.select', { x: 0, y: 0 })
    const lipSync = createNodeFromType('video.lipSync', { x: 0, y: 0 })
    const multiAngle = createNodeFromType('image.multiAngle', { x: 0, y: 0 })
    expect(supportsGenerateLock(image)).toBe(true)
    expect(supportsGenerateLock(lipSync)).toBe(true)
    expect(supportsGenerateLock(multiAngle)).toBe(true)
    expect(supportsGenerateLock(select)).toBe(false)
    expect(isGenerateLocked({ ...image, params: { locked: true } })).toBe(true)
    expect(isGenerateLocked({ ...select, params: { locked: true } })).toBe(false)
  })

  it('lock reuses gallery without calling generateImage', async () => {
    const image = createNodeFromType('asset.image', { x: 0, y: 0 }, {
      id: 'img',
      params: {
        locked: true,
        generatedImages: [
          { id: 'a', dataUrl: 'data:a' },
          { id: 'b', dataUrl: 'data:b' }
        ],
        selectedImageId: 'a'
      }
    })
    const output = createOutputGraphNode('image', { x: 200, y: 0 }, {
      id: IMAGE_OUTPUT_ID
    })
    let generateCalls = 0

    const result = await runGraph(
      {
        nodes: [image, output],
        edges: [
          {
            id: 'e1',
            source: 'img',
            target: IMAGE_OUTPUT_ID,
            sourcePort: 'out',
            targetPort: 'in'
          }
        ],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        stepDelayMs: 1,
        generateImage: async () => {
          generateCalls += 1
          return { images: [{ dataUrl: 'data:new' }], model: 'm' }
        }
      }
    )

    expect(result.ok, result.error).toBe(true)
    expect(generateCalls).toBe(0)
    expect(result.states.img?.status).toBe('done')
    expect(result.states.img?.outputs?.out).toMatchObject({
      kind: 'image',
      id: 'a',
      dataUrl: 'data:a'
    })
  })

  it('lock without cache fails with GRAPH_LOCK_NO_CACHE', async () => {
    const image = createNodeFromType('asset.image', { x: 0, y: 0 }, {
      id: 'img',
      params: { locked: true }
    })
    const output = createOutputGraphNode('image', { x: 200, y: 0 }, {
      id: IMAGE_OUTPUT_ID
    })
    let generateCalls = 0

    const result = await runGraph(
      {
        nodes: [image, output],
        edges: [
          {
            id: 'e1',
            source: 'img',
            target: IMAGE_OUTPUT_ID,
            sourcePort: 'out',
            targetPort: 'in'
          }
        ],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        stepDelayMs: 1,
        generateImage: async () => {
          generateCalls += 1
          return { images: [{ dataUrl: 'data:new' }], model: 'm' }
        }
      }
    )

    expect(result.ok).toBe(false)
    expect(result.error).toContain('GRAPH_LOCK_NO_CACHE')
    expect(result.states.img?.status).toBe('error')
    expect(result.states.img?.error).toBe('GRAPH_LOCK_NO_CACHE')
    expect(generateCalls).toBe(0)
  })

  it('lock can reuse prior runStates when gallery is empty', async () => {
    const image = createNodeFromType('asset.image', { x: 0, y: 0 }, {
      id: 'img',
      params: { locked: true }
    })
    const output = createOutputGraphNode('image', { x: 200, y: 0 }, {
      id: IMAGE_OUTPUT_ID
    })
    let generateCalls = 0

    const result = await runGraph(
      {
        nodes: [image, output],
        edges: [
          {
            id: 'e1',
            source: 'img',
            target: IMAGE_OUTPUT_ID,
            sourcePort: 'out',
            targetPort: 'in'
          }
        ],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        stepDelayMs: 1,
        priorNodeStates: {
          img: {
            status: 'done',
            outputs: {
              out: { kind: 'image', id: 'cached', dataUrl: 'data:cached' }
            }
          }
        },
        generateImage: async () => {
          generateCalls += 1
          return { images: [{ dataUrl: 'data:new' }], model: 'm' }
        }
      }
    )

    expect(result.ok, result.error).toBe(true)
    expect(generateCalls).toBe(0)
    expect(result.states.img?.outputs?.out).toMatchObject({
      kind: 'image',
      id: 'cached',
      dataUrl: 'data:cached'
    })
  })
})
