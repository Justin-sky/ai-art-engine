import type { GraphDocument } from '../types'
import {
  graphValueHasPayload,
  softResolveBoundaryOutputValue,
  type ResolveHostInputSlotsOptions
} from '../hostInput'
import { isBoundaryOutputNode } from '../hostInterface'
import {
  resolveImageGenerateParamsForApi,
  imageGenerateParamsToNodePatch,
  resolveGenerateSeed
} from '../imageGenerateParams'
import {
  anim2dCellKeys,
  ANIM2D_GIF_OUT_PORT_ID,
  buildAnim2dGridInstruction,
  buildAnimKeyColorPrompt,
  buildAnimVideoRestyleInstruction,
  buildAnimViewStylePrompt,
  readAnim2dFromNode,
  readAnimDisabledCellsFromNode,
  readAnimEdgeInsetFromNode,
  readAnimGenModeFromNode,
  readAnimGifFpsFromNode,
  readAnimKeyColorFromNode,
  readAnimKeyThresholdFromNode,
  readAnimPlayModeFromNode,
  readAnimStabilizeFromNode,
  readAnimStyleLockFromNode,
  readAnimVideoRangeFromNode,
  readAnimViewAngleFromNode,
  resolveAnim2dPreset,
  resolveFrameAnimGenSystemPrompt,
  type Anim2dState,
  type AnimGenMode
} from '../anim2d'
import type { GraphImageItem, GraphImageValue, GraphValue, NodeExecuteContext } from './types'
import { buildGeneratedMediaFileKey } from '../../domain'
import { dedupeGalleryIds } from './gallery'
import {
  commitGeneratedImages,
  materializeGeneratedBatch,
  mergeGeneratedImages
} from './materialize'
import { collectIncomingImageItems, collectIncomingVideoItems } from './mediaInputs'
import { fail } from '@shared/errors/appError'
import { SHARED_ERRORS } from '../../errors/catalog'

/**
 * 生成帧动画序列图：
 * 支持 4 种高可控度通道（可通过 animGenMode 显式指定或 auto 自动判别）：
 * 1. video-sheet（视频直抽拼表）：从上游视频均匀抽帧 + 背景抠除 + 原地脚底稳像 → 拼合序列图（零 API 成本）
 * 2. video-restyle（视频姿态引导重绘）：视频抽帧拼成动作网格表 + 角色参考图 → 生图 API 严格按姿态重绘
 * 3. frames-sheet（多图散帧拼表）：将逐帧拉片/舞台输出的 N 张关键帧统一稳像拼合为序列图
 * 4. ai-sheet（AI 提示词生图）：角色参考图 + 动作预设提示词 → 生图 API 生成序列图
 */
