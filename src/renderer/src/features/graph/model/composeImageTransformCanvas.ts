import {
  normalizeImageTransform,
  planImageTransform,
  type ImageTransformPlan,
  type ImageTransformState
} from '@shared/graph'

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('TRANSFORM_SOURCE_LOAD_FAILED'))
    img.src = src
  })
}

/** 填充色（透明 = 什么都不画，PNG 自带 alpha） */
function fillStyleOf(fill: ImageTransformState['fill']): string | null {
  if (fill === 'white') return '#ffffff'
  if (fill === 'black') return '#000000'
  return null
}

/**
 * 图片变换（本地像素，不调模型）：缩放 / 旋转 / 镜像 / 平移。
 *
 * 画法与编辑器预览共用 `planImageTransform` —— 同一份计划、同一套顺序（缩放 → 绕画布中心旋转
 * → 平移，翻转在旋转前施加），所以「预览什么样，出图就什么样」。
 */
export async function composeImageTransformCanvas(input: {
  sourceDataUrl: string
  state: ImageTransformState
}): Promise<{
  dataUrl: string
  width: number
  height: number
  sourceWidth: number
  sourceHeight: number
}> {
  const state = normalizeImageTransform(input.state)
  const img = await loadImage(input.sourceDataUrl)
  const sourceWidth = img.naturalWidth || 1
  const sourceHeight = img.naturalHeight || 1
  const plan = planImageTransform(sourceWidth, sourceHeight, state)

  const canvas = document.createElement('canvas')
  canvas.width = plan.width
  canvas.height = plan.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('TRANSFORM_CANVAS_UNAVAILABLE')

  const fill = fillStyleOf(plan.fill)
  if (fill) {
    ctx.fillStyle = fill
    ctx.fillRect(0, 0, plan.width, plan.height)
  }

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.save()
  ctx.translate(plan.width / 2 + plan.offsetX, plan.height / 2 + plan.offsetY)
  ctx.rotate((plan.rotate * Math.PI) / 180)
  // 翻转在旋转之前施加：镜像后再转 = 逆着转，符合「先镜像这张图再摆角度」的直觉
  ctx.scale(plan.flipH ? -1 : 1, plan.flipV ? -1 : 1)
  ctx.drawImage(img, -plan.drawWidth / 2, -plan.drawHeight / 2, plan.drawWidth, plan.drawHeight)
  ctx.restore()

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: plan.width,
    height: plan.height,
    sourceWidth: plan.sourceWidth,
    sourceHeight: plan.sourceHeight
  }
}

/**
 * 按计划把源图画进 2D 上下文（预览与出图共用）。
 *
 * **编辑器预览与执行器落笔共用这一个函数**：预览只把 `scale` 传成缩略比例，几何完全一致 ——
 * 两处各写一份绘制代码就是「预览和出图不一样」的根源。
 */
export function drawImageTransformPlan(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  plan: ImageTransformPlan,
  scale = 1
): void {
  const fill = fillStyleOf(plan.fill)
  if (fill) {
    ctx.fillStyle = fill
    ctx.fillRect(0, 0, plan.width * scale, plan.height * scale)
  }

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.save()
  ctx.translate(
    (plan.width / 2) * scale + plan.offsetX * scale,
    (plan.height / 2) * scale + plan.offsetY * scale
  )
  ctx.rotate((plan.rotate * Math.PI) / 180)
  ctx.scale(plan.flipH ? -1 : 1, plan.flipV ? -1 : 1)
  ctx.drawImage(
    img,
    (-plan.drawWidth / 2) * scale,
    (-plan.drawHeight / 2) * scale,
    plan.drawWidth * scale,
    plan.drawHeight * scale
  )
  ctx.restore()
}
