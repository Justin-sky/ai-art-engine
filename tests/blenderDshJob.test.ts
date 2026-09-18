import { describe, expect, it } from 'vitest'
import { guardBlenderCode } from '../src/shared/blenderMcp'
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
    expect(brief).toContain('Do not loop execute_blender_code')

    const task = buildBlenderJobTask(input)
    expect(task).toContain('Use skill "blender.pose"')
    expect(task).toContain('export_scene')
    expect(task).toContain('idle stand')
    expect(task).toContain('Do not guess joint angles')

    const rigTask = buildBlenderJobTask({ ...input, kind: 'rig', skillId: 'blender.rigSkin' })
    expect(rigTask).toContain('Create a real armature now')
    expect(rigTask).toContain('Do not screenshot-loop')
  })

  it('expands a short 人形骨架 chip into the 21-bone recipe', () => {
    const expanded = expandBlenderJobInstruction('rig', '人形骨架')
    expect(expanded).toContain('人形骨架')
    expect(expanded).toContain('Hips')
    expect(expanded).toContain('ARMATURE_AUTO')
    expect(buildBlenderJobTask({
      kind: 'rig',
      instruction: '人形骨架',
      inputAbs: 'a',
      outputAbs: 'b',
      resultAbs: 'c',
      skillId: 'blender.rigSkin'
    })).toContain('L_UpperArm')
  })

  it('expands stacked 人形骨架 + 人形简单骨架 chip text once', () => {
    const stacked =
      '人形骨架\n人形简单骨架：根骨 + 脊柱链（髋/胸/颈/头）+ 双手臂（肩/上臂/前臂/手）+ 双腿（上腿/下腿/脚），共 21 根骨头，适合人型角色基础动画。'
    const expanded = expandBlenderJobInstruction('rig', stacked)
    expect(expanded).toContain('Expanded recipe (humanoid-simple, 21 bones)')
    expect(expanded).toContain('Hips')
    expect(expanded).toContain('L_UpperArm')
    expect(expanded).not.toContain('prop-rigid')
    expect(expanded.match(/Expanded recipe/g)?.length ?? 0).toBe(1)

    const already =
      '人形简单骨架，共 21 骨：Hips（根）→ Spine。parent_set(ARMATURE_AUTO)。'
    expect(expandBlenderJobInstruction('rig', already)).toBe(already)

    const prop = expandBlenderJobInstruction('rig', '道具单骨骨架：只有一根 Root 骨')
    expect(prop).toContain('prop-rigid')
    expect(prop).not.toContain('humanoid-simple')
  })

  it('parses Blender readback stdout and merges a missing overlay', () => {
    expect(guardBlenderCode(BLENDER_JOB_READBACK_CODE).ok).toBe(true)
    const stdout = blenderExecuteStdout({
      executed: true,
      result: 'noise AIAE_JOB_META:{"ok":true,"rigMeta":{"armature":"Armature","bones":["Hips","Spine"],"vertexGroups":["Hips"]}} tail'
    })
    const meta = parseBlenderJobMetaLine(stdout, 'rig')
    expect(meta?.rigMeta?.bones).toEqual(['Hips', 'Spine'])
    expect(blenderJobOverlayReady('rig', meta!)).toBe(true)

    const merged = mergeBlenderJobOverlay(
      { ok: false, kind: 'rig', error: 'GRAPH_MODEL_DSH_RESULT' },
      meta
    )
    expect(merged.ok).toBe(true)
    expect(merged.error).toBeUndefined()
    expect(merged.rigMeta?.bones).toEqual(['Hips', 'Spine'])
    expect(
      validateBlenderJobDelivery({ kind: 'rig', result: merged, outputExists: true })
    ).toBeNull()
  })
})
