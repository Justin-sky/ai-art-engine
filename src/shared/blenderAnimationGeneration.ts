/**
 * 3D 动画 → Blender MCP 共享层（`model.animation` 节点用）。
 *
 * ## 设计取向
 *
 * 与 `blenderPoseGeneration.ts` / `blenderRigSkinGeneration.ts` 同构：
 *
 * - **预设派发**：13 个常见循环 / 单次动画预设（idle / walk / run / jumpAir / jumpLand /
 *   wave / crouch / sit / bow / fightGuard / kneel / think / handsOnHips），每个预设都
 *   是「骨名 → 帧 → [rx, ry, rz] 弧度」的关键帧表。命中预设即跳过 LLM：直接在 Node 端
 *   算好关键帧，丢给 Blender 写 fcurve。
 * - **LLM 生成 Python**：自由文本描述走 `generateText`，prompt 要求 LLM 输出
 *   「import bpy / math + 写 keyframes + print ANIM_RESULT」的脚本。两端用同一份
 *   stdout 解析（marker + 配对花括号 JSON）。
 *
 * ## 输出 / 契约
 *
 * ```
 * 节点                共享层                          Blender MCP              Blender
 *  │  strategy / code                                       │
 *  │ ─────────────────►                                       │
 *  │  runBlenderMcpTool(execute_blender_code, {code})         │
 *  │ ─────────────────────────────► addon TCP → 跑代码       │
 *  │                                stdout ─────────────────►│
 *  │  parseBlenderAnimReadback(stdout)                         │
 *  │ ◄────────────────────                                     │
 *  │  clip = { name, fps, frameRange, keyframes:{bone:{…}} }  │
 * ```
 *
 * ## 边界
 *
 * - 共享层**不**做 Blender 连接状态检查；那是渲染层的事。
 * - 预设脚本只 `import bpy / bmesh / math / json`，与 AI 路径共用同一份词法护栏。
 * - 关键帧是「相对绑定姿势的局部欧拉偏移」，单位弧度，与 `model.pose` 节点口径一致。
 */

import type { McpToolCallOutcome } from './mcpProtocol'

/** Blender 端脚本「结果在 stdout 的开头打上这个 marker」 */
export const BLENDER_ANIM_RESULT_MARKER = 'ANIM_RESULT:'

/** Blender 端「真写 keyframes 后」的命中/缺失明细 marker */
export const BLENDER_ANIM_DRIVE_META_MARKER = 'ANIM_DRIVE_META:'

/** 共享层已知的动画预设 id；枚举扩展时与 instruction presets 同步 */
export type BlenderAnimPresetId =
  | 'idle'
  | 'walk'
  | 'run'
  | 'jumpAir'
  | 'jumpLand'
  | 'wave'
  | 'handsOnHips'
  | 'think'
  | 'crouch'
  | 'kneel'
  | 'bow'
  | 'fightGuard'
  | 'sit'

/** 单帧关键帧（弧度 XYZ 欧拉偏移，相对绑定姿势） */
export type AnimEulerRad = [number, number, number]

/** 单根骨的关键帧表（按帧号排序，由小到大） */
export type AnimBoneKeyframes = Record<number, AnimEulerRad>

/** 完整关键帧表（骨名 → 帧表） */
export type AnimKeyframes = Record<string, AnimBoneKeyframes>

/** 一个完整动作的描述（与 AI 姿势 preset 共用相同欧拉偏移约定） */
export interface BlenderAnimClip {
  action: string
  fps: number
  frameRange: [number, number]
  keyframes: AnimKeyframes
  presetId: BlenderAnimPresetId | null
}

/** 读取到的「实际写入 Blender 的 action 数据」 */
export type BlenderAnimReadback = BlenderAnimClip

export interface BlenderAnimInput {
  /** 中文 / 英文 instruction；预设派发是字面量匹配 */
  instruction: string
  locale: string
  /** 当前 armature 名；找不到时让 Blender 自动选第一个 ARMATURE */
  armatureName: string
  /** 帧率，默认 24 */
  fps?: number
  /** 总帧数；预设派发按预设内置，用户可覆盖 */
  frames?: number
}

export type BlenderAnimStrategy = 'preset' | 'ai'

export interface BlenderAnimDispatch {
  strategy: BlenderAnimStrategy
  presetId: BlenderAnimPresetId | null
  code: string
  description: string
}

// --- 预设关键帧表 ---------------------------------------------------------
//
// 每条预设按角色（BlenderBoneRole）写关键帧；用 `BlenderBoneRole → Euler 偏移` 与
// `model.pose` 的旋转表共用约定（弧度 XYZ）。每条预设的「帧时长」由 `BLENDER_ANIM_PRESET_FRAMES`
// 控制；起始帧默认 1。
//
// 关键帧的相位 + 帧号构成循环（首尾相同），跑出来就是无缝 loop。

function makeKeyframe(rotations: AnimEulerRad[]): AnimBoneKeyframes {
  const out: AnimBoneKeyframes = {}
  rotations.forEach((r, i) => {
    out[i + 1] = r
  })
  return out
}

const PRESET_FRAMES: Record<BlenderAnimPresetId, number> = {
  idle: 30,
  walk: 24,
  run: 20,
  jumpAir: 18,
  jumpLand: 18,
  wave: 36,
  handsOnHips: 24,
  think: 36,
  crouch: 24,
  kneel: 24,
  bow: 30,
  fightGuard: 20,
  sit: 24
}

/**
 * 关键帧预设表：每个预设是「BlenderBoneRole → Euler 偏移序列」，与帧号对齐。
 * 长度 ≠ PRESET_FRAMES[id] 时以 `makeKeyframe` 内置的对齐（sequence 索引 + 1 = 帧号）。
 *
 * 与 `model.pose` 的旋转值同源（避免「预设派发和 LLM 派发对同一姿势产生不同动画」的诡异）。
 */
const PRESET_KEYFRAMES: Record<
  BlenderAnimPresetId,
  Partial<Record<keyof AnimKeyframes, AnimEulerRad[]>>
