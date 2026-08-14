import {
  appendStyleImagesReferencePrompt,
  buildGeneratedMediaFileKey,
  formatGeneratedMediaStamp,
  normalizeProjectStyleImages,
  portMentionIndex,
  resolveGenerateStyleImages,
  resolveStyleMentionReserveCount,
  type ProjectStyleImage,
  type StyleReferenceSubject
} from '../../domain'
import type { GraphImageReferenceMeta } from '../../modelProvider'
import type {
  GraphDocument,
  GraphNode,
  GraphNodeParams,
  GraphOutputKind,
  GraphPortDataType
} from '../types'
import {
  GraphPortType,
  isGraphCatalogKind,
  isPluralGraphPortDataType,
  toSingularGraphPortDataType
} from '../types'
import { expandIncomingThroughBundles } from '../bundleExpand'
import { catalogTextFromInputs, catalogValue } from '../catalogValue'
import { isAssetHostNode, isAssetRefNode, isProcessingAssetNode } from '../nodeRole'
import { cloneGraphDocument } from '../document'
import {
  graphValueHasPayload,
  mergeBoundarySoftValues,
  mergeHostInputValues,
  outputsToHostGalleryParams,
  readHostInputSlot,
  softResolveBoundaryOutputValue,
  type ResolveHostInputSlotsOptions
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
import { GRAPH_OUT_ALL_PORT_ID } from '../ports'

export { GRAPH_OUT_ALL_PORT_ID }
import {
  expandInstructionMentions,
  shouldKeepInstructionMentionToken,
  instructionHasMentions,
  type InstructionMentionSource
} from '../instructionMentions'
import type { InstructionPresetKind } from '../instructionPresets'
import {
  applyEpisodeAgentReview,
  createEpisodeAgentState,
  episodeFailReasonForStep,
  parseEpisodeAgentState,
  serializeEpisodeAgentState
} from '../episodeAgentState'
import {
  pickEpisodeAgentPrompt,
  resolveEpisodeDirectorReviewPack
} from '../episodeAgentPrompts'
import {
  parseEpisodeBeatBreakdown,
  selectEpisodeAnchor,
  selectEpisodeAnchors,
  selectEpisodeCell,
  selectEpisodeKeyframeSpans,
  formatEpisodeKeyframeSpanNotes,
  selectEpisodeMotion
} from '../episodeBoardParse'
import {
  resolveImageSystemPrompt,
  resolveGameSystemSystemPrompt,
  resolveOptimizeSystemPrompt,
  resolveScreenplaySystemPrompt,
  resolveWorldExtractSystemPrompt,
  resolveBeatSplitSystemPrompt,
  resolveBeatUnitGenSystemPrompt,
  resolveUiSplitSystemPrompt,
  resolveToPromptSystemPrompt,
  resolveUpscaleSystemPrompt,
  resolveExpandSystemPrompt,
  resolveRedrawSystemPrompt,
  resolveEraseSystemPrompt,
  resolveMatteSystemPrompt,
  resolveMultiAngleSystemPrompt,
  resolveLightingSystemPrompt,
  resolvePortraitTextureSystemPrompt,
  resolveEmotionSystemPrompt,
  resolveVideoSystemPrompt,
  resolveVoiceSystemPrompt
} from '../systemPromptSchemes'
import {
  buildLipSyncPrompt,
  resolveLipSyncSystemPrompt
} from '../lipSync'
import {
  buildReshootPrompt,
  formatReshootTimestamp,
  isValidReshootSegment,
  resolveReshootSystemPrompt
} from '../reshoot'
import {
  buildImagePrompt,
  buildOptimizePrompt,
  buildScreenplayPrompt,
  defaultGameSystemUserPrompt,
  buildWorldExtractPrompt,
  buildBeatSplitPrompt,
  buildBeatUnitGenPrompt,
  buildUiSplitPrompt,
  buildFrameAnimGenPrompt,
  buildToPromptUserPrompt,
  buildVideoPrompt,
  buildVoicePrompt
} from '../userPromptSchemes'
import { resolveAssetTextFromGenParams } from '../assetText'
import {
  resolveImageGenerateParamsForApi,
  imageGenerateParamsToNodePatch,
  resolveMaxInputReferences,
  resolveGenerateSeed
} from '../imageGenerateParams'
import {
  anim2dCellKeys,
  buildAnim2dGridInstruction,
  readAnim2dFromNode,
  resolveAnim2dPreset,
  resolveFrameAnimGenSystemPrompt,
  type Anim2dState
} from '../anim2d'
import {
  VIDEO_FIRST_FRAME_PORT_ID,
  VIDEO_LAST_FRAME_PORT_ID,
  resolveVideoGenerateParamsForApi,
  videoGenerateParamsToNodePatch,
  type VideoGenerateParamCapabilities
} from '../videoGenerateParams'
import { UNKNOWN_VIDEO_PORT_LIMITS } from '../portInputLimits'
import { resolveMotionImageItems, resolveMotionVideoItems } from '../motionShots'
import {
  mergeWorldCatalogPreservingReviewed,
  parseWorldElementCatalog,
  parseWorldElementGenResults,
  stringifyWorldElementCatalog,
  stringifyWorldElementGenResults,
  worldGenImageGroupOutputs,
  type WorldElementGenResult
} from '../worldElementParse'
import {
  mergeBeatRowsPreservingReviewed,
  parseBeatJson,
  stringifyBeatRows
} from '../beatParse'
import {
  parseUiScreenPrompts,
  screensFromUiGenIncoming,
  UI_SPLIT_INNER_GRAPH_VERSION
} from '../uiSplitParse'
import { formatBeatRefText } from '../beatParams'
import {
  multiAngleCameraToNodePatch,
  readMultiAngleCameraFromNode
} from '../multiAngleCamera'
import {
  readLightingSetupFromNode,
  resolveLightingOutputPrompt
} from '../lightingSetup'
import {
  portraitTextureToNodePatch,
  readPortraitTextureFromNode
} from '../portraitTexture'
import { emotionPadToNodePatch, readEmotionPadFromNode } from '../emotionPad'
import {
  readImageUpscaleFromNode,
  resolveUpscaleInstruction,
  upscaleScaleToResolution
} from '../imageUpscale'
import {
  apiAspectRatioForExpand,
  buildExpandPrompt,
  readImageExpandFromNode
} from '../imageExpand'
import {
  apiAspectRatioForRedraw,
  buildRedrawUserPrompt,
  hasRedrawMask,
  readImageRedrawFromNode
} from '../imageRedraw'
import {
  apiAspectRatioForErase,
  buildEraseUserPrompt,
  hasEraseMask,
  readImageEraseFromNode
} from '../imageErase'
import {
  apiAspectRatioForMatte,
  buildMatteUserPrompt,
  hasMatteMask,
  readImageMatteFromNode
} from '../imageMatte'
import { readImageCropFromNode } from '../imageCrop'
import {
  readImageGridSplitFromNode,
  resolveGridSplitTargets
} from '../imageGridSplit'
import type {
  GraphAssetValue,
  GraphImageItem,
  GraphNodeRunState,
  GraphOutputValue,
  GraphTextItem,
  GraphTextValue,
  GraphVoiceItem,
  GraphValue,
  GraphVideoItem,
  NodeExecuteContext
} from './types'
import {
  dedupeGalleryIds,
  dualImageGalleryOutputs,
  dualTextGalleryOutputs,
  dualVideoGalleryOutputs,
  dualVoiceGalleryOutputs,
  flattenAssetValues,
  flattenImagesValues,
  flattenTextValues,
  flattenTextsValues,
  flattenVideosValues,
  flattenVoicesValues,
  imageItemKey,
  newestImageSelectedId,
  newestTextSelectedId,
  newestVideoSelectedId,
  newestVoiceSelectedId,
  pickImageItem,
  pickTextItem,
  pickVideoItem,
  pickVoiceItem,
  stripEmbeddedTextData,
  textItemKey,
  videoItemKey,
  voiceItemKey
} from './gallery'
export {
  flattenAssetValues,
  flattenImagesValues,
  flattenTextValues,
  flattenTextsValues,
  flattenVideosValues,
  flattenVoicesValues,
  imageItemKey,
  pickImageItem,
  pickTextItem,
  pickVideoItem,
  pickVoiceItem,
  textItemKey,
  videoItemKey,
  voiceItemKey
}
import {
  autoIncomingTextForInstruction,
  collectIncomingValues,
  resolveIncomingByIndex,
  selectIncomingValuesForInstruction
} from './incoming'
export {
  collectIncomingValues,
  resolveIncomingByIndex,
  selectIncomingValuesForInstruction
}
import { contributionFromAssets, reindexContribution } from './contribution'
export { contributionFromAssets, reindexContribution }
import {
  commitGeneratedImages,
  commitInMemoryTextGallery,
  dualBeatCatalogOutputs,
  dualWorldCatalogOutputs,
  materializeGeneratedBatch,
  mergeGeneratedImages,
  persistBeatSplitGeneration,
  persistScreenplayGeneration,
  persistVideoGeneration,
  persistVoiceGeneration,
  persistWorldExtractGeneration
} from './materialize'

/** 预览/汇总时按路径补全文；无 readRunText 或无路径则原样返回 */
export async function hydrateTextItems(
  items: GraphTextItem[],
  readRunText?: (relativePath: string) => Promise<string>
): Promise<GraphTextItem[]> {
  if (!items.length) return items
  return Promise.all(
    items.map(async (item) => {
      if (item.text?.trim()) return item
      const relativePath = item.relativePath?.trim()
      if (!relativePath || !readRunText) return item
      try {
        const text = (await readRunText(relativePath))?.trim() ?? ''
        return text ? { ...item, text } : item
      } catch {
        return item
      }
    })
  )
}

/**
 * 按节点参数中的累计图库 + selected*Id 重算 `out` / `out-all`。
 * 用于 soft-resolve / soft-snapshot：避免缓存 outputs.out 与当前选中不一致。
 * `typeId`：世界元素提取等需把 `out` 组装成目录 kind，而非普通 text。
 */
export function resolveGalleryOutputsFromNodeParams(
  params: GraphNodeParams | undefined | null,
  options?: { typeId?: string | null }
): Record<string, GraphValue> | null {
  if (!params) return null

  if (options?.typeId === 'world.gen') {
    const fromParams = Array.isArray(params.worldElementOutputs)
      ? (params.worldElementOutputs as WorldElementGenResult[])
      : []
    const withImages = fromParams.filter(
      (item) => item?.type && item?.name && item?.imageUrl
    )
    const results =
      withImages.length > 0 ? withImages : parseWorldElementGenResults(params.text)
    if (!results.length) return null
    return worldGenImageGroupOutputs(results)
  }

  const generatedImages = params.generatedImages
  if (Array.isArray(generatedImages) && generatedImages.length) {
    const items: GraphImageItem[] = generatedImages.map((item) => ({
      id: item.id,
      dataUrl: item.dataUrl ?? '',
      relativePath: item.relativePath,
      createdAt: item.createdAt
    }))
    const selectedId =
      params.selectedImageId?.trim() || newestImageSelectedId(items)
    return dualImageGalleryOutputs(items, selectedId)
  }

  const generatedVideos = params.generatedVideos
  if (Array.isArray(generatedVideos) && generatedVideos.length) {
    const items: GraphVideoItem[] = generatedVideos.map((item) => ({
      id: item.id,
      dataUrl: item.dataUrl ?? '',
      relativePath: item.relativePath,
      createdAt: item.createdAt
    }))
    const selectedId =
      params.selectedVideoId?.trim() || newestVideoSelectedId(items)
    return dualVideoGalleryOutputs(items, selectedId)
  }

  const generatedVoices = params.generatedVoices
  if (Array.isArray(generatedVoices) && generatedVoices.length) {
    const items: GraphVoiceItem[] = generatedVoices.map((item) => ({
      id: item.id,
      relativePath: item.relativePath,
      createdAt: item.createdAt
    }))
    const selectedId =
      params.selectedVoiceId?.trim() || newestVoiceSelectedId(items)
    return dualVoiceGalleryOutputs(items, selectedId)
  }

  const generatedTexts = params.generatedTexts
  if (Array.isArray(generatedTexts) && generatedTexts.length) {
    const items: GraphTextItem[] = generatedTexts.map((item) => ({
      id: item.id,
      title: item.title,
      text: item.text ?? '',
      relativePath: item.relativePath,
      createdAt: item.createdAt
    }))
    const selectedId =
      params.selectedTextId?.trim() || newestTextSelectedId(items)
    if (options?.typeId === 'world.extract') {
      return dualWorldCatalogOutputs(items, selectedId)
    }
    if (options?.typeId === 'beat.split') {
      return dualBeatCatalogOutputs(items, selectedId)
    }
    if (options?.typeId === 'ui.split') {
      // 主出口为文本数组：每一项一个界面详细提示词
      return { out: { kind: 'texts', items } }
    }
    return dualTextGalleryOutputs(items, selectedId)
  }

  const cameraShots = params.cameraShots
  if (Array.isArray(cameraShots) && cameraShots.length) {
    const items: GraphImageItem[] = cameraShots.map((shot) => ({
      id: shot.id,
      dataUrl: shot.dataUrl ?? '',
      relativePath: shot.relativePath,
      createdAt: shot.createdAt
    }))
    const selectedId =
      params.selectedImageId?.trim() || newestImageSelectedId(items)
    return dualImageGalleryOutputs(items, selectedId)
  }

  return null
}

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
            : out.items.map((item) => item.text).filter(Boolean).join('\n')
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
    const fallback = mapHostInnerStatesToOutputs(
      hosted.states,
      doc,
      node.assetType ?? 'subgraph'
    )
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
          (n) =>
            isBoundaryOutputNode(n) && n.params.hostBoundaryPort?.portId === port.id
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
  const localNotes =
    expandInstructionMentions(instructionRaw, mentionSources) || undefined
  const incomingText = autoIncomingTextForInstruction(
    instructionRaw,
    selected,
    mentionSources
  )
  const items = flattenAssetValues(selected)
  if (!items.length) {
    const text = [localNotes, incomingText].filter(Boolean).join('\n').trim()
    if (!text) throw new Error('GRAPH_PROCESS_NO_INPUT')
    return { out: { kind: 'text', text } }
  }
  const enriched = items.map((item) => {
    const notes =
      [localNotes, item.notes, incomingText].filter(Boolean).join('\n') || undefined
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
export async function executeVoiceGenerateNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const instructionRaw = node.params.generateInstruction?.trim() || ''
  const mentionSources = resolveMentionSources(ctx)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const localNotes =
    expandInstructionMentions(instructionRaw, mentionSources) || undefined
  const incomingText = autoIncomingTextForInstruction(
    instructionRaw,
    selected,
    mentionSources
  )
  const sourceImages = await collectIncomingImageItems(ctx)

  if (!ctx.generateSpeech) {
    const voices = flattenVoicesValues(selected)
    if (voices.length) {
      const item = voices[0]!
      const notes = [localNotes, incomingText].filter(Boolean).join('\n') || undefined
      if (notes) ctx.patchNode?.({ params: { notes } })
      return {
        out: {
          kind: 'voices',
          items: [
            {
              ...(item.id ? { id: item.id } : {}),
              ...(item.createdAt ? { createdAt: item.createdAt } : {}),
              ...(item.relativePath ? { relativePath: item.relativePath } : {})
            }
          ]
        }
      }
    }
    const text = [localNotes, incomingText].filter(Boolean).join('\n').trim()
    if (!text && !sourceImages.length) throw new Error('GRAPH_PROCESS_NO_INPUT')
    return { out: { kind: 'text', text: text || '(image prompt)' } }
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  let userPrompt = buildVoicePrompt(instruction, ctx.locale)
  if (incomingText) {
    userPrompt = userPrompt.trim()
      ? `${userPrompt.trim()}\n\n${incomingText}`
      : incomingText
  }
  const system = resolveVoiceSystemPrompt(node.params.generateSystemPrompt, ctx.locale)
  const prompt = system.trim() ? `${system.trim()}\n\n${userPrompt}` : userPrompt

  let images: string[] = []
  if (sourceImages.length) {
    if (ctx.resolveImageUrls) {
      images = (await ctx.resolveImageUrls(sourceImages)).filter(Boolean)
    } else {
      images = sourceImages
        .map((item) => item.dataUrl?.trim())
        .filter((url): url is string => Boolean(url))
    }
  }

  if (!prompt.trim() && !images.length) throw new Error('GRAPH_PROCESS_NO_INPUT')

  const speechVoice =
    typeof node.params.generateSpeechVoice === 'string'
      ? node.params.generateSpeechVoice.trim()
      : undefined

  const result = await ctx.generateSpeech({
    input: prompt,
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined,
    voice: speechVoice || undefined,
    name: buildGeneratedMediaFileKey({
      hostAssetName: ctx.resolveHostAssetName?.(),
      nodeTitle: node.title || node.typeId || 'voice',
      stamp: formatGeneratedMediaStamp()
    }),
    images: images.length ? images : undefined,
    outputDir: node.params.mediaOutputDir?.trim() || undefined
  })

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  if (!result.assetId || !result.relativePath) {
    throw new Error('语音合成未返回资产')
  }

  const notes = [localNotes, incomingText].filter(Boolean).join('\n') || undefined
  if (notes) {
    ctx.node.params = { ...ctx.node.params, notes }
    ctx.patchNode?.({ params: { notes } })
  }

  return persistVoiceGeneration(ctx, {
    id: result.assetId,
    createdAt: new Date().toISOString(),
    relativePath: result.relativePath
  })
}

/** 视频生成：无 API 时透传上游；有 API 时调用视频模型并输出资产 */
export async function executeVideoGenerateNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const instructionRaw = node.params.generateInstruction?.trim() || ''
  const mentionSources = resolveMentionSources(ctx)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const localNotes =
    expandInstructionMentions(instructionRaw, mentionSources) || undefined
  const incomingText = autoIncomingTextForInstruction(
    instructionRaw,
    selected,
    mentionSources
  )

  if (!ctx.generateVideo) {
    return executeVideoGeneratePassthrough(ctx, {
      instructionRaw,
      selected,
      localNotes,
      incomingText
    })
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  let userPrompt = buildVideoPrompt(instruction, ctx.locale)
  if (incomingText) {
    userPrompt = userPrompt.trim()
      ? `${userPrompt.trim()}\n\n${incomingText}`
      : incomingText
  }
  const system = resolveVideoSystemPrompt(node.params.generateSystemPrompt, ctx.locale)
  const styleImages = resolveNodeStyleImages(ctx)
  // 风格图占 inputReferences 前 N 张，prompt 用「参考xx风格@n，参考强度…」指代（勿再 expand）
  userPrompt = appendStyleImagesReferencePrompt(userPrompt, styleImages, {
    locale: ctx.locale
  })
  const prompt = system.trim() ? `${system.trim()}\n\n${userPrompt}` : userPrompt

  const portReferences = await collectVideoGenerateInputReferences(ctx, selected)
  const styleUrls = await resolveStyleReferenceUrls(ctx, styleImages)
  // 风格图优先占图片槽位，再拼端口参考（与图片口上限共享额度；@n 与此顺序一致）
  const inputReferences = [
    ...styleUrls.map((url) => ({ kind: 'image_url' as const, url })),
    ...portReferences
  ]
  const firstFrameImageUrl = await resolveVideoFramePortImageUrl(ctx, VIDEO_FIRST_FRAME_PORT_ID)
  const lastFrameImageUrl = await resolveVideoFramePortImageUrl(ctx, VIDEO_LAST_FRAME_PORT_ID)

  if (
    !inputReferences.length &&
    !firstFrameImageUrl &&
    !lastFrameImageUrl &&
    !instruction.trim() &&
    !userPrompt.trim()
  ) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  let capsParams: VideoGenerateParamCapabilities | null = null
  let portLimits = UNKNOWN_VIDEO_PORT_LIMITS
  if (ctx.resolveVideoGenerateCapabilities) {
    try {
      const bundle = await ctx.resolveVideoGenerateCapabilities({
        model: node.params.generateModel || undefined,
        providerInstanceId: node.params.generateProviderInstanceId || undefined
      })
      if (bundle) {
        capsParams = bundle.params
        portLimits = bundle.portLimits
      }
    } catch {
      /* 能力查询失败时沿用节点已保存参数 */
    }
  }

  const genParams = resolveVideoGenerateParamsForApi(node.params, capsParams)
  const paramsPatch = videoGenerateParamsToNodePatch(genParams)
  node.params = { ...node.params, ...paramsPatch }
  ctx.patchNode?.({ params: paramsPatch })

  const limitedRefs = limitVideoInputReferences(inputReferences, portLimits)
  const useFirstFrame =
    genParams.frameMode === 'first' || genParams.frameMode === 'first_last'
      ? firstFrameImageUrl
      : undefined
  const useLastFrame =
    genParams.frameMode === 'first_last' ? lastFrameImageUrl : undefined
  // 方舟等：尾帧不可与 reference_image 混用；首尾帧模式下去掉参考图
  const apiRefs =
    useLastFrame?.trim()
      ? limitedRefs.filter((ref) => ref.kind !== 'image_url')
      : limitedRefs

  const result = await ctx.generateVideo({
    prompt,
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined,
    duration: genParams.duration,
    resolution: genParams.resolution,
    aspectRatio: genParams.aspectRatio,
    generateAudio: genParams.generateAudio,
    seed: resolveGenerateSeed(node.params, ctx.resolveProjectGenerateSeed?.()),
    firstFrameImageUrl: useFirstFrame,
    lastFrameImageUrl: useLastFrame,
    inputReferences: apiRefs.length ? apiRefs : undefined,
    outputDir: node.params.mediaOutputDir?.trim() || undefined,
    name: buildGeneratedMediaFileKey({
      hostAssetName: ctx.resolveHostAssetName?.(),
      nodeTitle: node.title || node.typeId || 'video',
      stamp: formatGeneratedMediaStamp()
    })
  })

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const notes =
    [localNotes, incomingText].filter(Boolean).join('\n') || undefined

  return persistVideoGeneration(
    ctx,
    {
      id: result.assetId,
      relativePath: result.relativePath,
      createdAt: new Date().toISOString()
    },
    notes
  )
}

/**
 * 对口型：角色图或参考视频 + 声音 → 多模态视频（Seedance 2 等）。
 * 有视频时优先「视频1 + 音频1」；否则「图片1 + 音频1」。不做首尾帧拼装。
 */
export async function executeLipSyncNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx

  const audioInputValues = [
    ...(ctx.inputs['in-voice'] ?? []),
    ...(ctx.inputs.in ?? [])
  ]
  const audioRefs = await collectVideoGenerateInputReferences(ctx, audioInputValues)
  const audioUrl = audioRefs.find((ref) => ref.kind === 'audio_url')?.url?.trim()
  if (!audioUrl) {
    throw new Error('GRAPH_LIPSYNC_NO_AUDIO')
  }

  const videoValues = ctx.inputs['in-video'] ?? []
  const videoRefs = await collectVideoGenerateInputReferences(ctx, videoValues)
  const videoUrl = videoRefs.find((ref) => ref.kind === 'video_url')?.url?.trim()

  let imageUrl: string | undefined
  if (!videoUrl) {
    const imageItems = await collectIncomingImageItems(ctx)
    if (ctx.resolveImageUrls && imageItems.length) {
      imageUrl = (await ctx.resolveImageUrls(imageItems.slice(0, 1))).find((u) => u.trim())?.trim()
    } else if (imageItems[0]?.dataUrl?.trim()) {
      imageUrl = imageItems[0].dataUrl.trim()
    }
    if (!imageUrl && ctx.resolveAssetImageUrl) {
      for (const value of [...(ctx.inputs['in-image'] ?? []), ...(ctx.inputs.in ?? [])]) {
        if (value.kind !== 'asset' || value.assetType !== 'image') continue
        const url = await ctx.resolveAssetImageUrl(value.assetId)
        if (url?.trim()) {
          imageUrl = url.trim()
          break
        }
      }
    }
  }

  if (!videoUrl && !imageUrl) {
    throw new Error('GRAPH_LIPSYNC_NO_VISUAL')
  }

  const visualKind = videoUrl ? 'video' : 'image'
  const instructionRaw = node.params.generateInstruction?.trim() || ''
  const mentionSources = resolveMentionSources(ctx)
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const incomingText = autoIncomingTextForInstruction(
    instructionRaw,
    selected,
    mentionSources
  )
  let userPrompt = buildLipSyncPrompt(instruction, ctx.locale, visualKind)
  if (incomingText) {
    userPrompt = userPrompt.trim()
      ? `${userPrompt.trim()}\n\n${incomingText}`
      : incomingText
  }
  const system = resolveLipSyncSystemPrompt(node.params.generateSystemPrompt, ctx.locale)
  const prompt = system.trim() ? `${system.trim()}\n\n${userPrompt}` : userPrompt

  if (!ctx.generateVideo) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  let capsParams: VideoGenerateParamCapabilities | null = null
  if (ctx.resolveVideoGenerateCapabilities) {
    try {
      const bundle = await ctx.resolveVideoGenerateCapabilities({
        model: node.params.generateModel || undefined,
        providerInstanceId: node.params.generateProviderInstanceId || undefined
      })
      if (bundle) capsParams = bundle.params
    } catch {
      /* 沿用节点已保存参数 */
    }
  }

  const genParams = resolveVideoGenerateParamsForApi(node.params, capsParams)
  // 对口型：强制参考音驱动；不做首尾帧
  const paramsPatch = videoGenerateParamsToNodePatch({
    ...genParams,
    frameMode: 'none',
    generateAudio: genParams.generateAudio ?? true
  })
  node.params = { ...node.params, ...paramsPatch }
  ctx.patchNode?.({ params: paramsPatch })

  const inputReferences: Array<{ kind: 'image_url' | 'video_url' | 'audio_url'; url: string }> =
    videoUrl
      ? [
          { kind: 'video_url', url: videoUrl },
          { kind: 'audio_url', url: audioUrl }
        ]
      : [
          { kind: 'image_url', url: imageUrl! },
          { kind: 'audio_url', url: audioUrl }
        ]

  const result = await ctx.generateVideo({
    prompt,
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined,
    duration: genParams.duration,
    resolution: genParams.resolution,
    aspectRatio: genParams.aspectRatio,
    generateAudio: paramsPatch.generateAudio !== false,
    seed: resolveGenerateSeed(node.params, ctx.resolveProjectGenerateSeed?.()),
    inputReferences,
    outputDir: node.params.mediaOutputDir?.trim() || undefined,
    name: buildGeneratedMediaFileKey({
      hostAssetName: ctx.resolveHostAssetName?.(),
      nodeTitle: node.title || node.typeId || 'lipSync',
      stamp: formatGeneratedMediaStamp()
    })
  })

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const notes =
    [instruction, incomingText].filter(Boolean).join('\n') || undefined

  return persistVideoGeneration(
    ctx,
    {
      id: result.assetId,
      relativePath: result.relativePath,
      createdAt: new Date().toISOString()
    },
    notes
  )
}

/**
 * 片段重拍：源视频（必填）+ 参考素材 + 时间戳区间 → Seedance 2.5 时间戳级视频编辑。
 * Prompt 内组装「编辑 @视频1：00:05—00:09 修改要求」，仅重绘指定区间，其余片段保持原视频。
 */
export async function executeVideoReshootNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx

  const videoValues = [...(ctx.inputs['in-video'] ?? []), ...(ctx.inputs.in ?? [])]
  const videoRefs = await collectVideoGenerateInputReferences(ctx, videoValues)
  const videoUrl = videoRefs.find((ref) => ref.kind === 'video_url')?.url?.trim()
  if (!videoUrl) {
    throw new Error('GRAPH_RESHOOT_NO_VIDEO')
  }

  const segment = {
    startSec: Number(node.params.reshootStartSec),
    endSec: Number(node.params.reshootEndSec)
  }

  const instructionRaw = node.params.generateInstruction?.trim() || ''
  const mentionSources = resolveMentionSources(ctx)
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const incomingText = autoIncomingTextForInstruction(
    instructionRaw,
    selected,
    mentionSources
  )
  let userPrompt = buildReshootPrompt(instruction, segment, ctx.locale)
  if (incomingText) {
    userPrompt = userPrompt.trim()
      ? `${userPrompt.trim()}\n\n${incomingText}`
      : incomingText
  }
  const system = resolveReshootSystemPrompt(node.params.generateSystemPrompt, ctx.locale)
  const prompt = system.trim() ? `${system.trim()}\n\n${userPrompt}` : userPrompt

  if (!ctx.generateVideo) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  let capsParams: VideoGenerateParamCapabilities | null = null
  if (ctx.resolveVideoGenerateCapabilities) {
    try {
      const bundle = await ctx.resolveVideoGenerateCapabilities({
        model: node.params.generateModel || undefined,
        providerInstanceId: node.params.generateProviderInstanceId || undefined
      })
      if (bundle) capsParams = bundle.params
    } catch {
      /* 沿用节点已保存参数 */
    }
  }

  const genParams = resolveVideoGenerateParamsForApi(node.params, capsParams)
  const paramsPatch = videoGenerateParamsToNodePatch({
    ...genParams,
    generateAudio: genParams.generateAudio ?? true
  })
  node.params = { ...node.params, ...paramsPatch }
  ctx.patchNode?.({ params: paramsPatch })

  // 源视频必须是第一个视频参考（@视频1）；随后拼图片 / 音频参考
  const referenceValues = [
    ...(ctx.inputs['in-image'] ?? []),
    ...(ctx.inputs['in-voice'] ?? [])
  ]
  const otherRefs = await collectVideoGenerateInputReferences(ctx, referenceValues)
  const inputReferences: Array<{
    kind: 'image_url' | 'video_url' | 'audio_url'
    url: string
  }> = [
    { kind: 'video_url', url: videoUrl },
    ...otherRefs
  ]

  const result = await ctx.generateVideo({
    prompt,
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined,
    duration: genParams.duration,
    resolution: genParams.resolution,
    aspectRatio: genParams.aspectRatio,
    generateAudio: paramsPatch.generateAudio !== false,
    seed: resolveGenerateSeed(node.params, ctx.resolveProjectGenerateSeed?.()),
    inputReferences,
    outputDir: node.params.mediaOutputDir?.trim() || undefined,
    name: buildGeneratedMediaFileKey({
      hostAssetName: ctx.resolveHostAssetName?.(),
      nodeTitle: node.title || node.typeId || 'reshoot',
      stamp: formatGeneratedMediaStamp()
    })
  })

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const segmentText = isValidReshootSegment(segment)
    ? `${formatReshootTimestamp(segment.startSec)}—${formatReshootTimestamp(segment.endSec)}`
    : ''
  const notes =
    [segmentText, instruction, incomingText].filter(Boolean).join('\n') || undefined

  return persistVideoGeneration(
    ctx,
    {
      id: result.assetId,
      relativePath: result.relativePath,
      createdAt: new Date().toISOString()
    },
    notes
  )
}

function executeVideoGeneratePassthrough(
  ctx: NodeExecuteContext,
  args: {
    instructionRaw: string
    selected: GraphValue[]
    localNotes: string | undefined
    incomingText: string
  }
): Record<string, GraphValue> {
  const { selected, localNotes, incomingText } = args
  const videos = flattenAssetValues(selected).filter((item) => item.assetType === 'video')
  const voices = flattenAssetValues(selected).filter((item) => item.assetType === 'voice')
  const gallery = (ctx.node.params.generatedVideos ?? [])
    .filter((item) => item.relativePath?.trim() || item.dataUrl?.trim())
    .map((item) => ({
      id: item.id,
      dataUrl: item.dataUrl || '',
      createdAt: item.createdAt,
      ...(item.relativePath?.trim() ? { relativePath: item.relativePath.trim() } : {})
    }))
  if (!videos.length) {
    if (gallery.length) {
      const selectedVideoId =
        ctx.node.params.selectedVideoId?.trim() || newestVideoSelectedId(gallery)
      return dualVideoGalleryOutputs(gallery, selectedVideoId)
    }
    const text = [localNotes, incomingText].filter(Boolean).join('\n').trim()
    const voiceNotes = voices
      .map((item) => item.title?.trim() || item.label?.trim() || item.notes?.trim() || '')
      .filter(Boolean)
      .join('\n')
    const outText = text || voiceNotes
    if (!outText) throw new Error('GRAPH_PROCESS_NO_INPUT')
    ctx.patchNode?.({ params: { notes: outText } })
    return { out: { kind: 'text', text: outText } }
  }

  const notes =
    [localNotes, videos[0]!.notes, incomingText].filter(Boolean).join('\n') || undefined
  const merged = [
    ...gallery,
    ...videos.map((item) => ({
      id: item.assetId,
      dataUrl: '',
      ...(item.relativePath?.trim() ? { relativePath: item.relativePath.trim() } : {})
    }))
  ]
  const generatedVideos = merged.map((item, index) => ({
    id: item.id?.trim() || `passthrough:${index}`,
    dataUrl: item.dataUrl || '',
    ...(item.relativePath ? { relativePath: item.relativePath } : {})
  }))
  const selectedVideoId = newestVideoSelectedId(generatedVideos)
  ctx.patchNode?.({
    params: {
      notes,
      previewRelativePath: videos[0]?.relativePath?.trim() || undefined,
      generatedVideos,
      selectedVideoId
    }
  })
  ctx.node.params = {
    ...ctx.node.params,
    generatedVideos,
    selectedVideoId,
    ...(notes !== undefined ? { notes } : {})
  }
  return dualVideoGalleryOutputs(generatedVideos, selectedVideoId)
}

type VideoRefKind = 'image_url' | 'video_url' | 'audio_url'

async function resolveVideoFramePortImageUrl(
  ctx: NodeExecuteContext,
  portId: string
): Promise<string | undefined> {
  const values = ctx.inputs[portId] ?? []
  if (!values.length) return undefined
  const refs = await collectVideoGenerateInputReferences(ctx, values)
  return refs.find((ref) => ref.kind === 'image_url')?.url
}

function resolveNodeStyleImages(ctx: NodeExecuteContext): ProjectStyleImage[] {
  const global = ctx.resolveProjectStyleImages?.() ?? []
  const images = resolveGenerateStyleImages(ctx.node.params, global)
  return ctx.enrichStyleImages ? ctx.enrichStyleImages(images) : images
}

async function resolveStyleReferenceUrls(
  ctx: NodeExecuteContext,
  images?: ProjectStyleImage[] | null
): Promise<string[]> {
  const normalized = normalizeProjectStyleImages(images)
  if (!normalized.length) return []
  if (ctx.resolveStyleImageUrls) {
    return (await ctx.resolveStyleImageUrls(normalized)).filter(Boolean)
  }
  return normalized
    .map((item) => item.dataUrl?.trim())
    .filter((url): url is string => Boolean(url?.startsWith('data:')))
}

async function collectVideoGenerateInputReferences(
  ctx: NodeExecuteContext,
  selected: GraphValue[]
): Promise<Array<{ kind: VideoRefKind; url: string }>> {
  const refs: Array<{ kind: VideoRefKind; url: string }> = []
  const seen = new Set<string>()

  const push = (kind: VideoRefKind, url: string): void => {
    const trimmed = url.trim()
    if (!trimmed) return
    const key = `${kind}:${trimmed.slice(0, 64)}:${trimmed.length}`
    if (seen.has(key)) return
    seen.add(key)
    refs.push({ kind, url: trimmed })
  }

  for (const value of selected) {
    if (value.kind === 'images') {
      for (const item of value.items) {
        if (ctx.resolveImageUrls) {
          const urls = await ctx.resolveImageUrls([item])
          for (const url of urls) push('image_url', url)
        } else if (item.dataUrl?.trim()) {
          push('image_url', item.dataUrl)
        }
      }
      continue
    }
    if (value.kind === 'image') {
      if (ctx.resolveImageUrls) {
        const urls = await ctx.resolveImageUrls([value])
        for (const url of urls) push('image_url', url)
      } else if (value.dataUrl?.trim()) {
        push('image_url', value.dataUrl)
      }
      continue
    }
    if (value.kind === 'video' || value.kind === 'videos') {
      const items =
        value.kind === 'videos'
          ? value.items
          : [
              {
                dataUrl: value.dataUrl,
                relativePath: value.relativePath
              }
            ]
      for (const item of items) {
        // 与 resolveAssetMediaDataUrl(video) 一致：优先工程相对路径，生成前再上传 TOS
        const relativePath = item.relativePath?.trim()
        if (relativePath) {
          push('video_url', relativePath.replace(/\\/g, '/'))
          continue
        }
        if (item.dataUrl?.trim()) push('video_url', item.dataUrl)
      }
      continue
    }
    if (value.kind === 'voices') {
      for (const item of value.items) {
        const relativePath = item.relativePath?.trim()
        if (relativePath) {
          push('audio_url', relativePath.replace(/\\/g, '/'))
          continue
        }
        const assetId = item.id?.trim()
        if (assetId && ctx.resolveAssetMediaUrl) {
          const url = await ctx.resolveAssetMediaUrl(assetId)
          if (url) push('audio_url', url)
        }
      }
      continue
    }
    if (value.kind === 'output' && value.voices?.length) {
      for (const item of value.voices) {
        const relativePath = item.relativePath?.trim()
        if (relativePath) {
          push('audio_url', relativePath.replace(/\\/g, '/'))
          continue
        }
        const assetId = item.id?.trim()
        if (assetId && ctx.resolveAssetMediaUrl) {
          const url = await ctx.resolveAssetMediaUrl(assetId)
          if (url) push('audio_url', url)
        }
      }
      continue
    }
    if (value.kind !== 'asset') continue
    const kind: VideoRefKind | null =
      value.assetType === 'image'
        ? 'image_url'
        : value.assetType === 'video'
          ? 'video_url'
          : value.assetType === 'voice'
            ? 'audio_url'
            : null
    if (!kind) continue
    let url: string | undefined
    if (ctx.resolveAssetMediaUrl) {
      url = await ctx.resolveAssetMediaUrl(value.assetId)
    } else if (kind === 'image_url' && ctx.resolveAssetImageUrl) {
      url = await ctx.resolveAssetImageUrl(value.assetId)
    }
    if (url) push(kind, url)
  }

  return refs
}

function limitVideoInputReferences(
  refs: Array<{ kind: VideoRefKind; url: string }>,
  limits: {
    maxImages: number | null
    maxVideos: number | null
    maxVoices: number | null
  }
): Array<{ kind: VideoRefKind; url: string }> {
  const take = (
    kind: VideoRefKind,
    max: number | null
  ): Array<{ kind: VideoRefKind; url: string }> => {
    const list = refs.filter((r) => r.kind === kind)
    if (max == null) return list
    return list.slice(0, Math.max(0, max))
  }
  return [
    ...take('image_url', limits.maxImages),
    ...take('video_url', limits.maxVideos),
    ...take('audio_url', limits.maxVoices)
  ]
}

async function collectImageItemsFromValue(
  value: GraphValue,
  ctx: NodeExecuteContext
): Promise<GraphImageItem[]> {
  const items: GraphImageItem[] = []
  const seen = new Set<string>()
  const pushItem = (item: GraphImageItem): void => {
    const key =
      item.id?.trim() ||
      item.relativePath?.trim() ||
      item.dataUrl?.trim() ||
      `idx:${items.length}`
    if (seen.has(key)) return
    const hasPayload =
      (typeof item.dataUrl === 'string' && item.dataUrl.length > 0) ||
      (typeof item.relativePath === 'string' && item.relativePath.length > 0)
    if (!hasPayload) return
    seen.add(key)
    items.push(item)
  }

  for (const item of flattenImagesValues([value])) {
    pushItem(item)
  }

  if (ctx.resolveAssetImageUrl) {
    for (const asset of flattenAssetValues([value])) {
      if (asset.assetType !== 'image') continue
      const url = await ctx.resolveAssetImageUrl(asset.assetId)
      if (!url) continue
      pushItem({ id: asset.assetId, dataUrl: url })
    }
  }

  return items
}

async function collectImageGenerateSourceItems(
  ctx: NodeExecuteContext,
  instructionRaw: string
): Promise<GraphImageItem[]> {
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const items: GraphImageItem[] = []
  const seen = new Set<string>()
  for (const value of selected) {
    for (const item of await collectImageItemsFromValue(value, ctx)) {
      const key =
        item.id?.trim() ||
        item.relativePath?.trim() ||
        item.dataUrl?.trim() ||
        `idx:${items.length}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push(item)
    }
  }
  return items
}

/** 收集节点入边图片（含 image / images，以及图片资产引用） */
async function collectIncomingImageItems(ctx: NodeExecuteContext): Promise<GraphImageItem[]> {
  const imageInputs = [
    ...(ctx.inputs.in ?? []),
    ...(ctx.inputs['in-image'] ?? [])
  ]
  const values = imageInputs.length ? imageInputs : collectIncomingValues(ctx.inputs)
  const items: GraphImageItem[] = []
  const seen = new Set<string>()
  for (const value of values) {
    for (const item of await collectImageItemsFromValue(value, ctx)) {
      const key =
        item.id?.trim() ||
        item.relativePath?.trim() ||
        item.dataUrl?.trim() ||
        `idx:${items.length}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push(item)
    }
  }
  return items
}

function patchImageGeneratePreview(
  ctx: NodeExecuteContext,
  items: GraphImageItem[]
): void {
  const preview = items[0]
  if (!preview) return
  ctx.patchNode?.({
    params: {
      previewDataUrl: preview.dataUrl?.trim() ? preview.dataUrl : undefined,
      previewRelativePath: preview.relativePath?.trim() ? preview.relativePath : undefined
    }
  })
}

/**
 * 图片生成：展开指令后调用图片生成 API，输出 images。
 * 未注入 generateImage 时退回上游图片透传。
 * 可接文本口（提示词）与图片口（参考图）；无 @ 时自动拼入上游正文。
 */
export async function executeImageGenerateNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const instructionRaw = node.params.generateInstruction?.trim() ?? ''
  const mentionSources = resolveMentionSources(ctx)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const sourceItems = await collectImageGenerateSourceItems(ctx, instructionRaw)
  const incomingText = autoIncomingTextForInstruction(
    instructionRaw,
    selected,
    mentionSources
  )

  if (!ctx.generateImage) {
    if (!sourceItems.length) {
      // 无 API 且无参考图：有指令或上游文本则仍算可运行（纯文案节点预览）
      if (!instructionRaw.trim() && !incomingText.trim()) {
        throw new Error('GRAPH_PROCESS_NO_INPUT')
      }
      return dualImageGalleryOutputs([], '')
    }
    patchImageGeneratePreview(ctx, sourceItems)
    return commitGeneratedImages(
      ctx,
      sourceItems.map((item, index) => ({
        ...item,
        id: item.id?.trim() || `source:${index}`
      })),
      sourceItems[0]?.relativePath?.trim()
    )
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  let userPrompt = buildImagePrompt(instruction, ctx.locale)
  if (incomingText) {
    userPrompt = userPrompt.trim()
      ? `${userPrompt.trim()}\n\n${incomingText}`
      : incomingText
  }
  const system = resolveImageSystemPrompt(node.params.generateSystemPrompt, ctx.locale)
  const styleImages = resolveNodeStyleImages(ctx)
  // /images 无独立 system 字段，拼入 prompt
  // 风格图占 image[] 前 N 张：追加「参考xx风格@n，参考强度…」，与 API 多图指代一致
  userPrompt = appendStyleImagesReferencePrompt(userPrompt, styleImages, {
    locale: ctx.locale,
    subject: node.params.styleReferenceSubject
  })
  // 剧集流水线产物节点（如 9宫格拼图 / 4宫格拼图）：重跑时附加导演上次 FAIL 原因
  if (node.params.episodeStep && ctx.readEpisodeAgentState) {
    try {
      const scopeKey = node.params.episodeScopeKey?.trim() || 'default'
      const raw = await ctx.readEpisodeAgentState(scopeKey)
      const failReason = episodeFailReasonForStep(
        parseEpisodeAgentState(raw),
        node.params.episodeStep
      )
      if (failReason) {
        userPrompt = `${userPrompt.trim()}\n\n【导演上次 FAIL 原因，必须针对性地修改】${failReason}`
      }
    } catch {
      /* 状态读取失败时不影响生成 */
    }
  }
  const prompt = system.trim() ? `${system.trim()}\n\n${userPrompt}` : userPrompt

  let portUrls: string[] = []
  if (sourceItems.length) {
    if (ctx.resolveImageUrls) {
      portUrls = (await ctx.resolveImageUrls(sourceItems)).filter(Boolean)
    } else {
      portUrls = sourceItems
        .map((item) => item.dataUrl?.trim())
        .filter((url): url is string => Boolean(url))
    }
  }
  const styleUrls = await resolveStyleReferenceUrls(ctx, styleImages)

  // 无参考图时允许纯文生图；既无参考也无有效指令/上游文本则失败
  if (!portUrls.length && !styleUrls.length && !instruction.trim() && !userPrompt.trim()) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const genParams = resolveImageGenerateParamsForApi(node.params)
  // 把实际使用的默认值写回节点，便于 UI / 下次执行一致
  const paramsPatch = imageGenerateParamsToNodePatch(genParams)
  node.params = { ...node.params, ...paramsPatch }
  ctx.patchNode?.({ params: paramsPatch })

  let maxInputReferences = resolveMaxInputReferences()
  if (ctx.resolveImageGenerateCapabilities) {
    try {
      const caps = await ctx.resolveImageGenerateCapabilities({
        model: node.params.generateModel || undefined,
        providerInstanceId: node.params.generateProviderInstanceId || undefined
      })
      maxInputReferences = resolveMaxInputReferences(caps)
    } catch {
      /* 能力查询失败时沿用默认上限 */
    }
  }
  // 风格图优先占位（@1..@N），与端口参考图共享上限并一并提交
  const cap = Math.max(0, Math.floor(maxInputReferences))
  const styleRefs = styleUrls.map((url) => url.trim()).filter(Boolean).slice(0, cap)
  const rest = Math.max(0, cap - styleRefs.length)
  const portRefs = portUrls.map((url) => url.trim()).filter(Boolean).slice(0, rest)
  const inputReferences = [...styleRefs, ...portRefs]
  // 与 inputReferences 一一对应的元信息：来源（风格库/端口参考图）+ 落盘相对路径/名称
  const inputReferenceMeta: GraphImageReferenceMeta[] = [
    ...styleImages.slice(0, styleRefs.length).map((item) => ({
      source: 'style' as const,
      name: item.name?.trim() || item.libraryId
    })),
    ...sourceItems.slice(0, portRefs.length).map((item) => ({
      source: 'port' as const,
      ...(item.relativePath?.trim() ? { relativePath: item.relativePath.trim() } : {})
    }))
  ]

  const result = await ctx.generateImage({
    prompt,
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined,
    aspectRatio: genParams.aspectRatio,
    resolution: genParams.resolution,
    quality: genParams.quality,
    n: genParams.count,
    seed: resolveGenerateSeed(node.params, ctx.resolveProjectGenerateSeed?.()),
    inputReferences: inputReferences.length ? inputReferences : undefined,
    inputReferenceMeta: inputReferenceMeta.length ? inputReferenceMeta : undefined
  })

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const createdAt = new Date().toISOString()
  const stamp = Date.now()
  const batch: GraphImageItem[] = []
  for (const [index, url] of (result.images ?? []).entries()) {
    const dataUrl = typeof url === 'string' ? url.trim() : ''
    if (!dataUrl) continue
    batch.push({
      id: `gen:${node.id}:${stamp}:${index}`,
      dataUrl,
      createdAt
    })
  }

  if (!batch.length) {
    throw new Error('模型未返回图片')
  }

  // 按设定宽高比裁正画布：宫格画布裁正后每个格子几何上严格按该比例均分
  if (genParams.aspectRatio?.trim() && ctx.normalizeImageAspectRatio) {
    const ratio = genParams.aspectRatio.trim()
    for (const item of batch) {
      if (!item.dataUrl?.startsWith('data:image/')) continue
      try {
        const normalized = await ctx.normalizeImageAspectRatio({
          dataUrl: item.dataUrl,
          aspectRatio: ratio
        })
        if (normalized) item.dataUrl = normalized
      } catch {
        /* 裁正失败时保留原图 */
      }
    }
  }

  const stampKey = `gen:${node.id}:${stamp}`
  const materializedBatch = await materializeGeneratedBatch(ctx, batch, stampKey)
  if (!materializedBatch.length) {
    throw new Error('图片落盘失败')
  }
  const generatedImages = mergeGeneratedImages(ctx, materializedBatch, `${stampKey}:keep`)
  return commitGeneratedImages(
    ctx,
    generatedImages,
    materializedBatch[0]?.relativePath?.trim()
  )
}

export function normalizeLocalScreenplayText(raw: string | undefined): string {
  const localRaw = raw?.trim() ?? ''
  return localRaw === '…' || localRaw === '...' ? '' : localRaw
}

export type InstructionFinalPreviewKind =
  | 'screenplay'
  | 'image'
  | 'video'
  | 'reshoot'
  | 'voice'
  | 'optimize'
  | 'toPrompt'
  | 'worldExtract'
  | 'beatSplit'
  | 'beatUnitGen'
  | 'uiSplit'
  | 'frameAnimGen'

/** 按节点 typeId / assetType / 编辑器 preset 解析预览种类 */
export function resolveInstructionFinalPreviewKind(
  node: Pick<GraphNode, 'typeId' | 'assetType'> | null | undefined,
  presetKind?: InstructionPresetKind | null
): InstructionFinalPreviewKind {
  const typeId = node?.typeId
  if (typeId === 'prompt.optimize' || presetKind === 'optimize') return 'optimize'
  if (typeId === 'image.toPrompt' || presetKind === 'toPrompt') return 'toPrompt'
  if (typeId === 'world.extract' || presetKind === 'worldExtract') return 'worldExtract'
  if (typeId === 'beat.split' || presetKind === 'beatSplit') {
    return 'beatSplit'
  }
  if (typeId === 'beat.unitGen' || presetKind === 'beatUnitGen') {
    return 'beatUnitGen'
  }
  if (typeId === 'ui.split' || presetKind === 'uiSplit') {
    return 'uiSplit'
  }
  if (typeId === 'frame.animGen' || presetKind === 'frameAnimGen') {
    return 'frameAnimGen'
  }
  if (typeId === 'video.reshoot' || presetKind === 'reshoot') return 'reshoot'

  const assetType = node?.assetType
  if (typeId === 'asset.video' || assetType === 'video' || presetKind === 'video') return 'video'
  if (typeId === 'asset.voice' || assetType === 'voice' || presetKind === 'voice') return 'voice'
  if (typeId === 'asset.image' || assetType === 'image' || presetKind === 'image') return 'image'
  if (
    typeId === 'asset.screenplay' ||
    assetType === 'screenplay' ||
    presetKind === 'screenplay'
  ) {
    return 'screenplay'
  }
  return 'screenplay'
}

function resolveSystemPromptForPreviewKind(
  kind: InstructionFinalPreviewKind,
  raw: string | undefined,
  locale?: string
): string {
  switch (kind) {
    case 'image':
      return resolveImageSystemPrompt(raw, locale)
    case 'video':
      return resolveVideoSystemPrompt(raw, locale)
    case 'reshoot':
      return resolveReshootSystemPrompt(raw, locale)
    case 'voice':
      return resolveVoiceSystemPrompt(raw, locale)
    case 'optimize':
      return resolveOptimizeSystemPrompt(raw, locale)
    case 'toPrompt':
      return resolveToPromptSystemPrompt(raw, locale)
    case 'worldExtract':
      return resolveWorldExtractSystemPrompt(raw, locale)
    case 'beatSplit':
      return resolveBeatSplitSystemPrompt(raw, locale)
    case 'beatUnitGen':
      return resolveBeatUnitGenSystemPrompt(raw, locale)
    case 'uiSplit':
      return resolveUiSplitSystemPrompt(raw, locale)
    case 'frameAnimGen':
      return resolveFrameAnimGenSystemPrompt(raw, locale)
    case 'screenplay':
    default:
      return resolveScreenplaySystemPrompt(raw, locale)
  }
}

function buildUserPromptForPreviewKind(
  kind: InstructionFinalPreviewKind,
  instruction: string,
  locale?: string,
  reshootSegment?: { startSec?: number; endSec?: number }
): string {
  switch (kind) {
    case 'image':
      return buildImagePrompt(instruction, locale)
    case 'video':
      return buildVideoPrompt(instruction, locale)
    case 'reshoot':
      return buildReshootPrompt(instruction, reshootSegment ?? {}, locale)
    case 'voice':
      return buildVoicePrompt(instruction, locale)
    case 'optimize':
      return buildOptimizePrompt(instruction, locale)
    case 'toPrompt':
      return buildToPromptUserPrompt(instruction, locale)
    case 'worldExtract':
      return buildWorldExtractPrompt(instruction, locale)
    case 'beatSplit':
      return buildBeatSplitPrompt(instruction, locale)
    case 'beatUnitGen':
      return buildBeatUnitGenPrompt(instruction, locale)
    case 'uiSplit':
      return buildUiSplitPrompt(instruction, locale)
    case 'frameAnimGen':
      return buildFrameAnimGenPrompt(instruction, locale)
    case 'screenplay':
    default:
      return buildScreenplayPrompt(instruction, locale)
  }
}

function previewSectionLabels(locale?: string): { system: string; user: string } {
  if (locale === 'en-US' || (locale?.startsWith('en') ?? false)) {
    return { system: 'System prompt', user: 'User prompt' }
  }
  return { system: '系统提示词', user: '用户提示词' }
}

/** 按节点类型拼接最终提示词预览（展开 @ + 对应系统提示词；无 @ 时拼上游正文，与执行一致） */
export function buildInstructionFinalPromptPreview(input: {
  kind: InstructionFinalPreviewKind
  instructionRaw: string
  sources: InstructionMentionSource[]
  systemPrompt?: string
  includeSystem?: boolean
  locale?: string
  /** 图片/视频生成：风格参考（与执行侧一致，追加「参考xx风格@n，参考强度…」） */
  styleImages?: ProjectStyleImage[] | null
  /** 图片生成：风格追加语义（与执行侧 node.params.styleReferenceSubject 一致） */
  styleReferenceSubject?: StyleReferenceSubject
  /** 片段重拍：重拍区间（与执行侧 buildReshootPrompt 一致，写入 mm:ss 时间戳） */
  reshootSegment?: { startSec?: number; endSec?: number }
  /** 帧动画序列图：行列数（与执行侧 buildAnim2dGridInstruction 一致，拼入网格排版指令） */
  frameAnimGrid?: { rows?: number; cols?: number }
}): string {
  const instruction = expandInstructionMentions(input.instructionRaw.trim(), input.sources)
  let userPrompt = buildUserPromptForPreviewKind(
    input.kind,
    instruction,
    input.locale,
    input.reshootSegment
  )
  // 所有指令框：先 build*Prompt(指令)，再无 @ 时追加上游 / 输入接口正文
  if (!instructionHasMentions(input.instructionRaw)) {
    const auto = input.sources
      .map((source) => source.text.trim())
      .filter(Boolean)
      .join('\n\n')
    if (auto) {
      userPrompt = userPrompt.trim() ? `${userPrompt.trim()}\n\n${auto}` : auto
    }
  }
  // 与 executeImage/VideoGenerateNode：风格图 @n 指代（在展开连线 @ 之后追加，保留 @n）
  if (input.kind === 'image' || input.kind === 'video') {
    userPrompt = appendStyleImagesReferencePrompt(userPrompt, input.styleImages, {
      locale: input.locale,
      subject: input.styleReferenceSubject
    })
  }
  if (input.kind === 'frameAnimGen' && input.frameAnimGrid) {
    const rows = Math.max(1, Math.floor(Number(input.frameAnimGrid.rows) || 1))
    const cols = Math.max(1, Math.floor(Number(input.frameAnimGrid.cols) || 4))
    const grid = buildAnim2dGridInstruction(rows, cols, input.locale)
    userPrompt = userPrompt.trim() ? `${userPrompt.trim()}\n\n${grid}` : grid
  }
  if (input.includeSystem === false) return userPrompt
  const system = resolveSystemPromptForPreviewKind(input.kind, input.systemPrompt, input.locale)
  const labels = previewSectionLabels(input.locale)
  return `【${labels.system}】\n${system}\n\n【${labels.user}】\n${userPrompt}`
}

function graphValueToMentionSource(value: GraphValue, index: number): InstructionMentionSource {
  if (value.kind === 'text') {
    return { index, title: `@${index}`, text: value.text }
  }
  if (value.kind === 'texts') {
    return {
      index,
      title: `@${index}`,
      text: value.items
        .map((item) => item.text.trim())
        .filter(Boolean)
        .join('\n\n')
    }
  }
  if (value.kind === 'asset') {
    const keepMentionToken = shouldKeepInstructionMentionToken({
      assetType: value.assetType,
      typeId: `asset.${value.assetType}`
    })
    return {
      index,
      title: value.title || value.label || `@${index}`,
      text: keepMentionToken ? '' : [value.notes, value.label].filter(Boolean).join('\n'),
      keepMentionToken
    }
  }
  if (value.kind === 'output') {
    return {
      index,
      title: `@${index}`,
      text: value.notes
        .map((item) => item.text.trim())
        .filter(Boolean)
        .join('\n\n')
    }
  }
  if (
    value.kind === 'image' ||
    value.kind === 'images' ||
    value.kind === 'video' ||
    value.kind === 'videos'
  ) {
    return { index, title: `@${index}`, text: '', keepMentionToken: true }
  }
  return { index, title: `@${index}`, text: '' }
}

function fallbackMentionTextFromNode(node: GraphNode | undefined): string {
  if (!node) return ''
  return (
    node.params.text?.trim() ||
    node.params.resultText?.trim() ||
    node.params.notes?.trim() ||
    ''
  )
}

function fallbackBeatUnitRefText(
  node: GraphNode | undefined,
  resolveBeatUnit?: (beatId: string) => import('../beatParse').BeatRow | null
): string {
  if (!node || node.typeId !== 'beat.unitRef' || !resolveBeatUnit) return ''
  const beatId = node.params.boundBeatId?.trim()
  if (!beatId) return ''
  const unit = resolveBeatUnit(beatId)
  return unit ? formatBeatRefText(unit) : ''
}

/**
 * 按入边顺序构建 `@n` 引用源，编号与 UI chips 一致；
 * 端口值缺正文时回退到源节点 params（与预览 resolveNodeTextContent 对齐）。
 * `mentionIndexBase`：风格图占用的编号数，端口从 base+1 起编。
 */
export function buildMentionSourcesForNode(input: {
  graph: GraphDocument
  nodeId: string
  byId: Map<string, GraphNode>
  outputs: Map<string, Record<string, GraphValue>>
  mentionIndexBase?: number
  resolveBeatUnit?: (beatId: string) => import('../beatParse').BeatRow | null
}): InstructionMentionSource[] {
  const base = Math.max(0, Math.floor(input.mentionIndexBase ?? 0))
  const incoming = expandIncomingThroughBundles(input.graph, input.nodeId)
  return incoming.map((edge, i) => {
    const index = portMentionIndex(i, base)
    const source = input.byId.get(edge.sourceNodeId)
    const sourcePort = edge.sourcePort
    const value = input.outputs.get(edge.sourceNodeId)?.[sourcePort]
    const fromValue = value ? graphValueToMentionSource(value, index) : null
    const keepMentionToken =
      fromValue?.keepMentionToken === true || shouldKeepInstructionMentionToken(source)
    const title =
      fromValue?.title?.trim() ||
      source?.title?.trim() ||
      source?.params.label?.trim() ||
      `@${index}`
    const text = keepMentionToken
      ? ''
      : fromValue?.text?.trim() ||
        fallbackMentionTextFromNode(source) ||
        fallbackBeatUnitRefText(source, input.resolveBeatUnit)
    return { index, title, text, keepMentionToken }
  })
}

/** 图片/视频生成节点：风格图占用的 `@n` 前缀数量 */
export function resolveGenerateMentionIndexBase(
  node: GraphNode,
  globalStyleImages?: ProjectStyleImage[] | null
): number {
  if (!isProcessingAssetNode(node)) return 0
  if (node.typeId !== 'asset.image' && node.typeId !== 'asset.video') return 0
  return resolveStyleMentionReserveCount(node.params, globalStyleImages)
}

function resolveMentionSources(ctx: NodeExecuteContext): InstructionMentionSource[] {
  if (ctx.mentionSources?.length) return ctx.mentionSources
  const incoming = collectIncomingValues(ctx.inputs)
  return incoming.map((value, i) => graphValueToMentionSource(value, i + 1))
}

/**
 * 画布上拖入的剧本资产引用。
 * 剧本优先 resolveAssetText（导入文件 URL / 新建 graphJson），否则走 genParams。
 */
export async function executeTextAssetRefNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  if (!ctx.node.assetId || !ctx.node.assetType) {
    throw new Error('GRAPH_UNBOUND_ASSET')
  }
  if (ctx.hasAsset && !ctx.hasAsset(ctx.node.assetId)) {
    throw new Error('GRAPH_MISSING_ASSET')
  }
  if (ctx.node.assetType === 'screenplay') {
    let text = (await ctx.resolveAssetText?.(ctx.node.assetId))?.trim() ?? ''
    if (!text) {
      const genParams = ctx.resolveAssetGenParams?.(ctx.node.assetId)
      text = resolveAssetTextFromGenParams(genParams, ctx.node.params)
    }
    // 节点上缓存的正文（拖入时预填）作最后兜底
    if (!text) text = ctx.node.params.text?.trim() ?? ''
    return { out: { kind: 'text', text } }
  }
  const genParams = ctx.resolveAssetGenParams?.(ctx.node.assetId)
  const text = resolveAssetTextFromGenParams(genParams, ctx.node.params)
  return { out: { kind: 'text', text } }
}

