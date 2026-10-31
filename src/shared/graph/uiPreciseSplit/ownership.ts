/**
 * 像素归属分区 + 窄带边缘抠图 + 可见像素锁定（UI 精准拆层 v2 · P1）。
 *
 * 旧路径用「上层底板 − 下层底板」的色差阈值反推整块 alpha：补底只要有一点偏差，
 * 元素内部就会被判成透明（被切掉一半），背景偏差又会被判成元素（污染）。这里改成：
 *
 * 1. **像素归属图**：按绘制顺序把每个元素的轮廓写进 owner 图（上层覆盖下层），
 *    每个像素恰好归属一个元素或底板，无缝无重叠；
 * 2. **内部 alpha 恒为 1**：轮廓内部不再看色差，只取像素（不透明控件不会再被切一半）；
 * 3. **窄带解混**：只在轮廓边界 ±2px 用合成方程 I = αF + (1−α)B 线性解混求 alpha 与前景色，
 *    F 取最近的内部像素色，B 取补底后的下层底板 → 边缘不带底色光晕；
 * 4. **光晕带**：轮廓外 3..R px 只在下层被补过底（L ≠ U）的像素上按色差取软 alpha，
 *    且必须与内侧连通，外发光 / 投影归元素，不再留在底板上；
 * 5. **可见像素锁定**：元素在原图中可见（owner = 自身）的像素直接取原图，
 *    补底 / 生成模型的漂移只可能出现在被上层遮挡的区域；
 * 6. **残留清扫**：剥层后检查元素轮廓外环带里仍带元素主色、且与远处底色明显不同的像素，
 *    连通到轮廓的部分在下层底板上局部补底，并同步到更低层的底板。
 */

import { clampRect, cropImage, expandRect, inpaintPushPull, median, pixelDistance } from './pixels'
import type { PixelRect, RgbaImage } from './types'

export interface CanvasMask {
  /** 画布坐标矩形 */
  rect: PixelRect
  /** rect.width * rect.height 的二值掩码（1 = 属于元素轮廓） */
  mask: Uint8Array
}

export interface OwnershipEntry {
  id: string
  /** 绘制顺序（越大越靠上） */
  paintIndex: number
  mask: CanvasMask
}

export interface OwnershipMap {
  width: number
  height: number
  /** 每像素归属的 entries 下标；-1 = 底板 */
  owner: Int32Array
  entries: OwnershipEntry[]
}

/** 按绘制顺序（低 → 高）写入归属图：上层覆盖下层，结果无缝无重叠 */
export function buildOwnershipMap(
  width: number,
  height: number,
  entries: readonly OwnershipEntry[]
): OwnershipMap {
  const owner = new Int32Array(width * height).fill(-1)
  const order = entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.paintIndex - b.e.paintIndex || a.i - b.i)
  for (const { e, i } of order) {
    const { rect, mask } = e.mask
    for (let y = 0; y < rect.height; y++) {
      const cy = rect.top + y
      if (cy < 0 || cy >= height) continue
      for (let x = 0; x < rect.width; x++) {
        if (!mask[y * rect.width + x]) continue
        const cx = rect.left + x
        if (cx < 0 || cx >= width) continue
        owner[cy * width + cx] = i
      }
    }
  }
  return { width, height, owner, entries: [...entries] }
}

/** 掩码像素数 */
export function maskArea(m: CanvasMask): number {
  let n = 0
  for (let i = 0; i < m.mask.length; i++) n += m.mask[i] ? 1 : 0
  return n
}

/** 把画布掩码投影到 region 局部坐标 */
function projectMask(m: CanvasMask, region: PixelRect): Uint8Array {
  const out = new Uint8Array(region.width * region.height)
  for (let y = 0; y < region.height; y++) {
    const my = region.top + y - m.rect.top
    if (my < 0 || my >= m.rect.height) continue
    for (let x = 0; x < region.width; x++) {
      const mx = region.left + x - m.rect.left
      if (mx < 0 || mx >= m.rect.width) continue
      if (m.mask[my * m.rect.width + mx]) out[y * region.width + x] = 1
    }
  }
  return out
}

/**
 * 轮廓外的棋盘距离（8 邻域 BFS，≤ maxR），同时记录最近的「内部种子」像素下标，
 * 用作边缘解混的前景色 F。inside = 0；超出 maxR = 255。
 */
