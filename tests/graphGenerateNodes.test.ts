import { describe, expect, it } from 'vitest'
import {
  createNodeFromType,
  getNodePorts,
  isNodeDeletable,
  listAddableNodeTypes
} from '../src/shared/graph'
import { graphOutputNodeId } from '../src/shared/graph/types'

const CANVAS_ADDABLE_NODE_TYPES = [
  'asset.image',
  'asset.motion',
  'asset.screenplay',
  'asset.script',
  'asset.video',
  'asset.voice',
  'note.text',
  'play.script',
  'image.crop',
  'image.emotion',
  'image.erase',
  'image.expand',
  'image.gridSplit',
  'image.lighting',
  'image.matte',
  'image.multiAngle',
  'image.portraitTexture',
  'image.redraw',
  'image.select',
  'video.select',
  'video.lipSync',
  'image.toPrompt',
  'image.upscale',
  'prompt.optimize',
  'narrative.gen',
  'narrative.unitGen',
  'narrative.unitRef',
  'narrative.split',
  'narrative.table',
  'text.select',
  'script.shotImageGen',
  'script.shotVideoGen',
  'script.shotParams',
  'script.shotSplit',
  'script.shotTable',
  'world.gen',
  'world.extract',
  'world.table'
] as const

const CANVAS_OUTPUT_NODE_TYPES = [
  'output.image',
  'output.video',
  'output.voice',
  'output.director',
  'output.timeline',
  'output.narrative',
  'output.narrativeUnit',
  'output.world',
  'output.text'
] as const

describe('graph canvas menu nodes', () => {
  for (const scope of [
    'workflow',
    'screenplayAsset',
    'directorAsset',
    'scriptAsset'
  ] as const) {
    it(`${scope} exposes every addable node type except outputs`, () => {
      const typeIds = listAddableNodeTypes(scope)
        .map((def) => def.typeId)
        .sort()
      expect(typeIds).toEqual([...CANVAS_ADDABLE_NODE_TYPES].sort())
    })
  }

  it('shotWorkflow exposes generate nodes plus video output', () => {
    const typeIds = listAddableNodeTypes('shotWorkflow')
      .map((def) => def.typeId)
      .sort()
    expect(typeIds).toEqual([...CANVAS_ADDABLE_NODE_TYPES, 'output.video'].sort())
  })

  it('visual exposes generate nodes plus image output', () => {
    const typeIds = listAddableNodeTypes('visual')
      .map((def) => def.typeId)
      .sort()
    expect(typeIds).toEqual([...CANVAS_ADDABLE_NODE_TYPES, 'output.image'].sort())
  })

  it('canvasAsset exposes generate nodes plus output nodes', () => {
    const typeIds = listAddableNodeTypes('canvasAsset')
      .map((def) => def.typeId)
      .sort()
    expect(typeIds).toEqual([...CANVAS_ADDABLE_NODE_TYPES, ...CANVAS_OUTPUT_NODE_TYPES].sort())
  })

  it('extra canvas output nodes are deletable while fixed scope output is not', () => {
    const fixed = createNodeFromType('output.image', { x: 0, y: 0 }, { id: graphOutputNodeId('image') })
    const extraA = createNodeFromType('output.video', { x: 40, y: 0 }, { id: 'node-out-a' })
    const extraB = createNodeFromType('output.director', { x: 80, y: 0 }, { id: 'node-out-b' })
    expect(isNodeDeletable(fixed)).toBe(false)
    expect(isNodeDeletable(extraA)).toBe(true)
    expect(isNodeDeletable(extraB)).toBe(true)
    expect(extraA.id).not.toBe(extraB.id)
  })

  it('generate asset nodes have input and output ports', () => {
    for (const typeId of [
      'asset.image',
      'asset.video',
      'asset.voice',
      'asset.screenplay'
    ] as const) {
      const node = createNodeFromType(typeId, { x: 0, y: 0 })
      const ports = getNodePorts(node)
      expect(ports.some((port) => port.direction === 'in')).toBe(true)
      expect(ports.some((port) => port.direction === 'out')).toBe(true)
    }
  })

  it('director generate node only exposes output ports', () => {
    const node = createNodeFromType('asset.motion', { x: 0, y: 0 })
    const ports = getNodePorts(node)
    expect(ports.some((port) => port.direction === 'in')).toBe(false)
    expect(ports.some((port) => port.direction === 'out')).toBe(true)
  })

  it('asset reference nodes only expose output ports', () => {
    const node = createNodeFromType('asset.image', { x: 0, y: 0 }, {
      assetId: '00000000-0000-4000-8000-000000000001',
      assetType: 'image',
      params: { assetRef: true }
    })
    const ports = getNodePorts(node)
    expect(ports.every((port) => port.direction === 'out')).toBe(true)
  })
})
