import type { DshSkillsInfo, ExternalPluginManifest, McpServerInfo } from '@shared/ipc'

/**
 * 插件市场的**统一卡片模型**与筛选规则（纯函数，可测）。
 *
 * 市场的三类内容来源完全不同（MCP 是运行中的本地端点、技能是磁盘文件、扩展是声明式
 * manifest），卡片形状也各异。把它们归一成一种卡片模型，视图层就只需要一套网格 + 筛选，
 * 不必为每类各写一遍列表与搜索。
 *
 * 注意这里**没有「安装」语义**：MCP 是本地端点、扩展来自用户数据目录、技能靠目录与模板，
 * 都不存在"从远端下载并安装"这一步。卡片的动作是配置 / 打开 / 导入 / 导出。
 *
 * **模块内不放任何展示文案**（连中文标签都没有）：副标题与来源一律输出 **i18n 键**，
 * 由视图层 `t()` 解析。否则这里会变成第二份文案来源，与 locale 文件各说各话。
 */

export type MarketplaceCategory = 'mcp' | 'skills' | 'plugins'

/** 分类页签：`all` 是视图概念，不属于任何卡片的类别 */
export type MarketplaceFilter = MarketplaceCategory | 'all'

export interface MarketplaceCard {
  /** 全局唯一：`<category>:<局部 id>`，避免跨类撞名，也用作 i18n 标题键 */
  key: string
  category: MarketplaceCategory
  /**
   * 标题：**数据自带**的显示名（技能文件名 / 扩展 displayName）。
   * MCP 两条卡没有数据自带的显示名，留空 → 视图层按 `key` 取标题键。
   */
  title?: string
  /** 等宽小字展示的标识（如 `aiartengine` / 文件名 / 扩展 id） */
  identifier: string
  /** 副标题 / 描述，可能为空 */
  subtitle?: string
  /** 副标题的 **i18n 键**（MCP 的端点描述走这里；有它时优先于 `subtitle`） */
  subtitleKey?: string
  /** 版本 / 端口等附加信息（纯数据，不经 i18n） */
  meta?: string
  /** 来源标签的 **i18n 键**，如 `marketplace.source.builtin` */
  sourceKey?: string
  /** 是否处于启用（运行中）状态；用于卡片上的状态点 */
  active?: boolean
}

export interface MarketplaceSources {
  mcp: McpServerInfo | null
  skills: DshSkillsInfo | null
  plugins: ExternalPluginManifest[]
}

/** MCP 两条固定卡片的 i18n 标题键 */
export const MCP_CARD_TITLE_KEYS: Record<string, string> = {
  'mcp:server': 'marketplace.card.mcpServer',
  'mcp:blender': 'marketplace.card.mcpBlender'
}

/** 技能文件 kind → 来源标签的 i18n 键 */
export function skillSourceKey(kind: string): string {
  // 未知 kind 当作自定义（历史上只有 builtin / custom / template 三种）
  const known = kind === 'builtin' || kind === 'template' ? kind : 'custom'
  return `marketplace.source.skill.${known}`
}

/** 扩展卡片的来源标签键 */
export function pluginSourceKey(hasToolbarItems: boolean): string {
  return hasToolbarItems
    ? 'marketplace.source.plugin.toolbar'
    : 'marketplace.source.plugin.declarative'
}

/**
 * 把三份来源归一成卡片数组。
 *
 * 顺序固定为 MCP → 技能 → 扩展（分类筛选后的相对顺序因此稳定，不会因数据刷新跳来跳去）。
 */
export function buildMarketplaceCards(sources: MarketplaceSources): MarketplaceCard[] {
  const cards: MarketplaceCard[] = []

  // ── MCP：主服务与 Blender 工具面各一张卡（后者只在启用时出现，与设置页原行为一致）
  const mcp = sources.mcp
  if (mcp) {
    cards.push({
      key: 'mcp:server',
      category: 'mcp',
      identifier: 'aiartengine',
      subtitleKey: 'marketplace.card.mcpServerHint',
      meta: `${mcp.port}`,
      sourceKey: mcp.running ? 'marketplace.state.running' : 'marketplace.state.stopped',
      active: mcp.running
    })
    if (mcp.blenderBridge) {
      cards.push({
        key: 'mcp:blender',
        category: 'mcp',
        identifier: 'blender',
        subtitleKey: 'marketplace.card.mcpBlenderHint',
        meta: `${mcp.blenderBridge.serverHost}:${mcp.blenderBridge.serverPort}`,
        sourceKey: mcp.blenderBridge.connected
          ? 'marketplace.state.connected'
          : 'marketplace.state.disconnected',
        active: mcp.blenderBridge.enabled && mcp.blenderBridge.mounted
      })
    }
  }

  // ── 技能：目录里每个文件一张卡（内置项由应用自动管理，不铺成卡片）
  const skills = sources.skills
  if (skills) {
    for (const file of skills.files) {
      cards.push({
        key: `skills:${file.fileName}`,
        category: 'skills',
        title: file.fileName.replace(/\.md$/i, ''),
        identifier: file.fileName,
        sourceKey: skillSourceKey(file.kind)
      })
    }
  }

  // ── 扩展：每条 manifest 一张卡
  for (const plugin of sources.plugins) {
    const toolbarCount = plugin.contributions?.toolbarItems?.length ?? 0
    cards.push({
      key: `plugins:${plugin.id}`,
      category: 'plugins',
      title: plugin.displayName || plugin.id,
      identifier: plugin.id,
      subtitle: plugin.permissions?.length ? plugin.permissions.join(' · ') : undefined,
      meta: `v${plugin.version}`,
      sourceKey: pluginSourceKey(toolbarCount > 0)
    })
  }

  return cards
}

/**
 * 分类 + 关键词筛选。
 *
 * 关键词对「标题 / 标识 / 副标题 / 来源键」做**不区分大小写**的子串匹配；空查询返回全部。
 * 只按 `category === 'all'` 跳过分类过滤，其余情况严格相等 —— 不要把 `all` 当成
 * "匹配不到任何分类"的兜底传入。
 */
export function filterMarketplaceCards(
  cards: readonly MarketplaceCard[],
  options: { category: MarketplaceFilter; query?: string }
): MarketplaceCard[] {
  const query = (options.query ?? '').trim().toLowerCase()
  return cards.filter((card) => {
    if (options.category !== 'all' && card.category !== options.category) return false
    if (!query) return true
    const haystack = [card.title, card.identifier, card.subtitle, card.sourceKey, card.subtitleKey]
      .filter((part): part is string => typeof part === 'string')
      .join('\n')
      .toLowerCase()
    return haystack.includes(query)
  })
}

/** 各分类的卡片数量（分类页签上的角标用） */
export function countByCategory(
  cards: readonly MarketplaceCard[]
): Record<MarketplaceFilter, number> {
  const counts: Record<MarketplaceFilter, number> = {
    all: cards.length,
    mcp: 0,
    skills: 0,
    plugins: 0
  }
  for (const card of cards) counts[card.category] += 1
  return counts
}
