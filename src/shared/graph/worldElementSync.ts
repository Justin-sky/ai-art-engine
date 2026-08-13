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
import { normalizeReviewStatus } from './reviewStatus'
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

export interface WorldElementBriefInput {
  style?: string
  worldview?: string
}

function buildWorldElementBriefInstruction(brief?: WorldElementBriefInput): string {
  const parts: string[] = []
  const style = brief?.style?.trim()
  const worldview = brief?.worldview?.trim()
  if (style) parts.push(`画风设定：${style}`)
  if (worldview) parts.push(`世界观设定：${worldview}`)
  return parts.join('\n\n')
}

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

function graphEdgeKey(edge: GraphEdge): string {
  return `${edge.source}:${edge.sourcePort ?? 'out'}->${edge.target}:${edge.targetPort ?? 'in'}`
}

/** 生成节点是否已有可用图片（落盘预览或图库条目），用于区分空壳托管节点 */
function hasUsableGeneratedImage(node: GraphNode): boolean {
  if (typeof node.params.previewRelativePath === 'string' && node.params.previewRelativePath.trim()) {
    return true
  }
  const images = node.params.generatedImages
  if (!Array.isArray(images)) return false
  return images.some((item) => {
    const row = item as { relativePath?: unknown; dataUrl?: unknown }
    return (
      (typeof row.relativePath === 'string' && row.relativePath.trim().length > 0) ||
      (typeof row.dataUrl === 'string' && row.dataUrl.trim().length > 0)
    )
  })
}

interface ElementChain {
  /** 链上所有边的规范化 key（保留用） */
  edgeKeys: Set<string>
  /** 链上所有节点 id */
  nodeIds: Set<string>
  /** script 之后的第一个 asset.image 链首（认领为托管生成节点） */
  headGenId: string | null
}

/**
 * 收集每个目录条目从 script 到 boundary 的既有图片链：script → (asset.image)* → boundary.output。
 * 用于认领用户已有链路（含中间加工节点，如角色三视图），
 * 避免同步时把旧链拆散、再新建一个无图空壳生成节点导致预览缺项。
 */
function collectElementChains(
  doc: GraphDocument,
  items: WorldElementItem[],
  managedScripts: Map<string, GraphNode>
): Map<string, ElementChain> {
  const nodeById = new Map(doc.nodes.map((node) => [node.id, node]))
  const edgesBySource = new Map<string, GraphEdge[]>()
  for (const edge of doc.edges) {
    const list = edgesBySource.get(edge.source)
    if (list) list.push(edge)
    else edgesBySource.set(edge.source, [edge])
  }

  const chains = new Map<string, ElementChain>()
  const walk = (
    currentId: string,
    itemId: string,
    boundaryId: string,
    visited: Set<string>,
    pathEdges: GraphEdge[],
    chain: ElementChain
  ): void => {
    if (currentId === boundaryId) {
      for (const edge of pathEdges) {
        chain.edgeKeys.add(graphEdgeKey(edge))
        chain.nodeIds.add(edge.source)
        chain.nodeIds.add(edge.target)
      }
      return
    }
    if (visited.has(currentId) || pathEdges.length >= 16) return
    const node = nodeById.get(currentId)
    if (!node) return
    const traversable =
      node.typeId === 'play.script' ||
      node.typeId === 'asset.image' ||
      isBoundaryOutputNode(node)
    if (!traversable) return
    // 不跨元素：已带其它 worldElementId 的节点不并入本链
    const wid = readWorldElementIdFromNodeParams(node.params)
    if (wid && wid !== itemId && !isBoundaryOutputNode(node)) return
    visited.add(currentId)
    for (const edge of edgesBySource.get(currentId) ?? []) {
      walk(edge.target, itemId, boundaryId, visited, [...pathEdges, edge], chain)
    }
    visited.delete(currentId)
  }

  for (const item of items) {
    const script = managedScripts.get(item.id)
    const boundaryId = boundaryOutputNodeId(worldElementBoundaryPortId(item.id))
    if (!script || !nodeById.has(boundaryId)) continue
    const chain: ElementChain = { edgeKeys: new Set(), nodeIds: new Set(), headGenId: null }
    walk(script.id, item.id, boundaryId, new Set(), [], chain)
    if (!chain.edgeKeys.size) continue
    const firstGen = (edgesBySource.get(script.id) ?? [])
      .map((edge) => nodeById.get(edge.target))
      .find((node) => node?.typeId === 'asset.image')
    chain.headGenId = firstGen?.id ?? null
    chains.set(item.id, chain)
  }
  return chains
}

/** 按目录条目物化 elementWorkflow：script → image gen → boundary.output */
export function syncWorldElementKindGraph(
  existing: GraphDocument | null | undefined,
  items: WorldElementItem[],
  brief?: WorldElementBriefInput
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

  // 既有链路认领计划：有完整 script → … → boundary 时，链首作托管 gen，
  // 取代无图的空壳托管节点，避免同步拆链/新建空节点。
  const chains = collectElementChains(doc, items, managedScripts)
  const adoptPlan = new Map<string, GraphNode>()
  const supersedeIds = new Set<string>()
  for (const item of items) {
    const chain = chains.get(item.id)
    if (!chain?.headGenId) continue
    const head = doc.nodes.find((node) => node.id === chain.headGenId)
    if (!head || head.typeId !== 'asset.image') continue
    const headWid = readWorldElementIdFromNodeParams(head.params)
    if (headWid === item.id) continue
    const current = managedGens.get(item.id)
    if (current && !hasUsableGeneratedImage(current)) {
      supersedeIds.add(current.id)
    }
    adoptPlan.set(item.id, head)
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
    if (supersedeIds.has(node.id)) return false
    const id = readWorldElementIdFromNodeParams(node.params)
    if (!id) return true
    return keepIds.has(id)
  })

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!
    const pos = chainPosition(index)
    const foundScript = managedScripts.get(item.id)
    const foundGen = adoptPlan.get(item.id) ?? managedGens.get(item.id)
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
             generateInstruction: buildWorldElementBriefInstruction(brief),
  reviewStatus: normalizeReviewStatus(item.status)
           }
        }),
      (node) => ({
        ...node,
        title: item.name,
        position: pos.gen,
        params: {
           ...node.params,
           worldElementId: item.id,
           generateInstruction: buildWorldElementBriefInstruction(brief),
  reviewStatus: normalizeReviewStatus(item.status)
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

  // 既有链路的边完整保留（含中间加工节点），其余按托管边规则清理
  const chainEdgeKeys = new Set<string>()
  for (const chain of chains.values()) {
    for (const key of chain.edgeKeys) chainEdgeKeys.add(key)
  }
  // 只保留同元素 id 的托管边；其余托管相关边丢弃后重建
  const cleanedEdges = edges.filter((edge) => {
    if (chainEdgeKeys.has(graphEdgeKey(edge))) return true
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
    const hasChain = !!chains.get(item.id)?.edgeKeys.size
    if (script && gen && !hasChain) {
      ensureEdge(cleanedEdges, script.id, gen.id, 'out', 'in-text')
    }
    if (gen && boundary && !hasChain) {
      ensureEdge(cleanedEdges, gen.id, boundary.id, 'out', 'in')
    }
  }

  return {
    ...withBoundary,
    nodes: alignedNodes,
    edges: cleanedEdges
  }
}
