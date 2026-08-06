import { describe, expect, it } from 'vitest'
import {
  cellKey,
  gridCellCropRect,
  normalizeImageGridSplit,
  resolveGridSplitTargets
} from '../src/shared/graph'

describe('imageGridSplit', () => {
  it('normalizes defaults', () => {
    expect(normalizeImageGridSplit()).toMatchObject({
      rows: 3,
      cols: 3,
      selected: []
    })
  })

  it('filters invalid selected cells', () => {
    const s = normalizeImageGridSplit({
      rows: 2,
      cols: 2,
      selected: ['1-1', '3-1', 'bad', '2-2']
    })
    expect(s.selected).toEqual(['1-1', '2-2'])
  })

  it('resolves all cells when selection empty', () => {
    expect(resolveGridSplitTargets(normalizeImageGridSplit({ rows: 2, cols: 2 }))).toEqual([
      '1-1',
      '1-2',
      '2-1',
      '2-2'
    ])
  })

  it('computes cell crop rect', () => {
    expect(gridCellCropRect(2, 2, 1, 2)).toEqual({
      cropX: 0.5,
      cropY: 0,
      cropW: 0.5,
      cropH: 0.5
    })
    expect(cellKey(3, 4)).toBe('3-4')
  })

  it('drops legacy upscale fields', () => {
    const s = normalizeImageGridSplit({ rows: 2, cols: 2, scale: 4, resolution: '4K' } as never)
    expect(s).toMatchObject({ rows: 2, cols: 2, selected: [] })
    expect(s).not.toHaveProperty('scale')
    expect(s).not.toHaveProperty('resolution')
  })
})
