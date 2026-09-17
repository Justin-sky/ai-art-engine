/**
 * 3D 导演台 AI 姿势生成 → Blender MCP 共享层。
 *
 * ## 设计取向
 *
 * 原实现（`renderer/src/features/director/aiPoseParse.ts`）让 LLM 直接吐 Euler 度数
 * JSON function call，再在渲染层把度数转弧度喂给 `applyObjectBonePoseMap`。LLM 写
 * 数字角度这件事本来就不擅长（°/弧度混、关节链条不自洽、四元数 vs 欧拉混），于是
 * 结果常常「看上去对、动起来丑」。
 *
 * 重写后让 Blender 当姿势计算的真相来源——骨骼拓扑、链式约束、IK 解算、姿势库
 * 这些都是 Blender 一手资产。两条路径共用同一套「Blender MCP `execute_blender_code` +
 * 读回 stdout」管道：
 *
 * - **预设派发**：14 个 AI 姿势预设各自对应一份 Python 脚本（按 `role` 查预设旋转
 *   表直接打印 `POSE_RESULT:`），命中预设即跳过 LLM 调用——确定性、无 token 成本。
 * - **LLM 生成 Python**：自由文本描述走 `generateText`，prompt 要求 LLM 输出一段
 *   「导入 bpy / math / json + 构 dict + print POSE_RESULT」的 Python，再发到 Blender
 *   跑。两端用同一份 stdout 解析。
 *
 * 弧度而非度数：Blender 的 `pose_bone.rotation_euler` 与渲染层 `applyObjectBonePoseMap`
 * 的 `StageVec3` 都是弧度，全程一处口径，避免 LLM / Python / 渲染层三方来回转。
 *
 * ## 调用契约
 *
 * ```
 * 渲染层                共享层                  Blender MCP              Blender
 *   │   buildPresetPoseScript / LLM prompt    │                          │
 *   │ ─────────────────────────────────────────►                          │
 *   │                  Python 文本            │                          │
 *   │   runBlenderMcpTool(execute_blender_code, {code})                   │
 *   │ ────────────────────────────────────────►  addon TCP → 跑代码       │
 *   │                                              stdout ───────────────►│
 *   │   parseBlenderPoseReadback(stdout)                                  │
 *   │ ◄────────────────────────────────────────                          │
 *   │   applyObjectBonePoseMap(rotationRad)                               │
 * ```
 *
 * ## 边界（有意为之）
 *
 * - 共享层**不**做 Blender 连接状态检查：那是渲染层在调 runBlenderMcpTool 前后
 *   通过 `getBlenderMcpInfo` 决定展示哪条错误信息的事，混在一起反让两处都要做。
 * - 预设脚本只引用 `json` / `math` 两个 stdlib 模块——不依赖 bpy 也能跑通
 *   `safe_mode` 的词法护栏（ALLOWED_IMPORT_MODULES）。
 * - LLM 路径同样鼓励只用 `math`，把脚本当数据计算。Blender 进程是个保险：万一
 *   LLM 写了 `import bpy`，main 进程护栏会按规则放行（白名单内），仍可正确执行。
 */

import type { McpToolCallOutcome } from './mcpProtocol'

/** Blender 端脚本「结果在 stdout 的开头打上这个 marker，便于与可能的附加输出区隔」 */
export const BLENDER_POSE_RESULT_MARKER = 'POSE_RESULT:'

/** Blender 端 armature 骨名清单 marker；用于 agent 起手校准可写骨名 */
export const BLENDER_ARMATURE_BONE_LIST_MARKER = 'POSE_ARMATURE_BONES:'

/** Blender 端「真驱动 pose_bones 后」的命中/缺失明细 marker（与 POSE_RESULT 配套） */
export const BLENDER_POSE_DRIVE_META_MARKER = 'POSE_DRIVE_META:'

/** AI 姿势预设的 id 类型，与 `aiPosePresets.ts` 的 AI_POSE_INSTRUCTION_PRESETS 对齐 */
export type BlenderAiPosePresetId =
  | 'idle'
  | 'walk'
  | 'run'
  | 'jumpAir'
  | 'jumpLand'
  | 'wave'
  | 'handsOnHips'
  | 'point'
  | 'think'
  | 'crouch'
  | 'kneel'
  | 'bow'
  | 'fightGuard'
  | 'sit'

/** 骨骼角色 id（与 `aiPoseParse.ts` 的 RoleId 对齐；本模块不直接 import 以免循环依赖） */
export type BlenderBoneRole =
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

/** Blender 预设身份所需的最小输入 */
export interface BlenderPresetPoseInput {
  presetId: BlenderAiPosePresetId
  /** 渲染层按 `inferBoneRole` 算出来的角色映射：骨名 → 角色 */
  boneRoles: Record<string, BlenderBoneRole>
}

/** LLM 路径所需的最小输入 */
export interface BlenderAiPoseScriptInput {
  instruction: string
  /** 渲染层按 `inferBoneRole` 算出来的角色映射：骨名 → 角色 */
  boneRoles: Record<string, BlenderBoneRole>
  /** 骨名 → 父骨名（仅给 LLM 看上下文，渲染层用同一份 AiPoseBoneContext 喂进来） */
  boneParents: Record<string, string | null>
  locale: string
}

/** 渲染层 dispatch 决策：preset / ai 二选一 */
export type BlenderPoseStrategy = 'preset' | 'ai'

export interface BlenderPoseDispatch {
  strategy: BlenderPoseStrategy
  /** preset 路径命中的预设 id（命中失败时为 null，渲染层据此切到 LLM） */
  presetId: BlenderAiPosePresetId | null
  /** 渲染层送给 Blender MCP 的 Python 源码 */
  code: string
  /** 提示信息（用于日志：用户看到这条文案就知道当前走哪条路） */
  description: string
}

/** 读回结果：骨名 → 局部欧拉偏移（弧度 XYZ） */
export type BlenderPoseReadback = Record<string, [number, number, number]>

// --- 预设旋转表 -------------------------------------------------------------
//
// 手写 14 个姿势 × 14 个角色，每条三元组 = (rx, ry, rz)，右手 XYZ，旋转顺序 = Euler 轴，
// 单位度数（在 builder 里统一乘 π/180 转弧度）。故意取温和幅度（基本 ≤ 60°），免得
// 关节链条过度弯曲出怪姿势；用户可在渲染层「微调」面板里再改。
//
// 角度按「正面视图、脊柱沿 +Y」约定。Mixamo/Rigify 等常见 humanoid 骨骼的 bind 姿态
// 通常是 T-pose 或 A-pose，本表以 T-pose 为基准（l_upperarm 沿 +X 水平外展）。

const PRESET_ROTATIONS_DEG: Record<
  BlenderAiPosePresetId,
  Partial<Record<BlenderBoneRole, [number, number, number]>>
