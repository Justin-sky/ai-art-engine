/**
 * 「盗梦空间」参考图色彩与光影基因反推器（AI Style & Lighting DNA Reverse-Engineering）
 *
 * 从任意参考图 RGBA 像素中 0 秒逆向提取：
 * 1. 阴影 / 中间调 / 高光三段 RGB 色彩偏移（Lift / Gamma / Gain）
 * 2. 色温冷暖倾向（Warmth）、绿品色调偏移（Tint）、饱和度与对比度特征
 * 3. 基于高光空间质心与边缘亮度梯度的 2.5D 主光方位角（Yaw / Pitch）、主光颜色与轮廓光强度
 * 4. 自动映射为可直接套用的 `PortraitRetouchState` 补丁、`LightingSetup` 布光配置
 * 5. 自动拟合并导出标准 Adobe / DaVinci / Premiere 兼容的 `.cube` 3D LUT
 */

import { normalizeLightingSetup, type LightingSetupState } from './lightingSetup'
import { type PortraitCubeLut } from './portraitLiveMath'
import {
  normalizePortraitRetouch,
  type PortraitLightRatio,
  type PortraitLutId,
  type PortraitRetouchState,
  type PortraitSaturationTier,
  type PortraitTier,
  type PortraitTintTier,
  type PortraitToneGrade,
  type PortraitWarmthTier
} from './portraitRetouch'

export interface RgbTriplet {
  r: number
  g: number
  b: number
}

