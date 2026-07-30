import type { StageVec3 } from '@shared/domain'
import { stripJsonCodeFence } from '@shared/graph'
import { normalizeBoneName } from './skeletonRetarget'

export const AI_POSE_FUNCTION_NAME = 'apply_bone_pose'

export type AiPoseApplyMode = 'replace' | 'merge'

export interface AiBonePoseDeg {
  x: number
  y: number
  z: number
}

export interface AiPoseFunctionCall {
  name: typeof AI_POSE_FUNCTION_NAME
  arguments: {
    bones: Record<string, AiBonePoseDeg>
    mode: AiPoseApplyMode
  }
}

export interface AiPoseBoneContext {
  name: string
  parent: string | null
  /** 当前局部欧拉偏移（度） */
  rotationDeg: AiBonePoseDeg
}

/** 从骨骼名推断人体角色标签，写入 user prompt 帮助模型对齐关节 */
export function inferBoneRole(boneName: string): string {
  const key = normalizeBoneName(boneName)
  if (!key) return 'other'
  if (/(^|[^a-z])(hips|hip|pelvis|root)([^a-z]|$)/.test(key) || key === 'hips' || key.endsWith('hips'))
    return 'hips'
  if (/spine|chest|torso|ribcage/.test(key)) return 'spine'
  if (/neck/.test(key)) return 'neck'
  if (/head/.test(key)) return 'head'
  if (/left/.test(key) && /shoulder|clavicle|collar/.test(key)) return 'l_shoulder'
  if (/right/.test(key) && /shoulder|clavicle|collar/.test(key)) return 'r_shoulder'
  if (/left/.test(key) && /upperarm|arm(?!ature)/.test(key) && !/fore|lower/.test(key))
    return 'l_upperarm'
  if (/right/.test(key) && /upperarm|arm(?!ature)/.test(key) && !/fore|lower/.test(key))
    return 'r_upperarm'
  if (/left/.test(key) && /(forearm|lowerarm)/.test(key)) return 'l_forearm'
  if (/right/.test(key) && /(forearm|lowerarm)/.test(key)) return 'r_forearm'
  if (/left/.test(key) && /hand|wrist/.test(key)) return 'l_hand'
  if (/right/.test(key) && /hand|wrist/.test(key)) return 'r_hand'
  if (/left/.test(key) && /(upleg|thigh|upperleg)/.test(key)) return 'l_thigh'
  if (/right/.test(key) && /(upleg|thigh|upperleg)/.test(key)) return 'r_thigh'
  if (/left/.test(key) && /(leg|calf|shin|lowerleg)/.test(key) && !/upleg|thigh|upperleg/.test(key))
    return 'l_shin'
  if (/right/.test(key) && /(leg|calf|shin|lowerleg)/.test(key) && !/upleg|thigh|upperleg/.test(key))
    return 'r_shin'
  if (/left/.test(key) && /foot|ankle/.test(key)) return 'l_foot'
  if (/right/.test(key) && /foot|ankle/.test(key)) return 'r_foot'
  if (/left/.test(key) && /toe/.test(key)) return 'l_toe'
  if (/right/.test(key) && /toe/.test(key)) return 'r_toe'
  if (/finger|thumb|index|middle|ring|pinky/.test(key)) return 'finger'
  return 'other'
}

function clampDeg(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(-180, Math.min(180, n))
}

function readVec3Deg(raw: unknown): AiBonePoseDeg | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Record<string, unknown>
  const x = clampDeg(Number(row.x))
  const y = clampDeg(Number(row.y))
  const z = clampDeg(Number(row.z))
  if (x === 0 && y === 0 && z === 0) return { x: 0, y: 0, z: 0 }
  return { x, y, z }
}

function readBones(raw: unknown): Record<string, AiBonePoseDeg> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out: Record<string, AiBonePoseDeg> = {}
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const key = name.trim()
    if (!key) continue
    const vec = readVec3Deg(value)
    if (!vec) continue
    out[key] = vec
  }
  return out
}

function readMode(raw: unknown): AiPoseApplyMode {
  return raw === 'merge' ? 'merge' : 'replace'
}

/**
 * 解析模型返回的 function-call JSON。
 * 支持：
 * - `{ "name":"apply_bone_pose", "arguments": { "bones": {...}, "mode":"replace" } }`
 * - `{ "bones": {...}, "mode":"merge" }`
 * - OpenAI 风格 `{ "tool_calls":[{ "function":{ "name","arguments": "..." }}] }`
 */
export function parseAiPoseFunctionCall(raw: string | null | undefined): AiPoseFunctionCall | null {
  if (!raw?.trim()) return null
  const text = stripJsonCodeFence(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      parsed = JSON.parse(text.slice(start, end + 1))
    } catch {
      return null
    }
  }
  if (!parsed || typeof parsed !== 'object') return null
  const root = parsed as Record<string, unknown>

  // OpenAI tool_calls
  if (Array.isArray(root.tool_calls) && root.tool_calls[0]) {
    const call = root.tool_calls[0] as Record<string, unknown>
    const fn = (call.function ?? call) as Record<string, unknown>
    const name = typeof fn.name === 'string' ? fn.name.trim() : ''
    let args: unknown = fn.arguments
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args)
      } catch {
        return null
      }
    }
    if (name && name !== AI_POSE_FUNCTION_NAME) return null
    const bones = readBones((args as Record<string, unknown>)?.bones)
    if (!bones) return null
    return {
      name: AI_POSE_FUNCTION_NAME,
      arguments: { bones, mode: readMode((args as Record<string, unknown>)?.mode) }
    }
  }

  if (typeof root.name === 'string' && root.name.trim() && root.name.trim() !== AI_POSE_FUNCTION_NAME) {
    return null
  }

  const argsObj =
    root.arguments && typeof root.arguments === 'object'
      ? (root.arguments as Record<string, unknown>)
      : root
  const bones = readBones(argsObj.bones)
  if (!bones || !Object.keys(bones).length) return null
  return {
    name: AI_POSE_FUNCTION_NAME,
    arguments: { bones, mode: readMode(argsObj.mode) }
  }
}

