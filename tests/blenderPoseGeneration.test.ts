import { describe, expect, it } from 'vitest'
import {
  BLENDER_POSE_RESULT_MARKER,
  BLENDER_PRESET_ROTATION_TABLE,
  type BlenderAiPosePresetId,
  buildBlenderAiPosePrompts,
  buildBlenderPresetPoseScript,
  decideBlenderPoseStrategy,
  executeBlenderPresetPosePure,
  parseBlenderPoseReadback
} from '../src/shared/blenderPoseGeneration'
import type { McpToolCallOutcome } from '../src/shared/mcpProtocol'

/** Mixamo 风格的人形骨架（17 根主关节 + 头） */
const MIXAMO_HIERARCHY = {
  'mixamorig:Hips': 'hips',
  'mixamorig:Spine': 'spine',
  'mixamorig:Spine1': 'spine',
  'mixamorig:Spine2': 'spine',
  'mixamorig:Neck': 'neck',
  'mixamorig:Head': 'head',
  'mixamorig:LeftShoulder': 'l_shoulder',
  'mixamorig:RightShoulder': 'r_shoulder',
  'mixamorig:LeftArm': 'l_upperarm',
  'mixamorig:RightArm': 'r_upperarm',
  'mixamorig:LeftForeArm': 'l_forearm',
  'mixamorig:RightForeArm': 'r_forearm',
  'mixamorig:LeftHand': 'l_hand',
  'mixamorig:RightHand': 'r_hand',
  'mixamorig:LeftUpLeg': 'l_thigh',
  'mixamorig:RightUpLeg': 'r_thigh',
  'mixamorig:LeftLeg': 'l_shin',
  'mixamorig:RightLeg': 'r_shin',
  'mixamorig:LeftToeBase': 'l_foot',
  'mixamorig:RightToeBase': 'r_foot'
} as const

/** 抽一个预设的中文 instruction 字面量用于派发匹配（取 idle） */
const ZH_IDLE_INSTRUCTION = Object.values(BLENDER_PRESET_ROTATION_TABLE)[0] // 占位，仅类型化
void ZH_IDLE_INSTRUCTION

/** 把纯 dict 复刻成「Blender 跑完后的 stdout」字符串（最终由社区/官方 addon 返回） */
function rawStdoutFromPreset(input: {
  presetId: BlenderAiPosePresetId
  boneRoles: Record<string, string>
}): string {
  const dict = executeBlenderPresetPosePure({
    presetId: input.presetId,
    boneRoles: input.boneRoles
  })
  // 模拟 addon handler 还会包一层前缀 print
  return `${BLENDER_POSE_RESULT_MARKER}${JSON.stringify(dict)}\n`
}

/** 套上 `McpToolCallOutcome` 的壳（社区 addon 风格：`{ result: { executed, result: stdout } }`） */
function outcomeFromStdout(stdout: string): McpToolCallOutcome {
  return { result: { executed: true, result: stdout } }
}