> = {
  // 自然站立休息：重心稳，肩松，脊柱直立，头略前看
  idle: {
    hips: [0, 0, 0],
    spine: [3, 0, 0],
    neck: [0, 0, 0],
    head: [-3, 0, 0],
    l_shoulder: [0, 0, 0],
    r_shoulder: [0, 0, 0],
    l_upperarm: [-6, 0, 5],
    r_upperarm: [-6, 0, -5],
    l_forearm: [10, 0, 0],
    r_forearm: [10, 0, 0],
    l_hand: [0, 0, 0],
    r_hand: [0, 0, 0],
    l_thigh: [0, 0, 0],
    r_thigh: [0, 0, 0],
    l_shin: [0, 0, 0],
    r_shin: [0, 0, 0],
    l_foot: [0, 0, 0],
    r_foot: [0, 0, 0],
    l_toe: [0, 0, 0],
    r_toe: [0, 0, 0]
  },
  // 走路迈步中段：右腿前跨、左腿后蹬，对侧手臂反相
  walk: {
    hips: [-2, 0, -3],
    spine: [3, 0, -5],
    neck: [0, 0, 0],
    head: [-3, 0, 5],
    l_shoulder: [0, 0, 0],
    r_shoulder: [0, 0, 0],
    l_upperarm: [-30, 0, 0],
    r_upperarm: [25, 0, 0],
    l_forearm: [15, 0, 0],
    r_forearm: [10, 0, 0],
    l_hand: [0, 0, 0],
    r_hand: [0, 0, 0],
    l_thigh: [-25, 0, 0],
    r_thigh: [25, 0, 0],
    l_shin: [40, 0, 0],
    r_shin: [10, 0, 0],
    l_foot: [0, 0, 0],
    r_foot: [0, 0, 0],
    l_toe: [0, 0, 0],
    r_toe: [0, 0, 0]
  },
  // 跑步冲刺静帧：前倾大，左臂大幅前摆肘屈
  run: {
    hips: [-15, 0, -5],
    spine: [15, 0, -8],
    neck: [0, 0, 0],
    head: [-10, 0, 5],
    l_shoulder: [0, 0, 0],
    r_shoulder: [0, 0, 0],
    l_upperarm: [-50, 0, 0],
    r_upperarm: [40, 0, 0],
    l_forearm: [80, 0, 0],
    r_forearm: [15, 0, 0],
    l_hand: [0, 0, 0],
    r_hand: [0, 0, 0],
    l_thigh: [-45, 0, 0],
    r_thigh: [50, 0, 0],
    l_shin: [70, 0, 0],
    r_shin: [10, 0, 0],
    l_foot: [0, 0, 0],
    r_foot: [0, 0, 0],
    l_toe: [0, 0, 0],
    r_toe: [0, 0, 0]
  },
  // 跳跃腾空：双臂上扬平衡，双膝收腿
  jumpAir: {
    hips: [5, 0, 0],
    spine: [-5, 0, 0],
    neck: [0, 0, 0],
    head: [-5, 0, 0],
    l_shoulder: [-30, 0, -45],
    r_shoulder: [-30, 0, 45],
    l_upperarm: [-50, 0, -45],
    r_upperarm: [-50, 0, 45],
    l_forearm: [60, 0, 0],
    r_forearm: [60, 0, 0],
    l_hand: [0, 0, 0],
    r_hand: [0, 0, 0],
    l_thigh: [60, 0, 0],
    r_thigh: [60, 0, 0],
    l_shin: [50, 0, 0],
    r_shin: [50, 0, 0],
    l_foot: [0, 0, 0],
    r_foot: [0, 0, 0],
    l_toe: [0, 0, 0],
    r_toe: [0, 0, 0]
  },
  // 跳跃落地缓冲：双膝深屈，髋后坐
  jumpLand: {
    hips: [-5, 0, 0],
    spine: [15, 0, 0],
    neck: [0, 0, 0],
    head: [-5, 0, 0],
    l_shoulder: [20, 0, -30],
    r_shoulder: [20, 0, 30],
    l_upperarm: [70, 0, -10],
    r_upperarm: [70, 0, 10],
    l_forearm: [30, 0, 0],
    r_forearm: [30, 0, 0],
    l_hand: [0, 0, 0],
    r_hand: [0, 0, 0],
    l_thigh: [-60, 0, 0],
    r_thigh: [-60, 0, 0],
    l_shin: [80, 0, 0],
    r_shin: [80, 0, 0],
    l_foot: [0, 0, 0],
    r_foot: [0, 0, 0],
    l_toe: [0, 0, 0],
    r_toe: [0, 0, 0]
  },
  // 右侧挥手：右上臂外展抬起，右腕上扬
  wave: {
    hips: [0, 0, 0],
    spine: [0, 0, -10],
    neck: [0, 0, 0],
    head: [0, 0, -5],
    l_shoulder: [0, 0, 0],
    r_shoulder: [0, 0, 0],
    l_upperarm: [-5, 0, 0],
    r_upperarm: [-100, 0, -20],
    l_forearm: [10, 0, 0],
    r_forearm: [-50, 0, 0],
    l_hand: [0, 0, 0],
    r_hand: [0, 0, 0],
    l_thigh: [0, 0, 0],
    r_thigh: [0, 0, 0],
    l_shin: [0, 0, 0],
    r_shin: [0, 0, 0],
    l_foot: [0, 0, 0],
    r_foot: [0, 0, 0],
    l_toe: [0, 0, 0],
    r_toe: [0, 0, 0]
  },
  // 双手叉腰：肘外展，胸微挺
  handsOnHips: {
    hips: [0, 0, 0],
    spine: [-3, 0, 0],
    neck: [0, 0, 0],
    head: [-5, 0, 0],
    l_shoulder: [0, 0, 0],
    r_shoulder: [0, 0, 0],
    l_upperarm: [-15, 0, 35],
    r_upperarm: [-15, 0, -35],
    l_forearm: [-90, 0, 0],
    r_forearm: [-90, 0, 0],
    l_hand: [0, 0, 0],
    r_hand: [0, 0, 0],
    l_thigh: [0, 0, 0],
    r_thigh: [0, 0, 0],
    l_shin: [0, 0, 0],
    r_shin: [0, 0, 0],
    l_foot: [0, 0, 0],
    r_foot: [0, 0, 0],
    l_toe: [0, 0, 0],
    r_toe: [0, 0, 0]
  },
  // 右手指向前方：右臂前伸
  point: {
    hips: [0, 0, 0],
    spine: [0, 0, -10],
    neck: [0, 0, 0],
    head: [-3, 0, -8],
    l_shoulder: [0, 0, 0],
    r_shoulder: [0, 0, 0],
    l_upperarm: [-5, 0, 0],
    r_upperarm: [-80, 0, 0],
    l_forearm: [10, 0, 0],
    r_forearm: [-5, 0, 0],
    l_hand: [0, 0, 0],
    r_hand: [0, 0, 0],
    l_thigh: [0, 0, 0],
    r_thigh: [0, 0, 0],
    l_shin: [0, 0, 0],
    r_shin: [0, 0, 0],
    l_foot: [0, 0, 0],
    r_foot: [0, 0, 0],
    l_toe: [0, 0, 0],
    r_toe: [0, 0, 0]
  },
  // 托腮思考：重心偏一侧，右手托下颌
  think: {
    hips: [-3, 0, 5],
    spine: [3, 0, 5],
    neck: [0, 0, 0],
    head: [-10, 0, -15],
    l_shoulder: [0, 0, 0],
    r_shoulder: [0, 0, 0],
    l_upperarm: [-10, 0, 10],
    r_upperarm: [-25, 0, -10],
    l_forearm: [-80, 0, 0],
    r_forearm: [-110, 0, 0],
    l_hand: [0, 0, 0],
    r_hand: [0, 0, 0],
    l_thigh: [0, 0, 0],
    r_thigh: [0, 0, 0],
    l_shin: [0, 0, 0],
    r_shin: [0, 0, 0],
    l_foot: [0, 0, 0],
    r_foot: [0, 0, 0],
    l_toe: [0, 0, 0],
    r_toe: [0, 0, 0]
  },
  // 深蹲警戒：双膝深屈，重心低
  crouch: {
    hips: [-15, 0, 0],
    spine: [20, 0, 0],
    neck: [0, 0, 0],
    head: [-10, 0, 0],
    l_shoulder: [0, 0, 0],
    r_shoulder: [0, 0, 0],
    l_upperarm: [-30, 0, -25],
    r_upperarm: [-30, 0, 25],
    l_forearm: [60, 0, 0],
    r_forearm: [60, 0, 0],
    l_hand: [0, 0, 0],
    r_hand: [0, 0, 0],
    l_thigh: [-70, 0, 0],
    r_thigh: [-70, 0, 0],
    l_shin: [80, 0, 0],
    r_shin: [80, 0, 0],
    l_foot: [0, 0, 0],
    r_foot: [0, 0, 0],
    l_toe: [0, 0, 0],
    r_toe: [0, 0, 0]
  },
  // 右膝单跪：右膝着地，左脚前撑
  kneel: {
    hips: [0, 0, 0],
    spine: [5, 0, 0],
    neck: [0, 0, 0],
    head: [-3, 0, 0],
    l_shoulder: [0, 0, 0],
    r_shoulder: [0, 0, 0],
    l_upperarm: [-5, 0, 0],
    r_upperarm: [-5, 0, 0],
    l_forearm: [30, 0, 0],
    r_forearm: [-50, 0, 0],
    l_hand: [0, 0, 0],
    r_hand: [0, 0, 0],
    l_thigh: [-90, 0, 5],
    r_thigh: [60, 0, -5],
    l_shin: [0, 0, 0],
    r_shin: [-90, 0, 0],
    l_foot: [0, 0, 0],
    r_foot: [0, 0, 0],
    l_toe: [0, 0, 0],
    r_toe: [0, 0, 0]
  },
  // 鞠躬致意：髋为轴上身 ~35° 前倾
  bow: {
    hips: [40, 0, 0],
    spine: [25, 0, 0],
    neck: [10, 0, 0],
    head: [10, 0, 0],
    l_shoulder: [0, 0, 0],
    r_shoulder: [0, 0, 0],
    l_upperarm: [-15, 0, 5],
    r_upperarm: [-15, 0, -5],
    l_forearm: [10, 0, 0],
    r_forearm: [10, 0, 0],
    l_hand: [0, 0, 0],
    r_hand: [0, 0, 0],
    l_thigh: [0, 0, 0],
    r_thigh: [0, 0, 0],
    l_shin: [0, 0, 0],
    r_shin: [0, 0, 0],
    l_foot: [0, 0, 0],
    r_foot: [0, 0, 0],
    l_toe: [0, 0, 0],
    r_toe: [0, 0, 0]
  },
  // 运动训练戒备：双肘抬起护面，膝微屈
  fightGuard: {
    hips: [0, 0, -10],
    spine: [5, 0, -5],
    neck: [0, 0, 0],
    head: [-3, 0, -5],
    l_shoulder: [0, 0, 0],
    r_shoulder: [0, 0, 0],
    l_upperarm: [-30, 0, 15],
    r_upperarm: [-30, 0, -15],
    l_forearm: [-100, 0, 0],
    r_forearm: [-100, 0, 0],
    l_hand: [0, 0, 0],
    r_hand: [0, 0, 0],
    l_thigh: [-25, 0, 0],
    r_thigh: [-15, 0, 0],
    l_shin: [10, 0, 0],
    r_shin: [10, 0, 0],
    l_foot: [0, 0, 0],
    r_foot: [0, 0, 0],
    l_toe: [0, 0, 0],
    r_toe: [0, 0, 0]
  },
  // 端坐：髋膝 ~90° 屈曲
  sit: {
    hips: [80, 0, 0],
    spine: [-10, 0, 0],
    neck: [0, 0, 0],
    head: [-3, 0, 0],
    l_shoulder: [0, 0, 0],
    r_shoulder: [0, 0, 0],
    l_upperarm: [-10, 0, 5],
    r_upperarm: [-10, 0, -5],
    l_forearm: [-90, 0, 0],
    r_forearm: [-90, 0, 0],
    l_hand: [0, 0, 0],
    r_hand: [0, 0, 0],
    l_thigh: [80, 0, 0],
    r_thigh: [80, 0, 0],
    l_shin: [-90, 0, 0],
    r_shin: [-90, 0, 0],
    l_foot: [0, 0, 0],
    r_foot: [0, 0, 0],
    l_toe: [0, 0, 0],
    r_toe: [0, 0, 0]
  }
}

