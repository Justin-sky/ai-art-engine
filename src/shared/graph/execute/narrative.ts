import { formatGeneratedMediaStamp } from '../../domain'
import type { GraphDocument, GraphNode, GraphNodeParams, GraphOutputKind } from '../types'
import { GraphPortType } from '../types'
import {
  graphValueHasPayload,
  mergeBoundarySoftValues,
  outputsToHostGalleryParams,
  softResolveBoundaryOutputValue,
  type ResolveHostInputSlotsOptions
} from '../hostInput'
import { isBoundaryOutputNode } from '../hostInterface'
import {
  expandInstructionMentions,
  instructionHasMentions,
  type InstructionMentionSource
} from '../instructionMentions'
import {
  applyEpisodeAgentReview,
  createEpisodeAgentState,
  episodeFailReasonForStep,
  parseEpisodeAgentState,
  serializeEpisodeAgentState
} from '../episodeAgentState'
import { pickEpisodeAgentPrompt, resolveEpisodeDirectorReviewPack } from '../episodeAgentPrompts'
import { parseAgentVerdict } from '../agentPrompts'
import {
  parseEpisodeBeatBreakdown,
  selectEpisodeAnchors,
  selectEpisodeKeyframeSpans,
  formatEpisodeKeyframeSpanNotes
} from '../episodeBoardParse'
import { resolveOptimizeSystemPrompt, resolveUiSplitSystemPrompt } from '../systemPromptSchemes'
import { buildOptimizePrompt, buildUiSplitPrompt } from '../userPromptSchemes'
import { resolveAssetTextFromGenParams } from '../assetText'
import {
  parseUiScreenPrompts,
  screensFromUiGenIncoming,
  UI_SPLIT_INNER_GRAPH_VERSION,
  type UiScreenPromptItem
} from '../uiSplitParse'
import type { GraphValue, NodeExecuteContext } from './types'
import { flattenVideosValues, newestTextSelectedId } from './gallery'
import { autoIncomingTextForInstruction, selectIncomingValuesForInstruction } from './incoming'
import { commitInMemoryTextGallery, persistScreenplayGeneration } from './materialize'
import { resolveMentionSources } from './context'
import { resolveGalleryOutputsFromNodeParams } from './helpers'
import { fail } from '@shared/errors/appError'
import { SHARED_ERRORS } from '../../errors/catalog'

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
    typeof node.params.episodeReviewVariant === 'string' ? node.params.episodeReviewVariant : null
  const reviewPack = resolveEpisodeDirectorReviewPack(episodeReviewTarget, reviewVariant)
  // 导演审核节点用最新 pack 指令（严格 PASS 门槛），不吃旧图里固化的宽松/严苛文案
  const instructionRaw =
    (reviewPack
      ? pickEpisodeAgentPrompt(reviewPack, ctx.locale, 'instruction')
      : node.params.generateInstruction?.trim()) ?? ''
  const instruction = expandInstructionMentions(instructionRaw, mentionSources)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const incomingText = autoIncomingTextForInstruction(instructionRaw, selected, mentionSources)
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
  if (!text)
    throw fail(SHARED_ERRORS.resultMissing, { what: { zh: '优化结果', en: 'optimization result' } }) // cjk-ok 双语错误数据（zh/en，由 errors/catalog 统一格式化）

  // 第二档闭环：导演审核节点解析 PASS/FAIL 并落盘 agent-state.json
  if (episodeReviewTarget && ctx.readEpisodeAgentState && ctx.writeEpisodeAgentState) {
    const verdict = parseEpisodeDirectorVerdict(text)
    if (verdict) {
      const raw = await ctx.readEpisodeAgentState(episodeScopeKey)
      const state =
        parseEpisodeAgentState(raw) ?? createEpisodeAgentState(episodeScopeKey, episodeScopeKey)
      const next = applyEpisodeAgentReview(
        state,
        episodeReviewTarget,
        verdict.result,
        verdict.reason
      )
      await ctx.writeEpisodeAgentState(episodeScopeKey, serializeEpisodeAgentState(next))
      const reviewMarks = {
        episodeReviewStatus: verdict.result,
        episodeReviewReason: verdict.reason,
        episodeReviewPending: false
      }
      node.params = { ...node.params, ...reviewMarks }
      ctx.patchNode?.({ params: reviewMarks })
    }
  }

  return persistScreenplayGeneration(ctx, text)
}