function outsideDistanceWithSeeds(
  inside: Uint8Array,
  core: Uint8Array,
  w: number,
  h: number,
  maxR: number
): { dist: Uint8Array; seed: Int32Array } {
  const n = w * h
  const dist = new Uint8Array(n).fill(255)
  const seed = new Int32Array(n).fill(-1)
  const queue = new Int32Array(n)
  let head = 0
  let tail = 0
  // 先从内部核心向整个轮廓 + 外圈扩散种子（轮廓边缘像素也需要最近核心色）
  for (let p = 0; p < n; p++) {
    if (core[p]) {
      seed[p] = p
      queue[tail++] = p
    }
  }
  const seedDist = new Uint8Array(n).fill(255)
  for (let p = 0; p < n; p++) if (core[p]) seedDist[p] = 0
  const limit = maxR + 4
  while (head < tail) {
    const p = queue[head++]!
    const py = (p / w) | 0
    const px = p - py * w
    const d = seedDist[p]!
    if (d >= limit) continue
    for (let dy = -1; dy <= 1; dy++) {
      const ny = py + dy
      if (ny < 0 || ny >= h) continue
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const nx = px + dx
        if (nx < 0 || nx >= w) continue
        const np = ny * w + nx
        if (seedDist[np]! <= d + 1) continue
        seedDist[np] = d + 1
        seed[np] = seed[p]!
        queue[tail++] = np
      }
    }
  }
  // 再算轮廓外距离
  head = 0
  tail = 0
  for (let p = 0; p < n; p++) {
    if (inside[p]) {
      dist[p] = 0
      queue[tail++] = p
    }
  }
  while (head < tail) {
    const p = queue[head++]!
    const py = (p / w) | 0
    const px = p - py * w
    const d = dist[p]!
    if (d >= maxR) continue
    for (let dy = -1; dy <= 1; dy++) {
      const ny = py + dy
      if (ny < 0 || ny >= h) continue
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const nx = px + dx
        if (nx < 0 || nx >= w) continue
        const np = ny * w + nx
        if (dist[np]! <= d + 1) continue
        dist[np] = d + 1
        queue[tail++] = np
      }
    }
  }
  return { dist, seed }
}

function smoothstep(e0: number, e1: number, x: number): number {
  if (x <= e0) return 0
  if (x >= e1) return 1
  const t = (x - e0) / (e1 - e0)
  return t * t * (3 - 2 * t)
}

/**
 * 线性解混：I = αF + (1−α)B → α = <I−B, F−B> / |F−B|²（RGB 空间）。
 * residual = |I − (αF + (1−α)B)|：残差大说明该像素不是 F/B 的混合（如独立颜色的描边 / 边框线），
 * 调用方此时不能信任 α。
 */
function unmixAlpha(
  I: Uint8ClampedArray,
  ii: number,
  F: Uint8ClampedArray,
  fi: number,
  B: Uint8ClampedArray,
  bi: number
): { alpha: number; contrast: number; residual: number } {
  const fr = F[fi]! - B[bi]!
  const fg = F[fi + 1]! - B[bi + 1]!
  const fb = F[fi + 2]! - B[bi + 2]!
  const den = fr * fr + fg * fg + fb * fb
  const contrast = Math.sqrt(den)
  const ir = I[ii]! - B[bi]!
  const ig = I[ii + 1]! - B[bi + 1]!
  const ib = I[ii + 2]! - B[bi + 2]!
  if (den < 1) return { alpha: 1, contrast, residual: Math.sqrt(ir * ir + ig * ig + ib * ib) }
  const a = Math.max(0, Math.min(1, (ir * fr + ig * fg + ib * fb) / den))
  const rr = ir - a * fr
  const rg = ig - a * fg
  const rb = ib - a * fb
  return { alpha: a, contrast, residual: Math.sqrt(rr * rr + rg * rg + rb * rb) }
}

/** 解混结果是否可信：对比度够、且像素确实能被 F/B 的线性混合解释 */
function unmixTrusted(u: { contrast: number; residual: number }): boolean {
  return u.contrast >= 18 && u.residual <= Math.max(24, u.contrast * 0.35)
}

