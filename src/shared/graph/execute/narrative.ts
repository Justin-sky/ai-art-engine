import { formatGeneratedMediaStamp } from '../../domain'
import type { GraphDocument, GraphNode, GraphNodeParams, GraphOutputKind } from '../types'
import { GraphPortType } from '../types'
import {
  appendImageTransparentBgPrompt,
  isExplicitOpaqueBgPrompt,
  supportsNativeTransparentImageModel
} from '../userPromptSchemes'
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
import {
  resolveOptimizeSystemPrompt,
  resolveUiImageSystemPrompt,
  resolveUiSplitSystemPrompt
} from '../systemPromptSchemes'
import { buildOptimizePrompt, buildUiSplitPrompt } from '../userPromptSchemes'
import { resolveAssetTextFromGenParams } from '../assetText'
import {
  applyUiGenStylePreset,
  buildDefaultUiLayerSplitPrompt,
  buildTextlessUiPrompt,
  normalizeUiGenStylePreset,
  normalizeUiGenTrackMode,
  normalizeUiScreenAspectRatio,
  parseUiScreenPrompts,
  screensFromUiGenIncoming,
  UI_SPLIT_INNER_GRAPH_VERSION,
  type UiScreenPromptItem
} from '../uiSplitParse'
import type {
  GraphImageItem,
  GraphTimelineVisualItem,
  GraphValue,
  GraphVideoItem,
  GraphVoiceItem,
  NodeExecuteContext
} from './types'
import {
  flattenImagesValues,
  flattenTextsValues,
  flattenVideosValues,
  flattenVoicesValues,
  newestTextSelectedId
} from './gallery'
import { autoIncomingTextForInstruction, selectIncomingValuesForInstruction } from './incoming'
import {
  commitInMemoryTextGallery,
  materializeGeneratedBatch,
  persistScreenplayGeneration
} from './materialize'
import {
  collectIncomingImageItems,
  resolveNodeStyleImages,
  resolveStyleReferenceUrls
} from './mediaInputs'
import { resolveMentionSources } from './context'
import { hydrateTextItems, resolveGalleryOutputsFromNodeParams } from './helpers'
import { cleanActSceneTitle, parseActSceneSubtitlePlan } from '../scriptTimeline'
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

