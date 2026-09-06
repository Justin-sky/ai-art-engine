import * as THREE from 'three'
import type { StageVec3 } from '@shared/domain'

/**
 * COCO17 → 导演台角色骨骼局部欧拉偏移（bonePose，弧度）换算器。
 *
 * 思路（正面近似）：
 * - 图像视为角色「正面平视」视图：图 x→骨架根系 +X、图下方→-Y、深度 z=0。
 * - 所有被驱动骨（脊柱基底/上臂/前臂/大腿/小腿）的目标是世界方向的线段。
 * - 采用 FK 自根向下的逐骨解算：每根骨仅对齐「自身骨段」方向，
 *   偏移相对其父骨「当前最终旋转」求得，避免链条式过度弯曲。
 * - 输出相对 bind 的局部欧拉偏移（弧度，'XYZ'），可直接喂给
 *   `applyObjectBonePoseMap(mode='replace')` 作为角色起始姿势。
 *
 * 已知限制：单视图无深度、前倾不可得；伸出屏幕/弯腰只能近似。
 * 人物/角色左右若镜像，用 flip 互换角色侧别与图像侧别的对应。
 */

export interface PoseKeypoint2D {
  x: number
  y: number
  /** 模型置信度 0~1（可选） */
  confidence?: number
}

export type KeypointMap = Partial<Record<string, PoseKeypoint2D>>

export interface ImagePoseBindBone {
  /** 骨骼名（原始，如 mixamorig:LeftArm） */
  name: string
  /** 几何父骨名；无父时为 null */
  parentName: string | null
  /** bind 局部平移（父空间） */
  position: StageVec3
  /** bind 局部旋转四元数（父空间） */
  quaternion: { x: number; y: number; z: number; w: number }
}

export interface ImagePoseSolveOptions {
  /** 目标角色蒙皮骨骼（bind 局部 TRS，与 bindPoseSnapshots 同构） */
  bones: ImagePoseBindBone[]
  /** COCO17 关键点；键名见 @shared/yolo YOLO_POSE_KEYPOINT_NAMES */
  keypoints: KeypointMap
  /** true：角色左臂对齐图像人物右臂（bind 朝向相反 / 自拍镜像时用） */
  flip?: boolean
  /** 单点置信度低于该值视为缺失；缺省 0.05 */
  minConfidence?: number
  /** 是否驱动躯干脊柱（默认 true） */
  driveTorso?: boolean
}

export interface ImagePoseSolveSegment {
  side: 'l' | 'r' | 'torso'
  role: string
  boneName: string | null
  status: 'ok' | 'no-bone' | 'no-keypoints' | 'degenerate'
  reason?: string
}

export interface ImagePoseSolveResult {
  /** 骨骼名 → 局部欧拉偏移（弧度 XYZ） */
  bonePose: Record<string, StageVec3>
  /** 按 FK 顺序成功驱动的骨骼名 */
  drivenBones: string[]
  /** 计划驱动的段 */
  segments: ImagePoseSolveSegment[]
}

type RoleId =
  | 'hips'
  | 'spine'
  | 'neck'
  | 'head'
  | 'l_shoulder'
  | 'r_shoulder'
  | 'l_upperarm'
  | 'r_upperarm'
  | 'l_forearm'
  | 'r_forearm'
  | 'l_hand'
  | 'r_hand'
  | 'l_thigh'
  | 'r_thigh'
  | 'l_shin'
  | 'r_shin'
  | 'l_foot'
  | 'r_foot'
  | 'l_toe'
  | 'r_toe'
  | 'finger'
  | 'other'

/** 与 skeletonRetarget.normalizeBoneName 对齐的骨名归一化（自包含便于单测） */
function normalizeBoneName(name: string): string {
  return name
    .trim()
    .replace(/^mixamorig[:_\s-]*/i, '')
    .replace(/^bip01[_\s-]*/i, '')
    .replace(/^bone[_\s-]*/i, '')
    .replace(/[_\s\-.:|]+/g, '')
    .toLowerCase()
}

