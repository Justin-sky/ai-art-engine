/**
 * 3D 骨骼蒙皮 → Blender MCP 共享层（`model.rigSkin` 节点用）。
 *
 * ## 设计取向
 *
 * 与 `blenderPoseGeneration.ts` 同构：
 *
 * - **预设派发**：4 个常见拓扑预设（humanoid-simple / humanoid-mixamo / quadruped /
 *   prop-rigid），每个预设对应一份 Python 脚本——直接用 bpy 创建 armature + bones，再
 *   调用 `bpy.ops.object.parent_set(type='ARMATURE_AUTO')` 让 Blender 自动算蒙皮权重。
 *   命中预设即跳过 LLM 调用，确定性、无 token 成本。
 * - **LLM 生成 Python**：自由文本描述走 `generateText`，prompt 要求 LLM 输出
 *   「import bpy + 构造 armature / bones / 调自动权重 + print RIG_RESULT」的脚本，发到
 *   Blender 跑。两端用同一份 stdout 解析（marker + 配对花括号 JSON）。
 *
 * ## 输出 / 契约
 *
 * ```
 * 节点                共享层                       Blender MCP               Blender
 *  │  strategy / code  │                                              │
 *  │ ─────────────────►                                              │
 *  │  runBlenderMcpTool(execute_blender_code, {code})                 │
 *  │ ─────────────────────────────► addon TCP → 跑代码                │
 *  │                                stdout ──────────────────────────►│
 *  │  parseBlenderRigReadback(stdout)                                 │
 *  │ ◄────────────────────                                             │
 *  │  rigMeta = { armature, bones, vertexGroups, presetId? }           │
 * ```
 *
 * ## 边界
 *
 * - 共享层**不**做 Blender 连接状态检查；那是渲染层的事。
 * - 预设脚本只 `import bpy / bmesh / math / json`，与 AI 路径共用同一份词法护栏。
 * - LLM 路径同样鼓励只用 `math` / `bpy` / `json`，让 safe mode 词法护栏稳妥放行。
 */

import type { McpToolCallOutcome } from './mcpProtocol'

/** Blender 端脚本「结果在 stdout 的开头打上这个 marker」 */
export const BLENDER_RIG_RESULT_MARKER = 'RIG_RESULT:'

/** Blender 端「真创建 armature 后」的命中/缺失明细 marker（与 RIG_RESULT 配套） */
export const BLENDER_RIG_DRIVE_META_MARKER = 'RIG_DRIVE_META:'

/** 共享层已知的骨骼拓扑预设 id；枚举扩展时与 instruction presets 同步 */
export type BlenderRigPresetId = 'humanoid-simple' | 'humanoid-mixamo' | 'quadruped' | 'prop-rigid'

/** 单根骨骼的相对位置与方向（rest-pose 局部坐标，米） */
export interface BlenderBoneSpec {
  name: string
  parent?: string
  /** head 位置（父骨局部） */
  head: [number, number, number]
  /** tail 位置（父骨局部） */
  tail: [number, number, number]
  /** roll（绕 bone axis 的旋转，弧度） */
  roll?: number
}

/** 一个完整 rig 拓扑描述 */
export interface BlenderRigTopology {
  /** armature 对象名（同时也是骨架显示名） */
  armatureName: string
  /** 骨头列表；parent 指向同数组里的 name 或省略表示根 */
  bones: BlenderBoneSpec[]
}

/** AI 姿势路径所需的最小输入 */
export interface BlenderRigSkinInput {
  /** 中文 / 英文 instruction；预设派发是字面量匹配 */
  instruction: string
  locale: string
  /** 当前模型名（Blender 端用作 armature/对象前缀，避免冲突） */
  modelName: string
}

/** 读回结果：armature + bones + vertex groups（自动权重后） */
export interface BlenderRigReadback {
  armature: string | null
  bones: string[]
  vertexGroups: string[]
  presetId: BlenderRigPresetId | null
}

/** 策略派发：preset / ai 二选一 */
export type BlenderRigStrategy = 'preset' | 'ai'

export interface BlenderRigDispatch {
  strategy: BlenderRigStrategy
  presetId: BlenderRigPresetId | null
  /** 预设派发的 Python 脚本；AI 路径只在 agent 决策时由 LLM 现场生成 */
  code: string
  description: string
}

/** 真驱动 armature 后回读的诊断元数据 */
export interface BlenderDriveRigMeta {
  /** armature 创建后 bones 数（用 data.bones.keys() 数） */
  bonesMatched: number
  /** vertex group 数（自动权重后 mesh.vertex_groups 数） */
  vertexGroupsMatched: number
  armature: string | null
}

// --- 预设拓扑表（rest-pose 局部坐标）----------------------------------------
//
// 按「脊柱沿 +Y 起点在原点、头朝 +Y、脚朝 -Y」约定；Mixamo / Rigify 默认朝向都这样。
// roll 设 0（多数 bone 不绕轴旋转也能看）。

