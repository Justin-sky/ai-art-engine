import type { GraphDocument, McpGraphEditOp as GraphEditOp } from '@shared/graph'
import {
  applyGraphEditOps,
  autoLayoutNodes,
  collectRunMediaPaths,
  ensureBoundaryProxyNodes,
  inferHostInterfaceFromGraph
} from '@shared/graph'
import { normalizeProjectStyleImages } from '@shared/domain'
import type { McpGraphEditPayload, McpGraphIconRefinePayload, McpTaskRunPayload } from '@shared/ipc'
import {
  applySemanticEdit,
  migrateSemanticTimeline,
  type SemanticEditInput,
  type SemanticTimeline
} from '@shared/semanticTimeline'
import { resolveActiveWorkspaceTargets } from '../../editor/control/surfaceRegistry'
import { useEditorKernel } from '../../editor/kernel'
import { useGraphTaskStore } from '../../stores/graphTasks'
import { useProjectStore } from '../../stores/project'
import { useWorkspaceStore } from '../../stores/workspace'
import { persistAssetRecord } from '../../composables/useAssetRecord'
import { executeDirectorStageEdit } from '../director/mcpDirectorStageOps'
import { IconRefineError, runIconRefine } from '../graph/model/runIconRefine'
import { graphEditorHosts } from '../graph/model/graphEditorHosts'
import { semanticTimelineSavePayload } from '../graph/model/semanticTimelineSave'
import { isGraphEditorOpen } from './openGraphEditors'
import { clearLiveCanvasRunStates, openMcpWorkflowAssetEditor } from './mcpGraphLiveCanvas'
import { emitGraphDiffVfx } from '../../graph/vfx/graphVfxEngine'

const GRAPH_EDITOR_OPEN_WAIT_MS = 8_000
const GRAPH_EDITOR_OPEN_POLL_MS = 50

/** 记录最近一次通过 graph_edit 触达的画布资产与节点 id，供紧随其后的 task_run 精准执行 */
let lastEditedAssetId = ''
const lastEditedNodeIdsByAsset = new Map<string, string[]>()
const handledMcpTaskIds = new Set<string>()
const handledGraphEditRequestIds = new Set<string>()

function collectDownstreamAndTargetIds(
  graph: GraphDocument,
  seedIds: string[]
): { targetNodeIds: string[]; invalidatedNodeIds: string[] } {
  const validSeeds = seedIds.filter((id) => graph.nodes.some((n) => n.id === id && !n.locked))
  if (!validSeeds.length) return { targetNodeIds: [], invalidatedNodeIds: [] }
  const reachable = new Set<string>()
  const queue = [...validSeeds]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (reachable.has(id)) continue
    reachable.add(id)
    for (const edge of graph.edges) {
      if (edge.source === id && edge.target !== id && !reachable.has(edge.target)) {
        queue.push(edge.target)
      }
    }
  }
  const hasOutgoingInReachable = new Set<string>()
  for (const edge of graph.edges) {
    if (edge.source !== edge.target && reachable.has(edge.source) && reachable.has(edge.target)) {
      hasOutgoingInReachable.add(edge.source)
    }
  }
  const terminalIds = [...reachable].filter((id) => !hasOutgoingInReachable.has(id))
  return {
    targetNodeIds: terminalIds.length ? terminalIds : validSeeds,
    invalidatedNodeIds: [...reachable]
  }
}

async function waitForGraphEditorOpen(assetId: string): Promise<boolean> {
  for (let elapsed = 0; elapsed < GRAPH_EDITOR_OPEN_WAIT_MS; elapsed += GRAPH_EDITOR_OPEN_POLL_MS) {
    if (isGraphEditorOpen(assetId) && graphEditorHosts.getLiveAssetDocument(assetId)) return true
    await new Promise<void>((resolve) => window.setTimeout(resolve, GRAPH_EDITOR_OPEN_POLL_MS))
  }
  return isGraphEditorOpen(assetId) && !!graphEditorHosts.getLiveAssetDocument(assetId)
}

/**
 * MCP task_run 的渲染层执行入口：
 * 主进程经 broadcast 派发「运行宿主资产工作流 / 画布节点」，优先读取打开画布的实时文档，
 * 交任务 store 按拓扑序执行并实时同步画布节点状态与预览，
 * 受理与终态经 reportMcpTask 回报主进程（供 MCP task_run / task_status 消费）。
 */

type ReportPhase = 'accepted' | 'finished' | 'failed'

function report(
  mcpTaskId: string,
  phase: ReportPhase,
  extra: {
    taskId?: string
    status?: 'done' | 'error' | 'stopped'
    error?: string
    /** 本轮产出的媒体相对路径（作品级优先）：主进程据此把活动收尾成可预览产物 */
    relativePaths?: string[]
  } = {}
): void {
  void window.studio?.reportMcpTask?.({ mcpTaskId, phase, ...extra })
}

/** 终态后等写回落盘的时长上限：产物 dataUrl 物化成相对路径后路径才齐全 */
const MEDIA_COLLECT_WRITE_BACK_TIMEOUT_MS = 30_000

/** 终态任务的本轮产物路径：先等写回完成，超时则按当前状态尽力收集 */
async function collectFinishedTaskMediaPaths(
  taskStore: ReturnType<typeof useGraphTaskStore>,
  taskId: string,
  preferredNodeIds?: string[]
): Promise<string[]> {
  await Promise.race([
    taskStore.waitForTaskIds([taskId]),
    new Promise<void>((resolve) => window.setTimeout(resolve, MEDIA_COLLECT_WRITE_BACK_TIMEOUT_MS))
  ])
  const snapshot = taskStore.getTaskRunSnapshot(taskId)
  if (!snapshot) return []
  return collectRunMediaPaths(snapshot.graph, snapshot.runStates, {
    ...(preferredNodeIds?.length ? { preferredNodeIds } : {})
  })
}

