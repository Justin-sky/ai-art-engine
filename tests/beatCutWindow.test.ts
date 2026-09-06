import { describe, expect, it } from 'vitest'
import { beatCutWindowForDuration } from '../src/shared/graph/smartCut'
import type { VideoBeatSegment, VideoBeatTags } from '../src/shared/videoBeats'

function beatsWith(segments: VideoBeatSegment[], durationSec = 30): VideoBeatTags {
  return {
    v: 1,
    status: 'ok',
    runAt: '2026-01-01T00:00:00.000Z',
    durationSec,
    samples: [],
    segments,
    summary: []
  }
}

function seg(kind: VideoBeatSegment['kind'], fromSec: number, toSec: number): VideoBeatSegment {
  return { kind, fromSec, toSec, labels: [] }
}

describe('smartCut.beatCutWindowForDuration', () => {
  it('无打点 / 未成功 / 空分段时返回 null（调用方回退整段）', () => {
    expect(beatCutWindowForDuration(null, 4)).toBeNull()
    expect(
      beatCutWindowForDuration({ ...beatsWith([]), status: 'skipped', error: 'x' }, 4)
    ).toBeNull()
    expect(beatCutWindowForDuration(beatsWith([]), 4)).toBeNull()
  })

  it('需求时长能放进内容窗口时，取最早窗口并跳过片头空镜', () => {
    const beats = beatsWith([
      seg('empty', 0, 4),
      seg('person-solo', 4, 20),
      seg('empty', 20, 30)
    ])
    expect(beatCutWindowForDuration(beats, 8)).toEqual({
      offsetSec: 4,
      durationSec: 8,
      trimmedToAvailable: false
    })
  })

  it('内容从 0 秒开始则偏移为 0', () => {
    const beats = beatsWith([
      seg('person-group', 0, 12),
      seg('empty', 12, 20)
    ])
    expect(beatCutWindowForDuration(beats, 6)).toEqual({
      offsetSec: 0,
      durationSec: 6,
      trimmedToAvailable: false
    })
  })

  it('相邻人物/有物段合并成一个可用窗口，跳过中间空镜', () => {
    const beats = beatsWith([
      seg('empty', 0, 2),
      seg('objects', 2, 5),
      seg('person-solo', 5, 10),
      seg('empty', 10, 14),
      seg('person-group', 14, 30)
    ])
    // 需求 12s：第一个合并窗口（2–10）不够，落入第二个合并窗口（14–30）→ 但最早能容纳的是 14 起？
    // 合并后窗口：2–10（8s）、14–30（16s）→ 需求 12 选 14–30。
    expect(beatCutWindowForDuration(beats, 12)).toEqual({
      offsetSec: 14,
      durationSec: 12,
      trimmedToAvailable: false
    })
  })

  it('全部内容窗口都放不下时，取最长窗口并收敛时长', () => {
    const beats = beatsWith([
      seg('empty', 0, 5),
      seg('person-solo', 5, 9),
      seg('empty', 9, 30)
    ])
    const win = beatCutWindowForDuration(beats, 10)
    expect(win).toEqual({
      offsetSec: 5,
      durationSec: 4,
      trimmedToAvailable: true
    })
  })

  it('可用内容过短（低于最短片段）时返回 null', () => {
    const beats = beatsWith([seg('empty', 0, 29.7), seg('person-solo', 29.7, 30)])
    expect(beatCutWindowForDuration(beats, 4)).toBeNull()
  })

  it('时长以打点记录总长为上限', () => {
    const beats = beatsWith([
      seg('person-solo', 0, 8),
      seg('empty', 8, 12)
    ], 12)
    // 需求 20 > 可用 8 → 收敛到 8
    expect(beatCutWindowForDuration(beats, 20)).toEqual({
      offsetSec: 0,
      durationSec: 8,
      trimmedToAvailable: true
    })
  })
})
