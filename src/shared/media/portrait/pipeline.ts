/**
 * 人像精修流水线：把 `PortraitRetouchState` + 人脸关键点 + 笔刷笔画渲染成一张图。
 *
 * 顺序很重要（每一步都依赖前一步的结果）：
 *   1 几何（液化 / 五官 / 身形）→ 关键点跟着变形，后续蒙版才对得上
 *   2 蒙版（肤色 / 五官区域 / 主体）
 *   3 修复 → 4 磨皮 → 5 肤色 → 6 眼睛 → 7 牙齿 → 8 妆容
 *   9 光影 → 10 调色 → 11 质感（全图）
 *  12 背景（虚化 / 换底）
 *  13 证件照（裁切 + 底色 + 可选拼版）
 *
 * 性能口径：所有滤波器都是 O(1)/像素，阶段之间可 `yield` 让出事件循环，
 * 渲染层因此能在 Cook 时逐阶段写进度而不冻界面。
 */

import type { PortraitBrushStroke, PortraitRetouchState } from '../../graph/portraitRetouch'
import type { PortraitFaceAnalysis, PortraitPoseKeypoint } from '../../graph/portraitFace'
import {
  buildBodyWarpControls,
  buildFaceWarpControls,
  portraitFaceMetrics,
  portraitRegionFeather,
  portraitRegionPolygon,
  type PortraitFaceRegion
} from '../../graph/portraitFace'
import {
  computeIdPhotoSheet,
  idPhotoBackgroundColors,
  idPhotoPixelSize,
  idPhotoSpecById,
  computeIdPhotoCrop,
  type IdPhotoPaperId
} from '../../graph/idPhoto'
import * as K from './kernels'
import type { RgbaImage } from './kernels'
import * as M from './mask'
import {
  buildWarpMesh,
  liquifyControlsFromStrokes,
  warpImage,
  warpPoints,
  WARP_MESH_COLS,
  WARP_MESH_ROWS,
  type WarpControl,
  type WarpMesh
} from './warp'

export interface PortraitGeometry {
  controls: WarpControl[]
  mesh: WarpMesh
  /** 变形后的关键点（编辑器叠加层与后续蒙版都用它） */
  landmarks: Array<[number, number]> | null
  pose: PortraitPoseKeypoint[] | null
}

export interface PortraitGeometryInput {
  state: PortraitRetouchState
  faces?: PortraitFaceAnalysis | null
  pose?: readonly PortraitPoseKeypoint[] | null
  strokes?: readonly PortraitBrushStroke[]
  /** 图像高宽比（h/w），用于让笔刷半径在像素空间是圆的 */
  aspect?: number
}

/**
 * 计算几何：五官参数 + 身形参数 + 液化笔画 → 位移网格，并把关键点一起推过去。
 * 编辑器画网格/关键点叠加层与执行器烘焙共用这一份，保证所见即所得。
 */
export function computePortraitGeometry(input: PortraitGeometryInput): PortraitGeometry {
  const aspect = input.aspect && input.aspect > 0 ? input.aspect : 1
  const numeric = input.state as unknown as Record<string, number>
  const controls: WarpControl[] = []
  const landmarks = input.faces?.landmarks ?? null

  if (landmarks) {
    controls.push(...buildFaceWarpControls(numeric, landmarks))
    // 瞳孔大小：没有瞳孔关键点，用眼中心 + 小半径径向缩放近似
    const pupil = numeric.pupilSize ?? 0
    if (Math.abs(pupil) > 0.5) {
      for (const group of [
        [36, 37, 38, 39, 40, 41],
        [42, 43, 44, 45, 46, 47]
      ]) {
        let cx = 0
        let cy = 0
        for (const i of group) {
          cx += landmarks[i][0]
          cy += landmarks[i][1]
        }
        cx /= group.length
        cy /= group.length
        controls.push({
          x: cx,
          y: cy,
          dx: 0,
          dy: 0,
          radius: Math.max(0.01, portraitFaceMetrics(landmarks).eyeDistance * 0.28),
          radial: (pupil / 100) * 0.02
        })
      }
    }
  }

  if (input.pose && input.pose.length >= 17) {
    controls.push(...buildBodyWarpControls(numeric, input.pose as PortraitPoseKeypoint[]))
  }

  const liquify = (input.strokes ?? []).filter((s) => s.tool === 'liquify')
  if (liquify.length) controls.push(...liquifyControlsFromStrokes(liquify))

  const mesh = buildWarpMesh(controls, WARP_MESH_COLS, WARP_MESH_ROWS, aspect)
  return {
    controls,
    mesh,
    landmarks: landmarks ? warpPoints(landmarks, mesh) : null,
    pose: input.pose
      ? (warpPoints(input.pose as Array<[number, number]>, mesh) as PortraitPoseKeypoint[])
      : null
  }
}

