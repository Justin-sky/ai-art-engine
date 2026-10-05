import { computed, nextTick, reactive, ref, shallowRef } from 'vue'
import type { ProjectStyleImage } from '@shared/domain'
import type { GraphImageReferenceMeta } from '@shared/modelProvider'
import {
  applyEpisodeReviewMarks,
  exportPersistedRunStates,
  findConflictingGraphRunLane,
  importPersistedRunStates,
  isBoundaryOutputNode,
  listGraphRunLaneOverlap,
  pickGraphRunSuccessMessageKey,
  resolveGraphRunTargeting,
  runGraph,
  summarizeGraphRunOutput,
  summarizeMediaUrlForLog,
  summarizeReferenceListForLog,
  type GraphDocument,
  type GraphNodeParams,
  type GraphNodeRunState,
  type GraphNodeRunStatus,
  type GraphRunLane,
  type GraphRunLogMode,
  type GraphRunResult
} from '@shared/graph'
import { createGraphRunLogBridge } from '../model/graphRunLogBridge'
import {
  formatVideoJobProgressMessage,
  subscribeVideoJobProgress
} from '../model/subscribeVideoJobProgress'
import { formatProviderErrorForLog } from '../model/formatProviderErrorForLog'
import { resolveImageGenerateCapabilitiesForRun } from '../model/imageGenerateCapabilities'
import { resolveVideoGenerateCapabilitiesForRun } from '../model/videoGenerateCapabilities'
import { readEpisodeAgentState, writeEpisodeAgentState } from '../episodeAgentStateIO'
import {
  resolveAssetImageUrl,
  resolveAssetMediaDataUrl,
  resolveGraphImageUrls,
  resolveVideoFirstFrameImageUrls,
  resolveVideoReviewFrameImageUrls
} from '../model/resolveGraphImageUrls'
import { resolveAssetFileUrl } from '../../media/assetUrlCache'
import { resolveAssetText as resolveAssetTextById } from '../../media/resolveAssetText'
import { composeImageExpandCanvas } from '../model/composeImageExpandCanvas'
import { composeImageRedrawCanvas } from '../model/composeImageRedrawCanvas'
import { composeImageCropCanvas } from '../model/composeImageCropCanvas'
import { composeImageTransformCanvas } from '../model/composeImageTransformCanvas'
import { composeImageCutoutCanvas } from '../model/composeImageCutoutCanvas'
import { composeImageAlignCanvas } from '../model/composeImageAlignCanvas'
import { composeImageComposeCanvas } from '../model/composeImageComposeCanvas'
import { composeStage2dCanvas } from '../model/composeStage2dCanvas'
import { composeStage2dFrameSheet } from '../model/composeStage2dFrameSheet'
import { composeImageGridCell } from '../model/composeImageGridCell'
import { composeAnim2dGif } from '../model/composeAnim2dGif'
import { renderSvgFrames } from '../model/renderSvgFrames'
import { composeImageIconPackSheet } from '../model/composeImageIconPackSheet'
import { composeImageLayerStack } from '../model/composeImageLayerStack'
import { composeComicPageImage } from '../../comic/composeComicPageImage'
import {
  composePortraitIdPhoto,
  composePortraitScopedRetouch,
  detectPortraitFaces,
  fitPortraitToSourceSize,
  flattenPortraitBackground,
  inspectImageSize
} from '../model/portraitCapabilities'
import { inspectModelSkeleton } from '../model/inspectModelSkeleton'
import { runBlenderDshJob } from '../model/runBlenderDshJob'
import { buildGamePlayProjectForNode } from '../model/runGamePlayBuild'
import { normalizeImageAspectRatio } from '../model/normalizeImageAspectRatio'
import { enrichStyleImagesWithLibraryPrompts } from '../../stylePresets/defaultLibrary'
import { resolveStyleImageUrls } from '../../stylePresets/resolveStyleImageUrls'

