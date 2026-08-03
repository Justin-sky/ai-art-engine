import { describe, expect, it } from 'vitest'
import {
  applyGraphClipboardPayload,
  buildGraphClipboardPayload,
  createNodeFromType,
  GRAPH_CLIPBOARD_PASTE_OFFSET,
  HOST_INTERFACE_SCHEMA_VERSION,
  parseGraphClipboardPayload,
  serializeGraphClipboardPayload,
  type GraphDocument,
  type GraphNode
} from '../src/shared/graph'

function emptyDoc(nodes: GraphNode[] = [], edges: GraphDocument['edges'] = []): GraphDocument {
  return {
    nodes,
    edges,
    groups: [],
    viewport: { x: 0, y: 0, zoom: 1 }
  }
}

function hostNode(assetId: string, id = 'host-a'): GraphNode {
  return {
    id,
    typeId: 'asset.subgraph',
    category: 'asset',
    assetId,
    assetType: 'subgraph',
    position: { x: 0, y: 0 },
    title: 'Host',
    params: {
      assetRef: true,
      assetHost: true,
      hostInterfaceSnapshot: {
        version: HOST_INTERFACE_SCHEMA_VERSION,
        inputs: [{ id: 'in-text', label: 'In', dataType: 'text', multiple: false }],
        outputs: [{ id: 'out-text', label: 'Out', dataType: 'text', multiple: false }]
      }
    }
  }
}

function mediaRefNode(assetId: string, id: string, x = 0): GraphNode {
  return {
    id,
    typeId: 'asset.image',
    category: 'asset',
    assetId,
    assetType: 'image',
    position: { x, y: 0 },
    title: 'Ref',
    params: { assetRef: true }
  }
}

describe('graph clipboard', () => {
  it('copies two nodes and an edge, paste remaps ids and offsets', () => {
    const a = createNodeFromType('note.text', { x: 10, y: 20 })
    const b = createNodeFromType('note.text', { x: 200, y: 20 })
    const doc = emptyDoc(
      [a, b],
      [{ id: 'edge-1', source: a.id, target: b.id, sourcePort: 'out', targetPort: 'in' }]
    )

    const { payload, skippedCount } = buildGraphClipboardPayload(doc, [a.id, b.id])
    expect(skippedCount).toBe(0)
    expect(payload?.nodes).toHaveLength(2)
    expect(payload?.edges).toHaveLength(1)

    const applied = applyGraphClipboardPayload(doc, payload!, {
      offset: { x: GRAPH_CLIPBOARD_PASTE_OFFSET, y: GRAPH_CLIPBOARD_PASTE_OFFSET }
    })
    expect(applied.pastedNodeIds).toHaveLength(2)
    expect(applied.pastedNodeIds.every((id) => id !== a.id && id !== b.id)).toBe(true)
    expect(applied.document.nodes).toHaveLength(4)
    expect(applied.document.edges).toHaveLength(2)

    const pastedEdge = applied.document.edges.find((e) => e.id !== 'edge-1')
    expect(pastedEdge).toBeTruthy()
    expect(applied.pastedNodeIds).toContain(pastedEdge!.source)
    expect(applied.pastedNodeIds).toContain(pastedEdge!.target)

    const pastedA = applied.document.nodes.find((n) => n.id === applied.pastedNodeIds[0])
    expect(pastedA?.position).toEqual({
      x: expect.any(Number),
      y: expect.any(Number)
    })
    expect(pastedA!.position.x).toBeGreaterThanOrEqual(10 + GRAPH_CLIPBOARD_PASTE_OFFSET)
  })

  it('skips non-deletable boundary nodes when building clipboard', () => {
    const boundary = createNodeFromType('graph.boundary.input', { x: 0, y: 0 })
    const note = createNodeFromType('note.text', { x: 100, y: 0 })
    const doc = emptyDoc([boundary, note])

    const { payload, skippedCount } = buildGraphClipboardPayload(doc, [boundary.id, note.id])
    expect(skippedCount).toBe(1)
    expect(payload?.nodes).toHaveLength(1)
    expect(payload?.nodes[0]?.typeId).toBe('note.text')
  })

  it('skips pasting a host when the same asset host already exists', () => {
    const assetId = '00000000-0000-4000-8000-0000000000aa'
    const existing = hostNode(assetId, 'host-existing')
    const doc = emptyDoc([existing])
    const payload = {
      version: 1,
      nodes: [hostNode(assetId, 'host-clip')],
      edges: [],
      groups: []
    }

    const applied = applyGraphClipboardPayload(doc, payload, {
      offset: { x: 40, y: 40 }
    })
    expect(applied.pastedNodeIds).toHaveLength(0)
    expect(applied.skippedHostCount).toBe(1)
    expect(applied.document.nodes).toHaveLength(1)
  })

  it('allows pasting multiple ordinary asset refs for the same asset', () => {
    const assetId = '00000000-0000-4000-8000-0000000000bb'
    const existing = mediaRefNode(assetId, 'ref-1', 0)
    const doc = emptyDoc([existing])
    const payload = {
      version: 1,
      nodes: [mediaRefNode(assetId, 'ref-clip', 100)],
      edges: [],
      groups: []
    }

    const applied = applyGraphClipboardPayload(doc, payload, { offset: { x: 40, y: 40 } })
    expect(applied.pastedNodeIds).toHaveLength(1)
    expect(applied.skippedHostCount).toBe(0)
    expect(applied.document.nodes.filter((n) => n.assetId === assetId)).toHaveLength(2)
  })

  it('serializes and parses clipboard text with magic prefix', () => {
    const note = createNodeFromType('note.text', { x: 0, y: 0 })
    const { payload } = buildGraphClipboardPayload(emptyDoc([note]), [note.id])
    expect(payload).toBeTruthy()
    const text = serializeGraphClipboardPayload(payload!)
    expect(text.startsWith('AIARTENGINE_GRAPH_CLIPBOARD_V1')).toBe(true)
    const parsed = parseGraphClipboardPayload(text)
    expect(parsed?.nodes).toHaveLength(1)
    expect(parseGraphClipboardPayload('not clipboard')).toBeNull()
  })

  it('copies intact groups and remaps group ids on paste', () => {
    const a = createNodeFromType('note.text', { x: 0, y: 0 })
    const b = createNodeFromType('note.text', { x: 80, y: 0 })
    a.groupId = 'group-1'
    b.groupId = 'group-1'
    const doc = emptyDoc([a, b])
    doc.groups = [{ id: 'group-1', title: 'Bundle' }]

    const { payload } = buildGraphClipboardPayload(doc, [a.id, b.id])
    expect(payload?.groups).toHaveLength(1)

    const applied = applyGraphClipboardPayload(doc, payload!, { offset: { x: 40, y: 40 } })
    const pasted = applied.document.nodes.filter((n) => applied.pastedNodeIds.includes(n.id))
    expect(pasted).toHaveLength(2)
    expect(pasted[0]!.groupId).toBeTruthy()
    expect(pasted[0]!.groupId).not.toBe('group-1')
    expect(pasted[0]!.groupId).toBe(pasted[1]!.groupId)
    expect(applied.document.groups?.some((g) => g.id === pasted[0]!.groupId)).toBe(true)
  })
})
