import { describe, expect, it } from 'vitest'
import { buildSubtitleClipsFromTranscription } from '../src/renderer/src/features/script/timelineSubtitleFromTranscription'
import type { ScriptTimelineClip } from '@shared/graph/scriptTimeline'

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

const ids: string[] = []
const makeId = (_index: number): string => {
  const id = `sub-${ids.length + 1}`
  ids.push(id)
  return id
}

describe('buildSubtitleClipsFromTranscription', () => {
  it('offsets segments by the voice clip start time', () => {
    const clips = buildSubtitleClipsFromTranscription(voice({ startSec: 10, durationSec: 6 }), [
      { startSec: 0.5, endSec: 1.8, text: '你好' },
      { startSec: 2.1, endSec: 3.4, text: '世界' }
    ], makeId)
    expect(clips).toHaveLength(2)
    expect(clips[0]).toMatchObject({ track: 'subtitle', startSec: 10.5, text: '你好' })
    expect(clips[0]?.durationSec).toBeCloseTo(1.3)
    expect(clips[1]).toMatchObject({ track: 'subtitle', startSec: 12.1, text: '世界' })
    expect(clips[1]?.durationSec).toBeCloseTo(1.3)
  })

  it('skips blank text segments', () => {
    const clips = buildSubtitleClipsFromTranscription(voice(), [
      { startSec: 0, endSec: 1, text: '   ' },
      { startSec: 1, endSec: 2, text: '' },
      { startSec: 2, endSec: 3, text: '有效' }
    ], makeId)
    expect(clips).toHaveLength(1)
    expect(clips[0]?.text).toBe('有效')
  })

  it('clips segments beyond the voice clip duration', () => {
    const clips = buildSubtitleClipsFromTranscription(voice({ startSec: 0, durationSec: 3 }), [
      { startSec: 2.5, endSec: 4.5, text: '收尾' }
    ], makeId)
    expect(clips).toHaveLength(1)
    expect(clips[0]?.startSec).toBe(2.5)
    expect(clips[0]?.durationSec).toBeCloseTo(0.5)
  })

  it('drops segments shorter than 0.1s', () => {
    const clips = buildSubtitleClipsFromTranscription(voice({ startSec: 0, durationSec: 3 }), [
      { startSec: 0, endSec: 0.05, text: '短' }
    ], makeId)
    expect(clips).toHaveLength(0)
  })

  it('clamps a start time beyond the 3600s cap', () => {
    const clips = buildSubtitleClipsFromTranscription(voice({ startSec: 3598, durationSec: 3 }), [
      { startSec: 2.5, endSec: 3.5, text: '超界' }
    ], makeId)
    expect(clips).toHaveLength(1)
    expect(clips[0]?.startSec).toBe(3600)
    expect(clips[0]?.durationSec).toBeCloseTo(1)
  })

  it('returns empty for no segments', () => {
    expect(buildSubtitleClipsFromTranscription(voice(), [], makeId)).toHaveLength(0)
  })

  it('falls back to the whole text when a segment has no timestamp', () => {
    const clips = buildSubtitleClipsFromTranscription(voice({ startSec: 5, durationSec: 4 }), [
      { startSec: 0, endSec: 0, text: '整段兜底' }
    ], makeId)
    expect(clips).toHaveLength(1)
    expect(clips[0]).toMatchObject({
      startSec: 5,
      durationSec: 4,
      text: '整段兜底'
    })
  })
})
