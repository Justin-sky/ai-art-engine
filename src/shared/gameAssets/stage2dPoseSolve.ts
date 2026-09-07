/**
 * 2D 骨骼 pose 平面反解（5.5「2D 导演台」骨骼摆姿第三子项地基）。
 *
 * 思路：把 5.3「姿态进导演台」`imagePoseSolver` 的自根向下逐骨解算
 * 落成无 THREE 依赖的平面版——只保留平面旋转：
 * - 图像视为角色「正面平视」：图像 px（y 向下）与舞台画布同一朝向，
 *   keypoint 线段方向直接与 rig 绑定世界方向比较，无需缩放（只对齐方向、保留自身比例）；
 * - 每根「驱动段」（肩→肘 / 肘→腕 / 髋→膝 / 膝→踝 / 躯干中髋→中肩）
 *   在近端关节上求一个局部旋转（度），使其子树当前方向贴到源线段方向；
 * - FK 自根向下逐骨解算（父先于子），偏移相对父关节当前最终旋转求得，
 *   避免链条式过度弯曲；pose 仍是「覆盖绑定旋转」的 Stage2dPose，不改写绑定；
 * - 低置信关键点不驱动（沿用 5.3 poseQuality 口径 POSE_KEYPOINT_MIN_CONF）。
 *
 * 关节 ↔ 关键点靠「角色命名」配对（装配模板已按约定命名）：
 *   躯干 chest/spine/…（向上挂 neck/head 的那节）；肩 shoulder / 肘 elbow /
 *   腕 wrist / 髋 hip / 膝 knee 各带 L/R 侧别（支持 shoulderL、leftShoulder、
 *   elbow_left 等写法）；左右镜像用 flip 互换角色侧别与图像侧别的对应。
 *
 * 纯函数，无 DOM / 模型依赖，可单测。
 */
import {
  computeStage2dRigTransforms,
  normalizeStage2dRig,
  type Stage2dJoint,
  type Stage2dPose,
  type Stage2dRig
} from './stage2dRig'
import type { YoloSkeletonPoint } from '../yolo'

/** 关键点统一置信度下限（与叠加显示一致，低于它不画也不驱动） */
export const STAGE2D_POSE_MIN_CONF = 0.2

/** COCO17 关键点名（与 YOLO_POSE_KEYPOINT_NAMES 顺序一致，自包含便于单测） */
export const COCO17_KEYPOINT_NAMES: string[] = [
  'nose',
  'left_eye',
  'right_eye',
  'left_ear',
  'right_ear',
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle'
]

/** 单人骨架 → 按 COCO 名索引的关键点表（跳过非有限值） */
export function keypointsFromSkeleton(
  skeleton: readonly YoloSkeletonPoint[]
): Record<string, YoloSkeletonPoint> {
  const out: Record<string, YoloSkeletonPoint> = {}
  const count = Math.min(skeleton.length, COCO17_KEYPOINT_NAMES.length)
  for (let i = 0; i < count; i++) {
    const p = skeleton[i]
    const name = COCO17_KEYPOINT_NAMES[i]
    if (!p || !name) continue
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    out[name] = p
  }
  return out
}

// ── 关节角色命名推断 ──────────────────────────────────────────────

export type Stage2dJointRole =
  | 'chest'
  | 'neck'
  | 'head'
  | 'shoulder'
  | 'elbow'
  | 'wrist'
  | 'hip'
  | 'knee'
  | 'ankle'
  | 'other'

const ROLE_WORDS: Record<Exclude<Stage2dJointRole, 'other'>, string[]> = {
  chest: ['spine', 'chest', 'torso'],
  neck: ['neck'],
  head: ['head'],
  shoulder: ['shoulder', 'clavicle', 'collar'],
  elbow: ['elbow'],
  wrist: ['wrist'],
  hip: ['hip'],
  knee: ['knee'],
  ankle: ['ankle', 'foot']
}