async function handleTaskRun(payload: McpTaskRunPayload): Promise<void> {
  if (payload.mcpTaskId && handledMcpTaskIds.has(payload.mcpTaskId)) {
    return
  }
  if (payload.mcpTaskId) {
    handledMcpTaskIds.add(payload.mcpTaskId)
  }

  const project = useProjectStore()
  const taskStore = useGraphTaskStore()
  const activeTargets = resolveActiveWorkspaceTargets()
  const rawAssetId = payload.assetId?.trim() ?? ''
  const effectiveAssetId =
    rawAssetId && rawAssetId !== 'current' && rawAssetId !== 'active'
      ? rawAssetId
      : lastEditedAssetId || activeTargets.defaultAssetId

  const asset = project.assets.find((item) => item.id === effectiveAssetId)
  if (asset) {
    openMcpWorkflowAssetEditor(payload.assetId || effectiveAssetId)
    if (!isGraphEditorOpen(effectiveAssetId)) {
      await waitForGraphEditorOpen(effectiveAssetId)
    }
  }

  const liveGraph = graphEditorHosts.getLiveAssetDocument(effectiveAssetId)
  const storedGraph = (asset?.genParams as Record<string, unknown> | undefined)?.graphJson as
    GraphDocument | undefined
  const graphJson = liveGraph ?? storedGraph

  if (!asset || !graphJson || !Array.isArray(graphJson.nodes)) {
    report(payload.mcpTaskId, 'failed', {
      error: '资产不存在或不含图文档（task_run 需要画布或含子图的宿主资产）'
    })
    return
  }

  const explicitNodeIds = Array.isArray(payload.nodeIds)
    ? payload.nodeIds.map((id) => String(id).trim()).filter(Boolean)
    : []
  const seedNodeIds = explicitNodeIds.length
    ? explicitNodeIds
    : (lastEditedNodeIdsByAsset.get(effectiveAssetId) ?? [])
  const { targetNodeIds: downstreamTargetIds, invalidatedNodeIds } = collectDownstreamAndTargetIds(
    graphJson,
    seedNodeIds
  )
  const validExplicitNodeIds = explicitNodeIds.filter((id) =>
    graphJson.nodes.some((n) => n.id === id && !n.locked)
  )
  // 若调用方显式指定了 nodeIds（如单跑部分配音/单张分镜），只以显式节点为目标，
  // 避免顺着连线把下游尚无需执行的成片节点与其余分支整图一并拉起。
  const targetNodeIds = validExplicitNodeIds.length ? validExplicitNodeIds : downstreamTargetIds
  if (!explicitNodeIds.length && seedNodeIds.length) {
    lastEditedNodeIdsByAsset.delete(effectiveAssetId)
  }

  const invalidatedSet = new Set(invalidatedNodeIds)
  const priorRunStates = graphJson.runStates ?? {}
  const priorPathSet = new Set<string>(
    collectRunMediaPaths(
      graphJson,
      Object.fromEntries(
        Object.entries(priorRunStates).filter(([nodeId]) => !invalidatedSet.has(nodeId))
      )
    )
  )

  const result = taskStore.enqueueWorkflow({
    title: `${asset.name} · MCP`,
    graph: graphJson,
    target: { kind: 'asset', assetId: effectiveAssetId, hostId: `asset:${effectiveAssetId}` },
    priorNodeStates: graphJson.runStates,
    skipCompletedNodes: true,
    liveCanvasSync: true,
    ...(targetNodeIds.length ? { targetNodeIds } : {}),
    ...(invalidatedNodeIds.length ? { invalidatedNodeIds } : {})
  })

  if (!result.ok) {
    report(payload.mcpTaskId, 'failed', { error: '该图已有进行中的同目标任务' })
    return
  }

  report(payload.mcpTaskId, 'accepted', { taskId: result.id })

  const executedNodeIds = new Set<string>(
    validExplicitNodeIds.length
      ? validExplicitNodeIds
      : invalidatedNodeIds.length
        ? invalidatedNodeIds
        : graphJson.nodes.map((n) => n.id)
  )
  const streamedPaths: string[] = []

  const collectAndStreamProgress = (): void => {
    const snapshot = taskStore.getTaskRunSnapshot(result.id)
    if (!snapshot) return
    const preferredIds = executedNodeIds.size ? [...executedNodeIds] : undefined
    const candidateStates = Object.fromEntries(
      Object.entries(snapshot.runStates).filter(
        ([nodeId, state]) => state?.status === 'done' && executedNodeIds.has(nodeId)
      )
    )
    const currentPaths = collectRunMediaPaths(snapshot.graph, candidateStates, {
      ...(preferredIds?.length ? { preferredNodeIds: preferredIds } : {})
    })
    let added = false
    for (const path of currentPaths) {
      if (priorPathSet.has(path) && !invalidatedSet.size && validExplicitNodeIds.length > 0) {
        continue
      }
      if (!streamedPaths.includes(path)) {
        streamedPaths.push(path)
        added = true
      }
    }
    if (added && streamedPaths.length > 0) {
      report(payload.mcpTaskId, 'accepted', {
        taskId: result.id,
        relativePaths: [...streamedPaths]
      })
    }
  }

  // 轮询任务状态直到终态（任务完成后会从 tasks 移入 completed，两处都要查）
  const timer = window.setInterval(() => {
    const activeTask = taskStore.tasks.find((item) => item.id === result.id)
    const completedTask = taskStore.completed.find((item) => item.id === result.id)
    const task = activeTask ?? completedTask
    if (!task) {
      window.clearInterval(timer)
      report(payload.mcpTaskId, 'finished', {
        taskId: result.id,
        status: 'stopped',
        ...(streamedPaths.length ? { relativePaths: [...streamedPaths] } : {})
      })
      return
    }
    for (const node of task.nodes) {
      if (node.status === 'pending' || node.status === 'running') {
        executedNodeIds.add(node.nodeId)
      }
    }
    collectAndStreamProgress()
    if (
      completedTask ||
      task.status === 'done' ||
      task.status === 'error' ||
      task.status === 'stopped'
    ) {
      const status =
        task.status === 'done' || task.status === 'error' || task.status === 'stopped'
          ? task.status
          : 'done'
      const error = status === 'error' ? task.message || undefined : undefined
      window.clearInterval(timer)
      void (async () => {
        // 产物相对路径要等写回落盘后才齐全，收集完再回报终态
        const preferredIds = executedNodeIds.size
          ? [...executedNodeIds]
          : targetNodeIds.length
            ? targetNodeIds
            : seedNodeIds
        const finishedPaths = await collectFinishedTaskMediaPaths(
          taskStore,
          result.id,
          preferredIds
        )
        const relativePaths = Array.from(new Set([...streamedPaths, ...finishedPaths]))
        report(payload.mcpTaskId, 'finished', {
          taskId: result.id,
          status,
          error,
          ...(relativePaths.length ? { relativePaths } : {})
        })
      })()
    }
  }, 300)
}

const STAGE_OP_KINDS = new Set([
  'object_update',
  'update_object',
  'hide_object',
  'show_object',
  'lock_object',
  'unlock_object',
  'set_visible',
  'transform_object',
  'pose_update',
  'light_update',
  'material_update',
  'reparent_object',
  'object_duplicate',
  'duplicate_object',
  'object_copy',
  'object_paste',
  'object_add',
  'add_object',
  'create_object',
  'object_delete',
  'delete_object',
  'remove_object',
  'object_select',
  'select_object',
  'focus_object',
  'select_scene',
  'select_panorama',
  'camera_update',
  'update_camera',
  'camera_add',
  'add_camera',
  'create_camera',
  'camera_delete',
  'delete_camera',
  'remove_camera',
  'lighting_preset',
  'set_lighting_preset',
  'environment_update',
  'update_environment',
  'scene_update',
  'panorama_update',
  'viewport_update',
  'set_viewport',
  'view_action',
  'ai_blocking',
  'director_blocking',
  'cinemachine_pack',
  'previz_pack',
  'storyboard_previz',
  'capture_shot',
  'bake_storyboard',
  'anim_control',
  'stage_edit',
  'director_stage_edit'
])

const GRAPH_OP_KINDS = new Set([
  'node_upsert',
  'node_add',
  'add_node',
  'node_update',
  'update_node',
  'apply_preset',
  'node_delete',
  'delete_node',
  'node_select',
  'select_node',
  'edge_connect',
  'edge_add',
  'add_edge',
  'edge_delete',
  'delete_edge',
  'edge_reorder',
  'group_add',
  'add_group',
  'group_update',
  'update_group',
  'group_delete',
  'delete_group',
  'auto_layout'
])