/** 将模型返回的骨名（原始或规范化）映射到目标骨骼，度数 → 弧度 */
export function mapAiPoseDegreesToBonePose(
  bonesDeg: Record<string, AiBonePoseDeg>,
  targetBoneNames: string[]
): { bonePose: Record<string, StageVec3>; matched: number; total: number } {
  const total = Object.keys(bonesDeg).length
  const byExact = new Map(targetBoneNames.map((n) => [n, n] as const))
  const byNorm = new Map<string, string>()
  for (const name of targetBoneNames) {
    const key = normalizeBoneName(name)
    if (key && !byNorm.has(key)) byNorm.set(key, name)
  }

  const bonePose: Record<string, StageVec3> = {}
  let matched = 0
  for (const [rawName, deg] of Object.entries(bonesDeg)) {
    const name = rawName.trim()
    if (!name) continue
    const target =
      byExact.get(name) ?? byNorm.get(normalizeBoneName(name)) ?? null
    if (!target) continue
    const x = (clampDeg(deg.x) * Math.PI) / 180
    const y = (clampDeg(deg.y) * Math.PI) / 180
    const z = (clampDeg(deg.z) * Math.PI) / 180
    if (x === 0 && y === 0 && z === 0) {
      // merge 时 0 表示复位该骨；replace 路径外层会整图替换
      bonePose[target] = { x: 0, y: 0, z: 0 }
    } else {
      bonePose[target] = { x, y, z }
    }
    matched += 1
  }
  return { bonePose, matched, total }
}

export function buildAiPoseSystemPrompt(locale: string): string {
  const zh = !locale.toLowerCase().startsWith('en')
  if (zh) {
    return `你是游戏/影视用 3D 动画软件中的角色绑骨姿势助手。根据用户对虚构角色表演姿势的描述，为给定骨架输出关节局部旋转偏移（仅用于数字角色动画）。

规则：
1. 只输出一个 JSON 对象，不要 markdown，不要解释。
2. JSON 必须是 function call 形式：
{"name":"apply_bone_pose","arguments":{"mode":"replace","bones":{"骨骼名":{"x":0,"y":0,"z":0}}}}
3. bones 的键必须使用输入中提供的原始骨骼名（区分大小写）。
4. x/y/z 为相对绑定姿势的局部欧拉角，单位度，范围 -180~180。右手坐标系，XYZ 顺序。
5. 只填写需要转动的骨骼；未列出的骨骼在 mode=replace 时视为 0（复位），mode=merge 时保持原状。
6. 生成可信的静态表演姿势（如走路迈步、跳跃起跳、挥手），不要动画关键帧序列。
7. 优先驱动躯干、脊柱、肩、肘、髋、膝、踝；避免无意义的扭曲。`
  }
  return `You are a character-rig posing helper inside 3D animation software for games/film. Given a fictional character skeleton and a performance pose description, output local joint rotation offsets for digital character animation only.

Rules:
1. Output ONE JSON object only. No markdown. No explanation.
2. Use this function-call shape:
{"name":"apply_bone_pose","arguments":{"mode":"replace","bones":{"BoneName":{"x":0,"y":0,"z":0}}}}
3. Bone keys MUST be exact names from the provided skeleton list (case-sensitive).
4. x/y/z are local Euler offsets from bind pose, in degrees, range -180..180, XYZ order, right-handed.
5. Only include bones that should rotate. Unlisted bones become 0 when mode=replace; kept when mode=merge.
6. Produce a believable static performance pose (walk mid-step, jump takeoff, wave, etc.), not an animation sequence.
7. Prefer torso/spine/shoulders/elbows/hips/knees/ankles; avoid meaningless twist bones.`
}

export function buildAiPoseUserPrompt(input: {
  instruction: string
  bones: AiPoseBoneContext[]
}): string {
  const skeleton = input.bones.map((b) => ({
    name: b.name,
    role: inferBoneRole(b.name),
    parent: b.parent,
    rotationDeg: b.rotationDeg
  }))
  const roles = Array.from(new Set(skeleton.map((b) => b.role).filter((r) => r !== 'other')))
  return [
    'User instruction:',
    input.instruction.trim(),
    '',
    'Available bone roles in this skeleton:',
    roles.length ? roles.join(', ') : '(no standard humanoid roles detected — still use exact name keys)',
    '',
    'Skeleton editable bones (use exact "name" as JSON keys; role is only a hint):',
    JSON.stringify(skeleton, null, 2),
    '',
    'Return the apply_bone_pose function call JSON now. Prefer mode=replace for full-body actions.',
    'Include every major chain bone needed for a readable pose; use only names from the list above.'
  ].join('\n')
}
