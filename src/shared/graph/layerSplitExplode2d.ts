import {
  isLayerSplitBase,
  isLayerSplitLayerDrawable,
  sortLayersForCompose,
  type ImageLayerSplitLayer,
  type ImageLayerSplitState
} from './imageLayerSplit'

export type LayerSplitExplode2dMode = 'tiled' | 'radial'

export interface LayerSplitExplode2dOptions {
  /** 平面排布子模式：tiled = 零重叠图块矩阵平铺（默认）；radial = 保持相对方位向外放射炸开 */
  mode?: LayerSplitExplode2dMode
  /** 图块间距档位（8..96，默认 24） */
  gap?: number
  /** 目标视口宽高比（用于平铺分行均衡，默认 1.45） */
  targetAspect?: number
  /** 是否为顶部图层标签预留垂直安全高度（默认 true） */
  reserveLabelHeight?: boolean
}

export interface LayerSplitExplode2dItem {
  id: string
  isBase: boolean
  /** 平面画板坐标系下的左上角 X */
  left: number
  /** 平面画板坐标系下的左上角 Y */
  top: number
  /** 平面画板坐标系下的图块展示宽度 */
  width: number
  /** 平面画板坐标系下的图块展示高度 */
  height: number
  /** 原始图层像素尺寸（供标签展示真实 W×H） */
  naturalWidth: number
  naturalHeight: number
  /** 原画布中心锚点（画板坐标系，供放射模式绘制引导虚线） */
  originCenterX: number
  originCenterY: number
  /** 炸开后图块中心锚点（画板坐标系） */
  explodedCenterX: number
  explodedCenterY: number
}

export interface LayerSplitExplode2dLayout {
  mode: LayerSplitExplode2dMode
  boardWidth: number
  boardHeight: number
  /** 放射模式下原画布参考框在画板中的位置 */
  originFrame: {
    left: number
    top: number
    width: number
    height: number
  }
  items: LayerSplitExplode2dItem[]
  byId: Record<string, LayerSplitExplode2dItem>
}

