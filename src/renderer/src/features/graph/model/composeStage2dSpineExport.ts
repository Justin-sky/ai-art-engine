import {
  buildStage2dSpineAtlasText,
  buildStage2dSpineData,
  computeStage2dLayerPlacements,
  extractAlphaBounds,
  normalizeStage2dRig,
  normalizeStage2dScene,
  stage2dSpineSafeName,
  type Stage2dPose,
  type Stage2dRig,
  type Stage2dSceneState
} from '@shared/gameAssets'
import { loadImageElement } from '../../yolo/cutout'

/**
 * Spine 骨架包像素拼装（5.4「Spine 骨骼拆件与装配数据」导出侧）。
 * 承接 stage2dSpineExport 纯几何：对每个「挂到关节的可见层」按放置计划
 * 从源图裁出实际绘制主体（plan.bounds 区域）并缩放到部件页尺寸，产出
 * 透明 PNG 页（不翻转位图——Spine 图像顶部朝 +y，与 y-down 舞台翻转到
 * y-up 后视觉一致）；几何换算全部交给共享纯函数，这里只做像素搬运。
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

/** Spine 骨架包拼装结果：skeleton JSON 文本 + atlas 文本 + 部件页 PNG */
export interface Stage2dSpineExportResult {
  skeletonName: string
  jsonText: string
  atlasText: string
  /** 部件页文件（每层一页） */
  files: Stage2dSpineExportFile[]
}

export async function composeStage2dSpineExport(input: {
  state: Stage2dSceneState
  /** 骨骼装配 */
  rig: Stage2dRig
  /** 当前摆姿（并入 setup 旋转） */
  pose?: Stage2dPose | null
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
    // 与纯函数过滤口径一致（尺寸非正不产出），保证页与几何元数据 1:1；
    // 只导出可见部件层（拆件后的整图层隐藏，不出页）
    if (!layer.visible || !probe || !plan || plan.dstW < 1 || plan.dstH < 1) continue
    // 枢轴（内容像素系，相对本层内容框左上角）→ 页像素：pivot * pageW / bounds.width
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

  const skeletonName = stage2dSpineSafeName(input.baseName || 'stage2d', 'skeleton')
  const built = buildStage2dSpineData({ rig, pose, parts, meta: { name: skeletonName } })
  if (!built.pages.length) return null

  // 逐页裁源主体并缩放到部件页尺寸（顺序与 parts 一致，纯函数过滤不会丢弃合法部件）
  const files: Stage2dSpineExportFile[] = built.pages.map((page, index) => {
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
    return {
      fileName: `${skeletonName}-${page.slotName}.png`,
      dataUrl: pageCanvas.toDataURL('image/png')
    }
  })

  return {
    skeletonName,
    jsonText: JSON.stringify(built.skeleton, null, 2),
    atlasText: buildStage2dSpineAtlasText({
      pages: built.pages.map((page, index) => ({
        fileName: files[index].fileName,
        slotName: page.slotName,
        width: page.pageWidth,
        height: page.pageHeight
      }))
    }),
    files
  }
}
