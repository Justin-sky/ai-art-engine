import * as THREE from 'three'
import type {
  DirectorAnimKeyframe,
  DirectorAnimPath,
  DirectorAnimPathHandle,
  DirectorAnimPathKind,
  DirectorPathForwardAxis,
  StageVec3
} from '@shared/domain'

const TMP = new THREE.Vector3()
const TMP_TAN = new THREE.Vector3()

function toVec3(p: StageVec3): THREE.Vector3 {
  return new THREE.Vector3(p.x, p.y, p.z)
}

function fromVec3(v: THREE.Vector3): StageVec3 {
  return { x: v.x, y: v.y, z: v.z }
}

export function requiredDrawClicks(kind: DirectorAnimPathKind): number | null {
  if (kind === 'circle' || kind === 'line' || kind === 'rect') return 2
  if (kind === 'pen') return null
  return null
}

export function buildCirclePath(center: StageVec3, rim: StageVec3, segments = 64): StageVec3[] {
  const radius = Math.max(0.05, Math.hypot(rim.x - center.x, rim.z - center.z))
  const y = center.y
  const points: StageVec3[] = []
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2
    points.push({
      x: center.x + Math.cos(a) * radius,
      y,
      z: center.z + Math.sin(a) * radius
    })
  }
  return points
}

export function buildRectPath(a: StageVec3, b: StageVec3): StageVec3[] {
  const y = (a.y + b.y) / 2
  return [
    { x: a.x, y, z: a.z },
    { x: b.x, y, z: a.z },
    { x: b.x, y, z: b.z },
    { x: a.x, y, z: b.z }
  ]
}

export function finalizeDrawnPath(
  kind: DirectorAnimPathKind,
  points: StageVec3[]
): DirectorAnimPath | null {
  if (kind === 'circle') {
    if (points.length < 2) return null
    return {
      kind,
      points: buildCirclePath(points[0], points[1]),
      closed: true
    }
  }
  if (kind === 'rect') {
    if (points.length < 2) return null
    return {
      kind,
      points: buildRectPath(points[0], points[1]),
      closed: true
    }
  }
  if (kind === 'line') {
    if (points.length < 2) return null
    return { kind, points: [points[0], points[1]], closed: false }
  }
  if (points.length < 2) return null
  const cleaned = kind === 'pencil' ? simplifyStrokePoints(points, 0.08, 64) : points.map((p) => ({ ...p }))
  if (cleaned.length < 2) return null
  return {
    kind,
    points: cleaned,
    closed: false
  }
}

/** 按最小间距简化笔画，保留起止点，避免过密点导致曲线抖动。 */
export function simplifyStrokePoints(
  points: StageVec3[],
  minDist = 0.08,
  maxPoints = 64
): StageVec3[] {
  if (points.length <= 2) return points.map((p) => ({ ...p }))
  const result: StageVec3[] = [{ ...points[0] }]
  let last = points[0]
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]
    if (Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z) >= minDist) {
      result.push({ ...p })
      last = p
    }
  }
  const end = points[points.length - 1]
  if (
    result.length === 1 ||
    Math.hypot(end.x - last.x, end.y - last.y, end.z - last.z) > 1e-6
  ) {
    result.push({ ...end })
  }
  if (result.length <= maxPoints) return result
  const step = (result.length - 1) / (maxPoints - 1)
  const decimated: StageVec3[] = []
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.min(result.length - 1, Math.round(i * step))
    decimated.push({ ...result[idx] })
  }
  return decimated
}

export function pathHasEditableHandles(path: DirectorAnimPath | null | undefined): boolean {
  return !!path?.handles && path.handles.length === path.points.length && path.points.length >= 2
}

/**
 * 由锚点邻点差分估算入/出手柄，使进入 Bezier 编辑时形状接近原 CatmullRom。
 */
export function derivePathHandles(points: StageVec3[]): DirectorAnimPathHandle[] {
  const n = points.length
  if (n < 2) return []
  const handles: DirectorAnimPathHandle[] = []
  for (let i = 0; i < n; i++) {
    const prev = points[Math.max(0, i - 1)]
    const cur = points[i]
    const next = points[Math.min(n - 1, i + 1)]
    const tx = (next.x - prev.x) / 6
    const ty = (next.y - prev.y) / 6
    const tz = (next.z - prev.z) / 6
    handles.push({
      in: { x: cur.x - tx, y: cur.y - ty, z: cur.z - tz },
      out: { x: cur.x + tx, y: cur.y + ty, z: cur.z + tz }
    })
  }
  return handles
}

function buildBezierCurvePath(path: DirectorAnimPath): THREE.CurvePath<THREE.Vector3> | null {
  if (!pathHasEditableHandles(path) || !path.handles) return null
  const curvePath = new THREE.CurvePath<THREE.Vector3>()
  for (let i = 0; i < path.points.length - 1; i++) {
    curvePath.add(
      new THREE.CubicBezierCurve3(
        toVec3(path.points[i]),
        toVec3(path.handles[i].out),
        toVec3(path.handles[i + 1].in),
        toVec3(path.points[i + 1])
      )
    )
  }
  return curvePath.curves.length ? curvePath : null
}

