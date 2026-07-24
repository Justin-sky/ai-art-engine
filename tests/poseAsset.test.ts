import { describe, expect, it } from 'vitest'
import {
  buildPoseAssetGenParams,
  isPoseModelAsset,
  readModelAssetKind,
  readPoseAssetData
} from '../src/shared/domain'
import {
  encodeBonePoseNormalized,
  mapNormalizedPoseToTargetBones
} from '../src/renderer/src/features/director/poseAsset'

describe('pose asset', () => {
  it('readModelAssetKind recognizes pose', () => {
    expect(readModelAssetKind({ modelKind: 'pose' })).toBe('pose')
    expect(isPoseModelAsset({ type: 'model', genParams: { modelKind: 'pose' } })).toBe(true)
    expect(isPoseModelAsset({ type: 'model', genParams: { modelKind: 'animation' } })).toBe(false)
  })

  it('encodeBonePoseNormalized uses normalized keys', () => {
    const encoded = encodeBonePoseNormalized({
      'mixamorig:Hips': { x: 0.1, y: 0, z: 0 },
      mixamorigSpine: { x: 0, y: 0.2, z: 0 }
    })
    expect(encoded).toEqual({
      hips: { x: 0.1, y: 0, z: 0 },
      spine: { x: 0, y: 0.2, z: 0 }
    })
  })

  it('mapNormalizedPoseToTargetBones remaps to target names', () => {
    const mapped = mapNormalizedPoseToTargetBones(
      { hips: { x: 0.5, y: 0, z: 0 }, spine: { x: 0, y: 0.1, z: 0 } },
      ['mixamorigHips', 'mixamorigHead']
    )
    expect(mapped.matched).toBe(1)
    expect(mapped.total).toBe(2)
    expect(mapped.bonePose).toEqual({
      mixamorigHips: { x: 0.5, y: 0, z: 0 }
    })
  })

  it('readPoseAssetData round-trips genParams', () => {
    const gen = buildPoseAssetGenParams(
      { hips: { x: 1, y: 0, z: 0 } },
      'model-1'
    )
    const data = readPoseAssetData(gen)
    expect(data).toEqual({
      schemaVersion: 1,
      bones: { hips: { x: 1, y: 0, z: 0 } },
      sourceModelAssetId: 'model-1'
    })
  })
})
