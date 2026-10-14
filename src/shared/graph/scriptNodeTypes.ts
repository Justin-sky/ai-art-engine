/**
 * `script.run` 节点类型注册。
 *
 * 端口是**动态**的：由 `params.ports` 声明，经 `resolveTypeDefPorts` 的 `script.run` 分支派生，
 * 所以这里的 `ports` 只是占位（真正端口不走它）。
 *
 * 执行器里的沙箱（QuickJS WASM）**懒加载**：避免把 WASM 拉进广泛被引用的注册模块的 import 图。
 */
import { GraphPortType, type GraphNodeParams } from './types'
import type { NodeTypeDefinition } from './registry'
import type { GraphValue, NodeExecuteContext } from './execute/types'
import { SCRIPT_RUN_TYPE_ID, scriptNodeDefaultParams } from './scriptNode'

const ASSET_SIZE = { w: 200, h: 140 }
const ASSET_LIMITS = { minW: 140, minH: 90, maxW: 560, maxH: 480 }

let executorPromise: Promise<
  (ctx: NodeExecuteContext) => Promise<Record<string, GraphValue>>
> | null = null

/** 懒加载 QuickJS 沙箱 + 执行器工厂（首次执行时才拉 WASM） */
async function getExecutor(): Promise<
  (ctx: NodeExecuteContext) => Promise<Record<string, GraphValue>>
> {
  if (!executorPromise) {
    executorPromise = (async () => {
      const [{ createScriptRunNodeExecutor }, { QuickJsScriptSandbox }] = await Promise.all([
        import('./execute/scriptRun'),
        import('./execute/scriptSandboxQuickjs')
      ])
      return createScriptRunNodeExecutor({ sandbox: new QuickJsScriptSandbox() })
    })()
  }
  return executorPromise
}

export const SCRIPT_NODE_TYPES: NodeTypeDefinition[] = [
  {
    typeId: SCRIPT_RUN_TYPE_ID,
    category: 'note',
    label: 'Script',
    icon: '⚙️',
    defaultTitle: 'Script',
    defaultSize: { ...ASSET_SIZE },
    sizeLimits: { ...ASSET_LIMITS },
    // 占位端口；真实端口由 resolveTypeDefPorts 的 script.run 分支按 params.ports 派生
    ports: [
      { id: 'in', direction: 'in', dataType: GraphPortType.text, multiple: false, label: 'In' },
      { id: 'out', direction: 'out', dataType: GraphPortType.text, multiple: false, label: 'Out' }
    ],
    defaultParams: () => scriptNodeDefaultParams() as unknown as GraphNodeParams,
    description:
      'Run sandboxed JavaScript: reads upstream inputs, may call declared app capabilities (om.*), returns outputs. No file / network / require.',
    addable: true,
    deletable: true,
    inspector: 'none',
    inspectorId: 'studio.graph.scriptRun',
    card: 'media',
    contributeToGeneration: false,
    execute: async (ctx) => (await getExecutor())(ctx)
  }
]