export interface GraphRunSessionOptions {
  buildGraph: () => GraphDocument
  commitLocal: () => void
  /**
   * 跑图落盘后回调（含成功 / 失败 / 中止）。
   * 用于 dive 内执行后把 boundary 出口抬到父图宿主 runStates。
   */
  afterRunCommit?: (info: {
    graph: GraphDocument
    runStates: Record<string, GraphNodeRunState>
    result: GraphRunResult | null
  }) => void | Promise<void>
  t: (key: string, params?: Record<string, unknown>) => string
  generateText?: (input: {
    prompt: string
    system?: string
    model?: string
    providerInstanceId?: string
    images?: string[]
  }) => Promise<{ text: string; model: string }>
  /** 决策判定：OpenRouter Decisions API（noul / choice / score） */
  generateDecisions?: (
    input: import('@shared/modelProvider').GenerateDecisionsInput
  ) => Promise<import('@shared/modelProvider').GenerateDecisionsResult>
  generateImage?: (input: {
    prompt: string
    model?: string
    providerInstanceId?: string
    aspectRatio?: string
    resolution?: string
    quality?: string
    n?: number
    inputReferences?: string[]
  }) => Promise<{ images: string[]; model: string; referenceNotes?: string[] }>
  generateVideo?: (input: {
    prompt: string
    model?: string
    providerInstanceId?: string
    duration?: number
    resolution?: string
    aspectRatio?: string
    generateAudio?: boolean
    inputReferences?: Array<string | { kind: 'image_url' | 'video_url' | 'audio_url'; url: string }>
    outputDir?: string
    graphBinding?: {
      hostId?: string
      nodeId?: string
      assetId?: string
      shotId?: string
      canvasField?: string
    }
  }) => Promise<{
    assetId: string
    relativePath: string
    model: string
    uploads?: Array<{
      objectKey: string
      url: string
      bytes: number
      sourceLabel: string
      logs: Array<{ level: 'info' | 'warn' | 'error'; message: string; ts: number }>
    }>
  }>
  generateSpeech?: (input: {
    input: string
    model?: string
    providerInstanceId?: string
    voice?: string
    name?: string
    images?: string[]
    outputDir?: string
  }) => Promise<{
    assetId?: string
    relativePath?: string
    model: string
    voice: string
  }>
  generateModel3d?: (input: {
    prompt: string
    model?: string
    providerInstanceId?: string
    style?: string
    inputReferences?: Array<{ kind: 'image_url' | 'video_url' | 'audio_url'; url: string }>
    outputDir?: string
    name?: string
    graphBinding?: {
      hostId?: string
      nodeId?: string
      assetId?: string
      shotId?: string
      canvasField?: string
    }
  }) => Promise<{
    assetId: string
    relativePath: string
    model: string
    uploads?: Array<{
      objectKey: string
      url: string
      bytes: number
      sourceLabel: string
      logs: Array<{ level: 'info' | 'warn' | 'error'; message: string; ts: number }>
    }>
  }>
  generateSpatialWorld?: (input: {
    prompt: string
    model?: string
    providerInstanceId?: string
    inputReferences?: Array<{ kind: 'image_url' | 'video_url' | 'audio_url'; url: string }>
    outputDir?: string
    name?: string
    /** 世界展示名（World Labs display_name） */
    displayName?: string
    /** 随机种子 */
    seed?: number
    /** 单图参考按全景处理（官方 is_pano） */
    panoMode?: 'auto' | 'always' | 'never'
    /** 关闭上游 recaption */
    disableRecaption?: boolean
    graphBinding?: {
      hostId?: string
      nodeId?: string
      assetId?: string
      shotId?: string
      canvasField?: string
    }
  }) => Promise<{
    assetId: string
    relativePath: string
    model: string
    uploads?: Array<{
      objectKey: string
      url: string
      bytes: number
      sourceLabel: string
      logs: Array<{ level: 'info' | 'warn' | 'error'; message: string; ts: number }>
    }>
    /** 参考处理说明（如「已上传 N 个托管媒体资产」） */
    referenceNotes?: string[]
    /** 随世界一起免费返回的附加产物（SPZ 泼溅 / 全景图），已落盘在主产物旁边 */
    extras?: Array<{ kind: string; relativePath?: string }>
    /** World Labs 世界 id：下游「空间世界导出」只认它 */
    spatialWorldId?: string
  }>
  /**
   * 出口值丢了 world_id 时的兜底：按产出该模型的节点去任务记录里找回来。
   * 世界生成的积分已经花过，不该因为一个字段丢了就逼用户重新生成。
   */
  lookupSpatialWorldId?: (input: {
    nodeId?: string
    assetId?: string
  }) => Promise<string | undefined>
  exportWorld?: (input: {
    spatialWorldId: string
    assetType: 'splats' | 'mesh'
    format: 'ply' | 'glb'
    meshVariant?: 'textured' | 'vertex_colored'
    resolution?: 'full_res' | '500k' | '150k' | '100k'
    providerInstanceId?: string
    model?: string
    sourceRelativePath?: string
    outputDir?: string
    name?: string
    graphBinding?: {
      hostId?: string
      nodeId?: string
      assetId?: string
      shotId?: string
      canvasField?: string
    }
  }) => Promise<{ assetId?: string; relativePath: string; model: string }>
  rigModel3d?: (input: {
    modelRelativePath?: string
    modelUrl?: string
    model?: string
    providerInstanceId?: string
    rigType?: string
    spec?: 'tripo' | 'mixamo'
    outFormat?: 'glb' | 'fbx'
    name?: string
    outputDir?: string
    graphBinding?: {
      hostId?: string
      nodeId?: string
      assetId?: string
      shotId?: string
      canvasField?: string
    }
  }) => Promise<{ assetId: string; relativePath: string; model: string }>
  segmentModel3d?: (input: {
    modelRelativePath?: string
    modelUrl?: string
    model?: string
    providerInstanceId?: string
    mode?: 'mesh' | 'smart'
    granularity?: 'simple' | 'balanced' | 'detailed'
    splitByConnectivity?: boolean
    smartGranularity?: 'coarse' | 'medium' | 'fine'
    hint?: string
    name?: string
    outputDir?: string
    graphBinding?: {
      hostId?: string
      nodeId?: string
      assetId?: string
      shotId?: string
      canvasField?: string
    }
  }) => Promise<{
    assetId: string
    relativePath: string
    model: string
    mode: 'mesh' | 'smart'
    parts: string[]
    maskUrl?: string
    description?: string
  }>
  postProcessModel3d?: (input: {
    op: 'meshComplete' | 'retopology' | 'rigCheck' | 'retarget' | 'convert' | 'texture'
    providerTaskId?: string
    modelUrl?: string
    modelRelativePath?: string
    providerInstanceId?: string
    model?: string
    partNames?: string[]
    completionMode?: 'ai_completion' | 'quick_cap'
    retopologyMode?: 'smart' | 'basic'
    faceLimit?: number
    quad?: boolean
    bake?: boolean
    animation?: string
    animations?: string[]
    actionIds?: number[]
    outFormat?: 'glb' | 'fbx'
    bakeAnimation?: boolean
    exportWithGeometry?: boolean
    animateInPlace?: boolean
    format?: 'GLTF' | 'FBX' | 'USDZ' | 'OBJ' | 'STL' | '3MF'
    textureSize?: number
    textureFormat?: 'JPEG' | 'PNG' | 'WEBP' | 'BMP' | 'DPX' | 'HDR' | 'OPEN_EXR' | 'TARGA' | 'TIFF'
    fbxPreset?: 'blender' | '3dsmax' | 'mixamo' | 'bake_scale'
    pivotToCenterBottom?: boolean
    packUv?: boolean
    exportVertexColors?: boolean
    exportOrientation?: '+x' | '-x' | '+y' | '-y'
    flattenBottom?: boolean
    flattenBottomThreshold?: number
    forceSymmetry?: boolean
    scaleFactor?: number
    withAnimation?: boolean
    textureVersion?: string
    texturePromptText?: string
    pbr?: boolean
    textureSeed?: number
    textureAlignment?: 'original_image' | 'geometry'
    textureQuality?: 'fast' | 'standard' | 'detailed' | 'extreme'
    delight?: boolean
    compress?: string
    name?: string
    outputDir?: string
    graphBinding?: {
      hostId?: string
      nodeId?: string
      assetId?: string
      shotId?: string
      canvasField?: string
    }
  }) => Promise<
    | { op: 'rigCheck'; taskId: string; riggable: boolean; rigType: string }
    | {
        op: 'meshComplete' | 'retopology' | 'retarget' | 'convert' | 'texture'
        taskId: string
        assetId: string
        relativePath: string
        model: string
      }
  >
  /** 当前界面语言（影响默认系统提示词等） */
  locale?: () => string
  /** 图宿主 id，用于执行日志关联 */
  hostId?: () => string
  /** 执行日志会话标题 */
  runTitle?: () => string
  /** 执行日志中的节点展示名（含 i18n） */
  resolveNodeTitle?: (
    node: import('@shared/graph').GraphNode | undefined,
    fallbackId: string
  ) => string
  onNodePatch?: (
    nodeId: string,
    patch: { params?: Partial<GraphNodeParams>; title?: string }
  ) => void
  saveRunMedia?: (input: {
    dataUrl: string
    key: string
    outputDir?: string
    node: import('@shared/graph').GraphNode
  }) => Promise<string>
  saveRunText?: (input: {
    content: string
    key: string
    outputDir?: string
    node: import('@shared/graph').GraphNode
  }) => Promise<string>
  readRunText?: (relativePath: string) => Promise<string>
  /** 覆盖默认 agent-state.json 读取（默认按作用域键读工程 Cache 目录） */
  readEpisodeAgentState?: (scopeKey: string) => Promise<string | null>
  /** 覆盖默认 agent-state.json 写入 */
  writeEpisodeAgentState?: (scopeKey: string, content: string) => Promise<void>
  resolveAssetGenParams?: (assetId: string) => Record<string, unknown> | undefined
  resolveLiveAssetGraph?: (assetId: string) => GraphDocument | undefined
  /** 资产是否仍存在（含草稿）；缺失引用节点执行时短路） */
  hasAsset?: (assetId: string) => boolean
  resolveAssetName?: (assetId: string) => string | undefined
  resolveHostAssetName?: () => string | undefined
  resolveHostAssetId?: () => string | undefined
  resolveAssetText?: (assetId: string) => Promise<string | undefined>
  /** 场参考节点：按 boundBeatId 解析目录行 */
  resolveBeatUnit?: (beatId: string) => import('@shared/graph').BeatRow | null
  /** 工程全局画面风格（生成节点「使用全局风格」时读取） */
  resolveProjectStyleImages?: () => ProjectStyleImage[]
  /** 工程全局随机种子（生成节点「使用全局种子」时读取） */
  resolveProjectGenerateSeed?: () => number | undefined
  /** 世界元素编辑：收集四类子图输出；cookBatch 时入队批跑元素子图 */
  collectWorldElementOutputs?: (
    signal?: AbortSignal,
    options?: { cookBatch?: boolean; nodeId?: string }
  ) => Promise<{
    items: Array<{ type: string; name: string; imageUrl: string }>
  } | null>
  /** world.gen 四类图片组口：params 为空时从 element 子图 soft 收集 */
  resolveWorldElementOutputs?: (
    node: import('@shared/graph').GraphNode
  ) => import('@shared/graph').WorldElementGenResult[]
  /** 场生成：收集各单元子图「场输出」已有文本 */
  collectBeatUnitTexts?: (signal?: AbortSignal) => Promise<{
    items: import('@shared/graph').GraphTextItem[]
  } | null>
  /** 世界元素表格节点：输出当前目录 JSON */
  resolveWorldCatalogJson?: () => string | null
  /** 世界元素表格 / 编辑节点执行时：导入上游提取 JSON 到元素子图 */
  importWorldCatalogJson?: (jsonText: string, sourceNodeId?: string) => void | Promise<void>
  /** 场表格节点：输出当前目录 JSON */
  resolveBeatCatalogJson?: () => string | null
  /** 场表格 / 编辑节点执行时：导入上游拆解 JSON */
  importBeatCatalogJson?: (jsonText: string) => void | Promise<void>
  /** 宿主内图整链：入队任务列表 */
  runHostInnerGraph?: import('@shared/graph').NodeExecuteContext['runHostInnerGraph']
  /**
   * 请求的运行与画布上进行中的链重叠时的回调（重叠即拒绝启动，不做排队）。
   * 用于给用户明确提示，而不是静默失败。
   */
  onRunBlocked?: (info: {
    targetNodeId?: string
    onlyTargetNode?: boolean
    /** 与进行中运行重叠、因而冲突的节点（整图运行时可能为空） */
    conflictNodeIds: string[]
  }) => void
}

