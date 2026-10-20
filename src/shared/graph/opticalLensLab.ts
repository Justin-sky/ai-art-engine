/**
 * 物理光学镜头实验室与胶片冲印仿真（Optical Lens Physics & Analog Halation Lab）
 *
 * 消除 AI 生图与普通数码修图的「塑料感」，在纯本地 RGBA 像素层复刻好莱坞电影镜头与暗房冲印的物理光学特征：
 * 1. 胶片红晕光（Analog Film Halation）：高反差强光边缘穿透乳剂层在片基反射形成的暖红光晕扩散
 * 2. 变形宽银幕拉丝眩光（Anamorphic Streak Flare）：高光锚点水平方向冰蓝/琥珀光学拉丝
 * 3. 径向轴向微色散（Radial Chromatic Aberration）：画幅边缘微米级红/蓝通道色差分离
 * 4. 旋焦猫眼暗角（Petzval Swirl & Optical Vignette）与大画幅移轴焦平面（Tilt-Shift Miniature Plane）
 */

export type OpticalLensPresetId =
  'arri-anamorphic' | 'kodak-halation' | 'leica-noctilux' | 'tilt-shift-miniature'

export interface OpticalLensPresetSpec {
  id: OpticalLensPresetId
  labelZh: string
  labelEn: string
  descriptionZh: string
  defaults: Required<Omit<OpticalLensLabOptions, 'preset'>>
}

export interface OpticalLensLabOptions {
  preset?: OpticalLensPresetId
  /** 胶片红晕光强度 0..1 */
  halationStrength?: number
  /** 变形宽银幕水平拉丝眩光强度 0..1 */
  anamorphicStreakStrength?: number
  /** 变形拉丝颜色倾向：'cyan'（科幻冰蓝）| 'amber'（复古琥珀） */
  streakTint?: 'cyan' | 'amber'
  /** 边缘径向色差像素偏移 0..4 */
  chromaticAberrationPx?: number
  /** 光学渐晕与暗角强度 0..1 */
  opticalVignetteStrength?: number
  /** 移轴焦平面中心 Y（0..1，默认 0.5） */
  tiltShiftFocusY?: number
  /** 移轴清晰带宽度（0.1..1，1.0 表示全图清晰不启用移轴模糊） */
  tiltShiftBandwidth?: number
}

export const OPTICAL_LENS_PRESETS: readonly OpticalLensPresetSpec[] = [
  {
    id: 'arri-anamorphic',
    labelZh: '阿莱变形宽银幕 (Anamorphic)',
    labelEn: 'ARRI Master Anamorphic',
    descriptionZh: '水平冰蓝变形拉丝眩光 + 轻微胶片红晕 + 电影级椭圆暗角',
    defaults: {
      halationStrength: 0.35,
      anamorphicStreakStrength: 0.65,
      streakTint: 'cyan',
      chromaticAberrationPx: 1.2,
      opticalVignetteStrength: 0.32,
      tiltShiftFocusY: 0.48,
      tiltShiftBandwidth: 1.0
    }
  },
  {
    id: 'kodak-halation',
    labelZh: '柯达 Vision3 胶片红晕',
    labelEn: 'Kodak 500T Film Halation',
    descriptionZh: '强逆光与高反差边缘呈现温暖迷人的胶片乳剂红橙晕光',
    defaults: {
      halationStrength: 0.78,
      anamorphicStreakStrength: 0.18,
      streakTint: 'amber',
      chromaticAberrationPx: 0.9,
      opticalVignetteStrength: 0.28,
      tiltShiftFocusY: 0.5,
      tiltShiftBandwidth: 1.0
    }
  },
  {
    id: 'leica-noctilux',
    labelZh: '徕卡夜神大光圈 (Noctilux f/0.95)',
    labelEn: 'Leica Noctilux 50mm f/0.95',
    descriptionZh: '浓郁大光圈光学渐晕 + 边缘微色散 + 柔和琥珀高光漫射',
    defaults: {
      halationStrength: 0.42,
      anamorphicStreakStrength: 0.22,
      streakTint: 'amber',
      chromaticAberrationPx: 1.6,
      opticalVignetteStrength: 0.52,
      tiltShiftFocusY: 0.46,
      tiltShiftBandwidth: 0.72
    }
  },
  {
    id: 'tilt-shift-miniature',
    labelZh: '大画幅移轴微缩镜头',
    labelEn: 'Tilt-Shift Miniature Lens',
    descriptionZh: '窄景深移轴焦平面 + 高饱和度光学通透感，营造微缩模型或特写抽离感',
    defaults: {
      halationStrength: 0.2,
      anamorphicStreakStrength: 0.1,
      streakTint: 'cyan',
      chromaticAberrationPx: 1.4,
      opticalVignetteStrength: 0.24,
      tiltShiftFocusY: 0.48,
      tiltShiftBandwidth: 0.32
    }
  }
] as const

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function sampleChannelBilinear(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  channelOffset: number
): number {
  const sx = clamp(x, 0, width - 1)
  const sy = clamp(y, 0, height - 1)
  const x0 = Math.floor(sx)
  const y0 = Math.floor(sy)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const fx = sx - x0
  const fy = sy - y0

  const p00 = (y0 * width + x0) * 4 + channelOffset
  const p10 = (y0 * width + x1) * 4 + channelOffset
  const p01 = (y1 * width + x0) * 4 + channelOffset
  const p11 = (y1 * width + x1) * 4 + channelOffset

  const top = (pixels[p00] ?? 0) * (1 - fx) + (pixels[p10] ?? 0) * fx
  const bottom = (pixels[p01] ?? 0) * (1 - fx) + (pixels[p11] ?? 0) * fx
  return top * (1 - fy) + bottom * fy
}

