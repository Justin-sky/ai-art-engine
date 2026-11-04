/**
 * 遮挡区确定性补全（UI 精准拆层 v2 · P2）。
 *
 * 被上层元素压住的区域在原图中根本不存在，旧路径只靠推拉金字塔扩散（糊块）或整版生图（漂移）。
 * 游戏 UI 的结构类控件（面板 / 按钮 / 槽位 / 边框 / 进度条 / 角标）绝大多数是规则的，
 * 这里按「越真实越优先」的顺序做零幻觉补全，只改元素自身底板（plates[k+1]）里被遮挡的像素：
 *
 * 1. **多实例融合**：同类、同尺寸且可见部分一致的重复控件（3 个奖励槽、一排同款按钮）
 *    视为同一预制体，被遮挡像素取其他实例在同一相对位置的真实像素中位数；
 * 2. **镜像对称**：元素可见部分左右 / 上下 / 中心对称时，被遮挡像素取对称位置的真实像素；
 * 3. **行列插值（九宫格拉伸区 / 渐变）**：被遮挡像素在同一行（或列）两侧都有平坦的可见锚点时，
 *    在两锚点间线性插值（纯色、横向 / 纵向渐变、九宫格中间拉伸区都是精确解）；
 * 4. 以上都不可信时保持原补底结果（推拉 / 生图），交给质检闸门判定。
 *
 * 可见像素一律不改；被遮挡区四周 2px 视为不可靠锚点（可能残留子元素抗锯齿 / 补底羽化）。
 */

import type { CanvasMask, OwnershipMap } from './ownership'
import { clampRect, dilateMask, pixelDistance, rectUnion } from './pixels'
import type { PixelRect, RgbaImage } from './types'

export interface CompletionTarget {
  id: string
  /** 元素种类（决定是否做结构化补全 + 预制体分组） */
  kind: string
  /** 被遮挡时的修补模式；'image' = 复杂画面（立绘 / 场景），跳过结构化补全 */
  repairMode?: string
  entryIndex: number
  mask: CanvasMask
  /** 元素自身底板（上层已剥离、元素仍在）：plates[level + 1] */
  plate: RgbaImage
}

export interface CompletionReport {
  /** 各策略补全的像素数 */
  instances: number
  mirror: number
  axis: number
  /** 被遮挡但没有可信结构化补全、保持原补底的像素数 */
  kept: number
  /** 识别出的预制体分组（元素 id 列表，≥ 2 个） */
  prefabGroups: string[][]
}

interface Prepared {
  t: CompletionTarget
  w: number
  h: number
  /** 局部坐标：1 = 可信可见像素（锚点） */
  known: Uint8Array
  /** 局部坐标：1 = 待补全（被遮挡 + 2px 不可靠带，限轮廓内） */
  target: Uint8Array
  targetCount: number
  /** 局部坐标：1 = 已补全 */
  done: Uint8Array
}

const STRUCTURED_KINDS = new Set([
  'panel',
  'frame',
  'banner',
  'button',
  'close-button',
  'tab',
  'item-slot',
  'badge',
  'progress-bar',
  'divider'
])

function prepare(t: CompletionTarget, ownership: OwnershipMap): Prepared | null {
  const { rect, mask } = t.mask
  const w = rect.width
  const h = rect.height
  const W = ownership.width
  const selfPaint = ownership.entries[t.entryIndex]!.paintIndex
  const occluded = new Uint8Array(w * h)
  let occCount = 0
  for (let y = 0; y < h; y++) {
    const cy = rect.top + y
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (!mask[p]) continue
      const own = ownership.owner[cy * W + rect.left + x]!
      if (
        own >= 0 &&
        own !== t.entryIndex &&
        (ownership.entries[own]?.paintIndex ?? -1) > selfPaint
      ) {
        occluded[p] = 1
        occCount++
      }
    }
  }
  if (!occCount) return null
  const uncertain = dilateMask(occluded, w, h, 2)
  const known = new Uint8Array(w * h)
  const target = new Uint8Array(w * h)
  let targetCount = 0
  for (let p = 0; p < w * h; p++) {
    if (!mask[p]) continue
    if (uncertain[p]) {
      target[p] = 1
      targetCount++
    } else known[p] = 1
  }
  return { t, w, h, known, target, targetCount, done: new Uint8Array(w * h) }
}

