import { describe, expect, it } from 'vitest'
import {
  createAssetGraphNode,
  createNodeFromType,
  encapsulateSelection,
  ensureBuiltinNodeTypes,
  findAllOutputNodes,
  getNodePorts,
  HOST_INTERFACE_FORMAT_VERSION,
  listHostInputPortDefs,
  mapHostBoundaryStatesToOutputs,
  pruneEdgesForHostInterface,
  sanitizeHostInterface,
  defaultHostInterfaceForAssetType,
  ensureBoundaryProxyNodes,
  boundaryInputNodeId,
  boundaryOutputNodeId,
  readHostInterfaceFromGenParams,
  type GraphDocument
} from '../src/shared/graph'

ensureBuiltinNodeTypes()

const HOST_A = '00000000-0000-4000-8000-0000000000a1'
const HOST_B = '00000000-0000-4000-8000-0000000000a2'
const HOST_C = '00000000-0000-4000-8000-0000000000a3'

describe('hostInterface sanitize', () => {
  it('drops invalid ports and dedupes ids', () => {
    const doc = sanitizeHostInterface({
      version: 1,
      inputs: [
        { id: 'in', label: 'In', dataType: 'text', multiple: true },
        { id: 'in', label: 'Dup', dataType: 'image' },
        { id: 'bad', label: 'Bad', dataType: 'not-a-type' },
        null
      ],
      outputs: [{ id: 'out', label: 'Out', dataType: 'text' }]
    })
    expect(doc.version).toBe(HOST_INTERFACE_FORMAT_VERSION)
    expect(doc.inputs).toHaveLength(1)
    expect(doc.inputs[0]?.id).toBe('in')
    expect(doc.outputs).toHaveLength(1)
  })

  it('preserves port description, notes, and file path', () => {
    const doc = sanitizeHostInterface({
      version: 1,
      inputs: [
        {
          id: 'in',
          label: 'In',
          dataType: 'text',
          description: '入口说明',
          notes: '备注',
          fileRelativePath: 'docs\\ports\\in.md'
        }
      ],
      outputs: []
    })
    expect(doc.inputs[0]?.description).toBe('入口说明')
    expect(doc.inputs[0]?.notes).toBe('备注')
    expect(doc.inputs[0]?.fileRelativePath).toBe('docs/ports/in.md')
  })

  it('reads from genParams with assetType fallback', () => {
    const fromParams = readHostInterfaceFromGenParams({
      hostInterface: {
        version: 1,
        inputs: [{ id: 'a', label: 'A', dataType: 'image' }],
        outputs: [{ id: 'b', label: 'B', dataType: 'video' }]
      }
    })
    expect(fromParams.inputs[0]?.id).toBe('a')
    expect(fromParams.outputs[0]?.dataType).toBe('video')

    const fallback = readHostInterfaceFromGenParams({}, 'script')
    expect(fallback.inputs.map((p) => p.id)).toEqual([
      'in-worldEntities',
      'in-narrativeEntity'
    ])
  })

  it('unifies listHostInputPortDefs with default templates', () => {
    expect(listHostInputPortDefs('image')).toEqual(
      defaultHostInterfaceForAssetType('image').inputs.map((p) => ({
        id: p.id,
        dataType: p.dataType
      }))
    )
    expect(listHostInputPortDefs('subgraph').length).toBeGreaterThan(0)
  })
})