> = {
  idle: {
    Hips: [
      [0, 0, 0],
      [0.02, 0, 0],
      [0, 0, 0],
      [0.02, 0, 0]
    ],
    Spine: [
      [0, 0, 0],
      [0.04, 0, 0],
      [0, 0, 0],
      [0.04, 0, 0]
    ],
    LeftUpperArm: [
      [-0.1, 0, 0.05],
      [-0.05, 0, 0.05],
      [-0.1, 0, 0.05],
      [-0.05, 0, 0.05]
    ],
    RightUpperArm: [
      [-0.1, 0, -0.05],
      [-0.05, 0, -0.05],
      [-0.1, 0, -0.05],
      [-0.05, 0, -0.05]
    ]
  },
  walk: {
    Hips: [
      [-0.03, 0, -0.05],
      [-0.02, 0, 0.05],
      [-0.03, 0, -0.05],
      [-0.02, 0, 0.05]
    ],
    LeftUpperArm: [
      [-0.5, 0, 0],
      [0.4, 0, 0],
      [-0.5, 0, 0],
      [0.4, 0, 0]
    ],
    RightUpperArm: [
      [0.4, 0, 0],
      [-0.5, 0, 0],
      [0.4, 0, 0],
      [-0.5, 0, 0]
    ],
    LeftUpperLeg: [
      [-0.4, 0, 0],
      [0.4, 0, 0],
      [-0.4, 0, 0],
      [0.4, 0, 0]
    ],
    RightUpperLeg: [
      [0.4, 0, 0],
      [-0.4, 0, 0],
      [0.4, 0, 0],
      [-0.4, 0, 0]
    ],
    LeftLowerLeg: [
      [0.6, 0, 0],
      [0.15, 0, 0],
      [0.6, 0, 0],
      [0.15, 0, 0]
    ],
    RightLowerLeg: [
      [0.15, 0, 0],
      [0.6, 0, 0],
      [0.15, 0, 0],
      [0.6, 0, 0]
    ]
  },
  run: {
    Hips: [
      [-0.25, 0, -0.1],
      [-0.2, 0, 0.1],
      [-0.25, 0, -0.1],
      [-0.2, 0, 0.1]
    ],
    LeftUpperArm: [
      [-0.85, 0, 0],
      [0.7, 0, 0],
      [-0.85, 0, 0],
      [0.7, 0, 0]
    ],
    RightUpperArm: [
      [0.7, 0, 0],
      [-0.85, 0, 0],
      [0.7, 0, 0],
      [-0.85, 0, 0]
    ],
    LeftUpperLeg: [
      [-0.75, 0, 0],
      [0.85, 0, 0],
      [-0.75, 0, 0],
      [0.85, 0, 0]
    ],
    RightUpperLeg: [
      [0.85, 0, 0],
      [-0.75, 0, 0],
      [0.85, 0, 0],
      [-0.75, 0, 0]
    ],
    LeftLowerLeg: [
      [1.2, 0, 0],
      [0.15, 0, 0],
      [1.2, 0, 0],
      [0.15, 0, 0]
    ],
    RightLowerLeg: [
      [0.15, 0, 0],
      [1.2, 0, 0],
      [0.15, 0, 0],
      [1.2, 0, 0]
    ]
  },
  jumpAir: {
    Hips: [
      [0.08, 0, 0],
      [0.1, 0, 0],
      [0.08, 0, 0],
      [0.1, 0, 0]
    ],
    LeftUpperArm: [
      [-0.85, 0, -0.75],
      [-0.85, 0, -0.75],
      [-0.85, 0, -0.75],
      [-0.85, 0, -0.75]
    ],
    RightUpperArm: [
      [-0.85, 0, 0.75],
      [-0.85, 0, 0.75],
      [-0.85, 0, 0.75],
      [-0.85, 0, 0.75]
    ],
    LeftForearm: [
      [1.0, 0, 0],
      [1.0, 0, 0],
      [1.0, 0, 0],
      [1.0, 0, 0]
    ],
    RightForearm: [
      [1.0, 0, 0],
      [1.0, 0, 0],
      [1.0, 0, 0],
      [1.0, 0, 0]
    ],
    LeftUpperLeg: [
      [1.0, 0, 0],
      [1.0, 0, 0],
      [1.0, 0, 0],
      [1.0, 0, 0]
    ],
    RightUpperLeg: [
      [1.0, 0, 0],
      [1.0, 0, 0],
      [1.0, 0, 0],
      [1.0, 0, 0]
    ],
    LeftLowerLeg: [
      [0.85, 0, 0],
      [0.85, 0, 0],
      [0.85, 0, 0],
      [0.85, 0, 0]
    ],
    RightLowerLeg: [
      [0.85, 0, 0],
      [0.85, 0, 0],
      [0.85, 0, 0],
      [0.85, 0, 0]
    ]
  },
  jumpLand: {
    Hips: [
      [-0.1, 0, 0],
      [-0.05, 0, 0],
      [-0.05, 0, 0],
      [-0.05, 0, 0]
    ],
    Spine: [
      [0.25, 0, 0],
      [0.18, 0, 0],
      [0.15, 0, 0],
      [0.12, 0, 0]
    ],
    LeftUpperArm: [
      [1.2, 0, -0.15],
      [0.6, 0, -0.15],
      [0.3, 0, -0.15],
      [0, 0, 0]
    ],
    RightUpperArm: [
      [1.2, 0, 0.15],
      [0.6, 0, 0.15],
      [0.3, 0, 0.15],
      [0, 0, 0]
    ],
    LeftUpperLeg: [
      [-1.0, 0, 0],
      [-0.7, 0, 0],
      [-0.5, 0, 0],
      [-0.3, 0, 0]
    ],
    RightUpperLeg: [
      [-1.0, 0, 0],
      [-0.7, 0, 0],
      [-0.5, 0, 0],
      [-0.3, 0, 0]
    ],
    LeftLowerLeg: [
      [1.4, 0, 0],
      [1.2, 0, 0],
      [1.0, 0, 0],
      [0.8, 0, 0]
    ],
    RightLowerLeg: [
      [1.4, 0, 0],
      [1.2, 0, 0],
      [1.0, 0, 0],
      [0.8, 0, 0]
    ]
  },
  wave: {
    RightUpperArm: [
      [-1.7, 0, -0.3],
      [-1.5, 0, -0.3],
      [-1.7, 0, -0.3],
      [-1.5, 0, -0.3]
    ],
    RightForearm: [
      [-0.85, 0, 0],
      [-0.5, 0, 0],
      [-0.85, 0, 0],
      [-0.5, 0, 0]
    ],
    Head: [
      [0, 0, -0.1],
      [0, 0, 0],
      [0, 0, -0.1],
      [0, 0, 0]
    ]
  },
  handsOnHips: {
    Hips: [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ],
    LeftUpperArm: [
      [-0.25, 0, 0.6],
      [-0.25, 0, 0.6],
      [-0.25, 0, 0.6],
      [-0.25, 0, 0.6]
    ],
    RightUpperArm: [
      [-0.25, 0, -0.6],
      [-0.25, 0, -0.6],
      [-0.25, 0, -0.6],
      [-0.25, 0, -0.6]
    ],
    LeftForearm: [
      [-1.55, 0, 0],
      [-1.55, 0, 0],
      [-1.55, 0, 0],
      [-1.55, 0, 0]
    ],
    RightForearm: [
      [-1.55, 0, 0],
      [-1.55, 0, 0],
      [-1.55, 0, 0],
      [-1.55, 0, 0]
    ]
  },
  think: {
    Head: [
      [-0.17, 0, -0.25],
      [-0.17, 0, -0.25],
      [-0.17, 0, -0.25],
      [-0.17, 0, -0.25]
    ],
    RightUpperArm: [
      [-0.42, 0, -0.17],
      [-0.42, 0, -0.17],
      [-0.42, 0, -0.17],
      [-0.42, 0, -0.17]
    ],
    RightForearm: [
      [-1.92, 0, 0],
      [-1.92, 0, 0],
      [-1.92, 0, 0],
      [-1.92, 0, 0]
    ]
  },
  crouch: {
    Hips: [
      [-0.25, 0, 0],
      [-0.2, 0, 0],
      [-0.25, 0, 0],
      [-0.2, 0, 0]
    ],
    LeftUpperArm: [
      [-0.5, 0, -0.42],
      [-0.45, 0, -0.42],
      [-0.5, 0, -0.42],
      [-0.45, 0, -0.42]
    ],
    RightUpperArm: [
      [-0.5, 0, 0.42],
      [-0.45, 0, 0.42],
      [-0.5, 0, 0.42],
      [-0.45, 0, 0.42]
    ],
    LeftUpperLeg: [
      [-1.22, 0, 0],
      [-1.1, 0, 0],
      [-1.22, 0, 0],
      [-1.1, 0, 0]
    ],
    RightUpperLeg: [
      [-1.22, 0, 0],
      [-1.1, 0, 0],
      [-1.22, 0, 0],
      [-1.1, 0, 0]
    ],
    LeftLowerLeg: [
      [1.4, 0, 0],
      [1.3, 0, 0],
      [1.4, 0, 0],
      [1.3, 0, 0]
    ],
    RightLowerLeg: [
      [1.4, 0, 0],
      [1.3, 0, 0],
      [1.4, 0, 0],
      [1.3, 0, 0]
    ]
  },
  kneel: {
    LeftUpperArm: [
      [-0.08, 0, 0],
      [-0.08, 0, 0],
      [-0.08, 0, 0],
      [-0.08, 0, 0]
    ],
    RightUpperArm: [
      [-0.08, 0, 0],
      [-0.08, 0, 0],
      [-0.08, 0, 0],
      [-0.08, 0, 0]
    ],
    RightUpperLeg: [
      [1.05, 0, -0.08],
      [1.0, 0, -0.08],
      [1.05, 0, -0.08],
      [1.0, 0, -0.08]
    ],
    RightLowerLeg: [
      [-1.57, 0, 0],
      [-1.57, 0, 0],
      [-1.57, 0, 0],
      [-1.57, 0, 0]
    ],
    LeftUpperLeg: [
      [-1.57, 0, 0.08],
      [-1.5, 0, 0.08],
      [-1.57, 0, 0.08],
      [-1.5, 0, 0.08]
    ]
  },
  bow: {
    Hips: [
      [0.7, 0, 0],
      [0.65, 0, 0],
      [0.7, 0, 0],
      [0.65, 0, 0]
    ],
    Spine: [
      [0.45, 0, 0],
      [0.4, 0, 0],
      [0.45, 0, 0],
      [0.4, 0, 0]
    ],
    Head: [
      [0.17, 0, 0],
      [0.15, 0, 0],
      [0.17, 0, 0],
      [0.15, 0, 0]
    ]
  },
  fightGuard: {
    Hips: [
      [0, 0, -0.17],
      [0, 0, -0.17],
      [0, 0, -0.17],
      [0, 0, -0.17]
    ],
    LeftUpperArm: [
      [-0.5, 0, 0.25],
      [-0.45, 0, 0.25],
      [-0.5, 0, 0.25],
      [-0.45, 0, 0.25]
    ],
    RightUpperArm: [
      [-0.5, 0, -0.25],
      [-0.45, 0, -0.25],
      [-0.5, 0, -0.25],
      [-0.45, 0, -0.25]
    ],
    LeftForearm: [
      [-1.75, 0, 0],
      [-1.75, 0, 0],
      [-1.75, 0, 0],
      [-1.75, 0, 0]
    ],
    RightForearm: [
      [-1.75, 0, 0],
      [-1.75, 0, 0],
      [-1.75, 0, 0],
      [-1.75, 0, 0]
    ],
    LeftUpperLeg: [
      [-0.42, 0, 0],
      [-0.4, 0, 0],
      [-0.42, 0, 0],
      [-0.4, 0, 0]
    ],
    RightUpperLeg: [
      [-0.25, 0, 0],
      [-0.25, 0, 0],
      [-0.25, 0, 0],
      [-0.25, 0, 0]
    ]
  },
  sit: {
    Hips: [
      [1.4, 0, 0],
      [1.4, 0, 0],
      [1.4, 0, 0],
      [1.4, 0, 0]
    ],
    Spine: [
      [-0.17, 0, 0],
      [-0.17, 0, 0],
      [-0.17, 0, 0],
      [-0.17, 0, 0]
    ],
    LeftUpperArm: [
      [-0.17, 0, 0.08],
      [-0.17, 0, 0.08],
      [-0.17, 0, 0.08],
      [-0.17, 0, 0.08]
    ],
    RightUpperArm: [
      [-0.17, 0, -0.08],
      [-0.17, 0, -0.08],
      [-0.17, 0, -0.08],
      [-0.17, 0, -0.08]
    ],
    LeftUpperLeg: [
      [1.4, 0, 0],
      [1.4, 0, 0],
      [1.4, 0, 0],
      [1.4, 0, 0]
    ],
    RightUpperLeg: [
      [1.4, 0, 0],
      [1.4, 0, 0],
      [1.4, 0, 0],
      [1.4, 0, 0]
    ],
    LeftLowerLeg: [
      [-1.57, 0, 0],
      [-1.57, 0, 0],
      [-1.57, 0, 0],
      [-1.57, 0, 0]
    ],
    RightLowerLeg: [
      [-1.57, 0, 0],
      [-1.57, 0, 0],
      [-1.57, 0, 0],
      [-1.57, 0, 0]
    ]
  }
}

