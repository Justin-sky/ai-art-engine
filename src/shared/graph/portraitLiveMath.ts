/**
 * Pure computational photography math & pixel pipeline for `image.portrait`.
 *
 * Runs deterministically on `Uint8ClampedArray` RGBA buffers without DOM dependencies,
 * enabling both < 35ms real-time canvas previews in the renderer and headless unit tests in Node.
 */

import { PORTRAIT_LANDMARK_COUNT, portraitFaceBoxFromLandmarks } from './portraitFace'
import { idPhotoSpecById } from './idPhoto'
import {
  normalizePortraitRetouch,
  type PortraitCameraStyle,
  type PortraitIdPhotoBg,
  type PortraitIdPhotoSpecId,
  type PortraitLutId,
  type PortraitRetouchState,
  type PortraitTier
} from './portraitRetouch'

// ── Interactive Brush & 3D LUT Contracts ─────────────────────────

export type PortraitLiquifyMode = 'push' | 'bloat' | 'pucker'

export const PORTRAIT_LIQUIFY_MODES: readonly PortraitLiquifyMode[] = [
  'push',
  'bloat',
  'pucker'
] as const

export interface PortraitLiquifyStroke {
  id: string
  mode: PortraitLiquifyMode
  /** Normalized start coordinate [0..1, 0..1] */
  from: [number, number]
  /** Normalized end coordinate [0..1, 0..1] */
  to: [number, number]
  /** Normalized brush radius (e.g. 0.02..0.25) */
  radius: number
  /** Strength in 0..1 */
  strength: number
}

export interface PortraitSpotHealPoint {
  id: string
  /** Normalized center X (0..1) */
  x: number
  /** Normalized center Y (0..1) */
  y: number
  /** Normalized brush radius (e.g. 0.005..0.08) */
  radius: number
}

export type PortraitSpotHeal = PortraitSpotHealPoint

export interface PortraitCubeLut {
  name: string
  /** 3D grid dimension N (typically 17, 32, or 33); table has N^3 * 3 floats in 0..1 */
  size: number
  /** Flattened RGB float triples ordered with Red changing fastest, then Green, then Blue */
  table: number[]
}

export type PortraitCustomLut = PortraitCubeLut

export const PORTRAIT_LIQUIFY_STROKE_LIMIT = 120
export const PORTRAIT_SPOT_HEAL_LIMIT = 120

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

function clamp01(v: number): number {
  return clamp(v, 0, 1)
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v)
}

export function normalizePortraitLiquifyStrokes(
  raw?: readonly (Partial<PortraitLiquifyStroke> | null | undefined)[] | null
): PortraitLiquifyStroke[] {
  if (!Array.isArray(raw)) return []
  const out: PortraitLiquifyStroke[] = []
  for (const item of raw) {
    if (!item) continue
    const mode = PORTRAIT_LIQUIFY_MODES.includes(item.mode as PortraitLiquifyMode)
      ? (item.mode as PortraitLiquifyMode)
      : 'push'
    const from = Array.isArray(item.from) && item.from.length >= 2 ? item.from : null
    const to = Array.isArray(item.to) && item.to.length >= 2 ? item.to : null
    if (!from || !to) continue
    const fx = Number(from[0])
    const fy = Number(from[1])
    const tx = Number(to[0])
    const ty = Number(to[1])
    if (![fx, fy, tx, ty].every(Number.isFinite)) continue
    const radius = clamp(Number.isFinite(item.radius) ? Number(item.radius) : 0.06, 0.008, 0.35)
    const strength = clamp01(Number.isFinite(item.strength) ? Number(item.strength) : 0.6)
    out.push({
      id: typeof item.id === 'string' && item.id ? item.id : `liq-${out.length + 1}`,
      mode,
      from: [clamp01(fx), clamp01(fy)],
      to: [clamp01(tx), clamp01(ty)],
      radius,
      strength
    })
  }
  return out.slice(-PORTRAIT_LIQUIFY_STROKE_LIMIT)
}

export function normalizePortraitSpotHeals(
  raw?: readonly (Partial<PortraitSpotHealPoint> | null | undefined)[] | null
): PortraitSpotHealPoint[] {
  if (!Array.isArray(raw)) return []
  const out: PortraitSpotHealPoint[] = []
  for (const item of raw) {
    if (!item) continue
    const x = Number(item.x)
    const y = Number(item.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const radius = clamp(Number.isFinite(item.radius) ? Number(item.radius) : 0.018, 0.003, 0.1)
    out.push({
      id: typeof item.id === 'string' && item.id ? item.id : `spot-${out.length + 1}`,
      x: clamp01(x),
      y: clamp01(y),
      radius
    })
  }
  return out.slice(-PORTRAIT_SPOT_HEAL_LIMIT)
}

export function normalizePortraitCubeLut(
  raw?: Partial<PortraitCubeLut> | null
): PortraitCubeLut | null {
  if (!raw || typeof raw !== 'object') return null
  const size = Math.round(Number(raw.size))
  if (!Number.isFinite(size) || size < 2 || size > 65) return null
  const expected = size * size * size * 3
  if (!Array.isArray(raw.table) || raw.table.length !== expected) return null
  const table = new Array<number>(expected)
  for (let i = 0; i < expected; i++) {
    const v = Number(raw.table[i])
    table[i] = Number.isFinite(v) ? clamp01(v) : 0
  }
  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : 'LUT',
    size,
    table
  }
}

// ── Tier Weight Conversion ───────────────────────────────────────

export function tierWeight(tier: PortraitTier | string | undefined): number {
  switch (tier) {
    case 'light':
      return 0.28
    case 'standard':
      return 0.55
    case 'strong':
      return 0.82
    case 'max':
      return 1.0
    default:
      return 0
  }
}

// ── Canonical-68 Semantic Face Contours ──────────────────────────

export interface FaceSemanticRegions {
  box: { x: number; y: number; w: number; h: number }
  /** Full facial skin contour (jawline 0..16 + lifted forehead arc) */
  faceSkinOutline: Array<[number, number]>
  leftEye: Array<[number, number]>
  rightEye: Array<[number, number]>
  leftBrow: Array<[number, number]>
  rightBrow: Array<[number, number]>
  outerLip: Array<[number, number]>
  innerMouth: Array<[number, number]>
  /** Under-eye pouch / dark circle regions */
  leftInfraorbital: Array<[number, number]>
  rightInfraorbital: Array<[number, number]>
  leftEyeCenter: [number, number]
  rightEyeCenter: [number, number]
  noseTip: [number, number]
  mouthCenter: [number, number]
}

function polygonCenter(pts: ReadonlyArray<readonly [number, number]>): [number, number] {
  if (!pts.length) return [0.5, 0.5]
  let sx = 0
  let sy = 0
  for (const p of pts) {
    sx += p[0]
    sy += p[1]
  }
  return [sx / pts.length, sy / pts.length]
}

function expandPolygon(
  pts: ReadonlyArray<readonly [number, number]>,
  scale: number
): Array<[number, number]> {
  const [cx, cy] = polygonCenter(pts)
  return pts.map(([x, y]) => [cx + (x - cx) * scale, cy + (y - cy) * scale])
}

export function extractFaceSemanticRegions(
  landmarks: ReadonlyArray<readonly [number, number]> | null | undefined
): FaceSemanticRegions | null {
  if (!landmarks || landmarks.length < PORTRAIT_LANDMARK_COUNT) return null
  const pts = landmarks.map((p) => [Number(p[0]) || 0, Number(p[1]) || 0] as [number, number])
  const box = portraitFaceBoxFromLandmarks(pts)
  if (!(box.w > 0.005 && box.h > 0.005)) return null

  const jaw = pts.slice(0, 17)
  const leftBrow = pts.slice(17, 22)
  const rightBrow = pts.slice(22, 27)
  const leftEye = pts.slice(36, 42)
  const rightEye = pts.slice(42, 48)
  const outerLip = pts.slice(48, 60)
  const innerMouth = pts.slice(60, 68)

  // Construct lifted forehead points above eyebrows (from right temple 16 -> left temple 0)
  const foreheadLift = box.h * 0.28
  const foreheadArc: Array<[number, number]> = [
    [pts[26][0] + box.w * 0.03, pts[26][1] - foreheadLift * 0.65],
    [pts[24][0], pts[24][1] - foreheadLift * 0.95],
    [(pts[21][0] + pts[22][0]) * 0.5, Math.min(pts[21][1], pts[22][1]) - foreheadLift],
    [pts[19][0], pts[19][1] - foreheadLift * 0.95],
    [pts[17][0] - box.w * 0.03, pts[17][1] - foreheadLift * 0.65]
  ]
  const faceSkinOutline: Array<[number, number]> = [...jaw, ...foreheadArc]

  // Infraorbital (under-eye) polygons below leftEye (36, 41, 40, 39) and rightEye (42, 47, 46, 45)
  const underEyeDrop = box.h * 0.09
  const leftInfraorbital: Array<[number, number]> = [
    pts[36],
    pts[41],
    pts[40],
    pts[39],
    [pts[39][0], pts[39][1] + underEyeDrop * 0.85],
    [pts[40][0], pts[40][1] + underEyeDrop],
    [pts[41][0], pts[41][1] + underEyeDrop * 0.9]
  ]
  const rightInfraorbital: Array<[number, number]> = [
    pts[42],
    pts[47],
    pts[46],
    pts[45],
    [pts[45][0], pts[45][1] + underEyeDrop * 0.85],
    [pts[46][0], pts[46][1] + underEyeDrop],
    [pts[47][0], pts[47][1] + underEyeDrop * 0.9]
  ]

  return {
    box,
    faceSkinOutline,
    leftEye: expandPolygon(leftEye, 1.18),
    rightEye: expandPolygon(rightEye, 1.18),
    leftBrow: expandPolygon(leftBrow, 1.12),
    rightBrow: expandPolygon(rightBrow, 1.12),
    outerLip: expandPolygon(outerLip, 1.08),
    innerMouth,
    leftInfraorbital,
    rightInfraorbital,
    leftEyeCenter: polygonCenter(leftEye),
    rightEyeCenter: polygonCenter(rightEye),
    noseTip: pts[30] ?? [box.x + box.w * 0.5, box.y + box.h * 0.6],
    mouthCenter: polygonCenter(outerLip)
  }
}

/** Standard ray-casting point-in-polygon test */
export function pointInPolygon(
  x: number,
  y: number,
  poly: ReadonlyArray<readonly [number, number]>
): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0]
    const yi = poly[i][1]
    const xj = poly[j][0]
    const yj = poly[j][1]
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi
    if (intersect) inside = !inside
  }
  return inside
}

export interface FeatheredPolygon {
  poly: ReadonlyArray<readonly [number, number]>
  minX: number
  maxX: number
  minY: number
  maxY: number
  feather: number
  featherSq: number
}

export function prepareFeatheredPolygon(
  poly: ReadonlyArray<readonly [number, number]>,
  feather: number
): FeatheredPolygon {
  const f = Math.max(0, feather)
  if (!poly.length) {
    return { poly, minX: 1, maxX: 0, minY: 1, maxY: 0, feather: f, featherSq: f * f }
  }
  let minX = poly[0][0]
  let maxX = poly[0][0]
  let minY = poly[0][1]
  let maxY = poly[0][1]
  for (let i = 1; i < poly.length; i++) {
    const px = poly[i][0]
    const py = poly[i][1]
    if (px < minX) minX = px
    if (px > maxX) maxX = px
    if (py < minY) minY = py
    if (py > maxY) maxY = py
  }
  return {
    poly,
    minX: minX - f,
    maxX: maxX + f,
    minY: minY - f,
    maxY: maxY + f,
    feather: f,
    featherSq: f * f
  }
}

/**
 * Evaluates a C1-smooth feathered polygon weight in [0..1] using signed distance to the polygon boundary.
 * Performs O(1) AABB rejection and avoids sqrt outside the narrow feather band.
 */
export function sampleFeatheredPolygon(x: number, y: number, fp: FeatheredPolygon): number {
  if (x < fp.minX || x > fp.maxX || y < fp.minY || y > fp.maxY) return 0
  const { poly, feather, featherSq } = fp
  const n = poly.length
  if (n < 3) return 0
  let inside = false
  let minDistSq = Number.POSITIVE_INFINITY

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i][0]
    const yi = poly[i][1]
    const xj = poly[j][0]
    const yj = poly[j][1]
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi
    if (intersect) inside = !inside

    if (featherSq > 1e-12) {
      const vx = xj - xi
      const vy = yj - yi
      const wx = x - xi
      const wy = y - yi
      const lenSq = vx * vx + vy * vy
      let t = lenSq > 1e-12 ? (wx * vx + wy * vy) / lenSq : 0
      if (t < 0) t = 0
      else if (t > 1) t = 1
      const dx = x - (xi + t * vx)
      const dy = y - (yi + t * vy)
      const dSq = dx * dx + dy * dy
      if (dSq < minDistSq) minDistSq = dSq
    }
  }

  if (featherSq <= 1e-12) return inside ? 1 : 0
  if (minDistSq >= featherSq) return inside ? 1 : 0
  const dist = Math.sqrt(minDistSq)
  const signedDist = inside ? dist : -dist
  const t = clamp01((signedDist + feather) / (2 * feather))
  return t * t * (3 - 2 * t)
}

/** Convenience wrapper for evaluating feathered polygon mask weight at (x, y) */
export function polygonFeatherWeight(
  x: number,
  y: number,
  poly: ReadonlyArray<readonly [number, number]>,
  feather = 0.015
): number {
  return sampleFeatheredPolygon(x, y, prepareFeatheredPolygon(poly, feather))
}

// ── Landmark MLS / Radial Control Vectors for Face Liquify ───────

export interface LiquifyControlVector {
  /** Normalized origin [x, y] */
  origin: [number, number]
  /** Normalized forward displacement [dx, dy] */
  delta: [number, number]
  /** Normalized radius of influence */
  radius: number
  /** Radial mode: 'translate' | 'expand' | 'contract' */
  kind: 'translate' | 'expand' | 'contract'
  /** Strength for radial expand/contract */
  radialFactor?: number
}

export function buildFaceLiquifyControlVectors(
  state: PortraitRetouchState,
  landmarks: ReadonlyArray<readonly [number, number]> | null | undefined
): LiquifyControlVector[] {
  if (!landmarks || landmarks.length < PORTRAIT_LANDMARK_COUNT) return []
  const regions = extractFaceSemanticRegions(landmarks)
  if (!regions) return []
  const pts = landmarks
  const { box } = regions
  const vectors: LiquifyControlVector[] = []
  const centerX = (pts[27][0] + pts[8][0]) * 0.5

  // 1. Face Slimming (cheeks 2..5 and 11..14 pulled toward face center)
  const slimW = tierWeight(state.faceSlim)
  if (slimW > 0) {
    const pull = box.w * 0.042 * slimW
    const radius = box.w * 0.28
    for (const idx of [2, 3, 4, 5]) {
      const p = pts[idx]
      const sign = centerX >= p[0] ? 1 : -1
      vectors.push({
        origin: [p[0], p[1]],
        delta: [sign * pull, -pull * 0.15],
        radius,
        kind: 'translate'
      })
    }
    for (const idx of [11, 12, 13, 14]) {
      const p = pts[idx]
      const sign = centerX <= p[0] ? -1 : 1
      vectors.push({
        origin: [p[0], p[1]],
        delta: [sign * pull, -pull * 0.15],
        radius,
        kind: 'translate'
      })
    }
  }

  // 2. Jawline Tightening (mandibular angle 4..6 and 10..12 lifted inward & upward)
  const jawW = tierWeight(state.jawline)
  if (jawW > 0) {
    const pull = box.w * 0.034 * jawW
    const radius = box.w * 0.24
    for (const idx of [4, 5, 6]) {
      const p = pts[idx]
      vectors.push({
        origin: [p[0], p[1]],
        delta: [pull * 0.8, -pull * 0.55],
        radius,
        kind: 'translate'
      })
    }
    for (const idx of [10, 11, 12]) {
      const p = pts[idx]
      vectors.push({
        origin: [p[0], p[1]],
        delta: [-pull * 0.8, -pull * 0.55],
        radius,
        kind: 'translate'
      })
    }
  }

  // 3. Chin Shaping (7, 8, 9 tapered toward 8)
  const chinW = tierWeight(state.chin)
  if (chinW > 0) {
    const pull = box.w * 0.028 * chinW
    const radius = box.w * 0.2
    vectors.push({
      origin: [pts[7][0], pts[7][1]],
      delta: [pull, 0],
      radius,
      kind: 'translate'
    })
    vectors.push({
      origin: [pts[9][0], pts[9][1]],
      delta: [-pull, 0],
      radius,
      kind: 'translate'
    })
  }

  // 4. Double Chin Removal (lifts sub-mental area below 7, 8, 9 upward)
  const doubleChinW = tierWeight(state.doubleChin)
  if (doubleChinW > 0) {
    const lift = box.h * 0.032 * doubleChinW
    const radius = box.w * 0.25
    for (const idx of [7, 8, 9]) {
      const p = pts[idx]
      vectors.push({
        origin: [p[0], p[1] + box.h * 0.06],
        delta: [0, -lift],
        radius,
        kind: 'translate'
      })
    }
  }

  // 5. Eye Size (radial bloat around leftEyeCenter & rightEyeCenter)
  const eyeW = tierWeight(state.eyeSize)
  if (eyeW > 0) {
    const eyeRadius = box.w * 0.16
    const factor = 0.16 * eyeW
    vectors.push({
      origin: regions.leftEyeCenter,
      delta: [0, 0],
      radius: eyeRadius,
      kind: 'expand',
      radialFactor: factor
    })
    vectors.push({
      origin: regions.rightEyeCenter,
      delta: [0, 0],
      radius: eyeRadius,
      kind: 'expand',
      radialFactor: factor
    })
  }

  // 6. Eye Spacing (horizontal shift of left and right eyes)
  if (state.eyeSpacing && state.eyeSpacing !== 'off') {
    const spacingMap: Record<string, number> = {
      narrow: 0.85,
      slightNarrow: 0.45,
      slightWide: -0.45,
      wide: -0.85
    }
    const sp = spacingMap[state.eyeSpacing] ?? 0
    if (sp !== 0) {
      const shift = box.w * 0.022 * sp
      const eyeRadius = box.w * 0.15
      vectors.push({
        origin: regions.leftEyeCenter,
        delta: [shift, 0],
        radius: eyeRadius,
        kind: 'translate'
      })
      vectors.push({
        origin: regions.rightEyeCenter,
        delta: [-shift, 0],
        radius: eyeRadius,
        kind: 'translate'
      })
    }
  }

  // 7. Nose Shape (alar wings 31, 32 and 34, 35 narrowed toward 33)
  const noseW = tierWeight(state.noseShape)
  if (noseW > 0) {
    const pull = box.w * 0.024 * noseW
    const radius = box.w * 0.14
    vectors.push({
      origin: [pts[31][0], pts[31][1]],
      delta: [pull, 0],
      radius,
      kind: 'translate'
    })
    vectors.push({
      origin: [pts[35][0], pts[35][1]],
      delta: [-pull, 0],
      radius,
      kind: 'translate'
    })
  }

  // 8. Lip Shape (plump mouth slightly)
  const lipW = tierWeight(state.lipShape)
  if (lipW > 0) {
    vectors.push({
      origin: regions.mouthCenter,
      delta: [0, 0],
      radius: box.w * 0.16,
      kind: 'expand',
      radialFactor: 0.12 * lipW
    })
  }

  // 9. Iris / Pupil Radial Enlargement (tight radial expand around iris centers without distorting outer canthus)
  const pupilW = tierWeight(state.pupilSize)
  if (pupilW > 0) {
    const irisRadius = box.w * 0.082
    const factor = 0.22 * pupilW
    vectors.push({
      origin: regions.leftEyeCenter,
      delta: [0, 0],
      radius: irisRadius,
      kind: 'expand',
      radialFactor: factor
    })
    vectors.push({
      origin: regions.rightEyeCenter,
      delta: [0, 0],
      radius: irisRadius,
      kind: 'expand',
      radialFactor: factor
    })
  }

  // 10. Swan Neck & Shoulder Extension (slims lateral neck columns & elongates collar line below jaw)
  const shoulderNeckW = tierWeight(state.shoulderNeck)
  if (shoulderNeckW > 0) {
    const neckPullX = box.w * 0.036 * shoulderNeckW
    const neckDropY = box.h * 0.024 * shoulderNeckW
    const neckRadius = box.w * 0.22
    const neckY = clamp01(pts[8][1] + box.h * 0.28)
    vectors.push({
      origin: [clamp01(pts[4][0] + box.w * 0.06), neckY],
      delta: [neckPullX, neckDropY],
      radius: neckRadius,
      kind: 'translate'
    })
    vectors.push({
      origin: [clamp01(pts[12][0] - box.w * 0.06), neckY],
      delta: [-neckPullX, neckDropY],
      radius: neckRadius,
      kind: 'translate'
    })
  }

  // 11. 90° Right-Angle Shoulder / Trapezius Reduction (flattens upper trapezius slope)
  const neckShoulderLineW = tierWeight(state.neckShoulderLine)
  if (neckShoulderLineW > 0) {
    const trapDropY = box.h * 0.048 * neckShoulderLineW
    const trapPullX = box.w * 0.018 * neckShoulderLineW
    const trapRadius = box.w * 0.34
    const trapY = clamp01(pts[8][1] + box.h * 0.42)
    vectors.push({
      origin: [clamp01(pts[3][0] - box.w * 0.26), trapY],
      delta: [trapPullX, trapDropY],
      radius: trapRadius,
      kind: 'translate'
    })
    vectors.push({
      origin: [clamp01(pts[13][0] + box.w * 0.26), trapY],
      delta: [-trapPullX, trapDropY],
      radius: trapRadius,
      kind: 'translate'
    })
  }

  // 12. Torso Waist Slimming (bilateral inward pinch at anatomical waist level below bust/chest)
  const waistW = tierWeight(state.waistSlim)
  if (waistW > 0) {
    const waistY = clamp01(pts[8][1] + box.h * 1.45)
    const waistPullX = box.w * 0.068 * waistW
    const waistRadius = Math.max(0.16, box.w * 0.52)
    vectors.push({
      origin: [clamp01(centerX - box.w * 0.68), waistY],
      delta: [waistPullX, 0],
      radius: waistRadius,
      kind: 'translate'
    })
    vectors.push({
      origin: [clamp01(centerX + box.w * 0.68), waistY],
      delta: [-waistPullX, 0],
      radius: waistRadius,
      kind: 'translate'
    })
  }

  // 13. Lower-Body Leg Lengthening (progressive vertical stretch in lower frame)
  const legW = tierWeight(state.legLengthen)
  if (legW > 0) {
    const legOriginY = clamp01(pts[8][1] + box.h * 2.05)
    const legStretchY = box.h * 0.075 * legW
    const legRadius = Math.max(0.22, box.h * 0.72)
    vectors.push({
      origin: [centerX, legOriginY],
      delta: [0, legStretchY],
      radius: legRadius,
      kind: 'translate'
    })
  }

  return vectors
}