/**
 * 剧本生成节点：调用大模型生成剧本，落盘到输出路径并追加 generatedTexts。
 * 未注入 generateText 时退回纯文本汇总（测试/无 API 环境），仍会落盘（若已注入 saveRunText）。
 */
export async function executeScreenplayGenerateNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  if (isAssetRefNode(node)) {
    return executeTextAssetRefNode(ctx)
  }

  const mentionSources = resolveMentionSources(ctx)
  const instructionRaw = node.params.generateInstruction?.trim() ?? ''
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const incomingText = autoIncomingTextForInstruction(
    instructionRaw,
    selected,
    mentionSources
  )

  if (!ctx.generateText) {
    const localText = normalizeLocalScreenplayText(node.params.text)
    const text = instruction.trim() || incomingText || localText
    if (!text.trim()) return dualTextGalleryOutputs([], '')
    return await persistScreenplayGeneration(ctx, text)
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  let prompt = buildScreenplayPrompt(instruction, ctx.locale)
  if (incomingText) {
    prompt = `${prompt.trim()}\n\n${incomingText}`
  }

  const result = await ctx.generateText({
    prompt,
    system: resolveScreenplaySystemPrompt(node.params.generateSystemPrompt, ctx.locale),
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined
  })
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const text = result.text.trim()
  if (!text) throw new Error('模型未返回剧本文本')

  return await persistScreenplayGeneration(ctx, text)
}

