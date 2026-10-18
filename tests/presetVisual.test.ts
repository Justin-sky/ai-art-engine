import { describe, expect, it } from 'vitest'
import {
  listInstructionPresets,
  type InstructionPresetKind
} from '../src/shared/graph/instructionPresets'
import {
  resolveInstructionVisual,
  resolveShotStagingVisual,
  shotSizeFromLabel
} from '../src/shared/graph/presetVisual'
import { buildPresetSchematicSvg } from '../src/renderer/src/features/graph/presetSchematicSvg'

const ALL_PRESET_KINDS: InstructionPresetKind[] = [
  'screenplay',
  'gameSystem',
  'image',
  'video',
  'lipSync',
  'reshoot',
  'voice',
  'dialogue',
  'sfx',
  'music',
  'toPrompt',
  'optimize',
  'spatialWorldExtract',
  'beatSplit',
  'uiSplit',
  'frameAnimGen',
  'svgGen',
  'gameHtmlGen',
  'model3d',
  'spatialWorld',
  'modelPose',
  'modelRigSkin',
  'modelSegment',
  'modelMeshComplete',
  'modelRetopology',
  'modelRigCheck',
  'modelRetarget',
  'modelConvert',
  'modelTexture',
  'modelAnimation',
  'mediaReview',
  'mediaRework',
  'semanticCompile'
]

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

  it('builds a tailored SVG schematic diagram for every instruction preset across all kinds', () => {
    let totalPresets = 0
    for (const kind of ALL_PRESET_KINDS) {
      const presets = listInstructionPresets(kind)
      for (const preset of presets) {
        totalPresets += 1
        const visual = resolveInstructionVisual({
          id: preset.id,
          presetKind: kind,
          visual: preset.visual
        })
        const svg = buildPresetSchematicSvg({
          visual,
          presetId: preset.id,
          presetKind: kind
        })
        expect(svg, `${kind}:${preset.id} should render an <svg>`).toContain(
          '<svg class="schematic-svg"'
        )
        expect(svg, `${kind}:${preset.id} should not fall back to default star`).not.toContain(
          'data-schematic="default"'
        )
      }
    }
    expect(totalPresets).toBeGreaterThan(180)
  })
})
