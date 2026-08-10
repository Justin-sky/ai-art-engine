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
  topologicalSort,
  type GraphDocument,
  type GraphNode,
  type GraphNodeParams,
  type GraphNodeRunState,
  type GraphNodeRunStatus,
  type HostInnerGraphRunInput,
  type HostInnerGraphRunResult
} from '@shared/graph'
import {
  isDraftAssetId,
  normalizeProjectStyleImages,
  resolveMediaOutputDir
} from '@shared/domain'
import { assetMediaHostDirs } from '@shared/assetPackage/pathname'
import { persistAssetRecord } from '../composables/useAssetRecord'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { liftHostOutputsFromInnerGraph } from '../features/graph/model/liftHostOutputsFromInner'
import { createGraphRunLogBridge } from '../features/graph/model/graphRunLogBridge'
import {
  readEpisodeAgentState,
  writeEpisodeAgentState
} from '../features/graph/episodeAgentStateIO'
import { resolveImageGenerateCapabilitiesForRun } from '../features/graph/model/imageGenerateCapabilities'
import { resolveVideoGenerateCapabilitiesForRun } from '../features/graph/model/videoGenerateCapabilities'
import {
  resolveAssetImageUrl,
  resolveAssetMediaDataUrl,
  resolveGraphImageUrls
} from '../features/graph/model/resolveGraphImageUrls'
import { resolveAssetText } from '../features/media/resolveAssetText'
import { enrichStyleImagesWithLibraryPrompts } from '../features/stylePresets/defaultLibrary'
import { resolveStyleImageUrls } from '../features/stylePresets/resolveStyleImageUrls'
import i18n from '../i18n'
import { composeImageExpandCanvas } from '../features/graph/model/composeImageExpandCanvas'
import { composeImageRedrawCanvas } from '../features/graph/model/composeImageRedrawCanvas'
import { composeImageCropCanvas } from '../features/graph/model/composeImageCropCanvas'
import { composeImageGridCell } from '../features/graph/model/composeImageGridCell'
import { normalizeImageAspectRatio } from '../features/graph/model/normalizeImageAspectRatio'
import {
  prepareGraphDocumentForPersist
} from '../features/graph/persistGraphRunOutputs'
import { saveGraphRunMediaForNode } from '../features/graph/saveGraphRunMediaForNode'
import { saveGraphRunTextForNode } from '../features/graph/saveGraphRunTextForNode'
import { readGraphRunText } from '../features/graph/readGraphRunText'
import { useDraftStore } from './drafts'
import { useProjectStore } from './project'
import { toPlain } from '../utils/toPlain'
import {
  applyWorldCatalog,
  loadWorldCatalog
} from '../features/world/applyWorldCatalogOnOpen'
import { collectWorldElementOutputs } from '../features/world/worldElementPipeline'
import { collectBeatUnitTexts } from '../features/beat/beatPipeline'
import { loadBeatCatalog, applyBeatCatalog } from '../features/beat/applyBeatCatalogOnOpen'
import {
  stringifyWorldElementCatalog,
  WORLD_ELEMENT_KINDS,
  collectTextFromBeatGraph,
  listVisualOutputNodeIdsNeedingCook,
  normalizeScopedGraph,
  readWorldElementGraphFromGenParams,
  readWorldElementIdFromNodeParams,
  inferElementWorkflowHostInterface,
  readBeatGraphFromGenParams,
  withWorldElementGraph,
  withBeatGraph,
  type WorldElementKind
} from '@shared/graph'

export type GraphTaskStatus = 'pending' | 'running' | 'done' | 'error' | 'stopped'

export type GraphTaskTarget =
  | {
      kind: 'world-element'
      worldAssetId: string
      elementKind: WorldElementKind
      hostId: string
    }
  | {
      kind: 'beat-unit'
      beatAssetId: string
      beatId: string
      hostId: string
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
}

function nodeIcon(node: GraphNode): string {
  const def = resolveNodeType(node) ?? (node.typeId ? getNodeType(node.typeId) : undefined)
  return def?.icon ?? '◆'
}

function nodeTitle(node: GraphNode): string {
  const custom = node.title?.trim()
  if (custom) return custom
  const def = resolveNodeType(node) ?? (node.typeId ? getNodeType(node.typeId) : undefined)
  return def?.label ?? node.typeId ?? node.id
}

