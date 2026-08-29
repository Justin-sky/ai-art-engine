/**
 * 媒体质检 / 返工的双语提示词文案。
 * 与 agentPrompts.ts 同属「双语域数据」：不走 vue-i18n，已登记 check-hardcoded-cjk 豁免清单。
 * 仅存放交给模型的提示词文本；错误与界面文案仍走 errors/catalog 与 vue-i18n。
 */

/**
 * 输入身份标注：质检模型必须分清「参考图」与「待审产物」，
 * 否则「与参考图一致」这条硬性检查无法执行（改造前正是如此）。
 */
export const MEDIA_REVIEW_INPUT_GUIDE_ZH = `输入图片按顺序编号，身份如下（务必严格区分）：
- 标注为「参考图」的：作为风格与主体的比对基准，本身不是审核对象，不作为审核对象评分。
- 标注为「待审产物」的：这才是审核对象，只针对它评分与判定。
一致性维度必须拿「待审产物」与「参考图」逐项比对后打分，不得跳过。`

export const MEDIA_REVIEW_INPUT_GUIDE_EN = `Input images are numbered in order with the following identities (distinguish them strictly):
- Those labeled "reference": the baseline for style and subject comparison. They are NOT the review target and must not be scored.
- Those labeled "artifact under review": this is the review target; score and judge only this one.
For the consistency dimension you must compare the artifact against the references item by item before scoring. Never skip it.`

/** 单张入参的身份前缀（注入提示词，与图片顺序一一对应） */
export const MEDIA_REVIEW_ROLE_REFERENCE_ZH = '参考图'
export const MEDIA_REVIEW_ROLE_REFERENCE_EN = 'reference'
export const MEDIA_REVIEW_ROLE_ARTIFACT_ZH = '待审产物'
export const MEDIA_REVIEW_ROLE_ARTIFACT_EN = 'artifact under review'

/**
 * 生成指令块：把「当初让它生成什么」交给质检模型作为比对依据。
 * 没有这段，模型只能凭画面主观判断，无法核对「是否符合原始意图」。
 */
export function mediaReviewSpecBlock(spec: string, locale?: string): string {
  const text = (spec ?? '').trim()
  if (!text) return ''
  const english = (locale ?? '').toLowerCase().startsWith('en')
  return english
    ? `\n\n[Generation instruction] ${text}`
    : `\n\n【生成指令】${text}`
}

/** 输入身份块：逐张标注 @n 是参考图还是待审产物，并附比对说明 */
export function mediaReviewIdentityBlock(
  roles: readonly ('reference' | 'artifact')[],
  locale?: string
): string {
  if (!roles.length) return ''
  const english = (locale ?? '').toLowerCase().startsWith('en')
  const lines = roles.map((role, index) => {
    const label =
      role === 'reference'
        ? english
          ? MEDIA_REVIEW_ROLE_REFERENCE_EN
          : MEDIA_REVIEW_ROLE_REFERENCE_ZH
        : english
          ? MEDIA_REVIEW_ROLE_ARTIFACT_EN
          : MEDIA_REVIEW_ROLE_ARTIFACT_ZH
    return `@${index + 1} ${label}`
  })
  const header = english ? '[Input image roles]' : '【输入图片身份】'
  const guide = english ? MEDIA_REVIEW_INPUT_GUIDE_EN : MEDIA_REVIEW_INPUT_GUIDE_ZH
  return `${header}\n${lines.join('\n')}\n\n${guide}`
}

/** 已由程序判定的客观指标块：避免模型重复判定，也避免它凭感觉推翻硬指标 */
export function mediaReviewObjectiveBlock(issues: readonly string[], locale?: string): string {
  const list = (issues ?? []).filter(Boolean)
  if (!list.length) return ''
  const english = (locale ?? '').toLowerCase().startsWith('en')
  const header = english ? '[Hard metrics already failed]' : '【已判定不达标的硬性指标】'
  const guide = english ? MEDIA_OBJECTIVE_GUIDE_EN : MEDIA_OBJECTIVE_GUIDE_ZH
  return `${header}\n${list.map((item) => `- ${item}`).join('\n')}\n${guide}`
}