// ── 妆容调色板 ─────────────────────────────────────────────────

interface MakeupPalette {
  brow: string
  eyeShadow: string
  eyeliner: string
  lash: string
  blush: string
  lip: string
  contour: string
  highlight: string
}

/** 妆面预设色板（hex）；`makeupHue` 会整体旋转色相 */
export const MAKEUP_PALETTES: Readonly<Record<string, MakeupPalette>> = {
  nude: {
    brow: '#6b5344',
    eyeShadow: '#c9a68a',
    eyeliner: '#3b2f2a',
    lash: '#2b2320',
    blush: '#e8a89a',
    lip: '#c9736c',
    contour: '#b08a72',
    highlight: '#f6ead9'
  },
  portrait: {
    brow: '#5c4636',
    eyeShadow: '#b98e79',
    eyeliner: '#332a26',
    lash: '#241d1a',
    blush: '#e39a8c',
    lip: '#b95f5c',
    contour: '#a67c63',
    highlight: '#f8efdf'
  },
  bride: {
    brow: '#584233',
    eyeShadow: '#c79b86',
    eyeliner: '#2f2724',
    lash: '#221b19',
    blush: '#ea9c93',
    lip: '#c04f55',
    contour: '#a8785f',
    highlight: '#fdf3e4'
  },
  child: {
    brow: '#7a6048',
    eyeShadow: '#dcb8a2',
    eyeliner: '#4a3a33',
    lash: '#3a2e29',
    blush: '#f0a89b',
    lip: '#d97f7a',
    contour: '#c39a80',
    highlight: '#fdf2e6'
  },
  hongkong: {
    brow: '#4a3628',
    eyeShadow: '#a5714f',
    eyeliner: '#241c18',
    lash: '#1b1512',
    blush: '#c67f6d',
    lip: '#9e3f3f',
    contour: '#8f6448',
    highlight: '#f3e2c8'
  },
  office: {
    brow: '#5f4a3a',
    eyeShadow: '#c4a189',
    eyeliner: '#362c28',
    lash: '#282120',
    blush: '#e0a094',
    lip: '#b3605f',
    contour: '#ab8067',
    highlight: '#f7ecdc'
  },
  stage: {
    brow: '#4d3729',
    eyeShadow: '#b07a52',
    eyeliner: '#1f1815',
    lash: '#161110',
    blush: '#cf7f6b',
    lip: '#8f3336',
    contour: '#8a5c40',
    highlight: '#f7e6c6'
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  return [
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255
  ]
}

function rgbToHex(rgb: [number, number, number]): string {
  const to = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, '0')
  return `#${to(rgb[0])}${to(rgb[1])}${to(rgb[2])}`
}

