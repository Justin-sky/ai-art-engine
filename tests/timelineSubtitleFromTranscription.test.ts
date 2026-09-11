/**
 * 字幕链路串联：转写分段 → 字幕片段 → 按区间替换落轨。
 *
 * 这个文件原本测渲染层的 `features/script/timelineSubtitleFromTranscription.ts`；
 * 该模块已下沉到共享层 `shared/graph/timelineSubtitle.ts`（编辑器与 MCP 共用一份口径，
 * 逐项断言见 `tests/timelineSubtitle.test.ts`）。下沉后这里只留**两段代码合起来才看得出来**的行为：
 * 字幕片段生成与 `timelineEdit` 的区间替换各自单测都过，串起来仍可能错位或堆积。
 */
import { describe, expect, it } from 'vitest'
import type {
  ScriptTimelineClip,
  ScriptTimelineDocument,
  ScriptTimelineTrackKind
} from '@shared/graph/scriptTimeline'
import { applyTimelineEdits } from '../src/shared/graph/timelineEdit'
import { buildSubtitleClipsFromTranscription } from '../src/shared/graph/timelineSubtitle'

function voice(overrides: Partial<ScriptTimelineClip> = {}): ScriptTimelineClip {
  return {
    id: 'voice-1',
    track: 'voice',
    sourceId: 'voice-1',
    title: '配音 1',
    startSec: 0,
    durationSec: 6,
    ...overrides
  }
}

function clip(
  track: ScriptTimelineTrackKind,
  id: string,
  startSec: number,
  durationSec: number
): ScriptTimelineClip {
  return { id, track, sourceId: `src:${id}`, title: id, startSec, durationSec }
}

function doc(clips: ScriptTimelineClip[]): ScriptTimelineDocument {
  return { clips }
}

const makeClipId = (track: ScriptTimelineTrackKind, index: number): string =>
  `new:${track}:${index}`

const voiceSegments = [
  { startSec: 0.5, endSec: 1.8, text: '第一句' },
  { startSec: 2.1, endSec: 3.4, text: '第二句' }
]

/** 按配音区间重建字幕轨：MCP `timeline_edit` 的 subtitles 指令走的就是这条 */
function rebuildSubtitles(
  document: ScriptTimelineDocument,
  voiceClip: ScriptTimelineClip
): ReturnType<typeof applyTimelineEdits> {
  const subtitleClips = buildSubtitleClipsFromTranscription(
    voiceClip,
    voiceSegments,
    (at) => makeClipId('subtitle', at)
  )
  return applyTimelineEdits(
    document,
    [
      {
        op: 'replaceRange',
        track: 'subtitle',
        range: { startSec: voiceClip.startSec, endSec: voiceClip.startSec + voiceClip.durationSec },
        clips: subtitleClips
      }
    ],
    { makeClipId }
  )
}

describe('字幕链路串联', () => {
  it('重建字幕替换掉与配音区间重叠的旧字幕，其它片段原位不动', () => {
    const voiceClip = voice({ startSec: 10, durationSec: 6 })
    const result = rebuildSubtitles(
      doc([
        clip('subtitle', 'before', 0, 2),
        voiceClip,
        clip('subtitle', 'inside', 10, 6),
        clip('video', 'v', 0, 20),
        clip('subtitle', 'after', 20, 3)
      ]),
      voiceClip
    )
    expect([result.removed, result.added]).toEqual([1, 2])
    expect(result.failures).toEqual([])
    expect(result.document.clips.map((item) => item.id)).toEqual([
      'before',
      'voice-1',
      'v',
      'after',
      'new:subtitle:0',
      'new:subtitle:1'
    ])
    // 字幕落点 = 配音起点 + 源文件时间戳
    expect(result.document.clips[4]).toMatchObject({ startSec: 10.5, text: '第一句' })
    expect(result.document.clips[5]).toMatchObject({ startSec: 12.1, text: '第二句' })
  })

  it('同一区间二次重建不会让字幕堆积（旧的那批被替换掉）', () => {
    const voiceClip = voice({ startSec: 10, durationSec: 6 })
    const first = rebuildSubtitles(doc([voiceClip]), voiceClip)
    const second = rebuildSubtitles(first.document, voiceClip)
    const subtitles = second.document.clips.filter((item) => item.track === 'subtitle')
    expect(subtitles.map((item) => item.id)).toEqual(['new:subtitle:0', 'new:subtitle:1'])
  })

  it('配音片段有取段起点时，字幕跟着取段起点回退后落轨', () => {
    const voiceClip = voice({ startSec: 100, durationSec: 4, sourceOffsetSec: 30 })
    const subtitleClips = buildSubtitleClipsFromTranscription(
      voiceClip,
      [
        { startSec: 30, endSec: 32, text: 'A' },
        { startSec: 33, endSec: 34, text: 'B' }
      ],
      (at) => makeClipId('subtitle', at)
    )
    const result = applyTimelineEdits(
      doc([voiceClip]),
      [
        {
          op: 'replaceRange',
          track: 'subtitle',
          range: { startSec: 100, endSec: 104 },
          clips: subtitleClips
        }
      ],
      { makeClipId }
    )
    expect(result.document.clips.map((item) => [item.title, item.startSec])).toEqual([
      ['配音 1', 100],
      ['A', 100],
      ['B', 103]
    ])
  })
})
