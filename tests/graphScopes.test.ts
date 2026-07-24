import { describe, expect, it } from 'vitest'
import {
  canScopeAcceptDraggedAsset,
  createParamsForScope,
  getGraphScopeDefinition,
  getScopeHostIdSuffix,
  getScopeShotCanvasField,
  normalizeScopedGraph,
  registerGraphScope,
  registerGraphScopeHost,
  resolveGraphScope,
  resolveScopeOutput
} from '../src/shared/graph'
import { createNodeFromType } from '../src/shared/graph'

describe('graph scopes', () => {
  it('resolves scope from editor host context', () => {
    expect(resolveGraphScope({ assetId: 'a1', assetType: 'screenplay' })).toBe('screenplayAsset')
    expect(resolveGraphScope({ assetId: 'a1', assetType: 'motion' })).toBe('directorAsset')
    expect(resolveGraphScope({ assetId: 'a1', assetType: 'script' })).toBe('scriptAsset')
    expect(resolveGraphScope({ assetId: 'a1', assetType: 'image' })).toBe('workflow')
    expect(resolveGraphScope({})).toBe('shotWorkflow')
  })

  it('workflow scope coerces output by asset type', () => {
    const output = resolveScopeOutput('workflow', 'voice')
    expect(output.kind).toBe('voice')
    expect(output.title).toBe('Voice output')
  })

  it('visual scope keeps nodes from every supported type', () => {
    const doc = normalizeScopedGraph('visual', {
      nodes: [
        createNodeFromType('asset.image', { x: 0, y: 0 }),
        createNodeFromType('play.script', { x: 0, y: 0 }),
        createNodeFromType('asset.screenplay', { x: 0, y: 0 })
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    })
    const typeIds = doc.nodes.map((node) => node.typeId).sort()
    expect(typeIds).toEqual(['asset.image', 'asset.screenplay', 'output.image', 'play.script'])
  })

  it('shot workflow does not coerce existing output kind', () => {
    const doc = normalizeScopedGraph('shotWorkflow', {
      nodes: [
        createNodeFromType('output.image', { x: 0, y: 0 }, {
          params: { outputKind: 'image' }
        })
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    })
    const imageOutput = doc.nodes.find((node) => node.typeId === 'output.image')
    expect(imageOutput?.params.outputKind).toBe('image')
  })

  it('create params for screenplay processing outside visual scope', () => {
    expect(createParamsForScope('workflow', 'asset.screenplay')).toEqual({
      inputDataType: 'text'
    })
    expect(createParamsForScope('visual', 'asset.screenplay')).toBeUndefined()
  })

  it('director scope uses processing chain instead of camera singleton', () => {
    const def = getGraphScopeDefinition('directorAsset')
    expect(def.ensureSingletonTypeIds).toBeUndefined()
  })

  it('script scope ensures launcher singletons', () => {
    const def = getGraphScopeDefinition('scriptAsset')
    expect(def.ensureSingletonTypeIds).toEqual([
      'script.shotSplit',
      'script.shotTable',
      'script.shotEditor'
    ])
  })

  it('world scope ensures extract / table / editor singletons', () => {
    const def = getGraphScopeDefinition('worldAsset')
    expect(def.ensureSingletonTypeIds).toEqual([
      'world.extract',
      'world.table',
      'world.editor'
    ])
  })

  it('narrative scope ensures split / table / editor / output singletons', () => {
    const def = getGraphScopeDefinition('narrativeAsset')
    expect(def.ensureOutput).toBe(false)
    expect(def.ensureSingletonTypeIds).toEqual([
      'narrative.split',
      'narrative.table',
      'narrative.editor',
      'output.narrative'
    ])
  })

  it('allows registering custom graph scopes', () => {
    const dispose = registerGraphScope({
      id: 'plugin.demo',
      output: { kind: 'image', title: 'Demo output' },
      persistNode: (node) => node.typeId === 'play.script'
    })
    const def = getGraphScopeDefinition('plugin.demo')
    expect(def.output.title).toBe('Demo output')
    dispose()
    expect(() => getGraphScopeDefinition('plugin.demo')).toThrow()
  })

  it('allows registering custom scope host bindings', () => {
    const disposeScope = registerGraphScope({
      id: 'plugin.model',
      output: { kind: 'image', title: 'Model output' }
    })
    const disposeHost = registerGraphScopeHost({
      assetType: 'model',
      scope: 'plugin.model',
      priority: 200
    })
    expect(resolveGraphScope({ assetId: 'a1', assetType: 'model' })).toBe('plugin.model')
    disposeHost()
    disposeScope()
    expect(resolveGraphScope({ assetId: 'a1', assetType: 'model' })).toBe('workflow')
  })

  it('visual scope uses dedicated shot canvas field and host suffix', () => {
    expect(getScopeShotCanvasField('visual')).toBe('visualGraphJson')
    expect(getScopeShotCanvasField('shotWorkflow')).toBe('graphJson')
    expect(getScopeHostIdSuffix('visual')).toBe('visual')
    expect(getScopeHostIdSuffix('shotWorkflow')).toBeUndefined()
  })

  it('custom scope can declare shot canvas persistence', () => {
    const dispose = registerGraphScope({
      id: 'plugin.shotAlt',
      output: { kind: 'image', title: 'Alt output' },
      shotCanvasField: 'visualGraphJson',
      hostIdSuffix: 'alt'
    })
    expect(getScopeShotCanvasField('plugin.shotAlt')).toBe('visualGraphJson')
    expect(getScopeHostIdSuffix('plugin.shotAlt')).toBe('alt')
    dispose()
  })

  it('allows every asset type in every builtin scope', () => {
    expect(canScopeAcceptDraggedAsset('shotWorkflow', 'image')).toBe(true)
    expect(canScopeAcceptDraggedAsset('shotWorkflow', 'script')).toBe(true)
    expect(canScopeAcceptDraggedAsset('visual', 'screenplay')).toBe(true)
    expect(canScopeAcceptDraggedAsset('visual', 'image')).toBe(true)
    expect(canScopeAcceptDraggedAsset('screenplayAsset', 'screenplay')).toBe(true)
    expect(canScopeAcceptDraggedAsset('directorAsset', 'motion')).toBe(true)
    expect(canScopeAcceptDraggedAsset('scriptAsset', 'model')).toBe(true)
  })

  it('custom scope drag whitelist', () => {
    const dispose = registerGraphScope({
      id: 'plugin.model',
      output: { kind: 'image', title: 'Model output' },
      dragAssets: { allowTypes: ['model', 'image'] }
    })
    expect(canScopeAcceptDraggedAsset('plugin.model', 'model')).toBe(true)
    expect(canScopeAcceptDraggedAsset('plugin.model', 'video')).toBe(false)
    dispose()
  })
})