export const BLENDER_ANIM_PRESET_FRAMES: Readonly<Record<BlenderAnimPresetId, number>> =
  Object.freeze(PRESET_FRAMES)

export const BLENDER_ANIM_PRESET_TABLE: Readonly<
  Record<
    BlenderAnimPresetId,
    Readonly<Partial<Record<keyof AnimKeyframes, readonly AnimEulerRad[]>>>
  >
> = Object.freeze(
  Object.fromEntries(
    (Object.keys(PRESET_KEYFRAMES) as BlenderAnimPresetId[]).map((id) => [
      id,
      Object.freeze(
        Object.fromEntries(
          Object.entries(PRESET_KEYFRAMES[id])
            .filter((entry): entry is [string, AnimEulerRad[]] => Array.isArray(entry[1]))
            .map(([k, v]) => [k, Object.freeze(v.slice())])
        )
      ) as Readonly<Partial<Record<keyof AnimKeyframes, readonly AnimEulerRad[]>>>
    ])
  ) as Record<
    BlenderAnimPresetId,
    Readonly<Partial<Record<keyof AnimKeyframes, readonly AnimEulerRad[]>>>
  >
)

// --- Python 构造 helpers ---------------------------------------------------

function pyKeyframesLiteral(kfs: AnimKeyframes): string {
  // 按 {bone: {frame: [x,y,z]}} 嵌套；外层 dict 用 JSON 序列化 + 引号转义即可。
  // Blender 端用 ast.literal_eval 反序列化（避开 json.loads 限制：tuple 写法）。
  const lines: string[] = []
  for (const [bone, frames] of Object.entries(kfs)) {
    if (!bone || !frames) continue
    const frameEntries: string[] = []
    const sortedFrames = Object.keys(frames)
      .map((k) => Number(k))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b)
    for (const f of sortedFrames) {
      const v = frames[f]
      if (!v || !Array.isArray(v) || v.length !== 3) continue
      frameEntries.push(`    ${f}: (${v[0]}, ${v[1]}, ${v[2]}),`)
    }
    if (!frameEntries.length) continue
    lines.push(`    ${JSON.stringify(bone)}: {\n${frameEntries.join('\n')}\n  },`)
  }
  return `{\n${lines.join('\n')}\n}`
}