function writePx(plate: RgbaImage, gi: number, r: number, g: number, b: number): void {
  plate.data[gi] = r
  plate.data[gi + 1] = g
  plate.data[gi + 2] = b
  plate.data[gi + 3] = 255
}

/** 同尺寸、同类、可见部分一致 → 同一预制体（并查集分组） */
function groupInstances(items: Prepared[]): Prepared[][] {
  const parent = items.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
  for (let a = 0; a < items.length; a++) {
    for (let b = a + 1; b < items.length; b++) {
      const A = items[a]!
      const B = items[b]!
      if (A.t.kind !== B.t.kind) continue
      if (Math.abs(A.w - B.w) > 2 || Math.abs(A.h - B.h) > 2) continue
      const w = Math.min(A.w, B.w)
      const h = Math.min(A.h, B.h)
      let both = 0
      let sum = 0
      let knownA = 0
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const pa = y * A.w + x
          const pb = y * B.w + x
          if (A.known[pa]) knownA++
          if (!A.known[pa] || !B.known[pb]) continue
          const ga = ((A.t.mask.rect.top + y) * A.t.plate.width + A.t.mask.rect.left + x) * 4
          const gb = ((B.t.mask.rect.top + y) * B.t.plate.width + B.t.mask.rect.left + x) * 4
          sum += pixelDistance(A.t.plate.data, ga, B.t.plate.data, gb)
          both++
        }
      }
      if (both >= Math.max(30, knownA * 0.4) && sum / both <= 8) {
        parent[find(a)] = find(b)
      }
    }
  }
  const groups = new Map<number, Prepared[]>()
  items.forEach((it, i) => {
    const r = find(i)
    const g = groups.get(r) ?? []
    g.push(it)
    groups.set(r, g)
  })
  return [...groups.values()].filter((g) => g.length >= 2)
}

function fillFromInstances(group: Prepared[]): number {
  let filled = 0
  const vals: number[][] = []
  for (const it of group) {
    if (!it.targetCount) continue
    const { rect } = it.t.mask
    const PW = it.t.plate.width
    for (let y = 0; y < it.h; y++) {
      for (let x = 0; x < it.w; x++) {
        const p = y * it.w + x
        if (!it.target[p] || it.done[p]) continue
        vals.length = 0
        for (const other of group) {
          if (other === it || x >= other.w || y >= other.h) continue
          const op = y * other.w + x
          if (!other.known[op]) continue
          // 局部一致性：目标像素周围 7×7 内两实例都可见的像素必须一致
          // （例如品质色条颜色不同的两个槽位，不能互抄色条附近的像素）
          let lc = 0
          let ls = 0
          for (let dy = -3; dy <= 3; dy++) {
            const yy = y + dy
            if (yy < 0 || yy >= it.h || yy >= other.h) continue
            for (let dx = -3; dx <= 3; dx++) {
              const xx = x + dx
              if (xx < 0 || xx >= it.w || xx >= other.w) continue
              if (!it.known[yy * it.w + xx] || !other.known[yy * other.w + xx]) continue
              ls += pixelDistance(
                it.t.plate.data,
                ((rect.top + yy) * PW + rect.left + xx) * 4,
                other.t.plate.data,
                ((other.t.mask.rect.top + yy) * other.t.plate.width + other.t.mask.rect.left + xx) *
                  4
              )
              lc++
            }
          }
          if (lc >= 6 && ls / lc > 10) continue
          const og =
            ((other.t.mask.rect.top + y) * other.t.plate.width + other.t.mask.rect.left + x) * 4
          vals.push([
            other.t.plate.data[og]!,
            other.t.plate.data[og + 1]!,
            other.t.plate.data[og + 2]!
          ])
        }
        if (!vals.length) continue
        if (vals.length >= 2) {
          // 多个实例意见不一致（该位置本来就是各实例不同的内容）→ 不采用
          const ref = new Uint8ClampedArray([vals[0]![0]!, vals[0]![1]!, vals[0]![2]!, 255])
          let maxD = 0
          const tmp = new Uint8ClampedArray(4)
          for (const v of vals) {
            tmp[0] = v[0]!
            tmp[1] = v[1]!
            tmp[2] = v[2]!
            tmp[3] = 255
            maxD = Math.max(maxD, pixelDistance(tmp, 0, ref, 0))
          }
          if (maxD > 12) continue
        }
        const med = (c: number): number => {
          const s = vals.map((v) => v[c]!).sort((a, b) => a - b)
          return s[s.length >> 1]!
        }
        writePx(it.t.plate, ((rect.top + y) * PW + rect.left + x) * 4, med(0), med(1), med(2))
        it.done[p] = 1
        filled++
      }
    }
  }
  return filled
}

