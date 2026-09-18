/** 从网格顶点（+ 可选边）推人形关节，不套固定头身比。 */

export type Vec3 = [number, number, number]

export interface MeshGraph {
  points: Vec3[]
  adj: number[][]
}

export interface HumanoidBoneSpec {
  name: string
  parent: string
  head: Vec3
  tail: Vec3
}

export const HUMANOID_BONE_NAMES = [
  'Hips',
  'Spine',
  'Chest',
  'Neck',
  'Head',
  'L_Shoulder',
  'L_UpperArm',
  'L_ForeArm',
  'L_Hand',
  'R_Shoulder',
  'R_UpperArm',
  'R_ForeArm',
  'R_Hand',
  'L_UpLeg',
  'L_LoLeg',
  'L_Foot',
  'L_Toes',
  'R_UpLeg',
  'R_LoLeg',
  'R_Foot',
  'R_Toes'
] as const

export function emptyAdj(n: number): number[][] {
  return Array.from({ length: n }, () => [])
}

export function addEdge(adj: number[][], a: number, b: number): void {
  if (a === b || a < 0 || b < 0 || a >= adj.length || b >= adj.length) return
  adj[a].push(b)
  adj[b].push(a)
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function mul(a: Vec3, t: number): Vec3 {
  return [a[0] * t, a[1] * t, a[2] * t]
}

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return add(a, mul(sub(b, a), t))
}

function dist2(a: Vec3, b: Vec3): number {
  const d = sub(a, b)
  return d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
}

function ensureLen(a: Vec3, b: Vec3, minLen: number): Vec3 {
  if (dist2(a, b) >= minLen * minLen) return b
  return [a[0], a[1], a[2] + minLen]
}

function axisExtents(points: Vec3[]): { min: Vec3; max: Vec3; size: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const p of points) {
    for (let i = 0; i < 3; i++) {
      if (p[i] < min[i]) min[i] = p[i]
      if (p[i] > max[i]) max[i] = p[i]
    }
  }
  return { min, max, size: sub(max, min) }
}

/** 站立角色：最长轴为 up；side 取 X（若 up 不是 X），否则 Z。 */
export function detectStandingAxes(points: Vec3[]): {
  up: 0 | 1 | 2
  side: 0 | 1 | 2
  fwd: 0 | 1 | 2
} {
  const { size } = axisExtents(points)
  let up: 0 | 1 | 2 = 1
  if (size[2] >= size[1] && size[2] >= size[0]) up = 2
  else if (size[0] >= size[1] && size[0] >= size[2]) up = 0
  const side: 0 | 1 | 2 = up === 0 ? 2 : 0
  const fwd = ([0, 1, 2] as const).find((i) => i !== up && i !== side) ?? 1
  return { up, side, fwd }
}

function comp(p: Vec3, axis: 0 | 1 | 2): number {
  return p[axis]
}

function bfsUntil(adj: number[][], start: number, ok: (i: number) => boolean): number[] {
  const prev = new Map<number, number>()
  prev.set(start, -1)
  const q = [start]
  let hit = -1
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi]!
    if (ok(i) && i !== start) {
      hit = i
      break
    }
    for (const j of adj[i] ?? []) {
      if (!prev.has(j)) {
        prev.set(j, i)
        q.push(j)
      }
    }
  }
  if (hit < 0) return []
  const path: number[] = []
  let i = hit
  while (i >= 0) {
    path.push(i)
    i = prev.get(i) ?? -1
  }
  path.reverse()
  return path
}

function pathPoint(points: Vec3[], path: number[], t: number): Vec3 {
  if (!path.length) return [0, 0, 0]
  const idx = Math.max(0, Math.min(path.length - 1, Math.round((path.length - 1) * t)))
  return points[path[idx]!]!
}

function pathIndexAt(t: number, len: number): number {
  return Math.max(0, Math.min(len - 1, Math.round((len - 1) * t)))
}

function highestOnPath(points: Vec3[], path: number[], up: 0 | 1 | 2): { pt: Vec3; idx: number } {
  let idx = path.length - 1
  let best = -Infinity
  for (let k = 0; k < path.length; k++) {
    const u = points[path[k]!]![up]
    if (u >= best) {
      best = u
      idx = k
    }
  }
  return { pt: points[path[idx]!]!, idx }
}

function centroid(points: Vec3[], pred: (p: Vec3, i: number) => boolean): Vec3 | null {
  let x = 0
  let y = 0
  let z = 0
  let n = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!
    if (!pred(p, i)) continue
    x += p[0]
    y += p[1]
    z += p[2]
    n++
  }
  if (!n) return null
  return [x / n, y / n, z / n]
}