function rgbToHsl(rgb: [number, number, number]): [number, number, number] {
  const [r, g, b] = rgb
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  let h = 0
  if (max === r) h = 60 * (((g - b) / d) % 6)
  else if (max === g) h = 60 * ((b - r) / d + 2)
  else h = 60 * ((r - g) / d + 4)
  return [(h + 360) % 360, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let rgb: [number, number, number]
  if (h < 60) rgb = [c, x, 0]
  else if (h < 120) rgb = [x, c, 0]
  else if (h < 180) rgb = [0, c, x]
  else if (h < 240) rgb = [0, x, c]
  else if (h < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return [rgb[0] + m, rgb[1] + m, rgb[2] + m]
}

/** 按 hue 偏移与饱和度缩放改造色板 */
function shiftColor(hex: string, hueShift: number, satScale: number): [number, number, number] {
  const [h, s, l] = rgbToHsl(hexToRgb(hex))
  return hslToRgb((h + hueShift * 60 + 360) % 360, Math.min(1, Math.max(0, s * satScale)), l)
}

// ── 渲染 ───────────────────────────────────────────────────────

export interface PortraitRenderInput {
  image: RgbaImage
  state: PortraitRetouchState
  faces?: PortraitFaceAnalysis | null
  pose?: readonly PortraitPoseKeypoint[] | null
  /** 主体（人）蒙版：0..255，人像为 255；缺省则背景类工具跳过 */
  subjectMask?: Uint8ClampedArray | null
  strokes?: readonly PortraitBrushStroke[]
  /** 颗粒种子：同一份参数重复渲染必须得到同一张图 */
  seed?: number
  idPhoto?: { dpi?: number; paper?: IdPhotoPaperId; sheet?: boolean } | null
}

export interface PortraitStageReport {
  stage: string
  ms: number
}

export interface PortraitRenderResult {
  image: RgbaImage
  /** 拼版相纸（未开启拼版为 null） */
  sheet: RgbaImage | null
  stages: PortraitStageReport[]
  /** 变形后的关键点，供调用方记录 / 叠加 */
  landmarks: Array<[number, number]> | null
}

export interface PortraitPipelineHooks {
  /** 每个阶段开始前回调（渲染层据此写运行日志 / 进度） */
  onStage?: (info: { stage: string; index: number; total: number }) => void
  /** 阶段之间的让出点（渲染层传 `() => new Promise(r => setTimeout(r))`） */
  yield?: () => Promise<void>
}

const STAGES = [
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
] as const

export async function renderPortrait(
  input: PortraitRenderInput,
  hooks?: PortraitPipelineHooks
): Promise<PortraitRenderResult> {
  const stages: PortraitStageReport[] = []
  const state = input.state
  const hooksYield = hooks?.yield
  let index = 0

  const begin = async (stage: (typeof STAGES)[number]): Promise<number> => {
    index += 1
    hooks?.onStage?.({ stage, index, total: STAGES.length })
    if (hooksYield) await hooksYield()
    return Date.now()
  }
  const end = (stage: string, started: number): void => {
    stages.push({ stage, ms: Math.max(0, Date.now() - started) })
  }

  let image = input.image
  const width = image.width
  const height = image.height
  const aspect = height / Math.max(1, width)

  // ── 1 几何 ────────────────────────────────────────────────
  let t = await begin('geometry')
  const geometry = computePortraitGeometry({
    state,
    faces: input.faces,
    pose: input.pose,
    strokes: input.strokes,
    aspect
  })
  image = warpImage(image, geometry.mesh)
  const landmarks = geometry.landmarks
  end('geometry', t)

  // ── 2 蒙版 ────────────────────────────────────────────────
  t = await begin('masks')
  const skinMask = M.buildSkinMask(image)
  const region = (name: PortraitFaceRegion): Uint8ClampedArray | null =>
    landmarks
      ? M.polygonMask(
          width,
          height,
          portraitRegionPolygon(name, landmarks),
          portraitRegionFeather(name)
        )
      : null
  const faceMask = region('faceOval')
  const foreheadMask = region('forehead')
  const eyeMaskL = region('leftEye')
  const eyeMaskR = region('rightEye')
  const browMaskL = region('leftBrow')
  const browMaskR = region('rightBrow')
  const noseMask = region('nose')
  const lipMask = region('outerLip')
  const teethMask = region('teeth')
  const cheekMaskL = region('leftCheek')
  const cheekMaskR = region('rightCheek')
  const jawMask = region('jaw')
  const bgMask = input.subjectMask
    ? M.backgroundMaskFromSubject(
        input.subjectMask,
        width,
        height,
        0.004 + (state.bgEdgeFeather / 100) * 0.03
      )
    : null
  end('masks', t)

  const skinStrength = skinMask
  const faceStrength = faceMask ?? skinStrength

  // ── 3 修复 ────────────────────────────────────────────────
  t = await begin('heal')
  if (state.blemishRemoval > 0) {
    image = K.healBlemishes(image, skinMask, state.blemishRemoval / 100, 2)
  }
  if (state.skinDenoise > 0) image = K.denoiseImage(image, state.skinDenoise / 100)
  const healStrokes = (input.strokes ?? []).filter((s) => s.tool === 'heal')
  if (healStrokes.length) {
    const brush = M.strokeMask(width, height, healStrokes)
    image = blendLocalHeal(image, brush, 0.8)
  }
  const smoothStrokes = (input.strokes ?? []).filter((s) => s.tool === 'smooth')
  if (smoothStrokes.length) {
    const brush = M.strokeMask(width, height, smoothStrokes)
    const smoothed = K.frequencySeparationSkin(image, {
      radius: 6,
      strength: 0.6,
      poreRetain: state.skinPore,
      mask: brush
    })
    image = smoothed
  }
  if (state.darkCircle > 0 && eyeMaskL && eyeMaskR) {
    const under = M.unionMask(
      M.blurMask(eyeMaskL, width, height, 6),
      M.blurMask(eyeMaskR, width, height, 6)
    )
    image = K.applyRegionTint(image, under, { brighten: 26 * (state.darkCircle / 100) }, 0.7)
  }
  if (state.eyeBag > 0 && eyeMaskL && eyeMaskR) {
    const under = M.unionMask(
      M.blurMask(eyeMaskL, width, height, 10),
      M.blurMask(eyeMaskR, width, height, 10)
    )
    image = K.frequencySeparationSkin(image, {
      radius: 5,
      strength: (state.eyeBag / 100) * 0.7,
      poreRetain: 40,
      mask: under
    })
  }
  if (state.nasolabial > 0 && landmarks) {
    for (const [a, b, c] of [
      [31, 3, 48],
      [35, 13, 54]
    ] as const) {
      const mask = M.polygonMask(
        width,
        height,
        [landmarks[a], landmarks[b], landmarks[c], landmarks[a]],
        0.5
      )
      image = K.applyRegionTint(image, mask, { brighten: 22 * (state.nasolabial / 100) }, 0.6)
    }
  }
  if (state.foreheadLines > 0 && foreheadMask) {
    image = K.frequencySeparationSkin(image, {
      radius: 4,
      strength: (state.foreheadLines / 100) * 0.6,
      poreRetain: 45,
      mask: foreheadMask
    })
  }
  if (state.neckLines > 0 && jawMask) {
    const neck = M.blurMask(jawMask, width, height, Math.round(height * 0.06))
    image = K.frequencySeparationSkin(image, {
      radius: 5,
      strength: (state.neckLines / 100) * 0.55,
      poreRetain: 45,
      mask: neck
    })
  }
  if (state.shineRemoval > 0) image = K.removeShine(image, faceStrength, state.shineRemoval / 100)
  if (state.strayHair > 0 && faceMask) {
    image = removeStrayHair(image, faceMask, state.strayHair / 100)
  }
  if (state.redEye > 0 && eyeMaskL && eyeMaskR) {
    image = desaturateRedEye(image, M.unionMask(eyeMaskL, eyeMaskR), state.redEye / 100)
  }
  end('heal', t)

  // ── 4 磨皮 ────────────────────────────────────────────────
  t = await begin('skin')
  if (state.skinSmoothing > 0) {
    image = K.frequencySeparationSkin(image, {
      radius: 2 + (state.skinSmoothing / 100) * 8,
      strength: (state.skinSmoothing / 100) * 0.95,
      poreRetain: state.skinPore,
      mask: skinMask
    })
  }
  if (state.skinEvenness > 0) {
    image = K.frequencySeparationSkin(image, {
      radius: 14,
      strength: (state.skinEvenness / 100) * 0.5,
      poreRetain: 70,
      mask: skinMask
    })
  }
  end('skin', t)

  // ── 5 肤色 ────────────────────────────────────────────────
  t = await begin('tone')
  {
    const whiten = (state.skinWhiten / 100) * 0.5
    const rosy = (state.skinRosy / 100) * 0.35
    const tone = state.skinTone / 100
    const deYellow = (state.skinDeYellow / 100) * 0.3
    if (whiten || rosy || tone || deYellow) {
      const warm: [number, number, number] = [
        1 + tone * 0.08 + rosy * 0.15,
        1 - deYellow * 0.06 + rosy * 0.02,
        1 - tone * 0.08 + rosy * 0.04 - deYellow * 0.08
      ]
      const tint: [number, number, number] = [
        Math.min(1, Math.max(0, warm[0])),
        Math.min(1, Math.max(0, warm[1])),
        Math.min(1, Math.max(0, warm[2]))
      ]
      image = K.applyRegionTint(
        image,
        skinMask,
        { whiten, brighten: (state.skinWhiten / 100) * 14, tint },
        0.85
      )
    }
  }
  end('tone', t)

  // ── 6 眼睛 ────────────────────────────────────────────────
  t = await begin('eyes')
  if (landmarks) {
    for (const [eyeMask, group] of [
      [eyeMaskL, [36, 37, 38, 39, 40, 41]],
      [eyeMaskR, [42, 43, 44, 45, 46, 47]]
    ] as const) {
      if (!eyeMask) continue
      if (state.eyeWhiten > 0) {
        const weighted = weightMaskByLuminance(image, eyeMask, 95, 175)
        image = K.applyRegionTint(
          image,
          weighted,
          { whiten: 0.35 * (state.eyeWhiten / 100), brighten: 10 * (state.eyeWhiten / 100) },
          0.8
        )
      }
      if (state.catchlight > 0) {
        const idx = group as readonly number[]
        let cx = 0
        let cy = 0
        for (const i of idx) {
          cx += landmarks[i][0]
          cy += landmarks[i][1]
        }
        cx /= idx.length
        cy /= idx.length
        const r = 0.012 * (1 + state.catchlight / 150)
        const dot = M.polygonMask(
          width,
          height,
          [
            [cx - r, cy - r * 1.2],
            [cx + r, cy - r * 1.2],
            [cx + r, cy + r * 0.4],
            [cx - r, cy + r * 0.4]
          ],
          0.9
        )
        image = K.applyRegionTint(image, dot, { brighten: 70 * (state.catchlight / 100) }, 0.85)
      }
      if (state.eyeShadow > 0) {
        const shadow = M.blurMask(eyeMask, width, height, 3)
        image = K.applyRegionTint(image, shadow, { brighten: -18 * (state.eyeShadow / 100) }, 0.7)
      }
    }
  }
  end('eyes', t)

  // ── 7 牙齿 ────────────────────────────────────────────────
  t = await begin('teeth')
  if (teethMask && (state.teethWhiten > 0 || state.teethBrighten > 0)) {
    const weighted = weightMaskByLuminance(image, teethMask, 70, 150)
    image = K.applyRegionTint(
      image,
      weighted,
      {
        whiten: 0.5 * (state.teethWhiten / 100),
        brighten: 16 * (state.teethBrighten / 100)
      },
      0.85
    )
  }
  if (lipMask && state.lipColorRepair > 0) {
    image = K.applyRegionTint(
      image,
      lipMask,
      { saturate: 0.25 * (state.lipColorRepair / 100), brighten: 6 * (state.lipColorRepair / 100) },
      0.7
    )
  }
  end('teeth', t)

  // ── 8 妆容 ────────────────────────────────────────────────
  t = await begin('makeup')
  if (landmarks && state.makeupPresetId !== 'none' && state.makeupIntensity > 0) {
    const palette = MAKEUP_PALETTES[state.makeupPresetId] ?? MAKEUP_PALETTES.nude
    const base = state.makeupIntensity / 100
    const hueShift = state.makeupHue / 100
    const satScale = 0.6 + (state.makeupSaturation / 100) * 1.2
    const apply = (
      mask: Uint8ClampedArray | null,
      color: string,
      strength: number,
      mode: 'tint' | 'darken' | 'brighten' = 'tint'
    ): void => {
      if (!mask || strength <= 0.001) return
      const rgb = shiftColor(color, hueShift, satScale)
      const amount = Math.min(1, base * strength)
      if (mode === 'tint') {
        image = K.applyRegionTint(image, mask, { tint: rgb, saturate: 0.1 }, amount)
      } else if (mode === 'darken') {
        image = K.applyRegionTint(image, mask, { brighten: -30 * amount }, amount)
      } else {
        image = K.applyRegionTint(image, mask, { brighten: 34 * amount }, amount)
      }
    }
    apply(browMaskL, palette.brow, state.makeupBrow, 'darken')
    apply(browMaskR, palette.brow, state.makeupBrow, 'darken')
    if (eyeMaskL && eyeMaskR) {
      const lidL = M.blurMask(eyeMaskL, width, height, 4)
      const lidR = M.blurMask(eyeMaskR, width, height, 4)
      apply(lidL, palette.eyeShadow, state.makeupEyeShadow)
      apply(lidR, palette.eyeShadow, state.makeupEyeShadow)
      apply(eyeMaskL, palette.eyeliner, state.makeupEyeliner, 'darken')
      apply(eyeMaskR, palette.eyeliner, state.makeupEyeliner, 'darken')
      apply(eyeMaskL, palette.lash, state.makeupLash * 0.8, 'darken')
      apply(eyeMaskR, palette.lash, state.makeupLash * 0.8, 'darken')
    }
    const blushL = cheekMaskL ? M.blurMask(cheekMaskL, width, height, 8) : null
    const blushR = cheekMaskR ? M.blurMask(cheekMaskR, width, height, 8) : null
    apply(blushL, palette.blush, state.makeupBlush)
    apply(blushR, palette.blush, state.makeupBlush)
    apply(lipMask, palette.lip, state.makeupLip)
    if (faceMask) {
      const inner = M.blurMask(faceMask, width, height, Math.round(width * 0.06))
      apply(inner, palette.contour, state.makeupContour * 0.6)
      const tzone = M.unionMask(
        foreheadMask ?? inner,
        M.unionMask(noseMask ?? inner, teethMask ? M.blurMask(teethMask, width, height, 6) : inner)
      )
      apply(tzone, palette.highlight, state.makeupHighlight, 'brighten')
    }
  }
  end('makeup', t)

  // ── 9 光影 ────────────────────────────────────────────────
  t = await begin('light')
  if (state.fillLight > 0 && faceMask) {
    const shadowWeight = weightMaskByLuminance(image, faceMask, 40, 130, true)
    image = K.applyRegionTint(image, shadowWeight, { brighten: 30 * (state.fillLight / 100) }, 0.8)
  }
  if (state.rimLight > 0 && input.subjectMask) {
    const band = edgeBand(input.subjectMask, width, height)
    image = K.applyRegionTint(image, band, { brighten: 40 * (state.rimLight / 100) }, 0.75)
  }
  if (state.highlightRepair > 0) {
    image = K.removeShine(image, null, state.highlightRepair / 100)
  }
  if (state.faceContour > 0 && faceMask) {
    const center = M.polygonMask(
      width,
      height,
      landmarks
        ? [
            landmarks[1],
            landmarks[4],
            landmarks[8],
            landmarks[12],
            landmarks[15],
            landmarks[27],
            landmarks[30]
          ]
        : [],
      0.6
    )
    const perimeter = M.subtractMask(faceMask, center)
    const amount = state.faceContour / 100
    image = K.applyRegionTint(image, center, { brighten: 16 * amount }, 0.7)
    image = K.applyRegionTint(image, perimeter, { brighten: -18 * amount }, 0.6)
  }
  if (state.lightRatio > 0 && faceMask) {
    const weighted = weightMaskByLuminance(image, faceMask, 60, 190, true)
    image = K.applyRegionTint(image, weighted, { brighten: -14 * (state.lightRatio / 100) }, 0.6)
  }
  if (state.lightTemp !== 0 && faceMask) {
    const warm = state.lightTemp / 100
    image = K.applyRegionTint(
      image,
      faceMask,
      { tint: [Math.min(1, 1 + warm * 0.1), 1, Math.max(0, 1 - warm * 0.1)] },
      Math.abs(warm) * 0.5
    )
  }
  end('light', t)

  // ── 10 调色 ───────────────────────────────────────────────
  t = await begin('color')
  if (state.lutId !== 'none') image = K.applyLut(image, state.lutId)
  const colorParams: K.PortraitColorAdjust = {
    exposure: state.exposure,
    contrast: state.contrast,
    highlights: state.highlights,
    shadows: state.shadows + state.shadowLift * 0.5,
    whites: state.whites,
    blacks: state.blacks,
    colorTemp: state.colorTemp,
    tint: state.tint,
    vibrance: state.vibrance,
    saturation: state.saturation,
    hslHue: state.hslHue,
    hslSat: state.hslSat,
    hslLum: state.hslLum
  }
  if (Object.values(colorParams).some((v) => v !== 0)) {
    image = K.applyColorAdjust(image, colorParams)
  }
  end('color', t)

  // ── 11 质感 ───────────────────────────────────────────────
  t = await begin('texture')
  if (state.clarity > 0) image = K.localContrast(image, 8, (state.clarity / 100) * 1.1)
  if (state.sharpness > 0) image = K.unsharpMask(image, 1.5, (state.sharpness / 100) * 1.2)
  if (state.softFocus > 0) image = K.softFocus(image, state.softFocus / 100)
  if (state.grain > 0) image = K.addGrain(image, state.grain / 100, input.seed ?? 1)
  if (state.vignette > 0) image = K.applyVignette(image, state.vignette / 100)
  end('texture', t)

  // ── 12 背景 ───────────────────────────────────────────────
  t = await begin('background')
  const idSpec = idPhotoSpecById(state.idPhotoSpecId)
  const wantIdPhotoBg = !!idSpec && state.idPhotoBg && state.idPhotoBg !== 'white'
  if (input.subjectMask && (state.bgBlur > 0 || state.bgMode !== 'keep' || idSpec)) {
    const mask = bgMask ?? M.backgroundMaskFromSubject(input.subjectMask, width, height, 0.01)
    if (state.bgBlur > 0) {
      const blurred = K.gaussianLikeBlur(image, 3 + (state.bgBlurRadius / 100) * 40)
      image = K.blendWithMask(image, blurred, M.scaleMask(mask, state.bgBlur / 100))
    }
    const solidFill = state.bgMode !== 'keep' || idSpec
    if (solidFill) {
      const colors = idSpec
        ? idPhotoBackgroundColors(state.idPhotoBg)
        : { from: state.bgColor, to: state.bgMode === 'gradient' ? state.bgColorTo : state.bgColor }
      const fill = gradientImage(width, height, colors.from, colors.to)
      image = K.blendWithMask(image, fill, mask)
      if (state.bgEdgeDecontaminate > 0) {
        image = decontaminateEdge(image, mask, fill, width, height, state.bgEdgeDecontaminate / 100)
      }
    } else if (wantIdPhotoBg) {
      const colors = idPhotoBackgroundColors(state.idPhotoBg)
      const fill = gradientImage(width, height, colors.from, colors.to)
      image = K.blendWithMask(image, fill, mask)
    }
  }
  end('background', t)

  // ── 13 证件照 ─────────────────────────────────────────────
  t = await begin('idPhoto')
  let sheet: RgbaImage | null = null
  if (idSpec && input.faces) {
    const analysis: PortraitFaceAnalysis = {
      ...input.faces,
      landmarks: landmarks ?? input.faces.landmarks
    }
    const crop = computeIdPhotoCrop({
      analysis,
      spec: idSpec,
      imageWidth: width,
      imageHeight: height
    })
    const target = idPhotoPixelSize(idSpec, input.idPhoto?.dpi ?? 300)
    const cropped = cropAndResize(image, crop, target.width, target.height)
    if (input.idPhoto?.sheet) {
      const layout = computeIdPhotoSheet({
        spec: idSpec,
        dpi: input.idPhoto?.dpi ?? 300,
        paper: input.idPhoto?.paper ?? 'fiveInch'
      })
      sheet = composeSheet(cropped, layout, '#ffffff')
    }
    image = cropped
  }
  end('idPhoto', t)

  return { image, sheet, stages, landmarks }
}

// ── 局部算子 ───────────────────────────────────────────────────

/** 笔刷修复：用较大半径的模糊填补笔刷区域，并把高频质感按比例加回，避免「糊块」 */
export function blendLocalHeal(
  image: RgbaImage,
  mask: Uint8ClampedArray,
  amount: number
): RgbaImage {
  const low = K.gaussianLikeBlur(image, 6)
  const high = K.gaussianLikeBlur(image, 1)
  const out = new Uint8ClampedArray(image.data)
  const a = Math.min(1, Math.max(0, amount))
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    const w = (mask[p] / 255) * a
    if (w <= 0.001) continue
    for (let c = 0; c < 3; c++) {
      const base = image.data[i + c]
      const texture = base - high.data[i + c]
      const target = low.data[i + c] + texture * 0.45
      out[i + c] = K.clamp255(base + (target - base) * w)
    }
  }
  return { data: out, width: image.width, height: image.height }
}

/** 按亮度加权蒙版：用于「只美白牙齿/眼白，不动牙龈与瞳孔」 */
export function weightMaskByLuminance(
  image: RgbaImage,
  mask: Uint8ClampedArray,
  low: number,
  high: number,
  invert = false
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(mask.length)
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    if (mask[p] === 0) continue
    const lum = 0.299 * image.data[i] + 0.587 * image.data[i + 1] + 0.114 * image.data[i + 2]
    let t = (lum - low) / Math.max(1, high - low)
    t = t < 0 ? 0 : t > 1 ? 1 : t
    if (invert) t = 1 - t
    out[p] = mask[p] * t
  }
  return out
}

