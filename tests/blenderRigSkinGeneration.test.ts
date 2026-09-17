import { describe, expect, it } from 'vitest'
import {
  BLENDER_RIG_AGENT_DEFAULT_MAX_TURNS,
  BLENDER_RIG_AGENT_STUCK_THRESHOLD,
  BLENDER_RIG_AGENT_TOOLS,
  BLENDER_RIG_DRIVE_META_MARKER,
  BLENDER_RIG_RESULT_MARKER,
  BLENDER_RIG_TOPOLOGY_TABLE,
  type BlenderRigAgentEvent,
  type RunBlenderRigAgentDeps,
  buildBlenderPresetRigScript,
  decideBlenderRigStrategy,
  executeBlenderPresetRigPure,
  listBlenderRigPresetInstructions,
  matchBlenderRigPresetId,
  parseBlenderDriveRigMeta,
  parseBlenderRigReadback,
  runBlenderRigAgent
} from '../src/shared/blenderRigSkinGeneration'
import type { McpToolCallOutcome } from '../src/shared/mcpProtocol'

function makeStdout(rigObj: unknown, metaObj: unknown): string {
  return (
    'before-line\n' +
    BLENDER_RIG_RESULT_MARKER +
    JSON.stringify(rigObj) +
    '\nmid-line\n' +
    BLENDER_RIG_DRIVE_META_MARKER +
    JSON.stringify(metaObj) +
    '\n'
  )
}

function makeOutcome(stdout: string): McpToolCallOutcome {
  // 模拟 addon wrapper：execute_blender_code 的 result 是 { executed, result: stdout }
  return { result: { executed: true, result: stdout } }
}

