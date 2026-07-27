/**
 * 分镜资产图：按叙事单元物化完整分镜链。
 * 空目录 → 默认单链（无 boundUnitId）；非空 → 每单元 unitRef→split→table→imageGen→videoGen→out。
 */
import { createNodeFromType, createOutputGraphNode } from './create'
import { cloneGraphDocument } from './document'
import { createDefaultScopedGraph } from './scopes'
import { readBoundUnitIdFromNodeParams } from './narrativeUnitParams'
import { parseNarrativeUnitJson, type NarrativeUnitRow } from './narrativeUnitParse'
import type { GraphDocument, GraphEdge, GraphNode } from './types'
import {
  GRAPH_SCRIPT_SHOT_IMAGE_GEN_NODE_ID,
  GRAPH_SCRIPT_SHOT_SPLIT_NODE_ID,
  GRAPH_SCRIPT_SHOT_TABLE_NODE_ID,
  GRAPH_SCRIPT_SHOT_VIDEO_GEN_NODE_ID,
  GraphPortType
} from './types'
import { GRAPH_INPUT_SLOT_TYPE_ID, isHostInputSlotNode, readHostInputSlot } from './hostInput'

const COLS = 1
const CHAIN_GAP_Y = 220
const ORIGIN_X = 120
const ORIGIN_Y = 160
const STEP_X = 220

const PIPELINE_TYPE_IDS = new Set([
  'narrative.unitRef',
  'script.shotSplit',
  'script.shotTable',
  'script.shotImageGen',
  'script.shotVideoGen',
  'output.video'
])

const EMPTY_CHAIN_IDS = new Set([
  GRAPH_SCRIPT_SHOT_SPLIT_NODE_ID,
  GRAPH_SCRIPT_SHOT_TABLE_NODE_ID,
  GRAPH_SCRIPT_SHOT_IMAGE_GEN_NODE_ID,
  GRAPH_SCRIPT_SHOT_VIDEO_GEN_NODE_ID,
  'video-output'
])

function unitNodeId(kind: string, unitId: string): string {
  return `script-nu-${kind}:${unitId}`
}

function ensureEdge(
  edges: GraphEdge[],
  sourceId: string,
  targetId: string,
  sourcePort: string,
  targetPort: string
): void {
  const linked = edges.some(
    (edge) =>
      edge.source === sourceId &&
      edge.target === targetId &&
      (edge.sourcePort ?? 'out') === sourcePort &&
      (edge.targetPort ?? 'in') === targetPort
  )
  if (linked) return
  edges.push({
    id: `edge-${sourceId}-${targetId}-${sourcePort}-${targetPort}`,
    source: sourceId,
    target: targetId,
    sourcePort,
    targetPort
  })
}

function chainPositions(index: number): Record<string, { x: number; y: number }> {
  const y = ORIGIN_Y + index * CHAIN_GAP_Y
  const x0 = ORIGIN_X + (index % COLS) * (STEP_X * 6 + 80)
  return {
    unitRef: { x: x0, y },
    split: { x: x0 + STEP_X, y },
    table: { x: x0 + STEP_X * 2, y },
    imageGen: { x: x0 + STEP_X * 3, y },
    videoGen: { x: x0 + STEP_X * 4, y },
    out: { x: x0 + STEP_X * 5, y }
  }
}

function upsertManagedNode(
  nextNodes: GraphNode[],
  found: GraphNode | undefined,
  create: () => GraphNode,
  patch: (node: GraphNode) => GraphNode
): void {
  if (found && nextNodes.some((n) => n.id === found.id)) {
    const idx = nextNodes.findIndex((n) => n.id === found.id)
    nextNodes[idx] = patch(nextNodes[idx]!)
    return
  }
  nextNodes.push(create())
}

function isManagedPipelineNode(node: GraphNode): boolean {
  if (!PIPELINE_TYPE_IDS.has(node.typeId)) return false
  if (readBoundUnitIdFromNodeParams(node.params)) return true
  if (EMPTY_CHAIN_IDS.has(node.id)) return true
  return false
}

function stripNarrativeInputSlots(nodes: GraphNode[], edges: GraphEdge[]): {
  nodes: GraphNode[]
  edges: GraphEdge[]
} {
  const drop = new Set(
    nodes
      .filter((node) => {
        if (!isHostInputSlotNode(node)) return false
        const slot = readHostInputSlot(node)
        return slot?.portId === 'in-narrative' || slot?.portId === 'in-text'
      })
      .map((n) => n.id)
  )
  if (!drop.size) return { nodes, edges }
  return {
    nodes: nodes.filter((n) => !drop.has(n.id)),
    edges: edges.filter((e) => !drop.has(e.source) && !drop.has(e.target))
  }
}

