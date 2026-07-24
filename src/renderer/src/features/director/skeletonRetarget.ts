import * as THREE from 'three'
import { retargetClip as skeletonRetargetClip } from 'three/examples/jsm/utils/SkeletonUtils.js'

/** 统一骨骼名，便于 Mixamo / Blender / 自定义命名对齐 */
export function normalizeBoneName(name: string): string {
  return name
    .trim()
    .replace(/^mixamorig:/i, '')
    .replace(/^mixamorig/i, '')
    .replace(/^bip01[_\s-]*/i, '')
    .replace(/^bone[_\s-]*/i, '')
    .replace(/[_\s\-.:|]+/g, '')
    .toLowerCase()
}

export function parseAnimationTrackBone(
  trackName: string
): { bone: string; property: string } | null {
  const bracket = /^\.bones\[(.+?)\]\.(position|quaternion|scale)$/.exec(trackName)
  if (bracket) return { bone: bracket[1]!, property: bracket[2]! }

  const dotted = /^(.+)\.(position|quaternion|scale)$/.exec(trackName)
  if (!dotted) return null
  let bone = dotted[1]!
  if (bone.includes('|')) bone = bone.split('|').pop() || bone
  if (bone.includes('/')) bone = bone.split('/').pop() || bone
  // 去掉 "Armature|" 一类已处理后的残留空段
  bone = bone.replace(/^\./, '').trim()
  if (!bone) return null
  return { bone, property: dotted[2]! }
}

export function findPrimarySkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let best: THREE.SkinnedMesh | null = null
  let bestCount = 0
  root.traverse((obj) => {
    if (!(obj instanceof THREE.SkinnedMesh) || !obj.skeleton?.bones.length) return
    if (obj.skeleton.bones.length > bestCount) {
      best = obj
      bestCount = obj.skeleton.bones.length
    }
  })
  return best
}

/**
 * 蒙皮实际使用的骨骼（SkinnedMesh.skeleton.bones）。
 * 姿势套用 / bind 快照必须用这套，否则会出现「点线正常、网格腿飞掉」。
 */
export function collectSkinningBones(root: THREE.Object3D): THREE.Bone[] {
  const meshes: THREE.SkinnedMesh[] = []
  root.traverse((obj) => {
    if (obj instanceof THREE.SkinnedMesh && obj.skeleton?.bones.length) {
      meshes.push(obj)
    }
  })
  meshes.sort((a, b) => b.skeleton.bones.length - a.skeleton.bones.length)

  const bones: THREE.Bone[] = []
  const seen = new Set<THREE.Bone>()
  const seenNames = new Set<string>()
  for (const mesh of meshes) {
    for (const bone of mesh.skeleton.bones) {
      if (!bone || seen.has(bone)) continue
      const name = bone.name?.trim()
      if (name) {
        if (seenNames.has(name)) continue
        seenNames.add(name)
      }
      seen.add(bone)
      bones.push(bone)
    }
  }
  if (bones.length) return bones

  root.traverse((obj) => {
    if (!(obj instanceof THREE.Bone) || seen.has(obj)) return
    const name = obj.name?.trim()
    if (name) {
      if (seenNames.has(name)) return
      seenNames.add(name)
    }
    seen.add(obj)
    bones.push(obj)
  })
  return bones
}

/**
 * twist / roll / ik / nub 等辅助骨：bind 时常与主链重合，一转父骨就会「多出一节」分叉。
 * 点线与姿势列表隐藏它们；蒙皮套用仍走 collectSkinningBones，保持 bind 局部 TRS。
 */
export function isAuxiliaryPoseBone(name: string): boolean {
  const raw = name.trim()
  if (!raw) return true
  // 扭骨 / 滚骨（含 ForeArmRoll、UpperArmTwist 等）
  if (/twist|roll/i.test(raw)) return true
  // 末端 / IK / 辅助：要求前后是分隔或边界，避免误伤 Hand、defend 等
  if (/(_|:|\.|\s|^)(ik|nub|end|tip|helper|target|pole|leaf)(_|:|\.|\s|$)/i.test(raw)) return true
  if (/iktarget|polevector|leafend/i.test(raw)) return true
  return false
}

/** 姿势编辑可见/可选的主链骨骼（已去掉辅助骨） */
export function collectPoseEditBones(root: THREE.Object3D): THREE.Bone[] {
  return collectSkinningBones(root).filter((bone) => {
    const name = bone.name?.trim()
    return !!name && !isAuxiliaryPoseBone(name)
  })
}

/** 在可编辑骨骼集合里找最近的骨骼祖先（跳过中间 Object3D / 被过滤的辅助骨） */
export function findNearestPoseBoneParent(
  bone: THREE.Bone,
  boneSet: Set<THREE.Bone>
): THREE.Bone | null {
  let p: THREE.Object3D | null = bone.parent
  while (p) {
    if (p instanceof THREE.Bone && boneSet.has(p)) return p
    p = p.parent
  }
  return null
}

export function collectBoneNames(root: THREE.Object3D): string[] {
  return collectSkinningBones(root)
    .map((bone) => bone.name?.trim())
    .filter((name): name is string => !!name)
}

export function collectPoseEditBoneNames(root: THREE.Object3D): string[] {
  return collectPoseEditBones(root)
    .map((bone) => bone.name?.trim())
    .filter((name): name is string => !!name)
}

