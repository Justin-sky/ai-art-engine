import { describe, expect, it } from 'vitest'
import {
  localizedText,
  SFX_PRESETS,
  SFX_PRESET_CATEGORIES,
  type SfxPresetCategory
} from '../src/renderer/src/features/timeline/sfxPresets'

const VALID_CATEGORIES: SfxPresetCategory[] = ['transition', 'ui', 'ambient']

describe('SFX_PRESETS', () => {
  it('id 唯一且分类合法', () => {
    const ids = new Set<string>()
    for (const preset of SFX_PRESETS) {
      expect(ids.has(preset.id)).toBe(false)
      ids.add(preset.id)
      expect(VALID_CATEGORIES).toContain(preset.category)
    }
    expect(SFX_PRESETS.length).toBeGreaterThanOrEqual(15)
  })

  it('每个预设均有中英文名称与 prompt', () => {
    for (const preset of SFX_PRESETS) {
      expect(preset.name.zh.trim().length).toBeGreaterThan(0)
      expect(preset.name.en.trim().length).toBeGreaterThan(0)
      expect(preset.prompt.zh.trim().length).toBeGreaterThan(0)
      expect(preset.prompt.en.trim().length).toBeGreaterThan(0)
    }
  })

  it('三个分类均有预设，且时长参考合理', () => {
    for (const category of VALID_CATEGORIES) {
      const list = SFX_PRESETS.filter((p) => p.category === category)
      expect(list.length).toBeGreaterThanOrEqual(4)
      for (const preset of list) {
        if (preset.durationSec !== undefined) {
          expect(preset.durationSec).toBeGreaterThanOrEqual(1)
          expect(preset.durationSec).toBeLessThanOrEqual(15)
        }
      }
    }
  })

  it('分类元数据完整覆盖', () => {
    const ids = SFX_PRESET_CATEGORIES.map((c) => c.id)
    expect(ids.sort()).toEqual([...VALID_CATEGORIES].sort())
    for (const meta of SFX_PRESET_CATEGORIES) {
      expect(meta.label.zh.trim().length).toBeGreaterThan(0)
      expect(meta.label.en.trim().length).toBeGreaterThan(0)
    }
  })

  it('localizedText 按语言取用', () => {
    const preset = SFX_PRESETS[0]!
    expect(localizedText('zh-CN', preset.name)).toBe(preset.name.zh)
    expect(localizedText('en-US', preset.name)).toBe(preset.name.en)
    expect(localizedText('en', preset.name)).toBe(preset.name.en)
  })
})
