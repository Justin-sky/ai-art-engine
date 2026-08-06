import { executePassthrough, GraphPortType } from '@shared/graph'
import { activateExtension, registerExtensionManifest } from '../registry'
import GraphDemoCard from './GraphDemoCard.vue'
import GraphDemoInspector from './GraphDemoInspector.vue'

export const GRAPH_DEMO_EXTENSION_ID = 'plugin.example.graph'
export const GRAPH_DEMO_SCOPE_ID = 'plugin.exampleCanvas'
export const GRAPH_DEMO_NODE_TYPE_ID = 'plugin.example.node'

let registered = false

/**
 * 内置图插件演示：节点类型 + Scope + 自定义卡片与检查器。
 * 正式包默认不注册（见 builtins.ts）；本地调试时可手动调用。
 */
export function registerGraphDemoExtension(): void {
  if (registered) return
  registered = true

  registerExtensionManifest({
    id: GRAPH_DEMO_EXTENSION_ID,
    version: '1.0.0',
    apiVersion: 1,
    displayName: 'Graph Plugin Demo',
    activationOrder: 100,
    nodeTypes: [
      {
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
      }
    ],
    graphScopes: [
      {
        id: GRAPH_DEMO_SCOPE_ID,
        output: { kind: 'image', title: 'Example output' },
        coerceOutput: true,
        dragAssets: { allowTypes: ['image', 'model'] },
        createParams: (typeId) =>
          typeId === GRAPH_DEMO_NODE_TYPE_ID ? { text: 'Hello from plugin' } : undefined
      }
    ],
    graphScopeHosts: [
      {
        assetType: 'model',
        scope: GRAPH_DEMO_SCOPE_ID,
        priority: 150
      }
    ],
    graphPolicy: {
      scopes: {
        [GRAPH_DEMO_SCOPE_ID]: {
          addableNodeTypes: [GRAPH_DEMO_NODE_TYPE_ID, 'note.text', 'play.script']
        },
        workflow: {
          addableNodeTypes: [GRAPH_DEMO_NODE_TYPE_ID]
        }
      }
    },
    inspectors: [
      {
        id: 'plugin.example.inspector',
        nodeTypeId: GRAPH_DEMO_NODE_TYPE_ID,
        component: GraphDemoInspector
      }
    ],
    activate(ctx) {
      ctx.registerGraphCard({
        id: 'plugin.example.card',
        order: 50,
        match: (_node, typeDef) => typeDef?.typeId === GRAPH_DEMO_NODE_TYPE_ID,
        component: GraphDemoCard
      })
    }
  })

  activateExtension(GRAPH_DEMO_EXTENSION_ID)
}