describe('blenderRigSkinGeneration', () => {
  describe('decideBlenderRigStrategy', () => {
    it('zh 指令字面命中 humanoid-simple', () => {
      const presets = listBlenderRigPresetInstructions('zh-CN')
      const text = presets.find((p) => p.id === 'humanoid-simple')!.text
      expect(matchBlenderRigPresetId(text, 'zh-CN')).toBe('humanoid-simple')
      expect(
        decideBlenderRigStrategy({ instruction: text, locale: 'zh-CN', modelName: 'M' }).strategy
      ).toBe('preset')
    })

    it('zh 指令字面命中 humanoid-mixamo', () => {
      const presets = listBlenderRigPresetInstructions('zh-CN')
      const text = presets.find((p) => p.id === 'humanoid-mixamo')!.text
      expect(
        decideBlenderRigStrategy({ instruction: text, locale: 'zh-CN', modelName: 'M' }).presetId
      ).toBe('humanoid-mixamo')
    })

    it('空白指令抛错', () => {
      expect(() =>
        decideBlenderRigStrategy({ instruction: '   ', locale: 'zh-CN', modelName: 'M' })
      ).toThrow()
    })

    it('非预设文本走 ai 策略', () => {
      const r = decideBlenderRigStrategy({
        instruction: '我想要一个六指机械手，每指 4 段',
        locale: 'zh-CN',
        modelName: 'M'
      })
      expect(r.strategy).toBe('ai')
      expect(r.code).toBe('')
    })

    it('en 预设指令能在 zh locale 下命中（locale 自动放宽）', () => {
      const enText = listBlenderRigPresetInstructions('en-US').find(
        (p) => p.id === 'quadruped'
      )!.text
      expect(matchBlenderRigPresetId(enText, 'zh-CN')).toBe('quadruped')
    })
  })

  describe('topology sanity', () => {
    it('humanoid-simple / mixamo / quadruped / prop-rigid 都有 parent 链闭合', () => {
      for (const id of ['humanoid-simple', 'humanoid-mixamo', 'quadruped', 'prop-rigid'] as const) {
        const topo = BLENDER_RIG_TOPOLOGY_TABLE[id]
        const names = new Set(topo.bones.map((b) => b.name))
        expect(names.size).toBe(topo.bones.length) // 无重名
        const roots = topo.bones.filter((b) => !b.parent)
        expect(roots.length).toBe(1) // 单根
        for (const b of topo.bones) {
          if (b.parent) expect(names.has(b.parent)).toBe(true)
        }
      }
    })

    it('humanoid-mixamo 含手指 + toe + Mixamo 命名', () => {
      const topo = BLENDER_RIG_TOPOLOGY_TABLE['humanoid-mixamo']
      expect(topo.armatureName).toBe('mixamorig')
      expect(topo.bones.find((b) => b.name === 'LeftToeBase')).toBeTruthy()
      expect(topo.bones.find((b) => b.name === 'LeftHandIndex2')).toBeTruthy()
      expect(topo.bones.find((b) => b.name === 'Hips')).toBeTruthy()
    })
  })

  describe('buildBlenderPresetRigScript', () => {
    it('脚本含必填 marker 与变量名', () => {
      const code = buildBlenderPresetRigScript({ presetId: 'humanoid-simple', modelName: 'Char' })
      expect(code).toContain('import json')
      expect(code).toContain('import bpy')
      expect(code).toContain(`print(${JSON.stringify(BLENDER_RIG_RESULT_MARKER)}`)
      expect(code).toContain(`print(${JSON.stringify(BLENDER_RIG_DRIVE_META_MARKER)}`)
      expect(code).toContain('ARMATURE_AUTO')
    })
  })

  describe('executeBlenderPresetRigPure', () => {
    it('不走 Blender 端也能算出 armature + bones', () => {
      const r = executeBlenderPresetRigPure({ presetId: 'quadruped' })
      expect(r.armature).toBe('RigQuadruped')
      expect(r.bones).toContain('Tail')
      expect(r.vertexGroups).toEqual([]) // 蒙皮必须 Blender 端算
      expect(r.presetId).toBe('quadruped')
    })
  })

  describe('parseBlenderRigReadback', () => {
    it('stdout 含 marker → 解析成功', () => {
      const stdout = makeStdout(
        {
          armature: 'mixamorig',
          bones: ['Hips', 'Spine', 'LeftArm'],
          vertexGroups: ['Spine', 'LeftArm']
        },
        { bonesMatched: 3, vertexGroupsMatched: 2, armature: 'mixamorig' }
      )
      const r = parseBlenderRigReadback(makeOutcome(stdout), 'humanoid-mixamo')
      expect(r.armature).toBe('mixamorig')
      expect(r.bones).toEqual(['Hips', 'Spine', 'LeftArm'])
      expect(r.vertexGroups).toEqual(['Spine', 'LeftArm'])
      expect(r.presetId).toBe('humanoid-mixamo')
    })

    it('stdout 缺 marker → 抛错', () => {
      const outcome = makeOutcome('just some text without marker')
      expect(() => parseBlenderRigReadback(outcome, null)).toThrow(/缺少 RIG_RESULT/)
    })

    it('marker 后 JSON 畸形 → 抛错', () => {
      const outcome = makeOutcome(BLENDER_RIG_RESULT_MARKER + 'not-json')
      expect(() => parseBlenderRigReadback(outcome, null)).toThrow(/JSON/)
    })

    it('empty bones / armature → 抛错', () => {
      const outcome = makeOutcome(BLENDER_RIG_RESULT_MARKER + JSON.stringify({ armature: null }))
      expect(() => parseBlenderRigReadback(outcome, null)).toThrow(/没有 armature/)
    })
  })

  describe('parseBlenderDriveRigMeta', () => {
    it('stdout 无 meta marker → 返回 null', () => {
      expect(parseBlenderDriveRigMeta(makeOutcome('no marker'))).toBeNull()
    })

    it('stdout 有 meta marker → 解析', () => {
      const stdout =
        BLENDER_RIG_DRIVE_META_MARKER +
        JSON.stringify({
          bonesMatched: 10,
          vertexGroupsMatched: 5,
          armature: 'Rig'
        })
      const meta = parseBlenderDriveRigMeta(makeOutcome(stdout))
      expect(meta).toEqual({ bonesMatched: 10, vertexGroupsMatched: 5, armature: 'Rig' })
    })
  })

  describe('agent tools schema', () => {
    it('工具集名固定', () => {
      const names = BLENDER_RIG_AGENT_TOOLS.map((t) => t.function.name)
      expect(names).toEqual(['try_blender_rig', 'finalize_rig'])
      expect(BLENDER_RIG_AGENT_DEFAULT_MAX_TURNS).toBeGreaterThanOrEqual(3)
      expect(BLENDER_RIG_AGENT_STUCK_THRESHOLD).toBe(3)
    })

    it('默认轮数允许 agent 跑多轮直到成功（不再是早期 5 轮硬截）', () => {
      // 真实场景中模型 + Blender 多轮对齐通常需要 5–15 轮，5 轮会把合法拓扑拦在外面。
      expect(BLENDER_RIG_AGENT_DEFAULT_MAX_TURNS).toBeGreaterThanOrEqual(20)
    })
  })

  describe('runBlenderRigAgent', () => {
    /** 模型侧假实现：依 step 序列依次回 text + tool_calls */
    function scriptedModel(
      steps: ReadonlyArray<{
        text: string
        python?: string
        finalize?: boolean
      }>
    ) {
      const calls: { text: string; toolNames: string[] }[] = []
      let i = 0
      const fn: RunBlenderRigAgentDeps['modelClient'] = async () => {
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
              name: 'try_blender_rig',
              arguments: JSON.stringify({ python_code: s.python })
            }
          })
        }
        if (s.finalize) {
          out.push({
            id: '2',
            type: 'function',
            function: { name: 'finalize_rig', arguments: '{}' }
          })
        }
        calls.push({ text: s.text, toolNames: out.map((c) => c.function.name) })
        return { text: s.text, toolCalls: out }
      }
      return { fn, calls }
    }

    it('首轮 Blender OK → 次轮 finalize', async () => {
      const goodCode = 'rig_pass1'
      const stdoutByCode = new Map<string, string>([
        [
          goodCode,
          makeStdout(
            { armature: 'mixamorig', bones: ['Hips', 'Spine'], vertexGroups: ['Spine'] },
            { bonesMatched: 2, vertexGroupsMatched: 1, armature: 'mixamorig' }
          )
        ]
      ])
      const blender = (async (code: string) => {
        const stdout = stdoutByCode.get(code)
        if (!stdout) throw new Error('no stdout')
        const o = makeOutcome(stdout)
        return { readback: parseBlenderRigReadback(o, null), meta: parseBlenderDriveRigMeta(o) }
      }) as RunBlenderRigAgentDeps['blenderRun']
      const model = scriptedModel([
        { text: 'try1', python: goodCode },
        { text: 'finalize', finalize: true }
      ])
      const events: BlenderRigAgentEvent[] = []
      const r = await runBlenderRigAgent(
        { instruction: '自定绑骨：我要 6 指机械手', locale: 'zh-CN', modelName: 'M' },
        {
          modelClient: model.fn,
          blenderRun: blender,
          applyToRenderer: (readback) => ({
            bonesMatched: readback.bones.length,
            vertexGroupsMatched: readback.vertexGroups.length
          }),
          onEvent: (e) => events.push(e)
        }
      )
      expect(r.ok).toBe(true)
      expect(r.reason).toBe('finalized')
      expect(r.readback.armature).toBe('mixamorig')
      expect(events.some((e) => e.kind === 'finalize')).toBe(true)
    })

    it('首轮 Blender 报错 → 次轮改对后 finalize', async () => {
      const good = 'rig_pass2'
      const stdoutByCode = new Map<string, string>([
        [
          good,
          makeStdout(
            { armature: 'Rig', bones: ['Root'], vertexGroups: [] },
            { bonesMatched: 1, vertexGroupsMatched: 0, armature: 'Rig' }
          )
        ]
      ])
      const blender = (async (code: string) => {
        if (!stdoutByCode.has(code)) throw new Error('blender fail')
        const o = makeOutcome(stdoutByCode.get(code)!)
        return { readback: parseBlenderRigReadback(o, null), meta: parseBlenderDriveRigMeta(o) }
      }) as RunBlenderRigAgentDeps['blenderRun']
      const model = scriptedModel([
        { text: 'try1 bad', python: 'rig_pass1_bad' },
        { text: 'try2 good', python: good },
        { text: 'finalize', finalize: true }
      ])
      const r = await runBlenderRigAgent(
        { instruction: '自定绑骨', locale: 'zh-CN', modelName: 'M' },
        {
          modelClient: model.fn,
          blenderRun: blender,
          applyToRenderer: (readback) => ({
            bonesMatched: readback.bones.length,
            vertexGroupsMatched: readback.vertexGroups.length
          })
        }
      )
      expect(r.ok).toBe(true)
      expect(r.reason).toBe('finalized')
      expect(r.readback.armature).toBe('Rig')
    })

    it('允许 agent 多轮调 Blender 直到成功（默认轮数 ≥ 20）', async () => {
      // 模拟 LLM 在第 7 轮才给到正确的 Python——早期 5 轮上限会把它判死。
      const failingBeforeSuccess = 6
      const codes: string[] = []
      const stdoutByCode = new Map<string, string>()
      for (let i = 0; i < failingBeforeSuccess; i++) {
        const code = `bad_${i}`
        codes.push(code)
        stdoutByCode.set(
          code,
          makeStdout(
            { armature: null, bones: [], vertexGroups: [] },
            { bonesMatched: 0, vertexGroupsMatched: 0, armature: null }
          )
        )
      }
      const goodCode = `good_${failingBeforeSuccess}`
      codes.push(goodCode)
      stdoutByCode.set(
        goodCode,
        makeStdout(
          { armature: 'mixamorig', bones: ['Hips', 'Spine'], vertexGroups: ['Spine'] },
          { bonesMatched: 2, vertexGroupsMatched: 1, armature: 'mixamorig' }
        )
      )
      const blender = (async (code: string) => {
        const stdout = stdoutByCode.get(code)
        if (!stdout) throw new Error('no stdout for ' + code)
        const o = makeOutcome(stdout)
        // 空 armature 在 parseBlenderRigReadback 里会抛错，模拟真实失败路径
        if (code !== goodCode) throw new Error(`blender empty rig for ${code}`)
        return { readback: parseBlenderRigReadback(o, null), meta: parseBlenderDriveRigMeta(o) }
      }) as RunBlenderRigAgentDeps['blenderRun']
      const steps = codes.map((code) => ({ text: `try ${code}`, python: code }))
      steps.push({ text: 'finalize', finalize: true })
      const model = scriptedModel(steps)
      const r = await runBlenderRigAgent(
        { instruction: '绑骨', locale: 'zh-CN', modelName: 'M' },
        {
          modelClient: model.fn,
          blenderRun: blender,
          applyToRenderer: (readback) => ({
            bonesMatched: readback.bones.length,
            vertexGroupsMatched: readback.vertexGroups.length
          })
        }
      )
      expect(r.ok).toBe(true)
      expect(r.reason).toBe('finalized')
      // 关键断言：超过早期 5 轮上限依然能成功——也就是 agent 跑到了第 6 轮才成功。
      expect(r.turns).toBeGreaterThan(5)
    })

    it('连续相同 readback 达阈值 → stuck 退出，不调 finalize', async () => {
      // 模型侧每轮都发不同的 python_code，但 Blender 端每次都返回同样的（残缺）readback
      // —— 模拟 agent 反复"微调"却没真正改对拓扑的场景。
      const repeatReadback = {
        armature: 'RigPartial',
        bones: ['Root', 'Hips'],
        vertexGroups: []
      }
      const repeatMeta = { bonesMatched: 2, vertexGroupsMatched: 0, armature: 'RigPartial' }
      const stdout = makeStdout(repeatReadback, repeatMeta)
      const blender = (async (_code: string) => {
        const o = makeOutcome(stdout)
        return { readback: parseBlenderRigReadback(o, null), meta: parseBlenderDriveRigMeta(o) }
      }) as RunBlenderRigAgentDeps['blenderRun']
      // 提供足够多轮脚本，确保 agent 在到达 BLENDER_RIG_AGENT_STUCK_THRESHOLD 时还在循环里
      const steps = Array.from({ length: BLENDER_RIG_AGENT_STUCK_THRESHOLD + 2 }, (_, i) => ({
        text: `attempt ${i}`,
        python: `attempt_${i}`
      }))
      const model = scriptedModel(steps)
      const events: BlenderRigAgentEvent[] = []
      const r = await runBlenderRigAgent(
        { instruction: '绑骨', locale: 'zh-CN', modelName: 'M' },
        {
          modelClient: model.fn,
          blenderRun: blender,
          applyToRenderer: (readback) => ({
            bonesMatched: readback.bones.length,
            vertexGroupsMatched: readback.vertexGroups.length
          }),
          onEvent: (e) => events.push(e)
        }
      )
      expect(r.ok).toBe(false)
      expect(r.reason).toBe('stuck')
      // 应该恰好在第 THRESHOLD 次成功 try_blender_rig 后 stuck（不是 max_turns）
      expect(r.turns).toBe(BLENDER_RIG_AGENT_STUCK_THRESHOLD)
      const stuckEvent = events.find((e) => e.kind === 'stuck')
      expect(stuckEvent).toBeDefined()
      expect((stuckEvent as { kind: 'stuck'; identicalStreak: number }).identicalStreak).toBe(
        BLENDER_RIG_AGENT_STUCK_THRESHOLD
      )
    })

    it('失败重试不计入 stuck 计数（throw 后下一次成功从 1 开始）', async () => {
      // 第 1 轮 throw，第 2 轮同 readback 成功——只该算 streak=1，不该直接 stuck。
      const repeatReadback = {
        armature: 'RigPartial',
        bones: ['Root', 'Hips'],
        vertexGroups: []
      }
      const repeatMeta = { bonesMatched: 2, vertexGroupsMatched: 0, armature: 'RigPartial' }
      const stdout = makeStdout(repeatReadback, repeatMeta)
      let callIdx = 0
      const blender = (async (code: string) => {
        callIdx += 1
        if (callIdx === 1) throw new Error('transient blender fail for ' + code)
        const o = makeOutcome(stdout)
        return { readback: parseBlenderRigReadback(o, null), meta: parseBlenderDriveRigMeta(o) }
      }) as RunBlenderRigAgentDeps['blenderRun']
      // 给到比 STUCK_THRESHOLD 大很多的 step，确保不会先于 max_turns 卡死——
      // 但默认 max_turns = 50，所以这个测试主要验"throw 不污染 streak"。
      const totalSteps = BLENDER_RIG_AGENT_STUCK_THRESHOLD + 4
      const steps = Array.from({ length: totalSteps }, (_, i) => ({
        text: `try${i}`,
        python: `p${i}`
      }))
      const model = scriptedModel(steps)
      const r = await runBlenderRigAgent(
        { instruction: '绑骨', locale: 'zh-CN', modelName: 'M' },
        {
          modelClient: model.fn,
          blenderRun: blender,
          applyToRenderer: (readback) => ({
            bonesMatched: readback.bones.length,
            vertexGroupsMatched: readback.vertexGroups.length
          })
        }
      )
      // 第 1 轮 throw（streak 不递增也不重置，保持 0），
      // 后面 N 次成功同 readback 累计到 THRESHOLD 后 stuck。
      expect(r.reason).toBe('stuck')
    })
  })
})
