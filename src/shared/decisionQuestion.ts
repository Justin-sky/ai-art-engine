/**
 * 决策问题的纯解析 / 判定辅助（无 IO）。
 *
 * UI（节点参数）、MCP 工具与主进程共用：
 * - 多行文本 → 问题清单（`名称 | 类型 | 问题 | 判定说明/选项`）
 * - 答案 + 阈值 → 可直接分支的判定结论
 *
 * 上游协议见 `@shared/modelProvider` 的 DecisionRequestInput / DecisionResponse。
 */

import type {
  ChoiceDecisionVerdict,
  DecisionAnswer,
  DecisionQuestionBody,
  DecisionQuestionInput,
  DecisionQuestionType,
  DecisionThresholds,
  DecisionVerdict,
  NoulDecisionVerdict,
  ScoreDecisionVerdict
} from './modelProvider'

/** noul 默认阈值：概率 ≥ 0.5 视为“是” */
export const DEFAULT_NOUL_YES_THRESHOLD = 0.5

const QUESTION_TYPES: readonly DecisionQuestionType[] = ['noul', 'choice', 'score']

export function isDecisionQuestionType(value: unknown): value is DecisionQuestionType {
  return typeof value === 'string' && (QUESTION_TYPES as readonly string[]).includes(value)
}

/**
 * 一行一个问题：`名称 | 类型 | 问题 | 判定说明`。
 * - noul：第 4 段用 `是说明 / 否说明` 拆成 true / false（缺省给通用说明，协议要求两者必填）
 * - choice：第 4 段为选项，`;` 或 `,` 分隔；每项可写 `值:说明`
 * - score：第 4 段为有序量表（低→高），`;` 或 `,` 分隔；每项可写 `标签:说明`
 */
export function parseDecisionQuestions(raw: string): DecisionQuestionInput[] {
  const out: DecisionQuestionInput[] = []
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    // 允许 # / // 开头的注释行，便于参数框里标注
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue
    const parts = trimmed.split('|').map((p) => p.trim())
    const [key, type, instructions] = parts
    if (!key || !isDecisionQuestionType(type)) continue
    // 第 4 段之后可能还有 `|`（说明里写竖线）：用 ' | ' 还原，避免被拆散后粘连
    const detail = parts.slice(3).join(' | ').trim()
    out.push(buildDecisionQuestion({ key, type, instructions: instructions ?? '', detail }))
  }
  return out
}

/** 由「名称 / 类型 / 问题 / 判定说明」四段构造一条问题（UI 与解析共用） */
export function buildDecisionQuestion(input: {
  key: string
  type: DecisionQuestionType
  instructions: string
  /** noul: `是说明 / 否说明`；choice / score: 选项或量表，`;` `,` 或换行分隔 */
  detail?: string
}): DecisionQuestionInput {
  const key = input.key.trim()
  const instructions = input.instructions.trim()
  const detail = (input.detail ?? '').trim()

  if (input.type === 'noul') {
    // 先按 `/` 拆是/否说明；只有一段时该段作为“是”的说明
    const halves = detail.split('/').map((s) => s.trim())
    const yes = halves[0] ?? ''
    const no = halves.slice(1).join('/').trim()
    return {
      key,
      type: 'noul',
      instructions: instructions || key,
      noulCriteria: {
        yes: yes || 'The condition described by the question holds.',
        no: no || 'The condition described by the question does not hold.'
      }
    }
  }

  const items = splitDecisionItems(detail)
  if (input.type === 'choice') {
    return { key, type: 'choice', instructions: instructions || key, choices: items }
  }
  return { key, type: 'score', instructions: instructions || key, scale: items }
}

/** 按换行 / `;` / `,` 拆分选项或量表项；每项支持 `值:说明` */
function splitDecisionItems(
  raw: string
): Array<{ value: string; label: string; description?: string }> {
  if (!raw) return []
  return raw
    .split(/[\n;,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const sep = item.indexOf(':')
      if (sep <= 0) return { value: item, label: item }
      return {
        value: item.slice(0, sep).trim(),
        label: item.slice(0, sep).trim(),
        description: item.slice(sep + 1).trim() || undefined
      }
    })
}