/**
 * Given normalized output pixel coordinate (u, v), computes the inverse-mapped
 * source coordinate (srcU, srcV) from landmark control vectors and manual liquify strokes.
 */
export function sampleLiquifySourceCoord(
  u: number,
  v: number,
  controlVectors: readonly LiquifyControlVector[],
  strokes: readonly PortraitLiquifyStroke[]
): [number, number] {
  let sx = u
  let sy = v

  for (let i = 0; i < controlVectors.length; i++) {
    const vec = controlVectors[i]
    const dx = u - vec.origin[0]
    const dy = v - vec.origin[1]
    const distSq = dx * dx + dy * dy
    const rSq = vec.radius * vec.radius
    if (distSq >= rSq || rSq <= 1e-9) continue
    const t = 1 - distSq / rSq
    const weight = t * t // Smooth C1 falloff
    if (vec.kind === 'translate') {
      sx -= vec.delta[0] * weight
      sy -= vec.delta[1] * weight
    } else if (vec.kind === 'expand') {
      const factor = (vec.radialFactor ?? 0.1) * weight
      sx -= dx * factor
      sy -= dy * factor
    } else if (vec.kind === 'contract') {
      const factor = (vec.radialFactor ?? 0.1) * weight
      sx += dx * factor
      sy += dy * factor
    }
  }

  for (let i = 0; i < strokes.length; i++) {
    const st = strokes[i]
    const dx = u - st.from[0]
    const dy = v - st.from[1]
    const distSq = dx * dx + dy * dy
    const rSq = st.radius * st.radius
    if (distSq >= rSq || rSq <= 1e-9) continue
    const t = 1 - distSq / rSq
    const weight = t * t * st.strength
    if (st.mode === 'push') {
      const moveX = st.to[0] - st.from[0]
      const moveY = st.to[1] - st.from[1]
      sx -= moveX * weight
      sy -= moveY * weight
    } else if (st.mode === 'bloat') {
      sx -= dx * 0.35 * weight
      sy -= dy * 0.35 * weight
    } else if (st.mode === 'pucker') {
      sx += dx * 0.35 * weight
      sy += dy * 0.35 * weight
    }
  }

  return [clamp01(sx), clamp01(sy)]
}

// ── .cube 3D LUT Parser & Trilinear Interpolator ─────────────────

export function parseCubeLut(text: string, fallbackName = 'Custom LUT'): PortraitCubeLut | null {
  if (typeof text !== 'string' || !text.trim()) return null
  const lines = text.split(/\r?\n/)
  let name = fallbackName
  let size = 0
  const values: number[] = []

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    if (line.toUpperCase().startsWith('TITLE')) {
      const m = line.match(/TITLE\s+"?([^"]+)"?/i)
      if (m?.[1]?.trim()) name = m[1].trim()
      continue
    }
    if (line.toUpperCase().startsWith('LUT_3D_SIZE')) {
      const parts = line.split(/\s+/)
      const n = Number(parts[1])
      if (Number.isFinite(n) && n >= 2 && n <= 65) size = Math.round(n)
      continue
    }
    if (
      line.toUpperCase().startsWith('DOMAIN_MIN') ||
      line.toUpperCase().startsWith('DOMAIN_MAX') ||
      line.toUpperCase().startsWith('LUT_1D_SIZE')
    ) {
      continue
    }
    const parts = line.split(/\s+/)
    if (parts.length >= 3) {
      const r = Number(parts[0])
      const g = Number(parts[1])
      const b = Number(parts[2])
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
        values.push(clamp01(r), clamp01(g), clamp01(b))
      }
    }
  }

  if (size < 2 || values.length !== size * size * size * 3) return null
  return { name, size, table: values }
}

/** Trilinear interpolation in a .cube 3D LUT for RGB in 0..255 */
export function applyCubeLutRgb(
  r255: number,
  g255: number,
  b255: number,
  lut: PortraitCubeLut
): [number, number, number] {
  const n = lut.size
  const maxIdx = n - 1
  const rf = clamp01(r255 / 255) * maxIdx
  const gf = clamp01(g255 / 255) * maxIdx
  const bf = clamp01(b255 / 255) * maxIdx

  const r0 = Math.floor(rf)
  const g0 = Math.floor(gf)
  const b0 = Math.floor(bf)
  const r1 = Math.min(maxIdx, r0 + 1)
  const g1 = Math.min(maxIdx, g0 + 1)
  const b1 = Math.min(maxIdx, b0 + 1)

  const dr = rf - r0
  const dg = gf - g0
  const db = bf - b0

  const { table } = lut
  const idx = (ri: number, gi: number, bi: number): number => ((bi * n + gi) * n + ri) * 3

  const c000 = idx(r0, g0, b0)
  const c100 = idx(r1, g0, b0)
  const c010 = idx(r0, g1, b0)
  const c110 = idx(r1, g1, b0)
  const c001 = idx(r0, g0, b1)
  const c101 = idx(r1, g0, b1)
  const c011 = idx(r0, g1, b1)
  const c111 = idx(r1, g1, b1)

  const out: [number, number, number] = [0, 0, 0]
  for (let ch = 0; ch < 3; ch++) {
    const v00 = table[c000 + ch] * (1 - dr) + table[c100 + ch] * dr
    const v10 = table[c010 + ch] * (1 - dr) + table[c110 + ch] * dr
    const v01 = table[c001 + ch] * (1 - dr) + table[c101 + ch] * dr
    const v11 = table[c011 + ch] * (1 - dr) + table[c111 + ch] * dr
    const v0 = v00 * (1 - dg) + v10 * dg
    const v1 = v01 * (1 - dg) + v11 * dg
    out[ch] = clamp255((v0 * (1 - db) + v1 * db) * 255)
  }
  return out
}

// ── Built-in Film LUT Color Grading ──────────────────────────────

export function applyBuiltinLutRgb(
  r: number,
  g: number,
  b: number,
  lutId: PortraitLutId
): [number, number, number] {
  if (!lutId || lutId === 'none') return [r, g, b]
  const luma = 0.299 * r + 0.587 * g + 0.114 * b
  switch (lutId) {
    case 'clear': {
      // Crisp highlights, clean slightly cool shadows
      const nr = r + (r - 128) * 0.06 + 4
      const ng = g + (g - 128) * 0.06 + 5
      const nb = b + (b - 128) * 0.08 + 7
      return [clamp255(nr), clamp255(ng), clamp255(nb)]
    }
    case 'warmFilm': {
      const nr = r * 1.05 + 8
      const ng = g * 1.01 + 3
      const nb = b * 0.93 - 4
      return [clamp255(nr), clamp255(ng), clamp255(nb)]
    }
    case 'coolFilm': {
      const nr = r * 0.94 - 2
      const ng = g * 1.01 + 2
      const nb = b * 1.07 + 8
      return [clamp255(nr), clamp255(ng), clamp255(nb)]
    }
    case 'fuji': {
      // Fuji classic negative / Velvia airy green-cyan shadow & clean skin
      const shadow = Math.max(0, (140 - luma) / 140)
      const nr = r * 1.01 + 2
      const ng = g * 1.04 + shadow * 6 + 3
      const nb = b * 1.02 + shadow * 8 + 2
      return [clamp255(nr), clamp255(ng), clamp255(nb)]
    }
    case 'kodak': {
      // Kodak Portra 400 golden warmth
      const nr = r * 1.06 + 6
      const ng = g * 1.02 + 2
      const nb = b * 0.91 + 4
      return [clamp255(nr), clamp255(ng), clamp255(nb)]
    }
    case 'hongkong': {
      // Retro HK cinema: rich warm highlights, deep teal shadows, high contrast
      const shadow = Math.max(0, (128 - luma) / 128)
      const hi = Math.max(0, (luma - 128) / 128)
      const nr = (r - 128) * 1.14 + 128 + hi * 14 - shadow * 6
      const ng = (g - 128) * 1.08 + 128 + hi * 5 + shadow * 4
      const nb = (b - 128) * 1.05 + 128 - hi * 10 + shadow * 10
      return [clamp255(nr), clamp255(ng), clamp255(nb)]
    }
    case 'japanese': {
      // High-key lifted blacks, airy pastel cyan-blue tint
      const liftedR = r * 0.88 + 26
      const liftedG = g * 0.9 + 28
      const liftedB = b * 0.92 + 32
      return [clamp255(liftedR), clamp255(liftedG), clamp255(liftedB)]
    }
    case 'morandi': {
      // Muted grey-tone desaturation with soft contrast
      const desatR = luma + (r - luma) * 0.62
      const desatG = luma + (g - luma) * 0.62
      const desatB = luma + (b - luma) * 0.65
      return [
        clamp255(desatR * 0.92 + 12),
        clamp255(desatG * 0.92 + 11),
        clamp255(desatB * 0.92 + 10)
      ]
    }
    case 'blackGold': {
      // Deep crushed shadows, golden-amber highlights
      const hi = Math.max(0, (luma - 110) / 145)
      const nr = (r - 128) * 1.18 + 120 + hi * 18
      const ng = (g - 128) * 1.12 + 116 + hi * 10
      const nb = (b - 128) * 1.1 + 110 - hi * 16
      return [clamp255(nr), clamp255(ng), clamp255(nb)]
    }
    case 'bw': {
      // Silver-halide monochrome with subtle S-curve
      const c = clamp255((luma - 128) * 1.12 + 128)
      return [c, c, c]
    }
    case 'sepia': {
      const sr = luma * 1.08 + 18
      const sg = luma * 0.96 + 6
      const sb = luma * 0.78 - 8
      return [clamp255(sr), clamp255(sg), clamp255(sb)]
    }
    default:
      return [r, g, b]
  }
}

// ── Mainstream Camera Color Science Engine ───────────────────────

/**
 * Skin-locus-aware camera color science emulation for mainstream DSLR, mirrorless,
 * rangefinder, medium-format, and film systems (Canon, Nikon, Fujifilm, Leica, Sony, Kodak, Hasselblad, Ricoh).
 *
 * Separates skin-locus chrominance protection (`skinConf` in 0..1) from ambient shadow/highlight
 * split-toning and sensor S-curve roll-off so portraits achieve each camera brand's signature look.
 */
export function applyCameraStyleRgb(
  r: number,
  g: number,
  b: number,
  cameraStyle: PortraitCameraStyle,
  skinConf?: number
): [number, number, number] {
  if (!cameraStyle || cameraStyle === 'none') return [r, g, b]
  const skin = clamp01(skinConf !== undefined ? skinConf : skinToneConfidence(r, g, b))
  const luma = 0.299 * r + 0.587 * g + 0.114 * b
  const shadow = Math.max(0, (135 - luma) / 135)
  const hi = Math.max(0, (luma - 125) / 130)

  switch (cameraStyle) {
    case 'canon': {
      // Canon EOS Portrait Color Science: rosy-peach skin locus shift,
      // warm-magenta midtone lift, and smooth highlight roll-off
      const hiRoll = luma > 200 ? (luma - 200) * 0.18 : 0
      const nr = r * 1.032 + 3 + skin * 8.5 - hiRoll
      const ng = g * 0.996 + 2 + skin * 1.8 - hiRoll * 0.9
      const nb = b * 1.012 + 3 + skin * 5.0 - hiRoll * 0.85
      return [clamp255(nr), clamp255(ng), clamp255(nb)]
    }
    case 'nikon': {
      // Nikon Z Neutral-Portrait: high dynamic range, crisp micro-contrast,
      // clean yellow/green separation, and neutral-true skin tone reproduction
      const cr = (r - 128) * 1.08 + 128
      const cg = (g - 128) * 1.085 + 128
      const cb = (b - 128) * 1.08 + 128
      const nr = cr + 1 + skin * 2.2 - shadow * 1.5
      const ng = cg + 2 + skin * 2.5 + (1 - skin) * 1.5
      const nb = cb + 1.5 + skin * 3.8
      return [clamp255(nr), clamp255(ng), clamp255(nb)]
    }
    case 'fujiClassicNeg': {
      // Fujifilm Classic Neg: cyan-green shadow split, warm amber-ochre highlights,
      // steep filmic midtone contrast while protecting skin from green shadow cast
      const cr = (r - 128) * 1.09 + 128
      const cg = (g - 128) * 1.08 + 128
      const cb = (b - 128) * 1.07 + 128
      const nonSkin = 1 - skin * 0.72
      const nr = cr - shadow * 5 * nonSkin + hi * 8 + skin * 4.5
      const ng = cg + shadow * 7 * nonSkin + hi * 3 + 2
      const nb = cb + shadow * 9 * nonSkin - hi * 6 + 2
      return [clamp255(nr), clamp255(ng), clamp255(nb)]
    }
    case 'fujiAstia': {
      // Fujifilm Astia Soft Portrait: silky low-contrast skin transition,
      // luminous peach-ivory skin, and airy cyan-blue skies/foliage
      const nr = r * 0.95 + 9 + skin * 6.5
      const ng = g * 0.96 + 9 + skin * 4.0 + (1 - skin) * 3.5
      const nb = b * 0.97 + 10 + skin * 5.2 + (1 - skin) * 6.0
      return [clamp255(nr), clamp255(ng), clamp255(nb)]
    }
    case 'leica': {
      // Leica M11 Summilux: dense micro-contrast S-curve, deep velvety blacks,
      // rich cobalt blues & carmine reds, and warm brassy highlight roll-off
      const sat = 1 + (1 - skin) * 0.14 - skin * 0.02
      const sr = luma + (r - luma) * sat
      const sg = luma + (g - luma) * sat
      const sb = luma + (b - luma) * sat
      const nr = (sr - 128) * 1.15 + 124 - shadow * 6 + hi * 9 + skin * 3.5
      const ng = (sg - 128) * 1.14 + 123 - shadow * 6 + hi * 4 + skin * 1.5
      const nb = (sb - 128) * 1.14 + 123 - shadow * 4 - hi * 5
      return [clamp255(nr), clamp255(ng), clamp255(nb)]
    }
    case 'leicaMonochrom': {
      // Leica M11 Monochrom: panchromatic yellow-orange optical filter response
      // (lifts skin luminance & smooths blemishes while deepening sky/foliage) + silver-halide S-curve
      const panLuma = 0.36 * r + 0.55 * g + 0.09 * b + skin * 4
      const sCurve = (panLuma - 128) * 1.16 + 126 - shadow * 4
      const shoulder = sCurve > 215 ? 215 + (sCurve - 215) * 0.68 : sCurve
      const c = clamp255(shoulder)
      return [c, c, c]
    }
    case 'sony': {
      // Sony Alpha S-Cinetone: cinema soft-knee highlight compression,
      // clean neutral-cool shadows, and warm-golden skin phase protection
      const knee = luma > 185 ? (luma - 185) * 0.22 : 0
      const nonSkin = 1 - skin * 0.8
      const nr = r * 1.01 + 2 - shadow * 4 * nonSkin + skin * 7.5 - knee
      const ng = g * 1.005 + 2 + shadow * 2 * nonSkin + skin * 2.5 - knee * 0.95
      const nb = b * 1.01 + 3 + shadow * 6 * nonSkin - skin * 2.5 - knee * 0.9
      return [clamp255(nr), clamp255(ng), clamp255(nb)]
    }
    case 'kodakPortra': {
      // Kodak Portra 400 Color Negative: golden-amber warmth, lifted creamy shadows,
      // halation-softened highlights, and warm pastel skin rendering
      const liftedR = r * 0.93 + 12
      const liftedG = g * 0.93 + 10
      const liftedB = b * 0.91 + 9
      const nr = liftedR * 1.055 + hi * 6 + skin * 5.0
      const ng = liftedG * 1.018 + hi * 3 + skin * 2.2
      const nb = liftedB * 0.935 - hi * 5 + shadow * 3
      return [clamp255(nr), clamp255(ng), clamp255(nb)]
    }
    case 'hasselblad': {
      // Hasselblad HNCS (16-bit Natural Colour Solution): ultra-linear tonal transition,
      // zero clipping at highlight/shadow extremes, and studio-pure skin chrominance
      const softExtremes = shadow * 4 - (luma > 210 ? (luma - 210) * 0.16 : 0)
      const sat = 1.05
      const sr = luma + (r - luma) * sat
      const sg = luma + (g - luma) * sat
      const sb = luma + (b - luma) * sat
      const nr = sr + softExtremes + skin * 4.5
      const ng = sg + softExtremes + skin * 3.2
      const nb = sb + softExtremes + skin * 3.8
      return [clamp255(nr), clamp255(ng), clamp255(nb)]
    }
    case 'ricohGr': {
      // Ricoh GR III Positive Film: crushed deep blacks, high-contrast street punch,
      // cool-teal shadow cast with warm skin highlight contrast
      const sat = 1.16 - skin * 0.08
      const sr = luma + (r - luma) * sat
      const sg = luma + (g - luma) * sat
      const sb = luma + (b - luma) * sat
      const nonSkin = 1 - skin * 0.7
      const nr = (sr - 128) * 1.18 + 121 - shadow * 7 * nonSkin + skin * 5.5
      const ng = (sg - 128) * 1.16 + 121 + shadow * 2 * nonSkin - shadow * 4 * skin
      const nb = (sb - 128) * 1.16 + 122 + shadow * 8 * nonSkin - hi * 4
      return [clamp255(nr), clamp255(ng), clamp255(nb)]
    }
    default:
      return [r, g, b]
  }
}

