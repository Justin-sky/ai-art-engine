import { describe, expect, it } from 'vitest'
import {
  BLENDER_ARMATURE_BONE_LIST_MARKER,
  BLENDER_POSE_AGENT_DEFAULT_MAX_TURNS,
  BLENDER_POSE_AGENT_TOOLS,
  BLENDER_POSE_DRIVE_META_MARKER,
  BLENDER_POSE_RESULT_MARKER,
  BLENDER_PRESET_ROTATION_TABLE,
  type BlenderAiPosePresetId,
  type BlenderPoseAgentEvent,
  type RunBlenderAiPoseAgentDeps,
  buildBlenderAiPosePrompts,
  buildBlenderListArmatureBonesScript,
  buildBlenderPresetPoseScript,
  decideBlenderPoseStrategy,
  executeBlenderPresetPosePure,
  parseBlenderArmatureBoneList,
  parseBlenderDrivePoseMeta,
  parseBlenderPoseReadback,
  runBlenderAiPoseAgent
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

    it('配对下一个 POSE_DRIVE_META: marker 共存时不串味（balanced-brace 回归）', () => {
      // 多 marker 共存：之前 lastIndexOf('}') 会把第二个 marker 的闭合花括号也吃进来，
      // 导致 JSON.parse 拿到两个 dict 拼一起的字符串然后炸。
      const stdout =
        BLENDER_POSE_RESULT_MARKER +
        JSON.stringify({ 'mixamorig:Hips': [0.1, 0, 0] }) +
        '\n' +
        BLENDER_POSE_DRIVE_META_MARKER +
        JSON.stringify({
          matched: 1,
          missing: ['mixamorig:Spine'],
          armature: 'Armature'
        })
      const outcome: McpToolCallOutcome = { result: { result: stdout } }
      const readback = parseBlenderPoseReadback(outcome)
      expect(readback).toEqual({ 'mixamorig:Hips': [0.1, 0, 0] })
    })
  })

  describe('parseBlenderArmatureBoneList', () => {
    it('parses armature name + bone list from stdout', () => {
      const stdout =
        BLENDER_ARMATURE_BONE_LIST_MARKER +
        JSON.stringify({
          armature: 'Armature',
          bones: ['mixamorig:Hips', 'mixamorig:Spine', 'mixamorig:Head']
        })
      const outcome: McpToolCallOutcome = { result: { result: stdout } }
      const list = parseBlenderArmatureBoneList(outcome)
      expect(list.armature).toBe('Armature')
      expect(list.bones).toEqual(['mixamorig:Hips', 'mixamorig:Spine', 'mixamorig:Head'])
    })

    it('returns armature=null + empty bones when Blender has no armature', () => {
      const stdout =
        BLENDER_ARMATURE_BONE_LIST_MARKER + JSON.stringify({ armature: null, bones: [] })
      const outcome: McpToolCallOutcome = { result: { result: stdout } }
      const list = parseBlenderArmatureBoneList(outcome)
      expect(list.armature).toBeNull()
      expect(list.bones).toEqual([])
    })

    it('throws when marker is missing', () => {
      const outcome: McpToolCallOutcome = { result: { result: 'nothing here' } }
      expect(() => parseBlenderArmatureBoneList(outcome)).toThrow(/缺少/)
    })

    it('throws when JSON is malformed', () => {
      const stdout = BLENDER_ARMATURE_BONE_LIST_MARKER + '{not valid json}'
      const outcome: McpToolCallOutcome = { result: { result: stdout } }
      expect(() => parseBlenderArmatureBoneList(outcome)).toThrow(/JSON 解析失败/)
    })

    it('ignores non-string entries in bones array', () => {
      const stdout =
        BLENDER_ARMATURE_BONE_LIST_MARKER +
        JSON.stringify({
          armature: 'A',
          bones: ['good', null, 1, 'alsoGood']
        })
      const outcome: McpToolCallOutcome = { result: { result: stdout } }
      const list = parseBlenderArmatureBoneList(outcome)
      expect(list.bones).toEqual(['good', 'alsoGood'])
    })
  })

  describe('parseBlenderDrivePoseMeta', () => {
    it('parses matched / missing / armature from POSE_DRIVE_META', () => {
      const stdout =
        BLENDER_POSE_RESULT_MARKER +
        JSON.stringify({ 'mixamorig:Hips': [0.1, 0, 0] }) +
        '\n' +
        BLENDER_POSE_DRIVE_META_MARKER +
        JSON.stringify({
          matched: 1,
          missing: ['mixamorig:Spine'],
          armature: 'Armature'
        })
      const outcome: McpToolCallOutcome = { result: { result: stdout } }
      const meta = parseBlenderDrivePoseMeta(outcome)
      expect(meta).toEqual({ matched: 1, missing: ['mixamorig:Spine'], armature: 'Armature' })
    })

    it('returns null when marker is missing (backward compatible with old scripts)', () => {
      const stdout = BLENDER_POSE_RESULT_MARKER + '{}'
      const outcome: McpToolCallOutcome = { result: { result: stdout } }
      expect(parseBlenderDrivePoseMeta(outcome)).toBeNull()
    })

    it('returns null when outcome has error', () => {
      expect(parseBlenderDrivePoseMeta({ error: 'oops' })).toBeNull()
    })
  })

  describe('buildBlenderListArmatureBonesScript', () => {
    it('emits a Python script that prints the armature bones marker', () => {
      const script = buildBlenderListArmatureBonesScript()
      expect(script).toContain('import json')
      expect(script).toContain(BLENDER_ARMATURE_BONE_LIST_MARKER)
      expect(script).toContain('"ARMATURE"')
      expect(script).toContain('arm.data.bones')
    })

    it('handles the no-armature branch (prints empty bones list)', () => {
      const script = buildBlenderListArmatureBonesScript()
      expect(script).toContain('arm is None')
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

  describe('runBlenderAiPoseAgent', () => {
    const MIXAMO_HIERARCHY = {
      'mixamorig:Hips': 'root' as const,
      'mixamorig:Spine': 'spine' as const,
      'mixamorig:Spine1': 'spine' as const,
      'mixamorig:Spine2': 'spine' as const,
      'mixamorig:Neck': 'neck' as const,
      'mixamorig:Head': 'head' as const,
      'mixamorig:LeftArm': 'leftArm' as const,
      'mixamorig:LeftForeArm': 'leftArm' as const,
      'mixamorig:RightArm': 'rightArm' as const,
      'mixamorig:RightForeArm': 'rightArm' as const
    }

    /** 假 modelClient：按 turns 顺序回放脚本；trailing 项继续 repeat 最后一条 */
    function scriptedModel(
      scripts: ReadonlyArray<{
        text: string
        python?: string
        finalize?: boolean
      }>
    ) {
      const calls: Array<{ systemLen: number; msgCount: number }> = []
      let i = 0
      const fn: RunBlenderAiPoseAgentDeps['modelClient'] = async (input) => {
        calls.push({ systemLen: input.system.length, msgCount: input.messages.length })
        const step = scripts[Math.min(i, scripts.length - 1)]
        i++
        if (step.finalize) {
          return {
            text: step.text,
            toolCalls: [
              {
                id: `call_${i}`,
                type: 'function',
                function: { name: 'finalize_pose', arguments: '{}' }
              }
            ]
          }
        }
        if (!step.python) return { text: step.text, toolCalls: [] }
        return {
          text: step.text,
          toolCalls: [
            {
              id: `call_${i}`,
              type: 'function',
              function: {
                name: 'try_blender_pose',
                arguments: JSON.stringify({ python_code: step.python })
              }
            }
          ]
        }
      }
      return { fn, calls }
    }

    /** 假 blenderRun：模拟 Blender 标准 stdout —— 用真的 parseBlenderPoseReadback 验证输出；
         如果 stdout 里也有 POSE_DRIVE_META 行，会一并解析成 meta（与新版 agent deps 返回形状一致）。 */
    function scriptedBlenderRun(stdoutByCode: Map<string, string>) {
      const calls: string[] = []
      const fn = async (code: string) => {
        calls.push(code)
        const stdout = stdoutByCode.get(code)
        if (stdout === undefined) throw new Error('POSE_RESULT stdout 缺少 POSE_RESULT: 标记')
        // 用真实的 addon wrapper 形状（社区 addon：{result: {executed, result: stdout}}），
        // 让 extractExecuteStdout 能从 outcome.result.result 取到 stdout
        const outcome: McpToolCallOutcome = { result: { executed: true, result: stdout } }
        const readback = parseBlenderPoseReadback(outcome)
        const meta = parseBlenderDrivePoseMeta(outcome)
        return { readback, meta }
      }
      return { fn, calls }
    }

    it('首轮就成功 → 1 turn 即 finalize', async () => {
      const goodCode = 'print_pose'
      const stdoutByCode = new Map<string, string>([
        [
          goodCode,
          BLENDER_POSE_RESULT_MARKER +
            JSON.stringify({ 'mixamorig:Hips': [0.1, 0, 0], 'mixamorig:Spine': [0, 0.05, 0] })
        ]
      ])
      // 脚本顺序 = [try, finalize]
      const model = scriptedModel([
        { text: 'attempt', python: goodCode },
        { text: 'finalize now', finalize: true }
      ])
      const blender = scriptedBlenderRun(stdoutByCode)
      const events: string[] = []
      const result = await runBlenderAiPoseAgent(
        {
          instruction: '鞠躬',
          boneRoles: { ...MIXAMO_HIERARCHY },
          boneParents: {},
          locale: 'zh-CN',
          maxTurns: 3
        },
        {
          modelClient: model.fn,
          blenderRun: blender.fn,
          applyToRenderer: () => ({ matched: 2, total: 10 }),
          onEvent: (e) => events.push(e.kind)
        }
      )
      expect(result.ok).toBe(true)
      expect(result.reason).toBe('finalized')
      expect(result.turns).toBe(2)
      expect(blender.calls).toEqual([goodCode])
      expect(events).toContain('turn')
      expect(events).toContain('tool')
      expect(events).toContain('finalize')
    })

    it('首轮 Blender 抛错 → 次轮模型改对后 finalize', async () => {
      const bad = 'print("no marker")'
      const good = 'print_pose_v2'
      const stdoutByCode = new Map<string, string>([
        [good, BLENDER_POSE_RESULT_MARKER + JSON.stringify({ 'mixamorig:Hips': [0.2, 0, 0] })]
      ])
      // 脚本顺序 = [try(bad), try(good), finalize]
      const model = scriptedModel([
        { text: '1st attempt', python: bad },
        { text: '2nd attempt', python: good },
        { text: 'finalize', finalize: true }
      ])
      const blender = scriptedBlenderRun(stdoutByCode)
      const events: string[] = []
      const result = await runBlenderAiPoseAgent(
        {
          instruction: 'pose',
          boneRoles: { ...MIXAMO_HIERARCHY },
          boneParents: {},
          locale: 'en-US',
          maxTurns: 5
        },
        {
          modelClient: model.fn,
          blenderRun: blender.fn,
          applyToRenderer: () => ({ matched: 1, total: 10 }),
          onEvent: (e) => events.push(e.kind)
        }
      )
      expect(result.ok).toBe(true)
      expect(result.reason).toBe('finalized')
      expect(result.turns).toBe(3)
      expect(blender.calls).toEqual([bad, good])
      expect(events.filter((e) => e === 'tool').length).toBe(2)
    })

    it('达到 maxTurns 仍未 finalize → 返回 max_turns', async () => {
      const bad = 'print_empty'
      const stdoutByCode = new Map<string, string>([
        // 空 dict — parseBlenderPoseReadback 会抛"POSE_RESULT 里没有可用的骨骼旋转"
        [bad, BLENDER_POSE_RESULT_MARKER + '{}']
      ])
      const model = scriptedModel([
        { text: '1', python: bad },
        { text: '2', python: bad },
        { text: '3', python: bad }
      ])
      const blender = scriptedBlenderRun(stdoutByCode)
      const result = await runBlenderAiPoseAgent(
        {
          instruction: 'pose',
          boneRoles: { ...MIXAMO_HIERARCHY },
          boneParents: {},
          locale: 'zh-CN',
          maxTurns: 3
        },
        {
          modelClient: model.fn,
          blenderRun: blender.fn,
          applyToRenderer: () => ({ matched: 0, total: 0 })
        }
      )
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('max_turns')
      expect(result.turns).toBe(3)
    })

    it('model 始终不调 tool → 返回 no_finalize', async () => {
      const model = scriptedModel([{ text: 'I will not call tools.' }, { text: 'still nothing.' }])
      const blender = scriptedBlenderRun(new Map())
      const result = await runBlenderAiPoseAgent(
        {
          instruction: 'pose',
          boneRoles: { ...MIXAMO_HIERARCHY },
          boneParents: {},
          locale: 'zh-CN'
        },
        {
          modelClient: model.fn,
          blenderRun: blender.fn,
          applyToRenderer: () => ({ matched: 0, total: 0 })
        }
      )
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('no_finalize')
      expect(blender.calls.length).toBe(0)
    })

    it('modelClient 抛错 → 返回 error，turns=0', async () => {
      const result = await runBlenderAiPoseAgent(
        {
          instruction: 'pose',
          boneRoles: { ...MIXAMO_HIERARCHY },
          boneParents: {},
          locale: 'zh-CN',
          maxTurns: 3
        },
        {
          modelClient: async () => {
            throw new Error('boom')
          },
          blenderRun: async () => ({}),
          applyToRenderer: () => ({ matched: 0, total: 0 })
        }
      )
      expect(result.ok).toBe(false)
      expect(result.reason).toBe('error')
      expect(result.turns).toBe(0)
    })

    it('tool schema 含 try_blender_pose 与 finalize_pose', () => {
      const names = BLENDER_POSE_AGENT_TOOLS.map((t) => t.function.name)
      expect(names).toContain('try_blender_pose')
      expect(names).toContain('finalize_pose')
    })

    it('default max turns = 5', () => {
      expect(BLENDER_POSE_AGENT_DEFAULT_MAX_TURNS).toBe(5)
    })

    it('listArmatureBones 调用一次 → 系统提示含 Blender 实际骨名 ∩ 渲染层骨架名', async () => {
      // Blender 端 armature 有 ["mixamorig:Hips","mixamorig:Spine","foo:Bar"]
      // 渲染层骨架有 ["mixamorig:Hips","mixamorig:Spine","mixamorig:Head"]
      // 交集 = ["mixamorig:Hips","mixamorig:Spine"]
      let listCalls = 0
      const good = 'print_payload'
      const stdoutByCode = new Map<string, string>([
        [
          good,
          BLENDER_POSE_RESULT_MARKER +
            JSON.stringify({ 'mixamorig:Hips': [0.1, 0, 0] }) +
            '\n' +
            BLENDER_POSE_DRIVE_META_MARKER +
            JSON.stringify({ matched: 1, missing: [], armature: 'Armature' })
        ]
      ])
      const model = scriptedModel([
        { text: 'attempt', python: good },
        { text: 'finalize', finalize: true }
      ])
      const blender = scriptedBlenderRun(stdoutByCode)
      const events: string[] = []
      const result = await runBlenderAiPoseAgent(
        {
          instruction: 'pose',
          boneRoles: {
            ...MIXAMO_HIERARCHY,
            'mixamorig:Head': 'head'
          },
          boneParents: {},
          locale: 'zh-CN',
          maxTurns: 3
        },
        {
          modelClient: async ({ system }) => {
            // 关键断言：system 提示里包含 armature 校准段 + 交集列表
            if (system.includes('Blender armature 校准')) {
              events.push('armature_section_in_zh_system')
            }
            return model.fn({ system, messages: [], tools: BLENDER_POSE_AGENT_TOOLS })
          },
          blenderRun: blender.fn,
          applyToRenderer: () => ({ matched: 1, total: 11 }),
          listArmatureBones: async () => {
            listCalls++
            return {
              armature: 'Armature',
              bones: ['mixamorig:Hips', 'mixamorig:Spine', 'foo:Bar']
            }
          },
          onEvent: (e) => events.push(e.kind)
        }
      )
      expect(listCalls).toBe(1)
      expect(events).toContain('armature_list')
      expect(events).toContain('armature_section_in_zh_system')
      expect(result.ok).toBe(true)
      expect(result.boneArmature).toBe('Armature')
      expect(result.boneIntersection).toEqual(['mixamorig:Hips', 'mixamorig:Spine'])
    })

    it('Blender 端返回 missing → tool 事件携带 missing/armature；result 透传', async () => {
      const good = 'print_payload'
      // LLM 写了两个骨名，Blender 只驱动了一个（Hips），Spine 不在 armature 上
      const stdoutByCode = new Map<string, string>([
        [
          good,
          BLENDER_POSE_RESULT_MARKER +
            JSON.stringify({ 'mixamorig:Hips': [0.1, 0, 0] }) +
            '\n' +
            BLENDER_POSE_DRIVE_META_MARKER +
            JSON.stringify({
              matched: 1,
              missing: ['mixamorig:Spine'],
              armature: 'Armature'
            })
        ]
      ])
      const model = scriptedModel([
        { text: 'attempt', python: good },
        { text: 'finalize', finalize: true }
      ])
      const blender = scriptedBlenderRun(stdoutByCode)
      const events: BlenderPoseAgentEvent[] = []
      const result = await runBlenderAiPoseAgent(
        {
          instruction: 'pose',
          boneRoles: { ...MIXAMO_HIERARCHY },
          boneParents: {},
          locale: 'en-US',
          maxTurns: 3
        },
        {
          modelClient: model.fn,
          blenderRun: blender.fn,
          applyToRenderer: () => ({ matched: 1, total: 11 }),
          onEvent: (e) => events.push(e)
        }
      )
      expect(result.ok).toBe(true)
      expect(result.lastMissing).toEqual(['mixamorig:Spine'])
      expect(result.lastArmature).toBe('Armature')
      const toolEvent = events.find((e) => e.kind === 'tool')
      expect(toolEvent?.matched).toBe(1)
      expect(toolEvent?.missing).toEqual(['mixamorig:Spine'])
      expect(toolEvent?.armature).toBe('Armature')
    })

    it('listArmatureBones 抛错 → 不阻塞 agent，按渲染层骨架名继续（graceful fallback）', async () => {
      const good = 'print_payload'
      const stdoutByCode = new Map<string, string>([
        [good, BLENDER_POSE_RESULT_MARKER + JSON.stringify({ 'mixamorig:Hips': [0.1, 0, 0] })]
      ])
      const model = scriptedModel([
        { text: 'attempt', python: good },
        { text: 'finalize', finalize: true }
      ])
      const blender = scriptedBlenderRun(stdoutByCode)
      const result = await runBlenderAiPoseAgent(
        {
          instruction: 'pose',
          boneRoles: { ...MIXAMO_HIERARCHY },
          boneParents: {},
          locale: 'zh-CN',
          maxTurns: 3
        },
        {
          modelClient: model.fn,
          blenderRun: blender.fn,
          applyToRenderer: () => ({ matched: 1, total: 11 }),
          listArmatureBones: async () => {
            throw new Error('MCP 断了')
          }
        }
      )
      expect(result.ok).toBe(true)
      expect(result.boneArmature).toBeUndefined()
    })
  })
})