interface SizedEntry {
  layer: ImageLayerSplitLayer
  isBase: boolean
  w: number
  h: number
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/**
 * 计算拆分图层的 2D 爆炸平面排布（不修改原图层坐标，纯视图投影）：
 * - `tiled`：按绘制层级将底板与各独立图块无重叠平铺到二维矩阵货架上，自动均衡大图与微小角标的可读尺寸；
 * - `radial`：以原画布为中心将前景控件沿平面方位向外推开并消解重叠，保留空间邻近关系与原位引导锚点。
 */
export function computeLayerSplitExplode2dLayout(
  state: Pick<ImageLayerSplitState, 'canvasWidth' | 'canvasHeight' | 'layers' | 'groups'>,
  options: LayerSplitExplode2dOptions = {}
): LayerSplitExplode2dLayout {
  const cw = Math.max(1, Math.round(state.canvasWidth || 1))
  const ch = Math.max(1, Math.round(state.canvasHeight || 1))
  const mode: LayerSplitExplode2dMode = options.mode ?? 'tiled'
  const rawGap = clamp(Math.round(options.gap ?? 24), 4, 120)
  const targetAspect = clamp(options.targetAspect ?? 1.45, 0.6, 2.8)
  const drawable = sortLayersForCompose(state.layers).filter((layer) =>
    isLayerSplitLayerDrawable(state, layer)
  )

  if (drawable.length === 0) {
    return {
      mode,
      boardWidth: cw,
      boardHeight: ch,
      originFrame: { left: 0, top: 0, width: cw, height: ch },
      items: [],
      byId: {}
    }
  }

  return mode === 'radial'
    ? computeRadialLayout(cw, ch, drawable, state, rawGap, options.reserveLabelHeight !== false)
    : computeTiledLayout(
        cw,
        ch,
        drawable,
        rawGap,
        targetAspect,
        options.reserveLabelHeight !== false
      )
}

function computeTiledLayout(
  cw: number,
  ch: number,
  drawable: ImageLayerSplitLayer[],
  rawGap: number,
  targetAspect: number,
  reserveLabelHeight: boolean
): LayerSplitExplode2dLayout {
  const refUnit = Math.max(280, Math.round(Math.sqrt(cw * ch)))
  const gapPx = Math.max(12, Math.round((rawGap / 24) * refUnit * 0.045))
  const labelHeadPx = reserveLabelHeight ? Math.max(18, Math.round(refUnit * 0.042)) : 0
  const padPx = Math.max(16, Math.round(gapPx * 0.85))

  // 动态量程收敛：全幅底板缩至适中主卡尺寸，微小红点/文字适度放大并给足最小卡片宽度，避免标签互相挤压
  const maxBaseSide = Math.round(refUnit * 0.56)
  const maxLargeSide = Math.round(refUnit * 0.48)
  const minCardW = Math.max(56, Math.round(refUnit * 0.145))
  const minCardH = Math.max(40, Math.round(refUnit * 0.095))

  const sized: SizedEntry[] = drawable.map((layer) => {
    const base = isLayerSplitBase(layer)
    const lw = Math.max(1, base ? cw : Math.round(layer.width))
    const lh = Math.max(1, base ? ch : Math.round(layer.height))
    const maxLim = base ? maxBaseSide : lw * lh > cw * ch * 0.42 ? maxLargeSide : refUnit * 0.44
    let scale = 1
    const maxDim = Math.max(lw, lh)
    if (maxDim > maxLim) {
      scale = maxLim / maxDim
    } else if (maxDim < refUnit * 0.11) {
      scale = Math.min(2.4, (refUnit * 0.11) / maxDim)
    }
    const w = Math.max(minCardW, Math.round(lw * scale))
    const h = Math.max(minCardH, Math.round(lh * scale))
    return { layer, isBase: base, w, h }
  })

  let totalArea = 0
  let maxSingleW = 0
  for (const s of sized) {
    totalArea += (s.w + gapPx) * (s.h + labelHeadPx + gapPx)
    if (s.w > maxSingleW) maxSingleW = s.w
  }
  const idealRowW = Math.max(
    maxSingleW,
    Math.round(Math.sqrt(Math.max(1, totalArea) * targetAspect) * 1.06)
  )

  const rows: SizedEntry[][] = []
  let curRow: SizedEntry[] = []
  let curW = 0
  for (const entry of sized) {
    const nextW = curRow.length === 0 ? entry.w : curW + gapPx + entry.w
    if (curRow.length > 0 && nextW > idealRowW) {
      rows.push(curRow)
      curRow = [entry]
      curW = entry.w
    } else {
      curRow.push(entry)
      curW = nextW
    }
  }
  if (curRow.length > 0) rows.push(curRow)

  const rowWidths = rows.map(
    (r) => r.reduce((acc, item) => acc + item.w, 0) + Math.max(0, r.length - 1) * gapPx
  )
  const contentW = Math.max(1, ...rowWidths)
  const boardWidth = contentW + padPx * 2

  const items: LayerSplitExplode2dItem[] = []
  const byId: Record<string, LayerSplitExplode2dItem> = {}
  let cursorY = padPx + labelHeadPx

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri]!
    const rowH = row.reduce((m, item) => Math.max(m, item.h), 0)
    let cursorX = padPx
    for (const entry of row) {
      const top = cursorY + Math.round((rowH - entry.h) * 0.5)
      const left = cursorX
      const origCx = entry.isBase ? cw * 0.5 : entry.layer.left + entry.layer.width * 0.5
      const origCy = entry.isBase ? ch * 0.5 : entry.layer.top + entry.layer.height * 0.5
      const item: LayerSplitExplode2dItem = {
        id: entry.layer.id,
        isBase: entry.isBase,
        left,
        top,
        width: entry.w,
        height: entry.h,
        naturalWidth: entry.isBase ? cw : Math.max(1, Math.round(entry.layer.width)),
        naturalHeight: entry.isBase ? ch : Math.max(1, Math.round(entry.layer.height)),
        originCenterX: origCx,
        originCenterY: origCy,
        explodedCenterX: left + entry.w * 0.5,
        explodedCenterY: top + entry.h * 0.5
      }
      items.push(item)
      byId[item.id] = item
      cursorX += entry.w + gapPx
    }
    cursorY += rowH + (ri < rows.length - 1 ? gapPx + labelHeadPx : 0)
  }

  const boardHeight = Math.max(1, cursorY + padPx)
  return {
    mode: 'tiled',
    boardWidth,
    boardHeight,
    originFrame: { left: padPx, top: padPx, width: cw, height: ch },
    items,
    byId
  }
}

