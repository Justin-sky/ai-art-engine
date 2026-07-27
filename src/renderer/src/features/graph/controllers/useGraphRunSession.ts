import { nextTick, reactive, ref } from 'vue'
import type {
  AssetType,
  ProjectStyleImage,
  ShotAudioRef,
  ShotGenRef,
  ShotStoryboard
} from '@shared/domain'
import {
  exportPersistedRunStates,
  importPersistedRunStates,
  pickGraphRunSuccessMessageKey,
  runGraph,
  summarizeGraphRunOutput,
  type GraphDocument,
  type GraphNodeParams,
  type GraphNodeRunState,
  type GraphNodeRunStatus,
  type GraphRunLogMode,
  type GraphRunResult
} from '@shared/graph'
import { createGraphRunLogBridge } from '../model/graphRunLogBridge'
import { formatProviderErrorForLog } from '../model/formatProviderErrorForLog'
import { resolveImageGenerateCapabilitiesForRun } from '../model/imageGenerateCapabilities'
import { resolveVideoGenerateCapabilitiesForRun } from '../model/videoGenerateCapabilities'
import {
  resolveAssetImageUrl,
  resolveAssetMediaDataUrl,
  resolveGraphImageUrls
} from '../model/resolveGraphImageUrls'
import { resolveAssetText as resolveAssetTextById } from '../../media/resolveAssetText'
import { composeImageExpandCanvas } from '../model/composeImageExpandCanvas'
import { composeImageRedrawCanvas } from '../model/composeImageRedrawCanvas'
import { composeImageCropCanvas } from '../model/composeImageCropCanvas'
import { composeImageGridCell } from '../model/composeImageGridCell'
import { enrichStyleImagesWithLibraryPrompts } from '../../stylePresets/defaultLibrary'
import { resolveStyleImageUrls } from '../../stylePresets/resolveStyleImageUrls'

