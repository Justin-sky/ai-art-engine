import { describe, expect, it } from 'vitest'
import { guardBlenderCode } from '../src/shared/blenderMcp'
import {
  BLENDER_HUMANOID_BONE_NAMES,
  BLENDER_HUMANOID_BONE_SPECS,
  BLENDER_HUMANOID_RIG_CODE
} from '../src/shared/blenderHumanoidRig'
import {
  BLENDER_DSH_SKILL_ID,
  BLENDER_DSH_TIMEOUT_MS,
  BLENDER_JOB_READBACK_CODE,
  blenderDshError,
  blenderExecuteStdout,
  blenderJobOverlayReady,
  buildBlenderJobBrief,
  buildBlenderJobTask,
  expandBlenderJobInstruction,
  mergeBlenderJobOverlay,
  parseBlenderJobMetaLine,
  parseBlenderJobResult,
  validateBlenderJobDelivery
} from '../src/shared/blenderDshJob'

describe('blenderDshJob', () => {
  it('maps kinds to skill ids, timeouts, and error prefixes', () => {
    expect(BLENDER_DSH_SKILL_ID.rig).toBe('blender.rigSkin')
    expect(BLENDER_DSH_SKILL_ID.pose).toBe('blender.pose')
    expect(BLENDER_DSH_SKILL_ID.anim).toBe('blender.animation')
    expect(BLENDER_DSH_TIMEOUT_MS.rig).toBe(6_000_000)
    expect(BLENDER_DSH_TIMEOUT_MS.pose).toBe(3_600_000)
    expect(BLENDER_DSH_TIMEOUT_MS.anim).toBe(7_200_000)
    expect(blenderDshError('rig', 'EXPORT')).toBe('GRAPH_MODEL_RIG_EXPORT')
    expect(blenderDshError('pose', 'DSH')).toBe('GRAPH_MODEL_POSE_DSH')
    expect(blenderDshError('anim', 'NO_MATCH')).toBe('GRAPH_MODEL_ANIM_NO_MATCH')
  })

  it('parses result.json overlays and rejects invalid payloads', () => {
    const parsed = parseBlenderJobResult(
      {
        ok: true,
        kind: 'pose',
        exportedPath: '/tmp/output.glb',
        bonePose: { Spine: { x: 0.1, y: 0, z: 0 }, Hips: [0, 0.2, 0], Zero: [0, 0, 0] },
        rigMeta: { armature: 'Armature', bones: ['Hips', 'Spine'], vertexGroups: ['Hips'] },
        clip: {
          name: 'Walk',
          fps: 24,
          frameRange: [1, 24],
          keyframes: { Hips: { '1': [0, 0.1, 0] } }
        }
      },
      'pose'
    )
    expect(parsed.ok).toBe(true)
    expect(parsed.bonePose?.Spine).toEqual({ x: 0.1, y: 0, z: 0 })
    expect(parsed.bonePose?.Hips).toEqual({ x: 0, y: 0.2, z: 0 })
    expect(parsed.bonePose?.Zero).toBeUndefined()
    expect(parsed.rigMeta?.bones).toEqual(['Hips', 'Spine'])
    expect(parsed.clip?.name).toBe('Walk')
    expect(parsed.clip?.keyframes.Hips?.[1]).toEqual([0, 0.1, 0])

    expect(parseBlenderJobResult('not-json', 'rig').error).toBe('GRAPH_MODEL_DSH_RESULT')
    expect(parseBlenderJobResult(null, 'anim').ok).toBe(false)
  })

  it('validates delivery: export file, ok flag, and overlay presence', () => {
    expect(
      validateBlenderJobDelivery({
        kind: 'pose',
        result: { ok: true, kind: 'pose', bonePose: { Spine: { x: 0.1, y: 0, z: 0 } } },
        outputExists: false
      })
    ).toBe('GRAPH_MODEL_POSE_EXPORT')

    expect(
      validateBlenderJobDelivery({
        kind: 'rig',
        result: { ok: true, kind: 'rig', rigMeta: { armature: 'A', bones: [], vertexGroups: [] } },
        outputExists: true
      })
    ).toBe('GRAPH_MODEL_RIG_NO_MATCH')

    expect(
      validateBlenderJobDelivery({
        kind: 'rig',
        result: {
          ok: true,
          kind: 'rig',
          rigMeta: { armature: 'A', bones: ['Hips'], vertexGroups: [] }
        },
        outputExists: true
      })
    ).toBe('GRAPH_MODEL_RIG_NO_WEIGHTS')

    expect(
      validateBlenderJobDelivery({
        kind: 'rig',
        result: {
          ok: true,
          kind: 'rig',
          rigMeta: { armature: 'A', bones: ['Hips'], vertexGroups: ['Hips'] }
        },
        outputExists: true
      })
    ).toBe('GRAPH_MODEL_RIG_QA')

    expect(
      validateBlenderJobDelivery({
        kind: 'anim',
        result: { ok: false, kind: 'anim', error: 'GRAPH_MODEL_ANIM_FAILED' },
        outputExists: true
      })
    ).toBe('GRAPH_MODEL_ANIM_FAILED')

    expect(
      validateBlenderJobDelivery({
        kind: 'anim',
        result: {
          ok: true,
          kind: 'anim',
          clip: { name: 'Idle', fps: 24, frameRange: [1, 24], keyframes: {} }
        },
        outputExists: true
      })
    ).toBeNull()
  })

  it('builds a brief and task that name paths and forbid guessing', () => {
    const input = {
      kind: 'pose' as const,
      instruction: 'idle stand',
      locale: 'zh-CN',
      inputAbs: 'F:/job/input.glb',
      outputAbs: 'F:/job/output.glb',
      resultAbs: 'F:/job/result.json',
      skillId: 'blender.pose'
    }
    const brief = buildBlenderJobBrief(input)
    expect(brief).toContain('Skill: blender.pose')
    expect(brief).toContain('F:/job/output.glb')
    expect(brief).toContain('Never invent Euler angles')

    const task = buildBlenderJobTask(input)
    expect(task).toContain('Use skill "blender.pose"')
    expect(task).toContain('export_scene')
    expect(task).toContain('idle stand')
    expect(task).toContain('Do not guess joint angles')

    const rigTask = buildBlenderJobTask({ ...input, kind: 'rig', skillId: 'blender.rigSkin' })
    expect(rigTask).toContain('Attempt 1/3')
    expect(rigTask).toContain('AIAE_HUMANOID_LANDMARKS')
    expect(rigTask).toContain('AIAE_HUMANOID_BIND_FROM_LANDMARKS')
    expect(rigTask).toContain('Do not export')
  })

  it('expands a short 人形骨架 chip into the iterative recipe', () => {
    const expanded = expandBlenderJobInstruction('rig', '人形骨架')
    expect(expanded).toContain('人形骨架')
    expect(expanded).toContain('AIAE_HUMANOID_LANDMARKS')
    expect(expanded).toContain('ARMATURE_AUTO')
    expect(
      buildBlenderJobTask({
        kind: 'rig',
        instruction: '人形骨架',
        inputAbs: 'a',
        outputAbs: 'b',
        resultAbs: 'c',
        skillId: 'blender.rigSkin'
      })
    ).toContain('L_UpperArm')
  })

  it('expands stacked 人形骨架 + 人形简单骨架 chip text once', () => {
    const stacked =
      '人形骨架\n人形简单骨架：根骨 + 脊柱链（髋/胸/颈/头）+ 双手臂（肩/上臂/前臂/手）+ 双腿（上腿/下腿/脚），共 21 根骨头，适合人型角色基础动画。'
    const expanded = expandBlenderJobInstruction('rig', stacked)
    expect(expanded).toContain('Expanded recipe (humanoid iterative skinning)')
    expect(expanded).toContain('AIAE_HUMANOID_LANDMARKS')
    expect(expanded).toContain('L_UpperArm')
    expect(expanded).not.toContain('prop-rigid')
    expect(expanded.match(/Expanded recipe/g)?.length ?? 0).toBe(1)

    const already = '人形简单骨架，共 21 骨：Hips（根）→ Spine。parent_set(ARMATURE_AUTO)。'
    const withScript = expandBlenderJobInstruction('rig', already)
    expect(withScript).toContain(already)
    expect(withScript).toContain('AIAE_HUMANOID_LANDMARKS')
    expect(expandBlenderJobInstruction('rig', withScript)).toBe(withScript)

    const prop = expandBlenderJobInstruction('rig', '道具单骨骨架：只有一根 Root 骨')
    expect(prop).toContain('prop-rigid')
    expect(prop).not.toContain('humanoid iterative')
  })

  it('ships a 21-bone mesh-landmark script that passes safe-mode', () => {
    expect(BLENDER_HUMANOID_BONE_SPECS).toHaveLength(21)
    expect(new Set(BLENDER_HUMANOID_BONE_NAMES).size).toBe(21)
    expect(BLENDER_HUMANOID_BONE_SPECS.map((s) => s.name)).toEqual([...BLENDER_HUMANOID_BONE_NAMES])
    const names = new Set<string>([''])
    for (const spec of BLENDER_HUMANOID_BONE_SPECS) {
      expect(names.has(spec.parent)).toBe(true)
      names.add(spec.name)
    }
    const hips = BLENDER_HUMANOID_BONE_SPECS.find((s) => s.name === 'Hips')!
    const leftArm = BLENDER_HUMANOID_BONE_SPECS.find((s) => s.name === 'L_Hand')!
    const rightArm = BLENDER_HUMANOID_BONE_SPECS.find((s) => s.name === 'R_Hand')!
    const leftShoulder = BLENDER_HUMANOID_BONE_SPECS.find((s) => s.name === 'L_Shoulder')!
    const leftLeg = BLENDER_HUMANOID_BONE_SPECS.find((s) => s.name === 'L_UpLeg')!
    const rightLeg = BLENDER_HUMANOID_BONE_SPECS.find((s) => s.name === 'R_UpLeg')!
    expect(hips.head[2]).toBeCloseTo(0.5)
    expect(leftShoulder.head[2]).toBeCloseTo(0.8)
    expect(leftShoulder.head[2] - hips.head[2]).toBeGreaterThan(0.25)
    expect(leftArm.tail[0]).toBeGreaterThan(0.5)
    expect(rightArm.tail[0]).toBeLessThan(-0.5)
    expect(leftLeg.head[0]).toBeGreaterThan(0)
    expect(rightLeg.head[0]).toBeLessThan(0)
    const verdict = guardBlenderCode(BLENDER_HUMANOID_RIG_CODE)
    expect(verdict.ok, verdict.reason).toBe(true)
    expect(expandBlenderJobInstruction('rig', 'mixamo')).toContain('AIAE_HUMANOID_LANDMARKS')
  })

  it('parses Blender readback stdout and requires rigQa for overlay ready', () => {
    expect(guardBlenderCode(BLENDER_JOB_READBACK_CODE).ok).toBe(true)
    const stdout = blenderExecuteStdout({
      executed: true,
      result:
        'noise AIAE_JOB_META:{"ok":true,"rigMeta":{"armature":"Armature","bones":["Hips","Spine"],"vertexGroups":["Hips"]}} tail'
    })
    const meta = parseBlenderJobMetaLine(stdout, 'rig')
    expect(meta?.rigMeta?.bones).toEqual(['Hips', 'Spine'])
    expect(blenderJobOverlayReady('rig', meta!)).toBe(false)

    const withQa = {
      ...meta!,
      rigQa: {
        pass: true,
        attempt: 1,
        fingerprint: 'ok',
        boneCount: 2,
        requiredBonesOk: true,
        parentChainOk: true,
        vertexGroupCount: 1,
        unweightedRatio: 0.01,
        maxInfluences: 2,
        weightSumError: 0.01,
        zeroInfluenceBones: [],
        deformMeshes: ['Body'],
        bones: [],
        poseMetrics: [],
        fails: [],
        notes: []
      }
    }
    expect(blenderJobOverlayReady('rig', withQa)).toBe(true)
    expect(
      validateBlenderJobDelivery({ kind: 'rig', result: withQa, outputExists: true })
    ).toBeNull()

    const merged = mergeBlenderJobOverlay(
      { ok: false, kind: 'rig', error: 'GRAPH_MODEL_DSH_RESULT' },
      withQa
    )
    expect(merged.ok).toBe(true)
    expect(merged.rigQa?.pass).toBe(true)
  })
})