/** 主体边缘环带（内缩 + 外扩之差）：轮廓光用 */
export function edgeBand(
  subject: Uint8ClampedArray,
  width: number,
  height: number
): Uint8ClampedArray {
  const radius = Math.max(1, Math.round(Math.min(width, height) * 0.012))
  const inner = M.erodeMask(subject, width, height, radius)
  const outer = M.dilateMask(subject, width, height, radius)
  return M.subtractMask(outer, inner)
}

/** 去红眼：红通道显著高于绿蓝时压掉红色 */
export function desaturateRedEye(
  image: RgbaImage,
  mask: Uint8ClampedArray,
  strength: number
): RgbaImage {
  const out = new Uint8ClampedArray(image.data)
  const a = Math.min(1, Math.max(0, strength))
  for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
    if (mask[p] < 40) continue
    const r = image.data[i]
    const g = image.data[i + 1]
    const b = image.data[i + 2]
    if (r > g * 1.4 && r > b * 1.4 && r > 60) {
      const target = (g + b) / 2
      const w = a * (mask[p] / 255)
      out[i] = K.clamp255(r + (target - r) * w)
    }
  }
  return { data: out, width: image.width, height: image.height }
}

/** 去碎发：脸轮廓外、比邻域显著暗的细结构做局部平滑（近似「碎发压掉」） */
export function removeStrayHair(
  image: RgbaImage,
  faceMask: Uint8ClampedArray,
  strength: number
): RgbaImage {
  const { width, height } = image
  const ring = (() => {
    const outer = M.dilateMask(faceMask, width, height, Math.max(2, Math.round(width * 0.05)))
    return M.subtractMask(outer, M.erodeMask(faceMask, width, height, 2))
  })()
  const smooth = K.gaussianLikeBlur(image, 3)
  const out = new Uint8ClampedArray(image.data)
  const a = Math.min(1, Math.max(0, strength))
  for (let p = 0, i = 0; p < ring.length; p++, i += 4) {
    if (ring[p] < 30) continue
    const lum = 0.299 * image.data[i] + 0.587 * image.data[i + 1] + 0.114 * image.data[i + 2]
    const smoothLum =
      0.299 * smooth.data[i] + 0.587 * smooth.data[i + 1] + 0.114 * smooth.data[i + 2]
    const darker = smoothLum - lum
    if (darker < 12) continue
    const w = a * Math.min(1, darker / 40) * (ring[p] / 255)
    for (let c = 0; c < 3; c++) {
      out[i + c] = K.clamp255(image.data[i + c] + (smooth.data[i + c] - image.data[i + c]) * w)
    }
  }
  return { data: out, width, height }
}