function ensureEmptyDefaultChain(nodes: GraphNode[], edges: GraphEdge[]): void {
  const pos = {
    split: { x: 120, y: 160 },
    table: { x: 340, y: 160 },
    imageGen: { x: 560, y: 160 },
    videoGen: { x: 780, y: 160 },
    out: { x: 1000, y: 160 }
  }
  const ensure = (
    id: string,
    typeId: GraphNode['typeId'],
    position: { x: number; y: number },
    title?: string,
    params?: GraphNode['params']
  ): GraphNode => {
    let node = nodes.find((n) => n.id === id)
    if (!node) {
      node =
        typeId === 'output.video'
          ? createOutputGraphNode('video', position, {
              id,
              title: title ?? 'Shot video output',
              params: {
                outputKind: 'video',
                inputDataType: GraphPortType.videoEntities,
                ...params
              }
            })
          : createNodeFromType(typeId, position, { id, title, params })
      nodes.push(node)
    } else {
      node.position = position
      if (title) node.title = title
    }
    return node
  }

  const split = ensure(GRAPH_SCRIPT_SHOT_SPLIT_NODE_ID, 'script.shotSplit', pos.split)
  const table = ensure(GRAPH_SCRIPT_SHOT_TABLE_NODE_ID, 'script.shotTable', pos.table)
  const imageGen = ensure(GRAPH_SCRIPT_SHOT_IMAGE_GEN_NODE_ID, 'script.shotImageGen', pos.imageGen)
  const videoGen = ensure(GRAPH_SCRIPT_SHOT_VIDEO_GEN_NODE_ID, 'script.shotVideoGen', pos.videoGen)
  const out = ensure('video-output', 'output.video', pos.out, 'Shot video output')

  ensureEdge(edges, split.id, table.id, 'out', 'in')
  ensureEdge(edges, table.id, imageGen.id, 'out', 'in')
  ensureEdge(edges, table.id, videoGen.id, 'out', 'in-text')
  ensureEdge(edges, imageGen.id, videoGen.id, 'out', 'in-entities')
  ensureEdge(edges, videoGen.id, out.id, 'out', 'in')
}

