import { describe, expect, it } from 'vitest'
import {
  buildPreviewFramePlan,
  DEFAULT_PREVIEW_FRAMES,
  MAX_PREVIEW_FRAMES,
  planPreviewTimestamps
} from '../src/shared/graph/timelinePreview'

describe('planPreviewTimestamps', () => {
  it('不给参数时按默认帧数均匀取每格中心', () => {
    const plan = planPreviewTimestamps({ durationSec: 12 })
    expect(plan.timestamps).toEqual([2, 6, 10])
    expect(plan.notes).toEqual([])
  })

  it('均匀取点首尾各留半格（避开开头淡入与结尾淡出）', () => {
    const plan = planPreviewTimestamps({ durationSec: 10, count: 2 })
    expect(plan.timestamps).toEqual([2.5, 7.5])
  })

  it('单帧落在正中而不是开头', () => {
    expect(planPreviewTimestamps({ durationSec: 8, count: 1 }).timestamps).toEqual([4])
  })

  it('帧数超过上限时夹取并回报', () => {
    const plan = planPreviewTimestamps({ durationSec: 60, count: 99 })
    expect(plan.timestamps).toHaveLength(MAX_PREVIEW_FRAMES)
    expect(plan.notes).toEqual([
      { code: 'frame-count-clamped', requested: 99, applied: MAX_PREVIEW_FRAMES }
    ])
  })

  it('帧数小于 1 时夹到 1 帧并回报', () => {
    const plan = planPreviewTimestamps({ durationSec: 6, count: 0 })
    expect(plan.timestamps).toEqual([3])
    expect(plan.notes).toEqual([{ code: 'frame-count-clamped', requested: 0, applied: 1 }])
  })

  it('帧数不是整数时向下取整', () => {
    expect(planPreviewTimestamps({ durationSec: 10, count: 2.7 }).timestamps).toEqual([2.5, 7.5])
  })

  it('帧数不是数字时回落到默认值', () => {
    expect(planPreviewTimestamps({ durationSec: 12, count: Number.NaN }).timestamps).toHaveLength(
      DEFAULT_PREVIEW_FRAMES
    )
  })

  it('指定时间点原样使用（升序）', () => {
    const plan = planPreviewTimestamps({ durationSec: 20, atSec: [12.5, 3, 7] })
    expect(plan.timestamps).toEqual([3, 7, 12.5])
    expect(plan.notes).toEqual([])
  })

  it('指定时间点优先于帧数', () => {
    const plan = planPreviewTimestamps({ durationSec: 20, count: 6, atSec: [5] })
    expect(plan.timestamps).toEqual([5])
  })

  it('空的时间点数组回落到帧数分支', () => {
    expect(planPreviewTimestamps({ durationSec: 12, atSec: [] }).timestamps).toEqual([2, 6, 10])
  })

  it('越界时间点被夹到片内并回报', () => {
    const plan = planPreviewTimestamps({ durationSec: 10, atSec: [-3, 99] })
    expect(plan.timestamps).toEqual([0, 9.99])
    expect(plan.notes).toEqual([{ code: 'timestamps-clamped', count: 2, durationSec: 10 }])
  })

  it('重复与相邻时间点合并成一帧', () => {
    const plan = planPreviewTimestamps({ durationSec: 10, atSec: [4, 4.002, 4.5, 9.004] })
    expect(plan.timestamps).toEqual([4, 4.5, 9])
    expect(plan.notes).toEqual([])
  })

  it('非有限数字的时间点被剔除并回报', () => {
    const plan = planPreviewTimestamps({
      durationSec: 10,
      atSec: [1, Number.NaN, Number.POSITIVE_INFINITY, 5]
    })
    expect(plan.timestamps).toEqual([1, 5])
    expect(plan.notes).toEqual([{ code: 'invalid-timestamps-dropped', count: 2 }])
  })

  it('时间点全非法时给出空数组（不静默当成帧数分支）', () => {
    const plan = planPreviewTimestamps({ durationSec: 10, atSec: [Number.NaN] })
    expect(plan.timestamps).toEqual([])
    expect(plan.notes).toEqual([{ code: 'invalid-timestamps-dropped', count: 1 }])
  })

  it('时间点数超过上限时取前 N 个', () => {
    const plan = planPreviewTimestamps({
      durationSec: 100,
      atSec: [10, 20, 30, 40, 50, 60, 70, 80]
    })
    expect(plan.timestamps).toEqual([10, 20, 30, 40, 50, 60])
    expect(plan.notes).toEqual([{ code: 'timestamps-truncated', limit: MAX_PREVIEW_FRAMES, requested: 8 }])
  })

  it('时长为 0 / 非法时不给时间点', () => {
    expect(planPreviewTimestamps({ durationSec: 0 }).timestamps).toEqual([])
    expect(planPreviewTimestamps({ durationSec: 0 }).notes).toEqual([{ code: 'empty-timeline' }])
    expect(planPreviewTimestamps({ durationSec: Number.NaN }).timestamps).toEqual([])
  })

  it('极短成片也能抽到片内的点', () => {
    const plan = planPreviewTimestamps({ durationSec: 0.4, count: 1 })
    expect(plan.timestamps[0]).toBeGreaterThanOrEqual(0)
    expect(plan.timestamps[0]).toBeLessThan(0.4)
  })

  it('均匀取点全在成片时长内', () => {
    const plan = planPreviewTimestamps({ durationSec: 3, count: MAX_PREVIEW_FRAMES })
    expect(plan.timestamps).toHaveLength(MAX_PREVIEW_FRAMES)
    for (const ts of plan.timestamps) {
      expect(ts).toBeGreaterThanOrEqual(0)
      expect(ts).toBeLessThan(3)
    }
  })
})

