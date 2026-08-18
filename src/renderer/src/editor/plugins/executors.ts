import type { Context } from '@cordisjs/core'
import { listNodeTypes, type NodeExecuteFn } from '@shared/graph'

export function createExecutorPlugin(typeId: string, execute: NodeExecuteFn) {
  return {
    name: `graph.executor.${typeId}`,
    inject: ['editor'],
    apply(ctx: Context): void {
      ctx.editor.executor(typeId, execute)
    }
  }
}

/** 把内置 NodeTypeDefinition.execute 挂到覆盖栈（可被后续插件覆盖，dispose 回落定义）。 */
export function applyBuiltinExecutors(ctx: Context): void {
  for (const definition of listNodeTypes()) {
    if (definition.execute) ctx.editor.executor(definition.typeId, definition.execute)
  }
}
