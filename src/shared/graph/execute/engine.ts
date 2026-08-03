import { graphValueHasPayload, softResolveSourceOutput } from '../hostInput'
import { isAssetHostNode, isGenerateLocked } from '../nodeRole'
import { SHOT_PARAMS_IMAGES_PORT_ID } from '../shotParams'
import { getNodePorts } from '../ports'
import { findOutputNode } from '../query'
import { resolveNodeType } from '../registry'
import type { GraphDocument, GraphNode, GraphPersistedRunState } from '../types'
import { isVideoFramePortId } from '../videoGenerateParams'
import { collectUpstreamNodeIds, topologicalSort, topologicalWaves } from './topo'
import type {
  GraphNodeRunState,
  GraphOutputValue,
  GraphRunOptions,
  GraphRunResult,
  GraphValue,
  NodeExecuteContext
} from './types'
import {
  buildMentionSourcesForNode,
  contributionFromAssets,
  executeAssetHostInnerGraph,
  executePassthrough,
  resolveGalleryOutputsFromNodeParams,
  resolveGenerateMentionIndexBase
} from './values'

function emptyState(status: GraphNodeRunState['status'] = 'idle'): GraphNodeRunState {
  return { status }
}

function publish(
  states: Record<string, GraphNodeRunState>,
  nodeId: string,
  state: GraphNodeRunState,
  onNodeUpdate?: GraphRunOptions['onNodeUpdate']
): void {
  states[nodeId] = state
  onNodeUpdate?.(nodeId, state)
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === 'AbortError') ||
    (err instanceof Error && err.name === 'AbortError')
  )
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError')
}

/** 让任意 Promise 可响应 AbortSignal；已中止则立即拒绝 */
function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (err) => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      }
    )
  })
}

function markCancelled(
  states: Record<string, GraphNodeRunState>,
  order: string[],
  onNodeUpdate?: GraphRunOptions['onNodeUpdate']
): void {
  for (const id of order) {
    const status = states[id]?.status
    if (status === 'pending' || status === 'running') {
      publish(states, id, { status: 'error', error: 'GRAPH_CANCELLED' }, onNodeUpdate)
    }
  }
}

/** 波次失败后，尚未执行的下游标为 skipped（同层并行节点应已跑完，不会误跳过） */
function markRemainingSkipped(
  states: Record<string, GraphNodeRunState>,
  order: string[],
  onNodeUpdate?: GraphRunOptions['onNodeUpdate']
): void {
  for (const id of order) {
    const status = states[id]?.status
    if (status === 'pending' || status === 'running') {
      publish(states, id, emptyState('skipped'), onNodeUpdate)
    }
  }
}

