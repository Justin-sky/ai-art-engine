import { describe, expect, it } from 'vitest'
import {
  createDefaultScopedGraph,
  createNodeFromType,
  createOutputGraphNode,
  createShotParamsNodeForShot,
  defaultShotParamsNodeParams,
  ensureShotWorkflowDefaultChain,
  executeShotParamsNode,
  getNodePorts,
  graphOutputNodeId,
  isNodeDeletable,
  normalizeScopedGraph,
  shotStoryboardToNodeParams
} from '../src/shared/graph'
import { createEmptyShot, createEmptyStoryboard } from '../src/shared/domain'

describe('script.shotParams node', () => {
  it('exposes a text output port only and is not a fixed singleton', () => {
    const node = createNodeFromType('script.shotParams', { x: 0, y: 0 })
    const ports = getNodePorts(node)
    expect(ports).toEqual([
      expect.objectContaining({ id: 'out', direction: 'out', dataType: 'text' })
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

  it('shotWorkflow default graph wires video → video-output without shotParams', () => {
    const doc = createDefaultScopedGraph('shotWorkflow')
    const typeIds = doc.nodes.map((node) => node.typeId)
    expect(typeIds).not.toContain('script.shotParams')
    expect(typeIds).toContain('asset.video')
    expect(typeIds).toContain('output.video')

    const video = doc.nodes.find((node) => node.typeId === 'asset.video')!
    const output = doc.nodes.find((node) => node.typeId === 'output.video')!

    expect(doc.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: video.id,
          target: output.id,
          sourcePort: 'out',
          targetPort: 'in'
        })
      ])
    )
  })

  it('empty shotWorkflow normalize uses the default video chain', () => {
    const doc = normalizeScopedGraph('shotWorkflow', null)
    expect(doc.nodes.some((node) => node.typeId === 'script.shotParams')).toBe(false)
    expect(doc.nodes.some((node) => node.typeId === 'asset.video')).toBe(true)
  })

  it('migrates legacy shot graph that only had video output', () => {
    const doc = normalizeScopedGraph('shotWorkflow', {
      nodes: [
        createOutputGraphNode('video', { x: 480, y: 160 }, { id: graphOutputNodeId('video') })
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    })
    expect(doc.nodes.map((node) => node.typeId).sort()).toEqual(
      ['asset.video', 'output.video'].sort()
    )
    const video = doc.nodes.find((node) => node.typeId === 'asset.video')!
    const output = doc.nodes.find((node) => node.typeId === 'output.video')!
    expect(doc.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: video.id,
          target: output.id
        })
      ])
    )
  })

  it('ensureShotWorkflowDefaultChain is idempotent', () => {
    const doc = createDefaultScopedGraph('shotWorkflow')
    const nodes = doc.nodes.map((node) => ({ ...node }))
    const edges = doc.edges.map((edge) => ({ ...edge }))
    ensureShotWorkflowDefaultChain(nodes, edges)
    expect(nodes).toHaveLength(2)
    expect(edges).toHaveLength(1)
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
