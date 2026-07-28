import { computed, reactive, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import {
  cloneGraphDocument,
  collectUpstreamNodeIds,
  findAllOutputNodes,
  getNodeType,
  mapHostInnerStatesToOutputs,
  parseNarrativeUnitJson,
  resolveNodeType,
  runGraph,
  shotsToShotSplitRows,
  stringifyShotSplitRows,
  topologicalSort,
  type GraphAddScope,
  type GraphDocument,
  type GraphNode,
  type GraphNodeParams,
  type GraphNodeRunState,
  type GraphNodeRunStatus,
  type HostInnerGraphRunInput,
  type HostInnerGraphRunResult,
  type ShotCanvasGraphField
} from '@shared/graph'
import {
  isDraftAssetId,
  isDraftShotId,
  normalizeProjectStyleImages,
  resolveMediaOutputDir,
  shotScriptAssetId,
  type Shot
} from '@shared/domain'
import { assetMediaHostDirs } from '@shared/assetPackage/pathname'
import { persistAssetRecord } from '../composables/useAssetRecord'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { createGraphRunLogBridge } from '../features/graph/model/graphRunLogBridge'
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
  applyVisualGraphGenRefsToShot,
  collectScriptShotImages,
  collectScriptShotVideos,
  shotNeedsVideoCascade,
  shotNeedsVisualCascade
} from '../features/script/shotVisualPipeline'
import { applyShotSplitJson } from '../features/script/applyShotSplitOnOpen'
import {
  applyWorldCatalog,
  loadWorldCatalog
} from '../features/world/applyWorldCatalogOnOpen'
import { collectWorldElementOutputs } from '../features/world/worldElementPipeline'
import { collectNarrativeUnitTexts } from '../features/narrative/narrativeUnitPipeline'
import { loadNarrativeCatalog, applyNarrativeCatalog } from '../features/narrative/applyNarrativeCatalogOnOpen'
import {
  stringifyWorldElementCatalog,
  WORLD_ELEMENT_KINDS,
  collectImagesFromVisualGraph,
  collectTextFromNarrativeUnitGraph,
  getScopeHostIdSuffix,
  normalizeScopedGraph,
  readWorldElementGraphFromGenParams,
  readWorldElementIdFromNodeParams,
  readNarrativeUnitGraphFromGenParams,
  withWorldElementGraph,
  withNarrativeUnitGraph,
  type WorldElementKind
} from '@shared/graph'

export type GraphTaskStatus = 'pending' | 'running' | 'done' | 'error' | 'stopped'

