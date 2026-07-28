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
    const worldExtract = createNodeFromType('world.extract', { x: 0, y: 0 })
    const worldGen = createNodeFromType('world.gen', { x: 0, y: 0 })
    const narrativeSplit = createNodeFromType('narrative.split', { x: 0, y: 0 })
    const narrativeGen = createNodeFromType('narrative.gen', { x: 0, y: 0 })
    const note = createNodeFromType('note.text', { x: 0, y: 0 })
    const host = createNodeFromType('asset.image', { x: 0, y: 0 }, {
      assetId: '00000000-0000-4000-8000-0000000000a1',
      params: { assetRef: true, assetHost: true, assetType: 'image' }
    })
    const output = createOutputGraphNode('image', { x: 0, y: 0 })
    const boundaryIn = createNodeFromType('graph.boundary.input', { x: 0, y: 0 })
    const boundaryOut = createNodeFromType('graph.boundary.output', { x: 0, y: 0 })
    const inputSlot = createNodeFromType('graph.input.slot', { x: 0, y: 0 })
    const worldTable = createNodeFromType('world.table', { x: 0, y: 0 })
    const narrativeTable = createNodeFromType('narrative.table', { x: 0, y: 0 })
    const shotTable = createNodeFromType('script.shotTable', { x: 0, y: 0 })
    expect(supportsGenerateLock(image)).toBe(true)
    expect(supportsGenerateLock(select)).toBe(true)
    expect(supportsGenerateLock(lipSync)).toBe(true)
    expect(supportsGenerateLock(multiAngle)).toBe(true)
    expect(supportsGenerateLock(worldExtract)).toBe(true)
    expect(supportsGenerateLock(worldGen)).toBe(true)
    expect(supportsGenerateLock(narrativeSplit)).toBe(true)
    expect(supportsGenerateLock(narrativeGen)).toBe(true)
    expect(supportsGenerateLock(note)).toBe(true)
    expect(supportsGenerateLock(host)).toBe(true)
    expect(supportsGenerateLock(output)).toBe(false)
    expect(supportsGenerateLock(boundaryIn)).toBe(false)
    expect(supportsGenerateLock(boundaryOut)).toBe(false)
    expect(supportsGenerateLock(inputSlot)).toBe(false)
    // 目录表格只透传，无图库可复用，锁定必然取不到缓存
    expect(supportsGenerateLock(worldTable)).toBe(false)
    expect(supportsGenerateLock(narrativeTable)).toBe(false)
    expect(supportsGenerateLock(shotTable)).toBe(false)
    expect(isGenerateLocked({ ...image, params: { locked: true } })).toBe(true)
    expect(isGenerateLocked({ ...host, params: { ...host.params, locked: true } })).toBe(true)
    expect(isGenerateLocked({ ...select, params: { locked: true } })).toBe(true)
    expect(isGenerateLocked({ ...output, params: { locked: true } })).toBe(false)
    expect(isGenerateLocked({ ...boundaryIn, params: { locked: true } })).toBe(false)
    expect(isGenerateLocked({ ...worldTable, params: { locked: true } })).toBe(false)
  })

  it('legacy locked world.table still passes the catalog through', async () => {
    const table = createNodeFromType('world.table', { x: 0, y: 0 }, {
      id: 'table',
      params: { locked: true, text: '{"characters":[{"name":"A"}]}' }
    })

    const result = await runGraph(
      {
        nodes: [table],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        stepDelayMs: 1,
        targetNodeId: 'table'
      }
    )

    expect(result.ok, result.error).toBe(true)
    expect(result.states.table?.status).toBe('done')
    expect(result.states.table?.outputs?.out).toMatchObject({
      kind: 'world',
      text: '{"characters":[{"name":"A"}]}'
    })
  })

  it('narrative.split lock reuses catalog gallery without calling generateText', async () => {
    const split = createNodeFromType('narrative.split', { x: 0, y: 0 }, {
      id: 'split',
      params: {
        locked: true,
        text: '[{"id":"nu-1","title":"A"}]',
        generatedTexts: [
          { id: 'old', text: '[]' },
          { id: 'pick', text: '[{"id":"nu-1","title":"A"}]' }
        ],
        selectedTextId: 'pick'
      }
    })
    let generateCalls = 0

    const result = await runGraph(
      {
        nodes: [split],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        stepDelayMs: 1,
        targetNodeId: 'split',
        onlyTargetNode: true,
        generateText: async () => {
          generateCalls += 1
          return { text: '[{"id":"nu-new","title":"NEW"}]', model: 'm' }
        }
      }
    )

    expect(result.ok, result.error).toBe(true)
    expect(generateCalls).toBe(0)
    expect(result.states.split?.outputs?.out).toMatchObject({
      kind: 'narrative',
      text: '[{"id":"nu-1","title":"A"}]'
    })
    expect(result.states.split?.outputs?.['out-all']?.kind).toBe('texts')
  })

  it('narrative.gen lock reuses generatedTexts without collecting', async () => {
    const gen = createNodeFromType('narrative.gen', { x: 0, y: 0 }, {
      id: 'gen',
      params: {
        locked: true,
        generatedTexts: [
          { id: 'a', text: '单元A', title: 'A' },
          { id: 'b', text: '单元B', title: 'B' }
        ],
        selectedTextId: 'b'
      }
    })
    let collectCalls = 0

    const result = await runGraph(
      {
        nodes: [gen],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        stepDelayMs: 1,
        targetNodeId: 'gen',
        onlyTargetNode: true,
        collectNarrativeUnitTexts: async () => {
          collectCalls += 1
          return { items: [{ id: 'new', text: '新', title: 'NEW' }] }
        }
      }
    )

    expect(result.ok, result.error).toBe(true)
    expect(collectCalls).toBe(0)
    expect(result.states.gen?.outputs?.out).toMatchObject({
      kind: 'text',
      text: '单元B',
      id: 'b'
    })
    expect(result.states.gen?.outputs?.['out-all']?.kind).toBe('texts')
  })

  it('world.extract lock reuses catalog gallery without calling generateText', async () => {
    const extract = createNodeFromType('world.extract', { x: 0, y: 0 }, {
      id: 'extract',
      params: {
        locked: true,
        text: '{"characters":[{"name":"A"}]}',
        generatedTexts: [
          { id: 'old', text: '{"characters":[]}' },
          { id: 'pick', text: '{"characters":[{"name":"A"}]}' }
        ],
        selectedTextId: 'pick'
      }
    })
    let generateCalls = 0

    const result = await runGraph(
      {
        nodes: [extract],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        stepDelayMs: 1,
        targetNodeId: 'extract',
        onlyTargetNode: true,
        generateText: async () => {
          generateCalls += 1
          return { text: '{"characters":[{"name":"NEW"}]}', model: 'm' }
        }
      }
    )

    expect(result.ok, result.error).toBe(true)
    expect(generateCalls).toBe(0)
    expect(result.states.extract?.outputs?.out).toMatchObject({
      kind: 'world',
      text: '{"characters":[{"name":"A"}]}'
    })
    expect(result.states.extract?.outputs?.['out-all']?.kind).toBe('texts')
  })

  it('world.gen lock reuses worldEntities without collecting', async () => {
    const gen = createNodeFromType('world.gen', { x: 0, y: 0 }, {
      id: 'gen',
      params: {
        locked: true,
        worldElementOutputs: [
          { type: '角色', name: 'A', imageUrl: 'data:a' },
          { type: '场景', name: 'B', imageUrl: 'data:b' }
        ]
      }
    })
    let collectCalls = 0

    const result = await runGraph(
      {
        nodes: [gen],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        stepDelayMs: 1,
        targetNodeId: 'gen',
        onlyTargetNode: true,
        collectWorldElementOutputs: async () => {
          collectCalls += 1
          return { items: [{ type: '角色', name: 'NEW', imageUrl: 'data:new' }] }
        }
      }
    )

    expect(result.ok, result.error).toBe(true)
    expect(collectCalls).toBe(0)
    expect(result.states.gen?.outputs?.out?.kind).toBe('worldEntities')
    if (result.states.gen?.outputs?.out?.kind === 'worldEntities') {
      const parsed = JSON.parse(result.states.gen.outputs.out.text) as Array<{ name: string }>
      expect(parsed.map((item) => item.name)).toEqual(['A', 'B'])
    }
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