function topologyHumanoidSimple(): BlenderRigTopology {
  const name = 'RigHumanoid'
  return {
    armatureName: name,
    bones: [
      // 根 + 脊柱链
      { name: 'Root', head: [0, 0, 0], tail: [0, 0.1, 0] },
      { name: 'Hips', parent: 'Root', head: [0, 1.0, 0], tail: [0, 1.1, 0] },
      { name: 'Spine', parent: 'Hips', head: [0, 1.1, 0], tail: [0, 1.4, 0] },
      { name: 'Chest', parent: 'Spine', head: [0, 1.4, 0], tail: [0, 1.65, 0] },
      { name: 'Neck', parent: 'Chest', head: [0, 1.65, 0], tail: [0, 1.78, 0] },
      { name: 'Head', parent: 'Neck', head: [0, 1.78, 0], tail: [0, 1.95, 0] },
      // 左臂
      { name: 'LeftShoulder', parent: 'Chest', head: [0.08, 1.6, 0], tail: [0.18, 1.6, 0] },
      { name: 'LeftUpperArm', parent: 'LeftShoulder', head: [0.18, 1.6, 0], tail: [0.45, 1.55, 0] },
      { name: 'LeftForearm', parent: 'LeftUpperArm', head: [0.45, 1.55, 0], tail: [0.65, 1.35, 0] },
      { name: 'LeftHand', parent: 'LeftForearm', head: [0.65, 1.35, 0], tail: [0.75, 1.3, 0] },
      // 右臂
      { name: 'RightShoulder', parent: 'Chest', head: [-0.08, 1.6, 0], tail: [-0.18, 1.6, 0] },
      {
        name: 'RightUpperArm',
        parent: 'RightShoulder',
        head: [-0.18, 1.6, 0],
        tail: [-0.45, 1.55, 0]
      },
      {
        name: 'RightForearm',
        parent: 'RightUpperArm',
        head: [-0.45, 1.55, 0],
        tail: [-0.65, 1.35, 0]
      },
      { name: 'RightHand', parent: 'RightForearm', head: [-0.65, 1.35, 0], tail: [-0.75, 1.3, 0] },
      // 左腿
      { name: 'LeftUpperLeg', parent: 'Hips', head: [0.1, 1.0, 0], tail: [0.1, 0.55, 0] },
      { name: 'LeftLowerLeg', parent: 'LeftUpperLeg', head: [0.1, 0.55, 0], tail: [0.1, 0.1, 0] },
      { name: 'LeftFoot', parent: 'LeftLowerLeg', head: [0.1, 0.1, 0], tail: [0.1, 0.0, 0.15] },
      // 右腿
      { name: 'RightUpperLeg', parent: 'Hips', head: [-0.1, 1.0, 0], tail: [-0.1, 0.55, 0] },
      {
        name: 'RightLowerLeg',
        parent: 'RightUpperLeg',
        head: [-0.1, 0.55, 0],
        tail: [-0.1, 0.1, 0]
      },
      { name: 'RightFoot', parent: 'RightLowerLeg', head: [-0.1, 0.1, 0], tail: [-0.1, 0.0, 0.15] }
    ]
  }
}

function topologyHumanoidMixamo(): BlenderRigTopology {
  // 与 humanoid-simple 拓扑一致 + 双手指（每指 2 段）+ toe，方便 Mixamo 动画直接套用。
  // Mixamo 约定里 Hips 就是 root（没有单独的 Root 骨），所以这里把第一根 Root 改名成 Hips。
  const base = topologyHumanoidSimple()
  const renameMap: Record<string, string> = {
    Hips: 'Hips',
    Spine: 'Spine',
    Chest: 'Spine1',
    Neck: 'Neck',
    Head: 'Head',
    LeftShoulder: 'LeftShoulder',
    LeftUpperArm: 'LeftArm',
    LeftForearm: 'LeftForeArm',
    LeftHand: 'LeftHand',
    RightShoulder: 'RightShoulder',
    RightUpperArm: 'RightArm',
    RightForearm: 'RightForeArm',
    RightHand: 'RightHand',
    LeftUpperLeg: 'LeftUpLeg',
    LeftLowerLeg: 'LeftLeg',
    LeftFoot: 'LeftFoot',
    RightUpperLeg: 'RightUpLeg',
    RightLowerLeg: 'RightLeg',
    RightFoot: 'RightFoot'
  }
  base.bones = base.bones.map((b) => ({
    name: renameMap[b.name] ?? b.name,
    parent: b.parent ? (renameMap[b.parent] ?? b.parent) : b.parent,
    head: b.head,
    tail: b.tail,
    roll: b.roll
  }))
  // Mixamo 约定：第一根 root 骨就是 Hips，把原 Root 改名成 Hips，再去掉独立的 Hips
  base.bones[0].name = 'Hips'
  base.bones[0].parent = undefined
  // 删掉之前那条被 rename 误重命名成 Hips 的「第二根 Hips」（parent=Root，现已不存在）
  base.bones = base.bones.filter((b, i) => !(i > 0 && b.name === 'Hips'))
  base.armatureName = 'mixamorig'

  // 手指：每只手 5 指，每指 2 段（命名沿用 Mixamo 风格）
  const fingerTemplates: Array<{ prefix: string; segments: number }> = [
    { prefix: 'LeftHandThumb', segments: 2 },
    { prefix: 'LeftHandIndex', segments: 2 },
    { prefix: 'LeftHandMiddle', segments: 2 },
    { prefix: 'LeftHandRing', segments: 2 },
    { prefix: 'LeftHandPinky', segments: 2 },
    { prefix: 'RightHandThumb', segments: 2 },
    { prefix: 'RightHandIndex', segments: 2 },
    { prefix: 'RightHandMiddle', segments: 2 },
    { prefix: 'RightHandRing', segments: 2 },
    { prefix: 'RightHandPinky', segments: 2 }
  ]
  for (const tpl of fingerTemplates) {
    const handName = tpl.prefix.startsWith('Left') ? 'LeftHand' : 'RightHand'
    for (let i = 1; i <= tpl.segments; i++) {
      base.bones.push({
        name: `${tpl.prefix}${i}`,
        parent: i === 1 ? handName : `${tpl.prefix}${i - 1}`,
        head: [0, 0, 0],
        tail: [0, 0, 0.03]
      })
    }
  }

  // toe 末端（Mixamo 动画里有 toe 摆动）
  base.bones.push({ name: 'LeftToeBase', parent: 'LeftFoot', head: [0, 0, 0], tail: [0, 0, 0.1] })
  base.bones.push({ name: 'RightToeBase', parent: 'RightFoot', head: [0, 0, 0], tail: [0, 0, 0.1] })
  return base
}