/** 游戏系统策划案生成：按专业系统策划提示词生成功能点与 UI 布局要求，并写入文本图库 */
export async function executeGameSystemGenerateNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  if (isAssetRefNode(node)) {
    return executeTextAssetRefNode(ctx)
  }

  const mentionSources = resolveMentionSources(ctx)
  const instructionRaw = node.params.generateInstruction?.trim() ?? ''
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const incomingText = autoIncomingTextForInstruction(
    instructionRaw,
    selected,
    mentionSources
  )

  if (!ctx.generateText) {
    const localText = normalizeLocalScreenplayText(node.params.text)
    const text = instruction.trim() || incomingText || localText
    if (!text.trim()) return dualTextGalleryOutputs([], '')
    return await persistScreenplayGeneration(ctx, text)
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const userPrompt = instruction.trim() || defaultGameSystemUserPrompt(ctx.locale)
  const prompt = incomingText
    ? `${userPrompt.trim()}\n\n${incomingText}`
    : userPrompt
  const system = resolveGameSystemSystemPrompt(
    node.params.generateSystemPrompt,
    ctx.locale
  )

  const result = await ctx.generateText({
    prompt,
    system,
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined
  })
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const text = result.text.trim()
  if (!text) throw new Error('模型未返回游戏系统策划案')

  return await persistScreenplayGeneration(ctx, text)
}