/**
 * 为「预设派发」路径构造 Blender Python 脚本。
 *
 * 脚本行为：
 * 1. 找到当前 view_layer 里第一个 ARMATURE（用 armatureName 兜底匹配）。
 * 2. 创建 / 重命名 action；清空已有 fcurve。
 * 3. 遍历 KEYFRAMES dict，逐根骨逐帧 `pose.bones[name].keyframe_insert(...)`。
 * 4. print ANIM_RESULT + ANIM_DRIVE_META。
 */
export function buildBlenderPresetAnimScript(input: {
  presetId: BlenderAnimPresetId
  armatureName: string
  fps?: number
}): string {
  const fps = input.fps ?? 24
  const frames = PRESET_FRAMES[input.presetId]
  const presetData = PRESET_KEYFRAMES[input.presetId]
  const keyframes: AnimKeyframes = {}
  for (const [bone, seq] of Object.entries(presetData)) {
    keyframes[bone] = makeKeyframe(seq as AnimEulerRad[])
  }
  const kfsLiteral = pyKeyframesLiteral(keyframes)
  const actionName = `${input.presetId}_cycle`
  return [
    `# AIAE 3D 动画：预设派发（preset_id = ${JSON.stringify(input.presetId)}）`,
    'import json',
    'import bpy',
    '',
    `ARMATURE_NAME = ${JSON.stringify(input.armatureName)}`,
    `ACTION_NAME = ${JSON.stringify(actionName)}`,
    `FPS = ${fps}`,
    `FRAMES = ${frames}`,
    `KEYFRAMES = ${kfsLiteral}`,
    '',
    '# 1. 选 armature',
    'arm = None',
    'if ARMATURE_NAME:',
    '    arm = bpy.data.objects.get(ARMATURE_NAME)',
    'if arm is None or arm.type != "ARMATURE":',
    '    for _o in bpy.context.view_layer.objects:',
    '        if _o.type == "ARMATURE":',
    '            arm = _o',
    '            break',
    'if arm is None:',
    '    print("ERROR: no armature found")',
    '    raise SystemExit(0)',
    '',
    '# 2. 创建 / 重绑 action',
    'if ACTION_NAME in bpy.data.actions:',
    '    bpy.data.actions.remove(bpy.data.actions[ACTION_NAME], do_unlink=True)',
    'action = bpy.data.actions.new(name=ACTION_NAME)',
    'if arm.animation_data is None:',
    '    arm.animation_data_create()',
    'arm.animation_data.action = action',
    '',
    '# 3. 设置帧率 + 帧范围',
    'bpy.context.scene.render.fps = FPS',
    'bpy.context.scene.frame_start = 1',
    'bpy.context.scene.frame_end = FRAMES',
    '',
    '# 4. 写关键帧：每根骨 pose 切到对应帧，keyframe_insert rotation_euler',
    'matched = []',
    'missing = []',
    'pose = arm.pose.bones',
    'for bone_name, frame_dict in KEYFRAMES.items():',
    '    if bone_name not in pose:',
    '        missing.append(bone_name)',
    '        continue',
    '    matched.append(bone_name)',
    '    pb = pose[bone_name]',
    '    pb.rotation_mode = "XYZ"',
    '    for frame_num, euler in frame_dict.items():',
    '        pb.rotation_euler = (euler[0], euler[1], euler[2])',
    '        pb.keyframe_insert(data_path="rotation_euler", frame=frame_num)',
    'bpy.context.view_layer.update()',
    '',
    '# 5. 读回 + print',
    'result = {',
    '    "action": action.name,',
    '    "fps": bpy.context.scene.render.fps,',
    '    "frame_range": [bpy.context.scene.frame_start, bpy.context.scene.frame_end],',
    '    "keyframes": {bn: {int(k): list(v) for k, v in pose[bn].rotation_euler.items()} for bn in matched if bn in pose}',
    '}',
    'print(' +
      JSON.stringify(BLENDER_ANIM_RESULT_MARKER) +
      ' + json.dumps(result, ensure_ascii=False))',
    'meta = {',
    '    "bones_matched": len(matched),',
    '    "bones_missing": missing,',
    '    "armature": arm.name,',
    '    "keyframe_count": sum(len(v) for v in KEYFRAMES.values()),',
    '}',
    'print(' +
      JSON.stringify(BLENDER_ANIM_DRIVE_META_MARKER) +
      ' + json.dumps(meta, ensure_ascii=False))'
  ].join('\n')
}

/**
 * 预设派发的本地计算：返回期望的 clip（不经过 Blender）。
 * 节点图 Cook / 单测可用，不必先开 Blender。
 */
export function computePresetAnimReadback(input: {
  presetId: BlenderAnimPresetId
  fps?: number
}): BlenderAnimClip {
  const fps = input.fps ?? 24
  const frames = PRESET_FRAMES[input.presetId]
  const presetData = PRESET_KEYFRAMES[input.presetId]
  const keyframes: AnimKeyframes = {}
  for (const [bone, seq] of Object.entries(presetData)) {
    keyframes[bone] = makeKeyframe(seq as AnimEulerRad[])
  }
  return {
    action: `${input.presetId}_cycle`,
    fps,
    frameRange: [1, frames],
    keyframes,
    presetId: input.presetId
  }
}

// --- 策略派发 / 提示词 -----------------------------------------------------

