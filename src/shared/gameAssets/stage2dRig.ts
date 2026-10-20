/**
 * 2D 骨骼装配与摆姿（5.5「2D 导演台」第二子项地基）共享纯函数层。
 *
 * 与 stage2dScene 的分工：舞台场景负责「多精灵层按锚点落位」，
 * 本模块负责「部件挂到骨骼上、摆姿后算出部件该去哪」——
 * 骨骼层级 + attach 槽 + 平面正向运动学（FK），输出每个挂点的
 * 世界坐标与旋转，供舞台层把部件层摆到该处（后续接入）。
 *
 * 坐标系与角度约定（与 spriteGeometry / stage2dScene 一致）：
 * - 舞台画布像素，原点左上，y 向下；
 * - 旋转为角度制、顺时针为正，相对父关节叠加；
 * - 绑定姿势（bind）存在关节上，摆姿 pose 只覆盖关节旋转，
 *   不改写绑定值（可随时回到绑定姿势）。
 *
 * 纯函数，无 DOM / 模型依赖，可单测。
 */

/** 关节 id（rig 内唯一） */
export type Stage2dJointId = string

/** 骨骼关节：相对父关节的绑定偏移 + 绑定旋转 */
export interface Stage2dJoint {
  id: Stage2dJointId
  /** 关节名（如 hip / chest / armL；默认取 id） */
  name: string
  /** 父关节 id；null 表示挂在 rig.root 上 */
  parentId: Stage2dJointId | null
  /** 相对父关节的绑定偏移（父局部坐标系，像素） */
  x: number
  /** 相对父关节的绑定偏移（父局部坐标系，像素） */
  y: number
  /** 绑定旋转（度，顺时针为正），相对父关节 */
  rotation: number
}

/** 部件挂点：把舞台层（stage2dScene.layers[].id）绑到关节 */
export interface Stage2dAttachment {
  /** 被绑定的舞台层 id */
  layerId: string
  /** 挂载到的关节 id */
  jointId: Stage2dJointId
  /** 部件锚点相对关节的偏移（关节局部坐标系，像素） */
  offsetX: number
  /** 部件锚点相对关节的偏移（关节局部坐标系，像素） */
  offsetY: number
  /** 部件自身旋转（度），叠加在关节世界旋转之上 */
  rotation: number
}

/** 2D 骨骼装配数据：根坐标 + 关节层级 + 部件挂点 */
export interface Stage2dRig {
  /** 根关节所在的舞台坐标（绑定姿势） */
  root: { x: number; y: number }
  /** 关节列表（顺序无关，父子关系由 parentId 决定） */
  joints: Stage2dJoint[]
  /** 部件挂点列表 */
  attachments: Stage2dAttachment[]
}

/** 摆姿：jointId → 该关节的局部旋转（度，覆盖绑定值） */
export type Stage2dPose = Record<Stage2dJointId, number>

/** 关节的世界变换（FK 结果） */
export interface Stage2dJointTransform {
  jointId: Stage2dJointId
  /** 世界坐标（舞台像素） */
  x: number
  y: number
  /** 世界旋转（度，顺时针为正） */
  rotation: number
}

/** 部件挂点的世界变换（FK 结果，供舞台层落位 / 旋转） */
export interface Stage2dAttachmentTransform {
  layerId: string
  jointId: Stage2dJointId
  /** 挂点世界坐标（舞台像素） */
  x: number
  y: number
  /** 世界旋转（度）＝ 关节世界旋转 + 部件自身旋转 */
  rotation: number
}

export const DEFAULT_STAGE2D_RIG: Stage2dRig = {
  root: { x: 0, y: 0 },
  joints: [],
  attachments: []
}

/** 归一化入参：字段允许缺失（旧版 / 手工编辑数据也要能吃下） */
export type Stage2dRigInput = Partial<Omit<Stage2dRig, 'joints' | 'attachments'>> & {
  root?: Partial<Stage2dRig['root']> | null
  joints?: Array<Partial<Stage2dJoint> | null>
  attachments?: Array<Partial<Stage2dAttachment> | null>
}

const MAX_COORD = 8192

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function num(raw: unknown, fallback = 0): number {
  const v = Number(raw)
  return Number.isFinite(v) ? v : fallback
}