export async function executeFrameAnimGenNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const state = readAnim2dFromNode(node.params)
  const rawMode = readAnimGenModeFromNode(node.params)
  const videoRange = readAnimVideoRangeFromNode(node.params)
  const preset = resolveAnim2dPreset(node.params.animPresetId)
  const keyColor = readAnimKeyColorFromNode(node.params)
  const keyThreshold = readAnimKeyThresholdFromNode(node.params)
  const stabilize = readAnimStabilizeFromNode(node.params)
  const viewAngle = readAnimViewAngleFromNode(node.params)
  const styleLock = readAnimStyleLockFromNode(node.params)

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

  const sourceVideos = await collectIncomingVideoItems(ctx)
  const hasVideo = sourceVideos.length > 0
  const hasImage = portUrls.length > 0

  let effectiveMode: Exclude<AnimGenMode, 'auto'> = 'ai-sheet'
  if (rawMode !== 'auto') {
    effectiveMode = rawMode
  } else if (hasVideo && hasImage) {
    effectiveMode = 'video-restyle'
  } else if (hasVideo) {
    effectiveMode = 'video-sheet'
  } else if (portUrls.length >= 2 && !ctx.generateImage) {
    effectiveMode = 'frames-sheet'
  } else {
    effectiveMode = 'ai-sheet'
  }

  // 通道 1 & 3：视频直接抽帧拼合序列图 / 多张散帧直接拼合序列图（零 API 成本，100% 确定性）
  if (
    (effectiveMode === 'video-sheet' || effectiveMode === 'frames-sheet') &&
    ctx.composeVideoFrameSheet
  ) {
    if (effectiveMode === 'video-sheet' && !hasVideo) {
      throw new Error('GRAPH_PROCESS_NO_INPUT')
    }
    if (effectiveMode === 'frames-sheet' && !hasImage) {
      throw new Error('GRAPH_PROCESS_NO_INPUT')
    }
    const videoItem = sourceVideos[0]
    const sheet = await ctx.composeVideoFrameSheet({
      ...(effectiveMode === 'video-sheet' && videoItem
        ? {
            videoUrl: videoItem.dataUrl?.trim(),
            videoRelativePath: videoItem.relativePath?.trim()
          }
        : {
            frameDataUrls: portUrls
          }),
      rows: state.rows,
      cols: state.cols,
      startRatio: videoRange.startRatio,
      endRatio: videoRange.endRatio,
      keyColor,
      keyThreshold,
      stabilize
    })
    if (ctx.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    const createdAt = new Date().toISOString()
    const stamp = Date.now()
    const stampKey = `animGen:${node.id}:${stamp}`
    const batch: GraphImageItem[] = [{ id: `${stampKey}:0`, dataUrl: sheet.dataUrl, createdAt }]
    const materializedBatch = await materializeGeneratedBatch(ctx, batch, stampKey)
    if (!materializedBatch.length) {
      throw fail(SHARED_ERRORS.persistImageFailed, { detail: '' })
    }
    const generatedImages = mergeGeneratedImages(ctx, materializedBatch, `${stampKey}:keep`)
    return commitGeneratedImages(ctx, generatedImages, materializedBatch[0]?.relativePath?.trim(), {
      animRows: state.rows,
      animCols: state.cols,
      animPresetId: node.params.animPresetId || '',
      animKeyColor: keyColor,
      ...(viewAngle ? { animViewAngle: viewAngle } : {}),
      ...(styleLock ? { animStyleLock: styleLock } : {})
    })
  }

  // 通道 2 & 4：AI 生图（含视频姿态参考表引导重绘 video-restyle 与纯提示词 ai-sheet）
  if (!ctx.generateImage) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  let restyleSheetUrl = ''
  if (effectiveMode === 'video-restyle' && hasVideo) {
    const videoItem = sourceVideos[0]!
    if (ctx.composeVideoFrameSheet) {
      try {
        const contactSheet = await ctx.composeVideoFrameSheet({
          videoUrl: videoItem.dataUrl?.trim(),
          videoRelativePath: videoItem.relativePath?.trim(),
          rows: state.rows,
          cols: state.cols,
          startRatio: videoRange.startRatio,
          endRatio: videoRange.endRatio,
          stabilize: stabilize !== 'off' ? stabilize : 'ground',
          drawFrameNumbers: true
        })
        restyleSheetUrl = contactSheet.dataUrl
      } catch {
        restyleSheetUrl = ''
      }
    }
  }

  const finalInputUrls = restyleSheetUrl ? [...portUrls, restyleSheetUrl] : portUrls
  if (!finalInputUrls.length) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  const isEn = Boolean(ctx.locale?.startsWith('en'))
  const presetPrompt = preset ? (isEn ? preset.promptEn || preset.prompt : preset.prompt) : ''
  const instructionRaw = node.params.generateInstruction?.trim() || presetPrompt || ''
  const system = resolveFrameAnimGenSystemPrompt(node.params.generateSystemPrompt, ctx.locale)
  const userPrompt = [
    instructionRaw,
    restyleSheetUrl ? buildAnimVideoRestyleInstruction(state.rows, state.cols, ctx.locale) : '',
    buildAnimViewStylePrompt(viewAngle, styleLock, ctx.locale),
    buildAnim2dGridInstruction(state.rows, state.cols, ctx.locale),
    buildAnimKeyColorPrompt(keyColor, ctx.locale)
  ]
    .filter(Boolean)
    .join('\n\n')
  const prompt = system.trim() ? `${system.trim()}\n\n${userPrompt}` : userPrompt

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
    inputReferences: finalInputUrls,
    inputReferenceMeta: finalInputUrls.map((_, idx) => {
      const item = sourceItems[idx]
      return {
        source: 'port' as const,
        ...(item?.relativePath?.trim() ? { relativePath: item.relativePath.trim() } : {})
      }
    })
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
    throw fail(SHARED_ERRORS.noModelImage)
  }

  if (genParams.transparentBg && ctx.removeImageSolidBackground) {
    for (const item of batch) {
      if (!item.dataUrl?.startsWith('data:image/')) continue
      try {
        const solidRes = await ctx.removeImageSolidBackground({ dataUrl: item.dataUrl })
        if (solidRes.keyedRatio >= 0.02 && solidRes.dataUrl) {
          item.dataUrl = solidRes.dataUrl
        }
      } catch {
        /* 保持原图 */
      }
    }
  }

  const stampKey = `animGen:${node.id}:${stamp}`
  const materializedBatch = await materializeGeneratedBatch(ctx, batch, stampKey)
  if (!materializedBatch.length) {
    throw fail(SHARED_ERRORS.persistImageFailed, { detail: '' })
  }
  const generatedImages = mergeGeneratedImages(ctx, materializedBatch, `${stampKey}:keep`)
  return commitGeneratedImages(ctx, generatedImages, materializedBatch[0]?.relativePath?.trim(), {
    animRows: state.rows,
    animCols: state.cols,
    animPresetId: node.params.animPresetId || '',
    animKeyColor: keyColor,
    ...(viewAngle ? { animViewAngle: viewAngle } : {}),
    ...(styleLock ? { animStyleLock: styleLock } : {})
  })
}