export function executeNoteNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const text = ctx.node.params.text?.trim() ?? ''
  return {
    out: { kind: 'text', text }
  }
}

export function executePlayScriptNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const text = ctx.node.params.text?.trim() ?? ''
  return {
    out: { kind: 'text', text }
  }
}

/** 宿主编辑器输入接口槽：输出外层注入或节点上缓存的标量值 */
export async function executeHostInputSlotNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const slot = readHostInputSlot(ctx.node)
  const portType = slot?.dataType ?? GraphPortType.text
  const dataType = toSingularGraphPortDataType(portType)
  const plural = isPluralGraphPortDataType(portType)
  if (dataType === GraphPortType.text) {
    let text = ctx.node.params.text ?? ''
    const path = ctx.node.params.previewRelativePath?.trim()
    if (!text.trim() && path && ctx.readRunText) {
      try {
        text = (await ctx.readRunText(path))?.trim() ?? ''
      } catch {
        text = ''
      }
      if (text) {
        ctx.node.params = { ...ctx.node.params, text }
        ctx.patchNode?.({ params: { text } })
      }
    }
    if (plural) {
      return {
        out: {
          kind: 'texts',
          items: text.trim() || path ? [{ text, ...(path ? { relativePath: path } : {}) }] : []
        }
      }
    }
    return {
      out: {
        kind: 'text',
        text,
        ...(path ? { relativePath: path } : {})
      }
    }
  }
  if (dataType === GraphPortType.image) {
    const path = ctx.node.params.previewRelativePath?.trim()
    const dataUrl = ctx.node.params.previewDataUrl?.trim() ?? ''
    if (plural) {
      return {
        out: {
          kind: 'images',
          items: dataUrl || path ? [{ dataUrl, relativePath: path }] : []
        }
      }
    }
    return {
      out: {
        kind: 'image',
        dataUrl,
        relativePath: path || undefined
      }
    }
  }
  if (dataType === GraphPortType.video) {
    const path = ctx.node.params.previewRelativePath?.trim()
    const dataUrl = ctx.node.params.previewDataUrl?.trim()
    if (plural) {
      return {
        out: {
          kind: 'videos',
          items: dataUrl || path ? [{ dataUrl: dataUrl ?? '', relativePath: path }] : []
        }
      }
    }
    return {
      out: {
        kind: 'video',
        dataUrl: dataUrl || undefined,
        relativePath: path || undefined
      }
    }
  }
  if (dataType === GraphPortType.voice) {
    return {
      out: {
        kind: 'voices',
        items: ctx.node.params.previewRelativePath
          ? [{ relativePath: ctx.node.params.previewRelativePath }]
          : []
      }
    }
  }
  if (isGraphCatalogKind(dataType)) {
    const text = ctx.node.params.text ?? ''
    const path = ctx.node.params.previewRelativePath?.trim()
    return {
      out: catalogValue(dataType, text, path)
    }
  }
  return { out: { kind: 'text', text: ctx.node.params.text ?? '' } }
}

/** 宿主边界输入：优先用 prior seed（引擎 skip），否则读 params 缓存 */
export async function executeBoundaryInputNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  return executeHostInputSlotNode({
    ...ctx,
    node: {
      ...ctx.node,
      typeId: 'graph.input.slot',
      params: {
        ...ctx.node.params,
        hostInputSlot: {
          portId: ctx.node.params.hostBoundaryPort?.portId ?? 'in',
          index: 0,
          dataType: ctx.node.params.hostBoundaryPort?.dataType ?? GraphPortType.text
        }
      }
    }
  })
}

/** 边界输出透传后，把媒体路径写到节点 params，供画布备注卡预览 */
function patchBoundaryOutputPreview(ctx: NodeExecuteContext, value: GraphValue): void {
  const apply = (params: {
    previewRelativePath: string
    previewDataUrl?: string
    previewCollapsed: false
  }): void => {
    ctx.node.params = { ...ctx.node.params, ...params }
    ctx.patchNode?.({ params })
  }
  if (value.kind === 'image') {
    const rel = value.relativePath?.trim()
    if (!rel && !value.dataUrl?.trim()) return
    apply({
      previewRelativePath: rel || '',
      previewDataUrl: rel ? undefined : value.dataUrl,
      previewCollapsed: false
    })
    return
  }
  if (value.kind === 'images') {
    const item = value.items.find((i) => i.relativePath?.trim() || i.dataUrl?.trim())
    if (!item) return
    const rel = item.relativePath?.trim()
    apply({
      previewRelativePath: rel || '',
      previewDataUrl: rel ? undefined : item.dataUrl,
      previewCollapsed: false
    })
    return
  }
  if (value.kind === 'video') {
    const rel = value.relativePath?.trim()
    if (!rel && !value.dataUrl?.trim()) return
    apply({
      previewRelativePath: rel || '',
      previewDataUrl: rel ? undefined : value.dataUrl,
      previewCollapsed: false
    })
    return
  }
  if (value.kind === 'videos') {
    const item = value.items.find((i) => i.relativePath?.trim() || i.dataUrl?.trim())
    if (!item) return
    const rel = item.relativePath?.trim()
    apply({
      previewRelativePath: rel || '',
      previewDataUrl: rel ? undefined : item.dataUrl,
      previewCollapsed: false
    })
  }
}

/** 宿主边界输出：单数透传首个输入；复数口按类别合并为数组 */
export function executeBoundaryOutputNode(
  ctx: NodeExecuteContext
): Record<string, GraphValue> {
  const incoming = ctx.inputs.in ?? Object.values(ctx.inputs).flat()
  const dataType = ctx.node.params.hostBoundaryPort?.dataType ?? GraphPortType.text
  const aggregate =
    ctx.node.params.hostBoundaryPort?.multiple === true || isPluralGraphPortDataType(dataType)

  if (aggregate && incoming.length) {
    if (dataType === GraphPortType.image || dataType === GraphPortType.images) {
      const items = flattenImagesValues(incoming)
      const value: GraphValue = { kind: 'images', items }
      if (items.length) patchBoundaryOutputPreview(ctx, value)
      return { out: value }
    }
    if (dataType === GraphPortType.video || dataType === GraphPortType.videos) {
      const items = flattenVideosValues(incoming)
      const value: GraphValue = { kind: 'videos', items }
      if (items.length) patchBoundaryOutputPreview(ctx, value)
      return { out: value }
    }
    if (dataType === GraphPortType.voice || dataType === GraphPortType.voices) {
      const items = flattenVoicesValues(incoming)
      const value: GraphValue = { kind: 'voices', items }
      if (items.length) patchBoundaryOutputPreview(ctx, value)
      return { out: value }
    }
    if (dataType === GraphPortType.text || dataType === GraphPortType.texts) {
      const items = flattenTextsValues(incoming)
      const value: GraphValue = { kind: 'texts', items }
      if (items.length) patchBoundaryOutputPreview(ctx, value)
      return { out: value }
    }
  }

  const first = incoming[0]
  if (first) {
    patchBoundaryOutputPreview(ctx, first)
    return { out: first }
  }
  if (
    dataType === GraphPortType.beat ||
    dataType === GraphPortType.worldEntities ||
    dataType === GraphPortType.world
  ) {
    return { out: catalogValue(dataType, '') }
  }
  if (dataType === GraphPortType.image || dataType === GraphPortType.images) {
    return { out: { kind: 'images', items: [] } }
  }
  if (dataType === GraphPortType.video || dataType === GraphPortType.videos) {
    return { out: { kind: 'videos', items: [] } }
  }
  if (dataType === GraphPortType.voice || dataType === GraphPortType.voices) {
    return { out: { kind: 'voices', items: [] } }
  }
  if (dataType === GraphPortType.texts) {
    return { out: { kind: 'texts', items: [] } }
  }
  return { out: { kind: 'text', text: '' } }
}

/**
 * 提示词优化：展开 @ 引用后调用文本模型改写。
 * 未注入 generateText 时退回指令 / 上游 / 本地文本汇总。
 */
export async function executePromptOptimizeNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const episodeStep = node.params.episodeStep
  const episodeReviewTarget = node.params.episodeReviewTarget
  const episodeScopeKey = node.params.episodeScopeKey?.trim() || 'default'
  const mentionSources = resolveMentionSources(ctx)
  const reviewVariant =
    typeof node.params.episodeReviewVariant === 'string'
      ? node.params.episodeReviewVariant
      : null
  const reviewPack = resolveEpisodeDirectorReviewPack(episodeReviewTarget, reviewVariant)
  // 导演审核节点用最新 pack 指令（严格 PASS 门槛），不吃旧图里固化的宽松/严苛文案
  const instructionRaw =
    (reviewPack
      ? pickEpisodeAgentPrompt(reviewPack, ctx.locale, 'instruction')
      : node.params.generateInstruction?.trim()) ?? ''
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const incomingText = autoIncomingTextForInstruction(
    instructionRaw,
    selected,
    mentionSources
  )
  const localText = node.params.text?.trim() ?? ''

  if (!ctx.generateText) {
    const text = instruction.trim() || incomingText || localText
    if (text && text !== localText) {
      node.params = { ...node.params, text }
      ctx.patchNode?.({ params: { text } })
    }
    if (!text) return { out: { kind: 'text', text: '' } }
    return commitInMemoryTextGallery(ctx, text)
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  let prompt = buildOptimizePrompt(instruction, ctx.locale)
  // 指令未用 @ 引用上游时，把上游正文接到指令后（适配「剧本内容：」类预设）
  if (incomingText) {
    prompt = `${prompt.trim()}\n\n${incomingText}`
  }
  // 第二档闭环：上游 Agent 步骤存在 FAIL 原因时自动附加，要求针对修改
  if (episodeStep && ctx.readEpisodeAgentState) {
    const raw = await ctx.readEpisodeAgentState(episodeScopeKey)
    const failReason = episodeFailReasonForStep(parseEpisodeAgentState(raw), episodeStep)
    if (failReason) {
      prompt = `${prompt.trim()}\n\n【导演上次 FAIL 原因，必须针对性地修改】${failReason}`
    }
  }
  // 9宫格：注入从拆解表自动选出的 9 个关键锚点，强制逐格对应，避免模型自行乱选
  if (episodeStep === 'beatboard' && incomingText) {
    const anchors = selectEpisodeAnchors(parseEpisodeBeatBreakdown(incomingText))
    if (anchors.length) {
      const list = anchors
        .map((a, i) => `锚点${i + 1} ← 原始节拍 #${a.index}「${a.summary}」`)
        .join('\n')
      prompt = `${prompt.trim()}\n\n【9宫格必须严格按以下 9 个关键锚点生成：锚点1 对应 格1、锚点2 对应 格2，以此类推；每格 [节拍ID: #N] 的 N 为锚点序号 1~9，必须与格号一致，不得使用原始节拍编号，不得更改或自创】\n${list}`
    }
  }

  // 4宫格 / 动态提示词：注入各格节拍区间，末格必须吃掉末端关键帧之后的剩余节拍
  if (episodeStep === 'sequence' || episodeStep === 'motion') {
    let beatRows = parseEpisodeBeatBreakdown(incomingText)
    if (!beatRows.length) {
      for (const source of mentionSources ?? []) {
        beatRows = parseEpisodeBeatBreakdown(source.text)
        if (beatRows.length) break
      }
    }
    const spanNotes = formatEpisodeKeyframeSpanNotes(selectEpisodeKeyframeSpans(beatRows))
    if (spanNotes) {
      prompt = `${prompt.trim()}\n\n${spanNotes}`
    }
  }
  // 导演审核：始终用最新质检 pack，避免旧图仍固化「最严苛」标准导致几乎必 FAIL
  const systemPrompt = reviewPack
    ? pickEpisodeAgentPrompt(reviewPack, ctx.locale, 'systemPrompt')
    : resolveOptimizeSystemPrompt(node.params.generateSystemPrompt, ctx.locale)

  const result = await ctx.generateText({
    prompt,
    system: systemPrompt,
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined
  })
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const text = result.text.trim()
  if (!text) throw new Error('模型未返回优化结果')

  // 第二档闭环：导演审核节点解析 PASS/FAIL 并落盘 agent-state.json
  if (episodeReviewTarget && ctx.readEpisodeAgentState && ctx.writeEpisodeAgentState) {
    const verdict = parseEpisodeDirectorVerdict(text)
    if (verdict) {
      const raw = await ctx.readEpisodeAgentState(episodeScopeKey)
      const state =
        parseEpisodeAgentState(raw) ?? createEpisodeAgentState(episodeScopeKey, episodeScopeKey)
      const next = applyEpisodeAgentReview(state, episodeReviewTarget, verdict.result, verdict.reason)
      await ctx.writeEpisodeAgentState(episodeScopeKey, serializeEpisodeAgentState(next))
      node.params = {
        ...node.params,
        episodeReviewStatus: verdict.result,
        episodeReviewReason: verdict.reason,
        episodeReviewPending: false
      }
    }
  }

  return persistScreenplayGeneration(ctx, text)
}

/** 解析导演审核结论：## 结论: PASS 或 ## 结论: FAIL (原因: …) */
export function parseEpisodeDirectorVerdict(
  text: string
): { result: 'PASS' | 'FAIL'; reason: string } | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim()
    const match = /^##\s*结论\s*[:：]\s*(PASS|FAIL)\b/i.exec(line)
    if (!match) continue
    const result = match[1]!.toUpperCase() === 'PASS' ? 'PASS' : 'FAIL'
    let reason = ''
    if (result === 'FAIL') {
      const normalized = line.replace(/（/g, '(').replace(/）/g, ')')
      const inline = /\(原因\s*[:：]\s*([\s\S]*)\)/i.exec(normalized)
      if (inline) {
        reason = inline[1]!.trim()
      } else {
        const reasonLines: string[] = []
        for (let next = index + 1; next < lines.length; next++) {
          const nextLine = lines[next]!.trim()
          if (/^##\s*/.test(nextLine)) break
          if (!nextLine) continue
          reasonLines.push(nextLine)
          if (reasonLines.length >= 3) break
        }
        reason = reasonLines
          .join(' ')
          .replace(/^[-*]\s*/, '')
          .replace(/^原因\s*[:：]\s*/i, '')
          .trim()
      }
    }
    return { result, reason }
  }
  return null
}

/**
 * 导演审核结果回标：把 PASS/FAIL 与原因写到审核节点和对应生成节点（episodeStep 匹配）的参数上，
 * 使节点卡片与流水线视图不依赖状态文件也能直接显示审核状态。
 */
export function applyEpisodeReviewMarks(
  nodes: GraphNode[],
  patch: (nodeId: string, params: Partial<GraphNodeParams>) => void
): void {
  for (const node of nodes) {
    const target = node.params?.episodeReviewTarget
    if (!target) continue
    const text = typeof node.params?.text === 'string' ? node.params.text : ''
    const verdict = parseEpisodeDirectorVerdict(text)
    if (!verdict) continue
    const marks: Partial<GraphNodeParams> = {
      episodeReviewStatus: verdict.result,
      episodeReviewReason: verdict.reason,
      episodeReviewPending: false
    }
    patch(node.id, marks)
    const upstream = nodes.find(
      (candidate) =>
        candidate.typeId === 'prompt.optimize' &&
        candidate.params?.episodeStep === target &&
        candidate.id !== node.id
    )
    if (upstream) patch(upstream.id, marks)
  }
}

/** 宫格选择：从 9宫格分镜表文本中选中一个宫格，输出该格提示词 */
export async function executeEpisodeAnchorSelectNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const incoming = flattenTextValues(ctx.inputs.in ?? Object.values(ctx.inputs).flat())
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join('\n\n')
  const source = incoming || node.params.text?.trim() || ''
  const index = node.params.anchorIndex ?? 1
  const row = selectEpisodeAnchor(source, index)
  const outText = row
    ? `# 格${row.index}${row.title ? ` - ${row.title}` : ''}${row.beatId ? ` [节拍ID: ${row.beatId}]` : ''}\n\n${row.text}`
    : source
  node.params = { ...node.params, text: outText }
  ctx.patchNode?.({ params: { text: outText } })
  return { out: { kind: 'text', text: outText } }
}

/** 动态格选择：优先从动态提示词表选中该格指令，回退到 4宫格动态分镜表选中该格内容 */
export async function executeEpisodeCellSelectNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const incoming = flattenTextValues(ctx.inputs.in ?? Object.values(ctx.inputs).flat())
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join('\n\n')
  const source = incoming || node.params.text?.trim() || ''
  const groupIndex = node.params.cellGroupIndex ?? 1
  const cellIndex = node.params.cellIndex ?? 1
  const motionRow = selectEpisodeMotion(source, groupIndex, cellIndex)
  const cellRow = selectEpisodeCell(source, groupIndex, cellIndex)
  const outText = motionRow
    ? `# ${motionRow.key}\n\n${motionRow.text}`
    : cellRow
      ? `# 格${cellRow.groupIndex}-${cellRow.cellIndex} (${cellRow.stage})\n\n${cellRow.text}`
      : source
  node.params = { ...node.params, text: outText }
  ctx.patchNode?.({ params: { text: outText } })
  return { out: { kind: 'text', text: outText } }
}

/** 成片时间线输出：透传上游视频（单视频 / 视频组），写回图库与预览路径 */
export async function executeTimelineOutputNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  // 合并全部输入口（单条 in 与方形 in-videos 视频组），按出现顺序排入时间线
  const incoming = Object.values(ctx.inputs).flat()
  const videos = flattenVideosValues(incoming)
  const previewRelativePath = videos[0]?.relativePath?.trim() || undefined
  const previewDataUrl = videos[0]?.dataUrl?.trim() || undefined
  const paramsPatch = {
    resultText: '',
    text: '',
    generatedVideos: videos.map((video) => ({
      id: video.id,
      dataUrl: video.dataUrl,
      relativePath: video.relativePath,
      createdAt: video.createdAt
    })),
    cameraShots: [] as [],
    previewDataUrl: previewDataUrl || '',
    previewRelativePath: previewRelativePath || '',
    outputKind: 'video' as GraphOutputKind,
    inputDataType: GraphPortType.video
  }
  ctx.node.params = { ...ctx.node.params, ...paramsPatch }
  ctx.patchNode?.({ params: paramsPatch })
  return { out: { kind: 'videos', items: videos } }
}

/**
 * 世界元素表格：有上游世界目录则透传并导入（提取 → 表格）；
 * 否则输出当前目录 JSON。
 * 导入只在节点执行时发生，打开表格窗口不会导入。
 */
export async function executeWorldTableNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const fromIn = catalogTextFromInputs(Object.values(ctx.inputs).flat(), GraphPortType.world)
  if (fromIn) {
    ctx.node.params = { ...ctx.node.params, text: fromIn }
    ctx.patchNode?.({ params: { text: fromIn } })
    await ctx.importWorldCatalogJson?.(fromIn, ctx.node.id)
    return { out: catalogValue(GraphPortType.world, fromIn) }
  }

  const fromCatalog = ctx.resolveWorldCatalogJson?.()?.trim()
  if (fromCatalog) {
    ctx.node.params = { ...ctx.node.params, text: fromCatalog }
    ctx.patchNode?.({ params: { text: fromCatalog } })
    return { out: catalogValue(GraphPortType.world, fromCatalog) }
  }

  const local = ctx.node.params.text?.trim() ?? ''
  return local ? { out: catalogValue(GraphPortType.world, local) } : {}
}

export { worldGenImageGroupOutputs }

/**
 * 世界元素生成：有上游提取/表格目录时同步到元素子图；
 * 再通过 ctx.collectWorldElementOutputs 汇集四类 elementWorkflow 边界输出实体。
 * 是否入队批跑元素子图由 ctx.cookBatchSubgraphs 决定（Cook 子图 / 整链为 true）。
 * 导入只在节点执行时发生，打开编辑窗口不会导入。
 */