/** 对称性评分：可见像素与其对称位置可见像素的平均色差（及配对覆盖率） */
function symmetryScore(
  it: Prepared,
  mapX: (x: number) => number,
  mapY: (y: number) => number
): { err: number; coverage: number } {
  const { rect } = it.t.mask
  const PW = it.t.plate.width
  let pairs = 0
  let known = 0
  let sum = 0
  const step = Math.max(1, Math.floor(Math.sqrt((it.w * it.h) / 4000)))
  for (let y = 0; y < it.h; y += step) {
    for (let x = 0; x < it.w; x += step) {
      const p = y * it.w + x
      if (!it.known[p]) continue
      known++
      const mx = mapX(x)
      const my = mapY(y)
      if (mx < 0 || my < 0 || mx >= it.w || my >= it.h) continue
      const mp = my * it.w + mx
      if (!it.known[mp] || mp === p) continue
      sum += pixelDistance(
        it.t.plate.data,
        ((rect.top + y) * PW + rect.left + x) * 4,
        it.t.plate.data,
        ((rect.top + my) * PW + rect.left + mx) * 4
      )
      pairs++
    }
  }
  return { err: pairs ? sum / pairs : Infinity, coverage: known ? pairs / known : 0 }
}

function fillByMirror(it: Prepared): number {
  const maps: Array<[(x: number) => number, (y: number) => number]> = [
    [(x) => it.w - 1 - x, (y) => y],
    [(x) => x, (y) => it.h - 1 - y],
    [(x) => it.w - 1 - x, (y) => it.h - 1 - y]
  ]
  const valid = maps
    .map((m) => ({ m, s: symmetryScore(it, m[0], m[1]) }))
    .filter((v) => v.s.coverage >= 0.3 && v.s.err <= 5)
    .sort((a, b) => a.s.err - b.s.err)
  if (!valid.length) return 0
  const { rect } = it.t.mask
  const PW = it.t.plate.width
  let filled = 0
  for (let y = 0; y < it.h; y++) {
    for (let x = 0; x < it.w; x++) {
      const p = y * it.w + x
      if (!it.target[p] || it.done[p]) continue
      for (const { m } of valid) {
        const mx = m[0](x)
        const my = m[1](y)
        if (mx < 0 || my < 0 || mx >= it.w || my >= it.h) continue
        const mp = my * it.w + mx
        if (!it.known[mp]) continue
        const sg = ((rect.top + my) * PW + rect.left + mx) * 4
        writePx(
          it.t.plate,
          ((rect.top + y) * PW + rect.left + x) * 4,
          it.t.plate.data[sg]!,
          it.t.plate.data[sg + 1]!,
          it.t.plate.data[sg + 2]!
        )
        it.done[p] = 1
        filled++
        break
      }
    }
  }
  return filled
}

interface Anchor {
  r: number
  g: number
  b: number
  flat: number
  pos: number
}