export interface ImageStyleDnaReport {
  title: string
  /** 平均亮度 0..1 */
  meanLuma: number
  /** 亮度标准差（对比度指标）0..0.5 */
  contrastStd: number
  /** 平均饱和度 0..1 */
  meanSaturation: number
  /** 色温冷暖分数 -1（极冷）.. +1（极暖） */
  warmthScore: number
  /** 绿/品色调分数 -1（偏绿）.. +1（偏品红） */
  tintScore: number
  /** 阴影（暗部 25%）RGB 色彩均值 0..1 */
  shadowRgb: RgbTriplet
  /** 中间调（25%..75%）RGB 色彩均值 0..1 */
  midtoneRgb: RgbTriplet
  /** 高光（亮部 25%）RGB 色彩均值 0..1 */
  highlightRgb: RgbTriplet
  /** 反推 2.5D 主光水平方位角 -180..180（正值为右侧来光） */
  estimatedYaw: number
  /** 反推 2.5D 主光俯仰角 -90..90（正值为上方来光） */
  estimatedPitch: number
  /** 反推主光颜色 Hex */
  keyLightColorHex: string
  /** 是否检测到明显边缘轮廓光 */
  hasRimLight: boolean
  /** 推荐套用的人像精修状态补丁 */
  recommendedPortraitPatch: Partial<PortraitRetouchState>
  /** 推荐套用的 2.5D 打光配置 */
  recommendedLightingSetup: LightingSetupState
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function toHexByte(v01: number): string {
  const n = Math.round(clamp01(v01) * 255)
  return n.toString(16).padStart(2, '0')
}

function rgb01ToHex(rgb: RgbTriplet): string {
  return `#${toHexByte(rgb.r)}${toHexByte(rgb.g)}${toHexByte(rgb.b)}`
}

/**
 * 从任意参考图 RGBA 像素缓冲区中逆向提取色彩与光影基因（Style & Lighting DNA）
 */
export function extractImageStyleDna(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  title = 'Reference Style DNA'
): ImageStyleDnaReport {
  const cleanTitle = title.trim() || 'Reference Style DNA'
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(1, Math.floor(height))
  const totalPixels = Math.max(1, Math.min(w * h, Math.floor(pixels.length / 4)))

  let sumLuma = 0
  let sumSat = 0
  let sumR = 0
  let sumG = 0
  let sumB = 0

  // 采样步长：大图自动降采样，确保毫秒级完成
  const step = Math.max(1, Math.floor(Math.sqrt(totalPixels / 4096)))
  let sampleCount = 0

  const samples: Array<{
    r: number
    g: number
    b: number
    luma: number
    nx: number
    ny: number
    edgeDist: number
  }> = []

  for (let y = 0; y < h; y += step) {
    const ny = (y / Math.max(1, h - 1)) * 2 - 1 // -1 (top) .. +1 (bottom)
    for (let x = 0; x < w; x += step) {
      const idx = (y * w + x) * 4
      if (idx + 3 >= pixels.length) continue
      const a = pixels[idx + 3]!
      if (a < 16) continue

      const r = pixels[idx]! / 255
      const g = pixels[idx + 1]! / 255
      const b = pixels[idx + 2]! / 255
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      const maxC = Math.max(r, g, b)
      const minC = Math.min(r, g, b)
      const sat = maxC > 1e-4 ? (maxC - minC) / maxC : 0
      const nx = (x / Math.max(1, w - 1)) * 2 - 1 // -1 (left) .. +1 (right)
      const edgeDist = Math.hypot(nx, ny)

      sumLuma += luma
      sumSat += sat
      sumR += r
      sumG += g
      sumB += b
      sampleCount++
      samples.push({ r, g, b, luma, nx, ny, edgeDist })
    }
  }

  if (sampleCount === 0) {
    const defaultLighting = normalizeLightingSetup({})
    return {
      title: cleanTitle,
      meanLuma: 0.5,
      contrastStd: 0.18,
      meanSaturation: 0.35,
      warmthScore: 0,
      tintScore: 0,
      shadowRgb: { r: 0.15, g: 0.15, b: 0.15 },
      midtoneRgb: { r: 0.5, g: 0.5, b: 0.5 },
      highlightRgb: { r: 0.85, g: 0.85, b: 0.85 },
      estimatedYaw: 25,
      estimatedPitch: 15,
      keyLightColorHex: '#fff5ea',
      hasRimLight: false,
      recommendedPortraitPatch: {},
      recommendedLightingSetup: defaultLighting
    }
  }

  const meanLuma = sumLuma / sampleCount
  const meanSat = sumSat / sampleCount
  const meanR = sumR / sampleCount
  const meanG = sumG / sampleCount
  const meanB = sumB / sampleCount

  let varLuma = 0
  for (const s of samples) {
    const dl = s.luma - meanLuma
    varLuma += dl * dl
  }
  const contrastStd = Math.sqrt(varLuma / sampleCount)

  // 按亮度排序，切分暗部 25%、中间调 50%、高光 25%
  const sorted = [...samples].sort((a, b) => a.luma - b.luma)
  const q1 = Math.max(1, Math.floor(sorted.length * 0.25))
  const q3 = Math.max(q1 + 1, Math.floor(sorted.length * 0.75))

  const avgSlice = (arr: typeof samples): RgbTriplet => {
    if (arr.length === 0) return { r: 0.5, g: 0.5, b: 0.5 }
    let sr = 0
    let sg = 0
    let sb = 0
    for (const item of arr) {
      sr += item.r
      sg += item.g
      sb += item.b
    }
    return {
      r: sr / arr.length,
      g: sg / arr.length,
      b: sb / arr.length
    }
  }

  const shadowRgb = avgSlice(sorted.slice(0, q1))
  const midtoneRgb = avgSlice(sorted.slice(q1, q3))
  const highlightRgb = avgSlice(sorted.slice(q3))

  // 色温冷暖（红蓝差分）与色调（绿品红差分）
  const warmthScore = clamp((meanR - meanB) * 2.4, -1, 1)
  const tintScore = clamp(((meanR + meanB) * 0.5 - meanG) * 2.8, -1, 1)

  // 反推 2.5D 主光方位角（使用亮部前 30% 像素的亮度加权空间质心）
  let weightedNx = 0
  let weightedNy = 0
  let weightSum = 0
  let outerBrightSum = 0
  let outerCount = 0
  let innerBrightSum = 0
  let innerCount = 0

  const brightThreshold = sorted[Math.floor(sorted.length * 0.7)]?.luma ?? meanLuma
  for (const s of samples) {
    if (s.luma >= brightThreshold) {
      const wgt = Math.max(0.01, s.luma - meanLuma + 0.1)
      weightedNx += s.nx * wgt
      weightedNy += -s.ny * wgt // 上方为正俯仰角
      weightSum += wgt
    }
    if (s.edgeDist > 0.78) {
      outerBrightSum += s.luma
      outerCount++
    } else if (s.edgeDist < 0.55) {
      innerBrightSum += s.luma
      innerCount++
    }
  }

  const cx = weightSum > 0 ? weightedNx / weightSum : 0.2
  const cy = weightSum > 0 ? weightedNy / weightSum : 0.15
  const estimatedYaw = Math.round(clamp(cx * 135, -160, 160))
  const estimatedPitch = Math.round(clamp(cy * 80, -75, 75))

  const outerMean = outerCount > 0 ? outerBrightSum / outerCount : meanLuma
  const innerMean = innerCount > 0 ? innerBrightSum / innerCount : meanLuma
  const hasRimLight = outerMean > innerMean * 1.08

  // 归一化高光颜色作为主光色（保持高明度）
  const maxHi = Math.max(0.25, highlightRgb.r, highlightRgb.g, highlightRgb.b)
  const keyLightColorHex = rgb01ToHex({
    r: clamp01(0.45 + (highlightRgb.r / maxHi) * 0.55),
    g: clamp01(0.45 + (highlightRgb.g / maxHi) * 0.55),
    b: clamp01(0.45 + (highlightRgb.b / maxHi) * 0.55)
  })

  // 推导 PortraitRetouchState 档位建议
  const colorTemp: PortraitWarmthTier =
    warmthScore <= -0.3
      ? 'cool'
      : warmthScore <= -0.1
        ? 'coolLight'
        : warmthScore >= 0.35
          ? 'warmStrong'
          : warmthScore >= 0.1
            ? 'warm'
            : 'off'

  const colorTint: PortraitTintTier =
    tintScore <= -0.25
      ? 'green'
      : tintScore <= -0.1
        ? 'slightGreen'
        : tintScore >= 0.25
          ? 'magenta'
          : tintScore >= 0.1
            ? 'slightMagenta'
            : 'off'

  const saturation: PortraitSaturationTier =
    meanSat <= 0.18
      ? 'desaturate'
      : meanSat <= 0.28
        ? 'desaturateSoft'
        : meanSat >= 0.58
          ? 'boostVivid'
          : meanSat >= 0.44
            ? 'boost'
            : 'off'

  const toneGrade: PortraitToneGrade =
    meanLuma >= 0.62 && contrastStd < 0.2
      ? 'brightAiry'
      : meanLuma <= 0.36
        ? 'lowKeyMoody'
        : contrastStd >= 0.25
          ? 'highContrast'
          : contrastStd <= 0.14
            ? 'filmFade'
            : 'natural'

  const lightRatio: PortraitLightRatio =
    contrastStd >= 0.26
      ? 'hard'
      : contrastStd >= 0.2
        ? 'dramatic'
        : contrastStd <= 0.15
          ? 'soft'
          : 'natural'

  const lutId: PortraitLutId =
    warmthScore < -0.15 && meanLuma > 0.52
      ? 'coolFilm'
      : warmthScore > 0.22 && contrastStd > 0.2
        ? 'hongkong'
        : contrastStd < 0.16 && warmthScore >= -0.05
          ? 'fuji'
          : meanSat < 0.18
            ? 'bw'
            : 'kodak'

  const skinWhiten: PortraitTier =
    meanLuma >= 0.65 ? 'strong' : meanLuma >= 0.52 ? 'standard' : 'light'

  const recommendedPortraitPatch: Partial<PortraitRetouchState> = normalizePortraitRetouch({
    skinSmoothing: 'standard',
    skinWhiten,
    skinEvenness: 'standard',
    colorTemp,
    colorTint,
    saturation,
    toneGrade,
    lightRatio,
    lightTemp: colorTemp,
    rimLight: hasRimLight ? 'standard' : 'off',
    lutId
  })

  const recommendedLightingSetup: LightingSetupState = normalizeLightingSetup({
    yaw: estimatedYaw,
    pitch: estimatedPitch,
    brightness: Math.round(clamp(55 + meanLuma * 40, 35, 100)),
    color: keyLightColorHex,
    rimLight: hasRimLight
  })

  return {
    title: cleanTitle,
    meanLuma: Number(meanLuma.toFixed(4)),
    contrastStd: Number(contrastStd.toFixed(4)),
    meanSaturation: Number(meanSat.toFixed(4)),
    warmthScore: Number(warmthScore.toFixed(4)),
    tintScore: Number(tintScore.toFixed(4)),
    shadowRgb,
    midtoneRgb,
    highlightRgb,
    estimatedYaw,
    estimatedPitch,
    keyLightColorHex,
    hasRimLight,
    recommendedPortraitPatch,
    recommendedLightingSetup
  }
}

/**
 * 根据逆向提取的 `ImageStyleDnaReport` 合成一颗标准 3D `.cube` LUT 对象
 */
export function synthesizeCubeLutFromStyleDna(dna: ImageStyleDnaReport, size = 9): PortraitCubeLut {
  const N = clamp(Math.round(size), 2, 33)
  const table: number[] = []

  // 计算暗部、中间调、高光相对于中性灰的偏移量
  const shLuma = 0.2126 * dna.shadowRgb.r + 0.7152 * dna.shadowRgb.g + 0.0722 * dna.shadowRgb.b
  const midLuma = 0.2126 * dna.midtoneRgb.r + 0.7152 * dna.midtoneRgb.g + 0.0722 * dna.midtoneRgb.b
  const hiLuma =
    0.2126 * dna.highlightRgb.r + 0.7152 * dna.highlightRgb.g + 0.0722 * dna.highlightRgb.b

  const shShift = {
    r: (dna.shadowRgb.r - shLuma) * 0.45,
    g: (dna.shadowRgb.g - shLuma) * 0.45,
    b: (dna.shadowRgb.b - shLuma) * 0.45
  }
  const midShift = {
    r: (dna.midtoneRgb.r - midLuma) * 0.55,
    g: (dna.midtoneRgb.g - midLuma) * 0.55,
    b: (dna.midtoneRgb.b - midLuma) * 0.55
  }
  const hiShift = {
    r: (dna.highlightRgb.r - hiLuma) * 0.45,
    g: (dna.highlightRgb.g - hiLuma) * 0.45,
    b: (dna.highlightRgb.b - hiLuma) * 0.45
  }

  const contrastGain = clamp(1 + (dna.contrastStd - 0.18) * 1.4, 0.82, 1.28)
  const satScale = clamp(1 + (dna.meanSaturation - 0.35) * 0.85, 0.65, 1.35)

  // 标准 .cube 顺序：B 最外层循环，G 中间层，R 最内层循环
  for (let bi = 0; bi < N; bi++) {
    const b0 = bi / (N - 1)
    for (let gi = 0; gi < N; gi++) {
      const g0 = gi / (N - 1)
      for (let ri = 0; ri < N; ri++) {
        const r0 = ri / (N - 1)
        const luma = 0.2126 * r0 + 0.7152 * g0 + 0.0722 * b0

        // 暗部 / 中间调 / 高光三段平滑权重
        const wShadow = (1 - luma) * (1 - luma)
        const wHighlight = luma * luma
        const wMid = 1 - Math.abs(luma * 2 - 1)

        // 对比度围绕 0.5 S 曲线拉伸
        const applyContrast = (v: number): number => 0.5 + (v - 0.5) * contrastGain

        let r = applyContrast(r0) + shShift.r * wShadow + midShift.r * wMid + hiShift.r * wHighlight
        let g = applyContrast(g0) + shShift.g * wShadow + midShift.g * wMid + hiShift.g * wHighlight
        let b = applyContrast(b0) + shShift.b * wShadow + midShift.b * wMid + hiShift.b * wHighlight

        const newLuma = 0.2126 * r + 0.7152 * g + 0.0722 * b
        r = newLuma + (r - newLuma) * satScale
        g = newLuma + (g - newLuma) * satScale
        b = newLuma + (b - newLuma) * satScale

        table.push(
          Number(clamp01(r).toFixed(6)),
          Number(clamp01(g).toFixed(6)),
          Number(clamp01(b).toFixed(6))
        )
      }
    }
  }

  return {
    name: dna.title || 'Reverse_Engineered_Style_DNA',
    size: N,
    table
  }
}

/**
 * 将 `PortraitCubeLut` 序列化为标准 `.cube` 文本文件内容，可直接保存并导入 DaVinci / Premiere / PS
 */
export function serializeCubeLutToText(lut: PortraitCubeLut): string {
  const safeTitle = (lut.name || 'AI_Art_Engine_Style_DNA').replace(/["\r\n]/g, '_')
  const lines: string[] = [
    `# Created by AI Art Engine Style DNA Extractor`,
    `TITLE "${safeTitle}"`,
    `LUT_3D_SIZE ${lut.size}`,
    `DOMAIN_MIN 0.000000 0.000000 0.000000`,
    `DOMAIN_MAX 1.000000 1.000000 1.000000`,
    ``
  ]
  for (let i = 0; i + 2 < lut.table.length; i += 3) {
    lines.push(
      `${lut.table[i]!.toFixed(6)} ${lut.table[i + 1]!.toFixed(6)} ${lut.table[i + 2]!.toFixed(6)}`
    )
  }
  return lines.join('\n')
}
