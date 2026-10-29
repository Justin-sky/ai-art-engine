/**
 * 游戏 UI 9-Slice（九宫格拉伸切图）边界检测与导出清单纯函数层。
 *
 * 面向 RPG 对话框、卡牌边框、通用按钮、SLG 面板等可拉伸 UI 组件：
 * 1. `detectNineSliceBorders`：先定位非透明主体框，再从中心采样带向四边扫描像素特征变化，
 *    自动识别可无损拉伸的中心矩形与四边保留厚度（top / right / bottom / left）；
 * 2. `buildNineSliceManifest`：输出 Godot `StyleBoxTexture`、Unity `Sprite.border`、Cocos 与 Web CSS
 *    可直接消费的九宫格元数据。
 */

import { extractAlphaBounds, type SpriteBounds } from './spriteGeometry'
import { applyBorderFloodColorKey } from './iconPackKeying'

export interface NineSliceBorders {
  /** 距图像顶边的九宫格切线像素距离 */
  top: number
  /** 距图像右边的九宫格切线像素距离 */
  right: number
  /** 距图像底边的九宫格切线像素距离 */
  bottom: number
  /** 距图像左边的九宫格切线像素距离 */
  left: number
}

export interface NineSliceDetectOptions {
  /** 与中心基准带的最大单通道平均色差容忍度（默认 14） */
  colorTolerance?: number
  /** alpha 阈值（默认 8） */
  alphaMin?: number
  /** 当纹理含强渐变或复杂底纹时的回退边距比例（默认 0.25） */
  fallbackBorderRatio?: number
}

export interface NineSliceDetectionResult {
  width: number
  height: number
  borders: NineSliceBorders
  /** 可安全拉伸的中心区域矩形 */
  centerRect: SpriteBounds
  /** Alpha 非透明主体外接框 */
  contentBounds: SpriteBounds
  /** 检测置信度（0~1，1 表示中心平铺区特征非常稳定） */
  confidence: number
}

