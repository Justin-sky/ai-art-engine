/**
 * 将世界元素目录条目同步到 elementWorkflow 子图：
 * 每条：play.script（提示词）→ asset.image → graph.boundary.output（image）
 * 无边界输入；结果从边界输出 runStates 汇集为世界元素实体。
 */
import { createNodeFromType } from './create'
import {
  boundaryOutputNodeId,
  isBoundaryInputNode,
  isBoundaryOutputNode
} from './hostInterface'
import { normalizeScopedGraph } from './normalize'
import type { GraphDocument, GraphEdge, GraphNode } from './types'
import { GraphPortType } from './types'
import { normalizeShotReviewStatus } from '../domain'
import {
  hostInterfaceForElementWorkflow,
  readWorldElementIdFromNodeParams,
  worldElementBoundaryPortId
} from './worldElementParams'
import type { WorldElementItem } from './worldElementParse'

export {
  hostInterfaceForElementWorkflow,
  inferElementWorkflowHostInterface,
  worldElementBoundaryPortId
} from './worldElementParams'

const COLS = 3
const PAIR_GAP_X = 560
const PAIR_GAP_Y = 160
const ORIGIN_X = 80
const ORIGIN_Y = 80
const GEN_DX = 200
const BOUNDARY_DX = 200

export function worldElementScriptNodeId(elementId: string): string {
  return `world-el-script:${elementId}`
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
  boundary: { x: number; y: number }
} {
  const col = index % COLS
  const row = Math.floor(index / COLS)
  const script = {
    x: ORIGIN_X + col * PAIR_GAP_X,
    y: ORIGIN_Y + row * PAIR_GAP_Y
  }
  const gen = { x: script.x + GEN_DX, y: script.y }
  return {
    script,
    gen,
    boundary: { x: gen.x + BOUNDARY_DX, y: gen.y }
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

function isManagedWorldElementNode(node: GraphNode): boolean {
  if (readWorldElementIdFromNodeParams(node.params)) {
    return (
      node.typeId === 'play.script' ||
      node.typeId === 'asset.image' ||
      isBoundaryOutputNode(node)
    )
  }
  return isBoundaryInputNode(node) || node.typeId === 'output.image' || node.category === 'output'
}

/** 按目录条目物化 elementWorkflow：script → image gen → boundary.output */
export function syncWorldElementKindGraph(
  existing: GraphDocument | null | undefined,
  items: WorldElementItem[]
): GraphDocument {
  const iface = hostInterfaceForElementWorkflow(items)
  const doc = normalizeScopedGraph('elementWorkflow', existing ?? null, {
    assetType: 'world',
    hostInterface: iface
  })

  const managedScripts = new Map<string, GraphNode>()
  const managedGens = new Map<string, GraphNode>()
  for (const node of doc.nodes) {
    const id = readWorldElementIdFromNodeParams(node.params)
    if (!id) continue
    if (node.typeId === 'play.script') managedScripts.set(id, node)
    else if (node.typeId === 'asset.image') managedGens.set(id, node)
  }

  const keepIds = new Set(items.map((item) => item.id))
  const keepBoundaryIds = new Set(
    items.map((item) => boundaryOutputNodeId(worldElementBoundaryPortId(item.id)))
  )

  // 去掉已删除条目的托管节点、全部边界输入、历史 classic 输出
  const nextNodes: GraphNode[] = doc.nodes.filter((node) => {
    if (isBoundaryInputNode(node)) return false
    if (node.typeId === 'output.image' || node.category === 'output') return false
    if (isBoundaryOutputNode(node)) {
      return keepBoundaryIds.has(node.id)
    }
    const id = readWorldElementIdFromNodeParams(node.params)
    if (!id) return true
    return keepIds.has(id)
  })

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!
    const pos = chainPosition(index)
    const foundScript = managedScripts.get(item.id)
    const foundGen = managedGens.get(item.id)
    const boundaryPortId = worldElementBoundaryPortId(item.id)
    const boundaryId = boundaryOutputNodeId(boundaryPortId)
    const foundBoundary = nextNodes.find((node) => node.id === boundaryId)

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
      foundBoundary,
      () => ({
        id: boundaryId,
        typeId: 'graph.boundary.output',
        category: 'note',
        position: pos.boundary,
        title: item.name,
        params: {
          previewCollapsed: true,
          worldElementId: item.id,
          hostBoundaryPort: {
            portId: boundaryPortId,
            dataType: GraphPortType.image,
            multiple: false
          }
        }
      }),
      (node) => ({
        ...node,
        title: item.name,
        position: pos.boundary,
        params: {
          ...node.params,
          // 保留已有折叠态 / 预览路径，勿每次同步压回折叠
          worldElementId: item.id,
          hostBoundaryPort: {
            portId: boundaryPortId,
            dataType: GraphPortType.image,
            multiple: false
          }
        }
      })
    )
  }

  // 再对齐接口并清掉残留输入
  const withBoundary = normalizeScopedGraph(
    'elementWorkflow',
    { ...doc, nodes: nextNodes, edges: doc.edges },
    { assetType: 'world', hostInterface: iface }
  )

  // ensure 可能重置位置/标题；把托管字段写回边界输出
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!
    const boundaryPortId = worldElementBoundaryPortId(item.id)
    const boundaryId = boundaryOutputNodeId(boundaryPortId)
    const pos = chainPosition(index)
    const idx = withBoundary.nodes.findIndex((node) => node.id === boundaryId)
    if (idx < 0) continue
    const node = withBoundary.nodes[idx]!
    withBoundary.nodes[idx] = {
      ...node,
      title: item.name,
      position: pos.boundary,
      params: {
        ...node.params,
        worldElementId: item.id,
        hostBoundaryPort: {
          portId: boundaryPortId,
          dataType: GraphPortType.image,
          multiple: false
        }
      }
    }
  }

  const alignedNodes = withBoundary.nodes.filter((node) => !isBoundaryInputNode(node))
  const nextIds = new Set(alignedNodes.map((node) => node.id))
  const edges = withBoundary.edges.filter(
    (edge) => nextIds.has(edge.source) && nextIds.has(edge.target)
  )

  // 只保留同元素 id 的托管边；其余托管相关边丢弃后重建
  const cleanedEdges = edges.filter((edge) => {
    const source = alignedNodes.find((n) => n.id === edge.source)
    const target = alignedNodes.find((n) => n.id === edge.target)
    if (!source || !target) return false
    const sid = readWorldElementIdFromNodeParams(source.params)
    const tid = readWorldElementIdFromNodeParams(target.params)
    const scriptToGen = source.typeId === 'play.script' && target.typeId === 'asset.image'
    const genToBoundary = source.typeId === 'asset.image' && isBoundaryOutputNode(target)
    if (scriptToGen || genToBoundary) return !!sid && sid === tid
    if (isManagedWorldElementNode(source) || isManagedWorldElementNode(target)) return false
    return true
  })

  for (const item of items) {
    const script = alignedNodes.find(
      (n) =>
        n.typeId === 'play.script' &&
        readWorldElementIdFromNodeParams(n.params) === item.id
    )
    const gen = alignedNodes.find(
      (n) =>
        n.typeId === 'asset.image' &&
        readWorldElementIdFromNodeParams(n.params) === item.id
    )
    const boundary = alignedNodes.find(
      (n) => n.id === boundaryOutputNodeId(worldElementBoundaryPortId(item.id))
    )
    if (script && gen) {
      ensureEdge(cleanedEdges, script.id, gen.id, 'out', 'in-text')
    }
    if (gen && boundary) {
      ensureEdge(cleanedEdges, gen.id, boundary.id, 'out', 'in')
    }
  }

  return {
    ...withBoundary,
    nodes: alignedNodes,
    edges: cleanedEdges
  }
}
