import { describe, expect, it } from 'vitest'
import {
  computePortraitGeometry,
  composeSheet,
  cropAndResize,
  gradientImage,
  renderPortrait
} from '../src/shared/media/portrait/pipeline'
import { createRng, type RgbaImage } from '../src/shared/media/portrait/kernels'
import {
  PORTRAIT_PARAM_SPECS,
  defaultPortraitRetouch,
  normalizePortraitRetouch
} from '../src/shared/graph/portraitRetouch'
import { canonicalFaceTemplate, type PortraitFaceAnalysis } from '../src/shared/graph/portraitFace'
import { polygonMask } from '../src/shared/media/portrait/mask'

/**
 * 人像精修流水线（src/shared/media/portrait/pipeline.ts）。
 *
 * 端到端锁四条不变量：
 * 1. **零参数必须逐像素等于输入**（否则「我只是打开看了一眼」就会改图）；
 * 2. 同一份参数 + 同一个种子必须可复现（Cook 两次结果不同是不可接受的）；
 * 3. 背景类工具真的改了背景、没碰主体；
 * 4. 证件照按规格出像素尺寸与拼版。
 */

/** 全部数值 0、枚举取「关闭」的状态：用于恒等与方向性测试 */
function zeroState() {
  return normalizePortraitRetouch({
    ...Object.fromEntries(
      PORTRAIT_PARAM_SPECS.map((spec) => [spec.key, spec.kind === 'number' ? 0 : spec.default])
    ),
    lutId: 'none',
    makeupPresetId: 'none',
    bgMode: 'keep',
    idPhotoSpecId: 'none',
    exportFormat: 'jpeg'
  })
}

function portraitImage(width: number, height: number): RgbaImage {
  // 中间一块肤色矩形 + 四周偏蓝背景，足够触发肤色蒙版与背景合成
  const data = new Uint8ClampedArray(width * height * 4)
  const rng = createRng(9)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const inFace = x > width * 0.25 && x < width * 0.75 && y > height * 0.15 && y < height * 0.75
      const noise = (rng() - 0.5) * 14
      data[i] = (inFace ? 215 : 40) + noise
      data[i + 1] = (inFace ? 175 : 70) + noise
      data[i + 2] = (inFace ? 155 : 190) + noise
      data[i + 3] = 255
    }
  }
  return { data, width, height }
}

function faceAnalysis(): PortraitFaceAnalysis {
  const landmarks = canonicalFaceTemplate().map(
    ([x, y]) => [0.5 + (x - 0.5) * 0.5, 0.42 + (y - 0.42) * 0.5] as [number, number]
  )
  return {
    schema: 'canonical68',
    landmarks,
    box: { x: 0.3, y: 0.1, w: 0.4, h: 0.6 },
    score: 0.98,
    modelId: 'test'
  }
}

function subjectMask(width: number, height: number): Uint8ClampedArray {
  return polygonMask(
    width,
    height,
    [
      [0.25, 0.1],
      [0.75, 0.1],
      [0.75, 0.9],
      [0.25, 0.9]
    ],
    0
  )
}

const pixel = (image: RgbaImage, x: number, y: number): [number, number, number] =>
  [
    image.data[(y * image.width + x) * 4],
    image.data[(y * image.width + x) * 4 + 1],
    image.data[(y * image.width + x) * 4 + 2]
  ] as [number, number, number]

