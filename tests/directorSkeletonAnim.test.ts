import { describe, expect, it } from 'vitest'
import {
  directorAnimTrackHasContent,
  directorTrackSkeletonClips,
  readDirectorAnimation
} from '../src/shared/domain'
import {
  clampSkeletonSegmentRange,
  findActiveSkeletonSegment,
  placeSkeletonSegmentRange,
  skeletonClipLabel,
  skeletonSegmentLocalTime
} from '../src/renderer/src/features/director/skeletonAnim'

describe('director skeleton animation', () => {
  it('ignores legacy skeletonClip fields without skeletonClips', () => {
    const anim = readDirectorAnimation({
      duration: 8,
      loop: true,
      tracks: [
        {
          id: 't1',
          name: 'Hero',
          targetKind: 'object',
          targetId: 'obj-1',
          start: 0,
          end: 5,
          path: null,
          keyframes: [],
          skeletonClip: 'Walk',
          skeletonAssetId: 'anim-asset-1',
          skeletonSpeed: 1.5,
          skeletonLoop: false
        }
      ]
    })
    expect(anim.tracks).toHaveLength(1)
    expect(anim.tracks[0].skeletonClips).toBeUndefined()
    expect(directorTrackSkeletonClips(anim.tracks[0])).toEqual([])
  })

  it('keeps multi skeletonClips segments', () => {
    const anim = readDirectorAnimation({
      duration: 10,
      tracks: [
        {
          id: 't1',
          name: 'Hero',
          targetKind: 'object',
          targetId: 'obj-1',
          start: 0,
          end: 10,
          path: null,
          keyframes: [],
          skeletonClips: [
            { id: 'a', clip: 'Idle', start: 0, end: 2 },
            { id: 'b', clip: 'Walk', assetId: 'anim-1', start: 2, end: 5, speed: 1.2 }
          ]
        }
      ]
    })
    expect(directorTrackSkeletonClips(anim.tracks[0])).toHaveLength(2)
    expect(anim.tracks[0].skeletonClips?.[1]).toMatchObject({
      clip: 'Walk',
      assetId: 'anim-1',
      speed: 1.2
    })
  })

  it('directorAnimTrackHasContent treats skeleton clips as playable', () => {
    expect(
      directorAnimTrackHasContent({
        id: 't',
        name: 't',
        targetKind: 'object',
        targetId: 'o',
        start: 0,
        end: 2,
        path: null,
        keyframes: [],
        skeletonClips: [{ id: 's', clip: 'Idle', start: 0, end: 2 }]
      })
    ).toBe(true)
    expect(
      directorAnimTrackHasContent({
        id: 't',
        name: 't',
        targetKind: 'object',
        targetId: 'o',
        start: 0,
        end: 2,
        path: null,
        keyframes: []
      })
    ).toBe(false)
  })

  it('findActiveSkeletonSegment picks covering segment', () => {
    const track = {
      id: 't',
      name: 't',
      targetKind: 'object' as const,
      targetId: 'o',
      start: 0,
      end: 10,
      path: null,
      keyframes: [],
      skeletonClips: [
        { id: 'a', clip: 'Idle', start: 0, end: 2 },
        { id: 'b', clip: 'Walk', start: 2, end: 5 }
      ]
    }
    expect(findActiveSkeletonSegment(track, 1)?.id).toBe('a')
    expect(findActiveSkeletonSegment(track, 3)?.id).toBe('b')
    expect(findActiveSkeletonSegment(track, 8)).toBeNull()
  })

  it('placeSkeletonSegmentRange avoids overlaps', () => {
    const existing = [{ id: 'a', clip: 'Idle', start: 0, end: 2 }]
    expect(placeSkeletonSegmentRange(existing, 1, 1.5, 10)).toEqual({ start: 2, end: 3.5 })
    expect(placeSkeletonSegmentRange(existing, 5, 1, 10)).toEqual({ start: 5, end: 6 })
  })

  it('clampSkeletonSegmentRange keeps min length and neighbors', () => {
    const existing = [
      { id: 'a', clip: 'Idle', start: 0, end: 2 },
      { id: 'b', clip: 'Walk', start: 2, end: 5 },
      { id: 'c', clip: 'Run', start: 6, end: 8 }
    ]
    expect(clampSkeletonSegmentRange(existing, 'b', 1, 7, 10)).toEqual({ start: 2, end: 6 })
  })

  it('skeletonSegmentLocalTime loops and applies speed', () => {
    expect(
      skeletonSegmentLocalTime(3, { start: 1, end: 10, speed: 2, loop: true }, 1.5)
    ).toEqual({ active: true, time: 1 })
  })

  it('skeletonClipLabel shortens Mixamo pipe paths', () => {
    expect(skeletonClipLabel('Armature|mixamo.com|Layer0', 0)).toBe('Layer0')
    expect(skeletonClipLabel('mixamo.com|Walking', 1)).toBe('Walking')
    expect(skeletonClipLabel('Armature|Idle', 0)).toBe('Idle')
  })
})
