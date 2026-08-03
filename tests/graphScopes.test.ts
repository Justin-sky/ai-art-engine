import { describe, expect, it } from 'vitest'
import {
  boundaryInputNodeId,
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
    expect(typeIds).toEqual([
      'asset.image',
      'asset.screenplay',
      'graph.boundary.output',
      'play.script'
    ])
  })

  it('shot workflow strips existing classic outputs', () => {
    const doc = normalizeScopedGraph('shotWorkflow', {
      nodes: [
        createNodeFromType('output.image', { x: 0, y: 0 }, {
          params: { outputKind: 'image' }
        })
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    })
    expect(doc.nodes).toHaveLength(0)
    expect(doc.edges).toHaveLength(0)
  })

  it('create params for screenplay processing outside visual scope', () => {
    expect(createParamsForScope('workflow', 'asset.screenplay')).toEqual({
      inputDataType: 'text'
    })
    expect(createParamsForScope('visual', 'asset.screenplay')).toBeUndefined()
  })

  it('director / script / world / beat scopes resolve default graph templates', () => {
    expect(resolveDefaultGraphTemplate('directorAsset')?.nodes.map((n) => n.key)).toEqual([
      'gen'
    ])
    expect(resolveDefaultGraphTemplate('scriptAsset')?.inputLinkTo).toEqual(['split', 'table'])
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

  it('visual scope defaults to image generate with boundary output', () => {
    const doc = createDefaultScopedGraph('visual')
    const image = doc.nodes.find((n) => n.typeId === 'asset.image')
    const bout = doc.nodes.find((n) => n.typeId === 'graph.boundary.output')
    expect(image).toBeTruthy()
    expect(bout).toBeTruthy()
    expect(bout?.params.hostBoundaryPort).toMatchObject({
      portId: 'out',
      dataType: 'image'
    })
    expect(doc.nodes.some((node) => node.category === 'output')).toBe(false)
    expect(
      doc.edges.some(
        (e) => e.source === image!.id && e.target === bout!.id && (e.targetPort ?? 'in') === 'in'
      )
    ).toBe(true)
  })

  it('shotWorkflow scope defaults to video generate with boundary output', () => {
    const doc = createDefaultScopedGraph('shotWorkflow')
    const video = doc.nodes.find((n) => n.typeId === 'asset.video')
    const bout = doc.nodes.find((n) => n.typeId === 'graph.boundary.output')
    expect(video).toBeTruthy()
    expect(bout).toBeTruthy()
    expect(bout?.params.hostBoundaryPort).toMatchObject({
      portId: 'out',
      dataType: 'video'
    })
    expect(doc.nodes.some((node) => node.category === 'output')).toBe(false)
    expect(
      doc.edges.some(
        (e) => e.source === video!.id && e.target === bout!.id && (e.targetPort ?? 'in') === 'in'
      )
    ).toBe(true)
  })

  it('shotWorkflow wires video to primary boundary even when video already feeds a side boundary', () => {
    const video = createNodeFromType('asset.video', { x: 300, y: 160 }, { id: 'vid-1' })
    const sideOut = {
      id: 'graph-boundary-out-side',
      typeId: 'graph.boundary.output' as const,
      category: 'note' as const,
      position: { x: 520, y: 200 },
      title: 'Side',
      params: {
        hostBoundaryPort: { portId: 'side', dataType: 'video' as const, multiple: false }
      }
    }
    const doc = normalizeScopedGraph('shotWorkflow', {
      nodes: [video, sideOut],
      edges: [
        {
          id: 'e-side',
          source: 'vid-1',
          target: sideOut.id,
          sourcePort: 'out',
          targetPort: 'in'
        }
      ],
      viewport: { x: 0, y: 0, zoom: 1 }
    })
    const bout = doc.nodes.find((n) => n.id === 'graph-boundary-out-out')
    expect(bout).toBeTruthy()
    expect(
      doc.edges.some(
        (e) => e.source === 'vid-1' && e.target === bout!.id && (e.targetPort ?? 'in') === 'in'
      )
    ).toBe(true)
    // 旁路边界保留
    expect(doc.edges.some((e) => e.source === 'vid-1' && e.target === sideOut.id)).toBe(true)
  })

  it('normalizeScopedGraph backfills shot boundary output without dropping bound inputs', () => {
    const boundIn = boundaryInputNodeId('bind-park')
    const doc = normalizeScopedGraph('visual', {
      nodes: [
        {
          id: 'img',
          typeId: 'asset.image',
          category: 'asset',
          assetType: 'image',
          position: { x: 300, y: 160 },
          params: {}
        },
        {
          id: boundIn,
          typeId: 'graph.boundary.input',
          category: 'note',
          position: { x: 40, y: 40 },
          title: '公园',
          params: {
            hostBoundaryPort: { portId: 'bind-park', dataType: 'image', multiple: false },
            previewRelativePath: 'Assets/scenes/park.png'
          }
        }
      ],
      edges: [
        {
          id: 'e-bind',
          source: boundIn,
          target: 'img',
          sourcePort: 'out',
          targetPort: 'in-image'
        }
      ],
      viewport: { x: 0, y: 0, zoom: 1 }
    })
    expect(doc.nodes.some((n) => n.id === boundIn)).toBe(true)
    const bout = doc.nodes.find((n) => n.typeId === 'graph.boundary.output')
    expect(bout).toBeTruthy()
    expect(
      doc.edges.some((e) => e.source === 'img' && e.target === bout!.id)
    ).toBe(true)
    expect(
      doc.edges.some((e) => e.source === boundIn && e.target === 'img')
    ).toBe(true)
  })

  it('visual scope strips output-only graphs without backfilling generate nodes', () => {
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
    expect(doc.nodes).toHaveLength(0)
  })

  it('visual scope strips multiple image outputs and their edges', () => {
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
    expect(doc.nodes.map((node) => node.id).sort()).toEqual([
      'graph-boundary-out-out',
      'img-1'
    ])
    expect(
      doc.edges.some(
        (e) => e.source === 'img-1' && e.target === 'graph-boundary-out-out'
      )
    ).toBe(true)
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
