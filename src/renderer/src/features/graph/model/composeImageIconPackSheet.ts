import {
  autoGridCellEdgeInsetPx,
  gridCellPixelRect,
  normalizeIconPackState,
  type IconPackState
} from '@shared/graph'
import {
  applyColorDistanceKey,
  averageRegionColor,
  extractAlphaBounds,
  ICON_KEY_BLACK,
  ICON_KEY_WHITE,
  type IconKeyColor
} from '@shared/gameAssets'

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('ICON_PACK_SOURCE_LOAD_FAILED'))
    img.src = src
  })
}

/**
 * 图标包整版合成：整版图标表 → 名单顺序逐格裁切 → 采样色键控透明 →
 * 主体修剪 → 统一画布中心对齐。本地像素处理，不调用任何模型。
 *
 * 背景采样策略（`keyColor:'auto'`）：
 * 1. 名单未占满时有纯色空白格 → 采样空白格中心区域颜色（最贴近提示词约定）；
 * 2. 名单占满整表时 → 采样整版图外框色带平均色；
 * 3. `black` / `white` 快捷键控，`none` 不抠。
 */
export async function composeImageIconPackSheet(input: {
  sourceDataUrl: string
  state: IconPackState
  /** 名单顺序即整版表逐行格位顺序；不足 rows×cols 的尾部格子视为空白格 */
  names: string[]
  /**
   * 单枚回炉覆盖：cellKey → 精修后的单张方形卡片图 dataURL。
   * 覆盖格不再从整版裁切，改用精修图独立走同一条键控透明 / 主体修剪 / 统一对齐出口；
   * 其余格照旧从整版裁切。背景采样仍以整版为准，保证整包底色一致。
   */
  cellOverrides?: Record<string, string>
  signal?: AbortSignal | null
}): Promise<{
  items: Array<{ cellKey: string; name: string; dataUrl: string; width: number; height: number }>
  canvasSize: number
  background: IconKeyColor | null
}> {
  const state = normalizeIconPackState(input.state)
  const names = (input.names ?? []).map((raw) => String(raw ?? '').trim()).filter(Boolean)
  const rows = Math.max(1, Math.floor(state.rows))
  const cols = Math.max(1, Math.floor(state.cols))
  const capacity = rows * cols
  if (names.length > capacity) {
    throw new Error(`ICON_PACK_TOO_MANY_NAMES ${names.length}>${capacity}`)
  }
  if (!names.length) throw new Error('ICON_PACK_EMPTY_NAMES')

  const img = await loadImage(input.sourceDataUrl)
  const sw = img.naturalWidth || 1
  const sh = img.naturalHeight || 1

  const probe = document.createElement('canvas')
  probe.width = sw
  probe.height = sh
  const probeCtx = probe.getContext('2d', { willReadFrequently: true })
  if (!probeCtx) throw new Error('ICON_PACK_CANVAS_UNAVAILABLE')
  probeCtx.drawImage(img, 0, 0)
  const wholeRgba = probeCtx.getImageData(0, 0, sw, sh)

  // —— 背景色确定 ——
  let background: IconKeyColor | null = null
  if (state.keyColor === 'black') background = { ...ICON_KEY_BLACK }
  else if (state.keyColor === 'white') background = { ...ICON_KEY_WHITE }
  else if (state.keyColor === 'auto') {
    const sampleCellRect = (r1: number, c1: number) => {
      const cell = gridCellPixelRect(sw, sh, rows, cols, r1, c1)
      const insetX = Math.max(1, Math.floor(cell.width * 0.2))
      const insetY = Math.max(1, Math.floor(cell.height * 0.2))
      return {
        x: cell.sx + insetX,
        y: cell.sy + insetY,
        width: Math.max(1, cell.width - insetX * 2),
        height: Math.max(1, cell.height - insetY * 2)
      }
    }
    for (let index = names.length; index < capacity && !background; index++) {
      const r1 = Math.floor(index / cols) + 1
      const c1 = (index % cols) + 1
      background = averageRegionColor(wholeRgba.data, sw, sampleCellRect(r1, c1))
    }
    if (!background) {
      const frame = Math.max(2, Math.floor(Math.min(sw, sh) * 0.015))
      background =
        averageRegionColor(wholeRgba.data, sw, { x: 0, y: 0, width: sw, height: frame }) ??
        averageRegionColor(wholeRgba.data, sw, { x: 0, y: sh - frame, width: sw, height: frame }) ??
        averageRegionColor(wholeRgba.data, sw, {
          x: 0,
          y: frame,
          width: frame,
          height: sh - frame * 2
        }) ??
        averageRegionColor(wholeRgba.data, sw, {
          x: sw - frame,
          y: frame,
          width: frame,
          height: sh - frame * 2
        })
    }
  }
  const keyEnabled = background !== null

  // —— 逐格键控 + 主体修剪 ——
  const trimmed: Array<{
    cellKey: string
    name: string
    canvas: HTMLCanvasElement
    width: number
    height: number
  }> = []

  for (let index = 0; index < names.length; index++) {
    if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const name = names[index]!
    const r1 = Math.floor(index / cols) + 1
    const c1 = (index % cols) + 1
    const cellKey = `${r1}-${c1}`

    // —— 格图源：默认整版裁切；存在回炉覆盖时改用该枚精修单图 ——
    let drawImg: HTMLImageElement = img
    let rect: { sx: number; sy: number; width: number; height: number }
    const overrideUrl = input.cellOverrides?.[cellKey]
    if (overrideUrl) {
      const overrideImg = await loadImage(overrideUrl)
      const ow = overrideImg.naturalWidth || 1
      const oh = overrideImg.naturalHeight || 1
      const overrideInsetPx =
        state.edgeInset === 'auto'
          ? autoGridCellEdgeInsetPx(ow, oh)
          : Math.max(0, Math.floor(Number(state.edgeInset) || 0))
      const overrideBase = { sx: 0, sy: 0, width: ow, height: oh }
      rect = overrideInsetPx
        ? gridCellPixelRect(ow, oh, 1, 1, 1, 1, { edgeInsetPx: overrideInsetPx })
        : overrideBase
      drawImg = overrideImg
    } else {
      const base = gridCellPixelRect(sw, sh, rows, cols, r1, c1)
      const insetPx =
        state.edgeInset === 'auto'
          ? autoGridCellEdgeInsetPx(base.width, base.height)
          : Math.max(0, Math.floor(Number(state.edgeInset) || 0))
      rect = insetPx
        ? gridCellPixelRect(sw, sh, rows, cols, r1, c1, { edgeInsetPx: insetPx })
        : base
    }

    const cellCanvas = document.createElement('canvas')
    cellCanvas.width = Math.max(1, rect.width)
    cellCanvas.height = Math.max(1, rect.height)
    const cellCtx = cellCanvas.getContext('2d')
    if (!cellCtx) throw new Error('ICON_PACK_CANVAS_UNAVAILABLE')
    cellCtx.imageSmoothingEnabled = false
    cellCtx.drawImage(
      drawImg,
      rect.sx,
      rect.sy,
      rect.width,
      rect.height,
      0,
      0,
      rect.width,
      rect.height
    )

    if (keyEnabled) {
      const data = cellCtx.getImageData(0, 0, rect.width, rect.height)
      applyColorDistanceKey(data.data, background!, {
        distance: state.distance,
        feather: state.feather,
        soft: true
      })
      cellCtx.putImageData(data, 0, 0)
    }

    const data = cellCtx.getImageData(0, 0, rect.width, rect.height)
    const subject = extractAlphaBounds(data.data, rect.width, rect.height, { alphaMin: 8 }) ?? {
      x: 0,
      y: 0,
      width: rect.width,
      height: rect.height
    }

    const trimCanvas = document.createElement('canvas')
    trimCanvas.width = Math.max(1, Math.round(subject.width))
    trimCanvas.height = Math.max(1, Math.round(subject.height))
    const trimCtx = trimCanvas.getContext('2d')
    if (!trimCtx) throw new Error('ICON_PACK_CANVAS_UNAVAILABLE')
    trimCtx.clearRect(0, 0, trimCanvas.width, trimCanvas.height)
    trimCtx.drawImage(
      cellCanvas,
      subject.x,
      subject.y,
      subject.width,
      subject.height,
      0,
      0,
      trimCanvas.width,
      trimCanvas.height
    )
    trimmed.push({
      cellKey: `${r1}-${c1}`,
      name,
      canvas: trimCanvas,
      width: trimCanvas.width,
      height: trimCanvas.height
    })
  }

  if (!trimmed.length) throw new Error('ICON_PACK_EMPTY_NAMES')

  // —— 统一画布（方形，锚点中心） ——
  const autoMax = Math.max(1, ...trimmed.map((t) => Math.max(t.width, t.height)))
  const target =
    state.canvasSize > 0
      ? Math.max(4, state.canvasSize)
      : Math.max(4, Math.ceil((autoMax * 1.04) / 2) * 2)
  const fitScale = autoMax > target ? (target * 0.96) / autoMax : 1

  const items: Array<{
    cellKey: string
    name: string
    dataUrl: string
    width: number
    height: number
  }> = []
  for (const entry of trimmed) {
    if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const out = document.createElement('canvas')
    out.width = target
    out.height = target
    const octx = out.getContext('2d')
    if (!octx) throw new Error('ICON_PACK_CANVAS_UNAVAILABLE')
    octx.clearRect(0, 0, target, target)
    const dw = Math.max(1, Math.round(entry.width * fitScale))
    const dh = Math.max(1, Math.round(entry.height * fitScale))
    octx.imageSmoothingEnabled = fitScale < 1
    octx.drawImage(
      entry.canvas,
      Math.floor((target - dw) / 2),
      Math.floor((target - dh) / 2),
      dw,
      dh
    )
    items.push({
      cellKey: entry.cellKey,
      name: entry.name,
      dataUrl: out.toDataURL('image/png'),
      width: target,
      height: target
    })
  }

  return { items, canvasSize: target, background }
}
