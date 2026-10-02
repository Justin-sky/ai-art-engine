/**
 * 判定问题的**结构化模型 + 与 DSL 文本的互转**（纯函数，UI 与主进程共用）。
 *
 * 为什么需要它：`decisionQuestions` 参数把「问题名 / 类型 / 问题 / 判定说明 / 选项 / 量表」
 * 全压在一行文本里，一共要学四套分隔符（`|` 分段、noul 用 `/` 拆是否、choice/score 用 `;`
 * 分项、选项再叠 `:` 写说明），而且解析失败是**静默丢行**。表单 UI 需要一份结构化模型来
 * 增删改，同时不能改存储格式（改了要迁移设置、老节点会失效）。
 *
 * 所以这里做单向的稳定互转：
 *   文本 ──parseDecisionQuestionsDetailed──▶ 结构化问题（顺带回报哪些行解析失败）
 *   结构化问题 ──stringifyDecisionQuestions──▶ 文本（仍是 DSL，agent / 高级用户可继续直写）
 *
 * 生成出来的文本可以被 `parseDecisionQuestions` 原样读回（往返稳定），
 * 这样表单「改一个字就重写整段文本」不会把用户的清单搅乱。
 */

import type { DecisionQuestionInput, DecisionQuestionType } from './modelProvider'
import {
  buildDecisionQuestion,
  isDecisionQuestionType,
  toDecisionQuestionBodies
} from './decisionQuestion'

/** 表单侧的问题模型：把 noul / choice / score 三种形态收在一张扁平结构里 */
export interface DecisionQuestionDraft {
  key: string
  type: DecisionQuestionType
  instructions: string
  /** noul：判「是」的说明 */
  yes: string
  /** noul：判「否」的说明 */
  no: string
  /** choice：选项（value 即响应 probabilities 的 key） */
  options: Array<{ value: string; description: string }>
  /** score：有序量表，index 0 = 最低档 */
  levels: Array<{ label: string; description: string }>
}

export interface DecisionQuestionsParseResult {
  questions: DecisionQuestionDraft[]
  /** 非空行里解析失败的行号（1-based），供 UI 标红；解析不了的行不会被静默吞掉 */
  failedLines: number[]
  /** 被跳过的注释行数 */
  commentLines: number
}

/** `DecisionQuestionInput` → 表单模型 */
export function draftFromQuestion(question: DecisionQuestionInput): DecisionQuestionDraft {
  return {
    key: question.key,
    type: question.type,
    instructions: question.instructions,
    yes: question.noulCriteria?.yes ?? '',
    no: question.noulCriteria?.no ?? '',
    options: (question.choices ?? []).map((item) => ({
      value: item.value,
      description: item.description ?? ''
    })),
    levels: (question.scale ?? []).map((item) => ({
      label: item.label,
      description: item.description ?? ''
    }))
  }
}

/**
 * DSL 文本 → 表单模型（**带失败行回报**）。
 *
 * 与 `parseDecisionQuestions` 的区别：后者是执行路径，解析不了就跳过；
 * 这里是编辑路径，必须把「哪一行没读懂」交回给 UI，否则用户只会看到
 * 自己写的问题凭空消失。
 */
export function parseDecisionQuestionsDetailed(raw: string): DecisionQuestionsParseResult {
  const questions: DecisionQuestionDraft[] = []
  const failedLines: number[] = []
  let commentLines = 0

  const lines = raw.split(/\r?\n/)
  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (!trimmed) return
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) {
      commentLines += 1
      return
    }
    const parts = trimmed.split('|').map((p) => p.trim())
    const [key, type] = parts
    if (!key || !isDecisionQuestionType(type)) {
      failedLines.push(index + 1)
      return
    }
    const detail = parts.slice(3).join(' | ').trim()
    questions.push(
      draftFromQuestion(buildDecisionQuestion({ key, type, instructions: parts[2] ?? '', detail }))
    )
  })

  return { questions, failedLines, commentLines }
}

/** 表单模型 → DSL 文本（产物可被 `parseDecisionQuestions` 原样读回） */
export function stringifyDecisionQuestions(drafts: DecisionQuestionDraft[]): string {
  return drafts
    .map((draft) => {
      const parts = [draft.key.trim() || 'q', draft.type, draft.instructions.trim()]
      if (draft.type === 'noul') {
        const yes = draft.yes.trim()
        const no = draft.no.trim()
        // 两段都在才用 `/` 拆；只写一段时原文即该段说明，避免凭空多出一个斜杠
        if (yes && no) parts.push(`${yes} / ${no}`)
        else if (yes) parts.push(yes)
        else if (no) parts.push(` / ${no}`)
        return parts.join(' | ')
      }
      if (draft.type === 'choice') {
        const items = draft.options
          .map((option) => {
            const value = option.value.trim()
            if (!value) return ''
            const description = option.description.trim()
            return description && description !== value ? `${value}:${description}` : value
          })
          .filter(Boolean)
        if (items.length) parts.push(items.join('; '))
        return parts.join(' | ')
      }
      const levels = draft.levels
        .map((level) => {
          const label = level.label.trim()
          if (!label) return ''
          const description = level.description.trim()
          return description && description !== label ? `${label}:${description}` : label
        })
        .filter(Boolean)
      if (levels.length) parts.push(levels.join('; '))
      return parts.join(' | ')
    })
    .join('\n')
}

