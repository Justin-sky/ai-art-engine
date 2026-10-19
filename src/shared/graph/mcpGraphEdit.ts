import { canConnectNodes, getNodePorts } from './ports'
import { createNodeFromType } from './create'
import { autoLayoutNodes } from './layout'
import { REFERENCE_PARAM_KEYS, sanitizeReferenceParams } from './referenceParams'
import { listAddableNodeTypes, listNodeTypes } from './registry'
import type { GraphAddScope } from './scopes'
import { applySmartNodePreset, mergeSmartNodeParams } from './smartPatch'
import type {
  GraphDocument,
  GraphEdge,
  GraphGroup,
  GraphNode,
  GraphNodeParams,
  GraphNodeTypeId
} from './types'

/**
 * MCP graph_edit 的共享纯逻辑：把外部 Agent 提交的一组编辑操作应用到
 * 图文档上。校验失败的 op 跳过并记入 warnings，不阻断后续操作。
 * 渲染层处理器负责：读取落盘图文档 → 调用本模块 → 持久化 + 广播。
 */

export type McpGraphEditOp =
  | {
      op: 'node_upsert' | 'node_add' | 'add_node'
      /** 缺省自动生成；已存在同 id 节点时转为更新 */
      nodeId?: string
      typeId: string
      title?: string
      params?: Record<string, unknown>
      preset?: string
      x?: number
      y?: number
      w?: number
      h?: number
      locked?: boolean
    }
  | {
      op: 'node_update' | 'update_node'
      nodeId: string
      title?: string
      x?: number
      y?: number
      w?: number
      h?: number
      locked?: boolean
      preset?: string
      /** 与现有 params 深度智能合并（支持点路径、子对象、JSON-string 及顶层简写路由） */
      params?: Record<string, unknown>
      [extraKey: string]: unknown
    }
  | {
      op: 'apply_preset'
      nodeId: string
      preset: string
    }
  | { op: 'node_delete' | 'delete_node'; nodeId: string }
  | {
      op: 'edge_connect' | 'edge_add' | 'add_edge'
      fromNodeId?: string
      toNodeId?: string
      from?: string
      to?: string
      source?: string
      target?: string
      fromPort?: string
      toPort?: string
      sourcePort?: string
      targetPort?: string
    }
  | {
      op: 'edge_delete' | 'delete_edge'
      fromNodeId?: string
      toNodeId?: string
      from?: string
      to?: string
      source?: string
      target?: string
    }
  /** 教学录屏：在打开的编辑器里选中节点（可见高亮；不改图结构） */
  | { op: 'node_select' | 'select_node'; nodeId: string }
  | {
      op: 'group_add' | 'add_group'
      groupId?: string
      title?: string
      label?: string
      nodeIds?: string[]
    }
  | {
      op: 'group_update' | 'update_group'
      groupId: string
      title?: string
      label?: string
      nodeIds?: string[]
      addNodeIds?: string[]
      removeNodeIds?: string[]
    }
  | {
      op: 'group_delete' | 'delete_group'
      groupId: string
    }
  | {
      op: 'auto_layout'
    }

export interface McpGraphEditResult {
  graph: GraphDocument
  applied: string[]
  warnings: string[]
  /** 需在打开的编辑器里执行的选中（按 ops 顺序，后者覆盖前者） */
  selectNodeIds?: string[]
  /** 本次编辑触达（新建、更新、预设或入边变更）的节点 id 清单 */
  touchedNodeIds?: string[]
}

/**
 * graph_edit 的校验作用域（宿主资产子图）：node_upsert 只接受该作用域下
 * 可添加的节点类型。MCP 的 graph_node_types 清单工具复用本常量，
 * 保证「清单里能查到的」与「graph_edit 能建的」始终同源。
 */
export const MCP_GRAPH_EDIT_SCOPE: GraphAddScope = 'subgraphAsset'