/** 沿一个方向找最近的连续可见锚点（最多取 4 个求均值与平坦度） */
function findAnchor(it: Prepared, x: number, y: number, dx: number, dy: number): Anchor | null {
  const { rect, mask } = it.t.mask
  const PW = it.t.plate.width
  const data = it.t.plate.data
  let cx = x + dx
  let cy = y + dy
  while (cx >= 0 && cy >= 0 && cx < it.w && cy < it.h) {
    const p = cy * it.w + cx
    if (!mask[p]) return null
    if (it.known[p]) break
    cx += dx
    cy += dy
  }
  if (cx < 0 || cy < 0 || cx >= it.w || cy >= it.h) return null
  const pos = dx ? cx : cy
  const samples: number[][] = []
  let sx = cx
  let sy = cy
  for (let k = 0; k < 4; k++) {
    if (sx < 0 || sy < 0 || sx >= it.w || sy >= it.h) break
    const p = sy * it.w + sx
    if (!it.known[p]) break
    const gi = ((rect.top + sy) * PW + rect.left + sx) * 4
    samples.push([data[gi]!, data[gi + 1]!, data[gi + 2]!])
    sx += dx
    sy += dy
  }
  if (!samples.length) return null
  const r = samples.reduce((s, v) => s + v[0]!, 0) / samples.length
  const g = samples.reduce((s, v) => s + v[1]!, 0) / samples.length
  const b = samples.reduce((s, v) => s + v[2]!, 0) / samples.length
  let flat = 0
  for (const v of samples) {
    flat = Math.max(flat, Math.abs(v[0]! - r), Math.abs(v[1]! - g), Math.abs(v[2]! - b))
  }
  // 只有 1 个样本时无法判断平坦度：保守地加罚
  if (samples.length < 2) flat += 6
  return { r, g, b, flat, pos }
}

function anchorDist(a: Anchor, b: Anchor): number {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b))
}

function computeConsistentRowProfile(
  it: Prepared
): Array<{ r: number; g: number; b: number } | null> {
  const { rect } = it.t.mask
  const PW = it.t.plate.width
  const data = it.t.plate.data
  const x0 = it.w >= 16 ? Math.floor(it.w * 0.14) : 0
  const x1 = it.w >= 16 ? Math.ceil(it.w * 0.86) : it.w
  const step = Math.max(1, Math.floor((x1 - x0) / 64))
  const out: Array<{ r: number; g: number; b: number } | null> = new Array(it.h).fill(null)
  const rs: number[] = []
  const gs: number[] = []
  const bs: number[] = []
  const devs: number[] = []
  for (let y = 0; y < it.h; y++) {
    rs.length = 0
    gs.length = 0
    bs.length = 0
    const row = y * it.w
    const gy = (rect.top + y) * PW
    for (let x = x0; x < x1; x += step) {
      if (!it.known[row + x]) continue
      const gi = (gy + rect.left + x) * 4
      rs.push(data[gi]!)
      gs.push(data[gi + 1]!)
      bs.push(data[gi + 2]!)
    }
    if (rs.length < 4) continue
    const sr = [...rs].sort((a, b) => a - b)
    const sg = [...gs].sort((a, b) => a - b)
    const sb = [...bs].sort((a, b) => a - b)
    const mid = sr.length >> 1
    const mr = sr[mid]!
    const mg = sg[mid]!
    const mb = sb[mid]!
    devs.length = 0
    for (let i = 0; i < rs.length; i++) {
      devs.push(Math.max(Math.abs(rs[i]! - mr), Math.abs(gs[i]! - mg), Math.abs(bs[i]! - mb)))
    }
    devs.sort((a, b) => a - b)
    if (devs[devs.length >> 1]! <= 12) {
      out[y] = { r: mr, g: mg, b: mb }
    }
  }
  return out
}

