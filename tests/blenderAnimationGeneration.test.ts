import { describe, expect, it } from 'vitest'
import {
  BLENDER_ANIM_AGENT_DEFAULT_MAX_TURNS,
  BLENDER_ANIM_AGENT_TOOLS,
  BLENDER_ANIM_DRIVE_META_MARKER,
  BLENDER_ANIM_PRESET_FRAMES,
  BLENDER_ANIM_PRESET_TABLE,
  BLENDER_ANIM_RESULT_MARKER,
  type BlenderAnimAgentEvent,
  type RunBlenderAnimAgentDeps,
  buildBlenderPresetAnimScript,
  decideBlenderAnimStrategy,
  executeBlenderPresetAnimPure,
  listBlenderAnimPresetInstructions,
  matchBlenderAnimPresetId,
  parseBlenderAnimReadback,
  parseBlenderDriveAnimMeta,
  runBlenderAnimAgent
} from '../src/shared/blenderAnimationGeneration'
import type { McpToolCallOutcome } from '../src/shared/mcpProtocol'

function makeStdout(animObj: unknown, metaObj: unknown): string {
  return (
    'before\n' +
    BLENDER_ANIM_RESULT_MARKER +
    JSON.stringify(animObj) +
    '\nmid\n' +
    BLENDER_ANIM_DRIVE_META_MARKER +
    JSON.stringify(metaObj) +
    '\n'
  )
}

function makeOutcome(stdout: string): McpToolCallOutcome {
  return { result: { executed: true, result: stdout } }
}

