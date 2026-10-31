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
import { dilateMask, pixelDistance } from './pixels'
import type { RgbaImage } from './types'

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

function fillByAxis(it: Prepared): number {
  const { rect } = it.t.mask
  const PW = it.t.plate.width
  let filled = 0
  for (let y = 0; y < it.h; y++) {
    for (let x = 0; x < it.w; x++) {
      const p = y * it.w + x
      if (!it.target[p] || it.done[p]) continue
      let best: { r: number; g: number; b: number; cost: number } | null = null
      for (const [dx, dy] of [
        [1, 0],
        [0, 1]
      ] as const) {
        const a0 = findAnchor(it, x, y, -dx, -dy)
        const a1 = findAnchor(it, x, y, dx, dy)
        if (!a0 || !a1) continue
        if (a0.flat > 8 || a1.flat > 8) continue
        const gap = anchorDist(a0, a1)
        if (gap > 28) continue
        const span = a1.pos - a0.pos
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

/**
 * 对所有结构类元素执行遮挡区确定性补全，原地修改各自的 plates[level+1]。
 */
export function completeOccludedRegions(input: {
  targets: readonly CompletionTarget[]
  ownership: OwnershipMap
}): CompletionReport {
  const report: CompletionReport = { instances: 0, mirror: 0, axis: 0, kept: 0, prefabGroups: [] }
  const prepared: Prepared[] = []
  // 预制体分组用全部结构类元素（包括没有遮挡的实例：它们提供真实像素）
  const allForGrouping: Prepared[] = []
  for (const t of input.targets) {
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
  if (!prepared.length && allForGrouping.length < 2) return report

  for (const group of groupInstances(allForGrouping)) {
    report.prefabGroups.push(group.map((g) => g.t.id))
    report.instances += fillFromInstances(group)
  }
  for (const it of prepared) {
    report.mirror += fillByMirror(it)
    report.axis += fillByAxis(it)
    for (let p = 0; p < it.done.length; p++) if (it.target[p] && !it.done[p]) report.kept++
  }
  return report
}
