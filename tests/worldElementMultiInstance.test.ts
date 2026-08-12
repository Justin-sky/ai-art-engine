import { describe, expect, it } from 'vitest'
import { createNodeFromType, ensureBuiltinNodeTypes } from '../src/shared/graph'

ensureBuiltinNodeTypes()

describe('world element nodes are multi-instance', () => {
  it('creates distinct ids for repeated world.extract / table / gen nodes', () => {
    for (const typeId of ['world.extract', 'world.table', 'world.gen'] as const) {
      const first = createNodeFromType(typeId, { x: 0, y: 0 })
      const second = createNodeFromType(typeId, { x: 120, y: 0 })
      expect(first.typeId).toBe(typeId)
      expect(second.typeId).toBe(typeId)
      // 不再落到固定 singletonId，可同时存在多个实例
      expect(first.id).not.toBe(second.id)
      expect(first.id).not.toBe('world-extract')
      expect(first.id).not.toBe('world-table')
      expect(first.id).not.toBe('world-gen')
    }
  })
})
