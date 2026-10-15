import {
  applyChromaKey,
  applySeamlessTileWrap,
  normalizeImageAlign,
  type ImageAlignState
} from '@shared/graph'
import {
  analyzeAssetQc,
  applyAssetQcFringeFix,
  applyColorDistanceKey,
  averageRegionColor,
  computeSpriteAlignPlan,
  extractAlphaBounds,
  type AssetQcReport,
  type IconKeyColor,
  type SpriteAlignPlan
} from '@shared/gameAssets'
import { loadImageElement } from '../../yolo/cutout'

function sampleCornerBackgroundColor(
  data: Uint8ClampedArray,
  width: number,
  height: number
): IconKeyColor | null {
  const patch = Math.max(1, Math.min(6, Math.floor(Math.min(width, height) / 10) || 1))
  const corners = [
    averageRegionColor(data, width, { x: 0, y: 0, width: patch, height: patch }),
    averageRegionColor(data, width, {
      x: Math.max(0, width - patch),
      y: 0,
      width: patch,
      height: patch
    }),
    averageRegionColor(data, width, {
      x: 0,
      y: Math.max(0, height - patch),
      width: patch,
      height: patch
    }),
    averageRegionColor(data, width, {
      x: Math.max(0, width - patch),
      y: Math.max(0, height - patch),
      width: patch,
      height: patch
    })
  ].filter((c): c is IconKeyColor => c !== null)
  if (!corners.length) return null
  const sum = corners.reduce((acc, c) => ({ r: acc.r + c.r, g: acc.g + c.g, b: acc.b + c.b }), {
    r: 0,
    g: 0,
    b: 0
  })
  return {
    r: Math.round(sum.r / corners.length),
    g: Math.round(sum.g / corners.length),
    b: Math.round(sum.b / corners.length)
  }
}

/**
 * 精灵统一对齐像素合成：透明 PNG 主体（或经快捷背景键控后的主体 alpha 外接框）→
 * 统一画布等比摆放 → center / ground 锚点 + 偏移微调 + 水平镜像 + 边缘反混合去白边 +
 * 2D 瓦片无缝平铺 + 引擎就绪资产质检（AssetQcReport）。
 */
export async function composeImageAlignCanvas(input: {
  sourceDataUrl: string
  state: ImageAlignState
}): Promise<{
  dataUrl: string
  width: number
  height: number
  plan: SpriteAlignPlan
  qcReport: AssetQcReport
}> {
  const state = normalizeImageAlign(input.state)
  const img = await loadImageElement(input.sourceDataUrl)
  const sw = img.naturalWidth || 1
  const sh = img.naturalHeight || 1

  // 读像素（可选先做快捷背景键控）求主体外接框
  const probe = document.createElement('canvas')
  probe.width = sw
  probe.height = sh
  const probeCtx = probe.getContext('2d')
  if (!probeCtx) throw new Error('ALIGN_CANVAS_UNAVAILABLE')
  probeCtx.drawImage(img, 0, 0)
  const rgba = probeCtx.getImageData(0, 0, sw, sh)

  if (state.bgKey) {
    const threshold = state.bgThreshold ?? 42
    if (state.bgKey === 'auto') {
      const bg = sampleCornerBackgroundColor(rgba.data, sw, sh)
      if (bg) {
        applyColorDistanceKey(rgba.data, bg, { distance: threshold, feather: 34 })
        if (state.defringe) applyAssetQcFringeFix({ data: rgba.data, width: sw, height: sh })
        probeCtx.putImageData(rgba, 0, 0)
      }
    } else if (state.bgKey === 'black' || state.bgKey === 'white') {
      applyChromaKey(rgba.data, state.bgKey, { threshold, feather: 48 })
      if (state.defringe) applyAssetQcFringeFix({ data: rgba.data, width: sw, height: sh })
      probeCtx.putImageData(rgba, 0, 0)
    }
  } else if (state.defringe) {
    applyAssetQcFringeFix({ data: rgba.data, width: sw, height: sh })
    probeCtx.putImageData(rgba, 0, 0)
  }

  const subject = extractAlphaBounds(rgba.data, sw, sh, { alphaMin: 8 }) ?? {
    x: 0,
    y: 0,
    width: sw,
    height: sh
  }

  const basePlan = computeSpriteAlignPlan(
    { srcWidth: sw, srcHeight: sh, bounds: subject },
    {
      canvasWidth: state.canvasWidth,
      canvasHeight: state.canvasHeight,
      anchor: state.anchor,
      contentHeightRatio: state.contentHeightRatio,
      groundRatio: state.groundRatio,
      fitWithinWidth: state.fitWithinWidth
    }
  )
  if (!basePlan) throw new Error('ALIGN_GEOMETRY_FAILED')

  const offsetX = state.offsetX ?? 0
  const offsetY = state.offsetY ?? 0
  const plan: SpriteAlignPlan = {
    ...basePlan,
    dstX: basePlan.dstX + offsetX,
    dstY: basePlan.dstY + offsetY,
    anchorX: basePlan.anchorX + offsetX,
    anchorY: basePlan.anchorY + offsetY
  }

  const canvas = document.createElement('canvas')
  canvas.width = plan.canvasWidth
  canvas.height = plan.canvasHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('ALIGN_CANVAS_UNAVAILABLE')
  ctx.clearRect(0, 0, plan.canvasWidth, plan.canvasHeight)

  ctx.save()
  if (state.flipX) {
    ctx.translate(plan.dstX + plan.dstW / 2, plan.dstY + plan.dstH / 2)
    ctx.scale(-1, 1)
    ctx.drawImage(
      probe,
      plan.bounds.x,
      plan.bounds.y,
      plan.bounds.width,
      plan.bounds.height,
      -plan.dstW / 2,
      -plan.dstH / 2,
      plan.dstW,
      plan.dstH
    )
  } else {
    // 只搬主体框内容（自动丢弃半透明孤立点/水印边界残留）
    ctx.drawImage(
      probe,
      plan.bounds.x,
      plan.bounds.y,
      plan.bounds.width,
      plan.bounds.height,
      plan.dstX,
      plan.dstY,
      plan.dstW,
      plan.dstH
    )
  }
  ctx.restore()

  const outData = ctx.getImageData(0, 0, plan.canvasWidth, plan.canvasHeight)
  let modified = false
  if (state.defringe) {
    applyAssetQcFringeFix({
      data: outData.data,
      width: plan.canvasWidth,
      height: plan.canvasHeight
    })
    modified = true
  }
  if (state.tileSeamless) {
    applySeamlessTileWrap(
      outData.data,
      plan.canvasWidth,
      plan.canvasHeight,
      state.tileBlendRatio ?? 0.15
    )
    modified = true
  }
  if (modified) {
    ctx.putImageData(outData, 0, 0)
  }

  const qcReport = analyzeAssetQc({
    data: outData.data,
    width: plan.canvasWidth,
    height: plan.canvasHeight
  })

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: plan.canvasWidth,
    height: plan.canvasHeight,
    plan,
    qcReport
  }
}
