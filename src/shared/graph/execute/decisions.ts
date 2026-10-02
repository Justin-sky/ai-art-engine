/**
 * 决策判定节点（`decisions.judge`）：调 OpenRouter 决策模型（TypeSafe Jev / Liquid D1 等）
 * 对上游文本 / 资产上下文回答一组带概率的类型化问题，把结论落成文本产物。
 *
 * 与文本节点的区别：决策模型不产出可读文案，只回 typed answer；
 * 因此节点把「判定结论摘要」写进 text 产物（保住下游文本链路），
 * 完整结论（含各档概率）留在 `node.params.decisionVerdicts`，供 Inspector / 卡片读取。
 */

import type { GenerateDecisionsInput } from '../../modelProvider'
import type { GraphValue } from '../types'
import type { NodeExecuteContext } from './types'
import { fail } from '@shared/errors/appError'
import { SHARED_ERRORS } from '../../errors/catalog'
import { resolveMentionSources } from './context'
import { autoIncomingTextForInstruction, selectIncomingValuesForInstruction } from './incoming'
import { flattenAssetValues, flattenTextValues } from './gallery'
import { persistScreenplayGeneration } from './materialize'
import {
  DEFAULT_NOUL_YES_THRESHOLD,
  describeDecisionVerdicts,
  parseDecisionQuestions,
  resolveDecisionVerdicts
} from '../../decisionQuestion'

/**
 * 决策结论是人类可读的短文本：`is_bug=no(0.12) team=payments(0.84)`。
 *
 * 为什么**不再**单独出结构化 JSON 口：
 * - 结论已经落在 `node.params.decisionVerdicts`，Inspector 与卡片直接读它，不需要过端口；
 * - 图引擎没有条件执行，下游拿到 JSON 也没法用字段做分支（`@n` 展开只是把正文插进提示词）；
 * - 本仓库的结构化数据惯例是**走节点参数**：`ui.split` 的 JSON 留自身 params、
 *   `media.review` 的 PASS/FAIL 回标 `mediaReviewStatus` 供下游读——没有「JSON 过文本口」的先例；
 * - 反而有副作用：文本节点在未写 `@` 时会把所有上游正文自动追加进提示词，
 *   于是挂上这条 JSON 边会把原文 JSON 默默灌进下游 prompt。
 */
function verdictSummary(ctx: NodeExecuteContext, summary: string): string {
  const title = ctx.node.title?.trim() || ctx.node.typeId
  const head = ctx.locale?.startsWith('en') ? 'Decisions' : '决策判定'
  return [`${head} · ${title}`, summary].join('\n')
}

export async function executeDecisionsJudgeNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const instructionRaw = node.params.decisionQuestions?.trim() ?? ''
  const questions = parseDecisionQuestions(instructionRaw)
  if (!questions.length) {
    throw new Error('GRAPH_DECISIONS_NO_QUESTIONS')
  }

  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  // 待判定内容：上游连进来的文本 / 资产说明优先，其次节点自己的 text 参数
  const mentionSources = resolveMentionSources(ctx)
  const selected = selectIncomingValuesForInstruction(ctx, instructionRaw)
  const incomingText = autoIncomingTextForInstruction(instructionRaw, selected, mentionSources)
  const upstreamText = flattenTextValues(selected)
    .map((value) => value.text.trim())
    .filter(Boolean)
    .join('\n\n')
  const hints = flattenAssetValues(selected)
    .map((asset) => [asset.title, asset.label, asset.notes].filter(Boolean).join(' · '))
    .filter(Boolean)
    .join('\n')
  const state = [incomingText, upstreamText, hints, node.params.text?.trim() ?? '']
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n\n')
  if (!state) {
    throw new Error('GRAPH_PROCESS_NO_INPUT')
  }

  if (!ctx.generateDecisions) {
    // 未接通决策模型（浏览器预览 / 未注入能力缝）时不做静默降级：判定结果无法伪造。
    // 这条刻意排在「没输入」之后：接线漏了是开发期问题，而没连上游是用户当场能改的，
    // 让后者先报出来，避免把「忘连线」误诊成「功能没接通」。
    throw new Error('GRAPH_DECISIONS_UNAVAILABLE')
  }

  const thresholds = {
    noulYes: node.params.decisionNoulYesThreshold ?? DEFAULT_NOUL_YES_THRESHOLD,
    ...(node.params.decisionChoiceMinConfidence == null
      ? {}
      : { choiceMinConfidence: node.params.decisionChoiceMinConfidence }),
    ...(node.params.decisionScoreMin == null ? {} : { scoreMin: node.params.decisionScoreMin })
  }
  const input: GenerateDecisionsInput = {
    state,
    questions,
    thresholds,
    ...(node.params.generateModel ? { model: node.params.generateModel } : {}),
    ...(node.params.generateProviderInstanceId
      ? { providerInstanceId: node.params.generateProviderInstanceId }
      : {})
  }

  const result = await ctx.generateDecisions(input)
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  // 结论优先用门面算好的 verdicts；缺失时按阈值本地兜底，保证节点一定有可读输出
  const verdicts = result.verdicts?.length
    ? result.verdicts
    : resolveDecisionVerdicts(result.answers, thresholds)
  if (!verdicts.length) {
    throw fail(SHARED_ERRORS.resultMissing, {
      what: { zh: '决策答案', en: 'decision answers' } // cjk-ok 双语错误数据（zh/en，由 errors/catalog 统一格式化）
    })
  }
  const summary = result.summary?.trim() || describeDecisionVerdicts(verdicts)

  // 结论写回节点参数：卡片 / 检查器不展开 text 产物也能看到上次判定
  const params = {
    ...node.params,
    decisionVerdicts: verdicts,
    decisionModelUsed: result.model,
    ...(result.provider ? { decisionProvider: result.provider } : {})
  }
  node.params = params

  const outputs = await persistScreenplayGeneration(ctx, verdictSummary(ctx, summary))
  // persistScreenplayGeneration 只 patch text / generatedTexts / selectedTextId，
  // 这里把判定字段一起补上（同一个节点，后写不冲突）
  ctx.patchNode?.({
    params: {
      decisionVerdicts: verdicts,
      decisionModelUsed: result.model,
      ...(result.provider ? { decisionProvider: result.provider } : {})
    }
  })
  return outputs
}
