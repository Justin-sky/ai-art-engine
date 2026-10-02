/**
 * OpenRouter Decisions 请求组装 / 响应归一化（纯函数，便于单测）。
 *
 * 协议：`POST {baseUrl}/alpha/decisions`
 * - 端点挂在 `https://openrouter.ai/api` 下，而本应用 Base URL 默认是 `https://openrouter.ai/api/v1`，
 *   所以实际路径是 `${baseUrl}/alpha/decisions`，与 `/models`、`/videos` 同一套拼接方式。
 * - 请求必填 `model` / `state` / `questions`；`state` 可以是字符串、对象或数组。
 * - 响应按问题名返回 typed answer：noul→概率、choice→选项+概率+confidence、score→加权位置+档位概率+legend。
 */

import type {
  DecisionAnswer,
  DecisionEvidenceItem,
  DecisionQuestionBody,
  DecisionRequestInput,
  DecisionResponse,
  GenerateDecisionsInput
} from '@shared/modelProvider'
import { toDecisionQuestionBodies } from '@shared/decisionQuestion'

/** 证据拼接：每条带 `标题 · 路径` 头，正文原样 */
function evidenceToText(evidence: DecisionEvidenceItem[]): string {
  const blocks: string[] = []
  for (const item of evidence) {
    const text = item.text?.trim()
    if (!text) continue
    const head = [item.title?.trim(), item.path?.trim()].filter(Boolean).join(' · ')
    blocks.push(head ? `## ${head}\n${text}` : text)
  }
  return blocks.join('\n\n')
}

function clampId(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  return trimmed.length > 256 ? trimmed.slice(0, 256) : trimmed
}

/**
 * 生成发往 Decisions API 的请求体（含 model）。
 * - 无 state 且无 evidence 时抛错（协议必填，且空状态无法判定）
 * - 问题清单先过 `toDecisionQuestionBodies`：无法组装的条目被丢弃，全丢时抛错
 * - 问题名沿用输入 key（与 bodies 同序），响应 answers 以它为 key
 * - sessionId / user 按协议截断到 256 字符；trace / provider 偏好不在本期范围
 */
export function buildDecisionsRequest(
  input: GenerateDecisionsInput,
  modelId: string
): DecisionRequestInput & { model: string } {
  const state = input.state ?? (input.evidence?.length ? evidenceToText(input.evidence) : undefined)
  if (state == null || (typeof state === 'string' && !state.trim())) {
    throw new Error('decisions: state is required (pass state or at least one evidence item)')
  }

  const entries = toDecisionQuestionBodies(input.questions ?? [])
  if (!entries.length) {
    throw new Error('decisions: at least one complete question is required')
  }

  const questions: Record<string, DecisionQuestionBody> = {}
  for (const entry of entries) {
    questions[entry.key] = entry.body
  }

  const sessionId = clampId(input.sessionId)
  const user = clampId(input.user)
  return {
    model: modelId,
    state,
    questions,
    ...(sessionId ? { sessionId } : {}),
    ...(user ? { user } : {})
  }
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return undefined
}

function asNumberRecord(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: Record<string, number> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const num = asNumber(raw)
    if (num != null) out[key] = num
  }
  return Object.keys(out).length ? out : undefined
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string') out[key] = raw
    else if (raw != null) out[key] = String(raw)
  }
  return Object.keys(out).length ? out : undefined
}

/** 概率最高项（并列时取字典序最小，保证结果可复现） */
function argmaxProbability(probabilities: Record<string, number>): string | undefined {
  let best: string | undefined
  let bestValue = Number.NEGATIVE_INFINITY
  for (const key of Object.keys(probabilities).sort()) {
    const value = probabilities[key]!
    if (value > bestValue) {
      bestValue = value
      best = key
    }
  }
  return best
}

/**
 * 归一化单条 answer。
 * - 未知 type：丢弃（返回 null），避免把上游新原语塞进既定联合类型
 * - choice：上游未返回 `choice` 时用 probabilities 兜底取最大项
 * - score：legend 的 key 是档位序号字符串
 */
export function normalizeDecisionAnswer(question: string, raw: unknown): DecisionAnswer | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const type = row.type
  if (type === 'noul') {
    const noul = asNumber(row.noul)
    if (noul == null) return null
    return { question, type: 'noul', noul }
  }
  if (type === 'choice') {
    const probabilities = asNumberRecord(row.probabilities)
    const choice =
      (typeof row.choice === 'string' && row.choice.trim()) ||
      (probabilities ? argmaxProbability(probabilities) : undefined)
    if (!choice) return null
    const confidence = asNumber(row.confidence)
    return {
      question,
      type: 'choice',
      choice,
      ...(confidence == null ? {} : { confidence }),
      ...(probabilities ? { probabilities } : {})
    }
  }
  if (type === 'score') {
    const score = asNumber(row.score)
    if (score == null) return null
    const confidence = asNumber(row.confidence)
    const probabilities = asNumberRecord(row.probabilities)
    const legend = asStringRecord(row.legend)
    return {
      question,
      type: 'score',
      score,
      ...(confidence == null ? {} : { confidence }),
      ...(probabilities ? { probabilities } : {}),
      ...(legend ? { legend } : {})
    }
  }
  return null
}

/** 归一化整个响应；缺 model 时用请求模型兜底 */
export function normalizeDecisionResponse(body: unknown, requestedModel: string): DecisionResponse {
  const row = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const rawAnswers = row.answers
  const answers: DecisionAnswer[] = []
  if (rawAnswers && typeof rawAnswers === 'object' && !Array.isArray(rawAnswers)) {
    for (const [question, raw] of Object.entries(rawAnswers as Record<string, unknown>)) {
      const normalized = normalizeDecisionAnswer(question, raw)
      if (normalized) answers.push(normalized)
    }
  }

  const usageRow =
    row.usage && typeof row.usage === 'object' ? (row.usage as Record<string, unknown>) : undefined
  const inputTokens = asNumber(usageRow?.input_tokens)
  const outputTokens = asNumber(usageRow?.output_tokens)
  const cost = asNumber(usageRow?.cost)

  return {
    ...(typeof row.id === 'string' ? { id: row.id } : {}),
    model: (typeof row.model === 'string' && row.model.trim()) || requestedModel,
    ...(typeof row.provider === 'string' ? { provider: row.provider } : {}),
    answers,
    ...(inputTokens == null && outputTokens == null && cost == null
      ? {}
      : {
          usage: {
            inputTokens: inputTokens ?? 0,
            outputTokens: outputTokens ?? 0,
            ...(cost == null ? {} : { cost })
          }
        })
  }
}