const TYPE_ID_ALIASES: Record<string, GraphNodeTypeId> = {
  'voice.tts': 'asset.voice',
  voice: 'asset.voice',
  tts: 'asset.voice',
  'voice.dialogue': 'asset.dialogue',
  dialogue: 'asset.dialogue',
  'audio.music': 'asset.music',
  music: 'asset.music',
  bgm: 'asset.music',
  'audio.sfx': 'asset.sfx',
  sfx: 'asset.sfx',
  'video.timeline': 'output.timeline',
  'video.compose': 'output.timeline',
  'script.timeline': 'output.timeline',
  timeline: 'output.timeline',
  'image.gen': 'asset.image',
  image: 'asset.image',
  'video.gen': 'asset.video',
  video: 'asset.video',
  'model3d.rig': 'model.rigSkin',
  'model3d.segment': 'model.segment',
  'spatialWorld.generate': 'asset.spatialWorld',
  text: 'note.text',
  note: 'note.text'
}

function normalizeMcpNodeTypeId(rawTypeId: string): string {
  const trimmed = rawTypeId?.trim() ?? ''
  return TYPE_ID_ALIASES[trimmed] ?? trimmed
}

/** 输出与边界节点承载宿主接口，远端删除会破坏资产契约 */
function isProtectedNode(node: GraphNode): boolean {
  const typeId = node.typeId ?? ''
  return (
    typeId.startsWith('output.') ||
    typeId === 'graph.boundary.input' ||
    typeId === 'graph.boundary.output'
  )
}

function findNode(graph: GraphDocument, nodeId: string): GraphNode | undefined {
  return graph.nodes.find((node) => node.id === nodeId)
}

function resolveEdgePorts(
  source: GraphNode,
  target: GraphNode,
  fromPort?: string,
  toPort?: string
): { sourcePort: string; targetPort: string } | null {
  if (target.typeId === 'asset.video' || target.assetType === 'video') {
    if (toPort === 'in-last-frame') {
      target.params = { ...target.params, generateFrameMode: 'first_last' }
    } else if (toPort === 'in-first-frame' && target.params?.generateFrameMode !== 'first_last') {
      target.params = { ...target.params, generateFrameMode: 'first' }
    } else if (
      toPort === 'in-image' &&
      target.params?.generateFrameMode &&
      target.params.generateFrameMode !== 'none'
    ) {
      target.params = { ...target.params, generateFrameMode: 'none' }
    }
  }
  if (target.typeId === 'output.timeline' && !toPort) {
    if (source.typeId === 'asset.music') {
      const musicPort = fromPort || 'out'
      if (canConnectNodes(source, target, { sourcePort: musicPort, targetPort: 'in-music' })) {
        return { sourcePort: musicPort, targetPort: 'in-music' }
      }
    }
  }
  if (fromPort || toPort) {
    const sourcePort = fromPort || 'out'
    const targetPort = toPort || 'in'
    if (canConnectNodes(source, target, { sourcePort, targetPort })) {
      return { sourcePort, targetPort }
    }
    // 若仅指定了 fromPort（如 svg.anim 的 out-gif）而未指定 toPort，自动匹配目标兼容入端口
    if (fromPort && !toPort) {
      const ins = getNodePorts(target).filter((port) => port.direction === 'in')
      for (const inPort of ins) {
        if (canConnectNodes(source, target, { sourcePort: fromPort, targetPort: inPort.id })) {
          return { sourcePort: fromPort, targetPort: inPort.id }
        }
      }
    }
    // 若仅指定了 toPort 而未指定 fromPort，自动匹配源兼容出端口
    if (!fromPort && toPort) {
      const outs = getNodePorts(source).filter((port) => port.direction === 'out')
      for (const out of outs) {
        if (canConnectNodes(source, target, { sourcePort: out.id, targetPort: toPort })) {
          return { sourcePort: out.id, targetPort: toPort }
        }
      }
    }
    return null
  }
  const outs = getNodePorts(source).filter((port) => port.direction === 'out')
  const ins = getNodePorts(target).filter((port) => port.direction === 'in')
  for (const out of outs) {
    for (const inPort of ins) {
      if (canConnectNodes(source, target, { sourcePort: out.id, targetPort: inPort.id })) {
        return { sourcePort: out.id, targetPort: inPort.id }
      }
    }
  }
  return null
}

/**
 * 把 op.params 深度智能合并到节点上（支持点路径、嵌套子对象、JSON-string 透明合并与简写属性路由），
 * 并对参考图参数做可用性校验（与 GraphPlan 物化同一套口径）。
 *
 * - 校验用「合并后」的值：单独更新 styleImagesUseGlobal 时也要能看到节点已有的 styleImages，
 *   否则会把「本地风格图 + 关掉全局风格」的合法组合误判成无风格；
 * - 本次传入不可用时保留节点原值（有的话），不静默销毁既有参考图配置。
 */
