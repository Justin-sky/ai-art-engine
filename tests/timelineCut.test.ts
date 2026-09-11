import { describe, expect, it } from 'vitest'
import {
  buildKeepRangesFromSpeech,
  planDeleteRanges,
  planRippleCut,
  planTimelineRoughCut,
  subtractRanges
} from '../src/shared/graph/timelineCut'
import type { ScriptTimelineClip, ScriptTimelineTrackKind } from '../src/shared/graph/scriptTimeline'

function clip(
  track: ScriptTimelineTrackKind,
  id: string,
  startSec: number,
  durationSec: number,
  extra: Partial<ScriptTimelineClip> = {}
): ScriptTimelineClip {
  return {
    id,
    track,
    sourceId: `src:${id}`,
    title: id,
    startSec,
    durationSec,
    ...extra
  }
}

/** 配音轨片段（粗剪唯一依据） */
function voice(
  id: string,
  startSec: number,
  durationSec: number,
  sourceOffsetSec = 0
): Pick<ScriptTimelineClip, 'id' | 'startSec' | 'durationSec' | 'sourceOffsetSec'> {
  return { id, startSec, durationSec, sourceOffsetSec }
}

describe('timelineCut: 语音 → 保留区间', () => {
  it('语音前后留边距，长静默段被标为待剪', () => {
    const plan = buildKeepRangesFromSpeech(
      [voice('v1', 0, 10)],
      [
        { startSec: 0, endSec: 2 },
        { startSec: 5, endSec: 7 }
      ]
    )
    expect(plan.keepRanges).toEqual([
      { startSec: 0, endSec: 2.2 },
      { startSec: 4.8, endSec: 7.2 }
    ])
    expect(plan.voiceRanges).toEqual([{ startSec: 0, endSec: 10 }])
    expect(plan.speechSec).toBe(4)
    expect(plan.warnings).toEqual([])
  })

  it('间隙小于 minSilenceSec 时两段语音之间的停顿不剪', () => {
    const plan = buildKeepRangesFromSpeech(
      [voice('v1', 0, 10)],
      [
        { startSec: 0, endSec: 2 },
        { startSec: 2.5, endSec: 4 }
      ]
    )
    const cuts = planDeleteRanges(plan.voiceRanges, plan.keepRanges, 0.8)
    // 中间 2.2~2.3 只有 0.1 秒停顿（不剪），只剪尾部静默
    expect(cuts).toEqual([{ startSec: 4.2, endSec: 10 }])
  })

  it('paddingSec 可调：设为 0 时保留区间紧贴语音', () => {
    const plan = buildKeepRangesFromSpeech(
      [voice('v1', 0, 10)],
      [{ startSec: 3, endSec: 4 }],
      { paddingSec: 0 }
    )
    expect(plan.keepRanges).toEqual([{ startSec: 3, endSec: 4 }])
  })

  it('按 sourceOffsetSec 把源文件时间平移到轨道时间，取段窗口外的语音忽略', () => {
    const plan = buildKeepRangesFromSpeech(
      [voice('v1', 5, 8, 10)],
      [
        { startSec: 11, endSec: 12 },
        { startSec: 15, endSec: 16 },
        { startSec: 20, endSec: 21 }
      ],
      { paddingSec: 0 }
    )
    // 源 [11,12)→轨道 [6,7]；源 [15,16)→轨道 [10,11]；源 [20,21) 落在取段窗口 [10,18) 之外
    expect(plan.keepRanges).toEqual([
      { startSec: 6, endSec: 7 },
      { startSec: 10, endSec: 11 }
    ])
    const cuts = planDeleteRanges(plan.voiceRanges, plan.keepRanges, 0.8)
    expect(cuts).toEqual([
      { startSec: 5, endSec: 6 },
      { startSec: 7, endSec: 10 },
      { startSec: 11, endSec: 13 }
    ])
  })

  it('片段内一句语音都没有时整段保留并回 warning（不做误剪）', () => {
    const plan = buildKeepRangesFromSpeech([voice('v1', 0, 10)], [{ startSec: 40, endSec: 42 }])
    expect(plan.keepRanges).toEqual([{ startSec: 0, endSec: 10 }])
    expect(plan.speechSec).toBe(0)
    expect(plan.warnings).toEqual([
      { code: 'clip-without-speech', clipId: 'v1' },
      { code: 'no-speech-detected' }
    ])
  })

  it('完全没有配音轨时返回 no-voice-clips 且不产生任何删除区间', () => {
    const plan = buildKeepRangesFromSpeech([], [{ startSec: 0, endSec: 1 }])
    expect(plan.keepRanges).toEqual([])
    expect(plan.voiceRanges).toEqual([])
    expect(plan.warnings).toEqual([{ code: 'no-voice-clips' }])
  })
})

