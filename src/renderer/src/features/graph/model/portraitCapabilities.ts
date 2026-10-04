/**
 * 人像处理：渲染层的能力缝实现。
 *
 * 这个文件是 `image.portrait` 执行器仅剩的**本地**部分。修图与换底全部由图片模型完成
 * （见 `execute/portrait.ts`），本地只保留模型做不可靠的三件事：
 * - `detectPortraitFaces`：人脸关键点检测 → 决定「依赖人脸的组能否进提示词」；
 * - `composePortraitIdPhoto`：按规格精确裁切 + 5 寸相纸拼版（纯几何，像素对齐）；
 * - `inspectImageSize`：量源图尺寸，供裁切框换算归一化坐标。
 * - `composePortraitScopedRetouch`：把模型结果按「脸 / 人物 / 手动框」蒙版回贴，只改对应部位。
 */

import {
  PORTRAIT_LANDMARK_COUNT,
  PORTRAIT_MASK_FEATHER_RATIO,
  PORTRAIT_MASK_MAX_EDGE,
  clampScopeRect,
  portraitFaceArea,
  portraitFaceBoxFromLandmarks,
  portraitFaceMaskShape,
  type PortraitFaceAnalysis,
  type PortraitScopeMask
} from '@shared/graph'
import { buildCutoutAlpha } from '@shared/yoloCutout'
import { imageToRaw, loadImageElement } from '../../yolo/cutout'
import { yoloFace, yoloSegment } from '../../yolo/api'