/** 线性渐变图（背景纯色 / 渐变都走这里） */
export function gradientImage(width: number, height: number, from: string, to: string): RgbaImage {
  const a = hexToRgb(from)
  const b = hexToRgb(to)
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const t = height <= 1 ? 0 : y / (height - 1)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      data[i] = (a[0] + (b[0] - a[0]) * t) * 255
      data[i + 1] = (a[1] + (b[1] - a[1]) * t) * 255
      data[i + 2] = (a[2] + (b[2] - a[2]) * t) * 255
      data[i + 3] = 255
    }
  }
  return { data, width, height }
}

/** 去杂边：在主体边缘带把主体色向新底色拉，压掉换底后的绿边/白边 */
export function decontaminateEdge(
  image: RgbaImage,
  bgMask: Uint8ClampedArray,
  fill: RgbaImage,
  width: number,
  height: number,
  strength: number
): RgbaImage {
  const band = M.blurMask(
    (() => {
      const subject = new Uint8ClampedArray(bgMask.length)
      for (let i = 0; i < bgMask.length; i++) subject[i] = 255 - bgMask[i]
      return edgeBand(subject, width, height)
    })(),
    width,
    height,
    2
  )
  const out = new Uint8ClampedArray(image.data)
  const radius = Math.max(2, Math.round(Math.min(width, height) * 0.01))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      if (band[p] < 20) continue
      // 采样环带外侧的底色，向它靠拢一部分
      const sx = Math.min(width - 1, x + radius)
      const sy = Math.min(height - 1, y + radius)
      const i = p * 4
      const j = (sy * width + sx) * 4
      const w = Math.min(1, Math.max(0, strength)) * (band[p] / 255) * 0.6
      for (let c = 0; c < 3; c++) {
        out[i + c] = K.clamp255(image.data[i + c] + (fill.data[j + c] - image.data[i + c]) * w)
      }
    }
  }
  return { data: out, width, height }
}

