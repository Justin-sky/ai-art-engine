import type { PortraitQualityState } from '@shared/graph'

/** 本地确定性人像后期预览：Canvas 像素级磨皮 / 调色 / 锐化 / 颗粒 / 暗角。 */

const PREVIEW_MAX_DIMENSION = 1280

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('预览图加载失败'))
    img.src = src
  })
}

function boxBlur(src: ImageData, radius: number): ImageData {
  const w = src.width
  const h = src.height
  const r = Math.max(1, Math.round(radius))
  const data = src.data
  const tmp = new Uint8ClampedArray(data.length)
  const out = new Uint8ClampedArray(data.length)

  // 水平
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      let rSum = 0
      let gSum = 0
      let bSum = 0
      let aSum = 0
      let count = 0
      for (let k = -r; k <= r; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k))
        const i = (row + xx) * 4
        rSum += data[i]
        gSum += data[i + 1]
        bSum += data[i + 2]
        aSum += data[i + 3]
        count++
      }
      const i = (row + x) * 4
      tmp[i] = rSum / count
      tmp[i + 1] = gSum / count
      tmp[i + 2] = bSum / count
      tmp[i + 3] = aSum / count
    }
  }

  // 垂直
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rSum = 0
      let gSum = 0
      let bSum = 0
      let aSum = 0
      let count = 0
      for (let k = -r; k <= r; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k))
        const i = (yy * w + x) * 4
        rSum += tmp[i]
        gSum += tmp[i + 1]
        bSum += tmp[i + 2]
        aSum += tmp[i + 3]
        count++
      }
      const i = (y * w + x) * 4
      out[i] = rSum / count
      out[i + 1] = gSum / count
      out[i + 2] = bSum / count
      out[i + 3] = aSum / count
    }
  }

  return new ImageData(out, w, h)
}

function blend(base: ImageData, overlay: ImageData, amount: number): ImageData {
  const out = new Uint8ClampedArray(base.data.length)
  const a = Math.min(1, Math.max(0, amount))
  for (let i = 0; i < base.data.length; i += 4) {
    out[i] = base.data[i] + (overlay.data[i] - base.data[i]) * a
    out[i + 1] = base.data[i + 1] + (overlay.data[i + 1] - base.data[i + 1]) * a
    out[i + 2] = base.data[i + 2] + (overlay.data[i + 2] - base.data[i + 2]) * a
    out[i + 3] = base.data[i + 3]
  }
  return new ImageData(out, base.width, base.height)
}

function unsharp(base: ImageData, blurred: ImageData, amount: number): ImageData {
  const out = new Uint8ClampedArray(base.data.length)
  const a = Math.max(0, amount)
  for (let i = 0; i < base.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = base.data[i + c] + (base.data[i + c] - blurred.data[i + c]) * a
      out[i + c] = v < 0 ? 0 : v > 255 ? 255 : v
    }
    out[i + 3] = base.data[i + 3]
  }
  return new ImageData(out, base.width, base.height)
}

function adjustColor(data: ImageData, temp: number, saturation: number, contrast: number, skinTone: number): void {
  const sat = 1 + Math.max(-1, Math.min(1, saturation / 100))
  const con = 1 + Math.max(-1, Math.min(1, contrast / 100))
  const tempR = temp / 100 * 24
  const tempB = -temp / 100 * 24
  const toneR = skinTone / 100 * 12
  const toneB = -skinTone / 100 * 10

  for (let i = 0; i < data.data.length; i += 4) {
    let r = data.data[i] + tempR + toneR
    let g = data.data[i + 1]
    let b = data.data[i + 2] + tempB + toneB
    const lum = 0.299 * r + 0.587 * g + 0.114 * b
    r = lum + (r - lum) * sat
    g = lum + (g - lum) * sat
    b = lum + (b - lum) * sat
    r = (r - 128) * con + 128
    g = (g - 128) * con + 128
    b = (b - 128) * con + 128
    data.data[i] = r < 0 ? 0 : r > 255 ? 255 : r
    data.data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g
    data.data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b
  }
}

function addGrain(data: ImageData, amount: number): void {
  if (amount <= 0) return
  const strength = (amount / 100) * 42
  for (let i = 0; i < data.data.length; i += 4) {
    const n = (Math.random() - 0.5) * strength
    for (let c = 0; c < 3; c++) {
      const v = data.data[i + c] + n
      data.data[i + c] = v < 0 ? 0 : v > 255 ? 255 : v
    }
  }
}

function applyVignette(data: ImageData, amount: number): void {
  if (amount <= 0) return
  const w = data.width
  const h = data.height
  const cx = w / 2
  const cy = h / 2
  const maxDist = Math.sqrt(cx * cx + cy * cy)
  const strength = (amount / 100) * 0.65
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / maxDist
      const factor = 1 - strength * Math.max(0, d - 0.35) * (1 / 0.65)
      const i = (y * w + x) * 4
      data.data[i] *= factor
      data.data[i + 1] *= factor
      data.data[i + 2] *= factor
    }
  }
}

function skinSmoothing(base: ImageData, state: PortraitQualityState): ImageData {
  const amount = state.skinSmoothing / 100
  if (amount <= 0.01) return base
  const radius = 1 + state.skinSmoothing / 100 * 7
  const blurred = boxBlur(base, radius)
  return blend(base, blurred, amount * 0.9)
}

function skinEvenness(base: ImageData, state: PortraitQualityState): ImageData {
  const amount = state.skinEvenness / 100
  if (amount <= 0.01) return base
  const blurred = boxBlur(base, 4)
  return blend(base, blurred, amount * 0.45)
}

export async function renderPortraitQualityPreview(
  src: string,
  state: PortraitQualityState
): Promise<string> {
  const img = await loadImage(src)
  const scale = Math.min(1, PREVIEW_MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return src
  ctx.drawImage(img, 0, 0, w, h)

  let current = ctx.getImageData(0, 0, w, h)
  current = skinSmoothing(current, state)
  current = skinEvenness(current, state)
  adjustColor(current, state.colorTemp, state.saturation, state.contrast, state.skinTone)

  if (state.softFocus > 0) {
    const blurred = boxBlur(current, 1 + (state.softFocus / 100) * 8)
    current = blend(current, blurred, state.softFocus / 100)
  }

  if (state.clarity > 0) {
    const blurred = boxBlur(current, 8)
    current = blend(current, unsharp(current, blurred, state.clarity / 100 * 1.1), 0.7)
  }

  if (state.sharpness > 0) {
    const blurred = boxBlur(current, 1.5)
    current = unsharp(current, blurred, state.sharpness / 100 * 1.4)
  }

  addGrain(current, state.grain)
  applyVignette(current, state.vignette)

  ctx.putImageData(current, 0, 0)
  return canvas.toDataURL('image/png')
}