function topologyQuadruped(): BlenderRigTopology {
  return {
    armatureName: 'RigQuadruped',
    bones: [
      { name: 'Root', head: [0, 0, 0], tail: [0, 0.1, 0] },
      { name: 'Hips', parent: 'Root', head: [0, 1.4, 0], tail: [0, 1.5, 0] },
      { name: 'Spine', parent: 'Hips', head: [0, 1.5, 0], tail: [0, 1.7, 0] },
      { name: 'Neck', parent: 'Spine', head: [0, 1.7, 0], tail: [0, 1.85, 0] },
      { name: 'Head', parent: 'Neck', head: [0, 1.85, 0], tail: [0, 1.95, 0] },
      { name: 'Tail', parent: 'Hips', head: [0, 1.4, 0], tail: [0, 1.3, -0.4] },
      // 四条腿（前左/前右/后左/后右），对称布局
      { name: 'FL_UpperLeg', parent: 'Spine', head: [0.25, 1.65, 0.25], tail: [0.25, 1.0, 0.25] },
      {
        name: 'FL_LowerLeg',
        parent: 'FL_UpperLeg',
        head: [0.25, 1.0, 0.25],
        tail: [0.25, 0.2, 0.25]
      },
      { name: 'FR_UpperLeg', parent: 'Spine', head: [-0.25, 1.65, 0.25], tail: [-0.25, 1.0, 0.25] },
      {
        name: 'FR_LowerLeg',
        parent: 'FR_UpperLeg',
        head: [-0.25, 1.0, 0.25],
        tail: [-0.25, 0.2, 0.25]
      },
      { name: 'BL_UpperLeg', parent: 'Hips', head: [0.25, 1.4, -0.25], tail: [0.25, 0.7, -0.25] },
      {
        name: 'BL_LowerLeg',
        parent: 'BL_UpperLeg',
        head: [0.25, 0.7, -0.25],
        tail: [0.25, 0.2, -0.25]
      },
      { name: 'BR_UpperLeg', parent: 'Hips', head: [-0.25, 1.4, -0.25], tail: [-0.25, 0.7, -0.25] },
      {
        name: 'BR_LowerLeg',
        parent: 'BR_UpperLeg',
        head: [-0.25, 0.7, -0.25],
        tail: [-0.25, 0.2, -0.25]
      }
    ]
  }
}

function topologyPropRigid(): BlenderRigTopology {
  return {
    armatureName: 'RigProp',
    bones: [{ name: 'Root', head: [0, 0, 0], tail: [0, 0.1, 0] }]
  }
}

const PRESET_TOPOLOGIES: Record<BlenderRigPresetId, () => BlenderRigTopology> = {
  'humanoid-simple': topologyHumanoidSimple,
  'humanoid-mixamo': topologyHumanoidMixamo,
  quadruped: topologyQuadruped,
  'prop-rigid': topologyPropRigid
}

/** 暴露给单测与执行器使用的预设表 */
export const BLENDER_RIG_TOPOLOGY_TABLE: Readonly<
  Record<BlenderRigPresetId, Readonly<BlenderRigTopology>>
> = Object.freeze({
  'humanoid-simple': Object.freeze(topologyHumanoidSimple()),
  'humanoid-mixamo': Object.freeze(topologyHumanoidMixamo()),
  quadruped: Object.freeze(topologyQuadruped()),
  'prop-rigid': Object.freeze(topologyPropRigid())
})

// --- Python 构造 helpers ---------------------------------------------------

function pyBoneLiteral(b: BlenderBoneSpec): string {
  // 用 dict + 独立 head/tail 数组，按构造顺序记 parent index，便于脚本里按引用搭建父子链
  const head = `(${b.head[0]}, ${b.head[1]}, ${b.head[2]})`
  const tail = `(${b.tail[0]}, ${b.tail[1]}, ${b.tail[2]})`
  const roll = typeof b.roll === 'number' ? b.roll : 0
  const parent = b.parent ? JSON.stringify(b.parent) : 'None'
  return `    {"name": ${JSON.stringify(b.name)}, "parent": ${parent}, "head": ${head}, "tail": ${tail}, "roll": ${roll}}`
}

function topologyLiteral(topo: BlenderRigTopology): string {
  const boneLines = topo.bones.map((b) => pyBoneLiteral(b))
  return `[\n${boneLines.join(',\n')}\n]`
}

/**
 * 为「预设派发」路径构造 Blender Python 脚本。
 *
 * 脚本行为：
 * 1. 创建 armature，按 BONES 列表逐根 add bone（按 parent 索引搭建父子链）。
 * 2. 把当前 view_layer 里第一个 MESH 对象 parent_set 到 armature，用
 *    `ARMATURE_AUTO`（Blender 自动算顶点权重）；无 mesh 时跳过自动权重步骤。
 * 3. 读回 armature 名 + bones 数 + vertex groups 数，print RIG_RESULT + RIG_DRIVE_META。
 */
