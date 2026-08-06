/**
 * 剧集分镜 Agent 流水线状态机（agent-state.json）。
 * 结构对齐 v4.0 规范：current_step / last_failed_reason / output_files。
 */

export type EpisodePipelineStep =
  | 'breakdown'
  | 'beatboard'
  | 'sequence'
  | 'motion'
  | 'completed'

export const EPISODE_PIPELINE_STEPS: readonly EpisodePipelineStep[] = [
  'breakdown',
  'beatboard',
  'sequence',
  'motion',
  'completed'
]

export interface EpisodeAgentReview {
  step: Exclude<EpisodePipelineStep, 'completed'>
  result: 'PASS' | 'FAIL'
  reason: string
  at: string
}

export interface EpisodeAgentState {
  project_name: string
  current_step: EpisodePipelineStep
  last_failed_reason: string
  output_files: {
    breakdown: string
    beatboard: string
    sequence: string
    motion: string
  }
  reviews?: EpisodeAgentReview[]
}

export function createEpisodeAgentState(projectName: string, ep: string): EpisodeAgentState {
  const token = ep.trim() || 'ep01'
  return {
    project_name: projectName.trim() || token,
    current_step: 'breakdown',
    last_failed_reason: '',
    output_files: {
      breakdown: `outputs/beat-breakdown-${token}.md`,
      beatboard: `outputs/beat-board-prompt-${token}.md`,
      sequence: `outputs/sequence-board-prompt-${token}.md`,
      motion: `outputs/motion-prompt-${token}.md`
    }
  }
}

export function parseEpisodeAgentState(raw: string | null | undefined): EpisodeAgentState | null {
  if (!raw?.trim()) return null
  try {
    const parsed = JSON.parse(raw) as Partial<EpisodeAgentState>
    if (typeof parsed.project_name !== 'string') return null
    return {
      project_name: parsed.project_name,
      current_step: EPISODE_PIPELINE_STEPS.includes(parsed.current_step as EpisodePipelineStep)
        ? (parsed.current_step as EpisodePipelineStep)
        : 'breakdown',
      last_failed_reason: typeof parsed.last_failed_reason === 'string' ? parsed.last_failed_reason : '',
      output_files: {
        breakdown: parsed.output_files?.breakdown ?? '',
        beatboard: parsed.output_files?.beatboard ?? '',
        sequence: parsed.output_files?.sequence ?? '',
        motion: parsed.output_files?.motion ?? ''
      },
      ...(Array.isArray(parsed.reviews) ? { reviews: parsed.reviews } : {})
    }
  } catch {
    return null
  }
}

export function serializeEpisodeAgentState(state: EpisodeAgentState): string {
  return `${JSON.stringify(state, null, 2)}\n`
}

export function nextEpisodePipelineStep(step: Exclude<EpisodePipelineStep, 'completed'>): EpisodePipelineStep {
  const idx = EPISODE_PIPELINE_STEPS.indexOf(step)
  return EPISODE_PIPELINE_STEPS[idx + 1] ?? 'completed'
}

/**
 * 应用导演审核结论：
 * PASS → 推进 current_step；FAIL → 回滚到该步并记录原因。
 */
export function applyEpisodeAgentReview(
  state: EpisodeAgentState,
  step: Exclude<EpisodePipelineStep, 'completed'>,
  result: 'PASS' | 'FAIL',
  reason: string
): EpisodeAgentState {
  const next: EpisodeAgentState = {
    ...state,
    reviews: [...(state.reviews ?? [])]
  }
  next.reviews!.push({ step, result, reason: reason || '', at: new Date().toISOString() })
  if (result === 'PASS') {
    next.current_step = nextEpisodePipelineStep(step)
    next.last_failed_reason = ''
  } else {
    next.current_step = step
    next.last_failed_reason = reason || ''
  }
  return next
}

/**
 * 取某阶段最近的 FAIL 原因：
 * 优先当前步骤的 last_failed_reason，其次回退 reviews 里该阶段最近一次 FAIL。
 * 这样即使后续步骤被乱序推进，重跑该阶段仍能带上导演审核结果。
 */
export function episodeFailReasonForStep(
  state: EpisodeAgentState | null | undefined,
  step: string
): string {
  if (!state) return ''
  if (state.current_step === step && state.last_failed_reason) {
    return state.last_failed_reason
  }
  const last = [...(state.reviews ?? [])]
    .reverse()
    .find((review) => review.step === step && review.result === 'FAIL' && !!review.reason)
  return last?.reason ?? ''
}
