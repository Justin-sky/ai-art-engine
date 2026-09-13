import { describe, expect, it } from 'vitest'
import type { YoloBox, YoloDetectResult } from '../src/shared/yolo'
import {
  buildVideoBeatSegments,
  buildVideoBeatTags,
  buildVideoBeatTimestamps,
  summarizeVideoBeatFrame,
  summarizeVideoBeatSamples,
  videoBeatKindOf,
  type VideoBeatSample
} from '../src/shared/videoBeats'

function box(label: string, confidence: number): YoloBox {
  return { label, confidence, x: 0, y: 0, width: 10, height: 10 }
}

function detect(boxes: YoloBox[], width = 640, height = 640, inferenceMs = 12): YoloDetectResult {
  return { width, height, boxes, inferenceMs }
}

function sample(
  timeSec: number,
  boxes: YoloBox[],
  manual?: Partial<VideoBeatSample>
): VideoBeatSample {
  return { ...summarizeVideoBeatFrame(detect(boxes), timeSec), ...manual }
}

const person = (confidence = 0.9) => box('person', confidence)
const car = (confidence = 0.8) => box('car', confidence)
const bird = (confidence = 0.5) => box('bird', confidence)

describe('videoBeats', () => {
  describe('buildVideoBeatTimestamps', () => {
    it('samples every interval and includes the end frame', () => {
      expect(buildVideoBeatTimestamps(10)).toEqual([0, 2, 4, 6, 8, 10])
      expect(buildVideoBeatTimestamps(10, { intervalSec: 5 })).toEqual([0, 5, 10])
    })

    it('caps sample count', () => {
      const ts = buildVideoBeatTimestamps(100, { intervalSec: 2, maxSamples: 6 })
      expect(ts).toHaveLength(6)
      expect(ts[0]).toBe(0)
      expect(ts[ts.length - 1]).toBe(100)
    })

    it('keeps first frame for sub-interval videos and returns [] for invalid duration', () => {
      expect(buildVideoBeatTimestamps(1.2)).toEqual([0])
      expect(buildVideoBeatTimestamps(0)).toEqual([])
      expect(buildVideoBeatTimestamps(Number.NaN)).toEqual([])
    })
  })

  describe('summarizeVideoBeatFrame', () => {
    it('counts persons, keeps labels by confidence desc, dedupes and caps', () => {
      const out = summarizeVideoBeatFrame(
        detect([person(0.4), bird(0.95), person(0.9), bird(0.6), car(0.2)]),
        3.14
      )
      expect(out.timeSec).toBe(3.14)
      expect(out.personCount).toBe(2)
      expect(out.objectCount).toBe(5)
      expect(out.isEmpty).toBe(false)
      expect(out.labels).toEqual(['bird', 'person', 'car'])
      expect(out.labelsZh).toEqual(['鸟', '人物', '汽车'])
    })

    it('marks empty frame', () => {
      const out = summarizeVideoBeatFrame(detect([]), 0)
      expect(out.isEmpty).toBe(true)
      expect(out.objectCount).toBe(0)
      expect(out.labels).toEqual([])
    })
  })

  describe('videoBeatKindOf', () => {
    it('classifies solo / group / objects / empty', () => {
      expect(videoBeatKindOf(sample(0, [person()]))).toBe('person-solo')
      expect(videoBeatKindOf(sample(0, [person(), person(0.8)]))).toBe('person-group')
      expect(videoBeatKindOf(sample(0, [car()]))).toBe('objects')
      expect(videoBeatKindOf(sample(0, []))).toBe('empty')
    })
  })

  describe('buildVideoBeatSegments', () => {
    it('merges adjacent same-kind samples and splits at midpoints', () => {
      const samples = [
        sample(0, [person()]),
        sample(2, [person()]),
        sample(4, [person(), person(0.8)]),
        sample(6, []),
        sample(8, [])
      ]
      const segments = buildVideoBeatSegments(samples, 10)
      expect(segments).toEqual([
        { kind: 'person-solo', fromSec: 0, toSec: 3, labels: ['person'] },
        { kind: 'person-group', fromSec: 3, toSec: 5, labels: ['person'] },
        { kind: 'empty', fromSec: 5, toSec: 10, labels: [] }
      ])
    })

    it('spans whole duration for a single sample and returns [] for empty input', () => {
      const segments = buildVideoBeatSegments([sample(5, [car()])], 8)
      expect(segments).toEqual([{ kind: 'objects', fromSec: 0, toSec: 8, labels: ['car'] }])
      expect(buildVideoBeatSegments([], 8)).toEqual([])
    })

    it('defensively sorts out-of-order samples', () => {
      const segments = buildVideoBeatSegments([sample(6, []), sample(2, [person()])], 8)
      expect(segments).toEqual([
        { kind: 'person-solo', fromSec: 0, toSec: 4, labels: ['person'] },
        { kind: 'empty', fromSec: 4, toSec: 8, labels: [] }
      ])
    })
  })

  describe('summarizeVideoBeatSamples', () => {
    it('aggregates first / last occurrence per label, sorted by frames desc', () => {
      const summary = summarizeVideoBeatSamples([
        sample(0, [person()]),
        sample(2, [car()]),
        sample(4, [person(), car(0.7)])
      ])
      expect(summary).toEqual([
        { label: 'person', labelZh: '人物', frames: 2, firstSec: 0, lastSec: 4 },
        { label: 'car', labelZh: '汽车', frames: 2, firstSec: 2, lastSec: 4 }
      ])
    })
  })

  describe('buildVideoBeatTags', () => {
    it('assembles the persisted shape', () => {
      const tags = buildVideoBeatTags({
        durationSec: 6,
        modelId: 'yolo11n',
        runAt: '2026-09-05T00:00:00.000Z',
        samples: [sample(0, [person()]), sample(3, []), sample(6, [person(), person(0.8)])]
      })
      expect(tags).toMatchObject({
        v: 1,
        status: 'ok',
        modelId: 'yolo11n',
        durationSec: 6,
        runAt: '2026-09-05T00:00:00.000Z'
      })
      expect(tags.samples.map((s) => s.timeSec)).toEqual([0, 3, 6])
      expect(tags.segments).toEqual([
        { kind: 'person-solo', fromSec: 0, toSec: 1.5, labels: ['person'] },
        { kind: 'empty', fromSec: 1.5, toSec: 4.5, labels: [] },
        { kind: 'person-group', fromSec: 4.5, toSec: 6, labels: ['person'] }
      ])
      expect(tags.summary).toEqual([
        { label: 'person', labelZh: '人物', frames: 2, firstSec: 0, lastSec: 6 }
      ])
    })
  })
})
