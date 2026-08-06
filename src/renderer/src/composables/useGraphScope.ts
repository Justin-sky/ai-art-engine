import { computed, inject, type ComputedRef } from 'vue'
import type { GraphAddScope } from '@shared/graph'

/** 节点图画布当前作用域（由 NodeGraphEditor provide） */
export function useGraphScope(): ComputedRef<GraphAddScope> {
  return inject<ComputedRef<GraphAddScope>>(
    'graphScope',
    computed(() => 'workflow')
  )
}
