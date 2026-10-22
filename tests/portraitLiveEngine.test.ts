import { describe, expect, it } from 'vitest'
import {
  PORTRAIT_CAMERA_STYLES,
  PORTRAIT_PRESETS,
  applyCameraStyleRgb,
  applyCubeLutRgb,
  applyPortraitLivePixelPipeline,
  applyPortraitPreset,
  buildCameraExifProfileMetadata,
  buildFaceLiquifyControlVectors,
  buildPortraitAiPrompt,
  buildPortraitPrompt,
  cameraExifPresetForStyle,
  defaultPortraitRetouch,
  extractFaceSemanticRegions,
  hasPortraitLiveAdjustments,
  parseCubeLut,
  pointInPolygon,
  polygonFeatherWeight,
  renderIdPhotoSingleRgba,
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

  it('extracts 68-point facial semantic regions and tests polygon containment & C1 feathering', () => {
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

    // 验证多边形 C1 平滑羽化权重：中心为 1，外部远处为 0，边界过渡带在 (0, 1) 之间连续单调
    const square: Array<[number, number]> = [
      [0.3, 0.3],
      [0.7, 0.3],
      [0.7, 0.7],
      [0.3, 0.7]
    ]
    expect(polygonFeatherWeight(0.5, 0.5, square, 0.05)).toBe(1)
    expect(polygonFeatherWeight(0.1, 0.1, square, 0.05)).toBe(0)
    const onEdge = polygonFeatherWeight(0.3, 0.5, square, 0.05)
    const slightIn = polygonFeatherWeight(0.32, 0.5, square, 0.05)
    const slightOut = polygonFeatherWeight(0.28, 0.5, square, 0.05)
    expect(onEdge).toBeCloseTo(0.5, 2)
    expect(slightIn).toBeGreaterThan(onEdge)
    expect(slightOut).toBeLessThan(onEdge)
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

  it('supports personMaskAlpha neural segmentation mask and edge defringe in renderIdPhotoSingleRgba', () => {
    const width = 32
    const height = 32
    const src = new Uint8ClampedArray(width * height * 4)
    const personMask = new Uint8ClampedArray(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4
        const inPerson = x >= 8 && x <= 24 && y >= 6
        // 原图背景为浅绿色摄影棚背景，人物中心为暖肤色
        src[idx] = inPerson ? 210 : 120
        src[idx + 1] = inPerson ? 170 : 200
        src[idx + 2] = inPerson ? 150 : 130
        src[idx + 3] = 255
        personMask[y * width + x] = inPerson ? 255 : 0
      }
    }
    const single = renderIdPhotoSingleRgba(
      src,
      width,
      height,
      {
        state: {
          ...defaultPortraitRetouch(),
          idPhotoSpecId: 'oneInch',
          idPhotoBg: 'blue'
        },
        landmarks: makeCanonical68Landmarks()
      },
      {
        dpi: 72,
        replaceBackdrop: true,
        personMaskAlpha: personMask
      }
    )
    expect(single).not.toBeNull()
    // 顶部背景角点应被替换为标准证件照蓝底 [67, 142, 219]
    expect(single!.pixels[0]).toBe(67)
    expect(single!.pixels[1]).toBe(142)
    expect(single!.pixels[2]).toBe(219)
  })

  it('supports mainstream camera styles (Canon, Nikon, Fujifilm, Leica, Sony, Kodak, Hasselblad, Ricoh) in prompt, live math & EXIF', () => {
    expect(PORTRAIT_CAMERA_STYLES).toEqual([
      'none',
      'canon',
      'nikon',
      'fujiClassicNeg',
      'fujiAstia',
      'leica',
      'leicaMonochrom',
      'sony',
      'kodakPortra',
      'hasselblad',
      'ricohGr'
    ])

    // 验证主流相机预设
    const canonPreset = applyPortraitPreset('canonRosy')
    expect(canonPreset.cameraStyle).toBe('canon')
    expect(applyPortraitPreset('nikonTrue').cameraStyle).toBe('nikon')
    expect(applyPortraitPreset('fujiFilm').cameraStyle).toBe('fujiClassicNeg')
    expect(applyPortraitPreset('leicaMaster').cameraStyle).toBe('leica')
    expect(applyPortraitPreset('sonyCinema').cameraStyle).toBe('sony')
    expect(applyPortraitPreset('kodakGold').cameraStyle).toBe('kodakPortra')
    expect(applyPortraitPreset('hasselbladStudio').cameraStyle).toBe('hasselblad')

    // 验证云端提示词生成与黑白相机负面词
    const leicaMonoPrompt = buildPortraitPrompt({
      state: { ...defaultPortraitRetouch(), cameraStyle: 'leicaMonochrom' },
      needs: { face: true, mask: true, pose: true },
      idPhoto: null
    })
    expect(leicaMonoPrompt.main).toContain('Leica M11 Monochrom')
    expect(leicaMonoPrompt.negative).toContain('残留彩色')

    // 验证皮肤区域与非皮肤区域的相机色彩科学映射
    const [canonR, canonG, canonB] = applyCameraStyleRgb(200, 160, 145, 'canon', 1.0)
    // 佳能白里透红肤色：R 和 B 均获得提升，且 R 增幅显著大于 G
    expect(canonR).toBeGreaterThan(208)
    expect(canonB).toBeGreaterThan(150)
    expect(canonR - canonG).toBeGreaterThan(40)

    // 富士 Classic Neg 暗部带青绿色调分离（非皮肤区 G/B 提升、R 压低）
    const [fujiR, fujiG, fujiB] = applyCameraStyleRgb(60, 60, 60, 'fujiClassicNeg', 0)
    expect(fujiG).toBeGreaterThan(fujiR)
    expect(fujiB).toBeGreaterThan(fujiR)

    // 徕卡黑白银盐输出严格等值灰度
    const [monoR, monoG, monoB] = applyCameraStyleRgb(190, 145, 130, 'leicaMonochrom', 0.9)
    expect(monoR).toBe(monoG)
    expect(monoG).toBe(monoB)

    // 验证实时管线检测与执行
    expect(
      hasPortraitLiveAdjustments({
        state: { ...defaultPortraitRetouch(), cameraStyle: 'sony' }
      })
    ).toBe(true)

    const buf = new Uint8ClampedArray([200, 160, 145, 255])
    const res = applyPortraitLivePixelPipeline(buf, 1, 1, {
      state: { ...defaultPortraitRetouch(), cameraStyle: 'canon' }
    })
    expect(res.appliedSteps).toContain('cameraStyle')
    expect(res.pixels[0]).toBeGreaterThan(205)

    // 验证相机风格与 EXIF 真机元数据自动映射
    expect(cameraExifPresetForStyle('canon')).toBe('canon-eos-r5')
    expect(cameraExifPresetForStyle('nikon')).toBe('nikon-z9')
    expect(cameraExifPresetForStyle('fujiClassicNeg')).toBe('fuji-gfx100')
    expect(cameraExifPresetForStyle('leica')).toBe('leica-m11-noctilux')
    expect(cameraExifPresetForStyle('sony')).toBe('sony-a7rv-gm')
    expect(cameraExifPresetForStyle('kodakPortra')).toBe('kodak-portra400')
    expect(cameraExifPresetForStyle('ricohGr')).toBe('ricoh-gr3x')
    expect(cameraExifPresetForStyle('hasselblad')).toBe('hasselblad-x2d')
    expect(buildCameraExifProfileMetadata('canon-eos-r5').make).toBe('Canon')
    expect(buildCameraExifProfileMetadata('nikon-z9').model).toBe('NIKON Z 9')

    // 回归验证：开启胶片颗粒（grain）与毛孔纹理（skinTexture）时，平铺色块绝不出现 45° 斜向条纹伪影
    const w = 32
    const h = 32
    const flat = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < flat.length; i += 4) {
      flat[i] = 190
      flat[i + 1] = 165
      flat[i + 2] = 140
      flat[i + 3] = 255
    }
    const grained = applyPortraitLivePixelPipeline(flat, w, h, {
      state: { ...defaultPortraitRetouch(), cameraStyle: 'kodakPortra', grain: 'standard' }
    })
    // 检查沿 45° 对角线 (x + y = const) 的像素不应全相等（旧 Math.sin 括号 bug 会导致 x+y 方向呈近似恒定条纹）
    const diagValues = new Set<number>()
    for (let k = 2; k < 20; k++) {
      const idx = (k * w + (22 - k)) * 4
      diagValues.add(grained.pixels[idx]!)
    }
    expect(diagValues.size).toBeGreaterThan(5)
  })
})
