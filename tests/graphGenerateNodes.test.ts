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
  'asset.gameSystem',
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
  'voice.select',
  'video.lipSync',
  'video.framePull',
  'video.reshoot',
  'image.toPrompt',
  'image.upscale',
  'prompt.optimize',
  'beat.unitGen',
  'beat.unitRef',
  'beat.select',
  'episode.anchorSelect',
  'episode.cellSelect',
  'beat.split',
  'ui.split',
  'beat.table',
  'text.select',
  'world.gen',
  'world.extract',
  'world.table'
] as const

describe('graph canvas menu nodes', () => {
  for (const scope of ['workflow', 'screenplayAsset', 'directorAsset'] as const) {
    it(`${scope} exposes every addable node type except outputs`, () => {
      const typeIds = listAddableNodeTypes(scope)
        .map((def) => def.typeId)
        .sort()
      expect(typeIds).toEqual([...CANVAS_ADDABLE_NODE_TYPES].sort())
    })
  }

  it('canvasAsset exposes generate nodes plus the timeline output', () => {
    const typeIds = listAddableNodeTypes('canvasAsset')
      .map((def) => def.typeId)
      .sort()
    expect(typeIds).toEqual([...CANVAS_ADDABLE_NODE_TYPES, 'output.timeline'].sort())
  })

  it('classic output nodes are deletable', () => {
    const fixed = createNodeFromType('output.image', { x: 0, y: 0 }, { id: graphOutputNodeId('image') })
    const extraA = createNodeFromType('output.video', { x: 40, y: 0 }, { id: 'node-out-a' })
    const extraB = createNodeFromType('output.director', { x: 80, y: 0 }, { id: 'node-out-b' })
    expect(isNodeDeletable(fixed)).toBe(true)
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
