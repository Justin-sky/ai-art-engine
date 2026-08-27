/**
 * 通用 Agent 编排层：可配置阶段表的状态机（规划 → 生成 → 质检 → 返工）。
 * 阶段顺序由调用方注入；导演/质检 PASS 推进、FAIL 回滚并记录原因，返工靠最近一次 FAIL 原因注入。
 */

/** 完成哨兵：推进到阶段表末尾后的状态值 */
export const AGENT_PIPELINE_COMPLETED = 'completed'

export interface AgentPipelineReview {
  step: string
  result: 'PASS' | 'FAIL'
  reason: string
  at: string
}

export interface AgentPipelineState {
  project_name: string
  current_step: string
  last_failed_reason: string
  output_files: Record<string, string>
  reviews?: AgentPipelineReview[]
  /** 固化阶段表（不含 completed），用于推进/回滚与解析 */
  stages: string[]
}

export interface CreateAgentPipelineStateInput {
  projectName: string
  /** 有序阶段表（不含 completed 哨兵） */
  stages: readonly string[]
  /** 各阶段产物落盘路径映射；缺省为 {} */
  outputFiles?: Record<string, string>
}

/** 创建初始状态：current_step 停在首阶段 */
export function createAgentPipelineState(input: CreateAgentPipelineStateInput): AgentPipelineState {
  const stages = [...input.stages]
  const projectName = input.projectName?.trim() || 'default'
  return {
    project_name: projectName,
    current_step: stages[0] ?? AGENT_PIPELINE_COMPLETED,
    last_failed_reason: '',
    output_files: { ...(input.outputFiles ?? {}) },
    stages
  }
}

/** 阶段表内推进：末尾之后返回 completed；未知阶段按 completed 处理 */
export function nextAgentPipelineStage(stages: readonly string[], step: string): string {
  const idx = stages.indexOf(step)
  if (idx < 0 || idx + 1 >= stages.length) return AGENT_PIPELINE_COMPLETED
  return stages[idx + 1]!
}

/**
 * 应用质检结论：PASS → 推进到下一阶段；FAIL → 回滚到该阶段并记录原因。
 * `step` 必须为阶段表内（不含 completed）的成员。
 */
export function applyAgentPipelineReview(
  state: AgentPipelineState,
  step: string,
  result: 'PASS' | 'FAIL',
  reason: string
): AgentPipelineState {
  const next: AgentPipelineState = {
    ...state,
    reviews: [...(state.reviews ?? [])]
  }
  next.reviews!.push({ step, result, reason: reason || '', at: new Date().toISOString() })
  if (result === 'PASS') {
    next.current_step = nextAgentPipelineStage(state.stages, step)
    next.last_failed_reason = ''
  } else {
    next.current_step = step
    next.last_failed_reason = reason || ''
  }
  return next
}

/**
 * 取某阶段最近的 FAIL 原因：仅当该阶段最近一次审核结论为 FAIL 时返回原因；
 * 最近一次已 PASS 则返回空，避免把已通过的历史 FAIL 反复附加进重跑提示词。
 */
export function agentFailReasonForStep(
  state: AgentPipelineState | null | undefined,
  step: string
): string {
  if (!state) return ''
  const last = [...(state.reviews ?? [])].reverse().find((review) => review.step === step)
  if (last?.result === 'FAIL' && last.reason) return last.reason
  return last?.reason ?? ''
}

/** 反序列化状态；缺省阶段表用入参 `stages`，否则回退到原文 `stages` */
export function parseAgentPipelineState(
  raw: string | null | undefined,
  stages: readonly string[]
): AgentPipelineState | null {
  if (!raw?.trim()) return null
  try {
    const parsed = JSON.parse(raw) as Partial<AgentPipelineState>
    if (typeof parsed.project_name !== 'string') return null
    const resolvedStages =
      Array.isArray(parsed.stages) && parsed.stages.length ? parsed.stages : [...stages]
    return {
      project_name: parsed.project_name,
      current_step:
        typeof parsed.current_step === 'string'
          ? parsed.current_step
          : (resolvedStages[0] ?? AGENT_PIPELINE_COMPLETED),
      last_failed_reason:
        typeof parsed.last_failed_reason === 'string' ? parsed.last_failed_reason : '',
      output_files:
        parsed.output_files && typeof parsed.output_files === 'object'
          ? (parsed.output_files as Record<string, string>)
          : {},
      ...(Array.isArray(parsed.reviews) ? { reviews: parsed.reviews } : {}),
      stages: resolvedStages
    }
  } catch {
    return null
  }
}

export function serializeAgentPipelineState(state: AgentPipelineState): string {
  return `${JSON.stringify(state, null, 2)}\n`
}