/** 暴露给单测用的预设表，避免被改类型时单测编译失败 */
export const BLENDER_PRESET_ROTATION_TABLE: Readonly<
  Record<
    BlenderAiPosePresetId,
    Readonly<Partial<Record<BlenderBoneRole, readonly [number, number, number]>>>
  >
> = PRESET_ROTATIONS_DEG

/** 度数 → 弧度的 Python 字面量构造 helper（保留 6 位精度避免 JSON 体积暴涨） */
function radLiteral(deg: number): string {
  const rad = (deg * Math.PI) / 180
  // 用 toFixed(6) 而不是 round6：避免 -0 输出，且不会让无害的 0 看起来像「未设」
  return Number(rad.toFixed(6)).toString()
}

/** 角色旋转字典的 Python 字面量构造 */
function roleRotationLiteral(presetId: BlenderAiPosePresetId): string {
  const table = PRESET_ROTATIONS_DEG[presetId]
  // 只输出有非零旋转的角色，避免给角色表里其它键也写一项零
  const lines: string[] = []
  for (const [role, [x, y, z]] of Object.entries(table)) {
    if (x === 0 && y === 0 && z === 0) continue
    lines.push(
      `    ${JSON.stringify(role)}: [${radLiteral(x)}, ${radLiteral(y)}, ${radLiteral(z)}],`
    )
  }
  return `{\n${lines.join('\n')}\n  }`
}

/** 渲染层传进来的 boneRoles 转 Python dict 字面量 */
function boneRolesLiteral(boneRoles: Record<string, BlenderBoneRole>): string {
  const lines: string[] = []
  for (const [name, role] of Object.entries(boneRoles)) {
    if (!name || !role) continue
    lines.push(`    ${JSON.stringify(name)}: ${JSON.stringify(role)},`)
  }
  return `{\n${lines.join('\n')}\n  }`
}

/**
 * 为「预设派发」路径构造 Blender Python 脚本。
 *
 * 脚本不依赖 bpy：只读取 `BONE_ROLES` 与 `ROLE_ROTATIONS_RAD` 两个 dict，遍历
 * 输出 pose_bones，标 marker 后 print。这样在 safe mode 词法护栏下走白名单（只用
 * `json` / `math`），也方便单测在 Node 端直接解释（用纯 JS 仿照执行即可）。
 */
export function buildBlenderPresetPoseScript(input: BlenderPresetPoseInput): string {
  const { presetId, boneRoles } = input
  const table = PRESET_ROTATIONS_DEG[presetId]
  if (!table) throw new Error(`未知 Blender 姿势预设：${presetId}`)
  return [
    '# AIAE 3D 导演台 AI 姿势生成：预设派发（路径 = preset）',
    `# preset_id = ${JSON.stringify(presetId)}`,
    'import json',
    '',
    '# 由渲染层注入：骨名 → 角色（来自渲染层的 inferBoneRole）',
    'BONE_ROLES = ' + boneRolesLiteral(boneRoles),
    '',
    '# 由渲染层注入：角色 → 局部欧拉偏移（弧度，XYZ，右手）',
    'ROLE_ROTATIONS_RAD = ' + roleRotationLiteral(presetId),
    '',
    'pose_bones = {}',
    'for _name, _role in BONE_ROLES.items():',
    '    if _role in ROLE_ROTATIONS_RAD:',
    '        pose_bones[_name] = list(ROLE_ROTATIONS_RAD[_role])',
    '',
    `print("${BLENDER_POSE_RESULT_MARKER}" + json.dumps(pose_bones, ensure_ascii=False))`
  ].join('\n')
}

/**
 * 预设姿势的本地计算：与 `buildBlenderPresetPoseScript` 输出同一份骨名→弧度表，
 * 不经过 Blender。节点图 Cook 常用姿势时不必先开 Blender。
 */
export function computePresetPoseReadback(input: BlenderPresetPoseInput): BlenderPoseReadback {
  const table = PRESET_ROTATIONS_DEG[input.presetId]
  if (!table) throw new Error(`未知 Blender 姿势预设：${input.presetId}`)
  const out: BlenderPoseReadback = {}
  for (const [name, role] of Object.entries(input.boneRoles)) {
    const bone = name.trim()
    if (!bone || !role) continue
    const deg = table[role]
    if (!deg) continue
    const [x, y, z] = deg
    if (x === 0 && y === 0 && z === 0) continue
    out[bone] = [(x * Math.PI) / 180, (y * Math.PI) / 180, (z * Math.PI) / 180]
  }
  return out
}

