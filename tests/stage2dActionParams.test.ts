import { describe, expect, it } from 'vitest'
import {
  readStage2dActionFromNode,
  stage2dActionToNodePatch,
  type Stage2dAction
} from '../src/shared/graph'

function samplePose(rotation = 12): Record<string, number> {
  return { shoulderL: rotation, shoulderR: -rotation }
}

function makeAction(overrides: Partial<Stage2dAction> = {}): Stage2dAction {
  return {
    name: 'wave',
    loop: true,
    duration: 1,
    keyframes: [
      { time: 0, pose: samplePose(0) },
      { time: 1, pose: samplePose(30) }
    ],
    ...overrides
  }
}

describe('stage2dAction 自定义动作参数读写', () => {
  it('readStage2dActionFromNode：缺失 / 空动作回落 null', () => {
    expect(readStage2dActionFromNode(null)).toBeNull()
    expect(readStage2dActionFromNode({})).toBeNull()
    expect(readStage2dActionFromNode({ stage2dAction: null })).toBeNull()
    expect(
      readStage2dActionFromNode({ stage2dAction: { name: 'empty', keyframes: [] } })
    ).toBeNull()
  })

  it('read / patch 往返：非空动作可经节点参数持久化', () => {
    const patch = stage2dActionToNodePatch(makeAction())
    const read = readStage2dActionFromNode(patch)
    expect(read).not.toBeNull()
    expect(read!.name).toBe('wave')
    expect(read!.keyframes).toHaveLength(2)
    expect(read!.duration).toBe(1)
  })

  it('stage2dActionToNodePatch：非法值归一化后写回，空动作清成 null', () => {
    const patch = stage2dActionToNodePatch(makeAction({ duration: Number.NaN, keyframes: [] }))
    expect(patch.stage2dAction).toBeNull()
    expect(stage2dActionToNodePatch(undefined).stage2dAction).toBeNull()
    expect(stage2dActionToNodePatch(null).stage2dAction).toBeNull()
  })
})
