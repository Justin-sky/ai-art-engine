import { describe, expect, it } from 'vitest'
import {
  STAGE2D_ACTION_ASSET_KEY,
  createDefaultStage2dActionAssetPack,
  normalizeStage2dActionAssetPack,
  packStage2dActionAsset,
  readStage2dActionAssetFromGenParams,
  stage2dActionAssetGenParams,
  type Stage2dActionAssetPack
} from '../src/shared/gameAssets/stage2dActionAsset'
import { normalizeStage2dAction } from '../src/shared/gameAssets/stage2dAction'

function makePack(overrides: Record<string, unknown> = {}): Stage2dActionAssetPack {
  const rig = {
    root: { x: 0, y: 100 },
    joints: [
      { id: 'pelvis', name: 'pelvis', parentId: null, x: 0, y: 0, rotation: 0 },
      { id: 'shoulderL', name: 'shoulderL', parentId: 'pelvis', x: -20, y: -40, rotation: 0 }
    ],
    attachments: []
  }
  const action = normalizeStage2dAction({
    name: 'wave',
    loop: true,
    duration: 1,
    keyframes: [
      { time: 0, pose: { shoulderL: 10 } },
      { time: 1, pose: { shoulderL: 40 } }
    ]
  })
  return {
    format: 'stage2d-action-asset',
    version: 1,
    action,
    rig,
    pose: { shoulderL: 15 },
    ...overrides
  } as Stage2dActionAssetPack
}

describe('stage2dAction 动作资产包', () => {
  it('默认资产包：标准人形装配 + 单空关键帧动作', () => {
    const pack = createDefaultStage2dActionAssetPack()
    expect(pack.format).toBe('stage2d-action-asset')
    expect(pack.rig?.joints.length).toBeGreaterThan(10)
    expect(pack.action.keyframes).toHaveLength(1)
    expect(pack.action.keyframes[0]!.time).toBe(0)
  })

  it('pack 往返：动作 / 装配 / 摆姿可直接落 genParams 再读出', () => {
    const source = makePack()
    const gen = stage2dActionAssetGenParams(packStage2dActionAsset(source))
    expect(gen[STAGE2D_ACTION_ASSET_KEY]).toBeTruthy()
    const read = readStage2dActionAssetFromGenParams(gen)
    expect(read).not.toBeNull()
    expect(read!.action.name).toBe('wave')
    expect(read!.action.keyframes).toHaveLength(2)
    expect(read!.rig?.joints[1]!.id).toBe('shoulderL')
    expect(read!.pose).toEqual({ shoulderL: 15 })
  })

  it('读库容错：无字段 / 格式不符回落 null，字段残缺可归一化', () => {
    expect(readStage2dActionAssetFromGenParams(null)).toBeNull()
    expect(readStage2dActionAssetFromGenParams({})).toBeNull()
    expect(
      readStage2dActionAssetFromGenParams({ [STAGE2D_ACTION_ASSET_KEY]: { format: 'nope' } })
    ).toBeNull()
    const repaired = normalizeStage2dActionAssetPack(null)
    expect(repaired.action.keyframes).toHaveLength(0)
  })

  it('归一化：非法角度 / 越界坐标收敛，动作帧仍按时间升序', () => {
    const normalized = normalizeStage2dActionAssetPack({
      action: {
        keyframes: [
          { time: 1, pose: { a: 400 } },
          { time: 0.5, pose: { a: 90, ghost: Number.NaN } },
          { time: 2, pose: { a: Number.POSITIVE_INFINITY } }
        ]
      },
      rig: {
        root: { x: 9999999 },
        joints: [{ id: 'a', parentId: 'ghost', rotation: 400 }],
        attachments: []
      },
      pose: { a: -190, b: Number.NaN }
    })
    expect(normalized.action.keyframes.map((f) => f.time)).toEqual([0.5, 1, 2])
    expect(normalized.action.keyframes[0]!.pose).toEqual({ a: 90 })
    expect(normalized.rig!.joints[0]!.parentId).toBeNull()
    expect(normalized.rig!.joints[0]!.rotation).toBe(40)
    expect(normalized.rig!.root.x).toBe(8192)
    expect(normalized.pose).toEqual({ a: 170 })
  })

  it('空动作包也保持形状完整（动作内容是否可用由消费方判空）', () => {
    const empty = packStage2dActionAsset({ action: normalizeStage2dAction({ keyframes: [] }) })
    expect(empty.action.keyframes).toHaveLength(0)
  })
})
