import { describe, expect, it } from 'vitest'
import {
  extractShotSplitJsonText,
  mergeShotSplitRowsPreservingReviewed,
  parseShotSplitJson,
  shotsToShotSplitRows,
  stripJsonCodeFence,
  stringifyShotSplitRows
} from '../src/shared/graph/shotSplitParse'
import type { GraphDocument } from '../src/shared/graph/types'
import type { Shot } from '../src/shared/domain'

describe('shotSplitParse', () => {
  it('strips markdown fences', () => {
    expect(stripJsonCodeFence('```json\n[{"title":"A"}]\n```')).toBe('[{"title":"A"}]')
  })

  it('parses table-aligned rows with default review status', () => {
    const rows = parseShotSplitJson(
      JSON.stringify([
        {
          title: '开场',
          durationSec: 4,
          visualDescription: '雨夜街道',
          shotSize: '全景',
          lighting: '霓虹',
          dialogue: '',
          soundFx: '雨声',
          cameraMove: '推进'
        }
      ])
    )
    expect(rows).toHaveLength(1)
    expect(rows?.[0]).toMatchObject({
      title: '开场',
      durationSec: 4,
      shotSize: '全景',
      visualDescription: '雨夜街道',
      status: '未审核'
    })
  })

  it('parses explicit reviewed status', () => {
    const rows = parseShotSplitJson(
      JSON.stringify([
        {
          title: 'A',
          durationSec: 3,
          visualDescription: '',
          shotSize: '中景',
          lighting: '',
          dialogue: '',
          soundFx: '',
          cameraMove: '',
          status: '已审核'
        }
      ])
    )
    expect(rows?.[0]?.status).toBe('已审核')
  })

  it('clamps duration and recovers from trailing prose', () => {
    const rows = parseShotSplitJson(`这里是说明\n[{"title":"A","durationSec":99}]\n完`)
    expect(rows?.[0]?.durationSec).toBe(60)
  })

  it('extracts text from upstream of shot table', () => {
    const doc = {
      nodes: [
        {
          id: 'split',
          typeId: 'script.shotSplit',
          category: 'note',
          position: { x: 0, y: 0 },
          params: { text: '[{"title":"FromSplit"}]' }
        },
        {
          id: 'table',
          typeId: 'script.shotTable',
          category: 'note',
          position: { x: 200, y: 0 },
          params: {}
        }
      ],
      edges: [
        {
          id: 'e1',
          source: 'split',
          target: 'table',
          sourcePort: 'out',
          targetPort: 'in'
        }
      ],
      groups: []
    } as GraphDocument
    expect(extractShotSplitJsonText(doc)).toContain('FromSplit')
  })

  it('falls back to shot split node text', () => {
    const doc = {
      nodes: [
        {
          id: 'split',
          typeId: 'script.shotSplit',
          category: 'note',
          position: { x: 0, y: 0 },
          params: { text: '[{"title":"Fallback"}]' }
        }
      ],
      edges: [],
      groups: []
    } as GraphDocument
    expect(extractShotSplitJsonText(doc)).toContain('Fallback')
  })

  it('preserves reviewed rows by index when re-splitting', () => {
    const previous = parseShotSplitJson(
      JSON.stringify([
        {
          title: 'Keep',
          durationSec: 5,
          visualDescription: 'locked',
          shotSize: '全景',
          lighting: '',
          dialogue: '',
          soundFx: '',
          cameraMove: '',
          status: '已审核'
        },
        {
          title: 'EditMe',
          durationSec: 4,
          visualDescription: 'old',
          shotSize: '中景',
          lighting: '',
          dialogue: '',
          soundFx: '',
          cameraMove: '',
          status: '未审核'
        }
      ])
    )
    const next = parseShotSplitJson(
      JSON.stringify([
        {
          title: 'Changed',
          durationSec: 9,
          visualDescription: 'tampered',
          shotSize: '特写',
          lighting: 'x',
          dialogue: '',
          soundFx: '',
          cameraMove: '',
          status: '未审核'
        },
        {
          title: 'EditMe2',
          durationSec: 6,
          visualDescription: 'new',
          shotSize: '中景',
          lighting: '',
          dialogue: '',
          soundFx: '',
          cameraMove: '',
          status: '未审核'
        }
      ])
    )
    const merged = mergeShotSplitRowsPreservingReviewed(previous, next)
    expect(merged?.[0]).toMatchObject({
      title: 'Keep',
      visualDescription: 'locked',
      status: '已审核'
    })
    expect(merged?.[1]).toMatchObject({
      title: 'EditMe2',
      visualDescription: 'new',
      status: '未审核'
    })
  })

  it('serializes shots to split rows including review status', () => {
    const shots = [
      {
        title: 'S1',
        reviewStatus: '已审核',
        camera: { motion: 'static', durationSec: 5 },
        storyboard: {
          visualDescription: 'v',
          shotSize: '全景',
          lighting: '',
          dialogue: '',
          soundFx: '',
          cameraMove: '',
          finalPrompt: '',
          characters: [{ name: '老人', type: '角色', imageUrl: 'a.png' }],
          scenes: [{ name: '公园', type: '场景' }],
          props: [{ name: '旧书', type: '道具' }],
          weapons: []
        }
      }
    ] as Shot[]
    const rows = shotsToShotSplitRows(shots)
    expect(rows[0]).toMatchObject({
      title: 'S1',
      status: '已审核',
      visualDescription: 'v',
      characters: [{ name: '老人', type: '角色', imageUrl: 'a.png' }],
      scenes: [{ name: '公园', type: '场景' }],
      props: [{ name: '旧书', type: '道具' }]
    })
    expect(stringifyShotSplitRows(rows)).toContain('"status": "已审核"')
    expect(stringifyShotSplitRows(rows)).toContain('"name": "老人"')
  })
})