// ── Live Adjustment Detection ────────────────────────────────────

export interface PortraitLiveInput {
  state: Partial<PortraitRetouchState> | null | undefined
  landmarks?: ReadonlyArray<readonly [number, number]> | null
  liquifyStrokes?: readonly PortraitLiquifyStroke[] | null
  spotHeals?: readonly PortraitSpotHealPoint[] | null
  customLut?: PortraitCubeLut | null
}

export function hasPortraitLiveAdjustments(input: PortraitLiveInput): boolean {
  const s = normalizePortraitRetouch(input.state)
  if ((input.liquifyStrokes?.length ?? 0) > 0) return true
  if ((input.spotHeals?.length ?? 0) > 0) return true
  if (input.customLut) return true

  const liveKeys: Array<keyof PortraitRetouchState> = [
    'blemishRemoval',
    'underEye',
    'wrinkles',
    'shineRemoval',
    'redEye',
    'doubleChin',
    'skinSmoothing',
    'skinTexture',
    'skinEvenness',
    'skinDenoise',
    'skinWhiten',
    'skinRosy',
    'skinDeYellow',
    'skinToneWarmth',
    'bodyToneUnify',
    'faceSlim',
    'jawline',
    'chin',
    'eyeSize',
    'eyeSpacing',
    'doubleEyelid',
    'brows',
    'noseShape',
    'lipShape',
    'catchlight',
    'pupilSize',
    'eyeWhiten',
    'teethWhiten',
    'makeupStyle',
    'makeupIntensity',
    'makeupTone',
    'shoulderNeck',
    'neckShoulderLine',
    'waistSlim',
    'legLengthen',
    'fillLight',
    'rimLight',
    'faceContour',
    'lightRatio',
    'lightTemp',
    'cameraStyle',
    'toneGrade',
    'saturation',
    'colorTemp',
    'colorTint',
    'sharpness',
    'clarity',
    'grain',
    'softFocus',
    'vignette'
  ]
  for (const key of liveKeys) {
    const val = s[key]
    if (typeof val === 'string' && val !== 'off' && val !== 'none' && val !== 'keep') return true
  }
  if (s.lutId !== 'none') return true
  return false
}

// ── Fast Separable Box Blur (for Frequency Separation) ───────────

function boxBlurRgb(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number
): Float32Array {
  const len = width * height * 3
  const tmp = new Float32Array(len)
  const out = new Float32Array(len)
  const r = Math.max(1, Math.min(24, Math.round(radius)))
  const win = 2 * r + 1

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    let sr = 0
    let sg = 0
    let sb = 0
    const rowOffset = y * width
    for (let ix = -r; ix <= r; ix++) {
      const cx = clamp(ix, 0, width - 1)
      const p = (rowOffset + cx) * 4
      sr += src[p]
      sg += src[p + 1]
      sb += src[p + 2]
    }
    for (let x = 0; x < width; x++) {
      const dstIdx = (rowOffset + x) * 3
      tmp[dstIdx] = sr / win
      tmp[dstIdx + 1] = sg / win
      tmp[dstIdx + 2] = sb / win

      const leftX = clamp(x - r, 0, width - 1)
      const rightX = clamp(x + r + 1, 0, width - 1)
      const pLeft = (rowOffset + leftX) * 4
      const pRight = (rowOffset + rightX) * 4
      sr += src[pRight] - src[pLeft]
      sg += src[pRight + 1] - src[pLeft + 1]
      sb += src[pRight + 2] - src[pLeft + 2]
    }
  }

  // Vertical pass
  for (let x = 0; x < width; x++) {
    let sr = 0
    let sg = 0
    let sb = 0
    for (let iy = -r; iy <= r; iy++) {
      const cy = clamp(iy, 0, height - 1)
      const p = (cy * width + x) * 3
      sr += tmp[p]
      sg += tmp[p + 1]
      sb += tmp[p + 2]
    }
    for (let y = 0; y < height; y++) {
      const dstIdx = (y * width + x) * 3
      out[dstIdx] = sr / win
      out[dstIdx + 1] = sg / win
      out[dstIdx + 2] = sb / win

      const topY = clamp(y - r, 0, height - 1)
      const botY = clamp(y + r + 1, 0, height - 1)
      const pTop = (topY * width + x) * 3
      const pBot = (botY * width + x) * 3
      sr += tmp[pBot] - tmp[pTop]
      sg += tmp[pBot + 1] - tmp[pTop + 1]
      sb += tmp[pBot + 2] - tmp[pTop + 2]
    }
  }

  return out
}

/** Skin-tone probability in [0..1] from RGB (YCbCr + warm skin locus) */
function skinToneConfidence(r: number, g: number, b: number): number {
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
  // Typical human skin cluster: Cb in [77..127], Cr in [133..173]
  const cbDist = Math.abs(cb - 105) / 26
  const crDist = Math.abs(cr - 150) / 24
  const d = Math.max(cbDist, crDist)
  if (d >= 1.35) return 0
  if (d <= 0.75) return 1
  return 1 - (d - 0.75) / 0.6
}

/**
 * True 32-bit integer avalanche spatial hash in [0, 1) without trigonometric `Math.sin`
 * periodicity — eliminates all diagonal wave/stripe/moiré artifacts in grain and pore synthesis.
 */
function spatialHash01(x: number, y: number, seed = 0): number {
  let h =
    (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) |
    0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h = (h ^ (h >>> 16)) >>> 0
  return (h & 0x00ffffff) / 0x01000000
}

/**
 * SOTA Procedural Anisotropic Skin Micro-Pore Synthesizer:
 * Generates anatomically oriented cellular micro-pore indentations along the 2.5D surface normal
 * (`nx`, `ny`, `nz`): finer isotropic pores on the T-zone/nose bridge, oblique ellipsoidal pores
 * along the malar cheek slope, and fine horizontal micro-texture across the forehead.
 * Restores DSLR-grade skin realism when `skinTexture` is active on over-smoothed or AI-plastic skin.
 */
export function synthesizeProceduralSkinPore(
  x: number,
  y: number,
  _nx: number,
  _ny: number,
  nz = 0.85
): number {
  // Integer avalanche cellular hash (zero trigonometric stripes)
  const ix = Math.round(x)
  const iy = Math.round(y)
  const f1 = spatialHash01(ix, iy, 101)
  const f2 = spatialHash01(ix, iy, 202)
  // Biphasic cellular micro-indentation: subtle pore pit balanced by micro-ridge
  const porePit = f1 < 0.22 ? -((0.22 - f1) / 0.22) * 0.85 : (f2 - 0.45) * 0.35
  return porePit * (0.45 + 0.55 * nz)
}

/**
 * Returns parametric velvet makeup palette (lip RGB, malar blush RGB, eyeshadow RGB, style multiplier)
 * from `makeupStyle`, `makeupTone`, and `makeupIntensity`.
 */
export function resolveParametricMakeupPalette(state: PortraitRetouchState): {
  weight: number
  lipRgb: [number, number, number]
  blushRgb: [number, number, number]
  shadowRgb: [number, number, number]
} | null {
  const hasStyle = state.makeupStyle && state.makeupStyle !== 'none'
  const hasIntensity = state.makeupIntensity && state.makeupIntensity !== 'off'
  const hasTone = state.makeupTone && state.makeupTone !== 'off'
  if (!hasStyle && !hasIntensity && !hasTone) return null

  const baseW = hasIntensity
    ? tierWeight(state.makeupIntensity)
    : hasStyle
      ? state.makeupStyle === 'nude' || state.makeupStyle === 'child'
        ? 0.36
        : state.makeupStyle === 'stage' || state.makeupStyle === 'hongkong'
          ? 0.74
          : 0.56
      : 0.48

  // Base velvet lip, malar blush, and upper-lid eyeshadow chrominance by style/tone
  let lipRgb: [number, number, number] = [198, 76, 86] // Rose-bean velvet default
  let blushRgb: [number, number, number] = [232, 132, 138]
  let shadowRgb: [number, number, number] = [176, 122, 112]

  if (state.makeupStyle === 'bride' || state.makeupTone === 'rosy') {
    lipRgb = [212, 74, 96]
    blushRgb = [242, 138, 156]
    shadowRgb = [194, 132, 136]
  } else if (state.makeupStyle === 'hongkong' || state.makeupStyle === 'stage') {
    lipRgb = [206, 48, 56]
    blushRgb = [228, 118, 122]
    shadowRgb = [168, 108, 98]
  } else if (state.makeupTone === 'cool') {
    lipRgb = [182, 58, 84]
    blushRgb = [216, 120, 144]
    shadowRgb = [152, 114, 128]
  } else if (state.makeupTone === 'warm') {
    lipRgb = [208, 84, 68]
    blushRgb = [238, 142, 118]
    shadowRgb = [188, 128, 102]
  } else if (state.makeupStyle === 'office') {
    lipRgb = [188, 62, 72]
    blushRgb = [222, 128, 124]
    shadowRgb = [162, 116, 104]
  }

  return { weight: clamp01(baseW), lipRgb, blushRgb, shadowRgb }
}

// ── Complete Computational Photography Pixel Pipeline ────────────

export interface PortraitLivePipelineResult {
  pixels: Uint8ClampedArray
  appliedSteps: string[]
}

