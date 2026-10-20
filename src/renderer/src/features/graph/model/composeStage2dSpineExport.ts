import {
  STAGE2D_ACTION_PRESETS,
  buildStage2dSpineData,
  buildStage2dSpinePackedAtlasText,
  computeStage2dLayerPlacements,
  extractAlphaBounds,
  normalizeStage2dRig,
  normalizeStage2dScene,
  packStage2dSpineAtlas,
  stage2dSpineSafeName,
  type Stage2dAction,
  type Stage2dPose,
  type Stage2dRig,
  type Stage2dSceneState,
  type Stage2dSpineActionEntry
} from '@shared/gameAssets'
import { loadImageElement } from '../../yolo/cutout'

/**
 * Spine 骨架包像素拼装（5.4「Spine 骨骼拆件与装配数据」导出侧）。
 * 承接 stage2dSpineExport 纯几何：对每个「挂到关节的可见层」按放置计划
 * 从源图裁出实际绘制主体（plan.bounds 区域）并缩放到部件页尺寸，产出
 * 透明 PNG 页 + 紧密拼合的单张合并图集（-atlas.png）+ 带完整动画轨的 skeleton.json。
 */

async function probeStageSprite(url: string): Promise<{
  image: HTMLImageElement
  srcWidth: number
  srcHeight: number
  bounds: NonNullable<ReturnType<typeof extractAlphaBounds>>
} | null> {
  const trimmed = url.trim()
  if (!trimmed) return null
  try {
    const img = await loadImageElement(trimmed)
    const sw = img.naturalWidth || 1
    const sh = img.naturalHeight || 1
    const probe = document.createElement('canvas')
    probe.width = sw
    probe.height = sh
    const probeCtx = probe.getContext('2d')
    if (!probeCtx) throw new Error('STAGE_CANVAS_UNAVAILABLE')
    probeCtx.drawImage(img, 0, 0)
    const rgba = probeCtx.getImageData(0, 0, sw, sh)
    const bounds = extractAlphaBounds(rgba.data, sw, sh, { alphaMin: 8 }) ?? {
      x: 0,
      y: 0,
      width: sw,
      height: sh
    }
    return { image: img, srcWidth: sw, srcHeight: sh, bounds }
  } catch {
    return null
  }
}

export interface Stage2dSpineExportFile {
  fileName: string
  dataUrl: string
}

/** Spine 骨架包拼装结果：skeleton JSON 文本 + atlas 文本 + 合并图集与部件页 PNG */
export interface Stage2dSpineExportResult {
  skeletonName: string
  jsonText: string
  atlasText: string
  /** 导出的动画轨数量 */
  animationCount: number
  /** 纹理文件（含合并图集 -atlas.png 与各部件页 PNG） */
  files: Stage2dSpineExportFile[]
}