export interface OwnedLayerInput {
  /** 原图（可见像素锁定来源） */
  source: RgbaImage
  /** 元素仍在、上层已剥离的底板（plates[k+1]） */
  upper: RgbaImage
  /** 元素已剥离的底板（plates[k]） */
  lower: RgbaImage
  /** 元素完整轮廓（含被上层遮挡部分） */
  mask: CanvasMask
  ownership: OwnershipMap
  /** 自身在 ownership.entries 中的下标 */
  entryIndex: number
  /** 光晕带半径（≥ 2；外发光 / 投影控件可取更大） */
  haloRadius?: number
  /** true = 内部色差明显偏低时返回 null，交给调用方走半透明差分抠图 */
  detectTranslucent?: boolean
  /**
   * 画布尺寸的「上层图层最大 alpha」累积图（自上而下合成时维护）：
   * 只有上层图层完全没覆盖到的像素才锁定为原图像素，否则取补底结果，
   * 避免把上层元素的抗锯齿边 / 外发光重复烘进本图层。
   */
  aboveAlpha?: Float32Array
}

export interface OwnedLayerResult {
  rect: PixelRect
  rgba: Uint8ClampedArray
  coverage: number
  stats: {
    /** 原图可见、被锁定为原图像素的数量 */
    visible: number
    /** 被上层遮挡、取补底结果的数量 */
    occluded: number
    /** 边缘解混像素数 */
    edge: number
    /** 光晕带软 alpha 像素数 */
    halo: number
  }
}

/**
 * 基于归属图合成单个元素图层（内部 alpha=1、窄带解混、光晕带、可见像素锁定）。
 * 返回 null = 无可分离像素，或（detectTranslucent 时）判定为半透明控件。
 */
