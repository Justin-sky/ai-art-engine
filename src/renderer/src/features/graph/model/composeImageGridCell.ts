import {
  autoGridCellEdgeInsetPx,
  gridCellPixelRect,
  normalizeImageGridSplit,
  parseCellKey,
  type ImageGridSplitState
} from '@shared/graph'

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('GRID_SPLIT_SOURCE_LOAD_FAILED'))
    img.src = src
  })
}

/** 裁出单个宫格 PNG。 */
export async function composeImageGridCell(input: {
  sourceDataUrl: string
  state: ImageGridSplitState
  cellKey: string
  /**
   * 向内收缩像素，削掉 AI 序列图常见的格线 / 黑边。
   * `'auto'`：按格子尺寸估算（约 1.5%）。
   */
  edgeInset?: number | 'auto'
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
  return {
    dataUrl: canvas.toDataURL('image/png'),
    width,
    height,
    cellKey: input.cellKey
  }
}