/** 自由文本描述 → LLM prompt（system + user） */
export function buildBlenderAiPosePrompts(input: BlenderAiPoseScriptInput): {
  system: string
  user: string
} {
  const zh = !input.locale.toLowerCase().startsWith('en')
  const roles = Array.from(
    new Set(Object.values(input.boneRoles).filter((r) => r && r !== 'other'))
  )
  const roleLines = roles.length
    ? roles.join(', ')
    : '(no standard roles; still key by exact bone name)'
  const bones = Object.keys(input.boneRoles)
    .filter((n) => !!n)
    .map((n) => ({
      name: n,
      role: input.boneRoles[n],
      parent: input.boneParents[n] ?? null
    }))

  const system = zh
    ? `你是 3D 动画软件里的角色绑骨姿势助手。根据用户对姿势的描述，输出一段 Blender Python 脚本，在 Blender 进程里跑完后把结果通过 print 回给应用。

规则：
1. 输出一段**纯 Python 代码**（不要 markdown 代码栅栏、不要任何解释）。
2. 第一行必须是 \`import json\`；必要时可以 \`import math\`。**禁止** import bpy / bmesh / mathutils 之外的任何模块，禁止 import 别名、禁止 from-import 与通配 import。
3. 构造一个 Python dict \`POSE_BONES\`，键为骨名（必须从下面提供的「可用骨骼」里**逐字**复用），值为 \`[rx, ry, rz]\` 三元组：相对绑定姿势的**局部欧拉偏移，单位弧度**（不是度数），XYZ 旋转顺序，右手坐标系。
4. 每个角色选 1~3 个主要骨骼驱动；没列出的骨骼不必写。
5. 优先驱动躯干脊柱、肩、肘、髋、膝、踝，避免动手指 / twist / helper 类小骨。
7. 末段必须写 \`print("POSE_RESULT:" + json.dumps(POSE_BONES, ensure_ascii=False))\`（字符串与 marker 完全一致）。`
    : `You are a character-rig posing helper for a 3D animation tool. Given a pose description and a character's skeleton, output a Blender Python script that prints the pose back as JSON.

Rules:
1. Output ONLY pure Python code (no markdown fences, no explanation).
2. First line must be \`import json\`; you may add \`import math\` if needed. Do NOT import anything other than bpy / bmesh / mathutils / json / math. No aliased imports, no from-imports, no wildcard imports.
3. Build a Python dict \`POSE_BONES\` keyed by exact bone names from the provided "available bones" list. Values are \`[rx, ry, rz]\` local Euler offsets in RADIANS (XYZ order, right-handed).
4. For each role drive 1-3 main bones; unmentioned bones do not need to be listed.
5. Prefer torso/spine/shoulders/elbows/hips/knees/ankles; avoid fingers/twist/helper bones.
6. Last line MUST be exactly \`print("POSE_RESULT:" + json.dumps(POSE_BONES, ensure_ascii=False))\`.`

  const user = [
    zh ? '用户姿势描述：' : 'User pose description:',
    input.instruction.trim(),
    '',
    zh ? '可用角色（本骨架）：' : 'Available roles in this skeleton:',
    roleLines,
    '',
    zh
      ? '可用骨骼（用 "name" 字段作 dict 键；role 是提示）：'
      : 'Available bones (use "name" as JSON key; role is a hint):',
    JSON.stringify(bones, null, 2),
    '',
    zh ? '现在按规则输出 Python 脚本。' : 'Output the Python script now following the rules above.'
  ].join('\n')

  return { system, user }
}

/**
 * 策略派发决策：先尝试匹配 AI 姿势预设的中英文 instruction 字面量；
 * 命中 → 预设派发；未命中 → LLM 生成 Python 派发。
 *
 * 复用 `aiPosePresets.matchAiPosePresetId`：它的实现按整段相等匹配，渲染层
 * 选预设也是这个语义（用户点了预设按钮时直接传预设的 instruction 字符串），
 * 这里保持一致。
 */
export interface DecideBlenderPoseStrategyInput {
  instruction: string
  locale: string
  boneRoles: Record<string, BlenderBoneRole>
}

export function decideBlenderPoseStrategy(
  input: DecideBlenderPoseStrategyInput
): BlenderPoseDispatch {
  // 角色映射为空：角色识别失败，LLM 也救不了——直接走预设派发（命中即用，未命中抛错）
  // 注意：这里故意不写 `instruction.trim()` 兜底以避免静默吞字符串——空描述由 UI 层拦
  if (!input.instruction.trim()) {
    throw new Error('AI 姿势指令不能为空')
  }
  const presetId = matchBlenderPresetId(input.instruction, input.locale)
  if (presetId) {
    return {
      strategy: 'preset',
      presetId,
      code: buildBlenderPresetPoseScript({ presetId, boneRoles: input.boneRoles }),
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

/**
 * 与 `aiPosePresets.matchAiPosePresetId` 等价的「中英文字面量匹配」，但只走共享层
 * 已知枚举的 14 个 id，避免共享层依赖渲染层（共享层被主进程 / 渲染层 / 单测共用）。
 */
function matchBlenderPresetId(instruction: string, locale: string): BlenderAiPosePresetId | null {
  const text = instruction.trim()
  if (!text) return null
  // 直接比对预设中文 instruction 字面量；预设库是中英两套文本，写死一份在共享层里
  // 与 `AI_POSE_INSTRUCTION_PRESETS` 对齐（保持「选预设 / 自由描述走 LLM」语义一致）。
  const presets: Record<BlenderAiPosePresetId, { zh: string; en: string }> = {
    idle: {
      zh: '自然站立休息：重心略偏右腿，左膝微松；双臂自然垂于体侧，肩放松；脊柱直立，头略微前看，整体放松不僵硬。',
      en: 'Relaxed idle stand: weight slightly on the right leg, left knee soft; arms hang naturally, shoulders relaxed; upright spine, gaze forward, not stiff.'
    },
    walk: {
      zh: '走路迈步中段：右腿向前跨出、膝微屈，左腿在后且膝更屈；左臂前摆、右臂后摆；骨盆略向右前侧下沉，脊柱轻微扭转，目视前方。',
      en: 'Walk mid-step: right leg forward with soft knee, left leg back more bent; left arm forward, right arm back; pelvis slightly lower on the forward side, mild spinal twist, looking ahead.'
    },
    run: {
      zh: '跑步冲刺静帧：躯干明显前倾；右腿大步前跨、左腿后蹬膝高屈；左臂大幅前摆肘屈约90°，右臂后摆；头略低看前方，动态张力强。',
      en: 'Running sprint still: strong forward lean; right leg long stride forward, left leg driving back with high knee flex; left arm swings high elbow ~90°, right arm back; head slightly down, high energy.'
    },
    jumpAir: {
      zh: '跳跃腾空：双臂上扬或略后摆平衡；髋与双膝屈曲收腿，脚尖略下指；脊柱轻微伸展，胸部打开，面朝前上方，像刚离开地面。',
      en: 'Jump airborne: arms raised or slightly back for balance; hips and both knees flexed, toes pointing slightly down; mild spinal extension, chest open, facing forward-up as if just left the ground.'
    },
    jumpLand: {
      zh: '跳跃落地缓冲：双脚着地感，双膝深度屈曲，髋后坐；躯干前倾，双臂前伸或侧开保持平衡；头前看，重心低稳。',
      en: 'Jump landing absorb: grounded feet, deep knee and hip flex, sit back; torso leans forward, arms forward or out for balance; head looking ahead, low stable center of mass.'
    },
    wave: {
      zh: '右侧挥手致意：身体略转向右；右上臂外展抬起，右肘屈约40°–60°，右腕上扬作挥手；左臂自然下垂；重心偏左腿，表情面向观者。',
      en: 'Wave with right hand: body slightly turned right; right upper arm raised/abducted, elbow flexed ~40–60°, wrist up for waving; left arm relaxed down; weight on left leg, facing the viewer.'
    },
    handsOnHips: {
      zh: '双手叉腰站立：双脚略分开，重心稳；双手叉于腰侧，肘外展；胸稍挺，下巴微抬，自信站姿。',
      en: 'Hands on hips: feet slightly apart, stable weight; both hands on waist, elbows out; chest slightly up, chin gently lifted, confident stance.'
    },
    point: {
      zh: '右手指向前方：右臂前伸指向正前方，肘微直；左臂自然垂或轻屈于体侧；躯干略跟右手方向扭转，目视所指方向。',
      en: 'Point forward with right hand: right arm extended forward, elbow nearly straight; left arm relaxed or softly bent; torso twists slightly toward the pointing direction, gaze along the point.'
    },
    think: {
      zh: '托腮思考：重心偏一侧；右手抬至下颌/面颊轻托，右肘屈；左臂交叠或垂于身前；头略侧倾低头思考，肩放松。',
      en: 'Thinking chin-rest: weight shifted to one side; right hand raised to chin/cheek, elbow bent; left arm folded or resting in front; head slightly tilted down in thought, shoulders soft.'
    },
    crouch: {
      zh: '深蹲警戒：双膝深屈、髋下沉，上身微前倾；双手可置于膝前或抬起防护；头抬起观察前方，重心低、随时可起身。',
      en: 'Deep crouch ready: deep knee and hip flex, torso slightly forward; hands near knees or raised guard; head up scanning ahead, low center of mass ready to rise.'
    },
    kneel: {
      zh: '右膝单跪：右膝着地、左脚前撑；躯干直立或微前倾；双手可放在左膝上；头正视前方，稳定单跪姿势。',
      en: 'Right-knee kneel: right knee down, left foot planted forward; torso upright or slight lean; hands may rest on the left knee; head facing forward, stable half-kneel.'
    },
    bow: {
      zh: '鞠躬致意：双脚并拢站稳；髋为轴上身前倾约30°–45°，脊柱连贯弯曲；双臂垂于体侧或身前；头随躯干低下，礼貌正式。',
      en: 'Formal bow: feet together; hinge at hips with torso bent ~30–45°, continuous spine curve; arms at sides or front; head follows the torso down, polite and formal.'
    },
    fightGuard: {
      zh: '运动训练戒备站姿：左脚在前右脚在后，膝微屈；双手抬至下颌前方护面，肘内收；躯干略侧对前方，重心居中可移动，目光平视前方。',
      en: 'Athletic ready stance: left foot forward, right back, soft knees; both hands up near the jaw for guard, elbows in; torso slightly bladed forward, mobile center of mass, looking ahead.'
    },
    sit: {
      zh: '端坐姿势（无椅子也可表现坐姿感）：髋膝约90°屈曲，躯干直立；双手放在大腿上；双脚平放地面感，肩放松，头正直前视。',
      en: 'Seated pose (chair optional): hips and knees ~90° flexed, upright torso; hands on thighs; feet feel planted, shoulders relaxed, head level looking forward.'
    }
  }
  const enMode = locale.toLowerCase().startsWith('en')
  for (const [id, body] of Object.entries(presets) as Array<
    [BlenderAiPosePresetId, { zh: string; en: string }]
  >) {
    if (enMode ? body.en === text : body.zh === text) return id
    // 双语兜底：用户跨语种粘贴也认得
    if (body.zh === text || body.en === text) return id
  }
  return null
}

// --- 读回解析 ---------------------------------------------------------------

/**
 * 从 `McpToolCallOutcome.result` 里抠出 stdout 文本（社区 / 官方后端 stdout 都落在
 * `outcome.result.result`，详见 `runBlenderTool` 在主进程 `blenderMcpService.ts`
 * 里对两种 addon 方言的归一逻辑）。
 */
function extractExecuteStdout(outcome: McpToolCallOutcome): string {
  if (outcome.error) return ''
  const r = outcome.result
  if (typeof r === 'string') return r
  if (r && typeof r === 'object') {
    const obj = r as Record<string, unknown>
    // 社区 addon：`{ executed, result: stdout }`；官方 addon：mcpServerService 把它
    // 拍成 `{ result: stdout }`。两侧都落到 `result` 键。
    if (typeof obj.result === 'string') return obj.result
    if (typeof obj.output === 'string') return obj.output
    if (typeof obj.stdout === 'string') return obj.stdout
  }
  return ''
}

/** 从 `text` 里找到首个 `{` 之后到配对 `}` 的子串（含外层花括号）。
 *  解决同 stdout 里多 marker 共存时 `lastIndexOf('}')` 误吞下一个 marker 的 JSON。
 *  找不到 / 不配对返回 null。 */
function findFirstBalancedJsonObject(text: string): { start: number; end: number } | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escape) {
        escape = false
      } else if (ch === '\\') {
        escape = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
    } else if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) {
        return { start, end: i }
      }
    }
  }
  return null
}

