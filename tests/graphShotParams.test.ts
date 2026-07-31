import { describe, expect, it } from 'vitest'
import {
  createDefaultScopedGraph,
  createNodeFromType,
  createOutputGraphNode,
  createShotParamsNodeForShot,
  defaultShotParamsNodeParams,
  ensureDefaultGraphFromTemplate,
  resolveDefaultGraphTemplate,
  resolveScopeOutput,
  resolveAssetProcessingTypeId,
  collectAllShotBindingImages,
  executeShotParamsNode,
  getNodePorts,
  graphOutputNodeId,
  isNodeDeletable,
  normalizeScopedGraph,
  resolveShotParamsBindingImageItems,
  shotStoryboardToNodeParams,
  softResolveSourceOutput,
  syncShotParamsBindingsFromShot,
  SHOT_PARAMS_IMAGES_PORT_ID
} from '../src/shared/graph'
import { createEmptyShot, createEmptyStoryboard } from '../src/shared/domain'

describe('script.shotParams node', () => {
  it('exposes text and binding-images output ports and is not a fixed singleton', () => {
    const node = createNodeFromType('script.shotParams', { x: 0, y: 0 })
    const ports = getNodePorts(node)
    expect(ports).toEqual([
      expect.objectContaining({ id: 'out', direction: 'out', dataType: 'text' }),
      expect.objectContaining({ id: 'out-images', direction: 'out', dataType: 'images' })
    ])
    expect(node.id).toMatch(/^node-/)
    expect(node.params.shotStoryboard).toEqual(createEmptyStoryboard())
    expect(isNodeDeletable(node)).toBe(true)
  })

  it('builds prompt text from node params', () => {
    const node = createNodeFromType('script.shotParams', { x: 0, y: 0 }, {
      params: shotStoryboardToNodeParams({
        ...createEmptyStoryboard(),
        visualDescription: '雨夜街道',
        shotSize: '中景',
        lighting: '霓虹'
      })
    })
    const result = executeShotParamsNode({ node, inputs: {} })
    expect(result.out).toEqual({
      kind: 'text',
      text: '雨夜街道；景别：中景；光影：霓虹'
    })
    expect(result['out-images']).toEqual({ kind: 'images', items: [] })
  })

  it('outputs all storyboard binding images on out-images', () => {
    const node = createNodeFromType('script.shotParams', { x: 0, y: 0 }, {
      params: shotStoryboardToNodeParams({
        ...createEmptyStoryboard(),
        characters: [{ name: '角色甲', type: '角色', imageUrl: 'Cache/chars/a.png' }],
        scenes: [{ name: '客厅', type: '场景', imageUrl: 'Cache/scenes/room.png' }],
        props: [{ name: '旧书', type: '道具', imageUrl: 'Cache/props/book.png' }],
        weapons: [{ name: '剑', type: '武器', imageUrl: 'Cache/weapons/sword.png' }]
      })
    })
    const result = executeShotParamsNode({ node, inputs: {} })
    expect(result['out-images']).toEqual({
      kind: 'images',
      items: [
        { id: 'Cache/chars/a.png', dataUrl: '', relativePath: 'Cache/chars/a.png' },
        { id: 'Cache/scenes/room.png', dataUrl: '', relativePath: 'Cache/scenes/room.png' },
        { id: 'Cache/props/book.png', dataUrl: '', relativePath: 'Cache/props/book.png' },
        { id: 'Cache/weapons/sword.png', dataUrl: '', relativePath: 'Cache/weapons/sword.png' }
      ]
    })
  })

  it('sync keeps richer table bindings when live shot lists are empty', () => {
    const node = createNodeFromType('script.shotParams', { x: 0, y: 0 }, {
      params: shotStoryboardToNodeParams(createEmptyStoryboard())
    })
    syncShotParamsBindingsFromShot(
      node,
      {
        storyboard: createEmptyStoryboard(),
        prompt: '',
        camera: { motion: 'static', durationSec: 5 }
      } as never,
      {
        ...createEmptyStoryboard(),
        scenes: [{ name: '客厅', type: '场景', imageUrl: 'Cache/scenes/room.png' }]
      }
    )
    expect(node.params.shotStoryboard?.scenes).toEqual([
      { name: '客厅', type: '场景', imageUrl: 'Cache/scenes/room.png' }
    ])
  })

  it('merges live shot bindings when node params lack imageUrls', () => {
    const node = createNodeFromType('script.shotParams', { x: 0, y: 0 }, {
      params: {
        ...shotStoryboardToNodeParams({
          ...createEmptyStoryboard(),
          characters: [{ name: '角色甲', type: '角色' }]
        }),
        boundShotId: 'shot-1'
      }
    })
    const result = executeShotParamsNode({
      node,
      inputs: {},
      resolveShotStoryboard: () => ({
        storyboard: {
          ...createEmptyStoryboard(),
          characters: [{ name: '角色甲', type: '角色', imageUrl: 'Cache/chars/live.png' }],
          scenes: [{ name: '客厅', type: '场景', imageUrl: 'Cache/scenes/live.png' }]
        }
      })
    })
    expect(result['out-images']).toEqual({
      kind: 'images',
      items: [
        { id: 'Cache/chars/live.png', dataUrl: '', relativePath: 'Cache/chars/live.png' },
        { id: 'Cache/scenes/live.png', dataUrl: '', relativePath: 'Cache/scenes/live.png' }
      ]
    })
  })

  it('out-images prefers all-shot binding images over the bound shot only', () => {
    const node = createNodeFromType('script.shotParams', { x: 0, y: 0 }, {
      params: {
        ...shotStoryboardToNodeParams({
          ...createEmptyStoryboard(),
          scenes: [{ name: '本镜', type: '场景', imageUrl: 'Cache/scenes/current.png' }]
        }),
        boundShotId: 'shot-1'
      }
    })
    const result = executeShotParamsNode({
      node,
      inputs: {},
      resolveAllShotBindingImages: () => [
        { id: 'Cache/scenes/a.png', name: 'A', relativePath: 'Cache/scenes/a.png' },
        { id: 'Cache/scenes/b.png', name: 'B', relativePath: 'Cache/scenes/b.png' }
      ]
    })
    expect(result['out-images']).toEqual({
      kind: 'images',
      items: [
        { id: 'Cache/scenes/a.png', dataUrl: '', relativePath: 'Cache/scenes/a.png' },
        { id: 'Cache/scenes/b.png', dataUrl: '', relativePath: 'Cache/scenes/b.png' }
      ]
    })
  })

  it('soft-resolves all-shot binding images without running the node', () => {
    const node = createNodeFromType('script.shotParams', { x: 0, y: 0 }, {
      id: 'params-1',
      params: shotStoryboardToNodeParams(createEmptyStoryboard())
    })
    const doc = {
      nodes: [node],
      edges: [],
      groups: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
    const value = softResolveSourceOutput(doc, 'params-1', SHOT_PARAMS_IMAGES_PORT_ID, {
      resolveAllShotBindingImages: () => [
        { id: 'Cache/chars/all.png', name: '全剧', relativePath: 'Cache/chars/all.png' }
      ]
    })
    expect(value).toEqual({
      kind: 'images',
      items: [{ id: 'Cache/chars/all.png', dataUrl: '', relativePath: 'Cache/chars/all.png' }]
    })
  })

  it('collectAllShotBindingImages merges every shot and table cache', () => {
    const images = collectAllShotBindingImages({
      shots: [
        {
          id: 's1',
          title: 'A',
          storyboard: {
            ...createEmptyStoryboard(),
            characters: [{ name: '甲', type: '角色', imageUrl: 'Cache/a.png' }]
          }
        },
        {
          id: 's2',
          title: 'B',
          storyboard: {
            ...createEmptyStoryboard(),
            scenes: [{ name: '厅', type: '场景', imageUrl: 'Cache/b.png' }]
          }
        }
      ],
      tableText: JSON.stringify([
        { title: 'A', scenes: [] },
        {
          title: 'B',
          scenes: [{ name: '厅', type: '场景', imageUrl: 'Cache/b-table.png' }]
        }
      ])
    })
    expect(images.map((item) => item.relativePath).sort()).toEqual([
      'Cache/a.png',
      'Cache/b.png'
    ])
    expect(
      resolveShotParamsBindingImageItems({
        node: { params: { shotParamsAllBindingImages: images } },
        resolveAllShotBindingImages: () => null
      }).length
    ).toBe(2)
  })

  it('does not expand legacy @n text in storyboard fields', () => {
    const node = createNodeFromType('script.shotParams', { x: 0, y: 0 }, {
      params: shotStoryboardToNodeParams({
        ...createEmptyStoryboard(),
        visualDescription: '人物看向 @1'
      })
    })
    const result = executeShotParamsNode({ node, inputs: {} })
    expect(result.out).toEqual({ kind: 'text', text: '人物看向 @1' })
  })

  it('uses default empty storyboard params', () => {
    expect(defaultShotParamsNodeParams().shotStoryboard).toEqual(createEmptyStoryboard())
  })

  it('createShotParamsNodeForShot binds shot id and seeds storyboard', () => {
    const base = createEmptyShot('镜A')
    const shot = {
      ...base,
      id: 'shot-1',
      createdAt: 't',
      updatedAt: 't',
      storyboard: {
        ...createEmptyStoryboard(),
        visualDescription: '日景'
      }
    }
    const node = createShotParamsNodeForShot(shot, { x: 10, y: 20 })
    expect(node.params.boundShotId).toBe('shot-1')
    expect(node.params.shotStoryboard?.visualDescription).toBe('日景')
    expect(node.title).toBe('镜A')
  })

  it('shotWorkflow default graph contains video without output or shotParams', () => {
    const doc = createDefaultScopedGraph('shotWorkflow')
    const typeIds = doc.nodes.map((node) => node.typeId)
    expect(typeIds).not.toContain('script.shotParams')
    expect(typeIds).toContain('asset.video')
    expect(typeIds).toContain('graph.boundary.output')
    expect(typeIds.some((typeId) => typeId.startsWith('output.'))).toBe(false)
    expect(doc.edges.length).toBeGreaterThanOrEqual(1)
  })

  it('empty shotWorkflow normalize uses the default video chain', () => {
    const doc = normalizeScopedGraph('shotWorkflow', null)
    expect(doc.nodes.some((node) => node.typeId === 'script.shotParams')).toBe(false)
    expect(doc.nodes.some((node) => node.typeId === 'asset.video')).toBe(true)
  })

  it('strips output-only shot graphs without backfilling video generate', () => {
    const doc = normalizeScopedGraph('shotWorkflow', {
      nodes: [
        createOutputGraphNode('video', { x: 480, y: 160 }, { id: graphOutputNodeId('video') })
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    })
    expect(doc.nodes).toHaveLength(0)
    expect(doc.edges).toHaveLength(0)
  })

  it('ensureDefaultGraphFromTemplate for shotWorkflow is idempotent', () => {
    const doc = createDefaultScopedGraph('shotWorkflow')
    const nodes = doc.nodes.map((node) => ({ ...node }))
    const edges = doc.edges.map((edge) => ({ ...edge }))
    const nodeCount = nodes.length
    const edgeCount = edges.length
    ensureDefaultGraphFromTemplate(nodes, edges, {
      scope: 'shotWorkflow',
      template: resolveDefaultGraphTemplate('shotWorkflow'),
      output: resolveScopeOutput('shotWorkflow'),
      processingTypeId: resolveAssetProcessingTypeId('shotWorkflow')
    })
    expect(nodes).toHaveLength(nodeCount)
    expect(edges).toHaveLength(edgeCount)
    expect(nodes.some((node) => node.typeId === 'asset.video')).toBe(true)
    expect(nodes.some((node) => node.typeId === 'script.shotParams')).toBe(false)
  })

  it('does not recreate shotParams after user deleted it', () => {
    const video = createNodeFromType('asset.video', { x: 300, y: 160 })
    const output = createOutputGraphNode('video', { x: 520, y: 160 }, {
      id: graphOutputNodeId('video')
    })
    const doc = normalizeScopedGraph('shotWorkflow', {
      nodes: [video, output],
      edges: [
        {
          id: 'edge-1',
          source: video.id,
          target: output.id,
          sourcePort: 'out',
          targetPort: 'in'
        }
      ],
      viewport: { x: 0, y: 0, zoom: 1 }
    })
    expect(doc.nodes.some((node) => node.typeId === 'script.shotParams')).toBe(false)
    expect(doc.nodes.some((node) => node.typeId === 'asset.video')).toBe(true)
  })

  it('allows multiple shotParams nodes on one graph', () => {
    const a = createNodeFromType('script.shotParams', { x: 0, y: 0 })
    const b = createNodeFromType('script.shotParams', { x: 40, y: 40 })
    expect(a.id).not.toBe(b.id)
  })
})