/** 常见肢体关键词；用于把 `_L`/`_R`、`.L`/`.R`、`L_`/`R_` 等单字母侧别标记展开成 left/right */
const LIMB_KEYWORDS = [
  'arm',
  'upperarm',
  'forearm',
  'lowerarm',
  'hand',
  'wrist',
  'thigh',
  'upleg',
  'upperleg',
  'shin',
  'calf',
  'lowerleg',
  'leg',
  'foot',
  'ankle',
  'toe',
  'shoulder',
  'clavicle',
  'collar'
] as const
const LIMB_KEYWORD_SET = new Set<string>(LIMB_KEYWORDS)

/** 把带单字母侧别后缀/前缀的骨骼名展开为包含 left/right 的标准形式，
 *  例如 Arm_L → leftarm、L_UpperArm → leftupperarm、DEF-forearm.L → leftforearm */
function expandSideMarker(name: string): string {
  const key = normalizeBoneName(name)
  if (!key || /left|right/.test(key)) return key
  const mid = key.match(
    /^(.+?)([lr])(arm|forearm|upperarm|lowerarm|hand|wrist|thigh|upleg|upperleg|shin|calf|lowerleg|leg|foot|ankle|toe|shoulder|clavicle|collar)$/
  )
  if (mid) return `${mid[1]}${mid[2] === 'l' ? 'left' : 'right'}${mid[3]}`
  if (key.length > 1) {
    const last = key.slice(-1)
    if ((last === 'l' || last === 'r') && LIMB_KEYWORD_SET.has(key.slice(0, -1))) {
      return `${last === 'l' ? 'left' : 'right'}${key.slice(0, -1)}`
    }
    const first = key[0]
    if ((first === 'l' || first === 'r') && LIMB_KEYWORD_SET.has(key.slice(1))) {
      return `${first === 'l' ? 'left' : 'right'}${key.slice(1)}`
    }
  }
  return key
}

/** 与 aiPoseParse.inferBoneRole 对齐的角色推断（自包含便于单测） */
function inferBoneRole(name: string): RoleId {
  const key = expandSideMarker(name)
  if (!key) return 'other'
  if (/(hips|hip|pelvis|root)$/.test(key)) return 'hips'
  if (/spine|chest|torso|ribcage/.test(key)) return 'spine'
  if (/neck/.test(key)) return 'neck'
  if (/head/.test(key)) return 'head'
  if (/left/.test(key) && /shoulder|clavicle|collar/.test(key)) return 'l_shoulder'
  if (/right/.test(key) && /shoulder|clavicle|collar/.test(key)) return 'r_shoulder'
  if (/left/.test(key) && /upperarm|arm(?!ature)/.test(key) && !/fore|lower/.test(key)) {
    // 排 finger/forearm 后仍匹配 arm 的（如 hand 内 arm 词）避免误判：仅当确实朝肘方向
    if (!/hand|palm/.test(key)) return 'l_upperarm'
  }
  if (/right/.test(key) && /upperarm|arm(?!ature)/.test(key) && !/fore|lower/.test(key)) {
    if (!/hand|palm/.test(key)) return 'r_upperarm'
  }
  if (/left/.test(key) && /(forearm|lowerarm)/.test(key)) return 'l_forearm'
  if (/right/.test(key) && /(forearm|lowerarm)/.test(key)) return 'r_forearm'
  if (/left/.test(key) && /hand|wrist/.test(key)) return 'l_hand'
  if (/right/.test(key) && /hand|wrist/.test(key)) return 'r_hand'
  if (/left/.test(key) && /(upleg|thigh|upperleg)/.test(key)) return 'l_thigh'
  if (/right/.test(key) && /(upleg|thigh|upperleg)/.test(key)) return 'r_thigh'
  if (/left/.test(key) && /(calf|shin|lowerleg|leg(?!.*(foot|toe)))/.test(key)) return 'l_shin'
  if (/right/.test(key) && /(calf|shin|lowerleg|leg(?!.*(foot|toe)))/.test(key)) return 'r_shin'
  if (/left/.test(key) && /(foot|ankle)/.test(key)) return 'l_foot'
  if (/right/.test(key) && /(foot|ankle)/.test(key)) return 'r_foot'
  if (/left/.test(key) && /toe/.test(key)) return 'l_toe'
  if (/right/.test(key) && /toe/.test(key)) return 'r_toe'
  if (/finger|thumb|index|middle|ring|pinky/.test(key)) return 'finger'
  return 'other'
}

