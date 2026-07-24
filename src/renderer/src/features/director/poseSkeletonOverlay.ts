import * as THREE from 'three'
import { collectPoseEditBones, findNearestPoseBoneParent } from './skeletonRetarget'

const BONE_COLOR = 0x3ddc84
const BONE_SELECTED_COLOR = 0x2ee6ff
const BONE_LINE_COLOR = 0xe8a54b

type BoneEntry = {
  name: string
  bone: THREE.Bone
  joint: THREE.Mesh
}

type BoneLink = {
  fromName: string
  toName: string
  from: THREE.Bone
  to: THREE.Bone
  mesh: THREE.Mesh
}

function boneLabel(bone: THREE.Bone): string {
  return bone.name?.trim() || bone.uuid.slice(0, 8)
}

/** Maya / Blender 风格：沿 +Y 的双锥骨段（父关节→子关节） */
function createBoneSegmentGeometry(): THREE.BufferGeometry {
  const w = 0.22
  const mid = 0.2
  const positions = new Float32Array([
    0, 0, 0,
    w, mid, 0,
    0, mid, w,
    -w, mid, 0,
    0, mid, -w,
    0, 1, 0
  ])
  const indices = [
    0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1,
    5, 2, 1, 5, 3, 2, 5, 4, 3, 5, 1, 4
  ]
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geom.setIndex(indices)
  geom.computeVertexNormals()
  return geom
}

export function objectHasSkeleton(root: THREE.Object3D): boolean {
  let found = false
  root.traverse((child) => {
    if (found) return
    if (child instanceof THREE.Bone) found = true
    else if (child instanceof THREE.SkinnedMesh && child.skeleton?.bones?.length) found = true
  })
  return found
}

export type PoseSkeletonOverlay = {
  clear: () => void
  setTarget: (root: THREE.Object3D | null) => void
  update: () => void
  getTargetObjectId: () => string | null
  setTargetObjectId: (id: string | null) => void
  setSelectedBone: (name: string | null) => void
  getJointMeshes: () => THREE.Mesh[]
  findBone: (name: string) => THREE.Bone | null
}

