import { describe, expect, it, beforeEach } from 'vitest'
import {
  canConnectNodes,
  createAssetGraphNode,
  createNodeFromType,
  createOutputGraphNode,
  getGraphPolicy,
  getScopePolicy,
  isNodeAddableInScope,
  listAddableNodeTypes,
  matchesTypeIdPattern,
  mergeGraphPolicy,
  resetGraphPolicyForTests
} from '../src/shared/graph'
import { graphOutputNodeId } from '../src/shared/graph/types'

describe('graph policy', () => {
  beforeEach(() => {
    resetGraphPolicyForTests()
  })

  it('loads builtin policy with expected scopes', () => {
    const policy = getGraphPolicy()
    expect(policy.version).toBe(1)
    expect(Object.keys(policy.scopes).sort()).toEqual(
      [
        'canvasAsset',
        'directorAsset',
        'elementWorkflow',
        'narrativeAsset',
        'narrativeUnit',
        'screenplayAsset',
        'scriptAsset',
        'shotWorkflow',
        'visual',
        'workflow',
        'worldAsset'
      ].sort()
    )
  })

  it('matches typeId wildcard patterns', () => {
    expect(matchesTypeIdPattern('*', 'plugin.any.node')).toBe(true)
    expect(matchesTypeIdPattern('asset.*', 'asset.image')).toBe(true)
    expect(matchesTypeIdPattern('output.*', 'output.video')).toBe(true)
    expect(matchesTypeIdPattern('asset.*', 'play.script')).toBe(false)
    expect(matchesTypeIdPattern('play.script', 'play.script')).toBe(true)
  })

  it('all builtin scopes use the all-node addable wildcard', () => {
    for (const scope of [
      'workflow',
      'shotWorkflow',
      'visual',
      'screenplayAsset',
      'directorAsset',
      'scriptAsset',
      'canvasAsset'
    ]) {
      expect(getScopePolicy(scope)!.addableNodeTypes).toEqual(['*'])
    }
    expect(isNodeAddableInScope('directorAsset', 'asset.motion')).toBe(true)
    expect(isNodeAddableInScope('directorAsset', 'asset.image')).toBe(true)
    expect(isNodeAddableInScope('visual', 'play.script')).toBe(true)
    expect(isNodeAddableInScope('scriptAsset', 'script.shotSplit')).toBe(true)
  })

  it('rejects every output node in every builtin scope and menu', () => {
    for (const scope of Object.keys(getGraphPolicy().scopes)) {
      for (const typeId of [
        'output.image',
        'output.video',
        'output.voice',
        'output.text',
        'output.director',
        'output.timeline',
        'output.narrative',
        'output.narrativeUnit',
        'output.world'
      ]) {
        expect(isNodeAddableInScope(scope, typeId), `${scope}: ${typeId}`).toBe(false)
      }
      expect(
        listAddableNodeTypes(scope).some((definition) => definition.typeId.startsWith('output.')),
        scope
      ).toBe(false)
    }
  })

  it('listAddableNodeTypes follows policy', () => {
    const typeIds = listAddableNodeTypes('shotWorkflow')
      .map((def) => def.typeId)
      .sort()
    expect(typeIds).toEqual(
      [
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
        'voice.select',
        'video.lipSync',
        'image.toPrompt',
        'image.upscale',
        'prompt.optimize',
        'narrative.select',
        'narrative.split',
        'narrative.table',
        'narrative.unitGen',
        'narrative.unitRef',
        'text.select',
        'script.shotImageGen',
        'script.shotVideoGen',
        'script.shotParams',
        'script.shotSplit',
        'script.shotTable',
        'world.gen',
        'world.extract',
        'world.table'
      ].sort()
    )
  })

  it('allows image processing and image refs to connect to image output', () => {
    const output = createOutputGraphNode('image', { x: 400, y: 0 }, {
      id: graphOutputNodeId('image'),
      params: { outputKind: 'image' }
    })
    const ref = createAssetGraphNode('00000000-0000-4000-8000-000000000101', 'image', 'Ref', { x: 0, y: 0 })
    const processing = createNodeFromType('asset.image', { x: 200, y: 0 })
    expect(canConnectNodes(ref, processing)).toBe(true)
    expect(canConnectNodes(processing, output)).toBe(true)
    expect(canConnectNodes(ref, output)).toBe(true)
  })

  it('rejects model and image references connecting to director (no input ports)', () => {
    const modelRef = createAssetGraphNode('00000000-0000-4000-8000-000000000201', 'model', 'Model', { x: 0, y: 0 })
    const director = createNodeFromType('asset.motion', { x: 200, y: 0 })
    const imageRef = createAssetGraphNode('00000000-0000-4000-8000-000000000202', 'image', 'Image', { x: 0, y: 160 })
    const videoRef = createAssetGraphNode('00000000-0000-4000-8000-000000000203', 'video', 'Video', { x: 0, y: 240 })

    expect(canConnectNodes(modelRef, director)).toBe(false)
    expect(canConnectNodes(imageRef, director)).toBe(false)
    expect(canConnectNodes(videoRef, director)).toBe(false)
  })

  it('merges plugin policy overlays and dispose removes overlay scope', () => {
    expect(getScopePolicy('plugin.test')).toBeUndefined()
    const dispose = mergeGraphPolicy('test.plugin', {
      scopes: {
        'plugin.test': {
          addableNodeTypes: ['plugin.test.node']
        }
      }
    })
    expect(getScopePolicy('plugin.test')!.addableNodeTypes).toEqual(['plugin.test.node'])
    expect(isNodeAddableInScope('plugin.test', 'plugin.test.node')).toBe(true)
    expect(isNodeAddableInScope('plugin.test', 'note.text')).toBe(false)
    dispose()
    expect(getScopePolicy('plugin.test')).toBeUndefined()
  })
})