function resolveRawOpKind(raw: Record<string, unknown>): string {
  if (typeof raw.op === 'string' && raw.op.trim()) return raw.op.trim()
  if (typeof raw.action === 'string' && raw.action.trim()) return raw.action.trim()
  if (typeof raw.type === 'string' && raw.type.trim()) return raw.type.trim()
  return ''
}

const NODE_UPDATE_ALIAS_KINDS = new Set([
  'node_update',
  'update_node',
  'update_data',
  'set_data',
  'update_params',
  'set_params',
  'patch_node',
  'edit_node'
])

function isDirectorStageOpRecord(raw: Record<string, unknown>): boolean {
  const op = resolveRawOpKind(raw)
  if (STAGE_OP_KINDS.has(op)) return true
  if (GRAPH_OP_KINDS.has(op) || NODE_UPDATE_ALIAS_KINDS.has(op)) return false
  if (
    op === 'project_globals_update' ||
    op === 'project_update' ||
    op === 'asset_update' ||
    op === 'inspector_update'
  ) {
    return false
  }
  const hasExplicitNodePayload =
    raw.params !== undefined || raw.data !== undefined || raw.patch !== undefined
  return Boolean(
    raw.objectId !== undefined ||
    raw.cameraId !== undefined ||
    raw.targetName !== undefined ||
    raw.skyColor !== undefined ||
    raw.ground !== undefined ||
    raw.environment !== undefined ||
    raw.sceneWorld !== undefined ||
    raw.cinemachine !== undefined ||
    raw.posePreset !== undefined ||
    raw.bonePose !== undefined ||
    raw.viewMode !== undefined ||
    raw.shadingMode !== undefined ||
    (raw.lightingPreset !== undefined && !hasExplicitNodePayload) ||
    (raw.visible !== undefined &&
      !hasExplicitNodePayload &&
      (raw.nodeId === undefined ||
        raw.name !== undefined ||
        raw.targetName !== undefined ||
        raw.objectId !== undefined))
  )
}

function extractEmbeddedDirectorStageOps(
  paramsObj: Record<string, unknown>
): Array<Record<string, unknown>> {
  const extracted: Array<Record<string, unknown>> = []
  if (Array.isArray(paramsObj.directorStageOps)) {
    for (const sub of paramsObj.directorStageOps) {
      if (sub && typeof sub === 'object') extracted.push(sub as Record<string, unknown>)
    }
  }
  const parseMaybeJsonObj = (val: unknown): Record<string, unknown> | null => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return val as Record<string, unknown>
    }
    if (typeof val === 'string' && val.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(val)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>
        }
      } catch {
        /* ignore */
      }
    }
    return null
  }
  const stageSources: Array<Record<string, unknown>> = [paramsObj]
  const nestedDirectorStage = parseMaybeJsonObj(paramsObj.directorStage)
  if (nestedDirectorStage) stageSources.push(nestedDirectorStage)
  const nestedStage = parseMaybeJsonObj(paramsObj.stage)
  if (nestedStage) stageSources.push(nestedStage)

  for (const src of stageSources) {
    if (Array.isArray(src.objects)) {
      for (const obj of src.objects) {
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
          const oRec = obj as Record<string, unknown>
          extracted.push({
            op: 'object_update',
            ...oRec,
            ...(typeof oRec.id === 'string' && !oRec.objectId ? { objectId: oRec.id } : {})
          })
        }
      }
    }
    if (
      src.visible !== undefined &&
      (typeof src.name === 'string' ||
        typeof src.targetName === 'string' ||
        typeof src.objectId === 'string')
    ) {
      extracted.push({ op: 'object_update', ...src })
    }
  }
  return extracted
}

