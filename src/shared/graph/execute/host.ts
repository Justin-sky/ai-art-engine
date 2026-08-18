import {
  executeImageGenerateNode,
  executeVideoGenerateNode,
  executeVoiceGenerateNode
} from './generateMedia'
import { executeScreenplayGenerateNode, executeTextAssetRefNode } from './generateText'
import type { GraphDocument } from '../types'
import { GraphPortType, isPluralGraphPortDataType } from '../types'
import { catalogValue } from '../catalogValue'
import { isAssetHostNode, isAssetRefNode } from '../nodeRole'
import { cloneGraphDocument } from '../document'
import {
  graphValueHasPayload,
  mergeBoundarySoftValues,
  mergeHostInputValues,
  softResolveBoundaryOutputValue
} from '../hostInput'
import {
  boundaryInputNodeId,
  boundaryOutputNodeId,
  isBoundaryOutputNode,
  resolveNodeHostInterface,
  type HostInterfaceDocument
} from '../hostInterface'
import { ensureBoundaryProxyNodes } from '../ensureBoundary'
import { findAllOutputNodes } from '../query'
import { expandInstructionMentions } from '../instructionMentions'
import { stringifyWorldElementGenResults, type WorldElementGenResult } from '../worldElementParse'
import type {
  GraphAssetValue,
  GraphNodeRunState,
  GraphOutputValue,
  GraphValue,
  NodeExecuteContext
} from './types'
import { flattenAssetValues } from './gallery'
import { autoIncomingTextForInstruction, selectIncomingValuesForInstruction } from './incoming'
import { resolveMentionSources } from './context'

/**
 * 写入累计图片图库，强制选中最新一条，返回双输出口。
 */
function mapChildOutputToHostOut(
  output: GraphOutputValue | undefined,
  assetType: string
): Record<string, GraphValue> | null {
  if (!output) return null
  if (assetType === 'world') {
    const fromParams = Array.isArray(output.params?.worldElementOutputs)
      ? (output.params.worldElementOutputs as WorldElementGenResult[])
      : []
    const entitiesText =
      (typeof output.params?.resultText === 'string' && output.params.resultText.trim()) ||
      (fromParams.length
        ? stringifyWorldElementGenResults(
            fromParams.filter((item) => item?.type && item?.name && item?.imageUrl)
          )
        : '') ||
      (typeof output.params?.text === 'string' && output.params.text.trim()) ||
      ''
    if (entitiesText) {
      return { out: catalogValue(GraphPortType.worldEntities, entitiesText) }
    }
    return null
  }
  if (assetType === 'beat') {
    const catalog =
      (typeof output.params?.resultText === 'string' && output.params.resultText.trim()) ||
      (typeof output.params?.text === 'string' && output.params.text.trim()) ||
      (output.notes?.length
        ? output.notes
            .map((n) => n.text.trim())
            .filter(Boolean)
            .join('\n\n')
        : '') ||
      ''
    if (catalog) {
      return { out: catalogValue(GraphPortType.beat, catalog) }
    }
    return null
  }
  if (assetType === 'screenplay') {
    if (output.texts?.length) {
      return { out: { kind: 'texts', items: output.texts } }
    }
    if (output.notes?.length) {
      const text = output.notes
        .map((n) => n.text.trim())
        .filter(Boolean)
        .join('\n\n')
      return { out: { kind: 'text', text } }
    }
  }
  if (assetType === 'image' && output.images?.length) {
    return { out: { kind: 'images', items: output.images } }
  }
  if (assetType === 'video' && output.videos?.length) {
    return { out: { kind: 'videos', items: output.videos } }
  }
  if (assetType === 'voice' && output.voices?.length) {
    return { out: { kind: 'voices', items: output.voices } }
  }
  return null
}

/** 宿主内图最大嵌套深度（防 A→B→A） */
export const MAX_HOST_COOK_DEPTH = 8

/**
 * 宿主实例：注入内图 boundary 输入，整链交给任务列表执行（runHostInnerGraph）。
 * 可宿主类型统一 HDA：零输入也可 cook；优先 boundary 映射出口。
 * 缺内图时抛 GRAPH_HOST_INNER_NO_GRAPH，禁止静默回退成资产引用。
 */
