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
  applyColorDistanceKey,
  averageRegionColor,
  extractAlphaBounds,
  type IconKeyColor
} from '@shared/gameAssets'

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('GRID_SPLIT_SOURCE_LOAD_FAILED'))
    img.src = src
  })
}

/** 采样格子四角（各 4×4 像素块）求背景主色 */
function sampleCornerBackgroundColor(
  data: Uint8ClampedArray,
  width: number,
  height: number
): IconKeyColor | null {
  const patch = Math.max(1, Math.min(4, Math.floor(Math.min(width, height) / 8) || 1))
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

/** 裁出单个宫格 PNG（支持黑/白/四角自动采样键控透明 + 边缘反混合去白边 + 脚底基线/中心防抖稳像）。 */
export async function composeImageGridCell(input: {
  sourceDataUrl: string
  state: ImageGridSplitState
  cellKey: string
  /**
   * 向内收缩像素，削掉 AI 序列图常见的格线 / 黑边。
   * `'auto'`：按格子尺寸估算（约 1.5%）。
   */
  edgeInset?: number | 'auto'
  /** 色度键：裁出宫格后把接近纯黑/纯白或四角采样色的像素转透明 */
  chromaKey?: { color: 'black' | 'white' | 'auto'; threshold?: number; feather?: number }
  /** 帧间防抖稳像：ground=脚底基线对齐 / center=主体质心居中 */
  stabilize?: 'off' | 'ground' | 'center'
}): Promise<{ dataUrl: string; width: number; height: number; cellKey: string }> {
  const state = normalizeImageGridSplit(input.state)
  const parsed = parseCellKey(input.cellKey)
  if (!parsed) throw new Error('GRID_SPLIT_BAD_CELL')
  const img = await loadImage(input.sourceDataUrl)
  const sw = img.naturalWidth || 1
  const sh = img.naturalHeight || 1
  const base = gridCellPixelRect(sw, sh, state.rows, state.cols, parsed.row, parsed.col)
  const edgeInsetPx =
    input.edgeInset === 'auto'
      ? autoGridCellEdgeInsetPx(base.width, base.height)
      : Math.max(0, Math.floor(Number(input.edgeInset) || 0))
  const { sx, sy, width, height } = edgeInsetPx
    ? gridCellPixelRect(sw, sh, state.rows, state.cols, parsed.row, parsed.col, {
        edgeInsetPx
      })
    : base

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('GRID_SPLIT_CANVAS_UNAVAILABLE')
  // 关闭平滑，避免裁边像素被插值成发灰/发糊的「假边」
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(img, sx, sy, width, height, 0, 0, width, height)
  const key = input.chromaKey
  if (key) {
    const imageData = ctx.getImageData(0, 0, width, height)
    if (key.color === 'auto') {
      const bg = sampleCornerBackgroundColor(imageData.data, width, height)
      if (bg) {
        applyColorDistanceKey(imageData.data, bg, {
          distance: key.threshold ?? 42,
          feather: key.feather ?? 34
        })
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
      const dstX = Math.round((width - bounds.width) / 2)
      const dstY =
        stabilize === 'ground'
          ? Math.max(0, Math.round(height * 0.94) - bounds.height)
          : Math.round((height - bounds.height) / 2)
      if (dstX !== bounds.x || dstY !== bounds.y) {
        const temp = document.createElement('canvas')
        temp.width = width
        temp.height = height
        const tempCtx = temp.getContext('2d')
        if (tempCtx) {
          tempCtx.putImageData(imageData, 0, 0)
          ctx.clearRect(0, 0, width, height)
          ctx.drawImage(
            temp,
            bounds.x,
            bounds.y,
            bounds.width,
            bounds.height,
            dstX,
            dstY,
            bounds.width,
            bounds.height
          )
        }
      }
    }
  }

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width,
    height,
    cellKey: input.cellKey
  }
}