/** `studio-media://` 必须以 CORS 模式取图，否则 drawImage 后读像素会被判为跨源污染 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
}

/** dataURL / 远端 URL → 主进程 YOLO 推理可吃的最小底图（限制长边，减少传输量） */
async function dataUrlToRawInput(sourceDataUrl: string, maxEdge: number): Promise<string> {
  const image = await loadImage(sourceDataUrl)
  if (!maxEdge || (image.width <= maxEdge && image.height <= maxEdge)) return sourceDataUrl
  const scale = maxEdge / Math.max(image.width, image.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return sourceDataUrl
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

/** 源图像素尺寸（人像处理按规格裁切时要算归一化框） */
export async function inspectImageSize(input: {
  sourceDataUrl: string
}): Promise<{ width: number; height: number }> {
  const image = await loadImage(input.sourceDataUrl)
  return { width: Math.max(1, image.width), height: Math.max(1, image.height) }
}

/**
 * 人脸关键点检测（执行器 `detectPortraitFaces` 钩子的落地）。
 *
 * 走本地两段式 `yolo:face`（BlazeFace 检测器 + FaceMesh 468 点），主进程侧已把 468 点
 * 映射成 canonical-68，这里只做三件事：
 * - 像素坐标 → 归一化 0..1（`PortraitFaceAnalysis.landmarks` 的约定口径）；
 * - 由关键点反推人脸框（模型不直接给框）；
 * - 面积从大到小排序（多人照下游默认取最大脸）。
 *
 * **失败一律降级为空数组**：等于「没检出人脸」，依赖人脸的组整组不进提示词
 * （宁可少修，不可错修），但绝不让整张图失败。
 */
export async function detectPortraitFaces(input: {
  sourceDataUrl: string
  signal?: AbortSignal | null
}): Promise<PortraitFaceAnalysis[]> {
  try {
    if (input.signal?.aborted) return []
    const raw = await dataUrlToRawInput(input.sourceDataUrl, 1280)
    const result = await yoloFace({ image: { kind: 'dataUrl', dataUrl: raw } })
    const width = Math.max(1, result.width)
    const height = Math.max(1, result.height)
    const faces: PortraitFaceAnalysis[] = []
    for (const face of result.faces ?? []) {
      // 主进程已把 FaceMesh 468 点映射成 canonical-68，这里直接用，不再自己推
      const points = face.landmarks68 ?? []
      if (points.length < PORTRAIT_LANDMARK_COUNT) continue
      const landmarks = points.map((point) => {
        const x = Math.min(1, Math.max(0, point.x / width))
        const y = Math.min(1, Math.max(0, point.y / height))
        return [x, y] as [number, number]
      })
      faces.push({
        schema: 'canonical68' as const,
        landmarks,
        box: portraitFaceBoxFromLandmarks(landmarks),
        score: typeof face.score === 'number' ? face.score : 0,
        modelId: 'yolo:face'
      })
    }
    return faces.sort((a, b) => portraitFaceArea(b) - portraitFaceArea(a))
  } catch (err) {
    console.warn('[portrait] face detection failed; face groups will be skipped', err)
    return []
  }
}

/**
 * 证件照纯几何输出：按归一化框裁到目标像素尺寸，可选铺成相纸拼版。
 *
 * 模型已经出了「构图正确、底色正确」的图，这里只做像素对齐这件事：
 * 裁切框来自 `planIdPhoto`（由关键点算出颅顶 / 下巴位置），拼版行列来自规格与相纸。
 */
export async function composePortraitIdPhoto(input: {
  sourceDataUrl: string
  crop: { x: number; y: number; w: number; h: number }
  outputWidth: number
  outputHeight: number
  sheet: {
    cols: number
    rows: number
    cellWidth: number
    cellHeight: number
    gapPx: number
    width: number
    height: number
    count: number
  } | null
  signal?: AbortSignal | null
}): Promise<{ dataUrl: string; sheetDataUrl: string | null }> {
  const image = await loadImage(input.sourceDataUrl)
  const sourceW = image.width
  const sourceH = image.height
  const sx = Math.round(Math.min(Math.max(0, input.crop.x), 1) * sourceW)
  const sy = Math.round(Math.min(Math.max(0, input.crop.y), 1) * sourceH)
  const sw = Math.max(1, Math.round(Math.min(1, input.crop.w) * sourceW))
  const sh = Math.max(1, Math.round(Math.min(1, input.crop.h) * sourceH))

  const cell = document.createElement('canvas')
  cell.width = Math.max(1, Math.round(input.outputWidth))
  cell.height = Math.max(1, Math.round(input.outputHeight))
  const cellCtx = cell.getContext('2d')
  if (!cellCtx) throw new Error('canvas 2d context unavailable')
  cellCtx.imageSmoothingQuality = 'high'
  cellCtx.drawImage(
    image,
    Math.min(sx, Math.max(0, sourceW - 1)),
    Math.min(sy, Math.max(0, sourceH - 1)),
    Math.min(sw, Math.max(1, sourceW - sx)),
    Math.min(sh, Math.max(1, sourceH - sy)),
    0,
    0,
    cell.width,
    cell.height
  )
  const dataUrl = cell.toDataURL('image/png')

  if (!input.sheet) return { dataUrl, sheetDataUrl: null }
  if (input.signal?.aborted) return { dataUrl, sheetDataUrl: null }

  const sheet = document.createElement('canvas')
  sheet.width = Math.max(1, Math.round(input.sheet.width))
  sheet.height = Math.max(1, Math.round(input.sheet.height))
  const sheetCtx = sheet.getContext('2d')
  if (!sheetCtx) return { dataUrl, sheetDataUrl: null }
  sheetCtx.fillStyle = '#ffffff'
  sheetCtx.fillRect(0, 0, sheet.width, sheet.height)
  const gap = input.sheet.gapPx
  // 居中排布：相纸左右上下留白均分，裁切时不会一侧过窄
  const gridW = input.sheet.cols * cell.width + (input.sheet.cols - 1) * gap
  const gridH = input.sheet.rows * cell.height + (input.sheet.rows - 1) * gap
  const offsetX = Math.max(0, Math.round((sheet.width - gridW) / 2))
  const offsetY = Math.max(0, Math.round((sheet.height - gridH) / 2))
  for (let row = 0; row < input.sheet.rows; row++) {
    for (let col = 0; col < input.sheet.cols; col++) {
      sheetCtx.drawImage(
        cell,
        offsetX + col * (cell.width + gap),
        offsetY + row * (cell.height + gap)
      )
    }
  }
  return { dataUrl, sheetDataUrl: sheet.toDataURL('image/png') }
}

/** 分割模型缺省的最小接受置信度 / 蒙版羽化（分割输出像素） */
const SCOPE_PERSON_CONFIDENCE = 0.35
const SCOPE_PERSON_MASK_THRESHOLD = 0.4

/**
 * 人像处理：局部回贴（`composePortraitScopedRetouch` 的落地）。
 *
 * 模型只认 prompt，一次调用必定重绘整张图 —— 这里把重绘结果按蒙版贴回原图，
 * 未请求部位**像素级**保持原图。蒙版 = 脸（关键点推椭圆 + 颈梯形）∪ 人物实例（本地分割）
 * ∪ 手动区域框，三者都能羽化；缺来源就少一块，全缺则 `applied:false` 让调用方用整张结果。
 *
 * 实现走 canvas：蒙版画在小画布上（上限 1024），回贴时放大到原图分辨率，
 * 放大插值天然把边缘抹成软过渡，不需要在原图上做重活。
 */
export async function composePortraitScopedRetouch(input: {
  sourceDataUrl: string
  generatedDataUrl: string
  mask: PortraitScopeMask
  landmarks?: ReadonlyArray<readonly [number, number]> | null
  signal?: AbortSignal | null
}): Promise<{ dataUrl: string; applied: boolean; coverRatio: number; notes: string[] }> {
  const notes: string[] = []
  const [source, generated] = await Promise.all([
    loadImageElement(input.sourceDataUrl),
    loadImageElement(input.generatedDataUrl)
  ])
  const width = Math.max(1, source.naturalWidth || source.width)
  const height = Math.max(1, source.naturalHeight || source.height)

  const maskScale = Math.min(1, PORTRAIT_MASK_MAX_EDGE / Math.max(width, height))
  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = Math.max(1, Math.round(width * maskScale))
  maskCanvas.height = Math.max(1, Math.round(height * maskScale))
  const maskCtx = maskCanvas.getContext('2d')
  if (!maskCtx) throw new Error('canvas 2d context unavailable')
  // 白色 + alpha = 蒙版强度；羽化只在画形状时做一次
  maskCtx.fillStyle = '#ffffff'
  maskCtx.filter = `blur(${Math.max(2, Math.round(Math.min(maskCanvas.width, maskCanvas.height) * PORTRAIT_MASK_FEATHER_RATIO))}px)`

  let shapes = 0

  if (input.mask.face) {
    const shape = portraitFaceMaskShape(input.landmarks)
    if (shape) {
      const { cx, cy, rx, ry } = shape.ellipse
      maskCtx.beginPath()
      maskCtx.ellipse(
        cx * maskCanvas.width,
        cy * maskCanvas.height,
        rx * maskCanvas.width,
        ry * maskCanvas.height,
        0,
        0,
        Math.PI * 2
      )
      maskCtx.fill()
      maskCtx.beginPath()
      shape.neck.forEach(([x, y], index) => {
        const px = x * maskCanvas.width
        const py = y * maskCanvas.height
        if (index === 0) maskCtx.moveTo(px, py)
        else maskCtx.lineTo(px, py)
      })
      maskCtx.closePath()
      maskCtx.fill()
      shapes++
    } else {
      notes.push('face landmarks unavailable')
    }
  }

  if (input.mask.person && !input.signal?.aborted) {
    const personMask = await buildPersonMaskCanvas(
      source,
      maskCanvas.width,
      maskCanvas.height,
      notes
    )
    if (personMask) {
      maskCtx.drawImage(personMask, 0, 0, maskCanvas.width, maskCanvas.height)
      shapes++
    }
  }

  if (input.mask.regions.length) {
    for (const rawRect of input.mask.regions) {
      const rect = clampScopeRect(rawRect)
      maskCtx.fillRect(
        rect.x * maskCanvas.width,
        rect.y * maskCanvas.height,
        rect.w * maskCanvas.width,
        rect.h * maskCanvas.height
      )
      shapes++
    }
  }

  if (!shapes) {
    notes.push('no mask source available')
    return { dataUrl: input.generatedDataUrl, applied: false, coverRatio: 0, notes }
  }

  const coverRatio = maskCoverRatio(maskCanvas)
  if (coverRatio <= 0.0005) {
    notes.push('mask covers nothing')
    return { dataUrl: input.generatedDataUrl, applied: false, coverRatio, notes }
  }

  // 生成图按蒙版留出 alpha，再盖回原图：未覆盖处直接就是原图像素
  const layer = document.createElement('canvas')
  layer.width = width
  layer.height = height
  const layerCtx = layer.getContext('2d')
  if (!layerCtx) throw new Error('canvas 2d context unavailable')
  layerCtx.imageSmoothingQuality = 'high'
  layerCtx.drawImage(generated, 0, 0, width, height)
  layerCtx.globalCompositeOperation = 'destination-in'
  layerCtx.drawImage(maskCanvas, 0, 0, width, height)

  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const outCtx = out.getContext('2d')
  if (!outCtx) throw new Error('canvas 2d context unavailable')
  outCtx.drawImage(source, 0, 0, width, height)
  outCtx.drawImage(layer, 0, 0)

  return { dataUrl: out.toDataURL('image/png'), applied: true, coverRatio, notes }
}

/** 蒙版覆盖率（alpha > 0.5 的像素占比）：用来判断「蒙版是不是空得没意义」 */
function maskCoverRatio(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d')
  if (!ctx) return 0
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let hit = 0
  for (let i = 3; i < data.length; i += 4) {
    if (data[i]! > 128) hit++
  }
  return data.length ? hit / (data.length / 4) : 0
}

/**
 * 人物实例蒙版：本地实例分割 → 取面积最大的人物 → alpha 概率图（自带羽化）。
 *
 * 复抠图那套纯函数（`buildCutoutAlpha`）做 letterbox 反算，缺模型 / 没检出人物时
 * 返回 null 并往 `notes` 里写原因，调用方少罩一块继续跑。
 */
async function buildPersonMaskCanvas(
  source: HTMLImageElement,
  maskWidth: number,
  maskHeight: number,
  notes: string[]
): Promise<HTMLCanvasElement | null> {
  try {
    const raw = imageToRaw(source, 1280)
    const result = await yoloSegment({
      image: { kind: 'raw', width: raw.width, height: raw.height, rgba: raw.rgba },
      confThreshold: SCOPE_PERSON_CONFIDENCE,
      softMask: true
    })
    let bestIndex = -1
    let bestArea = 0
    result.boxes.forEach((box, index) => {
      if (box.label !== 'person') return
      const area = box.width * box.height
      if (area > bestArea) {
        bestArea = area
        bestIndex = index
      }
    })
    if (bestIndex < 0) {
      notes.push('no person detected')
      return null
    }
    const mask = result.masks[bestIndex]
    if (!mask || mask.width <= 0) {
      notes.push('person mask unavailable')
      return null
    }
    const outScale = maskWidth / Math.max(1, raw.width)
    const alpha = buildCutoutAlpha({
      masks: [mask.data],
      maskHw: mask.width,
      soft: true,
      letterbox: result.letterbox,
      srcWidth: raw.width,
      srcHeight: raw.height,
      region: { x: 0, y: 0, width: raw.width, height: raw.height },
      threshold: SCOPE_PERSON_MASK_THRESHOLD,
      feather: Math.max(
        2,
        Math.round(Math.min(maskWidth, maskHeight) * PORTRAIT_MASK_FEATHER_RATIO)
      ),
      outScale
    })
    const outW = Math.max(1, Math.round(raw.width * outScale))
    const outH = Math.max(1, Math.round(raw.height * outScale))
    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d context unavailable')
    const imageData = ctx.createImageData(outW, outH)
    for (let i = 0; i < outW * outH; i++) {
      const value = Math.max(0, Math.min(1, alpha[i] ?? 0))
      imageData.data[i * 4] = 255
      imageData.data[i * 4 + 1] = 255
      imageData.data[i * 4 + 2] = 255
      imageData.data[i * 4 + 3] = Math.round(value * 255)
    }
    ctx.putImageData(imageData, 0, 0)
    return canvas
  } catch (err) {
    notes.push(`person mask skipped: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}