export interface NineSliceManifest {
  schemaVersion: 1
  assetName: string
  width: number
  height: number
  borders: NineSliceBorders
  centerRect: SpriteBounds
  contentBounds: SpriteBounds
  confidence: number
  engineConfigs: {
    /** Godot StyleBoxTexture texture_margin_* */
    godot: {
      textureMarginLeft: number
      textureMarginTop: number
      textureMarginRight: number
      textureMarginBottom: number
    }
    /** Unity Sprite.border Vector4(left, bottom, right, top) */
    unity: {
      borderLBRT: [number, number, number, number]
    }
    /** Web CSS border-image-slice */
    css: {
      borderImageSlice: string
    }
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function columnDeltaFromCenter(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  x: number,
  refX: number,
  y0: number,
  y1: number
): number {
  const count = Math.max(1, y1 - y0 + 1)
  let sum = 0
  for (let y = y0; y <= y1; y++) {
    const idx = (y * width + x) * 4
    const refIdx = (y * width + refX) * 4
    sum +=
      (Math.abs(rgba[idx]! - rgba[refIdx]!) +
        Math.abs(rgba[idx + 1]! - rgba[refIdx + 1]!) +
        Math.abs(rgba[idx + 2]! - rgba[refIdx + 2]!) +
        Math.abs(rgba[idx + 3]! - rgba[refIdx + 3]!)) /
      4
  }
  return sum / count
}

function rowDeltaFromCenter(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  y: number,
  refY: number,
  x0: number,
  x1: number
): number {
  const count = Math.max(1, x1 - x0 + 1)
  let sum = 0
  for (let x = x0; x <= x1; x++) {
    const idx = (y * width + x) * 4
    const refIdx = (refY * width + x) * 4
    sum +=
      (Math.abs(rgba[idx]! - rgba[refIdx]!) +
        Math.abs(rgba[idx + 1]! - rgba[refIdx + 1]!) +
        Math.abs(rgba[idx + 2]! - rgba[refIdx + 2]!) +
        Math.abs(rgba[idx + 3]! - rgba[refIdx + 3]!)) /
      4
  }
  return sum / count
}

/**
 * 自动识别 UI 面板 / 按钮图像的九宫格切线（top / right / bottom / left）。
 */
export function detectNineSliceBorders(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options?: NineSliceDetectOptions
): NineSliceDetectionResult {
  const safeW = Math.max(1, Math.floor(width))
  const safeH = Math.max(1, Math.floor(height))
  const tolerance = clamp(Number(options?.colorTolerance ?? 14), 2, 80)
  const fallbackRatio = clamp(Number(options?.fallbackBorderRatio ?? 0.25), 0.08, 0.42)

  const alphaBounds = extractAlphaBounds(rgba, safeW, safeH, {
    alphaMin: options?.alphaMin ?? 8
  }) ?? {
    x: 0,
    y: 0,
    width: safeW,
    height: safeH
  }

  const bx0 = alphaBounds.x
  const by0 = alphaBounds.y
  const bx1 = alphaBounds.x + alphaBounds.width - 1
  const by1 = alphaBounds.y + alphaBounds.height - 1

  const cx = Math.floor((bx0 + bx1) / 2)
  const cy = Math.floor((by0 + by1) / 2)

  const stripHalfW = Math.max(1, Math.floor(alphaBounds.width * 0.08))
  const stripHalfH = Math.max(1, Math.floor(alphaBounds.height * 0.08))
  const sampleX0 = clamp(cx - stripHalfW, bx0, bx1)
  const sampleX1 = clamp(cx + stripHalfW, bx0, bx1)
  const sampleY0 = clamp(cy - stripHalfH, by0, by1)
  const sampleY1 = clamp(cy + stripHalfH, by0, by1)

  // 从中心向左、向右扫描可拉伸水平区间
  let stretchLeft = cx
  while (stretchLeft > bx0) {
    const d = columnDeltaFromCenter(rgba, safeW, stretchLeft - 1, cx, sampleY0, sampleY1)
    if (d > tolerance) break
    stretchLeft--
  }

  let stretchRight = cx
  while (stretchRight < bx1) {
    const d = columnDeltaFromCenter(rgba, safeW, stretchRight + 1, cx, sampleY0, sampleY1)
    if (d > tolerance) break
    stretchRight++
  }

  // 从中心向上、向下扫描可拉伸垂直区间
  let stretchTop = cy
  while (stretchTop > by0) {
    const d = rowDeltaFromCenter(rgba, safeW, stretchTop - 1, cy, sampleX0, sampleX1)
    if (d > tolerance) break
    stretchTop--
  }

  let stretchBottom = cy
  while (stretchBottom < by1) {
    const d = rowDeltaFromCenter(rgba, safeW, stretchBottom + 1, cy, sampleX0, sampleX1)
    if (d > tolerance) break
    stretchBottom++
  }

  let left = stretchLeft
  let right = safeW - 1 - stretchRight
  let top = stretchTop
  let bottom = safeH - 1 - stretchBottom

  let confidence = 0.9
  const minCenterW = Math.max(4, Math.floor(alphaBounds.width * 0.15))
  const minCenterH = Math.max(4, Math.floor(alphaBounds.height * 0.15))

  // 若扫描出的中心区过窄或一直冲到主体外沿（纯色无边框），回退到稳健比例
  const scannedW = stretchRight - stretchLeft + 1
  const scannedH = stretchBottom - stretchTop + 1

  if (scannedW < minCenterW || left <= bx0 || right <= safeW - 1 - bx1) {
    const padX = Math.max(2, Math.round(alphaBounds.width * fallbackRatio))
    left = bx0 + padX
    right = safeW - (bx1 + 1 - padX)
    confidence -= 0.25
  }

  if (scannedH < minCenterH || top <= by0 || bottom <= safeH - 1 - by1) {
    const padY = Math.max(2, Math.round(alphaBounds.height * fallbackRatio))
    top = by0 + padY
    bottom = safeH - (by1 + 1 - padY)
    confidence -= 0.25
  }

  left = clamp(left, 1, Math.max(1, Math.floor(safeW * 0.45)))
  right = clamp(right, 1, Math.max(1, Math.floor(safeW * 0.45)))
  top = clamp(top, 1, Math.max(1, Math.floor(safeH * 0.45)))
  bottom = clamp(bottom, 1, Math.max(1, Math.floor(safeH * 0.45)))

  const centerRect: SpriteBounds = {
    x: left,
    y: top,
    width: Math.max(1, safeW - left - right),
    height: Math.max(1, safeH - top - bottom)
  }

  return {
    width: safeW,
    height: safeH,
    borders: { top, right, bottom, left },
    centerRect,
    contentBounds: alphaBounds,
    confidence: Number(clamp(confidence, 0.2, 1).toFixed(2))
  }
}

/**
 * 构建包含 Godot / Unity / CSS 引擎配置映射的九宫格清单。
 */
export function buildNineSliceManifest(
  assetName: string,
  detection: NineSliceDetectionResult
): NineSliceManifest {
  const { borders, width, height, centerRect, contentBounds, confidence } = detection
  return {
    schemaVersion: 1,
    assetName: (assetName || 'ui_panel').trim() || 'ui_panel',
    width,
    height,
    borders,
    centerRect,
    contentBounds,
    confidence,
    engineConfigs: {
      godot: {
        textureMarginLeft: borders.left,
        textureMarginTop: borders.top,
        textureMarginRight: borders.right,
        textureMarginBottom: borders.bottom
      },
      unity: {
        borderLBRT: [borders.left, borders.bottom, borders.right, borders.top]
      },
      css: {
        borderImageSlice: `${borders.top} ${borders.right} ${borders.bottom} ${borders.left} fill`
      }
    }
  }
}

export type NineSlicePatchName =
  | 'top_left'
  | 'top_center'
  | 'top_right'
  | 'middle_left'
  | 'middle_center'
  | 'middle_right'
  | 'bottom_left'
  | 'bottom_center'
  | 'bottom_right'

export interface NineSlicePatchEntry {
  name: NineSlicePatchName
  col: 0 | 1 | 2
  row: 0 | 1 | 2
  x: number
  y: number
  width: number
  height: number
  rgba: Uint8ClampedArray
}

export interface NinePatchSliceOptions {
  /** 是否自动对画布四边外围纯色背景执行泛洪去底（默认 true） */
  autoKeyBackground?: boolean
  /** 是否强制左右边框区域像素镜像对称（默认 false） */
  symmetricLock?: boolean
  /** 爆炸图（Exploded 9-Patch Sheet）各切片之间的间距像素（默认自适应 6~16px） */
  gapPx?: number
  /** 拉伸预览图目标宽度（默认 Math.round(width * 1.5)） */
  previewWidth?: number
  /** 拉伸预览图目标高度（默认 Math.round(height * 1.25)） */
  previewHeight?: number
  /** 九宫格拉伸或整数平铺模式（默认 'stretch'） */
  stretchMode?: 'stretch' | 'tile'
}

export interface NinePatchSliceResult {
  width: number
  height: number
  borders: NineSliceBorders
  centerRect: SpriteBounds
  /** 去底与可选对称校正后的完整原图 RGBA */
  cleanedRgba: Uint8ClampedArray
  /** 中心区域掏空（alpha=0）的纯镂空外框 RGBA */
  hollowFrameRgba: Uint8ClampedArray
  /** 3×3 九宫格爆炸拆解图集 RGBA（带可视间隔与微导引框线） */
  explodedSheetRgba: Uint8ClampedArray
  explodedWidth: number
  explodedHeight: number
  gapPx: number
  /** 按九宫格规则无损拉伸/平铺后的对话框预览图 RGBA */
  stretchedPreviewRgba: Uint8ClampedArray
  previewWidth: number
  previewHeight: number
  /** 按名称索引的 9 个独立切片 */
  patches: Record<NineSlicePatchName, NineSlicePatchEntry>
  /** 行优先顺序的 9 个独立切片列表 */
  patchList: NineSlicePatchEntry[]
}

function clampByte(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : Math.round(n)
}

/**
 * 原图九宫格直通拆解器（Raw 9-Slice Patch Slicer）：
 * - 100% 保留上游原图的像素画风与笔触，不覆盖任何程序化框体；
 * - 可选对四周纯色背景执行泛洪抠图（保留圆角与异形外框透明通道）；
 * - 按 `borders (left / right / top / bottom)` 将原图精准拆解为 9 个标准切片
 *   （`top_left`, `top_center`, `top_right`, `middle_left`, `middle_center`, `middle_right`,
 *    `bottom_left`, `bottom_center`, `bottom_right`）；
 * - 同时产出：
 *   1. `cleanedRgba`：去底/对称优化后的九宫格原图；
 *   2. `explodedSheetRgba`：带间距导引线的 3×3 九宫格拆解爆炸图（直观检验四角与四边切线是否切在装饰花纹上）；
 *   3. `hollowFrameRgba`：中心区域（`middle_center`）镂空透明的纯边框层；
 *   4. `stretchedPreviewRgba`：按九宫格规则横向/纵向延展后的实时对话框验收图。
 */
export function sliceNinePatchRegionsRgba(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  borders: NineSliceBorders,
  options?: NinePatchSliceOptions
): NinePatchSliceResult {
  const w = Math.max(4, Math.floor(width))
  const h = Math.max(4, Math.floor(height))
  const cleanedRgba = new Uint8ClampedArray(w * h * 4)
  cleanedRgba.set(rgba.subarray(0, w * h * 4))

  if (options?.autoKeyBackground !== false) {
    applyBorderFloodColorKey(cleanedRgba, w, h)
  }

  const L = clamp(Math.round(borders.left), 1, Math.max(1, Math.floor(w * 0.46)))
  const R = clamp(Math.round(borders.right), 1, Math.max(1, Math.floor(w * 0.46)))
  const T = clamp(Math.round(borders.top), 1, Math.max(1, Math.floor(h * 0.46)))
  const B = clamp(Math.round(borders.bottom), 1, Math.max(1, Math.floor(h * 0.46)))

  if (options?.symmetricLock) {
    const mirrorW = Math.min(L, R)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < mirrorW; x++) {
        const srcIdx = (y * w + x) * 4
        const dstIdx = (y * w + (w - 1 - x)) * 4
        cleanedRgba[dstIdx] = cleanedRgba[srcIdx]!
        cleanedRgba[dstIdx + 1] = cleanedRgba[srcIdx + 1]!
        cleanedRgba[dstIdx + 2] = cleanedRgba[srcIdx + 2]!
        cleanedRgba[dstIdx + 3] = cleanedRgba[srcIdx + 3]!
      }
    }
  }

