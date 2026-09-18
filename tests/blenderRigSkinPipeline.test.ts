import { describe, expect, it } from 'vitest'
import { guardBlenderCode } from '../src/shared/blenderMcp'
import {
  BLENDER_HUMANOID_BIND_FROM_LANDMARKS_CODE,
  BLENDER_HUMANOID_LANDMARKS_CODE,
  BLENDER_RIG_QA_CODE,
  BLENDER_RIG_WEIGHT_REPAIR_CODE,
  buildRigRepairTaskHint,
  isRigQaPass,
  isTransientBlenderError,
  isTransientRigQa,
  parsePrefixedJson,
  parseRigQaReport,
  rigQaFingerprint,
  shouldContinueTransientQaRetry,
  shouldStopRigAttempts,
  summarizeRigQaForAgent,
  AIAE_RIG_QA_PREFIX
} from '../src/shared/blenderRigSkinPipeline'
import { BLENDER_HUMANOID_RIG_CODE } from '../src/shared/blenderHumanoidRig'

function sampleQa(overrides: Partial<ReturnType<typeof parseRigQaReport>> = {}) {
  const base = parseRigQaReport(
    {
      pass: true,
      boneCount: 21,
      requiredBonesOk: true,
      parentChainOk: true,
      vertexGroupCount: 21,
      unweightedRatio: 0.01,
      maxInfluences: 3,
      weightSumError: 0.02,
      zeroInfluenceBones: [],
      deformMeshes: ['Body'],
      bones: [{ name: 'Hips', parent: '', head: [0, 0, 1], tail: [0, 0, 1.1] }],
      poseMetrics: [{ name: 'arms_up', bboxGrowth: 1.1, spikeCount: 0, ok: true }],
      fails: []
    },
    1
  )!
  return { ...base, ...overrides }
}

describe('blenderRigSkinPipeline', () => {
  it('ships landmark / bind / qa / repair scripts that pass safe-mode', () => {
    for (const [name, code] of [
      ['landmarks', BLENDER_HUMANOID_LANDMARKS_CODE],
      ['bind', BLENDER_HUMANOID_BIND_FROM_LANDMARKS_CODE],
      ['qa', BLENDER_RIG_QA_CODE],
      ['repair', BLENDER_RIG_WEIGHT_REPAIR_CODE],
      ['pipeline', BLENDER_HUMANOID_RIG_CODE]
    ] as const) {
      const verdict = guardBlenderCode(code)
      expect(verdict.ok, `${name}: ${verdict.reason}`).toBe(true)
    }
    expect(BLENDER_HUMANOID_LANDMARKS_CODE).toContain('AIAE_LM_')
    expect(BLENDER_HUMANOID_LANDMARKS_CODE).toContain('landmarks_unreliable')
    expect(BLENDER_HUMANOID_BIND_FROM_LANDMARKS_CODE).toContain('missing landmark')
    expect(BLENDER_HUMANOID_BIND_FROM_LANDMARKS_CODE).toContain('ARMATURE_AUTO')
    expect(BLENDER_RIG_QA_CODE).toContain('POSE_EXPLODE')
    expect(BLENDER_RIG_QA_CODE).toContain('SAMPLE_CAP')
    expect(BLENDER_RIG_QA_CODE).toContain('bound_box')
    expect(BLENDER_RIG_QA_CODE).toContain('weight_sample_stride')
  })

  it('parses QA marker JSON and fingerprints fails', () => {
    const stdout = `${AIAE_RIG_QA_PREFIX}{"pass":false,"boneCount":2,"requiredBonesOk":false,"parentChainOk":true,"vertexGroupCount":0,"unweightedRatio":0.5,"maxInfluences":0,"weightSumError":1,"zeroInfluenceBones":[],"deformMeshes":[],"bones":[],"poseMetrics":[],"fails":[{"code":"MISSING_BONE","message":"missing Head","bone":"Head"}],"notes":[]}`
    const raw = parsePrefixedJson(stdout, AIAE_RIG_QA_PREFIX)
    const qa = parseRigQaReport(raw, 2)
    expect(qa).toBeTruthy()
    expect(qa!.pass).toBe(false)
    expect(qa!.attempt).toBe(2)
    expect(qa!.fails[0]?.code).toBe('MISSING_BONE')
    expect(qa!.fingerprint).toBe(rigQaFingerprint(qa!))
    expect(isRigQaPass(qa!)).toBe(false)
  })

  it('stops on pass or stuck fingerprint; unlimited attempts by default', () => {
    const pass = sampleQa({ pass: true, fails: [] })
    expect(shouldStopRigAttempts({ attempt: 1, qa: pass }).reason).toBe('pass')

    const fail = sampleQa({
      pass: false,
      fails: [{ code: 'UNWEIGHTED', message: 'bad' }],
      unweightedRatio: 0.2,
      fingerprint: 'x'
    })
    // 默认不设轮次上限
    expect(shouldStopRigAttempts({ attempt: 99, qa: fail }).stop).toBe(false)
    expect(shouldStopRigAttempts({ attempt: 3, qa: fail, maxAttempts: 3 }).reason).toBe(
      'max_attempts'
    )
    expect(
      shouldStopRigAttempts({
        attempt: 2,
        qa: fail,
        previousFingerprint: 'x',
        stuckStreak: 1
      }).reason
    ).toBe('stuck')
    expect(
      shouldStopRigAttempts({
        attempt: 1,
        qa: fail,
        previousFingerprint: 'other'
      }).stop
    ).toBe(false)
  })

  it('classifies MCP disconnects as transient and does not stuck on them', () => {
    expect(isTransientBlenderError('read ECONNRESET')).toBe(true)
    expect(isTransientBlenderError('waiting timed out')).toBe(false)
    const qa = sampleQa({
      pass: false,
      fails: [{ code: 'QA_TRANSIENT', message: 'read ECONNRESET' }],
      fingerprint: 'transient:read ECONNRESET',
      unweightedRatio: 1,
      boneCount: 0
    })
    expect(isTransientRigQa(qa)).toBe(true)
    expect(
      shouldStopRigAttempts({
        attempt: 2,
        qa,
        previousFingerprint: qa.fingerprint,
        stuckStreak: 2
      }).stop
    ).toBe(false)
    expect(buildRigRepairTaskHint(qa)).toContain('transient MCP')
    expect(shouldContinueTransientQaRetry(0)).toBe(true)
    expect(shouldContinueTransientQaRetry(99)).toBe(true)
    expect(shouldContinueTransientQaRetry(2, 3)).toBe(true)
    expect(shouldContinueTransientQaRetry(3, 3)).toBe(false)
  })
})
