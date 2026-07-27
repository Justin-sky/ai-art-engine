/**
 * 将世界元素目录条目同步到 elementWorkflow 子图：
 * 每条：play.script（输入参数）→ asset.image → output.image
 */
import { createNodeFromType, createOutputGraphNode } from './create'
import { normalizeScopedGraph } from './normalize'
import type { GraphDocument, GraphEdge, GraphNode } from './types'
import { normalizeShotReviewStatus } from '../domain'
import { readWorldElementIdFromNodeParams } from './worldElementParams'
import type { WorldElementItem } from './worldElementParse'

const COLS = 3
const PAIR_GAP_X = 560
const PAIR_GAP_Y = 160
const ORIGIN_X = 80
const ORIGIN_Y = 80
const GEN_DX = 200
const OUT_DX = 400

function worldElementScriptNodeId(elementId: string): string {
  return `world-el-script:${elementId}`
}

function worldElementOutputNodeId(elementId: string): string {
  return `world-el-out:${elementId}`
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

function chainPosition(index: number): {
  script: { x: number; y: number }
  gen: { x: number; y: number }
  out: { x: number; y: number }
} {
  const col = index % COLS
  const row = Math.floor(index / COLS)
  const script = {
    x: ORIGIN_X + col * PAIR_GAP_X,
    y: ORIGIN_Y + row * PAIR_GAP_Y
  }
  return {
    script,
    gen: { x: script.x + GEN_DX, y: script.y },
    out: { x: script.x + OUT_DX, y: script.y }
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

/** 按目录条目物化 elementWorkflow：script → image gen → image out */
export function syncWorldElementKindGraph(
  existing: GraphDocument | null | undefined,
  items: WorldElementItem[]
): GraphDocument {
  const doc = normalizeScopedGraph('elementWorkflow', existing ?? null, {
    assetType: 'world'
  })

  const managedScripts = new Map<string, GraphNode>()
  const managedGens = new Map<string, GraphNode>()
  const managedOuts = new Map<string, GraphNode>()
  for (const node of doc.nodes) {
    const id = readWorldElementIdFromNodeParams(node.params)
    if (!id) continue
    if (node.typeId === 'play.script') managedScripts.set(id, node)
    else if (node.typeId === 'asset.image') managedGens.set(id, node)
    else if (node.typeId === 'output.image') managedOuts.set(id, node)
  }

  const keepIds = new Set(items.map((item) => item.id))
  // 去掉已删除条目的托管节点
  const nextNodes: GraphNode[] = doc.nodes.filter((node) => {
    const id = readWorldElementIdFromNodeParams(node.params)
    if (!id) return true
    return keepIds.has(id)
  })

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!
    const pos = chainPosition(index)
    const foundScript = managedScripts.get(item.id)
    const foundGen = managedGens.get(item.id)
    const foundOut = managedOuts.get(item.id)

    upsertManagedNode(
      nextNodes,
      foundScript,
      () =>
        createNodeFromType('play.script', pos.script, {
          id: worldElementScriptNodeId(item.id),
          title: item.name,
          params: {
            worldElementId: item.id,
            text: item.prompt
          }
        }),
      (node) => ({
        ...node,
        title: item.name,
        position: pos.script,
        params: {
          ...node.params,
          worldElementId: item.id,
          text: item.prompt
        }
      })
    )

    upsertManagedNode(
      nextNodes,
      foundGen,
      () =>
        createNodeFromType('asset.image', pos.gen, {
          title: item.name,
          params: {
            worldElementId: item.id,
            generateInstruction: '',
            reviewStatus: normalizeShotReviewStatus(item.status)
          }
        }),
      (node) => ({
        ...node,
        title: item.name,
        position: pos.gen,
        params: {
          ...node.params,
          worldElementId: item.id,
          generateInstruction: '',
          reviewStatus: normalizeShotReviewStatus(item.status)
        }
      })
    )

    upsertManagedNode(
      nextNodes,
      foundOut,
      () =>
        createOutputGraphNode('image', pos.out, {
          id: worldElementOutputNodeId(item.id),
          title: item.name,
          params: { worldElementId: item.id }
        }),
      (node) => ({
        ...node,
        title: item.name,
        position: pos.out,
        params: {
          ...node.params,
          worldElementId: item.id
        }
      })
    )
  }

  const nextIds = new Set(nextNodes.map((node) => node.id))
  const edges = doc.edges.filter(
    (edge) => nextIds.has(edge.source) && nextIds.has(edge.target)
  )

  // 只保留同元素 id 的托管边；其余托管相关边丢弃后重建
  const cleanedEdges = edges.filter((edge) => {
    const source = nextNodes.find((n) => n.id === edge.source)
    const target = nextNodes.find((n) => n.id === edge.target)
    if (!source || !target) return false
    const sid = readWorldElementIdFromNodeParams(source.params)
    const tid = readWorldElementIdFromNodeParams(target.params)
    const managedLink =
      (source.typeId === 'play.script' && target.typeId === 'asset.image') ||
      (source.typeId === 'asset.image' && target.typeId === 'output.image')
    if (managedLink) return !!sid && sid === tid
    return true
  })

  for (const item of items) {
    const script = nextNodes.find(
      (n) =>
        n.typeId === 'play.script' &&
        readWorldElementIdFromNodeParams(n.params) === item.id
    )
    const gen = nextNodes.find(
      (n) =>
        n.typeId === 'asset.image' &&
        readWorldElementIdFromNodeParams(n.params) === item.id
    )
    const out = nextNodes.find(
      (n) =>
        n.typeId === 'output.image' &&
        readWorldElementIdFromNodeParams(n.params) === item.id
    )
    if (script && gen) {
      ensureEdge(cleanedEdges, script.id, gen.id, 'out', 'in-text')
    }
    if (gen && out) {
      ensureEdge(cleanedEdges, gen.id, out.id, 'out', 'in')
    }
  }

  return {
    ...doc,
    nodes: nextNodes,
    edges: cleanedEdges
  }
}
