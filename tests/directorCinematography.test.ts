import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  blendDirectorViewerStates,
  buildDirectorCinematographyPrompt,
  buildLightingPresetObjects,
  DIRECTOR_EXPRESSIVE_POSE_PRESETS,
  evaluateHandheldCameraShake,
  evaluateKeyframeEasing,
  focalLengthMmToFov,
  fovToFocalLengthMm,
  solveCinemachineBrainCutAtTime,
  solveCinemachineVirtualCamera,
  solveDollyZoomPosition
} from '../src/shared/directorCinematography'
import {
  createDefaultDirectorStage,
  directorViewerForwardFromRotation,
  directorViewerRotationFromLook
} from '../src/shared/domain'
import { findDirectorShotCameraPreset } from '../src/shared/directorCameraPresets'
import { resolveMotionPromptText } from '../src/shared/graph/motionShots'
import { sampleAnimKeyframes } from '../src/renderer/src/features/director/animationPath'
import { findActiveSkeletonSegmentsWithBlend } from '../src/renderer/src/features/director/skeletonAnim'
import {
  DIRECTOR_CINEMACHINE_PREVIZ_PACKS,
  generateAiDirectorBlocking,
  generateCinemachinePrevizPack
} from '../src/renderer/src/features/director/directorAiBlocking'
import { createBuiltinMannequin } from '../src/renderer/src/features/director/builtinMannequin'

