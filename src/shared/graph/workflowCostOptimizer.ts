/**
 * 画布「算力/Token 精算师」与关键路径加速优化器
 * （Workflow Token/Cost Estimator & Critical-Path Optimizer）
 *
 * 1. 静态分析 `GraphDocument` 的 DAG 拓扑依赖关系，预估每个节点的算力积分消耗（Credits）、API 调用次数与单点耗时
 * 2. 精确计算全图串行总耗时（`totalSerialLatencySec`）与最大并行关键路径耗时（`criticalPathLatencySec`），标出拖慢全图的瓶颈节点链
 * 3. 自动识别「已有生成产物但未加锁」的高成本重型节点（`redundantCookNodes`）与重复提示词节点组（`duplicatePromptGroups`）
 * 4. 支持一键生成并应用「智能省流缓存锁定方案」（`applyWorkflowAutoCacheOptimization`），防止全图运行时重复扣费重跑
 */

import type { GraphDocument, GraphNode } from './types'

export interface NodeCostEstimateItem {
  nodeId: string
  nodeTitle: string
  nodeTypeId: string
  locked: boolean
  hasCachedOutput: boolean
  /** 预估 API 调用次数 */
  estimatedApiCalls: number
  /** 预估等效算力积分（1 Credit ≈ 1 张标准 1K 生图） */
  estimatedCredits: number
  /** 预估节点执行耗时（秒） */
  estimatedLatencySec: number
}

export interface DuplicatePromptGroup {
  typeId: string
  instructionSnippet: string
  nodeIds: string[]
}

export interface WorkflowCostAuditReport {
  totalNodes: number
  activeUnlockedNodes: number
  totalEstimatedApiCalls: number
  totalEstimatedCredits: number
  /** 若全部串行排队执行的总耗时（秒） */
  totalSerialLatencySec: number
  /** 按 DAG 拓扑最大并行度执行的关键路径最短耗时（秒） */
  criticalPathLatencySec: number
  /** 并行加速比（totalSerialLatencySec / criticalPathLatencySec） */
  parallelSpeedupFactor: number
  /** 关键路径上的瓶颈节点 ID 序列（按拓扑先后排序） */
  criticalPathNodeIds: string[]
  /** 已有缓存产物但未加锁、重跑会白白消耗算力的节点列表 */
  redundantCookNodes: NodeCostEstimateItem[]
  /** 检测到完全相同指令的重复生成节点组 */
  duplicatePromptGroups: DuplicatePromptGroup[]
  /** 假定锁定所有已有产物节点后可节省的算力积分与耗时 */
  potentialSavedCredits: number
  potentialSavedSec: number
  nodeBreakdown: NodeCostEstimateItem[]
}

function hasExistingCookedOutput(node: GraphNode): boolean {
  const p = node.params
  if (!p) return false
  return Boolean(
    (Array.isArray(p.generatedImages) && p.generatedImages.length > 0) ||
    (Array.isArray(p.generatedVideos) && p.generatedVideos.length > 0) ||
    (Array.isArray(p.generatedModels) && p.generatedModels.length > 0) ||
    (Array.isArray(p.generatedVoices) && p.generatedVoices.length > 0) ||
    (Array.isArray(p.generatedTexts) && p.generatedTexts.length > 0) ||
    (typeof p.portraitBakedRelativePath === 'string' && p.portraitBakedRelativePath.trim()) ||
    (typeof p.rebuildLastOutput === 'string' && p.rebuildLastOutput.trim())
  )
}