/** 词更长者优先匹配（ankle 含 foot 先于 hip？此处按词表长度排序即可稳定） */
const ROLE_PRIORITY = (Object.keys(ROLE_WORDS) as Exclude<Stage2dJointRole, 'other'>[]).sort(
  (a, b) => ROLE_WORDS[b].length - ROLE_WORDS[a].length
)

export interface JointNameTokens {
  words: string[]
  side: 'l' | 'r' | null
}

const SIDE_MARKER = new Set(['left', 'right', 'l', 'r'])
const NAME_NOISE = new Set(['mixamorig', 'bip', 'bone', 'joint', 'root'])

/** 把关节名拆成小写词 + 侧别（left/right/l/r 前后缀不限） */
export function tokenizeJointName(raw: string): JointNameTokens {
  const text = String(raw ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
  const all = text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  const words: string[] = []
  let side: 'l' | 'r' | null = null
  for (const word of all) {
    if (SIDE_MARKER.has(word)) {
      side = word === 'left' || word === 'l' ? 'l' : 'r'
    } else {
      words.push(word)
    }
  }
  while (words.length && NAME_NOISE.has(words[0])) words.shift()
  return { words, side }
}

/** 推断关节角色（用于与关键点段配对） */
export function classifyStage2dJoint(raw: string): {
  role: Stage2dJointRole
  side: 'l' | 'r' | null
} {
  const { words, side } = tokenizeJointName(raw)
  const set = new Set(words)
  for (const role of ROLE_PRIORITY) {
    if (ROLE_WORDS[role].some((w) => set.has(w))) return { role, side }
  }
  return { role: 'other', side }
}

// ── 解算计划与几何 ────────────────────────────────────────────────

/** 状态行：ok / no-joint / no-tip / no-keypoints / degenerate */
export type Stage2dPoseSegmentStatus =
  | 'ok'
  | 'no-joint'
  | 'no-tip'
  | 'no-keypoints'
  | 'degenerate'

export type Stage2dPoseSegmentKey = 'upperarm' | 'forearm' | 'thigh' | 'shin' | 'torso'

export interface Stage2dPoseSolveSegment {
  key: Stage2dPoseSegmentKey
  side: 'l' | 'r' | null
  /** 命中的 rig 关节 id；未命中为 null */
  jointId: string | null
  status: Stage2dPoseSegmentStatus
  reason?: string
}

export interface Stage2dPoseSolveResult {
  /** 关节 id → 摆姿旋转（度，覆盖绑定）；只含成功驱动的关节 */
  pose: Stage2dPose
  /** 成功驱动的关节 id（FK 父先于子的顺序） */
  driven: string[]
  /** 每个计划驱动段的解算状态 */
  segments: Stage2dPoseSolveSegment[]
}

export interface Stage2dPoseSolveOptions {
  rig: Stage2dRig
  /** 单人 COCO17 关键点（索引与 YOLO_POSE_KEYPOINT_NAMES 一一对应） */
  skeleton: readonly YoloSkeletonPoint[]
  /** true：角色左臂对齐图像人物右臂（bind 朝向相反 / 自拍镜像时用） */
  flip?: boolean
  /** 是否驱动躯干脊柱（默认 true） */
  driveTorso?: boolean
  /** 单点置信度低于该值视为缺失；缺省 STAGE2D_POSE_MIN_CONF */
  minConfidence?: number
}

interface LimbDrivePlan {
  key: Exclude<Stage2dPoseSegmentKey, 'torso'>
  /** 受驱动关节角色（近端） */
  pivotRole: Exclude<Stage2dJointRole, 'other'>
  /** 段末端关节角色（沿肢体方向最近的后代） */
  tipRole: Exclude<Stage2dJointRole, 'other'>
  /** COCO 关键点对：left_shoulder → 'shoulder' 等 */
  proximalKp: string
  distalKp: string
}

const LIMB_DRIVE_PLANS: LimbDrivePlan[] = [
  { key: 'upperarm', pivotRole: 'shoulder', tipRole: 'elbow', proximalKp: 'shoulder', distalKp: 'elbow' },
  { key: 'forearm', pivotRole: 'elbow', tipRole: 'wrist', proximalKp: 'elbow', distalKp: 'wrist' },
  { key: 'thigh', pivotRole: 'hip', tipRole: 'knee', proximalKp: 'hip', distalKp: 'knee' },
  { key: 'shin', pivotRole: 'knee', tipRole: 'ankle', proximalKp: 'knee', distalKp: 'ankle' }
]

/** 单侧关键点（先按 flip 换边取点，再按置信度过滤） */
function pairPoint(
  names: Record<string, YoloSkeletonPoint>,
  side: 'l' | 'r',
  kp: string,
  minConfidence: number
): YoloSkeletonPoint | null {
  const p = names[`${side === 'l' ? 'left' : 'right'}_${kp}`]
  if (!p) return null
  if (Number.isFinite(p.confidence) && p.confidence < minConfidence) return null
  return p
}

/** 双侧点的可用中心（一侧缺失时退化为单侧点） */
function sideMid(
  names: Record<string, YoloSkeletonPoint>,
  kp: string,
  minConfidence: number
): YoloSkeletonPoint | null {
  const l = pairPoint(names, 'l', kp, minConfidence)
  const r = pairPoint(names, 'r', kp, minConfidence)
  if (l && r) {
    return { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2, confidence: Math.min(l.confidence, r.confidence) }
  }
  return l ?? r
}

function wrap180(degAngle: number): number {
  let a = ((degAngle % 360) + 540) % 360 - 180
  if (a === -180) a = 180
  return a
}

/** 关节在 rig 中的父子索引（对已归一化的 rig） */
interface RigIndex {
  joints: Stage2dJoint[]
  byId: Map<string, Stage2dJoint>
  children: Map<string, Stage2dJoint[]>
}

function indexRig(rig: Stage2dRig): RigIndex {
  const joints = normalizeStage2dRig(rig).joints
  const byId = new Map(joints.map((j) => [j.id, j]))
  const children = new Map<string, Stage2dJoint[]>()
  for (const joint of joints) {
    if (joint.parentId && byId.has(joint.parentId)) {
      const list = children.get(joint.parentId) ?? []
      list.push(joint)
      children.set(joint.parentId, list)
    }
  }
  return { joints, byId, children }
}

/** 以分类角色匹配关节（side=null 时也会匹配两侧未标侧的关节） */
function jointByRole(
  rig: Stage2dRig,
  role: Stage2dJointRole,
  side: 'l' | 'r' | null
): Stage2dJoint | null {
  for (const joint of normalizeStage2dRig(rig).joints) {
    const cls = classifyStage2dJoint(joint.name || joint.id)
    if (cls.role === role && (side === null || cls.side === null || cls.side === side)) {
      return joint
    }
  }
  return null
}

/** 在 fromId 子树里找第一个角色匹配的后代（不含自身） */
function descendantByRole(index: RigIndex, fromId: string, want: Stage2dJointRole): Stage2dJoint | null {
  const queue = [...(index.children.get(fromId) ?? [])]
  const seen = new Set<string>()
  while (queue.length) {
    const cur = queue.shift()!
    if (seen.has(cur.id)) continue
    seen.add(cur.id)
    if (classifyStage2dJoint(cur.name || cur.id).role === want) return cur
    queue.push(...(index.children.get(cur.id) ?? []))
  }
  return null
}

/** 按关节在 FK 中的父先序给驱动段排队（父先于子） */
function driveOrder(joints: Stage2dJoint[], want: Set<string>): Stage2dJoint[] {
  const order: Stage2dJoint[] = []
  const byId = new Map(joints.map((j) => [j.id, j]))
  const seen = new Set<string>()
  const visit = (joint: Stage2dJoint): void => {
    if (seen.has(joint.id)) return
    seen.add(joint.id)
    if (want.has(joint.id)) order.push(joint)
    for (const child of joints) {
      if (child.parentId === joint.id) visit(child)
    }
  }
  for (const joint of joints) {
    if (!joint.parentId || !byId.has(joint.parentId)) visit(joint)
  }
  return order
}

/** 解算：单人 YOLO COCO17 → rig 平面摆姿 */
export function solveStage2dPoseFromSkeleton(
  options: Stage2dPoseSolveOptions
): Stage2dPoseSolveResult {
  const rig = normalizeStage2dRig(options.rig)
  const skeleton = options.skeleton ?? []
  const result: Stage2dPoseSolveResult = { pose: {}, driven: [], segments: [] }
  if (!rig.joints.length || !skeleton.length) return result

  const minConfidence = options.minConfidence ?? STAGE2D_POSE_MIN_CONF
  const flip = options.flip === true
  const driveTorso = options.driveTorso !== false
  const names = keypointsFromSkeleton(skeleton)
  const index = indexRig(rig)
  const bindById = new Map(rig.joints.map((j) => [j.id, j]))

  /** 关键点侧别（角色侧别 → 源图侧别，flip 互换） */
  const sourceSide = (side: 'l' | 'r'): 'l' | 'r' => (flip ? (side === 'l' ? 'r' : 'l') : side)

  interface Drive {
    joint: Stage2dJoint
    tip: Stage2dJoint
    row: Stage2dPoseSolveSegment
    pair: { from: YoloSkeletonPoint; to: YoloSkeletonPoint } | null
  }

  const drives: Drive[] = []

  const pushDrive = (
    row: Stage2dPoseSolveSegment,
    joint: Stage2dJoint | null,
    tip: Stage2dJoint | null,
    pair: { from: YoloSkeletonPoint; to: YoloSkeletonPoint } | null
  ): void => {
    result.segments.push(row)
    if (!joint) {
      row.status = 'no-joint'
      row.reason = 'no matching joint named in rig (use shoulder/elbow/hip/knee… keywords)'
      return
    }
    if (!tip) {
      row.status = 'no-tip'
      row.reason = 'no distal joint along the limb in rig'
      return
    }
    drives.push({ joint, tip, row, pair })
  }

  // 1) 躯干：驱动“上面挂着 neck/head”的躯干关节（chest/spine…），方向 = 中髋→中肩
  if (driveTorso) {
    const row: Stage2dPoseSolveSegment = { key: 'torso', side: null, jointId: null, status: 'no-joint' }
    let chest: Stage2dJoint | null = null
    for (const joint of rig.joints) {
      const cls = classifyStage2dJoint(joint.name || joint.id)
      if (cls.role !== 'chest') continue
      const hasNeckHead =
        descendantByRole(index, joint.id, 'neck') !== null ||
        descendantByRole(index, joint.id, 'head') !== null
      // 有 neck/head 后代者优先；否则取第一个躯干关节兜底
      if (!chest || hasNeckHead) chest = joint
      if (hasNeckHead) break
    }
    const hipMid = sideMid(names, 'hip', minConfidence)
    const shoulderMid = sideMid(names, 'shoulder', minConfidence)
    const pair =
      hipMid && shoulderMid
        ? { from: { x: hipMid.x, y: hipMid.y, confidence: hipMid.confidence }, to: { x: shoulderMid.x, y: shoulderMid.y, confidence: shoulderMid.confidence } }
        : null
    const tip = chest
      ? descendantByRole(index, chest.id, 'neck') ?? descendantByRole(index, chest.id, 'head')
      : null
    pushDrive(row, chest, tip, pair)
  }

  // 2) 四肢驱动段（每侧 4 段）
  for (const side of ['l', 'r'] as const) {
    for (const plan of LIMB_DRIVE_PLANS) {
      const row: Stage2dPoseSolveSegment = {
        key: plan.key,
        side,
        jointId: null,
        status: 'no-joint'
      }
      const joint = jointByRole(rig, plan.pivotRole, side)
      const tip = joint
        ? descendantByRole(index, joint.id, plan.tipRole) ?? firstChild(index, joint.id)
        : null
      const src = sourceSide(side)
      const from = pairPoint(names, src, plan.proximalKp, minConfidence)
      const to = pairPoint(names, src, plan.distalKp, minConfidence)
      const pair =
        from && to ? { from: { x: from.x, y: from.y, confidence: from.confidence }, to: { x: to.x, y: to.y, confidence: to.confidence } } : null
      pushDrive(row, joint, tip, pair)
    }
  }

  // 3) FK 自根向下逐骨解算：偏移相对父关节最终旋转求得
  const want = new Set(drives.map((d) => d.joint.id))
  const order = driveOrder(rig.joints, want)
  const pose: Stage2dPose = {}
  const driven: string[] = []
  const pending = new Map<string, Drive>()
  for (const drive of drives) pending.set(drive.joint.id, drive)

  for (const joint of order) {
    const drive = pending.get(joint.id)
    if (!drive) continue
    pending.delete(joint.id)
    if (!drive.pair) {
      drive.row.status = 'no-keypoints'
      drive.row.reason = 'image keypoints missing or low confidence'
      continue
    }
    const dx = drive.pair.to.x - drive.pair.from.x
    const dy = drive.pair.to.y - drive.pair.from.y
    if (Math.hypot(dx, dy) < 1e-6) {
      drive.row.status = 'degenerate'
      drive.row.reason = 'keypoint line degenerates to point'
      continue
    }
    // 当前方向：祖先已摆姿、自身与后代仍为绑定
    const transforms = computeStage2dRigTransforms(rig, pose)
    const map = new Map(transforms.map((t) => [t.jointId, t]))
    const cur = map.get(joint.id)
    const tipPos = map.get(drive.tip.id)
    if (!cur || !tipPos) {
      drive.row.status = 'degenerate'
      drive.row.reason = 'rig FK transform unavailable'
      continue
    }
    const bdx = tipPos.x - cur.x
    const bdy = tipPos.y - cur.y
    if (Math.hypot(bdx, bdy) < 1e-6) {
      drive.row.status = 'degenerate'
      drive.row.reason = 'rig bone segment has zero length'
      continue
    }
    const rawTarget = (Math.atan2(dy, dx) * 180) / Math.PI
    // flip = 参考图自拍镜像：换边读点（pair 已按 sourceSide 取）+ 水平方向反射
    const target = wrap180(flip ? 180 - rawTarget : rawTarget)
    const base = wrap180((Math.atan2(bdy, bdx) * 180) / Math.PI)
    const value = wrap180((bindById.get(joint.id)?.rotation ?? 0) + target - base)
    drive.row.status = 'ok'
    drive.row.jointId = joint.id
    if (Math.abs(value) >= 1e-6) {
      pose[joint.id] = value
      driven.push(joint.id)
    }
  }

  // 兜底：把未真正求解的行标记清楚（正常不会走到）
  for (const drive of drives) {
    if (drive.row.status !== 'no-joint') continue
    drive.row.status = drive.pair ? 'degenerate' : 'no-keypoints'
  }

  return { pose, driven, segments: result.segments }
}

function firstChild(index: RigIndex, jointId: string): Stage2dJoint | null {
  const kids = index.children.get(jointId)
  return kids && kids.length ? kids[0] : null
}

/** 便于 UI 展示的段状态统计 */
export function summarizeStage2dSolve(
  result: Stage2dPoseSolveResult
): { ok: number; noJoint: number; noKeypoints: number; degenerate: number; total: number } {
  let ok = 0
  let noJoint = 0
  let noKeypoints = 0
  let degenerate = 0
  for (const seg of result.segments) {
    if (seg.status === 'ok') ok++
    else if (seg.status === 'no-joint') noJoint++
    else if (seg.status === 'no-tip') noKeypoints++
    else if (seg.status === 'no-keypoints') noKeypoints++
    else degenerate++
  }
  return { ok, noJoint, noKeypoints, degenerate, total: result.segments.length }
}
