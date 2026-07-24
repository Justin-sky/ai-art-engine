import { describe, expect, it } from 'vitest'
import {
  MULTI_ANGLE_PRESETS,
  applyMultiAnglePreset,
  buildMultiAnglePrompt,
  markMultiAngleCustom,
  multiAngleCameraToNodePatch,
  normalizeMultiAngleCamera,
  resolveMultiAngleOutputPrompt,
  resolveMultiAnglePresetPanelPrompt,
  shotScaleLabel
} from '../src/shared/graph'

describe('multiAngleCamera', () => {
  it('matches screenshot preset table', () => {
    const byId = Object.fromEntries(MULTI_ANGLE_PRESETS.map((p) => [p.id, p]))
    expect(byId.fisheye).toMatchObject({
      yaw: 0,
      pitch: 30,
      shotScale: 1,
      prompt: '极度特写镜头，广角镜头，边缘带有鱼眼畸变效果'
    })
    expect(byId.dutch).toMatchObject({
      yaw: 45,
      pitch: -30,
      shotScale: 0.5,
      prompt: 'dutch angle, tilted frame'
    })
    expect(byId.frontHigh).toMatchObject({ yaw: 0, pitch: 60, shotScale: 0.5 })
    expect(byId.frontHigh.prompt).toBeUndefined()
    expect(byId.frontLow).toMatchObject({ yaw: 0, pitch: -30, shotScale: 0.5 })
    expect(byId.frontLow.prompt).toBeUndefined()
    expect(byId.panoramaHigh).toMatchObject({ yaw: 45, pitch: 30, shotScale: 0 })
    expect(byId.panoramaHigh.prompt).toBeUndefined()
    expect(byId.back).toMatchObject({ yaw: 180, pitch: 0, shotScale: 0.5 })
    expect(byId.back.prompt).toBeUndefined()
  })

  it('builds camera prompts from yaw/pitch/scale only', () => {
    expect(buildMultiAnglePrompt(applyMultiAnglePreset('fisheye', true))).toBe(
      '极度特写镜头，正面，俯拍'
    )
    expect(buildMultiAnglePrompt(applyMultiAnglePreset('dutch', true))).toBe(
      '中景镜头，右侧约45°，仰拍'
    )
    expect(buildMultiAnglePrompt(applyMultiAnglePreset('back', true))).toBe(
      '中景镜头，背面，平视'
    )
    expect(buildMultiAnglePrompt(applyMultiAnglePreset('frontHigh', false))).toBe(
      '中景镜头，正面，强俯拍'
    )
  })

  it('splices panel prompt only when promptEnabled', () => {
    const off = normalizeMultiAngleCamera({
      presetId: 'back',
      yaw: 180,
      pitch: 0,
      shotScale: 0.5,
      promptEnabled: false
    })
    const on = { ...off, promptEnabled: true }
    const cameraOnly = buildMultiAnglePrompt(off)
    expect(resolveMultiAngleOutputPrompt(off, '面板主体描述')).toBe(cameraOnly)
    expect(resolveMultiAngleOutputPrompt(on, '面板主体描述')).toBe(
      `面板主体描述\n${cameraOnly}`
    )
  })

  it('marks custom when sliders change', () => {
    const base = applyMultiAnglePreset('frontHigh', true)
    const custom = markMultiAngleCustom({ ...base, yaw: 12 })
    expect(custom.presetId).toBe('custom')
    expect(custom.yaw).toBe(12)
    expect(custom.promptEnabled).toBe(true)
  })

  it('maps shot scale labels', () => {
    expect(shotScaleLabel(0)).toBe('全景')
    expect(shotScaleLabel(0.5)).toBe('中景')
    expect(shotScaleLabel(1)).toBe('特写')
  })

  it('writes node patch with optional panel splice', () => {
    const patch = multiAngleCameraToNodePatch(
      normalizeMultiAngleCamera({
        presetId: 'panoramaHigh',
        yaw: 45,
        pitch: 30,
        shotScale: 0,
        promptEnabled: true
      }),
      '雪地人像'
    )
    expect(patch.multiAngleCamera.presetId).toBe('panoramaHigh')
    expect(patch.multiAnglePrompt).toMatch(/雪地人像/)
    expect(patch.multiAnglePrompt).toMatch(/全景/)
  })

  it('only fisheye/dutch presets provide panel prompt text', () => {
    expect(resolveMultiAnglePresetPanelPrompt('custom')).toBe('')
    expect(resolveMultiAnglePresetPanelPrompt('frontHigh')).toBe('')
    expect(resolveMultiAnglePresetPanelPrompt('frontLow')).toBe('')
    expect(resolveMultiAnglePresetPanelPrompt('panoramaHigh')).toBe('')
    expect(resolveMultiAnglePresetPanelPrompt('back')).toBe('')
    expect(resolveMultiAnglePresetPanelPrompt('fisheye')).toBe(
      '极度特写镜头，广角镜头，边缘带有鱼眼畸变效果'
    )
    expect(resolveMultiAnglePresetPanelPrompt('dutch')).toBe('dutch angle, tilted frame')
  })
})
