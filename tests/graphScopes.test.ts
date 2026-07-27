import { describe, expect, it } from 'vitest'
import {
  canScopeAcceptDraggedAsset,
  createDefaultScopedGraph,
  createParamsForScope,
  getGraphScopeDefinition,
  getScopeHostIdSuffix,
  getScopeShotCanvasField,
  normalizeScopedGraph,
  registerGraphScope,
  registerGraphScopeHost,
  resolveDefaultGraphTemplate,
  resolveGraphScope,
  resolveScopeOutput
} from '../src/shared/graph'
import { createNodeFromType, createOutputGraphNode } from '../src/shared/graph'

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

  it('director / script / world / narrative scopes resolve default graph templates', () => {
    expect(resolveDefaultGraphTemplate('directorAsset')?.nodes.map((n) => n.key)).toEqual([
      'gen',
      'out'
    ])
    expect(resolveDefaultGraphTemplate('scriptAsset')?.inputLinkTo).toBe('split')
    expect(getGraphScopeDefinition('worldAsset').ensureOutput).toBe(false)
    expect(resolveDefaultGraphTemplate('worldAsset')?.nodes.map((n) => n.typeId)).toEqual([
      'world.extract',
      'world.table',
      'world.gen',
      'output.world'
    ])
    expect(getGraphScopeDefinition('narrativeAsset').ensureOutput).toBe(false)
    expect(resolveDefaultGraphTemplate('narrativeAsset')?.nodes.some((n) => n.typeId === 'text.select')).toBe(
      true
    )
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

  it('visual scope defaults to image generate connected to image output', () => {
    const doc = createDefaultScopedGraph('visual')
    const image = doc.nodes.find((n) => n.typeId === 'asset.image')
    const output = doc.nodes.find((n) => n.typeId === 'output.image')
    expect(image).toBeTruthy()
    expect(output).toBeTruthy()
    expect(output?.params.inputDataType).toBe('image')
    expect(
      doc.edges.some((edge) => edge.source === image?.id && edge.target === output?.id)
    ).toBe(true)
  })

  it('shotWorkflow scope defaults to video generate connected to video output', () => {
    const doc = createDefaultScopedGraph('shotWorkflow')
    const video = doc.nodes.find((n) => n.typeId === 'asset.video')
    const output = doc.nodes.find((n) => n.typeId === 'output.video')
    expect(video).toBeTruthy()
    expect(output).toBeTruthy()
    expect(
      doc.edges.some((edge) => edge.source === video?.id && edge.target === output?.id)
    ).toBe(true)
  })

  it('visual scope does not backfill generate node onto output-only graphs', () => {
    const doc = normalizeScopedGraph('visual', {
      nodes: [
        createOutputGraphNode('image', { x: 520, y: 160 }, {
          id: 'image-output',
          params: { outputKind: 'image', inputDataType: 'image' }
        })
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    })
    expect(doc.nodes.some((n) => n.typeId === 'asset.image')).toBe(false)
    expect(doc.nodes.some((n) => n.typeId === 'output.image')).toBe(true)
  })

  it('visual scope collapses multiple image outputs to one', () => {
    const a = createOutputGraphNode('image', { x: 400, y: 100 }, {
      id: 'node-out-a',
      params: { outputKind: 'image', inputDataType: 'image' }
    })
    const b = createOutputGraphNode('image', { x: 600, y: 100 }, {
      id: 'image-output',
      params: { outputKind: 'image', inputDataType: 'image' }
    })
    const img = createNodeFromType('asset.image', { x: 0, y: 0 }, { id: 'img-1' })
    const doc = normalizeScopedGraph('visual', {
      nodes: [img, a, b],
      edges: [
        { id: 'e1', source: 'img-1', target: 'node-out-a', sourcePort: 'out', targetPort: 'in' },
        { id: 'e2', source: 'img-1', target: 'image-output', sourcePort: 'out', targetPort: 'in' }
      ],
      viewport: { x: 0, y: 0, zoom: 1 }
    })
    const outputs = doc.nodes.filter((n) => n.category === 'output')
    expect(outputs).toHaveLength(1)
    expect(outputs[0]?.id).toBe('image-output')
    expect(outputs[0]?.typeId).toBe('output.image')
    expect(doc.edges.every((e) => e.target === 'image-output' || e.source === 'img-1')).toBe(true)
    expect(doc.edges.some((e) => e.source === 'img-1' && e.target === 'image-output')).toBe(true)
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