/**
 * 解析 Blender Python 脚本里 `print("POSE_RESULT:" + json.dumps(...))` 的输出。
 *
 * 不抛则返回 `{骨名: [rx,ry,rz] 弧度}`；任何畸形（marker 缺失 / JSON 不合法 / 数值非法）
 * 一律抛错，让上层把异常翻译给用户看而不是静默空对象（与 `mapAiPoseDegreesToBonePose`
 * matched=0 路径同口径——空对象不该被当成「成功」）。
 */
export function parseBlenderPoseReadback(outcome: McpToolCallOutcome): BlenderPoseReadback {
  if (outcome.error) throw new Error(outcome.error)
  const stdout = extractExecuteStdout(outcome)
  if (!stdout) {
    throw new Error('Blender 没有返回 stdout；脚本是否跑了 print？')
  }
  const markerIdx = stdout.indexOf(BLENDER_POSE_RESULT_MARKER)
  if (markerIdx < 0) {
    throw new Error(
      `Blender stdout 缺少 ${BLENDER_POSE_RESULT_MARKER} 标记（前 200 字符）：${stdout.slice(0, 200)}`
    )
  }
  const tail = stdout.slice(markerIdx + BLENDER_POSE_RESULT_MARKER.length)
  // 取首个配对 {...} JSON：脚本后可能还有别的 marker（POSE_DRIVE_META:），
  // 不能用 lastIndexOf('}') 截，否则会把下一个 marker 的 JSON 一起吃进来。
  const balanced = findFirstBalancedJsonObject(tail)
  if (!balanced) {
    throw new Error(
      `${BLENDER_POSE_RESULT_MARKER} 后找不到 JSON 对象（前 200 字符）：${tail.slice(0, 200)}`
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(tail.slice(balanced.start, balanced.end + 1))
  } catch (err) {
    throw new Error(
      `${BLENDER_POSE_RESULT_MARKER} JSON 解析失败：${err instanceof Error ? err.message : String(err)}`
    )
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${BLENDER_POSE_RESULT_MARKER} 必须是 JSON 对象`)
  }
  const out: BlenderPoseReadback = {}
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (!k || typeof k !== 'string') continue
    if (!Array.isArray(v) || v.length !== 3) continue
    // 必须是「真正的 number」才能收：Number(null) === 0 / Number("") === 0 / Number("0") === 0
    // 这几类 LLM 输出瑕疵都会让「未填」被当成「=0」，必须排除
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
    out[k] = [nums[0], nums[1], nums[2]]
  }
  if (!Object.keys(out).length) {
    throw new Error(`${BLENDER_POSE_RESULT_MARKER} 里没有可用的骨骼旋转`)
  }
  return out
}

// --- Node 端等价执行（用于单测与离线回放）----------------------------------
//
// 单测在 Node 端跑、没法起 Blender，让 `executeBlenderPresetPosePure` 复刻脚本
// 在 Blender 里的最终结果（输入输出形状完全一致），便于断言 dispatcher 的产物。
// 脚本里没有任何 bpy 调用，所以这一步不需要解释器，就是一段纯 JS。

/** Node 端纯执行预设派发脚本；返回与 `parseBlenderPoseReadback` 等价的 dict */
export function executeBlenderPresetPosePure(input: BlenderPresetPoseInput): BlenderPoseReadback {
  const table = PRESET_ROTATIONS_DEG[input.presetId]
  if (!table) throw new Error(`未知 Blender 姿势预设：${input.presetId}`)
  const out: BlenderPoseReadback = {}
  for (const [name, role] of Object.entries(input.boneRoles)) {
    if (!name || !role) continue
    const rot = table[role as BlenderBoneRole]
    if (!rot) continue
    const [x, y, z] = rot
    if (x === 0 && y === 0 && z === 0) continue
    out[name] = [(x * Math.PI) / 180, (y * Math.PI) / 180, (z * Math.PI) / 180]
  }
  return out
}

// --- Armature 骨名清单：agent 起手时校准「可写骨名」---------------------------
//
// 之前的实现把渲染层骨架名当成 Blender 端 armature 骨名直接用；实际上两者经常不匹配
//（用户可能给渲染层装的是 Mixamo skeleton，Blender 里却是另一套 humanoid）。脚本里
// `pose_bones["mixamorig:Hips"] = ...` 在 Blender 端找不到同名骨就被静默丢掉，最终
// `parseBlenderPoseReadback` 抛"无可用骨骼旋转"。让 agent 起手先问 Blender「你
// 这儿的 armature 叫啥、骨有哪些」，与渲染层骨架取交集后再喂给 LLM，能少走很多弯路。

export interface BlenderArmatureBoneList {
  /** 当前 view_layer 里第一个 ARMATURE 对象的 name；找不到时为 null */
  armature: string | null
  /** armature 的所有骨名（data.bones.keys()，rest-pose 维度） */
  bones: string[]
}

/** 列出 Blender 当前 armature 骨名清单的 Python 脚本（agent 起手用） */
export function buildBlenderListArmatureBonesScript(): string {
  return [
    '# AIAE 3D 导演台：枚举当前 view_layer 里 armature 的全部骨名',
    'import json',
    'arm = None',
    'for _o in bpy.context.view_layer.objects:',
    '    if _o.type == "ARMATURE":',
    '        arm = _o',
    '        break',
    'if arm is None:',
    '    print(' +
      JSON.stringify(BLENDER_ARMATURE_BONE_LIST_MARKER) +
      ' + json.dumps({"armature": None, "bones": []}, ensure_ascii=False))',
    'else:',
    '    print(' +
      JSON.stringify(BLENDER_ARMATURE_BONE_LIST_MARKER) +
      ' + json.dumps({"armature": arm.name, "bones": list(arm.data.bones.keys())}, ensure_ascii=False))'
  ].join('\n')
}

/** 解析 list-armature 脚本的 stdout；marker 缺失 / JSON 畸形 / 不合规字段一律抛错 */
export function parseBlenderArmatureBoneList(outcome: McpToolCallOutcome): BlenderArmatureBoneList {
  if (outcome.error) throw new Error(outcome.error)
  const stdout = extractExecuteStdout(outcome)
  if (!stdout) throw new Error('Blender 没有返回 stdout；脚本是否跑了 print？')
  const idx = stdout.indexOf(BLENDER_ARMATURE_BONE_LIST_MARKER)
  if (idx < 0) {
    throw new Error(
      `Blender stdout 缺少 ${BLENDER_ARMATURE_BONE_LIST_MARKER} 标记（前 200 字符）：${stdout.slice(0, 200)}`
    )
  }
  const tail = stdout.slice(idx + BLENDER_ARMATURE_BONE_LIST_MARKER.length)
  const balanced = findFirstBalancedJsonObject(tail)
  if (!balanced) {
    throw new Error(
      `${BLENDER_ARMATURE_BONE_LIST_MARKER} 后找不到 JSON 对象（前 200 字符）：${tail.slice(0, 200)}`
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(tail.slice(balanced.start, balanced.end + 1))
  } catch (err) {
    throw new Error(
      `${BLENDER_ARMATURE_BONE_LIST_MARKER} JSON 解析失败：${err instanceof Error ? err.message : String(err)}`
    )
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${BLENDER_ARMATURE_BONE_LIST_MARKER} 必须是 JSON 对象`)
  }
  const obj = parsed as Record<string, unknown>
  const armature = typeof obj.armature === 'string' ? obj.armature : null
  const bonesRaw = Array.isArray(obj.bones) ? obj.bones : []
  const bones = bonesRaw.filter((b): b is string => typeof b === 'string')
  return { armature, bones }
}