function normalizeNodeUpdateAliases(
  rawOp: Record<string, unknown>,
  fallbackNodeId: string | null
): GraphEditOp {
  const nodeId = (typeof rawOp.nodeId === 'string' && rawOp.nodeId.trim()) || fallbackNodeId || ''
  const rawDataObj =
    rawOp.data && typeof rawOp.data === 'object' && !Array.isArray(rawOp.data)
      ? (rawOp.data as Record<string, unknown>)
      : {}
  const dataInnerParams =
    rawDataObj.params && typeof rawDataObj.params === 'object' && !Array.isArray(rawDataObj.params)
      ? (rawDataObj.params as Record<string, unknown>)
      : {}
  const baseData: Record<string, unknown> = { ...rawDataObj, ...dataInnerParams }
  delete baseData.params
  const baseParams =
    rawOp.params && typeof rawOp.params === 'object'
      ? { ...(rawOp.params as Record<string, unknown>) }
      : {}
  const nestedPatch =
    rawOp.patch && typeof rawOp.patch === 'object' ? (rawOp.patch as Record<string, unknown>) : {}
  const mergedParams: Record<string, unknown> = { ...baseData, ...nestedPatch, ...baseParams }

  // 把除结构保留键外的所有顶层字段（含点路径、简写属性、未来新节点任意新参数）自动收集进 mergedParams
  const reservedTopKeys = new Set([
    'op',
    'action',
    'type',
    'nodeId',
    'id',
    'typeId',
    'title',
    'x',
    'y',
    'w',
    'h',
    'locked',
    'params',
    'data',
    'patch'
  ])
  for (const [key, val] of Object.entries(rawOp)) {
    if (!reservedTopKeys.has(key) && val !== undefined && mergedParams[key] === undefined) {
      mergedParams[key] = val
    }
  }

  if (
    (mergedParams.instruction !== undefined ||
      mergedParams.prompt !== undefined ||
      mergedParams.input !== undefined ||
      mergedParams.script !== undefined) &&
    mergedParams.generateInstruction === undefined
  ) {
    mergedParams.generateInstruction =
      mergedParams.instruction ?? mergedParams.prompt ?? mergedParams.input ?? mergedParams.script
  }
  if (mergedParams.systemPrompt !== undefined && mergedParams.generateSystemPrompt === undefined) {
    mergedParams.generateSystemPrompt = mergedParams.systemPrompt
  }
  if (mergedParams.model !== undefined && mergedParams.generateModel === undefined) {
    mergedParams.generateModel = mergedParams.model
  }
  if (
    mergedParams.providerInstanceId !== undefined &&
    mergedParams.generateProviderInstanceId === undefined
  ) {
    mergedParams.generateProviderInstanceId = mergedParams.providerInstanceId
  }
  if (
    mergedParams.useGlobalStyle !== undefined &&
    mergedParams.styleImagesUseGlobal === undefined
  ) {
    mergedParams.styleImagesUseGlobal = mergedParams.useGlobalStyle
    delete mergedParams.useGlobalStyle
  }
  if (
    (mergedParams.voiceCharacter !== undefined ||
      mergedParams.speechCharacter !== undefined ||
      mergedParams.voiceProfile !== undefined) &&
    mergedParams.generateSpeechCharacter === undefined
  ) {
    mergedParams.generateSpeechCharacter =
      mergedParams.voiceCharacter ?? mergedParams.speechCharacter ?? mergedParams.voiceProfile
    delete mergedParams.voiceCharacter
    delete mergedParams.speechCharacter
    delete mergedParams.voiceProfile
  }
  if (mergedParams.voice !== undefined && mergedParams.generateSpeechVoice === undefined) {
    mergedParams.generateSpeechVoice = mergedParams.voice
  }
  if (mergedParams.voices !== undefined && mergedParams.generateDialogueVoices === undefined) {
    mergedParams.generateDialogueVoices = mergedParams.voices
  }
  if (mergedParams.aspectRatio !== undefined) {
    if (mergedParams.generateAspectRatio === undefined) {
      mergedParams.generateAspectRatio = mergedParams.aspectRatio
    }
    if (mergedParams.imageAspectRatio === undefined) {
      mergedParams.imageAspectRatio = mergedParams.aspectRatio
    }
    if (mergedParams.videoAspectRatio === undefined) {
      mergedParams.videoAspectRatio = mergedParams.aspectRatio
    }
  }
  if (mergedParams.size !== undefined) {
    if (mergedParams.generateResolution === undefined) {
      mergedParams.generateResolution = mergedParams.size
    }
    if (mergedParams.imageSize === undefined) {
      mergedParams.imageSize = mergedParams.size
    }
  }
  if (mergedParams.resolution !== undefined) {
    if (mergedParams.generateResolution === undefined) {
      mergedParams.generateResolution = mergedParams.resolution
    }
    if (mergedParams.imageSize === undefined) mergedParams.imageSize = mergedParams.resolution
    if (mergedParams.videoResolution === undefined) {
      mergedParams.videoResolution = mergedParams.resolution
    }
  }
  if (mergedParams.quality !== undefined && mergedParams.generateQuality === undefined) {
    mergedParams.generateQuality = mergedParams.quality
  }
  const rawCount = mergedParams.count ?? mergedParams.n
  if (rawCount !== undefined) {
    if (mergedParams.generateCount === undefined) mergedParams.generateCount = rawCount
    if (mergedParams.imageCount === undefined) mergedParams.imageCount = rawCount
  }
  const rawDuration =
    mergedParams.duration ?? mergedParams.durationSec ?? mergedParams.durationSeconds
  if (rawDuration !== undefined && mergedParams.generateDuration === undefined) {
    mergedParams.generateDuration = rawDuration
  }
  if (mergedParams.seed !== undefined && mergedParams.generateSeed === undefined) {
    mergedParams.generateSeed = mergedParams.seed
    if (mergedParams.generateSeedUseGlobal === undefined) {
      mergedParams.generateSeedUseGlobal = false
    }
  }
  if (
    mergedParams.transparentBg !== undefined &&
    mergedParams.generateTransparentBg === undefined
  ) {
    mergedParams.generateTransparentBg = mergedParams.transparentBg
  }
  if (mergedParams.lyrics !== undefined && mergedParams.generateMusicLyrics === undefined) {
    mergedParams.generateMusicLyrics = mergedParams.lyrics
  }
  if (
    mergedParams.instrumental !== undefined &&
    mergedParams.generateMusicInstrumental === undefined
  ) {
    mergedParams.generateMusicInstrumental = mergedParams.instrumental
  }
  if (mergedParams.loop !== undefined && mergedParams.generateSoundLoop === undefined) {
    mergedParams.generateSoundLoop = mergedParams.loop
  }

  // Comic page aliases（保留对象形态交给 mergeSmartNodeParams 增量合并，不提前覆盖整页）
  const rawComic = mergedParams.comicPage ?? mergedParams.comicPageLayout ?? mergedParams.layout
  if (rawComic !== undefined) {
    delete mergedParams.comicPageLayout
    delete mergedParams.layout
    mergedParams.comicPage = rawComic
  }

  // Film storyboard / cast / model / stage aliases（保留对象形态交给 mergeSmartNodeParams 增量合并）
  if (mergedParams.storyboard !== undefined && mergedParams.filmStoryboard === undefined) {
    mergedParams.filmStoryboard = mergedParams.storyboard
    delete mergedParams.storyboard
  }
  if (mergedParams.cast !== undefined && mergedParams.filmCast === undefined) {
    mergedParams.filmCast = mergedParams.cast
    delete mergedParams.cast
  }
  if (mergedParams.textModel !== undefined && mergedParams.filmTextModel === undefined) {
    mergedParams.filmTextModel = mergedParams.textModel
    delete mergedParams.textModel
  }
  if (
    mergedParams.textProviderInstanceId !== undefined &&
    mergedParams.filmTextProviderInstanceId === undefined
  ) {
    mergedParams.filmTextProviderInstanceId = mergedParams.textProviderInstanceId
    delete mergedParams.textProviderInstanceId
  }
  if (mergedParams.imageModel !== undefined && mergedParams.generateModel === undefined) {
    mergedParams.generateModel = mergedParams.imageModel
    delete mergedParams.imageModel
  }
  if (
    mergedParams.imageProviderInstanceId !== undefined &&
    mergedParams.generateProviderInstanceId === undefined
  ) {
    mergedParams.generateProviderInstanceId = mergedParams.imageProviderInstanceId
    delete mergedParams.imageProviderInstanceId
  }
  if (mergedParams.videoModel !== undefined && mergedParams.filmVideoModel === undefined) {
    mergedParams.filmVideoModel = mergedParams.videoModel
    delete mergedParams.videoModel
  }
  if (
    mergedParams.videoProviderInstanceId !== undefined &&
    mergedParams.filmVideoProviderInstanceId === undefined
  ) {
    mergedParams.filmVideoProviderInstanceId = mergedParams.videoProviderInstanceId
    delete mergedParams.videoProviderInstanceId
  }
  if (mergedParams.qcModel !== undefined && mergedParams.filmQcModel === undefined) {
    mergedParams.filmQcModel = mergedParams.qcModel
    delete mergedParams.qcModel
  }
  if (
    mergedParams.qcProviderInstanceId !== undefined &&
    mergedParams.filmQcProviderInstanceId === undefined
  ) {
    mergedParams.filmQcProviderInstanceId = mergedParams.qcProviderInstanceId
    delete mergedParams.qcProviderInstanceId
  }
  if (mergedParams.runMode !== undefined && mergedParams.filmWorkbenchRunMode === undefined) {
    mergedParams.filmWorkbenchRunMode = mergedParams.runMode
    delete mergedParams.runMode
  }
  if (mergedParams.renderMode !== undefined && mergedParams.filmRenderMode === undefined) {
    mergedParams.filmRenderMode = mergedParams.renderMode
    delete mergedParams.renderMode
  }

  // 2D animation doc object -> string
  if (mergedParams.anim2dDoc && typeof mergedParams.anim2dDoc === 'object') {
    mergedParams.anim2dDoc = JSON.stringify(mergedParams.anim2dDoc)
  }

  // Image tool aliases
  const toolAliases: Array<[string, string]> = [
    ['crop', 'imageCrop'],
    ['transform', 'imageTransform'],
    ['compose', 'imageCompose'],
    ['align', 'imageAlign'],
    ['cutout', 'imageCutout'],
    ['matte', 'imageMatte'],
    ['erase', 'imageErase'],
    ['redraw', 'imageRedraw'],
    ['expand', 'imageExpand'],
    ['upscale', 'imageUpscale'],
    ['gridSplit', 'imageGridSplit'],
    ['layerSplit', 'imageLayerSplit'],
    ['lighting', 'lightingSetup'],
    ['emotion', 'emotionPad'],
    ['portrait', 'portraitRetouch'],
    ['portraitQuality', 'portraitTexture'],
    ['adVariants', 'adVariantMatrix'],
    ['html', 'gamePlayHtml'],
    ['svg', 'svgText'],
    ['code', 'scriptCode']
  ]
  for (const [shortKey, fullKey] of toolAliases) {
    if (mergedParams[shortKey] !== undefined && mergedParams[fullKey] === undefined) {
      mergedParams[fullKey] = mergedParams[shortKey]
      delete mergedParams[shortKey]
    }
  }

  return {
    ...rawOp,
    op: 'node_update',
    nodeId,
    ...(Object.keys(mergedParams).length > 0 ? { params: mergedParams } : {})
  } as GraphEditOp
}

