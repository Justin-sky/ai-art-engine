/**
 * 全片「视觉连戏巡检官」与一键色彩拉平（Cross-Shot Continuity Radar & Auto-Harmonizer）
 *
 * 自动检测分镜/时间轴序列中相邻镜头的：
 * - 亮度跳变（`luma-jump`）
 * - 色温漂移（`color-temp-drift`）
 * - 饱和度断层（`saturation-mismatch`）
 * - 对比度坍塌（`contrast-drop`）
 * - 死黑/死白过曝裁切（`exposure-clipping`）
 * 并支持以主镜头（Hero Shot）为锚点一键拉平全片色彩与明暗分布。
 */

import { matchShotColorHistogramRgba } from './portraitLiveMath'

export interface ShotVisualMetrics {
  shotId: string
  title: string
  /** 平均亮度 0..1 */
  meanLuma: number
  /** 亮度标准差（对比度）0..0.5 */
  lumaStd: number
  /** 色温冷暖指数 -1（极冷）.. +1（极暖） */
  warmthIndex: number
  /** 绿/品色调指数 -1..+1 */
  tintIndex: number
  /** 平均饱和度 0..1 */
  meanSaturation: number
  /** 暗部死黑裁切占比 0..1 */
  shadowClipRatio: number
  /** 高光死白过曝占比 0..1 */
  highlightClipRatio: number
}

export type ContinuityIssueKind =
  'luma-jump' | 'color-temp-drift' | 'saturation-mismatch' | 'contrast-drop' | 'exposure-clipping'

export interface ContinuityIssueItem {
  kind: ContinuityIssueKind
  severity: 'warning' | 'critical'
  fromShotId: string
  toShotId: string
  delta: number
  messageZh: string
  messageEn: string
}