describe('blenderAnimationGeneration', () => {
  describe('decideBlenderAnimStrategy', () => {
    it('zh 指令字面命中 walk', () => {
      const presets = listBlenderAnimPresetInstructions('zh-CN')
      const text = presets.find((p) => p.id === 'walk')!.text
      expect(matchBlenderAnimPresetId(text, 'zh-CN')).toBe('walk')
      const r = decideBlenderAnimStrategy({
        instruction: text,
        locale: 'zh-CN',
        armatureName: 'mixamorig'
      })
      expect(r.strategy).toBe('preset')
      expect(r.presetId).toBe('walk')
    })

    it('非预设描述走 ai 策略', () => {
      const r = decideBlenderAnimStrategy({
        instruction: '角色向前跑并做出挥拳动作',
        locale: 'zh-CN',
        armatureName: 'mixamorig'
      })
      expect(r.strategy).toBe('ai')
      expect(r.code).toBe('')
    })

    it('空白指令抛错', () => {
      expect(() =>
        decideBlenderAnimStrategy({ instruction: '', locale: 'zh-CN', armatureName: 'mixamorig' })
      ).toThrow()
    })

    it('所有 13 个预设都能在 zh locale 命中', () => {
      const all = listBlenderAnimPresetInstructions('zh-CN')
      expect(all.length).toBe(13)
      for (const item of all) {
        expect(matchBlenderAnimPresetId(item.text, 'zh-CN')).toBe(item.id)
      }
    })
  })

  describe('preset table sanity', () => {
    it('预设帧数与表一致', () => {
      expect(BLENDER_ANIM_PRESET_FRAMES.walk).toBe(24)
      expect(BLENDER_ANIM_PRESET_FRAMES.run).toBe(20)
      expect(BLENDER_ANIM_PRESET_FRAMES.idle).toBe(30)
    })

    it('预设关键帧表：每条预设至少有 2 相位、欧拉值在合理范围', () => {
      const table = BLENDER_ANIM_PRESET_TABLE
      for (const id of Object.keys(table) as Array<keyof typeof table>) {
        const preset = table[id]
        expect(Object.keys(preset).length).toBeGreaterThan(0)
        for (const boneSpec of Object.values(preset)) {
          if (!boneSpec) continue
          expect(boneSpec.length).toBeGreaterThanOrEqual(2)
          for (const p of boneSpec) {
            expect(p.length).toBe(3)
            for (const v of p) {
              expect(typeof v).toBe('number')
              expect(Math.abs(v)).toBeLessThanOrEqual(Math.PI * 2 + 0.05)
            }
          }
        }
      }
    })
  })

  describe('buildBlenderPresetAnimScript', () => {
    it('脚本含必填 marker 与变量名', () => {
      const code = buildBlenderPresetAnimScript({
        presetId: 'walk',
        armatureName: 'mixamorig',
        fps: 30
      })
      expect(code).toContain('import json')
      expect(code).toContain('import bpy')
      expect(code).toContain(`print(${JSON.stringify(BLENDER_ANIM_RESULT_MARKER)}`)
      expect(code).toContain(`print(${JSON.stringify(BLENDER_ANIM_DRIVE_META_MARKER)}`)
      expect(code).toContain('KEYFRAMES')
      expect(code).toContain('FPS = 30')
    })
  })

  describe('executeBlenderPresetAnimPure', () => {
    it('不走 Blender 也能算出 clip', () => {
      const clip = executeBlenderPresetAnimPure({ presetId: 'walk' })
      expect(clip.action).toBe('walk_cycle')
      expect(clip.fps).toBe(24)
      expect(clip.frameRange).toEqual([1, 24])
      expect(clip.keyframes.Hips).toBeDefined()
      expect(clip.presetId).toBe('walk')
      // 走路循环 4 帧相位
      expect(Object.keys(clip.keyframes.LeftUpperArm[1] || [])).toEqual(expect.anything())
    })
  })

  describe('parseBlenderAnimReadback', () => {
    it('stdout 含 marker → 解析成功', () => {
      const stdout = makeStdout(
        {
          action: 'walk_cycle',
          fps: 24,
          frame_range: [1, 24],
          keyframes: {
            Hips: { 1: [0, 0, 0], 12: [0.05, 0, 0] },
            LeftUpperArm: { 1: [0.5, 0, 0], 12: [-0.5, 0, 0] }
          }
        },
        { bones_matched: 2, bones_missing: [], armature: 'mixamorig', keyframe_count: 4 }
      )
      const c = parseBlenderAnimReadback(makeOutcome(stdout), 'walk')
      expect(c.action).toBe('walk_cycle')
      expect(c.fps).toBe(24)
      expect(c.frameRange).toEqual([1, 24])
      expect(c.keyframes.Hips[12]).toEqual([0.05, 0, 0])
      expect(c.keyframes.LeftUpperArm[12]).toEqual([-0.5, 0, 0])
      expect(c.presetId).toBe('walk')
    })

    it('stdout 缺 marker → 抛错', () => {
      expect(() => parseBlenderAnimReadback(makeOutcome('no marker'), null)).toThrow(
        /缺少 ANIM_RESULT/
      )
    })

    it('JSON 畸形 → 抛错', () => {
      expect(() =>
        parseBlenderAnimReadback(makeOutcome(BLENDER_ANIM_RESULT_MARKER + 'not-json'), null)
      ).toThrow(/JSON/)
    })

    it('空 action / keyframes → 抛错', () => {
      expect(() =>
        parseBlenderAnimReadback(
          makeOutcome(
            BLENDER_ANIM_RESULT_MARKER +
              JSON.stringify({ action: '', fps: 24, frame_range: [1, 24], keyframes: {} })
          ),
          null
        )
      ).toThrow(/没有 action/)
    })
  })

  describe('parseBlenderDriveAnimMeta', () => {
    it('stdout 无 meta marker → null', () => {
      expect(parseBlenderDriveAnimMeta(makeOutcome('nothing'))).toBeNull()
    })

    it('stdout 有 meta marker → 解析', () => {
      const stdout =
        BLENDER_ANIM_DRIVE_META_MARKER +
        JSON.stringify({
          bones_matched: 3,
          bones_missing: ['BoneX'],
          armature: 'mixamorig',
          keyframe_count: 12
        })
      const m = parseBlenderDriveAnimMeta(makeOutcome(stdout))
      expect(m).toEqual({
        bonesMatched: 3,
        bonesMissing: ['BoneX'],
        armature: 'mixamorig',
        keyframeCount: 12
      })
    })
  })

  describe('agent tools schema', () => {
    it('工具集名固定', () => {
      const names = BLENDER_ANIM_AGENT_TOOLS.map((t) => t.function.name)
      expect(names).toEqual(['try_blender_anim', 'finalize_anim'])
      expect(BLENDER_ANIM_AGENT_DEFAULT_MAX_TURNS).toBeGreaterThanOrEqual(3)
    })
  })

  describe('runBlenderAnimAgent', () => {
    function scriptedModel(
      steps: ReadonlyArray<{
        text: string
        python?: string
        finalize?: boolean
      }>
    ) {
      let i = 0
      const fn: RunBlenderAnimAgentDeps['modelClient'] = async () => {
        const s = steps[i++] ?? { text: 'no more' }
        const out: Array<{
          id: string
          type: 'function'
          function: { name: string; arguments: string }
        }> = []
        if (s.python !== undefined) {
          out.push({
            id: '1',
            type: 'function',
            function: {
              name: 'try_blender_anim',
              arguments: JSON.stringify({ python_code: s.python })
            }
          })
        }
        if (s.finalize) {
          out.push({
            id: '2',
            type: 'function',
            function: { name: 'finalize_anim', arguments: '{}' }
          })
        }
        return { text: s.text, toolCalls: out }
      }
      return { fn }
    }

    it('首轮 Blender OK → 次轮 finalize', async () => {
      const good = 'anim_pass1'
      const stdoutByCode = new Map<string, string>([
        [
          good,
          makeStdout(
            {
              action: 'my_action',
              fps: 24,
              frame_range: [1, 24],
              keyframes: { Hips: { 1: [0, 0, 0], 12: [0.05, 0, 0] } }
            },
            { bones_matched: 1, bones_missing: [], armature: 'mixamorig', keyframe_count: 2 }
          )
        ]
      ])
      const blender = (async (code: string) => {
        const stdout = stdoutByCode.get(code)
        if (!stdout) throw new Error('no stdout')
        const o = makeOutcome(stdout)
        return { readback: parseBlenderAnimReadback(o, null), meta: parseBlenderDriveAnimMeta(o) }
      }) as RunBlenderAnimAgentDeps['blenderRun']
      const model = scriptedModel([
        { text: 'try', python: good },
        { text: 'finalize', finalize: true }
      ])
      const events: BlenderAnimAgentEvent[] = []
      const r = await runBlenderAnimAgent(
        { instruction: '自定义动画', locale: 'zh-CN', armatureName: 'mixamorig' },
        {
          modelClient: model.fn,
          blenderRun: blender,
          applyToRenderer: (clip) => ({
            bonesMatched: Object.keys(clip.keyframes).length,
            keyframeCount: Object.values(clip.keyframes).reduce(
              (s, v) => s + Object.keys(v).length,
              0
            )
          }),
          onEvent: (e) => events.push(e)
        }
      )
      expect(r.ok).toBe(true)
      expect(r.reason).toBe('finalized')
      expect(r.readback.action).toBe('my_action')
      expect(events.some((e) => e.kind === 'finalize')).toBe(true)
    })

    it('首轮 Blender 报错 → 次轮改对后 finalize', async () => {
      const good = 'anim_pass2'
      const stdoutByCode = new Map<string, string>([
        [
          good,
          makeStdout(
            {
              action: 'a',
              fps: 24,
              frame_range: [1, 24],
              keyframes: { Hips: { 1: [0, 0, 0] } }
            },
            { bones_matched: 1, bones_missing: [], armature: 'mixamorig', keyframe_count: 1 }
          )
        ]
      ])
      const blender = (async (code: string) => {
        if (!stdoutByCode.has(code)) throw new Error('blender fail')
        const o = makeOutcome(stdoutByCode.get(code)!)
        return { readback: parseBlenderAnimReadback(o, null), meta: parseBlenderDriveAnimMeta(o) }
      }) as RunBlenderAnimAgentDeps['blenderRun']
      const model = scriptedModel([
        { text: 't1', python: 'anim_pass1_bad' },
        { text: 't2', python: good },
        { text: 'finalize', finalize: true }
      ])
      const r = await runBlenderAnimAgent(
        { instruction: '自定义', locale: 'zh-CN', armatureName: 'mixamorig' },
        {
          modelClient: model.fn,
          blenderRun: blender,
          applyToRenderer: (clip) => ({
            bonesMatched: Object.keys(clip.keyframes).length,
            keyframeCount: Object.values(clip.keyframes).reduce(
              (s, v) => s + Object.keys(v).length,
              0
            )
          })
        }
      )
      expect(r.ok).toBe(true)
      expect(r.reason).toBe('finalized')
      expect(r.readback.action).toBe('a')
    })
  })
})