/**
 * 2D帧动画：收集上游序列图（或直接从 in-video 视频实时抽帧合成序列图），
 * 按 rows×cols 切分为单帧输出，并把序列图信息写回节点参数供 inspector 播放预览。
 */
export async function executeAnim2dNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const assetId = node.params.animAssetId?.trim()
  // 特效透明化：外层可显式设键控背景；未设时回退内层 frame.animGen 的键控设定
  const ownKeyColor = readAnimKeyColorFromNode(node.params)
  // 普通播放节点：优先取 in 端口序列图；无图片时检查 in-video 视频直抽；最后回退内图产物
  const incoming = await collectIncomingImageItems(ctx)
  let gridItem: (GraphImageItem & { assetId?: string }) | undefined = incoming[0]
  // 行列：有内图时沿用内图层帧生成行列，否则用本节点 Inspector 行列
  const innerState = assetId ? softResolveAnim2dInnerState(ctx, assetId) : undefined
  const state = innerState ?? readAnim2dFromNode(node.params)
  const keyColor = ownKeyColor || innerState?.keyColor || ''
  const keyThreshold = readAnimKeyThresholdFromNode(node.params)
  const edgeInset = readAnimEdgeInsetFromNode(node.params)
  const stabilize = readAnimStabilizeFromNode(node.params)
  const playMode = readAnimPlayModeFromNode(node.params)
  const videoRange = readAnimVideoRangeFromNode(node.params)

  let preProcessedFromVideo = false
  if (!gridItem) {
    const incomingVideos = await collectIncomingVideoItems(ctx)
    if (incomingVideos.length > 0 && ctx.composeVideoFrameSheet) {
      const videoItem = incomingVideos[0]!
      const videoSheet = await ctx.composeVideoFrameSheet({
        videoUrl: videoItem.dataUrl?.trim(),
        videoRelativePath: videoItem.relativePath?.trim(),
        rows: state.rows,
        cols: state.cols,
        startRatio: videoRange.startRatio,
        endRatio: videoRange.endRatio,
        keyColor,
        keyThreshold,
        stabilize
      })
      gridItem = {
        id: `animVideoSheet:${node.id}:${Date.now()}`,
        dataUrl: videoSheet.dataUrl
      }
      preProcessedFromVideo = true
    }
  }

  if (!gridItem && assetId) {
    gridItem = await softResolveAnim2dGridImage(ctx, assetId)
  }
  const disabledSet = new Set(
    readAnimDisabledCellsFromNode({
      animDisabledCells: node.params.animDisabledCells,
      animRows: state.rows,
      animCols: state.cols
    })
  )
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
    throw fail(SHARED_ERRORS.capabilityFrameSplit)
  }
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const allCells = anim2dCellKeys(state.rows, state.cols)
  const activeCells = allCells.filter((cell) => !disabledSet.has(cell))
  const targetCells = activeCells.length > 0 ? activeCells : allCells

  const createdAt = new Date().toISOString()
  const stamp = Date.now()
  const batch: GraphImageItem[] = []
  for (const cell of targetCells) {
    if (ctx.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    const composed = await ctx.composeImageGridCell({
      sourceDataUrl: sourceUrl,
      state: { rows: state.rows, cols: state.cols, selected: [] },
      cellKey: cell,
      // 视频抽帧直拼的序列图无格线，不再额外内缩；AI 生图序列图按設定内缩
      edgeInset: preProcessedFromVideo ? 0 : edgeInset,
      // 视频直拼时已在入表前做过键控与稳像，避免二次重复处理
      ...(!preProcessedFromVideo && keyColor
        ? {
            chromaKey: {
              color: keyColor,
              ...(node.params.animKeyThreshold !== undefined ? { threshold: keyThreshold } : {})
            }
          }
        : {}),
      ...(!preProcessedFromVideo && stabilize !== 'off' ? { stabilize } : {})
    })
    const cellDataUrl = composed.dataUrl?.trim()
    if (!cellDataUrl) {
      throw fail(SHARED_ERRORS.frameCellSplitFailed, { cell })
    }
    batch.push({
      id: `anim2d:${node.id}:${stamp}:${cell}`,
      dataUrl: cellDataUrl,
      createdAt
    })
  }
  if (!batch.length) {
    throw fail(SHARED_ERRORS.frameSplitEmpty)
  }

  const materializedBatch = await materializeGeneratedBatch(
    ctx,
    batch,
    `anim2d:${node.id}:${stamp}`
  )
  if (!materializedBatch.length) {
    throw fail(SHARED_ERRORS.persistImageFailed, { detail: '' })
  }
  // 普通播放节点：每次 cook 只保留本次切分结果，清除上一次的数据，不累积历史
  const generatedImages = dedupeGalleryIds([], materializedBatch, `anim2d:${node.id}:${stamp}:keep`)
  const gridImageParams = {
    ...(gridItem.dataUrl?.trim() ? { dataUrl: gridItem.dataUrl.trim() } : {}),
    ...(gridItem.relativePath?.trim() ? { relativePath: gridItem.relativePath.trim() } : {})
  }
  const gifFrames =
    playMode === 'pingpong' && batch.length > 2
      ? [...batch, ...batch.slice(1, -1).reverse()]
      : batch
  const gif = await composeAnim2dGifOutput(ctx, gifFrames, readAnimGifFpsFromNode(node.params))
  const outputs = commitGeneratedImages(
    ctx,
    generatedImages,
    materializedBatch[0]?.relativePath?.trim(),
    {
      animRows: state.rows,
      animCols: state.cols,
      animGridImage: Object.keys(gridImageParams).length ? gridImageParams : undefined,
      ...(keyColor ? { animKeyColor: keyColor } : {}),
      ...gif.params
    }
  )
  return gif.value ? { ...outputs, [ANIM2D_GIF_OUT_PORT_ID]: gif.value } : outputs
}