function resolveTaskTargets(graph: GraphDocument, targetNodeIds?: string[]): GraphNode[] {
  const explicit =
    targetNodeIds
      ?.map((id) => graph.nodes.find((node) => node.id === id))
      .filter((node): node is GraphNode => !!node) ?? []
  return explicit.length ? explicit : findAllOutputNodes(graph)
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
      return `world-element:${target.worldAssetId}:${target.elementKind}`
    case 'beat-unit':
      return `beat-unit:${target.beatAssetId}:${target.beatId}`
  }
}

/**
 * 写回互斥键：可并行烹调的子目标若共用同一 genParams 袋，必须串行写盘，
 * 否则后完成者用旧快照 merge 会冲掉先完成 kind/unit 的 runStates。
 * （与 taskTargetKey 分离：任务冲突仍按细粒度目标判断。）
 */
export function writeBackExclusiveKey(target: GraphTaskTarget): string {
  if (target.kind === 'world-element') {
    return `world-element:${target.worldAssetId}`
  }
  if (target.kind === 'beat-unit') {
    return `beat-unit:${target.beatAssetId}`
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
    const raw = readWorldElementGraphFromGenParams(
      readWorldGenParams(target.worldAssetId),
      target.elementKind
    )
    return asGraphDocument(raw)
  }
  if (target.kind === 'beat-unit') {
    const raw = readBeatGraphFromGenParams(
      readBeatGenParams(target.beatAssetId),
      target.beatId
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

export type EnqueueWorkflowResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'duplicate' }

export type EnqueueBatchResult = {
  enqueued: number
  skipped: number
  duplicates: number
  taskIds: string[]
}

function readWorldGenParams(worldAssetId: string): Record<string, unknown> {
  if (isDraftAssetId(worldAssetId)) {
    return { ...(useDraftStore().getDraft(worldAssetId)?.genParams ?? {}) }
  }
  const asset = useProjectStore().assets.find((a) => a.id === worldAssetId)
  return { ...((asset?.genParams as Record<string, unknown> | undefined) ?? {}) }
}

function worldKindNeedsBatch(doc: GraphDocument, onlyMissing: boolean): boolean {
  const hasElements = doc.nodes.some((node) => !!readWorldElementIdFromNodeParams(node.params))
  if (!hasElements) return false
  if (!onlyMissing) return true
  // 缺图补跑；有图但未锁定则重新 cook；锁定有图跳过
  return listVisualOutputNodeIdsNeedingCook(doc).length > 0
}

function beatUnitNeedsBatch(doc: GraphDocument, onlyMissing: boolean): boolean {
  if (!onlyMissing) return true
  const collected = collectTextFromBeatGraph(doc)
  return !(collected?.text.trim() || collected?.relativePath?.trim())
}

function worldElementHostId(worldAssetId: string, elementKind: WorldElementKind): string {
  return `asset:${worldAssetId}:element:${elementKind}`
}

function beatUnitHostId(beatAssetId: string, beatId: string): string {
  return `asset:${beatAssetId}:unit:${beatId}`
}

function readBeatGenParams(beatAssetId: string): Record<string, unknown> {
  if (isDraftAssetId(beatAssetId)) {
    return { ...(useDraftStore().getDraft(beatAssetId)?.genParams ?? {}) }
  }
  const asset = useProjectStore().assets.find((a) => a.id === beatAssetId)
  return { ...((asset?.genParams as Record<string, unknown> | undefined) ?? {}) }
}

function taskHostAssetId(target: GraphTaskTarget): string {
  switch (target.kind) {
    case 'asset':
      return target.assetId
    case 'world-element':
      return target.worldAssetId
    case 'beat-unit':
      return target.beatAssetId
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

  async function runWriteBackExclusive(targetKey: string, work: () => Promise<void>): Promise<void> {
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
    dialogAnchor.value =
      anchor ?? document.querySelector<HTMLElement>('[data-graph-task-anchor]')
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
          task.runStates[node.nodeId] = { status: 'error', error: 'GRAPH_CANCELLED' }
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
        task.runStates,
        {
          hostAssetId: taskHostAssetId(task.target)
        }
      )
      // 同步内存 runStates 为物化后版本，便于后续增量重跑 / 预览
      for (const key of Object.keys(task.runStates)) delete task.runStates[key]
      Object.assign(task.runStates, materializedStates)
      task.graph = prepared

      const isSubset = !!task.targetNodeIds?.length
      const graph = isSubset
        ? mergeSubsetGraphIntoBase(
            cloneGraphDocument(
              graphEditorHosts.getDocument(task.target.hostId) ??
                readPersistedGraphForTarget(task.target) ??
                prepared
            ),
            prepared,
            task.order,
            materializedStates
          )
        : prepared

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
        const { worldAssetId, elementKind } = task.target
        const prevParams = readWorldGenParams(worldAssetId)
        await persistAssetRecord(worldAssetId, {
          genParams: withWorldElementGraph(prevParams, elementKind, toPlain(graph) as GraphDocument)
        })
        return
      }

      if (task.target.kind === 'beat-unit') {
        const { beatAssetId, beatId } = task.target
        const prevParams = readBeatGenParams(beatAssetId)
        await persistAssetRecord(beatAssetId, {
          genParams: withBeatGraph(prevParams, beatId, toPlain(graph) as GraphDocument)
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
      invalidatedNodeIds: input.invalidatedNodeIds
    }) as GraphTaskInternal

    activeTasks.value = [task, ...activeTasks.value]
    bump()
    void runTask(task)
    return { ok: true, id }
  }

  function enqueueWorldElementBatch(input: {
    worldAssetId: string
    onlyMissing?: boolean
  }): EnqueueBatchResult {
    const onlyMissing = input.onlyMissing !== false
    const genParams = readWorldGenParams(input.worldAssetId)
    let enqueued = 0
    let skipped = 0
    let duplicates = 0
    const taskIds: string[] = []

    for (const elementKind of WORLD_ELEMENT_KINDS) {
      const raw = readWorldElementGraphFromGenParams(genParams, elementKind)
      const graph = normalizeScopedGraph('elementWorkflow', raw ?? null, {
        assetType: 'world',
        hostInterface: inferElementWorkflowHostInterface(raw)
      })
      if (!worldKindNeedsBatch(graph, onlyMissing)) {
        skipped += 1
        continue
      }
      const cookIds = listVisualOutputNodeIdsNeedingCook(graph)
      const priorNodeStates = graph.runStates
        ? ({ ...graph.runStates } as Record<string, GraphNodeRunState>)
        : undefined
      const result = enqueueWorkflow({
        title: elementKind,
        graph,
        target: {
          kind: 'world-element',
          worldAssetId: input.worldAssetId,
          elementKind,
          hostId: worldElementHostId(input.worldAssetId, elementKind)
        },
        // 缺图补跑 + 未锁定有图重烹；锁定有图不入队，collect 时 soft 进实体列表
        // skipCompletedNodes=false：未锁定节点即使 prior=done 也要重新 cook
        targetNodeIds: onlyMissing && cookIds.length ? cookIds : undefined,
        priorNodeStates,
        skipCompletedNodes: false
      })
      if (result.ok) {
        enqueued += 1
        taskIds.push(result.id)
      } else {
        duplicates += 1
      }
    }

    return { enqueued, skipped, duplicates, taskIds }
  }

  function enqueueBeatUnitBatch(input: {
    beatAssetId: string
    onlyMissing?: boolean
  }): EnqueueBatchResult {
    const onlyMissing = input.onlyMissing !== false
    const rows = loadBeatCatalog(input.beatAssetId)
    const genParams = readBeatGenParams(input.beatAssetId)
    let enqueued = 0
    let skipped = 0
    let duplicates = 0
    const taskIds: string[] = []

    for (const row of rows) {
      const raw = readBeatGraphFromGenParams(genParams, row.id)
      const graph = normalizeScopedGraph('beatUnit', raw ?? null, {
        assetType: 'beat'
      })
      if (!beatUnitNeedsBatch(graph, onlyMissing)) {
        skipped += 1
        continue
      }
      const result = enqueueWorkflow({
        title: row.title?.trim() || row.id,
        graph,
        target: {
          kind: 'beat-unit',
          beatAssetId: input.beatAssetId,
          beatId: row.id,
          hostId: beatUnitHostId(input.beatAssetId, row.id)
        }
      })
      if (result.ok) {
        enqueued += 1
        taskIds.push(result.id)
      } else {
        duplicates += 1
      }
    }

    return { enqueued, skipped, duplicates, taskIds }
  }

  /**
   * 等到任务离开 active 列表（writeBack + moveToCompleted 之后）。
   * 不能仅看 status===done：status 会在 writeBack 之前就置 done，过早返回会导致
   * collectWorldElementOutputs 读到旧 worldElementGraphs 并回写冲掉刚烹好的结果。
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
      ) ??
      mapHostInnerStatesToOutputs(
        done.runStates,
        done.graph,
        input.hostNode.assetType ?? ''
      )
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
      startMessage: 'task'
    })
    try {
      await waitForOlderSharedUpstreamPeers(task)
      if (task.abort.signal.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }
      if (task.skipCompletedNodes === true) {
        task.priorNodeStates = collectMergedDonePriors(task)
      }
      if (task.message === 'waiting_shared_upstream') {
        task.message = ''
        bump()
      }
      const result = await runGraph(task.graph, {
        signal: task.abort.signal,
        stepDelayMs: 100,
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
          }
          task.runStates[nodeId] = { ...state }
          applyRunStateToNodes(task.nodes, task.runStates)
          bump()
        },
        onNodePatch: (nodeId, patch) => {
          if (task.abort.signal.aborted) return
          const node = task.graph.nodes.find((n) => n.id === nodeId)
          if (!node) return
          if (patch.params) {
            node.params = { ...node.params, ...patch.params } as GraphNodeParams
          }
          if (patch.title !== undefined) node.title = patch.title
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
            imageCount: input.images?.length || undefined
          }
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
            seed: input.seed,
            inputReferenceCount: input.inputReferences?.length || undefined,
            inputReferences: input.inputReferenceMeta
          }
          try {
            const value = await window.studio.generateImage(input)
            logBridge.recordApiCall({
              kind: 'generateImage',
              request,
              response: { model: value.model, imageCount: value.images?.length ?? 0 },
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
            seed?: number
            inputReferenceCount?: number
            tosUploads?: Array<{
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
            seed: input.seed,
            inputReferenceCount: input.inputReferences?.length || undefined
          }
          try {
            const project = useProjectStore()
            const hostAssetId = taskHostAssetId(task.target)
            const hostAsset = hostAssetId
              ? project.assets.find((a) => a.id === hostAssetId)
              : null
            const dirs = assetMediaHostDirs(hostAsset, project.folders)
            const outputDir = resolveMediaOutputDir({
              mediaOutputDir: input.outputDir,
              cacheOutputDir: project.config?.cacheOutputDir,
              hostRelativePath: dirs.hostRelativePath,
              hostFolderDir: dirs.hostFolderDir,
              hostAssetName: dirs.hostAssetName,
              kind: 'video'
            })
            const value = await window.studio.generateVideo({ ...input, outputDir })
            if (outputDir === 'Assets' || outputDir.startsWith('Assets/')) {
              await project.scheduleRefreshLibrary()
            }
            if (value.tosUploads?.length) {
              request.tosUploads = value.tosUploads.map((item) => ({
                sourceLabel: item.sourceLabel,
                objectKey: item.objectKey,
                bytes: item.bytes,
                urlPreview: item.url.slice(0, 120)
              }))
              for (const item of value.tosUploads) {
                for (const log of item.logs) {
                  logBridge.appendMessage(`[TOS] ${log.message}`, log.level)
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
            imageCount: input.images?.length
          }
          try {
            const project = useProjectStore()
            const hostAssetId = taskHostAssetId(task.target)
            const hostAsset = hostAssetId
              ? project.assets.find((a) => a.id === hostAssetId)
              : null
            const dirs = assetMediaHostDirs(hostAsset, project.folders)
            const outputDir = resolveMediaOutputDir({
              mediaOutputDir: input.outputDir,
              cacheOutputDir: project.config?.cacheOutputDir,
              hostRelativePath: dirs.hostRelativePath,
              hostFolderDir: dirs.hostFolderDir,
              hostAssetName: dirs.hostAssetName,
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
        resolveLiveAssetGraph: (assetId) =>
          graphEditorHosts.getLiveAssetDocument(assetId) ?? undefined,
        resolveAssetGenParams: (assetId) => {
          const live = graphEditorHosts.getLiveAssetDocument(assetId)
          const project = useProjectStore()
          const base = isDraftAssetId(assetId)
            ? (useDraftStore().getDraft(assetId)?.genParams as Record<string, unknown> | undefined)
            : (project.assets.find((asset) => asset.id === assetId)?.genParams as
                | Record<string, unknown>
                | undefined)
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
        resolveAssetText,
        resolveImageUrls: resolveGraphImageUrls,
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
        composeImageExpandCanvas,
        composeImageRedrawCanvas,
        composeImageCropCanvas,
        composeImageGridCell,
        normalizeImageAspectRatio,
        resolveWorldCatalogJson: () => {
          if (task.target.kind !== 'asset') return null
          const worldId = task.target.assetId
          if (isDraftAssetId(worldId)) {
            const draft = useDraftStore().getDraft(worldId)
            if (draft?.type !== 'world') return null
          } else {
            const project = useProjectStore()
            const asset = project.assets.find((a) => a.id === worldId)
            if (asset?.type !== 'world') return null
          }
          const catalog = loadWorldCatalog(worldId)
          const total = WORLD_ELEMENT_KINDS.reduce((sum, kind) => sum + catalog[kind].length, 0)
          if (!total) return null
          return stringifyWorldElementCatalog(catalog)
        },
        importWorldCatalogJson: async (jsonText) => {
          if (task.target.kind !== 'asset') return
          const worldId = task.target.assetId
          if (isDraftAssetId(worldId)) {
            const draft = useDraftStore().getDraft(worldId)
            if (draft?.type !== 'world') return
          } else {
            const project = useProjectStore()
            const asset = project.assets.find((a) => a.id === worldId)
            if (asset?.type !== 'world') return
          }
          await applyWorldCatalog(worldId, jsonText)
        },
        collectBeatUnitTexts: async (signal) => {
          if (task.target.kind !== 'asset') return null
          const beatId = task.target.assetId
          if (isDraftAssetId(beatId)) {
            const draft = useDraftStore().getDraft(beatId)
            if (draft?.type !== 'beat') return null
            const batch = enqueueBeatUnitBatch({
              beatAssetId: beatId,
              onlyMissing: true
            })
            await waitForTaskIds(batch.taskIds)
            return collectBeatUnitTexts({ beatAssetId: beatId, signal })
          }
          const project = useProjectStore()
          const asset = project.assets.find((a) => a.id === beatId)
          if (asset?.type !== 'beat') return null
          const batch = enqueueBeatUnitBatch({
            beatAssetId: beatId,
            onlyMissing: true
          })
          await waitForTaskIds(batch.taskIds)
          return collectBeatUnitTexts({ beatAssetId: beatId, signal })
        },
        resolveBeatUnit: (beatId) => {
          const id = beatId.trim()
          if (!id) return null
          if (task.target.kind === 'asset') {
            const assetId = task.target.assetId
            const project = useProjectStore()
            const asset = project.assets.find((a) => a.id === assetId)
            const draft = useDraftStore().getDraft(assetId)
            const type = draft?.type ?? asset?.type
            if (type === 'beat') {
              return loadBeatCatalog(assetId).find((row) => row.id === id) ?? null
            }
          }
          return null
        },
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
        collectWorldElementOutputs: async (signal, options) => {
          if (task.target.kind !== 'asset') return null
          const worldId = task.target.assetId
          if (isDraftAssetId(worldId)) {
            const draft = useDraftStore().getDraft(worldId)
            if (draft?.type !== 'world') return null
            // Cook / 整链：缺图补跑后再收集；执行当前只收集已有结果
            if (options?.cookBatch) {
              const batch = enqueueWorldElementBatch({ worldAssetId: worldId, onlyMissing: true })
              await waitForTaskIds(batch.taskIds)
            }
            return collectWorldElementOutputs({ worldAssetId: worldId, signal })
          }
          const project = useProjectStore()
          const asset = project.assets.find((a) => a.id === worldId)
          if (asset?.type !== 'world') return null
          if (options?.cookBatch) {
            const batch = enqueueWorldElementBatch({ worldAssetId: worldId, onlyMissing: true })
            await waitForTaskIds(batch.taskIds)
          }
          return collectWorldElementOutputs({ worldAssetId: worldId, signal })
        },
        runHostInnerGraph
      })

      if (task.abort.signal.aborted || result.error === 'GRAPH_CANCELLED') {
        task.status = 'stopped'
        task.message = 'GRAPH_CANCELLED'
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
      }
      applyRunStateToNodes(task.nodes, task.runStates)

      // 导演审核回标：把 PASS/FAIL 与原因写到审核节点和对应生成节点
      applyEpisodeReviewMarks(task.graph.nodes, (nodeId, params) => {
        const node = task.graph.nodes.find((n) => n.id === nodeId)
        if (node) node.params = { ...node.params, ...params } as GraphNodeParams
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
    openDialog,
    closeDialog,
    enqueueWorkflow,
    enqueueWorldElementBatch,
    enqueueBeatUnitBatch,
    waitForTaskIds,
    runHostInnerGraph,
    removeTask,
    stopAndRemove,
    clearForProjectSwitch
  }
})