function buildCurve(path: DirectorAnimPath): THREE.Curve<THREE.Vector3> | null {
  if (path.points.length < 2) return null
  if (path.kind === 'line' && path.points.length === 2) {
    return new THREE.LineCurve3(toVec3(path.points[0]), toVec3(path.points[1]))
  }
  const bezier = buildBezierCurvePath(path)
  if (bezier) return bezier
  // 铅笔/钢笔：用 chordal + 低张力，更贴近手绘，减少过冲
  if (path.kind === 'pencil' || path.kind === 'pen') {
    return new THREE.CatmullRomCurve3(
      path.points.map(toVec3),
      false,
      'chordal',
      0.15
    )
  }
  const closed = path.closed === true || path.kind === 'circle' || path.kind === 'rect'
  return new THREE.CatmullRomCurve3(
    path.points.map(toVec3),
    closed,
    'catmullrom',
    0.5
  )
}

export function sampleAnimPath(
  path: DirectorAnimPath,
  t: number
): { position: StageVec3; tangent: StageVec3 } | null {
  const curve = buildCurve(path)
  if (!curve) return null
  const u = Math.min(1, Math.max(0, t))
  curve.getPoint(u, TMP)
  curve.getTangent(u, TMP_TAN)
  if (TMP_TAN.lengthSq() < 1e-8) TMP_TAN.set(0, 0, -1)
  else TMP_TAN.normalize()
  return {
    position: fromVec3(TMP),
    tangent: fromVec3(TMP_TAN)
  }
}

/**
 * 由轨迹切线生成朝向，使模型指定本地轴对齐切线。
 * ±X / ±Z：仅绕 Y（保持直立）；±Y：完整朝向切线。
 */
export function rotationFromPathTangent(
  tangent: StageVec3,
  fallback: StageVec3 = { x: 0, y: 0, z: 0 },
  forwardAxis: DirectorPathForwardAxis = '-x'
): StageVec3 {
  const len3 = Math.hypot(tangent.x, tangent.y, tangent.z)
  if (len3 < 1e-6) return { ...fallback }

  if (forwardAxis === '+y' || forwardAxis === '-y') {
    const dir =
      forwardAxis === '+y'
        ? { x: tangent.x / len3, y: tangent.y / len3, z: tangent.z / len3 }
        : { x: -tangent.x / len3, y: -tangent.y / len3, z: -tangent.z / len3 }
    // 将本地 +Y 旋到 dir：先 yaw 再 pitch
    const horizontal = Math.hypot(dir.x, dir.z)
    if (horizontal < 1e-6) {
      return { x: dir.y >= 0 ? -Math.PI / 2 : Math.PI / 2, y: fallback.y, z: 0 }
    }
    return {
      x: Math.atan2(-dir.y, horizontal),
      y: Math.atan2(dir.x, dir.z),
      z: 0
    }
  }

  const len = Math.hypot(tangent.x, tangent.z)
  if (len < 1e-6) return { ...fallback }
  const tx = tangent.x / len
  const tz = tangent.z / len
  let y = 0
  switch (forwardAxis) {
    case '+x':
      // forward=(cos(y),0,-sin(y))
      y = Math.atan2(-tz, tx)
      break
    case '-x':
      // forward=(-cos(y),0,sin(y))
      y = Math.atan2(tz, -tx)
      break
    case '+z':
      // forward=(sin(y),0,cos(y))
      y = Math.atan2(tx, tz)
      break
    case '-z':
    default:
      // forward=(-sin(y),0,-cos(y))
      y = Math.atan2(-tx, -tz)
      break
  }
  return { x: 0, y, z: 0 }
}

export function buildPathLineGeometry(path: DirectorAnimPath, divisions = 128): THREE.BufferGeometry {
  const curve = buildCurve(path)
  if (!curve) {
    const geo = new THREE.BufferGeometry()
    geo.setFromPoints(path.points.map(toVec3))
    return geo
  }
  return new THREE.BufferGeometry().setFromPoints(curve.getPoints(divisions))
}

export function buildDraftLineGeometry(points: StageVec3[]): THREE.BufferGeometry {
  return new THREE.BufferGeometry().setFromPoints(points.map(toVec3))
}

export function flattenStagePositions(points: StageVec3[]): number[] {
  const positions: number[] = []
  for (const p of points) {
    positions.push(p.x, p.y, p.z)
  }
  return positions
}

export function flattenPathPositions(path: DirectorAnimPath, divisions = 128): number[] {
  const curve = buildCurve(path)
  if (!curve) return flattenStagePositions(path.points)
  const positions: number[] = []
  for (const v of curve.getPoints(divisions)) {
    positions.push(v.x, v.y, v.z)
  }
  return positions
}

