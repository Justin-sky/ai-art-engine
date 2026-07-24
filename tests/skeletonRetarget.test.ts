import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  buildBoneNameMap,
  collectPoseEditBones,
  collectSkinningBones,
  findNearestPoseBoneParent,
  isAuxiliaryPoseBone,
  normalizeBoneName,
  parseAnimationTrackBone,
  remapClipTracksByBoneNames,
  rewriteBonesTracksForRootMixer
} from '../src/renderer/src/features/director/skeletonRetarget'

describe('skeleton retarget helpers', () => {
  it('normalizeBoneName strips Mixamo prefixes', () => {
    expect(normalizeBoneName('mixamorig:Hips')).toBe('hips')
    expect(normalizeBoneName('mixamorigHips')).toBe('hips')
    expect(normalizeBoneName('mixamorig_LeftArm')).toBe('leftarm')
  })

  it('parseAnimationTrackBone handles common track paths', () => {
    expect(parseAnimationTrackBone('mixamorigHips.quaternion')).toEqual({
      bone: 'mixamorigHips',
      property: 'quaternion'
    })
    expect(parseAnimationTrackBone('Armature|mixamorig:Hips.position')).toEqual({
      bone: 'mixamorig:Hips',
      property: 'position'
    })
    expect(parseAnimationTrackBone('.bones[Hips].quaternion')).toEqual({
      bone: 'Hips',
      property: 'quaternion'
    })
  })

  it('buildBoneNameMap matches normalized names', () => {
    const map = buildBoneNameMap(
      ['mixamorigHips', 'mixamorigSpine'],
      ['mixamorig:Hips', 'mixamorig:Spine', 'mixamorig:Head']
    )
    expect(map).toEqual({
      mixamorigHips: 'mixamorig:Hips',
      mixamorigSpine: 'mixamorig:Spine'
    })
  })

  it('remapClipTracksByBoneNames rewrites track targets', () => {
    const clip = new THREE.AnimationClip('Walk', 1, [
      new THREE.QuaternionKeyframeTrack('mixamorig:Hips.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
      new THREE.QuaternionKeyframeTrack('mixamorig:Spine.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])
    ])
    const remapped = remapClipTracksByBoneNames(clip, ['mixamorigHips', 'mixamorigSpine'])
    expect(remapped).not.toBeNull()
    expect(remapped!.tracks.map((t) => t.name)).toEqual([
      'mixamorigHips.quaternion',
      'mixamorigSpine.quaternion'
    ])
  })

  it('rewriteBonesTracksForRootMixer converts .bones[] paths', () => {
    const clip = new THREE.AnimationClip('Walk', 1, [
      new THREE.QuaternionKeyframeTrack('.bones[Hips].quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])
    ])
    const rewritten = rewriteBonesTracksForRootMixer(clip)
    expect(rewritten.tracks[0]?.name).toBe('Hips.quaternion')
  })

  it('collectSkinningBones ignores orphan bones with the same name', () => {
    const root = new THREE.Group()
    const hips = new THREE.Bone()
    hips.name = 'Hips'
    const leg = new THREE.Bone()
    leg.name = 'LeftUpLeg'
    const foot = new THREE.Bone()
    foot.name = 'LeftFoot'
    hips.add(leg)
    leg.add(foot)
    root.add(hips)

    const orphanFoot = new THREE.Bone()
    orphanFoot.name = 'LeftFoot'
    root.add(orphanFoot)

    const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
    mesh.bind(new THREE.Skeleton([hips, leg, foot]))
    root.add(mesh)

    const bones = collectSkinningBones(root)
    expect(bones.map((b) => b.name)).toEqual(['Hips', 'LeftUpLeg', 'LeftFoot'])
    expect(bones.find((b) => b.name === 'LeftFoot')).toBe(foot)
  })

  it('isAuxiliaryPoseBone filters twist/roll/ik without harming Hand', () => {
    expect(isAuxiliaryPoseBone('LeftForeArmRoll')).toBe(true)
    expect(isAuxiliaryPoseBone('mixamorigLeftArmTwist')).toBe(true)
    expect(isAuxiliaryPoseBone('LeftHand_End')).toBe(true)
    expect(isAuxiliaryPoseBone('IK_Hand_L')).toBe(true)
    expect(isAuxiliaryPoseBone('LeftHand')).toBe(false)
    expect(isAuxiliaryPoseBone('LeftForeArm')).toBe(false)
    expect(isAuxiliaryPoseBone('defend')).toBe(false)
  })

  it('collectPoseEditBones hides roll siblings and nearest parent skips them', () => {
    const root = new THREE.Group()
    const arm = new THREE.Bone()
    arm.name = 'LeftForeArm'
    const hand = new THREE.Bone()
    hand.name = 'LeftHand'
    const roll = new THREE.Bone()
    roll.name = 'LeftForeArmRoll'
    arm.add(hand)
    arm.add(roll)
    root.add(arm)

    const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
    mesh.bind(new THREE.Skeleton([arm, hand, roll]))
    root.add(mesh)

    const editable = collectPoseEditBones(root)
    expect(editable.map((b) => b.name)).toEqual(['LeftForeArm', 'LeftHand'])
    const set = new Set(editable)
    expect(findNearestPoseBoneParent(hand, set)).toBe(arm)
  })
})