describe('encapsulation', () => {
  function makeDoc(): GraphDocument {
    const a = createNodeFromType('play.script', { x: 40, y: 40 }, {
      title: 'A',
      params: { text: 'hello' }
    })
    a.id = 'n-a'
    const b = createNodeFromType('prompt.optimize', { x: 260, y: 40 }, {
      title: 'B'
    })
    b.id = 'n-b'
    const c = createNodeFromType('output.text', { x: 480, y: 40 }, {
      title: 'C'
    })
    c.id = 'n-c'
    return {
      nodes: [a, b, c],
      edges: [
        { id: 'e1', source: 'n-a', target: 'n-b', sourcePort: 'out', targetPort: 'in' },
        { id: 'e2', source: 'n-b', target: 'n-c', sourcePort: 'out', targetPort: 'in' }
      ],
      runStates: {
        'n-a': { status: 'done', outputs: { out: { kind: 'text', text: 'A' } } },
        'n-b': { status: 'done', outputs: { out: { kind: 'text', text: 'B' } } },
        'n-c': { status: 'idle' }
      },
      viewport: { x: 0, y: 0, zoom: 1 }
    }
  }

  it('encapsulates single-in single-out selection', () => {
    const doc = makeDoc()
    const result = encapsulateSelection(doc, {
      selectedNodeIds: ['n-b'],
      hostAssetId: HOST_A,
      hostAssetName: 'Host'
    })
    expect(result.hostInterface.inputs).toHaveLength(1)
    expect(result.hostInterface.outputs).toHaveLength(1)
    expect(result.hostInterface.inputs[0]?.label).toBe('文本输入')
    expect(result.hostInterface.outputs[0]?.label).toBe('文本输出')
    expect(result.parentDocument.nodes.some((n) => n.id === result.hostNodeId)).toBe(true)
    expect(result.parentDocument.nodes.some((n) => n.id === 'n-b')).toBe(false)
    expect(result.innerDocument.nodes.some((n) => n.id === 'n-b')).toBe(true)
    expect(
      result.innerDocument.nodes.some((n) => n.typeId === 'graph.boundary.input')
    ).toBe(true)
    expect(
      result.innerDocument.nodes.some((n) => n.typeId === 'graph.boundary.output')
    ).toBe(true)

    const parentIn = result.parentDocument.edges.find((e) => e.target === result.hostNodeId)
    const parentOut = result.parentDocument.edges.find((e) => e.source === result.hostNodeId)
    expect(parentIn?.source).toBe('n-a')
    expect(parentOut?.target).toBe('n-c')
    expect(result.innerDocument.runStates?.['n-b']?.status).toBe('done')
    expect(result.innerDocument.runStates?.['n-a']).toBeUndefined()
    expect(result.parentDocument.runStates?.['n-b']).toBeUndefined()
    expect(result.parentDocument.runStates?.['n-a']?.status).toBe('done')
  })

  it('encapsulates multi-in multi-out selection', () => {
    const left1 = createNodeFromType('play.script', { x: 0, y: 0 }, { title: 'L1' })
    left1.id = 'l1'
    const left2 = createNodeFromType('play.script', { x: 0, y: 120 }, { title: 'L2' })
    left2.id = 'l2'
    const mid1 = createNodeFromType('prompt.optimize', { x: 200, y: 0 }, { title: 'M1' })
    mid1.id = 'm1'
    const mid2 = createNodeFromType('prompt.optimize', { x: 200, y: 120 }, { title: 'M2' })
    mid2.id = 'm2'
    const right1 = createNodeFromType('output.text', { x: 400, y: 0 }, { title: 'R1' })
    right1.id = 'r1'
    const right2 = createNodeFromType('output.text', { x: 400, y: 120 }, { title: 'R2' })
    right2.id = 'r2'
    const doc: GraphDocument = {
      nodes: [left1, left2, mid1, mid2, right1, right2],
      edges: [
        { id: 'e1', source: 'l1', target: 'm1', sourcePort: 'out', targetPort: 'in' },
        { id: 'e2', source: 'l2', target: 'm2', sourcePort: 'out', targetPort: 'in' },
        { id: 'e3', source: 'm1', target: 'r1', sourcePort: 'out', targetPort: 'in' },
        { id: 'e4', source: 'm2', target: 'r2', sourcePort: 'out', targetPort: 'in' }
      ],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
    const result = encapsulateSelection(doc, {
      selectedNodeIds: ['m1', 'm2'],
      hostAssetId: HOST_B
    })
    expect(result.hostInterface.inputs.length).toBe(2)
    expect(result.hostInterface.outputs.length).toBe(2)
    expect(result.hostInterface.inputs.map((p) => p.label)).toEqual([
      '文本输入',
      '文本输入 2'
    ])
    expect(result.hostInterface.outputs.map((p) => p.label)).toEqual([
      '文本输出',
      '文本输出 2'
    ])
    expect(result.innerDocument.nodes.filter((n) => n.id === 'm1' || n.id === 'm2')).toHaveLength(
      2
    )
  })
})

describe('dynamic host ports', () => {
  it('reads ports from hostInterfaceSnapshot', () => {
    const node = createAssetGraphNode(HOST_C, 'subgraph', 'Host', { x: 0, y: 0 }, {
      assetHost: true,
      hostInterfaceSnapshot: {
        version: 1,
        inputs: [
          { id: 'in-a', label: 'A', dataType: 'text', multiple: true },
          { id: 'in-b', label: 'B', dataType: 'image', multiple: true }
        ],
        outputs: [{ id: 'out-x', label: 'X', dataType: 'video', multiple: false }]
      }
    })
    const ports = getNodePorts(node)
    expect(ports.filter((p) => p.direction === 'in').map((p) => p.id)).toEqual([
      'in-a',
      'in-b'
    ])
    expect(ports.filter((p) => p.direction === 'out').map((p) => p.id)).toEqual(['out-x'])
  })

  it('prunes incompatible edges after interface change', () => {
    const host = createAssetGraphNode(HOST_C, 'subgraph', 'Host', { x: 200, y: 0 }, {
      assetHost: true,
      hostInterfaceSnapshot: {
        version: 1,
        inputs: [{ id: 'in-0', label: 'In', dataType: 'text', multiple: true }],
        outputs: [{ id: 'out-0', label: 'Out', dataType: 'text', multiple: false }]
      }
    })
    host.id = 'host'
    const src = createNodeFromType('note.text', { x: 0, y: 0 })
    src.id = 'src'
    const doc: GraphDocument = {
      nodes: [src, host],
      edges: [
        { id: 'e1', source: 'src', target: 'host', sourcePort: 'out', targetPort: 'in-0' },
        { id: 'e2', source: 'src', target: 'host', sourcePort: 'out', targetPort: 'gone' }
      ],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
    const next = pruneEdgesForHostInterface(doc, 'host', {
      version: 1,
      inputs: [{ id: 'in-0', label: 'In', dataType: 'text', multiple: true }],
      outputs: [{ id: 'out-0', label: 'Out', dataType: 'text', multiple: false }]
    })
    expect(next.edges.map((e) => e.id)).toEqual(['e1'])
  })
})

describe('boundary output mapping', () => {
  it('includes boundary outputs alongside regular output nodes', () => {
    const output = createNodeFromType('output.text', { x: 0, y: 0 })
    const boundary = createNodeFromType('graph.boundary.output', { x: 200, y: 0 }, {
      params: { hostBoundaryPort: { portId: 'out-0', dataType: 'text' } }
    })
    const outputs = findAllOutputNodes({
      nodes: [output, boundary],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    })
    expect(outputs.map((node) => node.id)).toContain(output.id)
    expect(outputs.map((node) => node.id)).toContain(boundary.id)
  })

  it('maps boundary output states to host ports', () => {
    const iface = {
      version: 1,
      inputs: [],
      outputs: [
        { id: 'out-0', label: 'Out', dataType: 'text' as const, multiple: false },
        { id: 'out-1', label: 'Out2', dataType: 'text' as const, multiple: false }
      ]
    }
    const doc: GraphDocument = {
      nodes: [
        {
          id: 'graph-boundary-out-out-0',
          typeId: 'graph.boundary.output',
          category: 'note',
          position: { x: 0, y: 0 },
          params: { hostBoundaryPort: { portId: 'out-0', dataType: 'text' } }
        },
        {
          id: 'graph-boundary-out-out-1',
          typeId: 'graph.boundary.output',
          category: 'note',
          position: { x: 0, y: 80 },
          params: { hostBoundaryPort: { portId: 'out-1', dataType: 'text' } }
        }
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
    const mapped = mapHostBoundaryStatesToOutputs(
      {
        'graph-boundary-out-out-0': {
          status: 'done',
          outputs: { out: { kind: 'text', text: 'A' } }
        },
        'graph-boundary-out-out-1': {
          status: 'done',
          outputs: { out: { kind: 'text', text: 'B' } }
        }
      },
      doc,
      iface
    )
    expect(mapped).toEqual({
      'out-0': { kind: 'text', text: 'A' },
      'out-1': { kind: 'text', text: 'B' }
    })
  })

  it('soft-falls back to upstream gallery when boundary states are empty', () => {
    const boutId = boundaryOutputNodeId('out')
    const iface = {
      version: 1,
      inputs: [],
      outputs: [{ id: 'out', label: 'Out', dataType: 'image' as const, multiple: false }]
    }
    const doc: GraphDocument = {
      nodes: [
        {
          id: 'gen',
          typeId: 'asset.image',
          category: 'asset',
          position: { x: 0, y: 0 },
          params: {
            generatedImages: [
              {
                id: 'g1',
                dataUrl: 'data:image/png;base64,GG',
                relativePath: 'Cache/Images/g1.png'
              }
            ],
            selectedImageId: 'g1'
          }
        },
        {
          id: boutId,
          typeId: 'graph.boundary.output',
          category: 'note',
          position: { x: 200, y: 0 },
          params: { hostBoundaryPort: { portId: 'out', dataType: 'image' } }
        }
      ],
      edges: [
        { id: 'e1', source: 'gen', target: boutId, sourcePort: 'out', targetPort: 'in' }
      ],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
    const mapped = mapHostBoundaryStatesToOutputs(
      { [boutId]: { status: 'idle' } },
      doc,
      iface
    )
    expect(mapped?.out).toEqual(
      expect.objectContaining({
        kind: 'image',
        id: 'g1',
        relativePath: 'Cache/Images/g1.png'
      })
    )
  })
})

describe('hostable assets as HDA', () => {
  const hostable = [
    'image',
    'video',
    'voice',
    'screenplay',
    'world',
    'narrative',
    'script',
    'subgraph'
  ] as const

  it('default hostInterface + ensureBoundary for every hostable type', () => {
    for (const type of hostable) {
      const iface = defaultHostInterfaceForAssetType(type)
      expect(iface.outputs.length, type).toBeGreaterThan(0)
      const empty: GraphDocument = {
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 }
      }
      const withBoundary = ensureBoundaryProxyNodes(empty, iface)
      expect(
        withBoundary.nodes.filter((n) => n.typeId === 'graph.boundary.input').length,
        type
      ).toBe(iface.inputs.length)
      expect(
        withBoundary.nodes.filter((n) => n.typeId === 'graph.boundary.output').length,
        type
      ).toBe(iface.outputs.length)
    }
  })

  it('host instance ports follow editable hostInterfaceSnapshot for image/script', () => {
    for (const type of ['image', 'script'] as const) {
      const iface = defaultHostInterfaceForAssetType(type)
      const node = createAssetGraphNode(HOST_C, type, 'Host', { x: 0, y: 0 }, {
        assetHost: true,
        hostInterfaceSnapshot: {
          version: 1,
          inputs: [
            ...iface.inputs,
            { id: 'extra-in', label: 'Extra', dataType: 'text', multiple: true }
          ],
          outputs: iface.outputs
        }
      })
      const inIds = getNodePorts(node)
        .filter((p) => p.direction === 'in')
        .map((p) => p.id)
      expect(inIds).toContain('extra-in')
      expect(inIds.length).toBe(iface.inputs.length + 1)
    }
  })

  it('ensureBoundaryProxyNodes drops boundary nodes for removed ports', () => {
    const iface = {
      version: HOST_INTERFACE_FORMAT_VERSION,
      inputs: [
        { id: 'in', label: 'In', dataType: 'text' as const, multiple: true },
        { id: 'extra-in', label: 'Extra', dataType: 'text' as const, multiple: true }
      ],
      outputs: [
        { id: 'out', label: 'Out', dataType: 'text' as const, multiple: false },
        { id: 'extra-out', label: 'Extra Out', dataType: 'text' as const, multiple: false }
      ]
    }
    const withExtra = ensureBoundaryProxyNodes(
      { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
      iface
    )
    expect(withExtra.nodes.some((n) => n.id === boundaryInputNodeId('extra-in'))).toBe(true)
    expect(withExtra.nodes.some((n) => n.id === boundaryOutputNodeId('extra-out'))).toBe(true)

    const trimmed = {
      version: HOST_INTERFACE_FORMAT_VERSION,
      inputs: [{ id: 'in', label: 'In', dataType: 'text' as const, multiple: true }],
      outputs: [{ id: 'out', label: 'Out', dataType: 'text' as const, multiple: false }]
    }
    const after = ensureBoundaryProxyNodes(withExtra, trimmed)
    expect(after.nodes.some((n) => n.id === boundaryInputNodeId('extra-in'))).toBe(false)
    expect(after.nodes.some((n) => n.id === boundaryOutputNodeId('extra-out'))).toBe(false)
    expect(after.nodes.some((n) => n.id === boundaryInputNodeId('in'))).toBe(true)
    expect(after.nodes.some((n) => n.id === boundaryOutputNodeId('out'))).toBe(true)
    expect(
      after.edges.every(
        (e) =>
          e.source !== boundaryInputNodeId('extra-in') &&
          e.target !== boundaryInputNodeId('extra-in') &&
          e.source !== boundaryOutputNodeId('extra-out') &&
          e.target !== boundaryOutputNodeId('extra-out')
      )
    ).toBe(true)
  })
})