function fillByAxis(it: Prepared): number {
  const { rect } = it.t.mask
  const PW = it.t.plate.width
  const rowProfile = computeConsistentRowProfile(it)
  const isWideBar = it.w >= it.h * 1.8
  const capInset = Math.min(22, Math.max(6, Math.round(it.h * 0.18)))
  const maxOneSideSpan = Math.max(24, Math.round(it.h * 1.35))
  let filled = 0
  for (let y = 0; y < it.h; y++) {
    for (let x = 0; x < it.w; x++) {
      const p = y * it.w + x
      if (!it.target[p] || it.done[p]) continue
      let best: { r: number; g: number; b: number; cost: number } | null = null
      let horizLeft: Anchor | null | undefined
      let horizRight: Anchor | null | undefined
      for (const [dx, dy] of [
        [1, 0],
        [0, 1]
      ] as const) {
        const a0 = findAnchor(it, x, y, -dx, -dy)
        const a1 = findAnchor(it, x, y, dx, dy)
        if (dx === 1) {
          horizLeft = a0
          horizRight = a1
        }
        if (!a0 || !a1) continue
        if (a0.flat > 12 || a1.flat > 12) continue
        const span = a1.pos - a0.pos
        const gap = anchorDist(a0, a1)
        const maxGap = Math.min(42, 28 + Math.round(Math.max(0, span) * 0.08))
        if (gap > maxGap) continue
        if (dy === 1 && span >= 4) {
          // 防止把外沿深色边距纵向线性拉穿内部横向描边线或胶囊内腔（如语音输入条的青色内框线）
          let crossesStructuredRow = false
          for (let yy = a0.pos + 1; yy < a1.pos; yy++) {
            const rp = rowProfile[yy]
            if (!rp) continue
            const ty = (yy - a0.pos) / span
            const lr = a0.r + (a1.r - a0.r) * ty
            const lg = a0.g + (a1.g - a0.g) * ty
            const lb = a0.b + (a1.b - a0.b) * ty
            if (Math.max(Math.abs(lr - rp.r), Math.abs(lg - rp.g), Math.abs(lb - rp.b)) > 12) {
              crossesStructuredRow = true
              break
            }
          }
          if (crossesStructuredRow) continue
        }
        const tt = span > 0 ? ((dx ? x : y) - a0.pos) / span : 0.5
        const cost = a0.flat + a1.flat + gap * 0.5
        if (!best || cost < best.cost) {
          best = {
            r: a0.r + (a1.r - a0.r) * tt,
            g: a0.g + (a1.g - a0.g) * tt,
            b: a0.b + (a1.b - a0.b) * tt,
            cost
          }
        }
      }
      if (!best && isWideBar && x >= capInset && x <= it.w - 1 - capInset) {
        // 左右两端对称压了圆形按钮时（镜像互补失效、外侧紧邻圆角端帽）：用内侧一致的横向扫描线向端帽内延展
        const rp = rowProfile[y]
        const aInner =
          x < it.w / 2
            ? horizRight !== undefined
              ? horizRight
              : findAnchor(it, x, y, 1, 0)
            : horizLeft !== undefined
              ? horizLeft
              : findAnchor(it, x, y, -1, 0)
        if (
          rp &&
          aInner &&
          aInner.flat <= 11 &&
          Math.abs(aInner.pos - x) <= maxOneSideSpan &&
          Math.max(
            Math.abs(aInner.r - rp.r),
            Math.abs(aInner.g - rp.g),
            Math.abs(aInner.b - rp.b)
          ) <= 12
        ) {
          best = { r: aInner.r, g: aInner.g, b: aInner.b, cost: aInner.flat }
        }
      }
      if (!best) continue
      writePx(
        it.t.plate,
        ((rect.top + y) * PW + rect.left + x) * 4,
        Math.round(best.r),
        Math.round(best.g),
        Math.round(best.b)
      )
      it.done[p] = 1
      filled++
    }
  }
  return filled
}

export interface SilhouetteCompletionInput {
  box: PixelRect
  mask: CanvasMask
  plate: RgbaImage
  kind: string
  repairMode?: string
  ownership: OwnershipMap
  selfPaint: number
  /** 上层剥层羽化外扩半径（默认 4px） */
  occluderPad?: number
}

