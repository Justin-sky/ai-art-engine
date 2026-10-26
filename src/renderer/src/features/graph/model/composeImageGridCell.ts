import {
  applyChromaKey,
  autoGridCellEdgeInsetPx,
  gridCellPixelRect,
  normalizeImageGridSplit,
  parseCellKey,
  type ImageGridSplitState
} from '@shared/graph'
import {
  applyAssetQcFringeFix,
  applySpriteCellAutoKey,
  applySpriteGroundShadow,
  applySpriteLoopClosure,
  applySpriteMotionTrail,
  applySpriteOuterOutline,
  applySpritePaletteLock,
  applySpritePixelSnap,
  computeStabilizedCellPlacement,
  extractAlphaBounds,
  extractSpriteCorePivotX,
  extractSpritePalette,
  hasNativeTransparentPixels,
  type RgbTuple,
  type SpriteMotionTrailColor,
  type SpriteOutlineColor
} from '@shared/gameAssets'

let lastSheetCache: {
  key: string
  img: HTMLImageElement
  referenceHeightPx: number | null
  cellRgbaMap: Map<string, Uint8ClampedArray>
  paletteMap: Map<number, RgbTuple[]>
} | null = null

function loadImage(src: string): Promise<HTMLImageElement> {
  if (lastSheetCache && lastSheetCache.img.src === src && lastSheetCache.img.complete) {
    return Promise.resolve(lastSheetCache.img)
  }
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('GRID_SPLIT_SOURCE_LOAD_FAILED'))
    img.src = src
  })
}

/**
 * 计算整张 rows×cols 序列图各格角色的中位高度（用于跨格高度归一化，消除 AI 多格体型忽大忽小）。
 * 同一张序列图切多格时复用缓存，避免重复解码与重复扫描。
 */
function resolveSheetReferenceHeight(
  sourceDataUrl: string,
  img: HTMLImageElement,
  rows: number,
  cols: number,
  edgeInset: number | 'auto' | undefined,
  chromaKey?: { color: 'black' | 'white' | 'auto'; threshold?: number; feather?: number }
): number | null {
  if (rows * cols <= 1) return null
  const cacheKey = `${sourceDataUrl.slice(0, 96)}:${sourceDataUrl.length}:${rows}x${cols}:${edgeInset ?? '0'}:${chromaKey?.color ?? ''}:${chromaKey?.threshold ?? ''}`
  if (lastSheetCache && lastSheetCache.key === cacheKey) {
    return lastSheetCache.referenceHeightPx
  }

  const sw = img.naturalWidth || 1
  const sh = img.naturalHeight || 1
  const heights: number[] = []
  const probeCanvas = document.createElement('canvas')
  const probeCtx = probeCanvas.getContext('2d', { willReadFrequently: true })
  if (!probeCtx) return null
  probeCtx.imageSmoothingEnabled = false

  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) {
      const base = gridCellPixelRect(sw, sh, rows, cols, r, c)
      const insetPx =
        edgeInset === 'auto'
          ? autoGridCellEdgeInsetPx(base.width, base.height)
          : Math.max(0, Math.floor(Number(edgeInset) || 0))
      const rect = insetPx
        ? gridCellPixelRect(sw, sh, rows, cols, r, c, { edgeInsetPx: insetPx })
        : base
      if (rect.width <= 4 || rect.height <= 4) continue
      probeCanvas.width = rect.width
      probeCanvas.height = rect.height
      probeCtx.clearRect(0, 0, rect.width, rect.height)
      probeCtx.drawImage(
        img,
        rect.sx,
        rect.sy,
        rect.width,
        rect.height,
        0,
        0,
        rect.width,
        rect.height
      )
      const imgData = probeCtx.getImageData(0, 0, rect.width, rect.height)
      if (chromaKey && !hasNativeTransparentPixels(imgData.data, rect.width, rect.height)) {
        if (chromaKey.color === 'auto') {
          applySpriteCellAutoKey(imgData.data, rect.width, rect.height, {
            distance: chromaKey.threshold ?? 42,
            feather: chromaKey.feather ?? 34
          })
        } else {
          applyChromaKey(imgData.data, chromaKey.color, {
            threshold: chromaKey.threshold,
            feather: chromaKey.feather
          })
        }
      }
      const b = extractAlphaBounds(imgData.data, rect.width, rect.height, { alphaMin: 12 })
      if (b && b.height >= rect.height * 0.18 && b.height < rect.height) {
        heights.push(b.height)
      }
    }
  }

  let referenceHeightPx: number | null = null
  if (heights.length >= 2) {
    heights.sort((a, b) => a - b)
    referenceHeightPx = heights[Math.floor(heights.length / 2)]!
  }
  lastSheetCache = {
    key: cacheKey,
    img,
    referenceHeightPx,
    cellRgbaMap: new Map(),
    paletteMap: new Map()
  }
  return referenceHeightPx
}

