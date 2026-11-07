import { describe, expect, it } from 'vitest'
import {
  SEMANTIC_TIMELINE_SCHEMA,
  adaptiveSceneThreshold,
  buildShotsFromCutPoints,
  createEmptySemanticTimeline,
  makeTimeRange,
  parseSceneCutPtsTimes,
  roundtripDurationOk,
  shortHash,
  singleShot,
  timelineId,
  validateSemanticTimeline
} from '../src/shared/semanticTimeline'

describe('semanticTimeline schema', () => {
  it('creates a valid empty v2 document', () => {
    const doc = createEmptySemanticTimeline('vid-1', {
      durationSec: 60,
      fps: 30,
      width: 1080,
      height: 1920,
      hasAudio: true
    })
    expect(doc.schema).toBe(SEMANTIC_TIMELINE_SCHEMA)
    expect(doc.id).toBe(timelineId('vid-1'))
    expect(doc.shots).toEqual([])
    expect(doc.dialogue).toEqual([])
    const v = validateSemanticTimeline(doc)
    expect(v.ok).toBe(true)
  })

  it('rejects malformed source dimensions or invalid dialogue ranges', () => {
    const doc = createEmptySemanticTimeline('vid-1', {
      durationSec: 10,
      fps: 30,
      width: 1280,
      height: 720,
      hasAudio: false
    })
    doc.dialogue = [
      {
        id: 'dlg.bad',
        range: makeTimeRange(5, 2, 30),
        text: 'bad range',
        sourceText: 'bad range',
        granularity: 'sentence',
        confidence: 0.9,
        origin: 'analysis'
      }
    ]
    // Invalid reversed range (start > end) is flagged by validator
    doc.dialogue[0]!.range = { start: 5, end: 2, startFrame: 150, endFrame: 60 }
    expect(validateSemanticTimeline(doc).ok).toBe(false)
  })

  it('shortHash is stable', () => {
    expect(shortHash('abc')).toBe(shortHash('abc'))
    expect(shortHash('abc')).not.toBe(shortHash('abd'))
  })
})

describe('shots + L0 roundtrip', () => {
  it('builds shots from cut points and merges short ones', () => {
    const shots = buildShotsFromCutPoints([1, 1.1, 5, 9], 10, 30, { minShotSec: 0.4 })
    expect(shots.length).toBeGreaterThanOrEqual(3)
    expect(shots[0]!.range.start).toBe(0)
    expect(shots[shots.length - 1]!.range.end).toBe(10)
    const rt = roundtripDurationOk(10, shots, 30)
    expect(rt.ok).toBe(true)
  })

  it('singleShot covers whole duration', () => {
    const shots = singleShot(12.5, 25)
    expect(shots).toHaveLength(1)
    expect(roundtripDurationOk(12.5, shots, 25).ok).toBe(true)
  })

  it('parses ffmpeg scene pts_time', () => {
    const stderr = 'n:12 pts:123 pts_time:1.234 foo\npts_time=3.5 bar'
    expect(parseSceneCutPtsTimes(stderr)).toEqual([1.234, 3.5])
  })

  it('adaptive threshold clamps by duration', () => {
    expect(adaptiveSceneThreshold(10)).toBeLessThan(0.35)
    expect(adaptiveSceneThreshold(120)).toBeGreaterThan(0.35)
  })
})