// --- 真驱动 pose_bones 后回读的诊断元数据 -------------------------------------
//
// 让 LLM 的 Python 必须「先把 Euler 写到 `pose.bones[name].rotation_euler`、force
// depsgraph update、再读回」、并额外 print 一行 `POSE_DRIVE_META:` 元数据，让 agent
// 知道哪些骨真在 armature 上被驱动、哪些被 silently dropped。把诊断数据拆成独立 marker
// 是为了和原来的 POSE_RESULT flat dict 形状兼容——`parseBlenderPoseReadback` 不需要
// 改，preset 路径也照旧工作。

export interface BlenderDrivePoseMeta {
  /** Python 真正写到 pose.bones[xxx].rotation_euler 的命中数 */
  matched: number
  /** LLM 给了但 Blender armature 上找不到的骨名清单 */
  missing: string[]
  /** Blender 端实际命中的 armature 对象名（用于 UI 诊断） */
  armature: string | null
}

/** 解析 POSE_DRIVE_META: 行；marker 缺失返回 null（兼容老脚本只 print POSE_RESULT） */
export function parseBlenderDrivePoseMeta(outcome: McpToolCallOutcome): BlenderDrivePoseMeta | null {
  if (outcome.error) return null
  const stdout = extractExecuteStdout(outcome)
  if (!stdout) return null
  const idx = stdout.indexOf(BLENDER_POSE_DRIVE_META_MARKER)
  if (idx < 0) return null
  const tail = stdout.slice(idx + BLENDER_POSE_DRIVE_META_MARKER.length)
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
  const matched = Number.isFinite(obj.matched) ? Number(obj.matched) : 0
  const missingRaw = Array.isArray(obj.missing) ? obj.missing : []
  const missing = missingRaw.filter((m): m is string => typeof m === 'string')
  const armature = typeof obj.armature === 'string' ? obj.armature : null
  return { matched, missing, armature }
}

// --- Agent loop（多轮 chat agent + Blender MCP 当 tool）--------------------
//
// 取代「one-shot LLM → 直接 stripPythonCodeFence → 跑 Blender」的旧链：让 LLM 在
// 拿到 stdout 后能看出「哪个骨没命中 / 哪个轴值错了」，再发一轮修订脚本。我们把
// `try_blender_pose` 和 `finalize_pose` 两个 tool 暴露给 LLM，agent loop 是纯函数：
// 真实 I/O（`generateText` / `runBlenderMcpTool` / `scene.applyObjectBonePoseMap`）
// 通过 deps 注入，方便在 Node 单测里用假 client 跑。

/** Agent loop 默认最大轮数；到达即停，按未 finalize 处理 */
export const BLENDER_POSE_AGENT_DEFAULT_MAX_TURNS = 5

/** OpenAI 风格 tool schema（两条：跑脚本、落盘到渲染层） */
export const BLENDER_POSE_AGENT_TOOLS: ReadonlyArray<{
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
      name: 'try_blender_pose',
      description:
        '在 Blender 里执行一段 Python 脚本，**真正驱动**当前 armature 的 pose_bones 并回读姿态。\n' +
        '参数 python_code 必须是完整脚本，**严格按下面模板**只填 POSE_BONES 字典（其余驱动代码不要改）：\n\n' +
        '```python\n' +
        'import json\n' +
        'import bpy\n' +
        'import mathutils\n' +
        '\n' +
        'POSE_BONES = {\n' +
        '    # 骨名（必须从 system 里给的"实际可用骨骼"里逐字复用）: [rx, ry, rz] 弧度\n' +
        '}\n' +
        '\n' +
        'arm = next((o for o in bpy.context.view_layer.objects if o.type == "ARMATURE"), None)\n' +
        'matched = {}\n' +
        'missing = []\n' +
        'armature_name = None\n' +
        'if arm is not None:\n' +
        '    armature_name = arm.name\n' +
        '    pose = arm.pose.bones\n' +
        '    for name, value in POSE_BONES.items():\n' +
        '        if name in pose:\n' +
        '            pose[name].rotation_mode = "XYZ"\n' +
        '            pose[name].rotation_euler = mathutils.Euler(tuple(value), "XYZ")\n' +
        '            matched[name] = list(pose[name].rotation_euler)\n' +
        '        else:\n' +
        '            missing.append(name)\n' +
        '    bpy.context.view_layer.update()\n' +
        '\n' +
        'print("' + BLENDER_POSE_RESULT_MARKER + '" + json.dumps(matched, ensure_ascii=False))\n' +
        'print("' + BLENDER_POSE_DRIVE_META_MARKER + '" + json.dumps(\n' +
        '    {"matched": len(matched), "missing": missing, "armature": armature_name},\n' +
        '    ensure_ascii=False,\n' +
        '))\n' +
        '```\n\n' +
        '返回值是 JSON：成功时 {ok:true, matched, readback:{骨名:[rx,ry,rz]}, missing?, armature?}；' +
        '失败时 {ok:false, error}（marker 缺失 / JSON 畸形 / 空字典 / Blender 端没找到 armature 等）。\n' +
        '**必须真驱动** pose_bones[name].rotation_euler 再读回，不能只 print 一个凭空构造的 dict——' +
        '否则 Blender 端的姿态不会真正落到 armature 上，渲染层拿到的 Euler 也是 LLM 猜的、与 rig 骨骼轴向不匹配。',
      parameters: {
        type: 'object',
        properties: {
          python_code: { type: 'string', description: '完整可执行 Python 源码（按上述模板）' }
        },
        required: ['python_code']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'finalize_pose',
      description:
        '确认采用本轮 POSE_RESULT：把上一轮 try_blender_pose 返回的 readback 应用到渲染层场景。' +
        '只能在拿到的 readback 看起来合理时调用；不再调整就调一次并结束。',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['replace', 'merge'],
            description: 'replace=整图替换，merge=与现有 bonePose 合并（默认 replace）'
          }
        }
      }
    }
  }
]

