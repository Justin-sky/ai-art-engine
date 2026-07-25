import { describe, expect, it } from 'vitest'
import {
  resolveInstructionVisual,
  resolveShotStagingVisual,
  shotSizeFromLabel
} from '../src/shared/graph/presetVisual'

describe('presetVisual', () => {
  it('maps Chinese shot size labels', () => {
    expect(shotSizeFromLabel('全景')).toBe('full')
    expect(shotSizeFromLabel('特写')).toBe('close')
  })

  it('infers staging visuals from id/group', () => {
    expect(
      resolveShotStagingVisual({
        id: 'facing.profile',
        group: 'bodyFacing',
        shotSize: '特写'
      })
    ).toEqual({ kind: 'facing', facing: 'profile', shotSize: 'close' })

    expect(
      resolveShotStagingVisual({
        id: 'lighting.rembrandt',
        group: 'lighting'
      }).kind
    ).toBe('lighting')

    expect(
      resolveShotStagingVisual({
        id: 'camera.dutch',
        group: 'cameraLanguage',
        shotSize: '中景'
      }).camera
    ).toBe('dutch')
  })

  it('infers instruction visuals from id', () => {
    expect(resolveInstructionVisual({ id: 'image.multiAngle9' })).toEqual({
      kind: 'grid',
      grid: { cols: 3, rows: 3 }
    })
    expect(resolveInstructionVisual({ id: 'video.cameraOrbit' }).camera).toBe('orbit')
    expect(resolveInstructionVisual({ id: 'screenplay.create' }).kind).toBe('chips')
  })

  it('keeps explicit visual override', () => {
    expect(
      resolveInstructionVisual({
        id: 'image.multiAngle9',
        visual: { kind: 'icon', icon: 'X' }
      })
    ).toEqual({ kind: 'icon', icon: 'X' })
  })
})
