import { describe, expect, it, vi } from 'vitest'
import { applyBorderFloodColorKey, samplePerimeterBackgroundColor } from '../src/shared/gameAssets'
import {
  ALLOWED_PARAM_KEYS,
  appendImageTransparentBgPrompt,
  createNodeFromType,
  executeImageGenerateNode,
  IMAGE_NATIVE_TRANSPARENT_BG_PROMPT_ZH,
  IMAGE_TRANSPARENT_BG_PROMPT_EN,
  IMAGE_TRANSPARENT_BG_PROMPT_ZH,
  imageGenerateParamsToNodePatch,
  isExplicitOpaqueBgPrompt,
  readImageGenerateParamsFromNode,
  resolveImageGenerateParamsForApi,
  type GraphNode,
  type NodeExecuteContext
} from '../src/shared/graph'

describe('imageGenerateParams transparentBg', () => {
  it('defaults generateTransparentBg to true on node creation and parameter reading unless explicitly false', () => {
    const defaultNode = createNodeFromType('asset.image', { x: 0, y: 0 })
    expect(defaultNode.params.generateTransparentBg).toBe(true)

    const uiGenNode = createNodeFromType('ui.gen', { x: 0, y: 0 })
    expect(uiGenNode.params.generateTransparentBg).toBe(true)

    const readDefault = readImageGenerateParamsFromNode({})
    expect(readDefault.transparentBg).toBe(true)

    const readOff = readImageGenerateParamsFromNode({ generateTransparentBg: false })
    expect(readOff.transparentBg).toBe(false)

    const readOn = readImageGenerateParamsFromNode({ generateTransparentBg: true })
    expect(readOn.transparentBg).toBe(true)

    const resolved = resolveImageGenerateParamsForApi({})
    expect(resolved.transparentBg).toBe(true)

    const patch = imageGenerateParamsToNodePatch(resolved)
    expect(patch.generateTransparentBg).toBe(true)
    expect(ALLOWED_PARAM_KEYS.has('generateTransparentBg')).toBe(true)
  })

  it('appends transparent background prompt in zh/en, is idempotent, and skips when prompt explicitly requests opaque background', () => {
    const zh = appendImageTransparentBgPrompt('一把发光的魔法圣剑', 'zh-CN')
    expect(zh).toContain('一把发光的魔法圣剑')
    expect(zh).toContain(IMAGE_TRANSPARENT_BG_PROMPT_ZH)
    expect(appendImageTransparentBgPrompt(zh, 'zh-CN')).toBe(zh)

    const en = appendImageTransparentBgPrompt('A glowing magic sword', 'en-US')
    expect(en).toContain('A glowing magic sword')
    expect(en).toContain(IMAGE_TRANSPARENT_BG_PROMPT_EN)
    expect(appendImageTransparentBgPrompt(en, 'en-US')).toBe(en)

    const opaqueZh = '赛博朋克街头夜景，要求非透明背景，保留完整环境背景'
    expect(isExplicitOpaqueBgPrompt(opaqueZh)).toBe(true)
    expect(appendImageTransparentBgPrompt(opaqueZh, 'zh-CN')).toBe(opaqueZh)

    const opaqueEn = 'A fantasy tavern interior with opaque background and full environment details'
    expect(isExplicitOpaqueBgPrompt(opaqueEn)).toBe(true)
    expect(appendImageTransparentBgPrompt(opaqueEn, 'en-US')).toBe(opaqueEn)
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

  it('floods smooth ambient background shadows to zero alpha without leaking across silver-gray hair outlines', () => {
    // 16x9 画布：
    // x = 0..5：从纯白 (255,255,255) 平滑渐暗至 (200,200,200) 的凹陷环境阴影（每像素步差 ~9，总色距 55 > distance=40）
    // x = 6：浅银灰发丝描边 (198,198,204)（与背景有明显阶跃）
    // x = 7..10：角色内部纯白发丝 (248,248,252)
    // x = 11..15：右侧纯白背景 (255,255,255)，在 x=11 处为深色描边 (40,40,50)
    const w = 16
    const h = 9
    const rgba = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const inSubjectY = y >= 2 && y <= 6
        if (!inSubjectY || x >= 12) {
          rgba[i] = 255
          rgba[i + 1] = 255
          rgba[i + 2] = 255
          rgba[i + 3] = 255
        } else if (x <= 5) {
          // 凹陷处平滑环境阴影：从 255 渐变到 205
          const v = 255 - x * 9
          rgba[i] = v
          rgba[i + 1] = v
          rgba[i + 2] = v
          rgba[i + 3] = 255
        } else if (x === 6 || x === 11 || y === 2 || y === 6) {
          // 银灰发丝闭合外描边（相对相邻背景存在明显阶跃）
          rgba[i] = 175
          rgba[i + 1] = 178
          rgba[i + 2] = 188
          rgba[i + 3] = 255
        } else {
          // 内部纯白发丝 (x = 7..10, y = 3..5)
          rgba[i] = 248
          rgba[i + 1] = 248
          rgba[i + 2] = 252
          rgba[i + 3] = 255
        }
      }
    }

    applyBorderFloodColorKey(rgba, w, h, { distance: 40, feather: 34, soft: true })
    // 凹陷处平滑阴影 x=5 (v=210, dist=45 > 40) 必须被彻底泛洪置为 alpha=0，不残留半透明白雾
    expect(rgba[(4 * w + 5) * 4 + 3]).toBe(0)
    // 角色内部的纯白发丝 x=8 绝不被穿透，保持完全不透明 255
    expect(rgba[(4 * w + 8) * 4 + 3]).toBe(255)
  })
})