export function findHipBoneName(boneNames: string[]): string | null {
  const ranked = ['hips', 'hip', 'pelvis', 'root']
  const normalized = boneNames.map((name) => ({ name, key: normalizeBoneName(name) }))
  for (const key of ranked) {
    const hit = normalized.find((item) => item.key === key || item.key.endsWith(key))
    if (hit) return hit.name
  }
  return boneNames[0] ?? null
}

/** targetBoneName → sourceBoneName */
export function buildBoneNameMap(
  targetBones: string[],
  sourceBones: string[]
): Record<string, string> {
  const sourceByNorm = new Map<string, string>()
  for (const name of sourceBones) {
    const key = normalizeBoneName(name)
    if (!key || sourceByNorm.has(key)) continue
    sourceByNorm.set(key, name)
  }
  const map: Record<string, string> = {}
  for (const target of targetBones) {
    const key = normalizeBoneName(target)
    const source = sourceByNorm.get(key)
    if (source) map[target] = source
  }
  return map
}

function boneNamesFromClip(clip: THREE.AnimationClip): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const track of clip.tracks) {
    const parsed = parseAnimationTrackBone(track.name)
    if (!parsed || seen.has(parsed.bone)) continue
    seen.add(parsed.bone)
    names.push(parsed.bone)
  }
  return names
}

function extractSkeleton(root: THREE.Object3D): THREE.Skeleton | null {
  const skinned = findPrimarySkinnedMesh(root)
  if (skinned?.skeleton) return skinned.skeleton
  const bones: THREE.Bone[] = []
  root.traverse((obj) => {
    if (obj instanceof THREE.Bone) bones.push(obj)
  })
  if (!bones.length) return null
  return new THREE.Skeleton(bones)
}

/** retargetClip 输出 `.bones[name].*`，根节点 Mixer 需要 `name.*` */
export function rewriteBonesTracksForRootMixer(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks = clip.tracks.map((track) => {
    const bracket = /^\.bones\[(.+?)\]\.(position|quaternion|scale)$/.exec(track.name)
    if (!bracket) return track
    const cloned = track.clone()
    cloned.name = `${bracket[1]}.${bracket[2]}`
    return cloned
  })
  return new THREE.AnimationClip(clip.name, clip.duration, tracks)
}

/**
 * 仅按骨骼名重映射 track（同姿态/同绑定约定时够用，如 Mixamo→Mixamo）。
 * 映射过少时返回 null，交由完整 retarget。
 */
export function remapClipTracksByBoneNames(
  clip: THREE.AnimationClip,
  targetBones: string[]
): THREE.AnimationClip | null {
  const targetByNorm = new Map<string, string>()
  for (const name of targetBones) {
    const key = normalizeBoneName(name)
    if (key && !targetByNorm.has(key)) targetByNorm.set(key, name)
  }

  let mapped = 0
  const tracks: THREE.KeyframeTrack[] = []
  for (const track of clip.tracks) {
    const parsed = parseAnimationTrackBone(track.name)
    if (!parsed) {
      tracks.push(track)
      continue
    }
    const targetBone = targetByNorm.get(normalizeBoneName(parsed.bone))
    if (!targetBone) continue
    mapped += 1
    const cloned = track.clone()
    cloned.name = `${targetBone}.${parsed.property}`
    tracks.push(cloned)
  }
  if (mapped < 1) return null
  return new THREE.AnimationClip(clip.name, clip.duration, tracks)
}

/**
 * 将源动画 clip 重定向到目标角色根节点可播放的形式。
 * 优先完整 skeletonRetargetClip；失败则退回骨骼名重映射。
 */
export function retargetClipToCharacter(
  targetRoot: THREE.Object3D,
  sourceRoot: THREE.Object3D,
  clip: THREE.AnimationClip
): THREE.AnimationClip {
  const targetBones = collectBoneNames(targetRoot)
  if (!targetBones.length) return clip

  const sourceBonesFromScene = collectBoneNames(sourceRoot)
  const sourceBones =
    sourceBonesFromScene.length > 0 ? sourceBonesFromScene : boneNamesFromClip(clip)

  const nameMap = buildBoneNameMap(targetBones, sourceBones)
  const mappedCount = Object.keys(nameMap).length

  const targetSkinned = findPrimarySkinnedMesh(targetRoot)
  const sourceSkeleton = extractSkeleton(sourceRoot)

  if (targetSkinned?.skeleton && sourceSkeleton && mappedCount >= 1) {
    try {
      const sourceHip =
        findHipBoneName(sourceBones) ||
        Object.values(nameMap).find((n) => normalizeBoneName(n).includes('hip')) ||
        'Hips'
      const targetHip = findHipBoneName(targetBones)
      // names: target → source；hip 使用源骨骼名
      const hipSource = (targetHip && nameMap[targetHip]) || sourceHip
      const retargeted = skeletonRetargetClip(targetSkinned, sourceSkeleton, clip, {
        names: nameMap,
        hip: hipSource,
        useFirstFramePosition: true,
        fps: 30
      })
      // retarget 会改 target 姿态，恢复 bind
      targetSkinned.skeleton.pose()
      return rewriteBonesTracksForRootMixer(retargeted)
    } catch {
      /* fall through */
    }
  }

  const remapped = remapClipTracksByBoneNames(clip, targetBones)
  if (remapped) return remapped
  return clip
}