  const centerW = Math.max(1, w - L - R)
  const centerH = Math.max(1, h - T - B)
  const normalizedBorders: NineSliceBorders = { left: L, right: R, top: T, bottom: B }
  const centerRect: SpriteBounds = { x: L, y: T, width: centerW, height: centerH }

  // 1. 生成中心镂空的纯外框图（hollowFrameRgba）
  const hollowFrameRgba = new Uint8ClampedArray(cleanedRgba.length)
  hollowFrameRgba.set(cleanedRgba)
  for (let y = T; y < h - B; y++) {
    for (let x = L; x < w - R; x++) {
      const idx = (y * w + x) * 4
      const edgeDist = Math.min(x - L, w - R - 1 - x, y - T, h - B - 1 - y)
      // 保留 1px 内沿羽化过渡，中心完全透明
      if (edgeDist === 0) {
        hollowFrameRgba[idx + 3] = Math.round(hollowFrameRgba[idx + 3]! * 0.25)
      } else {
        hollowFrameRgba[idx] = 0
        hollowFrameRgba[idx + 1] = 0
        hollowFrameRgba[idx + 2] = 0
        hollowFrameRgba[idx + 3] = 0
      }
    }
  }

  // 2. 拆解 9 个独立切片（TL, TC, TR, ML, MC, MR, BL, BC, BR）
  const colX: [number, number, number] = [0, L, w - R]
  const colW: [number, number, number] = [L, centerW, R]
  const rowY: [number, number, number] = [0, T, h - B]
  const rowH: [number, number, number] = [T, centerH, B]
  const patchNames: NineSlicePatchName[][] = [
    ['top_left', 'top_center', 'top_right'],
    ['middle_left', 'middle_center', 'middle_right'],
    ['bottom_left', 'bottom_center', 'bottom_right']
  ]