/** 解析导演审核结论：## 结论: PASS 或 ## 结论: FAIL (原因: …) */
export function parseEpisodeDirectorVerdict(
  text: string
): { result: 'PASS' | 'FAIL'; reason: string } | null {
  return parseAgentVerdict(text)
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

/** 收集上游剧本文本（含 texts.relativePath 落盘正文） */
async function resolveUiSplitSourceText(
  ctx: NodeExecuteContext,
  instructionRaw: string,
  mentionSources?: InstructionMentionSource[]
): Promise<string> {
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const text = autoIncomingTextForInstruction(instructionRaw, selected, mentionSources).trim()
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
  const incomingText = await resolveUiSplitSourceText(ctx, instructionRaw, mentionSources)

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

  const hasMentionSource = instructionHasMentions(instructionRaw) && !!instruction.trim()
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
  if (!text)
    throw fail(SHARED_ERRORS.resultMissing, {
      what: { zh: 'UI 界面拆分结果', en: 'UI split result' }
    }) // cjk-ok 双语错误数据（zh/en，由 errors/catalog 统一格式化）

  const screens = parseUiScreenPrompts(text)
  if (!screens.length) {
    throw fail(SHARED_ERRORS.resultMissing, {
      what: {
        zh: '可解析的界面列表（需要 JSON 数组，含 title/prompt）',
        en: 'parseable screen list (expects a JSON array with title/prompt)'
      } // cjk-ok 双语错误数据（zh/en，由 errors/catalog 统一格式化）
    })
  }

  return persistUiSplitGeneration(ctx, screens)
}

/** UI 界面生成：接收界面提示词数组，落为 uiScreens 供 dive 内图使用；外口输出图片组（由内图产出）及当前选中单图（供直接连入 UI 图层分离） */
export async function executeUiGenNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const incoming = screensFromUiGenIncoming(Object.values(ctx.inputs).flat())
  // 端口无输入时保留已存界面列表，避免上游未运行就把 dive 提示词清空
  const screens = incoming.length
    ? incoming
    : Array.isArray(node.params.uiScreens)
      ? node.params.uiScreens
      : []
  const summary = screens.map((s, i) => `${i + 1}. ${s.title}`).join('\n')
  // 点 cook：收集内图所有输出边界（边界输出未运行也可从上游取到），并落节点图库供预览
  const collected = collectUiGenInnerOutputs(ctx)
  const out: GraphValue = collected ?? { kind: 'images', items: [] }
  const gallery = collected ? outputsToHostGalleryParams({ out }) : {}
  const genImgs = gallery.generatedImages ?? node.params.generatedImages ?? []
  const explicitSelectedId = node.params.selectedImageId?.trim()
  // 若用户尚未手动挑图，优先把「底图·*」（空字底图轨）选为默认单图输出，方便下游 UI 图层分离直接拆无字底板
  const preferredClean = !explicitSelectedId
    ? genImgs.find((item) => item.title?.startsWith('底图·')) // cjk-ok
    : undefined
  const selectedImageId =
    (explicitSelectedId && genImgs.some((item) => item.id === explicitSelectedId)
      ? explicitSelectedId
      : preferredClean?.id) ?? gallery.selectedImageId
  const finalGallery = selectedImageId ? { ...gallery, selectedImageId } : gallery
  node.params = { ...node.params, text: summary, uiScreens: screens, ...finalGallery }
  ctx.patchNode?.({ params: { text: summary, uiScreens: screens, ...finalGallery } })

  const picked =
    (selectedImageId ? genImgs.find((item) => item.id === selectedImageId) : undefined) ||
    genImgs[genImgs.length - 1]
  const outSelected: GraphValue | undefined = picked
    ? {
        kind: 'image',
        id: picked.id,
        ...(picked.title ? { title: picked.title } : {}),
        dataUrl: picked.dataUrl ?? '',
        createdAt: picked.createdAt,
        ...(picked.relativePath ? { relativePath: picked.relativePath } : {})
      }
    : undefined

  return outSelected ? { out, 'out-selected': outSelected } : { out }
}

/** ui.gen：从 dive 子图资产软解析所有输出边界，合并为图片组（保留边界标题以区分「图片·」与「底图·」） */
function collectUiGenInnerOutputs(ctx: NodeExecuteContext): GraphValue | undefined {
  const assetId = ctx.node.params.uiSplitAssetId?.trim()
  if (!assetId) return undefined
  const liveDoc = ctx.resolveLiveAssetGraph?.(assetId)
  const gen = ctx.resolveAssetGenParams?.(assetId)
  const raw = liveDoc ?? gen?.graphJson
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as GraphDocument).nodes)) {
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
    if (!graphValueHasPayload(value) || !value) continue
    const bTitle = bnode.title?.trim()
    if (value.kind === 'image' && bTitle && !value.title) {
      collected.push({ ...value, title: bTitle })
    } else {
      collected.push(value)
    }
  }
  return mergeBoundarySoftValues(collected, GraphPortType.images)
}

async function persistUiSplitGeneration(
  ctx: NodeExecuteContext,
  screens: UiScreenPromptItem[]
): Promise<Record<string, GraphValue>> {
  const createdAt = new Date().toISOString()
  const stamp = formatGeneratedMediaStamp()
  const items = screens.map((screen, index) => ({
    id: screen.id || `ui-screen:${stamp}:${index}`,
    title: screen.title,
    text: screen.prompt,
    // 空字底图轨提示词、界面形态、画幅比例与拆层提示词随 texts 载荷透传，dive 重建内图或下游拆层时保留
    cleanPrompt: screen.cleanPrompt?.trim() || undefined,
    ...(screen.screenKind ? { screenKind: screen.screenKind } : {}),
    ...(screen.aspectRatio ? { aspectRatio: screen.aspectRatio } : {}),
    ...(screen.layerPrompt?.trim() ? { layerPrompt: screen.layerPrompt.trim() } : {}),
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
  const uiSplitAssetId = sameScreens && sameVersion ? ctx.node.params.uiSplitAssetId : ''
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