export function composeOwnedLayer(input: OwnedLayerInput): OwnedLayerResult | null {
  const { source: S, upper: U, lower: L, ownership, entryIndex } = input
  const W = S.width
  const H = S.height
  const R = Math.max(2, Math.min(16, Math.round(input.haloRadius ?? 2)))
  const selfPaint = ownership.entries[entryIndex]!.paintIndex
  const region = expandRect(input.mask.rect, R + 1, W, H)
  const rw = region.width
  const rh = region.height
  const n = rw * rh
  if (n <= 0) return null

  const inside = projectMask(input.mask, region)
  let insideCount = 0
  for (let p = 0; p < n; p++) insideCount += inside[p]!
  if (!insideCount) return null

  // 内部核心 = 轮廓内且 4 邻域都在轮廓内（距边 ≥ 1px）；极细元素（线条/细描边）核心为空时退化为整个轮廓
  const core = new Uint8Array(n)
  const edge = new Uint8Array(n)
  let coreCount = 0
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const p = y * rw + x
      if (!inside[p]) continue
      const isEdge =
        x === 0 ||
        y === 0 ||
        x === rw - 1 ||
        y === rh - 1 ||
        !inside[p - 1] ||
        !inside[p + 1] ||
        !inside[p - rw] ||
        !inside[p + rw]
      if (isEdge) edge[p] = 1
      else {
        core[p] = 1
        coreCount++
      }
    }
  }
  const seeds = coreCount >= Math.max(4, insideCount * 0.08) ? core : inside
  const { dist, seed } = outsideDistanceWithSeeds(inside, seeds, rw, rh, R)

  const ownerOf = (cx: number, cy: number): number => ownership.owner[cy * W + cx]!
  const paintOf = (idx: number): number => ownership.entries[idx]?.paintIndex ?? -1
  const above = input.aboveAlpha
  /** 原图可见且未被任何上层图层（含其软边）覆盖 → 可锁定原图像素 */
  const lockable = (cx: number, cy: number): boolean =>
    ownerOf(cx, cy) === entryIndex && (!above || above[cy * W + cx]! < 0.004)

  // 半透明判定：内部核心（原图可见部分）上 U 与 L 的色差普遍偏小 = 磨砂 / 半透明面板
  if (input.detectTranslucent) {
    const samples: number[] = []
    const step = Math.max(1, Math.floor(coreCount / 1500))
    let k = 0
    for (let p = 0; p < n; p++) {
      if (!core[p]) continue
      if (k++ % step) continue
      const cx = region.left + (p % rw)
      const cy = region.top + ((p / rw) | 0)
      if (ownerOf(cx, cy) !== entryIndex) continue
      const i = (cy * W + cx) * 4
      samples.push(smoothstep(6, 40, pixelDistance(U.data, i, L.data, i)))
    }
    if (samples.length >= 24 && median(samples) < 0.55) return null
  }

  const alpha = new Float32Array(n)
  const color = new Uint8ClampedArray(n * 4)
  let visible = 0
  let occluded = 0
  let edgeCount = 0
  let haloCount = 0

  const solveColor = (o: number, i: number, a: number, fallbackIdx: number): void => {
    // 反解前景色：uc·ua = ec·a + lc·la·(1−a)；alpha 很低时向最近内部色收敛，避免放大噪声
    const ua = U.data[i + 3]! / 255
    const la = L.data[i + 3]! / 255
    const trust = smoothstep(0.1, 0.45, a)
    for (let c = 0; c < 3; c++) {
      const uc = U.data[i + c]!
      const lc = L.data[i + c]!
      const solved = a >= 0.995 ? uc : (uc * ua - lc * la * (1 - a)) / Math.max(a, 1e-3)
      const ref = fallbackIdx >= 0 ? U.data[fallbackIdx + c]! : uc
      color[o + c] = solved * trust + ref * (1 - trust)
    }
  }

  // 第一遍：轮廓内部 + 边缘 ±2px 解混
  for (let y = 0; y < rh; y++) {
    const cy = region.top + y
    for (let x = 0; x < rw; x++) {
      const p = y * rw + x
      const cx = region.left + x
      const i = (cy * W + cx) * 4
      const o = p * 4
      const own = ownerOf(cx, cy)
      const ua = U.data[i + 3]! / 255
      const la = L.data[i + 3]! / 255
      const sp = seed[p]!
      const seedI =
        sp >= 0 ? ((region.top + ((sp / rw) | 0)) * W + region.left + (sp % rw)) * 4 : -1

      if (inside[p]) {
        const occludedHere = own >= 0 && own !== entryIndex && paintOf(own) > selfPaint
        if (edge[p] && !occludedHere && la > 0.5 && seedI >= 0) {
          const um = unmixAlpha(U.data, i, U.data, seedI, L.data, i)
          // 对比度太低或像素不是 F/B 混合（独立颜色的边框线 / 描边）：保持轮廓内 = 不透明
          const aa = unmixTrusted(um) ? um.alpha : 1
          alpha[p] = aa * ua
          if (aa >= 0.98 && lockable(cx, cy)) {
            color[o] = S.data[i]!
            color[o + 1] = S.data[i + 1]!
            color[o + 2] = S.data[i + 2]!
            visible++
          } else {
            solveColor(o, i, aa, seedI)
          }
          edgeCount++
          continue
        }
        // 内部：alpha = 原像素 alpha（不透明控件恒为 1），颜色锁定原图 / 遮挡区取补底
        if (lockable(cx, cy)) {
          alpha[p] = S.data[i + 3]! / 255
          color[o] = S.data[i]!
          color[o + 1] = S.data[i + 1]!
          color[o + 2] = S.data[i + 2]!
          visible++
        } else {
          alpha[p] = ua
          color[o] = U.data[i]!
          color[o + 1] = U.data[i + 1]!
          color[o + 2] = U.data[i + 2]!
          occluded++
        }
        continue
      }

      const d = dist[p]!
      if (d > R) continue
      // 轮廓外：只认领原图中归属底板或更下层元素的像素（不抢上层 / 兄弟元素的像素）
      if (own >= 0 && paintOf(own) >= selfPaint && own !== entryIndex) continue
      const dU = pixelDistance(U.data, i, L.data, i)
      if (dU < 6) continue
      let a: number
      if (la < 0.5) {
        a = ua
      } else if (d <= 2 && seedI >= 0) {
        const um = unmixAlpha(U.data, i, U.data, seedI, L.data, i)
        a = unmixTrusted(um) ? um.alpha : smoothstep(8, 40, dU)
      } else {
        a = smoothstep(8, 40, dU)
      }
      if (la < 0.999) a = Math.max(a, Math.max(0, (ua - la) / (1 - la)))
      if (a < 0.02) continue
      alpha[p] = Math.min(1, a)
      solveColor(o, i, a, seedI)
      if (d <= 2) edgeCount++
      else haloCount++
    }
  }

  // 第二遍：光晕带连通约束（距离 d 的像素必须挨着 d−1 处仍有 alpha 的像素），剔除远处补底噪声
  for (let d = 1; d <= R; d++) {
    for (let p = 0; p < n; p++) {
      if (dist[p] !== d || alpha[p]! <= 0) continue
      const py = (p / rw) | 0
      const px = p - py * rw
      let ok = false
      for (let dy = -1; dy <= 1 && !ok; dy++) {
        const ny = py + dy
        if (ny < 0 || ny >= rh) continue
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const nx = px + dx
          if (nx < 0 || nx >= rw) continue
          const np = ny * rw + nx
          if (dist[np]! < d && (inside[np] || alpha[np]! > 0.04)) {
            ok = true
            break
          }
        }
      }
      if (!ok) {
        alpha[p] = 0
        if (d <= 2) edgeCount--
        else haloCount--
      }
    }
  }

  let minX = rw
  let minY = rh
  let maxX = -1
  let maxY = -1
  let opaque = 0
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const p = y * rw + x
      if (alpha[p]! < 0.01) continue
      if (alpha[p]! >= 0.5) opaque++
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return null
  const tw = maxX - minX + 1
  const th = maxY - minY + 1
  const out = new Uint8ClampedArray(tw * th * 4)
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const p = (minY + y) * rw + minX + x
      const a = alpha[p]!
      if (a < 0.01) continue
      const o = (y * tw + x) * 4
      out[o] = color[p * 4]!
      out[o + 1] = color[p * 4 + 1]!
      out[o + 2] = color[p * 4 + 2]!
      out[o + 3] = Math.round(a * 255)
    }
  }
  return {
    rect: clampRect(
      { left: region.left + minX, top: region.top + minY, width: tw, height: th },
      W,
      H
    ),
    rgba: out,
    coverage: opaque / Math.max(1, tw * th),
    stats: { visible, occluded, edge: Math.max(0, edgeCount), halo: Math.max(0, haloCount) }
  }
}