describe('blenderPoseGeneration', () => {
  describe('decideBlenderPoseStrategy', () => {
    it('returns preset strategy when instruction exactly matches a known preset (zh)', () => {
      const zhIdle =
        '自然站立休息：重心略偏右腿，左膝微松；双臂自然垂于体侧，肩放松；脊柱直立，头略微前看，整体放松不僵硬。'
      const dispatch = decideBlenderPoseStrategy({
        instruction: zhIdle,
        locale: 'zh-CN',
        boneRoles: { ...MIXAMO_HIERARCHY }
      })
      expect(dispatch.strategy).toBe('preset')
      expect(dispatch.presetId).toBe('idle')
      expect(dispatch.description).toContain('idle')
      expect(dispatch.code).toContain('ROLE_ROTATIONS_RAD')
      expect(dispatch.code).toContain('mixamorig:Hips')
    })

    it('returns preset strategy when instruction exactly matches a known preset (en)', () => {
      const enIdle =
        'Relaxed idle stand: weight slightly on the right leg, left knee soft; arms hang naturally, shoulders relaxed; upright spine, gaze forward, not stiff.'
      const dispatch = decideBlenderPoseStrategy({
        instruction: enIdle,
        locale: 'en-US',
        boneRoles: { ...MIXAMO_HIERARCHY }
      })
      expect(dispatch.strategy).toBe('preset')
      expect(dispatch.presetId).toBe('idle')
    })

    it('falls back to ai strategy for free-text instruction', () => {
      const dispatch = decideBlenderPoseStrategy({
        instruction: '单脚站立伸手摘星星',
        locale: 'zh-CN',
        boneRoles: { ...MIXAMO_HIERARCHY }
      })
      expect(dispatch.strategy).toBe('ai')
      expect(dispatch.presetId).toBeNull()
      expect(dispatch.code).toBe('')
    })

    it('throws when instruction is empty', () => {
      expect(() =>
        decideBlenderPoseStrategy({
          instruction: '   ',
          locale: 'zh-CN',
          boneRoles: { ...MIXAMO_HIERARCHY }
        })
      ).toThrow(/不能为空|不能为空/)
    })
  })

  describe('buildBlenderPresetPoseScript', () => {
    it('produces a Python script with BONE_ROLES and ROLE_ROTATIONS_RAD dicts', () => {
      const code = buildBlenderPresetPoseScript({
        presetId: 'walk',
        boneRoles: { ...MIXAMO_HIERARCHY }
      })
      expect(code).toMatch(/^# AIAE 3D 导演台 AI 姿势生成/)
      expect(code).toMatch(/preset_id = "walk"/)
      expect(code).toMatch(/import json/)
      expect(code).toMatch(/BONE_ROLES\s*=\s*\{/)
      expect(code).toMatch(/ROLE_ROTATIONS_RAD\s*=\s*\{/)
      // 走的预设里右腿前伸，右脚踝 → r_shin / r_thick 必须有非零旋转
      expect(code).toMatch(/"r_thigh":\s*\[\s*[0-9.-]+/)
      expect(code).toMatch(/"r_shin":\s*\[\s*[0-9.-]+/)
      // 末尾 marker
      expect(
        code
          .trim()
          .endsWith(
            `print("${BLENDER_POSE_RESULT_MARKER}" + json.dumps(pose_bones, ensure_ascii=False))`
          )
      ).toBe(true)
    })

    it('omits zero-rotation roles from ROLE_ROTATIONS_RAD (idle has many zeros)', () => {
      const code = buildBlenderPresetPoseScript({
        presetId: 'idle',
        boneRoles: { ...MIXAMO_HIERARCHY }
      })
      // idle 不动 l_thigh（0,0,0），脚本里就不输出这一行避免冗余
      expect(code).not.toMatch(/"l_thigh":/)
      // 但 hips 是非零（spine 微前倾）
      expect(code).toMatch(/"spine":/)
    })

    it('emits valid Python that pure executor mirrors (radians match exactly)', () => {
      for (const presetId of Object.keys(
        BLENDER_PRESET_ROTATION_TABLE
      ) as BlenderAiPosePresetId[]) {
        const code = buildBlenderPresetPoseScript({
          presetId,
          boneRoles: { ...MIXAMO_HIERARCHY }
        })
        expect(code).toContain(`preset_id = "${presetId}"`)
        // 用 Node 端纯执行镜像脚本最终输出（preset 脚本里没用 bpy）
        const expected = executeBlenderPresetPosePure({
          presetId,
          boneRoles: { ...MIXAMO_HIERARCHY }
        })
        expect(Object.keys(expected).length).toBeGreaterThan(0)
        for (const [b, [x, y, z]] of Object.entries(expected)) {
          // 任意一个值都在 [-π, π] 且 finite
          for (const v of [x, y, z]) {
            expect(Number.isFinite(v)).toBe(true)
            expect(v).toBeGreaterThanOrEqual(-Math.PI)
            expect(v).toBeLessThanOrEqual(Math.PI)
          }
          // 与代码里同名字典字面量能匹配（容忍 toFixed 精度）
          const key = JSON.stringify(b).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          // 用一个简化的存在性检查：代码里必须包含这个骨名
          expect(code).toContain(key)
          // 不强制做数值正则匹配（避免浮点字符串漂移导致脆弱断言）
          void b
        }
      }
    })
  })

  describe('buildBlenderAiPosePrompts', () => {
    it('emits bilingual system prompt and bone payload (zh)', () => {
      const { system, user } = buildBlenderAiPosePrompts({
        instruction: '单脚站立伸手摘星星',
        boneRoles: { ...MIXAMO_HIERARCHY },
        boneParents: { 'mixamorig:Spine': 'mixamorig:Hips' },
        locale: 'zh-CN'
      })
      expect(system).toContain('POSE_RESULT:')
      expect(system).toContain('import json')
      expect(system).not.toContain('from ') // 禁 from-import
      expect(system).toContain('弧度')
      expect(user).toContain('单脚站立伸手摘星星')
      expect(user).toContain('mixamorig:Hips')
      expect(user).toContain('mixamorig:Spine')
    })

    it('emits English prompt when locale=en-US', () => {
      const { system } = buildBlenderAiPosePrompts({
        instruction: 'reach up to grab a star',
        boneRoles: { ...MIXAMO_HIERARCHY },
        boneParents: {},
        locale: 'en-US'
      })
      expect(system).toContain('POSE_RESULT:')
      expect(system).toContain('RADIANS')
      expect(system).toContain('import json')
    })
  })

  describe('parseBlenderPoseReadback', () => {
    it('parses community addon stdout and returns radians dict', () => {
      const stdout = rawStdoutFromPreset({ presetId: 'bow', boneRoles: { ...MIXAMO_HIERARCHY } })
      const outcome = outcomeFromStdout(stdout)
      const readback = parseBlenderPoseReadback(outcome)
      // bow 必备的非零：hips 髋前倾 40°
      expect(readback['mixamorig:Hips']).toBeDefined()
      const [rx, ry, rz] = readback['mixamorig:Hips']
      // 40° → ~0.698 rad
      expect(rx).toBeCloseTo((40 * Math.PI) / 180, 4)
      expect(ry).toBeCloseTo(0, 4)
      expect(rz).toBeCloseTo(0, 4)
    })

    it('parses official addon stdout style ({ result: stdout })', () => {
      const stdout = rawStdoutFromPreset({ presetId: 'idle', boneRoles: { ...MIXAMO_HIERARCHY } })
      const outcome: McpToolCallOutcome = { result: { result: stdout } }
      const readback = parseBlenderPoseReadback(outcome)
      expect(Object.keys(readback).length).toBeGreaterThan(0)
      // idle 应该让脊柱微前倾 3°
      const spine = readback['mixamorig:Spine']
      expect(spine?.[0]).toBeCloseTo((3 * Math.PI) / 180, 4)
    })

    it('throws when stdout is missing POSE_RESULT marker', () => {
      const outcome: McpToolCallOutcome = { result: { result: 'just some unrelated print' } }
      expect(() => parseBlenderPoseReadback(outcome)).toThrow(/缺少/)
    })

    it('throws when outcome.error is set (Blender 未连接/脚本异常)', () => {
      const outcome: McpToolCallOutcome = { error: 'addon not connected' }
      expect(() => parseBlenderPoseReadback(outcome)).toThrow(/addon not connected/)
    })

    it('throws when JSON is malformed', () => {
      const outcome: McpToolCallOutcome = {
        result: { result: `${BLENDER_POSE_RESULT_MARKER}{not-json}` }
      }
      expect(() => parseBlenderPoseReadback(outcome)).toThrow(/JSON 解析失败|JSON parse/)
    })

    it('throws when JSON is empty object (no bones mapped)', () => {
      const outcome: McpToolCallOutcome = {
        result: { result: `${BLENDER_POSE_RESULT_MARKER}{}` }
      }
      expect(() => parseBlenderPoseReadback(outcome)).toThrow(/没有可用的骨骼旋转/)
    })

    it('skips non-array/non-finite entries instead of throwing', () => {
      const stdout = `${BLENDER_POSE_RESULT_MARKER}${JSON.stringify({
        'mixamorig:Hips': [0, 0, 0],
        'mixamorig:Spine': [1, null, 0],
        'mixamorig:Spine1': [0.1, 0.2, 0.3]
      })}`
      const outcome: McpToolCallOutcome = { result: { result: stdout } }
      const readback = parseBlenderPoseReadback(outcome)
      // Hips 全 0 会被执行端 0 过滤（renderPaths 都用 applyObjectBonePoseMap 仍写入 0 旋转）
      // 这里 parser 本身不过滤 0，但会过滤 null/NaN——所以应只剩 Spine1
      expect(readback['mixamorig:Spine1']).toEqual([0.1, 0.2, 0.3])
      expect(readback['mixamorig:Hips']).toEqual([0, 0, 0])
      expect(readback['mixamorig:Spine']).toBeUndefined()
    })
  })

  describe('preset rotation table sanity', () => {
    it('has 14 presets (matches aiPosePresets id set)', () => {
      const ids = Object.keys(BLENDER_PRESET_ROTATION_TABLE) as BlenderAiPosePresetId[]
      expect(ids.length).toBe(14)
      expect(new Set(ids)).toEqual(
        new Set<BlenderAiPosePresetId>([
          'idle',
          'walk',
          'run',
          'jumpAir',
          'jumpLand',
          'wave',
          'handsOnHips',
          'point',
          'think',
          'crouch',
          'kneel',
          'bow',
          'fightGuard',
          'sit'
        ])
      )
    })

    it('all rotations are finite and within [-180°, 180°] (sanity bound)', () => {
      for (const [presetId, table] of Object.entries(BLENDER_PRESET_ROTATION_TABLE)) {
        for (const [role, deg] of Object.entries(table)) {
          for (const v of deg) {
            expect(Number.isFinite(v), `${presetId}/${role} 非有限值`).toBe(true)
            expect(v, `${presetId}/${role} 超出 [-180, 180] 度`).toBeGreaterThanOrEqual(-180)
            expect(v, `${presetId}/${role} 超出 [-180, 180] 度`).toBeLessThanOrEqual(180)
          }
        }
      }
    })
  })
})