/**
 * 把问题清单转成上游请求体形状，并保留问题名。
 * - noul：协议要求 true / false 两种情形都给出说明，缺失处补通用说明
 * - choice：criteria 为「选项 → 说明」映射，选项名即响应 probabilities 的 key
 * - score：criteria 为有序数组，index 0 = 最低档
 * 返回值与入参同序；无法组装的条目被丢弃（调用方需保证至少一条）。
 */
export function toDecisionQuestionBodies(
  questions: DecisionQuestionInput[]
): Array<{ key: string; body: DecisionQuestionBody }> {
  const out: Array<{ key: string; body: DecisionQuestionBody }> = []
  for (const q of questions) {
    const key = q.key.trim()
    const instructions = q.instructions.trim()
    if (!key || !instructions) continue
    if (q.type === 'noul') {
      out.push({
        key,
        body: {
          type: 'noul',
          instructions,
          criteria: {
            true: q.noulCriteria?.yes?.trim() || 'The condition holds.',
            false: q.noulCriteria?.no?.trim() || 'The condition does not hold.'
          }
        }
      })
      continue
    }
    if (q.type === 'choice') {
      const criteria: Record<string, string> = {}
      for (const c of q.choices ?? []) {
        const value = c.value.trim()
        if (value) criteria[value] = c.description?.trim() || value
      }
      if (!Object.keys(criteria).length) continue
      out.push({ key, body: { type: 'choice', instructions, criteria } })
      continue
    }
    const scale = (q.scale ?? []).map((s) => s.label.trim()).filter(Boolean)
    if (!scale.length) continue
    out.push({ key, body: { type: 'score', instructions, criteria: scale } })
  }
  return out
}

/** noul 判定结论（与 provider 层共用同一形状，见 @shared/modelProvider） */
export type NoulVerdict = NoulDecisionVerdict
/** choice 判定结论 */
export type ChoiceVerdict = ChoiceDecisionVerdict
/** score 判定结论 */
export type ScoreVerdict = ScoreDecisionVerdict

/**
 * 答案 → 可直接分支的判定结论。
 * noul 用 `thresholds.noulYes`（缺省 0.5）；choice 用 `choiceMinConfidence`；
 * score 用 `scoreMin`。未设阈值的项对应字段恒为 true，便于调用方统一 `.confident`。
 */
export function resolveDecisionVerdicts(
  answers: DecisionAnswer[],
  thresholds?: DecisionThresholds
): DecisionVerdict[] {
  const noulThreshold = thresholds?.noulYes ?? DEFAULT_NOUL_YES_THRESHOLD
  const out: DecisionVerdict[] = []
  for (const a of answers) {
    if (a.type === 'noul' && typeof a.noul === 'number') {
      out.push({
        type: 'noul',
        question: a.question,
        probability: a.noul,
        verdict: a.noul >= noulThreshold,
        threshold: noulThreshold
      })
      continue
    }
    if (a.type === 'choice' && a.choice) {
      const threshold = thresholds?.choiceMinConfidence
      out.push({
        type: 'choice',
        question: a.question,
        choice: a.choice,
        confidence: a.confidence ?? 0,
        confident: threshold == null ? true : (a.confidence ?? 0) >= threshold,
        probabilities: a.probabilities ?? {},
        ...(threshold == null ? {} : { threshold })
      })
      continue
    }
    if (a.type === 'score' && typeof a.score === 'number') {
      const threshold = thresholds?.scoreMin
      out.push({
        type: 'score',
        question: a.question,
        score: a.score,
        ...(a.confidence == null ? {} : { confidence: a.confidence }),
        aboveThreshold: threshold == null ? true : a.score >= threshold,
        probabilities: a.probabilities ?? {},
        legend: a.legend ?? {},
        ...(threshold == null ? {} : { threshold })
      })
    }
  }
  return out
}

/** 汇总一句话结论，便于日志 / 节点输出展示（如 `is_bug=否(0.12) team=payments(0.84)`） */
export function describeDecisionVerdicts(verdicts: DecisionVerdict[]): string {
  return verdicts
    .map((v) => {
      if (v.type === 'noul') {
        return `${v.question}=${v.verdict ? 'yes' : 'no'}(${v.probability.toFixed(2)})`
      }
      if (v.type === 'choice') {
        return `${v.question}=${v.choice}(${v.confidence.toFixed(2)})`
      }
      return `${v.question}=${v.score.toFixed(2)}`
    })
    .join(' ')
}