function bone(
  name: string,
  parent: string,
  head: Vec3,
  tail: Vec3,
  minLen: number
): HumanoidBoneSpec {
  return { name, parent, head, tail: ensureLen(head, tail, minLen) }
}

/**
 * 用端点 + 网格连通（手/脚走到躯干）估计 21 骨。
 * 长发/裙子会干扰时，连通路径比包围盒比例可靠；路径失败才退回比例。
 */
export function detectHumanoidJoints(graph: MeshGraph): {
  bones: HumanoidBoneSpec[]
  usedFallback: boolean
} {
  const { points, adj } = graph
  if (points.length < 8) {
    return { bones: fallbackBones(points), usedFallback: true }
  }
  const axes = detectStandingAxes(points)
  const { min, size } = axisExtents(points)
  const ur = Math.max(size[axes.up], 1e-4)
  const sr = Math.max(size[axes.side], 1e-4)
  const cx = min[axes.side] + size[axes.side] * 0.5
  const unorm = (p: Vec3) => (comp(p, axes.up) - min[axes.up]) / ur
  const sidev = (p: Vec3) => comp(p, axes.side)
  const fwdv = (p: Vec3) => comp(p, axes.fwd)

  const midW: number[] = []
  for (const p of points) {
    const u = unorm(p)
    if (u >= 0.35 && u <= 0.7) midW.push(Math.abs(sidev(p) - cx))
  }
  midW.sort((a, b) => a - b)
  const torsoR = Math.max(midW.length ? midW[Math.floor(midW.length * 0.35)]! : sr * 0.2, sr * 0.14)

  const hasEdges = adj.some((n) => n.length > 0)
  const atTorso = (i: number) => Math.abs(sidev(points[i]!) - cx) <= torsoR * 1.25

  const pickExtreme = (
    sideSign: 1 | -1,
    lo: number,
    hi: number,
    mode: 'side' | 'upMin' | 'fwdMax'
  ) => {
    let best = -1
    let score = mode === 'upMin' ? Infinity : -Infinity
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!
      const u = unorm(p)
      if (u < lo || u > hi) continue
      const s = sidev(p) - cx
      if (sideSign > 0 && s <= 0) continue
      if (sideSign < 0 && s >= 0) continue
      if (mode === 'side') {
        const v = Math.abs(s)
        if (v > score) {
          score = v
          best = i
        }
      } else if (mode === 'upMin') {
        const v = comp(p, axes.up)
        if (v < score) {
          score = v
          best = i
        }
      } else {
        const v = fwdv(p)
        if (v > score) {
          score = v
          best = i
        }
      }
    }
    return best
  }

  const pickHand = (sideSign: 1 | -1): { tip: number; path: number[] } => {
    const ranked: Array<{ i: number; w: number }> = []
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!
      const u = unorm(p)
      if (u < 0.28 || u > 0.9) continue
      const s = sidev(p) - cx
      if (sideSign > 0 && s <= 0) continue
      if (sideSign < 0 && s >= 0) continue
      ranked.push({ i, w: Math.abs(s) })
    }
    ranked.sort((a, b) => b.w - a.w)
    let bestI = ranked[0]?.i ?? -1
    let bestPath: number[] = []
    let bestScore = -Infinity
    const limit = Math.min(20, ranked.length)
    for (let k = 0; k < limit; k++) {
      const i = ranked[k]!.i
      let path: number[] = []
      if (hasEdges) path = bfsUntil(adj, i, atTorso)
      if (path.length < 4) {
        if (bestI < 0) bestI = i
        continue
      }
      const topU = Math.max(...path.map((j) => unorm(points[j]!)))
      if (topU > 0.93) continue
      const endU = unorm(points[path[path.length - 1]!]!)
      const score = Math.abs(sidev(points[i]!) - cx) + (endU > 0.52 ? sr * 0.15 : 0)
      if (score > bestScore) {
        bestScore = score
        bestI = i
        bestPath = path
      }
    }
    return { tip: bestI, path: bestPath }
  }

  const head =
    centroid(points, (p) => unorm(p) > 0.88 && Math.abs(sidev(p) - cx) < sr * 0.22) ??
    points[pickExtreme(1, 0.85, 1, 'side')] ??
    points[0]!

  const lHand = pickHand(1)
  const rHand = pickHand(-1)
  const lFootI = pickExtreme(1, 0, 0.28, 'upMin')
  const rFootI = pickExtreme(-1, 0, 0.28, 'upMin')
  const lToeI = pickExtreme(1, 0, 0.12, 'fwdMax')
  const rToeI = pickExtreme(-1, 0, 0.12, 'fwdMax')

  const lFoot = lFootI >= 0 ? points[lFootI]! : lerp(head, [cx, 0, 0], 1)
  const rFoot = rFootI >= 0 ? points[rFootI]! : lFoot
  const lToe = lToeI >= 0 ? points[lToeI]! : lFoot
  const rToe = rToeI >= 0 ? points[rToeI]! : rFoot
  const lHandP = lHand.tip >= 0 ? points[lHand.tip]! : head
  const rHandP = rHand.tip >= 0 ? points[rHand.tip]! : head

  const lFootPath = lFootI >= 0 && hasEdges ? bfsUntil(adj, lFootI, atTorso) : []
  const rFootPath = rFootI >= 0 && hasEdges ? bfsUntil(adj, rFootI, atTorso) : []

  const lShoHit = lHand.path.length >= 4 ? highestOnPath(points, lHand.path, axes.up) : null
  const rShoHit = rHand.path.length >= 4 ? highestOnPath(points, rHand.path, axes.up) : null
  const lShoulder = lShoHit?.pt ?? lerp(lHandP, head, 0.72)
  const rShoulder = rShoHit?.pt ?? lerp(rHandP, head, 0.72)
  const lElbow = lShoHit
    ? points[lHand.path[pathIndexAt(0.5, lShoHit.idx + 1)]!]!
    : lerp(lShoulder, lHandP, 0.5)
  const rElbow = rShoHit
    ? points[rHand.path[pathIndexAt(0.5, rShoHit.idx + 1)]!]!
    : lerp(rShoulder, rHandP, 0.5)
  const lWrist =
    lHand.path.length >= 4 ? pathPoint(points, lHand.path, 0.12) : lerp(lElbow, lHandP, 0.72)
  const rWrist =
    rHand.path.length >= 4 ? pathPoint(points, rHand.path, 0.12) : lerp(rElbow, rHandP, 0.72)

  let lHip = lFootPath.length >= 4 ? pathPoint(points, lFootPath, 1) : lerp(lFoot, lShoulder, 0.52)
  let rHip = rFootPath.length >= 4 ? pathPoint(points, rFootPath, 1) : lerp(rFoot, rShoulder, 0.52)
  const shoulderU = (unorm(lShoulder) + unorm(rShoulder)) * 0.5
  const hipU = (unorm(lHip) + unorm(rHip)) * 0.5
  if (shoulderU - hipU < 0.12) {
    const raised = min[axes.up] + ur * Math.max(0.22, shoulderU - 0.32)
    lHip = [...lHip] as Vec3
    rHip = [...rHip] as Vec3
    lHip[axes.up] = raised
    rHip[axes.up] = raised
  }
  const lKnee = lFootPath.length >= 4 ? pathPoint(points, lFootPath, 0.5) : lerp(lHip, lFoot, 0.5)
  const rKnee = rFootPath.length >= 4 ? pathPoint(points, rFootPath, 0.5) : lerp(rHip, rFoot, 0.5)

  const hips = mul(add(lHip, rHip), 0.5)
  const chest =
    centroid(points, (p) => {
      const u = unorm(p)
      return (
        u > (unorm(hips) + shoulderU) * 0.5 - 0.04 &&
        u < shoulderU + 0.02 &&
        Math.abs(sidev(p) - cx) < torsoR
      )
    }) ?? lerp(hips, head, 0.62)
  const neck =
    centroid(
      points,
      (p) =>
        unorm(p) > shoulderU - 0.02 &&
        unorm(p) < unorm(head) - 0.04 &&
        Math.abs(sidev(p) - cx) < torsoR * 0.7
    ) ?? lerp(chest, head, 0.45)
  const spine = lerp(hips, chest, 0.45)

  const minLen = ur * 0.012
  const usedFallback = lHand.path.length < 4 && rHand.path.length < 4
  const bones: HumanoidBoneSpec[] = [
    bone('Hips', '', hips, spine, minLen),
    bone('Spine', 'Hips', spine, chest, minLen),
    bone('Chest', 'Spine', chest, neck, minLen),
    bone('Neck', 'Chest', neck, lerp(neck, head, 0.55), minLen),
    bone('Head', 'Neck', lerp(neck, head, 0.55), head, minLen),
    bone('L_Shoulder', 'Chest', lerp(neck, lShoulder, 0.35), lShoulder, minLen),
    bone('L_UpperArm', 'L_Shoulder', lShoulder, lElbow, minLen),
    bone('L_ForeArm', 'L_UpperArm', lElbow, lWrist, minLen),
    bone('L_Hand', 'L_ForeArm', lWrist, lHandP, minLen),
    bone('R_Shoulder', 'Chest', lerp(neck, rShoulder, 0.35), rShoulder, minLen),
    bone('R_UpperArm', 'R_Shoulder', rShoulder, rElbow, minLen),
    bone('R_ForeArm', 'R_UpperArm', rElbow, rWrist, minLen),
    bone('R_Hand', 'R_ForeArm', rWrist, rHandP, minLen),
    bone('L_UpLeg', 'Hips', lHip, lKnee, minLen),
    bone('L_LoLeg', 'L_UpLeg', lKnee, lFoot, minLen),
    bone('L_Foot', 'L_LoLeg', lFoot, lerp(lFoot, lToe, 0.65), minLen),
    bone('L_Toes', 'L_Foot', lerp(lFoot, lToe, 0.65), lToe, minLen),
    bone('R_UpLeg', 'Hips', rHip, rKnee, minLen),
    bone('R_LoLeg', 'R_UpLeg', rKnee, rFoot, minLen),
    bone('R_Foot', 'R_LoLeg', rFoot, lerp(rFoot, rToe, 0.65), minLen),
    bone('R_Toes', 'R_Foot', lerp(rFoot, rToe, 0.65), rToe, minLen)
  ]
  return { bones, usedFallback }
}

