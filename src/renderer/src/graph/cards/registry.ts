import { markRaw, shallowRef } from 'vue'
import { resolveNodeType, type GraphCardKind } from '@shared/graph'
import type { GraphNode } from '@shared/graph'
import type { GraphCardDefinition, ResolvedGraphCard } from './types'

export const DEFAULT_GRAPH_CARD_IDS: Record<GraphCardKind, string> = {
  note: 'studio.graph.note',
  media: 'studio.graph.media',
  bundle: 'studio.graph.bundle'
}

const definitions = shallowRef(new Map<string, GraphCardDefinition>())

export function registerGraphCard(definition: GraphCardDefinition): () => void {
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

export function getGraphCard(id: string): GraphCardDefinition | undefined {
  return definitions.value.get(id)
}

export function listGraphCards(): GraphCardDefinition[] {
  return [...definitions.value.values()].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id)
  )
}

function toResolved(definition: GraphCardDefinition): ResolvedGraphCard {
  return { definition, component: definition.component }
}

export function resolveGraphCard(node: GraphNode): ResolvedGraphCard | null {
  const typeDef = resolveNodeType(node)

  if (typeDef?.cardId) {
    const bound = getGraphCard(typeDef.cardId)
    if (bound) return toResolved(bound)
  }

  if (typeDef?.card) {
    const defaultCard = getGraphCard(DEFAULT_GRAPH_CARD_IDS[typeDef.card])
    if (defaultCard) return toResolved(defaultCard)
  }

  for (const definition of listGraphCards()) {
    if (!definition.match(node, typeDef)) continue
    return toResolved(definition)
  }
  return null
}

export function nodesForGraphCard(cardId: string, nodes: GraphNode[]): GraphNode[] {
  return nodes.filter((node) => resolveGraphCard(node)?.definition.id === cardId)
}