export function executeAssetHostInnerGraph(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> | null {
  const { node, inputs } = ctx
  if (!node.assetId) return null
  // 非宿主（导入素材等普通引用）交回引用路径。
  // 不以「资产有 graphJson」兜底：素材资产自身也带生成图，会把引用误当宿主重跑。
  if (!isAssetHostNode(node)) return null

  const genParams = ctx.resolveAssetGenParams?.(node.assetId)
  const raw = genParams?.graphJson
  const innerDoc =
    !!raw && typeof raw === 'object' && Array.isArray((raw as GraphDocument).nodes)
      ? (raw as GraphDocument)
      : null
  if (!innerDoc) {
    // 宿主必须有内图；静默回退成引用会让外层「跑完了」却不入队
    throw new Error('GRAPH_HOST_INNER_NO_GRAPH')
  }

  const cookStack = ctx.cookAssetIdStack ?? []
  if (cookStack.includes(node.assetId)) {
    throw new Error('GRAPH_HOST_RECURSION')
  }
  if (cookStack.length >= MAX_HOST_COOK_DEPTH) {
    throw new Error('GRAPH_HOST_MAX_DEPTH')
  }

  if (!ctx.runHostInnerGraph) {
    throw new Error('GRAPH_HOST_INNER_NO_RUNNER')
  }
  const runInner = ctx.runHostInnerGraph
  const nextStack = [...cookStack, node.assetId]
  const iface = resolveNodeHostInterface(node)

  return (async () => {
    let doc = cloneGraphDocument(innerDoc)
    // 新资产创建时已带 boundary；运行时再幂等补齐，避免缺 proxy
    doc = ensureBoundaryProxyNodes(doc, iface)
    const priorNodeStates: Record<string, GraphNodeRunState> = {}
    for (const port of iface.inputs) {
      const id = boundaryInputNodeId(port.id)
      const values = inputs[port.id] ?? []
      const out = mergeHostInputValues(values, port.dataType)
      if (!out) continue
      priorNodeStates[id] = { status: 'done', outputs: { out } }
      const bNode = doc.nodes.find((n) => n.id === id)
      if (bNode && (out.kind === 'text' || out.kind === 'texts')) {
        const text =
          out.kind === 'text'
            ? out.text
            : out.items
                .map((item) => item.text)
                .filter(Boolean)
                .join('\n')
        bNode.params = { ...bNode.params, text }
      }
    }

    const hosted = await runInner({
      hostNode: node,
      document: doc,
      priorNodeStates,
      signal: ctx.signal,
      cookAssetIdStack: nextStack,
      skipCompletedNodes: ctx.hostInnerSkipCompleted
    })
    if (!hosted.ok) {
      throw new Error(hosted.error || 'GRAPH_HOST_INNER_FAILED')
    }
    if (hosted.outputs) return hosted.outputs
    const mapped = mapHostBoundaryStatesToOutputs(hosted.states, doc, iface)
    if (mapped && Object.keys(mapped).length) return mapped
    // 过渡回退：内图尚无接到 boundary 出口时，按类型聚合输出节点
    const fallback = mapHostInnerStatesToOutputs(hosted.states, doc, node.assetType ?? 'subgraph')
    if (!fallback || !Object.keys(fallback).length) {
      throw new Error('GRAPH_HOST_INNER_NO_OUTPUT')
    }
    return fallback
  })()
}

/** 从 boundary.output 节点状态映射到宿主多出口 */
export function mapHostBoundaryStatesToOutputs(
  states: Record<string, GraphNodeRunState>,
  doc: GraphDocument,
  iface: HostInterfaceDocument
): Record<string, GraphValue> | null {
  const result: Record<string, GraphValue> = {}
  // soft-resolve 可读持久化 runStates + 上游图库；合并本次 states 优先
  const softDoc: GraphDocument = {
    ...doc,
    runStates: { ...(doc.runStates ?? {}), ...states }
  }
  for (const port of iface.outputs) {
    const plural = port.multiple === true || isPluralGraphPortDataType(port.dataType)
    const slotNodes = doc.nodes.filter(
      (n) =>
        isBoundaryOutputNode(n) &&
        n.params.hostBoundaryPort?.portId === port.id &&
        !!n.params.hostBoundaryPort?.slotSourceId
    )
    let boundaryNodes = slotNodes.length
      ? slotNodes
      : doc.nodes.filter(
          (n) => isBoundaryOutputNode(n) && n.params.hostBoundaryPort?.portId === port.id
        )
    if (!boundaryNodes.length) {
      const primary = doc.nodes.find((n) => n.id === boundaryOutputNodeId(port.id))
      if (primary) boundaryNodes = [primary]
    }
    if (!boundaryNodes.length) continue
    if (plural) {
      const collected: GraphValue[] = []
      for (const bnode of boundaryNodes) {
        const out = states[bnode.id]?.outputs?.out
        if (graphValueHasPayload(out)) {
          collected.push(out!)
          continue
        }
        const soft = softResolveBoundaryOutputValue(softDoc, bnode.id)
        if (graphValueHasPayload(soft)) collected.push(soft!)
      }
      const merged = mergeBoundarySoftValues(collected, port.dataType)
      if (merged) result[port.id] = merged
      continue
    }
    const node = boundaryNodes[0]!
    const out = states[node.id]?.outputs?.out
    if (graphValueHasPayload(out)) {
      result[port.id] = out!
      continue
    }
    const soft = softResolveBoundaryOutputValue(softDoc, node.id)
    if (graphValueHasPayload(soft)) result[port.id] = soft!
  }
  return Object.keys(result).length ? result : null
}

/** 从内图全部输出节点状态聚合宿主出口 */
export function mapHostInnerStatesToOutputs(
  states: Record<string, GraphNodeRunState>,
  doc: GraphDocument,
  assetType: string
): Record<string, GraphValue> | null {
  const outs = findAllOutputNodes(doc)
  if (!outs.length) return null

  for (const outNode of outs) {
    const raw = states[outNode.id]?.outputs?.out
    if (raw?.kind === 'output') {
      const mapped = mapChildOutputToHostOut(raw, assetType)
      if (mapped) return mapped
    }
    if (
      graphValueHasPayload(raw) &&
      (raw.kind === 'beat' ||
        raw.kind === 'worldEntities' ||
        raw.kind === 'text' ||
        raw.kind === 'texts')
    ) {
      return { out: raw }
    }
  }
  return null
}

export function executeAssetNode(
  ctx: NodeExecuteContext
): Record<string, GraphValue> | Promise<Record<string, GraphValue>> {
  const { node } = ctx

  if (isAssetRefNode(node)) {
    if (!node.assetId || !node.assetType) {
      throw new Error('GRAPH_UNBOUND_ASSET')
    }
    if (ctx.hasAsset && !ctx.hasAsset(node.assetId)) {
      throw new Error('GRAPH_MISSING_ASSET')
    }
    // 宿主实例：内图整链入队。返回 null 表示确非宿主（无内图的普通引用），
    // 缺内图 / 无 runner 由内部抛错，禁止静默当引用透传
    const nested = executeAssetHostInnerGraph(ctx)
    if (nested) return nested
    // 剧本引用端口为 text；非宿主引用仍可读正文
    if (node.assetType === 'screenplay') {
      return executeTextAssetRefNode(ctx)
    }
    const value: GraphAssetValue = {
      kind: 'asset',
      assetId: node.assetId,
      assetType: node.assetType,
      label: node.params.label,
      weight: node.params.weight,
      volume: node.params.volume,
      muted: node.params.muted,
      notes: node.params.notes,
      title: node.title
    }
    return { out: value }
  }

  // 剧本生成由专用 executeScreenplayGenerateNode 负责；此处仅处理图/视频/声音等
  if (node.assetType === 'screenplay') {
    return executeScreenplayGenerateNode(ctx)
  }

  // 图片生成：输出图片数组（引用节点不走此处）
  if (node.assetType === 'image' || node.typeId === 'asset.image') {
    return executeImageGenerateNode(ctx)
  }

  // 视频生成：文本 / 图片 / 视频均可入；透传优先取上游视频
  if (node.assetType === 'video' || node.typeId === 'asset.video') {
    return executeVideoGenerateNode(ctx)
  }

  // 声音生成：文生语音；无 API 时透传上游声音或输出文本
  if (node.assetType === 'voice' || node.typeId === 'asset.voice') {
    return executeVoiceGenerateNode(ctx)
  }

  // 其它加工：按 @ 筛选上游；无连接时允许仅指令文本（输出 text 供下游 notes）
  const instructionRaw = node.params.generateInstruction?.trim() || ''
  const mentionSources = resolveMentionSources(ctx)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const localNotes = expandInstructionMentions(instructionRaw, mentionSources) || undefined
  const incomingText = autoIncomingTextForInstruction(instructionRaw, selected, mentionSources)
  const items = flattenAssetValues(selected)
  if (!items.length) {
    const text = [localNotes, incomingText].filter(Boolean).join('\n').trim()
    if (!text) throw new Error('GRAPH_PROCESS_NO_INPUT')
    return { out: { kind: 'text', text } }
  }
  const enriched = items.map((item) => {
    const notes = [localNotes, item.notes, incomingText].filter(Boolean).join('\n') || undefined
    return {
      ...item,
      label: node.params.label ?? item.label,
      weight: node.params.weight ?? item.weight,
      volume: node.params.volume ?? item.volume,
      muted: node.params.muted ?? item.muted,
      notes,
      title: node.title ?? item.title
    }
  })
  return { out: enriched[0]! }
}

/** 声音生成：有 generateSpeech 时走声音设计/合成；否则透传上游声音为 voices 或输出文本 */
