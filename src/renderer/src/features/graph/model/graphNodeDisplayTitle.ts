import {
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
  'Shot video output': 'graph.titles.shotOutput',
  'Screenplay output': 'graph.titles.screenplayOutput',
  'Director deck output': 'graph.titles.directorOutput',
  'Shot output': 'graph.titles.scriptOutput',
  'Narrative output': 'graph.titles.narrativeOutput',
  'Narrative unit output': 'graph.titles.narrativeUnitOutput',
  'World element output': 'graph.titles.worldOutput'
}

export type GraphNodeDisplayTitleOptions = {
  scope?: GraphAddScope
  t: (key: string, params?: Record<string, unknown>) => string
  graphTypeLabel: (typeId: string) => string
  fallbackId?: string
}

/**
 * 节点展示名：自定义标题优先；英文默认/scope 输出默认标题走 i18n（与画布卡片一致）。
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
    const def = resolveNodeType(node) ?? (node.typeId ? getNodeType(node.typeId) : undefined)
    if (def?.defaultTitle && custom === def.defaultTitle) {
      if (node.typeId) return options.graphTypeLabel(node.typeId)
    }
    return custom
  }

  if (node.typeId) return options.graphTypeLabel(node.typeId)
  return fallback || node.id
}

/** 标题是否为 scope / 内置输出节点的英文默认值（应走 i18n，不当作用户自定义） */
export function isStockGraphOutputTitle(title: string | undefined | null, scope?: GraphAddScope): boolean {
  const custom = title?.trim() ?? ''
  if (!custom) return true
  if (STOCK_OUTPUT_TITLE_I18N[custom]) return true
  if (!scope) return false
  const stock = getGraphScopeDefinition(scope).output.title?.trim()
  return !!stock && custom === stock
}