/**
 * 画布上的一趟运行（泳道）。
 * 每趟独立持有失控开关与执行日志，因而互不重叠的链可以并行执行。
 */
interface ActiveRun {
  runId: string
  abort: AbortController
  logBridge: ReturnType<typeof createGraphRunLogBridge>
  /** 本趟会写 runStates 的节点 */
  nodeIds: ReadonlySet<string>
  /** 会写子集外节点态（整图运行）→ 与任何并行运行互斥 */
  exclusive: boolean
  targetNodeId?: string
  onlyTargetNode?: boolean
}

export function useGraphRunSession(options: GraphRunSessionOptions) {
  const runStates = reactive<Record<string, GraphNodeRunState>>({})
  /**
   * 进行中的运行趟次。互不重叠的链各自成趟并行执行；
   * 重叠（共用上游）或整图运行时按下标冲突拒绝新趟。
   */
  const activeRuns = shallowRef<ActiveRun[]>([])
  /** 画布上任一趟在跑（工具栏「停止全部」/ 关闭编辑器守卫仍按整画布判断） */
  const isRunning = ref(false)
  const runMessage = ref('')
  const runFailed = ref(false)
  const runSucceeded = ref(false)
  const lastRunResult = ref<GraphRunResult | null>(null)
  /** 最近启动那趟的目标节点；整图运行为 null */
  const runningTargetNodeId = ref<string | null>(null)
  /** 当前 / 最近一次前台运行的日志 runId */
  const lastLogRunId = ref<string | null>(null)

  /** 进行中运行对应的泳道 */
  const activeLanes = computed<GraphRunLane[]>(() =>
    activeRuns.value.map((run) => ({ nodeIds: run.nodeIds, exclusive: run.exclusive }))
  )
  /** 进行中运行正在写状态的节点并集 */
  const activeRunNodeIds = computed<ReadonlySet<string>>(() => {
    const ids = new Set<string>()
    for (const run of activeRuns.value) {
      for (const id of run.nodeIds) ids.add(id)
    }
    return ids
  })

  function isRunActive(run: ActiveRun): boolean {
    return activeRuns.value.includes(run)
  }

  /** 该趟是否已作废（被停止 / 已收尾）——等价于旧实现的 token 失效判断 */
  function isRunStale(run: ActiveRun): boolean {
    return !isRunActive(run) || run.abort.signal.aborted
  }

  function commitActiveRuns(next: ActiveRun[]): void {
    activeRuns.value = next
    isRunning.value = next.length > 0
    runningTargetNodeId.value = next.length ? (next[next.length - 1].targetNodeId ?? null) : null
  }

  function addActiveRun(run: ActiveRun): void {
    commitActiveRuns([...activeRuns.value, run])
  }

  function removeActiveRun(run: ActiveRun): void {
    if (!isRunActive(run)) return
    commitActiveRuns(activeRuns.value.filter((item) => item !== run))
  }

  function message(code: string | undefined): string {
    const keys: Record<string, string> = {
      GRAPH_CANCELLED: 'graph.run.cancelled',
      GRAPH_CYCLE: 'graph.run.cycle',
      GRAPH_NO_OUTPUT: 'graph.run.noOutput',
      GRAPH_UNBOUND_ASSET: 'graph.run.unboundAsset',
      GRAPH_MISSING_ASSET: 'graph.run.missingAsset',
      GRAPH_HOST_INNER_NO_RUNNER: 'graph.run.failed',
      GRAPH_HOST_INNER_NO_GRAPH: 'graph.run.hostNoGraph',
      GRAPH_HOST_INNER_FAILED: 'graph.run.failed',
      GRAPH_HOST_INNER_NO_OUTPUT: 'graph.run.noOutput',
      GRAPH_HOST_INNER_ENQUEUE_FAILED: 'graph.run.hostEnqueueFailed',
      GRAPH_PROCESS_NO_INPUT: 'graph.run.noInput',
      GRAPH_DECISIONS_NO_QUESTIONS: 'graph.run.decisionsNoQuestions',
      GRAPH_DECISIONS_UNAVAILABLE: 'graph.run.decisionsUnavailable',
      GRAPH_LIPSYNC_NO_IMAGE: 'graph.run.lipSyncNoVisual',
      GRAPH_LIPSYNC_NO_VISUAL: 'graph.run.lipSyncNoVisual',
      GRAPH_LIPSYNC_NO_AUDIO: 'graph.run.lipSyncNoAudio',
      GRAPH_REDRAW_NO_MASK: 'graph.run.noMask',
      GRAPH_LOCK_NO_CACHE: 'graph.run.lockNoCache',
      GRAPH_HOST_NO_CACHE_COOK: 'graph.run.hostNoCacheCook',
      GRAPH_COMIC_PAGE_EMPTY: 'graph.run.comicPageEmpty',
      COMIC_PAGE_COMPOSE_UNAVAILABLE: 'graph.run.comicPageCompose',
      COMIC_PAGE_COMPOSE_FAILED: 'graph.run.comicPageCompose',
      GRAPH_MODEL_POSE_NO_MODEL: 'graph.run.modelPoseNoModel',
      GRAPH_MODEL_POSE_MCP: 'graph.run.modelPoseMcp',
      GRAPH_MODEL_POSE_NO_MATCH: 'graph.run.modelPoseNoMatch',
      GRAPH_MODEL_POSE_FAILED: 'graph.run.modelPoseFailed',
      GRAPH_MODEL_POSE_EXPORT: 'graph.run.modelPoseExport',
      GRAPH_MODEL_POSE_DSH: 'graph.run.modelPoseDsh',
      GRAPH_MODEL_RIG_NO_MODEL: 'graph.run.modelRigNoModel',
      GRAPH_MODEL_RIG_MCP: 'graph.run.modelRigMcp',
      GRAPH_MODEL_RIG_NO_MATCH: 'graph.run.modelRigNoMatch',
      GRAPH_MODEL_RIG_NO_WEIGHTS: 'graph.run.modelRigNoWeights',
      GRAPH_MODEL_RIG_QA: 'graph.run.modelRigQa',
      GRAPH_MODEL_RIG_STUCK: 'graph.run.modelRigStuck',
      GRAPH_MODEL_RIG_FAILED: 'graph.run.modelRigFailed',
      GRAPH_MODEL_RIG_EXPORT: 'graph.run.modelRigExport',
      GRAPH_MODEL_RIG_DSH: 'graph.run.modelRigDsh',
      GRAPH_MODEL_RIG_PROVIDER: 'graph.run.modelRigProvider',
      GRAPH_MODEL_SEG_NO_MODEL: 'graph.run.modelSegNoModel',
      GRAPH_MODEL_SEG_API: 'graph.run.modelSegApi',
      GRAPH_MODEL_SEG_PROVIDER: 'graph.run.modelSegProvider',
      GRAPH_MODEL_SEG_FAILED: 'graph.run.modelSegFailed',
      GRAPH_MODEL_POST_NO_MODEL: 'graph.run.modelPostNoModel',
      GRAPH_MODEL_POST_API: 'graph.run.modelPostApi',
      GRAPH_MODEL_POST_PROVIDER: 'graph.run.modelPostProvider',
      GRAPH_MODEL_POST_TIMEOUT: 'graph.run.modelPostTimeout',
      GRAPH_MODEL_POST_RESULT: 'graph.run.modelPostResult',
      GRAPH_MODEL_ANIM_NO_MODEL: 'graph.run.modelAnimNoModel',
      GRAPH_MODEL_ANIM_MCP: 'graph.run.modelAnimMcp',
      GRAPH_MODEL_ANIM_EXPORT: 'graph.run.modelAnimExport',
      GRAPH_MODEL_ANIM_DSH: 'graph.run.modelAnimDsh',
      GRAPH_MODEL_DSH_TIMEOUT: 'graph.run.modelDshTimeout',
      GRAPH_MODEL_DSH_RESULT: 'graph.run.modelDshResult',
      GRAPH_MODEL_DSH_EXPORT: 'graph.run.modelDshExport',
      GRAPH_MODEL_DSH_START: 'graph.run.modelDshStart',
      GRAPH_MODEL_DSH_NO_MODEL: 'graph.run.modelPoseNoModel',
      GRAPH_MODEL_ANIM_NO_MATCH: 'graph.run.modelAnimNoMatch',
      GRAPH_MODEL_ANIM_FAILED: 'graph.run.modelAnimFailed',
      // 空间世界导出只认 world_id（上游不是空间世界生成节点 / 世界是旧版本生成的）
      GRAPH_WORLD_EXPORT_NO_WORLD: 'graph.run.worldExportNoWorld'
    }
    if (!code) return options.t('graph.run.failed')
    if (keys[code]) return options.t(keys[code])
    const match = /\b(GRAPH_[A-Z0-9_]+)\b/.exec(code)
    if (match?.[1] && keys[match[1]]) {
      return code.replace(match[1], options.t(keys[match[1]]))
    }
    return code
  }

  function clear(): void {
    for (const key of Object.keys(runStates)) delete runStates[key]
    runMessage.value = ''
    runFailed.value = false
    runSucceeded.value = false
  }

  /** 收尾未完成节点；给定 nodeIds 时只处理该趟的节点，避免打断并行的其它链 */
  function markInterrupted(nodeIds?: Iterable<string>): void {
    const scope = nodeIds ? new Set(nodeIds) : null
    for (const id of Object.keys(runStates)) {
      if (scope && !scope.has(id)) continue
      const state = runStates[id]
      if (state?.status === 'running' || state?.status === 'pending') {
        runStates[id] = {
          status: 'error',
          error: options.t('graph.run.stopped')
        }
      }
    }
  }

  /** 停止单趟运行；同画布并行的其它链不受影响 */
  function stopRun(run: ActiveRun): void {
    if (!isRunActive(run)) return
    run.abort.abort()
    removeActiveRun(run)
    markInterrupted(run.nodeIds)
    run.logBridge.endStopped(options.t('graph.run.stopped'))
    runMessage.value = options.t('graph.run.stopped')
    runFailed.value = false
    runSucceeded.value = false
  }

  /** 停止画布上全部运行（工具栏 / 关画布 / 圆形菜单停止） */
  function stopWorkflow(): void {
    const runs = activeRuns.value
    if (!runs.length) return
    for (const run of runs) run.abort.abort()
    commitActiveRuns([])
    markInterrupted()
    for (const run of runs) run.logBridge.endStopped(options.t('graph.run.stopped'))
    runMessage.value = options.t('graph.run.stopped')
    runFailed.value = false
    runSucceeded.value = false
  }

  function applyNodeUpdate(run: ActiveRun, nodeId: string, state: GraphNodeRunState): void {
    if (!isRunActive(run)) return
    run.logBridge.onNodeUpdate(nodeId, state)
    if (state.status === 'skipped') {
      // 子集外 skipped 不抹掉其它节点；本趟 pending/running → skipped 需写回
      const prev = runStates[nodeId]
      if (prev?.status !== 'pending' && prev?.status !== 'running') return
      runStates[nodeId] = { status: 'skipped' }
      return
    }
    // 输入端口仅写入执行日志，不灌入 UI runStates，避免 dataUrl 膨胀内存
    const { inputs: _inputs, ...rest } = state
    runStates[nodeId] = {
      ...rest,
      error: state.error ? message(state.error) : undefined
    }
  }

  function resolveLogMode(opts: {
    targetNodeId?: string
    onlyTargetNode?: boolean
  }): GraphRunLogMode {
    if (opts.onlyTargetNode) return 'nodeOnly'
    if (opts.targetNodeId) return 'toNode'
    return 'workflow'
  }

  function withAbortSignal<T>(promise: Promise<T>, run: ActiveRun): Promise<T> {
    const { signal } = run.abort
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => reject(new DOMException('Aborted', 'AbortError'))
      signal.addEventListener('abort', onAbort, { once: true })
      promise.then(
        (result) => {
          signal.removeEventListener('abort', onAbort)
          if (isRunStale(run)) {
            reject(new DOMException('Aborted', 'AbortError'))
            return
          }
          resolve(result)
        },
        (err) => {
          signal.removeEventListener('abort', onAbort)
          reject(err)
        }
      )
    })
  }

  function wrapGenerateText(run: ActiveRun) {
    const generateText = options.generateText
    if (!generateText) return undefined
    return async (input: {
      prompt: string
      system?: string
      model?: string
      providerInstanceId?: string
      images?: string[]
    }) => {
      if (isRunStale(run)) {
        throw new DOMException('Aborted', 'AbortError')
      }
      const startedAt = Date.now()
      const request = {
        prompt: input.prompt,
        system: input.system,
        model: input.model,
        providerInstanceId: input.providerInstanceId,
        imageCount: input.images?.length || undefined,
        inputReferenceUrls: summarizeReferenceListForLog(input.images)
      }
      run.logBridge.appendMessage(options.t('graph.logs.submitText'))
      try {
        const value = await withAbortSignal(generateText(input), run)
        run.logBridge.recordApiCall({
          kind: 'generateText',
          request,
          response: { text: value.text, model: value.model },
          durationMs: Math.max(0, Date.now() - startedAt)
        })
        return value
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          run.logBridge.recordApiCall({
            kind: 'generateText',
            request,
            error: err instanceof Error ? err.message : String(err),
            durationMs: Math.max(0, Date.now() - startedAt)
          })
        }
        throw err
      }
    }
  }

  /**
   * 决策判定：与文本同构（同步一次调用），日志里记成独立的 generateDecisions 调用，
   * 便于在「执行日志 · API 调用」里和文本生成区分开。
   */
  function wrapGenerateDecisions(run: ActiveRun) {
    const generateDecisions = options.generateDecisions
    if (!generateDecisions) return undefined
    return async (input: Parameters<NonNullable<typeof generateDecisions>>[0]) => {
      if (isRunStale(run)) {
        throw new DOMException('Aborted', 'AbortError')
      }
      const startedAt = Date.now()
      const request = {
        questions: input.questions.map((q) => ({ key: q.key, type: q.type })),
        model: input.model,
        providerInstanceId: input.providerInstanceId,
        evidenceCount: input.evidence?.length || undefined
      }
      run.logBridge.appendMessage(options.t('graph.logs.submitDecisions'))
      try {
        const value = await withAbortSignal(generateDecisions(input), run)
        run.logBridge.recordApiCall({
          kind: 'generateDecisions',
          request,
          response: { text: value.summary, model: value.model },
          durationMs: Math.max(0, Date.now() - startedAt)
        })
        return value
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          run.logBridge.recordApiCall({
            kind: 'generateDecisions',
            request,
            error: err instanceof Error ? err.message : String(err),
            durationMs: Math.max(0, Date.now() - startedAt)
          })
        }
        throw err
      }
    }
  }

  function wrapGenerateImage(run: ActiveRun) {
    const generateImage = options.generateImage
    if (!generateImage) return undefined
    return async (input: {
      prompt: string
      model?: string
      providerInstanceId?: string
      aspectRatio?: string
      resolution?: string
      quality?: string
      n?: number
      seed?: number
      inputReferences?: string[]
      inputReferenceMeta?: GraphImageReferenceMeta[]
      layerDecomposition?: boolean
    }) => {
      if (isRunStale(run)) {
        throw new DOMException('Aborted', 'AbortError')
      }
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
        layerDecomposition: input.layerDecomposition || undefined
      }
      run.logBridge.appendMessage(options.t('graph.logs.submitImage'))
      try {
        const value = await withAbortSignal(generateImage(input), run)
        run.logBridge.recordApiCall({
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
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          const raw = err instanceof Error ? err.message : String(err)
          const error = formatProviderErrorForLog(raw, options.locale?.())
          run.logBridge.recordApiCall({
            kind: 'generateImage',
            request,
            error,
            durationMs: Math.max(0, Date.now() - startedAt)
          })
          run.logBridge.appendMessage(error, 'error')
          throw new Error(error)
        }
        throw err
      }
    }
  }

  function wrapGenerateVideo(run: ActiveRun) {
    const generateVideo = options.generateVideo
    if (!generateVideo) return undefined
    return async (input: {
      prompt: string
      model?: string
      providerInstanceId?: string
      duration?: number
      resolution?: string
      aspectRatio?: string
      generateAudio?: boolean
      seed?: number
      firstFrameImageUrl?: string
      lastFrameImageUrl?: string
      inputReferences?: Array<
        string | { kind: 'image_url' | 'video_url' | 'audio_url'; url: string }
      >
      graphBinding?: {
        hostId?: string
        nodeId?: string
        assetId?: string
        shotId?: string
        canvasField?: string
      }
    }) => {
      if (isRunStale(run)) {
        throw new DOMException('Aborted', 'AbortError')
      }
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
      run.logBridge.appendMessage(options.t('graph.logs.submitVideo'))
      const progressNodeId =
        input.graphBinding?.nodeId?.trim() || run.logBridge.currentRunningNodeId() || undefined
      const stopProgress = subscribeVideoJobProgress({
        nodeId: progressNodeId,
        onMessage: (message) => run.logBridge.appendMessage(message),
        format: (job) => formatVideoJobProgressMessage(job, options.t)
      })
      try {
        const value = await withAbortSignal(generateVideo(input), run)
        if (value.uploads?.length) {
          request.uploads = value.uploads.map((item) => ({
            sourceLabel: item.sourceLabel,
            objectKey: item.objectKey,
            bytes: item.bytes,
            urlPreview: item.url.slice(0, 120)
          }))
          for (const item of value.uploads) {
            for (const log of item.logs) {
              run.logBridge.appendMessage(`[ObjectStorage] ${log.message}`, log.level)
            }
          }
        }
        run.logBridge.recordApiCall({
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
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          run.logBridge.recordApiCall({
            kind: 'generateVideo',
            request,
            error: err instanceof Error ? err.message : String(err),
            durationMs: Math.max(0, Date.now() - startedAt)
          })
        }
        throw err
      } finally {
        stopProgress()
      }
    }
  }

  function wrapGenerateSpeech(run: ActiveRun) {
    const generateSpeech = options.generateSpeech
    if (!generateSpeech) return undefined
    return async (input: {
      input: string
      model?: string
      providerInstanceId?: string
      voice?: string
      name?: string
      images?: string[]
    }) => {
      if (isRunStale(run)) {
        throw new DOMException('Aborted', 'AbortError')
      }
      const startedAt = Date.now()
      const request = {
        input: input.input,
        model: input.model,
        providerInstanceId: input.providerInstanceId,
        // 节点上填的声音。真正发出去的声音由主进程补齐（设置里的默认音色 →
        // 模型目录声明的第一个 → 适配器兜底），所以这里可能是 undefined，
        // 排查 400 时要连着响应里的 voice 一起看。
        voice: input.voice,
        name: input.name,
        imageCount: input.images?.length,
        inputReferenceUrls: summarizeReferenceListForLog(input.images)
      }
      run.logBridge.appendMessage(options.t('graph.logs.submitSpeech'))
      try {
        const value = await withAbortSignal(generateSpeech(input), run)
        run.logBridge.recordApiCall({
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
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          run.logBridge.recordApiCall({
            kind: 'generateSpeech',
            request,
            error: err instanceof Error ? err.message : String(err),
            durationMs: Math.max(0, Date.now() - startedAt)
          })
        }
        throw err
      }
    }
  }

  function wrapGenerateModel3d(run: ActiveRun) {
    const generateModel3d = options.generateModel3d
    if (!generateModel3d) return undefined
    return async (input: {
      prompt: string
      model?: string
      providerInstanceId?: string
      style?: string
      inputReferences?: Array<{ kind: 'image_url' | 'video_url' | 'audio_url'; url: string }>
      outputDir?: string
      name?: string
      graphBinding?: {
        hostId?: string
        nodeId?: string
        assetId?: string
        shotId?: string
        canvasField?: string
      }
    }) => {
      if (isRunStale(run)) {
        throw new DOMException('Aborted', 'AbortError')
      }
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
      run.logBridge.appendMessage(options.t('graph.logs.submitModel3d'))
      const progressNodeId =
        input.graphBinding?.nodeId?.trim() || run.logBridge.currentRunningNodeId() || undefined
      const stopProgress = subscribeVideoJobProgress({
        nodeId: progressNodeId,
        onMessage: (message) => run.logBridge.appendMessage(message),
        format: (job) => formatVideoJobProgressMessage(job, options.t)
      })
      try {
        const value = await withAbortSignal(generateModel3d(input), run)
        if (value.uploads?.length) {
          request.uploads = value.uploads.map((item) => ({
            sourceLabel: item.sourceLabel,
            objectKey: item.objectKey,
            bytes: item.bytes,
            urlPreview: item.url.slice(0, 120)
          }))
          for (const item of value.uploads) {
            for (const log of item.logs) {
              run.logBridge.appendMessage(`[ObjectStorage] ${log.message}`, log.level)
            }
          }
        }
        run.logBridge.recordApiCall({
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
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          run.logBridge.recordApiCall({
            kind: 'generateModel3d',
            request,
            error: err instanceof Error ? err.message : String(err),
            durationMs: Math.max(0, Date.now() - startedAt)
          })
        }
        throw err
      } finally {
        stopProgress()
      }
    }
  }

  function wrapGenerateSpatialWorld(run: ActiveRun) {
    const generateSpatialWorld = options.generateSpatialWorld
    if (!generateSpatialWorld) return undefined
    return async (input: {
      prompt: string
      model?: string
      providerInstanceId?: string
      inputReferences?: Array<{ kind: 'image_url' | 'video_url' | 'audio_url'; url: string }>
      outputDir?: string
      name?: string
      displayName?: string
      seed?: number
      panoMode?: 'auto' | 'always' | 'never'
      disableRecaption?: boolean
      graphBinding?: {
        hostId?: string
        nodeId?: string
        assetId?: string
        shotId?: string
        canvasField?: string
      }
    }) => {
      if (isRunStale(run)) {
        throw new DOMException('Aborted', 'AbortError')
      }
      const startedAt = Date.now()
      const request: {
        prompt: string
        model?: string
        providerInstanceId?: string
        seed?: number
        panoMode?: 'auto' | 'always' | 'never'
        disableRecaption?: boolean
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
        panoMode: input.panoMode,
        disableRecaption: input.disableRecaption || undefined,
        inputReferenceCount: input.inputReferences?.length || undefined,
        inputReferenceUrls: summarizeReferenceListForLog(input.inputReferences)
      }
      run.logBridge.appendMessage(options.t('graph.logs.submitSpatialWorld'))
      const progressNodeId =
        input.graphBinding?.nodeId?.trim() || run.logBridge.currentRunningNodeId() || undefined
      const stopProgress = subscribeVideoJobProgress({
        nodeId: progressNodeId,
        onMessage: (message) => run.logBridge.appendMessage(message),
        format: (job) => formatVideoJobProgressMessage(job, options.t)
      })
      try {
        const value = await withAbortSignal(generateSpatialWorld(input), run)
        if (value.uploads?.length) {
          request.uploads = value.uploads.map((item) => ({
            sourceLabel: item.sourceLabel,
            objectKey: item.objectKey,
            bytes: item.bytes,
            urlPreview: item.url.slice(0, 120)
          }))
          for (const item of value.uploads) {
            for (const log of item.logs) {
              run.logBridge.appendMessage(`[ObjectStorage] ${log.message}`, log.level)
            }
          }
        }
        // 参考媒体的托管上传 / 回退说明（不依赖对象存储那条路也在这里留痕）
        for (const note of value.referenceNotes ?? []) {
          run.logBridge.appendMessage(note, 'info')
        }
        run.logBridge.recordApiCall({
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
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          run.logBridge.recordApiCall({
            kind: 'generateSpatialWorld',
            request,
            error: err instanceof Error ? err.message : String(err),
            durationMs: Math.max(0, Date.now() - startedAt)
          })
        }
        throw err
      } finally {
        stopProgress()
      }
    }
  }

  /**
   * 空间世界导出（`spatialWorld.export` 节点）：HQ 网格导出可能等上一小时，
   * 与其它长任务一致地记运行日志 + 复用 videoJob 进度订阅。
   */
  function wrapExportWorld(run: ActiveRun) {
    const exportWorld = options.exportWorld
    if (!exportWorld) return undefined
    return async (input: {
      spatialWorldId: string
      assetType: 'splats' | 'mesh'
      format: 'ply' | 'glb'
      meshVariant?: 'textured' | 'vertex_colored'
      resolution?: 'full_res' | '500k' | '150k' | '100k'
      providerInstanceId?: string
      model?: string
      sourceRelativePath?: string
      outputDir?: string
      name?: string
      graphBinding?: {
        hostId?: string
        nodeId?: string
        assetId?: string
        shotId?: string
        canvasField?: string
      }
    }) => {
      if (isRunStale(run)) {
        throw new DOMException('Aborted', 'AbortError')
      }
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
      run.logBridge.appendMessage(options.t('graph.logs.submitSpatialWorldExport'))
      const progressNodeId =
        input.graphBinding?.nodeId?.trim() || run.logBridge.currentRunningNodeId() || undefined
      const stopProgress = subscribeVideoJobProgress({
        nodeId: progressNodeId,
        onMessage: (message) => run.logBridge.appendMessage(message),
        format: (job) => formatVideoJobProgressMessage(job, options.t)
      })
      try {
        const value = await withAbortSignal(exportWorld(input), run)
        run.logBridge.recordApiCall({
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
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          run.logBridge.recordApiCall({
            kind: 'exportWorld',
            request,
            error: err instanceof Error ? err.message : String(err),
            durationMs: Math.max(0, Date.now() - startedAt)
          })
        }
        throw err
      } finally {
        stopProgress()
      }
    }
  }

  function wrapRigModel3d(run: ActiveRun) {
    const rigModel3d = options.rigModel3d
    if (!rigModel3d) return undefined
    return async (input: {
      modelRelativePath?: string
      modelUrl?: string
      model?: string
      providerInstanceId?: string
      rigType?: string
      spec?: 'tripo' | 'mixamo'
      outFormat?: 'glb' | 'fbx'
      name?: string
      outputDir?: string
      graphBinding?: {
        hostId?: string
        nodeId?: string
        assetId?: string
        shotId?: string
        canvasField?: string
      }
    }) => {
      if (isRunStale(run)) {
        throw new DOMException('Aborted', 'AbortError')
      }
      run.logBridge.appendMessage(options.t('graph.logs.submitRig'))
      return withAbortSignal(rigModel3d(input), run)
    }
  }

  function wrapSegmentModel3d(run: ActiveRun) {
    const segmentModel3d = options.segmentModel3d
    if (!segmentModel3d) return undefined
    return async (input: {
      modelRelativePath?: string
      modelUrl?: string
      model?: string
      providerInstanceId?: string
      mode?: 'mesh' | 'smart'
      granularity?: 'simple' | 'balanced' | 'detailed'
      splitByConnectivity?: boolean
      smartGranularity?: 'coarse' | 'medium' | 'fine'
      hint?: string
      name?: string
      outputDir?: string
      graphBinding?: {
        hostId?: string
        nodeId?: string
        assetId?: string
        shotId?: string
        canvasField?: string
      }
    }) => {
      if (isRunStale(run)) {
        throw new DOMException('Aborted', 'AbortError')
      }
      run.logBridge.appendMessage(options.t('graph.logs.submitSegment'))
      return withAbortSignal(segmentModel3d(input), run)
    }
  }

  function wrapPostProcessModel3d(run: ActiveRun) {
    const postProcessModel3d = options.postProcessModel3d
    if (!postProcessModel3d) return undefined
    return async (input: {
      op: 'meshComplete' | 'retopology' | 'rigCheck' | 'retarget' | 'convert' | 'texture'
      providerTaskId?: string
      modelUrl?: string
      modelRelativePath?: string
      providerInstanceId?: string
      model?: string
      partNames?: string[]
      completionMode?: 'ai_completion' | 'quick_cap'
      retopologyMode?: 'smart' | 'basic'
      faceLimit?: number
      quad?: boolean
      bake?: boolean
      animation?: string
      animations?: string[]
      actionIds?: number[]
      outFormat?: 'glb' | 'fbx'
      bakeAnimation?: boolean
      exportWithGeometry?: boolean
      animateInPlace?: boolean
      format?: 'GLTF' | 'FBX' | 'USDZ' | 'OBJ' | 'STL' | '3MF'
      textureSize?: number
      textureFormat?:
        'JPEG' | 'PNG' | 'WEBP' | 'BMP' | 'DPX' | 'HDR' | 'OPEN_EXR' | 'TARGA' | 'TIFF'
      fbxPreset?: 'blender' | '3dsmax' | 'mixamo' | 'bake_scale'
      pivotToCenterBottom?: boolean
      packUv?: boolean
      withAnimation?: boolean
      textureVersion?: string
      texturePromptText?: string
      pbr?: boolean
      textureSeed?: number
      textureAlignment?: 'original_image' | 'geometry'
      textureQuality?: 'fast' | 'standard' | 'detailed' | 'extreme'
      name?: string
      outputDir?: string
      graphBinding?: {
        hostId?: string
        nodeId?: string
        assetId?: string
        shotId?: string
        canvasField?: string
      }
    }) => {
      if (isRunStale(run)) {
        throw new DOMException('Aborted', 'AbortError')
      }
      run.logBridge.appendMessage(options.t('graph.logs.submitPostProcess'))
      return withAbortSignal(postProcessModel3d(input), run)
    }
  }

  async function executeRun(opts: {
    targetNodeId?: string
    clearAll: boolean
    preserveOutsideSubset: boolean
    onlyTargetNode?: boolean
    skipCompletedNodes?: boolean
    cookHostInnerGraph?: boolean
  }): Promise<GraphRunResult | null> {
    // 先算本趟泳道：重叠（共用上游）或整图运行与进行中的链冲突时拒绝启动。
    // 拒绝而非排队，与任务清单的重复入队语义一致。
    const planningGraph = options.buildGraph()
    const targeting = resolveGraphRunTargeting(planningGraph, {
      targetNodeId: opts.targetNodeId,
      onlyTargetNode: opts.onlyTargetNode
    })
    const planLane: GraphRunLane = {
      nodeIds: targeting?.subset ?? new Set(planningGraph.nodes.map((node) => node.id)),
      // 与 runGraph 的 skipped 发布条件一致：子集外写状态 → 与任何并行运行互斥
      exclusive: !opts.preserveOutsideSubset && !targeting?.onlyTarget
    }
    const conflictIndex = findConflictingGraphRunLane(planLane, activeLanes.value)
    if (conflictIndex >= 0) {
      options.onRunBlocked?.({
        targetNodeId: opts.targetNodeId,
        onlyTargetNode: opts.onlyTargetNode,
        conflictNodeIds: listGraphRunLaneOverlap(planLane, activeLanes.value[conflictIndex])
      })
      return null
    }

    options.commitLocal()
    if (opts.clearAll) clear()
    const runId = `graph-run-${crypto.randomUUID()}`
    lastLogRunId.value = runId
    const targetNode = opts.targetNodeId
      ? planningGraph.nodes.find((n) => n.id === opts.targetNodeId)
      : undefined
    const targetLabel = opts.targetNodeId
      ? options.resolveNodeTitle?.(targetNode, opts.targetNodeId) ||
        targetNode?.title?.trim() ||
        opts.targetNodeId
      : ''
    const startMessage = !opts.targetNodeId
      ? options.t('graph.logs.startWorkflow')
      : opts.onlyTargetNode
        ? options.t('graph.logs.startNodeOnly', { name: targetLabel })
        : options.t('graph.logs.startToNode', { name: targetLabel })
    const logBridge = createGraphRunLogBridge({
      runId,
      title: options.runTitle?.() || options.t('graph.logs.defaultTitle'),
      hostId: options.hostId?.(),
      mode: resolveLogMode(opts),
      graph: planningGraph,
      targetNodeId: opts.targetNodeId,
      resolveErrorMessage: (code) => message(code),
      resolveNodeTitle: options.resolveNodeTitle,
      startMessage
    })
    const run: ActiveRun = {
      runId,
      abort: new AbortController(),
      logBridge,
      nodeIds: planLane.nodeIds,
      exclusive: planLane.exclusive,
      targetNodeId: opts.targetNodeId,
      onlyTargetNode: opts.onlyTargetNode
    }
    // 先登记再 await：冲突判断与 UI 状态必须同步生效，避免连点开出两趟重叠运行
    addActiveRun(run)
    const signal = run.abort.signal
    await nextTick()
    const graph = options.buildGraph()
    try {
      const result = await runGraph(graph, {
        signal,
        stepDelayMs: 100,
        // 整图工作流容错：任一节点失败不整链中断（降级继续）；单节点调试保持严格
        continueOnError: !opts.targetNodeId && !opts.onlyTargetNode,
        targetNodeId: opts.targetNodeId,
        onlyTargetNode: opts.onlyTargetNode,
        skipCompletedNodes: opts.skipCompletedNodes,
        cookHostInnerGraph: opts.cookHostInnerGraph,
        priorNodeStates: { ...runStates },
        preserveOutsideSubset: opts.preserveOutsideSubset,
        onNodeUpdate: (nodeId, state) => applyNodeUpdate(run, nodeId, state),
        onLog: (_nodeId, message, level) => {
          if (isRunStale(run)) return
          run.logBridge.appendMessage(message, level)
        },
        generateText: wrapGenerateText(run),
        generateDecisions: wrapGenerateDecisions(run),
        generateImage: wrapGenerateImage(run),
        generateVideo: wrapGenerateVideo(run),
        generateSpeech: wrapGenerateSpeech(run),
        generateModel3d: wrapGenerateModel3d(run),
        generateSpatialWorld: wrapGenerateSpatialWorld(run),
        lookupSpatialWorldId: options.lookupSpatialWorldId,
        exportWorld: wrapExportWorld(run),
        rigModel3d: wrapRigModel3d(run),
        segmentModel3d: wrapSegmentModel3d(run),
        postProcessModel3d: wrapPostProcessModel3d(run),
        locale: options.locale?.(),
        resolveAssetGenParams: options.resolveAssetGenParams,
        resolveLiveAssetGraph: options.resolveLiveAssetGraph,
        hasAsset: options.hasAsset,
        resolveAssetName: options.resolveAssetName,
        resolveHostAssetName: options.resolveHostAssetName,
        resolveHostAssetId: options.resolveHostAssetId,
        resolveAssetText: options.resolveAssetText ?? resolveAssetTextById,
        resolveBeatUnit: options.resolveBeatUnit,
        collectWorldElementOutputs: options.collectWorldElementOutputs,
        resolveWorldElementOutputs: options.resolveWorldElementOutputs,
        collectBeatUnitTexts: options.collectBeatUnitTexts,
        resolveWorldCatalogJson: options.resolveWorldCatalogJson,
        importWorldCatalogJson: options.importWorldCatalogJson,
        resolveBeatCatalogJson: options.resolveBeatCatalogJson,
        importBeatCatalogJson: options.importBeatCatalogJson,
        runHostInnerGraph: options.runHostInnerGraph,
        resolveImageUrls: resolveGraphImageUrls,
        resolveVideoFirstFrameImageUrls,
        resolveVideoFrameImageUrls: resolveVideoReviewFrameImageUrls,
        resolveStyleImageUrls: resolveStyleImageUrls,
        resolveProjectStyleImages:
          options.resolveProjectStyleImages ?? (() => [] as ProjectStyleImage[]),
        resolveProjectGenerateSeed: options.resolveProjectGenerateSeed ?? (() => undefined),
        enrichStyleImages: (images) =>
          enrichStyleImagesWithLibraryPrompts(images, options.locale?.() ?? 'zh-CN'),
        resolveImageGenerateCapabilities: resolveImageGenerateCapabilitiesForRun,
        resolveVideoGenerateCapabilities: resolveVideoGenerateCapabilitiesForRun,
        resolveAssetImageUrl,
        resolveAssetMediaUrl: resolveAssetMediaDataUrl,
        // 人像处理「以上次出图结果为底」需要按工程相对路径取图（产物是相对路径，不是 assetId）
        resolveProjectMediaUrl: (relativePath: string) => resolveAssetFileUrl(relativePath),
        composeImageExpandCanvas,
        composeImageRedrawCanvas,
        composeImageCropCanvas,
        composeImageTransformCanvas,
        composeImageCutoutCanvas,
        composeImageAlignCanvas,
        composeImageComposeCanvas,
        composeStage2dCanvas,
        composeStage2dFrameSheet,
        composeImageGridCell,
        composeGifFrames: composeAnim2dGif,
        renderSvgFrames,
        composeImageIconPackSheet,
        composeImageLayerStack,
        composeComicPageImage,
        composePortraitIdPhoto,
        composePortraitScopedRetouch,
        detectPortraitFaces,
        inspectImageSize,
        fitPortraitToSourceSize,
        flattenPortraitBackground,
        inspectModelSkeleton,
        runBlenderDshJob: (input) => runBlenderDshJob({ ...input, logRunId: run.runId }),
        buildGamePlayProject: buildGamePlayProjectForNode,
        runBlenderMcpTool: (input) =>
          window.studio.runBlenderMcpTool({
            name: input.name,
            args: input.args ?? {},
            timeoutMs: input.timeoutMs
          }),
        normalizeImageAspectRatio,
        onNodePatch: (nodeId, patch) => {
          if (isRunStale(run)) return
          options.onNodePatch?.(nodeId, patch)
        },
        saveRunMedia: options.saveRunMedia,
        saveRunText: options.saveRunText,
        readRunText: options.readRunText,
        readEpisodeAgentState: options.readEpisodeAgentState ?? readEpisodeAgentState,
        writeEpisodeAgentState: options.writeEpisodeAgentState ?? writeEpisodeAgentState
      })
      if (result) {
        // 导演审核回标：把 PASS/FAIL 与原因写到审核节点和对应生成节点
        applyEpisodeReviewMarks(graph.nodes, (nodeId, params) => {
          if (isRunStale(run)) return
          options.onNodePatch?.(nodeId, { params })
        })
      }
      // 被停止的趟已由 stopRun 收尾；此处不再写横幅与状态
      if (!isRunActive(run)) return null
      lastRunResult.value = result
      if (signal.aborted || result.error === 'GRAPH_CANCELLED') {
        runMessage.value = options.t('graph.run.stopped')
        markInterrupted(run.nodeIds)
        logBridge.endFromResult(result, {
          aborted: true,
          message: options.t('graph.run.stopped')
        })
        return result
      }
      if (result.ok) {
        const summary = summarizeGraphRunOutput(result)
        const key = pickGraphRunSuccessMessageKey(summary)
        runSucceeded.value = true
        runMessage.value = options.t(`graph.run.${key}`, {
          visual: summary.visual,
          voice: summary.voice,
          text: summary.text,
          images: summary.images
        })
        logBridge.endFromResult(result, { message: runMessage.value })
      } else {
        runFailed.value = true
        runMessage.value = message(result.error)
        logBridge.endFromResult(result, { message: runMessage.value })
      }
      return result
    } catch (error) {
      if (!isRunActive(run)) return null
      if (signal.aborted) {
        runMessage.value = options.t('graph.run.stopped')
        markInterrupted(run.nodeIds)
        logBridge.endFromResult(null, {
          aborted: true,
          message: options.t('graph.run.stopped')
        })
        return null
      }
      runFailed.value = true
      runMessage.value = message(error instanceof Error ? error.message : String(error))
      logBridge.endFromResult(null, { message: runMessage.value })
      return null
    } finally {
      if (isRunActive(run)) {
        // 把最新 runStates / 节点写回宿主图，避免只跑图未改结构时关窗丢失
        options.commitLocal()
        const settledGraph = options.buildGraph()
        void Promise.resolve(
          options.afterRunCommit?.({
            graph: settledGraph,
            runStates: { ...runStates },
            result: lastRunResult.value
          })
        ).catch(() => undefined)
        removeActiveRun(run)
      }
    }
  }

  async function runWorkflow(): Promise<GraphRunResult | null> {
    return executeRun({ clearAll: true, preserveOutsideSubset: false })
  }

  /** 当前节点 + 上游（全部重跑） */
  async function runToNode(nodeId: string): Promise<GraphRunResult | null> {
    const graph = options.buildGraph()
    const node = graph.nodes.find((n) => n.id === nodeId)
    // 边界输出：只软透传上游，不重跑生成
    if (node && isBoundaryOutputNode(node)) {
      return runNodeOnly(nodeId)
    }
    return executeRun({
      targetNodeId: nodeId,
      clearAll: false,
      preserveOutsideSubset: true
    })
  }

  /** 当前节点 + 上游（跳过已成功节点；目标始终执行） */
  async function runToNodeSkippingDone(nodeId: string): Promise<GraphRunResult | null> {
    const graph = options.buildGraph()
    const node = graph.nodes.find((n) => n.id === nodeId)
    if (node && isBoundaryOutputNode(node)) {
      return runNodeOnly(nodeId)
    }
    return executeRun({
      targetNodeId: nodeId,
      clearAll: false,
      preserveOutsideSubset: true,
      skipCompletedNodes: true
    })
  }

  /** 仅当前节点（节点按钮 / Inspector）；宿主默认不 cook 内图 */
  async function runNodeOnly(nodeId: string): Promise<GraphRunResult | null> {
    return executeRun({
      targetNodeId: nodeId,
      clearAll: false,
      preserveOutsideSubset: true,
      onlyTargetNode: true,
      cookHostInnerGraph: false
    })
  }

  /** 仅 cook 当前节点嵌套子图（宿主内图 / 批量子图编排；圆形菜单「Cook 子图」） */
  async function runHostCook(nodeId: string): Promise<GraphRunResult | null> {
    return executeRun({
      targetNodeId: nodeId,
      clearAll: false,
      preserveOutsideSubset: true,
      onlyTargetNode: true,
      cookHostInnerGraph: true
    })
  }

  function nodeStatus(nodeId: string): GraphNodeRunStatus | undefined {
    return runStates[nodeId]?.status
  }

  function isNodeActivelyRunning(nodeId: string): boolean {
    if (!activeRunNodeIds.value.has(nodeId)) return false
    const status = nodeStatus(nodeId)
    return status === 'pending' || status === 'running'
  }

  /** 节点属于哪一趟进行中的运行（不属于任何趟返回 undefined） */
  function activeRunForNode(nodeId: string): ActiveRun | undefined {
    return activeRuns.value.find((run) => run.nodeIds.has(nodeId))
  }

  /**
   * 节点卡 / Inspector：只跑当前节点。
   * 该趟正在跑这个节点（或它本就是这趟的目标）→ 停止那趟，不影响并行的其它链；
   * 其余情况启动新的一趟，重叠时由 executeRun 拒绝并提示。
   */
  function toggleNodeRun(nodeId: string): void {
    const owner = activeRunForNode(nodeId)
    if (owner && (isNodeActivelyRunning(nodeId) || owner.targetNodeId === nodeId)) {
      stopRun(owner)
      return
    }
    void runNodeOnly(nodeId)
  }

  /**
   * 窗口工具栏：有选中节点 → 当前+上游；无选中 → 整图到输出。
   * 由宿主传入 selectedNodeId。工具栏保持全局语义：任一趟在跑即「停止全部」。
   */
  function togglePlayStop(selectedNodeId?: string | null): void {
    if (isRunning.value) {
      stopWorkflow()
      return
    }
    if (selectedNodeId) void runToNode(selectedNodeId)
    else void runWorkflow()
  }

  function exportRunStatesSnapshot(nodeIds: Iterable<string>) {
    return exportPersistedRunStates(runStates, nodeIds)
  }

  function importRunStatesSnapshot(
    snapshot: Parameters<typeof importPersistedRunStates>[1],
    nodeIds: Iterable<string>
  ): void {
    importPersistedRunStates(runStates, snapshot, nodeIds)
  }

  return {
    runStates,
    isRunning,
    runMessage,
    runFailed,
    runSucceeded,
    lastRunResult,
    lastLogRunId,
    runningTargetNodeId,
    runWorkflow,
    runToNode,
    runToNodeSkippingDone,
    runNodeOnly,
    runHostCook,
    stopWorkflow,
    togglePlayStop,
    toggleNodeRun,
    nodeStatus,
    isNodeActivelyRunning,
    /** 进行中运行的泳道（供画布计算「哪些节点会冲突」） */
    activeLanes,
    /** 进行中运行正在写状态的节点并集 */
    activeRunNodeIds,
    exportRunStatesSnapshot,
    importRunStatesSnapshot
  }
}