const PRESET_INSTRUCTIONS: Record<BlenderAnimPresetId, { zh: string; en: string }> = {
  idle: {
    zh: '循环待机动画：身体轻微起伏、双手小摆、头微动，整体放松，24 fps，约 30 帧无缝循环。',
    en: 'Idle loop: subtle body rise/fall + small arm sway + slight head bob, relaxed; 24 fps, ~30 frames seamless loop.'
  },
  walk: {
    zh: '走路循环：四肢对侧摆、髋部上下/侧倾，24 fps，24 帧（一步半）无缝循环。',
    en: 'Walk cycle: cross-extremity swing + pelvis rise/side tilt, 24 fps, 24 frames (1.5 steps) seamless loop.'
  },
  run: {
    zh: '跑步循环：明显前倾、双臂高摆、双腿大幅摆动，24 fps，20 帧无缝循环。',
    en: 'Run cycle: forward lean, high arm swing, large leg stride; 24 fps, 20 frames seamless loop.'
  },
  jumpAir: {
    zh: '跳跃腾空帧：双臂上扬平衡、髋膝收腿，18 帧静帧姿态（适合补到 jumpLand 之前）。',
    en: 'Jump airborne pose: arms raised for balance, hips+knees tucked; 18-frame still (insert before jumpLand).'
  },
  jumpLand: {
    zh: '跳跃落地缓冲：双膝深屈、髋后坐、双臂前伸，18 帧静帧姿态。',
    en: 'Jump landing absorb: deep knee+hip flex, sit-back, arms forward; 18-frame still.'
  },
  wave: {
    zh: '右手挥手循环：右上臂高摆+右腕来回摆，36 帧无缝循环。',
    en: 'Right-hand wave loop: high right upper-arm swing + wrist oscillate; 36 frames seamless loop.'
  },
  handsOnHips: {
    zh: '双手叉腰站立循环：双手叉腰、肘外摆、胸微挺，24 帧轻微摆动。',
    en: 'Hands-on-hips loop: hands on waist, elbows out, chest slightly up; 24 frames subtle sway.'
  },
  think: {
    zh: '思考托腮循环：右手托下颌、头略低垂、轻微左右偏头，36 帧。',
    en: 'Thinking chin-rest loop: right hand on chin, head down-tilt + slight side tilt; 36 frames.'
  },
  crouch: {
    zh: '深蹲戒备循环：双膝深屈、重心低、双臂抬前护面，24 帧轻微起伏。',
    en: 'Crouch ready loop: deep knee+hip flex, low COM, hands forward guarding; 24 frames subtle bounce.'
  },
  kneel: {
    zh: '单膝跪姿静帧：右膝着地、左脚前撑，24 帧轻微呼吸起伏。',
    en: 'Right-knee kneel still: right knee down, left foot planted forward; 24 frames subtle breathing.'
  },
  bow: {
    zh: '鞠躬致意静帧：髋为轴上身前倾、脊柱连贯弯曲，30 帧（弯腰 + 短暂停顿）。',
    en: 'Formal bow still: hinge at hips with continuous spine curve; 30 frames (bend + short hold).'
  },
  fightGuard: {
    zh: '运动训练戒备站姿循环：双肘抬起护面、膝微屈，20 帧轻微摆动。',
    en: 'Athletic ready stance loop: elbows raised guarding face, soft knees; 20 frames subtle sway.'
  },
  sit: {
    zh: '端坐静帧：髋膝约 90° 屈曲、躯干直立，24 帧呼吸起伏。',
    en: 'Seated still: hips+knees ~90° flex, upright torso; 24 frames breathing.'
  }
}

export function matchBlenderAnimPresetId(
  instruction: string,
  locale: string
): BlenderAnimPresetId | null {
  const text = instruction.trim()
  if (!text) return null
  const enMode = locale.toLowerCase().startsWith('en')
  for (const [id, body] of Object.entries(PRESET_INSTRUCTIONS) as Array<
    [BlenderAnimPresetId, { zh: string; en: string }]
  >) {
    if (enMode ? body.en === text : body.zh === text) return id
    if (body.zh === text || body.en === text) return id
  }
  return null
}

export function listBlenderAnimPresetInstructions(locale: string): Array<{
  id: BlenderAnimPresetId
  text: string
}> {
  const enMode = locale.toLowerCase().startsWith('en')
  return (Object.keys(PRESET_INSTRUCTIONS) as BlenderAnimPresetId[]).map((id) => ({
    id,
    text: enMode ? PRESET_INSTRUCTIONS[id].en : PRESET_INSTRUCTIONS[id].zh
  }))
}

export interface DecideBlenderAnimStrategyInput {
  instruction: string
  locale: string
  armatureName: string
  fps?: number
  frames?: number
}

export function decideBlenderAnimStrategy(
  input: DecideBlenderAnimStrategyInput
): BlenderAnimDispatch {
  if (!input.instruction.trim()) {
    throw new Error('3D 动画指令不能为空')
  }
  const presetId = matchBlenderAnimPresetId(input.instruction, input.locale)
  if (presetId) {
    return {
      strategy: 'preset',
      presetId,
      code: buildBlenderPresetAnimScript({
        presetId,
        armatureName: input.armatureName,
        fps: input.fps
      }),
      description: `预设派发：${presetId}`
    }
  }
  return {
    strategy: 'ai',
    presetId: null,
    code: '',
    description: 'LLM 生成 Blender Python'
  }
}

// --- LLM 提示词 ----------------------------------------------------------

