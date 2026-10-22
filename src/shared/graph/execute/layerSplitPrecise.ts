import { type ImageLayerSplitGroup, type ImageLayerSplitLayer } from '../imageLayerSplit'
import {
  groupableElementIds,
  nearestAspectRatio,
  runPreciseUiSplit,
  type PreciseSplitIo,
  type PreciseSplitResult,
  type RgbaImage
} from '../uiPreciseSplit'
import type { GraphImageItem, NodeExecuteContext } from './types'

/**
 * 精准拆层（OCR + 多模态版面树 + 逐级剥层）在执行器里的适配层：
 * 负责把 ctx 能力注入成 {@link PreciseSplitIo}，再把流水线结果转换成
 * `ImageLayerSplitState` 需要的图层 / 分组 / 图片批次。
 */
export interface PreciseLayerSplitMapped {
  layers: ImageLayerSplitLayer[]
  groups: ImageLayerSplitGroup[]
  batch: GraphImageItem[]
  canvasWidth: number
  canvasHeight: number
  result: PreciseSplitResult
}

export function canRunPreciseLayerSplit(ctx: NodeExecuteContext): boolean {
  return Boolean(ctx.uiRgbaCodec && ctx.generateText)
}

function normalizeEditResolution(resolution: string | undefined): string {
  const r = String(resolution ?? '').trim()
  if (!r || r === 'auto' || r === '1.5K') return '2K'
  return r
}

export async function runPreciseLayerSplitForNode(
  ctx: NodeExecuteContext,
  input: {
    sourceUrl: string
    sourceTitle?: string
    userHint: string
    /** 生图模型（剥层补底） */
    model?: string
    providerInstanceId?: string
    resolution?: string
    stamp: number
    /** 把任意图片地址（https / TOS）转成 canvas 可解码地址 */
    toCanvasSafeUrl: (url: string, suffix: string) => Promise<string | undefined>
  }
): Promise<PreciseLayerSplitMapped> {
  const codec = ctx.uiRgbaCodec
  const generateText = ctx.generateText
  if (!codec || !generateText) {
    throw new Error('PRECISE_SPLIT_NO_CAPABILITY')
  }
  const { stamp } = input
  const nodeId = ctx.node.id
  const visionModel = ctx.node.params.visionModel?.trim() || undefined
  const visionProviderInstanceId = ctx.node.params.visionProviderInstanceId?.trim() || undefined

  const safeSource = await input.toCanvasSafeUrl(input.sourceUrl, 'source')
  if (!safeSource) throw new Error('PRECISE_SPLIT_SOURCE_UNREADABLE')
  const source = await codec.decodeImageRgba(safeSource)

  const log = (message: string): void => {
    ctx.log?.(`[precise-split] ${message}`, 'info')
  }

  let editIndex = 0
  const generateImage = ctx.generateImage
  const io: PreciseSplitIo = {
    vlm: async (req) => {
      const res = await generateText({
        system: req.system,
        prompt: req.prompt,
        images: req.images,
        visionGrounding: true,
        ...(visionModel ? { model: visionModel } : {}),
        ...(visionProviderInstanceId ? { providerInstanceId: visionProviderInstanceId } : {})
      })
      return res?.text ?? ''
    },
    ...(generateImage
      ? {
          editImage: async (req): Promise<RgbaImage | null> => {
            const res = await generateImage({
              prompt: req.prompt,
              model: input.model,
              providerInstanceId: input.providerInstanceId,
              resolution: normalizeEditResolution(input.resolution),
              ...(req.aspectRatio ? { aspectRatio: req.aspectRatio } : {}),
              inputReferences: [req.image]
            })
            const url = res.layers?.[0]?.url?.trim() || res.images?.[0]?.trim() || ''
            if (!url) return null
            editIndex += 1
            const safe = await input.toCanvasSafeUrl(url, `peel${editIndex}`)
            if (!safe) return null
            return codec.decodeImageRgba(safe)
          }
        }
      : {}),
    encodePng: (img) => codec.encodeRgbaPng(img),
    ...(codec.recognizeImageText
      ? {
          ocr: async (img) => {
            const dataUrl = await codec.encodeRgbaPng(img)
            return (await codec.recognizeImageText?.(dataUrl)) ?? []
          }
        }
      : {}),
    log,
    signal: ctx.signal ?? null
  }

  const result = await runPreciseUiSplit(io, source, {
    locale: ctx.locale,
    userHint: input.userHint,
    sourceTitle: input.sourceTitle
  })
  log(
    `done: ${result.layers.length} layers, recon error ${result.reconstructionError.toFixed(2)}, peel ${result.peelReport
      .map((r) => `L${r.level}:${r.method}×${r.elementCount}`)
      .join(' ')}`
  )
  // 便于在控制台排查（宽高比用于确认生图模型输入尺寸）
  log(
    `canvas ${result.canvasWidth}x${result.canvasHeight} (${nearestAspectRatio(result.canvasWidth, result.canvasHeight)})`
  )

  return mapPreciseResultToLayers(result, {
    idPrefix: `layerSplit:${nodeId}:${stamp}`,
    encodePng: (img) => codec.encodeRgbaPng(img)
  })
}

