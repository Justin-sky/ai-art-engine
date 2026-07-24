import { describe, expect, it } from 'vitest'
import {
  LIGHTING_PRESETS,
  applyLightingDirection,
  applyLightingPreset,
  buildLightingManualPrompt,
  lightingSetupToNodePatch,
  nearestLightingDirection,
  normalizeLightingSetup,
  resolveLightingOutputPrompt
} from '../src/shared/graph'

describe('lightingSetup', () => {
  it('applies golden hour preset', () => {
    const s = applyLightingPreset('goldenHour')
    expect(s.presetId).toBe('goldenHour')
    expect(s.rimLight).toBe(true)
    expect(s.smartPrompt).toContain('黄金时刻')
    expect(s.color).toBe('#ffb347')
  })

  it('builds manual prompt from direction/brightness/rim', () => {
    const s = normalizeLightingSetup({
      mainDirection: 'front',
      brightness: 50,
      color: '#ffffff',
      rimLight: false
    })
    expect(buildLightingManualPrompt(s)).toBe(
      '主光来自前方，白色光，中等亮度，无轮廓光'
    )
  })

  it('splices smart prompt when smartMode on', () => {
    const off = normalizeLightingSetup({
      smartMode: false,
      smartPrompt: "让画面光影变成'黄金时刻'",
      mainDirection: 'front',
      brightness: 50,
      color: '#ffffff'
    })
    const on = { ...off, smartMode: true }
    const manual = buildLightingManualPrompt(off)
    expect(resolveLightingOutputPrompt(off)).toBe(manual)
    expect(resolveLightingOutputPrompt(on)).toBe(
      `让画面光影变成'黄金时刻'\n${manual}`
    )
  })

  it('applies direction shortcuts', () => {
    const s = applyLightingDirection(normalizeLightingSetup(), 'left')
    expect(s.mainDirection).toBe('left')
    expect(s.yaw).toBe(-90)
    expect(s.presetId).toBe('custom')
  })

  it('finds nearest direction', () => {
    expect(nearestLightingDirection(0, 0)).toBe('front')
    expect(nearestLightingDirection(180, 0)).toBe('back')
    expect(nearestLightingDirection(-90, 0)).toBe('left')
  })

  it('writes node patch with final prompt', () => {
    const preset = LIGHTING_PRESETS.find((p) => p.id === 'rembrandt')!
    const patch = lightingSetupToNodePatch(applyLightingPreset('rembrandt'))
    expect(patch.lightingSetup.presetId).toBe('rembrandt')
    expect(patch.lightingPrompt).toContain(preset.prompt)
    expect(patch.lightingPrompt).toContain('主光来自左侧')
  })
})
