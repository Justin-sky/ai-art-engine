import { describe, expect, it } from 'vitest'
import { listInstructionPresets } from '../src/shared/graph'

describe('image instruction presets', () => {
  it('exposes the requested image generation presets', () => {
    const presets = listInstructionPresets('image')
    expect(presets.map((item) => item.id)).toEqual([
      'image.multiAngle9',
      'image.story4',
      'image.faceTurnaround',
      'image.characterSheet',
      'image.characterTurnaround',
      'image.sceneSheet',
      'image.productSheet',
      'image.story25',
      'image.cinematicLighting',
      'image.physics3sLater',
      'image.physics5sBefore',
      'image.panorama720',
      'image.shotEstablish',
      'image.shotDetail',
      'image.shotConfrontation'
    ])
    for (const item of presets) {
      expect(item.body.trim().length).toBeGreaterThan(20)
      expect(item.titleKey).toMatch(
        /^graph\.inspector\.generate\.presets\.image\./
      )
    }
  })
})