describe('portrait pipeline', () => {
  it('零参数 + 无脸：逐像素等于输入（不允许无条件重采样）', async () => {
    const image = portraitImage(48, 64)
    const result = await renderPortrait({ image, state: zeroState() })
    expect(result.image.width).toBe(48)
    expect(result.image.height).toBe(64)
    expect(Array.from(result.image.data)).toEqual(Array.from(image.data))
    expect(result.sheet).toBeNull()
  })

  it('有脸 + 全参数：尺寸不变、画面确实被改动、阶段清单完整', async () => {
    const image = portraitImage(64, 80)
    const state = normalizePortraitRetouch({
      ...defaultPortraitRetouch(),
      faceSlim: 40,
      skinSmoothing: 55,
      skinWhiten: 30,
      teethWhiten: 40,
      makeupPresetId: 'portrait',
      makeupIntensity: 50,
      makeupLip: 60,
      lutId: 'clear',
      clarity: 20,
      sharpness: 30,
      grain: 20,
      vignette: 15,
      bgBlur: 40
    })
    const result = await renderPortrait({
      image,
      state,
      faces: faceAnalysis(),
      subjectMask: subjectMask(64, 80),
      seed: 5
    })
    expect(result.image.width).toBe(64)
    expect(result.image.height).toBe(80)
    expect(Array.from(result.image.data)).not.toEqual(Array.from(image.data))
    expect(result.landmarks).not.toBeNull()
    expect(result.stages.map((s) => s.stage)).toEqual([
      'geometry',
      'masks',
      'heal',
      'skin',
      'tone',
      'eyes',
      'teeth',
      'makeup',
      'light',
      'color',
      'texture',
      'background',
      'idPhoto'
    ])
    expect(result.stages.every((s) => s.ms >= 0)).toBe(true)
  })

  it('可复现：同参数同种子两次渲染逐像素一致，换种子则不同', async () => {
    const image = portraitImage(40, 40)
    const state = normalizePortraitRetouch({ ...zeroState(), grain: 60 })
    const a = await renderPortrait({ image, state, seed: 42 })
    const b = await renderPortrait({ image, state, seed: 42 })
    const c = await renderPortrait({ image, state, seed: 43 })
    expect(Array.from(a.image.data)).toEqual(Array.from(b.image.data))
    expect(Array.from(a.image.data)).not.toEqual(Array.from(c.image.data))
  })

  it('进度钩子按阶段回调并让出（渲染层据此写运行日志）', async () => {
    const image = portraitImage(24, 24)
    const stages: string[] = []
    let yields = 0
    await renderPortrait(
      { image, state: zeroState() },
      {
        onStage: ({ stage, index, total }) => {
          stages.push(stage)
          expect(index).toBe(stages.length)
          expect(total).toBe(13)
        },
        yield: async () => {
          yields += 1
        }
      }
    )
    expect(stages).toHaveLength(13)
    expect(yields).toBe(13)
  })

  it('换底色：背景被替换、主体中心保持原色', async () => {
    const image = portraitImage(60, 60)
    const state = normalizePortraitRetouch({ ...zeroState(), bgMode: 'color', bgColor: '#00ff00' })
    const result = await renderPortrait({
      image,
      state,
      subjectMask: subjectMask(60, 60)
    })
    const [r, g, b] = pixel(result.image, 1, 1)
    expect(g).toBeGreaterThan(200)
    expect(r).toBeLessThan(60)
    expect(b).toBeLessThan(60)
    // 主体中心仍是肤色（红通道显著高于绿）
    const [cr, cg] = pixel(result.image, 30, 30)
    expect(cr).toBeGreaterThan(cg)
  })

  it('背景虚化降低背景局部对比，主体保持清晰', async () => {
    // 用更大的画布，保证取样窗口离人脸边缘足够远（模糊半径内不会被脸污染）
    const image = portraitImage(100, 100)
    const state = normalizePortraitRetouch({
      ...zeroState(),
      bgBlur: 100,
      bgBlurRadius: 40
    })
    const blurred = await renderPortrait({ image, state, subjectMask: subjectMask(100, 100) })
    const variance = (img: RgbaImage, x0: number, y0: number, x1: number, y1: number): number => {
      const values: number[] = []
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) values.push(img.data[(y * img.width + x) * 4])
      }
      const mean = values.reduce((s, v) => s + v, 0) / values.length
      return values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
    }
    expect(variance(blurred.image, 0, 0, 10, 10)).toBeLessThan(variance(image, 0, 0, 10, 10))
  })

  it('证件照：按规格裁切到目标像素，拼版出整张相纸', async () => {
    const image = portraitImage(600, 900)
    const state = normalizePortraitRetouch({
      ...zeroState(),
      idPhotoSpecId: 'oneInch',
      idPhotoBg: 'blue',
      idPhotoSheet: true
    })
    const result = await renderPortrait({
      image,
      state,
      faces: faceAnalysis(),
      subjectMask: subjectMask(600, 900),
      idPhoto: { dpi: 300, paper: 'fiveInch', sheet: true }
    })
    expect(result.image.width).toBe(295)
    expect(result.image.height).toBe(413)
    expect(result.sheet).not.toBeNull()
    expect(result.sheet!.width).toBe(1051)
    expect(result.sheet!.height).toBe(1500)
  })

  it('几何：五官参数或液化笔画产生非恒等网格，无输入则恒等', () => {
    const identity = computePortraitGeometry({ state: zeroState(), aspect: 1 })
    expect(identity.controls).toHaveLength(0)
    expect(identity.landmarks).toBeNull()

    const shaped = computePortraitGeometry({
      state: normalizePortraitRetouch({ ...zeroState(), faceSlim: 60 }),
      faces: faceAnalysis(),
      aspect: 1
    })
    expect(shaped.controls.length).toBeGreaterThan(0)
    expect(shaped.landmarks).not.toBeNull()

    const liquified = computePortraitGeometry({
      state: zeroState(),
      strokes: [
        {
          id: 's1',
          tool: 'liquify',
          mode: 'push',
          size: 0.2,
          hardness: 60,
          strength: 80,
          points: [{ x: 0.5, y: 0.5, dx: 0.05, dy: 0.02 }]
        }
      ],
      aspect: 1
    })
    expect(liquified.controls.length).toBeGreaterThan(0)
  })
})

describe('portrait 合成工具', () => {
  it('cropAndResize 同尺寸裁切近似恒等', () => {
    const image = portraitImage(20, 20)
    const out = cropAndResize(image, { x: 0, y: 0, width: 20, height: 20 }, 20, 20)
    let maxDiff = 0
    for (let i = 0; i < out.data.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(out.data[i] - image.data[i]))
    }
    // 双线性采样在像素中心对齐时误差应很小
    expect(maxDiff).toBeLessThanOrEqual(2)
  })

  it('composeSheet 按行列铺满并居中', () => {
    const cell: RgbaImage = {
      data: new Uint8ClampedArray(10 * 10 * 4).fill(255),
      width: 10,
      height: 10
    }
    const sheet = composeSheet(
      cell,
      { cols: 2, rows: 2, gapPx: 0, width: 30, height: 30 },
      '#000000'
    )
    expect(sheet.width).toBe(30)
    expect(sheet.height).toBe(30)
    // 居中后左上角留 5px 白边填充区域
    expect(sheet.data[0]).toBe(0)
    const center = (15 * 30 + 15) * 4
    expect(sheet.data[center]).toBe(255)
    const cornerOfCell = (5 * 30 + 5) * 4
    expect(sheet.data[cornerOfCell]).toBe(255)
  })

  it('gradientImage 上下渐进', () => {
    const gradient = gradientImage(4, 4, '#000000', '#ffffff')
    expect(gradient.data[0]).toBeLessThan(20)
    const bottom = (3 * 4 + 0) * 4
    expect(gradient.data[bottom]).toBeGreaterThan(230)
  })
})