export function buildBlenderAnimPrompts(input: {
  instruction: string
  locale: string
  armatureName: string
  fps?: number
  frames?: number
}): { system: string; user: string } {
  const zh = !input.locale.toLowerCase().startsWith('en')
  const fps = input.fps ?? 24
  const frames = input.frames ?? 24
  const system = zh
    ? `你是 3D 动画关键帧助手。根据用户对动画的描述，输出一段 Blender Python 脚本，在 Blender 进程里跑完后把结果通过 print 回给应用。

规则：
1. 输出一段**纯 Python 代码**（不要 markdown 代码栅栏、不要任何解释）。
2. 第一行必须是 \`import json\`；可以 \`import bpy\` / \`import math\`。**禁止** import bpy / bmesh / mathutils / json / math 之外的任何模块，禁止 import 别名、禁止 from-import 与通配 import。
3. 找到 view_layer 里第一个 ARMATURE（按 ARMATURE_NAME 兜底匹配），创建 / 重绑 action；遍历 KEYFRAMES dict，每根骨每帧 \`pose.bones[name].keyframe_insert(data_path="rotation_euler", frame=...)\`。
4. 单位约定：欧拉偏移 = **弧度 XYZ**（不是度数！），相对绑定姿势，旋转顺序 XYZ。
5. 设置帧率=${fps}、帧范围=[1, ${frames}]。
6. 末段必须写两行 print：
   - \`print("` +
      BLENDER_ANIM_RESULT_MARKER +
      `" + json.dumps({"action": action.name, "fps": FPS, "frame_range": [start, end], "keyframes": {骨名: {帧号: [rx,ry,rz]}}}, ensure_ascii=False))\`
   - \`print("` +
      BLENDER_ANIM_DRIVE_META_MARKER +
      `" + json.dumps({"bones_matched": N, "bones_missing": [...], "armature": "...", "keyframe_count": M}, ensure_ascii=False))\``
    : `You are a 3D keyframe animation assistant. Output a Blender Python script that prints the animation back as JSON.

Rules:
1. Output ONLY pure Python code (no markdown fences, no explanation).
2. First line must be \`import json\`; you may \`import bpy\` / \`import math\`. Do NOT import anything other than bpy / bmesh / mathutils / json / math.
3. Find first ARMATURE in view_layer (fallback to ARMATURE_NAME), create/rebind action, iterate KEYFRAMES dict, \`pose.bones[name].keyframe_insert(data_path="rotation_euler", frame=...)\` per bone per frame.
4. Euler offsets are **RADIANS XYZ**, relative to bind pose, XYZ rotation order.
5. Set fps=${fps}, frame range=[1, ${frames}].
6. Last two lines MUST be:
   - \`print("` +
      BLENDER_ANIM_RESULT_MARKER +
      `" + json.dumps({action, fps, frame_range, keyframes}, ensure_ascii=False))\`
   - \`print("` +
      BLENDER_ANIM_DRIVE_META_MARKER +
      `" + json.dumps({bones_matched, bones_missing, armature, keyframe_count}, ensure_ascii=False))\``

  const user = [
    zh ? '用户动画要求：' : 'User animation request:',
    input.instruction.trim(),
    '',
    zh ? `当前 armature 名：${input.armatureName}` : `Current armature name: ${input.armatureName}`,
    '',
    zh ? '现在按规则输出 Python 脚本。' : 'Output the Python script now following the rules above.'
  ].join('\n')

  return { system, user }
}

// --- stdout 解析 -----------------------------------------------------------

function extractExecuteStdout(outcome: McpToolCallOutcome): string {
  if (outcome.error) return ''
  const r = outcome.result
  if (typeof r === 'string') return r
  if (r && typeof r === 'object') {
    const obj = r as Record<string, unknown>
    if (typeof obj.result === 'string') return obj.result
    if (typeof obj.output === 'string') return obj.output
    if (typeof obj.stdout === 'string') return obj.stdout
  }
  return ''
}

function findFirstBalancedJsonObject(text: string): { start: number; end: number } | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return { start, end: i }
    }
  }
  return null
}

/**
 * 解析 Blender Python 脚本里 `print("ANIM_RESULT:" + json.dumps(...))` 的输出。
 */