export interface AnimKeyframeSample {
  position: StageVec3
  rotation: StageVec3
  scale: StageVec3
  tangent: StageVec3
}

function lerpVec3(a: StageVec3, b: StageVec3, u: number): StageVec3 {
  return {
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    z: a.z + (b.z - a.z) * u
  }
}

function keyframeRotation(kf: DirectorAnimKeyframe, fallback: StageVec3): StageVec3 {
  return kf.rotation ? { ...kf.rotation } : { ...fallback }
}

function keyframeScale(kf: DirectorAnimKeyframe, fallback: StageVec3): StageVec3 {
  return kf.scale ? { ...kf.scale } : { ...fallback }
}

/** 将路径按时间均匀烘焙为位置关键帧（始终包含起止时刻） */
export function bakeKeyframesFromPath(
  path: DirectorAnimPath,
  start: number,
  end: number,
  trackId: string
): DirectorAnimKeyframe[] {
  const span = Math.max(0.1, end - start)
  const closed = path.closed === true || path.kind === 'circle' || path.kind === 'rect'
  let count = Math.min(24, Math.max(2, path.kind === 'line' ? 2 : Math.ceil(path.points.length / 2)))
  if (path.kind === 'circle' || path.kind === 'rect') count = Math.min(16, Math.max(8, count))
  if (path.kind === 'pencil' || path.kind === 'pen') {
    count = Math.min(32, Math.max(6, Math.round(path.points.length * 0.6)))
  }
  // 闭合路径多采 1 个点，使末帧落在 end（与起点同位置、不同时间）
  const steps = closed ? count + 1 : count
  const keyframes: DirectorAnimKeyframe[] = []
  for (let i = 0; i < steps; i++) {
    const u = steps <= 1 ? 0 : i / (steps - 1)
    const sample = sampleAnimPath(path, u)
    if (!sample) continue
    keyframes.push({
      id: `kf:${trackId}:${i}:${crypto.randomUUID().slice(0, 8)}`,
      time: start + u * span,
      position: { ...sample.position }
    })
  }
  if (keyframes.length >= 1) {
    keyframes[keyframes.length - 1].time = end
  }
  return keyframes.sort((a, b) => a.time - b.time)
}

export function sampleAnimKeyframes(
  keyframes: DirectorAnimKeyframe[],
  time: number,
  fallback: { rotation: StageVec3; scale: StageVec3 } = {
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 }
  }
): AnimKeyframeSample | null {
  if (!keyframes.length) return null
  const sorted = [...keyframes].sort((a, b) => a.time - b.time)
  if (sorted.length === 1 || time <= sorted[0].time) {
    const kf = sorted[0]
    const next = sorted[1]
    const position = { ...kf.position }
    const tangent = next
      ? normalizeVec({
          x: next.position.x - position.x,
          y: next.position.y - position.y,
          z: next.position.z - position.z
        })
      : { x: 0, y: 0, z: -1 }
    return {
      position,
      rotation: keyframeRotation(kf, fallback.rotation),
      scale: keyframeScale(kf, fallback.scale),
      tangent
    }
  }
  const last = sorted[sorted.length - 1]
  if (time >= last.time) {
    const prev = sorted[sorted.length - 2] ?? last
    const tangent = normalizeVec({
      x: last.position.x - prev.position.x,
      y: last.position.y - prev.position.y,
      z: last.position.z - prev.position.z
    })
    return {
      position: { ...last.position },
      rotation: keyframeRotation(last, keyframeRotation(prev, fallback.rotation)),
      scale: keyframeScale(last, keyframeScale(prev, fallback.scale)),
      tangent
    }
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (time < a.time || time > b.time) continue
    const span = Math.max(1e-6, b.time - a.time)
    const u = (time - a.time) / span
    const position = lerpVec3(a.position, b.position, u)
    const rotation = lerpVec3(
      keyframeRotation(a, fallback.rotation),
      keyframeRotation(b, fallback.rotation),
      u
    )
    const scale = lerpVec3(keyframeScale(a, fallback.scale), keyframeScale(b, fallback.scale), u)
    const tangent = normalizeVec({
      x: b.position.x - a.position.x,
      y: b.position.y - a.position.y,
      z: b.position.z - a.position.z
    })
    return { position, rotation, scale, tangent }
  }
  return {
    position: { ...last.position },
    rotation: keyframeRotation(last, fallback.rotation),
    scale: keyframeScale(last, fallback.scale),
    tangent: { x: 0, y: 0, z: -1 }
  }
}

function normalizeVec(v: StageVec3): StageVec3 {
  const len = Math.hypot(v.x, v.y, v.z)
  if (len < 1e-8) return { x: 0, y: 0, z: -1 }
  return { x: v.x / len, y: v.y / len, z: v.z / len }
}