/** 按叙事单元同步分镜资产图管线 */
export function syncScriptNarrativeUnitChains(
  existing: GraphDocument | null | undefined,
  units: NarrativeUnitRow[]
): GraphDocument {
  const doc =
    existing?.nodes?.length
      ? cloneGraphDocument(existing)
      : createDefaultScopedGraph('scriptAsset', 'script')

  const managedByUnit = new Map<string, GraphNode[]>()
  for (const node of doc.nodes) {
    const unitId = readBoundUnitIdFromNodeParams(node.params)
    if (!unitId || !PIPELINE_TYPE_IDS.has(node.typeId)) continue
    const list = managedByUnit.get(unitId) ?? []
    list.push(node)
    managedByUnit.set(unitId, list)
  }

  let nextNodes = doc.nodes.filter((node) => {
    if (isHostInputSlotNode(node)) {
      const slot = readHostInputSlot(node)
      if (slot?.portId === 'in-narrative' || slot?.portId === 'in-text') return false
    }
    if (units.length === 0) {
      // 空态：丢掉托管多链，保留非管线用户节点与默认链
      const unitId = readBoundUnitIdFromNodeParams(node.params)
      if (unitId && PIPELINE_TYPE_IDS.has(node.typeId)) return false
      return true
    }
    // 非空：丢掉默认空链与已删单元托管节点
    if (EMPTY_CHAIN_IDS.has(node.id) && !readBoundUnitIdFromNodeParams(node.params)) {
      return false
    }
    const unitId = readBoundUnitIdFromNodeParams(node.params)
    if (unitId && PIPELINE_TYPE_IDS.has(node.typeId)) {
      return units.some((u) => u.id === unitId)
    }
    // 无 boundUnitId 的管线节点（旧默认链）在非空时删除
    if (PIPELINE_TYPE_IDS.has(node.typeId) && !unitId) {
      return false
    }
    return true
  })

  let nextEdges = doc.edges.filter(
    (edge) =>
      nextNodes.some((n) => n.id === edge.source) && nextNodes.some((n) => n.id === edge.target)
  )

  const stripped = stripNarrativeInputSlots(nextNodes, nextEdges)
  nextNodes = stripped.nodes
  nextEdges = stripped.edges

  if (units.length === 0) {
    ensureEmptyDefaultChain(nextNodes, nextEdges)
    return { ...doc, nodes: nextNodes, edges: nextEdges }
  }

  const findManaged = (unitId: string, typeId: string): GraphNode | undefined =>
    nextNodes.find(
      (n) =>
        n.typeId === typeId && readBoundUnitIdFromNodeParams(n.params) === unitId
    ) ?? managedByUnit.get(unitId)?.find((n) => n.typeId === typeId)

  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index]!
    const pos = chainPositions(index)
    const title = unit.title.trim() || `Unit ${unit.order}`
    const unitParams = { boundUnitId: unit.id }

    upsertManagedNode(
      nextNodes,
      findManaged(unit.id, 'narrative.unitRef'),
      () =>
        createNodeFromType('narrative.unitRef', pos.unitRef, {
          id: unitNodeId('ref', unit.id),
          title,
          params: unitParams
        }),
      (node) => ({
        ...node,
        title,
        position: pos.unitRef,
        params: { ...node.params, ...unitParams }
      })
    )

    upsertManagedNode(
      nextNodes,
      findManaged(unit.id, 'script.shotSplit'),
      () =>
        createNodeFromType('script.shotSplit', pos.split, {
          id: unitNodeId('split', unit.id),
          title: `${title} · split`,
          params: unitParams
        }),
      (node) => ({
        ...node,
        title: `${title} · split`,
        position: pos.split,
        params: { ...node.params, ...unitParams }
      })
    )

    upsertManagedNode(
      nextNodes,
      findManaged(unit.id, 'script.shotTable'),
      () =>
        createNodeFromType('script.shotTable', pos.table, {
          id: unitNodeId('table', unit.id),
          title: `${title} · table`,
          params: unitParams
        }),
      (node) => ({
        ...node,
        title: `${title} · table`,
        position: pos.table,
        params: { ...node.params, ...unitParams }
      })
    )

    upsertManagedNode(
      nextNodes,
      findManaged(unit.id, 'script.shotImageGen'),
      () =>
        createNodeFromType('script.shotImageGen', pos.imageGen, {
          id: unitNodeId('image', unit.id),
          title: `${title} · image`,
          params: unitParams
        }),
      (node) => ({
        ...node,
        title: `${title} · image`,
        position: pos.imageGen,
        params: { ...node.params, ...unitParams }
      })
    )

    upsertManagedNode(
      nextNodes,
      findManaged(unit.id, 'script.shotVideoGen'),
      () =>
        createNodeFromType('script.shotVideoGen', pos.videoGen, {
          id: unitNodeId('video', unit.id),
          title: `${title} · video`,
          params: unitParams
        }),
      (node) => ({
        ...node,
        title: `${title} · video`,
        position: pos.videoGen,
        params: { ...node.params, ...unitParams }
      })
    )

    upsertManagedNode(
      nextNodes,
      findManaged(unit.id, 'output.video'),
      () =>
        createOutputGraphNode('video', pos.out, {
          id: unitNodeId('out', unit.id),
          title: `${title} · out`,
          params: {
            ...unitParams,
            outputKind: 'video',
            inputDataType: GraphPortType.videoEntities
          }
        }),
      (node) => ({
        ...node,
        title: `${title} · out`,
        position: pos.out,
        params: {
          ...node.params,
          ...unitParams,
          outputKind: 'video',
          inputDataType: GraphPortType.videoEntities
        }
      })
    )
  }

  const nextIds = new Set(nextNodes.map((n) => n.id))
  nextEdges = nextEdges.filter((e) => nextIds.has(e.source) && nextIds.has(e.target))

  // 重建托管链边
  nextEdges = nextEdges.filter((edge) => {
    const source = nextNodes.find((n) => n.id === edge.source)
    const target = nextNodes.find((n) => n.id === edge.target)
    if (!source || !target) return false
    const sid = readBoundUnitIdFromNodeParams(source.params)
    const tid = readBoundUnitIdFromNodeParams(target.params)
    const managed =
      (source.typeId === 'narrative.unitRef' && target.typeId === 'script.shotSplit') ||
      (source.typeId === 'script.shotSplit' && target.typeId === 'script.shotTable') ||
      (source.typeId === 'script.shotTable' && target.typeId === 'script.shotImageGen') ||
      (source.typeId === 'script.shotTable' && target.typeId === 'script.shotVideoGen') ||
      (source.typeId === 'script.shotImageGen' && target.typeId === 'script.shotVideoGen') ||
      (source.typeId === 'script.shotVideoGen' && target.typeId === 'output.video')
    if (managed) return !!sid && sid === tid
    return true
  })

  for (const unit of units) {
    const ref = nextNodes.find(
      (n) =>
        n.typeId === 'narrative.unitRef' &&
        readBoundUnitIdFromNodeParams(n.params) === unit.id
    )
    const split = nextNodes.find(
      (n) =>
        n.typeId === 'script.shotSplit' &&
        readBoundUnitIdFromNodeParams(n.params) === unit.id
    )
    const table = nextNodes.find(
      (n) =>
        n.typeId === 'script.shotTable' &&
        readBoundUnitIdFromNodeParams(n.params) === unit.id
    )
    const imageGen = nextNodes.find(
      (n) =>
        n.typeId === 'script.shotImageGen' &&
        readBoundUnitIdFromNodeParams(n.params) === unit.id
    )
    const videoGen = nextNodes.find(
      (n) =>
        n.typeId === 'script.shotVideoGen' &&
        readBoundUnitIdFromNodeParams(n.params) === unit.id
    )
    const out = nextNodes.find(
      (n) =>
        n.typeId === 'output.video' &&
        readBoundUnitIdFromNodeParams(n.params) === unit.id
    )
    if (ref && split) ensureEdge(nextEdges, ref.id, split.id, 'out', 'in')
    if (split && table) ensureEdge(nextEdges, split.id, table.id, 'out', 'in')
    if (table && imageGen) ensureEdge(nextEdges, table.id, imageGen.id, 'out', 'in')
    if (table && videoGen) ensureEdge(nextEdges, table.id, videoGen.id, 'out', 'in-text')
    if (imageGen && videoGen) ensureEdge(nextEdges, imageGen.id, videoGen.id, 'out', 'in-entities')
    if (videoGen && out) ensureEdge(nextEdges, videoGen.id, out.id, 'out', 'in')
  }

  // 世界输入槽 fan-out 到各 table
  const worldSlots = nextNodes.filter((node) => {
    if (node.typeId !== GRAPH_INPUT_SLOT_TYPE_ID) return false
    return readHostInputSlot(node)?.portId === 'in-worldEntities'
  })
  for (const slot of worldSlots) {
    for (const unit of units) {
      const table = nextNodes.find(
        (n) =>
          n.typeId === 'script.shotTable' &&
          readBoundUnitIdFromNodeParams(n.params) === unit.id
      )
      if (table) ensureEdge(nextEdges, slot.id, table.id, 'out', 'in-worldEntities')
    }
  }

  return { ...doc, nodes: nextNodes, edges: nextEdges }
}