/**
 * 对 RGBA 图像应用物理光学镜头仿真（胶片红晕光 + 变形拉丝眩光 + 轴向微色散 + 光学暗角 + 移轴景深）
 */
export function applyOpticalLensLabRgba(
  sourcePixels: Uint8ClampedArray,
  width: number,
  height: number,
  options?: OpticalLensLabOptions
): Uint8ClampedArray {
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(1, Math.floor(height))
  const presetSpec =
    OPTICAL_LENS_PRESETS.find((p) => p.id === (options?.preset ?? 'arri-anamorphic')) ??
    OPTICAL_LENS_PRESETS[0]!

  const halationStrength = clamp01(
    options?.halationStrength ?? presetSpec.defaults.halationStrength
  )
  const streakStrength = clamp01(
    options?.anamorphicStreakStrength ?? presetSpec.defaults.anamorphicStreakStrength
  )
  const streakTint = options?.streakTint ?? presetSpec.defaults.streakTint
  const caPx = clamp(
    options?.chromaticAberrationPx ?? presetSpec.defaults.chromaticAberrationPx,
    0,
    4
  )
  const vignetteStrength = clamp01(
    options?.opticalVignetteStrength ?? presetSpec.defaults.opticalVignetteStrength
  )
  const focusY = clamp01(options?.tiltShiftFocusY ?? presetSpec.defaults.tiltShiftFocusY)
  const bandwidth = clamp(
    options?.tiltShiftBandwidth ?? presetSpec.defaults.tiltShiftBandwidth,
    0.1,
    1.0
  )

  const out = new Uint8ClampedArray(w * h * 4)

  // 1. 预计算高光能量图（用于胶片红晕与变形宽银幕拉丝）
  const highlightEnergy = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const r = (sourcePixels[i] ?? 0) / 255
      const g = (sourcePixels[i + 1] ?? 0) / 255
      const b = (sourcePixels[i + 2] ?? 0) / 255
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      // 超过阈值 0.68 的强高光激发胶片散射与拉丝
      highlightEnergy[y * w + x] = luma > 0.68 ? Math.pow((luma - 0.68) / 0.32, 1.35) : 0
    }
  }

  // 2. 水平方向宽跨度拉丝卷积（Anamorphic Horizontal Streak）与局部红晕扩散半径
  const streakField = new Float32Array(w * h)
  const halationField = new Float32Array(w * h)
  const streakRadius = Math.max(4, Math.min(64, Math.round(w * 0.32)))
  const halationRadius = Math.max(2, Math.min(12, Math.round(Math.min(w, h) * 0.06)))

  for (let y = 0; y < h; y++) {
    const rowOffset = y * w
    for (let x = 0; x < w; x++) {
      // 水平变形拉丝
      if (streakStrength > 0.01) {
        let sumStreak = 0
        let weightSum = 0
        const step = Math.max(1, Math.floor(streakRadius / 10))
        for (let dx = -streakRadius; dx <= streakRadius; dx += step) {
          const sx = clamp(x + dx, 0, w - 1)
          const decay = Math.exp(-Math.abs(dx) / (streakRadius * 0.48))
          sumStreak += (highlightEnergy[rowOffset + sx] ?? 0) * decay
          weightSum += decay
        }
        streakField[rowOffset + x] = weightSum > 0 ? sumStreak / weightSum : 0
      }

      // 2D 各向同性高反差边缘胶片红晕（Halation）
      if (halationStrength > 0.01) {
        let maxNeighborHighlight = 0
        let sumHal = 0
        let cnt = 0
        const hStep = Math.max(1, Math.floor(halationRadius / 2))
        for (let dy = -halationRadius; dy <= halationRadius; dy += hStep) {
          const sy = clamp(y + dy, 0, h - 1)
          for (let dx = -halationRadius; dx <= halationRadius; dx += hStep) {
            const sx = clamp(x + dx, 0, w - 1)
            const e = highlightEnergy[sy * w + sx] ?? 0
            if (e > maxNeighborHighlight) maxNeighborHighlight = e
            sumHal += e
            cnt++
          }
        }
        const avgHal = cnt > 0 ? sumHal / cnt : 0
        halationField[rowOffset + x] = avgHal * 0.65 + maxNeighborHighlight * 0.35
      }
    }
  }

  const cx = (w - 1) * 0.5
  const cy = (h - 1) * 0.5
  const maxR = Math.hypot(cx, cy) || 1

  // 3. 逐像素合成：径向微色差 + 移轴离焦 + 椭圆光学暗角 + 胶片红晕 + 变形拉丝
  for (let y = 0; y < h; y++) {
    const ny = (y + 0.5) / h
    const dy = y - cy
    // 移轴焦外模糊权重
    const distFromFocusPlane = Math.abs(ny - focusY)
    const defocusFactor =
      bandwidth < 0.98
        ? clamp01((distFromFocusPlane - bandwidth * 0.35) / Math.max(0.08, bandwidth * 0.65))
        : 0

    for (let x = 0; x < w; x++) {
      const dx = x - cx
      // 椭圆宽银幕暗角（水平方向衰减慢，垂直方向衰减略快）
      const normDist = Math.hypot(dx / (cx || 1), (dy / (cy || 1)) * 1.15)
      const radial01 = Math.hypot(dx, dy) / maxR

      // 径向微色差：红通道微向外扩，蓝通道微向内缩，绿通道保持原位
      const caShift = caPx * radial01 * radial01
      const dirX = radial01 > 1e-4 ? dx / maxR : 0
      const dirY = radial01 > 1e-4 ? dy / maxR : 0

      let r = sampleChannelBilinear(sourcePixels, w, h, x + dirX * caShift, y + dirY * caShift, 0)
      let g = sampleChannelBilinear(sourcePixels, w, h, x, y, 1)
      let b = sampleChannelBilinear(sourcePixels, w, h, x - dirX * caShift, y - dirY * caShift, 2)
      const a = sourcePixels[(y * w + x) * 4 + 3] ?? 255

      // 若开启移轴焦平面且处于焦外带，执行快速 5 点十字光学柔化
      if (defocusFactor > 0.04) {
        const blurStep = Math.max(1, Math.round(defocusFactor * 3))
        const rBlur =
          0.25 *
          (sampleChannelBilinear(sourcePixels, w, h, x - blurStep, y, 0) +
            sampleChannelBilinear(sourcePixels, w, h, x + blurStep, y, 0) +
            sampleChannelBilinear(sourcePixels, w, h, x, y - blurStep, 0) +
            sampleChannelBilinear(sourcePixels, w, h, x, y + blurStep, 0))
        const gBlur =
          0.25 *
          (sampleChannelBilinear(sourcePixels, w, h, x - blurStep, y, 1) +
            sampleChannelBilinear(sourcePixels, w, h, x + blurStep, y, 1) +
            sampleChannelBilinear(sourcePixels, w, h, x, y - blurStep, 1) +
            sampleChannelBilinear(sourcePixels, w, h, x, y + blurStep, 1))
        const bBlur =
          0.25 *
          (sampleChannelBilinear(sourcePixels, w, h, x - blurStep, y, 2) +
            sampleChannelBilinear(sourcePixels, w, h, x + blurStep, y, 2) +
            sampleChannelBilinear(sourcePixels, w, h, x, y - blurStep, 2) +
            sampleChannelBilinear(sourcePixels, w, h, x, y + blurStep, 2))
        const mix = defocusFactor * 0.78
        r = r * (1 - mix) + rBlur * mix
        g = g * (1 - mix) + gBlur * mix
        b = b * (1 - mix) + bBlur * mix
      }

      // 光学余弦四次方定律暗角（Cos^4 Optical Vignetting 在入射瞳发生，先于片基红晕与镜片眩光）
      if (vignetteStrength > 0.005) {
        const falloff = Math.max(
          0.25,
          1 - vignetteStrength * Math.pow(clamp(normDist * 0.78, 0, 1.35), 2.1)
        )
        r *= falloff
        g *= falloff
        b *= falloff
      }

      // 叠加胶片红晕光（Kodak Vision3 特征暖红橙色 #FF3814，在暗部/中调边缘最显著）
      const hal = (halationField[y * w + x] ?? 0) * halationStrength
      if (hal > 0.002) {
        const luma01 = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
        const edgeReceptivity = 1 - Math.pow(luma01, 2.2) * 0.55
        const halBoost = hal * edgeReceptivity * 125
        r += halBoost * 1.0
        g += halBoost * 0.28
        b += halBoost * 0.06
      }

      // 叠加变形宽银幕水平拉丝眩光（Anamorphic Streak）
      const streak = (streakField[y * w + x] ?? 0) * streakStrength
      if (streak > 0.002) {
        const sBoost = streak * 150
        if (streakTint === 'cyan') {
          r += sBoost * 0.22
          g += sBoost * 0.78
          b += sBoost * 1.25
        } else {
          r += sBoost * 1.15
          g += sBoost * 0.68
          b += sBoost * 0.2
        }
      }

      const idx = (y * w + x) * 4
      out[idx] = Math.round(clamp(r, 0, 255))
      out[idx + 1] = Math.round(clamp(g, 0, 255))
      out[idx + 2] = Math.round(clamp(b, 0, 255))
      out[idx + 3] = a
    }
  }

  return out
}