function estimateSingleNodeProfile(node: GraphNode): {
  apiCalls: number
  credits: number
  latencySec: number
} {
  const tid = node.typeId ?? ''
  const p = node.params ?? {}

  // 被锁定的节点直接复用缓存，0 API 消耗、0 秒等待
  if (p.locked) {
    return { apiCalls: 0, credits: 0, latencySec: 0 }
  }

  // 纯输入/输出/注释/选取类节点：0 算力消耗
  if (
    tid.startsWith('asset.') ||
    tid.startsWith('output.') ||
    tid.startsWith('note.') ||
    tid === 'text.plain' ||
    tid.endsWith('.select') ||
    tid === 'media.bundle' ||
    tid === 'image.crop' ||
    tid === 'image.transform' ||
    tid === 'image.gridSplit'
  ) {
    return { apiCalls: 0, credits: 0, latencySec: 0.1 }
  }

  const count = Math.max(1, Number(p.generateCount ?? 1))
  const resMultiplier =
    p.generateResolution === '4K' ? 2.2 : p.generateResolution === '2K' ? 1.4 : 1.0

  // 视频生成 / 语义重建 / 对口型 / 片段重拍（高算力重型节点）
  if (
    tid === 'video.generate' ||
    tid === 'video.lipSync' ||
    tid === 'video.reshoot' ||
    tid === 'film.render'
  ) {
    const durationSec = Math.max(4, Number(p.generateDuration ?? 5))
    const durationFactor = durationSec / 5
    return {
      apiCalls: count,
      credits: Number((count * 8.0 * durationFactor * resMultiplier).toFixed(2)),
      latencySec: Math.round(42 * durationFactor)
    }
  }

  // 3D 模型生成 / 空间世界 / 骨骼蒙皮 / 3D 贴图
  if (tid.startsWith('model.') || tid.includes('spatialWorld')) {
    return {
      apiCalls: 1,
      credits: 6.0,
      latencySec: 35
    }
  }

  // 高清放大 / 图层分离
  if (tid === 'image.upscale' || tid === 'image.layerSplit') {
    return {
      apiCalls: 1,
      credits: Number((1.8 * resMultiplier).toFixed(2)),
      latencySec: 12
    }
  }

  // 广告变体矩阵批量生图
  if (p.adVariantMatrix && Array.isArray(p.adVariantMatrix.cells)) {
    const activeCells = p.adVariantMatrix.cells.filter((c) => !c.locked).length || 4
    return {
      apiCalls: activeCells,
      credits: Number((activeCells * 1.0 * resMultiplier).toFixed(2)),
      latencySec: Math.round(activeCells * 8)
    }
  }

  // 图片生成 / 人像 AI 精修 / 2.5D 打光 / 扩图 / 重绘 / 擦除
  if (tid.startsWith('image.') || tid === 'svg.gen' || tid === 'film.shot' || tid === 'film.cast') {
    return {
      apiCalls: count,
      credits: Number((count * 1.0 * resMultiplier).toFixed(2)),
      latencySec: Math.round(9 * count * (resMultiplier > 1.2 ? 1.3 : 1))
    }
  }

  // 语音 / 音效 / 剧本 / LLM 决策节点
  if (
    tid.startsWith('voice.') ||
    tid.startsWith('prompt.') ||
    tid.startsWith('film.') ||
    tid.startsWith('decisions.')
  ) {
    return {
      apiCalls: 1,
      credits: 0.4,
      latencySec: 5
    }
  }

  return {
    apiCalls: 1,
    credits: 0.5,
    latencySec: 4
  }
}

/**
 * 静态分析画布工作流（`GraphDocument`）的算力成本、关键路径耗时与可缓存冗余节点
 */
