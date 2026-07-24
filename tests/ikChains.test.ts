import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  collectIkLinkNames,
  detectDefaultIkChains,
  mergeIkChains
} from '../src/renderer/src/features/director/ikChains'
import { solveCcdIk } from '../src/renderer/src/features/director/ccdIkSolve'

function makeMixamoArmature(): THREE.Group {
  const root = new THREE.Group()
  const hips = new THREE.Bone()
  hips.name = 'mixamorigHips'
  const spine = new THREE.Bone()
  spine.name = 'mixamorigSpine'
  const leftArm = new THREE.Bone()
  leftArm.name = 'mixamorigLeftArm'
  leftArm.position.set(1, 0, 0)
  const leftFore = new THREE.Bone()
  leftFore.name = 'mixamorigLeftForeArm'
  leftFore.position.set(1, 0, 0)
  const leftHand = new THREE.Bone()
  leftHand.name = 'mixamorigLeftHand'
  leftHand.position.set(1, 0, 0)
  const leftRoll = new THREE.Bone()
  leftRoll.name = 'mixamorigLeftForeArmRoll'
  leftRoll.position.set(0.5, 0, 0)

  const leftUpLeg = new THREE.Bone()
  leftUpLeg.name = 'mixamorigLeftUpLeg'
  leftUpLeg.position.set(0.2, -1, 0)
  const leftLeg = new THREE.Bone()
  leftLeg.name = 'mixamorigLeftLeg'
  leftLeg.position.set(0, -1, 0)
  const leftFoot = new THREE.Bone()
  leftFoot.name = 'mixamorigLeftFoot'
  leftFoot.position.set(0, -0.2, 0.2)

  hips.add(spine)
  spine.add(leftArm)
  leftArm.add(leftFore)
  leftFore.add(leftHand)
  leftFore.add(leftRoll)
  hips.add(leftUpLeg)
  leftUpLeg.add(leftLeg)
  leftLeg.add(leftFoot)
  root.add(hips)

  const mesh = new THREE.SkinnedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial())
  mesh.bind(
    new THREE.Skeleton([hips, spine, leftArm, leftFore, leftHand, leftRoll, leftUpLeg, leftLeg, leftFoot])
  )
  root.add(mesh)
  root.updateMatrixWorld(true)
  return root
}

describe('ikChains', () => {
  it('detects default targets and skips roll bones in links', () => {
    const root = makeMixamoArmature()
    const chains = detectDefaultIkChains(root)
    const arm = chains.find((c) => c.id === 'slot1')
    const leg = chains.find((c) => c.id === 'slot3')
    expect(arm?.effector).toBe('mixamorigLeftHand')
    expect(arm?.links).toEqual(['mixamorigLeftForeArm', 'mixamorigLeftArm'])
    expect(arm?.links.some((n) => /roll/i.test(n))).toBe(false)
    expect(leg?.effector).toBe('mixamorigLeftFoot')
    expect(leg?.links[0]).toBe('mixamorigLeftLeg')
  })

  it('collectIkLinkNames stops at spine/hips', () => {
    const root = makeMixamoArmature()
    const hand = root.getObjectByName('mixamorigLeftHand') as THREE.Bone
    const links = collectIkLinkNames(hand, 5)
    expect(links).toEqual(['mixamorigLeftForeArm', 'mixamorigLeftArm'])
  })

  it('mergeIkChains lets manual effector override auto names', () => {
    const root = makeMixamoArmature()
    const hand = root.getObjectByName('mixamorigLeftHand') as THREE.Bone
    hand.name = 'CustomPalm_L'
    root.updateMatrixWorld(true)
    const merged = mergeIkChains(root, [{ id: 'slot1', effector: 'CustomPalm_L' }])
    const arm = merged.find((c) => c.id === 'slot1')
    expect(arm?.effector).toBe('CustomPalm_L')
    expect(arm?.manual).toBe(true)
    expect(arm?.links[0]).toBe('mixamorigLeftForeArm')
  })
})

describe('solveCcdIk', () => {
  it('moves effector closer to target', () => {
    const root = makeMixamoArmature()
    const hand = root.getObjectByName('mixamorigLeftHand') as THREE.Bone
    const fore = root.getObjectByName('mixamorigLeftForeArm') as THREE.Bone
    const arm = root.getObjectByName('mixamorigLeftArm') as THREE.Bone
    root.updateMatrixWorld(true)
    const before = new THREE.Vector3()
    hand.getWorldPosition(before)
    const target = before.clone().add(new THREE.Vector3(0, 0.8, 0.2))
    solveCcdIk({
      effector: hand,
      links: [fore, arm],
      targetWorld: target,
      iteration: 16,
      root
    })
    const after = new THREE.Vector3()
    hand.getWorldPosition(after)
    expect(after.distanceTo(target)).toBeLessThan(before.distanceTo(target))
  })
})
