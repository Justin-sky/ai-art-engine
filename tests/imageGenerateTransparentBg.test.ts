import { describe, expect, it, vi } from 'vitest'
import { applyBorderFloodColorKey, samplePerimeterBackgroundColor } from '../src/shared/gameAssets'
import {
  ALLOWED_PARAM_KEYS,
  appendImageTransparentBgPrompt,
  executeImageGenerateNode,
  IMAGE_TRANSPARENT_BG_PROMPT_EN,
  IMAGE_TRANSPARENT_BG_PROMPT_ZH,
  imageGenerateParamsToNodePatch,
  readImageGenerateParamsFromNode,
  resolveImageGenerateParamsForApi,
  type GraphNode,
  type NodeExecuteContext
} from '../src/shared/graph'

describe('imageGenerateParams transparentBg', () => {
  it('reads and patches generateTransparentBg cleanly', () => {
    const readOff = readImageGenerateParamsFromNode({})
    expect(readOff.transparentBg).toBe(false)

    const readOn = readImageGenerateParamsFromNode({ generateTransparentBg: true })
    expect(readOn.transparentBg).toBe(true)

    const resolved = resolveImageGenerateParamsForApi({ generateTransparentBg: true })
    expect(resolved.transparentBg).toBe(true)

    const patch = imageGenerateParamsToNodePatch(resolved)
    expect(patch.generateTransparentBg).toBe(true)
    expect(ALLOWED_PARAM_KEYS.has('generateTransparentBg')).toBe(true)
  })

  it('appends transparent background prompt in zh/en and is idempotent', () => {
    const zh = appendImageTransparentBgPrompt('一把发光的魔法圣剑', 'zh-CN')
    expect(zh).toContain('一把发光的魔法圣剑')
    expect(zh).toContain(IMAGE_TRANSPARENT_BG_PROMPT_ZH)
    expect(appendImageTransparentBgPrompt(zh, 'zh-CN')).toBe(zh)

    const en = appendImageTransparentBgPrompt('A glowing magic sword', 'en-US')
    expect(en).toContain('A glowing magic sword')
    expect(en).toContain(IMAGE_TRANSPARENT_BG_PROMPT_EN)
    expect(appendImageTransparentBgPrompt(en, 'en-US')).toBe(en)
  })
})

describe('applyBorderFloodColorKey', () => {
  it('keys exterior solid background while preserving enclosed same-color interior highlights', () => {
    // 9x9 画布：外圈纯白背景 (255,255,255)，中间 5x5 深色轮廓 (20,30,40)，正中心 1x1 纯白高光/眼白 (255,255,255)
    const w = 9
    const h = 9
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const inOutline = x >= 2 && x <= 6 && y >= 2 && y <= 6
        const isInnerHighlight = x === 4 && y === 4
        if (inOutline && !isInnerHighlight) {
          rgba[i] = 20
          rgba[i + 1] = 30
          rgba[i + 2] = 40
          rgba[i + 3] = 255
        } else {
          rgba[i] = 255
          rgba[i + 1] = 255
          rgba[i + 2] = 255
          rgba[i + 3] = 255
        }
      }
    }

    const res = applyBorderFloodColorKey(rgba, w, h, { distance: 40, feather: 20 })
    expect(res.background).toEqual({ r: 255, g: 255, b: 255 })
    // 外圈 81 - 25 = 56 个像素全部被抠成全透明
    expect(res.keyedPixels).toBe(56)
    expect(rgba[3]).toBe(0)
    // 正中心被深色轮廓包围的纯白像素 (4,4) 绝不被误挖空
    const centerAlpha = rgba[(4 * w + 4) * 4 + 3]
    expect(centerAlpha).toBe(255)
  })

  it('ignores an outlier corner when sampling perimeter background color', () => {
    const w = 10
    const h = 10
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = 240
      rgba[i * 4 + 1] = 242
      rgba[i * 4 + 2] = 245
      rgba[i * 4 + 3] = 255
    }
    // 左上角 2x2 被深色物体压住
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        const idx = (y * w + x) * 4
        rgba[idx] = 10
        rgba[idx + 1] = 10
        rgba[idx + 2] = 10
      }
    }
    const sampled = samplePerimeterBackgroundColor(rgba, w, h)
    expect(sampled).toEqual({ r: 240, g: 242, b: 245 })
  })
})

describe('executeImageGenerateNode with generateTransparentBg', () => {
  function makeNode(generateTransparentBg: boolean): GraphNode {
    return {
      id: 'img-1',
      category: 'asset',
      typeId: 'asset.image',
      assetType: 'image',
      title: 'Image',
      position: { x: 0, y: 0 },
      params: {
        generateInstruction: '一瓶红色治疗药水',
        generateTransparentBg
      }
    }
  }

  it('appends solid-bg prompt and applies removeImageSolidBackground when generateTransparentBg is true', async () => {
    const generateImage = vi.fn(async () => ({
      images: ['data:image/png;base64,RAW_SOLID'],
      model: 'test-model'
    }))
    const removeImageSolidBackground = vi.fn(async () => ({
      dataUrl: 'data:image/png;base64,KEYED_RGBA',
      width: 512,
      height: 512,
      keyedRatio: 0.45
    }))
    const composeImageCutoutCanvas = vi.fn()

    const ctx: NodeExecuteContext = {
      node: makeNode(true),
      inputs: {},
      locale: 'zh-CN',
      generateImage,
      removeImageSolidBackground,
      composeImageCutoutCanvas
    }

    const out = await executeImageGenerateNode(ctx)
    expect(generateImage).toHaveBeenCalledOnce()
    expect(generateImage.mock.calls[0]![0].prompt).toContain(IMAGE_TRANSPARENT_BG_PROMPT_ZH)
    expect(removeImageSolidBackground).toHaveBeenCalledWith({
      dataUrl: 'data:image/png;base64,RAW_SOLID'
    })
    expect(composeImageCutoutCanvas).not.toHaveBeenCalled()
    expect(out.out).toMatchObject({
      kind: 'image',
      dataUrl: 'data:image/png;base64,KEYED_RGBA'
    })
  })

  it('falls back to composeImageCutoutCanvas when solid background keying ratio is too low', async () => {
    const generateImage = vi.fn(async () => ({
      images: ['data:image/png;base64,RAW_COMPLEX'],
      model: 'test-model'
    }))
    const removeImageSolidBackground = vi.fn(async () => ({
      dataUrl: 'data:image/png;base64,RAW_COMPLEX',
      width: 512,
      height: 512,
      keyedRatio: 0.005
    }))
    const composeImageCutoutCanvas = vi.fn(async () => ({
      dataUrl: 'data:image/png;base64,YOLO_CUTOUT_RGBA',
      width: 512,
      height: 512
    }))

    const ctx: NodeExecuteContext = {
      node: makeNode(true),
      inputs: {},
      locale: 'zh-CN',
      generateImage,
      removeImageSolidBackground,
      composeImageCutoutCanvas
    }

    const out = await executeImageGenerateNode(ctx)
    expect(removeImageSolidBackground).toHaveBeenCalledOnce()
    expect(composeImageCutoutCanvas).toHaveBeenCalledWith({
      sourceDataUrl: 'data:image/png;base64,RAW_COMPLEX',
      state: {
        confThreshold: 0.25,
        threshold: 0.5,
        feather: 2,
        cropToSubject: false,
        personOnly: false,
        selected: null
      }
    })
    expect(out.out).toMatchObject({
      kind: 'image',
      dataUrl: 'data:image/png;base64,YOLO_CUTOUT_RGBA'
    })
  })
})