interface RingRefs {
  bg: [number, number, number]
  bgSpread: number
  el: [number, number, number]
}

function medianColor(samples: number[][]): [number, number, number] {
  return [
    median(samples.map((s) => s[0]!)),
    median(samples.map((s) => s[1]!)),
    median(samples.map((s) => s[2]!))
  ]
}

const tmpA = new Uint8ClampedArray(4)
const tmpB = new Uint8ClampedArray(4)
function rgbDist(a: ArrayLike<number>, ai: number, c: readonly number[]): number {
  tmpA[0] = a[ai]!
  tmpA[1] = a[ai + 1]!
  tmpA[2] = a[ai + 2]!
  tmpA[3] = 255
  tmpB[0] = c[0]!
  tmpB[1] = c[1]!
  tmpB[2] = c[2]!
  tmpB[3] = 255
  return pixelDistance(tmpA, 0, tmpB, 0)
}

export interface ResidueScanInput {
  /** 检查残留的底板（元素已剥离） */
  plate: RgbaImage
  /** 元素仍在的底板（取元素主色） */
  upper: RgbaImage
  mask: CanvasMask
  ownership: OwnershipMap
  entryIndex: number
  radius: number
}

export interface ResidueScanResult {
  /** 画布坐标的残留像素下标 */
  pixels: number[]
  /** 外环带可检查像素数 */
  ringSize: number
}

/**
 * 残留检测：轮廓外 1..radius 环带里，颜色明显偏离远处底色、更接近元素主色、
 * 且与轮廓连通的像素（即没被补底覆盖到的边缘 / 外发光 / 投影）。
 */