/** Agent loop 与 renderer 通信的事件：用于日志 / UI 状态条 */
export type BlenderPoseAgentEvent =
  | { kind: 'armature_list'; armature: string | null; bones: string[]; sceneBones: string[]; matched: string[] }
  | { kind: 'turn'; turn: number; text?: string; toolNames: string[] }
  | {
      kind: 'tool'
      name: 'try_blender_pose'
      matched: number
      total: number
      missing?: string[]
      armature?: string | null
      error?: string
    }
  | { kind: 'finalize'; matched: number; total: number }
  | { kind: 'done'; reason: 'finalized' | 'no_finalize' | 'max_turns'; matched: number; total: number }
  | { kind: 'error'; message: string }

/** Agent loop 的依赖注入：把 I/O 从算法里拆出去 */
export interface RunBlenderAiPoseAgentDeps {
  /** 调 LLM；只关心 system+tools+多轮 messages */
  modelClient: (input: {
    system: string
    messages: ReadonlyArray<BlenderPoseAgentMessage>
    tools: typeof BLENDER_POSE_AGENT_TOOLS
  }) => Promise<{
    text: string
    toolCalls: ReadonlyArray<{
      id: string
      type: 'function'
      function: { name: string; arguments: string }
    }>
    finishReason?: string
  }>
  /** 跑 Blender Python；readback 仍是 {name:[rx,ry,rz]} flat dict，
   * meta 是 Blender 端真驱动后的命中数 / 缺失骨名 / armature 名（可选，老脚本兼容）。 */
  blenderRun: (code: string) => Promise<{
    readback: BlenderPoseReadback
    meta?: BlenderDrivePoseMeta | null
  }>
  /** 把 readback 真正写到 three.js 场景 */
  applyToRenderer: (readback: BlenderPoseReadback) => { matched: number; total: number }
  /** 列出 Blender 当前 armature 的实际骨名；agent 起手用它跟渲染层骨架取交集再喂给 LLM。
   *  可选——不传时 fallback 到只用渲染层骨架名（保留旧行为）。 */
  listArmatureBones?: () => Promise<BlenderArmatureBoneList>
  /** UI 日志钩子（可空） */
  onEvent?: (event: BlenderPoseAgentEvent) => void
}

/** Agent loop 多轮消息类型 */
export type BlenderPoseAgentMessage =
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

export interface RunBlenderAiPoseAgentInput {
  instruction: string
  boneRoles: Record<string, BlenderBoneRole>
  boneParents: Record<string, string | null>
  locale: string
  /** 默认 BLENDER_POSE_AGENT_DEFAULT_MAX_TURNS */
  maxTurns?: number
}

export interface RunBlenderAiPoseAgentResult {
  ok: boolean
  reason: 'finalized' | 'no_finalize' | 'max_turns' | 'error'
  matched: number
  total: number
  /** 最后一次成功的 readback（即便没 finalize 也保留，便于 UI 调试） */
  readback: BlenderPoseReadback
  /** 最近一次 Blender 真驱动的诊断（missing 骨名 / armature 名） */
  lastMissing?: string[]
  lastArmature?: string | null
  /** 起手校准：Blender 端 armature 实际有的骨名 ∩ 渲染层骨架名 */
  boneIntersection?: string[]
  boneArmature?: string | null
  turns: number
}

/** Agent loop 的 system prompt：在 buildBlenderAiPosePrompts 基础上补 tool 用法 + Blender-confirmed 骨名 */
function buildBlenderAiPoseAgentSystem(
  input: RunBlenderAiPoseAgentInput,
  boneContext?: { armature: string | null; blenderBones: string[]; intersect: string[] }
): string {
  const basePrompts = buildBlenderAiPosePrompts(input)
  const zh = !input.locale.toLowerCase().startsWith('en')
  let boneSection = ''
  if (boneContext && boneContext.blenderBones.length) {
    const listStr = boneContext.intersect.length
      ? boneContext.intersect.join('\n  - ')
      : '(空——渲染层骨架里没有任何名字在 Blender armature 上)'
    const fallbackStr = boneContext.intersect.length
      ? ''
      : `\n全部 Blender 骨名（仅供参考，可能含 finger/twist/helper 等小骨，按需自取）：\n  - ${boneContext.blenderBones.slice(0, 200).join('\n  - ')}${boneContext.blenderBones.length > 200 ? `\n  - … 还有 ${boneContext.blenderBones.length - 200} 根` : ''}`
    boneSection = zh
      ? `\n\n=== Blender armature 校准（agent 起手时确认） ===\narmature 名称：${boneContext.armature ?? '（Blender 端未找到任何 ARMATURE 对象）'}\n渲染层骨架名 ∩ Blender 骨名（请只从这里挑骨名写 POSE_BONES）：\n  - ${listStr}${fallbackStr}`
      : `\n\n=== Blender armature calibration (confirmed at agent start) ===\narmature name: ${boneContext.armature ?? '(no ARMATURE found in Blender)'}\nscene bones ∩ Blender bones (only use names from this list in POSE_BONES):\n  - ${listStr}${fallbackStr}`
  } else if (boneContext && !boneContext.armature) {
    boneSection = zh
      ? `\n\n=== Blender armature 校准 ===\nBlender 当前 view_layer 里没有任何 ARMATURE 对象——脚本里的 \`next((o for o in bpy.context.view_layer.objects if o.type == "ARMATURE"))\` 会拿到 None。\n请告诉用户：让 Blender 里打开/选中那个 armature 后再点 AI 姿势。`
      : `\n\n=== Blender armature calibration ===\nNo ARMATURE found in current view_layer — the \`next((...))\` will return None.\nTell the user to open/activate the armature in Blender before retrying.`
  }

  const tail = zh
    ? `

多轮工作流（必须遵守）：
1. 先调 \`try_blender_pose\` 工具，把你写的 Python 代码送进 Blender 跑。**Python 必须按工具描述里的模板**——先把 Euler 写到 \`pose.bones[name].rotation_euler\`，force depsgraph update，再 read 回 \`rotation_euler\`，最后分别 print \`${BLENDER_POSE_RESULT_MARKER}\` 与 \`${BLENDER_POSE_DRIVE_META_MARKER}\` 两行。**不要只 print 一个凭空构造的 dict**。
2. 工具会回 JSON：\n   - \`{ok:true, matched, readback:{...}, missing?, armature?}\`：Blender 端真驱动后的命中 / 缺失明细；\n   - \`{ok:false, error}\`：错误信息（marker 缺失 / JSON 畸形 / 空字典 / Blender 端没找到 armature 等）。
3. 如果 \`missing\` 里有渲染层骨架名但 Blender armature 上没有——**不要再写它们**，改用交集里的 Blender 实际骨名；如果 readback 里命中的骨数太少、轴值不合理或与用户描述不符，**改写 Python 再调一次** \`try_blender_pose\`，最多 ${BLENDER_POSE_AGENT_DEFAULT_MAX_TURNS} 轮。
4. 拿到满意的 readback 后，调 \`finalize_pose\` 一次把它落到渲染层（这会结束循环）。
5. 不要再返回纯文本以外的解释——所有决策都通过 tool。${boneSection}`
    : `

Multi-turn workflow (mandatory):
1. Call \`try_blender_pose\` with your Python script. **The script MUST follow the template in the tool description** — write \`pose.bones[name].rotation_euler = mathutils.Euler(value, 'XYZ')\`, force \`bpy.context.view_layer.update()\`, read back \`rotation_euler\`, then print both \`${BLENDER_POSE_RESULT_MARKER}\` and \`${BLENDER_POSE_DRIVE_META_MARKER}\`. Do NOT just print a hand-crafted dict.
2. The tool returns JSON:
   - \`{ok:true, matched, readback:{...}, missing?, armature?}\`: what Blender actually drove
   - \`{ok:false, error}\`: missing marker / malformed JSON / empty dict / no armature found
3. If \`missing\` contains scene-bone names that don't exist in Blender, drop them — only use the intersection. If matched is too low, axes feel wrong, or the result does not match the description, **revise the Python and call \`try_blender_pose\` again**. Maximum ${BLENDER_POSE_AGENT_DEFAULT_MAX_TURNS} turns.
4. When the readback looks good, call \`finalize_pose\` once to commit to the renderer (this ends the loop).
5. Do not output anything other than tool calls.${boneSection}`
  return basePrompts.system + tail
}

