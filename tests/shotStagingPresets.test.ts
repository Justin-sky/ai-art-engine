import { describe, expect, it } from 'vitest'
import { createEmptyStoryboard } from '../src/shared/domain'
import {
  SHOT_STAGING_PRESETS,
  applyShotStagingPreset,
  shotStagingPresetTargetFields
} from '../src/shared/graph'

describe('shot staging presets', () => {
  it('covers camera, facing, performance, lighting and advertising groups', () => {
    expect(new Set(SHOT_STAGING_PRESETS.map((preset) => preset.group))).toEqual(
      new Set(['cameraLanguage', 'bodyFacing', 'performance', 'lighting', 'advertising'])
    )
  })

  it('applies only fields supplied by a preset', () => {
    const original = {
      ...createEmptyStoryboard(),
      visualDescription: '保留原画面',
      shotSize: '中景',
      cameraMove: '保留原运镜'
    }
    const lighting = SHOT_STAGING_PRESETS.find((preset) => preset.id === 'lighting.top')
    expect(lighting).toBeDefined()

    const next = applyShotStagingPreset(original, lighting!, 'zh-CN')
    expect(next.visualDescription).toBe('保留原画面')
    expect(next.shotSize).toBe('中景')
    expect(next.cameraMove).toBe('保留原运镜')
    expect(next.lighting).toContain('眼窝')
    expect(shotStagingPresetTargetFields(lighting!)).toEqual(['lighting'])
  })

  it('resolves English template text for an English locale', () => {
    const preset = SHOT_STAGING_PRESETS.find((item) => item.id === 'facing.threeQuarter')
    expect(preset).toBeDefined()
    const next = applyShotStagingPreset(createEmptyStoryboard(), preset!, 'en-US')
    expect(next.visualDescription).toContain('three-quarter')
  })

  it('inserts preset text at the caret without clearing existing content', () => {
    const original = {
      ...createEmptyStoryboard(),
      visualDescription: '前文后文'
    }
    const preset = SHOT_STAGING_PRESETS.find((item) => item.id === 'facing.front')
    expect(preset).toBeDefined()

    const next = applyShotStagingPreset(original, preset!, 'zh-CN', {
      insertAt: { visualDescription: 2 }
    })
    expect(next.visualDescription).toMatch(/^前文严格全正面拍摄/)
    expect(next.visualDescription).toContain('后文')
  })
})