export function buildBlenderPresetRigScript(input: {
  presetId: BlenderRigPresetId
  modelName: string
}): string {
  const topo = PRESET_TOPOLOGIES[input.presetId]()
  // armatureName 用预设固定值，避免不同模型名导致 armature 互相冲突
  const armatureName = topo.armatureName
  const bonesLiteral = topologyLiteral(topo)
  return [
    `# AIAE 3D 骨骼蒙皮：预设派发（preset_id = ${JSON.stringify(input.presetId)}）`,
    'import json',
    'import bpy',
    '',
    `MODEL_NAME = ${JSON.stringify(input.modelName)}`,
    `ARMATURE_NAME = ${JSON.stringify(armatureName)}`,
    `BONES = ${bonesLiteral}`,
    '',
    '# 1. 创建 armature 数据 + 对象',
    'if ARMATURE_NAME in bpy.data.objects:',
    '    bpy.data.objects.remove(bpy.data.objects[ARMATURE_NAME], do_unlink=True)',
    'arm_data = bpy.data.armatures.new(name=ARMATURE_NAME + "_data")',
    'arm_obj = bpy.data.objects.new(ARMATURE_NAME, arm_data)',
    'bpy.context.collection.objects.link(arm_obj)',
    '',
    '# 2. 进入 edit mode 批量建 bone；parent 按 name 索引而非下标，方便按字符串查找',
    'bpy.context.view_layer.objects.active = arm_obj',
    'bpy.ops.object.mode_set(mode="EDIT")',
    'edit_bones = arm_obj.data.edit_bones',
    '_name_to_edit = {}',
    'for _spec in BONES:',
    '    _eb = edit_bones.new(name=_spec["name"])',
    '    _eb.head = _spec["head"]',
    '    _eb.tail = _spec["tail"]',
    '    _eb.roll = _spec["roll"]',
    '    _name_to_edit[_spec["name"]] = (_eb, _spec.get("parent"))',
    'for _name, (_eb, _parent) in _name_to_edit.items():',
    '    if _parent and _parent in _name_to_edit:',
    '        _eb.parent = _name_to_edit[_parent][0]',
    'bpy.ops.object.mode_set(mode="OBJECT")',
    '',
    '# 3. 自动蒙皮：把当前 view_layer 里第一个 MESH parent 到 armature；无 mesh 跳过',
    'mesh_obj = None',
    'for _o in bpy.context.view_layer.objects:',
    '    if _o.type == "MESH":',
    '        mesh_obj = _o',
    '        break',
    'if mesh_obj is not None:',
    '    mesh_obj.select_set(True)',
    '    arm_obj.select_set(True)',
    '    bpy.context.view_layer.objects.active = arm_obj',
    '    bpy.ops.object.parent_set(type="ARMATURE_AUTO")',
    '    bpy.ops.object.mode_set(mode="OBJECT")',
    '    # 清掉多选高亮，只留 armature 激活',
    '    for _o in bpy.context.view_layer.objects:',
    '        _o.select_set(False)',
    '    arm_obj.select_set(True)',
    '    bpy.context.view_layer.objects.active = arm_obj',
    '',
    '# 4. 读回 + print',
    'final_bones = list(arm_obj.data.bones.keys())',
    'final_vgs = []',
    'if mesh_obj is not None:',
    '    final_vgs = list(mesh_obj.vertex_groups.keys())',
    'result = {"armature": arm_obj.name, "bones": final_bones, "vertexGroups": final_vgs}',
    'print(' +
      JSON.stringify(BLENDER_RIG_RESULT_MARKER) +
      ' + json.dumps(result, ensure_ascii=False))',
    'meta = {"bonesMatched": len(final_bones), "vertexGroupsMatched": len(final_vgs), "armature": arm_obj.name}',
    'print(' +
      JSON.stringify(BLENDER_RIG_DRIVE_META_MARKER) +
      ' + json.dumps(meta, ensure_ascii=False))'
  ].join('\n')
}

/**
 * 预设派发的本地计算：返回期望的 armature + bone 清单（不经过 Blender）。
 * 节点图 Cook / 单测可用，不必先开 Blender。
 */
export function computePresetRigReadback(input: {
  presetId: BlenderRigPresetId
}): BlenderRigReadback {
  const topo = PRESET_TOPOLOGIES[input.presetId]()
  return {
    armature: topo.armatureName,
    bones: topo.bones.map((b) => b.name),
    vertexGroups: [], // 蒙皮权重必须 Blender 端算
    presetId: input.presetId
  }
}

// --- 策略派发 / 提示词 -----------------------------------------------------

const PRESET_INSTRUCTIONS: Record<BlenderRigPresetId, { zh: string; en: string }> = {
  'humanoid-simple': {
    zh: '人形简单骨架：根骨 + 脊柱链（髋/胸/颈/头）+ 双手臂（肩/上臂/前臂/手）+ 双腿（上腿/下腿/脚），共 21 根骨头，适合人型角色基础动画。',
    en: 'Humanoid simple rig: root + spine chain (hips/chest/neck/head) + both arms (shoulder/upper/forearm/hand) + both legs (thigh/shin/foot), 21 bones total — basic humanoid animation baseline.'
  },
  'humanoid-mixamo': {
    zh: '人形 Mixamo 兼容骨架：humanoid-simple + 双手指（每指 2~3 段）+ toe，可直接挂 Mixamo 动作库。',
    en: 'Humanoid Mixamo-compatible rig: humanoid-simple + fingers (2-3 segments each) + toes — drop-in compatible with Mixamo motion library.'
  },
  quadruped: {
    zh: '四足骨架：脊柱链 + 头/颈/尾 + 四条腿（前左/前右/后左/后后，每条上腿+下腿），适合兽类角色。',
    en: 'Quadruped rig: spine chain + head/neck/tail + four legs (FL/FR/BL/BR, each upper+lower) — for beast/creature characters.'
  },
  'prop-rigid': {
    zh: '道具单骨骨架：只有一根 Root 骨；适合静态/小幅度摆动物体（剑、门、旗杆）。',
    en: 'Prop rigid rig: a single Root bone — for static / small-swing objects (sword, door, flagpole).'
  }
}

