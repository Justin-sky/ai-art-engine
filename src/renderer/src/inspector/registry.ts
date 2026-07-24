import { markRaw, shallowRef } from 'vue'
import type {
  InspectorContext,
  InspectorDefinition,
  InspectorTarget,
  ResolvedInspector
} from './types'
import type { GraphNode } from '@shared/graph'
import { matchesInspectorTarget } from './match'
import { resolveGraphInspectorId } from './defaults'

/**
 * 使用不可变 Map 快照而不是“Map + revision 自增”。
 * 这样注册发生时只替换一次依赖值，不会在解析期间读写同一个响应式计数器。
 */
const definitions = shallowRef(new Map<string, InspectorDefinition>())

/** 注册或替换 Inspector；返回注销函数，方便插件热卸载。 */
export function registerInspector(definition: InspectorDefinition): () => void {
  const registered = {
    ...definition,
    component: markRaw(definition.component)
  }
  const next = new Map(definitions.value)
  next.set(registered.id, registered)
  definitions.value = next

  return () => {
    if (definitions.value.get(registered.id) === registered) {
      const remaining = new Map(definitions.value)
      remaining.delete(registered.id)
      definitions.value = remaining
    }
  }
}

export function unregisterInspector(id: string): void {
  if (!definitions.value.has(id)) return
  const next = new Map(definitions.value)
  next.delete(id)
  definitions.value = next
}

export function getInspector(id: string): InspectorDefinition | undefined {
  return definitions.value.get(id)
}

export function listInspectors(): InspectorDefinition[] {
  return [...definitions.value.values()].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id)
  )
}

export function resolveInspectors(
  target: InspectorTarget,
  context: InspectorContext
): ResolvedInspector[] {
  const resolved: ResolvedInspector[] = []
  const seen = new Set<string>()

  if (target.kind === 'graph.node' && target.graphNodeType && target.subject) {
    const node = target.subject as GraphNode
    const preferredId = resolveGraphInspectorId(target.graphNodeType, node)
    if (preferredId) {
      const bound = getInspector(preferredId)
      if (bound && matchesInspectorTarget(bound, target)) {
        resolved.push({
          definition: bound,
          props: bound.props?.(context) ?? {}
        })
        seen.add(bound.id)
      }
    }
  }

  for (const definition of listInspectors()) {
    if (seen.has(definition.id)) continue
    if (!matchesInspectorTarget(definition, target)) continue
    resolved.push({
      definition,
      props: definition.props?.(context) ?? {}
    })
    seen.add(definition.id)
  }

  return resolved
}
