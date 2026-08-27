import { describe, expect, it } from 'vitest'
import {
  beatRowsToTextItems,
  extractBeatJsonText,
  formatBeatFullText,
  mergeBeatRowsPreservingReviewed,
  parseBeatEntityJson,
  parseBeatJson,
  stableBeatId,
  stringifyBeatEntity,
  stringifyBeatRows,
  type BeatRow,
  type GraphDocument
} from '../src/shared/graph'

function beat(overrides: Partial<BeatRow> = {}): BeatRow {
  return {
    id: 'beat-1',
    title: '开场',
    order: 1,
    time: '雨夜',
    durationHint: '短',
    location: '城市巷口',
    locations: [{ name: '巷口', type: 'scene' }],
    characters: [{ name: '林晓', type: 'character' }],
    action: '林晓走进巷口',
    conflict: '寻找失踪的同伴',
    atmosphere: '雨声急促',
    props: [{ name: '雨伞', type: 'prop' }],
    weapons: [],
    sourceExcerpt: '雨夜，林晓撑伞走进巷口。',
    status: 'unreviewed',
    ...overrides
  }
}

describe('beatParse', () => {
  it('parses only new fields and Chinese aliases', () => {
    const rows = parseBeatJson(
      JSON.stringify([
        {
          名称: '对峙',
          顺序: 2,
          时间: '午夜',
          时长: '30 秒',
          空间与地点: '天台外景',
          地点绑定: '天台',
          角色: '林晓，阿哲',
          核心动作: '两人争夺信件',
          冲突与目标: '林晓要拿回证据',
          氛围与声音: '风声与警笛',
          props: ['信件'],
          weapons: ['短刀'],
          原文: '两人在天台相遇。',
          状态: '已审核'
        }
      ])
    )
    expect(rows?.[0]).toMatchObject({
      title: '对峙',
      order: 2,
      time: '午夜',
      durationHint: '30 秒',
      location: '天台外景',
      locations: [{ name: '天台' }],
      characters: [{ name: '林晓' }, { name: '阿哲' }],
      action: '两人争夺信件',
      conflict: '林晓要拿回证据',
      atmosphere: '风声与警笛',
      props: [{ name: '信件' }],
      weapons: [{ name: '短刀' }],
      sourceExcerpt: '两人在天台相遇。',
      status: 'reviewed'
    })
  })

  it('normalizes legacy persisted values to canonical ids', () => {
    // 旧版本以中文状态 / 中文 kind 持久化；读取必须归一化为英文规范值
    const rows = parseBeatJson(
      JSON.stringify([
        {
          id: 'beat-legacy-1',
          title: '旧文档',
          order: 1,
          status: '已审核',
          characters: [{ name: '林晓', type: '角色' }],
          locations: [{ name: '天台', type: '场景' }]
        },
        {
          id: 'beat-legacy-2',
          title: '同义词',
          order: 2,
          status: 'approved'
        },
        { id: 'beat-legacy-3', title: '未知值按默认处理', order: 3, status: 'garbage' }
      ])
    )
    expect(rows?.map((row) => row.status)).toEqual(['reviewed', 'reviewed', 'unreviewed'])
    expect(rows?.[0]).toMatchObject({
      characters: [{ name: '林晓', type: 'character' }],
      locations: [{ name: '天台', type: 'scene' }]
    })
  })

  it('does not read removed legacy fields', () => {
    const row = parseBeatJson(
      JSON.stringify([
        {
          summary: '旧摘要',
          dramaticFunction: '建置',
          emotionalBeat: '不安',
          scenes: ['旧场景']
        }
      ])
    )?.[0]
    expect(row).toMatchObject({
      title: '场 1',
      location: '',
      locations: [],
      action: '',
      conflict: '',
      atmosphere: ''
    })
    expect(row).not.toHaveProperty('summary')
    expect(row).not.toHaveProperty('scenes')
  })

  it('round-trips rows and a single entity', () => {
    const source = beat({
      locations: [{ name: '天台', imageUrl: 'Images/roof.png', type: 'scene' }]
    })
    expect(parseBeatJson(stringifyBeatRows([source]))).toEqual([source])
    expect(parseBeatEntityJson(stringifyBeatEntity(source))).toEqual(source)
  })

  it('formats full text and text items', () => {
    const source = beat()
    const text = formatBeatFullText(source)
    expect(text).toContain('1. 开场')
    expect(text).toContain('空间与地点：城市巷口')
    expect(text).toContain('地点绑定：巷口')
    expect(text).toContain('核心动作：林晓走进巷口')
    expect(beatRowsToTextItems([source])).toEqual([
      { id: source.id, title: source.title, text }
    ])
  })

  it('merges while preserving reviewed rows (canonical and legacy Chinese statuses)', () => {
    const previous = [
      // 已审核行以旧版中文状态进入（模拟旧文档），合并时同样必须保留
      beat({ id: 'beat-a', title: '已审', action: '保留', status: '已审核' as never }),
      beat({ id: 'beat-b', title: '未审', order: 2 })
    ]
    const next = [
      beat({ id: 'beat-a', title: '改写', action: '变化' }),
      beat({ id: 'beat-b', title: '未审新', order: 2, action: '更新' })
    ]
    const merged = mergeBeatRowsPreservingReviewed(previous, next)
    expect(merged?.[0]).toMatchObject({ title: '已审', action: '保留', status: '已审核' })
    expect(merged?.[1]).toMatchObject({ title: '未审新', action: '更新' })

    const canonicalPrevious = [
      beat({ id: 'beat-c', title: '已审C', action: '保留C', status: 'reviewed' }),
      beat({ id: 'beat-d', title: '未审D', order: 2 }),
      beat({ id: 'beat-e', title: '已审E', action: '保留E', status: 'reviewed', order: 3 })
    ]
    const canonicalNext = [beat({ id: 'beat-c', title: '改写C', action: '变化C' })]
    const mergedCanonical = mergeBeatRowsPreservingReviewed(canonicalPrevious, canonicalNext)
    expect(mergedCanonical?.[0]).toMatchObject({
      title: '已审C',
      action: '保留C',
      status: 'reviewed'
    })
    // 上游没再出现的已审核行必须追加保留；未审核行不保留
    expect(mergedCanonical?.map((row) => row.id)).toEqual(['beat-c', 'beat-e'])
  })

  it('uses beat prefix for generated stable ids', () => {
    expect(stableBeatId('T', 1, 'model-id')).toBe('model-id')
    expect(stableBeatId('T', 1)).toMatch(/^beat-/)
  })

  it('recovers an array from surrounding prose', () => {
    expect(parseBeatJson('说明\n[{"title":"A","order":1}]\n完')?.[0]?.title).toBe('A')
  })

  it('extracts table upstream text and split fallback', () => {
    const doc = {
      nodes: [
        {
          id: 'beat-split',
          typeId: 'beat.split',
          category: 'note',
          position: { x: 0, y: 0 },
          params: { text: '[{"title":"FromSplit"}]' }
        },
        {
          id: 'beat-table',
          typeId: 'beat.table',
          category: 'note',
          position: { x: 200, y: 0 },
          params: { text: '[{"title":"FromTable"}]' }
        }
      ],
      edges: [{ id: 'e1', source: 'beat-split', target: 'beat-table' }],
      viewport: { x: 0, y: 0, zoom: 1 }
    } as GraphDocument
    expect(extractBeatJsonText(doc)).toContain('FromSplit')
  })
})
