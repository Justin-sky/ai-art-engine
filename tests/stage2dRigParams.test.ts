import { describe, expect, it } from 'vitest'
import {
  createDefaultStage2dRig,
  createDefaultStage2dPose,
  normalizeStage2dPose,
  readStage2dPoseFromNode,
  readStage2dRigFromNode,
  stage2dPoseToNodePatch,
  stage2dRigToNodePatch,
  type Stage2dRig
} from '../src/shared/graph'

const rig: Stage2dRig = {
  root: { x: 0, y: 0 },
  joints: [
    { id: 'hip', name: '髋', parentId: null, x: 0, y: 0, rotation: 0 },
    { id: 'armL', name: '左臂', parentId: 'hip', x: 40, y: 0, rotation: 0 }
  ],
  attachments: []
}

describe('stage2dRig 节点参数读写', () => {
  it('createDefaultStage2dRig / createDefaultStage2dPose 返回空装配', () => {
    expect(createDefaultStage2dRig()).toEqual({ root: { x: 0, y: 0 }, joints: [], attachments: [] })
    expect(createDefaultStage2dPose()).toEqual({})
  })

  it('readStage2dRigFromNode：缺参数回落默认，非法关节断链夹取', () => {
    expect(readStage2dRigFromNode(null)).toEqual(createDefaultStage2dRig())
    const read = readStage2dRigFromNode({
      stage2dRig: {
        joints: [
          { parentId: 'ghost', x: 999999 },
          { id: 'b', rotation: 400 }
        ]
      }
    })
    expect(read.joints[0]!.parentId).toBeNull()
    expect(read.joints[0]!.x).toBe(8192)
    expect(read.joints[1]!.rotation).toBe(40)
  })

  it('stage2dRigToNodePatch 归一化后可直接写回节点', () => {
    const patch = stage2dRigToNodePatch({ ...rig, root: { x: Number.NaN, y: 1 } })
    expect(patch.stage2dRig.root).toEqual({ x: 0, y: 1 })
    expect(readStage2dRigFromNode(patch)).toEqual(patch.stage2dRig)
  })
})

describe('摆姿归一化', () => {
  it('剔除 rig 中不存在的关节与非有限数值', () => {
    const pose = normalizeStage2dPose(rig, { hip: 10, armL: Number.NaN, ghost: 90 })
    expect(pose).toEqual({ hip: 10 })
  })

  it('read / patch 往返：姿势可按节点参数持久化', () => {
    const pose = stage2dPoseToNodePatch(rig, { hip: -45 }).stage2dPose
    expect(readStage2dPoseFromNode({ stage2dPose: pose }, rig)).toEqual({ hip: -45 })
  })

  it('关节被删后 read 会清掉失效关节的摆姿', () => {
    const slim = { ...rig, joints: rig.joints.slice(0, 1) }
    expect(readStage2dPoseFromNode({ stage2dPose: { hip: 1, armL: 2 } }, slim)).toEqual({ hip: 1 })
  })
})