export interface GraphRunSessionOptions {
  buildGraph: () => GraphDocument
  commitLocal: () => void
  t: (key: string, params?: Record<string, unknown>) => string
  generateText?: (input: {
    prompt: string
    system?: string
    model?: string
    providerInstanceId?: string
    images?: string[]
  }) => Promise<{ text: string; model: string }>
  generateImage?: (input: {
    prompt: string
    model?: string
    providerInstanceId?: string
    aspectRatio?: string
    resolution?: string
    quality?: string
    n?: number
    inputReferences?: string[]
  }) => Promise<{ images: string[]; model: string }>
  generateVideo?: (input: {
    prompt: string
    model?: string
    providerInstanceId?: string
    duration?: number
    resolution?: string
    aspectRatio?: string
    generateAudio?: boolean
    inputReferences?: Array<
      | string
      | { kind: 'image_url' | 'video_url' | 'audio_url'; url: string }
    >
    outputDir?: string
  }) => Promise<{
    assetId: string
    relativePath: string
    model: string
    tosUploads?: Array<{
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
  resolveAssetGenParams?: (assetId: string) => Record<string, unknown> | undefined
  resolveAssetName?: (assetId: string) => string | undefined
  resolveHostAssetName?: () => string | undefined
  resolveAssetText?: (assetId: string) => Promise<string | undefined>
  resolveShotStoryboard?: (boundShotId?: string) => {
    storyboard: ShotStoryboard
    genRefs?: ShotGenRef[]
    audioRefs?: ShotAudioRef[]
    assetNames?: Map<string, string>
    assetTypes?: Map<string, AssetType>
    stylePreset?: string
  } | null
  /** 叙事单元参考节点：按 boundUnitId 解析目录行 */
  resolveNarrativeUnit?: (
    unitId: string
  ) => import('@shared/graph').NarrativeUnitRow | null
  /** 工程全局画面风格（生成节点「使用全局风格」时读取） */
  resolveProjectStyleImages?: () => ProjectStyleImage[]
  /** 分镜表格节点：输出当前分镜列表 JSON */
  resolveShotSplitTableJson?: (opts?: { narrativeUnitId?: string }) => string | null
  /** 分镜表格节点执行时：导入上游拆分 JSON 到分镜列表 */
  importShotSplitTableJson?: (
    jsonText: string,
    opts?: { narrativeUnitId?: string }
  ) => void | Promise<void>
  /** 生成分镜图：收集各镜 visual 图片输出已有结果并写回 genRefs */
  collectScriptShotImages?: (
    signal?: AbortSignal,
    opts?: { narrativeUnitId?: string }
  ) => Promise<{
    images: import('@shared/graph').GraphImageItem[]
    aggregateJson: string
    entities: Array<{ id: string; name: string; imageUrls: string[] }>
  } | null>
  /** 生成分镜视频：收集各镜子图视频生成节点已有结果并写回 genRefs */
  collectScriptShotVideos?: (
    signal?: AbortSignal,
    opts?: { narrativeUnitId?: string }
  ) => Promise<{
    videos: import('@shared/graph').GraphVideoItem[]
    entities: Array<{ id: string; name: string; videoUrls: string[] }>
  } | null>
  /** 世界元素编辑：收集四类子图已完成输出节点实体 */
  collectWorldElementOutputs?: (signal?: AbortSignal) => Promise<{
    items: Array<{ type: string; name: string; imageUrl: string }>
  } | null>
  /** 叙事单元生成：收集各单元子图「叙事输出」已有文本 */
  collectNarrativeUnitTexts?: (signal?: AbortSignal) => Promise<{
    items: import('@shared/graph').GraphTextItem[]
  } | null>
  /** 世界元素表格节点：输出当前目录 JSON */
  resolveWorldCatalogJson?: () => string | null
  /** 世界元素表格 / 编辑节点执行时：导入上游提取 JSON 到元素子图 */
  importWorldCatalogJson?: (jsonText: string) => void | Promise<void>
  /** 叙事单元表格节点：输出当前目录 JSON */
  resolveNarrativeCatalogJson?: () => string | null
  /** 叙事单元表格 / 编辑节点执行时：导入上游拆解 JSON */
  importNarrativeCatalogJson?: (jsonText: string) => void | Promise<void>
  /** 宿主内图整链：入队任务列表 */
  runHostInnerGraph?: import('@shared/graph').NodeExecuteContext['runHostInnerGraph']
}

export function useGraphRunSession(options: GraphRunSessionOptions) {
  const runStates = reactive<Record<string, GraphNodeRunState>>({})
  const isRunning = ref(false)
  const runMessage = ref('')
  const runFailed = ref(false)
  const runSucceeded = ref(false)
  const lastRunResult = ref<GraphRunResult | null>(null)
  /** 本次运行的目标节点；整图运行为 null */
  const runningTargetNodeId = ref<string | null>(null)
  /** 当前 / 最近一次前台运行的日志 runId */
  const lastLogRunId = ref<string | null>(null)
  let abortController: AbortController | null = null
  /** 递增使过期运行的结果写回失效 */
  let runToken = 0
  let activeLogBridge: ReturnType<typeof createGraphRunLogBridge> | null = null

  function message(code: string | undefined): string {
    const keys: Record<string, string> = {
      GRAPH_CANCELLED: 'graph.run.cancelled',
      GRAPH_CYCLE: 'graph.run.cycle',
      GRAPH_NO_OUTPUT: 'graph.run.noOutput',
      GRAPH_UNBOUND_ASSET: 'graph.run.unboundAsset',
      GRAPH_MISSING_ASSET: 'graph.run.missingAsset',
      GRAPH_HOST_INNER_NO_RUNNER: 'graph.run.failed',
      GRAPH_HOST_INNER_FAILED: 'graph.run.failed',
      GRAPH_HOST_INNER_NO_OUTPUT: 'graph.run.noOutput',
      GRAPH_PROCESS_NO_INPUT: 'graph.run.noInput',
      GRAPH_LIPSYNC_NO_IMAGE: 'graph.run.lipSyncNoVisual',
      GRAPH_LIPSYNC_NO_VISUAL: 'graph.run.lipSyncNoVisual',
      GRAPH_LIPSYNC_NO_AUDIO: 'graph.run.lipSyncNoAudio',
      GRAPH_REDRAW_NO_MASK: 'graph.run.noMask',
      GRAPH_LOCK_NO_CACHE: 'graph.run.lockNoCache'
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

  function markInterrupted(): void {
    for (const id of Object.keys(runStates)) {
      const state = runStates[id]
      if (state?.status === 'running' || state?.status === 'pending') {
        runStates[id] = {
          status: 'error',
          error: options.t('graph.run.stopped')
        }
      }
    }
  }

  function stopWorkflow(): void {
    if (!isRunning.value && !abortController) return
    abortController?.abort()
    runToken += 1
    isRunning.value = false
    runningTargetNodeId.value = null
    runMessage.value = options.t('graph.run.stopped')
    runFailed.value = false
    runSucceeded.value = false
    markInterrupted()
    activeLogBridge?.endStopped(options.t('graph.run.stopped'))
    activeLogBridge = null
  }

  function applyNodeUpdate(token: number, nodeId: string, state: GraphNodeRunState): void {
    if (token !== runToken) return
    activeLogBridge?.onNodeUpdate(nodeId, state)
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

  function withAbortSignal<T>(promise: Promise<T>, token: number, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => reject(new DOMException('Aborted', 'AbortError'))
      signal.addEventListener('abort', onAbort, { once: true })
      promise.then(
        (result) => {
          signal.removeEventListener('abort', onAbort)
          if (token !== runToken || signal.aborted) {
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

  function wrapGenerateText(token: number, signal: AbortSignal) {
    const generateText = options.generateText
    if (!generateText) return undefined
    return async (input: {
      prompt: string
      system?: string
      model?: string
      providerInstanceId?: string
      images?: string[]
    }) => {
      if (token !== runToken || signal.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }
      const startedAt = Date.now()
      const request = {
        prompt: input.prompt,
        system: input.system,
        model: input.model,
        providerInstanceId: input.providerInstanceId,
        imageCount: input.images?.length || undefined
      }
      try {
        const value = await withAbortSignal(generateText(input), token, signal)
        activeLogBridge?.recordApiCall({
          kind: 'generateText',
          request,
          response: { text: value.text, model: value.model },
          durationMs: Math.max(0, Date.now() - startedAt)
        })
        return value
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          activeLogBridge?.recordApiCall({
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

  function wrapGenerateImage(token: number, signal: AbortSignal) {
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
      inputReferences?: string[]
    }) => {
      if (token !== runToken || signal.aborted) {
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
        inputReferenceCount: input.inputReferences?.length || undefined
      }
      try {
        const value = await withAbortSignal(generateImage(input), token, signal)
        activeLogBridge?.recordApiCall({
          kind: 'generateImage',
          request,
          response: { model: value.model, imageCount: value.images?.length ?? 0 },
          durationMs: Math.max(0, Date.now() - startedAt)
        })
        return value
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          const raw = err instanceof Error ? err.message : String(err)
          const error = formatProviderErrorForLog(raw)
          activeLogBridge?.recordApiCall({
            kind: 'generateImage',
            request,
            error,
            durationMs: Math.max(0, Date.now() - startedAt)
          })
          activeLogBridge?.appendMessage(error, 'error')
          throw new Error(error)
        }
        throw err
      }
    }
  }

  function wrapGenerateVideo(token: number, signal: AbortSignal) {
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
      inputReferences?: Array<
        | string
        | { kind: 'image_url' | 'video_url' | 'audio_url'; url: string }
      >
    }) => {
      if (token !== runToken || signal.aborted) {
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
        const value = await withAbortSignal(generateVideo(input), token, signal)
        if (value.tosUploads?.length) {
          request.tosUploads = value.tosUploads.map((item) => ({
            sourceLabel: item.sourceLabel,
            objectKey: item.objectKey,
            bytes: item.bytes,
            urlPreview: item.url.slice(0, 120)
          }))
          for (const item of value.tosUploads) {
            for (const log of item.logs) {
              activeLogBridge?.appendMessage(`[TOS] ${log.message}`, log.level)
            }
          }
        }
        activeLogBridge?.recordApiCall({
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
          activeLogBridge?.recordApiCall({
            kind: 'generateVideo',
            request,
            error: err instanceof Error ? err.message : String(err),
            durationMs: Math.max(0, Date.now() - startedAt)
          })
        }
        throw err
      }
    }
  }

  function wrapGenerateSpeech(token: number, signal: AbortSignal) {
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
      if (token !== runToken || signal.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }
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
        const value = await withAbortSignal(generateSpeech(input), token, signal)
        activeLogBridge?.recordApiCall({
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
          activeLogBridge?.recordApiCall({
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

  async function executeRun(opts: {
    targetNodeId?: string
    clearAll: boolean
    preserveOutsideSubset: boolean
    onlyTargetNode?: boolean
    skipCompletedNodes?: boolean
  }): Promise<GraphRunResult | null> {
    if (isRunning.value) return null
    options.commitLocal()
    if (opts.clearAll) clear()
    const token = ++runToken
    isRunning.value = true
    runningTargetNodeId.value = opts.targetNodeId ?? null
    abortController?.abort()
    abortController = new AbortController()
    const signal = abortController.signal
    await nextTick()
    const graph = options.buildGraph()
    const runId = `graph-run-${crypto.randomUUID()}`
    lastLogRunId.value = runId
    const mode = resolveLogMode(opts)
    const targetNode = opts.targetNodeId
      ? graph.nodes.find((n) => n.id === opts.targetNodeId)
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
      mode,
      graph,
      targetNodeId: opts.targetNodeId,
      resolveErrorMessage: (code) => message(code),
      resolveNodeTitle: options.resolveNodeTitle,
      startMessage
    })
    activeLogBridge = logBridge
    try {
      const result = await runGraph(graph, {
        signal,
        stepDelayMs: 100,
        targetNodeId: opts.targetNodeId,
        onlyTargetNode: opts.onlyTargetNode,
        skipCompletedNodes: opts.skipCompletedNodes,
        priorNodeStates: { ...runStates },
        preserveOutsideSubset: opts.preserveOutsideSubset,
        onNodeUpdate: (nodeId, state) => applyNodeUpdate(token, nodeId, state),
        generateText: wrapGenerateText(token, signal),
        generateImage: wrapGenerateImage(token, signal),
        generateVideo: wrapGenerateVideo(token, signal),
        generateSpeech: wrapGenerateSpeech(token, signal),
        locale: options.locale?.(),
        resolveAssetGenParams: options.resolveAssetGenParams,
        resolveAssetName: options.resolveAssetName,
        resolveHostAssetName: options.resolveHostAssetName,
        resolveAssetText: options.resolveAssetText ?? resolveAssetTextById,
        resolveShotStoryboard: options.resolveShotStoryboard,
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
        resolveImageUrls: resolveGraphImageUrls,
        resolveStyleImageUrls: resolveStyleImageUrls,
        resolveProjectStyleImages:
          options.resolveProjectStyleImages ?? (() => [] as ProjectStyleImage[]),
        enrichStyleImages: (images) =>
          enrichStyleImagesWithLibraryPrompts(images, options.locale?.() ?? 'zh-CN'),
        resolveImageGenerateCapabilities: resolveImageGenerateCapabilitiesForRun,
        resolveVideoGenerateCapabilities: resolveVideoGenerateCapabilitiesForRun,
        resolveAssetImageUrl,
        resolveAssetMediaUrl: resolveAssetMediaDataUrl,
        composeImageExpandCanvas,
        composeImageRedrawCanvas,
        composeImageCropCanvas,
        composeImageGridCell,
        onNodePatch: (nodeId, patch) => {
          if (token !== runToken || signal.aborted) return
          options.onNodePatch?.(nodeId, patch)
        },
        saveRunMedia: options.saveRunMedia,
        saveRunText: options.saveRunText,
        readRunText: options.readRunText
      })
      if (token !== runToken) return null
      lastRunResult.value = result
      if (signal.aborted || result.error === 'GRAPH_CANCELLED') {
        runMessage.value = options.t('graph.run.stopped')
        markInterrupted()
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
      if (token !== runToken) return null
      if (signal.aborted) {
        runMessage.value = options.t('graph.run.stopped')
        markInterrupted()
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
      if (token === runToken) {
        // 把最新 runStates / 节点写回宿主图，避免只跑图未改结构时关窗丢失
        options.commitLocal()
        isRunning.value = false
        runningTargetNodeId.value = null
        if (activeLogBridge === logBridge) activeLogBridge = null
      }
    }
  }

  async function runWorkflow(): Promise<GraphRunResult | null> {
    return executeRun({ clearAll: true, preserveOutsideSubset: false })
  }

  /** 当前节点 + 上游（全部重跑） */
  async function runToNode(nodeId: string): Promise<GraphRunResult | null> {
    return executeRun({
      targetNodeId: nodeId,
      clearAll: false,
      preserveOutsideSubset: true
    })
  }

  /** 当前节点 + 上游（跳过已成功节点；目标始终执行） */
  async function runToNodeSkippingDone(nodeId: string): Promise<GraphRunResult | null> {
    return executeRun({
      targetNodeId: nodeId,
      clearAll: false,
      preserveOutsideSubset: true,
      skipCompletedNodes: true
    })
  }

  /** 仅当前节点（节点按钮 / Inspector） */
  async function runNodeOnly(nodeId: string): Promise<GraphRunResult | null> {
    return executeRun({
      targetNodeId: nodeId,
      clearAll: false,
      preserveOutsideSubset: true,
      onlyTargetNode: true
    })
  }

  function nodeStatus(nodeId: string): GraphNodeRunStatus | undefined {
    return runStates[nodeId]?.status
  }

  function isNodeActivelyRunning(nodeId: string): boolean {
    if (!isRunning.value) return false
    const status = nodeStatus(nodeId)
    return status === 'pending' || status === 'running'
  }

  /** 节点卡 / Inspector：只跑当前节点 */
  function toggleNodeRun(nodeId: string): void {
    if (isRunning.value) {
      if (isNodeActivelyRunning(nodeId) || runningTargetNodeId.value === nodeId) {
        stopWorkflow()
      }
      return
    }
    void runNodeOnly(nodeId)
  }

  /**
   * 窗口工具栏：有选中节点 → 当前+上游；无选中 → 整图到输出。
   * 由宿主传入 selectedNodeId。
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
    stopWorkflow,
    togglePlayStop,
    toggleNodeRun,
    nodeStatus,
    isNodeActivelyRunning,
    exportRunStatesSnapshot,
    importRunStatesSnapshot
  }
}
