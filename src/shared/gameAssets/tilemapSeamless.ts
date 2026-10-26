/**
 * 2D 瓦片地图（Tilemap）无缝拼接与 Auto-Tile 图集清单纯函数层。
 *
 * 面向 RPG / 平台跳跃 / 肉鸽 / 模拟经营 / SLG 地表纹理：
 * 1. `analyzeSeamlessTile`：检测图像上下、左右边界与四角像素色差，评估无缝度（0~100 分）；
 * 2. `applySeamlessTileBlend`：一维可分离正弦平滑对偶混合（C0/C1 连续），中心区域 100% 保留原图细节，
 *    边缘过渡带平滑收敛到对侧均值，保证平铺时左右/上下接缝色差为 0；
 * 3. `buildAutoTileAtlasManifest`：生成 Godot TileSet / Unity RuleTile / Tiled 通用 Auto-Tile 掩码映射清单
 *    （支持 grid3x3 基础九宫地形、wang16 四向 16 格、blob47 八向 47 格标准 Bitmask）。
 */

export interface SeamlessTileAnalysis {
  width: number
  height: number
  /** 左右边界（x=0 与 x=width-1）平均通道差（0~255） */
  horizontalEdgeDelta: number
  /** 上下边界（y=0 与 y=height-1）平均通道差（0~255） */
  verticalEdgeDelta: number
  /** 四角像素与四角均值之间的最大通道差（0~255） */
  cornerDelta: number
  /** 综合无缝得分（0~100，100 表示完全无缝） */
  score: number
  /** 是否在给定阈值下判定为可无缝平铺 */
  isSeamless: boolean
}

export interface SeamlessTileBlendOptions {
  /** 边缘过渡带占宽高比例（0.02~0.45，默认 0.18） */
  blendRatio?: number
  /** 是否在水平方向（左右）做无缝闭合（默认 true） */
  wrapX?: boolean
  /** 是否在垂直方向（上下）做无缝闭合（默认 true） */
  wrapY?: boolean
}

export type AutoTileLayoutKind = 'grid3x3' | 'wang16' | 'blob47'

export interface AutoTileNeighbors {
  n: boolean
  ne: boolean
  e: boolean
  se: boolean
  s: boolean
  sw: boolean
  w: boolean
  nw: boolean
}

export interface AutoTileCellEntry {
  index: number
  col: number
  row: number
  x: number
  y: number
  width: number
  height: number
  /** 8-bit 邻接掩码（N=1, NE=2, E=4, SE=8, S=16, SW=32, W=64, NW=128）或 4-bit 基数掩码 */
  bitmask: number
  /** 4 向简化掩码（N=1, E=2, S=4, W=8） */
  cardinalMask: number
  neighbors: AutoTileNeighbors
  role: string
}

