import {
  EPISODE_AGENT_STOCK_TITLES,
  getGraphScopeDefinition,
  getNodeType,
  resolveNodeType,
  type GraphAddScope,
  type GraphNode
} from '@shared/graph'

/** 持久化英文默认输出标题 → UI / 日志 i18n 键 */
const STOCK_OUTPUT_TITLE_I18N: Record<string, string> = {
  'Image output': 'graph.titles.assetOutput.image',
  'Video output': 'graph.titles.assetOutput.video',
  'Voice output': 'graph.titles.assetOutput.voice',
  'Text output': 'graph.titles.assetOutput.text',
  'Screenplay output': 'graph.titles.screenplayOutput',
  'Director deck output': 'graph.titles.directorOutput',
  'Cut timeline': 'graph.titles.timelineOutput',
  'Beat output': 'graph.titles.beatOutput',
  'Beat unit output': 'graph.titles.beatUnitOutput',
  'World element output': 'graph.titles.worldOutput'
}

/** 剧集 Agent 阶段节点标题（新英文库存值 + 旧中文持久化变体）→ i18n 键 */
const EPISODE_DIRECTOR_REVIEW_KEY = 'graph.episodeAgent.title.directorReview'
export const EPISODE_AGENT_TITLE_I18N: Record<string, string> = {
  [EPISODE_AGENT_STOCK_TITLES.breakdown]: 'graph.episodeAgent.title.beatBreakdown',
  [EPISODE_AGENT_STOCK_TITLES.beatboard]: 'graph.episodeAgent.title.grid9Storyboard',
  [EPISODE_AGENT_STOCK_TITLES.sequence]: 'graph.episodeAgent.title.grid4Motion',
  [EPISODE_AGENT_STOCK_TITLES.motion]: 'graph.episodeAgent.title.motionPrompt',
  [EPISODE_AGENT_STOCK_TITLES.directorReview]: EPISODE_DIRECTOR_REVIEW_KEY,
  // 旧版中文标题：手动菜单 / 一键工作流 / graphSkills 各代变体，读取时仍需识别
  '分镜师·节拍拆解表': 'graph.episodeAgent.title.beatBreakdown', // cjk-ok 旧版持久化标题
  '节拍拆解表': 'graph.episodeAgent.title.beatBreakdown', // cjk-ok 旧版持久化标题
  '分镜师·9宫格分镜表': 'graph.episodeAgent.title.grid9Storyboard', // cjk-ok 旧版持久化标题
  '9宫格分镜表': 'graph.episodeAgent.title.grid9Storyboard', // cjk-ok 旧版持久化标题
  '分镜师·4宫格动态分镜表': 'graph.episodeAgent.title.grid4Motion', // cjk-ok 旧版持久化标题
  '4宫格动态分镜表': 'graph.episodeAgent.title.grid4Motion', // cjk-ok 旧版持久化标题
  '动画师·动态提示词表': 'graph.episodeAgent.title.motionPrompt', // cjk-ok 旧版持久化标题
  '动画师·9宫格动态提示词表': 'graph.episodeAgent.title.motionPrompt', // cjk-ok 旧版持久化标题
  '动态提示词表': 'graph.episodeAgent.title.motionPrompt', // cjk-ok 旧版持久化标题
  '9宫格动态提示词表': 'graph.episodeAgent.title.motionPrompt', // cjk-ok 旧版持久化标题
  '导演审核': EPISODE_DIRECTOR_REVIEW_KEY // cjk-ok 旧版持久化标题
}

/** 审核复合标题的前缀形态（新英文 / 旧中文），如「导演审核·节拍拆解表」 */
const EPISODE_AGENT_REVIEW_PREFIXES: readonly string[] = [
  EPISODE_AGENT_STOCK_TITLES.directorReview,
  '导演审核' // cjk-ok 旧版复合标题前缀
]

/**
 * 剧集 Agent 阶段节点标题翻译：
 * 精确命中两代标题直接映射；「导演审核·X」复合式组合展示。
 * 未识别的标题返回 undefined（按用户自定义处理）。
 */