/** 图编辑操作批：读取落盘图 → 应用 ops → 持久化 + 同步界面（同时兼容 3D 导演台与检查器操作） */
async function handleGraphEdit(payload: McpGraphEditPayload): Promise<void> {
  if (payload.requestId && handledGraphEditRequestIds.has(payload.requestId)) {
    return
  }
  if (payload.requestId) {
    handledGraphEditRequestIds.add(payload.requestId)
  }
  const reply = (
    ok: boolean,
    extra: {
      assetId?: string
      nodeIds?: string[]
      applied?: string[]
      warnings?: string[]
      error?: string
    } = {}
  ): void => {
    void window.studio?.reportMcpGraphEdit?.({ requestId: payload.requestId, ok, ...extra })
  }
  try {
    const project = useProjectStore()
    const workspace = useWorkspaceStore()
    const editor = useEditorKernel()
    const curSel = editor.selection.current.value
    const activeTargets = resolveActiveWorkspaceTargets()

    const effectiveAssetId =
      payload.assetId &&
      payload.assetId.trim() &&
      payload.assetId.trim() !== 'current' &&
      payload.assetId.trim() !== 'active'
        ? payload.assetId.trim()
        : activeTargets.defaultAssetId

    const effectiveHostId =
      payload.hostId?.trim() ||
      (effectiveAssetId === activeTargets.defaultAssetId ? activeTargets.defaultHostId : '')

    const stageOps: Array<Record<string, unknown>> = []
    const projectOps: Array<Record<string, unknown>> = []
    const assetOps: Array<Record<string, unknown>> = []
    const semanticOps: Array<Record<string, unknown>> = []
    const graphOps: GraphEditOp[] = []

    const selectedGraphNodeId = activeTargets.defaultNodeId
    const selectedGraphGroupId = activeTargets.defaultGroupId

    for (const item of payload.ops as unknown as Array<Record<string, unknown>>) {
      if (!item || typeof item !== 'object') continue
      const opName = resolveRawOpKind(item)

      if (opName === 'stage_edit' || opName === 'director_stage_edit') {
        if (Array.isArray(item.ops)) {
          for (const sub of item.ops) {
            if (sub && typeof sub === 'object') stageOps.push(sub as Record<string, unknown>)
          }
        } else {
          const copy = { ...item }
          delete copy.op
          stageOps.push(copy)
        }
        continue
      }

      if (opName === 'semantic_timeline_edit' || opName === 'semantic_edit') {
        semanticOps.push(item)
        continue
      }

      if (isDirectorStageOpRecord(item)) {
        stageOps.push(item)
        continue
      }

      if (opName === 'project_globals_update' || opName === 'project_update') {
        projectOps.push(item)
        continue
      }

      if (opName === 'asset_update') {
        assetOps.push(item)
        continue
      }

      if (opName === 'inspector_update') {
        if (curSel.kind.startsWith('stage.')) {
          const copy = { ...item }
          delete copy.op
          stageOps.push(copy)
        } else if (curSel.kind === 'graph.group' && selectedGraphGroupId) {
          graphOps.push({
            op: 'group_update',
            groupId: (typeof item.groupId === 'string' && item.groupId) || selectedGraphGroupId,
            title: typeof item.title === 'string' ? item.title : String(item.name ?? '')
          })
        } else if (curSel.kind === 'asset') {
          assetOps.push(item)
        } else if (selectedGraphNodeId) {
          graphOps.push(normalizeNodeUpdateAliases(item, selectedGraphNodeId))
        } else {
          projectOps.push(item)
        }
        continue
      }

      if (opName === 'apply_preset') {
        graphOps.push({
          op: 'apply_preset',
          nodeId:
            (typeof item.nodeId === 'string' && item.nodeId.trim()) || selectedGraphNodeId || '',
          preset: String(item.preset ?? item.presetId ?? '')
        })
        continue
      }

      if (
        NODE_UPDATE_ALIAS_KINDS.has(opName) ||
        (!opName &&
          (item.params !== undefined || item.data !== undefined || item.patch !== undefined))
      ) {
        const normalized = normalizeNodeUpdateAliases(item, selectedGraphNodeId) as Record<
          string,
          unknown
        >
        const paramsObj =
          normalized.params && typeof normalized.params === 'object'
            ? (normalized.params as Record<string, unknown>)
            : null
        if (paramsObj) {
          const embeddedStageOps = extractEmbeddedDirectorStageOps(paramsObj)
          if (embeddedStageOps.length > 0) {
            stageOps.push(...embeddedStageOps)
            const restParams = { ...paramsObj }
            delete restParams.directorStageOps
            delete restParams.directorStage
            delete restParams.stage
            delete restParams.objects
            if (
              Object.keys(restParams).length > 0 ||
              item.title !== undefined ||
              item.locked !== undefined
            ) {
              graphOps.push({
                ...normalized,
                params: restParams
              } as unknown as GraphEditOp)
            }
            continue
          }
        }
        graphOps.push(normalized as unknown as GraphEditOp)
        continue
      }

      graphOps.push(item as unknown as GraphEditOp)
    }

    const totalApplied: string[] = []
    const totalWarnings: string[] = []

    if (stageOps.length > 0) {
      const stageRes = await executeDirectorStageEdit({
        assetId: effectiveAssetId,
        ops: stageOps
      })
      if (Array.isArray(stageRes.applied)) {
        totalApplied.push(...(stageRes.applied as string[]))
      }
      if (Array.isArray(stageRes.warnings)) {
        totalWarnings.push(...(stageRes.warnings as string[]))
      }
    }

    if (semanticOps.length > 0) {
      const diveKey = workspace.activeDiveRootKey
      const diveStack = diveKey ? (workspace.editorDives[diveKey] ?? []) : []
      const topFrame = diveStack.length ? diveStack[diveStack.length - 1] : null
      const defaultTimelineId =
        topFrame && topFrame.type === 'view' && topFrame.meta.viewId === 'semantic.timeline' // view-id-keep
          ? topFrame.meta.timelineId
          : ''
      for (const sOp of semanticOps) {
        const tlId =
          (typeof sOp.timelineId === 'string' && sOp.timelineId.trim()) || defaultTimelineId
        if (!tlId) {
          totalWarnings.push('semantic_timeline_edit 缺少 timelineId')
          continue
        }
        try {
          const text = await window.studio.readProjectFile(`Semantic/${tlId}/timeline.json`)
          if (!text?.trim()) {
            totalWarnings.push(`未找到语义时间线：Semantic/${tlId}/timeline.json`)
            continue
          }
          let doc = migrateSemanticTimeline(JSON.parse(text) as SemanticTimeline)
          const edits = Array.isArray(sOp.edits) ? sOp.edits : [sOp]
          for (const rawEdit of edits) {
            if (!rawEdit || typeof rawEdit !== 'object') continue
            const eObj = rawEdit as Record<string, unknown>
            const editKind =
              typeof eObj.editOp === 'string'
                ? eObj.editOp
                : typeof eObj.action === 'string'
                  ? eObj.action
                  : typeof eObj.op === 'string' &&
                      eObj.op !== 'semantic_timeline_edit' &&
                      eObj.op !== 'semantic_edit'
                    ? eObj.op
                    : 'shot.update'
            const target = String(
              eObj.target ?? eObj.shotId ?? eObj.utteranceId ?? eObj.entityId ?? ''
            )
            const patch =
              eObj.patch && typeof eObj.patch === 'object'
                ? (eObj.patch as Record<string, unknown>)
                : eObj
            doc = applySemanticEdit(doc, {
              op: editKind as SemanticEditInput['op'],
              target,
              patch
            })
            totalApplied.push(`semantic_timeline_edit:${tlId}:${editKind}:${target}`)
          }
          await window.studio.semanticSaveTimeline(semanticTimelineSavePayload(doc))
          graphEditorHosts.bumpRevision()
        } catch (err) {
          totalWarnings.push(
            `semantic_timeline_edit(${tlId}) 失败：${err instanceof Error ? err.message : String(err)}`
          )
        }
      }
    }

    if (projectOps.length > 0) {
      for (const pOp of projectOps) {
        const patchSource =
          pOp.patch && typeof pOp.patch === 'object'
            ? { ...(pOp.patch as Record<string, unknown>), ...pOp }
            : pOp
        const settingsPatch: {
          generateSeed?: number
          cacheOutputDir?: string
          styleImages?: ReturnType<typeof normalizeProjectStyleImages>
        } = {}
        if (patchSource.generateSeed !== undefined || patchSource.seed !== undefined) {
          const rawSeed = patchSource.generateSeed ?? patchSource.seed
          const n = Number(rawSeed)
          settingsPatch.generateSeed = Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined
        }
        if (patchSource.cacheOutputDir !== undefined) {
          settingsPatch.cacheOutputDir =
            typeof patchSource.cacheOutputDir === 'string' && patchSource.cacheOutputDir.trim()
              ? patchSource.cacheOutputDir.trim()
              : undefined
        }
        if (patchSource.styleImages !== undefined) {
          settingsPatch.styleImages = normalizeProjectStyleImages(
            Array.isArray(patchSource.styleImages) ? patchSource.styleImages : null
          )
        }
        await project.updateConfig(settingsPatch)
        totalApplied.push('project_globals_update')
      }
    }

    if (assetOps.length > 0) {
      for (const aOp of assetOps) {
        const patchSource =
          aOp.patch && typeof aOp.patch === 'object'
            ? { ...(aOp.patch as Record<string, unknown>), ...aOp }
            : aOp
        const targetAssetId =
          (typeof patchSource.targetAssetId === 'string' && patchSource.targetAssetId.trim()) ||
          (curSel.kind === 'asset' && typeof curSel.id === 'string' ? curSel.id : '') ||
          workspace.selectedAssetId ||
          effectiveAssetId
        const targetAsset = project.assets.find((item) => item.id === targetAssetId)
        if (!targetAsset) {
          totalWarnings.push(`资产不存在：${targetAssetId}`)
          continue
        }
        const nextName =
          typeof patchSource.name === 'string' && patchSource.name.trim()
            ? patchSource.name.trim()
            : undefined
        const curGen = (targetAsset.genParams as Record<string, unknown> | undefined) ?? {}
        const nextGen: Record<string, unknown> = { ...curGen }
        let genChanged = false
        if (typeof patchSource.color === 'string' && patchSource.color.trim()) {
          nextGen.color = patchSource.color.trim()
          genChanged = true
        }
        if (patchSource.transform && typeof patchSource.transform === 'object') {
          const curTf =
            curGen.transform && typeof curGen.transform === 'object'
              ? (curGen.transform as Record<string, unknown>)
              : {}
          nextGen.transform = { ...curTf, ...(patchSource.transform as Record<string, unknown>) }
          genChanged = true
        }
        if (patchSource.genParams && typeof patchSource.genParams === 'object') {
          Object.assign(nextGen, patchSource.genParams as Record<string, unknown>)
          genChanged = true
        }
        await persistAssetRecord(targetAssetId, {
          ...(nextName ? { name: nextName } : {}),
          ...(genChanged ? { genParams: nextGen } : {})
        })
        totalApplied.push(`asset_update:${nextName || targetAsset.name}(${targetAssetId})`)
      }
    }

    if (graphOps.length === 0) {
      if (!totalApplied.length && totalWarnings.length) {
        reply(false, { applied: [], warnings: totalWarnings, error: totalWarnings.join('；') })
        return
      }
      reply(true, {
        ...(effectiveAssetId ? { assetId: effectiveAssetId } : {}),
        applied: totalApplied,
        warnings: totalWarnings
      })
      return
    }

    const asset = project.assets.find((item) => item.id === effectiveAssetId)
    payload.assetId = effectiveAssetId

    // 默认自动打开画布编辑器（除非显式传 openEditor: false），保证画布节点变化全程实时可见
    if (payload.openEditor !== false && asset && !isGraphEditorOpen(effectiveAssetId)) {
      openMcpWorkflowAssetEditor(effectiveAssetId)
      const opened = await waitForGraphEditorOpen(effectiveAssetId)
      if (!opened && payload.openEditor === true) {
        reply(false, { error: '无法打开图编辑器（openEditor），请确认资产可编辑' })
        return
      }
    }

    /**
     * 「选中节点」是**看得见**的动作：编辑器没开就先把编辑器打开。
     */
    const hasSelectOp =
      payload.ops.some((op) => op.op === 'node_select') ||
      graphOps.some((op) => op.op === 'node_select' || op.op === 'select_node')
    if (hasSelectOp && !isGraphEditorOpen(payload.assetId)) {
      openMcpWorkflowAssetEditor(payload.assetId)
      await waitForGraphEditorOpen(payload.assetId)
    }

    const editOptions =
      payload.autoLayout === true
        ? { autoLayout: true as const }
        : payload.autoLayout === false
          ? { autoLayout: false as const }
          : undefined

    const syncSubgraphBoundaryAfterEdit = (
      doc: GraphDocument,
      reLayout: boolean
    ): { graph: GraphDocument; hostInterface?: ReturnType<typeof inferHostInterfaceFromGraph> } => {
      if (asset && asset.type !== 'subgraph') return { graph: doc }
      const hostInterface = inferHostInterfaceFromGraph(doc)
      const synced = ensureBoundaryProxyNodes(doc, hostInterface)
      if (reLayout) {
        autoLayoutNodes(synced.nodes, synced.edges)
      }
      return { graph: synced, hostInterface }
    }

    const resolveLiveHostForEdit = (): { hostId: string; live: GraphDocument } | null => {
      if (effectiveHostId) {
        const doc = graphEditorHosts.getDocument(effectiveHostId)
        if (doc) return { hostId: effectiveHostId, live: doc }
      }
      const baseHostId = `asset:${effectiveAssetId}`
      const baseDoc = graphEditorHosts.getLiveAssetDocument(effectiveAssetId)
      const targetNodeIds = new Set<string>()
      for (const op of graphOps) {
        if ('nodeId' in op && typeof op.nodeId === 'string' && op.nodeId.trim()) {
          targetNodeIds.add(op.nodeId.trim())
        }
        if ('fromNodeId' in op && typeof op.fromNodeId === 'string' && op.fromNodeId.trim()) {
          targetNodeIds.add(op.fromNodeId.trim())
        }
        if ('toNodeId' in op && typeof op.toNodeId === 'string' && op.toNodeId.trim()) {
          targetNodeIds.add(op.toNodeId.trim())
        }
      }
      if (
        baseDoc &&
        (targetNodeIds.size === 0 || baseDoc.nodes.some((n) => targetNodeIds.has(n.id)))
      ) {
        return { hostId: baseHostId, live: baseDoc }
      }
      const candidates = graphEditorHosts
        .listLiveEntries()
        .filter((e) => e.hostId === baseHostId || e.hostId.startsWith(`${baseHostId}:`))
      if (targetNodeIds.size > 0) {
        const matched = candidates.find((e) =>
          e.document.nodes.some((n) => targetNodeIds.has(n.id))
        )
        if (matched) return { hostId: matched.hostId, live: matched.document }
      }
      if (baseDoc) return { hostId: baseHostId, live: baseDoc }
      if (candidates[0]) return { hostId: candidates[0].hostId, live: candidates[0].document }
      return null
    }

    const liveTarget = resolveLiveHostForEdit()
    if (isGraphEditorOpen(effectiveAssetId) || liveTarget) {
      if (!liveTarget) {
        reply(false, { error: '编辑器已打开但暂时取不到实时图，请稍后重试' })
        return
      }
      const { hostId, live } = liveTarget
      const liveResult = applyGraphEditOps(live, graphOps, editOptions)
      const combinedApplied = [...totalApplied, ...liveResult.applied]
      const combinedWarnings = [...totalWarnings, ...liveResult.warnings]
      if (!combinedApplied.length && combinedWarnings.length) {
        reply(false, { applied: [], warnings: combinedWarnings, error: '全部操作未生效' })
        return
      }
      const didAutoLayout = liveResult.applied.includes('自动布局')
      const addedNewNode = liveResult.applied.some((item) => item.startsWith('新建节点'))
      const onlySelect =
        liveResult.selectNodeIds?.length &&
        liveResult.applied.every((item) => item === '自动布局' || item.startsWith('选中节点'))
      let syncedHostInterface: ReturnType<typeof inferHostInterfaceFromGraph> | undefined
      if (!onlySelect && liveResult.applied.length > 0) {
        const synced = syncSubgraphBoundaryAfterEdit(liveResult.graph, didAutoLayout)
        syncedHostInterface = synced.hostInterface
        if (liveResult.touchedNodeIds?.length) {
          const { invalidatedNodeIds } = collectDownstreamAndTargetIds(
            synced.graph,
            liveResult.touchedNodeIds
          )
          clearLiveCanvasRunStates(hostId, invalidatedNodeIds)
        }
        graphEditorHosts.applyExternalGraph(
          hostId,
          synced.graph,
          didAutoLayout || addedNewNode ? { fitView: true } : undefined
        )
        emitGraphDiffVfx(hostId, live, synced.graph, {
          source: 'ai',
          rawOps: graphOps,
          fitView: didAutoLayout || addedNewNode
        })
      }
      const selectId = liveResult.selectNodeIds?.at(-1) ?? liveResult.touchedNodeIds?.at(-1)
      if (selectId) graphEditorHosts.selectNode(hostId, selectId)
      await graphEditorHosts.flush(hostId)
      if (syncedHostInterface && asset) {
        const latest = project.assets.find((item) => item.id === effectiveAssetId) ?? asset
        await persistAssetRecord(effectiveAssetId, {
          genParams: {
            ...((latest.genParams as Record<string, unknown> | undefined) ?? {}),
            hostInterface: syncedHostInterface
          }
        })
      }
      lastEditedAssetId = effectiveAssetId
      if (liveResult.touchedNodeIds?.length) {
        lastEditedNodeIdsByAsset.set(effectiveAssetId, liveResult.touchedNodeIds)
      }
      reply(true, {
        assetId: effectiveAssetId,
        ...(liveResult.touchedNodeIds?.length ? { nodeIds: liveResult.touchedNodeIds } : {}),
        applied: combinedApplied,
        warnings: combinedWarnings
      })
      return
    }

    const graphJson = (asset?.genParams as Record<string, unknown> | undefined)?.graphJson as
      GraphDocument | undefined
    if (!asset || !graphJson || !Array.isArray(graphJson.nodes)) {
      reply(false, { error: '资产不存在或不含图文档（graph_edit 仅支持宿主资产子图）' })
      return
    }
    const result = applyGraphEditOps(graphJson, graphOps, editOptions)
    const combinedApplied = [...totalApplied, ...result.applied]
    const combinedWarnings = [...totalWarnings, ...result.warnings]
    if (!combinedApplied.length && combinedWarnings.length) {
      reply(false, { applied: [], warnings: combinedWarnings, error: '全部操作未生效' })
      return
    }
    const didAutoLayout = result.applied.includes('自动布局')
    const onlySelect =
      result.selectNodeIds?.length &&
      result.applied.every((item) => item === '自动布局' || item.startsWith('选中节点'))
    const synced = onlySelect
      ? { graph: result.graph, hostInterface: undefined }
      : syncSubgraphBoundaryAfterEdit(result.graph, didAutoLayout)
    const updated = await persistAssetRecord(effectiveAssetId, {
      genParams: {
        ...(asset.genParams as Record<string, unknown>),
        graphJson: synced.graph,
        ...(synced.hostInterface ? { hostInterface: synced.hostInterface } : {})
      }
    })
    if (!updated) {
      reply(false, { error: '持久化失败：资产不存在' })
      return
    }
    if (result.selectNodeIds?.length && !isGraphEditorOpen(effectiveAssetId)) {
      combinedWarnings.push(
        '选中节点未在画面上体现：图编辑器未打开（教学录屏请先 openEditor 或确保编辑器已打开）'
      )
    }
    lastEditedAssetId = effectiveAssetId
    if (result.touchedNodeIds?.length) {
      lastEditedNodeIdsByAsset.set(effectiveAssetId, result.touchedNodeIds)
    }
    reply(true, {
      assetId: effectiveAssetId,
      ...(result.touchedNodeIds?.length ? { nodeIds: result.touchedNodeIds } : {}),
      applied: combinedApplied,
      warnings: combinedWarnings
    })
  } catch (err) {
    reply(false, { error: err instanceof Error ? err.message : String(err) })
  }
}

