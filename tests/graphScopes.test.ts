import { describe, expect, it } from 'vitest'
import {
  boundaryInputNodeId,
  canScopeAcceptDraggedAsset,
  createDefaultScopedGraph,
  createParamsForScope,
  getGraphScopeDefinition,
  getScopeHostIdSuffix,
  normalizeScopedGraph,
  registerGraphScope,
  registerGraphScopeHost,
  resolveDefaultGraphTemplate,
  resolveGraphScope,
  resolveScopeOutput
} from '../src/shared/graph'
import { createNodeFromType } from '../src/shared/graph'

describe('graph scopes', () => {
  it('resolves scope from editor host context', () => {
    expect(resolveGraphScope({ assetId: 'a1', assetType: 'screenplay' })).toBe('screenplayAsset')
    expect(resolveGraphScope({ assetId: 'a1', assetType: 'motion' })).toBe('directorAsset')
    expect(resolveGraphScope({ assetId: 'a1', assetType: 'image' })).toBe('workflow')
    expect(resolveGraphScope({})).toBe('workflow')
  })

  it('workflow scope coerces output by asset type', () => {
    const output = resolveScopeOutput('workflow', 'voice')
    expect(output.kind).toBe('voice')
    expect(output.title).toBe('Voice output')
  })

  it('create params for screenplay processing', () => {
    expect(createParamsForScope('workflow', 'asset.screenplay')).toEqual({
      inputDataType: 'text'
    })
  })

  it('director / world / beat scopes resolve default graph templates', () => {
    expect(resolveDefaultGraphTemplate('directorAsset')?.nodes.map((n) => n.key)).toEqual([
      'gen'
    ])
    expect(getGraphScopeDefinition('worldAsset').ensureOutput).toBe(false)
    expect(resolveDefaultGraphTemplate('worldAsset')?.nodes.map((n) => n.typeId)).toEqual([
      'world.extract',
      'world.table',
      'world.gen'
    ])
    expect(getGraphScopeDefinition('beatAsset').ensureOutput).toBe(false)
    expect(
      resolveDefaultGraphTemplate('beatAsset')?.nodes.map((n) => n.typeId)
    ).toEqual(['beat.split', 'beat.table'])
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

  it('custom scope can declare host id suffix', () => {
    const dispose = registerGraphScope({
      id: 'plugin.shotAlt',
      output: { kind: 'image', title: 'Alt output' },
      hostIdSuffix: 'alt'
    })
    expect(getScopeHostIdSuffix('plugin.shotAlt')).toBe('alt')
    dispose()
  })

  it('allows every asset type in every builtin scope', () => {
    expect(canScopeAcceptDraggedAsset('screenplayAsset', 'screenplay')).toBe(true)
    expect(canScopeAcceptDraggedAsset('directorAsset', 'motion')).toBe(true)
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