export function estimateWorkflowCostAndCriticalPath(doc: GraphDocument): WorkflowCostAuditReport {
  const nodes = Array.isArray(doc.nodes) ? doc.nodes : []
  const edges = Array.isArray(doc.edges) ? doc.edges : []

  const nodeBreakdown: NodeCostEstimateItem[] = []
  const itemById = new Map<string, NodeCostEstimateItem>()

  for (const node of nodes) {
    const prof = estimateSingleNodeProfile(node)
    const item: NodeCostEstimateItem = {
      nodeId: node.id,
      nodeTitle: node.title || node.typeId || node.id,
      nodeTypeId: node.typeId || 'unknown',
      locked: Boolean(node.params?.locked),
      hasCachedOutput: hasExistingCookedOutput(node),
      estimatedApiCalls: prof.apiCalls,
      estimatedCredits: prof.credits,
      estimatedLatencySec: prof.latencySec
    }
    nodeBreakdown.push(item)
    itemById.set(node.id, item)
  }

  // 构建 DAG 邻接表与入度表，计算最长关键路径（Critical Path）
  const adj = new Map<string, string[]>()
  const inDegree = new Map<string, number>()
  for (const n of nodes) {
    adj.set(n.id, [])
    inDegree.set(n.id, 0)
  }

  for (const e of edges) {
    const srcId = e.source || (e as { fromNodeId?: string }).fromNodeId || ''
    const dstId = e.target || (e as { toNodeId?: string }).toNodeId || ''
    if (adj.has(srcId) && inDegree.has(dstId) && srcId !== dstId) {
      adj.get(srcId)!.push(dstId)
      inDegree.set(dstId, (inDegree.get(dstId) ?? 0) + 1)
    }
  }

  // Kahn 拓扑排序 + 动态规划最长耗时路径
  const queue: string[] = []
  const distSec = new Map<string, number>()
  const prevNode = new Map<string, string | null>()

  for (const n of nodes) {
    const lat = itemById.get(n.id)?.estimatedLatencySec ?? 0
    distSec.set(n.id, lat)
    prevNode.set(n.id, null)
    if ((inDegree.get(n.id) ?? 0) === 0) {
      queue.push(n.id)
    }
  }

  let head = 0
  while (head < queue.length) {
    const u = queue[head++]!
    const uDist = distSec.get(u) ?? 0
    for (const v of adj.get(u) ?? []) {
      const vLat = itemById.get(v)?.estimatedLatencySec ?? 0
      if (uDist + vLat > (distSec.get(v) ?? 0)) {
        distSec.set(v, uDist + vLat)
        prevNode.set(v, u)
      }
      const nextIn = (inDegree.get(v) ?? 1) - 1
      inDegree.set(v, nextIn)
      if (nextIn === 0) {
        queue.push(v)
      }
    }
  }

  // 回溯关键路径节点链
  let maxEndNodeId: string | null = null
  let maxPathSec = 0
  for (const [nid, d] of distSec.entries()) {
    if (d > maxPathSec) {
      maxPathSec = d
      maxEndNodeId = nid
    }
  }

  const criticalPathNodeIds: string[] = []
  let curr = maxEndNodeId
  const visited = new Set<string>()
  while (curr && !visited.has(curr)) {
    visited.add(curr)
    if ((itemById.get(curr)?.estimatedLatencySec ?? 0) > 0) {
      criticalPathNodeIds.unshift(curr)
    }
    curr = prevNode.get(curr) ?? null
  }

  const totalEstimatedApiCalls = nodeBreakdown.reduce((s, i) => s + i.estimatedApiCalls, 0)
  const totalEstimatedCredits = Number(
    nodeBreakdown.reduce((s, i) => s + i.estimatedCredits, 0).toFixed(2)
  )
  const totalSerialLatencySec = Math.round(
    nodeBreakdown.reduce((s, i) => s + i.estimatedLatencySec, 0)
  )
  const criticalPathLatencySec = Math.round(maxPathSec)
  const parallelSpeedupFactor =
    criticalPathLatencySec > 0
      ? Number(Math.max(1, totalSerialLatencySec / criticalPathLatencySec).toFixed(2))
      : 1

  // 识别已有生成缓存但未锁定的重型节点
  const redundantCookNodes = nodeBreakdown.filter(
    (item) => !item.locked && item.hasCachedOutput && item.estimatedCredits >= 0.5
  )

  const potentialSavedCredits = Number(
    redundantCookNodes.reduce((s, i) => s + i.estimatedCredits, 0).toFixed(2)
  )
  const potentialSavedSec = Math.round(
    redundantCookNodes.reduce((s, i) => s + i.estimatedLatencySec, 0)
  )

  // 识别相同 typeId 且生成指令完全一致的重复节点组
  const promptBuckets = new Map<string, { typeId: string; snippet: string; ids: string[] }>()
  for (const n of nodes) {
    const inst = (n.params?.generateInstruction ?? '').trim()
    if (inst.length >= 6 && n.typeId) {
      const key = `${n.typeId}::${inst.toLowerCase()}`
      const existing = promptBuckets.get(key)
      if (existing) {
        existing.ids.push(n.id)
      } else {
        promptBuckets.set(key, {
          typeId: n.typeId,
          snippet: inst.slice(0, 48),
          ids: [n.id]
        })
      }
    }
  }

  const duplicatePromptGroups: DuplicatePromptGroup[] = []
  for (const b of promptBuckets.values()) {
    if (b.ids.length >= 2) {
      duplicatePromptGroups.push({
        typeId: b.typeId,
        instructionSnippet: b.snippet,
        nodeIds: b.ids
      })
    }
  }

  return {
    totalNodes: nodes.length,
    activeUnlockedNodes: nodeBreakdown.filter((i) => !i.locked).length,
    totalEstimatedApiCalls,
    totalEstimatedCredits,
    totalSerialLatencySec,
    criticalPathLatencySec,
    parallelSpeedupFactor,
    criticalPathNodeIds,
    redundantCookNodes,
    duplicatePromptGroups,
    potentialSavedCredits,
    potentialSavedSec,
    nodeBreakdown
  }
}

/**
 * 一键为画布中所有「已有生成结果但未加锁」的重型节点自动开启缓存锁定（`locked: true`），避免重复扣费重跑
 */
export function applyWorkflowAutoCacheOptimization(
  doc: GraphDocument,
  report?: WorkflowCostAuditReport
): {
  document: GraphDocument
  lockedNodeIds: string[]
  estimatedSavedCredits: number
  estimatedSavedSec: number
} {
  const audit = report ?? estimateWorkflowCostAndCriticalPath(doc)
  const redundantSet = new Set(audit.redundantCookNodes.map((n) => n.nodeId))

  if (redundantSet.size === 0) {
    return {
      document: doc,
      lockedNodeIds: [],
      estimatedSavedCredits: 0,
      estimatedSavedSec: 0
    }
  }

  const lockedNodeIds: string[] = []
  const nextNodes = doc.nodes.map((node) => {
    if (!redundantSet.has(node.id)) return node
    lockedNodeIds.push(node.id)
    return {
      ...node,
      params: {
        ...(node.params ?? {}),
        locked: true
      }
    }
  })

  return {
    document: {
      ...doc,
      nodes: nextNodes
    },
    lockedNodeIds,
    estimatedSavedCredits: audit.potentialSavedCredits,
    estimatedSavedSec: audit.potentialSavedSec
  }
}