/** 重跑打包节点的等待上限（精修本身已耗时，这里给打包重跑留足） */
const ICON_REFINE_REPACK_TIMEOUT_MS = 6 * 60 * 1000

/** 等待任务进入终态；超时按 timeout 回报（任务仍在跑，不中断） */
function waitForTaskEnd(
  taskStore: ReturnType<typeof useGraphTaskStore>,
  taskId: string,
  timeoutMs: number
): Promise<'done' | 'error' | 'stopped' | 'timeout'> {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      const task = taskStore.tasks.find((item) => item.id === taskId)
      if (!task) {
        window.clearInterval(timer)
        resolve('stopped')
        return
      }
      if (task.status === 'done' || task.status === 'error' || task.status === 'stopped') {
        window.clearInterval(timer)
        resolve(task.status)
        return
      }
      if (Date.now() - startedAt > timeoutMs) {
        window.clearInterval(timer)
        resolve('timeout')
      }
    }, 1500)
  })
}

/** 精修失败原因码 → 给外部 Agent 的提示（与弹窗文案各自维护措辞） */
const ICON_REFINE_FAILURE_TEXT: Record<string, string> = {
  unresolved:
    '未定位到该切分节点与格位：splitNodeId 需为 image.gridSplit 节点、cellKey 形如 1-1（graph_read 可核对）',
  'no-pack': '未找到与本格同源打包节点：需图标包节点与整版图同源连接后才能回炉写回',
  'no-source': '未解析到整版源图：请先运行整版图片节点生成 / 落盘整版图再精修',
  'no-result': '生图未返回本地图片'
}

