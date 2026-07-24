import { describe, expect, it } from 'vitest'
import {
  getInstructionPreset,
  insertInstructionPresetText,
  listInstructionPresets
} from '../src/shared/graph'

describe('video instruction presets', () => {
  it('exposes the planned video generation presets', () => {
    const presets = listInstructionPresets('video')
    expect(presets.map((item) => item.id)).toEqual([
      'video.firstLastFrame',
      'video.cameraDolly',
      'video.cameraPanTilt',
      'video.cameraOrbit',
      'video.cameraCrane',
      'video.cameraFollow',
      'video.cameraCombo',
      'video.textToVideo',
      'video.multimodalRef',
      'video.shotEstablish',
      'video.shotDetail',
      'video.heroEntrance',
      'video.performanceRealism',
      'video.transitionHard',
      'video.transitionFlash',
      'video.transitionMotion'
    ])
    for (const item of presets) {
      expect(item.body.trim().length).toBeGreaterThan(20)
      expect(item.titleKey).toMatch(
        /^graph\.inspector\.generate\.presets\.video\./
      )
    }
  })

  it('firstLastFrame template uses structural first/last frames, not @ mentions', () => {
    const preset = getInstructionPreset('video', 'video.firstLastFrame')
    expect(preset?.body).toContain('首帧')
    expect(preset?.body).toContain('尾帧')
    expect(preset?.body).toContain('首尾帧')
    expect(preset?.body).toContain('勿接参考图')
    expect(preset?.body).not.toMatch(/第一帧@1|最后一帧@2/)
  })

  it('camera presets warn against mixing reference images in FL2V', () => {
    const cameraIds = [
      'video.cameraDolly',
      'video.cameraPanTilt',
      'video.cameraOrbit',
      'video.cameraCrane',
      'video.cameraFollow',
      'video.cameraCombo'
    ] as const
    for (const id of cameraIds) {
      const preset = getInstructionPreset('video', id)
      expect(preset?.body).toContain('首帧')
      expect(preset?.body).toContain('尾帧')
      expect(preset?.body).toContain('勿接参考图')
      expect(preset?.body).not.toMatch(/第一帧@1|最后一帧@2|@2\[/)
    }
  })

  it('inserts a preset at the caret without deleting existing instructions', () => {
    const result = insertInstructionPresetText('开头结尾', '预设正文', 2)
    expect(result.text).toBe('开头\n预设正文\n结尾')
    expect(result.cursor).toBe('开头\n预设正文\n'.length)
  })
})