export type GraphTaskTarget =
  | {
      kind: 'script-shot'
      scriptAssetId: string
      shotId: string
      scope: GraphAddScope
      canvasField: ShotCanvasGraphField
      hostId: string
    }
  | {
      kind: 'world-element'
      worldAssetId: string
      elementKind: WorldElementKind
      hostId: string
    }
  | {
      kind: 'narrative-unit'
      narrativeAssetId: string
      unitId: string
      hostId: string
    }
  | {
      kind: 'asset'
      assetId: string
      hostId: string
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

function buildOrder(graph: GraphDocument): string[] {
  const targets = findAllOutputNodes(graph)
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
  if (target.kind === 'asset') {
    return `asset:${target.assetId}`
  }
  if (target.kind === 'world-element') {
    return `world-element:${target.worldAssetId}:${target.elementKind}`
  }
  if (target.kind === 'narrative-unit') {
    return `narrative-unit:${target.narrativeAssetId}:${target.unitId}`
  }
  return `shot:${target.scriptAssetId}:${target.shotId}:${target.scope}:${target.canvasField}`
}

function isActiveStatus(status: GraphTaskStatus): boolean {
  return status === 'pending' || status === 'running'
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

function resolveShotForScript(shotId: string, scriptAssetId: string): Shot | null {
  const project = useProjectStore()
  const fromProject = project.shots.find((s) => s.id === shotId)
  if (fromProject) return fromProject
  if (isDraftAssetId(scriptAssetId)) {
    return useDraftStore().getDraft(scriptAssetId)?.shots?.find((s) => s.id === shotId) ?? null
  }
  return null
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
  return collectImagesFromVisualGraph(doc).length === 0
}

function narrativeUnitNeedsBatch(doc: GraphDocument, onlyMissing: boolean): boolean {
  if (!onlyMissing) return true
  const collected = collectTextFromNarrativeUnitGraph(doc)
  return !(collected?.text.trim() || collected?.relativePath?.trim())
}

function scriptShotHostId(scriptAssetId: string, scope: GraphAddScope): string {
  const base = `script:${scriptAssetId}`
  const suffix = getScopeHostIdSuffix(scope)
  return suffix ? `${base}:${suffix}` : base
}

function worldElementHostId(worldAssetId: string, elementKind: WorldElementKind): string {
  return `asset:${worldAssetId}:element:${elementKind}`
}

function narrativeUnitHostId(narrativeAssetId: string, unitId: string): string {
  return `asset:${narrativeAssetId}:unit:${unitId}`
}

function readNarrativeGenParams(narrativeAssetId: string): Record<string, unknown> {
  if (isDraftAssetId(narrativeAssetId)) {
    return { ...(useDraftStore().getDraft(narrativeAssetId)?.genParams ?? {}) }
  }
  const asset = useProjectStore().assets.find((a) => a.id === narrativeAssetId)
  return { ...((asset?.genParams as Record<string, unknown> | undefined) ?? {}) }
}

function taskHostAssetId(target: GraphTaskTarget): string {
  if (target.kind === 'asset') return target.assetId
  if (target.kind === 'world-element') return target.worldAssetId
  if (target.kind === 'narrative-unit') return target.narrativeAssetId
  return target.scriptAssetId
}

export const useGraphTaskStore = defineStore('graphTasks', () => {
  const activeTasks = ref<GraphTaskInternal[]>([])
  const completedTasks = ref<GraphTaskInternal[]>([])
  const dialogOpen = ref(false)
  const dialogAnchor = shallowRef<HTMLElement | null>(null)
  const tick = ref(0)

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
    return activeTasks.value.some((t) => taskTargetKey(t.target) === key)
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

    const { document: graph, materializedStates } = await prepareGraphDocumentForPersist(
      task.graph,
      task.runStates,
      {
    hostAssetId: taskHostAssetId(task.target)
      }
    )
    // 同步内存 runStates 为物化后版本，便于后续增量重跑 / 预览
    for (const key of Object.keys(task.runStates)) delete task.runStates[key]
    Object.assign(task.runStates, materializedStates)
    task.graph = graph

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

    if (task.target.kind === 'narrative-unit') {
      const { narrativeAssetId, unitId } = task.target
      const prevParams = readNarrativeGenParams(narrativeAssetId)
      await persistAssetRecord(narrativeAssetId, {
        genParams: withNarrativeUnitGraph(prevParams, unitId, toPlain(graph) as GraphDocument)
      })
      return
    }

    const { shotId, canvasField, scriptAssetId } = task.target
    const shot =
      project.shots.find((s) => s.id === shotId) ??
      (isDraftAssetId(scriptAssetId)
        ? useDraftStore().getDraft(scriptAssetId)?.shots?.find((s) => s.id === shotId)
        : null)
    if (!shot) return

    let next: Shot = {
      ...shot,
      canvas: {
        ...shot.canvas,
        [canvasField]: toPlain(graph)
      }
    }
    if (canvasField === 'visualGraphJson') {
      next = await applyVisualGraphGenRefsToShot(next, graph)
      next = {
        ...next,
        canvas: {
          ...next.canvas,
          visualGraphJson: toPlain(graph)
        }
      }
    }
    project.persistShotLocal(next)
    const ownerId = shotScriptAssetId(next)
    if (ownerId && isDraftAssetId(ownerId)) return
    if (isDraftShotId(next.id)) return
    await project.persistShot(next)
  }

  function enqueueWorkflow(input: {
    title: string
    graph: GraphDocument
    target: GraphTaskTarget
    priorNodeStates?: Record<string, GraphNodeRunState>
    skipCompletedNodes?: boolean
  }): EnqueueWorkflowResult {
    if (hasActiveTaskForTarget(input.target)) {
      return { ok: false, reason: 'duplicate' }
    }

    const graph = cloneGraphDocument(input.graph)
    const order = buildOrder(graph)
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
      skipCompletedNodes: input.skipCompletedNodes
    }) as GraphTaskInternal

    activeTasks.value = [task, ...activeTasks.value]
    bump()
    void runTask(task)
    return { ok: true, id }
  }

  function enqueueScriptShotBatch(input: {
    scriptAssetId: string
    shots: Shot[]
    kind: 'visual' | 'shotWorkflow'
    onlyMissing?: boolean
  }): EnqueueBatchResult {
    const onlyMissing = input.onlyMissing !== false
    const scope: GraphAddScope = input.kind === 'visual' ? 'visual' : 'shotWorkflow'
    const canvasField: ShotCanvasGraphField =
      input.kind === 'visual' ? 'visualGraphJson' : 'graphJson'
    const hostId = scriptShotHostId(input.scriptAssetId, scope)
    let enqueued = 0
    let skipped = 0
    let duplicates = 0
    const taskIds: string[] = []

    for (const shot of input.shots) {
      const live = resolveShotForScript(shot.id, input.scriptAssetId) ?? shot
      const needs =
        input.kind === 'visual' ? shotNeedsVisualCascade(live) : shotNeedsVideoCascade(live)
      if (onlyMissing && !needs) {
        skipped += 1
        continue
      }
      const raw =
        input.kind === 'visual' ? live.canvas.visualGraphJson : live.canvas.graphJson
      const graph = normalizeScopedGraph(scope, raw ?? null)
      const result = enqueueWorkflow({
        title: live.title?.trim() || shot.id,
        graph,
        target: {
          kind: 'script-shot',
          scriptAssetId: input.scriptAssetId,
          shotId: live.id,
          scope,
          canvasField,
          hostId
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
        assetType: 'world'
      })
      if (!worldKindNeedsBatch(graph, onlyMissing)) {
        skipped += 1
        continue
      }
      const result = enqueueWorkflow({
        title: elementKind,
        graph,
        target: {
          kind: 'world-element',
          worldAssetId: input.worldAssetId,
          elementKind,
          hostId: worldElementHostId(input.worldAssetId, elementKind)
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

  function enqueueNarrativeUnitBatch(input: {
    narrativeAssetId: string
    onlyMissing?: boolean
  }): EnqueueBatchResult {
    const onlyMissing = input.onlyMissing !== false
    const rows = loadNarrativeCatalog(input.narrativeAssetId)
    const genParams = readNarrativeGenParams(input.narrativeAssetId)
    let enqueued = 0
    let skipped = 0
    let duplicates = 0
    const taskIds: string[] = []

    for (const row of rows) {
      const raw = readNarrativeUnitGraphFromGenParams(genParams, row.id)
      const graph = normalizeScopedGraph('narrativeUnit', raw ?? null, {
        assetType: 'narrative'
      })
      if (!narrativeUnitNeedsBatch(graph, onlyMissing)) {
        skipped += 1
        continue
      }
      const result = enqueueWorkflow({
        title: row.title?.trim() || row.id,
        graph,
        target: {
          kind: 'narrative-unit',
          narrativeAssetId: input.narrativeAssetId,
          unitId: row.id,
          hostId: narrativeUnitHostId(input.narrativeAssetId, row.id)
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

  async function waitForTaskIds(taskIds: string[]): Promise<void> {
    if (!taskIds.length) return
    const pending = new Set(taskIds)
    await new Promise<void>((resolve) => {
      const tick = (): void => {
        for (const id of [...pending]) {
          const stillActive = activeTasks.value.some(
            (t) => t.id === id && isActiveStatus(t.status)
          )
          if (!stillActive) pending.delete(id)
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
      hostId: `asset:${assetId}`
    }
    const targetKey = taskTargetKey(target)

    const existing = activeTasks.value.find(
      (t) => isActiveStatus(t.status) && taskTargetKey(t.target) === targetKey
    )
    let taskId = existing?.id

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
        skipCompletedNodes: true
      })
      if (enqueued.ok) {
        taskId = enqueued.id
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
    const outputs = mapHostInnerStatesToOutputs(
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
      const result = await runGraph(task.graph, {
        signal: task.abort.signal,
        stepDelayMs: 100,
        skipCompletedNodes: task.skipCompletedNodes === true,
        priorNodeStates: task.priorNodeStates,
        targetNodeIds: findAllOutputNodes(task.graph).map((n) => n.id),
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
            inputReferenceCount: input.inputReferences?.length || undefined
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
              hostRelativePath: dirs.hostRelativePath,
              hostFolderDir: dirs.hostFolderDir,
              hostAssetName: dirs.hostAssetName,
              kind: 'video'
            })
            const value = await window.studio.generateVideo({ ...input, outputDir })
            await project.scheduleRefreshLibrary()
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
              hostRelativePath: dirs.hostRelativePath,
              hostFolderDir: dirs.hostFolderDir,
              hostAssetName: dirs.hostAssetName,
              kind: 'voice'
            })
            const value = await window.studio.generateSpeech({ ...input, outputDir })
            await project.refreshAssets()
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
        resolveAssetGenParams: (assetId) => {
          const project = useProjectStore()
          return project.assets.find((asset) => asset.id === assetId)?.genParams as
            | Record<string, unknown>
            | undefined
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
        collectNarrativeUnitTexts: async (signal) => {
          if (task.target.kind !== 'asset') return null
          const narrativeId = task.target.assetId
          if (isDraftAssetId(narrativeId)) {
            const draft = useDraftStore().getDraft(narrativeId)
            if (draft?.type !== 'narrative') return null
            const batch = enqueueNarrativeUnitBatch({
              narrativeAssetId: narrativeId,
              onlyMissing: true
            })
            await waitForTaskIds(batch.taskIds)
            return collectNarrativeUnitTexts({ narrativeAssetId: narrativeId, signal })
          }
          const project = useProjectStore()
          const asset = project.assets.find((a) => a.id === narrativeId)
          if (asset?.type !== 'narrative') return null
          const batch = enqueueNarrativeUnitBatch({
            narrativeAssetId: narrativeId,
            onlyMissing: true
          })
          await waitForTaskIds(batch.taskIds)
          return collectNarrativeUnitTexts({ narrativeAssetId: narrativeId, signal })
        },
        resolveNarrativeUnit: (unitId) => {
          const id = unitId.trim()
          if (!id) return null
          if (task.target.kind === 'asset') {
            const assetId = task.target.assetId
            const project = useProjectStore()
            const asset = project.assets.find((a) => a.id === assetId)
            const draft = useDraftStore().getDraft(assetId)
            const type = draft?.type ?? asset?.type
            if (type === 'narrative') {
              return loadNarrativeCatalog(assetId).find((row) => row.id === id) ?? null
            }
          }
          return null
        },
        resolveShotSplitTableJson: () => {
          if (task.target.kind !== 'asset') return null
          const scriptId = task.target.assetId
          const project = useProjectStore()
          const draft = useDraftStore().getDraft(scriptId)
          if ((draft?.type ?? project.assets.find((a) => a.id === scriptId)?.type) !== 'script') {
            return null
          }
          const shots =
            draft?.shots ??
            project.shots.filter((s) => shotScriptAssetId(s) === scriptId)
          if (!shots.length) return null
          return stringifyShotSplitRows(shotsToShotSplitRows(shots))
        },
        importShotSplitTableJson: async (jsonText) => {
          if (task.target.kind !== 'asset') return
          const scriptId = task.target.assetId
          const project = useProjectStore()
          const draft = useDraftStore().getDraft(scriptId)
          if ((draft?.type ?? project.assets.find((a) => a.id === scriptId)?.type) !== 'script') {
            return
          }
          await applyShotSplitJson(scriptId, jsonText)
        },
        collectScriptShotImages: async (signal) => {
          if (task.target.kind !== 'asset') return null
          const scriptId = task.target.assetId
          const project = useProjectStore()
          const draft = useDraftStore().getDraft(scriptId)
          if ((draft?.type ?? project.assets.find((a) => a.id === scriptId)?.type) !== 'script') {
            return null
          }
          const shots =
            draft?.shots ??
            project.shots.filter((s) => shotScriptAssetId(s) === scriptId)
          if (!shots.length) return { images: [], aggregateJson: '[]\n', entities: [] }
          const batch = enqueueScriptShotBatch({
            scriptAssetId: scriptId,
            shots,
            kind: 'visual',
            onlyMissing: true
          })
          await waitForTaskIds(batch.taskIds)
          return collectScriptShotImages({ scriptAssetId: scriptId, shots, signal })
        },
        collectScriptShotVideos: async (signal) => {
          if (task.target.kind !== 'asset') return null
          const scriptId = task.target.assetId
          const project = useProjectStore()
          const draft = useDraftStore().getDraft(scriptId)
          if ((draft?.type ?? project.assets.find((a) => a.id === scriptId)?.type) !== 'script') {
            return null
          }
          const shots =
            draft?.shots ??
            project.shots.filter((s) => shotScriptAssetId(s) === scriptId)
          if (!shots.length) return { videos: [], entities: [] }
          const batch = enqueueScriptShotBatch({
            scriptAssetId: scriptId,
            shots,
            kind: 'shotWorkflow',
            onlyMissing: true
          })
          await waitForTaskIds(batch.taskIds)
          return collectScriptShotVideos({ scriptAssetId: scriptId, shots, signal })
        },
        resolveNarrativeCatalogJson: () => {
          if (task.target.kind !== 'asset') return null
          const narrativeId = task.target.assetId
          const rows = loadNarrativeCatalog(narrativeId)
          if (!rows.length) return null
          return JSON.stringify(rows)
        },
        importNarrativeCatalogJson: async (jsonText) => {
          if (task.target.kind !== 'asset') return
          await applyNarrativeCatalog(task.target.assetId, jsonText)
        },
        collectWorldElementOutputs: async (signal) => {
          if (task.target.kind !== 'asset') return null
          const worldId = task.target.assetId
          if (isDraftAssetId(worldId)) {
            const draft = useDraftStore().getDraft(worldId)
            if (draft?.type !== 'world') return null
            const batch = enqueueWorldElementBatch({ worldAssetId: worldId, onlyMissing: true })
            await waitForTaskIds(batch.taskIds)
            return collectWorldElementOutputs({ worldAssetId: worldId, signal })
          }
          const project = useProjectStore()
          const asset = project.assets.find((a) => a.id === worldId)
          if (asset?.type !== 'world') return null
          const batch = enqueueWorldElementBatch({ worldAssetId: worldId, onlyMissing: true })
          await waitForTaskIds(batch.taskIds)
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
    enqueueScriptShotBatch,
    enqueueWorldElementBatch,
    enqueueNarrativeUnitBatch,
    waitForTaskIds,
    runHostInnerGraph,
    removeTask,
    stopAndRemove,
    clearForProjectSwitch
  }
})