export async function executeWorldGenNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const fromIn = catalogTextFromInputs(Object.values(ctx.inputs).flat(), GraphPortType.world)
  if (fromIn) {
    await ctx.importWorldCatalogJson?.(fromIn, ctx.node.id)
  }

  const collected = await ctx.collectWorldElementOutputs?.(ctx.signal, {
    cookBatch: ctx.cookBatchSubgraphs === true,
    nodeId: ctx.node.id
  })
  const items: WorldElementGenResult[] = (collected?.items ?? [])
    .map((item) => ({
      type: item.type as WorldElementGenResult['type'],
      name: String(item.name ?? '').trim(),
      imageUrl: String(item.imageUrl ?? '').trim()
    }))
    .filter((item) => item.type && item.name && item.imageUrl)

  const text = stringifyWorldElementGenResults(items)
  const params = {
    worldElementOutputs: items,
    text
  }
  ctx.node.params = { ...ctx.node.params, ...params }
  ctx.patchNode?.({ params })
  return worldGenImageGroupOutputs(items)
}

/** 世界元素实体输出：透传 worldEntities 目录 JSON */
export async function executeWorldEntitiesOutputNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const fromIn = catalogTextFromInputs(
    Object.values(ctx.inputs).flat(),
    GraphPortType.worldEntities
  )
  const text = fromIn ?? ''
  const items = parseWorldElementGenResults(text)
  const paramsPatch = {
    resultText: text,
    worldElementOutputs: items,
    outputKind: (ctx.node.params.outputKind ?? 'text') as GraphOutputKind,
    inputDataType: GraphPortType.worldEntities
  }
  ctx.node.params = { ...ctx.node.params, ...paramsPatch }
  ctx.patchNode?.({ params: paramsPatch })
  return text
    ? { out: catalogValue(GraphPortType.worldEntities, text) }
    : { out: catalogValue(GraphPortType.worldEntities, '[]') }
}

/** 场输出：透传 beat 目录 JSON */
export async function executeBeatCatalogOutputNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const fromIn = catalogTextFromInputs(
    Object.values(ctx.inputs).flat(),
    GraphPortType.beat
  )
  const text = fromIn ?? ''
  const paramsPatch = {
    resultText: text,
    text,
    generatedTexts: [] as GraphTextItem[],
    outputKind: (ctx.node.params.outputKind ?? 'text') as GraphOutputKind,
    inputDataType: GraphPortType.beat
  }
  ctx.node.params = { ...ctx.node.params, ...paramsPatch }
  ctx.patchNode?.({ params: paramsPatch })
  return {
    out: catalogValue(GraphPortType.beat, text || '[]')
  }
}

/**
 * 场表格：有上游场目录则透传并导入；
 * 可同时接收世界元素实体（写入 params，供表格引用）；
 * 否则输出当前目录 JSON。
 */
export async function executeBeatTableNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const fromIn = catalogTextFromInputs(
    ctx.inputs.in ?? Object.values(ctx.inputs).flat(),
    GraphPortType.beat
  )
  if (fromIn) {
    ctx.node.params = { ...ctx.node.params, text: fromIn }
    ctx.patchNode?.({ params: { text: fromIn } })
    await ctx.importBeatCatalogJson?.(fromIn)
    return { out: catalogValue(GraphPortType.beat, fromIn) }
  }

  const fromCatalog = ctx.resolveBeatCatalogJson?.()?.trim()
  if (fromCatalog) {
    ctx.node.params = { ...ctx.node.params, text: fromCatalog }
    ctx.patchNode?.({ params: { text: fromCatalog } })
    return { out: catalogValue(GraphPortType.beat, fromCatalog) }
  }

  const local = ctx.node.params.text?.trim() ?? ''
  return local ? { out: catalogValue(GraphPortType.beat, local) } : {}
}

/**
 * 场生成：有上游场目录时同步到单元子图；
 * 再从各单元 beatUnit 子图收集「场输出」已有文本并落地到输出路径（不级联跑子图生成）。
 * 导入只在节点执行时发生，打开细化窗口不会导入。
 */
export async function executeBeatGenNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const fromIn = catalogTextFromInputs(
    Object.values(ctx.inputs).flat(),
    GraphPortType.beat
  )
  if (fromIn) {
    // 先导入目录再 patch，减少与单元图落盘的竞态
    await ctx.importBeatCatalogJson?.(fromIn)
    ctx.node.params = { ...ctx.node.params, text: fromIn }
    ctx.patchNode?.({ params: { text: fromIn } })
  }

  const collected = await ctx.collectBeatUnitTexts?.(ctx.signal)
  const items = collected?.items ?? []
  if (!items.length) {
    const paramsPatch = {
      generatedTexts: [] as GraphTextItem[],
      selectedTextId: '',
      previewRelativePath: '',
      resultText: ''
    }
    ctx.node.params = { ...ctx.node.params, ...paramsPatch }
    ctx.patchNode?.({ params: paramsPatch })
    return dualTextGalleryOutputs([], '')
  }

  const hydrated = await hydrateTextItems(items, ctx.readRunText)
  const materialized = await materializeBeatUnitTextItems(ctx, hydrated)
  if (!materialized.length) {
    const paramsPatch = {
      generatedTexts: [] as GraphTextItem[],
      selectedTextId: '',
      previewRelativePath: '',
      resultText: ''
    }
    ctx.node.params = { ...ctx.node.params, ...paramsPatch }
    ctx.patchNode?.({ params: paramsPatch })
    return dualTextGalleryOutputs([], '')
  }

  const stripped = materialized.map(stripEmbeddedTextData)
  const selectedTextId = newestTextSelectedId(stripped)
  const previewRelativePath =
    stripped.find((item) => item.relativePath?.trim())?.relativePath?.trim() || ''
  const resultText = (
    await hydrateTextItems(stripped, ctx.readRunText)
  )
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join('\n\n')

  const paramsPatch = {
    generatedTexts: stripped,
    selectedTextId,
    previewRelativePath,
    resultText
  }
  ctx.node.params = { ...ctx.node.params, ...paramsPatch }
  ctx.patchNode?.({ params: paramsPatch })

  return dualTextGalleryOutputs(stripped, selectedTextId)
}

/**
/**
 * 世界元素提取：将上游剧本文本拆成角色/场景/道具/武器目录。
 * 成功结果写入 generatedTexts 图库；`out` 选中目录，`out-all` 历史。
 * 合并「已审核」项时只读本地 params 中的上次目录。
 */
export async function executeWorldExtractNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const mentionSources = resolveMentionSources(ctx)
  const instructionRaw = node.params.generateInstruction?.trim() ?? ''
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const incomingText = autoIncomingTextForInstruction(
    instructionRaw,
    selected,
    mentionSources
  )
  const localText = node.params.text?.trim() ?? ''
  const previousCatalog = parseWorldElementCatalog(localText)

  if (!ctx.generateText) {
    const text = localText || instruction.trim()
    if (!text.trim()) {
      const gallery = resolveGalleryOutputsFromNodeParams(node.params, {
        typeId: node.typeId
      })
      return gallery ?? dualWorldCatalogOutputs([], '')
    }
    if ((node.params.generatedTexts ?? []).length) {
      // 无模型：复用已有图库选中，仅同步 text
      node.params = { ...node.params, text }
      ctx.patchNode?.({ params: { text } })
      return (
        resolveGalleryOutputsFromNodeParams(node.params, { typeId: node.typeId }) ??
        dualWorldCatalogOutputs([], '')
      )
    }
    return persistWorldExtractGeneration(ctx, text)
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  let prompt = buildWorldExtractPrompt(instruction, ctx.locale)
  if (incomingText) {
    prompt = `${prompt.trim()}\n\n${incomingText}`
  }

  const result = await ctx.generateText({
    prompt,
    system: resolveWorldExtractSystemPrompt(node.params.generateSystemPrompt, ctx.locale),
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined
  })
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  let text = result.text.trim()
  if (!text) throw new Error('模型未返回世界元素提取结果')

  const nextCatalog = parseWorldElementCatalog(text)
  const merged = mergeWorldCatalogPreservingReviewed(previousCatalog, nextCatalog)
  if (merged) {
    text = stringifyWorldElementCatalog(merged)
  }

  return persistWorldExtractGeneration(ctx, text)
}

/**
 * 场拆解：将上游剧本文本（text）拆成有序场 JSON。
 * 成功结果写入 generatedTexts 图库；`out` 选中目录，`out-all` 历史。
 * 通常经由 text.select 从 texts 中选出单条后再接入。
 * 本地若含上次拆解 JSON，合并时强制保留「已审核」行。
 */
/** 收集场拆解可用的上游剧本文本（含 texts.relativePath 落盘正文） */
async function resolveBeatSplitSourceText(
  ctx: NodeExecuteContext,
  instructionRaw: string,
  mentionSources?: InstructionMentionSource[]
): Promise<string> {
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  let text = autoIncomingTextForInstruction(
    instructionRaw,
    selected,
    mentionSources
  ).trim()
  if (text) return text

  // 上游仅有落盘路径、或软快照曾给出空 text 时，按路径 / 资产再读一遍
  for (const value of selected) {
    if (value.kind === 'text' && value.text.trim()) return value.text.trim()
    if (value.kind === 'texts') {
      for (const item of value.items) {
        const body = item.text?.trim() ?? ''
        if (body) return body
        const rel = item.relativePath?.trim()
        if (rel && ctx.readRunText) {
          const fromFile = (await ctx.readRunText(rel))?.trim() ?? ''
          if (fromFile) return fromFile
        }
      }
    }
    if (value.kind === 'asset' && value.assetType === 'screenplay' && value.assetId) {
      const fromAsset = (await ctx.resolveAssetText?.(value.assetId))?.trim() ?? ''
      if (fromAsset) return fromAsset
      const genParams = ctx.resolveAssetGenParams?.(value.assetId)
      const fromGraph = resolveAssetTextFromGenParams(genParams, null).trim()
      if (fromGraph) return fromGraph
    }
  }
  return ''
}

export async function executeBeatUnitGenNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const mentionSources = resolveMentionSources(ctx)
  const instructionRaw = node.params.generateInstruction?.trim() ?? ''
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const incomingText = autoIncomingTextForInstruction(
    instructionRaw,
    selected,
    mentionSources
  )
  const localText = node.params.text?.trim() ?? ''

  if (!ctx.generateText) {
    const text = instruction.trim() || incomingText || localText
    if (text && text !== localText) {
      node.params = { ...node.params, text }
      ctx.patchNode?.({ params: { text } })
    }
    if (!text) return { out: { kind: 'text', text: '' } }
    return commitInMemoryTextGallery(ctx, text)
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  let prompt = buildBeatUnitGenPrompt(instruction, ctx.locale)
  if (incomingText) {
    prompt = `${prompt.trim()}\n\n${incomingText}`
  }

  const result = await ctx.generateText({
    prompt,
    system: resolveBeatUnitGenSystemPrompt(node.params.generateSystemPrompt, ctx.locale),
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined
  })
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const text = result.text.trim()
  if (!text) throw new Error('模型未返回叙事细化结果')

  return persistScreenplayGeneration(ctx, text)
}

/** 场参考：输出绑定单元的目录字段文本 */

export function executeBeatUnitRefNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const beatId = ctx.node.params.boundBeatId?.trim()
  if (!beatId) return {}
  const unit = ctx.resolveBeatUnit?.(beatId)
  if (!unit) return {}
  const text = formatBeatRefText(unit)
  return text ? { out: { kind: 'text', text } } : {}
}

export async function executeBeatSplitNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const mentionSources = resolveMentionSources(ctx)
  const instructionRaw = node.params.generateInstruction?.trim() ?? ''
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  const incomingText = await resolveBeatSplitSourceText(
    ctx,
    instructionRaw,
    mentionSources
  )
  const localText = node.params.text?.trim() ?? ''
  const previousRows = parseBeatJson(localText)

  if (!ctx.generateText) {
    // 无模型时只输出本地已有目录，不把上游剧本文冒充目录
    const text = localText || instruction.trim()
    if (!text.trim()) {
      const gallery = resolveGalleryOutputsFromNodeParams(node.params, {
        typeId: node.typeId
      })
      return gallery ?? dualBeatCatalogOutputs([], '')
    }
    if ((node.params.generatedTexts ?? []).length) {
      node.params = { ...node.params, text }
      ctx.patchNode?.({ params: { text } })
      return (
        resolveGalleryOutputsFromNodeParams(node.params, { typeId: node.typeId }) ??
        dualBeatCatalogOutputs([], '')
      )
    }
    return persistBeatSplitGeneration(ctx, text)
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  // 无上游正文时：若指令里用了 @ 引用且已展开出内容，仍可继续；否则报无输入
  const hasMentionSource =
    instructionHasMentions(instructionRaw) && !!instruction.trim()
  if (!incomingText.trim() && !hasMentionSource) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  let prompt = buildBeatSplitPrompt(instruction, ctx.locale)
  if (incomingText.trim()) {
    prompt = `${prompt.trim()}\n\n${incomingText}`
  }

  const result = await ctx.generateText({
    prompt,
    system: resolveBeatSplitSystemPrompt(node.params.generateSystemPrompt, ctx.locale),
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined
  })
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  let text = result.text.trim()
  if (!text) throw new Error('模型未返回场拆解结果')

  const nextRows = parseBeatJson(text)
  const merged = mergeBeatRowsPreservingReviewed(previousRows, nextRows)
  if (merged?.length) {
    text = stringifyBeatRows(merged)
  }

  return persistBeatSplitGeneration(ctx, text)
}

/**
 * UI 界面拆分：读策划案，把每个独立界面拆成详细生图提示词。
 * 主出口 `out` 为 texts 数组（每项一个界面）；图库 generatedTexts 同步保存便于预览。
 */
export async function executeUiSplitNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const mentionSources = resolveMentionSources(ctx)
  const instructionRaw = node.params.generateInstruction?.trim() ?? ''
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  const incomingText = await resolveBeatSplitSourceText(
    ctx,
    instructionRaw,
    mentionSources
  )

  if (!ctx.generateText) {
    const existing = resolveGalleryOutputsFromNodeParams(node.params, {
      typeId: node.typeId
    })
    if (existing) return existing
    const fallback = instruction.trim() || incomingText.trim()
    if (!fallback) return { out: { kind: 'texts', items: [] } }
    const screens = parseUiScreenPrompts(fallback)
    if (!screens.length) return { out: { kind: 'texts', items: [] } }
    return persistUiSplitGeneration(ctx, screens)
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const hasMentionSource =
    instructionHasMentions(instructionRaw) && !!instruction.trim()
  if (!incomingText.trim() && !hasMentionSource) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  let prompt = buildUiSplitPrompt(instruction, ctx.locale)
  if (incomingText.trim()) {
    prompt = `${prompt.trim()}\n\n${incomingText}`
  }

  const result = await ctx.generateText({
    prompt,
    system: resolveUiSplitSystemPrompt(node.params.generateSystemPrompt, ctx.locale),
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined
  })
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const text = result.text.trim()
  if (!text) throw new Error('模型未返回 UI 界面拆分结果')

  const screens = parseUiScreenPrompts(text)
  if (!screens.length) {
    throw new Error('模型未返回可解析的界面列表（需要 JSON 数组，含 title/prompt）')
  }

  return persistUiSplitGeneration(ctx, screens)
}

/** UI 界面生成：接收界面提示词数组，落为 uiScreens 供 dive 内图使用；外口输出图片组（由内图产出） */
export async function executeUiGenNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const incoming = screensFromUiGenIncoming(Object.values(ctx.inputs).flat())
  // 端口无输入时保留已存界面列表，避免上游未运行就把 dive 提示词清空
  const screens = incoming.length
    ? incoming
    : (Array.isArray(node.params.uiScreens) ? node.params.uiScreens : [])
  const summary = screens.map((s, i) => `${i + 1}. ${s.title}`).join('\n')
  // 点 cook：收集内图所有输出边界（边界输出未运行也可从上游取到），并落节点图库供预览
  const collected = collectUiGenInnerOutputs(ctx)
  const out: GraphValue = collected ?? { kind: 'images', items: [] }
  const gallery = collected ? outputsToHostGalleryParams({ out }) : {}
  node.params = { ...node.params, text: summary, uiScreens: screens, ...gallery }
  ctx.patchNode?.({ params: { text: summary, uiScreens: screens, ...gallery } })
  return { out }
}

/** ui.gen：从 dive 子图资产软解析所有输出边界，合并为图片组 */
function collectUiGenInnerOutputs(ctx: NodeExecuteContext): GraphValue | undefined {
  const assetId = ctx.node.params.uiSplitAssetId?.trim()
  if (!assetId) return undefined
  const liveDoc = ctx.resolveLiveAssetGraph?.(assetId)
  const gen = ctx.resolveAssetGenParams?.(assetId)
  const raw = liveDoc ?? gen?.graphJson
  if (
    !raw ||
    typeof raw !== 'object' ||
    !Array.isArray((raw as GraphDocument).nodes)
  ) {
    return undefined
  }
  const doc = raw as GraphDocument
  const collected: GraphValue[] = []
  const softOptions: ResolveHostInputSlotsOptions = {
    resolveLiveAssetGraph: ctx.resolveLiveAssetGraph,
    resolveAssetGenParams: ctx.resolveAssetGenParams
  }
  for (const bnode of doc.nodes) {
    if (!isBoundaryOutputNode(bnode)) continue
    const value = softResolveBoundaryOutputValue(doc, bnode.id, softOptions)
    if (graphValueHasPayload(value)) collected.push(value)
  }
  return mergeBoundarySoftValues(collected, GraphPortType.images)
}

async function persistUiSplitGeneration(
  ctx: NodeExecuteContext,
  screens: Array<{ id: string; title: string; prompt: string }>
): Promise<Record<string, GraphValue>> {
  const createdAt = new Date().toISOString()
  const stamp = formatGeneratedMediaStamp()
  const items = screens.map((screen, index) => ({
    id: screen.id || `ui-screen:${stamp}:${index}`,
    title: screen.title,
    text: screen.prompt,
    createdAt
  }))
  // 每次拆分结果整体替换图库，避免新旧界面混在一起
  const generatedTexts = items
  const selectedTextId = newestTextSelectedId(generatedTexts)
  const summary = screens.map((s, i) => `${i + 1}. ${s.title}`).join('\n')
  // 提示词变化或内图结构升级时作废旧的内图资产引用，
  // 避免 dive 打开与当前提示词 / 新结构不一致的子图
  const sameScreens = JSON.stringify(screens) === JSON.stringify(ctx.node.params.uiScreens)
  const sameVersion = ctx.node.params.uiSplitGraphVersion === UI_SPLIT_INNER_GRAPH_VERSION
  const uiSplitAssetId =
    sameScreens && sameVersion ? ctx.node.params.uiSplitAssetId : ''
  ctx.node.params = {
    ...ctx.node.params,
    text: summary,
    generatedTexts,
    selectedTextId,
    uiScreens: screens,
    uiSplitAssetId
  }
  ctx.patchNode?.({
    params: {
      text: summary,
      generatedTexts,
      selectedTextId,
      uiScreens: screens,
      uiSplitAssetId
    }
  })
  return { out: { kind: 'texts', items: generatedTexts } }
}

async function collectImageUrlsForPrompt(
  ctx: NodeExecuteContext,
  instructionRaw: string
): Promise<string[]> {
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const items = flattenImagesValues(selected).filter(
    (item) =>
      (typeof item.dataUrl === 'string' && item.dataUrl.length > 0) ||
      (typeof item.relativePath === 'string' && item.relativePath.length > 0)
  )
  const urls: string[] = []
  if (items.length && ctx.resolveImageUrls) {
    urls.push(...(await ctx.resolveImageUrls(items)))
  } else {
    for (const item of items) {
      const dataUrl = item.dataUrl?.trim()
      if (dataUrl) urls.push(dataUrl)
    }
  }
  if (ctx.resolveAssetImageUrl) {
    for (const asset of flattenAssetValues(selected)) {
      if (asset.assetType !== 'image') continue
      const url = await ctx.resolveAssetImageUrl(asset.assetId)
      if (url) urls.push(url)
    }
  }
  // 去重，最多传 4 张以免请求过大
  return [...new Set(urls.filter(Boolean))].slice(0, 4)
}

/**
 * 图片反推提示词：展开指令后调用视觉文本模型。
 * 未注入 generateText 时退回本地文本 / 上游资产说明。
 */
