import type { Context } from '@cordisjs/core'
import GraphBundleCard from '../../components/GraphBundleCard.vue'
import GraphNodeCard from '../../components/GraphNodeCard.vue'
import GraphNoteCard from '../../components/GraphNoteCard.vue'
import {
  BUILTIN_COMMANDS,
  BUILTIN_IMPORTERS,
  BUILTIN_INSPECTORS,
  BUILTIN_WINDOWS,
  CORE_EDITOR_PLUGIN_ID,
  WORKSPACE_TOOLBAR_ITEMS
} from '../extensions/builtins'
import { applyBuiltinExecutors } from './executors'

export const name = CORE_EDITOR_PLUGIN_ID
export const inject = ['kernel', 'editor']

export function apply(ctx: Context): void {
  ctx.editor.record({
    id: CORE_EDITOR_PLUGIN_ID,
    version: '1.0.0',
    displayName: 'AIArtEngine Core',
    source: 'core'
  })

  applyBuiltinExecutors(ctx)

  ctx.editor.graphCard({
    id: 'studio.graph.note',
    order: 0,
    match: (_node, typeDef) => typeDef?.card === 'note',
    component: GraphNoteCard
  })
  ctx.editor.graphCard({
    id: 'studio.graph.bundle',
    order: 5,
    match: (_node, typeDef) => typeDef?.card === 'bundle',
    component: GraphBundleCard
  })
  ctx.editor.graphCard({
    id: 'studio.graph.media',
    order: 10,
    match: (_node, typeDef) => typeDef?.card === 'media',
    component: GraphNodeCard
  })

  for (const definition of BUILTIN_WINDOWS) ctx.editor.window(definition)
  for (const definition of BUILTIN_INSPECTORS) ctx.editor.inspector(definition)
  for (const item of WORKSPACE_TOOLBAR_ITEMS) ctx.editor.toolbarItem(item)
  for (const contribution of BUILTIN_COMMANDS) ctx.editor.command(contribution)
  for (const definition of BUILTIN_IMPORTERS) ctx.editor.importer(definition)
}

export const corePlugin = { name, inject, apply }