/**
 * 遮挡区轮廓补全（供由叶向根逐级剥层循环调用）：
 * 当上层角标/按钮跨过下层结构类控件的边或角时，第一遍本地推拉补底会把外侧底色混入该边角，
 * 导致下层控件在分割时边角被啃出一个小缺口。这里利用控件在未遮挡区域的镜像对称性与直线跨度连续性，
 * 只在「上层遮挡区（含羽化带）∩ 元素框」内把被啃掉的二值轮廓补齐，随后再交由 {@link completeOccludedRegions}
 * 填入精确像素，既保留圆角弧度，又消除缺角与底板残留。
 */
export function completeOccludedSilhouette(input: SilhouetteCompletionInput): {
  mask: CanvasMask
  added: number
} {
  if (!STRUCTURED_KINDS.has(input.kind) || input.repairMode === 'image') {
    return { mask: input.mask, added: 0 }
  }
  const W = input.plate.width
  const H = input.plate.height
  const clampedBox = clampRect(input.box, W, H)
  const rawUnion = rectUnion([clampedBox, input.mask.rect]) ?? clampedBox
  const union = clampRect(rawUnion, W, H)
  const w = union.width
  const h = union.height
  const n = w * h
  if (w < 6 || h < 6) return { mask: input.mask, added: 0 }

  const cur = new Uint8Array(n)
  let cMinX = w
  let cMinY = h
  let cMaxX = -1
  let cMaxY = -1
  for (let y = 0; y < input.mask.rect.height; y++) {
    const uy = input.mask.rect.top + y - union.top
    if (uy < 0 || uy >= h) continue
    const mRow = y * input.mask.rect.width
    const uRow = uy * w
    for (let x = 0; x < input.mask.rect.width; x++) {
      if (!input.mask.mask[mRow + x]) continue
      const ux = input.mask.rect.left + x - union.left
      if (ux < 0 || ux >= w) continue
      cur[uRow + ux] = 1
      if (ux < cMinX) cMinX = ux
      if (ux > cMaxX) cMaxX = ux
      if (uy < cMinY) cMinY = uy
      if (uy > cMaxY) cMaxY = uy
    }
  }
  if (cMaxX < cMinX) return { mask: input.mask, added: 0 }

  const inBox = new Uint8Array(n)
  const bx0 = clampedBox.left - union.left
  const by0 = clampedBox.top - union.top
  const bx1 = bx0 + clampedBox.width - 1
  const by1 = by0 + clampedBox.height - 1
  for (let y = Math.max(0, by0); y <= Math.min(h - 1, by1); y++) {
    const row = y * w
    for (let x = Math.max(0, bx0); x <= Math.min(w - 1, bx1); x++) {
      inBox[row + x] = 1
    }
  }

  const rawOcc = new Uint8Array(n)
  let rawOccCount = 0
  for (let y = 0; y < h; y++) {
    const cy = union.top + y
    const row = y * w
    for (let x = 0; x < w; x++) {
      const own = input.ownership.owner[cy * W + union.left + x]!
      if (own >= 0 && (input.ownership.entries[own]?.paintIndex ?? -1) > input.selfPaint) {
        rawOcc[row + x] = 1
        rawOccCount++
      }
    }
  }
  if (rawOccCount < 4) return { mask: input.mask, added: 0 }

  const pad = Math.max(3, Math.round(input.occluderPad ?? 4))
  const uncertain = dilateMask(rawOcc, w, h, pad)
  let missing = 0
  for (let p = 0; p < n; p++) {
    if (inBox[p] && uncertain[p] && !cur[p]) missing++
  }
  if (!missing) return { mask: input.mask, added: 0 }

  const frames: Array<{ x0: number; y0: number; x1: number; y1: number }> = [
    { x0: cMinX, y0: cMinY, x1: cMaxX, y1: cMaxY }
  ]
  if (
    Math.abs(bx0 - cMinX) >= 2 ||
    Math.abs(by0 - cMinY) >= 2 ||
    Math.abs(bx1 - cMaxX) >= 2 ||
    Math.abs(by1 - cMaxY) >= 2
  ) {
    frames.push({
      x0: Math.max(0, bx0),
      y0: Math.max(0, by0),
      x1: Math.min(w - 1, bx1),
      y1: Math.min(h - 1, by1)
    })
  }

  type MirrorFn = [(x: number) => number, (y: number) => number]
  const validMirrors: Array<{ m: MirrorFn; score: number }> = []
  const step = Math.max(1, Math.floor(Math.sqrt(n / 4000)))
  for (const f of frames) {
    const maps: MirrorFn[] = [
      [(x) => f.x0 + f.x1 - x, (y) => y],
      [(x) => x, (y) => f.y0 + f.y1 - y],
      [(x) => f.x0 + f.x1 - x, (y) => f.y0 + f.y1 - y]
    ]
    for (const m of maps) {
      let knownFg = 0
      let pairedTotal = 0
      let mismatch = 0
      let fgPairs = 0
      let rgbSum = 0
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          const p = y * w + x
          if (uncertain[p]) continue
          if (cur[p]) knownFg++
          const mx = m[0](x)
          const my = m[1](y)
          if (mx < 0 || my < 0 || mx >= w || my >= h) continue
          const mp = my * w + mx
          if (uncertain[mp] || mp === p) continue
          pairedTotal++
          if (cur[p] !== cur[mp]) {
            mismatch++
          } else if (cur[p]) {
            fgPairs++
            rgbSum += pixelDistance(
              input.plate.data,
              ((union.top + y) * W + union.left + x) * 4,
              input.plate.data,
              ((union.top + my) * W + union.left + mx) * 4
            )
          }
        }
      }
      if (knownFg < 12 || fgPairs < Math.max(10, knownFg * 0.25)) continue
      const mismatchRate = mismatch / Math.max(1, pairedTotal)
      const rgbErr = rgbSum / fgPairs
      if (mismatchRate <= 0.06 && rgbErr <= 8) {
        validMirrors.push({ m, score: mismatchRate * 100 + rgbErr })
      }
    }
  }
  validMirrors.sort((a, b) => a.score - b.score)

  const out = new Uint8Array(cur)
  let added = 0
  if (validMirrors.length > 0) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x
        if (!inBox[p] || !uncertain[p] || out[p]) continue
        for (const { m } of validMirrors) {
          const mx = m[0](x)
          const my = m[1](y)
          if (mx < 0 || my < 0 || mx >= w || my >= h) continue
          const mp = my * w + mx
          if (uncertain[mp]) continue
          if (cur[mp]) {
            out[p] = 1
            added++
          }
          // 最可信对称轴明确判定该位置在轮廓外（如圆角外侧）时不再回退次优轴
          break
        }
      }
    }
  }

  // 非对称控件被跨边遮挡（例如左侧带图标的按钮顶部压了一个角标）：沿同行/同列两侧可信同色前景直线补齐
  const maxSpan = Math.max(8, Math.round(Math.max(w, h) * 0.6))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (!inBox[p] || !uncertain[p] || out[p]) continue
      for (const [dx, dy] of [
        [1, 0],
        [0, 1]
      ] as const) {
        let x0 = x - dx
        let y0 = y - dy
        let steps0 = 0
        while (
          x0 >= 0 &&
          y0 >= 0 &&
          x0 < w &&
          y0 < h &&
          uncertain[y0 * w + x0] &&
          steps0 < maxSpan
        ) {
          x0 -= dx
          y0 -= dy
          steps0++
        }
        if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) continue
        const p0 = y0 * w + x0
        if (uncertain[p0] || !cur[p0]) continue

        let x1 = x + dx
        let y1 = y + dy
        let steps1 = 0
        while (
          x1 >= 0 &&
          y1 >= 0 &&
          x1 < w &&
          y1 < h &&
          uncertain[y1 * w + x1] &&
          steps1 < maxSpan
        ) {
          x1 += dx
          y1 += dy
          steps1++
        }
        if (x1 < 0 || y1 < 0 || x1 >= w || y1 >= h) continue
        const p1 = y1 * w + x1
        if (uncertain[p1] || !cur[p1]) continue

        const dRgb = pixelDistance(
          input.plate.data,
          ((union.top + y0) * W + union.left + x0) * 4,
          input.plate.data,
          ((union.top + y1) * W + union.left + x1) * 4
        )
        if (dRgb <= 24) {
          out[p] = 1
          added++
          break
        }
      }
    }
  }

  if (!added) return { mask: input.mask, added: 0 }

  let oMinX = w
  let oMinY = h
  let oMaxX = -1
  let oMaxY = -1
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      if (!out[row + x]) continue
      if (x < oMinX) oMinX = x
      if (x > oMaxX) oMaxX = x
      if (y < oMinY) oMinY = y
      if (y > oMaxY) oMaxY = y
    }
  }
  const tw = oMaxX - oMinX + 1
  const th = oMaxY - oMinY + 1
  const tight = new Uint8Array(tw * th)
  for (let y = 0; y < th; y++) {
    tight.set(out.subarray((oMinY + y) * w + oMinX, (oMinY + y) * w + oMinX + tw), y * tw)
  }
  return {
    mask: {
      rect: { left: union.left + oMinX, top: union.top + oMinY, width: tw, height: th },
      mask: tight
    },
    added
  }
}