function waitStep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    if (signal?.aborted) return Promise.reject(abortError())
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        reject(abortError())
      }
      if (signal?.aborted) {
        reject(abortError())
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      requestAnimationFrame(() => {
        signal?.removeEventListener('abort', onAbort)
        if (signal?.aborted) reject(abortError())
        else resolve()
      })
    })
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(abortError())
    }
    if (signal?.aborted) {
      clearTimeout(timer)
      reject(abortError())
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** 输出表是否含有可用正文/媒体（空 text 视为无效） */
function hasUsableOutputRecord(
  outputs: Record<string, GraphValue> | undefined | null
): boolean {
  if (!outputs || !Object.keys(outputs).length) return false
  const out = outputs.out
  if (!out) return true
  if (out.kind === 'text') {
    return !!out.text.trim() || !!out.relativePath?.trim()
  }
  if (
    out.kind === 'world' ||
    out.kind === 'worldEntities' ||
    out.kind === 'shotEntities' ||
    out.kind === 'videoEntities' ||
    out.kind === 'narrative' ||
    out.kind === 'shots'
  ) {
    return !!out.text.trim() || !!('relativePath' in out && out.relativePath?.trim())
  }
  if (out.kind === 'texts') {
    return out.items.some(
      (item) => !!item.text.trim() || !!item.relativePath?.trim()
    )
  }
  return true
}

/** 缓存 outputs 是否含有可用正文/媒体（空 text 视为无效，需重新快照） */
function hasUsablePriorOutputs(prior?: GraphNodeRunState): boolean {
  return hasUsableOutputRecord(prior?.outputs)
}

/**
 * 锁定：优先图库（尊重当前 selected*），否则复用 prior runStates，
 * 再 soft-resolve params / 预览（如 play.script 的 text）。
 * 不调用节点 execute，避免无缓存时误触发生成。
 */
function resolveLockedOutputs(
  node: GraphNode,
  prior: GraphNodeRunState | undefined,
  graph?: GraphDocument
): Record<string, GraphValue> | null {
  const gallery = resolveGalleryOutputsFromNodeParams(node.params, {
    typeId: node.typeId
  })
  if (gallery && hasUsableOutputRecord(gallery)) {
    return hasUsablePriorOutputs(prior) ? { ...prior!.outputs!, ...gallery } : gallery
  }
  if (hasUsablePriorOutputs(prior)) return prior!.outputs!
  if (graph) {
    const soft = softResolveSourceOutput(graph, node.id, 'out')
    if (graphValueHasPayload(soft) && soft) {
      return { out: soft }
    }
  }
  return null
}

/** 单节点执行时：用缓存 outputs，或对上游做无 generate* 快照（仍解析资产正文） */
async function softSnapshotOutputs(
  node: GraphNode,
  prior: GraphNodeRunState | undefined,
  options: Pick<
    GraphRunOptions,
    | 'resolveAssetText'
    | 'resolveAssetGenParams'
    | 'hasAsset'
    | 'locale'
    | 'readRunText'
    | 'resolveNarrativeUnit'
    | 'resolveShotStoryboard'
    | 'resolveAllShotBindingImages'
  >,
  softCtx?: {
    graph: GraphDocument
    sourcePort: string
    priorNodeStates?: Record<string, GraphNodeRunState>
  }
): Promise<Record<string, GraphValue>> {
  const softResolveOpts = {
    resolveAssetGenParams: options.resolveAssetGenParams,
    resolveShotStoryboard: options.resolveShotStoryboard,
    resolveAllShotBindingImages: options.resolveAllShotBindingImages
  }
  // 图库选中可能已在 Inspector 变更：始终用 params 覆盖 out / out-all
  const gallery = resolveGalleryOutputsFromNodeParams(node.params, {
    typeId: node.typeId
  })
  if (hasUsablePriorOutputs(prior)) {
    const merged = gallery ? { ...prior!.outputs!, ...gallery } : { ...prior!.outputs! }
    // 分镜参数：prior 常有文本但 out-images 为空/过期；用全镜绑定图补齐
    if (
      softCtx &&
      node.typeId === 'script.shotParams' &&
      (softCtx.sourcePort === SHOT_PARAMS_IMAGES_PORT_ID ||
        !graphValueHasPayload(merged[SHOT_PARAMS_IMAGES_PORT_ID]))
    ) {
      const priorAsPersisted: Record<string, GraphPersistedRunState> = {
        ...(softCtx.graph.runStates ?? {})
      }
      for (const [id, state] of Object.entries(softCtx.priorNodeStates ?? {})) {
        priorAsPersisted[id] = state
      }
      const softDoc: GraphDocument = { ...softCtx.graph, runStates: priorAsPersisted }
      const softImages = softResolveSourceOutput(
        softDoc,
        node.id,
        SHOT_PARAMS_IMAGES_PORT_ID,
        softResolveOpts
      )
      if (graphValueHasPayload(softImages) && softImages) {
        merged[SHOT_PARAMS_IMAGES_PORT_ID] = softImages
      }
    }
    return hydrateOutputRecordTexts(merged, options.readRunText)
  }
  if (gallery) return hydrateOutputRecordTexts(gallery, options.readRunText)

  // 与 hostInput.softResolveSourceOutput 同源：有载荷则不再空 inputs execute（避免空跑生成）
  if (softCtx) {
    const priorAsPersisted: Record<string, GraphPersistedRunState> = {
      ...(softCtx.graph.runStates ?? {})
    }
    for (const [id, state] of Object.entries(softCtx.priorNodeStates ?? {})) {
      priorAsPersisted[id] = state
    }
    const softDoc: GraphDocument = { ...softCtx.graph, runStates: priorAsPersisted }
    const softVal = softResolveSourceOutput(
      softDoc,
      node.id,
      softCtx.sourcePort,
      softResolveOpts
    )
    if (graphValueHasPayload(softVal)) {
      // 资产引用正文常依赖异步 resolveAssetText；勿用 params 占位正文短路
      const deferAsyncAssetText =
        !!node.assetId &&
        !!options.resolveAssetText &&
        (softVal!.kind === 'text' || softVal!.kind === 'texts')
      if (!deferAsyncAssetText) {
        const port = softCtx.sourcePort || 'out'
        const record: Record<string, GraphValue> = { [port]: softVal!, out: softVal! }
        // 软解析文本口时一并补齐绑定图口
        if (
          node.typeId === 'script.shotParams' &&
          port !== SHOT_PARAMS_IMAGES_PORT_ID
        ) {
          const softImages = softResolveSourceOutput(
            softDoc,
            node.id,
            SHOT_PARAMS_IMAGES_PORT_ID,
            softResolveOpts
          )
          if (graphValueHasPayload(softImages) && softImages) {
            record[SHOT_PARAMS_IMAGES_PORT_ID] = softImages
          }
        }
        return hydrateOutputRecordTexts(record, options.readRunText)
      }
    }
  }

  const def = resolveNodeType(node)
  const execute = def?.execute ?? executePassthrough
  return Promise.resolve(
    execute({
      node,
      inputs: {},
      locale: options.locale,
      // 剧本/分镜引用快照必须能读正文；不调 generateText/Image/Video
      resolveAssetText: options.resolveAssetText,
      resolveAssetGenParams: options.resolveAssetGenParams,
      hasAsset: options.hasAsset,
      readRunText: options.readRunText,
      resolveNarrativeUnit: options.resolveNarrativeUnit,
      resolveShotStoryboard: options.resolveShotStoryboard,
      resolveAllShotBindingImages: options.resolveAllShotBindingImages
    })
  )
}

/** 路径-only text / catalog 在复用 prior 时按 relativePath 补全文 */
async function hydrateOutputRecordTexts(
  outputs: Record<string, GraphValue>,
  readRunText?: (relativePath: string) => Promise<string>
): Promise<Record<string, GraphValue>> {
  if (!readRunText) return outputs
  const next = { ...outputs }
  for (const [key, value] of Object.entries(next)) {
    if (!value) continue
    if (
      (value.kind === 'text' ||
        value.kind === 'world' ||
        value.kind === 'worldEntities' ||
        value.kind === 'shotEntities' ||
        value.kind === 'videoEntities' ||
        value.kind === 'narrative' ||
        value.kind === 'shots') &&
      !value.text.trim() &&
      value.relativePath?.trim()
    ) {
      try {
        const text = (await readRunText(value.relativePath.trim()))?.trim() ?? ''
        if (text) next[key] = { ...value, text }
      } catch {
        // keep path-only
      }
    }
  }
  return next
}

async function executeOneNode(
  nodeId: string,
  byId: Map<string, GraphNode>,
  graph: GraphDocument,
  outputs: Map<string, Record<string, GraphValue>>,
  options: GraphRunOptions,
  states: Record<string, GraphNodeRunState>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const node = byId.get(nodeId)
  if (!node) return { ok: true }

  if (options.signal?.aborted) {
    publish(states, nodeId, { status: 'error', error: 'GRAPH_CANCELLED' }, options.onNodeUpdate)
    return { ok: false, error: 'GRAPH_CANCELLED' }
  }

  const def = resolveNodeType(node)

  // 节点锁定：不 cook，直接复用图库 / 上次输出 / soft params
  if (isGenerateLocked(node)) {
    const locked = resolveLockedOutputs(node, options.priorNodeStates?.[nodeId], graph)
    if (!locked) {
      publish(
        states,
        nodeId,
        { status: 'error', error: 'GRAPH_LOCK_NO_CACHE' },
        options.onNodeUpdate
      )
      return {
        ok: false,
        error: `${def?.label ?? node.title ?? nodeId}: GRAPH_LOCK_NO_CACHE`
      }
    }
    outputs.set(nodeId, locked)
    publish(states, nodeId, { status: 'done', outputs: locked }, options.onNodeUpdate)
    return { ok: true }
  }

  // 先挂上声明的入端口（可为空），再填入边上传来的值，便于日志打印空输入
  const inputs: Record<string, GraphValue[]> = {}
  for (const port of getNodePorts(node).filter((p) => p.direction === 'in')) {
    inputs[port.id] = []
  }
  for (const edge of graph.edges) {
    if (edge.target !== nodeId) continue
    const sourcePorts = outputs.get(edge.source)
    if (!sourcePorts) continue
    const sourcePort = edge.sourcePort ?? 'out'
    const targetPort = edge.targetPort ?? 'in'
    const value = sourcePorts[sourcePort]
    if (!value) continue
    ;(inputs[targetPort] ??= []).push(value)
  }

  publish(states, nodeId, { status: 'running', inputs }, options.onNodeUpdate)
  const execute = def?.execute ?? executePassthrough
  const mentionIndexBase = resolveGenerateMentionIndexBase(
    node,
    options.resolveProjectStyleImages?.() ?? []
  )
  const mentionSources = buildMentionSourcesForNode({
    graph,
    nodeId,
    byId,
    outputs,
    mentionIndexBase,
    resolveNarrativeUnit: options.resolveNarrativeUnit
  })
  const incomingByIndex = graph.edges
    .filter(
      (edge) => edge.target === nodeId && !isVideoFramePortId(edge.targetPort ?? 'in')
    )
    .map((edge, i) => {
      const index = mentionIndexBase + i + 1
      const sourcePort = edge.sourcePort ?? 'out'
      const value = outputs.get(edge.source)?.[sourcePort]
      return value ? { index, value } : { index }
    })
  const ctx: NodeExecuteContext = {
    node,
    inputs,
    mentionSources,
    incomingByIndex,
    generateText: options.generateText,
    generateImage: options.generateImage,
    generateVideo: options.generateVideo,
    generateSpeech: options.generateSpeech,
    locale: options.locale,
    signal: options.signal,
    resolveAssetGenParams: options.resolveAssetGenParams,
    hasAsset: options.hasAsset,
    resolveAssetName: options.resolveAssetName,
    resolveHostAssetName: options.resolveHostAssetName,
    resolveAssetText: options.resolveAssetText,
    resolveImageUrls: options.resolveImageUrls,
    resolveStyleImageUrls: options.resolveStyleImageUrls,
    resolveProjectStyleImages: options.resolveProjectStyleImages,
    enrichStyleImages: options.enrichStyleImages,
    resolveImageGenerateCapabilities: options.resolveImageGenerateCapabilities,
    resolveVideoGenerateCapabilities: options.resolveVideoGenerateCapabilities,
    resolveAssetImageUrl: options.resolveAssetImageUrl,
    resolveAssetMediaUrl: options.resolveAssetMediaUrl,
    composeImageExpandCanvas: options.composeImageExpandCanvas,
    composeImageRedrawCanvas: options.composeImageRedrawCanvas,
    composeImageCropCanvas: options.composeImageCropCanvas,
    composeImageGridCell: options.composeImageGridCell,
    resolveShotStoryboard: options.resolveShotStoryboard,
    resolveAllShotBindingImages: options.resolveAllShotBindingImages,
    resolveNarrativeUnit: options.resolveNarrativeUnit,
    resolveShotSplitTableJson: options.resolveShotSplitTableJson,
    importShotSplitTableJson: options.importShotSplitTableJson,
    collectScriptShotImages: options.collectScriptShotImages,
    collectScriptShotVideos: options.collectScriptShotVideos,
    collectWorldElementOutputs: options.collectWorldElementOutputs,
    collectNarrativeUnitTexts: options.collectNarrativeUnitTexts,
    resolveWorldCatalogJson: options.resolveWorldCatalogJson,
    importWorldCatalogJson: options.importWorldCatalogJson,
    resolveNarrativeCatalogJson: options.resolveNarrativeCatalogJson,
    importNarrativeCatalogJson: options.importNarrativeCatalogJson,
    runHostInnerGraph: options.runHostInnerGraph,
    cookAssetIdStack: options.cookAssetIdStack,
    saveRunMedia: options.saveRunMedia,
    saveRunText: options.saveRunText,
    readRunText: options.readRunText,
    patchNode: options.onNodePatch
      ? (patch) => options.onNodePatch?.(nodeId, patch)
      : undefined
  }

  try {
    // onlyTarget 默认不 cook 内图（防误点父节点）；Cook 子图 / 上游链运行显式允许。
    const shouldCookHostInner =
      options.cookHostInnerGraph ?? options.onlyTargetNode !== true
    if (isAssetHostNode(node) && !shouldCookHostInner) {
      const reused = resolveLockedOutputs(node, options.priorNodeStates?.[nodeId], graph)
      if (!reused) {
        publish(
          states,
          nodeId,
          { status: 'error', error: 'GRAPH_HOST_NO_CACHE_COOK' },
          options.onNodeUpdate
        )
        return {
          ok: false,
          error: `${def?.label ?? node.title ?? nodeId}: GRAPH_HOST_NO_CACHE_COOK`
        }
      }
      const hydrated = await hydrateOutputRecordTexts(reused, options.readRunText)
      outputs.set(nodeId, hydrated)
      publish(states, nodeId, { status: 'done', outputs: hydrated }, options.onNodeUpdate)
      return { ok: true }
    }

    // 宿主 cook 属节点角色而非节点类型：必须先于类型专用 execute，
    // 否则 asset.screenplay 这类走专用函数的宿主会被当引用透传，内图永不入队。
    const hostCook = shouldCookHostInner ? executeAssetHostInnerGraph(ctx) : null
    const result = await withAbort(
      hostCook ?? Promise.resolve(execute(ctx)),
      options.signal
    )
    if (options.signal?.aborted) {
      publish(states, nodeId, { status: 'error', error: 'GRAPH_CANCELLED' }, options.onNodeUpdate)
      return { ok: false, error: 'GRAPH_CANCELLED' }
    }
    outputs.set(nodeId, result)
    // 输入已在 running 时写入日志；完成态只带 outputs，避免详情里再刷一遍大段输入
    publish(states, nodeId, { status: 'done', outputs: result }, options.onNodeUpdate)
    return { ok: true }
  } catch (err) {
    if (isAbortError(err) || options.signal?.aborted) {
      publish(states, nodeId, { status: 'error', error: 'GRAPH_CANCELLED' }, options.onNodeUpdate)
      return { ok: false, error: 'GRAPH_CANCELLED' }
    }
    const message = err instanceof Error ? err.message : String(err)
    publish(states, nodeId, { status: 'error', error: message }, options.onNodeUpdate)
    return {
      ok: false,
      error: `${def?.label ?? node.title ?? nodeId}: ${message}`
    }
  }
}

export async function runGraph(
  graph: GraphDocument,
  options: GraphRunOptions = {}
): Promise<GraphRunResult> {
  const states: Record<string, GraphNodeRunState> = {}
  for (const node of graph.nodes) {
    states[node.id] = emptyState('idle')
  }

  const multiTargets =
    options.targetNodeIds
      ?.map((id) => graph.nodes.find((n) => n.id === id))
      .filter((n): n is GraphNode => !!n) ?? []
  const target =
    multiTargets[0] ??
    (options.targetNodeId
      ? graph.nodes.find((n) => n.id === options.targetNodeId)
      : findOutputNode(graph)) ??
    null

  if (!target) {
    return { ok: false, order: [], states, error: 'GRAPH_NO_OUTPUT' }
  }

  const onlyTarget = options.onlyTargetNode === true && !!options.targetNodeId && !multiTargets.length
  const subset = onlyTarget
    ? new Set<string>([target.id])
    : multiTargets.length
      ? (() => {
          const ids = new Set<string>()
          for (const t of multiTargets) {
            for (const id of collectUpstreamNodeIds(graph, t.id)) ids.add(id)
          }
          return ids
        })()
      : collectUpstreamNodeIds(graph, target.id)

  const skipCompleted = options.skipCompletedNodes === true && !onlyTarget
  const canSkipNode = (nodeId: string): boolean =>
    skipCompleted &&
    nodeId !== target.id &&
    options.priorNodeStates?.[nodeId]?.status === 'done'

  for (const id of subset) {
    if (canSkipNode(id)) {
      const prior = options.priorNodeStates?.[id]
      publish(
        states,
        id,
        { status: 'done', outputs: prior?.outputs, error: prior?.error },
        options.onNodeUpdate
      )
      continue
    }
    publish(states, id, emptyState('pending'), options.onNodeUpdate)
  }
  if (!options.preserveOutsideSubset && !onlyTarget) {
    for (const node of graph.nodes) {
      if (!subset.has(node.id)) {
        publish(states, node.id, emptyState('skipped'), options.onNodeUpdate)
      }
    }
  }

  const order = onlyTarget
    ? [target.id]
    : topologicalSort(subset, graph.edges)
  if (!order) {
    for (const id of subset) {
      publish(states, id, { status: 'error', error: 'GRAPH_CYCLE' }, options.onNodeUpdate)
    }
    return { ok: false, order: [], states, error: 'GRAPH_CYCLE' }
  }

  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const outputs = new Map<string, Record<string, GraphValue>>()
  const stepDelayMs = options.stepDelayMs ?? 80

  if (onlyTarget) {
    for (const edge of graph.edges) {
      if (edge.target !== target.id) continue
      if (outputs.has(edge.source)) continue
      const source = byId.get(edge.source)
      if (!source) continue
      const sourcePort = edge.sourcePort ?? 'out'
      try {
        const snap = await softSnapshotOutputs(
          source,
          options.priorNodeStates?.[edge.source],
          options,
          {
            graph,
            sourcePort,
            priorNodeStates: options.priorNodeStates
          }
        )
        const out = snap[sourcePort] ?? snap.out
        const emptyText =
          (out?.kind === 'text' && !out.text.trim()) ||
          (out?.kind === 'texts' &&
            !out.items.some((item) => !!item.text.trim() || !!item.relativePath?.trim()))
        // 软快照正文为空时，再直接按资产 id 读一次（覆盖空 prior / 解析失败）
        if (emptyText && source.assetId && options.resolveAssetText) {
          const text = (await options.resolveAssetText(source.assetId))?.trim() ?? ''
          if (text) {
            outputs.set(edge.source, { out: { kind: 'text', text } })
            continue
          }
        }
        outputs.set(edge.source, snap)
      } catch {
        // 上游快照抛错时：资产引用仍尝试直接读正文
        if (source.assetId && options.resolveAssetText) {
          try {
            const text = (await options.resolveAssetText(source.assetId))?.trim() ?? ''
            if (text) {
              outputs.set(edge.source, { out: { kind: 'text', text } })
            }
          } catch {
            // 忽略，目标节点侧会报无输入
          }
        }
      }
    }
  }

  // 可复用的已完成节点：先灌 outputs，再从待执行集合中剔除
  for (const nodeId of order) {
    if (!canSkipNode(nodeId) || outputs.has(nodeId)) continue
    const source = byId.get(nodeId)
    if (!source) continue
    try {
      const snap = await softSnapshotOutputs(
        source,
        options.priorNodeStates?.[nodeId],
        options
      )
      outputs.set(nodeId, snap)
      publish(states, nodeId, { status: 'done', outputs: snap }, options.onNodeUpdate)
    } catch {
      // 无法复用则真正执行
    }
  }

  const runIds = order.filter((id) => !(canSkipNode(id) && outputs.has(id)))
  const waves = onlyTarget
    ? [runIds]
    : topologicalWaves(runIds, graph.edges)
  if (!waves) {
    for (const id of runIds) {
      publish(states, id, { status: 'error', error: 'GRAPH_CYCLE' }, options.onNodeUpdate)
    }
    return { ok: false, order, states, error: 'GRAPH_CYCLE' }
  }

  for (const wave of waves) {
    try {
      await waitStep(stepDelayMs, options.signal)
    } catch {
      markCancelled(states, order, options.onNodeUpdate)
      return { ok: false, order, states, error: 'GRAPH_CANCELLED' }
    }

    if (options.signal?.aborted) {
      markCancelled(states, order, options.onNodeUpdate)
      return { ok: false, order, states, error: 'GRAPH_CANCELLED' }
    }

    // 同层互不依赖：并行执行，再汇总到下游
    const steps = await Promise.all(
      wave.map((nodeId) => executeOneNode(nodeId, byId, graph, outputs, options, states))
    )

    if (
      options.signal?.aborted ||
      steps.some((s) => !s.ok && s.error === 'GRAPH_CANCELLED')
    ) {
      markCancelled(states, order, options.onNodeUpdate)
      return { ok: false, order, states, error: 'GRAPH_CANCELLED' }
    }

    const failed = steps.find((s) => !s.ok)
    if (failed && !failed.ok) {
      // 仅跳过尚未执行的下游；同层并行节点已全部跑完
      markRemainingSkipped(states, order, options.onNodeUpdate)
      return { ok: false, order, states, error: failed.error }
    }
  }

  const targetOut = outputs.get(target.id)?.out
  const output: GraphOutputValue | undefined =
    targetOut && targetOut.kind === 'output' ? targetOut : undefined
  const contribution = output
    ? contributionFromAssets(output.items)
    : undefined

  return {
    ok: true,
    order,
    states,
    output,
    contribution
  }
}
