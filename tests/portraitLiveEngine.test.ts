import { describe, expect, it } from 'vitest'
import {
  PORTRAIT_PRESETS,
  applyCubeLutRgb,
  applyPortraitLivePixelPipeline,
  applyPortraitPreset,
  buildFaceLiquifyControlVectors,
  buildPortraitAiPrompt,
  buildPortraitPrompt,
  defaultPortraitRetouch,
  extractFaceSemanticRegions,
  parseCubeLut,
  pointInPolygon,
  sampleLiquifySourceCoord
} from '../src/shared/graph'

/** 构造标准 68 点测试人脸关键点（归一化 0..1） */
function makeCanonical68Landmarks(): Array<[number, number]> {
  const pts: Array<[number, number]> = []
  // 0..16: 下颌线（从左颊经下巴到右颊）
  for (let i = 0; i <= 16; i++) {
    const t = (i - 8) / 8
    pts.push([0.5 + t * 0.18, 0.45 + (1 - t * t) * 0.22])
  }
  // 17..21: 左眉
  for (let i = 0; i < 5; i++) pts.push([0.36 + i * 0.025, 0.36])
  // 22..26: 右眉
  for (let i = 0; i < 5; i++) pts.push([0.54 + i * 0.025, 0.36])
  // 27..30: 鼻梁
  for (let i = 0; i < 4; i++) pts.push([0.5, 0.4 + i * 0.03])
  // 31..35: 鼻翼底
  for (let i = 0; i < 5; i++) pts.push([0.46 + i * 0.02, 0.52])
  // 36..41: 左眼
  const leftEye: Array<[number, number]> = [
    [0.38, 0.41],
    [0.4, 0.395],
    [0.43, 0.395],
    [0.45, 0.41],
    [0.43, 0.425],
    [0.4, 0.425]
  ]
  pts.push(...leftEye)
  // 42..47: 右眼
  const rightEye: Array<[number, number]> = [
    [0.55, 0.41],
    [0.57, 0.395],
    [0.6, 0.395],
    [0.62, 0.41],
    [0.6, 0.425],
    [0.57, 0.425]
  ]
  pts.push(...rightEye)
  // 48..59: 外唇
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2
    pts.push([0.5 + Math.cos(angle) * 0.06, 0.58 + Math.sin(angle) * 0.025])
  }
  // 60..67: 内唇（牙齿区域）
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2
    pts.push([0.5 + Math.cos(angle) * 0.04, 0.58 + Math.sin(angle) * 0.015])
  }
  return pts
}

