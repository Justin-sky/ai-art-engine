import { formatGeneratedMediaStamp } from '../../domain'
import { materializeBeatUnitTextItems } from './output'
import type { GraphDocument, GraphNode, GraphNodeParams, GraphOutputKind } from '../types'
import { GraphPortType } from '../types'
import { catalogTextFromInputs, catalogValue } from '../catalogValue'
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
  selectEpisodeAnchor,
  selectEpisodeAnchors,
  selectEpisodeCell,
  selectEpisodeKeyframeSpans,
  formatEpisodeKeyframeSpanNotes,
  selectEpisodeMotion
} from '../episodeBoardParse'
import {
  resolveOptimizeSystemPrompt,
  resolveWorldExtractSystemPrompt,
  resolveBeatSplitSystemPrompt,
  resolveBeatUnitGenSystemPrompt,
  resolveUiSplitSystemPrompt
} from '../systemPromptSchemes'
import {
  buildOptimizePrompt,
  buildWorldExtractPrompt,
  buildBeatSplitPrompt,
  buildBeatUnitGenPrompt,
  buildUiSplitPrompt
} from '../userPromptSchemes'
import { resolveAssetTextFromGenParams } from '../assetText'
import {
  mergeWorldCatalogPreservingReviewed,
  parseWorldElementCatalog,
  parseWorldElementGenResults,
  stringifyWorldElementCatalog,
  stringifyWorldElementGenResults,
  worldGenImageGroupOutputs,
  type WorldElementGenResult
} from '../worldElementParse'
import { mergeBeatRowsPreservingReviewed, parseBeatJson, stringifyBeatRows } from '../beatParse'
import {
  parseUiScreenPrompts,
  screensFromUiGenIncoming,
  UI_SPLIT_INNER_GRAPH_VERSION
} from '../uiSplitParse'
import { formatBeatRefText } from '../beatParams'
import type { GraphTextItem, GraphValue, NodeExecuteContext } from './types'
import {
  dualTextGalleryOutputs,
  flattenTextValues,
  flattenVideosValues,
  newestTextSelectedId,
  stripEmbeddedTextData
} from './gallery'
import { autoIncomingTextForInstruction, selectIncomingValuesForInstruction } from './incoming'
import {
  commitInMemoryTextGallery,
  dualBeatCatalogOutputs,
  dualWorldCatalogOutputs,
  persistBeatSplitGeneration,
  persistScreenplayGeneration,
  persistWorldExtractGeneration
} from './materialize'
import { resolveMentionSources } from './context'
import { hydrateTextItems, resolveGalleryOutputsFromNodeParams } from './helpers'

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
  if (!text) throw new Error('模型未返回优化结果')

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
  const fromIn = catalogTextFromInputs(Object.values(ctx.inputs).flat(), GraphPortType.beat)
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
  const fromIn = catalogTextFromInputs(Object.values(ctx.inputs).flat(), GraphPortType.beat)
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
  const resultText = (await hydrateTextItems(stripped, ctx.readRunText))
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
  const incomingText = autoIncomingTextForInstruction(instructionRaw, selected, mentionSources)
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

export async function executeBeatUnitGenNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const mentionSources = resolveMentionSources(ctx)
  const instructionRaw = node.params.generateInstruction?.trim() ?? ''
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
  const incomingText = await resolveBeatSplitSourceText(ctx, instructionRaw, mentionSources)
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
  const hasMentionSource = instructionHasMentions(instructionRaw) && !!instruction.trim()
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
  const incomingText = await resolveBeatSplitSourceText(ctx, instructionRaw, mentionSources)

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
    : Array.isArray(node.params.uiScreens)
      ? node.params.uiScreens
      : []
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