export function scanPlateResidue(input: ResidueScanInput): ResidueScanResult {
  const { plate: L, upper: U, ownership, entryIndex } = input
  const W = L.width
  const H = L.height
  const R = Math.max(2, Math.min(16, Math.round(input.radius)))
  const outer = R + 4
  const region = expandRect(input.mask.rect, outer + 1, W, H)
  const rw = region.width
  const rh = region.height
  const n = rw * rh
  const inside = projectMask(input.mask, region)
  const { dist } = outsideDistanceWithSeeds(inside, inside, rw, rh, outer)
  const selfPaint = ownership.entries[entryIndex]!.paintIndex
  const paintOf = (idx: number): number => ownership.entries[idx]?.paintIndex ?? -1
  const eligible = (cx: number, cy: number): boolean => {
    const own = ownership.owner[cy * W + cx]!
    return own < 0 || (own !== entryIndex && paintOf(own) < selfPaint)
  }

  const bgSamples: number[][] = []
  const elSamples: number[][] = []
  const scx = input.mask.rect.left + input.mask.rect.width / 2 - region.left
  const scy = input.mask.rect.top + input.mask.rect.height / 2 - region.top
  const sectorIndex = (x: number, y: number): number => {
    const a = Math.atan2(y - scy, x - scx)
    return ((Math.round((a / (Math.PI * 2)) * 8) % 8) + 8) % 8
  }
  for (let y = 0; y < rh; y++) {
    const cy = region.top + y
    for (let x = 0; x < rw; x++) {
      const p = y * rw + x
      const cx = region.left + x
      const i = (cy * W + cx) * 4
      const d = dist[p]!
      if (inside[p]) {
        // 元素主色：轮廓内靠边 2px 的像素（取 upper，即元素仍在时的颜色）
        let nearEdge = false
        for (let k = 1; k <= 2 && !nearEdge; k++) {
          if (x - k < 0 || x + k >= rw || y - k < 0 || y + k >= rh) nearEdge = true
          else if (!inside[p - k] || !inside[p + k] || !inside[p - k * rw] || !inside[p + k * rw])
            nearEdge = true
        }
        if (nearEdge && U.data[i + 3]! > 200)
          elSamples.push([U.data[i]!, U.data[i + 1]!, U.data[i + 2]!])
        continue
      }
      if (d >= R + 2 && d <= outer && eligible(cx, cy) && L.data[i + 3]! > 200) {
        bgSamples.push([L.data[i]!, L.data[i + 1]!, L.data[i + 2]!, sectorIndex(x, y)])
      }
    }
  }
  if (bgSamples.length < 12 || elSamples.length < 4) return { pixels: [], ringSize: 0 }
  const bg = medianColor(bgSamples.map((s) => [s[0]!, s[1]!, s[2]!]))
  const el = medianColor(elSamples)
  const spreads = bgSamples.map((s) => rgbDist(s, 0, bg))
  const refs: RingRefs = { bg, el, bgSpread: median(spreads) }
  // 元素主色与底色本就接近时无法区分残留，直接跳过（避免把底板纹理当残留抹掉）
  if (rgbDist(el, 0, bg) < 24) return { pixels: [], ringSize: 0 }
  // 纹理底（噪声 / 花纹）上无法可靠区分「抗锯齿残留」与「底纹本身」：不清扫，交给质检
  if (refs.bgSpread > 14) return { pixels: [], ringSize: 0 }
  const thr = Math.max(16, refs.bgSpread * 2.2 + 6)

  // 底色按 8 个方位扇区分别取中位数（渐变底 / 一侧是边框一侧是立绘时，全局中位数不可靠）
  const sectorSamples: number[][][] = Array.from({ length: 8 }, () => [])
  for (const s of bgSamples) sectorSamples[s[3]!]!.push(s)
  const sectorBg = sectorSamples.map((ss) => (ss.length >= 6 ? medianColor(ss) : bg))

  const cand = new Uint8Array(n)
  let ringSize = 0
  for (let y = 0; y < rh; y++) {
    const cy = region.top + y
    for (let x = 0; x < rw; x++) {
      const p = y * rw + x
      const d = dist[p]!
      if (inside[p] || d < 1 || d > R) continue
      const cx = region.left + x
      if (!eligible(cx, cy)) continue
      const i = (cy * W + cx) * 4
      if (L.data[i + 3]! < 40) continue
      ringSize++
      const B = sectorBg[sectorIndex(x, y)]!
      if (rgbDist(L.data, i, B) <= thr) continue
      // 残留 = 元素色与底色的混合（抗锯齿边 / 外发光 / 投影）：必须落在 E–B 连线附近，
      // 不能是第三种颜色（相邻的边框线、立绘发丝等本来就属于别人的像素）
      const er = el[0] - B[0]!
      const eg = el[1] - B[1]!
      const eb = el[2] - B[2]!
      const den = er * er + eg * eg + eb * eb
      if (den < 400) continue
      const pr = L.data[i]! - B[0]!
      const pg = L.data[i + 1]! - B[1]!
      const pb = L.data[i + 2]! - B[2]!
      const a = (pr * er + pg * eg + pb * eb) / den
      if (a < 0.25) continue
      const ac = Math.min(1, a)
      const rr = pr - ac * er
      const rg = pg - ac * eg
      const rb = pb - ac * eb
      const residual = Math.sqrt(rr * rr + rg * rg + rb * rb)
      if (residual <= Math.max(14, Math.sqrt(den) * 0.12)) cand[p] = 1
    }
  }
  // 连通约束：从紧贴轮廓（d = 1）的候选向外生长
  const keep = new Uint8Array(n)
  const queue: number[] = []
  for (let p = 0; p < n; p++) {
    if (cand[p] && dist[p] === 1) {
      keep[p] = 1
      queue.push(p)
    }
  }
  while (queue.length) {
    const p = queue.pop()!
    const py = (p / rw) | 0
    const px = p - py * rw
    for (let dy = -1; dy <= 1; dy++) {
      const ny = py + dy
      if (ny < 0 || ny >= rh) continue
      for (let dx = -1; dx <= 1; dx++) {
        const nx = px + dx
        if (nx < 0 || nx >= rw) continue
        const np = ny * rw + nx
        if (cand[np] && !keep[np]) {
          keep[np] = 1
          queue.push(np)
        }
      }
    }
  }
  const pixels: number[] = []
  for (let p = 0; p < n; p++) {
    if (!keep[p]) continue
    pixels.push((region.top + ((p / rw) | 0)) * W + region.left + (p % rw))
  }
  return { pixels, ringSize }
}