// ── 裁切 / 缩放 / 拼版 ─────────────────────────────────────────

/** 双线性裁切 + 缩放到目标尺寸（无 canvas 依赖，Cook 侧与测试都用它） */
export function cropAndResize(
  image: RgbaImage,
  crop: { x: number; y: number; width: number; height: number },
  targetWidth: number,
  targetHeight: number
): RgbaImage {
  const out = new Uint8ClampedArray(targetWidth * targetHeight * 4)
  const px = new Float32Array(4)
  const scaleX = crop.width / Math.max(1, targetWidth)
  const scaleY = crop.height / Math.max(1, targetHeight)
  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      K.sampleBilinear(
        image,
        crop.x + (x + 0.5) * scaleX - 0.5,
        crop.y + (y + 0.5) * scaleY - 0.5,
        px
      )
      const i = (y * targetWidth + x) * 4
      out[i] = px[0]
      out[i + 1] = px[1]
      out[i + 2] = px[2]
      out[i + 3] = px[3]
    }
  }
  return { data: out, width: targetWidth, height: targetHeight }
}

/** 证件照拼版：把单张按行列铺到相纸画布上 */
export function composeSheet(
  cell: RgbaImage,
  layout: { cols: number; rows: number; gapPx: number; width: number; height: number },
  background = '#ffffff'
): RgbaImage {
  const bg = hexToRgb(background)
  const data = new Uint8ClampedArray(layout.width * layout.height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = bg[0] * 255
    data[i + 1] = bg[1] * 255
    data[i + 2] = bg[2] * 255
    data[i + 3] = 255
  }
  const totalW = layout.cols * cell.width + (layout.cols - 1) * layout.gapPx
  const totalH = layout.rows * cell.height + (layout.rows - 1) * layout.gapPx
  const offsetX = Math.max(0, Math.round((layout.width - totalW) / 2))
  const offsetY = Math.max(0, Math.round((layout.height - totalH) / 2))
  for (let row = 0; row < layout.rows; row++) {
    for (let col = 0; col < layout.cols; col++) {
      const x0 = offsetX + col * (cell.width + layout.gapPx)
      const y0 = offsetY + row * (cell.height + layout.gapPx)
      for (let y = 0; y < cell.height; y++) {
        const dy = y0 + y
        if (dy < 0 || dy >= layout.height) continue
        for (let x = 0; x < cell.width; x++) {
          const dx = x0 + x
          if (dx < 0 || dx >= layout.width) continue
          const si = (y * cell.width + x) * 4
          const di = (dy * layout.width + dx) * 4
          data[di] = cell.data[si]
          data[di + 1] = cell.data[si + 1]
          data[di + 2] = cell.data[si + 2]
          data[di + 3] = cell.data[si + 3]
        }
      }
    }
  }
  return { data, width: layout.width, height: layout.height }
}

/** 供测试与调试：把调色板 hex 转成归一化 rgb */
export function paletteRgb(hex: string): [number, number, number] {
  return hexToRgb(hex)
}

export { rgbToHex }
