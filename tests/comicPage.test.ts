import { describe, expect, it } from 'vitest'
import {
  addComicBubble,
  addComicPanel,
  COMIC_PAGE_DEFAULTS,
  COMIC_PAGE_PARAM_KEY,
  comicBubblePagePoint,
  comicPanelRects,
  createComicPage,
  fillComicPageFromImageUrls,
  findComicCellAtPagePoint,
  findComicPanelAtPagePoint,
  findEmptyComicCell,
  normalizeComicPage,
  pagePointToBubbleNorm,
  parseComicPage,
  readComicPageFromGenParams,
  removeComicBubble,
  removeComicPanel,
  serializeComicPage,
  updateComicBubble,
  upsertComicPanel,
  withComicPage
} from '../src/shared/graph'

describe('createComicPage / normalizeComicPage', () => {
  it('applies defaults', () => {
    const page = createComicPage()
    expect(page.columns).toBe(COMIC_PAGE_DEFAULTS.columns)
    expect(page.rows).toBe(COMIC_PAGE_DEFAULTS.rows)
    expect(page.gutter).toBe(COMIC_PAGE_DEFAULTS.gutter)
    expect(page.width).toBe(COMIC_PAGE_DEFAULTS.width)
    expect(page.height).toBe(COMIC_PAGE_DEFAULTS.height)
    expect(page.panels).toEqual([])
  })

  it('clamps degenerate dimensions to >=1', () => {
    const page = createComicPage({ columns: 0, rows: -2, width: 0, height: -5, gutter: -3 })
    expect(page.columns).toBe(1)
    expect(page.rows).toBe(1)
    expect(page.width).toBe(1)
    expect(page.height).toBe(1)
    expect(page.gutter).toBe(0)
  })

  it('clamps panel placement and spans into bounds', () => {
    const page = createComicPage({
      columns: 2,
      rows: 2,
      panels: [
        {
          id: 'a',
          row: 5,
          col: 5,
          rowSpan: 9,
          colSpan: 9,
          bubbles: []
        }
      ]
    })
    expect(page.panels[0]).toMatchObject({ row: 1, col: 1, rowSpan: 1, colSpan: 1 })
  })

  it('drops bubbles without text', () => {
    const page = createComicPage({
      panels: [
        {
          id: 'p1',
          row: 0,
          col: 0,
          rowSpan: 1,
          colSpan: 1,
          bubbles: [{ id: 'b1', text: '   ', x: 0, y: 0, tail: 'tl' }]
        }
      ]
    })
    expect(page.panels[0]!.bubbles).toEqual([])
  })
})

describe('comicPanelRects', () => {
  it('lays out a 2x2 grid with gutter', () => {
    const page = createComicPage({
      columns: 2,
      rows: 2,
      gutter: 10,
      width: 210,
      height: 210,
      panels: [
        { id: 'a', row: 0, col: 0, rowSpan: 1, colSpan: 1, bubbles: [] },
        { id: 'b', row: 0, col: 1, rowSpan: 1, colSpan: 1, bubbles: [] },
        { id: 'c', row: 1, col: 0, rowSpan: 1, colSpan: 1, bubbles: [] },
        { id: 'd', row: 1, col: 1, rowSpan: 1, colSpan: 1, bubbles: [] }
      ]
    })
    const rects = comicPanelRects(page)
    // 每格 100x100，gutter 10
    expect(rects.get('a')).toEqual({ x: 0, y: 0, width: 100, height: 100 })
    expect(rects.get('b')).toEqual({ x: 110, y: 0, width: 100, height: 100 })
    expect(rects.get('c')).toEqual({ x: 0, y: 110, width: 100, height: 100 })
    expect(rects.get('d')).toEqual({ x: 110, y: 110, width: 100, height: 100 })
  })

  it('spans across columns and rows', () => {
    const page = createComicPage({
      columns: 3,
      rows: 2,
      gutter: 10,
      width: 320,
      height: 210,
      panels: [
        { id: 'wide', row: 0, col: 0, rowSpan: 1, colSpan: 2, bubbles: [] },
        { id: 'tall', row: 0, col: 2, rowSpan: 2, colSpan: 1, bubbles: [] }
      ]
    })
    const rects = comicPanelRects(page)
    // 每格 100x100；wide 占 2 列 => 100*2 + 10 = 210
    expect(rects.get('wide')).toEqual({ x: 0, y: 0, width: 210, height: 100 })
    // tall 占 2 行 => 100*2 + 10 = 210
    expect(rects.get('tall')).toEqual({ x: 220, y: 0, width: 100, height: 210 })
  })
})