function clampCoord(raw: unknown): number {
  return clamp(num(raw), -MAX_COORD, MAX_COORD)
}

/** 角度收敛到 (-180, 180]，保证同一姿势有唯一表示（输入可为任意度数） */
function normalizeAngle(raw: unknown): number {
  const deg = num(raw)
  if (!Number.isFinite(deg)) return 0
  const wrapped = ((((deg + 180) % 360) + 360) % 360) - 180
  return wrapped === -180 ? 180 : wrapped
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/** 绕原点顺时针旋转（y 向下坐标系） */
function rotate(x: number, y: number, deg: number): { x: number; y: number } {
  const rad = degToRad(deg)
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return { x: x * cos - y * sin, y: x * sin + y * cos }
}

/**
 * 骨骼装配归一化：
 * - 关节补齐 id / name、坐标与角度夹取，角度收敛到 (-180, 180]；
 * - 父关节不存在 / 自引用 / 成环一律断链挂到 root（不让 FK 死循环）；
 * - 挂点要求 layerId 与 jointId 同时有效，否则剔除。
 */
export function normalizeStage2dRig(raw?: Stage2dRigInput | null): Stage2dRig {
  const base = { ...DEFAULT_STAGE2D_RIG, ...(raw ?? {}) }
  const rawJoints = Array.isArray(base.joints) ? base.joints : []
  const joints: Stage2dJoint[] = rawJoints
    .filter((j): j is Partial<Stage2dJoint> => !!j && typeof j === 'object')
    .map((j, index) => ({
      id: j.id?.trim() || `joint-${index}`,
      name: String(j.name ?? j.id?.trim() ?? `Joint ${index + 1}`),
      parentId: j.parentId?.trim() || null,
      x: clampCoord(j.x),
      y: clampCoord(j.y),
      rotation: normalizeAngle(j.rotation)
    }))
  // id 去重：后出现的关节改名，保证层级引用唯一
  const used = new Set<string>()
  for (const joint of joints) {
    if (!used.has(joint.id)) {
      used.add(joint.id)
      continue
    }
    let suffix = 2
    while (used.has(`${joint.id}-${suffix}`)) suffix += 1
    joint.id = `${joint.id}-${suffix}`
    used.add(joint.id)
  }
  const byId = new Map(joints.map((joint) => [joint.id, joint]))
  // 断环：沿 parentId 上溯，遇到已访问节点说明成环，直接挂 root
  for (const joint of joints) {
    let cursor = joint.parentId
    const seen = new Set<string>([joint.id])
    while (cursor) {
      if (seen.has(cursor)) {
        joint.parentId = null
        break
      }
      seen.add(cursor)
      cursor = byId.get(cursor)?.parentId ?? null
    }
    if (joint.parentId && !byId.has(joint.parentId)) joint.parentId = null
  }

  const rawAttachments = Array.isArray(base.attachments) ? base.attachments : []
  const attachments: Stage2dAttachment[] = rawAttachments
    .filter((a): a is Partial<Stage2dAttachment> => !!a && typeof a === 'object')
    .map((a) => ({
      layerId: String(a.layerId ?? '').trim(),
      jointId: String(a.jointId ?? '').trim(),
      offsetX: clampCoord(a.offsetX),
      offsetY: clampCoord(a.offsetY),
      rotation: normalizeAngle(a.rotation)
    }))
    .filter((a) => !!a.layerId && byId.has(a.jointId))

  return {
    root: { x: clampCoord(base.root?.x), y: clampCoord(base.root?.y) },
    joints,
    attachments
  }
}

/**
 * 正向运动学：自根向下算出每个关节的世界变换（顺序与 joints 一致）。
 * pose 中出现的关节用其角度覆盖绑定旋转（POSE 不改写绑定值）。
 * rootOffset 可选叠加在 rig.root 之上（用于跳跃、跑步重心起伏等根骨骼位移）。
 */
export function computeStage2dRigTransforms(
  rig: Stage2dRig,
  pose?: Stage2dPose | null,
  rootOffset?: { x: number; y: number } | null
): Stage2dJointTransform[] {
  const s = normalizeStage2dRig(rig)
  const rootX = s.root.x + num(rootOffset?.x, 0)
  const rootY = s.root.y + num(rootOffset?.y, 0)
  const transforms = new Map<Stage2dJointId, Stage2dJointTransform>()
  const resolve = (joint: Stage2dJoint): Stage2dJointTransform => {
    const cached = transforms.get(joint.id)
    if (cached) return cached
    const parent = joint.parentId ? s.joints.find((item) => item.id === joint.parentId) : undefined
    const base: Stage2dJointTransform = parent
      ? resolve(parent)
      : { jointId: '', x: rootX, y: rootY, rotation: 0 }
    const parentRotation = base.rotation
    const local = rotate(joint.x, joint.y, parentRotation)
    const rotation = normalizeAngle(parentRotation + (pose?.[joint.id] ?? joint.rotation))
    const next: Stage2dJointTransform = {
      jointId: joint.id,
      x: base.x + local.x,
      y: base.y + local.y,
      rotation
    }
    transforms.set(joint.id, next)
    return next
  }
  return s.joints.map((joint) => resolve(joint))
}

/** 部件挂点世界变换：关节世界变换 + 挂点局部偏移（随关节旋转） */
export function computeStage2dAttachmentTransforms(
  rig: Stage2dRig,
  pose?: Stage2dPose | null,
  rootOffset?: { x: number; y: number } | null
): Stage2dAttachmentTransform[] {
  const s = normalizeStage2dRig(rig)
  const rootX = s.root.x + num(rootOffset?.x, 0)
  const rootY = s.root.y + num(rootOffset?.y, 0)
  const joints = computeStage2dRigTransforms(s, pose, rootOffset)
  return s.attachments.map((attachment) => {
    const joint =
      joints.find((item) => item.jointId === attachment.jointId) ??
      ({ jointId: attachment.jointId, x: rootX, y: rootY, rotation: 0 } as const)
    const local = rotate(attachment.offsetX, attachment.offsetY, joint.rotation)
    return {
      layerId: attachment.layerId,
      jointId: attachment.jointId,
      x: joint.x + local.x,
      y: joint.y + local.y,
      rotation: normalizeAngle(joint.rotation + attachment.rotation)
    }
  })
}

export interface Stage2dTwoBoneIkInput {
  rig: Stage2dRig
  pose?: Stage2dPose | null
  rootOffset?: { x: number; y: number } | null
  /** 末端关节 id（如 wristL / wristR / ankleL / ankleR） */
  effectorJointId: Stage2dJointId
  /** 目标世界坐标（舞台像素） */
  targetX: number
  targetY: number
  /** 弯曲方向偏好（+1 或 -1）；省略时自动选择离当前中段关节最近的一侧防翻转 */
  bendDirection?: 1 | -1
}

/**
 * 2D 双骨解析反向运动学（Two-Bone Analytic IK）：
 * 给定末端关节（effector，如手腕/脚踝）与目标舞台坐标 (targetX, targetY)，
 * 自动反解其父关节（mid，如肘/膝）与祖父关节（upper，如肩/髋）的局部旋转角。
 * 若该关节不足两级父链（如胸/头），则退化为单骨朝向指向目标。
 */
export function solveStage2dTwoBoneIk(input: Stage2dTwoBoneIkInput): Stage2dPose {
  const s = normalizeStage2dRig(input.rig)
  const nextPose: Stage2dPose = { ...(input.pose ?? {}) }
  const byId = new Map(s.joints.map((j) => [j.id, j]))
  const effector = byId.get(input.effectorJointId)
  if (!effector || !effector.parentId) return nextPose

  const currentTransforms = computeStage2dRigTransforms(s, nextPose, input.rootOffset)
  const tfById = new Map(currentTransforms.map((t) => [t.jointId, t]))

  const childCount = new Map<string, number>()
  for (const j of s.joints) {
    if (j.parentId) {
      childCount.set(j.parentId, (childCount.get(j.parentId) ?? 0) + 1)
    }
  }

  const mid = byId.get(effector.parentId)
  if (!mid) return nextPose

  // 单骨退化：effector 的父关节已经是根级关节，或祖父关节是多分支躯干枢纽（如 chest / pelvis）时直接单段对准目标
  const rawUpper = mid.parentId ? byId.get(mid.parentId) : undefined
  const upper = rawUpper && (childCount.get(rawUpper.id) ?? 0) <= 1 ? rawUpper : undefined
  if (!upper) {
    const midTf = tfById.get(mid.id)
    if (!midTf) return nextPose
    const l2 = Math.hypot(effector.x, effector.y)
    const dx = input.targetX - midTf.x
    const dy = input.targetY - midTf.y
    if (l2 < 1e-4 || Math.hypot(dx, dy) < 1e-4) return nextPose
    const restDeg = (Math.atan2(effector.y, effector.x) * 180) / Math.PI
    const targetDeg = (Math.atan2(dy, dx) * 180) / Math.PI
    const parentRot = mid.parentId ? (tfById.get(mid.parentId)?.rotation ?? 0) : 0
    nextPose[mid.id] = normalizeAngle(targetDeg - restDeg - parentRot)
    return nextPose
  }

  const upperTf = tfById.get(upper.id)
  const curMidTf = tfById.get(mid.id)
  if (!upperTf || !curMidTf) return nextPose

  const l1 = Math.hypot(mid.x, mid.y)
  const l2 = Math.hypot(effector.x, effector.y)
  const dx = input.targetX - upperTf.x
  const dy = input.targetY - upperTf.y
  const dist = Math.hypot(dx, dy)
  if (l1 < 1e-4 || l2 < 1e-4 || dist < 1e-4) return nextPose

  const alpha1 = (Math.atan2(mid.y, mid.x) * 180) / Math.PI
  const alpha2 = (Math.atan2(effector.y, effector.x) * 180) / Math.PI
  const phi = (Math.atan2(dy, dx) * 180) / Math.PI
  const upperParentRot = upper.parentId ? (tfById.get(upper.parentId)?.rotation ?? 0) : 0

  const clampedDist = clamp(dist, Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4)
  const cosBeta1 = clamp(
    (l1 * l1 + clampedDist * clampedDist - l2 * l2) / (2 * l1 * clampedDist),
    -1,
    1
  )
  const beta1 = (Math.acos(cosBeta1) * 180) / Math.PI

  // 决定弯曲侧（+1 或 -1）：未显式指定时选择使 mid 关节世界坐标更贴近当前位置的一侧
  let sign: 1 | -1 = input.bendDirection ?? 1
  if (!input.bendDirection) {
    const rotPlus = phi + beta1 - alpha1
    const midPlus = rotate(mid.x, mid.y, rotPlus)
    const dPlus = Math.hypot(upperTf.x + midPlus.x - curMidTf.x, upperTf.y + midPlus.y - curMidTf.y)

    const rotMinus = phi - beta1 - alpha1
    const midMinus = rotate(mid.x, mid.y, rotMinus)
    const dMinus = Math.hypot(
      upperTf.x + midMinus.x - curMidTf.x,
      upperTf.y + midMinus.y - curMidTf.y
    )
    sign = dMinus < dPlus ? -1 : 1
  }

  const upperWorldRot = phi + sign * beta1 - alpha1
  const solvedMidOffset = rotate(mid.x, mid.y, upperWorldRot)
  const solvedMidX = upperTf.x + solvedMidOffset.x
  const solvedMidY = upperTf.y + solvedMidOffset.y

  const toTargetDx = input.targetX - solvedMidX
  const toTargetDy = input.targetY - solvedMidY
  const bcWorldDeg =
    Math.hypot(toTargetDx, toTargetDy) > 1e-4
      ? (Math.atan2(toTargetDy, toTargetDx) * 180) / Math.PI
      : phi
  const midWorldRot = bcWorldDeg - alpha2

  nextPose[upper.id] = normalizeAngle(upperWorldRot - upperParentRot)
  nextPose[mid.id] = normalizeAngle(midWorldRot - upperWorldRot)
  return nextPose
}

/** 新建关节（绑定姿势）：只做字段归一化，parentId 是否合法由 rig 装配时校验 */
export function createStage2dJoint(input: {
  id: string
  name?: string
  parentId?: Stage2dJointId | null
  x?: number
  y?: number
  rotation?: number
}): Stage2dJoint {
  const id = input.id?.trim() || `joint-${Date.now().toString(36)}`
  return {
    id,
    name: String(input.name || id),
    parentId: input.parentId?.trim() || null,
    x: clampCoord(input.x),
    y: clampCoord(input.y),
    rotation: normalizeAngle(input.rotation)
  }
}