/** 客观校验项说明：不经过模型即可判定的硬指标，先行拦截以省下视觉模型调用 */
export const MEDIA_OBJECTIVE_GUIDE_ZH = `以下为已由程序判定的硬性指标，无需你重复判定，直接计入结论。`
export const MEDIA_OBJECTIVE_GUIDE_EN = `The hard metrics below were already verified programmatically. Do not re-judge them; fold them into the verdict directly.`

/**
 * 客观校验失败原因文案（注入返工提示词，供生图模型针对性修正）。
 * 技术描述保持 ASCII，避免污染 CJK 守卫。
 */
export function mediaObjectiveIssueText(
  code: 'count-mismatch' | 'aspect-ratio-mismatch' | 'resolution-too-low',
  detail: string,
  locale?: string
): string {
  const english = (locale ?? '').toLowerCase().startsWith('en')
  const detailText = detail ? ` (${detail})` : ''
  if (code === 'count-mismatch') {
    return english
      ? `Image count does not match the requirement${detailText}.`
      : `图片数量不符合要求${detailText}。`
  }
  if (code === 'aspect-ratio-mismatch') {
    return english
      ? `Aspect ratio does not match the requirement${detailText}.`
      : `画面宽高比不符合要求${detailText}。`
  }
  return english
    ? `Resolution is below the required minimum${detailText}.`
    : `分辨率低于要求下限${detailText}。`
}

/** 返工策略提示：按失败轮次升级，避免每轮都用同一句话重抽卡 */
export const MEDIA_REWORK_STRATEGY_HINT_ZH: Record<'guidance' | 'reseed' | 'stronger', string> = {
  guidance: '针对性修正上一轮的问题，其余部分尽量保持不变。',
  reseed: '换一种构图与镜头重新演绎，同时必须满足上一轮指出的修正要求。',
  stronger: '重新理解原始意图，优先保证主体、结构与构图的正确性，再追求风格细节。'
}

export const MEDIA_REWORK_STRATEGY_HINT_EN: Record<'guidance' | 'reseed' | 'stronger', string> = {
  guidance: 'Fix the issues raised last round; keep everything else as close as possible.',
  reseed: 'Re-stage with a different composition and camera angle, while still satisfying the fixes raised last round.',
  stronger: 'Re-read the original intent; prioritize correctness of subject, structure and composition before style detail.'
}

/** 按界面语言取策略提示 */
export function pickMediaReworkStrategyHint(
  strategy: 'guidance' | 'reseed' | 'stronger',
  locale?: string
): string {
  const english = (locale ?? '').toLowerCase().startsWith('en')
  const table = english ? MEDIA_REWORK_STRATEGY_HINT_EN : MEDIA_REWORK_STRATEGY_HINT_ZH
  return table[strategy] ?? table.guidance
}

/**
 * 拼接返工指令：原始指令 + 客观校验问题 + 质检 FAIL 原因 + 本轮策略提示。
 * 中文文案集中在本文件（cjk 豁免），mediaRework.ts 只负责装配。
 */
export function mediaReworkDirective(
  baseInstruction: string,
  options: {
    failReason?: string
    strategy?: 'guidance' | 'reseed' | 'stronger'
    objectiveIssues?: readonly string[]
    locale?: string
  } = {}
): string {
  const base = (baseInstruction ?? '').trim()
  const english = (options.locale ?? '').toLowerCase().startsWith('en')
  const blocks: string[] = []

  const objective = (options.objectiveIssues ?? []).filter(Boolean)
  if (objective.length) {
    blocks.push(
      english
        ? `[Hard metrics already failed, must be fixed] ${objective.join('; ')}`
        : `【已判定不达标的硬性指标，必须修正】${objective.join('；')}`
    )
  }

  const reason = (options.failReason ?? '').trim()
  if (reason) {
    blocks.push(
      english
        ? `[Last QC FAIL reason; fix it specifically] ${reason}`
        : `【上次质检 FAIL 原因，必须针对性修正】${reason}`
    )
  }

  if (!blocks.length) return base
  const hint = pickMediaReworkStrategyHint(options.strategy ?? 'guidance', options.locale)
  blocks.push(english ? `[Strategy] ${hint}` : `【本轮策略】${hint}`)
  return base ? `${base}\n\n${blocks.join('\n')}` : blocks.join('\n')
}