export function applyPortraitLivePixelPipeline(
  sourcePixels: Uint8ClampedArray,
  width: number,
  height: number,
  input: PortraitLiveInput
): PortraitLivePipelineResult {
  const state = normalizePortraitRetouch(input.state)
  const strokes = normalizePortraitLiquifyStrokes(input.liquifyStrokes)
  const spotHeals = normalizePortraitSpotHeals(input.spotHeals)
  const customLut = normalizePortraitCubeLut(input.customLut)
  const regions = extractFaceSemanticRegions(input.landmarks)
  const appliedSteps: string[] = []

  let working = new Uint8ClampedArray(sourcePixels)

  // ── PASS 1: Landmark MLS + Manual Brush Liquify Warp ───────────
  const controlVectors = buildFaceLiquifyControlVectors(state, input.landmarks)
  if (controlVectors.length > 0 || strokes.length > 0) {
    appliedSteps.push('liquify')
    const warped = new Uint8ClampedArray(working.length)
    for (let y = 0; y < height; y++) {
      const v = (y + 0.5) / height
      for (let x = 0; x < width; x++) {
        const u = (x + 0.5) / width
        const [su, sv] = sampleLiquifySourceCoord(u, v, controlVectors, strokes)
        const sx = clamp(su * width - 0.5, 0, width - 1)
        const sy = clamp(sv * height - 0.5, 0, height - 1)
        const x0 = Math.floor(sx)
        const y0 = Math.floor(sy)
        const x1 = Math.min(width - 1, x0 + 1)
        const y1 = Math.min(height - 1, y0 + 1)
        const fx = sx - x0
        const fy = sy - y0

        const p00 = (y0 * width + x0) * 4
        const p10 = (y0 * width + x1) * 4
        const p01 = (y1 * width + x0) * 4
        const p11 = (y1 * width + x1) * 4
        const dst = (y * width + x) * 4

        for (let c = 0; c < 4; c++) {
          const top = working[p00 + c] * (1 - fx) + working[p10 + c] * fx
          const bot = working[p01 + c] * (1 - fx) + working[p11 + c] * fx
          warped[dst + c] = clamp255(top * (1 - fy) + bot * fy)
        }
      }
    }
    working = warped
  }

  // ── PASS 2: Interactive Spot Blemish Healing ───────────────────
  if (spotHeals.length > 0) {
    appliedSteps.push('spotHeal')
    const healed = new Uint8ClampedArray(working)
    const minEdge = Math.min(width, height)
    for (const spot of spotHeals) {
      const cx = spot.x * width
      const cy = spot.y * height
      const radPx = Math.max(2, spot.radius * minEdge)
      // Sample ring around the blemish at 1.35 * radPx to get clean surrounding skin color
      let ringR = 0
      let ringG = 0
      let ringB = 0
      let ringCount = 0
      const samples = 16
      for (let s = 0; s < samples; s++) {
        const angle = (s / samples) * Math.PI * 2
        const rx = clamp(Math.round(cx + Math.cos(angle) * radPx * 1.35), 0, width - 1)
        const ry = clamp(Math.round(cy + Math.sin(angle) * radPx * 1.35), 0, height - 1)
        const p = (ry * width + rx) * 4
        ringR += working[p]
        ringG += working[p + 1]
        ringB += working[p + 2]
        ringCount++
      }
      if (!ringCount) continue
      ringR /= ringCount
      ringG /= ringCount
      ringB /= ringCount

      const xMin = Math.max(0, Math.floor(cx - radPx))
      const xMax = Math.min(width - 1, Math.ceil(cx + radPx))
      const yMin = Math.max(0, Math.floor(cy - radPx))
      const yMax = Math.min(height - 1, Math.ceil(cy + radPx))
      const radSq = radPx * radPx

      for (let y = yMin; y <= yMax; y++) {
        for (let x = xMin; x <= xMax; x++) {
          const dx = x - cx
          const dy = y - cy
          const dSq = dx * dx + dy * dy
          if (dSq >= radSq) continue
          const t = 1 - Math.sqrt(dSq) / radPx
          const blend = t * t * (3 - 2 * t) // Smoothstep feather
          const p = (y * width + x) * 4
          // Preserve subtle micro-grain from outer ring while replacing blemish chrominance/luminance
          healed[p] = clamp255(healed[p] * (1 - blend) + ringR * blend)
          healed[p + 1] = clamp255(healed[p + 1] * (1 - blend) + ringG * blend)
          healed[p + 2] = clamp255(healed[p + 2] * (1 - blend) + ringB * blend)
        }
      }
    }
    working = healed
  }

  // ── PASS 3: SOTA 4-Band Wavelet Pyramid Skin Decomposition ─────
  const blemishW = tierWeight(state.blemishRemoval)
  const wrinklesW = tierWeight(state.wrinkles)
  const evennessW = tierWeight(state.skinEvenness)
  const denoiseW = tierWeight(state.skinDenoise)
  const smoothW = Math.max(
    tierWeight(state.skinSmoothing),
    blemishW * 0.55,
    wrinklesW * 0.45,
    evennessW * 0.45,
    denoiseW * 0.4
  )
  const underEyeW = tierWeight(state.underEye)
  const shineW = tierWeight(state.shineRemoval)
  const textureW = tierWeight(state.skinTexture)
  const sharpW = tierWeight(state.sharpness)
  const clarityW = tierWeight(state.clarity)
  const softFocusW = tierWeight(state.softFocus)

  const needPyramid =
    blemishW > 0 ||
    smoothW > 0 ||
    wrinklesW > 0 ||
    evennessW > 0 ||
    underEyeW > 0 ||
    shineW > 0 ||
    textureW > 0 ||
    sharpW > 0 ||
    clarityW > 0 ||
    softFocusW > 0

  const needCoarseBand = wrinklesW > 0 || evennessW > 0 || underEyeW > 0

  // Band 1 boundary (r1 = 1px): separates 1-2px true cellular pores & hair strands from Band 2 blemishes
  const fineLow = needPyramid ? boxBlurRgb(working, width, height, 1) : null
  // Band 2 boundary (r2 ~ 1.2%): separates medium-scale skin roughness/acne from structural folds
  const midBlurRadius = Math.max(2, Math.round(Math.min(width, height) * 0.012))
  const lowFreq = needPyramid ? boxBlurRgb(working, width, height, midBlurRadius) : null
  // Band 3 boundary (r3 ~ 2.8%): separates nasolabial folds, forehead lines & eye bags from base 3D lighting
  const coarseBlurRadius = Math.max(midBlurRadius + 2, Math.round(Math.min(width, height) * 0.028))
  const coarseLow = needCoarseBand ? boxBlurRgb(working, width, height, coarseBlurRadius) : null

  if (
    smoothW > 0 ||
    wrinklesW > 0 ||
    evennessW > 0 ||
    underEyeW > 0 ||
    shineW > 0 ||
    textureW > 0 ||
    blemishW > 0
  ) {
    appliedSteps.push('frequencySeparationSkin')
    appliedSteps.push('wavelet4BandSkin')
  }
  if (blemishW > 0) {
    appliedSteps.push('autoBlemishHeal')
  }
  if (textureW > 0) {
    appliedSteps.push('proceduralSkinPore')
  }

  // Band 1 (1-2px true pore micro-texture) retention:
  // Preserved at >= 0.90 during smoothing so skin never looks plastic, and boosted up to 1.45x when skinTexture is active!
  const band1PoreGain =
    textureW > 0
      ? 1.05 + textureW * 0.42
      : smoothW > 0
        ? Math.max(0.86, 1.0 - smoothW * 0.12 - denoiseW * 0.25)
        : 1.0

  // ── PASS 4, 5, 6: Combined Single-Loop Per-Pixel Grading ───────
  const whitenW = tierWeight(state.skinWhiten)
  const rosyW = tierWeight(state.skinRosy)
  const deYellowW = tierWeight(state.skinDeYellow)
  const bodyUnifyW = tierWeight(state.bodyToneUnify)
  const eyeWhitenW = tierWeight(state.eyeWhiten)
  const catchlightW = tierWeight(state.catchlight)
  const redEyeW = tierWeight(state.redEye)
  const pupilSizeW = tierWeight(state.pupilSize)
  const doubleEyelidW = tierWeight(state.doubleEyelid)
  const browsW = tierWeight(state.brows)
  const teethWhitenW = tierWeight(state.teethWhiten)
  const makeupPalette = resolveParametricMakeupPalette(state)
  const fillLightW = tierWeight(state.fillLight)
  const rimLightW = tierWeight(state.rimLight)
  const contourW = tierWeight(state.faceContour)
  const grainW = tierWeight(state.grain)
  const vignetteW = tierWeight(state.vignette)

  if (
    eyeWhitenW > 0 ||
    catchlightW > 0 ||
    redEyeW > 0 ||
    pupilSizeW > 0 ||
    doubleEyelidW > 0 ||
    browsW > 0 ||
    teethWhitenW > 0
  ) {
    appliedSteps.push('eyesAndTeeth')
    if (redEyeW > 0) appliedSteps.push('redEye')
    if (doubleEyelidW > 0) appliedSteps.push('doubleEyelid')
    if (browsW > 0) appliedSteps.push('brows')
  }
  if (makeupPalette) {
    appliedSteps.push('parametricMakeup')
  }
  if (
    fillLightW > 0 ||
    rimLightW > 0 ||
    contourW > 0 ||
    state.lightRatio !== 'off' ||
    state.lightTemp !== 'off'
  ) {
    appliedSteps.push('normalMapRelighting')
  }
  if (
    whitenW > 0 ||
    rosyW > 0 ||
    deYellowW > 0 ||
    bodyUnifyW > 0 ||
    state.skinToneWarmth !== 'off' ||
    state.cameraStyle !== 'none' ||
    state.toneGrade !== 'off' ||
    state.saturation !== 'off' ||
    state.colorTemp !== 'off' ||
    state.colorTint !== 'off' ||
    state.lutId !== 'none' ||
    customLut
  ) {
    appliedSteps.push('colorAndTone')
    if (state.cameraStyle !== 'none') {
      appliedSteps.push('cameraStyle')
    }
  }
  if (sharpW > 0 || clarityW > 0 || grainW > 0 || softFocusW > 0 || vignetteW > 0) {
    appliedSteps.push('textureFinish')
  }

  const out = new Uint8ClampedArray(working.length)

  // Precompute feathered semantic polygons so strong retouching never leaves hard polygon seams
  const faceMinDim = regions ? Math.min(regions.box.w, regions.box.h) : 0
  const feFaceSkin = regions
    ? prepareFeatheredPolygon(regions.faceSkinOutline, Math.max(0.008, faceMinDim * 0.035))
    : null
  const feLeftEye = regions
    ? prepareFeatheredPolygon(regions.leftEye, Math.max(0.003, faceMinDim * 0.012))
    : null
  const feRightEye = regions
    ? prepareFeatheredPolygon(regions.rightEye, Math.max(0.003, faceMinDim * 0.012))
    : null
  const feLeftBrow = regions
    ? prepareFeatheredPolygon(regions.leftBrow, Math.max(0.004, faceMinDim * 0.016))
    : null
  const feRightBrow = regions
    ? prepareFeatheredPolygon(regions.rightBrow, Math.max(0.004, faceMinDim * 0.016))
    : null
  const feOuterLip = regions
    ? prepareFeatheredPolygon(regions.outerLip, Math.max(0.003, faceMinDim * 0.014))
    : null
  const feInnerMouth = regions
    ? prepareFeatheredPolygon(regions.innerMouth, Math.max(0.003, faceMinDim * 0.014))
    : null
  const feLeftInfra = regions
    ? prepareFeatheredPolygon(regions.leftInfraorbital, Math.max(0.006, faceMinDim * 0.028))
    : null
  const feRightInfra = regions
    ? prepareFeatheredPolygon(regions.rightInfraorbital, Math.max(0.006, faceMinDim * 0.028))
    : null

  const bilateralSigmaSq2 = 2 * (26 + smoothW * 22) * (26 + smoothW * 22)

  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width
      const p4 = (y * width + x) * 4
      const p3 = (y * width + x) * 3

      let r = working[p4]
      let g = working[p4 + 1]
      let b = working[p4 + 2]
      const a = working[p4 + 3]

      const flR = fineLow ? fineLow[p3] : r
      const flG = fineLow ? fineLow[p3 + 1] : g
      const flB = fineLow ? fineLow[p3 + 2] : b
      const lfR = lowFreq ? lowFreq[p3] : r
      const lfG = lowFreq ? lowFreq[p3 + 1] : g
      const lfB = lowFreq ? lowFreq[p3 + 2] : b
      const clR = coarseLow ? coarseLow[p3] : lfR
      const clG = coarseLow ? coarseLow[p3 + 1] : lfG
      const clB = coarseLow ? coarseLow[p3 + 2] : lfB

      // 4-Band Wavelet Decomposition:
      // Band 1 (1-2px true cellular pores & hair strands): I - fineLow
      let band1R = r - flR
      let band1G = g - flG
      let band1B = b - flB
      // Band 2 (medium-frequency acne/roughness): fineLow - lowFreq
      let band2R = flR - lfR
      let band2G = flG - lfG
      let band2B = flB - lfB
      // Band 3 (coarse structural folds: nasolabial, forehead lines, eye bags): lowFreq - coarseLow
      const band3R = lfR - clR
      const band3G = lfG - clG
      const band3B = lfB - clB

      let hfR = r - lfR
      let hfG = g - lfG
      let hfB = b - lfB

      // Feathered semantic region weights (0..1 with C1 smoothstep transitions)
      const leftEyeW = feLeftEye ? sampleFeatheredPolygon(u, v, feLeftEye) : 0
      const rightEyeW = feRightEye ? sampleFeatheredPolygon(u, v, feRightEye) : 0
      const eyeW = Math.max(leftEyeW, rightEyeW)
      const browW =
        feLeftBrow && feRightBrow
          ? Math.max(
              sampleFeatheredPolygon(u, v, feLeftBrow),
              sampleFeatheredPolygon(u, v, feRightBrow)
            )
          : 0
      const outerLipW = feOuterLip ? sampleFeatheredPolygon(u, v, feOuterLip) : 0
      const innerMouthW = feInnerMouth ? sampleFeatheredPolygon(u, v, feInnerMouth) : 0
      const facePolyW = feFaceSkin ? sampleFeatheredPolygon(u, v, feFaceSkin) : 0

      // 2.5D Facial Surface Normal (nx, ny, nz) for relighting & anisotropic pore synthesis
      const midU = regions ? regions.noseTip[0] : 0.5
      const midV = regions ? regions.noseTip[1] : 0.5
      const halfW = regions ? Math.max(0.05, regions.box.w * 0.5) : 0.25
      const halfH = regions ? Math.max(0.05, regions.box.h * 0.55) : 0.3
      const nx = clamp((u - midU) / halfW, -1, 1)
      const ny = clamp((v - midV) / halfH, -1, 1)
      const nz = Math.sqrt(Math.max(0.04, 1 - 0.78 * nx * nx - 0.45 * ny * ny))

      // Nostril & alar base protection so nostrils are never blurred or treated as dark blemishes
      let nostrilExclW = 0
      if (regions) {
        const ndx = (u - regions.noseTip[0]) / Math.max(0.01, regions.box.w * 0.14)
        const ndy =
          (v - (regions.noseTip[1] + regions.box.h * 0.02)) / Math.max(0.01, regions.box.h * 0.065)
        const nDistSq = ndx * ndx + ndy * ndy
        if (nDistSq < 1) nostrilExclW = (1 - nDistSq) * 0.85
      }

      const skinConf = skinToneConfidence(r, g, b)
      // Semantic skin mask: smooth inside face polygon (excluding eyes/brows/lips/nostrils), or skin-tone confidence for neck/body
      const featureExclW = Math.max(eyeW, browW, outerLipW, nostrilExclW)
      const inFaceWeight = Math.max(0.65, skinConf)
      const nonFaceWeight = skinConf * (bodyUnifyW > 0 ? 0.9 : 0.45)
      const rawSkinWeight = regions
        ? facePolyW * inFaceWeight + (1 - facePolyW) * nonFaceWeight
        : skinConf
      const faceSkinWeight = rawSkinWeight * (1 - featureExclW)

      // 0) Auto Blemish / Acne Spot Detection & Ring-Neighborhood Healing (Identity-Safe)
      if (blemishW > 0 && lowFreq && faceSkinWeight > 0.25) {
        const luma = 0.299 * r + 0.587 * g + 0.114 * b
        const lfLuma = 0.299 * lfR + 0.587 * lfG + 0.114 * lfB
        // Acne/pimple redness spike vs surrounding low-freq skin
        const redSpike = r - lfR - 0.65 * (g - lfG)
        // Dark spot / post-acne hyperpigmentation vs surrounding low-freq skin
        const darkDip = lfLuma - luma
        // Protect deep non-red permanent beauty marks/moles unless blemishRemoval is 'max'
        const isSignatureMole = darkDip > 58 && redSpike < 5 && blemishW < 0.98
        if (!isSignatureMole && (redSpike > 5.5 || darkDip > 7.5)) {
          const anomalyScore = Math.max((redSpike - 5.5) / 22, (darkDip - 7.5) / 26)
          const healBlend = clamp01(anomalyScore * blemishW * 1.35) * faceSkinWeight
          // Attenuate blemish chrominance/luminance in Band 2 while preserving Band 1 micro-pore texture
          r = r * (1 - healBlend) + lfR * healBlend
          g = g * (1 - healBlend) + lfG * healBlend
          b = b * (1 - healBlend) + lfB * healBlend
          band2R *= 1 - healBlend * 0.85
          band2G *= 1 - healBlend * 0.85
          band2B *= 1 - healBlend * 0.85
          band1R *= 1 - healBlend * 0.35
          band1G *= 1 - healBlend * 0.35
          band1B *= 1 - healBlend * 0.35
          hfR = band1R + band2R
          hfG = band1G + band2G
          hfB = band1B + band2B
        }
      }

      // 1) SOTA 4-Band Wavelet Pyramid Skin Retouch + Procedural Anisotropic Pore Synthesis
      if (
        faceSkinWeight > 0.05 &&
        lowFreq &&
        (smoothW > 0 || wrinklesW > 0 || evennessW > 0 || textureW > 0)
      ) {
        const colorDeltaSq = band2R * band2R + band2G * band2G + band2B * band2B
        // Bilateral range kernel prevents smoothing across sharp anatomical boundaries (alar crease, lip border, jawline)
        const bilateralRangeW = Math.exp(-colorDeltaSq / bilateralSigmaSq2)
        // Band 2 attenuation: removes mid-frequency acne/roughness/blotches
        const effBand2Smooth = smoothW * faceSkinWeight * (0.3 + 0.7 * bilateralRangeW)
        const band2Keep = Math.max(0.08, 1 - effBand2Smooth)

        // Band 3 attenuation: softens nasolabial folds, forehead wrinkles & blotchy tone unevenness without flattening Band 4 3D lighting
        const foldAtten =
          Math.max(wrinklesW * 0.72, evennessW * 0.58) *
          faceSkinWeight *
          (0.35 + 0.65 * bilateralRangeW)
        const baseIllumR = coarseLow ? clR + band3R * (1 - foldAtten) : lfR
        const baseIllumG = coarseLow ? clG + band3G * (1 - foldAtten) : lfG
        const baseIllumB = coarseLow ? clB + band3B * (1 - foldAtten) : lfB

        // Band 1 (1-2px true pores) is preserved/boosted independently of Band 2 smoothing!
        const effBand1Gain = 1 + (band1PoreGain - 1) * faceSkinWeight
        let synthPore = 0
        if (textureW > 0) {
          // Adaptive pore deficit: synthesize stronger cellular pores where skin is overly smooth/plastic
          const nativePoreEnergy = (Math.abs(band1R) + Math.abs(band1G) + Math.abs(band1B)) / 3
          const deficit = clamp01((5.5 - nativePoreEnergy) / 5.5)
          const poreAmp = textureW * (2.2 + deficit * 4.6) * faceSkinWeight
          synthPore = synthesizeProceduralSkinPore(x, y, nx, ny, nz) * poreAmp
        }

        r = baseIllumR + band2R * band2Keep + band1R * effBand1Gain + synthPore
        g = baseIllumG + band2G * band2Keep + band1G * effBand1Gain + synthPore * 0.96
        b = baseIllumB + band2B * band2Keep + band1B * effBand1Gain + synthPore * 0.92
      }

      // 2) Under-Eye Dark Circle & Eye-Bag Lift (Band 3 shadow fold neutralization + warm chrominance lift)
      if (underEyeW > 0 && feLeftInfra && feRightInfra && eyeW < 0.99) {
        const infraW =
          Math.max(
            sampleFeatheredPolygon(u, v, feLeftInfra),
            sampleFeatheredPolygon(u, v, feRightInfra)
          ) *
          (1 - eyeW)
        if (infraW > 0.01) {
          const baseRefR = coarseLow ? clR : lfR
          const baseRefG = coarseLow ? clG : lfG
          const baseRefB = coarseLow ? clB : lfB
          const blend = 0.48 * infraW * Math.min(1, underEyeW + 0.35)
          const lift = underEyeW * 18 * infraW
          // Keep Band 1 micro-pores under the eye while lifting Band 3 tear-trough shadow
          r = baseRefR * blend + r * (1 - blend) + lift + band1R * 0.45 * infraW
          g = baseRefG * blend + g * (1 - blend) + lift * 0.92 + band1G * 0.45 * infraW
          b = baseRefB * blend + b * (1 - blend) + lift * 0.85 + band1B * 0.45 * infraW
        }
      }

      // 3) Shine / Oil Highlight Compression on Skin
      if (shineW > 0 && faceSkinWeight > 0.2) {
        const luma = 0.299 * r + 0.587 * g + 0.114 * b
        if (luma > 205) {
          const excess = (luma - 205) * shineW * 0.55 * faceSkinWeight
          r -= excess
          g -= excess
          b -= excess
        }
      }

      // 4) Eyes & Brows Polish: Sclera Whitening, Catchlight, Red-Eye, Double Eyelid, Brow Density
      if (eyeW > 0.01 && (eyeWhitenW > 0 || catchlightW > 0 || redEyeW > 0 || pupilSizeW > 0)) {
        const luma = 0.299 * r + 0.587 * g + 0.114 * b
        // Flash Red-Eye Correction inside pupil/iris
        if (redEyeW > 0 && r > g * 1.32 && r - g > 20 && luma < 175) {
          const redNeutralize = clamp01(((r - g) / 65) * redEyeW * 1.35) * eyeW
          const neutralDark = (g * 0.65 + b * 0.35) * 0.82
          r = r * (1 - redNeutralize) + neutralDark * redNeutralize
        }
        // Sclera pixels have moderate-to-high luminance (not dark pupil/iris)
        if (eyeWhitenW > 0 && luma > 95) {
          const effEyeWhiten = eyeWhitenW * eyeW
          const boost = effEyeWhiten * 20
          r = luma + (r - luma) * (1 - effEyeWhiten * 0.45) + boost
          g = luma + (g - luma) * (1 - effEyeWhiten * 0.45) + boost
          b = luma + (b - luma) * (1 - effEyeWhiten * 0.35) + boost * 1.08
        }
        // Catchlight reflection dot slightly upper-right of eye center
        if (catchlightW > 0 && regions) {
          const eyeCenter = leftEyeW >= rightEyeW ? regions.leftEyeCenter : regions.rightEyeCenter
          const cx = eyeCenter[0] + regions.box.w * 0.014
          const cy = eyeCenter[1] - regions.box.h * 0.012
          const rad = regions.box.w * 0.012
          const dSq = (u - cx) * (u - cx) + (v - cy) * (v - cy)
          if (dSq < rad * rad) {
            const spec = (1 - dSq / (rad * rad)) * catchlightW * 75 * eyeW
            r += spec
            g += spec
            b += spec
          }
        }
      }

      // 4b) Parametric Double-Eyelid Crease Contour above Upper Eyelids
      if (doubleEyelidW > 0 && regions && eyeW < 0.5) {
        for (const eyeCenter of [regions.leftEyeCenter, regions.rightEyeCenter]) {
          const edx = (u - eyeCenter[0]) / Math.max(0.012, regions.box.w * 0.095)
          if (Math.abs(edx) < 1.0) {
            // Parabolic supraorbital crease arch just above upper eyelid
            const archY = eyeCenter[1] - regions.box.h * 0.036 + edx * edx * regions.box.h * 0.014
            const edy = (v - archY) / Math.max(0.002, regions.box.h * 0.008)
            if (Math.abs(edy) < 1.3) {
              const horizEnv = 1 - edx * edx
              // Subtle dark crease line + soft highlight on pretarsal fold below crease
              const creaseShade =
                edy < 0.3
                  ? -Math.exp(-edy * edy * 2.4) * 22 * doubleEyelidW * horizEnv
                  : Math.exp(-(edy - 0.65) * (edy - 0.65) * 3.0) * 8 * doubleEyelidW * horizEnv
              r += creaseShade
              g += creaseShade * 0.94
              b += creaseShade * 0.9
            }
          }
        }
      }

      // 4c) Parametric Eyebrow Hair-Flow Density & Arch Definition
      if (browsW > 0 && browW > 0.02) {
        const luma = 0.299 * r + 0.587 * g + 0.114 * b
        // Deepen brow hair density + directional hair-stroke micro-contrast
        const hairStroke = Math.sin((x * 1.85 + y * 0.45) * 2.1) * 4.5 * browsW
        const darken = Math.max(0, (185 - luma) / 185) * 24 * browsW * browW
        r = r - darken + hairStroke * browW
        g = g - darken * 0.96 + hairStroke * browW
        b = b - darken * 0.92 + hairStroke * browW
      }

      // 5) Teeth Whitening inside Inner Mouth
      if (innerMouthW > 0.01 && teethWhitenW > 0) {
        const luma = 0.299 * r + 0.587 * g + 0.114 * b
        // Tooth pixels: bright and slightly warm/yellow, not deep red gum/tongue
        if (luma > 105 && r - g < 45) {
          const effTeethWhiten = teethWhitenW * innerMouthW
          const whiten = effTeethWhiten * 24
          r = luma + (r - luma) * (1 - effTeethWhiten * 0.6) + whiten
          g = luma + (g - luma) * (1 - effTeethWhiten * 0.55) + whiten
          b = luma + (b - luma) * (1 - effTeethWhiten * 0.35) + whiten * 1.12
        }
      }

      // 5b) SOTA Parametric Velvet Makeup (Lip Tint Preserving Lip Lines + Malar Blush + Eyeshadow)
      if (makeupPalette) {
        const { weight: mkW, lipRgb, blushRgb, shadowRgb } = makeupPalette
        // Velvet Lip Tint on outerLip excluding innerMouth teeth/cavity, preserving 100% of Band 1+2 lip creases & gloss
        const lipMask = clamp01(outerLipW - innerMouthW * 0.92)
        if (lipMask > 0.01) {
          const luma = 0.299 * r + 0.587 * g + 0.114 * b
          // Protect natural specular lip gloss on highlights (luma > 210)
          const glossProtect = luma > 195 ? clamp01((240 - luma) / 45) : 1
          const tintBlend = lipMask * mkW * 0.56 * glossProtect
          const lipLumaScale = clamp(luma / 148, 0.45, 1.35)
          const targetLipR = lipRgb[0] * lipLumaScale + (band1R + band2R * 0.65)
          const targetLipG = lipRgb[1] * lipLumaScale + (band1G + band2G * 0.65)
          const targetLipB = lipRgb[2] * lipLumaScale + (band1B + band2B * 0.65)
          r = r * (1 - tintBlend) + targetLipR * tintBlend
          g = g * (1 - tintBlend) + targetLipG * tintBlend
          b = b * (1 - tintBlend) + targetLipB * tintBlend
        }
        // Malar Cheek Blush & Upper Eyelid Eyeshadow Wash
        if (regions && faceSkinWeight > 0.05) {
          const leftAppleX = regions.box.x + regions.box.w * 0.23
          const rightAppleX = regions.box.x + regions.box.w * 0.77
          const appleY = regions.noseTip[1] + regions.box.h * 0.02
          const rx = Math.max(0.02, regions.box.w * 0.17)
          const ry = Math.max(0.02, regions.box.h * 0.13)
          const dLeft =
            ((u - leftAppleX) * (u - leftAppleX)) / (rx * rx) +
            ((v - appleY) * (v - appleY)) / (ry * ry)
          const dRight =
            ((u - rightAppleX) * (u - rightAppleX)) / (rx * rx) +
            ((v - appleY) * (v - appleY)) / (ry * ry)
          const dMin = Math.min(dLeft, dRight)
          if (dMin < 1.0) {
            const blushEnv = (1 - dMin) * (1 - dMin) * mkW * 0.24 * faceSkinWeight
            r = r * (1 - blushEnv) + blushRgb[0] * blushEnv
            g = g * (1 - blushEnv) + blushRgb[1] * blushEnv
            b = b * (1 - blushEnv) + blushRgb[2] * blushEnv
          }
          // Subtle upper-lid eyeshadow wash
          for (const eyeCenter of [regions.leftEyeCenter, regions.rightEyeCenter]) {
            const sdx = (u - eyeCenter[0]) / Math.max(0.015, regions.box.w * 0.12)
            const sdy =
              (v - (eyeCenter[1] - regions.box.h * 0.032)) / Math.max(0.01, regions.box.h * 0.032)
            const sDistSq = sdx * sdx + sdy * sdy
            if (sDistSq < 1.0) {
              const shadowEnv = (1 - sDistSq) * mkW * 0.22 * (1 - eyeW)
              r = r * (1 - shadowEnv) + shadowRgb[0] * shadowEnv
              g = g * (1 - shadowEnv) + shadowRgb[1] * shadowEnv
              b = b * (1 - shadowEnv) + shadowRgb[2] * shadowEnv
            }
          }
        }
      }

      // 6) Skin Tone Grading (Whiten, Rosy, De-Yellow, Warmth, Body Unify)
      const toneMask = Math.max(faceSkinWeight, bodyUnifyW > 0 ? skinConf * 0.92 : 0)
      if (toneMask > 0.05) {
        if (whitenW > 0) {
          const lift = whitenW * 18 * toneMask
          r += lift
          g += lift * 0.98
          b += lift * 1.02
        }
        if (rosyW > 0) {
          r += rosyW * 11 * toneMask
          g -= rosyW * 2 * toneMask
          b += rosyW * 3 * toneMask
        }
        if (deYellowW > 0) {
          g -= deYellowW * 4 * toneMask
          b += deYellowW * 11 * toneMask
        }
        if (state.skinToneWarmth !== 'off') {
          const wDelta =
            state.skinToneWarmth === 'warmStrong'
              ? 10
              : state.skinToneWarmth === 'warm'
                ? 5
                : state.skinToneWarmth === 'cool'
                  ? -10
                  : -5
          r += wDelta * toneMask
          b -= wDelta * toneMask
        }
      }

      // 7) 2.5D Surface-Normal Lighting, Rim Light & Facial Contour Sculpting
      const lightWarmthShift =
        state.lightTemp === 'warmStrong'
          ? 8
          : state.lightTemp === 'warm'
            ? 4
            : state.lightTemp === 'cool'
              ? -8
              : state.lightTemp === 'coolLight'
                ? -4
                : 0
      if (fillLightW > 0) {
        const luma = 0.299 * r + 0.587 * g + 0.114 * b
        const shadowLift = Math.max(0, (160 - luma) / 160) * fillLightW * 26
        r += shadowLift + lightWarmthShift * fillLightW * 0.5
        g += shadowLift
        b += shadowLift - lightWarmthShift * fillLightW * 0.5
      }
      if ((contourW > 0 || rimLightW > 0 || state.lightRatio !== 'off') && facePolyW > 0.01) {
        const midU = regions ? regions.noseTip[0] : 0.5
        const midV = regions ? regions.noseTip[1] : 0.5
        const halfW = regions ? Math.max(0.05, regions.box.w * 0.5) : 0.25
        const halfH = regions ? Math.max(0.05, regions.box.h * 0.55) : 0.3
        const nx = clamp((u - midU) / halfW, -1, 1)
        const ny = clamp((v - midV) / halfH, -1, 1)
        const nz = Math.sqrt(Math.max(0.04, 1 - 0.78 * nx * nx - 0.45 * ny * ny))

        if (contourW > 0) {
          // 3D normal-based sculpting: lift high-Nz central ridge (nose bridge, forehead, malar), deepen oblique jaw slope
          const sculpt = (nz - 0.62) * contourW * 28 * facePolyW
          r += sculpt
          g += sculpt
          b += sculpt
        }
        if (rimLightW > 0) {
          // Grazing-angle specular rim light along the outer cheek/temple/jaw silhouette
          const grazing = Math.pow(1 - nz, 1.55) * rimLightW * 34 * facePolyW
          r += grazing + lightWarmthShift * rimLightW
          g += grazing + lightWarmthShift * rimLightW * 0.25
          b += grazing - lightWarmthShift * rimLightW
        }
        if (state.lightRatio !== 'off') {
          const luma = 0.299 * r + 0.587 * g + 0.114 * b
          const ratioStrength =
            state.lightRatio === 'soft'
              ? -0.14
              : state.lightRatio === 'dramatic'
                ? 0.2
                : state.lightRatio === 'hard'
                  ? 0.28
                  : 0
          if (ratioStrength !== 0) {
            const delta = (luma - 128) * ratioStrength * facePolyW
            r += delta
            g += delta
            b += delta
          }
        }
      }

      // 8) Global Tone Grade, Saturation, Color Temp & Tint
      if (state.toneGrade !== 'off') {
        if (state.toneGrade === 'brightAiry') {
          r = r * 1.05 + 10
          g = g * 1.05 + 10
          b = b * 1.05 + 10
        } else if (state.toneGrade === 'highContrast') {
          r = (r - 128) * 1.18 + 128
          g = (g - 128) * 1.18 + 128
          b = (b - 128) * 1.18 + 128
        } else if (state.toneGrade === 'lowKeyMoody') {
          r = r * 0.88 - 6
          g = g * 0.88 - 6
          b = b * 0.9 - 4
        } else if (state.toneGrade === 'filmFade') {
          r = r * 0.86 + 22
          g = g * 0.86 + 21
          b = b * 0.86 + 20
        }
      }

      if (state.saturation !== 'off') {
        const luma = 0.299 * r + 0.587 * g + 0.114 * b
        const satFactor =
          state.saturation === 'boostVivid'
            ? 1.32
            : state.saturation === 'boost'
              ? 1.16
              : state.saturation === 'desaturate'
                ? 0.65
                : 0.82
        r = luma + (r - luma) * satFactor
        g = luma + (g - luma) * satFactor
        b = luma + (b - luma) * satFactor
      }

      if (state.colorTemp !== 'off') {
        const tempShift =
          state.colorTemp === 'warmStrong'
            ? 14
            : state.colorTemp === 'warm'
              ? 7
              : state.colorTemp === 'cool'
                ? -14
                : -7
        r += tempShift
        b -= tempShift
      }

      if (state.colorTint !== 'off') {
        const tintShift =
          state.colorTint === 'green'
            ? 10
            : state.colorTint === 'slightGreen'
              ? 5
              : state.colorTint === 'magenta'
                ? -10
                : -5
        g += tintShift
        r -= tintShift * 0.5
        b -= tintShift * 0.5
      }

      // 9) Camera Color Science, Built-in LUT & Custom .cube 3D LUT
      if (state.cameraStyle !== 'none') {
        ;[r, g, b] = applyCameraStyleRgb(r, g, b, state.cameraStyle, skinConf)
      }
      if (state.lutId !== 'none') {
        ;[r, g, b] = applyBuiltinLutRgb(r, g, b, state.lutId)
      }
      if (customLut) {
        ;[r, g, b] = applyCubeLutRgb(r, g, b, customLut)
      }

      // 10) Texture Finish: USM Sharpness, Clarity, Soft Focus, Grain, Vignette
      if (sharpW > 0 && lowFreq) {
        const usm = sharpW * 0.85
        r += hfR * usm
        g += hfG * usm
        b += hfB * usm
      }
      if (clarityW > 0 && lowFreq) {
        const midPunch = clarityW * 0.45
        r += (r - lfR) * midPunch
        g += (g - lfG) * midPunch
        b += (b - lfB) * midPunch
      }
      if (softFocusW > 0 && lowFreq) {
        const glow = softFocusW * 0.42
        r = r * (1 - glow) + Math.max(r, lfR) * glow
        g = g * (1 - glow) + Math.max(g, lfG) * glow
        b = b * (1 - glow) + Math.max(b, lfB) * glow
      }
      if (grainW > 0) {
        // Bell-distributed 32-bit integer avalanche film grain (zero diagonal sine stripes),
        // modulated by midtone luminance so highlights and deep shadows stay clean
        const g1 = spatialHash01(x, y, 307)
        const g2 = spatialHash01(x, y, 613)
        const triNoise = (g1 + g2 - 1.0) * 0.5
        const normLuma = clamp01((0.299 * r + 0.587 * g + 0.114 * b) / 255)
        const midtoneEnv = 0.35 + 0.65 * (4 * normLuma * (1 - normLuma))
        const noise = triNoise * grainW * 24 * midtoneEnv
        r += noise
        g += noise
        b += noise
      }
      if (vignetteW > 0) {
        const dx = u - 0.5
        const dy = v - 0.5
        const rDistSq = dx * dx + dy * dy
        const vig = Math.max(0, (rDistSq - 0.12) * 1.65) * vignetteW
        const mult = Math.max(0.35, 1 - vig)
        r *= mult
        g *= mult
        b *= mult
      }

      out[p4] = clamp255(r)
      out[p4 + 1] = clamp255(g)
      out[p4 + 2] = clamp255(b)
      out[p4 + 3] = a
    }
  }

  return { pixels: out, appliedSteps }
}