export async function executeImageToPromptNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const mentionSources = resolveMentionSources(ctx)
  const instructionRaw = node.params.generateInstruction?.trim() ?? ''
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const incomingText = autoIncomingTextForInstruction(
    instructionRaw,
    selected,
    mentionSources
  )
  const localText = node.params.text?.trim() ?? ''
  const hints = flattenAssetValues(selected)
    .map((asset) => [asset.title, asset.label, asset.notes].filter(Boolean).join(' · '))
    .filter(Boolean)
    .join('\n')

  if (!ctx.generateText) {
    const text = instruction.trim() || incomingText || localText || hints
    if (text && text !== localText) {
      node.params = { ...node.params, text }
      ctx.patchNode?.({ params: { text } })
    }
    if (!text) return { out: { kind: 'text', text: '' } }
    return commitInMemoryTextGallery(ctx, text)
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const images = await collectImageUrlsForPrompt(ctx, instructionRaw)
  if (!images.length) {
    // 反推必须有图；有指令但无图时仍提示需要图片输入（非「未连接」泛化）
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  let prompt = buildToPromptUserPrompt(instruction, ctx.locale)
  if (incomingText) {
    prompt = `${prompt.trim()}\n\n${incomingText}`
  }
  const result = await ctx.generateText({
    prompt,
    system: resolveToPromptSystemPrompt(node.params.generateSystemPrompt, ctx.locale),
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined,
    images
  })
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const text = result.text.trim()
  if (!text) throw new Error('模型未返回提示词')

  return persistScreenplayGeneration(ctx, text)
}

export function executeCamera3dNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const shots = ctx.node.params.cameraShots ?? []
  const items: GraphImageItem[] = shots
    .filter(
      (shot) =>
        (typeof shot.dataUrl === 'string' && shot.dataUrl.length > 0) ||
        (typeof shot.relativePath === 'string' && shot.relativePath.length > 0)
    )
    .map((shot) => ({
      id: shot.id,
      dataUrl: shot.dataUrl || '',
      createdAt: shot.createdAt,
      ...(shot.relativePath ? { relativePath: shot.relativePath } : {})
    }))
  // 无站位截图时回退单张预览图
  if (!items.length && ctx.node.params.previewDataUrl) {
    items.push({ dataUrl: ctx.node.params.previewDataUrl })
  } else if (!items.length && ctx.node.params.previewRelativePath) {
    items.push({ dataUrl: '', relativePath: ctx.node.params.previewRelativePath })
  }
  const videos = ctx.node.params.cameraVideos ?? []
  const videoItems: GraphVideoItem[] = videos
    .filter(
      (video) =>
        (typeof video.dataUrl === 'string' && video.dataUrl.length > 0) ||
        (typeof video.relativePath === 'string' && video.relativePath.length > 0)
    )
    .map((video) => ({
      id: video.id,
      dataUrl: video.dataUrl || '',
      createdAt: video.createdAt,
      ...(video.relativePath ? { relativePath: video.relativePath } : {})
    }))
  return {
    'out-shots': { kind: 'images', items },
    'out-actions': { kind: 'videos', items: videoItems }
  }
}

/** 画布上拖入的导演台资产引用：从资产 stage/graph 读取站位/动作 */
export function executeMotionAssetRefNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const genParams = ctx.node.assetId
    ? ctx.resolveAssetGenParams?.(ctx.node.assetId)
    : undefined
  const items = resolveMotionImageItems(genParams, ctx.node.params, ctx.node.id)
  const videoItems = resolveMotionVideoItems(genParams, ctx.node.params, ctx.node.id)
  if (items.length || videoItems.length) {
    const cameraShots = items.map((image, index) => ({
      id: image.id ?? `shot:${index}`,
      dataUrl: image.dataUrl,
      createdAt: image.createdAt ?? new Date().toISOString(),
      ...(image.relativePath ? { relativePath: image.relativePath } : {})
    }))
    const cameraVideos = videoItems.map((video, index) => ({
      id: video.id ?? `action:${index}`,
      dataUrl: video.dataUrl,
      createdAt: video.createdAt ?? new Date().toISOString(),
      ...(video.relativePath ? { relativePath: video.relativePath } : {})
    }))
    ctx.patchNode?.({
      params: {
        ...(cameraShots.length ? { cameraShots, previewDataUrl: cameraShots[0]?.dataUrl } : {}),
        ...(cameraVideos.length ? { cameraVideos } : {})
      }
    })
  }
  return {
    'out-shots': { kind: 'images', items },
    'out-actions': { kind: 'videos', items: videoItems }
  }
}

/** 选取图片：从图片数组中选出一张，输出为单张 image */
export function executeSelectImageNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const items = flattenImagesValues(collectIncomingValues(ctx.inputs)).filter(
    (item) =>
      (typeof item.dataUrl === 'string' && item.dataUrl.length > 0) ||
      (typeof item.relativePath === 'string' && item.relativePath.length > 0)
  )
  const picked = pickImageItem(items, ctx.node.params.selectedImageId)
  const selectedImageId = picked
    ? imageItemKey(picked, Math.max(0, items.indexOf(picked)))
    : undefined
  const previewDataUrl = picked?.dataUrl?.trim() ? picked.dataUrl : undefined
  const previewRelativePath = picked?.relativePath?.trim() ? picked.relativePath : undefined
  ctx.node.params = {
    ...ctx.node.params,
    ...(selectedImageId ? { selectedImageId } : {}),
    previewDataUrl,
    previewRelativePath
  }
  ctx.patchNode?.({
    params: {
      selectedImageId,
      previewDataUrl,
      previewRelativePath
    }
  })
  if (!picked) {
    return { out: { kind: 'image', dataUrl: '' } }
  }
  return {
    out: {
      kind: 'image',
      id: selectedImageId,
      dataUrl: picked.dataUrl || '',
      createdAt: picked.createdAt,
      ...(picked.relativePath ? { relativePath: picked.relativePath } : {})
    }
  }
}

/**
 * 选取文本：从 texts 数组中选出一条，输出为单个 text（落盘项会读全文）。
 */
export async function executeSelectTextNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const items = flattenTextsValues(collectIncomingValues(ctx.inputs)).filter(
    (item) => item.text?.trim() || item.relativePath?.trim()
  )
  const picked = pickTextItem(items, ctx.node.params.selectedTextId)
  const selectedTextId = picked
    ? textItemKey(picked, Math.max(0, items.indexOf(picked)))
    : undefined
  const hydrated = picked
    ? (await hydrateTextItems([picked], ctx.readRunText))[0]
    : undefined
  const text = hydrated?.text?.trim() ?? ''
  const previewRelativePath = hydrated?.relativePath?.trim() || undefined
  ctx.node.params = {
    ...ctx.node.params,
    ...(selectedTextId ? { selectedTextId } : {}),
    text,
    ...(previewRelativePath ? { previewRelativePath } : { previewRelativePath: undefined })
  }
  ctx.patchNode?.({
    params: {
      selectedTextId,
      text,
      previewRelativePath
    }
  })
  return { out: { kind: 'text', text } }
}

/**
 * 从入边取场目录 JSON。
 * soft 快照偶发把上游目录解析成 text，此时若正文可 parse 为场行则同样接受。
 */
function beatCatalogTextFromIncoming(inputs: Record<string, GraphValue[]>): string {
  const values = collectIncomingValues(inputs)
  const fromBeat = catalogTextFromInputs(values, GraphPortType.beat)
  if (fromBeat) return fromBeat
  for (const value of values) {
    if (value?.kind !== 'text') continue
    const text = value.text?.trim() ?? ''
    if (!text) continue
    const rows = parseBeatJson(text)
    if (rows?.length) return text
  }
  return ''
}

/**
 * 选择场：从 beat 目录中选出一行，输出可读普通文本。
 */
export function executeSelectBeatNode(
  ctx: NodeExecuteContext
): Record<string, GraphValue> {
  const catalogText = beatCatalogTextFromIncoming(ctx.inputs)
  const rows = parseBeatJson(catalogText) ?? []
  const selectedId = ctx.node.params.selectedBeatId?.trim()
  const picked =
    (selectedId ? rows.find((row) => row.id === selectedId) : undefined) ?? rows[0]
  if (!picked) {
    // 上游瞬时软快照失败时保留已有结果，避免「执行当前」把预览清空
    const existing = ctx.node.params.text?.trim() ?? ''
    if (existing) {
      return { out: { kind: 'text', text: existing } }
    }
    ctx.node.params = { ...ctx.node.params, text: '', selectedBeatId: '' }
    ctx.patchNode?.({ params: { text: '', selectedBeatId: '' } })
    return {}
  }
  const text = formatBeatRefText(picked)
  ctx.node.params = {
    ...ctx.node.params,
    selectedBeatId: picked.id,
    text
  }
  ctx.patchNode?.({
    params: {
      selectedBeatId: picked.id,
      text
    }
  })
  return { out: { kind: 'text', text } }
}

/** 选取视频：从视频数组中选出一条，输出为单个 video */
export function executeSelectVideoNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const items = flattenVideosValues(collectIncomingValues(ctx.inputs)).filter(
    (item) =>
      (typeof item.dataUrl === 'string' && item.dataUrl.length > 0) ||
      (typeof item.relativePath === 'string' && item.relativePath.length > 0)
  )
  const picked = pickVideoItem(items, ctx.node.params.selectedVideoId)
  const selectedVideoId = picked
    ? videoItemKey(picked, Math.max(0, items.indexOf(picked)))
    : undefined
  const previewDataUrl = picked?.dataUrl?.trim() ? picked.dataUrl : undefined
  const previewRelativePath = picked?.relativePath?.trim() ? picked.relativePath : undefined
  ctx.node.params = {
    ...ctx.node.params,
    ...(selectedVideoId ? { selectedVideoId } : {}),
    previewDataUrl,
    previewRelativePath
  }
  ctx.patchNode?.({
    params: {
      selectedVideoId,
      previewDataUrl,
      previewRelativePath
    }
  })
  if (!picked) {
    return { out: { kind: 'video' } }
  }
  return {
    out: {
      kind: 'video',
      id: selectedVideoId,
      ...(picked.dataUrl ? { dataUrl: picked.dataUrl } : {}),
      createdAt: picked.createdAt,
      ...(picked.relativePath ? { relativePath: picked.relativePath } : {})
    }
  }
}

/**
 * 逐帧拉片：交互取帧存于 `params.generatedImages`，执行时把图库透出为图片输出。
 * 无已取帧时输出空图（不报错，节点本身以交互为主）。
 */
export function executeFramePullNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const frames = (ctx.node.params.generatedImages ?? []).filter(
    (item) =>
      (typeof item.dataUrl === 'string' && item.dataUrl.length > 0) ||
      (typeof item.relativePath === 'string' && item.relativePath.length > 0)
  )
  if (!frames.length) {
    return { out: { kind: 'image', dataUrl: '' } }
  }
  return commitGeneratedImages(ctx, frames, frames[frames.length - 1]?.relativePath?.trim())
}

/** 选取声音：从声音数组中选出一条，输出为单个 voice */
export function executeSelectVoiceNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const items = flattenVoicesValues(collectIncomingValues(ctx.inputs)).filter(
    (item) => typeof item.relativePath === 'string' && item.relativePath.length > 0
  )
  const picked = pickVoiceItem(items, ctx.node.params.selectedVoiceId)
  const selectedVoiceId = picked
    ? voiceItemKey(picked, Math.max(0, items.indexOf(picked)))
    : undefined
  const previewRelativePath = picked?.relativePath?.trim() ? picked.relativePath : undefined
  ctx.node.params = {
    ...ctx.node.params,
    ...(selectedVoiceId ? { selectedVoiceId } : {}),
    previewRelativePath
  }
  ctx.patchNode?.({
    params: {
      selectedVoiceId,
      previewRelativePath
    }
  })
  if (!picked) {
    return { out: { kind: 'voice' } }
  }
  return {
    out: {
      kind: 'voice',
      id: selectedVoiceId,
      createdAt: picked.createdAt,
      ...(picked.relativePath ? { relativePath: picked.relativePath } : {})
    }
  }
}

/**
 * 多角度 / 打光 / 人像质感 / 情绪：以上游图为参考，用编辑器拼出的提示词调用图片 API，输出图库。
 */
async function executePromptImageEditNode(
  ctx: NodeExecuteContext,
  options: {
    stampPrefix: string
    userPrompt: string
    systemPrompt: string
    extraParams: Record<string, unknown>
    emptyResultError: string
  }
): Promise<Record<string, GraphValue>> {
  const sourceItems = await collectIncomingImageItems(ctx)
  if (!sourceItems.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const userPrompt = options.userPrompt.trim()
  if (!userPrompt) {
    throw new Error('GRAPH_PROCESS_EMPTY_PROMPT')
  }
  // /images 无独立 system 字段，拼入 prompt
  const system = options.systemPrompt.trim()
  const prompt = system ? `${system}\n\n${userPrompt}` : userPrompt

  if (!ctx.generateImage) {
    const picked = sourceItems[0]!
    return commitGeneratedImages(
      ctx,
      [{ ...picked, id: picked.id?.trim() || 'passthrough:0' }],
      picked.relativePath?.trim(),
      options.extraParams
    )
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  let inputReferences: string[] = []
  if (ctx.resolveImageUrls) {
    inputReferences = (await ctx.resolveImageUrls(sourceItems.slice(0, 1))).filter(Boolean)
  } else {
    const dataUrl = sourceItems[0]?.dataUrl?.trim()
    if (dataUrl) inputReferences = [dataUrl]
  }
  if (!inputReferences.length && ctx.resolveAssetImageUrl) {
    for (const value of [
      ...(ctx.inputs.in ?? []),
      ...(ctx.inputs['in-image'] ?? []),
      ...collectIncomingValues(ctx.inputs)
    ]) {
      if (value.kind !== 'asset' || value.assetType !== 'image') continue
      const url = await ctx.resolveAssetImageUrl(value.assetId)
      if (url) {
        inputReferences = [url]
        break
      }
    }
  }
  if (!inputReferences.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const result = await ctx.generateImage({
    prompt,
    model: ctx.node.params.generateModel || undefined,
    providerInstanceId: ctx.node.params.generateProviderInstanceId || undefined,
    quality: 'high',
    n: 1,
    inputReferences
  })

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const createdAt = new Date().toISOString()
  const stamp = Date.now()
  const batch: GraphImageItem[] = []
  for (const [index, url] of (result.images ?? []).entries()) {
    const dataUrl = typeof url === 'string' ? url.trim() : ''
    if (!dataUrl) continue
    batch.push({
      id: `${options.stampPrefix}:${ctx.node.id}:${stamp}:${index}`,
      dataUrl,
      createdAt
    })
  }
  if (!batch.length) {
    throw new Error(options.emptyResultError)
  }

  const stampKey = `${options.stampPrefix}:${ctx.node.id}:${stamp}`
  const materializedBatch = await materializeGeneratedBatch(ctx, batch, stampKey)
  if (!materializedBatch.length) {
    throw new Error('图片落盘失败')
  }
  const generatedImages = mergeGeneratedImages(ctx, materializedBatch, `${stampKey}:keep`)
  return commitGeneratedImages(
    ctx,
    generatedImages,
    materializedBatch[0]?.relativePath?.trim(),
    options.extraParams
  )
}

/**
 * 多角度编辑：参考图 + 机位提示词调用图片模型，输出结果图库。
 */
export async function executeMultiAngleNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const camera = readMultiAngleCameraFromNode(ctx.node.params)
  const panelPrompt = ctx.node.params.text?.trim() || ''
  const patch = multiAngleCameraToNodePatch(camera, panelPrompt)
  return executePromptImageEditNode(ctx, {
    stampPrefix: 'multiAngle',
    userPrompt: patch.multiAnglePrompt,
    systemPrompt: resolveMultiAngleSystemPrompt(
      ctx.node.params.generateSystemPrompt,
      ctx.locale
    ),
    extraParams: patch,
    emptyResultError: '模型未返回多角度图片'
  })
}

/**
 * 打光效果：参考图 + 打光提示词调用图片模型，输出结果图库。
 */
export async function executeLightingNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const setup = readLightingSetupFromNode(ctx.node.params)
  const lightingPrompt = resolveLightingOutputPrompt(setup)
  const patch = {
    lightingSetup: setup,
    lightingPrompt
  }
  return executePromptImageEditNode(ctx, {
    stampPrefix: 'lighting',
    userPrompt: lightingPrompt,
    systemPrompt: resolveLightingSystemPrompt(
      ctx.node.params.generateSystemPrompt,
      ctx.locale
    ),
    extraParams: patch,
    emptyResultError: '模型未返回打光图片'
  })
}

/**
 * 人像质感调节：参考图 + 质感提示词调用图片模型，输出结果图库。
 */
export async function executePortraitTextureNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const patch = portraitTextureToNodePatch(readPortraitTextureFromNode(ctx.node.params))
  return executePromptImageEditNode(ctx, {
    stampPrefix: 'portraitTexture',
    userPrompt: patch.portraitTexturePrompt,
    systemPrompt: resolvePortraitTextureSystemPrompt(
      ctx.node.params.generateSystemPrompt,
      ctx.locale
    ),
    extraParams: patch,
    emptyResultError: '模型未返回人像质感图片'
  })
}

/**
 * 情绪调节：参考图 + 情绪提示词调用图片模型，输出结果图库。
 */
export async function executeEmotionNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const patch = emotionPadToNodePatch(readEmotionPadFromNode(ctx.node.params))
  return executePromptImageEditNode(ctx, {
    stampPrefix: 'emotion',
    userPrompt: patch.emotionPrompt,
    systemPrompt: resolveEmotionSystemPrompt(
      ctx.node.params.generateSystemPrompt,
      ctx.locale
    ),
    extraParams: patch,
    emptyResultError: '模型未返回情绪图片'
  })
}

/**
 * 高清放大：以上游图为参考，调用图片模型做超分。
 */
