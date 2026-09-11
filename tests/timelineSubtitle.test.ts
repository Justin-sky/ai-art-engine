import { describe, expect, it } from 'vitest'
import { buildSubtitleClipsFromTranscription } from '../src/shared/graph/timelineSubtitle'
import type { TranscribeAudioSegment } from '../src/shared/modelProvider'

const makeId = (index: number): string => `sub:${index}`

function seg(startSec: number, endSec: number, text: string): TranscribeAudioSegment {
  return { startSec, endSec, text }
}

describe('timelineSubtitle: 转写 → 字幕片段', () => {
  it('按配音片段起点平移，空白分段被跳过', () => {
    const clips = buildSubtitleClipsFromTranscription(
      { startSec: 10, durationSec: 5, sourceOffsetSec: 0 },
      [seg(0, 2, '第一句'), seg(2, 2.4, '   '), seg(3, 5, '第二句')],
      makeId
    )
    expect(clips.map((item) => [item.text, item.startSec, item.durationSec])).toEqual([
      ['第一句', 10, 2],
      ['第二句', 13, 2]
    ])
    expect(clips.every((item) => item.track === 'subtitle')).toBe(true)
  })

  it('配音片段只取了源文件中段时，字幕跟着取段起点回退', () => {
    const clips = buildSubtitleClipsFromTranscription(
      { startSec: 100, durationSec: 4, sourceOffsetSec: 30 },
      [seg(30, 32, 'A'), seg(33, 34, 'B')],
      makeId
    )
    expect(clips.map((item) => [item.startSec, item.durationSec])).toEqual([
      [100, 2],
      [103, 1]
    ])
  })

  it('早于取段起点的分段被夹到片段开头，不会跑到片段之前', () => {
    const clips = buildSubtitleClipsFromTranscription(
      { startSec: 50, durationSec: 4, sourceOffsetSec: 30 },
      [seg(29, 31, 'A')],
      makeId
    )
    expect(clips[0]).toMatchObject({ startSec: 50, durationSec: 1 })
  })

  it('超出配音片段的分段被裁掉，裁没了的直接跳过', () => {
    const clips = buildSubtitleClipsFromTranscription(
      { startSec: 0, durationSec: 2, sourceOffsetSec: 0 },
      [seg(1, 5, '尾段被裁'), seg(9, 10, '完全在外')],
      makeId
    )
    expect(clips.map((item) => [item.text, item.startSec, item.durationSec])).toEqual([
      ['尾段被裁', 1, 1]
    ])
  })

  it('无时间戳（start === end）时整段对齐配音片段', () => {
    const clips = buildSubtitleClipsFromTranscription(
      { startSec: 4, durationSec: 3, sourceOffsetSec: 0 },
      [seg(0, 0, '整段'), seg(1, 2, '')],
      makeId
    )
    expect(clips).toHaveLength(1)
    expect(clips[0]).toMatchObject({ text: '整段', startSec: 4, durationSec: 3 })
  })

  it('时长不足 0.1 秒的分段不生成字幕（避免闪现）', () => {
    const clips = buildSubtitleClipsFromTranscription(
      { startSec: 0, durationSec: 5, sourceOffsetSec: 0 },
      [seg(1, 1.05, '太短')],
      makeId
    )
    expect(clips).toEqual([])
  })

  it('起点超过 3600 秒上限时被夹住（不至于生成到天上）', () => {
    const clips = buildSubtitleClipsFromTranscription(
      { startSec: 3598, durationSec: 3, sourceOffsetSec: 0 },
      [seg(2.5, 3.5, '超界')],
      makeId
    )
    expect(clips[0]).toMatchObject({ startSec: 3600 })
    expect(clips[0]?.durationSec).toBeCloseTo(1)
  })

  it('没有分段时返回空数组', () => {
    expect(
      buildSubtitleClipsFromTranscription({ startSec: 0, durationSec: 6, sourceOffsetSec: 0 }, [], makeId)
    ).toEqual([])
  })

  it('id 由调用方工厂产出（序号从 0 起），sourceId 带落点毫秒', () => {
    const clips = buildSubtitleClipsFromTranscription(
      { startSec: 0, durationSec: 5, sourceOffsetSec: 0 },
      [seg(0, 1, 'A'), seg(1, 2, 'B')],
      makeId
    )
    expect(clips.map((item) => item.id)).toEqual(['sub:0', 'sub:1'])
    expect(clips[0].sourceId).toBe('subtitle:transcribe:0')
    expect(clips[1].sourceId).toBe('subtitle:transcribe:1000')
  })
})