describe('panel mutations', () => {
  it('adds, upserts, removes panels', () => {
    let page = createComicPage({ columns: 2, rows: 2 })
    page = addComicPanel(page, { row: 0, col: 0, title: 'first' })
    expect(page.panels).toHaveLength(1)
    expect(page.panels[0]!.title).toBe('first')

    const id = page.panels[0]!.id
    page = upsertComicPanel(page, { ...page.panels[0]!, title: 'renamed' })
    expect(page.panels[0]!.title).toBe('renamed')

    page = removeComicPanel(page, id)
    expect(page.panels).toHaveLength(0)
  })

  it('addComicPanel generates unique ids', () => {
    let page = createComicPage({ columns: 2, rows: 2 })
    page = addComicPanel(page)
    page = addComicPanel(page)
    const ids = page.panels.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('bubble mutations', () => {
  function pageWithPanel(): ReturnType<typeof createComicPage> {
    return addComicPanel(createComicPage({ columns: 2, rows: 2 }), {
      id: 'p1',
      row: 0,
      col: 0,
      rowSpan: 1,
      colSpan: 1
    })
  }

  it('adds, updates, removes bubbles', () => {
    let page = pageWithPanel()
    page = addComicBubble(page, 'p1', { id: 'b1', text: '你好', speaker: '甲', x: 0.5, y: 0.2 })
    expect(page.panels[0]!.bubbles).toHaveLength(1)
    expect(page.panels[0]!.bubbles[0]).toMatchObject({ text: '你好', speaker: '甲' })

    page = updateComicBubble(page, 'p1', 'b1', { text: '你好吗', x: 0.8 })
    expect(page.panels[0]!.bubbles[0]).toMatchObject({ text: '你好吗', x: 0.8, speaker: '甲' })

    page = removeComicBubble(page, 'p1', 'b1')
    expect(page.panels[0]!.bubbles).toHaveLength(0)
  })

  it('updateComicBubble drops bubble when text becomes empty', () => {
    let page = pageWithPanel()
    page = addComicBubble(page, 'p1', { id: 'b1', text: '你好' })
    page = updateComicBubble(page, 'p1', 'b1', { text: '  ' })
    expect(page.panels[0]!.bubbles).toHaveLength(0)
  })
})

describe('comicBubblePagePoint', () => {
  it('maps normalized anchor to page pixels', () => {
    const page = createComicPage({
      columns: 2,
      rows: 1,
      gutter: 0,
      width: 200,
      height: 100,
      panels: [
        {
          id: 'p1',
          row: 0,
          col: 0,
          rowSpan: 1,
          colSpan: 1,
          bubbles: [{ id: 'b1', text: 'x', x: 0.5, y: 1, tail: 'tl' }]
        }
      ]
    })
    expect(comicBubblePagePoint(page, 'p1', 'b1')).toEqual({ x: 50, y: 100 })
  })

  it('returns null for unknown panel or bubble', () => {
    const page = createComicPage()
    expect(comicBubblePagePoint(page, 'nope', 'b1')).toBeNull()
  })
})

describe('serialize / parse / genParams', () => {
  it('round-trips through serialize + parse', () => {
    const page = createComicPage({
      title: '第一页',
      columns: 2,
      rows: 2,
      panels: [
        {
          id: 'p1',
          row: 0,
          col: 0,
          rowSpan: 1,
          colSpan: 1,
          imageUrl: 'shots/a.png',
          bubbles: [{ id: 'b1', text: '台词', speaker: '甲', x: 0.4, y: 0.6, tail: 'br' }]
        }
      ]
    })
    const parsed = parseComicPage(serializeComicPage(page))
    expect(parsed).toEqual(page)
  })

  it('parses code-fenced JSON', () => {
    const json = serializeComicPage(createComicPage({ title: 'x' })).trim()
    const parsed = parseComicPage(`\`\`\`json\n${json}\n\`\`\``)
    expect(parsed?.title).toBe('x')
  })

  it('returns null on empty or invalid', () => {
    expect(parseComicPage('')).toBeNull()
    expect(parseComicPage(null)).toBeNull()
    expect(parseComicPage('not json')).toBeNull()
    expect(parseComicPage('[]')).toBeNull()
  })

  it('reads and writes genParams', () => {
    const page = createComicPage({ title: 'gen' })
    const params = withComicPage({ other: 1 }, page)
    expect(params[COMIC_PAGE_PARAM_KEY]).toBeTypeOf('string')
    expect(readComicPageFromGenParams(params)?.title).toBe('gen')
    expect(readComicPageFromGenParams(null)).toBeNull()
  })

  it('normalizeComicPage accepts object input directly', () => {
    const page = normalizeComicPage({ title: 'obj', columns: 2, rows: 1 })
    expect(page.columns).toBe(2)
    expect(page.rows).toBe(1)
    expect(page.panels).toEqual([])
  })
})

describe('layout hit-testing and fill from images', () => {
  it('finds empty cells and page-point hits', () => {
    let page = createComicPage({ columns: 2, rows: 2, width: 200, height: 200, gutter: 0 })
    page = addComicPanel(page, { id: 'p1', row: 0, col: 0 })
    expect(findEmptyComicCell(page)).toEqual({ row: 0, col: 1 })
    expect(findComicCellAtPagePoint(page, 10, 10)).toEqual({ row: 0, col: 0 })
    expect(findComicPanelAtPagePoint(page, 10, 10)?.id).toBe('p1')
    expect(findComicPanelAtPagePoint(page, 150, 10)).toBeNull()
  })

  it('converts page points to bubble-normalized coords', () => {
    let page = createComicPage({ columns: 1, rows: 1, width: 100, height: 100, gutter: 0 })
    page = addComicPanel(page, { id: 'p1', row: 0, col: 0 })
    expect(pagePointToBubbleNorm(page, 'p1', 25, 50)).toEqual({ x: 0.25, y: 0.5 })
  })

  it('fills empty panels in reading order and keeps bound images', () => {
    let page = createComicPage({ columns: 2, rows: 1 })
    page = addComicPanel(page, { id: 'a', row: 0, col: 0, imageUrl: 'keep.png' })
    page = addComicPanel(page, { id: 'b', row: 0, col: 1 })
    const filled = fillComicPageFromImageUrls(page, ['new-1.png', 'new-2.png'])
    expect(filled.panels.find((item) => item.id === 'a')?.imageUrl).toBe('keep.png')
    expect(filled.panels.find((item) => item.id === 'b')?.imageUrl).toBe('new-1.png')
  })

  it('creates missing panels when the page is empty', () => {
    const page = createComicPage({ columns: 2, rows: 2 })
    const filled = fillComicPageFromImageUrls(page, ['a.png', 'b.png', 'c.png'])
    expect(filled.panels).toHaveLength(3)
    expect(filled.panels.map((item) => `${item.row},${item.col}`)).toEqual(['0,0', '0,1', '1,0'])
    expect(filled.panels.map((item) => item.imageUrl)).toEqual(['a.png', 'b.png', 'c.png'])
  })
})