/** 纯转换：流水线结果 → 图层 / 分组 / 批次（导出供测试） */
export async function mapPreciseResultToLayers(
  result: PreciseSplitResult,
  opts: { idPrefix: string; encodePng: (img: RgbaImage) => Promise<string> }
): Promise<PreciseLayerSplitMapped> {
  const W = result.canvasWidth
  const H = result.canvasHeight
  const createdAt = new Date().toISOString()
  const layers: ImageLayerSplitLayer[] = []
  const batch: GraphImageItem[] = []

  const baseId = `${opts.idPrefix}:base`
  const baseUrl = await opts.encodePng(result.base)
  layers.push({
    id: baseId,
    imageId: baseId,
    zIndex: 0,
    name: 'Base',
    description: '',
    visible: true,
    left: 0,
    top: 0,
    width: W,
    height: H,
    role: 'canvas-base',
    uiPartRole: 'canvas-base'
  })
  batch.push({ id: baseId, title: 'Base', dataUrl: baseUrl, createdAt })

  const layerIdByElement = new Map<string, string>()
  result.layers.forEach((layer, i) => {
    layerIdByElement.set(layer.elementId, `${opts.idPrefix}:e${i + 1}`)
  })

  // 分组：有子图层的元素各成一组；元素本体图层放在自己的组内
  const groupable = groupableElementIds(result.layers)
  const groupIdByElement = new Map<string, string>()
  for (const elementId of groupable) {
    groupIdByElement.set(elementId, `${opts.idPrefix}:g:${elementId}`)
  }
  const groups: ImageLayerSplitGroup[] = []
  for (const layer of result.layers) {
    const groupId = groupIdByElement.get(layer.elementId)
    if (!groupId) continue
    const parentGroupId = layer.parentElementId
      ? groupIdByElement.get(layer.parentElementId)
      : undefined
    groups.push({
      id: groupId,
      name: layer.name,
      collapsed: false,
      visible: true,
      sourceLayerId: layerIdByElement.get(layer.elementId)!,
      ...(parentGroupId ? { parentGroupId } : {})
    })
  }

  for (const layer of result.layers) {
    const id = layerIdByElement.get(layer.elementId)!
    const ownGroup = groupIdByElement.get(layer.elementId)
    const parentGroup = layer.parentElementId
      ? groupIdByElement.get(layer.parentElementId)
      : undefined
    const groupId = ownGroup ?? parentGroup
    const dataUrl = await opts.encodePng({
      width: layer.width,
      height: layer.height,
      data: layer.rgba
    })
    const right = layer.left + layer.width
    const bottom = layer.top + layer.height
    layers.push({
      id,
      imageId: id,
      zIndex: Math.max(1, layer.paintIndex),
      name: layer.name,
      description: layer.kind,
      visible: true,
      left: layer.left,
      top: layer.top,
      width: layer.width,
      height: layer.height,
      role: 'layer',
      originalAbsolute: [layer.left, layer.top, right, bottom],
      originalNormalized: [
        Math.round((layer.left / W) * 1000),
        Math.round((layer.top / H) * 1000),
        Math.round((right / W) * 1000),
        Math.round((bottom / H) * 1000)
      ],
      uiControlId: ownGroup ? layer.elementId : (layer.parentElementId ?? layer.elementId),
      uiControlName: layer.name,
      ...(groupId ? { groupId } : {}),
      ...(layer.uiControlType ? { uiControlType: layer.uiControlType } : {}),
      ...(layer.uiPartRole ? { uiPartRole: layer.uiPartRole } : {}),
      ...(layer.editableText ? { editableText: layer.editableText } : {})
    })
    batch.push({ id, title: layer.name, dataUrl, createdAt })
  }

  return { layers, groups, batch, canvasWidth: W, canvasHeight: H, result }
}
