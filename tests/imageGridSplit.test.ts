import { describe, expect, it } from 'vitest'
import {
  autoGridCellEdgeInsetPx,
  cellKey,
  gridCellCropRect,
  gridCellPixelRect,
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

  it('pixel rect uses floor boundaries so cells cover the image without gaps', () => {
    const cells = [
      gridCellPixelRect(1000, 500, 2, 4, 1, 1),
      gridCellPixelRect(1000, 500, 2, 4, 1, 2),
      gridCellPixelRect(1000, 500, 2, 4, 1, 3),
      gridCellPixelRect(1000, 500, 2, 4, 1, 4),
      gridCellPixelRect(1000, 500, 2, 4, 2, 4)
    ]
    expect(cells[0]).toEqual({ sx: 0, sy: 0, width: 250, height: 250 })
    expect(cells[1]).toEqual({ sx: 250, sy: 0, width: 250, height: 250 })
    expect(cells[2]).toEqual({ sx: 500, sy: 0, width: 250, height: 250 })
    expect(cells[3]).toEqual({ sx: 750, sy: 0, width: 250, height: 250 })
    expect(cells[3]!.sx + cells[3]!.width).toBe(1000)
    expect(cells[4]!.sy + cells[4]!.height).toBe(500)
  })

  it('pixel rect edge inset shrinks each cell evenly', () => {
    expect(gridCellPixelRect(400, 200, 1, 2, 1, 1, { edgeInsetPx: 4 })).toEqual({
      sx: 4,
      sy: 4,
      width: 192,
      height: 192
    })
    expect(autoGridCellEdgeInsetPx(256, 256)).toBe(4)
    expect(autoGridCellEdgeInsetPx(40, 40)).toBe(1)
  })

  it('drops legacy upscale fields', () => {
    const s = normalizeImageGridSplit({ rows: 2, cols: 2, scale: 4, resolution: '4K' } as never)
    expect(s).toMatchObject({ rows: 2, cols: 2, selected: [] })
    expect(s).not.toHaveProperty('scale')
    expect(s).not.toHaveProperty('resolution')
  })
})