/** 成片时间线输出：收集上游视频、图片/动图（含 SVG 烘焙 GIF）、配音、背景音乐与字幕，自动渲染 MP4 成片并写回图库与预览路径 */
export async function executeTimelineOutputNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const knownPorts = new Set([
    'in',
    'in-videos',
    'in-image',
    'in-images',
    'in-voice',
    'in-voices',
    'in-music',
    'in-text'
  ])
  const extraIncoming = Object.entries(ctx.inputs)
    .filter(([k]) => !knownPorts.has(k))
    .flatMap(([, v]) => v)

  const videoValues = [
    ...(ctx.inputs.in ?? []),
    ...(ctx.inputs['in-videos'] ?? []),
    ...extraIncoming
  ]
  const imageValues = [
    ...(ctx.inputs['in-image'] ?? []),
    ...(ctx.inputs['in-images'] ?? []),
    ...extraIncoming
  ]
  const voiceValues = [
    ...(ctx.inputs['in-voice'] ?? []),
    ...(ctx.inputs['in-voices'] ?? []),
    ...extraIncoming
  ]
  const musicValues = [...(ctx.inputs['in-music'] ?? [])]
  const textValues = [...(ctx.inputs['in-text'] ?? [])]

  const videos = flattenVideosValues(videoValues)
  let images = flattenImagesValues(imageValues)
  const rawVoices = flattenVoicesValues(voiceValues)
  const music = flattenVoicesValues(musicValues)
  const hydratedTextItems = await hydrateTextItems(flattenTextsValues(textValues), ctx.readRunText)
  const subtitles = hydratedTextItems.map((t) => t.text?.trim() ?? '').filter(Boolean)

  // 利用图拓扑元信息：
  // 1) 若上游为 svg.anim / anim.2d 且已产出 GIF，自动将单帧 PNG 升级为动图 GIF；
  // 2) 若上游为 asset.voice / asset.dialogue，提取其旁白台词作为自动同步字幕；
  // 3) 若 asset.music 误连到 in-voice，自动归入 music 轨；
  // 4) 混合接入视频与图片/SVG 动图时，按连线顺序及节点标题镜头序号对齐镜头与旁白。
  const extractShotNum = (title?: string): number | null => {
    if (!title) return null
    const m =
      title.match(
        /(?:\u5206\u955c|\u955c\u5934|\u7247\u6bb5|\u7ae0\u8282|\u5e55|\u6b65\u9aa4|\u7167\u7247|\u56fe\u7247|Shot|Scene|Step|Part|Clip|Photo|Image|Episode|Ep\.?)\s*#?(\d+)/i
      ) ??
      title.match(
        /\u7b2c\s*(\d+)\s*(?:\u96c6|\u573a|\u5e55|\u955c|\u7ae0|\u8282|\u6b65|\u8bdd|\u56de)/i
      ) ??
      title.match(/^#?(\d+)[\s._:\uff1a-]/i) ??
      title.match(/(\d+)/)
    return m ? Number(m[1]) : null
  }

  const isMultiVisualSourceEdge = (edge: { sourcePort?: string }, node: GraphNode): boolean =>
    node.typeId === 'film.workbench' ||
    node.typeId === 'film.render' ||
    edge.sourcePort === 'out-videos' ||
    edge.sourcePort === 'out-images' ||
    edge.sourcePort === 'out-sheets' ||
    edge.sourcePort === 'out-shots' ||
    edge.sourcePort === 'out-all'

  const nodeContainsFilmMedia = (node: GraphNode, relativePath?: string): boolean => {
    const rel = relativePath?.trim()
    if (!rel) return false
    return (
      (typeof node.params?.filmRenders === 'string' && node.params.filmRenders.includes(rel)) ||
      (typeof node.params?.filmStoryboard === 'string' && node.params.filmStoryboard.includes(rel))
    )
  }

  const doc = ctx.document
  const voices: Array<
    GraphVoiceItem & {
      text?: string
      title?: string
      trackKind?: 'voice' | 'sfx'
      lane?: number
      _order?: number
    }
  > = []
  const orderedVisuals: Array<GraphTimelineVisualItem & { _order: number }> = []

  if (doc) {
    const incomingEdges = doc.edges.filter((e) => e.target === ctx.node.id)
    const nodeById = new Map(doc.nodes.map((n) => [n.id, n]))

    if (!subtitles.length) {
      const textSourceNodes = incomingEdges
        .filter((e) => e.targetPort === 'in-text')
        .map((e) => nodeById.get(e.source))
        .filter((n): n is GraphNode => Boolean(n))
      for (const tn of textSourceNodes) {
        const fallbackTxt = tn.params?.text?.trim()
        if (fallbackTxt) subtitles.push(fallbackTxt)
      }
    }

    const imageSourceEdges = incomingEdges
      .map((e, edgeIdx) => ({ edge: e, node: nodeById.get(e.source), edgeIdx }))
      .filter(
        (item): item is { edge: typeof item.edge; node: GraphNode; edgeIdx: number } =>
          Boolean(item.node) &&
          (!item.edge.targetPort ||
            item.edge.targetPort === 'in-image' ||
            item.edge.targetPort === 'in-images')
      )

    const videoSourceEdges = incomingEdges
      .map((e, edgeIdx) => ({ edge: e, node: nodeById.get(e.source), edgeIdx }))
      .filter(
        (item): item is { edge: typeof item.edge; node: GraphNode; edgeIdx: number } =>
          Boolean(item.node) &&
          (!item.edge.targetPort ||
            item.edge.targetPort === 'in' ||
            item.edge.targetPort === 'in-videos')
      )

    const usedImgEdgeIndices = new Set<number>()
    images = images.map((img, idx) => {
      const matched =
        imageSourceEdges.find(
          ({ node: n, edgeIdx }) =>
            !usedImgEdgeIndices.has(edgeIdx) &&
            (n.params?.generatedImages?.some(
              (g) =>
                (g.relativePath && g.relativePath === img.relativePath) ||
                (g.id && g.id !== 'ref:0' && g.id === img.id)
            ) ||
              (img.relativePath && n.params?.previewRelativePath === img.relativePath) ||
              nodeContainsFilmMedia(n, img.relativePath))
        ) ?? imageSourceEdges[idx]
      if (matched && !isMultiVisualSourceEdge(matched.edge, matched.node)) {
        usedImgEdgeIndices.add(matched.edgeIdx)
      }
      const matchedNode = matched?.node
      if (!matchedNode) {
        orderedVisuals.push({
          id: img.id,
          kind: 'image',
          dataUrl: img.dataUrl,
          relativePath: img.relativePath,
          createdAt: img.createdAt,
          title: img.title,
          _order: 100000 + idx
        })
        return img
      }
      const gifRel =
        (typeof matchedNode.params?.svgGifRelativePath === 'string' &&
          matchedNode.params.svgGifRelativePath.trim()) ||
        (typeof matchedNode.params?.animGifRelativePath === 'string' &&
          matchedNode.params.animGifRelativePath.trim()) ||
        ''
      const title = img.title?.trim() || matchedNode.title?.trim()
      const shotNum = extractShotNum(title) ?? extractShotNum(matchedNode.title)
      const upgraded: GraphImageItem = {
        ...img,
        ...(gifRel ? { relativePath: gifRel } : {}),
        ...(title ? { title } : {})
      }
      orderedVisuals.push({
        id: upgraded.id,
        kind: 'image',
        dataUrl: upgraded.dataUrl,
        relativePath: upgraded.relativePath,
        createdAt: upgraded.createdAt,
        title: upgraded.title,
        _order:
          shotNum !== null
            ? shotNum * 100000 + matched.edgeIdx * 10 + idx
            : 10000000 + matched.edgeIdx * 10 + idx
      })
      return upgraded
    })

    const usedVidEdgeIndices = new Set<number>()
    videos.forEach((v, idx) => {
      const matched =
        videoSourceEdges.find(
          ({ node: n, edgeIdx }) =>
            !usedVidEdgeIndices.has(edgeIdx) &&
            (n.params?.generatedVideos?.some(
              (g) =>
                (g.relativePath && g.relativePath === v.relativePath) ||
                (g.id && g.id !== 'ref:0' && g.id === v.id)
            ) ||
              (v.relativePath &&
                (n.params?.previewRelativePath === v.relativePath ||
                  n.params?.rebuildLastOutput === v.relativePath)) ||
              nodeContainsFilmMedia(n, v.relativePath))
        ) ?? videoSourceEdges[idx]
      if (matched && !isMultiVisualSourceEdge(matched.edge, matched.node)) {
        usedVidEdgeIndices.add(matched.edgeIdx)
      }
      const title = matched?.node.title?.trim()
      const shotNum = extractShotNum(title)
      const edgeOrder = matched?.edgeIdx ?? idx
      orderedVisuals.push({
        id: v.id,
        kind: 'video',
        dataUrl: v.dataUrl,
        relativePath: v.relativePath,
        createdAt: v.createdAt,
        ...(title ? { title } : {}),
        _order:
          shotNum !== null
            ? shotNum * 100000 + 10000 + edgeOrder * 10 + idx
            : 10000000 + 10000 + edgeOrder * 10 + idx
      })
    })
    orderedVisuals.sort((a, b) => a._order - b._order)

    const voiceSourceEdges = incomingEdges
      .map((e, edgeIdx) => ({ edge: e, node: nodeById.get(e.source), edgeIdx }))
      .filter(
        (item): item is { edge: typeof item.edge; node: GraphNode; edgeIdx: number } =>
          Boolean(item.node) &&
          (item.edge.targetPort === 'in-voice' || item.edge.targetPort === 'in-voices')
      )

    rawVoices.forEach((v, idx) => {
      const matched =
        voiceSourceEdges.find(
          ({ node: n }) =>
            n.params?.generatedVoices?.some(
              (g) =>
                (g.id && g.id === v.id) || (g.relativePath && g.relativePath === v.relativePath)
            ) ||
            (n.params?.previewRelativePath && n.params.previewRelativePath === v.relativePath)
        ) ?? voiceSourceEdges[idx]
      const matchedNode = matched?.node
      if (matchedNode?.typeId === 'asset.music') {
        music.push(v)
        return
      }
      const isSfxNode = matchedNode?.typeId === 'asset.sfx'
      const spokenText = isSfxNode
        ? ''
        : (
            matchedNode?.params?.notes?.trim() ||
            matchedNode?.params?.generateInstruction?.trim() ||
            matchedNode?.params?.text?.trim() ||
            ''
          )
            .replace(/@\d+/g, '')
            .trim()
      const title = matchedNode?.title?.trim()
      const shotNum = extractShotNum(title)
      voices.push({
        ...v,
        ...(spokenText ? { text: spokenText } : {}),
        ...(title ? { title } : {}),
        trackKind: isSfxNode ? 'sfx' : 'voice',
        _order:
          shotNum !== null
            ? shotNum * 100 + (matched?.edgeIdx ?? idx)
            : 1000 + (matched?.edgeIdx ?? idx)
      })
    })
    voices.sort((a, b) => (a._order ?? 0) - (b._order ?? 0))

    // 古画一镜入画等混合入画模式（同时含取景切片图与写实复活视频）：
    // 若未接入或未水合出 subtitles，从图内识图节点/切片节点提取，或对尚未命名的古画切片即时调用多模态识图提炼场景名与专业历史文博解说词；
    // 若尚未配置独立历史解说配音轨且支持 generateSpeech，自动合成文博解说旁白。
    if (images.length > 0 && videos.length > 0) {
      const sortedImgVis = orderedVisuals.filter((v) => v.kind === 'image')
      for (let actIdx = 0; actIdx < sortedImgVis.length; actIdx++) {
        const imgVis = sortedImgVis[actIdx]!
        const actNum = extractShotNum(imgVis.title) ?? actIdx + 1
        const actMatchingNodes = doc.nodes.filter((n) => {
          const nNum = extractShotNum(n.title) ?? extractShotNum(n.id)
          return nNum === actNum
        })
        const voiceNode = actMatchingNodes.find((n) => n.typeId === 'asset.voice')
        const recognizeNode = actMatchingNodes.find((n) => n.typeId === 'image.toPrompt')
        const cropNode = actMatchingNodes.find((n) => n.typeId === 'image.process')
        const videoNode = actMatchingNodes.find((n) => n.typeId === 'asset.video')
        const realNode = actMatchingNodes.find((n) => n.typeId === 'asset.image')

        let rawText =
          subtitles[actIdx]?.trim() ||
          (typeof voiceNode?.params?.generateInstruction === 'string' &&
            voiceNode.params.generateInstruction.trim()) ||
          (typeof recognizeNode?.params?.text === 'string' && recognizeNode.params.text.trim()) ||
          (typeof cropNode?.params?.text === 'string' && cropNode.params.text.trim()) ||
          ''

        const existingCleanTitle = cleanActSceneTitle(imgVis.title || cropNode?.title, actIdx)
        if (!rawText && !existingCleanTitle && ctx.generateText) {
          try {
            let imgUrl = imgVis.dataUrl?.trim() ?? ''
            if (!imgUrl && ctx.resolveImageUrls) {
              imgUrl =
                (
                  await ctx.resolveImageUrls([
                    {
                      dataUrl: imgVis.dataUrl || '',
                      relativePath: imgVis.relativePath
                    }
                  ])
                ).find(Boolean) ?? ''
            }
            if (imgUrl) {
              const vlmRes = await ctx.generateText({
                system:
                  'You are a Chief Curator of Chinese Classical Painting at the Palace Museum and a CCTV historical documentary writer. Inspect the painting slice and output ONLY valid JSON: {"sceneName": "四字古风场景名", "subtitle": "四十至六十字专业历史文博解说词，深入剖析画作朝代笔墨技法（如宋代界画/工笔设色）、建筑舟车形制与当时社会人文历史典故"}', // cjk-ok
                prompt: `Analyze Act ${actNum} of this classical Chinese painting and write an authoritative museum-grade historical documentary commentary in Chinese. Return JSON only.`,
                images: [imgUrl],
                visionGrounding: true
              })
              const jsonMatch = vlmRes?.text?.match(/\{[\s\S]*\}/)
              if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
                const sName =
                  typeof parsed.sceneName === 'string'
                    ? parsed.sceneName.replace(/^[【[\s]+|[】\]\s]+$/g, '').trim()
                    : ''
                const sSub = typeof parsed.subtitle === 'string' ? parsed.subtitle.trim() : ''
                if (sName) {
                  const fullSceneTitle = sName.includes(`第${actNum}幕`) // cjk-ok
                    ? sName
                    : `第${actNum}幕 · ${sName}` // cjk-ok
                  imgVis.title = fullSceneTitle
                  rawText = sSub ? `【${fullSceneTitle}】${sSub}` : `【${fullSceneTitle}】`
                  if (cropNode) {
                    cropNode.title = fullSceneTitle
                    cropNode.params = { ...cropNode.params, text: rawText }
                  }
                }
              }
            }
          } catch {
            // VLM 识图失败时静默回退到专业历史文博解说词库
          }
        }

        const plan = parseActSceneSubtitlePlan({
          actIndex: actIdx,
          rawText: rawText || undefined,
          titleCandidates: [imgVis.title, cropNode?.title, videoNode?.title, realNode?.title],
          fallbackPromptTexts: [
            videoNode?.params?.generateInstruction,
            realNode?.params?.generateInstruction
          ]
        })
        imgVis.title = plan.sceneTitle
        subtitles[actIdx] = `【${plan.sceneTitle}】${plan.narrationText}`

        const existingActVoices = voices.filter(
          (vo) => vo.trackKind !== 'sfx' && (extractShotNum(vo.title) ?? -1) === actNum
        )
        if (existingActVoices.length === 0 && ctx.generateSpeech) {
          try {
            const ttsRes = await ctx.generateSpeech({
              input: plan.narrationText,
              voice: 'onyx',
              name: `act${actNum}_narration`
            })
            if (ttsRes?.relativePath?.trim()) {
              voices.push({
                id: ttsRes.assetId?.trim() || ttsRes.relativePath.trim(),
                relativePath: ttsRes.relativePath.trim(),
                title: `${plan.sceneTitle} · 画面解说旁白`, // cjk-ok
                text: plan.narrationText,
                trackKind: 'voice',
                lane: 0,
                _order: actNum * 100
              })
            }
          } catch {
            // 未配置语音合成模型时静默跳过，保留解说字幕与环境音
          }
        }
      }
      voices.sort((a, b) => (a._order ?? 0) - (b._order ?? 0))
    }
  } else {
    voices.push(...rawVoices)
    videos.forEach((v, idx) => {
      orderedVisuals.push({
        id: v.id,
        kind: 'video',
        dataUrl: v.dataUrl,
        relativePath: v.relativePath,
        createdAt: v.createdAt,
        _order: idx
      })
    })
    images.forEach((img, idx) => {
      orderedVisuals.push({
        id: img.id,
        kind: 'image',
        dataUrl: img.dataUrl,
        relativePath: img.relativePath,
        createdAt: img.createdAt,
        title: img.title,
        _order: videos.length + idx
      })
    })
  }

  const visuals: GraphTimelineVisualItem[] = orderedVisuals.map(({ _order: _, ...rest }) => rest)
  const cleanVoices = voices.map(({ _order: _, ...rest }) => rest)

  let composed: { relativePath?: string; assetId?: string } | null = null
  if (ctx.composeTimelineVideo) {
    try {
      composed = await ctx.composeTimelineVideo({
        nodeId: ctx.node.id,
        videos,
        ...(images.length ? { images } : {}),
        ...(visuals.length ? { visuals } : {}),
        voices: cleanVoices,
        ...(music.length ? { music } : {}),
        ...(subtitles.length ? { subtitles } : {}),
        signal: ctx.signal
      })
    } catch {
      composed = null
    }
  }

  const composedItem: GraphVideoItem | null = composed?.relativePath?.trim()
    ? {
        id: composed.assetId?.trim() || 'timeline-composed',
        relativePath: composed.relativePath.trim(),
        createdAt: formatGeneratedMediaStamp()
      }
    : null

  const outputVideos = composedItem
    ? [composedItem, ...videos.filter((v) => v.relativePath?.trim() !== composedItem.relativePath)]
    : videos

  const previewRelativePath =
    composedItem?.relativePath ||
    videos[0]?.relativePath?.trim() ||
    images[0]?.relativePath?.trim() ||
    undefined
  const previewDataUrl = composedItem
    ? undefined
    : videos[0]?.dataUrl?.trim() || images[0]?.dataUrl?.trim() || undefined
  const paramsPatch = {
    resultText: '',
    text: '',
    generatedVideos: outputVideos.map((video) => ({
      id: video.id,
      dataUrl: video.dataUrl,
      relativePath: video.relativePath,
      createdAt: video.createdAt
    })),
    ...(voices.length
      ? {
          generatedVoices: voices.map((voice) => ({
            id: voice.id,
            relativePath: voice.relativePath,
            createdAt: voice.createdAt
          }))
        }
      : {}),
    cameraShots: [] as [],
    previewDataUrl: previewDataUrl || '',
    previewRelativePath: previewRelativePath || '',
    outputKind: 'video' as GraphOutputKind,
    inputDataType: GraphPortType.video
  }
  ctx.node.params = { ...ctx.node.params, ...paramsPatch }
  ctx.patchNode?.({ params: paramsPatch })
  return { out: { kind: 'videos', items: outputVideos } }
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