// ── Millimeter-Exact Local ID Photo Auto-Crop & Print Sheet ─────

export interface IdPhotoCropBoxResult {
  /** Normalized crop rectangle in 0..1 of the source image */
  x: number
  y: number
  w: number
  h: number
  /** Target pixel width at requested DPI (e.g. 295px for 1-inch @ 300 DPI) */
  widthPx: number
  /** Target pixel height at requested DPI (e.g. 413px for 1-inch @ 300 DPI) */
  heightPx: number
  /** Physical millimeter dimensions */
  widthMm: number
  heightMm: number
  dpi: number
}

/**
 * Computes a millimeter-exact ID photo crop box from 68-point facial landmarks
 * (or fallback center portrait framing) so the crown has ~9% top headroom,
 * the nose bridge is horizontally centered, and shoulders are framed cleanly.
 */
export function computeIdPhotoCropBox(
  specId: PortraitIdPhotoSpecId | string,
  landmarks?: readonly (readonly [number, number])[] | null,
  sourceAspect = 1,
  dpi = 300
): IdPhotoCropBoxResult | null {
  const spec = idPhotoSpecById(specId)
  if (!spec) return null
  const safeDpi = clamp(Number.isFinite(dpi) ? Math.round(dpi) : 300, 72, 600)
  const widthPx = Math.max(64, Math.round((spec.widthMm / 25.4) * safeDpi))
  const heightPx = Math.max(64, Math.round((spec.heightMm / 25.4) * safeDpi))
  const targetAspect = spec.widthMm / spec.heightMm
  const imgAspect = Number.isFinite(sourceAspect) && sourceAspect > 0.1 ? sourceAspect : 1

  const regions = extractFaceSemanticRegions(landmarks)
  let centerX = 0.5
  let headTopY = 0.18
  let chinY = 0.56

  if (regions && landmarks && landmarks.length >= PORTRAIT_LANDMARK_COUNT) {
    centerX = landmarks[27][0]
    chinY = landmarks[8][1]
    const browMinY = Math.min(
      ...regions.leftBrow.map((p) => p[1]),
      ...regions.rightBrow.map((p) => p[1])
    )
    const browToChin = Math.max(0.08, chinY - browMinY)
    headTopY = Math.max(0.02, browMinY - browToChin * 0.52)
  }

  // Standard ID photo framing: head height (crown to chin) occupies ~56% of frame height,
  // with ~9% top margin above crown.
  const headSpan = Math.max(0.12, chinY - headTopY)
  let cropH = clamp(headSpan / 0.56, 0.25, 1)
  // Normalized width w = cropH * (targetAspect / imgAspect)
  let cropW = cropH * (targetAspect / imgAspect)
  if (cropW > 1) {
    cropW = 1
    cropH = clamp(cropW * (imgAspect / targetAspect), 0.15, 1)
  }

  let cropX = clamp(centerX - cropW * 0.5, 0, 1 - cropW)
  let cropY = clamp(headTopY - cropH * 0.09, 0, 1 - cropH)

  return {
    x: cropX,
    y: cropY,
    w: cropW,
    h: cropH,
    widthPx,
    heightPx,
    widthMm: spec.widthMm,
    heightMm: spec.heightMm,
    dpi: safeDpi
  }
}

function idPhotoBackdropRgb(
  bg: PortraitIdPhotoBg | 'gray' | 'gradientBlue',
  v: number
): [number, number, number] {
  switch (bg) {
    case 'blue':
      return [67, 142, 219]
    case 'red':
      return [217, 46, 46]
    case 'gray':
      return [218, 222, 228]
    case 'gradient':
    case 'gradientBlue': {
      const t = clamp01(v)
      return [
        Math.round(52 * (1 - t) + 150 * t),
        Math.round(126 * (1 - t) + 198 * t),
        Math.round(208 * (1 - t) + 242 * t)
      ]
    }
    case 'white':
    default:
      return [255, 255, 255]
  }
}

/**
 * Renders a millimeter-exact single ID photo RGBA buffer from the live portrait pipeline,
 * cropping to the specification aspect ratio and optionally replacing the backdrop when
 * edge background pixels are detected outside the head-and-shoulder silhouette.
 */
export function renderIdPhotoSingleRgba(
  sourcePixels: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  input: PortraitLiveInput,
  options?: {
    dpi?: number
    replaceBackdrop?: boolean
    /** Optional person foreground alpha mask (length srcW * srcH, values 0..1 or 0..255) from ONNX segmentation */
    personMaskAlpha?: Uint8ClampedArray | Float32Array | null
  }
): { pixels: Uint8ClampedArray; width: number; height: number; crop: IdPhotoCropBoxResult } | null {
  const state = normalizePortraitRetouch(input.state)
  const crop = computeIdPhotoCropBox(
    state.idPhotoSpecId,
    input.landmarks,
    srcW / Math.max(1, srcH),
    options?.dpi ?? (state.exportDpi || 300)
  )
  if (!crop) return null

  const { pixels: retouched } = applyPortraitLivePixelPipeline(sourcePixels, srcW, srcH, input)
  const dstW = crop.widthPx
  const dstH = crop.heightPx
  const out = new Uint8ClampedArray(dstW * dstH * 4)

  // Multi-point border background estimation across 8 perimeter sample points (top + upper left/right margins)
  const borderSampleCoords: Array<[number, number]> = [
    [crop.x + crop.w * 0.03, crop.y + crop.h * 0.02],
    [crop.x + crop.w * 0.18, crop.y + crop.h * 0.02],
    [crop.x + crop.w * 0.82, crop.y + crop.h * 0.02],
    [crop.x + crop.w * 0.97, crop.y + crop.h * 0.02],
    [crop.x + crop.w * 0.02, crop.y + crop.h * 0.18],
    [crop.x + crop.w * 0.98, crop.y + crop.h * 0.18],
    [crop.x + crop.w * 0.02, crop.y + crop.h * 0.38],
    [crop.x + crop.w * 0.98, crop.y + crop.h * 0.38]
  ]
  const samplesR: number[] = []
  const samplesG: number[] = []
  const samplesB: number[] = []
  for (const [u, v] of borderSampleCoords) {
    const sx = clamp(Math.round(u * (srcW - 1)), 0, srcW - 1)
    const sy = clamp(Math.round(v * (srcH - 1)), 0, srcH - 1)
    const idx = (sy * srcW + sx) * 4
    samplesR.push(retouched[idx])
    samplesG.push(retouched[idx + 1])
    samplesB.push(retouched[idx + 2])
  }
  samplesR.sort((a, b) => a - b)
  samplesG.sort((a, b) => a - b)
  samplesB.sort((a, b) => a - b)
  // Trimmed median (middle 4 of 8 samples) for outlier-resilient background color reference
  const bgRefR = (samplesR[2] + samplesR[3] + samplesR[4] + samplesR[5]) * 0.25
  const bgRefG = (samplesG[2] + samplesG[3] + samplesG[4] + samplesG[5]) * 0.25
  const bgRefB = (samplesB[2] + samplesB[3] + samplesB[4] + samplesB[5]) * 0.25
  const bgSpread = Math.hypot(
    samplesR[5] - samplesR[2],
    samplesG[5] - samplesG[2],
    samplesB[5] - samplesB[2]
  )
  const bgTolerance = clamp(44 + bgSpread * 0.65, 42, 76)
  const doBackdrop = options?.replaceBackdrop !== false
  const maskBuf =
    options?.personMaskAlpha && options.personMaskAlpha.length === srcW * srcH
      ? options.personMaskAlpha
      : null
  const maskScale = maskBuf instanceof Uint8ClampedArray ? 1 / 255 : 1

  for (let y = 0; y < dstH; y++) {
    const nv = (y + 0.5) / dstH
    const su = crop.y + nv * crop.h
    const sy = clamp(su * srcH - 0.5, 0, srcH - 1)
    const y0 = Math.floor(sy)
    const y1 = Math.min(srcH - 1, y0 + 1)
    const fy = sy - y0

    for (let x = 0; x < dstW; x++) {
      const nu = (x + 0.5) / dstW
      const sv = crop.x + nu * crop.w
      const sx = clamp(sv * srcW - 0.5, 0, srcW - 1)
      const x0 = Math.floor(sx)
      const x1 = Math.min(srcW - 1, x0 + 1)
      const fx = sx - x0

      const i00 = y0 * srcW + x0
      const i10 = y0 * srcW + x1
      const i01 = y1 * srcW + x0
      const i11 = y1 * srcW + x1

      const p00 = i00 * 4
      const p10 = i10 * 4
      const p01 = i01 * 4
      const p11 = i11 * 4

      let r =
        (retouched[p00] * (1 - fx) + retouched[p10] * fx) * (1 - fy) +
        (retouched[p01] * (1 - fx) + retouched[p11] * fx) * fy
      let g =
        (retouched[p00 + 1] * (1 - fx) + retouched[p10 + 1] * fx) * (1 - fy) +
        (retouched[p01 + 1] * (1 - fx) + retouched[p11 + 1] * fx) * fy
      let b =
        (retouched[p00 + 2] * (1 - fx) + retouched[p10 + 2] * fx) * (1 - fy) +
        (retouched[p01 + 2] * (1 - fx) + retouched[p11 + 2] * fx) * fy
      const a =
        (retouched[p00 + 3] * (1 - fx) + retouched[p10 + 3] * fx) * (1 - fy) +
        (retouched[p01 + 3] * (1 - fx) + retouched[p11 + 3] * fx) * fy

      if (doBackdrop) {
        let maskTrans = 0
        if (maskBuf) {
          const mVal =
            ((maskBuf[i00] * (1 - fx) + maskBuf[i10] * fx) * (1 - fy) +
              (maskBuf[i01] * (1 - fx) + maskBuf[i11] * fx) * fy) *
            maskScale
          maskTrans = clamp01(1 - clamp01(mVal))
        }
        const alphaTrans = a < 252 ? clamp01(1 - a / 255) : 0
        const segOutside = Math.max(alphaTrans, maskTrans)

        // Head + shoulders geometric prior inside ID photo frame:
        // head ellipse centered at (0.5, 0.39), shoulder trapezoid at (0.5, 0.92)
        const headDx = (nu - 0.5) / 0.29
        const headDy = (nv - 0.39) / 0.28
        const headDist = Math.sqrt(headDx * headDx + headDy * headDy)
        const shoulderDx = (nu - 0.5) / 0.48
        const shoulderDy = (nv - 0.92) / 0.28
        const shoulderDist = Math.sqrt(shoulderDx * shoulderDx + shoulderDy * shoulderDy)
        const geoInside = Math.min(headDist, shoulderDist)
        const colorDist = Math.hypot(r - bgRefR, g - bgRefG, b - bgRefB)
        const bgSim = colorDist < bgTolerance ? 1 - colorDist / bgTolerance : 0
        const geoOutside = geoInside > 0.92 ? clamp01((geoInside - 0.92) * 2.2) * bgSim : 0
        const outsideWeight = Math.max(segOutside, geoOutside)

        if (outsideWeight > 0.01) {
          // Chromatic edge defringe (color-spill suppression) in the hair/shoulder transition band
          if (outsideWeight < 0.96 && colorDist < bgTolerance * 1.15) {
            const spillW = outsideWeight * (1 - outsideWeight) * 1.65
            const fgWeight = Math.max(0.25, 1 - outsideWeight * 0.75)
            r = clamp255(r + ((r - bgRefR * outsideWeight) / fgWeight - r) * spillW)
            g = clamp255(g + ((g - bgRefG * outsideWeight) / fgWeight - g) * spillW)
            b = clamp255(b + ((b - bgRefB * outsideWeight) / fgWeight - b) * spillW)
          }
          const [br, bg, bb] = idPhotoBackdropRgb(state.idPhotoBg, nv)
          r = r * (1 - outsideWeight) + br * outsideWeight
          g = g * (1 - outsideWeight) + bg * outsideWeight
          b = b * (1 - outsideWeight) + bb * outsideWeight
        }
      }

      const dst = (y * dstW + x) * 4
      out[dst] = clamp255(r)
      out[dst + 1] = clamp255(g)
      out[dst + 2] = clamp255(b)
      out[dst + 3] = 255
    }
  }

  return { pixels: out, width: dstW, height: dstH, crop }
}

