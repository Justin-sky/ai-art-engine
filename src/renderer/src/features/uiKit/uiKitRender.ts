/**
 * 渲染层「UI 部件提取」的纯 canvas 帮手：源图加载、按部件裁剪透明 PNG、
 * 九宫格拉伸预览绘制。数据模型 / 命名 / 网格几何均来自 @shared/gameAssets。
 */
import { clampUiKitRect, computeNineSliceCells, type UiKitPart } from '@shared/gameAssets'

/** 以 CORS 模式加载源图（studio-media:// 带 ACAO:*，可读像素） */
export function loadUiKitSourceImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('UIKIT: failed to load source image'))
    img.src = url
  })
}

/** 裁剪部件源图像素区域到离屏 canvas（坐标即自然像素） */
function cropPartCanvas(img: HTMLImageElement, part: UiKitPart): HTMLCanvasElement | null {
  const natW = img.naturalWidth || img.width
  const natH = img.naturalHeight || img.height
  const rect = clampUiKitRect(part.rect, natW, natH)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, rect.width)
  canvas.height = Math.max(1, rect.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)
  return canvas
}

/** 裁剪部件为透明 PNG data URL */
export function cropUiKitPartPng(img: HTMLImageElement, part: UiKitPart): string {
  const canvas = cropPartCanvas(img, part)
  if (!canvas) throw new Error('UIKIT: canvas 2d context unavailable')
  return canvas.toDataURL('image/png')
}

/**
 * 按 9-slice 网格把部件画到指定画布（任意目标尺寸不变形），用于界面即时预览。
 * 返回目标画布实际写入的宽高（<1 时返回 null）。
 */
export function paintUiKitNineSlice(
  canvas: HTMLCanvasElement | null,
  img: HTMLImageElement | null,
  part: UiKitPart,
  targetWidth: number,
  targetHeight: number
): boolean {
  if (!canvas || !img) return false
  const natW = img.naturalWidth || img.width
  const natH = img.naturalHeight || img.height
  const rect = clampUiKitRect(part.rect, natW, natH)
  const dstW = Math.max(1, Math.round(targetWidth))
  const dstH = Math.max(1, Math.round(targetHeight))
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  canvas.width = dstW
  canvas.height = dstH
  ctx.clearRect(0, 0, dstW, dstH)
  const cells = computeNineSliceCells(rect.width, rect.height, part.border, dstW, dstH)
  for (const cell of cells) {
    ctx.drawImage(
      img,
      rect.x + cell.src.x,
      rect.y + cell.src.y,
      cell.src.width,
      cell.src.height,
      cell.dst.x,
      cell.dst.y,
      cell.dst.width,
      cell.dst.height
    )
  }
  return true
}