function iconRefineErrorText(err: unknown): string {
  if (err instanceof IconRefineError) return ICON_REFINE_FAILURE_TEXT[err.code] ?? err.code
  return err instanceof Error ? err.message : String(err)
}

/**
 * 单枚图标精修回炉：重画某一格 → 写回同源 iconPack 的逐枚覆盖 → 重跑打包节点。
 * 执行口径与 dive 弹窗「精修回炉」按钮完全一致（同一个 runIconRefine）。
 */
async function handleGraphIconRefine(payload: McpGraphIconRefinePayload): Promise<void> {
  const reply = (
    ok: boolean,
    extra: {
      cellKey?: string
      name?: string
      packNodeId?: string
      prompt?: string
      repacked?: boolean
      warning?: string
      error?: string
    } = {}
  ): void => {
    void window.studio?.reportMcpGraphIconRefine?.({ requestId: payload.requestId, ok, ...extra })
  }
  try {
    const project = useProjectStore()
    const asset = project.assets.find((item) => item.id === payload.assetId)
    const graphJson = (asset?.genParams as Record<string, unknown> | undefined)?.graphJson as
      GraphDocument | undefined
    if (!asset || !graphJson || !Array.isArray(graphJson.nodes)) {
      reply(false, { error: '资产不存在或不含图文档（graph_icon_refine 仅支持宿主资产子图）' })
      return
    }
    if (isGraphEditorOpen(payload.assetId)) {
      reply(false, {
        error: '该资产的图编辑器正在界面中打开，为避免互相覆盖请先关闭编辑器再远程精修'
      })
      return
    }

    const result = await runIconRefine({
      document: graphJson,
      splitNodeId: payload.splitNodeId,
      cellKey: payload.cellKey,
      hint: payload.hint,
      prompt: payload.prompt,
      locale: payload.locale === 'en' ? 'en' : 'zh',
      assets: project.assets
    })

    const updated = await persistAssetRecord(payload.assetId, {
      genParams: { ...(asset.genParams as Record<string, unknown>), graphJson: result.document }
    })
    if (!updated) {
      reply(false, { error: '持久化失败：资产不存在' })
      return
    }

    const done = {
      cellKey: result.cellKey,
      name: result.name ?? undefined,
      packNodeId: result.packNodeId,
      prompt: result.prompt
    }
    if (payload.repack === false) {
      reply(true, {
        ...done,
        repacked: false,
        warning: '已写入精修结果，按请求未重跑打包节点（repack=false）'
      })
      return
    }

    openMcpWorkflowAssetEditor(payload.assetId)

    const taskStore = useGraphTaskStore()
    const enqueued = taskStore.enqueueWorkflow({
      title: `${asset.name} · MCP 精修回炉`,
      graph: result.document,
      target: { kind: 'asset', assetId: payload.assetId, hostId: `asset:${payload.assetId}` },
      priorNodeStates: result.document.runStates,
      skipCompletedNodes: true,
      liveCanvasSync: true,
      // 该节点旧 done 结果已失效（本格精修图要顶替成图），不得复用
      invalidatedNodeIds: [result.packNodeId]
    })
    if (!enqueued.ok) {
      reply(true, {
        ...done,
        repacked: false,
        warning: '该资产已有进行中的同目标工作流，精修结果已写入，稍后自行重跑打包即可生效'
      })
      return
    }

    const status = await waitForTaskEnd(taskStore, enqueued.id, ICON_REFINE_REPACK_TIMEOUT_MS)
    reply(true, {
      ...done,
      repacked: status === 'done',
      ...(status === 'done'
        ? {}
        : {
            warning: `精修结果已写入，重跑打包未在本轮完成（${status}），可在应用任务列表查看进度`
          })
    })
  } catch (err) {
    reply(false, { error: iconRefineErrorText(err) })
  }
}

