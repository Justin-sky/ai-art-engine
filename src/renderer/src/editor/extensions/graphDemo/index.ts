import type { Context } from '@cordisjs/core'
import { executePassthrough, GraphPortType } from '@shared/graph'
import { loadEditorPlugin } from '../../runtime'
import GraphDemoCard from './GraphDemoCard.vue'
import GraphDemoInspector from './GraphDemoInspector.vue'

export const GRAPH_DEMO_EXTENSION_ID = 'plugin.example.graph'
export const GRAPH_DEMO_SCOPE_ID = 'plugin.exampleCanvas'
export const GRAPH_DEMO_NODE_TYPE_ID = 'plugin.example.node'

export const name = GRAPH_DEMO_EXTENSION_ID
export const inject = ['kernel', 'editor']

export function apply(ctx: Context): void {
  ctx.editor.record({
    id: GRAPH_DEMO_EXTENSION_ID,
    version: '1.0.0',
    displayName: 'Graph Plugin Demo',
    source: 'demo'
  })

  ctx.editor.nodeType({
    typeId: GRAPH_DEMO_NODE_TYPE_ID,
    category: 'note',
    label: 'Example',
    icon: '🧩',
    defaultTitle: 'Example',
    defaultSize: { w: 220, h: 140 },
    sizeLimits: { minW: 140, minH: 90, maxW: 480, maxH: 360 },
    ports: [{ id: 'out', direction: 'out', dataType: GraphPortType.text, multiple: true, label: 'Out' }],
    defaultParams: () => ({ text: '' }),
    addable: true,
    deletable: true,
    inspector: 'note',
    inspectorId: 'plugin.example.inspector',
    card: 'note',
    cardId: 'plugin.example.card',
    contributeToGeneration: false,
    execute: executePassthrough
  })

  ctx.editor.graphScope({
    id: GRAPH_DEMO_SCOPE_ID,
    output: { kind: 'image', title: 'Example output' },
    coerceOutput: true,
    dragAssets: { allowTypes: ['image', 'model'] },
    createParams: (typeId) =>
      typeId === GRAPH_DEMO_NODE_TYPE_ID ? { text: 'Hello from plugin' } : undefined
  })

  ctx.editor.graphScopeHost({
    assetType: 'model',
    scope: GRAPH_DEMO_SCOPE_ID,
    priority: 150
  })

  ctx.editor.graphPolicy(GRAPH_DEMO_EXTENSION_ID, {
    scopes: {
      [GRAPH_DEMO_SCOPE_ID]: {
        addableNodeTypes: [GRAPH_DEMO_NODE_TYPE_ID, 'note.text', 'play.script']
      },
      workflow: {
        addableNodeTypes: [GRAPH_DEMO_NODE_TYPE_ID]
      }
    }
  })

  ctx.editor.inspector({
    id: 'plugin.example.inspector',
    nodeTypeId: GRAPH_DEMO_NODE_TYPE_ID,
    component: GraphDemoInspector
  })

  ctx.editor.graphCard({
    id: 'plugin.example.card',
    order: 50,
    match: (_node, typeDef) => typeDef?.typeId === GRAPH_DEMO_NODE_TYPE_ID,
    component: GraphDemoCard
  })
}

/** 本地调试：在 runtime 启动后加载演示插件。正式包默认不加载。 */
export function registerGraphDemoExtension(): void {
  loadEditorPlugin({ name, inject, apply })
}
