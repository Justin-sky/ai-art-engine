import { computed, reactive, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import {
  applyEpisodeReviewMarks,
  cloneGraphDocument,
  collectUpstreamNodeIds,
  findAllOutputNodes,
  getNodeType,
  mapHostInnerStatesToOutputs,
  mapHostBoundaryStatesToOutputs,
  resolveNodeHostInterface,
  resolveNodeType,
  runGraph,
  summarizeMediaUrlForLog,
  summarizeReferenceListForLog,
  topologicalSort,
  type GraphDocument,
  type GraphNode,
  type GraphNodeParams,
  type GraphNodeRunState,
  type GraphNodeRunStatus,
  type HostInnerGraphRunInput,
  type HostInnerGraphRunResult,
  type GraphRunLogMeta
} from '@shared/graph'
import { isDraftAssetId, normalizeProjectStyleImages, resolveMediaOutputDir } from '@shared/domain'
import { persistAssetRecord } from '../composables/useAssetRecord'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import {
  seedLiveCanvasRunStates,
  syncLiveCanvasEpisodeReviewFromNode,
  syncLiveCanvasNodeParams,
  syncLiveCanvasRunState,
  waitForLiveCanvasHost
} from '../features/mcp/mcpGraphLiveCanvas'
import { liftHostOutputsFromInnerGraph } from '../features/graph/model/liftHostOutputsFromInner'
import { createGraphRunLogBridge } from '../features/graph/model/graphRunLogBridge'
import {
  formatVideoJobProgressMessage,
  subscribeVideoJobProgress
} from '../features/graph/model/subscribeVideoJobProgress'
import {
  resolveGraphNodeDisplayTitle,
  resolveGraphTypeLabel
} from '../features/graph/model/graphNodeDisplayTitle'
import {
  readEpisodeAgentState,
  writeEpisodeAgentState
} from '../features/graph/episodeAgentStateIO'
import { resolveImageGenerateCapabilitiesForRun } from '../features/graph/model/imageGenerateCapabilities'
import { resolveVideoGenerateCapabilitiesForRun } from '../features/graph/model/videoGenerateCapabilities'
import {
  resolveAssetImageUrl,
  resolveAssetMediaDataUrl,
  resolveGraphImageUrls,
  resolveVideoFirstFrameImageUrls
} from '../features/graph/model/resolveGraphImageUrls'
import { resolveAssetFileUrl } from '../features/media/assetUrlCache'
import { resolveAssetText } from '../features/media/resolveAssetText'
import { enrichStyleImagesWithLibraryPrompts } from '../features/stylePresets/defaultLibrary'
import { resolveStyleImageUrls } from '../features/stylePresets/resolveStyleImageUrls'
import i18n from '../i18n'
import { composeImageExpandCanvas } from '../features/graph/model/composeImageExpandCanvas'
import { semanticGraphCapabilities } from '../features/graph/model/semanticGraphCapabilities'
import { composeImageRedrawCanvas } from '../features/graph/model/composeImageRedrawCanvas'
import { composeImageCropCanvas } from '../features/graph/model/composeImageCropCanvas'
import { composeImageTransformCanvas } from '../features/graph/model/composeImageTransformCanvas'
import { composeImageCutoutCanvas } from '../features/graph/model/composeImageCutoutCanvas'
import { composeImageAlignCanvas } from '../features/graph/model/composeImageAlignCanvas'
import { composeImageComposeCanvas } from '../features/graph/model/composeImageComposeCanvas'
import { composeStage2dCanvas } from '../features/graph/model/composeStage2dCanvas'
import { composeStage2dFrameSheet } from '../features/graph/model/composeStage2dFrameSheet'
import { autoDetectAndFitStage2dRig } from '../features/graph/model/composeStage2dAutoCut'
import { composeImageGridCell } from '../features/graph/model/composeImageGridCell'
import { composeAnim2dGif } from '../features/graph/model/composeAnim2dGif'
import { renderSvgFrames } from '../features/graph/model/renderSvgFrames'
import { composeImageIconPackSheet } from '../features/graph/model/composeImageIconPackSheet'
import {
  composeImageLayerStack,
  decomposeImageUiLayers,
  uiRgbaCodec
} from '../features/graph/model/composeImageLayerStack'
import { composeComicPageImage } from '../features/comic/composeComicPageImage'
import {
  composePortraitIdentityLock,
  composePortraitIdPhoto,
  composePortraitLiveRetouch,
  composePortraitScopedRetouch,
  detectPortraitFaces,
  fitPortraitToSourceSize,
  flattenPortraitBackground,
  inspectImageSize
} from '../features/graph/model/portraitCapabilities'
import { inspectModelSkeleton } from '../features/graph/model/inspectModelSkeleton'
import { runBlenderDshJob } from '../features/graph/model/runBlenderDshJob'
import { buildGamePlayProjectForNode } from '../features/graph/model/runGamePlayBuild'
import { normalizeImageAspectRatio } from '../features/graph/model/normalizeImageAspectRatio'
import { removeImageSolidBackground } from '../features/graph/model/removeImageSolidBackground'
import { composeTimelineVideoForNode } from '../features/graph/model/composeTimelineVideo'
import { renderOffscreenDirectorPreviz } from '../features/director/renderOffscreenDirectorPreviz'
import { prepareGraphDocumentForPersist } from '../features/graph/persistGraphRunOutputs'
import { saveGraphRunMediaForNode } from '../features/graph/saveGraphRunMediaForNode'
import { saveGraphRunTextForNode } from '../features/graph/saveGraphRunTextForNode'
import { readGraphRunText } from '../features/graph/readGraphRunText'
import { useDraftStore } from './drafts'
import { useProjectStore } from './project'
import { toPlain } from '../utils/toPlain'
import { previewWorldElementOutputsFromSubgraphs } from '../features/world/worldElementPreview'
import { loadBeatCatalog, applyBeatCatalog } from '../features/beat/applyBeatCatalogOnOpen'
import {
  LEGACY_WORLD_GEN_NODE_ID,
  readWorldElementGraphForNode,
  withWorldElementGraphForNode,
  type WorldElementKind
} from '@shared/graph'

export type GraphTaskStatus = 'pending' | 'running' | 'done' | 'error' | 'stopped'

export type GraphTaskTarget =
  | {
      kind: 'world-element'
      worldAssetId: string
      elementKind: WorldElementKind
      hostId: string
      /** 所属世界元素节点 id；缺省 / 旧版默认节点走资产级共享子图 */
      nodeId?: string
    }
  | {
      kind: 'asset'
      assetId: string
      hostId: string
      /** 通用宿主每次 cook 独立，避免同定义的不同实例错误复用输入与输出 */
      instanceKey?: string
    }

export interface GraphTaskNodeSnapshot {
  nodeId: string
  typeId?: string
  title: string
  icon: string
  status: GraphNodeRunStatus
  error?: string
}

export interface GraphTask {
  id: string
  title: string
  createdAt: number
  status: GraphTaskStatus
  message: string
  target: GraphTaskTarget
  order: string[]
  nodes: GraphTaskNodeSnapshot[]
  runStates: Record<string, GraphNodeRunState>
}

interface GraphTaskInternal extends GraphTask {
  graph: GraphDocument
  abort: AbortController
  /** 入队时的工程会话；切换工程后禁止写回 */
  sessionEpoch: number
  discardWriteBack?: boolean
  /** 宿主内图：已注入输入槽的 prior */
  priorNodeStates?: Record<string, GraphNodeRunState>
  skipCompletedNodes?: boolean
  cookAssetIdStack?: string[]
  /** 指定汇点；缺省时跑图内全部输出节点 */
  targetNodeIds?: string[]
  /** 本次任务不得复用这些节点的旧 done 结果（上游内容已失效） */
  invalidatedNodeIds?: string[]
  logMeta?: GraphRunLogMeta
  /** MCP 旁路跑图：同步节点 running/done 到已打开画布 */
  liveCanvasSync?: boolean
  /** 本次任务实际执行或 patch 过的节点 id，写回底图时避免用 skipped 旧快照覆盖已完成上游 */
  touchedNodeIds?: Set<string>
}

function nodeIcon(node: GraphNode): string {
  const def = resolveNodeType(node) ?? (node.typeId ? getNodeType(node.typeId) : undefined)
  return def?.icon ?? '◆'
}

function nodeTitle(node: GraphNode): string {
  return resolveGraphNodeDisplayTitle(node, {
    scope: undefined,
    t: (key, params) => String(i18n.global.t(key, params ?? {})),
    graphTypeLabel: (typeId) =>
      resolveGraphTypeLabel(
        typeId,
        (key, params) => String(i18n.global.t(key, params ?? {})),
        (key) => i18n.global.te(key)
      )
  })
}

function resolveTaskTargets(graph: GraphDocument, targetNodeIds?: string[]): GraphNode[] {
  const explicit =
    targetNodeIds
      ?.map((id) => graph.nodes.find((node) => node.id === id))
      .filter((node): node is GraphNode => !!node) ?? []
  if (explicit.length) return explicit
  const outputs = findAllOutputNodes(graph)
  if (outputs.length) return outputs
  // 自由画布无 output.* / boundary.output 节点时，以所有无出边的可执行终端节点为汇点
  const hasOutgoing = new Set(graph.edges.filter((e) => e.source !== e.target).map((e) => e.source))
  const sinks = graph.nodes.filter(
    (node) =>
      node.typeId !== 'graph.boundary.input' &&
      node.typeId !== 'note.text' &&
      !node.locked &&
      !hasOutgoing.has(node.id)
  )
  return sinks.length ? sinks : graph.nodes.filter((n) => n.typeId !== 'graph.boundary.input')
}

function buildOrder(graph: GraphDocument, targetNodeIds?: string[]): string[] {
  const targets = resolveTaskTargets(graph, targetNodeIds)
  if (!targets.length) return graph.nodes.map((n) => n.id)
  const subset = new Set<string>()
  for (const target of targets) {
    for (const id of collectUpstreamNodeIds(graph, target.id)) subset.add(id)
  }
  return topologicalSort(subset, graph.edges) ?? [...subset]
}

function snapshotNodes(graph: GraphDocument, order: string[]): GraphTaskNodeSnapshot[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  return order.map((id) => {
    const node = byId.get(id)
    return {
      nodeId: id,
      typeId: node?.typeId,
      title: node ? nodeTitle(node) : id,
      icon: node ? nodeIcon(node) : '◆',
      status: 'idle' as GraphNodeRunStatus
    }
  })
}

function applyRunStateToNodes(
  nodes: GraphTaskNodeSnapshot[],
  runStates: Record<string, GraphNodeRunState>
): void {
  for (const item of nodes) {
    const state = runStates[item.nodeId]
    item.status = state?.status ?? 'idle'
    item.error = state?.error
  }
}

function taskTargetKey(target: GraphTaskTarget): string {
  switch (target.kind) {
    case 'asset':
      return target.instanceKey
        ? `asset:${target.assetId}:instance:${target.instanceKey}`
        : `asset:${target.assetId}`
    case 'world-element':
      return `world-element:${target.worldAssetId}${
        target.nodeId ? `:${target.nodeId}` : ''
      }:${target.elementKind}`
  }
}

/**
 * 写回互斥键：可并行烹调的子目标若共用同一 genParams 袋，必须串行写盘，
 * 否则后完成者用旧快照 merge 会冲掉先完成 kind/unit 的 runStates。
 * （与 taskTargetKey 分离：任务冲突仍按细粒度目标判断。）
 */
export function writeBackExclusiveKey(target: GraphTaskTarget): string {
  if (target.kind === 'world-element') {
    return `world-element:${target.worldAssetId}${target.nodeId ? `:${target.nodeId}` : ''}`
  }
  return taskTargetKey(target)
}

function sameTargetNodeIds(a?: string[], b?: string[]): boolean {
  const left = a?.length ? [...a].sort() : null
  const right = b?.length ? [...b].sort() : null
  if (!left && !right) return true
  if (!left || !right || left.length !== right.length) return false
  return left.every((id, i) => id === right[i])
}

function isActiveStatus(status: GraphTaskStatus): boolean {
  return status === 'pending' || status === 'running'
}

/** 同一画布可并行多条输出链；整图任务或相同汇点集合视为冲突 */
export function conflictsWithActiveWorkflow(
  target: GraphTaskTarget,
  targetNodeIds: string[] | undefined,
  active: Array<{ status: GraphTaskStatus; target: GraphTaskTarget; targetNodeIds?: string[] }>
): boolean {
  const key = taskTargetKey(target)
  const incomingFull = !targetNodeIds?.length
  return active.some((t) => {
    if (!isActiveStatus(t.status)) return false
    if (taskTargetKey(t.target) !== key) return false
    const existingFull = !t.targetNodeIds?.length
    if (incomingFull || existingFull) return true
    return sameTargetNodeIds(t.targetNodeIds, targetNodeIds)
  })
}

/** 合并各来源中 status=done 的节点态，供跨任务 skipCompletedNodes 复用 */
export function mergeDoneRunStates(
  ...sources: Array<Record<string, GraphNodeRunState> | undefined | null>
): Record<string, GraphNodeRunState> {
  const out: Record<string, GraphNodeRunState> = {}
  for (const src of sources) {
    if (!src) continue
    for (const [id, state] of Object.entries(src)) {
      if (state?.status === 'done') out[id] = { ...state }
    }
  }
  return out
}

/** 更早入队的任务优先烹调共同上游；同刻按 id 稳定打破平局 */
export function isOlderGraphTaskPeer(
  task: { id: string; createdAt: number },
  other: { id: string; createdAt: number }
): boolean {
  if (other.createdAt !== task.createdAt) return other.createdAt < task.createdAt
  return other.id < task.id
}

export function listSharedNodeIds(orderA: string[], orderB: string[]): string[] {
  if (!orderA.length || !orderB.length) return []
  const set = new Set(orderA)
  return orderB.filter((id) => set.has(id))
}

/**
 * 更早的并行任务是否仍在烹调与本任务重叠的上游节点。
 * done/skipped/error 视为该节点已结束，后到任务可据此 skip 或自行重试。
 */
export function peerBlocksSharedUpstream(
  peer: {
    status: GraphTaskStatus
    order: string[]
    runStates: Record<string, { status?: string } | undefined>
  },
  sharedNodeIds: readonly string[]
): boolean {
  if (!isActiveStatus(peer.status) || !sharedNodeIds.length) return false
  for (const id of sharedNodeIds) {
    const st = peer.runStates[id]?.status
    if (st !== 'done' && st !== 'skipped' && st !== 'error') return true
  }
  return false
}

function asGraphDocument(raw: unknown): GraphDocument | null {
  if (!raw || typeof raw !== 'object') return null
  const doc = raw as GraphDocument
  if (!Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) return null
  return cloneGraphDocument(doc)
}

function readPersistedGraphForTarget(target: GraphTaskTarget): GraphDocument | null {
  const project = useProjectStore()
  if (target.kind === 'asset') {
    const draft = useDraftStore().getDraft(target.assetId)
    const asset = project.assets.find((a) => a.id === target.assetId)
    return asGraphDocument(
      (draft?.genParams as Record<string, unknown> | undefined)?.graphJson ??
        (asset?.genParams as Record<string, unknown> | undefined)?.graphJson
    )
  }
  if (target.kind === 'world-element') {
    const raw = readWorldElementGraphForNode(
      readWorldGenParams(target.worldAssetId),
      target.nodeId ?? LEGACY_WORLD_GEN_NODE_ID,
      target.elementKind
    )
    return asGraphDocument(raw)
  }
  return null
}

/** 把子集任务跑过的节点合并进最新底图，避免并行写回互相覆盖 */
function mergeSubsetGraphIntoBase(
  base: GraphDocument,
  subset: GraphDocument,
  nodeIds: Iterable<string>,
  subsetRunStates: Record<string, GraphNodeRunState>
): GraphDocument {
  const ids = new Set(nodeIds)
  const fromSubset = new Map(subset.nodes.map((node) => [node.id, node]))
  const merged = cloneGraphDocument(base)
  merged.nodes = merged.nodes.map((node) => {
    if (!ids.has(node.id)) return node
    const patched = fromSubset.get(node.id)
    return patched ? (toPlain(patched) as GraphNode) : node
  })
  merged.runStates = { ...(merged.runStates ?? {}) }
  for (const id of ids) {
    const state = subsetRunStates[id]
    if (state) merged.runStates[id] = { ...state }
  }
  return merged
}

const MAX_COMPLETED_TASKS = 100

export type EnqueueWorkflowResult = { ok: true; id: string } | { ok: false; reason: 'duplicate' }

function readWorldGenParams(worldAssetId: string): Record<string, unknown> {
  if (isDraftAssetId(worldAssetId)) {
    return { ...(useDraftStore().getDraft(worldAssetId)?.genParams ?? {}) }
  }
  const asset = useProjectStore().assets.find((a) => a.id === worldAssetId)
  return { ...((asset?.genParams as Record<string, unknown> | undefined) ?? {}) }
}

/** 世界元素管线宿主资产：世界元素资产，或封装了世界节点链的子图资产 */
function isWorldPipelineAssetType(type: string | undefined | null): boolean {
  return type === 'world' || type === 'subgraph'
}

function taskHostAssetId(target: GraphTaskTarget): string {
  switch (target.kind) {
    case 'asset':
      return target.assetId
    case 'world-element':
      return target.worldAssetId
  }
}

export const useGraphTaskStore = defineStore('graphTasks', () => {
  const activeTasks = ref<GraphTaskInternal[]>([])
  const completedTasks = ref<GraphTaskInternal[]>([])
  const dialogOpen = ref(false)
  const dialogAnchor = shallowRef<HTMLElement | null>(null)
  const tick = ref(0)
  /** 同画布并行写回串行化，避免后完成的任务整图覆盖先完成的结果 */
  const writeBackChains = new Map<string, Promise<void>>()

  const tasks = computed(() => {
    void tick.value
    return activeTasks.value.map(({ abort: _a, graph: _g, ...publicTask }) => publicTask)
  })
  const completed = computed(() => {
    void tick.value
    return completedTasks.value.map(({ abort: _a, graph: _g, ...publicTask }) => publicTask)
  })
  const runningCount = computed(() => {
    void tick.value
    return activeTasks.value.filter((t) => isActiveStatus(t.status)).length
  })

  function bump(): void {
    tick.value += 1
  }

  function hasActiveTaskForTarget(target: GraphTaskTarget): boolean {
    const key = taskTargetKey(target)
    return activeTasks.value.some(
      (t) => isActiveStatus(t.status) && taskTargetKey(t.target) === key
    )
  }

  function getActiveTaskRunStatesForTarget(
    target: GraphTaskTarget
  ): Record<string, GraphNodeRunState> | null {
    const key = taskTargetKey(target)
    const active = activeTasks.value.find(
      (t) => isActiveStatus(t.status) && taskTargetKey(t.target) === key
    )
    return active ? { ...active.runStates } : null
  }

  function stopActiveTasksForTarget(target: GraphTaskTarget): boolean {
    const key = taskTargetKey(target)
    const matching = activeTasks.value.filter(
      (t) => isActiveStatus(t.status) && taskTargetKey(t.target) === key
    )
    if (!matching.length) return false
    for (const task of matching) {
      void stopAndRemove(task.id)
    }
    return true
  }

  async function runWriteBackExclusive(
    targetKey: string,
    work: () => Promise<void>
  ): Promise<void> {
    const prev = writeBackChains.get(targetKey) ?? Promise.resolve()
    const curr = prev.catch(() => undefined).then(work)
    writeBackChains.set(
      targetKey,
      curr.then(
        () => undefined,
        () => undefined
      )
    )
    await curr
  }

  function moveToCompleted(task: GraphTaskInternal): void {
    const activeIdx = activeTasks.value.findIndex((t) => t.id === task.id)
    if (activeIdx >= 0) {
      activeTasks.value.splice(activeIdx, 1)
    }
    const completedIdx = completedTasks.value.findIndex((t) => t.id === task.id)
    if (completedIdx >= 0) {
      completedTasks.value.splice(completedIdx, 1)
    }
    completedTasks.value = [task, ...completedTasks.value].slice(0, MAX_COMPLETED_TASKS)
    bump()
  }

  function openDialog(anchor?: HTMLElement | null): void {
    dialogAnchor.value = anchor ?? document.querySelector<HTMLElement>('[data-graph-task-anchor]')
    dialogOpen.value = true
  }

  function closeDialog(): void {
    dialogOpen.value = false
    dialogAnchor.value = null
  }

  function removeTask(taskId: string): void {
    const activeIdx = activeTasks.value.findIndex((t) => t.id === taskId)
    if (activeIdx >= 0) {
      const task = activeTasks.value[activeIdx]
      if (isActiveStatus(task.status)) {
        task.abort.abort()
      }
      activeTasks.value.splice(activeIdx, 1)
      bump()
      return
    }
    const completedIdx = completedTasks.value.findIndex((t) => t.id === taskId)
    if (completedIdx < 0) return
    completedTasks.value.splice(completedIdx, 1)
    bump()
  }

  async function stopAndRemove(taskId: string): Promise<void> {
    const task = activeTasks.value.find((t) => t.id === taskId)
    if (!task) return
    if (isActiveStatus(task.status)) {
      task.abort.abort()
      task.status = 'stopped'
      task.message = 'stopped'
      for (const node of task.nodes) {
        if (node.status === 'pending' || node.status === 'running') {
          node.status = 'error'
          node.error = 'GRAPH_CANCELLED'
          const cancelledState: GraphNodeRunState = { status: 'error', error: 'GRAPH_CANCELLED' }
          task.runStates[node.nodeId] = cancelledState
          if (task.liveCanvasSync) {
            syncLiveCanvasRunState(task.target.hostId, node.nodeId, cancelledState)
          }
        }
      }
      bump()
      await writeBack(task)
    }
    moveToCompleted(task)
  }

  async function writeBack(task: GraphTaskInternal): Promise<void> {
    if (task.discardWriteBack) return
    const project = useProjectStore()
    if (task.sessionEpoch !== project.sessionEpoch) return

    await runWriteBackExclusive(writeBackExclusiveKey(task.target), async () => {
      if (task.discardWriteBack) return
      if (task.sessionEpoch !== useProjectStore().sessionEpoch) return

      const { document: prepared, materializedStates } = await prepareGraphDocumentForPersist(
        task.graph,
        task.runStates
      )
      // 同步内存 runStates 为物化后版本，便于后续增量重跑 / 预览
      for (const key of Object.keys(task.runStates)) delete task.runStates[key]
      Object.assign(task.runStates, materializedStates)
      task.graph = prepared

      // 写回前并入当前画布视口，避免落盘/applyExternalGraph 用入队时的旧 zoom 冲掉滚轮缩放
      const liveVp = graphEditorHosts.getDocument(task.target.hostId)?.viewport
      if (liveVp) {
        prepared.viewport = { ...liveVp }
      }

      const isSubset = !!task.targetNodeIds?.length
      const mergeIds = task.touchedNodeIds?.size ? task.touchedNodeIds : task.order
      const graph = isSubset
        ? mergeSubsetGraphIntoBase(
            cloneGraphDocument(
              graphEditorHosts.getDocument(task.target.hostId) ??
                readPersistedGraphForTarget(task.target) ??
                prepared
            ),
            prepared,
            mergeIds,
            materializedStates
          )
        : prepared

      if (liveVp) {
        graph.viewport = { ...liveVp }
      }

      // 实时编辑器若仍打开，先同步 UI（含已物化 outputs）
      graphEditorHosts.applyExternalGraph(task.target.hostId, graph)

      if (task.target.kind === 'asset') {
        const assetId = task.target.assetId
        const drafts = useDraftStore()
        const draft = drafts.getDraft(assetId)
        const asset = project.assets.find((a) => a.id === assetId)
        if (!draft && !asset) return
        const prevParams = draft?.genParams ?? asset?.genParams ?? {}
        await persistAssetRecord(assetId, {
          genParams: { ...prevParams, graphJson: toPlain(graph) }
        })
        // dive / 内图任务落盘后抬升宿主出口，避免只有外层 Cook 才能把输出送到父图
        await liftHostOutputsFromInnerGraph(assetId, graph, materializedStates)
        return
      }

      if (task.target.kind === 'world-element') {
        const { worldAssetId, elementKind, nodeId } = task.target
        const prevParams = readWorldGenParams(worldAssetId)
        await persistAssetRecord(worldAssetId, {
          genParams: withWorldElementGraphForNode(
            prevParams,
            nodeId ?? LEGACY_WORLD_GEN_NODE_ID,
            elementKind,
            toPlain(graph) as GraphDocument
          )
        })
        return
      }
    })
  }

  function enqueueWorkflow(input: {
    title: string
    graph: GraphDocument
    target: GraphTaskTarget
    priorNodeStates?: Record<string, GraphNodeRunState>
    skipCompletedNodes?: boolean
    cookAssetIdStack?: string[]
    /** 只跑这些汇点的上游并集（如侧栏图内选中的单条链） */
    targetNodeIds?: string[]
    /** 本次任务不得复用这些节点的旧 done 结果（上游内容已失效） */
    invalidatedNodeIds?: string[]
    logMeta?: GraphRunLogMeta
    liveCanvasSync?: boolean
  }): EnqueueWorkflowResult {
    const targetNodeIds = input.targetNodeIds?.length ? [...input.targetNodeIds] : undefined
    if (conflictsWithActiveWorkflow(input.target, targetNodeIds, activeTasks.value)) {
      return { ok: false, reason: 'duplicate' }
    }

    const graph = cloneGraphDocument(input.graph)
    const order = buildOrder(graph, targetNodeIds)
    const abort = new AbortController()
    const id = `graph-task-${crypto.randomUUID()}`
    const task: GraphTaskInternal = reactive({
      id,
      title: input.title,
      createdAt: Date.now(),
      status: 'pending',
      message: '',
      target: input.target,
      order,
      nodes: snapshotNodes(graph, order),
      runStates: {},
      graph,
      abort,
      sessionEpoch: useProjectStore().sessionEpoch,
      priorNodeStates: input.priorNodeStates,
      skipCompletedNodes: input.skipCompletedNodes,
      cookAssetIdStack: input.cookAssetIdStack,
      targetNodeIds,
      invalidatedNodeIds: input.invalidatedNodeIds,
      logMeta: input.logMeta,
      liveCanvasSync: input.liveCanvasSync === true
    }) as GraphTaskInternal

    activeTasks.value = [task, ...activeTasks.value]
    bump()
    void runTask(task)
    return { ok: true, id }
  }

  /**
   * 等到任务离开 active 列表（writeBack + moveToCompleted 之后）。
   * 不能仅看 status===done：status 会在 writeBack 之前就置 done，过早返回会读到旧产物。
   */
  async function waitForTaskIds(taskIds: string[]): Promise<void> {
    if (!taskIds.length) return
    const pending = new Set(taskIds)
    await new Promise<void>((resolve) => {
      const tick = (): void => {
        for (const id of [...pending]) {
          const stillInFlight = activeTasks.value.some((t) => t.id === id)
          if (!stillInFlight) pending.delete(id)
        }
        if (!pending.size) {
          resolve()
          return
        }
        window.setTimeout(tick, 200)
      }
      tick()
    })
  }

  function findTaskById(taskId: string): GraphTaskInternal | undefined {
    return (
      activeTasks.value.find((t) => t.id === taskId) ??
      completedTasks.value.find((t) => t.id === taskId)
    )
  }

  /**
   * 任务图与运行态快照：对外 tasks / completed 快照刻意不含 graph，
   * 而 MCP 回报本轮产物路径需要按端口与节点参数定位媒体（GIF / 拼版 / 成片）。
   */
  function getTaskRunSnapshot(
    taskId: string
  ): { graph: GraphDocument; runStates: Record<string, GraphNodeRunState> } | null {
    const task = findTaskById(taskId)
    if (!task) return null
    return { graph: task.graph, runStates: { ...task.runStates } }
  }

  /**
   * 宿主内图：整链入队任务列表，等待完成后映射出口。
   * 同资产已有进行中任务则等待该任务。
   */
  async function runHostInnerGraph(
    input: HostInnerGraphRunInput
  ): Promise<HostInnerGraphRunResult> {
    const assetId = input.hostNode.assetId?.trim()
    if (!assetId) {
      return { ok: false, states: {}, error: 'GRAPH_UNBOUND_ASSET' }
    }
    const target: GraphTaskTarget = {
      kind: 'asset',
      assetId,
      hostId: `asset:${assetId}`,
      // 每次宿主 cook 独立实例：避免与 dive 入队的定义工作流、或其它实例抢同一 target
      instanceKey: `${input.hostNode.id}:${crypto.randomUUID()}`
    }
    const targetKey = taskTargetKey(target)

    const existing = activeTasks.value.find(
      (t) => isActiveStatus(t.status) && taskTargetKey(t.target) === targetKey
    )
    let taskId = existing?.id
    let justEnqueued = false

    if (!taskId) {
      const project = useProjectStore()
      const title =
        input.hostNode.title?.trim() ||
        project.assets.find((a) => a.id === assetId)?.name?.trim() ||
        useDraftStore().getDraft(assetId)?.name?.trim() ||
        assetId
      const enqueued = enqueueWorkflow({
        title,
        graph: input.document,
        target,
        priorNodeStates: input.priorNodeStates,
        // Cook 子图显式传 false；其它宿主链默认跳过已完成
        skipCompletedNodes: input.skipCompletedNodes !== false,
        cookAssetIdStack: input.cookAssetIdStack
      })
      if (enqueued.ok) {
        taskId = enqueued.id
        justEnqueued = true
      } else {
        const again = activeTasks.value.find(
          (t) => isActiveStatus(t.status) && taskTargetKey(t.target) === targetKey
        )
        taskId = again?.id
      }
    }

    if (!taskId) {
      return { ok: false, states: {}, error: 'GRAPH_HOST_INNER_ENQUEUE_FAILED' }
    }

    if (justEnqueued) {
      openDialog(document.querySelector<HTMLElement>('[data-graph-task-anchor]'))
    }

    const onAbort = (): void => {
      const t = findTaskById(taskId!)
      if (t && isActiveStatus(t.status)) t.abort.abort()
    }
    input.signal?.addEventListener('abort', onAbort)
    try {
      await waitForTaskIds([taskId])
    } finally {
      input.signal?.removeEventListener('abort', onAbort)
    }

    const done = findTaskById(taskId)
    if (!done) {
      return { ok: false, states: {}, error: 'GRAPH_HOST_INNER_MISSING_TASK' }
    }
    const outputs =
      mapHostBoundaryStatesToOutputs(
        done.runStates,
        done.graph,
        resolveNodeHostInterface(input.hostNode)
      ) ?? mapHostInnerStatesToOutputs(done.runStates, done.graph, input.hostNode.assetType ?? '')
    return {
      ok: done.status === 'done',
      states: { ...done.runStates },
      outputs: outputs ?? undefined,
      error: done.status === 'done' ? undefined : done.message || 'GRAPH_HOST_INNER_FAILED'
    }
  }

  function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      const onAbort = (): void => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  /** 从同画布其它任务 / 落盘 / 实时编辑器收集已完成节点，供 skip 复用 */
  function collectMergedDonePriors(task: GraphTaskInternal): Record<string, GraphNodeRunState> {
    const key = taskTargetKey(task.target)
    const sources: Array<Record<string, GraphNodeRunState> | undefined | null> = [
      task.priorNodeStates
    ]
    for (const other of activeTasks.value) {
      if (other.id === task.id) continue
      if (taskTargetKey(other.target) !== key) continue
      sources.push(other.runStates)
    }
    for (const other of completedTasks.value) {
      if (taskTargetKey(other.target) !== key) continue
      sources.push(other.runStates)
    }
    sources.push(readPersistedGraphForTarget(task.target)?.runStates)
    sources.push(graphEditorHosts.getDocument(task.target.hostId)?.runStates)
    const merged = mergeDoneRunStates(...sources)
    if (task.invalidatedNodeIds?.length) {
      for (const id of task.invalidatedNodeIds) delete merged[id]
    }
    return merged
  }

  /**
   * 后到任务等待更早任务把重叠上游烹完，再 skip；避免两条链同时 cook 共同节点。
   * 无重叠或本任务未开 skip 时立即返回。
   */
  async function waitForOlderSharedUpstreamPeers(task: GraphTaskInternal): Promise<void> {
    if (task.skipCompletedNodes !== true) return
    const key = taskTargetKey(task.target)
    while (!task.abort.signal.aborted) {
      const blockers = activeTasks.value.filter((other) => {
        if (other.id === task.id) return false
        if (!isOlderGraphTaskPeer(task, other)) return false
        if (taskTargetKey(other.target) !== key) return false
        const shared = listSharedNodeIds(task.order, other.order)
        return peerBlocksSharedUpstream(other, shared)
      })
      if (!blockers.length) return
      task.message = 'waiting_shared_upstream'
      bump()
      try {
        await sleep(48, task.abort.signal)
      } catch {
        return
      }
    }
  }

  async function runTask(task: GraphTaskInternal): Promise<void> {
    task.status = 'running'
    bump()
    const logBridge = createGraphRunLogBridge({
      runId: task.id,
      title: task.title,
      hostId: task.target.hostId,
      mode: 'task',
      graph: task.graph,
      startMessage: 'task',
      pipelineStage: task.logMeta?.pipelineStage,
      cellKey: task.logMeta?.cellKey,
      resolveNodeTitle: (item, fallbackId) =>
        resolveGraphNodeDisplayTitle(item, {
          scope: undefined,
          t: (key, params) => String(i18n.global.t(key, params ?? {})),
          graphTypeLabel: (typeId) =>
            resolveGraphTypeLabel(
              typeId,
              (key, params) => String(i18n.global.t(key, params ?? {})),
              (key) => i18n.global.te(key)
            ),
          fallbackId
        })
    })
    try {
      await waitForOlderSharedUpstreamPeers(task)
      if (task.abort.signal.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }
      if (!task.touchedNodeIds) task.touchedNodeIds = new Set<string>()
      // 同步等待期间先完成任务落盘/写回画布的最新节点参数，防止后续节点读到入队时的旧快照
      const latestBeforeRun =
        graphEditorHosts.getDocument(task.target.hostId) ?? readPersistedGraphForTarget(task.target)
      if (latestBeforeRun?.nodes?.length) {
        const latestById = new Map(latestBeforeRun.nodes.map((n) => [n.id, n]))
        task.graph.nodes = task.graph.nodes.map((node) => {
          if (task.touchedNodeIds?.has(node.id)) return node
          const fresh = latestById.get(node.id)
          return fresh ? (toPlain(fresh) as GraphNode) : node
        })
      }
      if (task.skipCompletedNodes === true) {
        task.priorNodeStates = collectMergedDonePriors(task)
      }
      if (task.message === 'waiting_shared_upstream') {
        task.message = ''
        bump()
      }
      if (task.liveCanvasSync) {
        await waitForLiveCanvasHost(task.target.hostId)
        if (task.priorNodeStates) {
          seedLiveCanvasRunStates(task.target.hostId, task.priorNodeStates)
        }
      }
      let checkpointTimer: ReturnType<typeof setTimeout> | null = null
      const clearCheckpointTimer = (): void => {
        if (checkpointTimer) {
          clearTimeout(checkpointTimer)
          checkpointTimer = null
        }
      }
      const scheduleCheckpointPersist = (): void => {
        if (checkpointTimer || task.discardWriteBack || task.abort.signal.aborted) return
        checkpointTimer = setTimeout(() => {
          checkpointTimer = null
          if (!isActiveStatus(task.status) || task.discardWriteBack || task.abort.signal.aborted) {
            return
          }
          void runWriteBackExclusive(writeBackExclusiveKey(task.target), async () => {
            if (
              !isActiveStatus(task.status) ||
              task.discardWriteBack ||
              task.abort.signal.aborted ||
              task.sessionEpoch !== useProjectStore().sessionEpoch
            ) {
              return
            }
            const doneStates = mergeDoneRunStates(task.priorNodeStates, task.runStates)
            const { document: prepared, materializedStates } = await prepareGraphDocumentForPersist(
              task.graph,
              doneStates
            )
            const baseDoc =
              graphEditorHosts.getDocument(task.target.hostId) ??
              readPersistedGraphForTarget(task.target) ??
              prepared
            const mergeIds = task.touchedNodeIds?.size ? task.touchedNodeIds : task.order
            const checkpointGraph = mergeSubsetGraphIntoBase(
              cloneGraphDocument(baseDoc),
              prepared,
              mergeIds,
              materializedStates
            )
            if (task.target.kind === 'asset') {
              const assetId = task.target.assetId
              const project = useProjectStore()
              const drafts = useDraftStore()
              const draft = drafts.getDraft(assetId)
              const asset = project.assets.find((a) => a.id === assetId)
              if (!draft && !asset) return
              const prevParams = draft?.genParams ?? asset?.genParams ?? {}
              await persistAssetRecord(assetId, {
                genParams: { ...prevParams, graphJson: toPlain(checkpointGraph) }
              })
            } else if (task.target.kind === 'world-element') {
              const { worldAssetId, elementKind, nodeId } = task.target
              const prevParams = readWorldGenParams(worldAssetId)
              await persistAssetRecord(worldAssetId, {
                genParams: withWorldElementGraphForNode(
                  prevParams,
                  nodeId ?? LEGACY_WORLD_GEN_NODE_ID,
                  elementKind,
                  toPlain(checkpointGraph) as GraphDocument
                )
              })
            }
          })
        }, 1000)
      }
      let result: Awaited<ReturnType<typeof runGraph>>
      try {
        result = await runGraph(task.graph, {
          signal: task.abort.signal,
          stepDelayMs: 100,
          // Agent 后台任务走容错模式：节点失败不整链中断，长链跑得完
          continueOnError: true,
          skipCompletedNodes: task.skipCompletedNodes === true,
          priorNodeStates: task.priorNodeStates,
          cookAssetIdStack: task.cookAssetIdStack,
          targetNodeIds: resolveTaskTargets(task.graph, task.targetNodeIds).map((n) => n.id),
          onNodeUpdate: (nodeId, state) => {
            if (task.abort.signal.aborted) return
            logBridge.onNodeUpdate(nodeId, state)
            if (state.status === 'skipped') {
              // 子集外 skipped 不覆盖；本趟 pending/running 收尾为 skipped 需写回
              const prev = task.runStates[nodeId]
              if (prev?.status !== 'pending' && prev?.status !== 'running') return
            } else if (
              state.status === 'running' ||
              state.status === 'done' ||
              state.status === 'error'
            ) {
              task.touchedNodeIds?.add(nodeId)
            }
            task.runStates[nodeId] = { ...state }
            applyRunStateToNodes(task.nodes, task.runStates)
            if (task.liveCanvasSync !== false) {
              syncLiveCanvasRunState(task.target.hostId, nodeId, state)
              syncLiveCanvasEpisodeReviewFromNode(task.target.hostId, task.graph.nodes, nodeId)
            }
            if (state.status === 'done') {
              scheduleCheckpointPersist()
            }
            bump()
          },
          onLog: (_nodeId, message, level) => {
            if (task.abort.signal.aborted) return
            logBridge.appendMessage(message, level)
          },
          onNodePatch: (nodeId, patch) => {
            if (task.abort.signal.aborted) return
            const node = task.graph.nodes.find((n) => n.id === nodeId)
            if (!node) return
            task.touchedNodeIds?.add(nodeId)
            if (patch.params) {
              node.params = { ...node.params, ...patch.params } as GraphNodeParams
              if (task.liveCanvasSync !== false) {
                syncLiveCanvasNodeParams(task.target.hostId, nodeId, patch.params)
              }
              if (
                patch.params.filmStoryboard !== undefined ||
                patch.params.filmCast !== undefined ||
                patch.params.filmRenders !== undefined ||
                patch.params.filmReviewReport !== undefined ||
                patch.params.comicPage !== undefined ||
                patch.params.generatedImages !== undefined ||
                patch.params.generatedVideos !== undefined ||
                patch.params.generatedTexts !== undefined
              ) {
                scheduleCheckpointPersist()
              }
            }
            if (patch.title !== undefined) node.title = patch.title
            bump()
          },
          saveRunMedia: (input) =>
            saveGraphRunMediaForNode({
              ...input,
              hostAssetId: taskHostAssetId(task.target)
            }),
          saveRunText: (input) =>
            saveGraphRunTextForNode({
              ...input,
              hostAssetId: taskHostAssetId(task.target)
            }),
          readRunText: readGraphRunText,
          readEpisodeAgentState,
          writeEpisodeAgentState,
          generateText: async (input) => {
            const startedAt = Date.now()
            const request = {
              prompt: input.prompt,
              system: input.system,
              model: input.model,
              providerInstanceId: input.providerInstanceId,
              imageCount: input.images?.length || undefined,
              inputReferenceUrls: summarizeReferenceListForLog(input.images)
            }
            logBridge.appendMessage(String(i18n.global.t('graph.logs.submitText')))
            try {
              const value = await window.studio.generateText(input)
              logBridge.recordApiCall({
                kind: 'generateText',
                request,
                response: { text: value.text, model: value.model },
                durationMs: Math.max(0, Date.now() - startedAt)
              })
              return value
            } catch (err) {
              logBridge.recordApiCall({
                kind: 'generateText',
                request,
                error: err instanceof Error ? err.message : String(err),
                durationMs: Math.max(0, Date.now() - startedAt)
              })
              throw err
            }
          },
          generateDecisions: async (input) => {
            const startedAt = Date.now()
            const request = {
              questions: input.questions.map((q) => ({ key: q.key, type: q.type })),
              model: input.model,
              providerInstanceId: input.providerInstanceId,
              evidenceCount: input.evidence?.length || undefined
            }
            logBridge.appendMessage(String(i18n.global.t('graph.logs.submitDecisions')))
            try {
              const value = await window.studio.generateDecisions(input)
              logBridge.recordApiCall({
                kind: 'generateDecisions',
                request,
                response: { text: value.summary, model: value.model },
                durationMs: Math.max(0, Date.now() - startedAt)
              })
              return value
            } catch (err) {
              logBridge.recordApiCall({
                kind: 'generateDecisions',
                request,
                error: err instanceof Error ? err.message : String(err),
                durationMs: Math.max(0, Date.now() - startedAt)
              })
              throw err
            }
          },
          generateImage: async (input) => {
            const startedAt = Date.now()
            const request = {
              prompt: input.prompt,
              model: input.model,
              providerInstanceId: input.providerInstanceId,
              aspectRatio: input.aspectRatio,
              resolution: input.resolution,
              quality: input.quality,
              n: input.n,
              seed: input.seed ?? null,
              inputReferenceCount: input.inputReferences?.length || undefined,
              inputReferences: input.inputReferenceMeta,
              inputReferenceUrls: summarizeReferenceListForLog(input.inputReferences),
              transparentBackground: input.transparentBackground || undefined,
              layerDecomposition: input.layerDecomposition || undefined
            }
            logBridge.appendMessage(String(i18n.global.t('graph.logs.submitImage')))
            try {
              const value = await window.studio.generateImage(input)
              logBridge.recordApiCall({
                kind: 'generateImage',
                request,
                response: {
                  model: value.model,
                  imageCount: value.images?.length ?? 0,
                  referenceNotes: value.referenceNotes
                },
                durationMs: Math.max(0, Date.now() - startedAt)
              })
              return value
            } catch (err) {
              logBridge.recordApiCall({
                kind: 'generateImage',
                request,
                error: err instanceof Error ? err.message : String(err),
                durationMs: Math.max(0, Date.now() - startedAt)
              })
              throw err
            }
          },
          generateVideo: async (input) => {
            const startedAt = Date.now()
            const request: {
              prompt: string
              model?: string
              providerInstanceId?: string
              aspectRatio?: string
              resolution?: string
              duration?: number
              generateAudio?: boolean
              seed?: number | null
              inputReferenceCount?: number
              inputReferenceUrls?: Array<{ kind?: string; url: string }>
              firstFrameImageUrl?: string
              lastFrameImageUrl?: string
              uploads?: Array<{
                sourceLabel: string
                objectKey: string
                bytes: number
                urlPreview: string
              }>
            } = {
              prompt: input.prompt,
              model: input.model,
              providerInstanceId: input.providerInstanceId,
              aspectRatio: input.aspectRatio,
              resolution: input.resolution,
              duration: input.duration,
              generateAudio: input.generateAudio,
              seed: input.seed ?? null,
              inputReferenceCount: input.inputReferences?.length || undefined,
              inputReferenceUrls: summarizeReferenceListForLog(input.inputReferences),
              firstFrameImageUrl: input.firstFrameImageUrl?.trim()
                ? summarizeMediaUrlForLog(input.firstFrameImageUrl)
                : undefined,
              lastFrameImageUrl: input.lastFrameImageUrl?.trim()
                ? summarizeMediaUrlForLog(input.lastFrameImageUrl)
                : undefined
            }
            logBridge.appendMessage(String(i18n.global.t('graph.logs.submitVideo')))
            const progressNodeId =
              input.graphBinding?.nodeId?.trim() || logBridge.currentRunningNodeId() || undefined
            const stopProgress = subscribeVideoJobProgress({
              nodeId: progressNodeId,
              onMessage: (message) => logBridge.appendMessage(message),
              format: (job) =>
                formatVideoJobProgressMessage(job, (key, params) =>
                  String(i18n.global.t(key, params ?? {}))
                )
            })
            try {
              const project = useProjectStore()
              const outputDir = resolveMediaOutputDir({
                mediaOutputDir: input.outputDir,
                cacheOutputDir: project.config?.cacheOutputDir,
                kind: 'video'
              })
              const value = await window.studio.generateVideo({ ...input, outputDir })
              if (outputDir === 'Assets' || outputDir.startsWith('Assets/')) {
                await project.scheduleRefreshLibrary()
              }
              if (value.uploads?.length) {
                request.uploads = value.uploads.map((item) => ({
                  sourceLabel: item.sourceLabel,
                  objectKey: item.objectKey,
                  bytes: item.bytes,
                  urlPreview: item.url.slice(0, 120)
                }))
                for (const item of value.uploads) {
                  for (const log of item.logs) {
                    logBridge.appendMessage(`[ObjectStorage] ${log.message}`, log.level)
                  }
                }
              }
              logBridge.recordApiCall({
                kind: 'generateVideo',
                request,
                response: {
                  model: value.model,
                  assetId: value.assetId,
                  relativePath: value.relativePath
                },
                durationMs: Math.max(0, Date.now() - startedAt)
              })
              return value
            } catch (err) {
              logBridge.recordApiCall({
                kind: 'generateVideo',
                request,
                error: err instanceof Error ? err.message : String(err),
                durationMs: Math.max(0, Date.now() - startedAt)
              })
              throw err
            } finally {
              stopProgress()
            }
          },
          generateSpeech: async (input) => {
            const startedAt = Date.now()
            const request = {
              input: input.input,
              model: input.model,
              providerInstanceId: input.providerInstanceId,
              voice: input.voice,
              name: input.name,
              imageCount: input.images?.length,
              inputReferenceUrls: summarizeReferenceListForLog(input.images)
            }
            logBridge.appendMessage(String(i18n.global.t('graph.logs.submitSpeech')))
            try {
              const project = useProjectStore()
              const outputDir = resolveMediaOutputDir({
                mediaOutputDir: input.outputDir,
                cacheOutputDir: project.config?.cacheOutputDir,
                kind: 'voice'
              })
              const value = await window.studio.generateSpeech({ ...input, outputDir })
              if (outputDir === 'Assets' || outputDir.startsWith('Assets/')) {
                await project.refreshAssets()
              }
              logBridge.recordApiCall({
                kind: 'generateSpeech',
                request,
                response: {
                  model: value.model,
                  voice: value.voice,
                  assetId: value.assetId,
                  relativePath: value.relativePath
                },
                durationMs: Math.max(0, Date.now() - startedAt)
              })
              return value
            } catch (err) {
              logBridge.recordApiCall({
                kind: 'generateSpeech',
                request,
                error: err instanceof Error ? err.message : String(err),
                durationMs: Math.max(0, Date.now() - startedAt)
              })
              throw err
            }
          },
          generateSoundEffect: async (input) => {
            const startedAt = Date.now()
            const request = {
              prompt: input.prompt,
              model: input.model,
              providerInstanceId: input.providerInstanceId,
              loop: input.loop,
              durationSeconds: input.durationSeconds
            }
            logBridge.appendMessage(String(i18n.global.t('graph.logs.submitSoundEffect')))
            try {
              const project = useProjectStore()
              const outputDir = resolveMediaOutputDir({
                mediaOutputDir: input.outputDir,
                cacheOutputDir: project.config?.cacheOutputDir,
                kind: 'sfx'
              })
              const value = await window.studio.generateSoundEffect({ ...input, outputDir })
              if (outputDir === 'Assets' || outputDir.startsWith('Assets/')) {
                await project.refreshAssets()
              }
              logBridge.recordApiCall({
                kind: 'generateSoundEffect',
                request,
                response: {
                  model: value.model,
                  assetId: value.assetId,
                  relativePath: value.relativePath,
                  ...(value.resolvedPrompt ? { resolvedPrompt: value.resolvedPrompt } : {})
                },
                durationMs: Math.max(0, Date.now() - startedAt)
              })
              return value
            } catch (err) {
              logBridge.recordApiCall({
                kind: 'generateSoundEffect',
                request,
                error: err instanceof Error ? err.message : String(err),
                durationMs: Math.max(0, Date.now() - startedAt)
              })
              throw err
            }
          },
          generateMusic: async (input) => {
            const startedAt = Date.now()
            const request = {
              prompt: input.prompt,
              lyricsLength: input.lyrics?.length,
              instrumental: input.instrumental,
              model: input.model,
              providerInstanceId: input.providerInstanceId
            }
            logBridge.appendMessage(String(i18n.global.t('graph.logs.submitMusic')))
            try {
              const project = useProjectStore()
              const outputDir = resolveMediaOutputDir({
                mediaOutputDir: input.outputDir,
                cacheOutputDir: project.config?.cacheOutputDir,
                kind: 'music'
              })
              const value = await window.studio.generateMusic({ ...input, outputDir })
              if (outputDir === 'Assets' || outputDir.startsWith('Assets/')) {
                await project.refreshAssets()
              }
              logBridge.recordApiCall({
                kind: 'generateMusic',
                request,
                response: {
                  model: value.model,
                  assetId: value.assetId,
                  relativePath: value.relativePath
                },
                durationMs: Math.max(0, Date.now() - startedAt)
              })
              return value
            } catch (err) {
              logBridge.recordApiCall({
                kind: 'generateMusic',
                request,
                error: err instanceof Error ? err.message : String(err),
                durationMs: Math.max(0, Date.now() - startedAt)
              })
              throw err
            }
          },
          generateModel3d: async (input) => {
            const startedAt = Date.now()
            const request: {
              prompt: string
              model?: string
              providerInstanceId?: string
              style?: string
              inputReferenceCount?: number
              inputReferenceUrls?: Array<{ kind?: string; url: string }>
              uploads?: Array<{
                sourceLabel: string
                objectKey: string
                bytes: number
                urlPreview: string
              }>
            } = {
              prompt: input.prompt,
              model: input.model,
              providerInstanceId: input.providerInstanceId,
              style: input.style,
              inputReferenceCount: input.inputReferences?.length || undefined,
              inputReferenceUrls: summarizeReferenceListForLog(input.inputReferences)
            }
            logBridge.appendMessage(String(i18n.global.t('graph.logs.submitModel3d')))
            const progressNodeId =
              input.graphBinding?.nodeId?.trim() || logBridge.currentRunningNodeId() || undefined
            const stopProgress = subscribeVideoJobProgress({
              nodeId: progressNodeId,
              onMessage: (message) => logBridge.appendMessage(message),
              format: (job) =>
                formatVideoJobProgressMessage(job, (key, params) =>
                  String(i18n.global.t(key, params ?? {}))
                )
            })
            try {
              const value = await window.studio.generateModel3d(input)
              if (value.uploads?.length) {
                request.uploads = value.uploads.map((item) => ({
                  sourceLabel: item.sourceLabel,
                  objectKey: item.objectKey,
                  bytes: item.bytes,
                  urlPreview: item.url.slice(0, 120)
                }))
                for (const item of value.uploads) {
                  for (const log of item.logs) {
                    logBridge.appendMessage(`[ObjectStorage] ${log.message}`, log.level)
                  }
                }
              }
              logBridge.recordApiCall({
                kind: 'generateModel3d',
                request,
                response: {
                  model: value.model,
                  assetId: value.assetId,
                  relativePath: value.relativePath
                },
                durationMs: Math.max(0, Date.now() - startedAt)
              })
              return value
            } catch (err) {
              logBridge.recordApiCall({
                kind: 'generateModel3d',
                request,
                error: err instanceof Error ? err.message : String(err),
                durationMs: Math.max(0, Date.now() - startedAt)
              })
              throw err
            } finally {
              stopProgress()
            }
          },
          generateSpatialWorld: async (input) => {
            const startedAt = Date.now()
            const request: {
              prompt: string
              model?: string
              providerInstanceId?: string
              seed?: number
              inputReferenceCount?: number
              inputReferenceUrls?: Array<{ kind?: string; url: string }>
              uploads?: Array<{
                sourceLabel: string
                objectKey: string
                bytes: number
                urlPreview: string
              }>
            } = {
              prompt: input.prompt,
              model: input.model,
              providerInstanceId: input.providerInstanceId,
              seed: input.seed,
              inputReferenceCount: input.inputReferences?.length || undefined,
              inputReferenceUrls: summarizeReferenceListForLog(input.inputReferences)
            }
            logBridge.appendMessage(String(i18n.global.t('graph.logs.submitSpatialWorld')))
            const progressNodeId =
              input.graphBinding?.nodeId?.trim() || logBridge.currentRunningNodeId() || undefined
            const stopProgress = subscribeVideoJobProgress({
              nodeId: progressNodeId,
              onMessage: (message) => logBridge.appendMessage(message),
              format: (job) =>
                formatVideoJobProgressMessage(job, (key, params) =>
                  String(i18n.global.t(key, params ?? {}))
                )
            })
            try {
              const value = await window.studio.generateSpatialWorld(input)
              if (value.uploads?.length) {
                request.uploads = value.uploads.map((item) => ({
                  sourceLabel: item.sourceLabel,
                  objectKey: item.objectKey,
                  bytes: item.bytes,
                  urlPreview: item.url.slice(0, 120)
                }))
                for (const item of value.uploads) {
                  for (const log of item.logs) {
                    logBridge.appendMessage(`[ObjectStorage] ${log.message}`, log.level)
                  }
                }
              }
              // 参考媒体的托管上传 / 回退说明（不依赖对象存储那条路也在这里留痕）
              for (const note of value.referenceNotes ?? []) {
                logBridge.appendMessage(note, 'info')
              }
              logBridge.recordApiCall({
                kind: 'generateSpatialWorld',
                request,
                response: {
                  model: value.model,
                  assetId: value.assetId,
                  relativePath: value.relativePath
                },
                durationMs: Math.max(0, Date.now() - startedAt)
              })
              return value
            } catch (err) {
              logBridge.recordApiCall({
                kind: 'generateSpatialWorld',
                request,
                error: err instanceof Error ? err.message : String(err),
                durationMs: Math.max(0, Date.now() - startedAt)
              })
              throw err
            } finally {
              stopProgress()
            }
          },
          exportWorld: async (input) => {
            const startedAt = Date.now()
            const request = {
              spatialWorldId: input.spatialWorldId,
              assetType: input.assetType,
              format: input.format,
              meshVariant: input.meshVariant,
              resolution: input.resolution,
              providerInstanceId: input.providerInstanceId,
              model: input.model
            }
            logBridge.appendMessage(String(i18n.global.t('graph.logs.submitSpatialWorldExport')))
            const progressNodeId =
              input.graphBinding?.nodeId?.trim() || logBridge.currentRunningNodeId() || undefined
            const stopProgress = subscribeVideoJobProgress({
              nodeId: progressNodeId,
              onMessage: (message) => logBridge.appendMessage(message),
              format: (job) =>
                formatVideoJobProgressMessage(job, (key, params) =>
                  String(i18n.global.t(key, params ?? {}))
                )
            })
            try {
              const value = await window.studio.exportWorld(input)
              logBridge.recordApiCall({
                kind: 'exportWorld',
                request,
                response: {
                  model: value.model,
                  assetId: value.assetId,
                  relativePath: value.relativePath
                },
                durationMs: Math.max(0, Date.now() - startedAt)
              })
              return value
            } catch (err) {
              logBridge.recordApiCall({
                kind: 'exportWorld',
                request,
                error: err instanceof Error ? err.message : String(err),
                durationMs: Math.max(0, Date.now() - startedAt)
              })
              throw err
            } finally {
              stopProgress()
            }
          },
          rigModel3d: async (input) => {
            const startedAt = Date.now()
            const request = {
              modelRelativePath: input.modelRelativePath,
              model: input.model,
              providerInstanceId: input.providerInstanceId,
              rigType: input.rigType,
              spec: input.spec,
              outFormat: input.outFormat
            }
            logBridge.appendMessage(String(i18n.global.t('graph.logs.submitRig')))
            try {
              const value = await window.studio.rigModel3d(input)
              logBridge.recordApiCall({
                kind: 'rigModel3d',
                request,
                response: {
                  model: value.model,
                  assetId: value.assetId,
                  relativePath: value.relativePath
                },
                durationMs: Math.max(0, Date.now() - startedAt)
              })
              return value
            } catch (err) {
              logBridge.recordApiCall({
                kind: 'rigModel3d',
                request,
                error: err instanceof Error ? err.message : String(err),
                durationMs: Math.max(0, Date.now() - startedAt)
              })
              throw err
            }
          },
          segmentModel3d: async (input) => {
            const startedAt = Date.now()
            const request = {
              modelRelativePath: input.modelRelativePath,
              model: input.model,
              providerInstanceId: input.providerInstanceId,
              mode: input.mode,
              granularity: input.granularity,
              smartGranularity: input.smartGranularity
            }
            logBridge.appendMessage(String(i18n.global.t('graph.logs.submitSegment')))
            try {
              const value = await window.studio.segmentModel3d(input)
              logBridge.recordApiCall({
                kind: 'segmentModel3d',
                request,
                response: {
                  model: value.model,
                  assetId: value.assetId,
                  relativePath: value.relativePath,
                  text: value.parts.join(', ')
                },
                durationMs: Math.max(0, Date.now() - startedAt)
              })
              return value
            } catch (err) {
              logBridge.recordApiCall({
                kind: 'segmentModel3d',
                request,
                error: err instanceof Error ? err.message : String(err),
                durationMs: Math.max(0, Date.now() - startedAt)
              })
              throw err
            }
          },
          postProcessModel3d: async (input) => {
            const startedAt = Date.now()
            const request = {
              op: input.op,
              providerTaskId: input.providerTaskId,
              modelRelativePath: input.modelRelativePath,
              model: input.model,
              providerInstanceId: input.providerInstanceId
            }
            logBridge.appendMessage(String(i18n.global.t('graph.logs.submitPostProcess')))
            try {
              const value = await window.studio.postProcessModel3d(input)
              logBridge.recordApiCall({
                kind: 'postProcessModel3d',
                request,
                response:
                  value.op === 'rigCheck'
                    ? { ok: value.riggable, text: value.rigType }
                    : {
                        model: value.model,
                        assetId: value.assetId,
                        relativePath: value.relativePath
                      },
                durationMs: Math.max(0, Date.now() - startedAt)
              })
              return value
            } catch (err) {
              logBridge.recordApiCall({
                kind: 'postProcessModel3d',
                request,
                error: err instanceof Error ? err.message : String(err),
                durationMs: Math.max(0, Date.now() - startedAt)
              })
              throw err
            }
          },
          resolveLiveAssetGraph: (assetId) =>
            graphEditorHosts.getLiveAssetDocument(assetId) ?? undefined,
          resolveAssetGenParams: (assetId) => {
            const live = graphEditorHosts.getLiveAssetDocument(assetId)
            const project = useProjectStore()
            const base = isDraftAssetId(assetId)
              ? (useDraftStore().getDraft(assetId)?.genParams as
                  Record<string, unknown> | undefined)
              : (project.assets.find((asset) => asset.id === assetId)?.genParams as
                  Record<string, unknown> | undefined)
            if (live) {
              return { ...(base ?? {}), graphJson: live }
            }
            return base
          },
          resolveAssetName: (assetId) => {
            const project = useProjectStore()
            return project.assets.find((asset) => asset.id === assetId)?.name?.trim() || undefined
          },
          resolveHostAssetName: () => {
            const hostAssetId = taskHostAssetId(task.target)
            const project = useProjectStore()
            return (
              project.assets.find((asset) => asset.id === hostAssetId)?.name?.trim() ||
              useDraftStore().getDraft(hostAssetId)?.name?.trim() ||
              undefined
            )
          },
          resolveHostAssetId: () => taskHostAssetId(task.target),
          resolveAssetText,
          resolveImageUrls: resolveGraphImageUrls,
          resolveVideoFirstFrameImageUrls,
          resolveStyleImageUrls,
          resolveProjectStyleImages: () =>
            normalizeProjectStyleImages(useProjectStore().config?.styleImages),
          resolveProjectGenerateSeed: () => useProjectStore().config?.generateSeed,
          enrichStyleImages: (images) =>
            enrichStyleImagesWithLibraryPrompts(images, String(i18n.global.locale.value)),
          resolveImageGenerateCapabilities: resolveImageGenerateCapabilitiesForRun,
          resolveVideoGenerateCapabilities: resolveVideoGenerateCapabilitiesForRun,
          resolveAssetImageUrl,
          resolveAssetMediaUrl: resolveAssetMediaDataUrl,
          resolveProjectMediaUrl: (relativePath: string) => resolveAssetFileUrl(relativePath),
          ...semanticGraphCapabilities,
          composeImageExpandCanvas,
          composeImageRedrawCanvas,
          composeImageCropCanvas,
          composeImageTransformCanvas,
          composeImageCutoutCanvas,
          composeImageAlignCanvas,
          composeImageComposeCanvas,
          composeStage2dCanvas,
          composeStage2dFrameSheet,
          autoRigStage2dScene: autoDetectAndFitStage2dRig,
          composeImageGridCell,
          composeGifFrames: composeAnim2dGif,
          renderSvgFrames,
          composeImageIconPackSheet,
          composeImageLayerStack,
          decomposeImageUiLayers,
          uiRgbaCodec,
          composeComicPageImage,
          composePortraitIdPhoto,
          composePortraitScopedRetouch,
          composePortraitIdentityLock,
          detectPortraitFaces,
          inspectImageSize,
          fitPortraitToSourceSize,
          flattenPortraitBackground,
          composePortraitLiveRetouch,
          inspectModelSkeleton,
          runBlenderDshJob,
          buildGamePlayProject: buildGamePlayProjectForNode,
          runBlenderMcpTool: (input) =>
            window.studio.runBlenderMcpTool({
              name: input.name,
              args: input.args ?? {},
              timeoutMs: input.timeoutMs
            }),
          normalizeImageAspectRatio,
          removeImageSolidBackground,
          composeTimelineVideo: (input) =>
            composeTimelineVideoForNode({
              ...input,
              hostAssetId: taskHostAssetId(task.target)
            }),
          renderDirectorStagePreviz: (input) =>
            renderOffscreenDirectorPreviz({
              ...input,
              shots: input.shots as import('@shared/graph/film/storyboard').FilmShot[] | undefined,
              hostAssetId: input.hostAssetId ?? taskHostAssetId(task.target),
              hostAssetName: input.hostAssetName ?? task.title
            }),
          resolveBeatCatalogJson: () => {
            if (task.target.kind !== 'asset') return null
            const beatId = task.target.assetId
            const rows = loadBeatCatalog(beatId)
            if (!rows.length) return null
            return JSON.stringify(rows)
          },
          importBeatCatalogJson: async (jsonText) => {
            if (task.target.kind !== 'asset') return
            await applyBeatCatalog(task.target.assetId, jsonText)
          },
          resolveWorldElementOutputs: (node) => {
            if (task.target.kind !== 'asset') return []
            const spatialWorldId = task.target.assetId
            if (isDraftAssetId(spatialWorldId)) {
              const draft = useDraftStore().getDraft(spatialWorldId)
              if (!isWorldPipelineAssetType(draft?.type)) return []
            } else {
              const project = useProjectStore()
              const asset = project.assets.find((a) => a.id === spatialWorldId)
              if (!isWorldPipelineAssetType(asset?.type)) return []
            }
            return previewWorldElementOutputsFromSubgraphs({
              worldAssetId: spatialWorldId,
              nodeId: node?.id
            })
          },
          runHostInnerGraph
        })
      } finally {
        clearCheckpointTimer()
      }

      if (task.abort.signal.aborted || result.error === 'GRAPH_CANCELLED') {
        task.status = 'stopped'
        task.message = 'GRAPH_CANCELLED'
        for (const [id, st] of Object.entries(task.runStates)) {
          if (st?.status === 'pending' || st?.status === 'running') {
            const cancelledState: GraphNodeRunState = { status: 'error', error: 'GRAPH_CANCELLED' }
            task.runStates[id] = cancelledState
            if (task.liveCanvasSync !== false) {
              syncLiveCanvasRunState(task.target.hostId, id, cancelledState)
            }
          }
        }
        applyRunStateToNodes(task.nodes, task.runStates)
        logBridge.endFromResult(result, { aborted: true })
        bump()
        await writeBack(task)
        moveToCompleted(task)
        return
      }

      // 合并引擎最终 states
      for (const [id, state] of Object.entries(result.states)) {
        if (state.status === 'skipped') {
          const prev = task.runStates[id]
          if (prev?.status !== 'pending' && prev?.status !== 'running') continue
        }
        task.runStates[id] = { ...state }
        if (task.liveCanvasSync !== false) {
          syncLiveCanvasRunState(task.target.hostId, id, state)
        }
      }
      applyRunStateToNodes(task.nodes, task.runStates)

      // 导演审核回标：把 PASS/FAIL 与原因写到审核节点和对应生成节点
      applyEpisodeReviewMarks(task.graph.nodes, (nodeId, params) => {
        const node = task.graph.nodes.find((n) => n.id === nodeId)
        if (node) node.params = { ...node.params, ...params } as GraphNodeParams
        if (task.liveCanvasSync !== false) {
          syncLiveCanvasNodeParams(task.target.hostId, nodeId, params)
        }
      })

      if (result.ok) {
        task.status = 'done'
        task.message = 'ok'
      } else {
        task.status = 'error'
        task.message = result.error ?? 'failed'
      }
      logBridge.endFromResult(result, { message: task.message })
      bump()
      await writeBack(task)
      moveToCompleted(task)
    } catch (error) {
      if (task.abort.signal.aborted) {
        task.status = 'stopped'
        task.message = 'GRAPH_CANCELLED'
        logBridge.endFromResult(null, { aborted: true })
      } else {
        task.status = 'error'
        task.message = error instanceof Error ? error.message : String(error)
        logBridge.endFromResult(null, { message: task.message })
      }
      for (const [id, st] of Object.entries(task.runStates)) {
        if (st?.status === 'pending' || st?.status === 'running') {
          const fallbackState: GraphNodeRunState = {
            status: 'error',
            error: task.message || 'GRAPH_CANCELLED'
          }
          task.runStates[id] = fallbackState
          if (task.liveCanvasSync !== false) {
            syncLiveCanvasRunState(task.target.hostId, id, fallbackState)
          }
        }
      }
      applyRunStateToNodes(task.nodes, task.runStates)
      bump()
      await writeBack(task)
      moveToCompleted(task)
    }
  }

  function clearForProjectSwitch(): void {
    for (const task of activeTasks.value) {
      task.discardWriteBack = true
      if (isActiveStatus(task.status)) {
        task.abort.abort()
        task.status = 'stopped'
        task.message = 'stopped'
      }
    }
    activeTasks.value = []
    completedTasks.value = []
    dialogOpen.value = false
    dialogAnchor.value = null
    bump()
  }

  return {
    tasks,
    completed,
    dialogOpen,
    dialogAnchor,
    runningCount,
    hasActiveTaskForTarget,
    getActiveTaskRunStatesForTarget,
    stopActiveTasksForTarget,
    openDialog,
    closeDialog,
    enqueueWorkflow,
    waitForTaskIds,
    getTaskRunSnapshot,
    runHostInnerGraph,
    removeTask,
    stopAndRemove,
    clearForProjectSwitch
  }
})