function isAuxiliaryName(name: string): boolean {
  const raw = name.trim()
  if (!raw) return true
  if (/twist|roll/i.test(raw)) return true
  if (/(_|:|\.|\s|^)(ik|nub|end|tip|helper|target|pole|leaf)(_|:|\.|\s|$)/i.test(raw)) return true
  return false
}

interface SNode {
  bone: ImagePoseBindBone
  name: string
  parent: SNode | null
  children: SNode[]
  bindLocalQuat: THREE.Quaternion
  bindWorldQuat: THREE.Quaternion
  bindWorldPos: THREE.Vector3
  role: RoleId
  /** FK 解算出的最终世界旋转（含祖先偏移），供后代使用 */
  finalWorldQuat: THREE.Quaternion
}

const EPS_DIST = 1e-4

function oppositeSide(side: 'l' | 'r'): 'l' | 'r' {
  return side === 'l' ? 'r' : 'l'
}

function sideWord(side: 'l' | 'r'): string {
  return side === 'l' ? 'left' : 'right'
}

function jointMap(kp: KeypointMap, side: 'l' | 'r'): Record<string, PoseKeypoint2D | undefined> {
  const w = sideWord(side)
  const out: Record<string, PoseKeypoint2D | undefined> = {}
  for (const j of ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle'] as const) {
    out[j] = kp[`${w}_${j}`]
  }
  return out
}

function takePair(
  a: PoseKeypoint2D | undefined,
  b: PoseKeypoint2D | undefined,
  minConfidence: number
): { from: PoseKeypoint2D; to: PoseKeypoint2D } | null {
  if (!a || !b) return null
  const ca = typeof a.confidence === 'number' ? a.confidence : 1
  const cb = typeof b.confidence === 'number' ? b.confidence : 1
  if (ca < minConfidence || cb < minConfidence) return null
  if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) return null
  if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) return null
  return { from: a, to: b }
}

/** 图 x→+X、图 y（向下）→-Y；无深度（z=0） */
function imageVectorToChar(
  dxPx: number,
  dyPx: number,
  out: THREE.Vector3
): boolean {
  const dx = dxPx
  const dy = -dyPx
  out.set(dx, dy, 0)
  const len = out.length()
  if (len < 1e-6) return false
  out.multiplyScalar(1 / len)
  return true
}

function alignQuaternion(from: THREE.Vector3, to: THREE.Vector3): THREE.Quaternion {
  const a = from.clone().normalize()
  const b = to.clone().normalize()
  const q = new THREE.Quaternion()
  const dot = a.dot(b)
  if (dot > 0.99999) return q
  if (dot < -0.99999) {
    const axis = new THREE.Vector3()
    const ref = Math.abs(a.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)
    axis.crossVectors(a, ref)
    if (axis.lengthSq() < 1e-8) axis.crossVectors(a, new THREE.Vector3(0, 1, 0))
    axis.normalize()
    return q.setFromAxisAngle(axis, Math.PI)
  }
  return q.setFromUnitVectors(a, b)
}

const LIMB_SEGMENTS = ['upperarm', 'forearm', 'thigh', 'shin'] as const
type LimbSegment = (typeof LIMB_SEGMENTS)[number]

const SEG_ROTATE_ROLE: Record<LimbSegment, (s: 'l' | 'r') => RoleId> = {
  upperarm: (s) => (s === 'l' ? 'l_upperarm' : 'r_upperarm'),
  forearm: (s) => (s === 'l' ? 'l_forearm' : 'r_forearm'),
  thigh: (s) => (s === 'l' ? 'l_thigh' : 'r_thigh'),
  shin: (s) => (s === 'l' ? 'l_shin' : 'r_shin')
}