export function parseBlenderAnimReadback(
  outcome: McpToolCallOutcome,
  presetId: BlenderAnimPresetId | null
): BlenderAnimClip {
  if (outcome.error) throw new Error(outcome.error)
  const stdout = extractExecuteStdout(outcome)
  if (!stdout) throw new Error('Blender 没有返回 stdout；脚本是否跑了 print？')
  const idx = stdout.indexOf(BLENDER_ANIM_RESULT_MARKER)
  if (idx < 0) {
    throw new Error(
      `Blender stdout 缺少 ${BLENDER_ANIM_RESULT_MARKER} 标记（前 200 字符）：${stdout.slice(0, 200)}`
    )
  }
  const tail = stdout.slice(idx + BLENDER_ANIM_RESULT_MARKER.length)
  const balanced = findFirstBalancedJsonObject(tail)
  if (!balanced) {
    throw new Error(
      `${BLENDER_ANIM_RESULT_MARKER} 后找不到 JSON 对象（前 200 字符）：${tail.slice(0, 200)}`
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(tail.slice(balanced.start, balanced.end + 1))
  } catch (err) {
    throw new Error(
      `${BLENDER_ANIM_RESULT_MARKER} JSON 解析失败：${err instanceof Error ? err.message : String(err)}`
    )
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${BLENDER_ANIM_RESULT_MARKER} 必须是 JSON 对象`)
  }
  const obj = parsed as Record<string, unknown>
  const action = typeof obj.action === 'string' ? obj.action : ''
  const fps = Number.isFinite(obj.fps) ? Number(obj.fps) : 24
  const fr = Array.isArray(obj.frame_range) ? obj.frame_range : [1, 24]
  const frameRange: [number, number] = [
    Number.isFinite(fr[0]) ? Number(fr[0]) : 1,
    Number.isFinite(fr[1]) ? Number(fr[1]) : 24
  ]
  const keyframes: AnimKeyframes = {}
  const rawKfs = obj.keyframes
  if (rawKfs && typeof rawKfs === 'object' && !Array.isArray(rawKfs)) {
    for (const [bone, frames] of Object.entries(rawKfs as Record<string, unknown>)) {
      if (!bone || !frames || typeof frames !== 'object' || Array.isArray(frames)) continue
      const boneKfs: AnimBoneKeyframes = {}
      for (const [f, v] of Object.entries(frames as Record<string, unknown>)) {
        const fn = Number(f)
        if (!Number.isFinite(fn)) continue
        if (!Array.isArray(v) || v.length !== 3) continue
        const nums: number[] = []
        let invalid = false
        for (const x of v) {
          if (typeof x !== 'number' || !Number.isFinite(x)) {
            invalid = true
            break
          }
          nums.push(x)
        }
        if (invalid) continue
        boneKfs[fn] = [nums[0], nums[1], nums[2]]
      }
      if (Object.keys(boneKfs).length) keyframes[bone] = boneKfs
    }
  }
  if (!action || !Object.keys(keyframes).length) {
    throw new Error(`${BLENDER_ANIM_RESULT_MARKER} 里没有 action / keyframes`)
  }
  return { action, fps, frameRange, keyframes, presetId }
}

export interface BlenderDriveAnimMeta {
  bonesMatched: number
  bonesMissing: string[]
  armature: string | null
  keyframeCount: number
}

export function parseBlenderDriveAnimMeta(
  outcome: McpToolCallOutcome
): BlenderDriveAnimMeta | null {
  if (outcome.error) return null
  const stdout = extractExecuteStdout(outcome)
  if (!stdout) return null
  const idx = stdout.indexOf(BLENDER_ANIM_DRIVE_META_MARKER)
  if (idx < 0) return null
  const tail = stdout.slice(idx + BLENDER_ANIM_DRIVE_META_MARKER.length)
  const balanced = findFirstBalancedJsonObject(tail)
  if (!balanced) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(tail.slice(balanced.start, balanced.end + 1))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const obj = parsed as Record<string, unknown>
  const missingRaw = Array.isArray(obj.bones_missing) ? obj.bones_missing : []
  const missing = missingRaw.filter((m): m is string => typeof m === 'string')
  return {
    bonesMatched: Number.isFinite(obj.bones_matched) ? Number(obj.bones_matched) : 0,
    bonesMissing: missing,
    armature: typeof obj.armature === 'string' ? obj.armature : null,
    keyframeCount: Number.isFinite(obj.keyframe_count) ? Number(obj.keyframe_count) : 0
  }
}

// --- Node 端等价执行（单测 / 离线回放）-------------------------------------

export function executeBlenderPresetAnimPure(input: {
  presetId: BlenderAnimPresetId
  fps?: number
}): BlenderAnimClip {
  return computePresetAnimReadback(input)
}

// --- Agent loop（LLM 多轮 chat + Blender MCP 当 tool）---------------------

export const BLENDER_ANIM_AGENT_DEFAULT_MAX_TURNS = 5

export const BLENDER_ANIM_AGENT_TOOLS: ReadonlyArray<{
  type: 'function'
  function: {
    name: string
    description?: string
    parameters?: Record<string, unknown>
  }
}> = [
  {
    type: 'function',
    function: {
      name: 'try_blender_anim',
      description:
        '在 Blender 里执行一段 Python 脚本，**真正写入**关键帧并绑定 action。\n' +
        '参数 python_code 必须是完整脚本，**严格按下面模板**只填 ARMATURE_NAME / ACTION_NAME / FPS / FRAMES / KEYFRAMES 五个变量（其余驱动代码不要改）：\n\n' +
        '```python\n' +
        'import json\n' +
        'import bpy\n' +
        '\n' +
        'ARMATURE_NAME = "..."\n' +
        'ACTION_NAME = "..."\n' +
        'FPS = 24\n' +
        'FRAMES = 24\n' +
        'KEYFRAMES = {\n' +
        '    "Hips": {1: (0, 0, 0), 12: (0.1, 0, 0)},\n' +
        '    "Spine": {1: (0, 0, 0), 12: (0.05, 0, 0)},\n' +
        '    # ...更多骨\n' +
        '}\n' +
        '\n' +
        'arm = bpy.data.objects.get(ARMATURE_NAME) if ARMATURE_NAME else None\n' +
        'if arm is None or arm.type != "ARMATURE":\n' +
        '    for o in bpy.context.view_layer.objects:\n' +
        '        if o.type == "ARMATURE": arm = o; break\n' +
        'if arm is None: raise SystemExit(0)\n' +
        'if ACTION_NAME in bpy.data.actions:\n' +
        '    bpy.data.actions.remove(bpy.data.actions[ACTION_NAME], do_unlink=True)\n' +
        'action = bpy.data.actions.new(name=ACTION_NAME)\n' +
        'if arm.animation_data is None: arm.animation_data_create()\n' +
        'arm.animation_data.action = action\n' +
        'bpy.context.scene.render.fps = FPS\n' +
        'bpy.context.scene.frame_start = 1; bpy.context.scene.frame_end = FRAMES\n' +
        'pose = arm.pose.bones\n' +
        'matched = []; missing = []\n' +
        'for bn, frames in KEYFRAMES.items():\n' +
        '    if bn not in pose: missing.append(bn); continue\n' +
        '    matched.append(bn)\n' +
        '    pb = pose[bn]; pb.rotation_mode = "XYZ"\n' +
        '    for fn, e in frames.items():\n' +
        '        pb.rotation_euler = (e[0], e[1], e[2])\n' +
        '        pb.keyframe_insert(data_path="rotation_euler", frame=fn)\n' +
        'bpy.context.view_layer.update()\n' +
        'print("' +
        BLENDER_ANIM_RESULT_MARKER +
        '" + json.dumps({"action": action.name, "fps": FPS, "frame_range": [1, FRAMES], "keyframes": {bn: {int(k): list(v) for k, v in pose[bn].rotation_euler.items()} for bn in matched if bn in pose}}, ensure_ascii=False))\n' +
        'print("' +
        BLENDER_ANIM_DRIVE_META_MARKER +
        '" + json.dumps({"bones_matched": len(matched), "bones_missing": missing, "armature": arm.name, "keyframe_count": sum(len(v) for v in KEYFRAMES.values())}, ensure_ascii=False))\n' +
        '```\n\n' +
        '返回值是 JSON：成功时 {ok:true, readback:{action, fps, frame_range, keyframes}, meta:{bones_matched, bones_missing, armature, keyframe_count}}；' +
        '失败时 {ok:false, error}（marker 缺失 / JSON 畸形 / armature 找不到 / 空 keyframes 等）。',
      parameters: {
        type: 'object',
        properties: {
          python_code: {
            type: 'string',
            description: '完整可执行 Python 源码（按上述模板）'
          }
        },
        required: ['python_code']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'finalize_anim',
      description:
        '确认采用本轮 ANIM_RESULT：把上一轮 try_blender_anim 返回的 readback 应用到节点图（作为模型资产附带的 clip）。' +
        '只能在拿到的 readback 看起来合理时调用；不再调整就调一次并结束。',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['replace', 'merge'],
            description: 'replace=整图替换，merge=与现有 clip 合并（默认 replace）'
          }
        }
      }
    }
  }
]

export type BlenderAnimAgentEvent =
  | { kind: 'turn'; turn: number; text?: string; toolNames: string[] }
  | {
      kind: 'tool'
      name: 'try_blender_anim'
      bonesMatched: number
      keyframeCount: number
      armature?: string | null
      error?: string
    }
  | { kind: 'finalize'; bonesMatched: number; keyframeCount: number }
  | { kind: 'done'; reason: 'finalized' | 'no_finalize' | 'max_turns' }
  | { kind: 'error'; message: string }

export interface RunBlenderAnimAgentDeps {
  modelClient: (input: {
    system: string
    messages: ReadonlyArray<BlenderAnimAgentMessage>
    tools: typeof BLENDER_ANIM_AGENT_TOOLS
  }) => Promise<{
    text: string
    toolCalls: ReadonlyArray<{
      id: string
      type: 'function'
      function: { name: string; arguments: string }
    }>
    finishReason?: string
  }>
  blenderRun: (code: string) => Promise<{
    readback: BlenderAnimClip
    meta?: BlenderDriveAnimMeta | null
  }>
  applyToRenderer: (clip: BlenderAnimClip) => {
    bonesMatched: number
    keyframeCount: number
  }
  onEvent?: (event: BlenderAnimAgentEvent) => void
}

export type BlenderAnimAgentMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | {
      role: 'assistant'
      content: string
      tool_calls: ReadonlyArray<{
        id: string
        type: 'function'
        function: { name: string; arguments: string }
      }>
    }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface RunBlenderAnimAgentInput {
  instruction: string
  locale: string
  armatureName: string
  fps?: number
  frames?: number
  maxTurns?: number
}

