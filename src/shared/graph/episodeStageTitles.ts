/**
 * 剧集 Agent 流水线：阶段节点的英文库存标题与两代值兼容匹配。
 *
 * 新文档写入 EPISODE_AGENT_STOCK_TITLES 的英文标题；旧文档仍保留中文标题
 * （「分镜师·节拍拆解表」「导演审核·9宫格分镜表」等一键工作流 / 手动菜单变体）。
 * 所有按标题兜底匹配的阶段探测必须走本模块，不得散落 .includes('中文')。
 */

/** 阶段节点写盘规范英文标题（与 STOCK_OUTPUT_TITLE_I18N 同一先例） */
export const EPISODE_AGENT_STOCK_TITLES = {
  breakdown: 'Beat Breakdown Table',
  beatboard: '9-Grid Storyboard Table',
  sequence: '4-Grid Motion Storyboard Table',
  motion: 'Motion Prompt Table',
  directorReview: 'Director Review'
} as const

export type EpisodeAgentStockTitle =
  (typeof EPISODE_AGENT_STOCK_TITLES)[keyof typeof EPISODE_AGENT_STOCK_TITLES]

/** 分镜师 / 动画师生成步骤（不含导演审核） */
export type EpisodeStageKey = Exclude<
  keyof typeof EPISODE_AGENT_STOCK_TITLES,
  'directorReview'
>

/**
 * 各阶段的标题识别片段（小写比较）：英文为规范库存标题，中文保持旧行为的
 * 子串宽度（老文档还可能有 宫格提取 等变体之外的自由命名）。
 */
const STAGE_TITLE_FRAGMENTS: Record<EpisodeStageKey, readonly string[]> = {
  breakdown: ['beat breakdown table', '节拍拆解'], // cjk-ok 旧标题兼容片段
  beatboard: ['9-grid storyboard table', '9宫格'], // cjk-ok 旧标题兼容片段
  sequence: ['4-grid motion storyboard table', '4宫格'], // cjk-ok 旧标题兼容片段
  motion: ['motion prompt table', '动态提示词'] // cjk-ok 旧标题兼容片段
}

/** 导演审核节点的标题标记（任一命中即认为是审核节点标题） */
const REVIEW_TITLE_MARKERS: readonly string[] = [
  'director review',
  '导演审核', // cjk-ok 旧标题兼容片段
  '审核' // cjk-ok 旧标题兼容片段
]

function normalizeTitleFragment(title: string | null | undefined): string {
  return title?.trim().toLowerCase() ?? ''
}

/**
 * 阶段生成节点标题兜底匹配（优先级低于 params.episodeStep）：
 * 新英文标题与旧中文标题（分镜师·节拍拆解表 等）都命中。
 */
export function titleMatchesEpisodeStage(
  title: string | null | undefined,
  stage: EpisodeStageKey
): boolean {
  const raw = normalizeTitleFragment(title)
  if (!raw) return false
  return STAGE_TITLE_FRAGMENTS[stage].some((fragment) => raw.includes(fragment))
}

/**
 * 导演审核节点标题兜底匹配（优先级低于 params.episodeReviewTarget）：
 * 必须同时带审核标记与目标阶段片段，避免普通阶段节点误判。
 */
export function titleMatchesEpisodeReview(
  title: string | null | undefined,
  target: EpisodeStageKey
): boolean {
  const raw = normalizeTitleFragment(title)
  if (!raw) return false
  if (!REVIEW_TITLE_MARKERS.some((marker) => raw.includes(marker))) return false
  return STAGE_TITLE_FRAGMENTS[target].some((fragment) => raw.includes(fragment))
}
