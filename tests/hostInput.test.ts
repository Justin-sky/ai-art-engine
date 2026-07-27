import { describe, expect, it } from 'vitest'
import {
  buildHostInputSlotSeedOutputs,
  createNodeFromType,
  ensureHostInputSlotNodes,
  getNodePorts,
  GRAPH_INPUT_SLOT_TYPE_ID,
  hostInputSlotNodeId,
  isNodeDeletable,
  normalizeScopedGraph,
  resolveHostInputSlotsFromParentGraph,
  resolveHostInputSlotsForHostOpen,
  type GraphDocument,
  type GraphNode
} from '../src/shared/graph'

const HOST_ID = '00000000-0000-4000-8000-000000000201'
const SRC_A = 'src-a'
const SRC_B = 'src-b'

function parentWithHostEdges(opts?: {
  textsItems?: number
}): GraphDocument {
  const host: GraphNode = {
    id: 'host-node',
    typeId: 'asset.screenplay',
    category: 'asset',
    position: { x: 400, y: 80 },
    params: { assetHost: true, assetRef: true },
    assetId: HOST_ID,
    assetType: 'screenplay',
    title: '剧本'
  }
  const a: GraphNode = {
    id: SRC_A,
    typeId: 'note.text',
    category: 'note',
    position: { x: 40, y: 40 },
    params: { text: 'A' },
    title: 'A'
  }
  const b: GraphNode = {
    id: SRC_B,
    typeId: 'note.text',
    category: 'note',
    position: { x: 40, y: 160 },
    params: { text: 'B' },
    title: 'B'
  }
  const items = opts?.textsItems
  return {
    nodes: [a, b, host],
    edges: [
      { id: 'e1', source: SRC_A, target: host.id, sourcePort: 'out', targetPort: 'in' },
      { id: 'e2', source: SRC_B, target: host.id, sourcePort: 'out', targetPort: 'in' }
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    ...(items
      ? {
          runStates: {
            [SRC_A]: {
              status: 'done' as const,
              outputs: {
                out: {
                  kind: 'texts' as const,
                  items: Array.from({ length: items }, (_, i) => ({
                    text: `item-${i}`,
                    title: `T${i}`
                  }))
                }
              }
            }
          }
        }
      : {})
  }
}

describe('host input slots', () => {
  it('mirrors out port dataType from hostInputSlot', () => {
    const node = createNodeFromType(GRAPH_INPUT_SLOT_TYPE_ID, { x: 0, y: 0 })
    node.params.hostInputSlot = { portId: 'in', index: 0, dataType: 'image' }
    const ports = getNodePorts(node)
    expect(ports).toEqual([
      expect.objectContaining({ id: 'out', direction: 'out', dataType: 'image' })
    ])
    expect(isNodeDeletable(node)).toBe(false)
  })

  it('resolves one slot per incoming edge when source has no array output', () => {
    const slots = resolveHostInputSlotsFromParentGraph(parentWithHostEdges(), HOST_ID)
    expect(slots.map((s) => `${s.portId}:${s.index}`)).toEqual(['in:0', 'in:1'])
    expect(slots.every((s) => s.dataType === 'text')).toBe(true)
  })

  it('expands texts array into N ordered slots for one edge', () => {
    const slots = resolveHostInputSlotsFromParentGraph(
      parentWithHostEdges({ textsItems: 3 }),
      HOST_ID
    )
    // SRC_A expands to 3 + SRC_B still 1
    expect(slots.map((s) => s.index)).toEqual([0, 1, 2, 3])
    expect(slots[0]?.text).toBe('item-0')
    expect(slots[2]?.title).toBe('T2')
  })

  it('soft-resolves source node params.text when runStates empty', () => {
    const parent = parentWithHostEdges()
    // 源节点有正文，但未跑图
    parent.nodes.find((n) => n.id === SRC_A)!.params.text = '来自外层 A'
    parent.nodes.find((n) => n.id === SRC_B)!.params.text = '来自外层 B'
    const slots = resolveHostInputSlotsFromParentGraph(parent, HOST_ID)
    expect(slots.map((s) => s.text)).toEqual(['来自外层 A', '来自外层 B'])
  })

  it('soft-resolves gallery selectedTextId over stale runStates.out', () => {
    const host: GraphNode = {
      id: 'host-node',
      typeId: 'asset.screenplay',
      category: 'asset',
      position: { x: 400, y: 80 },
      params: { assetHost: true, assetRef: true },
      assetId: HOST_ID,
      assetType: 'screenplay',
      title: '剧本'
    }
    const gen: GraphNode = {
      id: 'gen',
      typeId: 'asset.screenplay',
      category: 'asset',
      position: { x: 40, y: 40 },
      params: {
        generatedTexts: [
          { id: 'a', text: '旧稿' },
          { id: 'b', text: '新选中' }
        ],
        selectedTextId: 'b'
      },
      title: '生成'
    }
    const parent: GraphDocument = {
      nodes: [gen, host],
      edges: [
        { id: 'e1', source: 'gen', target: host.id, sourcePort: 'out', targetPort: 'in' }
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      runStates: {
        gen: {
          status: 'done',
          outputs: {
            out: { kind: 'text', text: '旧稿', id: 'a' },
            'out-all': {
              kind: 'texts',
              items: [
                { id: 'a', text: '旧稿' },
                { id: 'b', text: '新选中' }
              ]
            }
          }
        }
      }
    }
    const slots = resolveHostInputSlotsFromParentGraph(parent, HOST_ID)
    expect(slots).toHaveLength(1)
    expect(slots[0]?.text).toBe('新选中')
  })

  it('ensure is idempotent and keeps stable ids', () => {
    const nodes: GraphNode[] = []
    const edges: GraphDocument['edges'] = []
    const slots = [
      { portId: 'in', index: 0, dataType: 'text' as const, text: 'one' },
      { portId: 'in', index: 1, dataType: 'text' as const, text: 'two' }
    ]
    ensureHostInputSlotNodes(nodes, edges, slots)
    const ids1 = nodes.filter((n) => n.typeId === GRAPH_INPUT_SLOT_TYPE_ID).map((n) => n.id)
    expect(ids1).toEqual([
      hostInputSlotNodeId('in', 0),
      hostInputSlotNodeId('in', 1)
    ])
    ensureHostInputSlotNodes(nodes, edges, slots)
    const ids2 = nodes.filter((n) => n.typeId === GRAPH_INPUT_SLOT_TYPE_ID).map((n) => n.id)
    expect(ids2).toEqual(ids1)
    expect(nodes).toHaveLength(2)

    ensureHostInputSlotNodes(nodes, edges, [slots[0]!])
    expect(nodes.map((n) => n.id)).toEqual([hostInputSlotNodeId('in', 0)])
  })

  it('opens host with default one slot per port when no parent edges', () => {
    const slots = resolveHostInputSlotsForHostOpen('script', [], HOST_ID)
    expect(slots.map((s) => `${s.portId}:${s.index}:${s.dataType}`)).toEqual([
      'in-worldEntities:0:worldEntities'
    ])
  })

  it('host open merges parent expansion with missing-port defaults', () => {
    const slots = resolveHostInputSlotsForHostOpen(
      'script',
      [
        {
          nodes: [
            {
              id: 'h',
              typeId: 'asset.script',
              category: 'asset',
              position: { x: 0, y: 0 },
              params: { assetHost: true },
              assetId: HOST_ID,
              assetType: 'script'
            },
            {
              id: 't',
              typeId: 'note.text',
              category: 'note',
              position: { x: 0, y: 0 },
              params: { text: '叙事' },
              title: 't'
            }
          ],
          edges: [
            {
              id: 'e',
              source: 't',
              target: 'h',
              sourcePort: 'out',
              targetPort: 'in-text'
            }
          ],
          viewport: { x: 0, y: 0, zoom: 1 }
        }
      ],
      HOST_ID
    )
    // script 编辑图仅世界槽；叙事不再建输入槽
    expect(slots.map((s) => `${s.portId}:${s.index}`)).toEqual(['in-worldEntities:0'])
  })

  it('opens narrative host with text slot only', () => {
    const slots = resolveHostInputSlotsForHostOpen('narrative', [], HOST_ID)
    expect(slots.map((s) => `${s.portId}:${s.index}:${s.dataType}`)).toEqual([
      'in:0:text'
    ])
  })

  it('normalizeScopedGraph always creates default slots for host open', () => {
    const doc = normalizeScopedGraph('screenplayAsset', null, {
      assetType: 'screenplay',
      hostAssetId: HOST_ID
    })
    const slots = doc.nodes.filter((n) => n.typeId === GRAPH_INPUT_SLOT_TYPE_ID)
    expect(slots).toHaveLength(1)
    expect(slots[0]?.id).toBe(hostInputSlotNodeId('in', 0))
  })

  it('normalizeScopedGraph syncs slots from parentHostInputSlots', () => {
    const doc = normalizeScopedGraph('screenplayAsset', null, {
      assetType: 'screenplay',
      hostAssetId: HOST_ID,
      parentHostInputSlots: [
        { portId: 'in', index: 0, dataType: 'text', text: 'hello' },
        { portId: 'in', index: 1, dataType: 'text', text: 'world' }
      ]
    })
    const slots = doc.nodes.filter((n) => n.typeId === GRAPH_INPUT_SLOT_TYPE_ID)
    expect(slots).toHaveLength(2)
    expect(slots[0]?.id).toBe(hostInputSlotNodeId('in', 0))
    expect(slots[0]?.params.text).toBe('hello')
  })

  it('buildHostInputSlotSeedOutputs expands texts into seed outs', () => {
    const host: GraphNode = {
      id: 'h',
      typeId: 'asset.screenplay',
      category: 'asset',
      position: { x: 0, y: 0 },
      params: { assetHost: true },
      assetId: HOST_ID,
      assetType: 'screenplay'
    }
    const seeds = buildHostInputSlotSeedOutputs(host, {
      in: [
        {
          kind: 'texts',
          items: [{ text: 'a' }, { text: 'b' }]
        }
      ]
    })
    expect(Object.keys(seeds).sort()).toEqual([
      hostInputSlotNodeId('in', 0),
      hostInputSlotNodeId('in', 1)
    ].sort())
    expect(seeds[hostInputSlotNodeId('in', 1)]?.out).toEqual({ kind: 'text', text: 'b' })
  })
})