const SEG_TIP_ROLES: Record<LimbSegment, (s: 'l' | 'r') => RoleId[]> = {
  upperarm: (s) => (s === 'l' ? ['l_forearm', 'l_hand'] : ['r_forearm', 'r_hand']),
  forearm: (s) => (s === 'l' ? ['l_hand'] : ['r_hand']),
  thigh: (s) => (s === 'l' ? ['l_shin', 'l_foot'] : ['r_shin', 'r_foot']),
  shin: (s) => (s === 'l' ? ['l_foot', 'l_toe'] : ['r_foot', 'r_toe'])
}

/** 四肢图像关键点对（近端 → 远端；按 YOLO 输出命名） */
const SEG_PAIR: Record<LimbSegment, readonly [string, string]> = {
  upperarm: ['shoulder', 'elbow'],
  forearm: ['elbow', 'wrist'],
  thigh: ['hip', 'knee'],
  shin: ['knee', 'ankle']
}

interface DriveRequest {
  /** 受驱动骨 */
  node: SNode
  /** bind 骨段方向（节点 bind 局部坐标系，v̂） */
  bindDirLocal: THREE.Vector3
  /** 期望世界方向（骨架根坐标系，已归一化） */
  targetWorld: THREE.Vector3
  statusRow: ImagePoseSolveSegment
}