/**
 * UI 界面生成：
 * - 接收上游 `ui.split` 界面提示词数组（或使用本节点已存 `uiScreens` / 单屏指令）
 * - 若 Dive 子图已有产出则优先收集子图输出；
 * - 若外层直接点击运行且注入了 `ctx.generateImage`，则按 `uiGenTrackMode`（`dual` 双轨 / `clean-only` 仅无字底图 / `preview-only` 仅带字预览）直接批量生图；
 * - 外口输出 `out`（图片组）及 `out-selected`（当前选中单图，默认优选无字底图直通 `image.layerSplit`），并同步 `uiSelectedLayerPrompt`。
 */
export async function executeUiGenNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const incoming = screensFromUiGenIncoming(Object.values(ctx.inputs).flat())
  const previousScreens = Array.isArray(node.params.uiScreens) ? node.params.uiScreens : []
  // 端口无输入时保留已存界面列表，避免上游未运行就把 dive 提示词清空；若有输入则保留用户在面板上勾选的 enabled 状态
  let screens: UiScreenPromptItem[] = incoming.length
    ? incoming.map((item) => {
        const prevMatch = previousScreens.find(
          (p) => (p.id && p.id === item.id) || (p.title && p.title === item.title)
        )
        return prevMatch && prevMatch.enabled === false ? { ...item, enabled: false } : item
      })
    : previousScreens

  // 支持独立单节点使用：若既无上游拆屏也无已存 uiScreens，则允许用 generateInstruction 构造单屏条目
  if (!screens.length) {
    const manualPrompt = node.params.generateInstruction?.trim() || ''
    if (manualPrompt) {
      const aspect = normalizeUiScreenAspectRatio(node.params.generateAspectRatio, manualPrompt)
      screens = [
        {
          id: 'ui-1',
          title: node.title?.trim() || '主界面', // cjk-ok 默认界面名
          prompt: manualPrompt,
          ...(aspect ? { aspectRatio: aspect } : {})
        }
      ]
    }
  }

  const summary = screens.map((s, i) => `${i + 1}. ${s.title}`).join('\n')
  // 点 cook：收集内图所有输出边界（边界输出未运行也可从上游取到），并落节点图库供预览
  let collected = collectUiGenInnerOutputs(ctx)
  const hasInnerImages =
    collected?.kind === 'images' && Array.isArray(collected.items) && collected.items.length > 0

  // 外层直跑：当注入了 generateImage 且 Dive 内图尚未产出图片时，按启用界面直接批量生成游戏 UI
  if (!hasInnerImages && ctx.generateImage && screens.length > 0) {
    if (ctx.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    const activeScreens = screens.filter((s) => s.enabled !== false && Boolean(s.prompt?.trim()))
    if (activeScreens.length > 0) {
      const trackMode = normalizeUiGenTrackMode(node.params.uiGenTrackMode)
      const stylePreset = normalizeUiGenStylePreset(node.params.uiGenStylePreset)
      const defaultAspect = normalizeUiScreenAspectRatio(node.params.generateAspectRatio) ?? '9:16'
      const systemPrompt = resolveUiImageSystemPrompt(
        node.params.generateSystemPrompt,
        ctx.locale
      ).trim()
      const model = node.params.generateModel?.trim() || undefined
      const providerInstanceId = node.params.generateProviderInstanceId?.trim() || undefined

      // 汇总主画布 in-image 风格参考图与全局 UI 风格参考图
      const sourceItems = await collectIncomingImageItems(ctx)
      let portRefs: string[] = []
      if (sourceItems.length) {
        if (ctx.resolveImageUrls) {
          portRefs = (await ctx.resolveImageUrls(sourceItems.slice(0, 4))).filter(Boolean)
        } else {
          portRefs = sourceItems
            .slice(0, 4)
            .map((item) => item.dataUrl?.trim() ?? '')
            .filter(Boolean)
        }
      }
      const styleImages =
        node.params.styleImagesUseGlobal !== false ? resolveNodeStyleImages(ctx) : []
      const styleUrls = styleImages.length ? await resolveStyleReferenceUrls(ctx, styleImages) : []
      const baseInputRefs = [...styleUrls, ...portRefs].filter(Boolean).slice(0, 4)

      const createdAt = new Date().toISOString()
      const stamp = Date.now()
      const batch: GraphImageItem[] = []

      for (const [idx, screen] of activeScreens.entries()) {
        if (ctx.signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError')
        }
        const slot = idx + 1
        const aspectRatio =
          normalizeUiScreenAspectRatio(screen.aspectRatio, screen.prompt, screen.title) ??
          defaultAspect
        const screenLayerPrompt =
          screen.layerPrompt?.trim() || buildDefaultUiLayerSplitPrompt(screen, ctx.locale)
        const useTransparentBg =
          node.params.generateTransparentBg !== false && !isExplicitOpaqueBgPrompt(screen.prompt)
        const isNativeTransparentModel = supportsNativeTransparentImageModel(model)
        let previewUrl = ''

        if (trackMode === 'dual' || trackMode === 'preview-only') {
          let styledPreview = applyUiGenStylePreset(screen.prompt, stylePreset, ctx.locale)
          if (useTransparentBg && isNativeTransparentModel) {
            styledPreview = appendImageTransparentBgPrompt(styledPreview, ctx.locale, {
              nativeTransparentModel: true
            })
          }
          const fullPreviewPrompt = systemPrompt
            ? `${systemPrompt}\n\n${styledPreview}`
            : styledPreview
          const previewRes = await ctx.generateImage({
            prompt: fullPreviewPrompt,
            model,
            providerInstanceId,
            aspectRatio,
            n: 1,
            ...(useTransparentBg ? { transparentBackground: true } : {}),
            inputReferences: baseInputRefs.length ? baseInputRefs : undefined
          })
          const firstUrl = previewRes.images?.[0]?.trim() || ''
          if (firstUrl) {
            previewUrl = firstUrl
            batch.push({
              id: `uiGen:${node.id}:${stamp}:${slot}:preview`,
              title: `图片·${screen.title}`, // cjk-ok 带字预览轨标题前缀
              ...(screenLayerPrompt ? { layerPrompt: screenLayerPrompt } : {}),
              dataUrl: firstUrl,
              createdAt
            })
          }
        }

        if (trackMode === 'dual' || trackMode === 'clean-only') {
          if (ctx.signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError')
          }
          const rawClean = screen.cleanPrompt?.trim() || buildTextlessUiPrompt(screen.prompt)
          let styledClean = applyUiGenStylePreset(rawClean, stylePreset, ctx.locale)
          if (useTransparentBg && isNativeTransparentModel) {
            styledClean = appendImageTransparentBgPrompt(styledClean, ctx.locale, {
              nativeTransparentModel: true
            })
          }
          const fullCleanPrompt = systemPrompt ? `${systemPrompt}\n\n${styledClean}` : styledClean
          // 双轨模式下把同屏刚产出的带字图作为第一参考图，保证无字底板与带字预览 100% 布局对齐
          const cleanRefs = previewUrl ? [previewUrl, ...baseInputRefs].slice(0, 4) : baseInputRefs
          const cleanRes = await ctx.generateImage({
            prompt: fullCleanPrompt,
            model,
            providerInstanceId,
            aspectRatio,
            n: 1,
            ...(useTransparentBg ? { transparentBackground: true } : {}),
            inputReferences: cleanRefs.length ? cleanRefs : undefined
          })
          const cleanUrl = cleanRes.images?.[0]?.trim() || ''
          if (cleanUrl) {
            batch.push({
              id: `uiGen:${node.id}:${stamp}:${slot}:clean`,
              title: `底图·${screen.title}`, // cjk-ok 空字底板轨标题前缀
              ...(screenLayerPrompt ? { layerPrompt: screenLayerPrompt } : {}),
              dataUrl: cleanUrl,
              createdAt
            })
          }
        }
      }

      if (batch.length > 0) {
        const materialized = await materializeGeneratedBatch(
          ctx,
          batch,
          `uiGen:${node.id}:${stamp}`
        )
        collected = {
          kind: 'images',
          items: materialized.map((item) => ({
            id: item.id,
            ...(item.title ? { title: item.title } : {}),
            ...(item.layerPrompt ? { layerPrompt: item.layerPrompt } : {}),
            dataUrl: item.dataUrl ?? '',
            createdAt: item.createdAt,
            ...(item.relativePath ? { relativePath: item.relativePath } : {})
          }))
        }
      }
    }
  }

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

  const picked =
    (selectedImageId ? genImgs.find((item) => item.id === selectedImageId) : undefined) ||
    genImgs[genImgs.length - 1]

  // 根据当前选中的界面图反查对应 screen 的专属 layerPrompt，供下游 image.layerSplit 自动继承
  const pickedScreenTitle = picked?.title
    ? picked.title.replace(/^(?:图片|底图|Image|Base)\s*[·•:\-—]\s*/i, '').trim() // cjk-ok
    : ''
  const matchedScreen =
    (pickedScreenTitle ? screens.find((s) => s.title.trim() === pickedScreenTitle) : undefined) ||
    screens[0]
  const uiSelectedLayerPrompt =
    picked?.layerPrompt?.trim() ||
    (matchedScreen
      ? matchedScreen.layerPrompt?.trim() ||
        buildDefaultUiLayerSplitPrompt(matchedScreen, ctx.locale)
      : undefined)

  const patchParams = {
    text: summary,
    uiScreens: screens,
    ...(uiSelectedLayerPrompt ? { uiSelectedLayerPrompt } : {}),
    ...finalGallery
  }
  node.params = { ...node.params, ...patchParams }
  ctx.patchNode?.({ params: patchParams })

  const outSelected: GraphValue | undefined = picked
    ? {
        kind: 'image',
        id: picked.id,
        ...(picked.title ? { title: picked.title } : {}),
        ...(uiSelectedLayerPrompt ? { layerPrompt: uiSelectedLayerPrompt } : {}),
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
