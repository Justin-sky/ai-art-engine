import { describe, expect, it } from 'vitest'
import {
  boundaryOutputNodeId,
  createNodeFromType,
  encapsulateSelection,
  isBoundaryInputNode,
  isBoundaryOutputNode,
  LEGACY_WORLD_GEN_NODE_ID,
  pickWorldElementStateForMigration,
  readWorldElementGraphForNode,
  readWorldElementGraphsForNode,
  syncWorldElementKindGraph,
  withWorldElementGraphForNode,
  worldElementBoundaryPortId
} from '../src/shared/graph'

describe('syncWorldElementKindGraph', () => {
  it('creates script → image gen → boundary.output chain per catalog item', () => {
    const doc = syncWorldElementKindGraph(null, [
      { id: 'c1', name: 'Hero', prompt: 'a hero', status: 'draft' },
      { id: 'c2', name: 'Villain', prompt: 'a villain', status: 'draft' }
    ])

    const scripts = doc.nodes.filter((node) => node.typeId === 'play.script')
    const gens = doc.nodes.filter((node) => node.typeId === 'asset.image')
    const boundaries = doc.nodes.filter((node) => isBoundaryOutputNode(node))
    expect(scripts).toHaveLength(2)
    expect(gens).toHaveLength(2)
    expect(boundaries).toHaveLength(2)
    expect(doc.nodes.some((node) => isBoundaryInputNode(node))).toBe(false)
    expect(doc.nodes.some((node) => node.category === 'output')).toBe(false)

    for (const itemId of ['c1', 'c2']) {
      const script = scripts.find((node) => node.params.worldElementId === itemId)!
      const gen = gens.find((node) => node.params.worldElementId === itemId)!
      const boundaryId = boundaryOutputNodeId(worldElementBoundaryPortId(itemId))
      const boundary = boundaries.find((node) => node.id === boundaryId)!
      expect(gen.params.generateInstruction).toBe('')
      expect(script.params.text).toBe(itemId === 'c1' ? 'a hero' : 'a villain')
      expect(boundary.params.worldElementId).toBe(itemId)
      expect(boundary.params.hostBoundaryPort).toEqual({
        portId: worldElementBoundaryPortId(itemId),
        dataType: 'image',
        multiple: false
      })
      expect(
        doc.edges.some(
          (edge) =>
            edge.source === script.id &&
            edge.target === gen.id &&
            (edge.sourcePort ?? 'out') === 'out' &&
            (edge.targetPort ?? 'in') === 'in-text'
        )
      ).toBe(true)
      expect(
        doc.edges.some(
          (edge) =>
            edge.source === gen.id &&
            edge.target === boundary.id &&
            (edge.sourcePort ?? 'out') === 'out' &&
            (edge.targetPort ?? 'in') === 'in'
        )
      ).toBe(true)
    }
  })

  it('removes managed script, gen and boundary when catalog item disappears', () => {
    const first = syncWorldElementKindGraph(null, [
      { id: 'c1', name: 'Hero', prompt: 'a', status: 'draft' },
      { id: 'c2', name: 'Extra', prompt: 'b', status: 'draft' }
    ])
    const next = syncWorldElementKindGraph(first, [
      { id: 'c1', name: 'Hero', prompt: 'a', status: 'draft' }
    ])
    const ids = [
      ...new Set(next.nodes.map((node) => node.params.worldElementId).filter(Boolean))
    ]
    expect(ids).toEqual(['c1'])
    expect(next.nodes.filter((n) => n.typeId === 'play.script')).toHaveLength(1)
    expect(next.nodes.filter((n) => n.typeId === 'asset.image')).toHaveLength(1)
    expect(next.nodes.filter((n) => isBoundaryOutputNode(n))).toHaveLength(1)
    expect(next.nodes.some((n) => isBoundaryInputNode(n))).toBe(false)
    expect(next.nodes.some((n) => n.category === 'output')).toBe(false)
  })

  it('adopts existing unmanaged chain and keeps intermediate processing nodes', () => {
    const base = syncWorldElementKindGraph(null, [
      { id: 'c1', name: 'Hero', prompt: 'a hero', status: 'draft' }
    ])
    const script = base.nodes.find((node) => node.typeId === 'play.script')!
    const managedGen = base.nodes.find(
      (node) => node.typeId === 'asset.image' && node.params.worldElementId === 'c1'
    )!
    const boundaryId = boundaryOutputNodeId(worldElementBoundaryPortId('c1'))

    // 模拟用户把托管生成节点换成自己的链路：script → head → 三视图加工 → boundary
    const head = createNodeFromType(
      'asset.image',
      { x: 300, y: 0 },
      { title: 'Hero', params: {} }
    )
    const proc = createNodeFromType(
      'asset.image',
      { x: 500, y: 0 },
      {
        title: '三视图',
        params: { generateInstruction: '基于当前参考图，生成「角色三视图」' }
      }
    )
    const userDoc: typeof base = {
      ...base,
      nodes: [...base.nodes.filter((node) => node.id !== managedGen.id), head, proc],
      edges: [
        ...base.edges.filter(
          (edge) => edge.source !== managedGen.id && edge.target !== managedGen.id
        ),
        {
          id: 'e1',
          source: script.id,
          target: head.id,
          sourcePort: 'out',
          targetPort: 'in-text'
        },
        {
          id: 'e2',
          source: head.id,
          target: proc.id,
          sourcePort: 'out',
          targetPort: 'in-image'
        },
        {
          id: 'e3',
          source: proc.id,
          target: boundaryId,
          sourcePort: 'out',
          targetPort: 'in'
        }
      ]
    }

    const synced = syncWorldElementKindGraph(userDoc, [
      { id: 'c1', name: 'Hero', prompt: 'a hero', status: 'draft' }
    ])

    const gens = synced.nodes.filter((node) => node.typeId === 'asset.image')
    // 不新建空壳生成节点：仍只有 head + 三视图加工节点
    expect(gens).toHaveLength(2)
    // 空壳托管节点被取代移除
    expect(synced.nodes.some((node) => node.id === managedGen.id)).toBe(false)
    // 链首被认领为托管生成节点
    const adopted = synced.nodes.find((node) => node.id === head.id)!
    expect(adopted.params.worldElementId).toBe('c1')
    expect(adopted.params.generateInstruction).toBe('')
    // 中间加工节点及其边完整保留
    expect(synced.nodes.some((node) => node.id === proc.id)).toBe(true)
    expect(
      synced.edges.some(
        (edge) =>
          edge.source === head.id && edge.target === proc.id
      )
    ).toBe(true)
    expect(
      synced.edges.some(
        (edge) =>
          edge.source === proc.id && edge.target === boundaryId
      )
    ).toBe(true)
  })

  it('preserves intermediate processing nodes on existing managed chain', () => {
    const base = syncWorldElementKindGraph(null, [
      { id: 'c1', name: 'Hero', prompt: 'a hero', status: 'draft' }
    ])
    const script = base.nodes.find((node) => node.typeId === 'play.script')!
    const gen = base.nodes.find(
      (node) => node.typeId === 'asset.image' && node.params.worldElementId === 'c1'
    )!
    const boundaryId = boundaryOutputNodeId(worldElementBoundaryPortId('c1'))

    // gen 后插入三视图加工节点
    const proc = createNodeFromType(
      'asset.image',
      { x: 500, y: 0 },
      { title: '三视图', params: {} }
    )
    const withProc: typeof base = {
      ...base,
      nodes: [...base.nodes, proc],
      edges: [
        ...base.edges.filter(
          (edge) => edge.source !== gen.id && edge.target !== gen.id
        ),
        {
          id: 'e1',
          source: script.id,
          target: gen.id,
          sourcePort: 'out',
          targetPort: 'in-text'
        },
        {
          id: 'e2',
          source: gen.id,
          target: proc.id,
          sourcePort: 'out',
          targetPort: 'in-image'
        },
        {
          id: 'e3',
          source: proc.id,
          target: boundaryId,
          sourcePort: 'out',
          targetPort: 'in'
        }
      ]
    }

    const synced = syncWorldElementKindGraph(withProc, [
      { id: 'c1', name: 'Hero', prompt: 'a hero', status: 'draft' }
    ])

    expect(synced.nodes.filter((node) => node.typeId === 'asset.image')).toHaveLength(2)
    expect(synced.nodes.some((node) => node.id === proc.id)).toBe(true)
    expect(
      synced.edges.some(
        (edge) => edge.source === gen.id && edge.target === proc.id
      )
    ).toBe(true)
    expect(
      synced.edges.some(
        (edge) => edge.source === proc.id && edge.target === boundaryId
      )
    ).toBe(true)
    // 已有链路时不补直达 gen → boundary 边，避免边界双源
    expect(
      synced.edges.some(
        (edge) => edge.source === gen.id && edge.target === boundaryId
      )
    ).toBe(false)
  })

  it('keeps world element graphs independent per world.gen node', () => {
    const docA = syncWorldElementKindGraph(null, [
      { id: 'c1', name: 'Hero', prompt: 'a hero', status: 'draft' }
    ])
    const docB = syncWorldElementKindGraph(null, [
      { id: 'c2', name: 'Villain', prompt: 'a villain', status: 'draft' }
    ])

    const stored = withWorldElementGraphForNode(
      withWorldElementGraphForNode({}, 'gen-1', 'characters', docA),
      'gen-2',
      'characters',
      docB
    )

    // 每个节点各自持有自己的子图
    expect(readWorldElementGraphForNode(stored, 'gen-1', 'characters')).toBe(docA)
    expect(readWorldElementGraphForNode(stored, 'gen-2', 'characters')).toBe(docB)
    // 新节点没有独立条目时保持空，不回退到共享/其它节点内容
    expect(readWorldElementGraphsForNode(stored, 'gen-3')).toEqual({})
    expect(readWorldElementGraphForNode(stored, 'gen-3', 'characters')).toBeNull()

    // 旧版资产级共享图只作为默认节点 world-gen 的回退
    const legacy = { worldElementGraphs: { characters: docA } } as never
    expect(readWorldElementGraphForNode(legacy, LEGACY_WORLD_GEN_NODE_ID, 'characters')).toBe(docA)
    expect(readWorldElementGraphForNode(legacy, 'gen-9', 'characters')).toBeNull()

    // 默认节点写入仍走资产级共享图，不产生按节点副本
    const legacyWritten = withWorldElementGraphForNode(
      legacy,
      LEGACY_WORLD_GEN_NODE_ID,
      'characters',
      docB
    ) as { worldElementGraphs: Record<string, unknown>; worldElementGraphsByNode?: unknown }
    expect(legacyWritten.worldElementGraphs.characters).toBe(docB)
    expect(legacyWritten.worldElementGraphsByNode?.[LEGACY_WORLD_GEN_NODE_ID]).toBeUndefined()
  })

  it('picks world element state for migration when encapsulating nodes', () => {
    const legacyGraphs = {
      characters: { nodes: [] },
      scenes: { nodes: [] },
      props: { nodes: [] },
      weapons: { nodes: [] }
    }
    const byNode = { 'gen-a': { characters: { nodes: [] } } }
    const source = {
      worldElementGraphs: legacyGraphs,
      worldElementGraphsByNode: byNode,
      lastAppliedWorldCatalogFingerprint: 'fp-legacy',
      lastAppliedWorldCatalogFingerprintByNode: { 'gen-a': 'fp-a' },
      graphJson: { nodes: [] }
    } as never

    const picked = pickWorldElementStateForMigration(source, [
      LEGACY_WORLD_GEN_NODE_ID,
      'gen-a'
    ])
    expect(picked.worldElementGraphs).toBe(legacyGraphs)
    expect(picked.lastAppliedWorldCatalogFingerprint).toBe('fp-legacy')
    expect(picked.worldElementGraphsByNode).toEqual({ 'gen-a': byNode['gen-a'] })
    expect(picked.lastAppliedWorldCatalogFingerprintByNode).toEqual({ 'gen-a': 'fp-a' })
    // 其它字段（如 graphJson）不迁移
    expect(picked.graphJson).toBeUndefined()
    // 未选中的节点不迁移任何状态
    expect(pickWorldElementStateForMigration(source, ['gen-b'])).toEqual({})
  })

  it('encapsulating a world.gen node migrates source subgraphs into the host asset', () => {
    const sourceGenParams = {
      worldElementGraphs: {
        characters: { nodes: [{ id: 'c1' }] },
        scenes: { nodes: [] },
        props: { nodes: [] },
        weapons: { nodes: [] }
      },
      lastAppliedWorldCatalogFingerprint: 'fp-legacy'
    } as never

    const doc = {
      nodes: [
        createNodeFromType(
          'world.gen',
          { x: 0, y: 0 },
          { id: LEGACY_WORLD_GEN_NODE_ID }
        ),
        createNodeFromType('output.image', { x: 300, y: 0 }, { id: 'out' })
      ],
      edges: [
        {
          id: 'e1',
          source: LEGACY_WORLD_GEN_NODE_ID,
          target: 'out',
          sourcePort: 'out-characters',
          targetPort: 'in'
        }
      ]
    }

    const result = encapsulateSelection(doc, {
      selectedNodeIds: [LEGACY_WORLD_GEN_NODE_ID],
      hostAssetId: '123e4567-e89b-12d3-a456-426614174000',
      hostAssetName: 'Host'
    })

    // 内图保留 world.gen 节点
    expect(
      result.innerDocument.nodes.some((node) => node.id === LEGACY_WORLD_GEN_NODE_ID)
    ).toBe(true)
    // 外层被替换为 host 节点
    expect(
      result.parentDocument.nodes.some((node) => node.id === LEGACY_WORLD_GEN_NODE_ID)
    ).toBe(false)
    expect(
      result.parentDocument.nodes.some((node) => node.typeId === 'asset.subgraph')
    ).toBe(true)

    // 自动迁移：封装资产的 genParams 应带上源画布的四类子图与指纹
    const migrated = pickWorldElementStateForMigration(sourceGenParams, [
      LEGACY_WORLD_GEN_NODE_ID
    ])
    expect(migrated.worldElementGraphs).toBe(sourceGenParams.worldElementGraphs)
    expect(migrated.lastAppliedWorldCatalogFingerprint).toBe('fp-legacy')
  })

  it('encapsulate names host output ports after source port labels', () => {
    const gen = createNodeFromType('world.gen', { x: 0, y: 0 }, { id: 'gen-1' })
    const o1 = createNodeFromType('output.image', { x: 300, y: 0 }, { id: 'o1' })
    const o2 = createNodeFromType('output.image', { x: 300, y: 100 }, { id: 'o2' })
    const doc = {
      nodes: [gen, o1, o2],
      edges: [
        {
          id: 'e1',
          source: 'gen-1',
          target: 'o1',
          sourcePort: 'out-characters',
          targetPort: 'in'
        },
        {
          id: 'e2',
          source: 'gen-1',
          target: 'o2',
          sourcePort: 'out-scenes',
          targetPort: 'in'
        }
      ]
    }

    const result = encapsulateSelection(doc, {
      selectedNodeIds: ['gen-1'],
      hostAssetId: '123e4567-e89b-12d3-a456-426614174000',
      hostAssetName: 'Host'
    })

    // 输出端口用源端口语义名（角色 / 场景），而不是通用的「图片组输出 N」
    expect(result.hostInterface.outputs.map((output) => output.label)).toEqual(['角色', '场景'])
    const boundaryTitles = result.innerDocument.nodes
      .filter((node) => node.typeId === 'graph.boundary.output')
      .map((node) => node.title)
    expect(boundaryTitles).toEqual(['角色', '场景'])
  })
})