export function isScriptNarrativeManagedNode(node: GraphNode): boolean {
  return isManagedPipelineNode(node)
}

export interface ResolveNarrativeUnitsForScriptOptions {
  resolveAssetGenParams?: (assetId: string) => Record<string, unknown> | undefined
}

function catalogFromGenParams(gen: Record<string, unknown> | undefined): NarrativeUnitRow[] {
  if (!gen) return []
  const raw = gen.narrativeCatalog
  if (typeof raw === 'string') return parseNarrativeUnitJson(raw) ?? []
  if (Array.isArray(raw)) return parseNarrativeUnitJson(JSON.stringify(raw)) ?? []
  return []
}

/**
 * 从父图指向分镜宿主 `in-narrative` 的边解析叙事单元目录。
 * 优先叙事资产 genParams.narrativeCatalog；否则解析边上的 narrative JSON。
 */
export function resolveNarrativeUnitsForScriptHost(
  parents: GraphDocument[],
  hostAssetId: string,
  options?: ResolveNarrativeUnitsForScriptOptions
): NarrativeUnitRow[] {
  if (!hostAssetId.trim() || !parents.length) return []

  for (const parent of parents) {
    const hostNodes = parent.nodes.filter(
      (node) =>
        node.assetId === hostAssetId &&
        (node.params.assetHost === true || node.params.assetRef === true)
    )
    for (const hostNode of hostNodes) {
      const edges = parent.edges.filter(
        (edge) =>
          edge.target === hostNode.id && (edge.targetPort ?? 'in') === 'in-narrative'
      )
      for (const edge of edges) {
        const source = parent.nodes.find((n) => n.id === edge.source)
        if (!source) continue
        if (
          (source.assetType === 'narrative' || source.typeId === 'asset.narrative') &&
          source.assetId
        ) {
          const rows = catalogFromGenParams(options?.resolveAssetGenParams?.(source.assetId))
          if (rows.length) return rows
        }
        const runOut = parent.runStates?.[source.id]?.outputs?.[edge.sourcePort ?? 'out'] as
          | { kind?: string; text?: string }
          | undefined
        if (runOut?.kind === 'narrative' && typeof runOut.text === 'string') {
          const rows = parseNarrativeUnitJson(runOut.text) ?? []
          if (rows.length) return rows
        }
        const text = source.params.text?.trim() || source.params.resultText?.trim() || ''
        if (text.startsWith('[') || text.startsWith('{')) {
          const rows = parseNarrativeUnitJson(text) ?? []
          if (rows.length) return rows
        }
      }
    }
  }
  return []
}