export async function composeStage2dSpineExport(input: {
  state: Stage2dSceneState
  /** 骨骼装配 */
  rig: Stage2dRig
  /** 当前摆姿（并入 setup 旋转） */
  pose?: Stage2dPose | null
  /** 当前自定义动作（可选，一并写入 animations） */
  customAction?: Stage2dAction | null
  /** 显式指定的动作表（缺省导出 customAction + 全部匹配的内置动作预设） */
  actions?: Stage2dSpineActionEntry[] | null
  /** 层 sourceUrl → 可绘制 URL 的 resolver（相对路径需读成 dataUrl） */
  resolveLayerUrl: (sourceUrl: string) => Promise<string>
  /** 骨架包文件名前缀（默认取自场景名） */
  baseName?: string
}): Promise<Stage2dSpineExportResult | null> {
  const scene = normalizeStage2dScene(input.state)
  const rig = normalizeStage2dRig(input.rig)
  const pose = input.pose ?? null
  if (!scene.layers.length || !rig.attachments.length) return null

  // 逐层解码（与 composeStage2dCanvas 同口径：全部层都探源，含隐藏整图层——
  // 部件层 frame 需要参考层的计划几何；先经 resolver 得到可绘 URL）
  const probes = await Promise.all(
    scene.layers.map(async (layer) => {
      if (!layer.sourceUrl.trim()) return null
      const url = await input.resolveLayerUrl(layer.sourceUrl)
      return url ? probeStageSprite(url) : null
    })
  )
  const sourceInfos = scene.layers.map((_, index) => {
    const probe = probes[index]
    return probe
      ? { srcWidth: probe.srcWidth, srcHeight: probe.srcHeight, bounds: probe.bounds }
      : { srcWidth: 0, srcHeight: 0, bounds: null }
  })
  const placements = computeStage2dLayerPlacements(scene, sourceInfos)

  // 只收集「有挂点 + 可见 + 放置计划可用」的层作为部件
  const parts: Array<Parameters<typeof buildStage2dSpineData>[0]['parts'][number]> = []
  const crops: Array<{
    image: HTMLImageElement
    plan: NonNullable<(typeof placements)[number]['plan']>
  }> = []
  for (const attachment of rig.attachments) {
    const layerIndex = scene.layers.findIndex((layer) => layer.id === attachment.layerId)
    if (layerIndex < 0) continue
    const layer = scene.layers[layerIndex]
    const probe = probes[layerIndex]
    const { plan } = placements[layerIndex]
    if (!layer.visible || !probe || !plan || plan.dstW < 1 || plan.dstH < 1) continue
    const bw = Math.max(1, plan.bounds.width)
    const bh = Math.max(1, plan.bounds.height)
    const layerPivot = layer.pivot
    const pivotPageX = layerPivot ? (layerPivot.x / bw) * plan.dstW : undefined
    const pivotPageY = layerPivot ? (layerPivot.y / bh) * plan.dstH : undefined
    parts.push({
      layerId: layer.id,
      name: layer.name,
      jointId: attachment.jointId,
      anchor: layer.align.anchor === 'center' ? 'center' : 'ground',
      pivotX: pivotPageX,
      pivotY: pivotPageY,
      dstWidth: plan.dstW,
      dstHeight: plan.dstH,
      offsetX: attachment.offsetX,
      offsetY: attachment.offsetY,
      rotation: attachment.rotation
    })
    crops.push({ image: probe.image, plan })
  }
  if (!parts.length) return null

  const actionEntries: Stage2dSpineActionEntry[] = input.actions ?? [
    ...(input.customAction && input.customAction.keyframes.length
      ? [{ name: input.customAction.name || 'custom', action: input.customAction }]
      : []),
    ...STAGE2D_ACTION_PRESETS.map((preset) => ({ name: preset.id, action: preset }))
  ]

  const skeletonName = stage2dSpineSafeName(input.baseName || 'stage2d', 'skeleton')
  const built = buildStage2dSpineData({
    rig,
    pose,
    parts,
    actions: actionEntries,
    meta: { name: skeletonName }
  })
  if (!built.pages.length) return null

  // 1) 逐部件页裁切 PNG
  const partCanvases: HTMLCanvasElement[] = []
  const partFiles: Stage2dSpineExportFile[] = built.pages.map((page, index) => {
    const crop = crops[index]
    const pageCanvas = document.createElement('canvas')
    pageCanvas.width = page.pageWidth
    pageCanvas.height = page.pageHeight
    const ctx = pageCanvas.getContext('2d')
    if (!ctx) throw new Error('STAGE_CANVAS_UNAVAILABLE')
    ctx.clearRect(0, 0, page.pageWidth, page.pageHeight)
    ctx.drawImage(
      crop.image,
      crop.plan.bounds.x,
      crop.plan.bounds.y,
      crop.plan.bounds.width,
      crop.plan.bounds.height,
      0,
      0,
      page.pageWidth,
      page.pageHeight
    )
    partCanvases.push(pageCanvas)
    return {
      fileName: `${skeletonName}-${page.slotName}.png`,
      dataUrl: pageCanvas.toDataURL('image/png')
    }
  })

  // 2) 合成单张紧致图集纹理（<skeletonName>-atlas.png）与对应的 .atlas 描述文本
  const pack = packStage2dSpineAtlas(built.pages, { padding: 2 })
  const atlasCanvas = document.createElement('canvas')
  atlasCanvas.width = pack.width
  atlasCanvas.height = pack.height
  const atlasCtx = atlasCanvas.getContext('2d')
  if (!atlasCtx) throw new Error('STAGE_CANVAS_UNAVAILABLE')
  atlasCtx.clearRect(0, 0, pack.width, pack.height)
  for (const region of pack.regions) {
    const partCanvas = partCanvases[region.pageIndex]
    if (partCanvas) {
      atlasCtx.drawImage(partCanvas, region.x, region.y)
    }
  }
  const atlasFileName = `${skeletonName}-atlas.png`
  const atlasFile: Stage2dSpineExportFile = {
    fileName: atlasFileName,
    dataUrl: atlasCanvas.toDataURL('image/png')
  }

  const animationsObj = (built.skeleton.animations ?? {}) as Record<string, unknown>
  return {
    skeletonName,
    jsonText: JSON.stringify(built.skeleton, null, 2),
    atlasText: buildStage2dSpinePackedAtlasText({
      fileName: atlasFileName,
      pack
    }),
    animationCount: Object.keys(animationsObj).length,
    files: [atlasFile, ...partFiles]
  }
}