describe('buildPreviewFramePlan', () => {
  it('多帧：先缩放一次再 split，每帧一条 trim 分支', () => {
    const plan = buildPreviewFramePlan({ mapVideo: '[vout]', timestamps: [2, 6, 10], width: 640 })
    expect(plan.filterParts).toEqual([
      '[vout]scale=640:-2[vscaled]',
      '[vscaled]split=3[vsel0][vsel1][vsel2]',
      '[vsel0]trim=start=2.000,setpts=PTS-STARTPTS[vframe0]',
      '[vsel1]trim=start=6.000,setpts=PTS-STARTPTS[vframe1]',
      '[vsel2]trim=start=10.000,setpts=PTS-STARTPTS[vframe2]'
    ])
    expect(plan.outputs).toEqual([
      { label: 'vframe0', timeSec: 2 },
      { label: 'vframe1', timeSec: 6 },
      { label: 'vframe2', timeSec: 10 }
    ])
  })

  it('单帧：不走 split', () => {
    const plan = buildPreviewFramePlan({ mapVideo: '[lastVideo]', timestamps: [3.25], width: 480 })
    expect(plan.filterParts).toEqual([
      '[lastVideo]scale=480:-2[vpreview]',
      '[vpreview]trim=start=3.250,setpts=PTS-STARTPTS[vframe0]'
    ])
    expect(plan.outputs).toEqual([{ label: 'vframe0', timeSec: 3.25 }])
  })

  it('输出标签与时间点顺序一致（文件名与 frames 靠它对齐）', () => {
    const plan = buildPreviewFramePlan({
      mapVideo: '[vout]',
      timestamps: [0.5, 1, 1.5, 2],
      width: 640
    })
    expect(plan.outputs.map((item) => item.label)).toEqual([
      'vframe0',
      'vframe1',
      'vframe2',
      'vframe3'
    ])
    expect(plan.outputs.map((item) => item.timeSec)).toEqual([0.5, 1, 1.5, 2])
  })

  it('帧宽取整（ffmpeg 不接受小数宽）', () => {
    const plan = buildPreviewFramePlan({ mapVideo: '[vout]', timestamps: [1], width: 640.6 })
    expect(plan.filterParts[0]).toContain('scale=641:-2')
  })

  it('链段数随帧数线性增长（一帧一个分支）', () => {
    const plan = buildPreviewFramePlan({
      mapVideo: '[vout]',
      timestamps: [1, 2, 3, 4, 5, 6],
      width: 640
    })
    expect(plan.filterParts).toHaveLength(2 + 6)
  })
})