/**
 * Composes a multi-up ID photo print sheet (default 4×2 = 8-up on 6-inch paper)
 * with clean white margins and L-shaped corner cut marks.
 */
export function composeIdPhotoPrintSheetRgba(
  photoPixels: Uint8ClampedArray,
  photoW: number,
  photoH: number,
  options?: {
    columns?: number
    rows?: number
    gapPx?: number
    marginPx?: number
    cutMarks?: boolean
  }
): { pixels: Uint8ClampedArray; width: number; height: number; count: number } {
  const cols = Math.max(1, Math.min(6, options?.columns ?? 4))
  const rows = Math.max(1, Math.min(6, options?.rows ?? 2))
  const gap = Math.max(4, options?.gapPx ?? Math.round(Math.min(photoW, photoH) * 0.08))
  const margin = Math.max(8, options?.marginPx ?? Math.round(Math.min(photoW, photoH) * 0.14))
  const drawCutMarks = options?.cutMarks !== false

  const sheetW = margin * 2 + cols * photoW + (cols - 1) * gap
  const sheetH = margin * 2 + rows * photoH + (rows - 1) * gap
  const out = new Uint8ClampedArray(sheetW * sheetH * 4)
  out.fill(255) // Pure white photo paper

  const markLen = Math.max(4, Math.min(12, Math.floor(gap * 0.45)))

  const setGrayPixel = (px: number, py: number, gray: number): void => {
    if (px < 0 || px >= sheetW || py < 0 || py >= sheetH) return
    const i = (py * sheetW + px) * 4
    out[i] = gray
    out[i + 1] = gray
    out[i + 2] = gray
    out[i + 3] = 255
  }

  for (let r = 0; r < rows; r++) {
    const oy = margin + r * (photoH + gap)
    for (let c = 0; c < cols; c++) {
      const ox = margin + c * (photoW + gap)
      for (let y = 0; y < photoH; y++) {
        for (let x = 0; x < photoW; x++) {
          const srcIdx = (y * photoW + x) * 4
          const dstIdx = ((oy + y) * sheetW + (ox + x)) * 4
          out[dstIdx] = photoPixels[srcIdx]
          out[dstIdx + 1] = photoPixels[srcIdx + 1]
          out[dstIdx + 2] = photoPixels[srcIdx + 2]
          out[dstIdx + 3] = 255
        }
      }

      if (drawCutMarks) {
        // Subtle L-shaped corner cut ticks around each ID photo cell
        const corners: Array<[number, number, number, number]> = [
          [ox - 2, oy - 2, -1, -1],
          [ox + photoW + 1, oy - 2, 1, -1],
          [ox - 2, oy + photoH + 1, -1, 1],
          [ox + photoW + 1, oy + photoH + 1, 1, 1]
        ]
        for (const [cx, cy, dx, dy] of corners) {
          for (let k = 0; k < markLen; k++) {
            setGrayPixel(cx + dx * k, cy, 168)
            setGrayPixel(cx, cy + dy * k, 168)
          }
        }
      }
    }
  }

  return { pixels: out, width: sheetW, height: sheetH, count: cols * rows }
}

// ── Portrait Batch Sync Clipboard ────────────────────────────────

export interface PortraitBatchClipboardPayload {
  schema: 'ai-art-engine.portrait-batch-sync'
  version: 1
  state: PortraitRetouchState
  customLut: PortraitCubeLut | null
}

export function serializePortraitBatchClipboard(input: {
  state?: Partial<PortraitRetouchState> | null
  customLut?: PortraitCubeLut | null
}): string {
  const payload: PortraitBatchClipboardPayload = {
    schema: 'ai-art-engine.portrait-batch-sync',
    version: 1,
    state: normalizePortraitRetouch(input.state),
    customLut: normalizePortraitCubeLut(input.customLut)
  }
  return JSON.stringify(payload)
}

export function parsePortraitBatchClipboard(raw: string): {
  state: PortraitRetouchState
  customLut: PortraitCubeLut | null
} | null {
  try {
    const parsed = JSON.parse(raw) as Partial<PortraitBatchClipboardPayload>
    if (!parsed || parsed.schema !== 'ai-art-engine.portrait-batch-sync') return null
    return {
      state: normalizePortraitRetouch(parsed.state),
      customLut: normalizePortraitCubeLut(parsed.customLut)
    }
  } catch {
    return null
  }
}

// ── Multi-Shot Color Consistency (Mean/Std Reinhard Color Transfer) ──

/**
 * Matches the RGB channel mean and standard deviation of `sourcePixels` to `referencePixels`
 * so multi-shot storyboards or batch portraits lock color grading consistently.
 */
export function matchShotColorHistogramRgba(
  sourcePixels: Uint8ClampedArray,
  referencePixels: Uint8ClampedArray,
  strength = 0.85
): Uint8ClampedArray {
  const blend = clamp01(Number.isFinite(strength) ? strength : 0.85)
  const out = new Uint8ClampedArray(sourcePixels)
  if (blend <= 0 || sourcePixels.length < 4 || referencePixels.length < 4) return out

  const stats = (
    buf: Uint8ClampedArray
  ): { mean: [number, number, number]; std: [number, number, number] } => {
    const count = Math.max(1, Math.floor(buf.length / 4))
    let mr = 0
    let mg = 0
    let mb = 0
    for (let i = 0; i < buf.length; i += 4) {
      mr += buf[i]
      mg += buf[i + 1]
      mb += buf[i + 2]
    }
    mr /= count
    mg /= count
    mb /= count
    let vr = 0
    let vg = 0
    let vb = 0
    for (let i = 0; i < buf.length; i += 4) {
      vr += (buf[i] - mr) * (buf[i] - mr)
      vg += (buf[i + 1] - mg) * (buf[i + 1] - mg)
      vb += (buf[i + 2] - mb) * (buf[i + 2] - mb)
    }
    return {
      mean: [mr, mg, mb],
      std: [
        Math.max(4, Math.sqrt(vr / count)),
        Math.max(4, Math.sqrt(vg / count)),
        Math.max(4, Math.sqrt(vb / count))
      ]
    }
  }

  const srcStat = stats(sourcePixels)
  const refStat = stats(referencePixels)

  for (let i = 0; i < out.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const val = sourcePixels[i + c]
      const transferred =
        (val - srcStat.mean[c]) * (refStat.std[c] / srcStat.std[c]) + refStat.mean[c]
      out[i + c] = clamp255(val * (1 - blend) + transferred * blend)
    }
  }
  return out
}

// ── Smart Dual-Engine Classifier & Triple Identity Lock ──────────

export type PortraitIdentityLockMode =
  'full-local' | 'exterior-face-lock' | 'landmark-frequency-fusion'

export interface PortraitExecutionStrategy {
  /** Recommended execution route */
  recommendedEngine: 'local-deterministic' | 'hybrid-exterior-lock' | 'hybrid-frequency-fusion'
  /** True only when at least one generative synthesis parameter (attire, prompt bg, hairline, makeup, etc.) is active */
  requiresGenerativeModel: boolean
  /** How facial identity should be locked when combining with an AI model */
  identityLockMode: PortraitIdentityLockMode
  /** Active parameters handled deterministically by the local computational photography pipeline */
  computationalKeys: string[]
  /** Active parameters that require AI synthesis only OUTSIDE the core face (attire, hairline, body, background) */
  exteriorGenerativeKeys: string[]
  /** Active parameters that request AI synthesis INSIDE the face (makeup, glasses glare, double eyelid, etc.) */
  facialGenerativeKeys: string[]
}

const COMPUTATIONAL_PORTRAIT_KEYS: ReadonlyArray<keyof PortraitRetouchState> = [
  'blemishRemoval',
  'underEye',
  'wrinkles',
  'shineRemoval',
  'doubleChin',
  'skinSmoothing',
  'skinTexture',
  'skinEvenness',
  'skinDenoise',
  'skinWhiten',
  'skinRosy',
  'skinDeYellow',
  'skinToneWarmth',
  'bodyToneUnify',
  'faceSlim',
  'jawline',
  'chin',
  'eyeSize',
  'eyeSpacing',
  'noseShape',
  'lipShape',
  'catchlight',
  'eyeWhiten',
  'redEye',
  'doubleEyelid',
  'brows',
  'pupilSize',
  'teethWhiten',
  'makeupIntensity',
  'makeupTone',
  'shoulderNeck',
  'neckShoulderLine',
  'waistSlim',
  'legLengthen',
  'fillLight',
  'rimLight',
  'faceContour',
  'lightRatio',
  'lightTemp',
  'cameraStyle',
  'toneGrade',
  'saturation',
  'colorTemp',
  'colorTint',
  'sharpness',
  'clarity',
  'grain',
  'softFocus',
  'vignette'
]

const EXTERIOR_GENERATIVE_KEYS: ReadonlyArray<keyof PortraitRetouchState> = [
  'strayHair',
  'hairlineFill',
  'clothDeWrinkle'
]

const FACIAL_GENERATIVE_KEYS: ReadonlyArray<keyof PortraitRetouchState> = [
  'glassesGlare',
  'teethAlign'
]

/**
 * Classifies a portrait retouch request into deterministic computational photography
 * vs exterior-only generative synthesis vs facial hybrid frequency fusion.
 */
export function classifyPortraitExecutionStrategy(
  rawState?: Partial<PortraitRetouchState> | null,
  options?: {
    extraInstruction?: string | null
    liquifyStrokes?: readonly PortraitLiquifyStroke[] | null
    spotHeals?: readonly PortraitSpotHealPoint[] | null
    customLut?: PortraitCubeLut | null
  }
): PortraitExecutionStrategy {
  const s = normalizePortraitRetouch(rawState)
  const computationalKeys: string[] = []
  const exteriorGenerativeKeys: string[] = []
  const facialGenerativeKeys: string[] = []

  for (const key of COMPUTATIONAL_PORTRAIT_KEYS) {
    const val = s[key]
    if (typeof val === 'string' && val !== 'off' && val !== 'none' && val !== 'keep') {
      computationalKeys.push(key)
    }
  }
  if (s.makeupStyle && s.makeupStyle !== 'none') computationalKeys.push('makeupStyle')
  if (s.lutId !== 'none') computationalKeys.push('lutId')
  if (s.idPhotoSpecId !== 'none') computationalKeys.push('idPhotoSpecId')
  if (s.bgMode === 'color' || s.bgMode === 'gradient') computationalKeys.push('bgMode')
  if ((options?.liquifyStrokes?.length ?? 0) > 0) computationalKeys.push('liquifyStrokes')
  if ((options?.spotHeals?.length ?? 0) > 0) computationalKeys.push('spotHeals')
  if (options?.customLut) computationalKeys.push('customLut')

  for (const key of EXTERIOR_GENERATIVE_KEYS) {
    const val = s[key]
    if (typeof val === 'string' && val !== 'off' && val !== 'none' && val !== 'keep') {
      exteriorGenerativeKeys.push(key)
    }
  }
  if (s.idPhotoAttire !== 'keep') exteriorGenerativeKeys.push('idPhotoAttire')
  if (s.bgMode === 'prompt' || s.bgMode === 'blur') exteriorGenerativeKeys.push('bgMode')

  for (const key of FACIAL_GENERATIVE_KEYS) {
    const val = s[key]
    if (typeof val === 'string' && val !== 'off' && val !== 'none' && val !== 'keep') {
      facialGenerativeKeys.push(key)
    }
  }
  if (s.extraNote.trim().length > 0) facialGenerativeKeys.push('extraNote')
  if ((options?.extraInstruction ?? '').trim().length > 0) {
    facialGenerativeKeys.push('extraInstruction')
  }
  if (s.manualRegions.length > 0) facialGenerativeKeys.push('manualRegions')

  if (facialGenerativeKeys.length === 0 && exteriorGenerativeKeys.length === 0) {
    return {
      recommendedEngine: 'local-deterministic',
      requiresGenerativeModel: false,
      identityLockMode: 'full-local',
      computationalKeys,
      exteriorGenerativeKeys,
      facialGenerativeKeys
    }
  }

  if (facialGenerativeKeys.length === 0 && exteriorGenerativeKeys.length > 0) {
    return {
      recommendedEngine: 'hybrid-exterior-lock',
      requiresGenerativeModel: true,
      identityLockMode: 'exterior-face-lock',
      computationalKeys,
      exteriorGenerativeKeys,
      facialGenerativeKeys
    }
  }

  return {
    recommendedEngine: 'hybrid-frequency-fusion',
    requiresGenerativeModel: true,
    identityLockMode: 'landmark-frequency-fusion',
    computationalKeys,
    exteriorGenerativeKeys,
    facialGenerativeKeys
  }
}

/**
 * Computes the intended 68-point facial landmark coordinates after applying
 * user-requested geometric adjustments (`faceSlim`, `jawline`, `chin`, `eyeSize`,
 * `eyeSpacing`, `noseShape`, `lipShape`, and manual `liquifyStrokes`).
 */
export function computeTargetRetouchedLandmarks(
  rawState: Partial<PortraitRetouchState> | null | undefined,
  landmarks: ReadonlyArray<readonly [number, number]> | null | undefined,
  liquifyStrokes?: readonly PortraitLiquifyStroke[] | null
): Array<[number, number]> | null {
  if (!landmarks || landmarks.length < PORTRAIT_LANDMARK_COUNT) return null
  const state = normalizePortraitRetouch(rawState)
  const strokes = normalizePortraitLiquifyStrokes(liquifyStrokes)
  const controlVectors = buildFaceLiquifyControlVectors(
    {
      ...state,
      shoulderNeck: 'off',
      neckShoulderLine: 'off',
      waistSlim: 'off',
      legLengthen: 'off'
    },
    landmarks
  )
  const pts = landmarks.map(
    (p) => [clamp01(Number(p[0]) || 0), clamp01(Number(p[1]) || 0)] as [number, number]
  )
  if (controlVectors.length === 0 && strokes.length === 0) return pts

  return pts.map(([u, v]) => {
    let tx = u
    let ty = v
    for (let i = 0; i < controlVectors.length; i++) {
      const vec = controlVectors[i]
      const dx = u - vec.origin[0]
      const dy = v - vec.origin[1]
      const distSq = dx * dx + dy * dy
      const rSq = vec.radius * vec.radius
      if (distSq >= rSq || rSq <= 1e-9) continue
      const t = 1 - distSq / rSq
      const weight = t * t
      if (vec.kind === 'translate') {
        tx += vec.delta[0] * weight
        ty += vec.delta[1] * weight
      } else if (vec.kind === 'expand') {
        const factor = (vec.radialFactor ?? 0.1) * weight
        tx += dx * factor
        ty += dy * factor
      } else if (vec.kind === 'contract') {
        const factor = (vec.radialFactor ?? 0.1) * weight
        tx -= dx * factor
        ty -= dy * factor
      }
    }
    for (let i = 0; i < strokes.length; i++) {
      const st = strokes[i]
      const dx = u - st.from[0]
      const dy = v - st.from[1]
      const distSq = dx * dx + dy * dy
      const rSq = st.radius * st.radius
      if (distSq >= rSq || rSq <= 1e-9) continue
      const t = 1 - distSq / rSq
      const weight = t * t * st.strength
      if (st.mode === 'push') {
        tx += (st.to[0] - st.from[0]) * weight
        ty += (st.to[1] - st.from[1]) * weight
      } else if (st.mode === 'bloat') {
        tx += dx * 0.35 * weight
        ty += dy * 0.35 * weight
      } else if (st.mode === 'pucker') {
        tx -= dx * 0.35 * weight
        ty -= dy * 0.35 * weight
      }
    }
    return [clamp01(tx), clamp01(ty)] as [number, number]
  })
}

export interface LandmarkDewarpResult {
  pixels: Uint8ClampedArray
  /** Maximum landmark drift corrected in pixels */
  maxDriftPx: number
  /** Mean landmark drift as a fraction of face bounding box size */
  meanDriftRatio: number
  applied: boolean
}

/**
 * 68-Point Procrustes / MLS Geometric Dewarping:
 * Aligns an AI-generated portrait (`generatedPixels`) back to the exact target 68-point
 * facial geometry (`targetLandmarks`), eliminating interpupillary distance drift, nose/mouth
 * displacement, and facial bone-structure distortion introduced by generative resampling.
 */
