/**
 * 把图片裁正到目标宽高比（居中裁切）。
 * 宫格画布按设定比例生成后，格子几何上会严格按该比例均分。
 */

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('IMAGE_ASPECT_LOAD_FAILED'))
    img.src = src
  })
}

export function parseAspectRatio(value: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(String(value).trim())
  if (!m) return null
  const w = Number(m[1])
  const h = Number(m[2])
  if (!(w > 0) || !(h > 0)) return null
  return w / h
}

/** 居中裁切到目标比例，返回 { x, y, width, height }（原图坐标系） */
export function aspectRatioCropRect(
  width: number,
  height: number,
  ratio: number
): { x: number; y: number; width: number; height: number } {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  const current = w / h
  if (Math.abs(current - ratio) < 0.001) {
    return { x: 0, y: 0, width: w, height: h }
  }
  if (current > ratio) {
    // 太宽：裁左右
    const cw = Math.max(1, Math.round(h * ratio))
    return { x: Math.floor((w - cw) / 2), y: 0, width: Math.min(w, cw), height: h }
  }
  // 太高：裁上下
  const ch = Math.max(1, Math.round(w / ratio))
  return { x: 0, y: Math.floor((h - ch) / 2), width: w, height: Math.min(h, ch) }
}

/** 返回裁正后的 dataUrl；无需裁正或失败时返回原 dataUrl */
export async function normalizeImageAspectRatio(input: {
  dataUrl: string
  aspectRatio: string
}): Promise<string> {
  const ratio = parseAspectRatio(input.aspectRatio)
  if (!ratio || !input.dataUrl.startsWith('data:image/')) return input.dataUrl
  const img = await loadImage(input.dataUrl)
  const sw = img.naturalWidth || 1
  const sh = img.naturalHeight || 1
  const rect = aspectRatioCropRect(sw, sh, ratio)
  if (rect.x === 0 && rect.y === 0 && rect.width === sw && rect.height === sh) {
    return input.dataUrl
  }
  const canvas = document.createElement('canvas')
  canvas.width = rect.width
  canvas.height = rect.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return input.dataUrl
  ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)
  return canvas.toDataURL('image/png')
}