/**
 * 提取单格经过抠底、去白边与躯干稳像后的干净 RGBA 缓冲（同一张序列图切多格时缓存复用，供调色板锁死、残影拖尾与首尾循环闭合共享）。
 */
function extractCleanCellRgba(input: {
  sourceDataUrl: string
  img: HTMLImageElement
  rows: number
  cols: number
  cellKey: string
  edgeInset?: number | 'auto'
  chromaKey?: { color: 'black' | 'white' | 'auto'; threshold?: number; feather?: number }
  stabilize?: 'off' | 'ground' | 'center'
  cellOffset?: { dx?: number; dy?: number; flipX?: boolean }
}): { rgba: Uint8ClampedArray; width: number; height: number } {
  const parsed = parseCellKey(input.cellKey)
  if (!parsed) throw new Error('GRID_SPLIT_BAD_CELL')

  const referenceHeightPx =
    input.stabilize === 'ground'
      ? resolveSheetReferenceHeight(
          input.sourceDataUrl,
          input.img,
          input.rows,
          input.cols,
          input.edgeInset,
          input.chromaKey
        )
      : null

  const cacheKey = `${input.sourceDataUrl.slice(0, 96)}:${input.sourceDataUrl.length}:${input.rows}x${input.cols}:${input.edgeInset ?? '0'}:${input.chromaKey?.color ?? ''}:${input.chromaKey?.threshold ?? ''}`
  if (!lastSheetCache || lastSheetCache.key !== cacheKey) {
    lastSheetCache = {
      key: cacheKey,
      img: input.img,
      referenceHeightPx,
      cellRgbaMap: new Map(),
      paletteMap: new Map()
    }
  }

  const offsetDx = Math.round(Number(input.cellOffset?.dx) || 0)
  const offsetDy = Math.round(Number(input.cellOffset?.dy) || 0)
  const flipX = input.cellOffset?.flipX === true
  const cellSubKey = `${input.cellKey}:${input.stabilize ?? 'off'}:${offsetDx},${offsetDy},${flipX ? 1 : 0}`

  const sw = input.img.naturalWidth || 1
  const sh = input.img.naturalHeight || 1
  const base = gridCellPixelRect(sw, sh, input.rows, input.cols, parsed.row, parsed.col)
  const edgeInsetPx =
    input.edgeInset === 'auto'
      ? autoGridCellEdgeInsetPx(base.width, base.height)
      : Math.max(0, Math.floor(Number(input.edgeInset) || 0))
  const { sx, sy, width, height } = edgeInsetPx
    ? gridCellPixelRect(sw, sh, input.rows, input.cols, parsed.row, parsed.col, {
        edgeInsetPx
      })
    : base

  const cached = lastSheetCache.cellRgbaMap.get(cellSubKey)
  if (cached && cached.length === width * height * 4) {
    return { rgba: new Uint8ClampedArray(cached), width, height }
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('GRID_SPLIT_CANVAS_UNAVAILABLE')
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(input.img, sx, sy, width, height, 0, 0, width, height)

  const key = input.chromaKey
  if (key) {
    const imageData = ctx.getImageData(0, 0, width, height)
    if (!hasNativeTransparentPixels(imageData.data, width, height)) {
      if (key.color === 'auto') {
        const res = applySpriteCellAutoKey(imageData.data, width, height, {
          distance: key.threshold ?? 42,
          feather: key.feather ?? 34
        })
        if (res.keyedPixels > 0) {
          applyAssetQcFringeFix({ data: imageData.data, width, height })
          ctx.putImageData(imageData, 0, 0)
        }
      } else {
        applyChromaKey(imageData.data, key.color, {
          threshold: key.threshold,
          feather: key.feather
        })
        applyAssetQcFringeFix({ data: imageData.data, width, height })
        ctx.putImageData(imageData, 0, 0)
      }
    }
  }

  const stabilize = input.stabilize
  if (stabilize === 'ground' || stabilize === 'center') {
    const imageData = ctx.getImageData(0, 0, width, height)
    const bounds = extractAlphaBounds(imageData.data, width, height, { alphaMin: 12 })
    if (
      bounds &&
      bounds.width > 0 &&
      bounds.height > 0 &&
      (bounds.width < width || bounds.height < height)
    ) {
      const pivotX = extractSpriteCorePivotX(imageData.data, width, height, bounds, {
        alphaMin: 12
      })
      const placement = computeStabilizedCellPlacement({
        cellWidth: width,
        cellHeight: height,
        bounds,
        pivotX,
        mode: stabilize,
        referenceHeightPx
      })
      if (
        placement.dstX !== bounds.x ||
        placement.dstY !== bounds.y ||
        placement.dstW !== bounds.width ||
        placement.dstH !== bounds.height
      ) {
        const temp = document.createElement('canvas')
        temp.width = width
        temp.height = height
        const tempCtx = temp.getContext('2d')
        if (tempCtx) {
          tempCtx.putImageData(imageData, 0, 0)
          ctx.clearRect(0, 0, width, height)
          ctx.imageSmoothingEnabled = placement.scale !== 1
          ctx.drawImage(
            temp,
            bounds.x,
            bounds.y,
            bounds.width,
            bounds.height,
            placement.dstX,
            placement.dstY,
            placement.dstW,
            placement.dstH
          )
        }
      }
    }
  }

  if (offsetDx !== 0 || offsetDy !== 0 || flipX) {
    const temp = document.createElement('canvas')
    temp.width = width
    temp.height = height
    const tempCtx = temp.getContext('2d')
    if (tempCtx) {
      tempCtx.drawImage(canvas, 0, 0)
      ctx.clearRect(0, 0, width, height)
      ctx.save()
      ctx.imageSmoothingEnabled = false
      if (flipX) {
        ctx.translate(width + offsetDx, offsetDy)
        ctx.scale(-1, 1)
        ctx.drawImage(temp, 0, 0)
      } else {
        ctx.drawImage(temp, offsetDx, offsetDy)
      }
      ctx.restore()
    }
  }

  const finalData = ctx.getImageData(0, 0, width, height).data
  lastSheetCache.cellRgbaMap.set(cellSubKey, new Uint8ClampedArray(finalData))
  return { rgba: new Uint8ClampedArray(finalData), width, height }
}

/** 裁出单个宫格 PNG（支持黑/白/四周聚簇泛洪自动采样键控透明 + 封闭内洞清除 + 边缘反混合去白边 + 躯干主轴/跨格身高防抖稳像 + 调色板锁死 + 残影拖尾 + 首尾循环平滑）。 */
export async function composeImageGridCell(input: {
  sourceDataUrl: string
  state: ImageGridSplitState
  cellKey: string
  /**
   * 向内收缩像素，削掉 AI 序列图常见的格线 / 黑边。
   * `'auto'`：按格子尺寸估算（约 1.5%）。
   */
  edgeInset?: number | 'auto'
  /** 色度键：裁出宫格后把接近纯黑/纯白或四周采样色的像素转透明 */
  chromaKey?: { color: 'black' | 'white' | 'auto'; threshold?: number; feather?: number }
  /** 帧间防抖稳像：ground=脚底基线对齐 / center=主体质心居中 */
  stabilize?: 'off' | 'ground' | 'center'
  /** 单帧像素级偏移微调与水平翻转 */
  cellOffset?: { dx?: number; dy?: number; flipX?: boolean }
  /** 真像素网格对齐粒度（0=关闭, 2/3/4/6 px） */
  pixelSnap?: number
  /** 精灵 1px 外描边色 */
  outlineColor?: SpriteOutlineColor
  /** 脚底接触椭圆阴影 */
  groundShadow?: boolean
  /** 跨帧调色板锁死与限色量化（0=关闭, 16/32/64=像素画定色, 128=跨帧主色防闪烁锁死） */
  paletteLock?: 0 | 16 | 32 | 64 | 128
  /** 动作残影/刀光幻影拖尾（'' | 'cyan' | 'gold' | 'purple' | 'crimson' | 'echo'） */
  motionTrail?: SpriteMotionTrailColor
  /** 上一有效帧的 cellKey（用于合成动作残影拖尾） */
  prevCellKey?: string
  /** 首尾循环无缝平滑闭合开关（仅对循环尾帧生效） */
  loopBlend?: boolean
  /** 当前格是否为循环尾帧 */
  isLastLoopCell?: boolean
}): Promise<{ dataUrl: string; width: number; height: number; cellKey: string }> {
  const fallbackState = normalizeImageGridSplit(input.state)
  const rawRows = Math.floor(Number(input.state?.rows))
  const rawCols = Math.floor(Number(input.state?.cols))
  const state = {
    rows: Number.isFinite(rawRows) && rawRows >= 1 ? rawRows : fallbackState.rows,
    cols: Number.isFinite(rawCols) && rawCols >= 1 ? rawCols : fallbackState.cols
  }
  const parsed = parseCellKey(input.cellKey)
  if (!parsed) throw new Error('GRID_SPLIT_BAD_CELL')
  const img = await loadImage(input.sourceDataUrl)

  const { rgba, width, height } = extractCleanCellRgba({
    sourceDataUrl: input.sourceDataUrl,
    img,
    rows: state.rows,
    cols: state.cols,
    cellKey: input.cellKey,
    edgeInset: input.edgeInset,
    chromaKey: input.chromaKey,
    stabilize: input.stabilize,
    cellOffset: input.cellOffset
  })

  // 1. 首尾循环无缝闭合补偿（对循环尾帧向首帧 1-1 做微幅质心与核心区收敛）
  const isLastCell =
    input.isLastLoopCell === true ||
    (input.isLastLoopCell === undefined && parsed.row === state.rows && parsed.col === state.cols)
  if (input.loopBlend === true && isLastCell && input.cellKey !== '1-1') {
    const firstCell = extractCleanCellRgba({
      sourceDataUrl: input.sourceDataUrl,
      img,
      rows: state.rows,
      cols: state.cols,
      cellKey: '1-1',
      edgeInset: input.edgeInset,
      chromaKey: input.chromaKey,
      stabilize: input.stabilize
    })
    if (firstCell.width === width && firstCell.height === height) {
      applySpriteLoopClosure(rgba, firstCell.rgba, width, height, 0.3)
    }
  }

  // 2. 跨帧首帧调色板锁死与 16/32/64 色索引量化
  const paletteLock = Math.floor(Number(input.paletteLock) || 0)
  if (paletteLock > 0 && lastSheetCache) {
    let palette = lastSheetCache.paletteMap.get(paletteLock)
    if (!palette) {
      const refCell =
        input.cellKey === '1-1'
          ? { rgba, width, height }
          : extractCleanCellRgba({
              sourceDataUrl: input.sourceDataUrl,
              img,
              rows: state.rows,
              cols: state.cols,
              cellKey: '1-1',
              edgeInset: input.edgeInset,
              chromaKey: input.chromaKey,
              stabilize: input.stabilize
            })
      palette = extractSpritePalette(refCell.rgba, refCell.width, refCell.height, paletteLock)
      lastSheetCache.paletteMap.set(paletteLock, palette)
    }
    if (palette.length > 0) {
      applySpritePaletteLock(rgba, width, height, palette, paletteLock === 128 ? 0.82 : 1)
    }
  }

  // 3. PixelOver 级真像素网格重采样 & 1px 外描边
  const pixelSnap = Math.floor(Number(input.pixelSnap) || 0)
  const outlineColor = input.outlineColor || ''
  if (pixelSnap > 1) {
    applySpritePixelSnap(rgba, width, height, pixelSnap)
  }
  if (outlineColor) {
    applySpriteOuterOutline(rgba, width, height, { color: outlineColor, thickness: 1 })
  }

  // 4. 动作残影 / 刀光幻影拖尾（将上一有效帧叠加在当前帧底层）
  const motionTrail = input.motionTrail || ''
  if (motionTrail) {
    let prevKey = input.prevCellKey
    if (!prevKey) {
      if (parsed.col > 1) prevKey = `${parsed.row}-${parsed.col - 1}`
      else if (parsed.row > 1) prevKey = `${parsed.row - 1}-${state.cols}`
    }
    if (prevKey && prevKey !== input.cellKey) {
      const prevCell = extractCleanCellRgba({
        sourceDataUrl: input.sourceDataUrl,
        img,
        rows: state.rows,
        cols: state.cols,
        cellKey: prevKey,
        edgeInset: input.edgeInset,
        chromaKey: input.chromaKey,
        stabilize: input.stabilize
      })
      if (prevCell.width === width && prevCell.height === height) {
        applySpriteMotionTrail(rgba, prevCell.rgba, width, height, { style: motionTrail })
      }
    }
  }

  // 5. 脚底接触椭圆阴影
  if (input.groundShadow === true) {
    const postBounds = extractAlphaBounds(rgba, width, height, { alphaMin: 20 })
    applySpriteGroundShadow(rgba, width, height, postBounds)
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('GRID_SPLIT_CANVAS_UNAVAILABLE')
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width,
    height,
    cellKey: input.cellKey
  }
}