export interface AutoTileAtlasManifest {
  schemaVersion: 1
  terrainName: string
  layout: AutoTileLayoutKind
  tileWidth: number
  tileHeight: number
  columns: number
  rows: number
  atlasWidth: number
  atlasHeight: number
  cells: AutoTileCellEntry[]
  engineHints: {
    godot: {
      terrainSetMode: 'match_corners_and_sides' | 'match_sides'
      tileSize: [number, number]
    }
    unity: {
      ruleTileType: 'HexagonalRuleTile' | 'RuleTile'
      pixelsPerUnit: number
    }
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function clampByte(n: number): number {
  return n < 0 ? 0 : n > 255 ? 255 : Math.round(n)
}

/**
 * 评估 RGBA 纹理的无缝平铺度。
 * threshold 默认为 6（平均单通道色差 <= 6 视为无缝）。
 */
export function analyzeSeamlessTile(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 6
): SeamlessTileAnalysis {
  if (width <= 1 || height <= 1 || rgba.length < width * height * 4) {
    return {
      width: Math.max(0, width),
      height: Math.max(0, height),
      horizontalEdgeDelta: 0,
      verticalEdgeDelta: 0,
      cornerDelta: 0,
      score: 100,
      isSeamless: true
    }
  }

  let hDiffSum = 0
  for (let y = 0; y < height; y++) {
    const leftIdx = (y * width + 0) * 4
    const rightIdx = (y * width + (width - 1)) * 4
    hDiffSum +=
      (Math.abs(rgba[leftIdx]! - rgba[rightIdx]!) +
        Math.abs(rgba[leftIdx + 1]! - rgba[rightIdx + 1]!) +
        Math.abs(rgba[leftIdx + 2]! - rgba[rightIdx + 2]!) +
        Math.abs(rgba[leftIdx + 3]! - rgba[rightIdx + 3]!)) /
      4
  }
  const horizontalEdgeDelta = Number((hDiffSum / height).toFixed(2))

  let vDiffSum = 0
  for (let x = 0; x < width; x++) {
    const topIdx = (0 * width + x) * 4
    const bottomIdx = ((height - 1) * width + x) * 4
    vDiffSum +=
      (Math.abs(rgba[topIdx]! - rgba[bottomIdx]!) +
        Math.abs(rgba[topIdx + 1]! - rgba[bottomIdx + 1]!) +
        Math.abs(rgba[topIdx + 2]! - rgba[bottomIdx + 2]!) +
        Math.abs(rgba[topIdx + 3]! - rgba[bottomIdx + 3]!)) /
      4
  }
  const verticalEdgeDelta = Number((vDiffSum / width).toFixed(2))

  const corners = [
    0,
    (width - 1) * 4,
    (height - 1) * width * 4,
    ((height - 1) * width + (width - 1)) * 4
  ]
  const avgCorner = [0, 0, 0, 0]
  for (const idx of corners) {
    avgCorner[0]! += rgba[idx]! / 4
    avgCorner[1]! += rgba[idx + 1]! / 4
    avgCorner[2]! += rgba[idx + 2]! / 4
    avgCorner[3]! += rgba[idx + 3]! / 4
  }
  let maxCornerDiff = 0
  for (const idx of corners) {
    const d =
      (Math.abs(rgba[idx]! - avgCorner[0]!) +
        Math.abs(rgba[idx + 1]! - avgCorner[1]!) +
        Math.abs(rgba[idx + 2]! - avgCorner[2]!) +
        Math.abs(rgba[idx + 3]! - avgCorner[3]!)) /
      4
    if (d > maxCornerDiff) maxCornerDiff = d
  }
  const cornerDelta = Number(maxCornerDiff.toFixed(2))

  const meanDelta = (horizontalEdgeDelta + verticalEdgeDelta) / 2
  const score = Number(clamp(100 - meanDelta * 2.2, 0, 100).toFixed(1))
  const isSeamless = horizontalEdgeDelta <= threshold && verticalEdgeDelta <= threshold

  return {
    width,
    height,
    horizontalEdgeDelta,
    verticalEdgeDelta,
    cornerDelta,
    score,
    isSeamless
  }
}

/**
 * 将输入 RGBA 纹理处理为无缝平铺纹理（返回新 Uint8ClampedArray）。
 *
 * 算法：
 * 在距离边界 d ∈ [0, margin) 的过渡带内，采用正弦曲线权重
 * w(d) = 0.5 + 0.5 * sin((π / 2) * (d / margin))
 * 将像素 (d) 与镜像对侧像素 (size - 1 - d) 做对称混合：
 * - 在边界 d = 0 处 w(0) = 0.5，故左边界与右边界（上边界与下边界）完全相等，边界色差严格为 0；
 * - 在过渡带内侧终点 d = margin 处 w(margin) = 1 且一阶导数为 0，与中心原图区域 C1 平滑衔接。
 */
export function applySeamlessTileBlend(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options?: SeamlessTileBlendOptions
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length)
  out.set(rgba)
  if (width <= 2 || height <= 2 || rgba.length < width * height * 4) {
    return out
  }

  const blendRatio = clamp(Number(options?.blendRatio ?? 0.18), 0.02, 0.45)
  const wrapX = options?.wrapX !== false
  const wrapY = options?.wrapY !== false

  if (wrapX) {
    const marginX = Math.max(1, Math.min(Math.floor(width / 2) - 1, Math.round(width * blendRatio)))
    const temp = new Uint8ClampedArray(out)
    for (let y = 0; y < height; y++) {
      const rowOffset = y * width
      for (let d = 0; d < marginX; d++) {
        const w = 0.5 + 0.5 * Math.sin((Math.PI * 0.5 * d) / marginX)
        const invW = 1 - w
        const leftIdx = (rowOffset + d) * 4
        const rightIdx = (rowOffset + (width - 1 - d)) * 4
        for (let c = 0; c < 4; c++) {
          const lVal = temp[leftIdx + c]!
          const rVal = temp[rightIdx + c]!
          out[leftIdx + c] = clampByte(w * lVal + invW * rVal)
          out[rightIdx + c] = clampByte(w * rVal + invW * lVal)
        }
      }
    }
  }

  if (wrapY) {
    const marginY = Math.max(
      1,
      Math.min(Math.floor(height / 2) - 1, Math.round(height * blendRatio))
    )
    const temp = new Uint8ClampedArray(out)
    for (let d = 0; d < marginY; d++) {
      const w = 0.5 + 0.5 * Math.sin((Math.PI * 0.5 * d) / marginY)
      const invW = 1 - w
      const topRow = d * width
      const bottomRow = (height - 1 - d) * width
      for (let x = 0; x < width; x++) {
        const topIdx = (topRow + x) * 4
        const bottomIdx = (bottomRow + x) * 4
        for (let c = 0; c < 4; c++) {
          const tVal = temp[topIdx + c]!
          const bVal = temp[bottomIdx + c]!
          out[topIdx + c] = clampByte(w * tVal + invW * bVal)
          out[bottomIdx + c] = clampByte(w * bVal + invW * tVal)
        }
      }
    }
  }

  return out
}

/**
 * 标准 47 格 Blob Auto-Tile 的 8 邻域有效掩码表（N=1, NE=2, E=4, SE=8, S=16, SW=32, W=64, NW=128）。
 * 对角线仅在两侧正交方向均连通时生效。
 */
export const BLOB_47_BITMASKS: readonly number[] = [
  0, 1, 4, 5, 7, 16, 17, 20, 21, 23, 28, 29, 31, 64, 65, 68, 69, 71, 80, 81, 84, 85, 87, 92, 93, 95,
  112, 113, 116, 117, 119, 124, 125, 127, 193, 197, 199, 209, 213, 215, 221, 223, 241, 245, 247,
  253, 255
]

function maskToNeighbors(bitmask: number, is4Bit = false): AutoTileNeighbors {
  if (is4Bit) {
    const n = Boolean(bitmask & 1)
    const e = Boolean(bitmask & 2)
    const s = Boolean(bitmask & 4)
    const w = Boolean(bitmask & 8)
    return {
      n,
      ne: n && e,
      e,
      se: s && e,
      s,
      sw: s && w,
      w,
      nw: n && w
    }
  }
  return {
    n: Boolean(bitmask & 1),
    ne: Boolean(bitmask & 2),
    e: Boolean(bitmask & 4),
    se: Boolean(bitmask & 8),
    s: Boolean(bitmask & 16),
    sw: Boolean(bitmask & 32),
    w: Boolean(bitmask & 64),
    nw: Boolean(bitmask & 128)
  }
}

function classifyTileRole(neighbors: AutoTileNeighbors): string {
  const { n, e, s, w } = neighbors
  const count = Number(n) + Number(e) + Number(s) + Number(w)
  if (count === 0) return 'isolated_island'
  if (count === 4) {
    const corners =
      Number(neighbors.ne) + Number(neighbors.se) + Number(neighbors.sw) + Number(neighbors.nw)
    if (corners === 4) return 'center_fill'
    return 'inner_corner'
  }
  if (count === 3) {
    if (!n) return 'edge_top'
    if (!e) return 'edge_right'
    if (!s) return 'edge_bottom'
    return 'edge_left'
  }
  if (count === 2) {
    if (n && s) return 'corridor_vertical'
    if (e && w) return 'corridor_horizontal'
    if (s && e) return 'outer_corner_tl'
    if (s && w) return 'outer_corner_tr'
    if (n && e) return 'outer_corner_bl'
    return 'outer_corner_br'
  }
  if (n) return 'end_cap_bottom'
  if (e) return 'end_cap_left'
  if (s) return 'end_cap_top'
  return 'end_cap_right'
}

/**
 * 构建引擎可直读的 Auto-Tile 瓦片图集切格与掩码清单。
 */
export function buildAutoTileAtlasManifest(options: {
  terrainName?: string
  layout?: AutoTileLayoutKind
  tileWidth?: number
  tileHeight?: number
}): AutoTileAtlasManifest {
  const terrainName = (options.terrainName || 'terrain').trim() || 'terrain'
  const layout: AutoTileLayoutKind =
    options.layout === 'blob47' || options.layout === 'grid3x3' ? options.layout : 'wang16'
  const tileWidth = Math.max(8, Math.round(options.tileWidth ?? 64))
  const tileHeight = Math.max(8, Math.round(options.tileHeight ?? 64))

  let columns = 4
  let rows = 4
  let masks: number[] = []
  let is4Bit = true

  if (layout === 'grid3x3') {
    columns = 3
    rows = 3
    // 3x3 标准九宫格：左上、上、右上 / 左、中、右 / 左下、下、右下
    masks = [
      2 + 4, // TL: E + S
      2 + 4 + 8, // T: E + S + W
      4 + 8, // TR: S + W
      1 + 2 + 4, // L: N + E + S
      1 + 2 + 4 + 8, // C: N + E + S + W
      1 + 4 + 8, // R: N + S + W
      1 + 2, // BL: N + E
      1 + 2 + 8, // B: N + E + W
      1 + 8 // BR: N + W
    ]
    is4Bit = true
  } else if (layout === 'wang16') {
    columns = 4
    rows = 4
    masks = Array.from({ length: 16 }, (_, i) => i)
    is4Bit = true
  } else {
    columns = 8
    rows = 6
    masks = [...BLOB_47_BITMASKS]
    is4Bit = false
  }

  const cells: AutoTileCellEntry[] = masks.map((bitmask, index) => {
    const col = index % columns
    const row = Math.floor(index / columns)
    const neighbors = maskToNeighbors(bitmask, is4Bit)
    const cardinalMask =
      (neighbors.n ? 1 : 0) | (neighbors.e ? 2 : 0) | (neighbors.s ? 4 : 0) | (neighbors.w ? 8 : 0)
    return {
      index,
      col,
      row,
      x: col * tileWidth,
      y: row * tileHeight,
      width: tileWidth,
      height: tileHeight,
      bitmask,
      cardinalMask,
      neighbors,
      role: classifyTileRole(neighbors)
    }
  })

  return {
    schemaVersion: 1,
    terrainName,
    layout,
    tileWidth,
    tileHeight,
    columns,
    rows,
    atlasWidth: columns * tileWidth,
    atlasHeight: rows * tileHeight,
    cells,
    engineHints: {
      godot: {
        terrainSetMode: layout === 'blob47' ? 'match_corners_and_sides' : 'match_sides',
        tileSize: [tileWidth, tileHeight]
      },
      unity: {
        ruleTileType: 'RuleTile',
        pixelsPerUnit: tileWidth
      }
    }
  }
}
