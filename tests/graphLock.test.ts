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
  it('supportsGenerateLock covers all nodes except graph I/O', () => {
    const image = createNodeFromType('asset.image', { x: 0, y: 0 })
    const select = createNodeFromType('image.select', { x: 0, y: 0 })
    const lipSync = createNodeFromType('video.lipSync', { x: 0, y: 0 })
    const multiAngle = createNodeFromType('image.multiAngle', { x: 0, y: 0 })
    const filmBreakdown = createNodeFromType('film.breakdown', { x: 0, y: 0 })
    const filmRender = createNodeFromType('film.render', { x: 0, y: 0 })
    const note = createNodeFromType('note.text', { x: 0, y: 0 })
    const host = createNodeFromType(
      'asset.image',
      { x: 0, y: 0 },
      {
        assetId: '00000000-0000-4000-8000-0000000000a1',
        params: { assetRef: true, assetHost: true, assetType: 'image' }
      }
    )
    const output = createOutputGraphNode('image', { x: 0, y: 0 })
    const boundaryIn = createNodeFromType('graph.boundary.input', { x: 0, y: 0 })
    const boundaryOut = createNodeFromType('graph.boundary.output', { x: 0, y: 0 })
    const inputSlot = createNodeFromType('graph.input.slot', { x: 0, y: 0 })
    expect(supportsGenerateLock(image)).toBe(true)
    expect(supportsGenerateLock(select)).toBe(true)
    expect(supportsGenerateLock(lipSync)).toBe(true)
    expect(supportsGenerateLock(multiAngle)).toBe(true)
    expect(supportsGenerateLock(filmBreakdown)).toBe(true)
    expect(supportsGenerateLock(filmRender)).toBe(true)
    expect(supportsGenerateLock(note)).toBe(true)
    expect(supportsGenerateLock(host)).toBe(true)
    expect(supportsGenerateLock(output)).toBe(false)
    expect(supportsGenerateLock(boundaryIn)).toBe(false)
    expect(supportsGenerateLock(boundaryOut)).toBe(false)
    expect(supportsGenerateLock(inputSlot)).toBe(false)
    expect(isGenerateLocked({ ...image, params: { locked: true } })).toBe(true)
    expect(isGenerateLocked({ ...host, params: { ...host.params, locked: true } })).toBe(true)
    expect(isGenerateLocked({ ...select, params: { locked: true } })).toBe(true)
    expect(isGenerateLocked({ ...output, params: { locked: true } })).toBe(false)
    expect(isGenerateLocked({ ...boundaryIn, params: { locked: true } })).toBe(false)
  })

  it('lock reuses gallery without calling generateImage', async () => {
    const image = createNodeFromType(
      'asset.image',
      { x: 0, y: 0 },
      {
        id: 'img',
        params: {
          locked: true,
          generatedImages: [
            { id: 'a', dataUrl: 'data:a' },
            { id: 'b', dataUrl: 'data:b' }
          ],
          selectedImageId: 'a'
        }
      }
    )
    const output = createOutputGraphNode(
      'image',
      { x: 200, y: 0 },
      {
        id: IMAGE_OUTPUT_ID
      }
    )
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

  it('locked text.plain reuses params.text without GRAPH_LOCK_NO_CACHE', async () => {
    const script = createNodeFromType(
      'text.plain',
      { x: 0, y: 0 },
      {
        id: 'script',
        params: { locked: true, text: 'a locked prompt' }
      }
    )
    const image = createNodeFromType(
      'asset.image',
      { x: 200, y: 0 },
      {
        id: 'img',
        params: {
          locked: true,
          generatedImages: [{ id: 'a', dataUrl: 'data:a', relativePath: 'Cache/Images/a.png' }],
          selectedImageId: 'a'
        }
      }
    )
    const output = createOutputGraphNode(
      'image',
      { x: 400, y: 0 },
      {
        id: IMAGE_OUTPUT_ID
      }
    )
    let generateCalls = 0

    const result = await runGraph(
      {
        nodes: [script, image, output],
        edges: [
          {
            id: 'e1',
            source: 'script',
            target: 'img',
            sourcePort: 'out',
            targetPort: 'in-text'
          },
          {
            id: 'e2',
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
    expect(result.states.script?.status).toBe('done')
    expect(result.states.script?.outputs?.out).toMatchObject({
      kind: 'text',
      text: 'a locked prompt'
    })
    expect(result.states.img?.outputs?.out).toMatchObject({
      kind: 'image',
      id: 'a',
      relativePath: 'Cache/Images/a.png'
    })
  })

  it('lock without cache fails with GRAPH_LOCK_NO_CACHE', async () => {
    const image = createNodeFromType(
      'asset.image',
      { x: 0, y: 0 },
      {
        id: 'img',
        params: { locked: true }
      }
    )
    const output = createOutputGraphNode(
      'image',
      { x: 200, y: 0 },
      {
        id: IMAGE_OUTPUT_ID
      }
    )
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
    const image = createNodeFromType(
      'asset.image',
      { x: 0, y: 0 },
      {
        id: 'img',
        params: { locked: true }
      }
    )
    const output = createOutputGraphNode(
      'image',
      { x: 200, y: 0 },
      {
        id: IMAGE_OUTPUT_ID
      }
    )
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
