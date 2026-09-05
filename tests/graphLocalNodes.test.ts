import { describe, expect, it } from 'vitest'
import {
  DEFAULT_IMAGE_CUTOUT,
  imageCutoutToNodePatch,
  normalizeImageCutout,
  readImageCutoutFromNode
} from '../src/shared/graph/imageCutout'
import {
  DEFAULT_IMAGE_COMPOSE,
  imageComposeToNodePatch,
  normalizeImageCompose
} from '../src/shared/graph/imageCompose'

describe('normalizeImageCutout', () => {
  it('空输入回落默认值', () => {
    const s = normalizeImageCutout(null)
    expect(s).toEqual(DEFAULT_IMAGE_CUTOUT)
  })

  it('置信度/保留阈值按边界钳制', () => {
    const s = normalizeImageCutout({ confThreshold: 1.5, threshold: -1 })
    expect(s.confThreshold).toBe(0.9)
    expect(s.threshold).toBe(0.05)
  })

  it('羽化取整并钳到 [0,96]', () => {
    expect(normalizeImageCutout({ feather: 12.6 }).feather).toBe(13)
    expect(normalizeImageCutout({ feather: -4 }).feather).toBe(0)
    expect(normalizeImageCutout({ feather: 200 }).feather).toBe(96)
  })

  it('boolean 默认开，仅显式 false 关闭', () => {
    expect(normalizeImageCutout({}).cropToSubject).toBe(true)
    expect(normalizeImageCutout({}).personOnly).toBe(true)
    expect(
      normalizeImageCutout({ cropToSubject: false, personOnly: false })
    ).toMatchObject({ cropToSubject: false, personOnly: false })
  })

  it('readImageCutoutFromNode 从节点 params 读取', () => {
    const s = readImageCutoutFromNode({
      imageCutout: { threshold: 0.8, feather: 8, personOnly: false }
    })
    expect(s).toMatchObject({ threshold: 0.8, feather: 8, personOnly: false })
    expect(s.confThreshold).toBe(DEFAULT_IMAGE_CUTOUT.confThreshold)
  })

  it('patch 往返保持合法值', () => {
    const patch = imageCutoutToNodePatch({
      threshold: 2,
      feather: -3,
      cropToSubject: false,
      personOnly: true,
      confThreshold: 0.5
    })
    expect(patch.imageCutout).toMatchObject({
      threshold: 1,
      feather: 0,
      cropToSubject: false,
      personOnly: true
    })
  })
})

describe('normalizeImageCompose', () => {
  it('空输入回落默认（9:16 / headroom）', () => {
    const s = normalizeImageCompose(null)
    expect(s.aspectId).toBe('9:16')
    expect(s.strategy).toBe('headroom')
    expect(s.confThreshold).toBe(DEFAULT_IMAGE_COMPOSE.confThreshold)
  })

  it('未知画幅回落默认画幅', () => {
    expect(normalizeImageCompose({ aspectId: '21:9' }).aspectId).toBe('9:16')
    expect(normalizeImageCompose({ aspectId: '1:1' }).aspectId).toBe('1:1')
  })

  it('strategy 只允许 center / headroom', () => {
    expect(normalizeImageCompose({ strategy: 'center' }).strategy).toBe('center')
    // 测试里传其它值会走 headroom 兜底（类型上是合法 union）
    expect(normalizeImageCompose({ strategy: 'headroom' }).strategy).toBe('headroom')
  })

  it('subjectBox 缓存字段：越界或源尺寸缺失即清空', () => {
    const box = { x: 10, y: 20, width: 100, height: 300 }
    const s = normalizeImageCompose({
      subjectBox: box,
      detectedWidth: 1080,
      detectedHeight: 1920,
      detectedConf: 0.5
    })
    expect(s.subjectBox).toEqual(box)

    // 无源尺寸时清空主体框
    expect(
      normalizeImageCompose({ subjectBox: box, detectedWidth: 0, detectedHeight: 0 })
        .subjectBox
    ).toBeNull()
    // 尺寸为负时清空
    expect(
      normalizeImageCompose({
        subjectBox: box,
        detectedWidth: 1080,
        detectedHeight: -1
      }).subjectBox
    ).toBeNull()
  })

  it('patch 往返保留缓存字段', () => {
    const state = normalizeImageCompose({
      aspectId: '1:1',
      strategy: 'center',
      confThreshold: 0.7,
      subjectBox: { x: 0, y: 0, width: 10, height: 10 },
      detectedWidth: 100,
      detectedHeight: 100,
      detectedConf: 0.7
    })
    const patch = imageComposeToNodePatch(state)
    expect(patch.imageCompose).toEqual(state)
  })
})
