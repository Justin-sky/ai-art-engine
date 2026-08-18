import { describe, expect, it } from 'vitest'
import {
  createNodeFromType,
  executePassthrough,
  getExecutor,
  registerExecutor,
  resolveNodeExecutor
} from '../src/shared/graph'
import type { NodeExecuteContext } from '../src/shared/graph'

describe('graph executor overlay registry', () => {
  it('falls back to definition execute when no overlay is registered', () => {
    const node = createNodeFromType('note.text', { x: 0, y: 0 })
    const execute = resolveNodeExecutor(node, { execute: executePassthrough })
    expect(execute).toBe(executePassthrough)
  })

  it('prefers a registered overlay and restores after dispose', () => {
    const typeId = 'plugin.test.executor.overlay'
    const overlay = (ctx: NodeExecuteContext) => ({
      out: { kind: 'text' as const, text: ctx.node.params.text || 'overlay' }
    })
    const dispose = registerExecutor(typeId, overlay)
    expect(getExecutor(typeId)).toBe(overlay)
    expect(resolveNodeExecutor({ typeId }, { execute: executePassthrough })).toBe(overlay)
    dispose()
    expect(getExecutor(typeId)).toBeUndefined()
    expect(resolveNodeExecutor({ typeId }, { execute: executePassthrough })).toBe(executePassthrough)
  })
})
