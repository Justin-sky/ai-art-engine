import { describe, expect, it } from 'vitest'
import {
  applyTimelineEdits,
  findOverlappingClipIds,
  trackEndSec,
  type TimelineClipDraft
} from '../src/shared/graph/timelineEdit'
import type {
  ScriptTimelineClip,
  ScriptTimelineDocument,
  ScriptTimelineTrackKind
} from '../src/shared/graph/scriptTimeline'

function clip(
  track: ScriptTimelineTrackKind,
  id: string,
  startSec: number,
  durationSec: number,
  extra: Partial<ScriptTimelineClip> = {}
): ScriptTimelineClip {
  return { id, track, sourceId: `src:${id}`, title: id, startSec, durationSec, ...extra }
}

function draft(
  track: ScriptTimelineTrackKind,
  durationSec: number,
  extra: Partial<TimelineClipDraft> = {}
): TimelineClipDraft {
  return { track, durationSec, ...extra }
}

function doc(clips: ScriptTimelineClip[]): ScriptTimelineDocument {
  return { clips }
}

/** 确定性 id 工厂：单测里不引入时间戳 / 随机 */
const ids = {
  makeClipId: (track: ScriptTimelineTrackKind, index: number) => `new:${track}:${index}`
}

describe('timelineEdit: 新增片段', () => {
  it('未给 startSec 时排到该轨轨尾', () => {
    const result = applyTimelineEdits(
      doc([clip('video', 'a', 0, 4)]),
      [{ op: 'add', clips: [draft('video', 3)] }],
      ids
    )
    expect(result.failures).toEqual([])
    expect(result.added).toBe(1)
    expect(result.document.clips.map((item) => [item.id, item.startSec, item.durationSec])).toEqual([
      ['a', 0, 4],
      ['new:video:0', 4, 3]
    ])
  })

  it('同一批草稿依次紧接（第二枚接在第一枚结束处，而不是同一起点）', () => {
    const result = applyTimelineEdits(
      doc([clip('video', 'a', 0, 4)]),
      [{ op: 'add', clips: [draft('video', 2), draft('video', 5)] }],
      ids
    )
    expect(result.document.clips.map((item) => item.startSec)).toEqual([0, 4, 6])
  })

  it('gapSec 留出空隙（与轨内既有内容之间同样留）', () => {
    const result = applyTimelineEdits(
      doc([clip('video', 'a', 0, 4)]),
      [{ op: 'add', clips: [draft('video', 2), draft('video', 2)], gapSec: 0.5 }],
      ids
    )
    expect(result.document.clips.map((item) => item.startSec)).toEqual([0, 4.5, 7])
  })

  it('各轨独立排布：轨尾只算本轨', () => {
    const result = applyTimelineEdits(
      doc([clip('video', 'a', 0, 10), clip('music', 'm', 0, 2)]),
      [{ op: 'add', clips: [draft('music', 3)] }],
      ids
    )
    expect(result.document.clips[2]).toMatchObject({ track: 'music', startSec: 2 })
  })

  it('显式 startSec 就地插入，不搬动既有片段', () => {
    const result = applyTimelineEdits(
      doc([clip('video', 'a', 0, 4), clip('video', 'b', 4, 4)]),
      [{ op: 'add', clips: [draft('video', 1, { startSec: 2 })] }],
      ids
    )
    expect(result.document.clips.map((item) => [item.id, item.startSec])).toEqual([
      ['a', 0],
      ['b', 4],
      ['new:video:0', 2]
    ])
  })

  it('id 与既有片段冲突时加后缀，不覆盖既有片段', () => {
    const result = applyTimelineEdits(
      doc([clip('video', 'dup', 0, 1)]),
      [{ op: 'add', clips: [draft('video', 1, { id: 'dup' })] }],
      ids
    )
    expect(result.document.clips.map((item) => item.id)).toEqual(['dup', 'dup~2'])
  })

  it('时长非法的草稿跳过并回报，其余照常新增', () => {
    const result = applyTimelineEdits(
      doc([clip('video', 'a', 0, 4)]),
      [{ op: 'add', clips: [draft('video', 0), draft('video', 2), draft('video', -1)] }],
      ids
    )
    expect(result.added).toBe(1)
    expect(result.failures).toEqual([
      { op: 'add', code: 'invalid-duration', target: '#1' },
      { op: 'add', code: 'invalid-duration', target: '#3' }
    ])
  })

  it('title / sourceId 缺省时兜底（纯文本片段不给媒体路径也能上轨）', () => {
    const result = applyTimelineEdits(
      doc([]),
      [{ op: 'add', clips: [draft('subtitle', 2, { text: '你好' })] }],
      ids
    )
    expect(result.document.clips[0]).toMatchObject({ title: '你好', sourceId: '' })
  })

  it('负数 startSec 被夹到 0', () => {
    const result = applyTimelineEdits(
      doc([]),
      [{ op: 'add', clips: [draft('video', 2, { startSec: -5 })] }],
      ids
    )
    expect(result.document.clips[0].startSec).toBe(0)
  })
})

