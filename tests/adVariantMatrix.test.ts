import { describe, expect, it } from 'vitest'
import {
  adVariantCellId,
  applyAdVariantOutputRefs,
  buildAdVariantCellPrompt,
  expandAdVariantMatrix,
  normalizeAdVariantMatrix,
  normalizeAdVariantVerdict,
  readAdVariantMatrixFromGenParams,
  readAdVariantMatrixFromNode,
  withAdVariantCellVerdict,
  withAdVariantMatrix
} from '../src/shared/graph'

const dimensions = [
  { id: 'angle', label: '机位角度', values: ['正面', '侧面'] },
  { id: 'style', label: '视觉风格', values: ['简约', '高级'] }
]

describe('adVariantMatrix', () => {
  it('expands product × dimensions into cartesian cells', () => {
    const cells = expandAdVariantMatrix('一瓶香水', dimensions)
    expect(cells).toHaveLength(4)
    expect(cells[0]).toMatchObject({
      combo: { angle: '正面', style: '简约' },
      prompt: '一瓶香水\n机位角度：正面\n视觉风格：简约'
    })
    expect(cells[3].combo).toEqual({ angle: '侧面', style: '高级' })
    expect(cells[0].status).toBe('未审核')
  })

  it('ignores dimensions with no values', () => {
    const cells = expandAdVariantMatrix('产品', [
      { id: 'angle', label: '机位', values: [] },
      { id: 'style', label: '风格', values: ['高级'] }
    ])
    expect(cells).toHaveLength(1)
    expect(cells[0].combo).toEqual({ style: '高级' })
    expect(cells[0].prompt).toBe('产品\n风格：高级')
  })

  it('returns no cells when no dimensions have values', () => {
    expect(expandAdVariantMatrix('产品', [])).toHaveLength(0)
    expect(
      expandAdVariantMatrix('产品', [{ id: 'a', label: 'A', values: [] }])
    ).toHaveLength(0)
  })

  it('generates stable cell ids from combos', () => {
    const id1 = adVariantCellId({ angle: '正面', style: '简约' }, ['angle', 'style'])
    const id2 = adVariantCellId({ angle: '正面', style: '简约' }, ['angle', 'style'])
    expect(id1).toBe(id2)
    expect(id1).toContain('angle=正面')
  })

  it('normalizes malformed raw data defensively', () => {
    const normalized = normalizeAdVariantMatrix({
      product: '产品',
      dimensions: [{ id: 'a', label: 'A', values: ['x', 1, null] }] as never,
      cells: [
        {
          id: 'c1',
          combo: { a: 'x' },
          prompt: 'p',
          outputRefs: ['r', 2],
          status: '已审核'
        }
      ] as never
    })
    expect(normalized.product).toBe('产品')
    expect(normalized.dimensions[0].values).toEqual(['x'])
    expect(normalized.cells[0].outputRefs).toEqual(['r'])
    expect(normalized.cells[0].status).toBe('已审核')
  })

  it('roundtrips through genParams', () => {
    const matrix = normalizeAdVariantMatrix({
      product: '产品',
      dimensions,
      cells: expandAdVariantMatrix('产品', dimensions)
    })
    const genParams = withAdVariantMatrix(null, matrix)
    const read = readAdVariantMatrixFromGenParams(genParams)
    expect(read?.product).toBe('产品')
    expect(read?.cells).toHaveLength(4)
  })

  it('reads missing/invalid genParams as null', () => {
    expect(readAdVariantMatrixFromGenParams(null)).toBeNull()
    expect(readAdVariantMatrixFromGenParams({})).toBeNull()
    expect(readAdVariantMatrixFromGenParams({ adVariantMatrix: 'not-object' })).toBeNull()
  })

  it('builds prompt without label when label is empty', () => {
    expect(buildAdVariantCellPrompt('产品', [{ label: '', value: '特写' }])).toBe(
      '产品\n特写'
    )
  })

  it('reads matrix from node params and tolerates missing', () => {
    const matrix = normalizeAdVariantMatrix({
      product: '产品',
      dimensions,
      cells: expandAdVariantMatrix('产品', dimensions)
    })
    expect(readAdVariantMatrixFromNode({ adVariantMatrix: matrix }).cells).toHaveLength(4)
    expect(readAdVariantMatrixFromNode({}).product).toBe('')
    expect(readAdVariantMatrixFromNode({ adVariantMatrix: null }).cells).toHaveLength(0)
  })

  it('backfills outputRefs by cell order, appending and skipping empties', () => {
    const cells = expandAdVariantMatrix('产品', dimensions).map((c, i) =>
      i === 0 ? { ...c, outputRefs: ['已有'] } : c
    )
    const cellIds = cells.map((c) => c.id)
    const paths = [cells[0].id, cells[1].id, cells[2].id, cells[3].id].map((id, i) =>
      i === 3 ? '' : `out/${id}.png`
    )
    const result = applyAdVariantOutputRefs(cells, cellIds, paths)
    expect(result[0].outputRefs).toEqual(['已有', 'out/' + cells[0].id + '.png'])
    expect(result[1].outputRefs).toEqual(['out/' + cells[1].id + '.png'])
    expect(result[2].outputRefs).toHaveLength(1)
    expect(result[3].outputRefs).toEqual([])
  })

  it('normalizes verdict values to selected/rejected/undefined', () => {
    expect(normalizeAdVariantVerdict('selected')).toBe('selected')
    expect(normalizeAdVariantVerdict('入选')).toBe('selected')
    expect(normalizeAdVariantVerdict('rejected')).toBe('rejected')
    expect(normalizeAdVariantVerdict('淘汰')).toBe('rejected')
    expect(normalizeAdVariantVerdict('nonsense')).toBeUndefined()
    expect(normalizeAdVariantVerdict(undefined)).toBeUndefined()
  })

  it('carries verdict through normalizeAdVariantMatrix', () => {
    const normalized = normalizeAdVariantMatrix({
      product: '产品',
      dimensions,
      cells: [
        { id: 'c1', combo: {}, prompt: '', outputRefs: [], status: '未审核', verdict: '入选' },
        { id: 'c2', combo: {}, prompt: '', outputRefs: [], status: '未审核', verdict: '淘汰' },
        { id: 'c3', combo: {}, prompt: '', outputRefs: [], status: '未审核' }
      ]
    })
    expect(normalized.cells[0].verdict).toBe('selected')
    expect(normalized.cells[1].verdict).toBe('rejected')
    expect(normalized.cells[2].verdict).toBeUndefined()
  })

  it('sets/clears verdict on a single cell without mutating others', () => {
    const cells = expandAdVariantMatrix('产品', dimensions)
    const marked = withAdVariantCellVerdict(cells, cells[0].id, 'selected')
    expect(marked[0].verdict).toBe('selected')
    expect(marked[1].verdict).toBeUndefined()
    expect(cells[0].verdict).toBeUndefined() // 原数组不变
    const cleared = withAdVariantCellVerdict(marked, cells[0].id, undefined)
    expect(cleared[0].verdict).toBeUndefined()
  })
})