  const patches = {} as Record<NineSlicePatchName, NineSlicePatchEntry>
  const patchList: NineSlicePatchEntry[] = []

  const gapPx = clamp(
    Math.round(options?.gapPx ?? Math.max(6, Math.round(Math.min(w, h) * 0.045))),
    2,
    32
  )
  const explodedWidth = w + gapPx * 2
  const explodedHeight = h + gapPx * 2
  const explodedSheetRgba = new Uint8ClampedArray(explodedWidth * explodedHeight * 4)

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const name = patchNames[r]![c]!
      const sx = colX[c]!
      const sy = rowY[r]!
      const pw = Math.max(1, colW[c]!)
      const ph = Math.max(1, rowH[r]!)
      const patchBuf = new Uint8ClampedArray(pw * ph * 4)

      const dstOffsetX = sx + c * gapPx
      const dstOffsetY = sy + r * gapPx

      for (let py = 0; py < ph; py++) {
        const srcRowStart = ((sy + py) * w + sx) * 4
        const dstPatchStart = py * pw * 4
        const rowSlice = cleanedRgba.subarray(srcRowStart, srcRowStart + pw * 4)
        patchBuf.set(rowSlice, dstPatchStart)

        const dstExplodedStart = ((dstOffsetY + py) * explodedWidth + dstOffsetX) * 4
        explodedSheetRgba.set(rowSlice, dstExplodedStart)
      }