/**
 * 运行后输出 GIF（可选）：用本节点切好的帧（已键控透明）合成动图并落盘为工程资产。
 * 帧率为 0、帧数不足两帧或渲染层未注入合成能力时不产出，保持纯切帧行为。
 * GIF 编码在渲染层 canvas 完成（见 composeAnim2dGif），shared 侧只经 ctx 能力调用。
 */
async function composeAnim2dGifOutput(
  ctx: NodeExecuteContext,
  frames: GraphImageItem[],
  fps: number
): Promise<{ value?: GraphImageValue; params: Record<string, unknown> }> {
  if (fps <= 0 || !ctx.composeGifFrames || !ctx.saveRunMedia) return { params: {} }
  const frameUrls = frames
    .map((item) => item.dataUrl?.trim() ?? '')
    .filter((url): url is string => Boolean(url))
  // 单帧动图没有播放价值
  if (frameUrls.length < 2) return { params: {} }
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const gif = await ctx.composeGifFrames({ frameUrls, fps, loop: true })
  if (!gif?.dataUrl) return { params: {} }
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const stem = ctx.node.title?.trim() || ctx.node.typeId || 'anim2d'
  const relativePath = await ctx.saveRunMedia({
    dataUrl: gif.dataUrl,
    key: buildGeneratedMediaFileKey({
      hostAssetName: ctx.resolveHostAssetName?.(),
      nodeTitle: `${stem}-gif`
    }),
    outputDir: ctx.node.params.mediaOutputDir?.trim() || undefined,
    node: ctx.node
  })
  return {
    value: { kind: 'image', dataUrl: '', relativePath },
    params: {
      animGifRelativePath: relativePath,
      animGifFps: fps,
      animGifFrameCount: gif.frameCount,
      animGifWidth: gif.width,
      animGifHeight: gif.height
    }
  }
}

/** 从 dive 子图资产软解析序列图输出边界（边界输出未运行也可从上游取到） */
async function softResolveAnim2dGridImage(
  ctx: NodeExecuteContext,
  assetId: string
): Promise<(GraphImageItem & { assetId?: string }) | undefined> {
  const liveDoc = ctx.resolveLiveAssetGraph?.(assetId)
  const gen = ctx.resolveAssetGenParams?.(assetId)
  const raw = liveDoc ?? gen?.graphJson
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as GraphDocument).nodes)) {
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

/** 从 dive 子图资产读取「生成帧动画序列图」节点的行列与键控参数（单一数据源） */
function softResolveAnim2dInnerState(
  ctx: NodeExecuteContext,
  assetId: string
): (Anim2dState & { keyColor: ReturnType<typeof readAnimKeyColorFromNode> }) | undefined {
  const liveDoc = ctx.resolveLiveAssetGraph?.(assetId)
  const gen = ctx.resolveAssetGenParams?.(assetId)
  const raw = liveDoc ?? gen?.graphJson
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as GraphDocument).nodes)) {
    return undefined
  }
  const doc = raw as GraphDocument
  const genNode = doc.nodes.find((n) => n.typeId === 'frame.animGen')
  if (!genNode) return undefined
  return {
    ...readAnim2dFromNode(genNode.params),
    keyColor: readAnimKeyColorFromNode(genNode.params)
  }
}