export function matchBlenderRigPresetId(
  instruction: string,
  locale: string
): BlenderRigPresetId | null {
  const text = instruction.trim()
  if (!text) return null
  const enMode = locale.toLowerCase().startsWith('en')
  for (const [id, body] of Object.entries(PRESET_INSTRUCTIONS) as Array<
    [BlenderRigPresetId, { zh: string; en: string }]
  >) {
    if (enMode ? body.en === text : body.zh === text) return id
    if (body.zh === text || body.en === text) return id
  }
  return null
}

export function listBlenderRigPresetInstructions(locale: string): Array<{
  id: BlenderRigPresetId
  text: string
}> {
  const enMode = locale.toLowerCase().startsWith('en')
  return (Object.keys(PRESET_INSTRUCTIONS) as BlenderRigPresetId[]).map((id) => ({
    id,
    text: enMode ? PRESET_INSTRUCTIONS[id].en : PRESET_INSTRUCTIONS[id].zh
  }))
}

export interface DecideBlenderRigStrategyInput {
  instruction: string
  locale: string
  modelName: string
}

export function decideBlenderRigStrategy(input: DecideBlenderRigStrategyInput): BlenderRigDispatch {
  if (!input.instruction.trim()) {
    throw new Error('3D 骨骼指令不能为空')
  }
  const presetId = matchBlenderRigPresetId(input.instruction, input.locale)
  if (presetId) {
    return {
      strategy: 'preset',
      presetId,
      code: buildBlenderPresetRigScript({
        presetId,
        modelName: input.modelName
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

export function buildBlenderRigPrompts(input: {
  instruction: string
  locale: string
  modelName: string
}): { system: string; user: string } {
  const zh = !input.locale.toLowerCase().startsWith('en')
  const system = zh
    ? `你是 3D 角色绑骨助手。根据用户对骨架拓扑 / 蒙皮要求的描述，输出一段 Blender Python 脚本，在 Blender 进程里跑完后把结果通过 print 回给应用。

规则：
1. 输出一段**纯 Python 代码**（不要 markdown 代码栅栏、不要任何解释）。
2. 第一行必须是 \`import json\`；可以 \`import bpy\` / \`import math\`。**禁止** import bpy / bmesh / mathutils / json / math 之外的任何模块，禁止 import 别名、禁止 from-import 与通配 import。
3. 创建 armature 对象，按用户的骨骼拓扑逐根添加 bone。**parent 字段填父骨名**（同数组里的另一项的 name），根骨 parent 留 None / 省略。
4. 给当前 view_layer 里第一个 MESH 调 \`bpy.ops.object.parent_set(type="ARMATURE_AUTO")\` 让 Blender 自动算顶点权重。无 mesh 时跳过这一步。
5. 末段必须写两行 print：
   - \`print("` +
      BLENDER_RIG_RESULT_MARKER +
      `" + json.dumps({"armature": arm_obj.name, "bones": list(arm_obj.data.bones.keys()), "vertexGroups": list(mesh_obj.vertex_groups.keys())}, ensure_ascii=False))\`
   - \`print("` +
      BLENDER_RIG_DRIVE_META_MARKER +
      `" + json.dumps({"bonesMatched": N, "vertexGroupsMatched": M, "armature": arm_obj.name}, ensure_ascii=False))\`
6. 头部 + 尾部用 (x,y,z) 元组；roll 不写默认 0；bone 父子链必须无环。`
    : `You are a character rigging assistant. Output a Blender Python script that prints the rig back as JSON.

Rules:
1. Output ONLY pure Python code (no markdown fences, no explanation).
2. First line must be \`import json\`; you may \`import bpy\` / \`import math\`. Do NOT import anything other than bpy / bmesh / mathutils / json / math. No aliased imports, no from-imports, no wildcard imports.
3. Create an armature and add bones per the user's topology. \`parent\` field = parent bone name (or None for root).
4. Call \`bpy.ops.object.parent_set(type="ARMATURE_AUTO")\` on the first MESH to compute skin weights automatically; skip if no mesh is present.
5. Last two lines MUST be:
   - \`print("` +
      BLENDER_RIG_RESULT_MARKER +
      `" + json.dumps({"armature": arm_obj.name, "bones": list(arm_obj.data.bones.keys()), "vertexGroups": list(mesh_obj.vertex_groups.keys())}, ensure_ascii=False))\`
   - \`print("` +
      BLENDER_RIG_DRIVE_META_MARKER +
      `" + json.dumps({"bonesMatched": N, "vertexGroupsMatched": M, "armature": arm_obj.name}, ensure_ascii=False))\`
6. head/tail = (x,y,z) tuples; roll defaults to 0; parent chain must be acyclic.`

  const user = [
    zh ? '用户绑骨要求：' : 'User rigging request:',
    input.instruction.trim(),
    '',
    zh
      ? `当前模型名（用来命名 armature）：${input.modelName}`
      : `Current model name (used for armature naming): ${input.modelName}`,
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
      if (depth === 0) return { start, end: i }
    }
  }
  return null
}

/**
 * 解析 Blender Python 脚本里 `print("RIG_RESULT:" + json.dumps(...))` 的输出。
 * 失败抛错；不抛返回 `{armature, bones, vertexGroups, presetId}`。
 */
export function parseBlenderRigReadback(
  outcome: McpToolCallOutcome,
  presetId: BlenderRigPresetId | null
): BlenderRigReadback {
  if (outcome.error) throw new Error(outcome.error)
  const stdout = extractExecuteStdout(outcome)
  if (!stdout) throw new Error('Blender 没有返回 stdout；脚本是否跑了 print？')
  const idx = stdout.indexOf(BLENDER_RIG_RESULT_MARKER)
  if (idx < 0) {
    throw new Error(
      `Blender stdout 缺少 ${BLENDER_RIG_RESULT_MARKER} 标记（前 200 字符）：${stdout.slice(0, 200)}`
    )
  }
  const tail = stdout.slice(idx + BLENDER_RIG_RESULT_MARKER.length)
  const balanced = findFirstBalancedJsonObject(tail)
  if (!balanced) {
    throw new Error(
      `${BLENDER_RIG_RESULT_MARKER} 后找不到 JSON 对象（前 200 字符）：${tail.slice(0, 200)}`
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(tail.slice(balanced.start, balanced.end + 1))
  } catch (err) {
    throw new Error(
      `${BLENDER_RIG_RESULT_MARKER} JSON 解析失败：${err instanceof Error ? err.message : String(err)}`
    )
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${BLENDER_RIG_RESULT_MARKER} 必须是 JSON 对象`)
  }
  const obj = parsed as Record<string, unknown>
  const armature = typeof obj.armature === 'string' ? obj.armature : null
  const bonesRaw = Array.isArray(obj.bones) ? obj.bones : []
  const bones = bonesRaw.filter((b): b is string => typeof b === 'string')
  const vgRaw = Array.isArray(obj.vertexGroups) ? obj.vertexGroups : []
  const vertexGroups = vgRaw.filter((v): v is string => typeof v === 'string')
  if (!armature || !bones.length) {
    throw new Error(`${BLENDER_RIG_RESULT_MARKER} 里没有 armature / bones`)
  }
  return { armature, bones, vertexGroups, presetId }
}

export function parseBlenderDriveRigMeta(outcome: McpToolCallOutcome): BlenderDriveRigMeta | null {
  if (outcome.error) return null
  const stdout = extractExecuteStdout(outcome)
  if (!stdout) return null
  const idx = stdout.indexOf(BLENDER_RIG_DRIVE_META_MARKER)
  if (idx < 0) return null
  const tail = stdout.slice(idx + BLENDER_RIG_DRIVE_META_MARKER.length)
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
  return {
    bonesMatched: Number.isFinite(obj.bonesMatched) ? Number(obj.bonesMatched) : 0,
    vertexGroupsMatched: Number.isFinite(obj.vertexGroupsMatched)
      ? Number(obj.vertexGroupsMatched)
      : 0,
    armature: typeof obj.armature === 'string' ? obj.armature : null
  }
}

// --- Node 端等价执行（用于单测与离线回放）---------------------------------

/** Node 端纯执行预设派发脚本；返回与 `parseBlenderRigReadback` 等价的 readback */
export function executeBlenderPresetRigPure(input: {
  presetId: BlenderRigPresetId
}): BlenderRigReadback {
  return computePresetRigReadback(input)
}

// --- Agent loop（LLM 多轮 chat + Blender MCP 当 tool）---------------------

/**
 * 骨骼蒙皮 agent 的默认最大轮数。
 *
 * 设计取向：
 * - agent 的目标是"Blender 端真创建 armature + bones + 自动权重"，让 LLM 多轮
 *   改 Python 直到 readback 完整。早期给 5 轮曾把许多合法拓扑拦在外面。
 * - 现在放宽到 50 轮作为绝对兜底；同时靠 `BLENDER_RIG_AGENT_STUCK_THRESHOLD`
 *   检测"连续 N 次 Blender 回传相同 readback"——这是 agent 在原地踏步的强信号，
 *   立刻终止并报 `stuck` reason，让上层把它归到用户可读错误。
 * - **不要**把默认轮数改回 5，否则常见的"先试一个脚本、再调一下 vertex groups
 *   命名、再加 Mixamo 手指、再调回 parent 链"这种 5–10 轮正常路径会被截断。
 */
export const BLENDER_RIG_AGENT_DEFAULT_MAX_TURNS = 50

/** 连续相同 readback 指纹次数阈值；到阈值判定 agent 卡死、强制退出 */
export const BLENDER_RIG_AGENT_STUCK_THRESHOLD = 3

export const BLENDER_RIG_AGENT_TOOLS: ReadonlyArray<{
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
      name: 'try_blender_rig',
      description:
        '在 Blender 里执行一段 Python 脚本，**真正创建** armature + bones 并尝试自动蒙皮。\n' +
        '参数 python_code 必须是完整脚本，**严格按下面模板**只填 BONES 列表与 ARMATURE_NAME（其余驱动代码不要改）：\n\n' +
        '```python\n' +
        'import json\n' +
        'import bpy\n' +
        '\n' +
        'ARMATURE_NAME = "..."\n' +
        'BONES = [\n' +
        '    {"name": "Root", "parent": None, "head": (0,0,0), "tail": (0,0.1,0), "roll": 0},\n' +
        '    {"name": "Hips", "parent": "Root", "head": (0,1.0,0), "tail": (0,1.1,0), "roll": 0},\n' +
        '    # ...更多 bone；parent 指向同数组里的 name 字段\n' +
        ']\n' +
        '\n' +
        'if ARMATURE_NAME in bpy.data.objects:\n' +
        '    bpy.data.objects.remove(bpy.data.objects[ARMATURE_NAME], do_unlink=True)\n' +
        'arm_data = bpy.data.armatures.new(name=ARMATURE_NAME + "_data")\n' +
        'arm_obj = bpy.data.objects.new(ARMATURE_NAME, arm_data)\n' +
        'bpy.context.collection.objects.link(arm_obj)\n' +
        'bpy.context.view_layer.objects.active = arm_obj\n' +
        'bpy.ops.object.mode_set(mode="EDIT")\n' +
        '_name_to_edit = {}\n' +
        'for _spec in BONES:\n' +
        '    _eb = arm_obj.data.edit_bones.new(name=_spec["name"])\n' +
        '    _eb.head = _spec["head"]; _eb.tail = _spec["tail"]; _eb.roll = _spec["roll"]\n' +
        '    _name_to_edit[_spec["name"]] = (_eb, _spec.get("parent"))\n' +
        'for _name, (_eb, _parent) in _name_to_edit.items():\n' +
        '    if _parent and _parent in _name_to_edit:\n' +
        '        _eb.parent = _name_to_edit[_parent][0]\n' +
        'bpy.ops.object.mode_set(mode="OBJECT")\n' +
        '\n' +
        'mesh_obj = next((o for o in bpy.context.view_layer.objects if o.type == "MESH"), None)\n' +
        'if mesh_obj is not None:\n' +
        '    for o in bpy.context.view_layer.objects: o.select_set(False)\n' +
        '    mesh_obj.select_set(True); arm_obj.select_set(True)\n' +
        '    bpy.context.view_layer.objects.active = arm_obj\n' +
        '    bpy.ops.object.parent_set(type="ARMATURE_AUTO")\n' +
        '    for o in bpy.context.view_layer.objects: o.select_set(False)\n' +
        '    arm_obj.select_set(True)\n' +
        '    bpy.context.view_layer.objects.active = arm_obj\n' +
        '\n' +
        'final_bones = list(arm_obj.data.bones.keys())\n' +
        'final_vgs = list(mesh_obj.vertex_groups.keys()) if mesh_obj else []\n' +
        'print("' +
        BLENDER_RIG_RESULT_MARKER +
        '" + json.dumps({"armature": arm_obj.name, "bones": final_bones, "vertexGroups": final_vgs}, ensure_ascii=False))\n' +
        'print("' +
        BLENDER_RIG_DRIVE_META_MARKER +
        '" + json.dumps({"bonesMatched": len(final_bones), "vertexGroupsMatched": len(final_vgs), "armature": arm_obj.name}, ensure_ascii=False))\n' +
        '```\n\n' +
        '返回值是 JSON：成功时 {ok:true, readback:{armature, bones, vertexGroups}, meta:{bonesMatched, vertexGroupsMatched, armature}}；' +
        '失败时 {ok:false, error}（marker 缺失 / JSON 畸形 / 空 armature 等）。',
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
      name: 'finalize_rig',
      description:
        '确认采用本轮 RIG_RESULT：把上一轮 try_blender_rig 返回的 readback 应用到节点图（作为模型资产附带的 rigMeta）。' +
        '只能在拿到的 readback 看起来合理时调用；不再调整就调一次并结束。',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['replace', 'merge'],
            description: 'replace=整图替换，merge=与现有 rigMeta 合并（默认 replace）'
          }
        }
      }
    }
  }
]

export type BlenderRigAgentEvent =
  | { kind: 'turn'; turn: number; text?: string; toolNames: string[] }
  | {
      kind: 'tool'
      name: 'try_blender_rig'
      bonesMatched: number
      vertexGroupsMatched: number
      armature?: string | null
      error?: string
    }
  | { kind: 'finalize'; bonesMatched: number; vertexGroupsMatched: number }
  | { kind: 'stuck'; identicalStreak: number }
  | { kind: 'done'; reason: 'finalized' | 'no_finalize' | 'max_turns' | 'stuck' }
  | { kind: 'error'; message: string }

export interface RunBlenderRigAgentDeps {
  modelClient: (input: {
    system: string
    messages: ReadonlyArray<BlenderRigAgentMessage>
    tools: typeof BLENDER_RIG_AGENT_TOOLS
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
    readback: BlenderRigReadback
    meta?: BlenderDriveRigMeta | null
  }>
  applyToRenderer: (readback: BlenderRigReadback) => {
    bonesMatched: number
    vertexGroupsMatched: number
  }
  onEvent?: (event: BlenderRigAgentEvent) => void
}

export type BlenderRigAgentMessage =
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

export interface RunBlenderRigAgentInput {
  instruction: string
  locale: string
  modelName: string
  maxTurns?: number
}

export interface RunBlenderRigAgentResult {
  ok: boolean
  reason: 'finalized' | 'no_finalize' | 'max_turns' | 'stuck' | 'error'
  readback: BlenderRigReadback
  turns: number
}

function buildBlenderRigAgentSystem(input: RunBlenderRigAgentInput): string {
  const base = buildBlenderRigPrompts(input)
  const zh = !input.locale.toLowerCase().startsWith('en')
  const tail = zh
    ? `
多轮工作流（必须遵守）：
1. 先调 \`try_blender_rig\` 工具，把你写的 Python 代码送进 Blender 跑。**Python 必须按工具描述里的模板**——先创建 armature、按 BONES 列表 add bone、给 mesh 调 parent_set(type='ARMATURE_AUTO')，最后分别 print \`${BLENDER_RIG_RESULT_MARKER}\` 与 \`${BLENDER_RIG_DRIVE_META_MARKER}\` 两行。
2. 工具会回 JSON：
   - \`{ok:true, readback:{armature, bones, vertexGroups}, meta:{bonesMatched, vertexGroupsMatched, armature}}\`：Blender 端真驱动后的命中/缺失明细；
   - \`{ok:false, error}\`：错误信息（marker 缺失 / JSON 畸形 / 空 armature 等）。
3. **目标是 Blender 端真创建完整拓扑**：BONES 列表里每根骨都要在 \`bones\` 里出现、且 mesh 的 vertex groups 不为空。不要预期输出 round 一次就过——通常需要 5–15 轮来回调整 Python（参数、命名、parent 链、ARMATURE_AUTO 触发方式、mode 切换）。**每一轮都根据 Blender 回传的 readback 决定下一步**，直到 bones 与 vertex groups 都对齐你的预期。
4. 拿到满意的 readback 后，调 \`finalize_rig\` 一次把它落到节点图（这会结束循环）。**不要**在 readback 仍有缺失时就 finalize。
5. **连续多轮 Blender 回传的 readback 完全一样**（同样的 armature 名、同样的 bones 列表、同样的 vertex groups），说明你在原地踏步——这时候请**重新审视 BONES 列表的拓扑 / 命名 / parent 链**，而不是再发一版近似的脚本。系统会在这种连续无进展达到上限时强制终止。
6. 不要再返回纯文本以外的解释——所有决策都通过 tool。`
    : `
Multi-turn workflow (mandatory):
1. Call \`try_blender_rig\` with your Python script. **The script MUST follow the template** — create armature, add bones per BONES list, parent_set(type='ARMATURE_AUTO') on mesh, then print both \`${BLENDER_RIG_RESULT_MARKER}\` and \`${BLENDER_RIG_DRIVE_META_MARKER}\`.
2. The tool returns JSON:
   - \`{ok:true, readback, meta}\`: what Blender actually created
   - \`{ok:false, error}\`: missing marker / malformed JSON / empty armature
3. **Goal is a complete rig in Blender**: every bone in your BONES list must appear in \`bones\`, and the mesh must have non-empty vertex groups. Don't expect success on the first try — typical topologies take 5–15 iterations to converge (parameters, naming, parent chain, ARMATURE_AUTO triggers, mode switches). **Each turn must react to Blender's readback.**
4. When the readback matches your expectation, call \`finalize_rig\` once (this ends the loop). **Do not** finalize while bones / vertex groups are still incomplete.
5. **If Blender keeps returning the exact same readback across turns**, you are spinning in place. Re-think the topology / naming / parent chain rather than resending a near-identical script. The system will force-terminate after a fixed streak of identical readbacks.
6. Do not output anything other than tool calls.`
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

export async function runBlenderRigAgent(
  input: RunBlenderRigAgentInput,
  deps: RunBlenderRigAgentDeps
): Promise<RunBlenderRigAgentResult> {
  const maxTurns = Math.max(1, input.maxTurns ?? BLENDER_RIG_AGENT_DEFAULT_MAX_TURNS)
  const system = buildBlenderRigAgentSystem(input)
  const prompts = buildBlenderRigPrompts(input)
  const messages: BlenderRigAgentMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: prompts.user }
  ]

  let lastReadback: BlenderRigReadback = {
    armature: null,
    bones: [],
    vertexGroups: [],
    presetId: null
  }
  let finalized = false
  /**
   * 卡死检测：每次成功 Blender 跑后，比较本次 readback 与上一次的"指纹"。
   * 指纹 = armature 名 + bones 列表 + vertex groups 列表。
   * 连续相同指纹达到 BLENDER_RIG_AGENT_STUCK_THRESHOLD 次说明 agent 在原地踏步，
   * 直接终止并报 `stuck`，让上层把 reason 转译成用户可见错误。
   *
   * `lastReadbackFingerprint` 与 `identicalStreak` 只在成功 try_blender_rig 后更新，
   * 失败（抛错）时不清零也不递增——下一次成功又从头数，避免把"一直在尝试新方案"
   * 误判成"卡死"。
   */
  let lastReadbackFingerprint: string | null = null
  let identicalStreak = 0

  function buildResult(
    ok: boolean,
    reason: RunBlenderRigAgentResult['reason'],
    turns: number
  ): RunBlenderRigAgentResult {
    return { ok, reason, readback: lastReadback, turns }
  }

  for (let turn = 0; turn < maxTurns; turn++) {
    let result: Awaited<ReturnType<RunBlenderRigAgentDeps['modelClient']>>
    try {
      result = await deps.modelClient({ system, messages, tools: BLENDER_RIG_AGENT_TOOLS })
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
      if (call.function.name === 'try_blender_rig') {
        const code = typeof args.python_code === 'string' ? args.python_code : ''
        if (!code.trim()) {
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ ok: false, error: 'python_code 不能为空' })
          })
          deps.onEvent?.({
            kind: 'tool',
            name: 'try_blender_rig',
            bonesMatched: 0,
            vertexGroupsMatched: 0,
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
            name: 'try_blender_rig',
            bonesMatched: outcome.meta?.bonesMatched ?? outcome.readback.bones.length,
            vertexGroupsMatched:
              outcome.meta?.vertexGroupsMatched ?? outcome.readback.vertexGroups.length,
            armature: outcome.readback.armature
          })
          // 卡死检测：本次 readback 与上一次指纹一致就 +1，否则归 1。
          const fingerprint = `${lastReadback.armature ?? ''}|${lastReadback.bones.join(
            ','
          )}|${lastReadback.vertexGroups.join(',')}`
          if (fingerprint === lastReadbackFingerprint) {
            identicalStreak += 1
          } else {
            identicalStreak = 1
            lastReadbackFingerprint = fingerprint
          }
          if (identicalStreak >= BLENDER_RIG_AGENT_STUCK_THRESHOLD) {
            deps.onEvent?.({ kind: 'stuck', identicalStreak })
            return buildResult(false, 'stuck', turn + 1)
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ ok: false, error: message })
          })
          deps.onEvent?.({
            kind: 'tool',
            name: 'try_blender_rig',
            bonesMatched: 0,
            vertexGroupsMatched: 0,
            error: message
          })
        }
      } else if (call.function.name === 'finalize_rig') {
        const result2 = deps.applyToRenderer(lastReadback)
        finalized = true
        deps.onEvent?.({
          kind: 'finalize',
          bonesMatched: result2.bonesMatched,
          vertexGroupsMatched: result2.vertexGroupsMatched
        })
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({
            ok: true,
            mode: args.mode === 'merge' ? 'merge' : 'replace',
            bonesMatched: result2.bonesMatched,
            vertexGroupsMatched: result2.vertexGroupsMatched
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