export async function executeUpscaleNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const sourceItems = await collectIncomingImageItems(ctx)
  if (!sourceItems.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const upscale = readImageUpscaleFromNode(ctx.node.params)
  const userPrompt = resolveUpscaleInstruction(
    expandInstructionMentions(
      ctx.node.params.generateInstruction ?? '',
      resolveMentionSources(ctx)
    ),
    upscale,
    ctx.locale
  )
  const system = resolveUpscaleSystemPrompt(ctx.node.params.generateSystemPrompt, ctx.locale)
  // /images 无独立 system 字段，拼入 prompt
  const prompt = system.trim() ? `${system.trim()}\n\n${userPrompt}` : userPrompt
  const resolution =
    ctx.node.params.generateResolution?.trim() || upscaleScaleToResolution(upscale.scale)
  const aspectRatio = ctx.node.params.generateAspectRatio?.trim() || undefined
  const quality = ctx.node.params.generateQuality?.trim() || 'high'

  if (!ctx.generateImage) {
    // 无 API 时透传输入，便于离线预览链路
    const picked = sourceItems[0]!
    ctx.node.params = {
      ...ctx.node.params,
      imageUpscale: upscale,
      previewDataUrl: picked.dataUrl?.trim() ? picked.dataUrl : undefined,
      previewRelativePath: picked.relativePath?.trim() ? picked.relativePath : undefined
    }
    ctx.patchNode?.({
      params: {
        imageUpscale: upscale,
        previewDataUrl: picked.dataUrl?.trim() ? picked.dataUrl : undefined,
        previewRelativePath: picked.relativePath?.trim() ? picked.relativePath : undefined
      }
    })
    return commitGeneratedImages(
      ctx,
      [{ ...picked, id: picked.id?.trim() || 'passthrough:0' }],
      picked.relativePath?.trim()
    )
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  let inputReferences: string[] = []
  if (ctx.resolveImageUrls) {
    inputReferences = (await ctx.resolveImageUrls(sourceItems.slice(0, 1))).filter(Boolean)
  } else {
    const dataUrl = sourceItems[0]?.dataUrl?.trim()
    if (dataUrl) inputReferences = [dataUrl]
  }
  // 资产引用路径下 collect 已写入 dataUrl；若仍为空再尝试 asset 解析兜底
  if (!inputReferences.length && ctx.resolveAssetImageUrl) {
    for (const value of [
      ...(ctx.inputs.in ?? []),
      ...(ctx.inputs['in-image'] ?? []),
      ...collectIncomingValues(ctx.inputs)
    ]) {
      if (value.kind !== 'asset' || value.assetType !== 'image') continue
      const url = await ctx.resolveAssetImageUrl(value.assetId)
      if (url) {
        inputReferences = [url]
        break
      }
    }
  }
  if (!inputReferences.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const result = await ctx.generateImage({
    prompt,
    model: ctx.node.params.generateModel || undefined,
    providerInstanceId: ctx.node.params.generateProviderInstanceId || undefined,
    resolution,
    ...(aspectRatio ? { aspectRatio } : {}),
    quality,
    n: 1,
    inputReferences
  })

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const createdAt = new Date().toISOString()
  const stamp = Date.now()
  const batch: GraphImageItem[] = []
  for (const [index, url] of (result.images ?? []).entries()) {
    const dataUrl = typeof url === 'string' ? url.trim() : ''
    if (!dataUrl) continue
    batch.push({
      id: `upscale:${ctx.node.id}:${stamp}:${index}`,
      dataUrl,
      createdAt
    })
  }
  if (!batch.length) {
    throw new Error('模型未返回放大图片')
  }

  const stampKey = `upscale:${ctx.node.id}:${stamp}`
  const materializedBatch = await materializeGeneratedBatch(ctx, batch, stampKey)
  if (!materializedBatch.length) {
    throw new Error('图片落盘失败')
  }
  const generatedImages = mergeGeneratedImages(ctx, materializedBatch, `${stampKey}:keep`)
  return commitGeneratedImages(
    ctx,
    generatedImages,
    materializedBatch[0]?.relativePath?.trim(),
    { imageUpscale: upscale }
  )
}

/**
 * 扩图：按锚点合成扩展画布后，调用图片模型 outpaint。
 */
export async function executeExpandNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const sourceItems = await collectIncomingImageItems(ctx)
  if (!sourceItems.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const expand = readImageExpandFromNode(ctx.node.params)
  const userPrompt = buildExpandPrompt(expand)
  const system = resolveExpandSystemPrompt(ctx.node.params.generateSystemPrompt, ctx.locale)
  const prompt = system.trim() ? `${system.trim()}\n\n${userPrompt}` : userPrompt

  if (!ctx.generateImage) {
    const picked = sourceItems[0]!
    ctx.node.params = {
      ...ctx.node.params,
      imageExpand: expand,
      previewDataUrl: picked.dataUrl?.trim() ? picked.dataUrl : undefined,
      previewRelativePath: picked.relativePath?.trim() ? picked.relativePath : undefined
    }
    ctx.patchNode?.({
      params: {
        imageExpand: expand,
        previewDataUrl: picked.dataUrl?.trim() ? picked.dataUrl : undefined,
        previewRelativePath: picked.relativePath?.trim() ? picked.relativePath : undefined
      }
    })
    return commitGeneratedImages(
      ctx,
      [{ ...picked, id: picked.id?.trim() || 'passthrough:0' }],
      picked.relativePath?.trim()
    )
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  let sourceUrls: string[] = []
  if (ctx.resolveImageUrls) {
    sourceUrls = (await ctx.resolveImageUrls(sourceItems.slice(0, 1))).filter(Boolean)
  } else {
    const dataUrl = sourceItems[0]?.dataUrl?.trim()
    if (dataUrl) sourceUrls = [dataUrl]
  }
  if (!sourceUrls.length && ctx.resolveAssetImageUrl) {
    for (const value of [
      ...(ctx.inputs.in ?? []),
      ...(ctx.inputs['in-image'] ?? []),
      ...collectIncomingValues(ctx.inputs)
    ]) {
      if (value.kind !== 'asset' || value.assetType !== 'image') continue
      const url = await ctx.resolveAssetImageUrl(value.assetId)
      if (url) {
        sourceUrls = [url]
        break
      }
    }
  }
  if (!sourceUrls.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  let inputReferences = sourceUrls.slice(0, 1)
  let aspectRatio = apiAspectRatioForExpand(expand)
  if (ctx.composeImageExpandCanvas) {
    try {
      const composed = await ctx.composeImageExpandCanvas({
        sourceDataUrl: sourceUrls[0]!,
        state: expand
      })
      if (composed.dataUrl) {
        inputReferences = [composed.dataUrl]
        if (composed.aspectRatio) aspectRatio = composed.aspectRatio
      }
    } catch {
      /* 合成失败时退回原图参考 */
    }
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const result = await ctx.generateImage({
    prompt,
    model: ctx.node.params.generateModel || undefined,
    providerInstanceId: ctx.node.params.generateProviderInstanceId || undefined,
    aspectRatio,
    resolution: expand.resolution,
    quality: 'high',
    n: expand.count,
    inputReferences
  })

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const createdAt = new Date().toISOString()
  const stamp = Date.now()
  const batch: GraphImageItem[] = []
  for (const [index, url] of (result.images ?? []).entries()) {
    const dataUrl = typeof url === 'string' ? url.trim() : ''
    if (!dataUrl) continue
    batch.push({
      id: `expand:${ctx.node.id}:${stamp}:${index}`,
      dataUrl,
      createdAt
    })
  }
  if (!batch.length) {
    throw new Error('模型未返回扩图结果')
  }

  const stampKey = `expand:${ctx.node.id}:${stamp}`
  const materializedBatch = await materializeGeneratedBatch(ctx, batch, stampKey)
  if (!materializedBatch.length) {
    throw new Error('图片落盘失败')
  }
  const generatedImages = mergeGeneratedImages(ctx, materializedBatch, `${stampKey}:keep`)
  return commitGeneratedImages(
    ctx,
    generatedImages,
    materializedBatch[0]?.relativePath?.trim(),
    { imageExpand: expand }
  )
}

/**
 * 重绘：按蒙版挖空后调用图片模型 inpaint。
 */
export async function executeRedrawNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const sourceItems = await collectIncomingImageItems(ctx)
  if (!sourceItems.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const redraw = readImageRedrawFromNode(ctx.node.params)
  const userPrompt = buildRedrawUserPrompt(redraw)
  const system = resolveRedrawSystemPrompt(ctx.node.params.generateSystemPrompt, ctx.locale)
  const prompt = system.trim() ? `${system.trim()}\n\n${userPrompt}` : userPrompt

  if (!ctx.generateImage) {
    const picked = sourceItems[0]!
    ctx.node.params = {
      ...ctx.node.params,
      imageRedraw: redraw,
      previewDataUrl: picked.dataUrl?.trim() ? picked.dataUrl : undefined,
      previewRelativePath: picked.relativePath?.trim() ? picked.relativePath : undefined
    }
    ctx.patchNode?.({
      params: {
        imageRedraw: redraw,
        previewDataUrl: picked.dataUrl?.trim() ? picked.dataUrl : undefined,
        previewRelativePath: picked.relativePath?.trim() ? picked.relativePath : undefined
      }
    })
    return commitGeneratedImages(
      ctx,
      [{ ...picked, id: picked.id?.trim() || 'passthrough:0' }],
      picked.relativePath?.trim()
    )
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  let sourceUrls: string[] = []
  if (ctx.resolveImageUrls) {
    sourceUrls = (await ctx.resolveImageUrls(sourceItems.slice(0, 1))).filter(Boolean)
  } else {
    const dataUrl = sourceItems[0]?.dataUrl?.trim()
    if (dataUrl) sourceUrls = [dataUrl]
  }
  if (!sourceUrls.length && ctx.resolveAssetImageUrl) {
    for (const value of [
      ...(ctx.inputs.in ?? []),
      ...(ctx.inputs['in-image'] ?? []),
      ...collectIncomingValues(ctx.inputs)
    ]) {
      if (value.kind !== 'asset' || value.assetType !== 'image') continue
      const url = await ctx.resolveAssetImageUrl(value.assetId)
      if (url) {
        sourceUrls = [url]
        break
      }
    }
  }
  if (!sourceUrls.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  if (!hasRedrawMask(redraw)) {
    throw new Error('GRAPH_REDRAW_NO_MASK')
  }

  let inputReferences = sourceUrls.slice(0, 1)
  let aspectRatio = apiAspectRatioForRedraw(redraw)
  if (ctx.composeImageRedrawCanvas) {
    try {
      const composed = await ctx.composeImageRedrawCanvas({
        sourceDataUrl: sourceUrls[0]!,
        state: redraw
      })
      if (composed.dataUrl) {
        inputReferences = [composed.dataUrl]
        if (composed.maskDataUrl) inputReferences.push(composed.maskDataUrl)
        if (composed.aspectRatio) aspectRatio = composed.aspectRatio
      }
    } catch {
      /* 合成失败时退回原图 + 原始 mask */
      if (redraw.maskDataUrl) inputReferences = [sourceUrls[0]!, redraw.maskDataUrl]
    }
  } else if (redraw.maskDataUrl) {
    inputReferences = [sourceUrls[0]!, redraw.maskDataUrl]
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const result = await ctx.generateImage({
    prompt,
    model: ctx.node.params.generateModel || undefined,
    providerInstanceId: ctx.node.params.generateProviderInstanceId || undefined,
    aspectRatio,
    resolution: redraw.resolution,
    quality: 'high',
    n: redraw.count,
    inputReferences
  })

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const createdAt = new Date().toISOString()
  const stamp = Date.now()
  const batch: GraphImageItem[] = []
  for (const [index, url] of (result.images ?? []).entries()) {
    const dataUrl = typeof url === 'string' ? url.trim() : ''
    if (!dataUrl) continue
    batch.push({
      id: `redraw:${ctx.node.id}:${stamp}:${index}`,
      dataUrl,
      createdAt
    })
  }
  if (!batch.length) {
    throw new Error('模型未返回重绘结果')
  }

  const stampKey = `redraw:${ctx.node.id}:${stamp}`
  const materializedBatch = await materializeGeneratedBatch(ctx, batch, stampKey)
  if (!materializedBatch.length) {
    throw new Error('图片落盘失败')
  }
  const generatedImages = mergeGeneratedImages(ctx, materializedBatch, `${stampKey}:keep`)
  return commitGeneratedImages(
    ctx,
    generatedImages,
    materializedBatch[0]?.relativePath?.trim(),
    { imageRedraw: redraw }
  )
}

/**
 * 擦除：蒙版挖空后调用图片模型做 object removal。
 */
export async function executeEraseNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const sourceItems = await collectIncomingImageItems(ctx)
  if (!sourceItems.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const erase = readImageEraseFromNode(ctx.node.params)
  const userPrompt = buildEraseUserPrompt(erase)
  const system = resolveEraseSystemPrompt(ctx.node.params.generateSystemPrompt, ctx.locale)
  const prompt = system.trim() ? `${system.trim()}\n\n${userPrompt}` : userPrompt

  if (!ctx.generateImage) {
    const picked = sourceItems[0]!
    ctx.node.params = {
      ...ctx.node.params,
      imageErase: erase,
      previewDataUrl: picked.dataUrl?.trim() ? picked.dataUrl : undefined,
      previewRelativePath: picked.relativePath?.trim() ? picked.relativePath : undefined
    }
    ctx.patchNode?.({
      params: {
        imageErase: erase,
        previewDataUrl: picked.dataUrl?.trim() ? picked.dataUrl : undefined,
        previewRelativePath: picked.relativePath?.trim() ? picked.relativePath : undefined
      }
    })
    return commitGeneratedImages(
      ctx,
      [{ ...picked, id: picked.id?.trim() || 'passthrough:0' }],
      picked.relativePath?.trim()
    )
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  let sourceUrls: string[] = []
  if (ctx.resolveImageUrls) {
    sourceUrls = (await ctx.resolveImageUrls(sourceItems.slice(0, 1))).filter(Boolean)
  } else {
    const dataUrl = sourceItems[0]?.dataUrl?.trim()
    if (dataUrl) sourceUrls = [dataUrl]
  }
  if (!sourceUrls.length && ctx.resolveAssetImageUrl) {
    for (const value of [
      ...(ctx.inputs.in ?? []),
      ...(ctx.inputs['in-image'] ?? []),
      ...collectIncomingValues(ctx.inputs)
    ]) {
      if (value.kind !== 'asset' || value.assetType !== 'image') continue
      const url = await ctx.resolveAssetImageUrl(value.assetId)
      if (url) {
        sourceUrls = [url]
        break
      }
    }
  }
  if (!sourceUrls.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  if (!hasEraseMask(erase)) {
    throw new Error('GRAPH_REDRAW_NO_MASK')
  }

  let inputReferences = sourceUrls.slice(0, 1)
  let aspectRatio = apiAspectRatioForErase(erase)
  if (ctx.composeImageRedrawCanvas) {
    try {
      const composed = await ctx.composeImageRedrawCanvas({
        sourceDataUrl: sourceUrls[0]!,
        state: erase
      })
      if (composed.dataUrl) {
        inputReferences = [composed.dataUrl]
        if (composed.maskDataUrl) inputReferences.push(composed.maskDataUrl)
        if (composed.aspectRatio) aspectRatio = composed.aspectRatio
      }
    } catch {
      if (erase.maskDataUrl) inputReferences = [sourceUrls[0]!, erase.maskDataUrl]
    }
  } else if (erase.maskDataUrl) {
    inputReferences = [sourceUrls[0]!, erase.maskDataUrl]
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const result = await ctx.generateImage({
    prompt,
    model: ctx.node.params.generateModel || undefined,
    providerInstanceId: ctx.node.params.generateProviderInstanceId || undefined,
    aspectRatio,
    resolution: erase.resolution,
    quality: 'high',
    n: erase.count,
    inputReferences
  })

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const createdAt = new Date().toISOString()
  const stamp = Date.now()
  const batch: GraphImageItem[] = []
  for (const [index, url] of (result.images ?? []).entries()) {
    const dataUrl = typeof url === 'string' ? url.trim() : ''
    if (!dataUrl) continue
    batch.push({
      id: `erase:${ctx.node.id}:${stamp}:${index}`,
      dataUrl,
      createdAt
    })
  }
  if (!batch.length) {
    throw new Error('模型未返回擦除结果')
  }

  const stampKey = `erase:${ctx.node.id}:${stamp}`
  const materializedBatch = await materializeGeneratedBatch(ctx, batch, stampKey)
  if (!materializedBatch.length) {
    throw new Error('图片落盘失败')
  }
  const generatedImages = mergeGeneratedImages(ctx, materializedBatch, `${stampKey}:keep`)
  return commitGeneratedImages(
    ctx,
    generatedImages,
    materializedBatch[0]?.relativePath?.trim(),
    { imageErase: erase }
  )
}

/**
 * 抠图：无蒙版自动去背景；有蒙版时白区保留、黑区透明。
 */
export async function executeMatteNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const sourceItems = await collectIncomingImageItems(ctx)
  if (!sourceItems.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const matte = readImageMatteFromNode(ctx.node.params)
  const userPrompt = buildMatteUserPrompt(matte)
  const system = resolveMatteSystemPrompt(ctx.node.params.generateSystemPrompt, ctx.locale)
  const prompt = system.trim() ? `${system.trim()}\n\n${userPrompt}` : userPrompt

  if (!ctx.generateImage) {
    const picked = sourceItems[0]!
    ctx.node.params = {
      ...ctx.node.params,
      imageMatte: matte,
      previewDataUrl: picked.dataUrl?.trim() ? picked.dataUrl : undefined,
      previewRelativePath: picked.relativePath?.trim() ? picked.relativePath : undefined
    }
    ctx.patchNode?.({
      params: {
        imageMatte: matte,
        previewDataUrl: picked.dataUrl?.trim() ? picked.dataUrl : undefined,
        previewRelativePath: picked.relativePath?.trim() ? picked.relativePath : undefined
      }
    })
    return commitGeneratedImages(
      ctx,
      [{ ...picked, id: picked.id?.trim() || 'passthrough:0' }],
      picked.relativePath?.trim()
    )
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  let sourceUrls: string[] = []
  if (ctx.resolveImageUrls) {
    sourceUrls = (await ctx.resolveImageUrls(sourceItems.slice(0, 1))).filter(Boolean)
  } else {
    const dataUrl = sourceItems[0]?.dataUrl?.trim()
    if (dataUrl) sourceUrls = [dataUrl]
  }
  if (!sourceUrls.length && ctx.resolveAssetImageUrl) {
    for (const value of [
      ...(ctx.inputs.in ?? []),
      ...(ctx.inputs['in-image'] ?? []),
      ...collectIncomingValues(ctx.inputs)
    ]) {
      if (value.kind !== 'asset' || value.assetType !== 'image') continue
      const url = await ctx.resolveAssetImageUrl(value.assetId)
      if (url) {
        sourceUrls = [url]
        break
      }
    }
  }
  if (!sourceUrls.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  let inputReferences = sourceUrls.slice(0, 1)
  let aspectRatio = apiAspectRatioForMatte(matte)
  if (hasMatteMask(matte) && ctx.composeImageRedrawCanvas) {
    try {
      const composed = await ctx.composeImageRedrawCanvas({
        sourceDataUrl: sourceUrls[0]!,
        state: matte,
        punch: 'black'
      })
      if (composed.dataUrl) {
        inputReferences = [composed.dataUrl]
        if (composed.maskDataUrl) inputReferences.push(composed.maskDataUrl)
        if (composed.aspectRatio) aspectRatio = composed.aspectRatio
      }
    } catch {
      if (matte.maskDataUrl) inputReferences = [sourceUrls[0]!, matte.maskDataUrl]
    }
  } else if (hasMatteMask(matte) && matte.maskDataUrl) {
    inputReferences = [sourceUrls[0]!, matte.maskDataUrl]
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const result = await ctx.generateImage({
    prompt,
    model: ctx.node.params.generateModel || undefined,
    providerInstanceId: ctx.node.params.generateProviderInstanceId || undefined,
    aspectRatio,
    resolution: matte.resolution,
    quality: 'high',
    n: matte.count,
    inputReferences
  })

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const createdAt = new Date().toISOString()
  const stamp = Date.now()
  const batch: GraphImageItem[] = []
  for (const [index, url] of (result.images ?? []).entries()) {
    const dataUrl = typeof url === 'string' ? url.trim() : ''
    if (!dataUrl) continue
    batch.push({
      id: `matte:${ctx.node.id}:${stamp}:${index}`,
      dataUrl,
      createdAt
    })
  }
  if (!batch.length) {
    throw new Error('模型未返回抠图结果')
  }

  const stampKey = `matte:${ctx.node.id}:${stamp}`
  const materializedBatch = await materializeGeneratedBatch(ctx, batch, stampKey)
  if (!materializedBatch.length) {
    throw new Error('图片落盘失败')
  }
  const generatedImages = mergeGeneratedImages(ctx, materializedBatch, `${stampKey}:keep`)
  return commitGeneratedImages(
    ctx,
    generatedImages,
    materializedBatch[0]?.relativePath?.trim(),
    { imageMatte: matte }
  )
}

/**
 * 裁剪：本地按归一化框裁出图片（不调模型）。
 */
export async function executeCropNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const sourceItems = await collectIncomingImageItems(ctx)
  if (!sourceItems.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const crop = readImageCropFromNode(ctx.node.params)

  let sourceUrls: string[] = []
  if (ctx.resolveImageUrls) {
    sourceUrls = (await ctx.resolveImageUrls(sourceItems.slice(0, 1))).filter(Boolean)
  } else {
    const dataUrl = sourceItems[0]?.dataUrl?.trim()
    if (dataUrl) sourceUrls = [dataUrl]
  }
  if (!sourceUrls.length && ctx.resolveAssetImageUrl) {
    for (const value of [
      ...(ctx.inputs.in ?? []),
      ...(ctx.inputs['in-image'] ?? []),
      ...collectIncomingValues(ctx.inputs)
    ]) {
      if (value.kind !== 'asset' || value.assetType !== 'image') continue
      const url = await ctx.resolveAssetImageUrl(value.assetId)
      if (url) {
        sourceUrls = [url]
        break
      }
    }
  }
  if (!sourceUrls.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  if (!ctx.composeImageCropCanvas) {
    // 无合成注入时透传，便于离线
    const picked = sourceItems[0]!
    ctx.node.params = { ...ctx.node.params, imageCrop: crop }
    ctx.patchNode?.({ params: { imageCrop: crop } })
    return commitGeneratedImages(
      ctx,
      [{ ...picked, id: picked.id?.trim() || 'passthrough:0' }],
      picked.relativePath?.trim()
    )
  }

  const composed = await ctx.composeImageCropCanvas({
    sourceDataUrl: sourceUrls[0]!,
    state: crop
  })
  if (!composed.dataUrl) {
    throw new Error('裁剪失败')
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const createdAt = new Date().toISOString()
  const stamp = Date.now()
  const item: GraphImageItem = {
    id: `crop:${ctx.node.id}:${stamp}`,
    dataUrl: composed.dataUrl,
    createdAt
  }
  const materializedBatch = await materializeGeneratedBatch(ctx, [item], `crop:${ctx.node.id}:${stamp}`)
  if (!materializedBatch.length) {
    throw new Error('图片落盘失败')
  }
  const generatedImages = mergeGeneratedImages(ctx, materializedBatch, `crop:${ctx.node.id}:${stamp}:keep`)
  return commitGeneratedImages(
    ctx,
    generatedImages,
    materializedBatch[0]?.relativePath?.trim(),
    { imageCrop: crop }
  )
}

/**
 * 宫格切分：裁出选中（或全部）宫格，再逐格高清放大。
 */
/**
 * 宫格切分：纯裁切，不调用大模型。
 * 按 rows×cols 从源图裁出每个目标宫格并直接输出。
 */
export async function executeGridSplitNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const sourceItems = await collectIncomingImageItems(ctx)
  if (!sourceItems.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const grid = readImageGridSplitFromNode(ctx.node.params)
  const targets = resolveGridSplitTargets(grid)
  if (!targets.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  let sourceUrl = ''
  if (ctx.resolveImageUrls) {
    sourceUrl = (await ctx.resolveImageUrls(sourceItems.slice(0, 1))).find(Boolean) ?? ''
  } else {
    sourceUrl = sourceItems[0]?.dataUrl?.trim() ?? ''
  }
  if (!sourceUrl && ctx.resolveAssetImageUrl) {
    for (const value of [
      ...(ctx.inputs.in ?? []),
      ...(ctx.inputs['in-image'] ?? []),
      ...collectIncomingValues(ctx.inputs)
    ]) {
      if (value.kind !== 'asset' || value.assetType !== 'image') continue
      const url = await ctx.resolveAssetImageUrl(value.assetId)
      if (url) {
        sourceUrl = url
        break
      }
    }
  }
  if (!sourceUrl) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }
  if (!ctx.composeImageGridCell) {
    throw new Error('宫格裁切能力未注入，无法执行宫格切分')
  }
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const createdAt = new Date().toISOString()
  const stamp = Date.now()
  const batch: GraphImageItem[] = []

  for (const cell of targets) {
    if (ctx.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    const composed = await ctx.composeImageGridCell({
      sourceDataUrl: sourceUrl,
      state: grid,
      cellKey: cell
    })
    const cellDataUrl = composed.dataUrl?.trim()
    if (!cellDataUrl) {
      throw new Error(`宫格 ${cell} 裁切失败`)
    }
    batch.push({
      id: `gridSplit:${ctx.node.id}:${stamp}:${cell}`,
      dataUrl: cellDataUrl,
      createdAt
    })
  }

  if (!batch.length) {
    throw new Error('宫格切分失败')
  }

  const materializedBatch = await materializeGeneratedBatch(
    ctx,
    batch,
    `grid:${ctx.node.id}:${stamp}`
  )
  if (!materializedBatch.length) {
    throw new Error('图片落盘失败')
  }
  const generatedImages = mergeGeneratedImages(
    ctx,
    materializedBatch,
    `grid:${ctx.node.id}:${stamp}:keep`
  )
  return commitGeneratedImages(
    ctx,
    generatedImages,
    materializedBatch[0]?.relativePath?.trim(),
    { imageGridSplit: grid }
  )
}

/**
 * 生成帧动画序列图：参考图 + 动作描述 → 生图 API 生成 rows×cols 分格序列图。
 * 序列图排版指令按当前行列数动态拼入提示词。
 */
export async function executeFrameAnimGenNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const state = readAnim2dFromNode(node.params)
  const preset = resolveAnim2dPreset(node.params.animPresetId)
  const instructionRaw = node.params.generateInstruction?.trim() || preset?.prompt || ''
  const system = resolveFrameAnimGenSystemPrompt(node.params.generateSystemPrompt, ctx.locale)
  const userPrompt = [
    instructionRaw,
    buildAnim2dGridInstruction(state.rows, state.cols, ctx.locale)
  ]
    .filter(Boolean)
    .join('\n\n')
  const prompt = system.trim() ? `${system.trim()}\n\n${userPrompt}` : userPrompt

  if (!ctx.generateImage) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const sourceItems = await collectIncomingImageItems(ctx)
  let portUrls: string[] = []
  if (sourceItems.length) {
    if (ctx.resolveImageUrls) {
      portUrls = (await ctx.resolveImageUrls(sourceItems)).filter(Boolean)
    } else {
      portUrls = sourceItems
        .map((item) => item.dataUrl?.trim())
        .filter((url): url is string => Boolean(url))
    }
  }
  if (!portUrls.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const genParams = resolveImageGenerateParamsForApi(node.params)
  const paramsPatch = imageGenerateParamsToNodePatch(genParams)
  node.params = { ...node.params, ...paramsPatch }
  ctx.patchNode?.({ params: paramsPatch })

  const result = await ctx.generateImage({
    prompt,
    model: node.params.generateModel || undefined,
    providerInstanceId: node.params.generateProviderInstanceId || undefined,
    aspectRatio: genParams.aspectRatio,
    resolution: genParams.resolution,
    quality: genParams.quality,
    n: genParams.count,
    seed: resolveGenerateSeed(node.params, ctx.resolveProjectGenerateSeed?.()),
    inputReferences: portUrls,
    inputReferenceMeta: sourceItems.slice(0, portUrls.length).map((item) => ({
      source: 'port',
      ...(item.relativePath?.trim() ? { relativePath: item.relativePath.trim() } : {})
    }))
  })

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const createdAt = new Date().toISOString()
  const stamp = Date.now()
  const batch: GraphImageItem[] = []
  for (const [index, url] of (result.images ?? []).entries()) {
    const dataUrl = typeof url === 'string' ? url.trim() : ''
    if (!dataUrl) continue
    batch.push({ id: `animGen:${node.id}:${stamp}:${index}`, dataUrl, createdAt })
  }
  if (!batch.length) {
    throw new Error('模型未返回图片')
  }

  const stampKey = `animGen:${node.id}:${stamp}`
  const materializedBatch = await materializeGeneratedBatch(ctx, batch, stampKey)
  if (!materializedBatch.length) {
    throw new Error('图片落盘失败')
  }
  const generatedImages = mergeGeneratedImages(ctx, materializedBatch, `${stampKey}:keep`)
  return commitGeneratedImages(ctx, generatedImages, materializedBatch[0]?.relativePath?.trim(), {
    animRows: state.rows,
    animCols: state.cols,
    animPresetId: node.params.animPresetId || ''
  })
}

/**
 * 2D帧动画：收集 dive 子图输出边界（序列图），按 rows×cols 切分为单帧输出，
 * 并把序列图信息写回节点参数供 inspector 播放预览。
 */
export async function executeAnim2dNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const assetId = node.params.animAssetId?.trim()
  // 普通播放节点：优先取 in 端口序列图；旧数据无输入时回退内图产物
  const incoming = await collectIncomingImageItems(ctx)
  let gridItem: (GraphImageItem & { assetId?: string }) | undefined = incoming[0]
  if (!gridItem && assetId) {
    gridItem = await softResolveAnim2dGridImage(ctx, assetId)
  }
  // 行列：有内图时沿用内图层帧生成行列，否则用本节点 Inspector 行列
  const innerState = assetId ? softResolveAnim2dInnerState(ctx, assetId) : undefined
  const state = innerState ?? readAnim2dFromNode(node.params)
  if (!gridItem) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  let sourceUrl = gridItem.dataUrl?.trim() || ''
  if (!sourceUrl && ctx.resolveImageUrls) {
    sourceUrl = (await ctx.resolveImageUrls([gridItem])).find(Boolean) ?? ''
  }
  if (!sourceUrl && ctx.resolveAssetImageUrl && gridItem.assetId) {
    sourceUrl = (await ctx.resolveAssetImageUrl(gridItem.assetId)) ?? ''
  }
  if (!sourceUrl) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }
  if (!ctx.composeImageGridCell) {
    throw new Error('帧序列切分能力未注入')
  }
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const createdAt = new Date().toISOString()
  const stamp = Date.now()
  const batch: GraphImageItem[] = []
  for (const cell of anim2dCellKeys(state.rows, state.cols)) {
    if (ctx.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    const composed = await ctx.composeImageGridCell({
      sourceDataUrl: sourceUrl,
      state: { rows: state.rows, cols: state.cols, selected: [] },
      cellKey: cell,
      // 序列图常带格线/黑边：整数切格后再按格子尺寸内缩
      edgeInset: 'auto'
    })
    const cellDataUrl = composed.dataUrl?.trim()
    if (!cellDataUrl) {
      throw new Error(`帧 ${cell} 切分失败`)
    }
    batch.push({
      id: `anim2d:${node.id}:${stamp}:${cell}`,
      dataUrl: cellDataUrl,
      createdAt
    })
  }
  if (!batch.length) {
    throw new Error('帧序列切分失败')
  }

  const materializedBatch = await materializeGeneratedBatch(
    ctx,
    batch,
    `anim2d:${node.id}:${stamp}`
  )
  if (!materializedBatch.length) {
    throw new Error('图片落盘失败')
  }
  // 普通播放节点：每次 cook 只保留本次切分结果，清除上一次的数据，不累积历史
  const generatedImages = dedupeGalleryIds(
    [],
    materializedBatch,
    `anim2d:${node.id}:${stamp}:keep`
  )
  const gridImageParams = {
    ...(gridItem.dataUrl?.trim() ? { dataUrl: gridItem.dataUrl.trim() } : {}),
    ...(gridItem.relativePath?.trim() ? { relativePath: gridItem.relativePath.trim() } : {})
  }
  return commitGeneratedImages(
    ctx,
    generatedImages,
    materializedBatch[0]?.relativePath?.trim(),
    {
      animRows: state.rows,
      animCols: state.cols,
      animGridImage: Object.keys(gridImageParams).length ? gridImageParams : undefined
    }
  )
}

/** 从 dive 子图资产软解析序列图输出边界（边界输出未运行也可从上游取到） */
async function softResolveAnim2dGridImage(
  ctx: NodeExecuteContext,
  assetId: string
): Promise<(GraphImageItem & { assetId?: string }) | undefined> {
  const liveDoc = ctx.resolveLiveAssetGraph?.(assetId)
  const gen = ctx.resolveAssetGenParams?.(assetId)
  const raw = liveDoc ?? gen?.graphJson
  if (
    !raw ||
    typeof raw !== 'object' ||
    !Array.isArray((raw as GraphDocument).nodes)
  ) {
    return undefined
  }
  const doc = raw as GraphDocument
  const softOptions: ResolveHostInputSlotsOptions = {
    resolveLiveAssetGraph: ctx.resolveLiveAssetGraph,
    resolveAssetGenParams: ctx.resolveAssetGenParams
  }
  for (const bnode of doc.nodes) {
    if (!isBoundaryOutputNode(bnode)) continue
    const value = softResolveBoundaryOutputValue(doc, bnode.id, softOptions)
    if (!graphValueHasPayload(value)) continue
    if (value.kind === 'image') {
      return {
        id: value.id || `animGrid:${assetId}`,
        dataUrl: value.dataUrl || '',
        relativePath: value.relativePath
      }
    }
    if (value.kind === 'images' && value.items.length) {
      const first = value.items[0]!
      return { ...first, id: first.id || `animGrid:${assetId}` }
    }
    if (value.kind === 'asset' && value.assetType === 'image') {
      const url = ctx.resolveAssetImageUrl
        ? await ctx.resolveAssetImageUrl(value.assetId)
        : undefined
      if (url) return { id: `animGrid:${assetId}`, dataUrl: url }
    }
  }
  return undefined
}

/** 从 dive 子图资产读取「生成帧动画序列图」节点的行列参数（单一数据源） */
function softResolveAnim2dInnerState(
  ctx: NodeExecuteContext,
  assetId: string
): Anim2dState | undefined {
  const liveDoc = ctx.resolveLiveAssetGraph?.(assetId)
  const gen = ctx.resolveAssetGenParams?.(assetId)
  const raw = liveDoc ?? gen?.graphJson
  if (
    !raw ||
    typeof raw !== 'object' ||
    !Array.isArray((raw as GraphDocument).nodes)
  ) {
    return undefined
  }
  const doc = raw as GraphDocument
  const genNode = doc.nodes.find((n) => n.typeId === 'frame.animGen')
  if (!genNode) return undefined
  return readAnim2dFromNode(genNode.params)
}

/**
 * 「剧本输出」：不调用大模型，透传 texts（有路径时只传 relativePath，对齐图片）。
 */
export async function executeScreenplayOutputNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const incoming = collectIncomingValues(ctx.inputs)
  const textItems = flattenTextsValues(incoming)
  const hydrated = await hydrateTextItems(textItems, ctx.readRunText)
  const notes: GraphTextValue[] = hydrated
    .map((item) => item.text.trim())
    .filter(Boolean)
    .map((text) => ({ kind: 'text' as const, text }))
  const resultText = notes.map((item) => item.text).join('\n\n')
  const outputKind: GraphOutputKind = ctx.node.params.outputKind ?? 'text'
  // 场输出等：落地已迁至上游 gen，清空旧 generatedTexts，避免预览叠 resultText 变多
  const paramsPatch = {
    resultText,
    ...(ctx.node.typeId === 'output.beat' ? { generatedTexts: [] as GraphTextItem[] } : {})
  }
  ctx.node.params = { ...ctx.node.params, ...paramsPatch }
  ctx.patchNode?.({ params: paramsPatch })
  const value: GraphOutputValue = {
    kind: 'output',
    outputKind,
    items: [],
    notes,
    // 边上/落盘：路径优先，清空已物化正文
    texts: textItems.map(stripEmbeddedTextData),
    params: { ...ctx.node.params, outputKind }
  }
  return { out: value }
}

function sanitizeBeatOutputKeyPart(raw: string, fallback: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^\w\u4e00-\u9fff.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
  return cleaned || fallback
}

/** 落盘文件名：{宿主}_{场标题}_{时间戳}[_{序号}] */
function resolveBeatUnitFileKey(
  ctx: NodeExecuteContext,
  item: GraphTextItem,
  index: number,
  stamp: string,
  total: number
): string {
  const fromTitle = item.title?.trim()
  const firstLine = item.text?.split(/\r?\n/, 1)[0]?.trim() ?? ''
  const numbered = firstLine.match(/^\d+\.\s*(.+)$/)
  const fromLine = (numbered?.[1] ?? firstLine).trim()
  const unitTitle = sanitizeBeatOutputKeyPart(
    fromTitle || fromLine || item.id?.trim() || '',
    `场${index + 1}`
  )
  return buildGeneratedMediaFileKey({
    hostAssetName: ctx.resolveHostAssetName?.(),
    nodeTitle: unitTitle,
    stamp,
    index: total > 1 ? index + 1 : null
  })
}

/**
 * 将场 texts 落地为剧本文件（txt），返回物化后的条目（有路径时清空 text）。
 */
async function materializeBeatUnitTextItems(
  ctx: NodeExecuteContext,
  hydrated: GraphTextItem[]
): Promise<GraphTextItem[]> {
  const createdAt = new Date().toISOString()
  const stamp = formatGeneratedMediaStamp()
  const materialized: GraphTextItem[] = []

  for (let index = 0; index < hydrated.length; index++) {
    const item = hydrated[index]!
    const text = item.text?.trim() ?? ''
    const existingPath = item.relativePath?.trim()
    const id = item.id?.trim() || `nu-out:${stamp}:${index}`
    const fileKey = resolveBeatUnitFileKey(ctx, item, index, stamp, hydrated.length)
    const title = item.title?.trim() || fileKey

    if (existingPath && !ctx.saveRunText) {
      materialized.push({
        id,
        title,
        text: '',
        createdAt: item.createdAt ?? createdAt,
        relativePath: existingPath
      })
      continue
    }

    if (!text && existingPath) {
      materialized.push({
        id,
        title,
        text: '',
        createdAt: item.createdAt ?? createdAt,
        relativePath: existingPath
      })
      continue
    }

    if (!text) continue

    if (!ctx.saveRunText) {
      materialized.push({
        id,
        title,
        text,
        createdAt: item.createdAt ?? createdAt
      })
      continue
    }

    try {
      const relativePath = await ctx.saveRunText({
        content: text,
        key: fileKey,
        outputDir: ctx.node.params.mediaOutputDir?.trim() || undefined,
        node: ctx.node
      })
      materialized.push({
        id,
        title,
        text: '',
        createdAt: item.createdAt ?? createdAt,
        relativePath
      })
    } catch (err) {
      console.warn('[graph] beat unit text save failed', err)
      materialized.push({
        id,
        title,
        text,
        createdAt: item.createdAt ?? createdAt
      })
    }
  }

  return materialized
}

/**
 * 场细化画布输出：透传上游 texts（资产主链已改为 table → output.beat）。
 */
export async function executeBeatOutputNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  return executeScreenplayOutputNode(ctx)
}

export async function executeOutputNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  // 「剧本/文本输出」：透传为 texts，不调大模型、不收集媒体 genRefs
  if (
    ctx.node.params.outputKind === 'text' ||
    ctx.node.typeId === 'output.text' ||
    ctx.node.typeId === 'output.beat' ||
    ctx.node.typeId === 'output.beatUnit'
  ) {
    return executeScreenplayOutputNode(ctx)
  }

  const incoming = collectIncomingValues(ctx.inputs)
  const items = flattenAssetValues(incoming)
  const notes = flattenTextValues(incoming)
  const images = flattenImagesValues(incoming)
  const videos = flattenVideosValues(incoming)
  const voices = flattenVoicesValues(incoming)
  const outputKind: GraphOutputKind = ctx.node.params.outputKind ?? 'video'
  const params: GraphNodeParams = { ...ctx.node.params, outputKind }
  // 图片数组输入（导演台 / 图片输出）：写回预览，便于节点卡与下游读取
  const acceptImages =
    ctx.node.params.inputDataType === GraphPortType.image || outputKind === 'image'
  const acceptVideos =
    ctx.node.params.inputDataType === GraphPortType.video || outputKind === 'video'
  const acceptVoices =
    ctx.node.params.inputDataType === GraphPortType.voice || outputKind === 'voice'
  if (images.length && acceptImages) {
    const cameraShots = images.map((image, index) => ({
      id: image.id ?? `shot:${index}`,
      dataUrl: image.dataUrl,
      createdAt: image.createdAt ?? new Date().toISOString(),
      ...(image.relativePath ? { relativePath: image.relativePath } : {})
    }))
    const previewDataUrl = cameraShots[0]?.dataUrl?.trim()
      ? cameraShots[0].dataUrl
      : undefined
    const previewRelativePath = cameraShots[0]?.relativePath?.trim()
      ? cameraShots[0].relativePath
      : undefined
    ctx.patchNode?.({
      params: {
        cameraShots,
        previewDataUrl,
        previewRelativePath
      }
    })
    params.cameraShots = cameraShots
    params.previewDataUrl = previewDataUrl
    params.previewRelativePath = previewRelativePath
  } else if (videos.length && acceptVideos) {
    const previewRelativePath = videos[0]?.relativePath?.trim() || undefined
    if (previewRelativePath) {
      ctx.patchNode?.({ params: { previewRelativePath } })
      params.previewRelativePath = previewRelativePath
    }
  } else if (voices.length && acceptVoices) {
    const previewRelativePath = voices[0]?.relativePath?.trim() || undefined
    if (previewRelativePath) {
      ctx.patchNode?.({ params: { previewRelativePath } })
      params.previewRelativePath = previewRelativePath
    }
  } else if (outputKind === 'video' || outputKind === 'voice') {
    // 视频 / 声音输出：从上游资产写回预览路径（与图片输出对称）
    const preferred =
      items.find((item) => item.assetType === outputKind) ?? items[0]
    const previewRelativePath = preferred?.relativePath?.trim() || undefined
    if (previewRelativePath) {
      ctx.patchNode?.({ params: { previewRelativePath } })
      params.previewRelativePath = previewRelativePath
    }
  }
  const value: GraphOutputValue = {
    kind: 'output',
    outputKind,
    items,
    notes,
    params,
    ...(images.length ? { images } : {}),
    ...(videos.length ? { videos } : {}),
    ...(voices.length ? { voices } : {})
  }
  return { out: value }
}

/**
 * 束结：按锁定类型聚合多条入边为复数（或 catalog）输出。
 * 下游指令 / cook 另经 expandIncomingThroughBundles 展开真实上游。
 */
export function executeBundleNode(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const incoming = ctx.inputs.in ?? Object.values(ctx.inputs).flat()
  const dataType =
    ctx.node.params.bundleDataType ??
    (incoming[0] ? graphValueKindToPortType(incoming[0].kind) : GraphPortType.image)

  if (incoming.length) {
    if (dataType === GraphPortType.image || dataType === GraphPortType.images) {
      const items = flattenImagesValues(incoming)
      const value: GraphValue = { kind: 'images', items }
      if (items.length) patchBoundaryOutputPreview(ctx, value)
      return { out: value }
    }
    if (dataType === GraphPortType.video || dataType === GraphPortType.videos) {
      const items = flattenVideosValues(incoming)
      const value: GraphValue = { kind: 'videos', items }
      if (items.length) patchBoundaryOutputPreview(ctx, value)
      return { out: value }
    }
    if (dataType === GraphPortType.voice || dataType === GraphPortType.voices) {
      const items = flattenVoicesValues(incoming)
      const value: GraphValue = { kind: 'voices', items }
      return { out: value }
    }
    if (dataType === GraphPortType.text || dataType === GraphPortType.texts) {
      const items = flattenTextsValues(incoming)
      const value: GraphValue = { kind: 'texts', items }
      return { out: value }
    }
    const first = incoming[0]
    if (first) {
      patchBoundaryOutputPreview(ctx, first)
      return { out: first }
    }
  }

  if (
    dataType === GraphPortType.beat ||
    dataType === GraphPortType.worldEntities ||
    dataType === GraphPortType.world
  ) {
    return { out: catalogValue(dataType, '') }
  }
  if (dataType === GraphPortType.image || dataType === GraphPortType.images) {
    return { out: { kind: 'images', items: [] } }
  }
  if (dataType === GraphPortType.video || dataType === GraphPortType.videos) {
    return { out: { kind: 'videos', items: [] } }
  }
  if (dataType === GraphPortType.voice || dataType === GraphPortType.voices) {
    return { out: { kind: 'voices', items: [] } }
  }
  if (dataType === GraphPortType.texts || dataType === GraphPortType.text) {
    return { out: { kind: 'texts', items: [] } }
  }
  return { out: { kind: 'text', text: '' } }
}

function graphValueKindToPortType(kind: GraphValue['kind']): GraphPortDataType {
  switch (kind) {
    case 'image':
    case 'images':
      return GraphPortType.image
    case 'video':
    case 'videos':
      return GraphPortType.video
    case 'voice':
    case 'voices':
      return GraphPortType.voice
    case 'text':
    case 'texts':
      return GraphPortType.text
    case 'beat':
      return GraphPortType.beat
    case 'world':
      return GraphPortType.world
    case 'worldEntities':
      return GraphPortType.worldEntities
    default:
      return GraphPortType.image
  }
}

/** 无 execute 时的兜底：透传第一个输入或空 */
export function executePassthrough(ctx: NodeExecuteContext): Record<string, GraphValue> {
  const first = Object.values(ctx.inputs).flat()[0]
  if (first) return { out: first }
  return {}
}

export function isGraphAssetValue(v: GraphValue): v is GraphAssetValue {
  return v.kind === 'asset'
}

export function nodeToAssetValue(node: GraphNode): GraphAssetValue | null {
  if (!node.assetId || !node.assetType) return null
  return {
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
}