describe('executeImageGenerateNode with generateTransparentBg', () => {
  function makeNode(generateTransparentBg?: boolean, generateModel?: string): GraphNode {
    return {
      id: 'img-1',
      category: 'asset',
      typeId: 'asset.image',
      assetType: 'image',
      title: 'Image',
      position: { x: 0, y: 0 },
      params: {
        generateInstruction: '一瓶红色治疗药水',
        ...(generateTransparentBg !== undefined ? { generateTransparentBg } : {}),
        ...(generateModel ? { generateModel } : {})
      }
    }
  }

  it('enables transparentBackground by default without post-generation background removal, generating transparent images on supported models and normal opaque images on unsupported models', async () => {
    const generateImage = vi.fn(async () => ({
      images: ['data:image/png;base64,MODEL_OUTPUT'],
      model: 'gpt-image-1'
    }))
    const removeImageSolidBackground = vi.fn()
    const composeImageCutoutCanvas = vi.fn()

    // 1. Default (omitted generateTransparentBg) + Native transparent model (e.g. gpt-image-1) -> native transparent prompt + transparentBackground: true, no post-processing
    const outNative = await executeImageGenerateNode({
      node: makeNode(undefined, 'gpt-image-1'),
      inputs: {},
      locale: 'zh-CN',
      generateImage,
      removeImageSolidBackground,
      composeImageCutoutCanvas
    })
    expect(generateImage).toHaveBeenCalledTimes(1)
    expect(generateImage.mock.calls[0]![0].prompt).toContain(IMAGE_NATIVE_TRANSPARENT_BG_PROMPT_ZH)
    expect(generateImage.mock.calls[0]![0].transparentBackground).toBe(true)
    expect(removeImageSolidBackground).not.toHaveBeenCalled()
    expect(composeImageCutoutCanvas).not.toHaveBeenCalled()
    expect(outNative.out).toMatchObject({
      kind: 'image',
      dataUrl: 'data:image/png;base64,MODEL_OUTPUT'
    })

    // 2. Non-transparent model (e.g. seedream-3.0) with transparentBg enabled -> no special prompt or post-processing, generates opaque image directly
    const outOpaqueModel = await executeImageGenerateNode({
      node: makeNode(true, 'seedream-3.0'),
      inputs: {},
      locale: 'zh-CN',
      generateImage,
      removeImageSolidBackground,
      composeImageCutoutCanvas
    })
    expect(generateImage).toHaveBeenCalledTimes(2)
    expect(generateImage.mock.calls[1]![0].prompt).not.toContain(IMAGE_TRANSPARENT_BG_PROMPT_ZH)
    expect(generateImage.mock.calls[1]![0].prompt).not.toContain(
      IMAGE_NATIVE_TRANSPARENT_BG_PROMPT_ZH
    )
    expect(generateImage.mock.calls[1]![0].transparentBackground).toBe(true)
    expect(removeImageSolidBackground).not.toHaveBeenCalled()
    expect(composeImageCutoutCanvas).not.toHaveBeenCalled()
    expect(outOpaqueModel.out).toMatchObject({
      kind: 'image',
      dataUrl: 'data:image/png;base64,MODEL_OUTPUT'
    })
  })

  it('does not request transparent background when generateTransparentBg is false or prompt explicitly asks for opaque background', async () => {
    const generateImage = vi.fn(async () => ({
      images: ['data:image/png;base64,RAW_OPAQUE'],
      model: 'gpt-image-1'
    }))
    const removeImageSolidBackground = vi.fn()
    const composeImageCutoutCanvas = vi.fn()

    const out = await executeImageGenerateNode({
      node: makeNode(false, 'gpt-image-1'),
      inputs: {},
      locale: 'zh-CN',
      generateImage,
      removeImageSolidBackground,
      composeImageCutoutCanvas
    })
    expect(generateImage).toHaveBeenCalledOnce()
    expect(generateImage.mock.calls[0]![0].prompt).not.toContain(
      IMAGE_NATIVE_TRANSPARENT_BG_PROMPT_ZH
    )
    expect(generateImage.mock.calls[0]![0].transparentBackground).toBeUndefined()
    expect(removeImageSolidBackground).not.toHaveBeenCalled()
    expect(composeImageCutoutCanvas).not.toHaveBeenCalled()
    expect(out.out).toMatchObject({
      kind: 'image',
      dataUrl: 'data:image/png;base64,RAW_OPAQUE'
    })
  })
})