function mergeNodeParams(
  node: GraphNode,
  incoming: Record<string, unknown> | undefined,
  warnings: string[]
): void {
  if (!incoming || typeof incoming !== 'object') return
  const before = (node.params ?? {}) as Record<string, unknown>
  const merged = mergeSmartNodeParams(node, incoming) as Record<string, unknown>
  if (!REFERENCE_PARAM_KEYS.some((key) => key in incoming)) {
    node.params = merged as GraphNodeParams
    return
  }
  const sanitized = sanitizeReferenceParams(
    merged as Partial<GraphNodeParams>,
    node.id,
    warnings
  ) as Record<string, unknown>
  for (const key of REFERENCE_PARAM_KEYS) {
    if (key in sanitized || !(key in before)) continue
    // 合并后不可用（含 styleImages 变空连带的开关回落）：保留原值，别让一次失败的写入抹掉既有配置
    sanitized[key] = before[key]
    warnings.push(`节点「${node.id}」${key} 本次改动无法生效，已保留原值`)
  }
  node.params = sanitized as GraphNodeParams
}

function applyNodeGeometryAndLock(
  node: GraphNode,
  op: { x?: number; y?: number; w?: number; h?: number; locked?: boolean }
): void {
  if (typeof op.x === 'number' && Number.isFinite(op.x)) {
    node.position = { ...node.position, x: op.x }
  }
  if (typeof op.y === 'number' && Number.isFinite(op.y)) {
    node.position = { ...node.position, y: op.y }
  }
  if (
    (typeof op.w === 'number' && Number.isFinite(op.w) && op.w > 0) ||
    (typeof op.h === 'number' && Number.isFinite(op.h) && op.h > 0)
  ) {
    const curW = node.size?.w ?? 260
    const curH = node.size?.h ?? 180
    node.size = {
      w: typeof op.w === 'number' && Number.isFinite(op.w) && op.w > 0 ? op.w : curW,
      h: typeof op.h === 'number' && Number.isFinite(op.h) && op.h > 0 ? op.h : curH
    }
  }
  if (typeof op.locked === 'boolean') {
    node.locked = op.locked
    ;(node.params as Record<string, unknown>).locked = op.locked
  }
}

function extractInlineNodeParams(op: Record<string, unknown>): Record<string, unknown> {
  const reserved = new Set([
    'op',
    'nodeId',
    'id',
    'typeId',
    'title',
    'x',
    'y',
    'w',
    'h',
    'locked',
    'params'
  ])
  const inline: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(op)) {
    if (!reserved.has(k) && v !== undefined) {
      inline[k] = v
    }
  }
  const explicitParams =
    op.params && typeof op.params === 'object' && !Array.isArray(op.params)
      ? (op.params as Record<string, unknown>)
      : {}
  return {
    ...inline,
    ...explicitParams
  }
}

function isDataOrHttpUrl(raw: string): boolean {
  return raw.startsWith('data:') || /^https?:\/\//i.test(raw)
}

function buildLockedMediaRefParams(
  typeId: 'asset.image' | 'asset.video' | 'asset.model3d' | 'asset.voice',
  rawUrl: string
): GraphNodeParams {
  const url = rawUrl.trim()
  const isInline = isDataOrHttpUrl(url)
  const now = new Date().toISOString()
  if (typeId === 'asset.image') {
    return {
      locked: true,
      ...(isInline ? { previewDataUrl: url } : { previewRelativePath: url }),
      generatedImages: [
        {
          id: 'ref:0',
          dataUrl: isInline ? url : '',
          ...(isInline ? {} : { relativePath: url }),
          createdAt: now
        }
      ],
      selectedImageId: 'ref:0'
    }
  }
  if (typeId === 'asset.video') {
    return {
      locked: true,
      ...(isInline ? { previewDataUrl: url } : { previewRelativePath: url }),
      generatedVideos: [
        {
          id: 'ref:0',
          dataUrl: isInline ? url : '',
          ...(isInline ? {} : { relativePath: url }),
          createdAt: now
        }
      ],
      selectedVideoId: 'ref:0'
    }
  }
  if (typeId === 'asset.model3d') {
    return {
      locked: true,
      previewRelativePath: url,
      generatedModels: [
        {
          id: 'ref:0',
          relativePath: url,
          createdAt: now
        }
      ],
      selectedModelId: 'ref:0'
    }
  }
  return {
    locked: true,
    previewRelativePath: url,
    generatedVoices: [
      {
        id: 'ref:0',
        relativePath: url,
        createdAt: now
      }
    ],
    selectedVoiceId: 'ref:0'
  }
}