export interface RunBlenderAnimAgentResult {
  ok: boolean
  reason: 'finalized' | 'no_finalize' | 'max_turns' | 'error'
  readback: BlenderAnimClip
  turns: number
}

function buildBlenderAnimAgentSystem(input: RunBlenderAnimAgentInput): string {
  const base = buildBlenderAnimPrompts(input)
  const zh = !input.locale.toLowerCase().startsWith('en')
  const tail = zh
    ? `
多轮工作流（必须遵守）：
1. 先调 \`try_blender_anim\` 工具，把你写的 Python 代码送进 Blender 跑。**Python 必须按工具描述里的模板**——只填 ARMATURE_NAME / ACTION_NAME / FPS / FRAMES / KEYFRAMES 五个变量，其余驱动代码按原样，最后分别 print \`${BLENDER_ANIM_RESULT_MARKER}\` 与 \`${BLENDER_ANIM_DRIVE_META_MARKER}\` 两行。
2. 工具会回 JSON：
   - \`{ok:true, readback:{action, fps, frame_range, keyframes}, meta:{bones_matched, bones_missing, armature, keyframe_count}}\`：Blender 端真驱动后的命中/缺失明细；
   - \`{ok:false, error}\`：错误信息（marker 缺失 / JSON 畸形 / armature 找不到 / 空 keyframes 等）。
3. 如果 \`bones_matched\` 比你的 KEYFRAMES 字典少、或 keyframe_count 为 0——**改 Python 再调一次** \`try_blender_anim\`，最多 ${BLENDER_ANIM_AGENT_DEFAULT_MAX_TURNS} 轮。
4. 拿到满意的 readback 后，调 \`finalize_anim\` 一次把它落到节点图（这会结束循环）。
5. 不要再返回纯文本以外的解释——所有决策都通过 tool。`
    : `
Multi-turn workflow (mandatory):
1. Call \`try_blender_anim\` with your Python script. **The script MUST follow the template** — only fill ARMATURE_NAME / ACTION_NAME / FPS / FRAMES / KEYFRAMES, then print both \`${BLENDER_ANIM_RESULT_MARKER}\` and \`${BLENDER_ANIM_DRIVE_META_MARKER}\`.
2. The tool returns JSON:
   - \`{ok:true, readback, meta}\`: what Blender actually wrote
   - \`{ok:false, error}\`: missing marker / malformed JSON / no armature / empty keyframes
3. If bones_matched is low or keyframe_count is 0, **revise the Python and call \`try_blender_anim\` again**. Maximum ${BLENDER_ANIM_AGENT_DEFAULT_MAX_TURNS} turns.
4. When readback looks good, call \`finalize_anim\` once (this ends the loop).
5. Do not output anything other than tool calls.`
  return base.system + tail
}

function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      return parsed as Record<string, unknown>
  } catch {
    /* fall through */
  }
  return {}
}

export async function runBlenderAnimAgent(
  input: RunBlenderAnimAgentInput,
  deps: RunBlenderAnimAgentDeps
): Promise<RunBlenderAnimAgentResult> {
  const maxTurns = Math.max(1, input.maxTurns ?? BLENDER_ANIM_AGENT_DEFAULT_MAX_TURNS)
  const system = buildBlenderAnimAgentSystem(input)
  const prompts = buildBlenderAnimPrompts(input)
  const messages: BlenderAnimAgentMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: prompts.user }
  ]

  let lastReadback: BlenderAnimClip = {
    action: '',
    fps: 24,
    frameRange: [1, 24],
    keyframes: {},
    presetId: null
  }
  let finalized = false

  function buildResult(
    ok: boolean,
    reason: RunBlenderAnimAgentResult['reason'],
    turns: number
  ): RunBlenderAnimAgentResult {
    return { ok, reason, readback: lastReadback, turns }
  }

  for (let turn = 0; turn < maxTurns; turn++) {
    let result: Awaited<ReturnType<RunBlenderAnimAgentDeps['modelClient']>>
    try {
      result = await deps.modelClient({ system, messages, tools: BLENDER_ANIM_AGENT_TOOLS })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      deps.onEvent?.({ kind: 'error', message })
      return buildResult(false, 'error', turn)
    }
    messages.push({
      role: 'assistant',
      content: result.text ?? '',
      tool_calls: result.toolCalls ?? []
    })
    deps.onEvent?.({
      kind: 'turn',
      turn,
      text: result.text,
      toolNames: (result.toolCalls ?? []).map((c) => c.function.name)
    })

    const calls = result.toolCalls ?? []
    if (!calls.length) {
      deps.onEvent?.({ kind: 'done', reason: 'no_finalize' })
      return buildResult(false, 'no_finalize', turn + 1)
    }

    for (const call of calls) {
      const args = parseToolArgs(call.function.arguments)
      if (call.function.name === 'try_blender_anim') {
        const code = typeof args.python_code === 'string' ? args.python_code : ''
        if (!code.trim()) {
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ ok: false, error: 'python_code 不能为空' })
          })
          deps.onEvent?.({
            kind: 'tool',
            name: 'try_blender_anim',
            bonesMatched: 0,
            keyframeCount: 0,
            error: 'empty python_code'
          })
          continue
        }
        try {
          const outcome = await deps.blenderRun(code)
          lastReadback = outcome.readback
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({
              ok: true,
              readback: outcome.readback,
              meta: outcome.meta ?? null
            })
          })
          deps.onEvent?.({
            kind: 'tool',
            name: 'try_blender_anim',
            bonesMatched: outcome.meta?.bonesMatched ?? 0,
            keyframeCount: outcome.meta?.keyframeCount ?? 0,
            armature: outcome.readback.action
          })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ ok: false, error: message })
          })
          deps.onEvent?.({
            kind: 'tool',
            name: 'try_blender_anim',
            bonesMatched: 0,
            keyframeCount: 0,
            error: message
          })
        }
      } else if (call.function.name === 'finalize_anim') {
        const result2 = deps.applyToRenderer(lastReadback)
        finalized = true
        deps.onEvent?.({
          kind: 'finalize',
          bonesMatched: result2.bonesMatched,
          keyframeCount: result2.keyframeCount
        })
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({
            ok: true,
            mode: args.mode === 'merge' ? 'merge' : 'replace',
            bonesMatched: result2.bonesMatched,
            keyframeCount: result2.keyframeCount
          })
        })
      } else {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ ok: false, error: `未知 tool: ${call.function.name}` })
        })
      }
    }

    if (finalized) {
      deps.onEvent?.({ kind: 'done', reason: 'finalized' })
      return buildResult(true, 'finalized', turn + 1)
    }
  }
  deps.onEvent?.({ kind: 'done', reason: 'max_turns' })
  return buildResult(false, 'max_turns', maxTurns)
}
