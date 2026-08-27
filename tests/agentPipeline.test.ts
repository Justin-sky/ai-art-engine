import { describe, expect, it } from 'vitest'
import {
  AGENT_PIPELINE_COMPLETED,
  agentFailReasonForStep,
  applyAgentPipelineReview,
  createAgentPipelineState,
  nextAgentPipelineStage,
  parseAgentPipelineState,
  serializeAgentPipelineState
} from '../src/shared/graph'

const STAGES = ['plan', 'generate', 'review'] as const

describe('agent pipeline state machine', () => {
  it('creates initial state at the first stage', () => {
    const state = createAgentPipelineState({
      projectName: 'p01',
      stages: STAGES,
      outputFiles: { plan: 'out/plan.md' }
    })
    expect(state.current_step).toBe('plan')
    expect(state.last_failed_reason).toBe('')
    expect(state.stages).toEqual([...STAGES])
    expect(state.output_files.plan).toBe('out/plan.md')
  })

  it('advances stage and completes past the end', () => {
    expect(nextAgentPipelineStage(STAGES, 'plan')).toBe('generate')
    expect(nextAgentPipelineStage(STAGES, 'generate')).toBe('review')
    expect(nextAgentPipelineStage(STAGES, 'review')).toBe(AGENT_PIPELINE_COMPLETED)
    expect(nextAgentPipelineStage(STAGES, 'unknown')).toBe(AGENT_PIPELINE_COMPLETED)
  })

  it('advances on PASS and rolls back on FAIL with reason', () => {
    const initial = createAgentPipelineState({ projectName: 'p01', stages: STAGES })
    const passed = applyAgentPipelineReview(initial, 'plan', 'PASS', '')
    expect(passed.current_step).toBe('generate')
    expect(passed.last_failed_reason).toBe('')
    const failed = applyAgentPipelineReview(passed, 'generate', 'FAIL', '主体不一致')
    expect(failed.current_step).toBe('generate')
    expect(failed.last_failed_reason).toBe('主体不一致')
    expect(failed.reviews?.length).toBe(2)
    expect(failed.reviews?.[1]).toMatchObject({ step: 'generate', result: 'FAIL', reason: '主体不一致' })
  })

  it('returns the latest FAIL reason for a step, empty after PASS', () => {
    let state = createAgentPipelineState({ projectName: 'p01', stages: STAGES })
    state = applyAgentPipelineReview(state, 'generate', 'FAIL', '主体不一致')
    state = applyAgentPipelineReview(state, 'review', 'PASS', '')
    expect(agentFailReasonForStep(state, 'generate')).toBe('主体不一致')
    state = applyAgentPipelineReview(state, 'generate', 'PASS', '')
    expect(agentFailReasonForStep(state, 'generate')).toBe('')
    expect(agentFailReasonForStep(state, 'plan')).toBe('')
  })

  it('round-trips through parse/serialize', () => {
    const state = createAgentPipelineState({ projectName: 'p01', stages: STAGES })
    const advanced = applyAgentPipelineReview(state, 'plan', 'PASS', '')
    const raw = serializeAgentPipelineState(advanced)
    const parsed = parseAgentPipelineState(raw, STAGES)
    expect(parsed).not.toBeNull()
    expect(parsed!.current_step).toBe('generate')
    expect(parsed!.stages).toEqual([...STAGES])
    expect(parsed!.reviews?.length).toBe(1)
  })

  it('rejects malformed state JSON', () => {
    expect(parseAgentPipelineState('not json', STAGES)).toBeNull()
    expect(parseAgentPipelineState('{}', STAGES)).toBeNull()
  })
})
