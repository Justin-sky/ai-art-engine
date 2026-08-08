import { describe, expect, it } from 'vitest'
import { parseKeyframeTimes } from '../src/main/services/ffprobeService'

describe('ffprobe keyframe parser', () => {
  it('parses csv pts times', () => {
    expect(parseKeyframeTimes('0.000000,1\n0.033000,0\n0.500000,1\n1.000000,1\n')).toEqual([
      0, 0.5, 1
    ])
  })

  it('skips invalid lines and dedupes / sorts', () => {
    expect(
      parseKeyframeTimes('0.500000,1\nN/A,0\n0.500000,1\n0.250000,1\n0.750000,0\n')
    ).toEqual([0.25, 0.5])
  })

  it('returns empty for empty input', () => {
    expect(parseKeyframeTimes('')).toEqual([])
  })
})