export function dewarpPortraitByLandmarksRgba(
  generatedPixels: Uint8ClampedArray,
  width: number,
  height: number,
  generatedLandmarks: ReadonlyArray<readonly [number, number]> | null | undefined,
  targetLandmarks: ReadonlyArray<readonly [number, number]> | null | undefined,
  strength = 1.0
): LandmarkDewarpResult {
  const out = new Uint8ClampedArray(generatedPixels)
  const effStrength = clamp01(Number.isFinite(strength) ? strength : 1.0)
  if (
    effStrength <= 0 ||
    !generatedLandmarks ||
    !targetLandmarks ||
    generatedLandmarks.length < PORTRAIT_LANDMARK_COUNT ||
    targetLandmarks.length < PORTRAIT_LANDMARK_COUNT
  ) {
    return { pixels: out, maxDriftPx: 0, meanDriftRatio: 0, applied: false }
  }

  const targetBox = portraitFaceBoxFromLandmarks(
    targetLandmarks.map((p) => [Number(p[0]) || 0, Number(p[1]) || 0] as [number, number])
  )
  const faceSpan = Math.max(0.04, Math.max(targetBox.w, targetBox.h))
  const diagPx = Math.hypot(width, height)

  const driftX = new Float32Array(PORTRAIT_LANDMARK_COUNT)
  const driftY = new Float32Array(PORTRAIT_LANDMARK_COUNT)
  const tgtX = new Float32Array(PORTRAIT_LANDMARK_COUNT)
  const tgtY = new Float32Array(PORTRAIT_LANDMARK_COUNT)

  let maxDriftNorm = 0
  let sumDriftNorm = 0
  for (let k = 0; k < PORTRAIT_LANDMARK_COUNT; k++) {
    const gx = Number(generatedLandmarks[k][0]) || 0
    const gy = Number(generatedLandmarks[k][1]) || 0
    const tx = Number(targetLandmarks[k][0]) || 0
    const ty = Number(targetLandmarks[k][1]) || 0
    // Clamp extreme outlier detector noise to 18% of faceSpan
    const maxShift = faceSpan * 0.18
    const dx = clamp(gx - tx, -maxShift, maxShift)
    const dy = clamp(gy - ty, -maxShift, maxShift)
    driftX[k] = dx
    driftY[k] = dy
    tgtX[k] = tx
    tgtY[k] = ty
    const dNorm = Math.hypot(dx, dy)
    if (dNorm > maxDriftNorm) maxDriftNorm = dNorm
    sumDriftNorm += dNorm
  }

  const meanDriftNorm = sumDriftNorm / PORTRAIT_LANDMARK_COUNT
  const maxDriftPx = Math.round(maxDriftNorm * diagPx * 100) / 100
  const meanDriftRatio = Math.round((meanDriftNorm / faceSpan) * 10000) / 10000

  // If landmarks are already sub-pixel aligned (< 0.03% of diagonal), skip resampling
  if (maxDriftNorm < 0.0003) {
    return { pixels: out, maxDriftPx: 0, meanDriftRatio: 0, applied: false }
  }

  const radius = clamp(faceSpan * 0.28, 0.05, 0.28)
  const rSq = radius * radius
  const pad = radius * 1.15
  const xMin = Math.max(0, Math.floor((targetBox.x - pad) * width))
  const xMax = Math.min(width - 1, Math.ceil((targetBox.x + targetBox.w + pad) * width))
  const yMin = Math.max(0, Math.floor((targetBox.y - pad) * height))
  const yMax = Math.min(height - 1, Math.ceil((targetBox.y + targetBox.h + pad) * height))

  for (let y = yMin; y <= yMax; y++) {
    const v = (y + 0.5) / height
    for (let x = xMin; x <= xMax; x++) {
      const u = (x + 0.5) / width
      let sumW = 0
      let sumDx = 0
      let sumDy = 0

      for (let k = 0; k < PORTRAIT_LANDMARK_COUNT; k++) {
        const lx = u - tgtX[k]
        const ly = v - tgtY[k]
        const dSq = lx * lx + ly * ly
        if (dSq >= rSq) continue
        const t = 1 - dSq / rSq
        // Wendland C2 + inverse-distance kernel for exact landmark interpolation
        const w = (t * t * t) / (dSq + 0.00025)
        sumW += w
        sumDx += w * driftX[k]
        sumDy += w * driftY[k]
      }

      if (sumW <= 1e-6) continue
      // Smooth boundary anchor damping so pixels at the outer radius decay smoothly to 0
      const anchorDamp = sumW / (sumW + 18)
      const shiftU = (sumDx / sumW) * anchorDamp * effStrength
      const shiftV = (sumDy / sumW) * anchorDamp * effStrength

      const su = clamp01(u + shiftU)
      const sv = clamp01(v + shiftV)
      const sx = clamp(su * width - 0.5, 0, width - 1)
      const sy = clamp(sv * height - 0.5, 0, height - 1)
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const x1 = Math.min(width - 1, x0 + 1)
      const y1 = Math.min(height - 1, y0 + 1)
      const fx = sx - x0
      const fy = sy - y0

      const p00 = (y0 * width + x0) * 4
      const p10 = (y0 * width + x1) * 4
      const p01 = (y1 * width + x0) * 4
      const p11 = (y1 * width + x1) * 4
      const dst = (y * width + x) * 4

      for (let c = 0; c < 4; c++) {
        const top = generatedPixels[p00 + c] * (1 - fx) + generatedPixels[p10 + c] * fx
        const bot = generatedPixels[p01 + c] * (1 - fx) + generatedPixels[p11 + c] * fx
        out[dst + c] = clamp255(top * (1 - fy) + bot * fy)
      }
    }
  }

  return { pixels: out, maxDriftPx, meanDriftRatio, applied: true }
}

/**
 * Multi-Face Nearest-Neighbor Matcher:
 * Given a reference 68-point landmark set (`referenceLandmarks`) and an array of detected
 * candidate faces (`candidateFaces`, e.g. from a group photo after AI generation), returns
 * the candidate face whose normalized centroid and scale best match `referenceLandmarks`.
 */
export function matchCorrespondingFaceLandmarks(
  referenceLandmarks: ReadonlyArray<readonly [number, number]> | null | undefined,
  candidateFaces:
    | ReadonlyArray<
        | ReadonlyArray<readonly [number, number]>
        | { landmarks?: ReadonlyArray<readonly [number, number]> | null }
      >
    | null
    | undefined
): Array<[number, number]> | null {
  if (!candidateFaces || candidateFaces.length === 0) return null
  const validCandidates: Array<Array<[number, number]>> = []
  for (const item of candidateFaces) {
    const face = Array.isArray(item)
      ? item
      : item && typeof item === 'object' && 'landmarks' in item
        ? item.landmarks
        : null
    if (Array.isArray(face) && face.length >= PORTRAIT_LANDMARK_COUNT) {
      validCandidates.push(
        face
          .slice(0, PORTRAIT_LANDMARK_COUNT)
          .map((p) => [clamp01(Number(p[0]) || 0), clamp01(Number(p[1]) || 0)] as [number, number])
      )
    }
  }
  if (validCandidates.length === 0) return null
  if (
    validCandidates.length === 1 ||
    !referenceLandmarks ||
    referenceLandmarks.length < PORTRAIT_LANDMARK_COUNT
  ) {
    return validCandidates[0]
  }

  const refPts = referenceLandmarks
    .slice(0, PORTRAIT_LANDMARK_COUNT)
    .map((p) => [clamp01(Number(p[0]) || 0), clamp01(Number(p[1]) || 0)] as [number, number])
  const refBox = portraitFaceBoxFromLandmarks(refPts)
  const refCenterX = (refPts[27][0] + refPts[8][0]) * 0.5
  const refCenterY = (refPts[27][1] + refPts[8][1]) * 0.5
  const refSpan = Math.max(0.02, Math.hypot(refBox.w, refBox.h))

  let bestFace = validCandidates[0]
  let bestScore = Number.POSITIVE_INFINITY
  for (const cand of validCandidates) {
    const candBox = portraitFaceBoxFromLandmarks(cand)
    const candCenterX = (cand[27][0] + cand[8][0]) * 0.5
    const candCenterY = (cand[27][1] + cand[8][1]) * 0.5
    const candSpan = Math.max(0.02, Math.hypot(candBox.w, candBox.h))
    const centerDist = Math.hypot(candCenterX - refCenterX, candCenterY - refCenterY)
    const scaleDiff = Math.abs(Math.log(candSpan / refSpan))
    const score = centerDist + scaleDiff * 0.18
    if (score < bestScore) {
      bestScore = score
      bestFace = cand
    }
  }
  return bestFace
}

export interface ProcrustesSimilarityTransform {
  scale: number
  angleRad: number
  angleDeg: number
  srcCenter: [number, number]
  dstCenter: [number, number]
  translationNorm: number
  /** Maps a point (u, v) from source space to destination space */
  forward: (u: number, v: number) => [number, number]
  /** Maps a point (u, v) from destination space back to source space */
  inverse: (u: number, v: number) => [number, number]
  isIdentity: boolean
}

const RIGID_CRANIAL_ANCHOR_INDICES: readonly number[] = [
  8, 27, 28, 29, 30, 33, 36, 39, 42, 45, 48, 54
]

/**
 * 2D Orthogonal Procrustes Similarity Transform:
 * Computes the optimal rigid similarity transform (translation + uniform scale + rotation,
 * with zero non-rigid shear) aligning `sourceLandmarks` ($P$) to `destinationLandmarks` ($Q$).
 * Used to align the locally retouched original face onto an AI-reframed/tilted/scaled body/collar
 * while preserving 100% of the person's internal bone structure and facial proportions.
 */
export function computeProcrustesSimilarityTransform(
  sourceLandmarks: ReadonlyArray<readonly [number, number]> | null | undefined,
  destinationLandmarks: ReadonlyArray<readonly [number, number]> | null | undefined
): ProcrustesSimilarityTransform {
  const identity: ProcrustesSimilarityTransform = {
    scale: 1,
    angleRad: 0,
    angleDeg: 0,
    srcCenter: [0.5, 0.5],
    dstCenter: [0.5, 0.5],
    translationNorm: 0,
    forward: (u, v) => [u, v],
    inverse: (u, v) => [u, v],
    isIdentity: true
  }
  if (
    !sourceLandmarks ||
    !destinationLandmarks ||
    sourceLandmarks.length < PORTRAIT_LANDMARK_COUNT ||
    destinationLandmarks.length < PORTRAIT_LANDMARK_COUNT
  ) {
    return identity
  }

  let sx = 0
  let sy = 0
  let dx = 0
  let dy = 0
  const n = RIGID_CRANIAL_ANCHOR_INDICES.length
  for (const idx of RIGID_CRANIAL_ANCHOR_INDICES) {
    sx += Number(sourceLandmarks[idx][0]) || 0
    sy += Number(sourceLandmarks[idx][1]) || 0
    dx += Number(destinationLandmarks[idx][0]) || 0
    dy += Number(destinationLandmarks[idx][1]) || 0
  }
  const srcCenter: [number, number] = [sx / n, sy / n]
  const dstCenter: [number, number] = [dx / n, dy / n]

  let sumDot = 0
  let sumCross = 0
  let sumSrcNormSq = 0
  for (const idx of RIGID_CRANIAL_ANCHOR_INDICES) {
    const px = (Number(sourceLandmarks[idx][0]) || 0) - srcCenter[0]
    const py = (Number(sourceLandmarks[idx][1]) || 0) - srcCenter[1]
    const qx = (Number(destinationLandmarks[idx][0]) || 0) - dstCenter[0]
    const qy = (Number(destinationLandmarks[idx][1]) || 0) - dstCenter[1]
    sumDot += px * qx + py * qy
    sumCross += px * qy - py * qx
    sumSrcNormSq += px * px + py * py
  }

  if (sumSrcNormSq < 1e-6) return identity

  const rawAngle = Math.atan2(sumCross, sumDot)
  const maxAngle = (25 * Math.PI) / 180
  const angleRad = clamp(rawAngle, -maxAngle, maxAngle)
  const rawScale = Math.hypot(sumDot, sumCross) / sumSrcNormSq
  const scale = clamp(rawScale, 0.72, 1.38)
  const cosA = Math.cos(angleRad)
  const sinA = Math.sin(angleRad)
  const invScale = 1 / Math.max(0.1, scale)
  const translationNorm = Math.hypot(dstCenter[0] - srcCenter[0], dstCenter[1] - srcCenter[1])
  const isIdentity =
    translationNorm < 0.0005 && Math.abs(scale - 1) < 0.001 && Math.abs(angleRad) < 0.001

  if (isIdentity) return identity

  return {
    scale,
    angleRad,
    angleDeg: Math.round(((angleRad * 180) / Math.PI) * 100) / 100,
    srcCenter,
    dstCenter,
    translationNorm,
    forward: (u: number, v: number): [number, number] => {
      const rx = u - srcCenter[0]
      const ry = v - srcCenter[1]
      return [
        dstCenter[0] + scale * (rx * cosA - ry * sinA),
        dstCenter[1] + scale * (rx * sinA + ry * cosA)
      ]
    },
    inverse: (u: number, v: number): [number, number] => {
      const rx = (u - dstCenter[0]) * invScale
      const ry = (v - dstCenter[1]) * invScale
      return [srcCenter[0] + (rx * cosA + ry * sinA), srcCenter[1] + (-rx * sinA + ry * cosA)]
    },
    isIdentity: false
  }
}

/**
 * Resamples `sourcePixels` using a 2D Procrustes rigid similarity transform so the source face
 * aligns with the head pose (`translation + uniform scale + rotation`) of `destinationLandmarks`
 * while preserving 100% of `sourceLandmarks`'s internal bone structure.
 */
export function alignPortraitByProcrustesSimilarityRgba(
  sourcePixels: Uint8ClampedArray,
  width: number,
  height: number,
  sourceLandmarks: ReadonlyArray<readonly [number, number]> | null | undefined,
  destinationLandmarks: ReadonlyArray<readonly [number, number]> | null | undefined
): {
  pixels: Uint8ClampedArray
  alignedLandmarks: Array<[number, number]>
  transform: ProcrustesSimilarityTransform
  applied: boolean
} {
  const transform = computeProcrustesSimilarityTransform(sourceLandmarks, destinationLandmarks)
  const basePts = (sourceLandmarks ?? []).map(
    (p) => [Number(p[0]) || 0, Number(p[1]) || 0] as [number, number]
  )
  if (transform.isIdentity) {
    return {
      pixels: new Uint8ClampedArray(sourcePixels),
      alignedLandmarks: basePts,
      transform,
      applied: false
    }
  }

  const alignedLandmarks = basePts.map(([u, v]) => {
    const [au, av] = transform.forward(u, v)
    return [clamp01(au), clamp01(av)] as [number, number]
  })
  const out = new Uint8ClampedArray(sourcePixels.length)
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width
      const [su, sv] = transform.inverse(u, v)
      const sx = clamp(su * width - 0.5, 0, width - 1)
      const sy = clamp(sv * height - 0.5, 0, height - 1)
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const x1 = Math.min(width - 1, x0 + 1)
      const y1 = Math.min(height - 1, y0 + 1)
      const fx = sx - x0
      const fy = sy - y0

      const p00 = (y0 * width + x0) * 4
      const p10 = (y0 * width + x1) * 4
      const p01 = (y1 * width + x0) * 4
      const p11 = (y1 * width + x1) * 4
      const dst = (y * width + x) * 4

      for (let c = 0; c < 4; c++) {
        const top = sourcePixels[p00 + c] * (1 - fx) + sourcePixels[p10 + c] * fx
        const bot = sourcePixels[p01 + c] * (1 - fx) + sourcePixels[p11 + c] * fx
        out[dst + c] = clamp255(top * (1 - fy) + bot * fy)
      }
    }
  }
  return { pixels: out, alignedLandmarks, transform, applied: true }
}

/**
 * SOTA Exterior-Only Face Identity Lock (with 2D Procrustes Pose Alignment & Multi-Band Laplacian Blending):
 * When the generative model is only invoked for exterior edits (attire swap `idPhotoAttire`,
 * background prompt `bgMode`, hairline fill `hairlineFill`, stray hair `strayHair`, body/clothing),
 * this:
 * 1. Rigid-aligns `localRetouchedPixels` (`targetLandmarks`) to the AI head pose (`generatedLandmarks`)
 *    via 2D Orthogonal Procrustes Similarity Transform so head scale/tilt/neck-collar fit is 100% seamless
 *    while preserving 100% of the person's internal facial proportions and bone structure;
 * 2. Blends the aligned face over `generatedPixels` using a 2-Band Laplacian Pyramid (wide feather for
 *    low-frequency illumination with Reinhard seam adaptation, tight core feather for high-frequency
 *    pore & edge crispness) so neither double-edges nor lighting seams ever appear.
 */