/** 尝试解析 tool_call.arguments；解析失败返回原始字符串，方便 LLM 看出错 */
function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    /* fall through */
  }
  return {}
}

/** Agent loop 入口 */
export async function runBlenderAiPoseAgent(
  input: RunBlenderAiPoseAgentInput,
  deps: RunBlenderAiPoseAgentDeps
): Promise<RunBlenderAiPoseAgentResult> {
  const maxTurns = Math.max(1, input.maxTurns ?? BLENDER_POSE_AGENT_DEFAULT_MAX_TURNS)

  // 起手：先问 Blender 当前 armature 有什么骨；与渲染层骨架取交集后塞进 system prompt，
  // 让 LLM 的 POSE_BONES 只用 Blender 真正有的骨名——避免名字不对导致静默丢姿态。
  let boneContext:
    | { armature: string | null; blenderBones: string[]; intersect: string[] }
    | undefined
  const sceneBoneNames = Object.keys(input.boneRoles).filter((n) => !!n)
  if (deps.listArmatureBones) {
    try {
      const list = await deps.listArmatureBones()
      const intersect = sceneBoneNames.filter((n) => list.bones.includes(n))
      boneContext = {
        armature: list.armature,
        blenderBones: list.bones,
        intersect
      }
      deps.onEvent?.({
        kind: 'armature_list',
        armature: list.armature,
        bones: list.bones,
        sceneBones: sceneBoneNames,
        matched: intersect
      })
    } catch (err) {
      // 列 armature 失败不应阻塞 agent——保留旧行为：只用渲染层骨架名
      const message = err instanceof Error ? err.message : String(err)
      deps.onEvent?.({ kind: 'error', message })
    }
  }

  const system = buildBlenderAiPoseAgentSystem(input, boneContext)
  const prompts = buildBlenderAiPosePrompts(input)
  const messages: BlenderPoseAgentMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: prompts.user }
  ]

  let lastReadback: BlenderPoseReadback = {}
  let lastMatch = 0
  let lastTotal = 0
  let lastMissing: string[] = []
  let lastArmature: string | null = null
  let finalized = false
  let finalizeMatched = 0
  let finalizeTotal = 0

  /** 把每轮累计的诊断状态塞进 return —— 让 renderer / UI 不用再遍历 messages 自己拼 */
  function buildResult(
    ok: boolean,
    reason: RunBlenderAiPoseAgentResult['reason'],
    turns: number,
    matched: number,
    total: number,
    readback: BlenderPoseReadback
  ): RunBlenderAiPoseAgentResult {
    const result: RunBlenderAiPoseAgentResult = {
      ok,
      reason,
      matched,
      total,
      readback,
      turns
    }
    if (lastMissing.length) result.lastMissing = lastMissing
    if (lastArmature !== null) result.lastArmature = lastArmature
    if (boneContext) {
      result.boneIntersection = boneContext.intersect
      result.boneArmature = boneContext.armature
    }
    return result
  }

  for (let turn = 0; turn < maxTurns; turn++) {
    let result: Awaited<ReturnType<RunBlenderAiPoseAgentDeps['modelClient']>>
    try {
      result = await deps.modelClient({
        system,
        messages,
        tools: BLENDER_POSE_AGENT_TOOLS
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      deps.onEvent?.({ kind: 'error', message })
      return buildResult(false, 'error', turn, lastMatch, lastTotal, lastReadback)
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
      // 模型没调 tool，按"未 finalize"收尾；保留 lastReadback 方便 UI 复用
      deps.onEvent?.({
        kind: 'done',
        reason: 'no_finalize',
        matched: lastMatch,
        total: lastTotal
      })
      return buildResult(false, 'no_finalize', turn + 1, lastMatch, lastTotal, lastReadback)
    }

    for (const call of calls) {
      const args = parseToolArgs(call.function.arguments)
      if (call.function.name === 'try_blender_pose') {
        const code = typeof args.python_code === 'string' ? args.python_code : ''
        if (!code.trim()) {
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ ok: false, error: 'python_code 不能为空' })
          })
          deps.onEvent?.({
            kind: 'tool',
            name: 'try_blender_pose',
            matched: 0,
            total: lastTotal,
            error: 'empty python_code'
          })
          continue
        }
        try {
          const outcome = await deps.blenderRun(code)
          const readback = outcome.readback
          const meta = outcome.meta
          const matched = meta?.matched ?? Object.keys(readback).length
          const missing = meta?.missing ?? []
          const armature = meta?.armature ?? null
          lastReadback = readback
          lastMatch = matched
          lastTotal = Object.keys(readback).length
          lastMissing = missing
          lastArmature = armature
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({
              ok: true,
              matched,
              readback,
              missing: missing.length ? missing : undefined,
              armature
            })
          })
          deps.onEvent?.({
            kind: 'tool',
            name: 'try_blender_pose',
            matched,
            total: lastTotal,
            missing: missing.length ? missing : undefined,
            armature
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
            name: 'try_blender_pose',
            matched: 0,
            total: lastTotal,
            error: message
          })
        }
      } else if (call.function.name === 'finalize_pose') {
        const mode = args.mode === 'merge' ? 'merge' : 'replace'
        // 把 lastReadback 当作"采纳值"——如果用户在最后一轮同时调 try_blender_pose + finalize，
        // 就拿最后一轮 try 的产物；否则以最近一次成功的为准。
        const result2 = deps.applyToRenderer(lastReadback)
        finalizeMatched = result2.matched
        finalizeTotal = result2.total
        finalized = true
        deps.onEvent?.({
          kind: 'finalize',
          matched: result2.matched,
          total: result2.total
        })
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({
            ok: true,
            mode,
            matched: result2.matched,
            total: result2.total
          })
        })
      } else {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({
            ok: false,
            error: `未知 tool: ${call.function.name}`
          })
        })
      }
    }

    if (finalized) {
      deps.onEvent?.({
        kind: 'done',
        reason: 'finalized',
        matched: finalizeMatched,
        total: finalizeTotal
      })
      return buildResult(true, 'finalized', turn + 1, finalizeMatched, finalizeTotal, lastReadback)
    }
  }

  deps.onEvent?.({
    kind: 'done',
    reason: 'max_turns',
    matched: lastMatch,
    total: lastTotal
  })
  return buildResult(false, 'max_turns', maxTurns, lastMatch, lastTotal, lastReadback)
}