export interface ShotSequenceContinuityReport {
  /** 0..100 全片视觉连戏健康分 */
  continuityScore: number
  /** 推荐作为全片色彩基准锚点的主镜头（Hero Shot）ID */
  recommendedHeroShotId: string
  metrics: ShotVisualMetrics[]
  issues: ContinuityIssueItem[]
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

/**
 * 计算单个分镜画面的视觉测光与色彩指标
 */
export function analyzeShotVisualMetrics(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  shotId: string,
  title?: string
): ShotVisualMetrics {
  const total = Math.max(1, Math.min(width * height, Math.floor(pixels.length / 4)))
  const step = Math.max(1, Math.floor(total / 4096))

  let count = 0
  let sumLuma = 0
  let sumSat = 0
  let sumR = 0
  let sumG = 0
  let sumB = 0
  let shadowClips = 0
  let highlightClips = 0
  const lumas: number[] = []

  for (let p = 0; p < total; p += step) {
    const i = p * 4
    const r = (pixels[i] ?? 0) / 255
    const g = (pixels[i + 1] ?? 0) / 255
    const b = (pixels[i + 2] ?? 0) / 255
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    const maxC = Math.max(r, g, b)
    const minC = Math.min(r, g, b)
    const sat = maxC > 1e-4 ? (maxC - minC) / maxC : 0

    sumLuma += luma
    sumSat += sat
    sumR += r
    sumG += g
    sumB += b
    if (luma < 0.03) shadowClips++
    if (luma > 0.97) highlightClips++
    lumas.push(luma)
    count++
  }

  if (count === 0) {
    return {
      shotId,
      title: title || shotId,
      meanLuma: 0.5,
      lumaStd: 0.18,
      warmthIndex: 0,
      tintIndex: 0,
      meanSaturation: 0.3,
      shadowClipRatio: 0,
      highlightClipRatio: 0
    }
  }

  const meanLuma = sumLuma / count
  let varLuma = 0
  for (const l of lumas) {
    const d = l - meanLuma
    varLuma += d * d
  }
  const lumaStd = Math.sqrt(varLuma / count)
  const meanR = sumR / count
  const meanG = sumG / count
  const meanB = sumB / count

  return {
    shotId,
    title: title || shotId,
    meanLuma: Number(meanLuma.toFixed(4)),
    lumaStd: Number(lumaStd.toFixed(4)),
    warmthIndex: Number(clamp((meanR - meanB) * 2.2, -1, 1).toFixed(4)),
    tintIndex: Number(clamp(((meanR + meanB) * 0.5 - meanG) * 2.5, -1, 1).toFixed(4)),
    meanSaturation: Number((sumSat / count).toFixed(4)),
    shadowClipRatio: Number((shadowClips / count).toFixed(4)),
    highlightClipRatio: Number((highlightClips / count).toFixed(4))
  }
}

/**
 * 评估多镜头序列的视觉连戏健康度，定位跳色/跳光镜头并推荐最优色彩基准主镜头（Hero Shot）
 */
export function evaluateShotSequenceContinuity(
  shots: ReadonlyArray<{
    shotId: string
    title?: string
    pixels: Uint8ClampedArray
    width: number
    height: number
  }>
): ShotSequenceContinuityReport {
  if (shots.length === 0) {
    return {
      continuityScore: 100,
      recommendedHeroShotId: '',
      metrics: [],
      issues: []
    }
  }

  const metrics = shots.map((s) =>
    analyzeShotVisualMetrics(s.pixels, s.width, s.height, s.shotId, s.title)
  )
  const issues: ContinuityIssueItem[] = []
  let penalty = 0

  // 1. 单镜曝光裁切检查
  for (const m of metrics) {
    const clipTotal = m.shadowClipRatio + m.highlightClipRatio
    if (clipTotal > 0.35) {
      const severity = clipTotal > 0.55 ? 'critical' : 'warning'
      penalty += severity === 'critical' ? 14 : 7
      issues.push({
        kind: 'exposure-clipping',
        severity,
        fromShotId: m.shotId,
        toShotId: m.shotId,
        delta: Number(clipTotal.toFixed(3)),
        messageZh: `镜头「${m.title}」存在明显死黑/过曝裁切（占比 ${Math.round(clipTotal * 100)}%）`,
        messageEn: `Shot "${m.title}" has severe shadow/highlight clipping (${Math.round(clipTotal * 100)}%)`
      })
    }
  }

  // 2. 相邻镜头连戏跳变检查
  for (let i = 1; i < metrics.length; i++) {
    const prev = metrics[i - 1]!
    const curr = metrics[i]!

    const deltaLuma = Math.abs(curr.meanLuma - prev.meanLuma)
    if (deltaLuma >= 0.18) {
      const severity = deltaLuma >= 0.3 ? 'critical' : 'warning'
      penalty += severity === 'critical' ? 18 : 9
      issues.push({
        kind: 'luma-jump',
        severity,
        fromShotId: prev.shotId,
        toShotId: curr.shotId,
        delta: Number(deltaLuma.toFixed(3)),
        messageZh: `「${prev.title} → ${curr.title}」亮度剧烈跳变（ΔLuma ${(deltaLuma * 100).toFixed(0)}%）`,
        messageEn: `Luminance jump between "${prev.title}" and "${curr.title}" (ΔLuma ${(deltaLuma * 100).toFixed(0)}%)`
      })
    }

    const deltaTemp = Math.abs(curr.warmthIndex - prev.warmthIndex)
    if (deltaTemp >= 0.26) {
      const severity = deltaTemp >= 0.45 ? 'critical' : 'warning'
      penalty += severity === 'critical' ? 18 : 9
      issues.push({
        kind: 'color-temp-drift',
        severity,
        fromShotId: prev.shotId,
        toShotId: curr.shotId,
        delta: Number(deltaTemp.toFixed(3)),
        messageZh: `「${prev.title} → ${curr.title}」色温冷暖不连戏（ΔCCT ${(deltaTemp * 100).toFixed(0)}%）`,
        messageEn: `Color temperature drift between "${prev.title}" and "${curr.title}" (ΔCCT ${(deltaTemp * 100).toFixed(0)}%)`
      })
    }

    const deltaSat = Math.abs(curr.meanSaturation - prev.meanSaturation)
    if (deltaSat >= 0.22) {
      const severity = deltaSat >= 0.36 ? 'critical' : 'warning'
      penalty += severity === 'critical' ? 14 : 7
      issues.push({
        kind: 'saturation-mismatch',
        severity,
        fromShotId: prev.shotId,
        toShotId: curr.shotId,
        delta: Number(deltaSat.toFixed(3)),
        messageZh: `「${prev.title} → ${curr.title}」饱和度断层（ΔSat ${(deltaSat * 100).toFixed(0)}%）`,
        messageEn: `Saturation mismatch between "${prev.title}" and "${curr.title}" (ΔSat ${(deltaSat * 100).toFixed(0)}%)`
      })
    }

    const deltaContrast = Math.abs(curr.lumaStd - prev.lumaStd)
    if (deltaContrast >= 0.12) {
      issues.push({
        kind: 'contrast-drop',
        severity: 'warning',
        fromShotId: prev.shotId,
        toShotId: curr.shotId,
        delta: Number(deltaContrast.toFixed(3)),
        messageZh: `「${prev.title} → ${curr.title}」画面反差跨度过大`,
        messageEn: `Contrast shift between "${prev.title}" and "${curr.title}"`
      })
      penalty += 5
    }
  }

  // 选出最接近全片中位曝光、对比适中且无裁切的最佳主镜头（Hero Shot）
  const avgLuma = metrics.reduce((acc, m) => acc + m.meanLuma, 0) / metrics.length
  const avgWarmth = metrics.reduce((acc, m) => acc + m.warmthIndex, 0) / metrics.length
  let bestHero = metrics[0]!
  let bestHeroLoss = Infinity
  for (const m of metrics) {
    const loss =
      Math.abs(m.meanLuma - clamp(avgLuma, 0.35, 0.65)) * 1.5 +
      Math.abs(m.warmthIndex - avgWarmth) +
      (m.shadowClipRatio + m.highlightClipRatio) * 2
    if (loss < bestHeroLoss) {
      bestHeroLoss = loss
      bestHero = m
    }
  }

  return {
    continuityScore: Math.round(clamp(100 - penalty, 0, 100)),
    recommendedHeroShotId: bestHero.shotId,
    metrics,
    issues
  }
}

/**
 * 以指定主镜头（`heroShotIndex`）为色彩锚点，一键拉平全片所有分镜的色调与曝光分布
 */
export function harmonizeShotSequenceRgba(
  shots: ReadonlyArray<{
    shotId: string
    pixels: Uint8ClampedArray
    width: number
    height: number
  }>,
  heroShotIndex = 0,
  strength = 0.85
): Array<{
  shotId: string
  pixels: Uint8ClampedArray
  width: number
  height: number
}> {
  if (shots.length === 0) return []
  const safeHeroIdx = clamp(Math.floor(heroShotIndex), 0, shots.length - 1)
  const hero = shots[safeHeroIdx]!

  return shots.map((shot, idx) => {
    if (idx === safeHeroIdx) {
      return {
        shotId: shot.shotId,
        pixels: new Uint8ClampedArray(shot.pixels),
        width: shot.width,
        height: shot.height
      }
    }
    const harmonized = matchShotColorHistogramRgba(shot.pixels, hero.pixels, strength)
    return {
      shotId: shot.shotId,
      pixels: harmonized,
      width: shot.width,
      height: shot.height
    }
  })
}