/**
 * 残留清扫：在 plates[level] 上把残留像素（外扩 1px）局部补底，
 * 并同步到所有更低层底板中「仍与旧值相同」的像素（低层底板由它派生）。
 * 返回修复像素数。
 */
export function scrubPlateResidue(input: {
  plates: RgbaImage[]
  level: number
  residue: readonly number[]
  mask: CanvasMask
}): number {
  const { plates, level, residue } = input
  const L = plates[level]
  if (!L || !residue.length) return 0
  const W = L.width
  const H = L.height
  let minX = W
  let minY = H
  let maxX = -1
  let maxY = -1
  for (const idx of residue) {
    const x = idx % W
    const y = (idx / W) | 0
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  const ctx = expandRect(
    { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    12,
    W,
    H
  )
  const crop = cropImage(L, ctx)
  const hole = new Uint8Array(ctx.width * ctx.height)
  const inMask = (cx: number, cy: number): boolean => {
    const mx = cx - input.mask.rect.left
    const my = cy - input.mask.rect.top
    if (mx < 0 || my < 0 || mx >= input.mask.rect.width || my >= input.mask.rect.height)
      return false
    return !!input.mask.mask[my * input.mask.rect.width + mx]
  }
  for (const idx of residue) {
    const x = idx % W
    const y = (idx / W) | 0
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = x + dx
        const cy = y + dy
        if (
          cx < ctx.left ||
          cy < ctx.top ||
          cx >= ctx.left + ctx.width ||
          cy >= ctx.top + ctx.height
        )
          continue
        // 轮廓内在 L 上已是补底结果，可作为可信邻域，不再挖洞
        if (inMask(cx, cy)) continue
        hole[(cy - ctx.top) * ctx.width + (cx - ctx.left)] = 1
      }
    }
  }
  const before = cropImage(L, ctx)
  inpaintPushPull(crop, hole)

  const targets = new Set<RgbaImage>()
  for (let k = level; k >= 1; k--) {
    const pl = plates[k]
    if (pl) targets.add(pl)
  }
  let fixed = 0
  for (let y = 0; y < ctx.height; y++) {
    for (let x = 0; x < ctx.width; x++) {
      const lp = y * ctx.width + x
      if (!hole[lp]) continue
      const li = lp * 4
      const gi = ((ctx.top + y) * W + ctx.left + x) * 4
      for (const pl of targets) {
        if (pixelDistance(pl.data, gi, before.data, li) > 2) continue
        pl.data[gi] = crop.data[li]!
        pl.data[gi + 1] = crop.data[li + 1]!
        pl.data[gi + 2] = crop.data[li + 2]!
        pl.data[gi + 3] = crop.data[li + 3]!
      }
      fixed++
    }
  }
  return fixed
}