      // 在爆炸图的每个切片四周绘制 1px 淡青/琥珀色微导引框，方便直观检查切线位置
      const isCorner = (r === 0 || r === 2) && (c === 0 || c === 2)
      const guideR = isCorner ? 56 : 251
      const guideG = isCorner ? 189 : 191
      const guideB = isCorner ? 248 : 36
      for (let gx = 0; gx < pw; gx++) {
        const topIdx = (dstOffsetY * explodedWidth + (dstOffsetX + gx)) * 4
        const botIdx = ((dstOffsetY + ph - 1) * explodedWidth + (dstOffsetX + gx)) * 4
        if (explodedSheetRgba[topIdx + 3]! < 64) {
          explodedSheetRgba[topIdx] = guideR
          explodedSheetRgba[topIdx + 1] = guideG
          explodedSheetRgba[topIdx + 2] = guideB
          explodedSheetRgba[topIdx + 3] = 110
        }
        if (explodedSheetRgba[botIdx + 3]! < 64) {
          explodedSheetRgba[botIdx] = guideR
          explodedSheetRgba[botIdx + 1] = guideG
          explodedSheetRgba[botIdx + 2] = guideB
          explodedSheetRgba[botIdx + 3] = 110
        }
      }
      for (let gy = 0; gy < ph; gy++) {
        const leftIdx = ((dstOffsetY + gy) * explodedWidth + dstOffsetX) * 4
        const rightIdx = ((dstOffsetY + gy) * explodedWidth + (dstOffsetX + pw - 1)) * 4
        if (explodedSheetRgba[leftIdx + 3]! < 64) {
          explodedSheetRgba[leftIdx] = guideR
          explodedSheetRgba[leftIdx + 1] = guideG
          explodedSheetRgba[leftIdx + 2] = guideB
          explodedSheetRgba[leftIdx + 3] = 110
        }
        if (explodedSheetRgba[rightIdx + 3]! < 64) {
          explodedSheetRgba[rightIdx] = guideR
          explodedSheetRgba[rightIdx + 1] = guideG
          explodedSheetRgba[rightIdx + 2] = guideB
          explodedSheetRgba[rightIdx + 3] = 110
        }
      }

