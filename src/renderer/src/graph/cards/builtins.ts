import GraphNodeCard from '../../components/GraphNodeCard.vue'
import GraphNoteCard from '../../components/GraphNoteCard.vue'
import { registerGraphCard } from './registry'

let registered = false

export function registerBuiltinGraphCards(): void {
  if (registered) return
  registered = true

  registerGraphCard({
    id: 'studio.graph.note',
    order: 0,
    match: (_node, typeDef) => typeDef?.card === 'note',
    component: GraphNoteCard
  })

  registerGraphCard({
    id: 'studio.graph.media',
    order: 10,
    match: (_node, typeDef) => typeDef?.card === 'media',
    component: GraphNodeCard
  })
}