describe('timelineCut: 区间运算', () => {
  it('subtractRanges 求差集并合并重叠', () => {
    expect(
      subtractRanges(
        [{ startSec: 0, endSec: 10 }],
        [
          { startSec: 2, endSec: 4 },
          { startSec: 3, endSec: 5 },
          { startSec: 8, endSec: 12 }
        ]
      )
    ).toEqual([
      { startSec: 0, endSec: 2 },
      { startSec: 5, endSec: 8 }
    ])
  })

  it('subtractRanges 支持多源区间与零长度结果过滤', () => {
    expect(
      subtractRanges(
        [
          { startSec: 0, endSec: 2 },
          { startSec: 5, endSec: 7 }
        ],
        [{ startSec: 1, endSec: 6 }]
      )
    ).toEqual([
      { startSec: 0, endSec: 1 },
      { startSec: 6, endSec: 7 }
    ])
    expect(subtractRanges([{ startSec: 0, endSec: 2 }], [{ startSec: 0, endSec: 2 }])).toEqual([])
  })

  it('planDeleteRanges 只保留达到阈值的静默段', () => {
    const voiceRanges = [{ startSec: 0, endSec: 10 }]
    const keep = [
      { startSec: 0, endSec: 2 },
      { startSec: 2.5, endSec: 4 },
      { startSec: 6, endSec: 10 }
    ]
    expect(planDeleteRanges(voiceRanges, keep, 0.8)).toEqual([{ startSec: 4, endSec: 6 }])
    expect(planDeleteRanges(voiceRanges, keep, 1.5)).toEqual([{ startSec: 4, endSec: 6 }])
    expect(planDeleteRanges(voiceRanges, keep, 2.5)).toEqual([])
  })
})

describe('timelineCut: ripple 前移', () => {
  it('片段被切开：保留子段各自带正确的 sourceOffsetSec', () => {
    const result = planRippleCut([clip('video', 'c1', 0, 10, { sourceOffsetSec: 0 })], [
      { startSec: 2.2, endSec: 4.8 },
      { startSec: 7.2, endSec: 10 }
    ])
    expect(result.clips).toHaveLength(2)
    expect(result.clips[0]).toMatchObject({
      id: 'c1',
      startSec: 0,
      durationSec: 2.2,
      sourceOffsetSec: 0
    })
    expect(result.clips[1]).toMatchObject({
      id: 'c1~2',
      startSec: 2.2,
      durationSec: 2.4,
      sourceOffsetSec: 4.8
    })
    expect(result.beforeSec).toBe(10)
    expect(result.afterSec).toBe(4.6)
    expect(result.removedSec).toBe(5.4)
    expect(result.splitCount).toBe(1)
    expect(result.droppedCount).toBe(0)
  })

  it('多轨按同一映射前移，字幕仍贴在语音上', () => {
    const result = planRippleCut(
      [
        clip('video', 'v', 0, 10),
        clip('voice', 'a', 0, 10),
        clip('subtitle', 's', 5, 2, { text: '字幕' })
      ],
      [
        { startSec: 2.2, endSec: 4.8 },
        { startSec: 7.2, endSec: 10 }
      ]
    )
    const subtitle = result.clips.find((item) => item.id === 's')
    expect(subtitle).toMatchObject({ startSec: 2.4, durationSec: 2, text: '字幕' })
    // 语音第二段前移后为 [2.2, 4.6]，字幕 [2.4, 4.4] 落在其中
    const voiceSecond = result.clips.find((item) => item.id === 'a~2')
    expect(voiceSecond).toMatchObject({ startSec: 2.2, durationSec: 2.4 })
  })

  it('被整段覆盖的片段直接删除', () => {
    const result = planRippleCut(
      [clip('sfx', 'noise', 1, 1), clip('video', 'main', 0, 10)],
      [{ startSec: 0.5, endSec: 2.5 }]
    )
    expect(result.clips.map((item) => item.id)).toEqual(['main', 'main~2'])
    expect(result.droppedCount).toBe(1)
    expect(result.clips[0]).toMatchObject({ startSec: 0, durationSec: 0.5 })
    expect(result.clips[1]).toMatchObject({ startSec: 0.5, durationSec: 7.5, sourceOffsetSec: 2.5 })
  })

  it('转场与淡入淡出只保留在片段真正的首尾', () => {
    const result = planRippleCut(
      [
        clip('video', 'c1', 0, 12, {
          transitionInSec: 0.4,
          transitionOutSec: 0.6,
          fadeInSec: 0.3,
          fadeOutSec: 0.3
        })
      ],
      [
        { startSec: 3, endSec: 4 },
        { startSec: 7, endSec: 8 }
      ]
    )
    expect(result.clips).toHaveLength(3)
    expect(result.clips[0].transitionInSec).toBe(0.4)
    expect(result.clips[0].transitionOutSec).toBeUndefined()
    expect(result.clips[1].transitionInSec).toBeUndefined()
    expect(result.clips[1].transitionOutSec).toBeUndefined()
    expect(result.clips[2].transitionOutSec).toBe(0.6)
    expect(result.clips[0].fadeInSec).toBe(0.3)
    expect(result.clips[2].fadeOutSec).toBe(0.3)
  })

  it('没有删除区间时原样返回（含空片段数组）', () => {
    const clips = [clip('video', 'c1', 0, 5)]
    const result = planRippleCut(clips, [])
    expect(result.clips).toEqual(clips)
    expect(result.removedSec).toBe(0)
    expect(planRippleCut([], [{ startSec: 0, endSec: 1 }])).toMatchObject({
      clips: [],
      beforeSec: 0,
      afterSec: 0
    })
  })
})