export function createPoseSkeletonOverlay(scene: THREE.Scene): PoseSkeletonOverlay {
  let overlay: THREE.Group | null = null
  let targetRoot: THREE.Object3D | null = null
  let entries: BoneEntry[] = []
  let links: BoneLink[] = []
  let jointGeom: THREE.SphereGeometry | null = null
  let segmentGeom: THREE.BufferGeometry | null = null
  let jointMat: THREE.MeshBasicMaterial | null = null
  let jointMatSelected: THREE.MeshBasicMaterial | null = null
  let linkMat: THREE.MeshBasicMaterial | null = null
  let linkMatSelected: THREE.MeshBasicMaterial | null = null
  let boneRadius = 0.02
  let targetObjectId: string | null = null
  let selectedBone: string | null = null
  const worldPos = new THREE.Vector3()
  const worldPosChild = new THREE.Vector3()
  const boneDir = new THREE.Vector3()
  const boneQuat = new THREE.Quaternion()
  const yAxis = new THREE.Vector3(0, 1, 0)

  function ensureMaterials(): void {
    if (!jointGeom) jointGeom = new THREE.SphereGeometry(1, 12, 12)
    if (!segmentGeom) segmentGeom = createBoneSegmentGeometry()
    if (!jointMat) {
      jointMat = new THREE.MeshBasicMaterial({
        color: BONE_COLOR,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.95
      })
    }
    if (!jointMatSelected) {
      jointMatSelected = new THREE.MeshBasicMaterial({
        color: BONE_SELECTED_COLOR,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 1
      })
    }
    if (!linkMat) {
      linkMat = new THREE.MeshBasicMaterial({
        color: BONE_LINE_COLOR,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.88,
        side: THREE.DoubleSide
      })
    }
    if (!linkMatSelected) {
      linkMatSelected = new THREE.MeshBasicMaterial({
        color: BONE_SELECTED_COLOR,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide
      })
    }
  }

  function clear(): void {
    if (overlay) {
      scene.remove(overlay)
      overlay = null
    }
    targetRoot = null
    entries = []
    links = []
    jointGeom?.dispose()
    jointGeom = null
    segmentGeom?.dispose()
    segmentGeom = null
    jointMat?.dispose()
    jointMat = null
    jointMatSelected?.dispose()
    jointMatSelected = null
    linkMat?.dispose()
    linkMat = null
    linkMatSelected?.dispose()
    linkMatSelected = null
    targetObjectId = null
    selectedBone = null
  }

  function setTarget(root: THREE.Object3D | null): void {
    if (overlay) {
      scene.remove(overlay)
      overlay = null
    }
    entries = []
    links = []
    targetRoot = null
    if (!root || !objectHasSkeleton(root)) {
      targetObjectId = null
      return
    }

    targetRoot = root
    ensureMaterials()
    const box = new THREE.Box3().setFromObject(root)
    const size = new THREE.Vector3()
    box.getSize(size)
    const maxDim = Math.max(size.x, size.y, size.z, 0.01)
    boneRadius = Math.max(0.012, maxDim * 0.022)

    overlay = new THREE.Group()
    overlay.name = 'pose-skeleton-overlay'
    overlay.renderOrder = 999

    const bones = collectPoseEditBones(root)
    const boneSet = new Set(bones)
    for (const bone of bones) {
      const name = boneLabel(bone)
      const joint = new THREE.Mesh(jointGeom!, jointMat!)
      joint.name = `pose-joint:${name}`
      joint.userData.poseBoneName = name
      joint.renderOrder = 1001
      joint.frustumCulled = false
      overlay!.add(joint)
      entries.push({ name, bone, joint })
    }

    // 用最近可编辑祖先连线：跳过被隐藏的 twist/roll，避免肘部「分叉多一节」
    for (const bone of bones) {
      const parent = findNearestPoseBoneParent(bone, boneSet)
      if (!parent) continue
      const fromName = boneLabel(parent)
      const toName = boneLabel(bone)
      const mesh = new THREE.Mesh(segmentGeom!, linkMat!)
      mesh.name = `pose-link:${fromName}>${toName}`
      mesh.renderOrder = 1000
      mesh.frustumCulled = false
      overlay!.add(mesh)
      links.push({ fromName, toName, from: parent, to: bone, mesh })
    }

    scene.add(overlay)
    update()
  }

  function update(): void {
    if (!overlay || !entries.length) return
    // 强制刷新整棵骨架世界矩阵，否则父骨转动后子骨点线会停在原地
    targetRoot?.updateMatrixWorld(true)
    for (const entry of entries) {
      entry.bone.getWorldPosition(worldPos)
      entry.joint.position.copy(worldPos)
      const selected = selectedBone != null && selectedBone === entry.name
      entry.joint.material = selected ? jointMatSelected! : jointMat!
      entry.joint.scale.setScalar(selected ? boneRadius * 0.72 : boneRadius * 0.48)
    }
    for (const link of links) {
      link.from.getWorldPosition(worldPos)
      link.to.getWorldPosition(worldPosChild)
      boneDir.subVectors(worldPosChild, worldPos)
      const len = boneDir.length()
      if (len < 1e-6) {
        link.mesh.visible = false
        continue
      }
      link.mesh.visible = true
      boneDir.multiplyScalar(1 / len)
      boneQuat.setFromUnitVectors(yAxis, boneDir)
      link.mesh.position.copy(worldPos)
      link.mesh.quaternion.copy(boneQuat)
      const thickness = Math.max(boneRadius * 1.2, len * 0.07)
      link.mesh.scale.set(thickness, len, thickness)
      const selected =
        selectedBone != null &&
        (selectedBone === link.fromName || selectedBone === link.toName)
      link.mesh.material = selected ? linkMatSelected! : linkMat!
    }
  }

  return {
    clear,
    setTarget,
    update,
    getTargetObjectId: () => targetObjectId,
    setTargetObjectId: (id) => {
      targetObjectId = id
    },
    setSelectedBone: (name) => {
      selectedBone = name?.trim() || null
      update()
    },
    getJointMeshes: () => entries.map((entry) => entry.joint),
    findBone: (name) => {
      const key = name.trim()
      return entries.find((entry) => entry.name === key)?.bone ?? null
    }
  }
}
