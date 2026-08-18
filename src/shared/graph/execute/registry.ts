import type { GraphNode } from '../types'
import type { NodeTypeDefinition } from '../registry'
import type { NodeExecuteFn } from './types'
import { executePassthrough } from './helpers'

/**
 * 执行器覆盖栈（后注册优先）。
 * 内置 execute 仍挂在 NodeTypeDefinition 上；插件用 registerExecutor 覆盖，dispose 后回落到定义。
 */
const overlays = new Map<string, NodeExecuteFn[]>()

export function registerExecutor(typeId: string, execute: NodeExecuteFn): () => void {
  const id = typeId.trim()
  if (!id) throw new Error('Executor typeId is empty')
  const stack = overlays.get(id) ?? []
  stack.push(execute)
  overlays.set(id, stack)
  return () => {
    const next = (overlays.get(id) ?? []).filter((fn) => fn !== execute)
    if (next.length) overlays.set(id, next)
    else overlays.delete(id)
  }
}

export function getExecutor(typeId: string | undefined | null): NodeExecuteFn | undefined {
  if (!typeId) return undefined
  const stack = overlays.get(typeId)
  return stack?.[stack.length - 1]
}

export function listExecutorTypeIds(): string[] {
  return [...overlays.keys()]
}

export function resolveNodeExecutor(
  node: Pick<GraphNode, 'typeId'>,
  def?: Pick<NodeTypeDefinition, 'execute'> | null
): NodeExecuteFn {
  return getExecutor(node.typeId) ?? def?.execute ?? executePassthrough
}
