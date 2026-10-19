/**
 * Pure computational photography math & pixel pipeline for `image.portrait`.
 *
 * Runs deterministically on `Uint8ClampedArray` RGBA buffers without DOM dependencies,
 * enabling both < 35ms real-time canvas previews in the renderer and headless unit tests in Node.
 */

import { PORTRAIT_LANDMARK_COUNT, portraitFaceBoxFromLandmarks } from './portraitFace'
import {
  normalizePortraitRetouch,
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
    'teethWhiten',
    'fillLight',
    'rimLight',
    'faceContour',
    'lightRatio',
    'lightTemp',
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

  // ── PASS 3: Frequency Separation Skin + Sharpness Low-Freq ─────
  const smoothW = Math.max(
    tierWeight(state.skinSmoothing),
    tierWeight(state.blemishRemoval) * 0.55,
    tierWeight(state.wrinkles) * 0.5,
    tierWeight(state.skinEvenness) * 0.45,
    tierWeight(state.skinDenoise) * 0.4
  )
  const underEyeW = tierWeight(state.underEye)
  const shineW = tierWeight(state.shineRemoval)
  const textureW = tierWeight(state.skinTexture)
  const sharpW = tierWeight(state.sharpness)
  const clarityW = tierWeight(state.clarity)
  const softFocusW = tierWeight(state.softFocus)

  const needLowFreq =
    smoothW > 0 ||
    underEyeW > 0 ||
    shineW > 0 ||
    textureW > 0 ||
    sharpW > 0 ||
    clarityW > 0 ||
    softFocusW > 0

  const blurRadius = Math.max(2, Math.round(Math.min(width, height) * 0.012))
  const lowFreq = needLowFreq ? boxBlurRgb(working, width, height, blurRadius) : null

  if (smoothW > 0 || underEyeW > 0 || shineW > 0 || textureW > 0) {
    appliedSteps.push('frequencySeparationSkin')
  }

  // Pore high-frequency retention factor:
  // When skinTexture is set, preserve or boost high-frequency skin pores even under heavy smoothing!
  const poreRetention =
    textureW > 0
      ? 0.55 + textureW * 0.65
      : smoothW > 0
        ? Math.max(0.22, 0.72 - smoothW * 0.48)
        : 1.0

  // ── PASS 4, 5, 6: Combined Single-Loop Per-Pixel Grading ───────
  const whitenW = tierWeight(state.skinWhiten)
  const rosyW = tierWeight(state.skinRosy)
  const deYellowW = tierWeight(state.skinDeYellow)
  const bodyUnifyW = tierWeight(state.bodyToneUnify)
  const eyeWhitenW = tierWeight(state.eyeWhiten)
  const catchlightW = tierWeight(state.catchlight)
  const teethWhitenW = tierWeight(state.teethWhiten)
  const fillLightW = tierWeight(state.fillLight)
  const contourW = tierWeight(state.faceContour)
  const grainW = tierWeight(state.grain)
  const vignetteW = tierWeight(state.vignette)

  if (eyeWhitenW > 0 || catchlightW > 0 || teethWhitenW > 0) {
    appliedSteps.push('eyesAndTeeth')
  }
  if (
    whitenW > 0 ||
    rosyW > 0 ||
    deYellowW > 0 ||
    bodyUnifyW > 0 ||
    state.skinToneWarmth !== 'off' ||
    state.toneGrade !== 'off' ||
    state.saturation !== 'off' ||
    state.colorTemp !== 'off' ||
    state.colorTint !== 'off' ||
    state.lutId !== 'none' ||
    customLut
  ) {
    appliedSteps.push('colorAndTone')
  }
  if (sharpW > 0 || clarityW > 0 || grainW > 0 || softFocusW > 0 || vignetteW > 0) {
    appliedSteps.push('textureFinish')
  }

  const out = new Uint8ClampedArray(working.length)

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

      const lfR = lowFreq ? lowFreq[p3] : r
      const lfG = lowFreq ? lowFreq[p3 + 1] : g
      const lfB = lowFreq ? lowFreq[p3 + 2] : b
      const hfR = r - lfR
      const hfG = g - lfG
      const hfB = b - lfB

      // Semantic region checks
      const inLeftEye = regions ? pointInPolygon(u, v, regions.leftEye) : false
      const inRightEye = regions ? pointInPolygon(u, v, regions.rightEye) : false
      const inEye = inLeftEye || inRightEye
      const inBrow = regions
        ? pointInPolygon(u, v, regions.leftBrow) || pointInPolygon(u, v, regions.rightBrow)
        : false
      const inOuterLip = regions ? pointInPolygon(u, v, regions.outerLip) : false
      const inInnerMouth = regions ? pointInPolygon(u, v, regions.innerMouth) : false
      const inFacePoly = regions ? pointInPolygon(u, v, regions.faceSkinOutline) : false

      const skinConf = skinToneConfidence(r, g, b)
      // Semantic skin mask: high inside face polygon (excluding eyes/brows/lips), or skin-tone confidence for neck/body
      const isFeatureExcluded = inEye || inBrow || inOuterLip
      const faceSkinWeight = isFeatureExcluded
        ? 0
        : regions
          ? inFacePoly
            ? Math.max(0.65, skinConf)
            : skinConf * (bodyUnifyW > 0 ? 0.9 : 0.45)
          : skinConf

      // 1) Frequency Separation Skin Smoothing + Pore Retention
      if (faceSkinWeight > 0.05 && lowFreq && (smoothW > 0 || textureW > 0)) {
        const effSmooth = smoothW * faceSkinWeight
        const baseR = r * (1 - effSmooth) + lfR * effSmooth
        const baseG = g * (1 - effSmooth) + lfG * effSmooth
        const baseB = b * (1 - effSmooth) + lfB * effSmooth
        const hfScale = 1 + (poreRetention - 1) * faceSkinWeight
        r = baseR + hfR * hfScale
        g = baseG + hfG * hfScale
        b = baseB + hfB * hfScale
      }

      // 2) Under-Eye Dark Circle & Eye-Bag Lift
      if (underEyeW > 0 && regions && !inEye) {
        const inInfra =
          pointInPolygon(u, v, regions.leftInfraorbital) ||
          pointInPolygon(u, v, regions.rightInfraorbital)
        if (inInfra) {
          const lift = underEyeW * 18
          r = lfR * 0.45 + r * 0.55 + lift
          g = lfG * 0.45 + g * 0.55 + lift * 0.92
          b = lfB * 0.45 + b * 0.55 + lift * 0.85
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

      // 4) Eyes Polish: Sclera Whitening & Catchlight
      if (inEye && (eyeWhitenW > 0 || catchlightW > 0)) {
        const luma = 0.299 * r + 0.587 * g + 0.114 * b
        // Sclera pixels have moderate-to-high luminance (not dark pupil/iris)
        if (eyeWhitenW > 0 && luma > 95) {
          const boost = eyeWhitenW * 20
          r = luma + (r - luma) * (1 - eyeWhitenW * 0.45) + boost
          g = luma + (g - luma) * (1 - eyeWhitenW * 0.45) + boost
          b = luma + (b - luma) * (1 - eyeWhitenW * 0.35) + boost * 1.08
        }
        // Catchlight reflection dot slightly upper-right of eye center
        if (catchlightW > 0 && regions) {
          const eyeCenter = inLeftEye ? regions.leftEyeCenter : regions.rightEyeCenter
          const cx = eyeCenter[0] + regions.box.w * 0.014
          const cy = eyeCenter[1] - regions.box.h * 0.012
          const rad = regions.box.w * 0.012
          const dSq = (u - cx) * (u - cx) + (v - cy) * (v - cy)
          if (dSq < rad * rad) {
            const spec = (1 - dSq / (rad * rad)) * catchlightW * 75
            r += spec
            g += spec
            b += spec
          }
        }
      }

      // 5) Teeth Whitening inside Inner Mouth
      if (inInnerMouth && teethWhitenW > 0) {
        const luma = 0.299 * r + 0.587 * g + 0.114 * b
        // Tooth pixels: bright and slightly warm/yellow, not deep red gum/tongue
        if (luma > 105 && r - g < 45) {
          const whiten = teethWhitenW * 24
          r = luma + (r - luma) * (1 - teethWhitenW * 0.6) + whiten
          g = luma + (g - luma) * (1 - teethWhitenW * 0.55) + whiten
          b = luma + (b - luma) * (1 - teethWhitenW * 0.35) + whiten * 1.12
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

      // 7) Lighting & Facial Contour
      if (fillLightW > 0) {
        const luma = 0.299 * r + 0.587 * g + 0.114 * b
        const shadowLift = Math.max(0, (160 - luma) / 160) * fillLightW * 26
        r += shadowLift
        g += shadowLift
        b += shadowLift
      }
      if (contourW > 0 && regions && inFacePoly) {
        // Brighten T-zone/center face, subtly sculpt lateral jawline
        const dx = Math.abs(u - (regions.box.x + regions.box.w * 0.5)) / (regions.box.w * 0.5)
        const sculpt = (0.45 - dx) * contourW * 16
        r += sculpt
        g += sculpt
        b += sculpt
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

      // 9) Built-in LUT & Custom .cube 3D LUT
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
        // Deterministic spatial hash noise
        const hash = Math.sin((x * 12.9898 + y * 78.233) * 43758.5453)
        const noise = (hash - Math.floor(hash) - 0.5) * grainW * 28
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