export function resolveEpisodeAgentStageTitle(
  custom: string,
  t: (key: string, params?: Record<string, unknown>) => string
): string | undefined {
  const direct = EPISODE_AGENT_TITLE_I18N[custom]
  if (direct) return t(direct)
  for (const prefix of EPISODE_AGENT_REVIEW_PREFIXES) {
    if (!custom.startsWith(prefix)) continue
    const rest = custom.slice(prefix.length).replace(/^[\s·•\-—]+/, '').trim()
    const stageKey = rest ? EPISODE_AGENT_TITLE_I18N[rest] : undefined
    if (stageKey && stageKey !== EPISODE_DIRECTOR_REVIEW_KEY) {
      return `${t(EPISODE_DIRECTOR_REVIEW_KEY)} · ${t(stageKey)}`
    }
  }
  return undefined
}

export type GraphNodeDisplayTitleOptions = {
  scope?: GraphAddScope
  t: (key: string, params?: Record<string, unknown>) => string
  graphTypeLabel: (typeId: string) => string
  fallbackId?: string
}

/**
 * 节点类型展示名（非组件环境复用 useStudioI18n.graphTypeLabel 的等价逻辑）：
 * asset.* 走 `graph.types.asset.<kind>`，其余走 `graph.types.<typeId>`，未命中回退 typeId。
 */
export function resolveGraphTypeLabel(
  typeId: string,
  t: (key: string, params?: Record<string, unknown>) => string,
  te: (key: string) => boolean
): string {
  if (typeId.startsWith('asset.')) {
    const kind = typeId.slice('asset.'.length)
    const key = `graph.types.asset.${kind}`
    if (te(key)) return t(key)
    const typeName = te(`asset.type.${kind}`) ? t(`asset.type.${kind}`) : kind
    return `${typeName}${t('graph.nodeRole.generate')}`
  }
  const key = `graph.types.${typeId}`
  return te(key) ? t(key) : typeId
}

/**
 * 节点展示名：自定义标题优先；英文默认/scope 输出默认标题走 i18n（与画布卡片一致）。
 * 剧集 Agent 阶段节点的新旧两代库存标题同样走 i18n。
 */
export function resolveGraphNodeDisplayTitle(
  node: GraphNode | undefined,
  options: GraphNodeDisplayTitleOptions
): string {
  const fallback = options.fallbackId ?? ''
  if (!node) return fallback

  const custom = node.title?.trim() ?? ''
  if (node.category === 'output') {
    const scopeDef = options.scope ? getGraphScopeDefinition(options.scope) : undefined
    const stock = scopeDef?.output.title?.trim()
    const isStock = !custom || (stock != null && custom === stock) || !!STOCK_OUTPUT_TITLE_I18N[custom]
    if (isStock) {
      if (
        scopeDef?.outputTitleI18nKey &&
        (!node.params.outputKind || node.params.outputKind === scopeDef.output.kind)
      ) {
        return options.t(scopeDef.outputTitleI18nKey)
      }
      if (custom && STOCK_OUTPUT_TITLE_I18N[custom]) {
        return options.t(STOCK_OUTPUT_TITLE_I18N[custom])
      }
      const kind = node.params.outputKind ?? scopeDef?.output.kind ?? 'video'
      return options.t(`graph.titles.assetOutput.${kind}`)
    }
    return custom
  }

  if (custom) {
    const agentTitle = resolveEpisodeAgentStageTitle(custom, options.t)
    if (agentTitle) return agentTitle
    const def = resolveNodeType(node) ?? (node.typeId ? getNodeType(node.typeId) : undefined)
    if (def?.defaultTitle && custom === def.defaultTitle) {
      if (node.typeId) return options.graphTypeLabel(node.typeId)
    }
    return custom
  }

  if (node.typeId) return options.graphTypeLabel(node.typeId)
  return fallback || node.id
}

/** 标题是否为 scope / 内置输出节点或剧集 Agent 阶段节点的库存默认值（应走 i18n，不当作用户自定义） */
export function isStockGraphOutputTitle(title: string | undefined | null, scope?: GraphAddScope): boolean {
  const custom = title?.trim() ?? ''
  if (!custom) return true
  if (STOCK_OUTPUT_TITLE_I18N[custom]) return true
  if (EPISODE_AGENT_TITLE_I18N[custom]) return true
  if (!scope) return false
  const stock = getGraphScopeDefinition(scope).output.title?.trim()
  return !!stock && custom === stock
}