describe('commercial portrait specialties & live computational engine', () => {
  it('supports commercial retouch fields, ecommerce/businessPortrait presets, and attire prompts', () => {
    const ecom = applyPortraitPreset('ecommerce')
    expect(ecom.clothDeWrinkle).toBe('strong')
    expect(ecom.bodyToneUnify).toBe('strong')
    expect(ecom.neckShoulderLine).toBe('standard')

    const biz = applyPortraitPreset('businessPortrait')
    expect(biz.doubleChin).toBe('standard')
    expect(biz.glassesGlare).toBe('standard')
    expect(biz.teethWhiten).toBe('standard')
    expect(PORTRAIT_PRESETS.some((p) => p.id === 'ecommerce')).toBe(true)
    expect(PORTRAIT_PRESETS.some((p) => p.id === 'businessPortrait')).toBe(true)

    const state = {
      ...defaultPortraitRetouch(),
      doubleChin: 'strong' as const,
      glassesGlare: 'standard' as const,
      hairlineFill: 'light' as const,
      bodyToneUnify: 'standard' as const,
      teethWhiten: 'strong' as const,
      teethAlign: 'light' as const,
      neckShoulderLine: 'standard' as const,
      clothDeWrinkle: 'strong' as const,
      idPhotoSpecId: 'oneInch',
      idPhotoAttire: 'maleSuit' as const
    }
    const prompt = buildPortraitPrompt({
      state,
      needs: { face: true, mask: true, pose: true },
      idPhoto: {
        label: '一寸',
        widthMm: 25,
        heightMm: 35,
        background: '白底',
        sheet: false
      }
    })
    expect(prompt.main).toContain('消除双下巴')
    expect(prompt.main).toContain('眼镜片反光')
    expect(prompt.main).toContain('发际线')
    expect(prompt.main).toContain('统一脸部、颈部、肩膀与手臂肤色')
    expect(prompt.main).toContain('牙齿明显洁白亮丽')
    expect(prompt.main).toContain('修整牙齿边缘')
    expect(prompt.main).toContain('斜方肌')
    expect(prompt.main).toContain('熨平衣物褶皱')
    expect(prompt.main).toContain('男士西装外套')

    expect(buildPortraitAiPrompt('deWrinkle', '')).toContain('去除人物全身衣物的杂乱折痕与褶皱')
    expect(buildPortraitAiPrompt('idAttire', '')).toContain('正装')
    expect(buildPortraitAiPrompt('hairVolume', '')).toContain('颅顶蓬松度')
    expect(buildPortraitAiPrompt('relight3d', '')).toContain('影棚级立体补光')
  })

  it('extracts 68-point facial semantic regions and tests polygon containment', () => {
    const landmarks = makeCanonical68Landmarks()
    const regions = extractFaceSemanticRegions(landmarks)
    expect(regions).not.toBeNull()
    expect(regions!.faceSkinOutline.length).toBeGreaterThan(20)
    expect(regions!.leftEye).toHaveLength(6)
    expect(regions!.rightEye).toHaveLength(6)
    expect(regions!.outerLip).toHaveLength(12)
    expect(regions!.innerMouth).toHaveLength(8)

    // 鼻尖在面部轮廓内，图像四角不在面部轮廓内
    expect(pointInPolygon(0.5, 0.48, regions!.faceSkinOutline)).toBe(true)
    expect(pointInPolygon(0.05, 0.05, regions!.faceSkinOutline)).toBe(false)
    // 口腔中心在内唇多边形内
    expect(pointInPolygon(0.5, 0.58, regions!.innerMouth)).toBe(true)
  })

  it('computes 68-point MLS liquify control vectors and interactive brush warps', () => {
    const landmarks = makeCanonical68Landmarks()
    const state = {
      ...defaultPortraitRetouch(),
      faceSlim: 'strong' as const,
      jawline: 'standard' as const,
      chin: 'light' as const,
      doubleChin: 'standard' as const,
      eyeSize: 'standard' as const,
      noseShape: 'standard' as const
    }
    const vectors = buildFaceLiquifyControlVectors(state, landmarks)
    expect(vectors.length).toBeGreaterThan(10)

    // 验证交互推拉笔位移逆映射
    const warped = sampleLiquifySourceCoord(
      0.5,
      0.5,
      [],
      [
        {
          id: 's1',
          mode: 'push',
          from: [0.48, 0.5],
          to: [0.52, 0.5],
          radius: 0.08,
          strength: 0.8
        }
      ]
    )
    expect(warped[0]).toBeLessThan(0.5)
    expect(warped[1]).toBeCloseTo(0.5, 4)
  })

  it('parses standard .cube 3D LUTs and performs trilinear interpolation', () => {
    const cubeText = [
      '# Test LUT',
      'TITLE "Warm Cinema 2"',
      'LUT_3D_SIZE 2',
      '0.0 0.0 0.0',
      '1.0 0.0 0.0',
      '0.0 1.0 0.0',
      '1.0 1.0 0.0',
      '0.0 0.0 1.0',
      '1.0 0.0 1.0',
      '0.0 1.0 1.0',
      '0.9 0.8 0.7'
    ].join('\n')
    const lut = parseCubeLut(cubeText)
    expect(lut).not.toBeNull()
    expect(lut!.name).toBe('Warm Cinema 2')
    expect(lut!.size).toBe(2)
    expect(lut!.table).toHaveLength(24)

    // 顶点 (1,1,1) 应映射到 clamp255([0.9, 0.8, 0.7] * 255) = [230, 204, 179]
    const [r, g, b] = applyCubeLutRgb(255, 255, 255, lut!)
    expect(r).toBe(230)
    expect(g).toBe(204)
    expect(b).toBe(179)
  })

  it('runs the full 6-pass RGBA computational photography pipeline deterministically', () => {
    const width = 32
    const height = 32
    const src = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        // 模拟带高频微纹理的人像肤色 + 中心一颗暗斑瑕疵
        const isSpot = x === 16 && y === 16
        const pore = ((x + y) % 2) * 6 - 3
        src[idx] = isSpot ? 90 : 205 + pore
        src[idx + 1] = isSpot ? 60 : 165 + pore
        src[idx + 2] = isSpot ? 55 : 145 + pore
        src[idx + 3] = 255
      }
    }

    const state = {
      ...defaultPortraitRetouch(),
      skinSmoothing: 'strong' as const,
      skinTexture: 'standard' as const,
      skinWhiten: 'standard' as const,
      skinRosy: 'light' as const,
      sharpness: 'light' as const
    }

    const res = applyPortraitLivePixelPipeline(src, width, height, {
      state,
      landmarks: makeCanonical68Landmarks(),
      spotHeals: [{ id: 'spot-1', x: 16 / width, y: 16 / height, radius: 3 / width }]
    })

    expect(res.pixels).toHaveLength(src.length)
    expect(res.appliedSteps).toContain('spotHeal')
    expect(res.appliedSteps).toContain('frequencySeparationSkin')
    // 中心瑕疵点被周围健康肤色修复并提亮，R 通道显著高于原始暗斑 90
    const centerIdx = (16 * width + 16) * 4
    expect(res.pixels[centerIdx]!).toBeGreaterThan(170)
  })
})