describe('timelineEdit: 修改片段', () => {
  it('按 id 改字段', () => {
    const result = applyTimelineEdits(
      doc([clip('music', 'm', 0, 10)]),
      [{ op: 'update', clipId: 'm', patch: { volume: 0.4, fadeInSec: 1 } }],
      ids
    )
    expect(result.updated).toBe(1)
    expect(result.failures).toEqual([])
    expect(result.document.clips[0]).toMatchObject({ volume: 0.4, fadeInSec: 1 })
  })

  it('传 null 清除字段（转场 / 淡出可以被显式取消）', () => {
    const result = applyTimelineEdits(
      doc([clip('video', 'a', 0, 4, { transitionType: 'dissolve', transitionInSec: 0.5 })]),
      [{ op: 'update', clipId: 'a', patch: { transitionType: null, transitionInSec: null } }],
      ids
    )
    const out = result.document.clips[0]
    expect('transitionType' in out).toBe(false)
    expect('transitionInSec' in out).toBe(false)
  })

  it('数值越界被夹取（volume 到 1、opacity 到 0）', () => {
    const result = applyTimelineEdits(
      doc([clip('music', 'm', 0, 4, { volume: 0.5 })]),
      [{ op: 'update', clipId: 'm', patch: { volume: 3, opacity: -2 } }],
      ids
    )
    expect(result.document.clips[0]).toMatchObject({ volume: 1, opacity: 0 })
  })

  it('时长改成 0 报 invalid-duration 且不写回', () => {
    const result = applyTimelineEdits(
      doc([clip('video', 'a', 0, 4)]),
      [{ op: 'update', clipId: 'a', patch: { durationSec: 0 } }],
      ids
    )
    expect(result.updated).toBe(0)
    expect(result.failures).toEqual([{ op: 'update', code: 'invalid-duration', target: 'a' }])
    expect(result.document.clips[0].durationSec).toBe(4)
  })

  it('部分字段非法时合法字段照常生效', () => {
    const result = applyTimelineEdits(
      doc([clip('music', 'm', 0, 4)]),
      [{ op: 'update', clipId: 'm', patch: { volume: 0.2, durationSec: -1 } }],
      ids
    )
    expect(result.document.clips[0].volume).toBe(0.2)
    expect(result.updated).toBe(1)
    expect(result.failures).toEqual([{ op: 'update', code: 'invalid-duration', target: 'm' }])
  })

  it('id / track 不在可改字段里（换轨请 remove + add）', () => {
    const result = applyTimelineEdits(
      doc([clip('video', 'a', 0, 4)]),
      [{ op: 'update', clipId: 'a', patch: { id: 'b', track: 'voice' } as never }],
      ids
    )
    expect(result.updated).toBe(0)
    expect(result.failures).toEqual([{ op: 'update', code: 'empty-patch', target: 'a' }])
    expect(result.document.clips[0]).toMatchObject({ id: 'a', track: 'video' })
  })

  it('片段不存在报 clip-not-found', () => {
    const result = applyTimelineEdits(
      doc([clip('video', 'a', 0, 4)]),
      [{ op: 'update', clipId: 'ghost', patch: { volume: 0.5 } }],
      ids
    )
    expect(result.failures).toEqual([{ op: 'update', code: 'clip-not-found', target: 'ghost' }])
  })

  it('非法转场类型被忽略（不写进片段）', () => {
    const result = applyTimelineEdits(
      doc([clip('video', 'a', 0, 4)]),
      [{ op: 'update', clipId: 'a', patch: { transitionType: 'zoomin' as never } }],
      ids
    )
    expect(result.updated).toBe(0)
    expect(result.document.clips[0].transitionType).toBeUndefined()
  })
})

describe('timelineEdit: 删除片段', () => {
  it('按 id 批量删除', () => {
    const result = applyTimelineEdits(
      doc([clip('video', 'a', 0, 4), clip('video', 'b', 4, 4), clip('music', 'm', 0, 1)]),
      [{ op: 'remove', clipIds: ['a', 'm'] }],
      ids
    )
    expect(result.removed).toBe(2)
    expect(result.document.clips.map((item) => item.id)).toEqual(['b'])
  })

  it('不存在的 id 报 clip-not-found，其余照删', () => {
    const result = applyTimelineEdits(
      doc([clip('video', 'a', 0, 4)]),
      [{ op: 'remove', clipIds: ['ghost', 'a'] }],
      ids
    )
    expect(result.removed).toBe(1)
    expect(result.failures).toEqual([{ op: 'remove', code: 'clip-not-found', target: 'ghost' }])
  })

  it('删掉后该 id 可被新片段复用（同一批操作内）', () => {
    const result = applyTimelineEdits(
      doc([clip('video', 'a', 0, 4)]),
      [
        { op: 'remove', clipIds: ['a'] },
        { op: 'add', clips: [draft('video', 2, { id: 'a' })] }
      ],
      ids
    )
    expect(result.document.clips.map((item) => item.id)).toEqual(['a'])
  })
})