      const entry: NineSlicePatchEntry = {
        name,
        col: c as 0 | 1 | 2,
        row: r as 0 | 1 | 2,
        x: sx,
        y: sy,
        width: pw,
        height: ph,
        rgba: patchBuf
      }
      patches[name] = entry
      patchList.push(entry)
    }
  }

  // 3. 生成无损九宫格延展对话框预览图（stretchedPreviewRgba）
  const previewWidth = Math.max(w + 16, Math.round(options?.previewWidth ?? w * 1.5))
  const previewHeight = Math.max(h + 12, Math.round(options?.previewHeight ?? h * 1.25))
  const stretchMode = options?.stretchMode === 'tile' ? 'tile' : 'stretch'
  const stretchedPreviewRgba = new Uint8ClampedArray(previewWidth * previewHeight * 4)
  const dstCenterW = Math.max(1, previewWidth - L - R)
  const dstCenterH = Math.max(1, previewHeight - T - B)

  const mapAxis = (
    dPos: number,
    startM: number,
    endM: number,
    sTotal: number,
    dTotal: number,
    sCenter: number,
    dCenter: number
  ): number => {
    if (dPos < startM) return dPos
    if (dPos >= dTotal - endM) return sTotal - (dTotal - dPos)
    const offset = dPos - startM
    if (stretchMode === 'tile') {
      return startM + (offset % sCenter)
    }
    return (
      startM + Math.min(sCenter - 1, (offset / Math.max(1, dCenter - 1)) * Math.max(0, sCenter - 1))
    )
  }

  for (let dy = 0; dy < previewHeight; dy++) {
    const syFloat = clamp(mapAxis(dy, T, B, h, previewHeight, centerH, dstCenterH), 0, h - 1)
    const y0 = Math.floor(syFloat)
    const y1 = Math.min(h - 1, y0 + 1)
    const wy = syFloat - y0

    for (let dx = 0; dx < previewWidth; dx++) {
      const sxFloat = clamp(mapAxis(dx, L, R, w, previewWidth, centerW, dstCenterW), 0, w - 1)
      const x0 = Math.floor(sxFloat)
      const x1 = Math.min(w - 1, x0 + 1)
      const wx = sxFloat - x0

      const i00 = (y0 * w + x0) * 4
      const i10 = (y0 * w + x1) * 4
      const i01 = (y1 * w + x0) * 4
      const i11 = (y1 * w + x1) * 4

      const w00 = (1 - wx) * (1 - wy)
      const w10 = wx * (1 - wy)
      const w01 = (1 - wx) * wy
      const w11 = wx * wy

      const dIdx = (dy * previewWidth + dx) * 4
      stretchedPreviewRgba[dIdx] = clampByte(
        cleanedRgba[i00]! * w00 +
          cleanedRgba[i10]! * w10 +
          cleanedRgba[i01]! * w01 +
          cleanedRgba[i11]! * w11
      )
      stretchedPreviewRgba[dIdx + 1] = clampByte(
        cleanedRgba[i00 + 1]! * w00 +
          cleanedRgba[i10 + 1]! * w10 +
          cleanedRgba[i01 + 1]! * w01 +
          cleanedRgba[i11 + 1]! * w11
      )
      stretchedPreviewRgba[dIdx + 2] = clampByte(
        cleanedRgba[i00 + 2]! * w00 +
          cleanedRgba[i10 + 2]! * w10 +
          cleanedRgba[i01 + 2]! * w01 +
          cleanedRgba[i11 + 2]! * w11
      )
      stretchedPreviewRgba[dIdx + 3] = clampByte(
        cleanedRgba[i00 + 3]! * w00 +
          cleanedRgba[i10 + 3]! * w10 +
          cleanedRgba[i01 + 3]! * w01 +
          cleanedRgba[i11 + 3]! * w11
      )
    }
  }

  return {
    width: w,
    height: h,
    borders: normalizedBorders,
    centerRect,
    cleanedRgba,
    hollowFrameRgba,
    explodedSheetRgba,
    explodedWidth,
    explodedHeight,
    gapPx,
    stretchedPreviewRgba,
    previewWidth,
    previewHeight,
    patches,
    patchList
  }
}

/**
 * 导出 Godot 4 `NinePatchRect` 场景文件（`.tscn`）兼 `StyleBoxTexture` 主题配置。
 */
