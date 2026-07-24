import { describe, expect, it } from 'vitest'
import {
  extractNarrativeUnitJsonText,
  formatNarrativeUnitFullText,
  mergeNarrativeUnitRowsPreservingReviewed,
  narrativeUnitRowsToTextItems,
  parseNarrativeUnitJson,
  stableNarrativeUnitId,
  stringifyNarrativeUnitRows
} from '../src/shared/graph/narrativeUnitParse'
import type { GraphDocument } from '../src/shared/graph/types'
import { stripJsonCodeFence } from '../src/shared/graph/shotSplitParse'

describe('narrativeUnitParse', () => {
  it('strips markdown fences via shared helper', () => {
    expect(stripJsonCodeFence('```json\n[{"title":"A"}]\n```')).toBe('[{"title":"A"}]')
  })

  it('formats full text and texts items for editor output', () => {
    const rows = parseNarrativeUnitJson(
      JSON.stringify([
        {
          id: 'nu-1',
          title: '开场',
          order: 1,
          summary: '登场',
          dramaticFunction: '建置',
          characters: ['林晓'],
          location: '街道',
          sourceExcerpt: '雨夜。',
          status: '未审核'
        }
      ])
    )!
    const full = formatNarrativeUnitFullText(rows[0]!)
    expect(full).toContain('1. 开场')
    expect(full).toContain('雨夜。')
    expect(narrativeUnitRowsToTextItems(rows)).toEqual([
      { id: 'nu-1', title: '开场', text: full }
    ])
  })

  it('parses narrative unit rows with defaults', () => {
    const rows = parseNarrativeUnitJson(
      JSON.stringify([
        {
          title: '开场',
          order: 1,
          summary: '主角登场',
          dramaticFunction: '建置',
          characters: ['林晓'],
          location: '雨夜街道',
          sourceExcerpt: '林晓撑伞走进巷口',
          emotionalBeat: '不安',
          durationHint: '中'
        }
      ])
    )
    expect(rows).toHaveLength(1)
    expect(rows?.[0]).toMatchObject({
      title: '开场',
      order: 1,
      dramaticFunction: '建置',
      characters: ['林晓'],
      status: '未审核'
    })
    expect(rows?.[0]?.id).toBeTruthy()
  })

  it('accepts comma-separated characters and chinese aliases', () => {
    const rows = parseNarrativeUnitJson(
      JSON.stringify([
        {
          名称: '对峙',
          顺序: 2,
          摘要: '两人冲突升级',
          戏剧功能: '冲突',
          角色: '林晓，阿哲',
          地点: '天台',
          原文: '……',
          情绪: '紧张',
          时长: '短',
          status: '已审核'
        }
      ])
    )
    expect(rows?.[0]).toMatchObject({
      title: '对峙',
      order: 2,
      characters: ['林晓', '阿哲'],
      location: '天台',
      status: '已审核'
    })
  })

  it('recovers array from trailing prose', () => {
    const rows = parseNarrativeUnitJson(`说明\n[{"title":"A","order":1}]\n完`)
    expect(rows?.[0]?.title).toBe('A')
  })

  it('merges preserving reviewed by id', () => {
    const previous = parseNarrativeUnitJson(
      stringifyNarrativeUnitRows([
        {
          id: 'nu-a',
          title: '已审',
          order: 1,
          summary: 'keep',
          dramaticFunction: '建置',
          characters: [],
          location: '',
          sourceExcerpt: '',
          emotionalBeat: '',
          durationHint: '',
          status: '已审核'
        },
        {
          id: 'nu-b',
          title: '未审',
          order: 2,
          summary: 'old',
          dramaticFunction: '过渡',
          characters: [],
          location: '',
          sourceExcerpt: '',
          emotionalBeat: '',
          durationHint: '',
          status: '未审核'
        }
      ])
    )!
    const next = parseNarrativeUnitJson(
      stringifyNarrativeUnitRows([
        {
          id: 'nu-a',
          title: '改写',
          order: 1,
          summary: 'changed',
          dramaticFunction: '冲突',
          characters: ['X'],
          location: 'L',
          sourceExcerpt: '',
          emotionalBeat: '',
          durationHint: '',
          status: '未审核'
        },
        {
          id: 'nu-b',
          title: '未审新',
          order: 2,
          summary: 'new',
          dramaticFunction: '转折',
          characters: [],
          location: '',
          sourceExcerpt: '',
          emotionalBeat: '',
          durationHint: '',
          status: '未审核'
        }
      ])
    )!
    const merged = mergeNarrativeUnitRowsPreservingReviewed(previous, next)!
    expect(merged[0]).toMatchObject({ id: 'nu-a', title: '已审', summary: 'keep', status: '已审核' })
    expect(merged[1]).toMatchObject({ id: 'nu-b', title: '未审新', summary: 'new' })
  })

  it('stable id prefers model id', () => {
    expect(stableNarrativeUnitId('T', 1, 'nu-custom')).toBe('nu-custom')
    expect(stableNarrativeUnitId('T', 1)).toMatch(/^nu-/)
  })

  it('extracts text from narrative split node', () => {
    const doc = {
      nodes: [
        {
          id: 'narrative-split',
          typeId: 'narrative.split',
          category: 'note',
          position: { x: 0, y: 0 },
          params: { text: '[{"title":"FromSplit"}]' }
        }
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    } as GraphDocument
    expect(extractNarrativeUnitJsonText(doc)).toContain('FromSplit')
  })

  it('prefers table upstream text, then table params', () => {
    const withUpstream = {
      nodes: [
        {
          id: 'narrative-split',
          typeId: 'narrative.split',
          category: 'note',
          position: { x: 0, y: 0 },
          params: { text: '[{"title":"FromSplit"}]' }
        },
        {
          id: 'narrative-table',
          typeId: 'narrative.table',
          category: 'note',
          position: { x: 200, y: 0 },
          params: { text: '[{"title":"FromTable"}]' }
        }
      ],
      edges: [
        {
          id: 'e1',
          source: 'narrative-split',
          target: 'narrative-table',
          sourcePort: 'out',
          targetPort: 'in'
        }
      ],
      viewport: { x: 0, y: 0, zoom: 1 }
    } as GraphDocument
    expect(extractNarrativeUnitJsonText(withUpstream)).toContain('FromSplit')

    const tableOnly = {
      nodes: [
        {
          id: 'narrative-table',
          typeId: 'narrative.table',
          category: 'note',
          position: { x: 200, y: 0 },
          params: { text: '[{"title":"FromTable"}]' }
        }
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    } as GraphDocument
    expect(extractNarrativeUnitJsonText(tableOnly)).toContain('FromTable')
  })
})