export function solveImagePoseToBonePose(options: ImagePoseSolveOptions): ImagePoseSolveResult {
  const minConfidence = options.minConfidence ?? 0.05
  const flip = options.flip === true
  const driveTorso = options.driveTorso !== false

  const result: ImagePoseSolveResult = { bonePose: {}, drivenBones: [], segments: [] }
  const bones = options.bones ?? []
  if (!bones.length) return result

  // 1. 组装骨骼树
  const byName = new Map<string, SNode>()
  for (const bone of bones) {
    const name = bone.name?.trim()
    if (!name || byName.has(name)) continue
    byName.set(name, {
      bone,
      name,
      parent: null,
      children: [],
      bindLocalQuat: new THREE.Quaternion(
        bone.quaternion?.x ?? 0,
        bone.quaternion?.y ?? 0,
        bone.quaternion?.z ?? 0,
        Number.isFinite(bone.quaternion?.w) ? bone.quaternion.w : 1
      ),
      bindWorldQuat: new THREE.Quaternion(),
      bindWorldPos: new THREE.Vector3(
        bone.position?.x ?? 0,
        bone.position?.y ?? 0,
        bone.position?.z ?? 0
      ),
      role: 'other',
      finalWorldQuat: new THREE.Quaternion()
    })
  }
  const roots: SNode[] = []
  for (const node of byName.values()) {
    const parentName = node.bone.parentName?.trim() || null
    const parent = parentName ? byName.get(parentName) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
    node.parent = parent ?? null
  }

  // 2. bind 世界位姿（根为 origin / identity）
  const visited = new Set<string>()
  const walkBind = (node: SNode): void => {
    if (visited.has(node.name)) return
    visited.add(node.name)
    if (node.parent) {
      node.bindWorldQuat.copy(node.parent.bindWorldQuat).multiply(node.bindLocalQuat)
      const d = new THREE.Vector3(
        node.bindWorldPos.x,
        node.bindWorldPos.y,
        node.bindWorldPos.z
      ).applyQuaternion(node.parent.bindWorldQuat)
      node.bindWorldPos.copy(node.parent.bindWorldPos).add(d)
    } else {
      node.bindWorldQuat.copy(node.bindLocalQuat)
    }
    node.role = inferBoneRole(node.name)
    for (const child of node.children) walkBind(child)
  }
  for (const root of roots) walkBind(root)

  const kp = options.keypoints ?? {}
  const tmpV = new THREE.Vector3()

  const findBoneByRole = (role: RoleId): SNode | null => {
    for (const node of byName.values()) {
      if (node.role === role && !isAuxiliaryName(node.name)) return node
    }
    return null
  }

  /** 子树内找方向末端：优先指定角色骨，否则最近的非零距离后代（容忍 twist 中间骨） */
  const findTip = (node: SNode, preferredRoles: RoleId[]): SNode | null => {
    const wanted = new Set(preferredRoles)
    const queue: SNode[] = [node]
    while (queue.length) {
      const cur = queue.shift()!
      for (const child of cur.children) {
        if (wanted.has(child.role)) return child
        queue.push(child)
      }
    }
    const q2: SNode[] = [node]
    while (q2.length) {
      const cur = q2.shift()!
      for (const child of cur.children) {
        if (child.bindWorldPos.distanceTo(node.bindWorldPos) > EPS_DIST) return child
        q2.push(child)
      }
    }
    return null
  }

  /** bind 骨段在「受驱动骨 bind 局部系」的方向 v̂ */
  const tmpQ = new THREE.Quaternion()
  const bindDirInLocal = (node: SNode, tip: SNode): THREE.Vector3 | null => {
    tmpV.copy(tip.bindWorldPos).sub(node.bindWorldPos)
    if (tmpV.lengthSq() < EPS_DIST * EPS_DIST) return null
    tmpQ.copy(node.bindWorldQuat).invert()
    tmpV.applyQuaternion(tmpQ)
    if (tmpV.lengthSq() < 1e-8) return null
    return tmpV.clone().normalize()
  }

  // 3. 收集驱动请求（骨架拓扑 + 图像方向）
  const drives = new Map<string, DriveRequest>()

  const pushDrive = (row: ImagePoseSolveSegment, req: DriveRequest | null): void => {
    result.segments.push(row)
    if (req) {
      const prev = drives.get(row.boneName!)
      if (!prev) drives.set(row.boneName!, req)
    }
  }

  for (const segment of LIMB_SEGMENTS) {
    for (const side of ['l', 'r'] as const) {
      const srcSide = flip ? oppositeSide(side) : side
      const role = SEG_ROTATE_ROLE[segment](side)
      const row: ImagePoseSolveSegment = { side, role, boneName: null, status: 'no-bone' }
      const node = findBoneByRole(role)
      const tip = node ? findTip(node, SEG_TIP_ROLES[segment](side)) : null
      if (!node || !tip) {
        row.reason = 'no matching role bone in skeleton'
        result.segments.push(row)
        continue
      }
      const pts = jointMap(kp, srcSide)
      const [j0, j1] = SEG_PAIR[segment]
      const pair = takePair(pts[j0], pts[j1], minConfidence)
      if (!pair) {
        row.status = 'no-keypoints'
        row.reason = 'image keypoints missing or low confidence'
        result.segments.push(row)
        continue
      }
      const target = new THREE.Vector3()
      if (!imageVectorToChar(pair.to.x - pair.from.x, pair.to.y - pair.from.y, target)) {
        row.status = 'degenerate'
        row.reason = 'keypoint line degenerates to point'
        result.segments.push(row)
        continue
      }
      const vLocal = bindDirInLocal(node, tip)
      if (!vLocal) {
        row.status = 'degenerate'
        row.reason = 'bind bone segment has zero length'
        result.segments.push(row)
        continue
      }
      row.boneName = node.name
      pushDrive(row, { node, bindDirLocal: vLocal, targetWorld: target, statusRow: row })
    }
  }

  // 4. 躯干脊柱基底（整体前倾/侧倾）
  if (driveTorso) {
    const row: ImagePoseSolveSegment = { side: 'torso', role: 'spine', boneName: null, status: 'no-bone' }
    const spineNode = ((): SNode | null => {
      for (const node of byName.values()) {
        if (node.role !== 'spine' || isAuxiliaryName(node.name)) continue
        let hasSpineAncestor = false
        let p: SNode | null = node.parent
        while (p) {
          if (p.role === 'spine') {
            hasSpineAncestor = true
            break
          }
          p = p.parent
        }
        if (!hasSpineAncestor) return node
      }
      return null
    })()
    if (!spineNode) {
      row.reason = 'no spine/chest bone identified'
      result.segments.push(row)
    } else {
      const lM = jointMap(kp, flip ? 'r' : 'l')
      const rM = jointMap(kp, flip ? 'l' : 'r')
      const hipPair = takePair(lM.hip, rM.hip, minConfidence)
      const shPair = takePair(lM.shoulder, rM.shoulder, minConfidence)
      if (!hipPair || !shPair) {
        row.status = 'no-keypoints'
        row.reason = 'torso needs hip/shoulder keypoints'
        result.segments.push(row)
      } else {
        const hipC = {
          x: (hipPair.from.x + hipPair.to.x) / 2,
          y: (hipPair.from.y + hipPair.to.y) / 2
        }
        const shC = {
          x: (shPair.from.x + shPair.to.x) / 2,
          y: (shPair.from.y + shPair.to.y) / 2
        }
        const target = new THREE.Vector3()
        if (!imageVectorToChar(shC.x - hipC.x, shC.y - hipC.y, target)) {
          row.status = 'degenerate'
          row.reason = 'torso direction degenerates to point'
          result.segments.push(row)
        } else {
          const tip = findTip(spineNode, ['spine', 'neck', 'head'])
          const vLocal = tip ? bindDirInLocal(spineNode, tip) : null
          if (!vLocal) {
            row.status = 'no-bone'
            row.reason = 'spine bone has no upward segment'
            result.segments.push(row)
          } else {
            row.boneName = spineNode.name
            pushDrive(row, {
              node: spineNode,
              bindDirLocal: vLocal,
              targetWorld: target,
              statusRow: row
            })
          }
        }
      }
    }
  }

  // 5. FK 自根向下解算（父先于子），避免逐段绝对对齐导致的过度弯曲
  const order: SNode[] = []
  const stack: SNode[] = [...roots]
  const seen = new Set<string>()
  while (stack.length) {
    const node = stack.pop()!
    if (seen.has(node.name)) continue
    seen.add(node.name)
    order.push(node)
    for (const child of node.children) stack.push(child)
  }

  for (const node of order) {
    const parentFinal = node.parent ? node.parent.finalWorldQuat : null
    const parentQuat = parentFinal ?? new THREE.Quaternion()
    // 基态：bind 世界旋转经过祖先偏移后的当前态（祖先已在前面算好）
    const baseRot = parentQuat.clone().multiply(node.bindLocalQuat)
    const drive = drives.get(node.name)
    if (drive) {
      // 目标映射到父当前系再进 node bind 系：v̂ → (bind⁻¹)·(父当前⁻¹)·T
      const uParent = tmpV.copy(drive.targetWorld).applyQuaternion(parentQuat.clone().invert())
      const uBind = uParent.applyQuaternion(node.bindLocalQuat.clone().invert())
      if (uBind.lengthSq() > 1e-8) {
        uBind.normalize()
        const offset = alignQuaternion(drive.bindDirLocal, uBind)
        const euler = new THREE.Euler().setFromQuaternion(offset, 'XYZ')
        const x = round6(euler.x)
        const y = round6(euler.y)
        const z = round6(euler.z)
        if (!(x === 0 && y === 0 && z === 0)) {
          result.bonePose[node.name] = { x, y, z }
          result.drivenBones.push(node.name)
        }
        node.finalWorldQuat.copy(baseRot).multiply(offset)
        drive.statusRow.status = 'ok'
        continue
      }
      drive.statusRow.status = 'degenerate'
      drive.statusRow.reason = 'target direction degenerate'
    }
    node.finalWorldQuat.copy(baseRot)
  }

  return result
}

function round6(v: number): number {
  if (!Number.isFinite(v)) return 0
  const r = Math.round(v * 1e6) / 1e6
  return Math.abs(r) < 1e-9 ? 0 : r
}
