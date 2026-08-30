import { computed, isRef, type ComputedRef, type Ref } from 'vue'
import type { GraphAddScope, GraphNode } from '@shared/graph'
import { useStudioI18n } from './useStudioI18n'
import { resolveGraphNodeDisplayTitle } from '../features/graph/model/graphNodeDisplayTitle'

/**
 * Inspector 面板标题：与节点卡片一致，库存英文标题（剧集 Agent 阶段节点 / 复合审核标题 / scope 输出标题）走 i18n。
 * 节点为空时回退到 typeLabel / 传入的 fallback。
 */
export function useNodeDisplayTitle(
  node: Readonly<Ref<GraphNode | null | undefined>>,
  fallback: ComputedRef<string> | string,
  scope?: Readonly<Ref<GraphAddScope | undefined>> | GraphAddScope
): ComputedRef<string> {
  const { t, graphTypeLabel } = useStudioI18n()
  const fallbackRef = isRef(fallback) ? fallback : computed(() => fallback)
  const scopeRef = scope == null || isRef(scope) ? scope : computed(() => scope)
  return computed(() => {
    const current = node.value
    if (!current) return fallbackRef.value
    return resolveGraphNodeDisplayTitle(current, {
      scope: scopeRef?.value,
      t,
      graphTypeLabel
    })
  })
}
