import { describe, expect, it } from 'vitest'
import {
  deductReservedImageSlots,
  formatDurationRange,
  formatPortLimitBadge,
  mergeImageUrlsWithStyleBudget,
  portLimitMaxForDataType,
  resolveVideoGeneratePortLimits,
  shouldShowPortLimitBadge,
  GraphPortType
} from '../src/shared/graph'

describe('portInputLimits', () => {
  it('formats badge as number or *', () => {
    expect(formatPortLimitBadge(4)).toBe('4')
    expect(formatPortLimitBadge(0)).toBe('0')
    expect(formatPortLimitBadge(null)).toBe('*')
    expect(formatPortLimitBadge(undefined)).toBe('*')
  })

  it('formats duration ranges', () => {
    expect(formatDurationRange([])).toBe('')
    expect(formatDurationRange([5])).toBe('5s')
    expect(formatDurationRange([4, 5, 6, 7, 8])).toBe('4–8s')
    expect(formatDurationRange([4, 6, 8])).toBe('4/6/8s')
  })

  it('only shows badges on media input ports', () => {
    expect(
      shouldShowPortLimitBadge({ direction: 'in', dataType: GraphPortType.image })
    ).toBe(true)
    expect(
      shouldShowPortLimitBadge({ direction: 'in', dataType: GraphPortType.text })
    ).toBe(false)
    expect(
      shouldShowPortLimitBadge({ direction: 'out', dataType: GraphPortType.video })
    ).toBe(false)
  })

  it('resolves Seedance known media caps', () => {
    const caps = resolveVideoGeneratePortLimits('bytedance/seedance-2.0', {
      supported_durations: [4, 8, 12]
    })
    expect(caps.maxImages).toBe(9)
    expect(caps.maxVideos).toBe(3)
    expect(caps.maxVoices).toBe(3)
    expect(caps.durations).toEqual([4, 8, 12])
  })

  it('leaves unknown models as undeclared *', () => {
    const caps = resolveVideoGeneratePortLimits('google/veo-3.1', {
      supported_durations: [4, 6, 8]
    })
    expect(caps.maxImages).toBeNull()
    expect(caps.maxVideos).toBeNull()
    expect(caps.maxVoices).toBeNull()
    expect(formatPortLimitBadge(caps.maxVideos)).toBe('*')
  })

  it('maps port data types for image vs video nodes', () => {
    expect(
      portLimitMaxForDataType(GraphPortType.image, { kind: 'image', imageMax: 14 })
    ).toBe(14)
    expect(
      portLimitMaxForDataType(GraphPortType.text, { kind: 'image', imageMax: 14 })
    ).toBeUndefined()
    expect(
      portLimitMaxForDataType(GraphPortType.video, {
        kind: 'video',
        videoLimits: {
          maxImages: 9,
          maxVideos: 3,
          maxVoices: 3,
          durations: []
        }
      })
    ).toBe(3)
  })

  it('deducts style slots from image port budget', () => {
    expect(deductReservedImageSlots(14, 2)).toBe(12)
    expect(deductReservedImageSlots(2, 4)).toBe(0)
    expect(deductReservedImageSlots(null, 2)).toBeNull()
    expect(deductReservedImageSlots(undefined, 2)).toBeUndefined()
  })

  it('merges style urls first within budget', () => {
    expect(
      mergeImageUrlsWithStyleBudget(
        ['port-a', 'port-b', 'port-c'],
        ['style-1', 'style-2'],
        3
      )
    ).toEqual(['style-1', 'style-2', 'port-a'])
  })
})