describe('timelineEdit: 区间替换（字幕重建走这条）', () => {
  it('删掉与该区间重叠的旧片段，再放入新片段', () => {
    const result = applyTimelineEdits(
      doc([clip('subtitle', 'old1', 0, 2), clip('subtitle', 'old2', 2, 2), clip('video', 'v', 0, 10)]),
      [
        {
          op: 'replaceRange',
          track: 'subtitle',
          range: { startSec: 0, endSec: 2 },
          clips: [draft('subtitle', 2.5, { id: 'newSub', startSec: 0 })]
        }
      ],
      ids
    )
    expect([result.removed, result.added]).toEqual([1, 1])
    expect(result.failures).toEqual([])
    expect(result.document.clips.map((item) => item.id)).toEqual(['old2', 'v', 'newSub'])
    expect(result.document.clips[2]).toMatchObject({ startSec: 0, durationSec: 2.5 })
  })

  it('只动指定轨道，别的轨即使重叠也不受影响', () => {
    const result = applyTimelineEdits(
      doc([clip('video', 'v', 0, 10), clip('subtitle', 'old', 0, 10)]),
      [
        {
          op: 'replaceRange',
          track: 'subtitle',
          range: { startSec: 0, endSec: 10 },
          clips: [draft('subtitle', 1, { id: 'new', startSec: 0 })]
        }
      ],
      ids
    )
    expect(result.document.clips.map((item) => item.id)).toEqual(['v', 'new'])
  })

  it('新片段缺 startSec 时落到 0（替换语义下不套用轨尾排布）', () => {
    const result = applyTimelineEdits(
      doc([clip('subtitle', 'old', 8, 2)]),
      [
        {
          op: 'replaceRange',
          track: 'subtitle',
          range: { startSec: 8, endSec: 10 },
          clips: [draft('subtitle', 1, { id: 'fresh' })]
        }
      ],
      ids
    )
    expect(result.document.clips.map((item) => [item.id, item.startSec])).toEqual([['fresh', 0]])
  })

  it('轨道名非法时报 invalid-track 且不动任何片段', () => {
    const result = applyTimelineEdits(
      doc([clip('subtitle', 'old', 0, 2)]),
      [
        {
          op: 'replaceRange',
          track: 'karaoke' as never,
          range: { startSec: 0, endSec: 2 },
          clips: [draft('subtitle', 1, { id: 'new', startSec: 0 })]
        }
      ],
      ids
    )
    expect(result.document.clips.map((item) => item.id)).toEqual(['old'])
    expect(result.failures).toEqual([
      { op: 'replaceRange', code: 'invalid-track', target: 'karaoke' }
    ])
  })
})

describe('timelineEdit: 不可变性与容错', () => {
  it('入参文档与片段对象都不被改写', () => {
    const source = doc([clip('video', 'a', 0, 4)])
    const snapshot = JSON.stringify(source)
    applyTimelineEdits(
      source,
      [
        { op: 'add', clips: [draft('video', 2)] },
        { op: 'update', clipId: 'a', patch: { volume: 0.5 } }
      ],
      ids
    )
    expect(JSON.stringify(source)).toBe(snapshot)
  })

  it('结构不完整的脏片段原样留着（不参与排布，也不被丢弃）', () => {
    const broken = { id: '', track: 'video', startSec: 0, durationSec: 0 } as ScriptTimelineClip
    const result = applyTimelineEdits(
      doc([broken, clip('video', 'a', 0, 4)]),
      [{ op: 'add', clips: [draft('video', 2)] }],
      ids
    )
    expect(result.document.clips).toHaveLength(3)
    expect(result.document.clips[0]).toMatchObject({ id: '' })
    // 轨尾算的是 'a' 的 4 秒，脏片段不参与
    expect(result.document.clips[2]).toMatchObject({ startSec: 4 })
  })

  it('operations 缺省或为空时不改动片段，只做一次拷贝', () => {
    const source = doc([clip('video', 'a', 0, 4)])
    const result = applyTimelineEdits(source, undefined, ids)
    expect(result.document.clips).toEqual(source.clips)
    expect(result.document.clips).not.toBe(source.clips)
    expect([result.added, result.updated, result.removed]).toEqual([0, 0, 0])
  })

  it('trackEndSec 只算本轨的可用片段', () => {
    expect(
      trackEndSec(
        [clip('video', 'a', 2, 3), clip('video', 'b', 0, 1), clip('music', 'm', 10, 10)],
        'video'
      )
    ).toBe(5)
    expect(trackEndSec([], 'video')).toBe(0)
  })

  it('findOverlappingClipIds 按半开区间判重叠（相邻不算）', () => {
    const clips = [
      clip('subtitle', 's1', 0, 2),
      clip('subtitle', 's2', 2.5, 2),
      clip('video', 'v1', 0, 10)
    ]
    expect(findOverlappingClipIds(clips, 'subtitle', { startSec: 0, endSec: 2 })).toEqual(['s1'])
    expect(findOverlappingClipIds(clips, 'subtitle', { startSec: 1, endSec: 3 })).toEqual([
      's1',
      's2'
    ])
    expect(findOverlappingClipIds(clips, 'subtitle', { startSec: 2, endSec: 2.5 })).toEqual([])
  })
})
