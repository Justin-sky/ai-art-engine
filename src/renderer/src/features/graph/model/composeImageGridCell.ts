import {
  gridCellCropRect,
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
}): Promise<{ dataUrl: string; width: number; height: number; cellKey: string }> {
  const state = normalizeImageGridSplit(input.state)
  const parsed = parseCellKey(input.cellKey)
  if (!parsed) throw new Error('GRID_SPLIT_BAD_CELL')
  const rect = gridCellCropRect(state.rows, state.cols, parsed.row, parsed.col)
  const img = await loadImage(input.sourceDataUrl)
  const sw = img.naturalWidth || 1
  const sh = img.naturalHeight || 1
  const sx = Math.round(rect.cropX * sw)
  const sy = Math.round(rect.cropY * sh)
  const width = Math.max(1, Math.min(sw - sx, Math.round(rect.cropW * sw)))
  const height = Math.max(1, Math.min(sh - sy, Math.round(rect.cropH * sh)))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('GRID_SPLIT_CANVAS_UNAVAILABLE')
  ctx.drawImage(img, sx, sy, width, height, 0, 0, width, height)
  return {
    dataUrl: canvas.toDataURL('image/png'),
    width,
    height,
    cellKey: input.cellKey
  }
}