function fallbackBones(points: Vec3[]): HumanoidBoneSpec[] {
  const { min, size } = axisExtents(points.length ? points : [[0, 0, 0]])
  const axes = points.length
    ? detectStandingAxes(points)
    : { up: 2 as const, side: 0 as const, fwd: 1 as const }
  const wp = (side: number, fwd: number, h: number): Vec3 => {
    const p: Vec3 = [0, 0, 0]
    p[axes.side] = min[axes.side] + (side * 0.5 + 0.5) * Math.max(size[axes.side], 0.001)
    p[axes.fwd] = min[axes.fwd] + (fwd * 0.5 + 0.5) * Math.max(size[axes.fwd], 0.001)
    p[axes.up] = min[axes.up] + h * Math.max(size[axes.up], 0.001)
    return p
  }
  const specs: Array<[string, string, Vec3, Vec3]> = [
    ['Hips', '', wp(0, 0.02, 0.5), wp(0, 0, 0.56)],
    ['Spine', 'Hips', wp(0, 0, 0.56), wp(0, 0, 0.66)],
    ['Chest', 'Spine', wp(0, 0, 0.66), wp(0, 0, 0.76)],
    ['Neck', 'Chest', wp(0, 0, 0.76), wp(0, 0, 0.84)],
    ['Head', 'Neck', wp(0, 0, 0.84), wp(0, 0.02, 0.98)],
    ['L_Shoulder', 'Chest', wp(0.1, 0.02, 0.8), wp(0.2, 0.02, 0.8)],
    ['L_UpperArm', 'L_Shoulder', wp(0.2, 0.02, 0.8), wp(0.38, 0.04, 0.72)],
    ['L_ForeArm', 'L_UpperArm', wp(0.38, 0.04, 0.72), wp(0.54, 0.04, 0.6)],
    ['L_Hand', 'L_ForeArm', wp(0.54, 0.04, 0.6), wp(0.66, 0.04, 0.54)],
    ['R_Shoulder', 'Chest', wp(-0.1, 0.02, 0.8), wp(-0.2, 0.02, 0.8)],
    ['R_UpperArm', 'R_Shoulder', wp(-0.2, 0.02, 0.8), wp(-0.38, 0.04, 0.72)],
    ['R_ForeArm', 'R_UpperArm', wp(-0.38, 0.04, 0.72), wp(-0.54, 0.04, 0.6)],
    ['R_Hand', 'R_ForeArm', wp(-0.54, 0.04, 0.6), wp(-0.66, 0.04, 0.54)],
    ['L_UpLeg', 'Hips', wp(0.11, 0.02, 0.5), wp(0.12, 0.03, 0.28)],
    ['L_LoLeg', 'L_UpLeg', wp(0.12, 0.03, 0.28), wp(0.11, 0.04, 0.06)],
    ['L_Foot', 'L_LoLeg', wp(0.11, 0.04, 0.06), wp(0.11, 0.16, 0.02)],
    ['L_Toes', 'L_Foot', wp(0.11, 0.16, 0.02), wp(0.11, 0.24, 0.02)],
    ['R_UpLeg', 'Hips', wp(-0.11, 0.02, 0.5), wp(-0.12, 0.03, 0.28)],
    ['R_LoLeg', 'R_UpLeg', wp(-0.12, 0.03, 0.28), wp(-0.11, 0.04, 0.06)],
    ['R_Foot', 'R_LoLeg', wp(-0.11, 0.04, 0.06), wp(-0.11, 0.16, 0.02)],
    ['R_Toes', 'R_Foot', wp(-0.11, 0.16, 0.02), wp(-0.11, 0.24, 0.02)]
  ]
  return specs.map(([name, parent, head, tail]) => ({ name, parent, head, tail }))
}