export function exportGodotNinePatchTscn(
  manifest: NineSliceManifest,
  options?: {
    textureResPath?: string
    stretchMode?: 'stretch' | 'tile'
    targetWidth?: number
    targetHeight?: number
  }
): string {
  const safeName =
    manifest.assetName.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'UIPanel'
  const texPath = options?.textureResPath?.trim() || `res://assets/ui/${safeName}.png`
  const axisMode = options?.stretchMode === 'tile' ? 1 : 0
  const targetW = Math.max(manifest.width, Math.round(options?.targetWidth ?? manifest.width * 1.5))
  const targetH = Math.max(
    manifest.height,
    Math.round(options?.targetHeight ?? manifest.height * 1.25)
  )
  const { left, top, right, bottom } = manifest.borders

  return [
    `[gd_scene load_steps=3 format=3]`,
    ``,
    `[ext_resource type="Texture2D" path="${texPath}" id="1_tex"]`,
    ``,
    `[sub_resource type="StyleBoxTexture" id="StyleBoxTexture_panel"]`,
    `texture = ExtResource("1_tex")`,
    `texture_margin_left = ${left.toFixed(1)}`,
    `texture_margin_top = ${top.toFixed(1)}`,
    `texture_margin_right = ${right.toFixed(1)}`,
    `texture_margin_bottom = ${bottom.toFixed(1)}`,
    `axis_stretch_horizontal = ${axisMode}`,
    `axis_stretch_vertical = ${axisMode}`,
    ``,
    `[node name="${safeName}" type="NinePatchRect"]`,
    `offset_right = ${targetW.toFixed(1)}`,
    `offset_bottom = ${targetH.toFixed(1)}`,
    `texture = ExtResource("1_tex")`,
    `patch_margin_left = ${left}`,
    `patch_margin_top = ${top}`,
    `patch_margin_right = ${right}`,
    `patch_margin_bottom = ${bottom}`,
    `axis_stretch_horizontal = ${axisMode}`,
    `axis_stretch_vertical = ${axisMode}`,
    ``
  ].join('\n')
}

/**
 * 导出 Unity UI Toolkit (`.uss`) 9-Slice 样式表与 UGUI `Sprite.border` 导入配置代码片段。
 */
export function exportUnityNineSliceSnippet(
  manifest: NineSliceManifest,
  options?: {
    textureName?: string
    stretchMode?: 'stretch' | 'tile'
  }
): string {
  const safeName =
    manifest.assetName
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'ui-panel'
  const texName = options?.textureName?.trim() || `${safeName}.png`
  const sliceType = options?.stretchMode === 'tile' ? 'tiled' : 'sliced'
  const { left, top, right, bottom } = manifest.borders

  return [
    `/* 1. Unity UI Toolkit (.uss) 9-Slice Stylesheet */`,
    `.${safeName} {`,
    `  background-image: resource("UI/${texName}");`,
    `  -unity-slice-left: ${left};`,
    `  -unity-slice-top: ${top};`,
    `  -unity-slice-right: ${right};`,
    `  -unity-slice-bottom: ${bottom};`,
    `  -unity-slice-type: ${sliceType};`,
    `}`,
    ``,
    `/* 2. Unity UGUI TextureImporter Sprite.border (Vector4: Left, Bottom, Right, Top) */`,
    `// importer.spriteBorder = new UnityEngine.Vector4(${left}f, ${bottom}f, ${right}f, ${top}f);`,
    ``
  ].join('\n')
}

/**
 * 导出 Web / H5 游戏 HUD 通用 CSS `border-image` 九宫格样式片段。
 */
export function exportWebCssNineSliceSnippet(
  manifest: NineSliceManifest,
  options?: {
    imageFileName?: string
    stretchMode?: 'stretch' | 'tile'
  }
): string {
  const safeName =
    manifest.assetName
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'ui-panel'
  const fileName = options?.imageFileName?.trim() || `${safeName}.png`
  const repeatMode = options?.stretchMode === 'tile' ? 'repeat' : 'stretch'
  const { left, top, right, bottom } = manifest.borders

  return [
    `.${safeName} {`,
    `  box-sizing: border-box;`,
    `  border-style: solid;`,
    `  border-width: ${top}px ${right}px ${bottom}px ${left}px;`,
    `  border-image-source: url("./${fileName}");`,
    `  border-image-slice: ${top} ${right} ${bottom} ${left} fill;`,
    `  border-image-repeat: ${repeatMode};`,
    `}`,
    ``
  ].join('\n')
}
