import type { Component } from 'vue'
import type { GraphNode } from '@shared/graph'
import type { NodeTypeDefinition } from '@shared/graph'

export interface GraphCardDefinition {
  id: string
  order?: number
  match: (node: GraphNode, typeDef?: NodeTypeDefinition) => boolean
  component: Component
}

export interface ResolvedGraphCard {
  definition: GraphCardDefinition
  component: Component
}