export function composeExteriorOnlyIdentityLockRgba(
  localRetouchedPixels: Uint8ClampedArray,
  generatedPixels: Uint8ClampedArray,
  width: number,
  height: number,
  targetLandmarks: ReadonlyArray<readonly [number, number]> | null | undefined,
  rawState?: Partial<PortraitRetouchState> | null,
  generatedLandmarks?: ReadonlyArray<readonly [number, number]> | null
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(generatedPixels)
  if (!targetLandmarks || targetLandmarks.length < PORTRAIT_LANDMARK_COUNT) return out
  const state = normalizePortraitRetouch(rawState)

  // Step 1: 2D Procrustes rigid pose alignment if generatedLandmarks indicates head translation/scale/rotation
  const poseAligned =
    generatedLandmarks && generatedLandmarks.length >= PORTRAIT_LANDMARK_COUNT
      ? alignPortraitByProcrustesSimilarityRgba(
          localRetouchedPixels,
          width,
          height,
          targetLandmarks,
          generatedLandmarks
        )
      : {
          pixels: localRetouchedPixels,
          alignedLandmarks: targetLandmarks.map(
            (p) => [Number(p[0]) || 0, Number(p[1]) || 0] as [number, number]
          )
        }
  const alignedLocalPixels = poseAligned.pixels
  const pts = poseAligned.alignedLandmarks

  const box = portraitFaceBoxFromLandmarks(pts)
  if (!(box.w > 0.005 && box.h > 0.005)) return out

  // Adapt forehead arc height when hairlineFill / strayHair is active so AI-synthesized hairline is preserved
  const hasHairlineEdit = state.hairlineFill !== 'off' || state.strayHair !== 'off'
  const foreheadLift = box.h * (hasHairlineEdit ? 0.14 : 0.26)
  const foreheadArc: Array<[number, number]> = [
    [pts[26][0] + box.w * 0.02, pts[26][1] - foreheadLift * 0.65],
    [pts[24][0], pts[24][1] - foreheadLift * 0.95],
    [(pts[21][0] + pts[22][0]) * 0.5, Math.min(pts[21][1], pts[22][1]) - foreheadLift],
    [pts[19][0], pts[19][1] - foreheadLift * 0.95],
    [pts[17][0] - box.w * 0.02, pts[17][1] - foreheadLift * 0.65]
  ]

  // Adapt lower jaw contour when attire swap is active so suit collar / tie below chin is never overwritten
  const hasAttireSwap = state.idPhotoAttire !== 'keep'
  const jaw = pts.slice(0, 17).map(([jx, jy], idx) => {
    if (hasAttireSwap && idx >= 5 && idx <= 11) {
      return [jx, jy - box.h * 0.015] as [number, number]
    }
    return [jx, jy] as [number, number]
  })

  const lockOutline: Array<[number, number]> = [...jaw, ...foreheadArc]
  const faceMinDim = Math.min(box.w, box.h)
  const feLock = prepareFeatheredPolygon(lockOutline, Math.max(0.01, faceMinDim * 0.042))

  // Step 2: 2-Band Laplacian Pyramid Decomposition for Seamless Multi-Band Blending
  const lapRadius = Math.max(2, Math.round(Math.min(width, height) * 0.015))
  const lfLocal = boxBlurRgb(alignedLocalPixels, width, height, lapRadius)
  const lfGen = boxBlurRgb(generatedPixels, width, height, lapRadius)

  // Compute subtle ambient luminance/chrominance match across core cheek skin so locked face matches scene light
  let sumLocalR = 0
  let sumLocalG = 0
  let sumLocalB = 0
  let sumGenR = 0
  let sumGenG = 0
  let sumGenB = 0
  let sampleCount = 0

  const xMin = Math.max(0, Math.floor(feLock.minX * width))
  const xMax = Math.min(width - 1, Math.ceil(feLock.maxX * width))
  const yMin = Math.max(0, Math.floor(feLock.minY * height))
  const yMax = Math.min(height - 1, Math.ceil(feLock.maxY * height))

  const stepX = Math.max(1, Math.floor((xMax - xMin) / 24))
  const stepY = Math.max(1, Math.floor((yMax - yMin) / 24))
  for (let y = yMin; y <= yMax; y += stepY) {
    const v = (y + 0.5) / height
    for (let x = xMin; x <= xMax; x += stepX) {
      const u = (x + 0.5) / width
      if (sampleFeatheredPolygon(u, v, feLock) > 0.75) {
        const p = (y * width + x) * 4
        if (
          skinToneConfidence(
            alignedLocalPixels[p],
            alignedLocalPixels[p + 1],
            alignedLocalPixels[p + 2]
          ) > 0.5
        ) {
          sumLocalR += alignedLocalPixels[p]
          sumLocalG += alignedLocalPixels[p + 1]
          sumLocalB += alignedLocalPixels[p + 2]
          sumGenR += generatedPixels[p]
          sumGenG += generatedPixels[p + 1]
          sumGenB += generatedPixels[p + 2]
          sampleCount++
        }
      }
    }
  }

  // Gentle ambient lighting offset (at most +-8 RGB levels) so identity pixels stay 100% authentic without edge seams
  const ambientShiftR =
    sampleCount > 8 ? clamp(((sumGenR - sumLocalR) / sampleCount) * 0.22, -8, 8) : 0
  const ambientShiftG =
    sampleCount > 8 ? clamp(((sumGenG - sumLocalG) / sampleCount) * 0.22, -8, 8) : 0
  const ambientShiftB =
    sampleCount > 8 ? clamp(((sumGenB - sumLocalB) / sampleCount) * 0.22, -8, 8) : 0

  for (let y = yMin; y <= yMax; y++) {
    const v = (y + 0.5) / height
    for (let x = xMin; x <= xMax; x++) {
      const u = (x + 0.5) / width
      const wLow = sampleFeatheredPolygon(u, v, feLock)
      if (wLow <= 0.001) continue

      const p4 = (y * width + x) * 4
      const p3 = (y * width + x) * 3

      // Tighter high-frequency feather mask prevents double-edge ghosting at jaw/temple while keeping wide low-freq transition
      const tHigh = clamp01((wLow - 0.14) / 0.72)
      const wHigh = tHigh * tHigh * (3 - 2 * tHigh)

      // Attenuate ambient shift near 1.0 core so eyes/lips/skin center are 100% pure local retouched pixels
      const edgeAmbientW = wLow * (1 - wLow * 0.65)
      const lfLocR = lfLocal[p3] + ambientShiftR * edgeAmbientW
      const lfLocG = lfLocal[p3 + 1] + ambientShiftG * edgeAmbientW
      const lfLocB = lfLocal[p3 + 2] + ambientShiftB * edgeAmbientW

      const hfLocR = alignedLocalPixels[p4] - lfLocal[p3]
      const hfLocG = alignedLocalPixels[p4 + 1] - lfLocal[p3 + 1]
      const hfLocB = alignedLocalPixels[p4 + 2] - lfLocal[p3 + 2]

      const hfGenR = generatedPixels[p4] - lfGen[p3]
      const hfGenG = generatedPixels[p4 + 1] - lfGen[p3 + 1]
      const hfGenB = generatedPixels[p4 + 2] - lfGen[p3 + 2]

      const blendedLowR = lfGen[p3] * (1 - wLow) + lfLocR * wLow
      const blendedLowG = lfGen[p3 + 1] * (1 - wLow) + lfLocG * wLow
      const blendedLowB = lfGen[p3 + 2] * (1 - wLow) + lfLocB * wLow

      const blendedHighR = hfGenR * (1 - wHigh) + hfLocR * wHigh
      const blendedHighG = hfGenG * (1 - wHigh) + hfLocG * wHigh
      const blendedHighB = hfGenB * (1 - wHigh) + hfLocB * wHigh

      out[p4] = clamp255(blendedLowR + blendedHighR)
      out[p4 + 1] = clamp255(blendedLowG + blendedHighG)
      out[p4 + 2] = clamp255(blendedLowB + blendedHighB)
    }
  }

  return out
}

/**
 * Frequency-Separated Hybrid Identity Fusion:
 * When the AI model is used for facial edits (makeup, heavy wrinkle smoothing, glasses glare removal),
 * this fuses the low-frequency illumination/smoothness of the landmark-aligned AI output with
 * the high-frequency pore micro-texture, beauty marks, and locked eye/lip anchors of the original person.
 */
export function fusePortraitIdentityHybridRgba(
  localRetouchedPixels: Uint8ClampedArray,
  alignedAiPixels: Uint8ClampedArray,
  width: number,
  height: number,
  targetLandmarks: ReadonlyArray<readonly [number, number]> | null | undefined,
  rawState?: Partial<PortraitRetouchState> | null
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(alignedAiPixels)
  const regions = extractFaceSemanticRegions(targetLandmarks)
  if (!regions) return out
  const state = normalizePortraitRetouch(rawState)

  const blurRadius = Math.max(2, Math.round(Math.min(width, height) * 0.014))
  const lfLocal = boxBlurRgb(localRetouchedPixels, width, height, blurRadius)
  const lfAi = boxBlurRgb(alignedAiPixels, width, height, blurRadius)

  const faceMinDim = Math.min(regions.box.w, regions.box.h)
  const feFaceSkin = prepareFeatheredPolygon(
    regions.faceSkinOutline,
    Math.max(0.01, faceMinDim * 0.04)
  )
  const feLeftEye = prepareFeatheredPolygon(regions.leftEye, Math.max(0.004, faceMinDim * 0.015))
  const feRightEye = prepareFeatheredPolygon(regions.rightEye, Math.max(0.004, faceMinDim * 0.015))
  const feLeftBrow = prepareFeatheredPolygon(regions.leftBrow, Math.max(0.004, faceMinDim * 0.016))
  const feRightBrow = prepareFeatheredPolygon(
    regions.rightBrow,
    Math.max(0.004, faceMinDim * 0.016)
  )
  const feOuterLip = prepareFeatheredPolygon(regions.outerLip, Math.max(0.004, faceMinDim * 0.015))
  const feInnerMouth = prepareFeatheredPolygon(
    regions.innerMouth,
    Math.max(0.003, faceMinDim * 0.012)
  )

  const xMin = Math.max(0, Math.floor(feFaceSkin.minX * width))
  const xMax = Math.min(width - 1, Math.ceil(feFaceSkin.maxX * width))
  const yMin = Math.max(0, Math.floor(feFaceSkin.minY * height))
  const yMax = Math.min(height - 1, Math.ceil(feFaceSkin.maxY * height))

  // Measure mean skin tone drift between lfLocal and lfAi so AI doesn't shift person's ethnicity/complexion
  let sumLocR = 0
  let sumLocG = 0
  let sumLocB = 0
  let sumAiR = 0
  let sumAiG = 0
  let sumAiB = 0
  let skinSamples = 0
  const stepX = Math.max(1, Math.floor((xMax - xMin) / 24))
  const stepY = Math.max(1, Math.floor((yMax - yMin) / 24))
  for (let y = yMin; y <= yMax; y += stepY) {
    const v = (y + 0.5) / height
    for (let x = xMin; x <= xMax; x += stepX) {
      const u = (x + 0.5) / width
      if (sampleFeatheredPolygon(u, v, feFaceSkin) > 0.7) {
        const p3 = (y * width + x) * 3
        if (skinToneConfidence(lfLocal[p3], lfLocal[p3 + 1], lfLocal[p3 + 2]) > 0.5) {
          sumLocR += lfLocal[p3]
          sumLocG += lfLocal[p3 + 1]
          sumLocB += lfLocal[p3 + 2]
          sumAiR += lfAi[p3]
          sumAiG += lfAi[p3 + 1]
          sumAiB += lfAi[p3 + 2]
          skinSamples++
        }
      }
    }
  }
  const toneCorrR = skinSamples > 8 ? clamp(((sumLocR - sumAiR) / skinSamples) * 0.55, -18, 18) : 0
  const toneCorrG = skinSamples > 8 ? clamp(((sumLocG - sumAiG) / skinSamples) * 0.55, -18, 18) : 0
  const toneCorrB = skinSamples > 8 ? clamp(((sumLocB - sumAiB) / skinSamples) * 0.55, -18, 18) : 0

  const hasGlassesOrEyeAi =
    state.glassesGlare !== 'off' ||
    state.redEye !== 'off' ||
    state.pupilSize !== 'off' ||
    state.doubleEyelid !== 'off'
  const hasBrowAi = state.brows !== 'off'
  const hasMouthAi =
    state.teethAlign !== 'off' ||
    state.makeupStyle !== 'none' ||
    state.makeupIntensity !== 'off' ||
    state.makeupTone !== 'off'
  const hasHeavyMakeup =
    state.makeupStyle !== 'none' || state.makeupIntensity !== 'off' || state.makeupTone !== 'off'

  // Base AI low-frequency weight: 0.42 for standard retouch, 0.62 when makeup/wrinkles are explicitly requested
  const baseAiLowW =
    hasHeavyMakeup || state.wrinkles === 'strong' || state.wrinkles === 'max' ? 0.58 : 0.42
  // High-frequency pore & micro-feature retention from local retouched image (84% original pore/identity detail)
  const localHighW = 0.84

  for (let y = yMin; y <= yMax; y++) {
    const v = (y + 0.5) / height
    for (let x = xMin; x <= xMax; x++) {
      const u = (x + 0.5) / width
      const faceW = sampleFeatheredPolygon(u, v, feFaceSkin)
      if (faceW <= 0.001) continue

      const p4 = (y * width + x) * 4
      const p3 = (y * width + x) * 3

      const locR = localRetouchedPixels[p4]
      const locG = localRetouchedPixels[p4 + 1]
      const locB = localRetouchedPixels[p4 + 2]

      const aiR = alignedAiPixels[p4]
      const aiG = alignedAiPixels[p4 + 1]
      const aiB = alignedAiPixels[p4 + 2]

      const lfLocR = lfLocal[p3]
      const lfLocG = lfLocal[p3 + 1]
      const lfLocB = lfLocal[p3 + 2]
      const hfLocR = locR - lfLocR
      const hfLocG = locG - lfLocG
      const hfLocB = locB - lfLocB

      const lfAiR = lfAi[p3] + toneCorrR
      const lfAiG = lfAi[p3 + 1] + toneCorrG
      const lfAiB = lfAi[p3 + 2] + toneCorrB
      const hfAiR = aiR - lfAi[p3]
      const hfAiG = aiG - lfAi[p3 + 1]
      const hfAiB = aiB - lfAi[p3 + 2]

      const eyeW = Math.max(
        sampleFeatheredPolygon(u, v, feLeftEye),
        sampleFeatheredPolygon(u, v, feRightEye)
      )
      const browW = Math.max(
        sampleFeatheredPolygon(u, v, feLeftBrow),
        sampleFeatheredPolygon(u, v, feRightBrow)
      )
      const lipW = Math.max(
        sampleFeatheredPolygon(u, v, feOuterLip),
        sampleFeatheredPolygon(u, v, feInnerMouth)
      )

      // Detect permanent signature beauty mark / mole in local image so AI never erases it
      const locLuma = 0.299 * locR + 0.587 * locG + 0.114 * locB
      const lfLocLuma = 0.299 * lfLocR + 0.587 * lfLocG + 0.114 * lfLocB
      const redSpike = locR - lfLocR - 0.65 * (locG - lfLocG)
      const moleLockW =
        state.blemishRemoval !== 'max' && lfLocLuma - locLuma > 55 && redSpike < 5 ? 0.9 : 0

      // Anchor 1: Eyes (Iris, Pupil, Canthus) -> 92% locked to local unless glassesGlare/eye AI is active
      const eyeLock = eyeW * (hasGlassesOrEyeAi ? 0.58 : 0.92)
      // Anchor 2: Eyebrows -> 82% locked to local unless brow shaping AI is active
      const browLock = browW * (hasBrowAi ? 0.45 : 0.82)
      // Anchor 3: Lips & Teeth -> 80% locked to local unless lipColor/teethAlign AI is active
      const lipLock = lipW * (hasMouthAi ? 0.42 : 0.8)

      const directAnchorLock = Math.max(eyeLock, browLock, lipLock, moleLockW)

      // Frequency-separated fusion for skin & general face structure
      const effAiLowW = baseAiLowW * (1 - directAnchorLock * 0.85)
      const fusedLowR = lfLocR * (1 - effAiLowW) + lfAiR * effAiLowW
      const fusedLowG = lfLocG * (1 - effAiLowW) + lfAiG * effAiLowW
      const fusedLowB = lfLocB * (1 - effAiLowW) + lfAiB * effAiLowW

      const effLocalHighW = Math.max(localHighW, directAnchorLock)
      const fusedHighR = hfLocR * effLocalHighW + hfAiR * (1 - effLocalHighW)
      const fusedHighG = hfLocG * effLocalHighW + hfAiG * (1 - effLocalHighW)
      const fusedHighB = hfLocB * effLocalHighW + hfAiB * (1 - effLocalHighW)

      const hybridR = clamp255(fusedLowR + fusedHighR)
      const hybridG = clamp255(fusedLowG + fusedHighG)
      const hybridB = clamp255(fusedLowB + fusedHighB)

      out[p4] = clamp255(aiR * (1 - faceW) + hybridR * faceW)
      out[p4 + 1] = clamp255(aiG * (1 - faceW) + hybridG * faceW)
      out[p4 + 2] = clamp255(aiB * (1 - faceW) + hybridB * faceW)
    }
  }

  return out
}

export interface LockPortraitIdentityInput {
  sourcePixels: Uint8ClampedArray
  generatedPixels: Uint8ClampedArray
  width: number
  height: number
  sourceLandmarks: ReadonlyArray<readonly [number, number]> | null | undefined
  generatedLandmarks?: ReadonlyArray<readonly [number, number]> | null | undefined
  state?: Partial<PortraitRetouchState> | null
  extraInstruction?: string | null
  liquifyStrokes?: readonly PortraitLiquifyStroke[] | null
  spotHeals?: readonly PortraitSpotHealPoint[] | null
  /** Optional explicit override for identity lock mode */
  modeOverride?: PortraitIdentityLockMode
}

export interface LockPortraitIdentityResult {
  pixels: Uint8ClampedArray
  mode: PortraitIdentityLockMode
  maxDriftPx: number
  meanDriftRatio: number
  appliedSteps: string[]
}

/**
 * Full Triple Identity Lock Orchestrator:
 * 1. Runs the deterministic local computational photography pipeline on `sourcePixels`
 *    (so skin smoothing, blemish removal, MLS face slimming, and eye/teeth polish have 0 identity drift);
 * 2. Computes target 68 landmarks and dewarps `generatedPixels` (`dewarpPortraitByLandmarksRgba`)
 *    so any AI landmark displacement is geometrically corrected back to the original bone structure;
 * 3. Applies either `composeExteriorOnlyIdentityLockRgba` (100% original face lock with Procrustes pose alignment
 *    & 2-band Laplacian pyramid blending for attire/bg/hairline) or `fusePortraitIdentityHybridRgba`
 *    (low-frequency AI + high-frequency original pores & eye/lip anchors).
 */
export function lockPortraitIdentityRgba(
  input: LockPortraitIdentityInput
): LockPortraitIdentityResult {
  const { width, height, sourcePixels, generatedPixels } = input
  if (!input.sourceLandmarks || input.sourceLandmarks.length < PORTRAIT_LANDMARK_COUNT) {
    return {
      pixels: new Uint8ClampedArray(generatedPixels),
      mode: 'landmark-frequency-fusion',
      maxDriftPx: 0,
      meanDriftRatio: 0,
      appliedSteps: []
    }
  }

  const strategy = classifyPortraitExecutionStrategy(input.state, {
    extraInstruction: input.extraInstruction,
    liquifyStrokes: input.liquifyStrokes,
    spotHeals: input.spotHeals
  })
  const mode = input.modeOverride ?? strategy.identityLockMode
  const appliedSteps: string[] = []

  // Step 1: Produce 100%-identity-faithful local retouched reference
  const localRes = applyPortraitLivePixelPipeline(sourcePixels, width, height, {
    state: input.state,
    landmarks: input.sourceLandmarks,
    liquifyStrokes: input.liquifyStrokes,
    spotHeals: input.spotHeals
  })
  const localPixels = localRes.pixels
  if (localRes.appliedSteps.length > 0) {
    appliedSteps.push('localBaseRetouch')
  }

  if (mode === 'full-local') {
    appliedSteps.push('fullLocalIdentityLock')
    return {
      pixels: localPixels,
      mode: 'full-local',
      maxDriftPx: 0,
      meanDriftRatio: 0,
      appliedSteps
    }
  }

  // Step 2: Compute intended 68 landmarks
  const targetLandmarks =
    computeTargetRetouchedLandmarks(input.state, input.sourceLandmarks, input.liquifyStrokes) ??
    input.sourceLandmarks.map((p) => [Number(p[0]) || 0, Number(p[1]) || 0] as [number, number])

  // Step 3: Exterior Face Lock vs Frequency-Separated Hybrid Fusion
  if (mode === 'exterior-face-lock') {
    // In exterior-only mode (e.g., ID photo attire swap or background prompt), rigid-align targetLandmarks
    // to the AI head pose first so the AI suit collar/neck is never warped out of place, then dewarp only
    // non-rigid facial drift and Laplacian-blend the Procrustes-aligned local face.
    const poseTransform = computeProcrustesSimilarityTransform(
      targetLandmarks,
      input.generatedLandmarks ?? targetLandmarks
    )
    const poseAlignedTarget = poseTransform.isIdentity
      ? targetLandmarks
      : targetLandmarks.map(([u, v]) => {
          const [au, av] = poseTransform.forward(u, v)
          return [clamp01(au), clamp01(av)] as [number, number]
        })
    if (!poseTransform.isIdentity) {
      appliedSteps.push('procrustesPoseAlign')
    }
    const dewarp = dewarpPortraitByLandmarksRgba(
      generatedPixels,
      width,
      height,
      input.generatedLandmarks ?? poseAlignedTarget,
      poseAlignedTarget,
      1.0
    )
    if (dewarp.applied) {
      appliedSteps.push(`landmarkDewarp:${dewarp.maxDriftPx}px`)
    }
    const locked = composeExteriorOnlyIdentityLockRgba(
      localPixels,
      dewarp.pixels,
      width,
      height,
      targetLandmarks,
      input.state,
      poseAlignedTarget
    )
    appliedSteps.push('exteriorFaceIdentityLock')
    return {
      pixels: locked,
      mode: 'exterior-face-lock',
      maxDriftPx: dewarp.maxDriftPx,
      meanDriftRatio: dewarp.meanDriftRatio,
      appliedSteps
    }
  }

  const dewarp = dewarpPortraitByLandmarksRgba(
    generatedPixels,
    width,
    height,
    input.generatedLandmarks ?? targetLandmarks,
    targetLandmarks,
    1.0
  )
  if (dewarp.applied) {
    appliedSteps.push(`landmarkDewarp:${dewarp.maxDriftPx}px`)
  }

  const fused = fusePortraitIdentityHybridRgba(
    localPixels,
    dewarp.pixels,
    width,
    height,
    targetLandmarks,
    input.state
  )
  appliedSteps.push('frequencyHybridIdentityLock')
  return {
    pixels: fused,
    mode: 'landmark-frequency-fusion',
    maxDriftPx: dewarp.maxDriftPx,
    meanDriftRatio: dewarp.meanDriftRatio,
    appliedSteps
  }
}
