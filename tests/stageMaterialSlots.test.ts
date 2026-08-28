import { describe, expect, it } from 'vitest'
import { collectStageMaterialSlots } from '../src/renderer/src/features/director/stageMaterialSlots'

interface FakeMaterial {
  id: string
}

const mat = (id: string): FakeMaterial => ({ id })

describe('collectStageMaterialSlots', () => {
  it('uses material names as stable keys', () => {
    const a = mat('a')
    const slots = collectStageMaterialSlots([{ material: a, name: 'Body' }])
    expect(slots).toEqual([{ key: 'Body', label: 'Body', material: a }])
  })

  it('dedupes shared materials and same-name materials', () => {
    const shared = mat('shared')
    const other = mat('other')
    const slots = collectStageMaterialSlots([
      { material: shared, name: 'Skin' },
      { material: shared, name: 'Skin' },
      { material: other, name: 'Skin' }
    ])
    expect(slots).toHaveLength(1)
    expect(slots[0]?.material).toBe(shared)
  })

  it('synthesizes material-N keys for unnamed materials in traversal order', () => {
    const a = mat('a')
    const b = mat('b')
    const named = mat('named')
    const slots = collectStageMaterialSlots([
      { material: a, name: '' },
      { material: named, name: 'Glass' },
      { material: b }
    ])
    expect(slots.map((slot) => slot.key)).toEqual(['material-1', 'Glass', 'material-2'])
    expect(slots.map((slot) => slot.label)).toEqual(['material-1', 'Glass', 'material-2'])
  })

  it('trims whitespace-only names to synthetic keys', () => {
    const a = mat('a')
    const slots = collectStageMaterialSlots([{ material: a, name: '   ' }])
    expect(slots[0]?.key).toBe('material-1')
  })

  it('returns an empty list for empty input', () => {
    expect(collectStageMaterialSlots([])).toEqual([])
  })
})
