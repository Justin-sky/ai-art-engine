import { describe, expect, it } from 'vitest'
import {
  applySeamlessTileWrap,
  DEFAULT_IMAGE_ALIGN,
  IMAGE_ALIGN_SIZE_PRESETS,
  imageAlignToNodePatch,
  normalizeImageAlign,
  readImageAlignFromNode,
  type ImageAlignState
} from '../src/shared/graph'

describe('imageAlign 参数态', () => {
  it('空输入落到默认（1024 画布 / 脚底锚点 / 主体高 90% / 地面 6%）', () => {
    expect(normalizeImageAlign(null)).toEqual(DEFAULT_IMAGE_ALIGN)
    expect(normalizeImageAlign(undefined)).toEqual(DEFAULT_IMAGE_ALIGN)
  })

  it('越界值夹取、非法锚点回落', () => {
    const o = normalizeImageAlign({
      canvasWidth: 1,
      canvasHeight: 99999,
      anchor: 'nonsense' as never,
      contentHeightRatio: 3,
      groundRatio: -1
    } as Partial<ImageAlignState>)
    expect(o.canvasWidth).toBe(16)
    expect(o.canvasHeight).toBe(8192)
    expect(o.anchor).toBe('ground')
    expect(o.contentHeightRatio).toBe(1)
    expect(o.groundRatio).toBe(0)
  })

  it('保留 center 锚点与 fitWithinWidth=false', () => {
    const o = normalizeImageAlign({
      anchor: 'center',
      fitWithinWidth: false,
      contentHeightRatio: 0.72
    })
    expect(o.anchor).toBe('center')
    expect(o.fitWithinWidth).toBe(false)
    expect(o.contentHeightRatio).toBeCloseTo(0.72, 5)
  })

  it('readImageAlignFromNode 兼容缺参节点', () => {
    expect(readImageAlignFromNode({})).toEqual(DEFAULT_IMAGE_ALIGN)
    const state = readImageAlignFromNode({ imageAlign: { canvasWidth: 512 } })
    expect(state.canvasWidth).toBe(512)
    expect(state.canvasHeight).toBe(DEFAULT_IMAGE_ALIGN.canvasHeight)
  })

  it('toNodePatch 归一化后可回读', () => {
    const patch = imageAlignToNodePatch({ canvasWidth: 600, canvasHeight: 900 } as ImageAlignState)
    const state = readImageAlignFromNode(patch)
    expect(patch.imageAlign).toBeDefined()
    expect(state).toMatchObject({
      canvasWidth: 600,
      canvasHeight: 900,
      anchor: 'ground',
      contentHeightRatio: 0.9,
      groundRatio: 0.06,
      fitWithinWidth: true
    })
  })

  it('支持微调偏移、水平翻转与前置去底参数归一化，且提供常用尺寸预设', () => {
    expect(IMAGE_ALIGN_SIZE_PRESETS.length).toBeGreaterThanOrEqual(5)
    const o = normalizeImageAlign({
      canvasWidth: 512,
      canvasHeight: 512,
      offsetX: 24,
      offsetY: -12,
      flipX: true,
      bgKey: 'auto',
      bgThreshold: 55,
      defringe: true,
      tileSeamless: true,
      tileBlendRatio: 0.25,
      nineSlice: 32
    })
    expect(o).toMatchObject({
      canvasWidth: 512,
      canvasHeight: 512,
      offsetX: 24,
      offsetY: -12,
      flipX: true,
      bgKey: 'auto',
      bgThreshold: 55,
      defringe: true,
      tileSeamless: true,
      tileBlendRatio: 0.25,
      nineSlice: 32
    })
  })

  it('applySeamlessTileWrap 对边余弦融合消除左右与上下拼缝跳变', () => {
    const w = 16
    const h = 16
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        rgba[i] = x < w / 2 ? 40 : 200
        rgba[i + 1] = y < h / 2 ? 60 : 180
        rgba[i + 2] = 100
        rgba[i + 3] = 255
      }
    }
    const rawDiffX = Math.abs(rgba[0] - rgba[(w - 1) * 4])
    applySeamlessTileWrap(rgba, w, h, 0.25)
    const wrappedDiffX = Math.abs(rgba[0] - rgba[(w - 1) * 4])
    expect(wrappedDiffX).toBeLessThan(rawDiffX)
  })
})