let registered = false

type WindowWithMcpTaskRunnerCleanup = Window & {
  __aiaeMcpTaskRunnerCleanup?: () => void
}

export function registerMcpTaskRunner(): void {
  if (registered) return
  registered = true
  const win = window as WindowWithMcpTaskRunnerCleanup
  win.__aiaeMcpTaskRunnerCleanup?.()
  const cleanups: Array<() => void> = []
  if (typeof window.studio?.onMcpWorkflowFocus === 'function') {
    const off = window.studio.onMcpWorkflowFocus((payload) => {
      const assetId = payload.assetId?.trim()
      if (assetId) openMcpWorkflowAssetEditor(assetId)
    })
    if (typeof off === 'function') cleanups.push(off)
  }
  if (typeof window.studio?.onMcpTaskRun !== 'function') return
  const offTaskRun = window.studio.onMcpTaskRun((payload) => {
    void handleTaskRun(payload)
  })
  if (typeof offTaskRun === 'function') cleanups.push(offTaskRun)
  if (typeof window.studio?.onMcpGraphEdit === 'function') {
    const offGraphEdit = window.studio.onMcpGraphEdit((payload) => {
      void handleGraphEdit(payload)
    })
    if (typeof offGraphEdit === 'function') cleanups.push(offGraphEdit)
  }
  if (typeof window.studio?.onMcpGraphIconRefine === 'function') {
    const offIconRefine = window.studio.onMcpGraphIconRefine((payload) => {
      void handleGraphIconRefine(payload)
    })
    if (typeof offIconRefine === 'function') cleanups.push(offIconRefine)
  }
  win.__aiaeMcpTaskRunnerCleanup = () => {
    for (const off of cleanups) {
      try {
        off()
      } catch {
        /* ignore cleanup error */
      }
    }
  }
}