function computeRadialLayout(
  cw: number,
  ch: number,
  drawable: ImageLayerSplitLayer[],
  state: Pick<ImageLayerSplitState, 'layers' | 'groups'>,
  rawGap: number,
  reserveLabelHeight: boolean
): LayerSplitExplode2dLayout {
  const refUnit = Math.max(280, Math.round(Math.sqrt(cw * ch)))
  const gapPx = Math.max(10, Math.round((rawGap / 24) * refUnit * 0.04))
  const labelHeadPx = reserveLabelHeight ? Math.max(16, Math.round(refUnit * 0.038)) : 0
  const spread = 0.28 + (rawGap / 24) * 0.45

  const groupSourceById = new Map<string, ImageLayerSplitLayer>()
  for (const grp of state.groups) {
    if (!grp.sourceLayerId) continue
    const src = state.layers.find((l) => l.id === grp.sourceLayerId)
    if (src) groupSourceById.set(grp.id, src)
  }

  interface Body {
    layer: ImageLayerSplitLayer
    isBase: boolean
    cx: number
    cy: number
    w: number
    h: number
    origCx: number
    origCy: number
  }

  const centerCx = cw * 0.5
  const centerCy = ch * 0.5
  const nonBase = drawable.filter((l) => !isLayerSplitBase(l))
  const count = Math.max(1, nonBase.length)

  const bodies: Body[] = nonBase.map((layer, idx) => {
    const w = Math.max(1, Math.round(layer.width))
    const h = Math.max(1, Math.round(layer.height))
    const origCx = layer.left + w * 0.5
    const origCy = layer.top + h * 0.5
    let vx = origCx - centerCx
    let vy = origCy - centerCy

    // 子控件相对所属容器中心再叠加局部离心分量，使同面板上的嵌套控件自然散开
    const parentLayer = layer.groupId ? groupSourceById.get(layer.groupId) : undefined
    if (parentLayer && parentLayer.id !== layer.id) {
      const px = parentLayer.left + parentLayer.width * 0.5
      const py = parentLayer.top + parentLayer.height * 0.5
      vx += (origCx - px) * 0.85
      vy += (origCy - py) * 0.85
    }

    // 正中心重合元素按黄金角赋确定性初始方向，避免堆死在原点
    if (Math.hypot(vx, vy) < 6) {
      const angle = idx * 2.39996323
      const radius = Math.max(24, refUnit * 0.12 * ((idx + 1) / count))
      vx = Math.cos(angle) * radius
      vy = Math.sin(angle) * radius
    }

    const zRatio = count > 1 ? idx / (count - 1) : 0.5
    const layerBoost = 1 + zRatio * 0.35
    return {
      layer,
      isBase: false,
      cx: origCx + vx * spread * layerBoost,
      cy: origCy + vy * spread * layerBoost,
      w,
      h,
      origCx,
      origCy
    }
  })

  // 迭代式二维轴对齐包围盒（AABB）碰撞消解：确保所有前景图块及标签带互不遮挡
  const passes = 80
  for (let iter = 0; iter < passes; iter++) {
    let movedAny = false
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i]!
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j]!
        const reqX = (a.w + b.w) * 0.5 + gapPx
        const reqY = (a.h + b.h) * 0.5 + gapPx + labelHeadPx
        const dx = b.cx - a.cx
        const dy = b.cy - a.cy
        const overX = reqX - Math.abs(dx)
        const overY = reqY - Math.abs(dy)
        if (overX <= 0 || overY <= 0) continue
        movedAny = true
        if (overX < overY) {
          const sign = dx > 0 ? 1 : dx < 0 ? -1 : i % 2 === 0 ? 1 : -1
          const push = overX * 0.52
          a.cx -= sign * push
          b.cx += sign * push
        } else {
          const sign = dy > 0 ? 1 : dy < 0 ? -1 : i % 2 === 0 ? 1 : -1
          const push = overY * 0.52
          a.cy -= sign * push
          b.cy += sign * push
        }
      }
    }
    if (!movedAny) break
  }

  let minX = 0
  let minY = -labelHeadPx
  let maxX = cw
  let maxY = ch
  for (const b of bodies) {
    minX = Math.min(minX, b.cx - b.w * 0.5)
    minY = Math.min(minY, b.cy - b.h * 0.5 - labelHeadPx)
    maxX = Math.max(maxX, b.cx + b.w * 0.5)
    maxY = Math.max(maxY, b.cy + b.h * 0.5)
  }

  const padPx = Math.max(20, Math.round(gapPx * 0.9))
  const shiftX = padPx - minX
  const shiftY = padPx - minY
  const boardWidth = Math.max(1, Math.round(maxX - minX + padPx * 2))
  const boardHeight = Math.max(1, Math.round(maxY - minY + padPx * 2))
  const originFrame = {
    left: Math.round(shiftX),
    top: Math.round(shiftY),
    width: cw,
    height: ch
  }

  const items: LayerSplitExplode2dItem[] = []
  const byId: Record<string, LayerSplitExplode2dItem> = {}

  for (const layer of drawable) {
    if (isLayerSplitBase(layer)) {
      const baseItem: LayerSplitExplode2dItem = {
        id: layer.id,
        isBase: true,
        left: originFrame.left,
        top: originFrame.top,
        width: cw,
        height: ch,
        naturalWidth: cw,
        naturalHeight: ch,
        originCenterX: originFrame.left + cw * 0.5,
        originCenterY: originFrame.top + ch * 0.5,
        explodedCenterX: originFrame.left + cw * 0.5,
        explodedCenterY: originFrame.top + ch * 0.5
      }
      items.push(baseItem)
      byId[baseItem.id] = baseItem
      continue
    }
    const b = bodies.find((entry) => entry.layer.id === layer.id)
    if (!b) continue
    const left = Math.round(b.cx - b.w * 0.5 + shiftX)
    const top = Math.round(b.cy - b.h * 0.5 + shiftY)
    const item: LayerSplitExplode2dItem = {
      id: layer.id,
      isBase: false,
      left,
      top,
      width: b.w,
      height: b.h,
      naturalWidth: b.w,
      naturalHeight: b.h,
      originCenterX: Math.round(b.origCx + shiftX),
      originCenterY: Math.round(b.origCy + shiftY),
      explodedCenterX: left + b.w * 0.5,
      explodedCenterY: top + b.h * 0.5
    }
    items.push(item)
    byId[item.id] = item
  }

  return {
    mode: 'radial',
    boardWidth,
    boardHeight,
    originFrame,
    items,
    byId
  }
}