/** 表单模型 → 执行用的问题清单（丢空 key / 空问题，与执行路径同口径） */
export function draftsToQuestions(drafts: DecisionQuestionDraft[]): DecisionQuestionInput[] {
  return drafts.map((draft) => {
    if (draft.type === 'noul') {
      return {
        key: draft.key.trim(),
        type: 'noul' as const,
        instructions: draft.instructions.trim() || draft.key.trim(),
        noulCriteria: {
          yes: draft.yes.trim() || 'The condition described by the question holds.',
          no: draft.no.trim() || 'The condition described by the question does not hold.'
        }
      }
    }
    if (draft.type === 'choice') {
      return {
        key: draft.key.trim(),
        type: 'choice' as const,
        instructions: draft.instructions.trim() || draft.key.trim(),
        choices: draft.options
          .map((option) => ({
            value: option.value.trim(),
            description: option.description.trim() || option.value.trim()
          }))
          .filter((option) => option.value)
      }
    }
    return {
      key: draft.key.trim(),
      type: 'score' as const,
      instructions: draft.instructions.trim() || draft.key.trim(),
      scale: draft.levels
        .map((level) => ({
          label: level.label.trim(),
          description: level.description.trim() || level.label.trim()
        }))
        .filter((level) => level.label)
    }
  })
}

/** 新建一条问题的默认草稿：key 自动避让已有名字，用户少填一格 */
export function createDecisionQuestionDraft(
  type: DecisionQuestionType,
  existingKeys: readonly string[]
): DecisionQuestionDraft {
  const taken = new Set(existingKeys.map((key) => key.trim()))
  let index = 1
  while (taken.has(`q${index}`)) index += 1
  return {
    key: `q${index}`,
    type,
    instructions: '',
    yes: '',
    no: '',
    options:
      type === 'choice'
        ? [
            { value: 'a', description: '' },
            { value: 'b', description: '' }
          ]
        : [],
    levels:
      type === 'score'
        ? [
            { label: '', description: '' },
            { label: '', description: '' }
          ]
        : []
  }
}

/** 切类型时补齐该类型必需的格子（保留已填内容，不丢用户输入） */
export function withDecisionQuestionType(
  draft: DecisionQuestionDraft,
  type: DecisionQuestionType
): DecisionQuestionDraft {
  const next: DecisionQuestionDraft = { ...draft, type }
  if (type === 'choice' && next.options.length < 2) {
    next.options = [...next.options, ...createDecisionQuestionDraft('choice', []).options]
  }
  if (type === 'score' && next.levels.length < 2) {
    next.levels = [...next.levels, ...createDecisionQuestionDraft('score', []).levels]
  }
  return next
}

/** 一条问题是否已填够（用于表单校验提示，不阻止保存） */
export function decisionQuestionIssues(draft: DecisionQuestionDraft): string[] {
  const issues: string[] = []
  if (!draft.key.trim()) issues.push('missingKey')
  if (!draft.instructions.trim()) issues.push('missingInstructions')
  if (draft.type === 'choice' && !draft.options.some((option) => option.value.trim())) {
    issues.push('missingOptions')
  }
  if (draft.type === 'score' && !draft.levels.some((level) => level.label.trim())) {
    issues.push('missingLevels')
  }
  return issues
}

/** 表单模式预览的产物 */
export interface DecisionRequestPreview {
  /** 可直接展示的文本（问题名 + 即将发给模型的问题定义） */
  text: string
  /** 会真正发给模型的问题名 */
  includedKeys: string[]
  /** 会被执行路径丢掉的问题名（缺问题名 / 缺选项…），预览里单独标出来 */
  droppedKeys: string[]
}

/**
 * 表单 → 「即将发送的判定问题」预览。
 *
 * 为什么不直接展示 DSL 原文：文本模式的预览已经能看到原文。表单模式真正的价值是
 * **暴露会被悄悄丢掉的问题** —— `toDecisionQuestionBodies` 会丢弃缺问题名 / 缺选项的条目，
 * 表单上看着填了、实际根本没发出去，是最难查的一类问题。
 *
 * state（上游正文 / 节点文本）运行时才有，这里用一行说明带过，不假装能预览。
 */
export function buildDecisionRequestPreview(
  drafts: DecisionQuestionDraft[],
  options: { model?: string; omittedNote: string; emptyText: string }
): DecisionRequestPreview {
  const bodies = toDecisionQuestionBodies(draftsToQuestions(drafts))
  const includedKeys = bodies.map((entry) => entry.key)
  const included = new Set(includedKeys)
  const droppedKeys = drafts
    .map((draft) => draft.key.trim() || '(unnamed)')
    .filter((key) => !included.has(key))

  if (!bodies.length) {
    return { text: options.emptyText, includedKeys, droppedKeys }
  }

  const payload = {
    ...(options.model?.trim() ? { model: options.model.trim() } : {}),
    questions: Object.fromEntries(bodies.map((entry) => [entry.key, entry.body]))
  }
  return {
    text: [JSON.stringify(payload, null, 2), '', options.omittedNote].join('\n'),
    includedKeys,
    droppedKeys
  }
}