describe('directorCinematography (P0 / P1 / P2)', () => {
  it('converts between focalLengthMm and vertical FOV accurately on 35mm full-frame sensor', () => {
    const fov50 = focalLengthMmToFov(50)
    expect(fov50).toBeGreaterThan(26)
    expect(fov50).toBeLessThan(28)
    expect(fovToFocalLengthMm(fov50)).toBeCloseTo(50, 1)

    const fov24 = focalLengthMmToFov(24)
    const fov85 = focalLengthMmToFov(85)
    expect(fov24).toBeGreaterThan(fov50)
    expect(fov85).toBeLessThan(fov50)
  })

  it('solves Dolly Zoom (Hitchcock zoom) camera position to preserve subject framing height', () => {
    const pos = { x: 0, y: 1.5, z: 4 }
    const target = { x: 0, y: 1.5, z: 0 }
    const oldFov = 50
    const narrowerFov = 25
    const nextPos = solveDollyZoomPosition(pos, target, oldFov, narrowerFov)
    // Narrower FOV requires moving further away from the target along the same sightline
    expect(nextPos.z).toBeGreaterThan(pos.z)
    expect(nextPos.x).toBeCloseTo(0, 5)
    expect(nextPos.y).toBeCloseTo(1.5, 5)
  })

  it('evaluates keyframe easing curves and interpolates keyframe FOV in sampleAnimKeyframes', () => {
    expect(evaluateKeyframeEasing(0.25, 'linear')).toBeCloseTo(0.25, 5)
    expect(evaluateKeyframeEasing(0.25, 'easeIn')).toBeLessThan(0.25)
    expect(evaluateKeyframeEasing(0.75, 'easeOut')).toBeGreaterThan(0.75)
    expect(evaluateKeyframeEasing(0.5, 'easeInOut')).toBeCloseTo(0.5, 5)

    const sampled = sampleAnimKeyframes(
      [
        {
          id: 'kf-1',
          time: 0,
          position: { x: 0, y: 0, z: 0 },
          easing: 'easeIn',
          fov: 60
        },
        {
          id: 'kf-2',
          time: 2,
          position: { x: 10, y: 0, z: 0 },
          fov: 30
        }
      ],
      0.5
    )
    expect(sampled).not.toBeNull()
    // At u = 0.25 with easeIn (u^2 = 0.0625), x should be < 2.5 and fov should be closer to 60 than 52.5
    expect(sampled!.position.x).toBeLessThan(2.5)
    expect(sampled!.fov).toBeGreaterThan(55)
  })

  it('samples deterministic procedural handheld camera shake', () => {
    const zero = evaluateHandheldCameraShake(1.2, {
      enabled: false,
      intensity: 0.5,
      frequency: 1.5
    })
    expect(zero.rotOffset.x).toBe(0)
    expect(zero.rotOffset.y).toBe(0)

    const active = evaluateHandheldCameraShake(1.2, {
      enabled: true,
      intensity: 0.5,
      frequency: 1.5
    })
    expect(Math.abs(active.rotOffset.x) + Math.abs(active.rotOffset.y)).toBeGreaterThan(0)
  })

  it('builds 3-point character lighting presets and expressive pose presets', () => {
    const rembrandt = buildLightingPresetObjects('rembrandt', { x: 0, y: 1, z: 0 })
    expect(rembrandt.lights.length).toBeGreaterThanOrEqual(2)
    expect(rembrandt.lights.every((obj) => obj.kind === 'light')).toBe(true)

    expect(DIRECTOR_EXPRESSIVE_POSE_PRESETS.length).toBeGreaterThanOrEqual(35)
    const bodyPresets = DIRECTOR_EXPRESSIVE_POSE_PRESETS.filter((p) => p.category === 'body')
    expect(bodyPresets.length).toBeGreaterThanOrEqual(24)
    expect(bodyPresets.some((p) => p.id === 'body.sit')).toBe(true)
    expect(bodyPresets.some((p) => p.id === 'body.jump')).toBe(true)
    expect(bodyPresets.some((p) => p.id === 'body.run')).toBe(true)
    const fist = DIRECTOR_EXPRESSIVE_POSE_PRESETS.find((p) => p.id === 'hand.fist')
    expect(fist).toBeDefined()
    expect(Object.keys(fist!.bones).length).toBeGreaterThan(4)
  })

  it('generates structured cinematography prompt and resolves out-prompt for asset.motion', () => {
    const defaultStage = createDefaultDirectorStage()
    const stage = {
      ...defaultStage,
      objects: buildLightingPresetObjects('rembrandt', { x: 0, y: 1, z: 0 }).lights,
      cameras: [
        {
          id: 'cam-1',
          name: 'Cam 1',
          viewer: {
            position: { x: 0, y: 2.2, z: 2.5 },
            target: { x: 0, y: 1.0, z: 0 },
            fov: 16,
            focalLengthMm: 85,
            aperture: 2.0,
            focusDistance: 2.8,
            handheldShake: { enabled: true, intensity: 0.3, frequency: 1.2 }
          }
        }
      ],
      activeCameraId: 'cam-1',
      fogEnabled: true,
      fogDensity: 0.03
    }
    const analysis = buildDirectorCinematographyPrompt(stage)
    expect(analysis.prompt).toContain('85mm')
    expect(analysis.prompt).toContain('shallow depth of field')
    expect(analysis.prompt).toContain('handheld')
    expect(analysis.prompt).toContain('volumetric atmospheric fog')

    const resolved = resolveMotionPromptText({ stage })
    expect(resolved).toContain('85mm')
  })

  it('computes cross-fade blending weights between adjacent skeletal clip segments', () => {
    const segments = [
      { id: 's1', assetId: 'a1', clip: 'Walk', start: 0, end: 2, crossFadeSec: 0.4 },
      { id: 's2', assetId: 'a1', clip: 'Run', start: 2, end: 4, crossFadeSec: 0.4 }
    ]
    const blend = findActiveSkeletonSegmentsWithBlend(segments, 2.2)
    expect(blend).not.toBeNull()
    expect(blend!.primary.id).toBe('s2')
    expect(blend!.previous?.id).toBe('s1')
    expect(blend!.primaryWeight).toBeCloseTo(0.5, 2)
  })

  it('generates AI Co-Director 3D blocking from natural language storyboard prompt', () => {
    const defaultStage = createDefaultDirectorStage()
    const blocking = generateAiDirectorBlocking(
      defaultStage,
      '夕阳下两人对峙，镜头从特写缓慢拉远到全景，带手持呼吸感'
    )
    expect(blocking.objects.length).toBeGreaterThanOrEqual(2)
    expect(blocking.cameras?.length).toBeGreaterThanOrEqual(2)
    expect(blocking.lightingPreset).toBe('goldenHour')
    expect(blocking.animation?.tracks.length).toBeGreaterThanOrEqual(2)
  })

  it('generates all 5 Cinemachine Previz Packs with smart actor reuse and shot breakdown prompts', () => {
    expect(DIRECTOR_CINEMACHINE_PREVIZ_PACKS.length).toBe(5)

    // Pre-populate stage with 1 user character model to verify smart actor reuse
    const baseStage = createDefaultDirectorStage()
    baseStage.objects.push({
      id: 'user-hero-1',
      name: 'Lin Xia',
      kind: 'model',
      assetId: 'asset-linxia',
      visible: true,
      position: { x: 5, y: 0, z: 5 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 }
    })

    for (const packDef of DIRECTOR_CINEMACHINE_PREVIZ_PACKS) {
      const staged = generateCinemachinePrevizPack(baseStage, packDef.id, 'zh-CN')
      expect(staged.cameras?.length).toBe(packDef.cameraCount)
      const actors = staged.objects.filter((o) => o.kind === 'character' || o.kind === 'model')
      expect(actors.length).toBe(packDef.actorCount)
      // First actor slot reuses user-hero-1
      expect(actors[0].id).toBe('user-hero-1')
      expect(actors[0].assetId).toBe('asset-linxia')

      const cutTrack = staged.animation?.tracks.find((tr) => tr.cameraCut)
      expect(cutTrack).toBeDefined()
      expect(cutTrack!.cameraSegments?.length).toBe(packDef.cameraCount)

      const promptZh = buildDirectorCinematographyPrompt(staged, 'zh-CN')
      expect(promptZh.prompt).toContain('[分镜切镜表]')

      const promptEn = buildDirectorCinematographyPrompt(staged, 'en-US')
      expect(promptEn.prompt).toContain('[Shot Breakdown]')
    }
  })

  it('creates procedural posable 3D mannequin with bones and embedded animation clips without torso/head clipping', () => {
    const built = createBuiltinMannequin('humanoid', '#5b9cf5')
    expect(built.bones.length).toBeGreaterThanOrEqual(15)
    expect(built.clips.map((a) => a.name)).toEqual([
      'Idle',
      'Walk',
      'Run',
      'Sprint',
      'Jump',
      'Sit',
      'SitFloor',
      'Crouch',
      'Kneel',
      'LieDown',
      'Wave',
      'Bow',
      'Clap',
      'Cheer',
      'Dance',
      'Talk',
      'Think',
      'PhoneLook',
      'Stretch',
      'LookAround',
      'Drink',
      'PushUp',
      'Fall',
      'Action'
    ])

    const boneByName = new Map(built.bones.map((b) => [b.name, b]))
    const leftForeArm = boneByName.get('LeftForeArm')!
    const rightForeArm = boneByName.get('RightForeArm')!
    const leftHand = boneByName.get('LeftHand')!
    const rightHand = boneByName.get('RightHand')!

    const pos = new THREE.Vector3()
    const worldOf = (bone: THREE.Bone): THREE.Vector3 => {
      built.root.updateMatrixWorld(true)
      return bone.getWorldPosition(pos).clone()
    }

    const bindPos = new Map(built.bones.map((b) => [b.name, b.position.clone()]))
    const resetToBind = (): void => {
      for (const bone of built.bones) {
        const bp = bindPos.get(bone.name)
        if (bp) bone.position.copy(bp)
        bone.rotation.set(0, 0, 0)
      }
    }

    // Verify all 24 built-in animation clips keep elbows and hands outside torso/head
    for (const clip of built.clips) {
      resetToBind()
      const mixer = new THREE.AnimationMixer(built.root)
      const action = mixer.clipAction(clip)
      action.play()
      for (let step = 0; step <= 8; step++) {
        const t = (clip.duration * step) / 8
        mixer.setTime(t)
        const lElbow = worldOf(leftForeArm)
        const rElbow = worldOf(rightForeArm)
        const lWrist = worldOf(leftHand)
        const rWrist = worldOf(rightHand)

        // Left elbow & wrist stay on the -X side (abducted outward) or in front of chest (+Z)
        expect(lElbow.x).toBeLessThan(-0.18)
        expect(rElbow.x).toBeGreaterThan(0.18)
        if (clip.name === 'Wave') {
          // Wave raises the right arm outward and up (+X, +Y), never crossing into head/neck
          expect(rElbow.x).toBeGreaterThan(0.35)
          expect(rWrist.x).toBeGreaterThan(0.35)
          expect(rWrist.y).toBeGreaterThan(1.65)
        } else {
          expect(lWrist.x < -0.15 || lWrist.z > 0.12).toBe(true)
          expect(rWrist.x > 0.15 || rWrist.z > 0.12).toBe(true)
        }
      }
      mixer.stopAllAction()
    }

    // Verify expressive pose presets do not adduct elbows into the torso
    for (const preset of DIRECTOR_EXPRESSIVE_POSE_PRESETS) {
      for (const bone of built.bones) {
        bone.rotation.set(0, 0, 0)
      }
      for (const [bName, rot] of Object.entries(preset.bones)) {
        const bone = boneByName.get(bName)
        if (bone) {
          bone.rotation.set(rot.x, rot.y, rot.z, 'XYZ')
        }
      }
      const lElbow = worldOf(leftForeArm)
      const rElbow = worldOf(rightForeArm)
      expect(lElbow.x).toBeLessThan(-0.18)
      expect(rElbow.x).toBeGreaterThan(0.18)
    }
  })

  it('solves Unity Cinemachine Virtual Camera Body (Transposer, Orbital, GroupFraming) and Aim Composer with Auto Focus Pull', () => {
    const actors = [
      {
        id: 'actor-a',
        kind: 'character' as const,
        position: { x: 2, y: 0, z: -1 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 }
      },
      {
        id: 'actor-b',
        kind: 'character' as const,
        position: { x: -2, y: 0, z: -1 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 }
      }
    ]

    // 1. Transposer + Aim Composer + Auto Focus Pull
    const baseViewer = {
      position: { x: 0, y: 1.5, z: 5 },
      target: { x: 0, y: 1, z: 0 },
      fov: 45,
      focusDistance: 1.0,
      cinemachine: {
        bodyMode: 'transposer' as const,
        followTargetId: 'actor-a',
        followOffset: { x: 0, y: 1.8, z: 3.0 },
        followSpace: 'world' as const,
        positionDamping: 0,
        aimMode: 'composer' as const,
        lookAtTargetId: 'actor-a',
        aimTargetPart: 'head' as const,
        screenOffset: { x: -0.33, y: 0.12 },
        aimDamping: 0,
        autoFocusPull: true,
        noisePreset: 'handheld' as const,
        impulseTimeSec: 1.0,
        impulseIntensity: 0.8
      }
    }
    const solved = solveCinemachineVirtualCamera(baseViewer, actors, 1.05, null, 16 / 9)
    // Position should track actor-a (x=2, z=-1) + offset (0, 1.8, 3.0) => ~ (2, 1.8, 2.0) plus impulse/noise
    expect(solved.viewer.position.x).toBeCloseTo(2, 0)
    expect(solved.viewer.position.z).toBeCloseTo(2, 0)
    // Auto Focus Pull should update focusDistance to ~3.0m (distance from (2,1.8,2) to actor-a head at (2, 1.53, -1))
    expect(solved.viewer.focusDistance).toBeGreaterThan(2.5)
    expect(solved.viewer.focusDistance).toBeLessThan(3.5)

    // 2. Orbital Transposer advances angle with timeSec
    const orbitViewer = {
      ...baseViewer,
      cinemachine: {
        bodyMode: 'orbital' as const,
        followTargetId: 'actor-a',
        orbitRadius: 4,
        orbitHeight: 2,
        orbitSpeedDegPerSec: 90,
        orbitStartAngleDeg: 0,
        positionDamping: 0
      }
    }
    const orbit0 = solveCinemachineVirtualCamera(orbitViewer, actors, 0, null)
    const orbit1 = solveCinemachineVirtualCamera(orbitViewer, actors, 1, null)
    // At t=0 (angle=0), x = 2 + 0 = 2, z = -1 + 4 = 3
    expect(orbit0.viewer.position.x).toBeCloseTo(2, 2)
    expect(orbit0.viewer.position.z).toBeCloseTo(3, 2)
    // At t=1 (angle=90 deg), x = 2 + 4 = 6, z = -1 + 0 = -1
    expect(orbit1.viewer.position.x).toBeCloseTo(6, 2)
    expect(orbit1.viewer.position.z).toBeCloseTo(-1, 2)

    // 3. Group Framing + Group Composer frames both actor-a and actor-b around x=0
    const groupViewer = {
      ...baseViewer,
      cinemachine: {
        bodyMode: 'groupFraming' as const,
        groupFramingScale: 1.5,
        positionDamping: 0,
        aimMode: 'groupComposer' as const,
        aimDamping: 0
      }
    }
    const groupSolved = solveCinemachineVirtualCamera(groupViewer, actors, 0, null)
    expect(groupSolved.viewer.target.x).toBeCloseTo(0, 2)
  })

  it('evaluates Cinemachine Brain multi-camera cut transitions and blends viewer states smoothly', () => {
    const segs = [
      { id: 'c1', cameraId: 'cam-wide', start: 0, end: 2, blendInSec: 0 },
      {
        id: 'c2',
        cameraId: 'cam-close',
        start: 2,
        end: 5,
        blendInSec: 1.0,
        blendCurve: 'linear' as const
      }
    ]
    const atMidTransition = solveCinemachineBrainCutAtTime(segs, 2.5)
    expect(atMidTransition).not.toBeNull()
    expect(atMidTransition!.activeCameraId).toBe('cam-close')
    expect(atMidTransition!.previousCameraId).toBe('cam-wide')
    expect(atMidTransition!.blendWeight).toBeCloseTo(0.5, 3)

    const blended = blendDirectorViewerStates(
      {
        position: { x: 0, y: 2, z: 6 },
        target: { x: 0, y: 1, z: 0 },
        fov: 60,
        focusDistance: 6,
        aperture: 1.4
      },
      {
        position: { x: 2, y: 1.4, z: 2 },
        target: { x: 0, y: 1.4, z: 0 },
        fov: 24,
        focusDistance: 2,
        aperture: 4.0
      },
      atMidTransition!.blendWeight
    )
    expect(blended.position.x).toBeCloseTo(1, 3)
    expect(blended.position.z).toBeCloseTo(4, 3)
    expect(blended.fov).toBeCloseTo(42, 3)
    expect(blended.focusDistance).toBeCloseTo(4, 3)
  })

  it('frames the character face (not the neck) in close-up presets and Cinemachine head-aim shots across all 360° camera angles', () => {
    const built = createBuiltinMannequin('humanoid')
    built.root.updateMatrixWorld(true)
    const headMesh = built.root.getObjectByName('Head_Mesh') as THREE.Mesh
    const neckMesh = built.root.getObjectByName('Neck_Mesh') as THREE.Mesh
    expect(headMesh).toBeTruthy()
    expect(neckMesh).toBeTruthy()

    const headBox = new THREE.Box3().setFromObject(headMesh)
    const neckBox = new THREE.Box3().setFromObject(neckMesh)
    const fullBox = new THREE.Box3().setFromObject(built.root)
    const headCenter = headBox.getCenter(new THREE.Vector3())
    const neckCenter = neckBox.getCenter(new THREE.Vector3())
    const subjectHeight = fullBox.max.y - fullBox.min.y

    // Close-up and extreme-close-up preset frameBias must land inside the head/face bounds, above the neck
    const cuPreset = findDirectorShotCameraPreset('shot.close-up')!
    const ecuPreset = findDirectorShotCameraPreset('shot.extreme-close-up')!
    const cuAimY = fullBox.min.y + (cuPreset.frameBias ?? 0.5) * subjectHeight
    const ecuAimY = fullBox.min.y + (ecuPreset.frameBias ?? 0.5) * subjectHeight
    expect(cuAimY).toBeGreaterThan(neckBox.max.y)
    expect(cuAimY).toBeGreaterThanOrEqual(headBox.min.y)
    expect(cuAimY).toBeLessThanOrEqual(headBox.max.y)
    expect(ecuAimY).toBeGreaterThan(neckCenter.y + 0.1)
    expect(Math.abs(ecuAimY - headCenter.y)).toBeLessThan(0.05)

    // Cinemachine head-aim cameras in previz packs must project the entire head inside NDC [-1, 1]
    const stage = createDefaultDirectorStage()
    const otsStage = generateCinemachinePrevizPack(stage, 'ots_dialogue', 'zh-CN')
    const cuCam = otsStage.cameras!.find((c) => c.id === 'cam:cm:ots_cu')!
    const solved = solveCinemachineVirtualCamera(
      cuCam.viewer,
      otsStage.objects,
      6.5,
      null,
      16 / 9
    ).viewer

    const cam = new THREE.PerspectiveCamera(solved.fov ?? 27, 16 / 9, 0.1, 100)
    cam.rotation.order = 'YXZ'
    cam.position.set(solved.position.x, solved.position.y, solved.position.z)
    cam.rotation.set(solved.rotation!.x, solved.rotation!.y, solved.rotation!.z, 'YXZ')
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld(true)

    const actorA = otsStage.objects.find((o) => o.kind === 'character')!
    const faceWorld = new THREE.Vector3(
      actorA.position.x,
      actorA.position.y + headCenter.y,
      actorA.position.z
    )
    const crownWorld = new THREE.Vector3(
      actorA.position.x,
      actorA.position.y + headBox.max.y,
      actorA.position.z
    )
    const chinWorld = new THREE.Vector3(
      actorA.position.x,
      actorA.position.y + headBox.min.y,
      actorA.position.z
    )
    const faceNdc = faceWorld.clone().project(cam)
    const crownNdc = crownWorld.clone().project(cam)
    const chinNdc = chinWorld.clone().project(cam)

    // Face center, chin, and crown must all stay well inside the vertical frame [-1, 1]
    expect(Math.abs(faceNdc.y)).toBeLessThan(0.35)
    expect(crownNdc.y).toBeLessThan(0.85)
    expect(chinNdc.y).toBeGreaterThan(-0.85)

    // YXZ forward vector and look rotation must be exact inverses at any 360° angle
    const sampleTargets = [
      { pos: { x: -1.5, y: 1.74, z: 0.7 }, target: { x: 1.15, y: 1.75, z: 0 } },
      { pos: { x: 0, y: 1.74, z: -1.5 }, target: { x: 0, y: 1.9, z: 0 } },
      { pos: { x: 2.0, y: 1.2, z: 0 }, target: { x: 0, y: 1.75, z: 0 } }
    ]
    for (const { pos, target } of sampleTargets) {
      const rot = directorViewerRotationFromLook(pos, target)
      const fwd = directorViewerForwardFromRotation(rot)
      const dx = target.x - pos.x
      const dy = target.y - pos.y
      const dz = target.z - pos.z
      const len = Math.hypot(dx, dy, dz)
      expect(fwd.x).toBeCloseTo(dx / len, 5)
      expect(fwd.y).toBeCloseTo(dy / len, 5)
      expect(fwd.z).toBeCloseTo(dz / len, 5)
    }
  })
})
