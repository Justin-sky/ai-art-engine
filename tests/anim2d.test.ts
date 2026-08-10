import { describe, expect, it } from 'vitest'
import {
  ANIM2D_PRESETS,
  anim2dCellKeys,
  buildAnim2dGridInstruction,
  buildAnim2dInnerGraph,
  normalizeAnim2dState,
  readAnim2dFromNode,
  resolveAnim2dPreset
} from '../src/shared/graph'

describe('anim2d state', () => {
  it('normalizes rows/cols into clamped defaults', () => {
    expect(normalizeAnim2dState({ rows: 2, cols: 6 })).toEqual({ rows: 2, cols: 6 })
    expect(normalizeAnim2dState({ rows: 0, cols: 99 })).toEqual({ rows: 1, cols: 6 })
    expect(normalizeAnim2dState({})).toEqual({ rows: 1, cols: 4 })
    expect(readAnim2dFromNode({ animRows: 3, animCols: 2 })).toEqual({ rows: 3, cols: 2 })
  })

  it('builds row-major cell keys', () => {
    expect(anim2dCellKeys(2, 3)).toEqual(['1-1', '1-2', '1-3', '2-1', '2-2', '2-3'])
  })
})

describe('anim2d presets', () => {
  it('resolves known presets and rejects unknown', () => {
    expect(resolveAnim2dPreset('walk')?.id).toBe('walk')
    expect(resolveAnim2dPreset('nope')).toBeUndefined()
    expect(ANIM2D_PRESETS.length).toBeGreaterThanOrEqual(5)
  })

  it('builds grid instruction mentioning rows x cols', () => {
    const zh = buildAnim2dGridInstruction(2, 4)
    expect(zh).toContain('2×4')
    expect(zh).toContain('8 帧')
    const en = buildAnim2dGridInstruction(1, 4, 'en-US')
    expect(en).toContain('4 frames')
  })
})

describe('anim2d inner graph', () => {
  it('wires input boundary → frame.animGen → output boundary', () => {
    const doc = buildAnim2dInnerGraph({ rows: 2, cols: 4 }, 'walk', '', 'zh-CN')
    expect(doc.nodes.map((n) => n.typeId)).toContain('frame.animGen')
    expect(doc.edges.length).toBe(2)
    const gen = doc.nodes.find((n) => n.typeId === 'frame.animGen')
    expect(gen?.params?.animRows).toBe(2)
    expect(gen?.params?.animCols).toBe(4)
    expect(gen?.params?.animPresetId).toBe('walk')
  })
})