/**
 * 对所有结构类元素执行遮挡区确定性补全，原地修改各自的 plates[level+1]。
 * 可选传入已剥离层级的只读 `donors` 参与跨层级预制体分组与像素借用，避免重复计分与重复改写。
 */
export function completeOccludedRegions(input: {
  targets: readonly CompletionTarget[]
  donors?: readonly CompletionTarget[]
  ownership: OwnershipMap
}): CompletionReport {
  const report: CompletionReport = { instances: 0, mirror: 0, axis: 0, kept: 0, prefabGroups: [] }
  const prepared: Prepared[] = []
  // 预制体分组用全部结构类元素（包括没有遮挡的实例与跨层级只读样本：它们提供真实像素）
  const allForGrouping: Prepared[] = []
  const targetIds = new Set<string>()
  for (const t of input.targets) {
    targetIds.add(t.id)
    if (!STRUCTURED_KINDS.has(t.kind) || t.repairMode === 'image') continue
    const pr = prepare(t, input.ownership)
    if (pr) {
      prepared.push(pr)
      allForGrouping.push(pr)
    } else {
      const { width: w, height: h } = t.mask.rect
      const known = new Uint8Array(t.mask.mask)
      allForGrouping.push({
        t,
        w,
        h,
        known,
        target: new Uint8Array(w * h),
        targetCount: 0,
        done: new Uint8Array(w * h)
      })
    }
  }
  if (input.donors?.length) {
    for (const d of input.donors) {
      if (targetIds.has(d.id)) continue
      if (!STRUCTURED_KINDS.has(d.kind) || d.repairMode === 'image') continue
      const pr = prepare(d, input.ownership)
      const { width: w, height: h } = d.mask.rect
      const known = pr ? pr.known : new Uint8Array(d.mask.mask)
      allForGrouping.push({
        t: d,
        w,
        h,
        known,
        target: new Uint8Array(w * h),
        targetCount: 0,
        done: new Uint8Array(w * h)
      })
    }
  }
  if (!prepared.length && allForGrouping.length < 2) return report

  for (const group of groupInstances(allForGrouping)) {
    if (group.some((g) => targetIds.has(g.t.id))) {
      report.prefabGroups.push(group.map((g) => g.t.id))
    }
    report.instances += fillFromInstances(group)
  }
  for (const it of prepared) {
    report.mirror += fillByMirror(it)
    report.axis += fillByAxis(it)
    for (let p = 0; p < it.done.length; p++) if (it.target[p] && !it.done[p]) report.kept++
  }
  return report
}