describe('timelineCut: 端到端计划', () => {
  it('口播素材：按转写收紧时间线并保持三轨同步', () => {
    const clips = [
      clip('video', 'cam', 0, 12),
      clip('voice', 'vo', 0, 12),
      clip('subtitle', 'sub', 6, 2, { text: '第二句' }),
      clip('music', 'bgm', 0, 12)
    ]
    const plan = planTimelineRoughCut({
      clips,
      segments: [
        { startSec: 0.5, endSec: 2.5 },
        { startSec: 6, endSec: 8 }
      ]
    })
    // 保留 [0.3, 2.7] 与 [5.8, 8.2]：中间 3.1 秒停顿与尾部 3.8 秒静默都要剪
    expect(plan.keepRanges).toEqual([
      { startSec: 0.3, endSec: 2.7 },
      { startSec: 5.8, endSec: 8.2 }
    ])
    expect(plan.cuts).toEqual([
      { startSec: 2.7, endSec: 5.8 },
      { startSec: 8.2, endSec: 12 }
    ])
    expect(plan.afterSec).toBe(5.1)
    expect(plan.removedSec).toBe(6.9)
    expect(plan.warnings).toEqual([])
    // 音乐轨同样前移，避免与画面脱节
    expect(plan.clips.find((item) => item.id === 'bgm')).toMatchObject({
      startSec: 0,
      durationSec: 2.7
    })
    expect(plan.clips.find((item) => item.id === 'bgm~2')).toMatchObject({
      startSec: 2.7,
      durationSec: 2.4
    })
    expect(plan.clips.find((item) => item.id === 'sub')).toMatchObject({
      startSec: 2.9,
      durationSec: 2,
      text: '第二句'
    })
  })

  it('没有任何可剪静默时回 nothing-to-cut，片段保持原样', () => {
    const clips = [clip('voice', 'vo', 0, 5)]
    const plan = planTimelineRoughCut({
      clips,
      segments: [{ startSec: 0, endSec: 5 }]
    })
    expect(plan.cuts).toEqual([])
    expect(plan.clips).toHaveLength(1)
    expect(plan.removedSec).toBe(0)
    expect(plan.warnings).toEqual([{ code: 'nothing-to-cut' }])
  })

  it('没有配音轨时不剪任何东西', () => {
    const clips = [clip('video', 'cam', 0, 9), clip('music', 'bgm', 0, 9)]
    const plan = planTimelineRoughCut({ clips, segments: [{ startSec: 0, endSec: 1 }] })
    expect(plan.cuts).toEqual([])
    expect(plan.afterSec).toBe(9)
    expect(plan.warnings).toContainEqual({ code: 'no-voice-clips' })
  })

  it('忽略非法片段与非法区间', () => {
    const clips = [
      clip('voice', 'vo', 0, 10),
      { ...clip('voice', 'bad', 0, 0) },
      { ...clip('voice', 'nan', Number.NaN, 5) }
    ]
    const plan = planTimelineRoughCut({
      clips,
      segments: [
        { startSec: 0, endSec: 1 },
        { startSec: 4, endSec: 3 }
      ]
    })
    expect(plan.clips.map((item) => item.id)).toContain('vo')
    expect(plan.clips.some((item) => item.id === 'nan')).toBe(false)
    expect(plan.afterSec).toBeLessThanOrEqual(10)
  })
})
