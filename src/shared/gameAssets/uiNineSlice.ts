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