function upsertLockedMediaRefNodeAndConnect(
  graph: GraphDocument,
  refNodeId: string,
  refTypeId: 'asset.image' | 'asset.video' | 'asset.model3d' | 'asset.voice',
  refTitle: string,
  rawUrl: string,
  targetNode: GraphNode,
  preferredToPort?: string
): void {
  let refNode = findNode(graph, refNodeId)
  const refParams = buildLockedMediaRefParams(refTypeId, rawUrl)
  if (!refNode) {
    refNode = createNodeFromType(
      refTypeId,
      {
        x: Math.max(0, (targetNode.position?.x ?? 320) - 340),
        y: targetNode.position?.y ?? 0
      },
      { title: refTitle }
    )
    refNode.id = refNodeId
    refNode.locked = true
    refNode.params = { ...refNode.params, ...refParams }
    graph.nodes.push(refNode)
  } else {
    refNode.locked = true
    refNode.params = { ...refNode.params, ...refParams }
  }
  const ports =
    (preferredToPort ? resolveEdgePorts(refNode, targetNode, 'out', preferredToPort) : null) ??
    resolveEdgePorts(refNode, targetNode)
  if (!ports) return
  const exists = graph.edges.some(
    (e) =>
      e.source === refNode!.id &&
      e.target === targetNode.id &&
      e.sourcePort === ports.sourcePort &&
      e.targetPort === ports.targetPort
  )
  if (!exists) {
    graph.edges.push({
      id: `edge-mcp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      source: refNode.id,
      target: targetNode.id,
      sourcePort: ports.sourcePort,
      targetPort: ports.targetPort
    })
  }
}

/**
 * 支持在创建/更新生成或加工节点时直接内联传入 `referenceImageUrls`、`firstFrameImageUrl`、
 * `lastFrameImageUrl`、`referenceVideoUrl`、`sourceRelativePath`：
 * 自动在画布上补齐锁定的上游参考节点并连线到对应端口。
 */
function wireInlineReferenceMedia(
  graph: GraphDocument,
  targetNode: GraphNode,
  combinedParams: Record<string, unknown>
): boolean {
  let wiredEdge = false
  const isAssetNode = (targetNode.typeId ?? '').startsWith('asset.')

  // 若目标本身是 asset.* 节点且传入了 sourceRelativePath / relativePath（作为锁定参考素材节点）
  const rawSelfPath =
    typeof combinedParams.sourceRelativePath === 'string' &&
    combinedParams.sourceRelativePath.trim()
      ? combinedParams.sourceRelativePath.trim()
      : typeof combinedParams.relativePath === 'string' && combinedParams.relativePath.trim()
        ? combinedParams.relativePath.trim()
        : ''
  if (rawSelfPath && isAssetNode && (targetNode.locked || !combinedParams.generateInstruction)) {
    delete combinedParams.sourceRelativePath
    delete combinedParams.relativePath
    const selfType =
      targetNode.typeId === 'asset.video'
        ? 'asset.video'
        : targetNode.typeId === 'asset.model3d' || targetNode.typeId === 'asset.spatialWorld'
          ? 'asset.model3d'
          : targetNode.typeId === 'asset.voice' ||
              targetNode.typeId === 'asset.sfx' ||
              targetNode.typeId === 'asset.music' ||
              targetNode.typeId === 'asset.dialogue'
            ? 'asset.voice'
            : 'asset.image'
    Object.assign(combinedParams, buildLockedMediaRefParams(selfType, rawSelfPath))
  } else if (rawSelfPath && !isAssetNode) {
    delete combinedParams.sourceRelativePath
    delete combinedParams.relativePath
    const refType: 'asset.image' | 'asset.video' | 'asset.model3d' | 'asset.voice' =
      (targetNode.typeId ?? '').startsWith('model.') ||
      /\.(glb|gltf|fbx|obj|ply|spz)$/i.test(rawSelfPath)
        ? 'asset.model3d'
        : /\.(mp4|webm|mov|mkv)$/i.test(rawSelfPath)
          ? 'asset.video'
          : /\.(mp3|wav|ogg|m4a|flac)$/i.test(rawSelfPath)
            ? 'asset.voice'
            : 'asset.image'
    upsertLockedMediaRefNodeAndConnect(
      graph,
      `${targetNode.id}-src`,
      refType,
      '输入素材',
      rawSelfPath,
      targetNode
    )
    wiredEdge = true
  }

  const rawRefImgs =
    combinedParams.referenceImageUrls ??
    combinedParams.referenceImages ??
    (typeof combinedParams.referenceImageUrl === 'string'
      ? [combinedParams.referenceImageUrl]
      : undefined)
  if (rawRefImgs !== undefined) {
    delete combinedParams.referenceImageUrls
    delete combinedParams.referenceImages
    delete combinedParams.referenceImageUrl
    const list = (Array.isArray(rawRefImgs) ? rawRefImgs : [rawRefImgs])
      .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
      .map((u) => u.trim())
    for (const [idx, url] of list.entries()) {
      upsertLockedMediaRefNodeAndConnect(
        graph,
        `${targetNode.id}-ref-img-${idx + 1}`,
        'asset.image',
        list.length > 1 ? `参考图 ${idx + 1}` : '参考图',
        url,
        targetNode,
        'in-image'
      )
      wiredEdge = true
    }
  }

  const firstFrameUrl =
    typeof combinedParams.firstFrameImageUrl === 'string'
      ? combinedParams.firstFrameImageUrl.trim()
      : ''
  const lastFrameUrl =
    typeof combinedParams.lastFrameImageUrl === 'string'
      ? combinedParams.lastFrameImageUrl.trim()
      : ''
  if (combinedParams.firstFrameImageUrl !== undefined) delete combinedParams.firstFrameImageUrl
  if (combinedParams.lastFrameImageUrl !== undefined) delete combinedParams.lastFrameImageUrl

  if ((firstFrameUrl || lastFrameUrl) && targetNode.typeId === 'asset.video') {
    const mode = firstFrameUrl && lastFrameUrl ? 'first_last' : 'first'
    targetNode.params = { ...targetNode.params, generateFrameMode: mode }
    combinedParams.generateFrameMode = mode
  }
  if (firstFrameUrl) {
    upsertLockedMediaRefNodeAndConnect(
      graph,
      `${targetNode.id}-first-frame`,
      'asset.image',
      '首帧参考',
      firstFrameUrl,
      targetNode,
      'in-first-frame'
    )
    wiredEdge = true
  }
  if (lastFrameUrl) {
    upsertLockedMediaRefNodeAndConnect(
      graph,
      `${targetNode.id}-last-frame`,
      'asset.image',
      '尾帧参考',
      lastFrameUrl,
      targetNode,
      'in-last-frame'
    )
    wiredEdge = true
  }

  const refVideoUrl =
    typeof combinedParams.referenceVideoUrl === 'string'
      ? combinedParams.referenceVideoUrl.trim()
      : ''
  if (combinedParams.referenceVideoUrl !== undefined) delete combinedParams.referenceVideoUrl
  if (refVideoUrl) {
    upsertLockedMediaRefNodeAndConnect(
      graph,
      `${targetNode.id}-ref-video`,
      'asset.video',
      '参考视频',
      refVideoUrl,
      targetNode,
      'in-video'
    )
    wiredEdge = true
  }

  return wiredEdge
}

function isUnexecutedStandaloneNode(
  graph: GraphDocument,
  node: GraphNode,
  touchedNodeIds: string[]
): boolean {
  if (node.locked || touchedNodeIds.includes(node.id)) return false
  if (graph.edges.some((e) => e.source === node.id || e.target === node.id)) return false
  if (graph.runStates?.[node.id]?.status === 'done') return false
  const p = node.params
  if (!p) return true
  if (
    (Array.isArray(p.generatedImages) && p.generatedImages.length > 0) ||
    (Array.isArray(p.generatedVideos) && p.generatedVideos.length > 0) ||
    (Array.isArray(p.generatedVoices) && p.generatedVoices.length > 0) ||
    (Array.isArray(p.generatedModels) && p.generatedModels.length > 0) ||
    Boolean(p.previewRelativePath?.trim()) ||
    Boolean(p.previewDataUrl?.trim()) ||
    Boolean(p.spatialWorldId?.trim()) ||
    Boolean(p.resultText?.trim())
  ) {
    return false
  }
  return true
}

function applyOp(
  graph: GraphDocument,
  op: McpGraphEditOp,
  addable: Set<string>,
  warnings: string[],
  touchedNodeIds: string[]
): string | null {
  switch (op.op) {
    case 'node_upsert':
    case 'node_add':
    case 'add_node': {
      const canonicalTypeId = normalizeMcpNodeTypeId(op.typeId)
      if (!addable.has(canonicalTypeId)) {
        warnings.push(`未知或不可添加的节点类型「${op.typeId}」，已跳过`)
        return null
      }
      const existing = op.nodeId
        ? findNode(graph, op.nodeId)
        : canonicalTypeId === 'output.timeline'
          ? graph.nodes.find((n) => n.typeId === 'output.timeline')
          : op.op === 'node_upsert'
            ? graph.nodes.find(
                (n) =>
                  n.typeId === canonicalTypeId &&
                  isUnexecutedStandaloneNode(graph, n, touchedNodeIds)
              )
            : undefined
      const combinedParams = extractInlineNodeParams(op as unknown as Record<string, unknown>)
      if (existing) {
        if (typeof op.title === 'string' && op.title.trim()) existing.title = op.title.trim()
        applyNodeGeometryAndLock(existing, op)
        wireInlineReferenceMedia(graph, existing, combinedParams)
        if (Object.keys(combinedParams).length > 0) {
          mergeNodeParams(existing, combinedParams, warnings)
        }
        touchedNodeIds.push(existing.id)
        return `更新节点 ${existing.id}`
      }
      const node = createNodeFromType(
        canonicalTypeId as GraphNodeTypeId,
        {
          x: op.x ?? 0,
          y: op.y ?? 0
        },
        { title: op.title?.trim() || undefined }
      )
      if (op.nodeId) node.id = op.nodeId
      if (findNode(graph, node.id)) {
        warnings.push(`节点 id「${node.id}」已存在，已跳过新建`)
        return null
      }
      applyNodeGeometryAndLock(node, op)
      graph.nodes.push(node)
      wireInlineReferenceMedia(graph, node, combinedParams)
      if (Object.keys(combinedParams).length > 0) {
        mergeNodeParams(node, combinedParams, warnings)
      }
      touchedNodeIds.push(node.id)
      return `新建节点 ${node.id}（${canonicalTypeId}）`
    }
    case 'node_update':
    case 'update_node': {
      const node = findNode(graph, op.nodeId)
      if (!node) {
        warnings.push(`节点「${op.nodeId}」不存在，更新已跳过`)
        return null
      }
      if (typeof op.title === 'string' && op.title.trim()) node.title = op.title.trim()
      applyNodeGeometryAndLock(node, op)
      const combinedParams = extractInlineNodeParams(op as unknown as Record<string, unknown>)
      wireInlineReferenceMedia(graph, node, combinedParams)
      if (Object.keys(combinedParams).length > 0) {
        mergeNodeParams(node, combinedParams, warnings)
      }
      touchedNodeIds.push(node.id)
      return `更新节点 ${node.id}`
    }
    case 'apply_preset': {
      const node = findNode(graph, op.nodeId)
      if (!node) {
        warnings.push(`节点「${op.nodeId}」不存在，预设应用已跳过`)
        return null
      }
      const presetRes = applySmartNodePreset(node, op.preset)
      if (!presetRes) {
        warnings.push(`节点「${op.nodeId}」未找到匹配的预设「${op.preset}」`)
        return null
      }
      mergeNodeParams(node, presetRes.paramsPatch as Record<string, unknown>, warnings)
      touchedNodeIds.push(node.id)
      return `应用预设 ${presetRes.matchedPresetId} → 节点 ${node.id}`
    }
    case 'node_delete':
    case 'delete_node': {
      const node = findNode(graph, op.nodeId)
      if (!node) {
        warnings.push(`节点「${op.nodeId}」不存在，删除已跳过`)
        return null
      }
      if (isProtectedNode(node)) {
        warnings.push(`节点「${op.nodeId}」为输出 / 边界节点，禁止删除`)
        return null
      }
      graph.nodes = graph.nodes.filter((item) => item.id !== op.nodeId)
      graph.edges = graph.edges.filter(
        (edge) => edge.source !== op.nodeId && edge.target !== op.nodeId
      )
      return `删除节点 ${op.nodeId}（含连线）`
    }
    case 'edge_connect':
    case 'edge_add':
    case 'add_edge': {
      const fromId = op.fromNodeId ?? op.from ?? op.source ?? ''
      const toId = op.toNodeId ?? op.to ?? op.target ?? ''
      const fromPort = op.fromPort ?? op.sourcePort
      const toPort = op.toPort ?? op.targetPort
      const source = findNode(graph, fromId)
      const target = findNode(graph, toId)
      if (!source || !target) {
        warnings.push(`连线端点不存在（${fromId} → ${toId}），已跳过`)
        return null
      }
      const ports = resolveEdgePorts(source, target, fromPort, toPort)
      if (!ports) {
        warnings.push(`连线不兼容（${fromId} → ${toId}），已跳过`)
        return null
      }
      const duplicate = graph.edges.some(
        (edge) =>
          edge.source === source.id &&
          edge.target === target.id &&
          edge.sourcePort === ports.sourcePort &&
          edge.targetPort === ports.targetPort
      )
      if (duplicate) return `连线已存在（${fromId} → ${toId}）`
      const edge: GraphEdge = {
        id: `edge-mcp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        source: source.id,
        target: target.id,
        sourcePort: ports.sourcePort,
        targetPort: ports.targetPort
      }
      graph.edges.push(edge)
      touchedNodeIds.push(target.id)
      return `连线 ${fromId} → ${toId}`
    }
    case 'edge_delete':
    case 'delete_edge': {
      const fromId = op.fromNodeId ?? op.from ?? op.source ?? ''
      const toId = op.toNodeId ?? op.to ?? op.target ?? ''
      const before = graph.edges.length
      graph.edges = graph.edges.filter((edge) => !(edge.source === fromId && edge.target === toId))
      const removed = before - graph.edges.length
      if (!removed) warnings.push(`连线不存在（${fromId} → ${toId}），已跳过`)
      else touchedNodeIds.push(toId)
      return `删除连线 ${fromId} → ${toId}`
    }
    case 'node_select':
    case 'select_node': {
      const node = findNode(graph, op.nodeId)
      if (!node) {
        warnings.push(`节点「${op.nodeId}」不存在，选中已跳过`)
        return null
      }
      return `选中节点 ${op.nodeId}`
    }
    case 'group_add':
    case 'add_group': {
      const groupId =
        typeof op.groupId === 'string' && op.groupId.trim()
          ? op.groupId.trim()
          : `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      const title = (op.title ?? op.label ?? '').trim() || undefined
      const groups: GraphGroup[] = graph.groups ? [...graph.groups] : []
      const existingGroup = groups.find((g) => g.id === groupId)
      if (existingGroup) {
        if (title) existingGroup.title = title
      } else {
        groups.push({ id: groupId, ...(title ? { title } : {}) })
      }
      graph.groups = groups
      if (Array.isArray(op.nodeIds)) {
        const idSet = new Set(op.nodeIds)
        for (const n of graph.nodes) {
          if (idSet.has(n.id)) n.groupId = groupId
        }
      }
      return `新建分组 ${groupId}`
    }
    case 'group_update':
    case 'update_group': {
      const groups: GraphGroup[] = graph.groups ? [...graph.groups] : []
      let group = groups.find((g) => g.id === op.groupId)
      const title = (op.title ?? op.label ?? '').trim() || undefined
      if (!group) {
        group = { id: op.groupId, ...(title ? { title } : {}) }
        groups.push(group)
      } else if (title !== undefined) {
        group.title = title
      }
      graph.groups = groups
      if (Array.isArray(op.nodeIds)) {
        const idSet = new Set(op.nodeIds)
        for (const n of graph.nodes) {
          if (idSet.has(n.id)) n.groupId = op.groupId
          else if (n.groupId === op.groupId) delete n.groupId
        }
      }
      if (Array.isArray(op.addNodeIds)) {
        const addSet = new Set(op.addNodeIds)
        for (const n of graph.nodes) {
          if (addSet.has(n.id)) n.groupId = op.groupId
        }
      }
      if (Array.isArray(op.removeNodeIds)) {
        const remSet = new Set(op.removeNodeIds)
        for (const n of graph.nodes) {
          if (remSet.has(n.id) && n.groupId === op.groupId) delete n.groupId
        }
      }
      return `更新分组 ${op.groupId}`
    }
    case 'group_delete':
    case 'delete_group': {
      if (graph.groups) {
        graph.groups = graph.groups.filter((g) => g.id !== op.groupId)
      }
      for (const n of graph.nodes) {
        if (n.groupId === op.groupId) delete n.groupId
      }
      return `删除分组 ${op.groupId}`
    }
    case 'auto_layout': {
      if (graph.nodes.length > 1) {
        autoLayoutNodes(graph.nodes, graph.edges, { columnGap: 96, rowGap: 56 })
      }
      return '自动布局'
    }
    default:
      warnings.push('未知操作，已跳过')
      return null
  }
}

function cloneGraphForEdit(graph: GraphDocument): GraphDocument {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({
      ...node,
      position: { ...node.position },
      ...(node.size ? { size: { ...node.size } } : {}),
      params: node.params ? { ...node.params } : node.params
    })),
    edges: graph.edges.map((edge) => ({ ...edge })),
    ...(graph.groups ? { groups: graph.groups.map((g) => ({ ...g })) } : {}),
    ...(graph.runStates ? { runStates: { ...graph.runStates } } : {})
  }
}

function invalidateTouchedRunStates(graph: GraphDocument, seedIds: string[]): void {
  if (!seedIds.length || !graph.runStates) return
  const invalidated = new Set<string>()
  const queue = [...seedIds]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (invalidated.has(id)) continue
    invalidated.add(id)
    for (const edge of graph.edges) {
      if (edge.source === id && !invalidated.has(edge.target)) {
        queue.push(edge.target)
      }
    }
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  for (const id of invalidated) {
    const node = byId.get(id)
    if (node?.locked) continue
    delete graph.runStates[id]
  }
}

function shouldAutoLayoutAfterOps(applied: string[], options?: { autoLayout?: boolean }): boolean {
  // 显式 false：尊重调用方（精细摆位）；显式 true：强制布局
  if (options?.autoLayout === false) return false
  if (options?.autoLayout === true) return true
  // 默认：新建或新连线后自动拉开，避免 Agent 漏传 autoLayout 时叠在原点
  return applied.some((desc) => desc.startsWith('新建节点') || desc.startsWith('连线 '))
}

export function applyGraphEditOps(
  graph: GraphDocument,
  ops: McpGraphEditOp[],
  options?: { autoLayout?: boolean }
): McpGraphEditResult {
  const next = cloneGraphForEdit(graph)
  const addable = new Set([
    ...listAddableNodeTypes(MCP_GRAPH_EDIT_SCOPE).map((def) => def.typeId),
    ...listNodeTypes()
      .filter((def) => def.addable !== false && !def.typeId.startsWith('output.'))
      .map((def) => def.typeId)
  ])
  const applied: string[] = []
  const warnings: string[] = []
  const selectNodeIds: string[] = []
  const touchedNodeIds: string[] = []
  for (const op of ops) {
    try {
      const appliedDesc = applyOp(next, op, addable, warnings, touchedNodeIds)
      if (appliedDesc) {
        applied.push(appliedDesc)
        if (op.op === 'node_select' || op.op === 'select_node') selectNodeIds.push(op.nodeId)
      }
    } catch (err) {
      warnings.push(
        `操作 ${'op' in op ? op.op : '?'} 执行失败：${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
  const uniqueTouchedIds = [
    ...new Set(touchedNodeIds.filter((id) => next.nodes.some((n) => n.id === id)))
  ]
  if (uniqueTouchedIds.length > 0) {
    invalidateTouchedRunStates(next, uniqueTouchedIds)
  }
  // 教学录屏 / 批量建节点后：按连线拓扑左→右分层，避免节点叠在默认原点
  if (
    shouldAutoLayoutAfterOps(applied, options) &&
    !applied.includes('自动布局') &&
    next.nodes.length > 1
  ) {
    autoLayoutNodes(next.nodes, next.edges, { columnGap: 96, rowGap: 56 })
    applied.push('自动布局')
  }
  return {
    graph: next,
    applied,
    warnings,
    ...(selectNodeIds.length ? { selectNodeIds } : {}),
    ...(uniqueTouchedIds.length ? { touchedNodeIds: uniqueTouchedIds } : {})
  }
}
