import {
  normalizeImageAlign,
  type ImageAlignState
} from '@shared/graph'
import {
  computeSpriteAlignPlan,
  extractAlphaBounds
} from '@shared/gameAssets'

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('ALIGN_SOURCE_LOAD_FAILED'))
    img.src = src
  })
}

/**
 * 精灵统一对齐像素合成：透明 PNG 主体（alpha 外接框）→ 统一画布等比摆放
 * → center / ground 锚点。只读第一帧像素求主体框，不调用任何模型。
 * 几何与边界规则复用 shared/gameAssets 纯函数，与导出工具/批处理一致。
 */
export async function composeImageAlignCanvas(input: {
  sourceDataUrl: string
  state: ImageAlignState
}): Promise<{ dataUrl: string; width: number; height: number }> {
  const state = normalizeImageAlign(input.state)
  const img = await loadImage(input.sourceDataUrl)
  const sw = img.naturalWidth || 1
  const sh = img.naturalHeight || 1

  // 读透明通道求主体外接框
  const probe = document.createElement('canvas')
  probe.width = sw
  probe.height = sh
  const probeCtx = probe.getContext('2d')
  if (!probeCtx) throw new Error('ALIGN_CANVAS_UNAVAILABLE')
  probeCtx.drawImage(img, 0, 0)
  const rgba = probeCtx.getImageData(0, 0, sw, sh)
  const subject =
    extractAlphaBounds(rgba.data, sw, sh, { alphaMin: 8 }) ?? {
      x: 0,
      y: 0,
      width: sw,
      height: sh
    }

  const plan = computeSpriteAlignPlan(
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
  if (!plan) throw new Error('ALIGN_GEOMETRY_FAILED')

  const canvas = document.createElement('canvas')
  canvas.width = plan.canvasWidth
  canvas.height = plan.canvasHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('ALIGN_CANVAS_UNAVAILABLE')
  ctx.clearRect(0, 0, plan.canvasWidth, plan.canvasHeight)
  // 只搬主体框内容（自动丢弃半透明孤立点/水印边界残留）
  ctx.drawImage(
    img,
    plan.bounds.x,
    plan.bounds.y,
    plan.bounds.width,
    plan.bounds.height,
    plan.dstX,
    plan.dstY,
    plan.dstW,
    plan.dstH
  )
  return { dataUrl: canvas.toDataURL('image/png'), width: plan.canvasWidth, height: plan.canvasHeight }
}
