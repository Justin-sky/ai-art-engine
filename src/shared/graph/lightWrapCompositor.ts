/**
 * 发丝级边缘去色溢净化与 Nuke 级「物理环境光包裹」合成器
 * （Sub-Pixel Hair De-Fringing & Physical Light-Wrap Compositor）
 *
 * 解决证件照换底、抠图换背景与绿幕合成中的两大核心破绽：
 * 1. 半透明发丝边缘残留旧背景的白边/绿边/蓝边（Color Spill / Fringe）
 * 2. 前景人物像剪纸贴片一样生硬、不吃新背景的环境光与边缘散射光
 */

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * 亚像素发丝边缘去色溢与内侧纯净色彩延拓（Sub-Pixel Edge Decontamination）
 *
 * 自动检测半透明边缘带（`4 <= alpha <= 250`），寻找邻域内高不透明度（`alpha >= 240`）的纯净前景像素，
 * 将前景真实发色/肤色向外延拓覆盖半透明边缘中的杂色污染，并自动压制绿幕/蓝幕/白底残留色溢。
 */
export function decontaminateAlphaEdgeSpillRgba(
  fgPixels: Uint8ClampedArray,
  width: number,
  height: number,
  options?: {
    /** 去色溢与边缘色彩净化强度 0..1，默认 0.85 */
    strength?: number
    /** 内侧色彩向外搜索延拓半径（像素），默认 3 */
    searchRadiusPx?: number
  }
): Uint8ClampedArray {
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(1, Math.floor(height))
  const out = new Uint8ClampedArray(fgPixels)
  const strength = clamp01(options?.strength ?? 0.85)
  const radius = clamp(Math.floor(options?.searchRadiusPx ?? 3), 1, 8)

  if (strength <= 0.01) return out

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4
      const alpha = fgPixels[idx + 3] ?? 0
      // 仅针对半透明过渡带像素进行边缘色溢净化
      if (alpha < 4 || alpha > 250) continue

      let sumR = 0
      let sumG = 0
      let sumB = 0
      let weightSum = 0

      for (let dy = -radius; dy <= radius; dy++) {
        const sy = clamp(y + dy, 0, h - 1)
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx === 0 && dy === 0) continue
          const sx = clamp(x + dx, 0, w - 1)
          const nIdx = (sy * w + sx) * 4
          const nAlpha = fgPixels[nIdx + 3] ?? 0
          // 优先采信不透明度更高的内侧前景像素
          if (nAlpha > alpha + 18 && nAlpha >= 180) {
            const dist = Math.hypot(dx, dy)
            const wgt = nAlpha / 255 / Math.max(0.8, dist)
            sumR += (fgPixels[nIdx] ?? 0) * wgt
            sumG += (fgPixels[nIdx + 1] ?? 0) * wgt
            sumB += (fgPixels[nIdx + 2] ?? 0) * wgt
            weightSum += wgt
          }
        }
      }

      let r = fgPixels[idx] ?? 0
      let g = fgPixels[idx + 1] ?? 0
      let b = fgPixels[idx + 2] ?? 0

      // 绿幕色溢抑制（当 G 显著高于 R 与 B 的均值时）
      const rbAvg = (r + b) * 0.5
      if (g > rbAvg + 12) {
        g = rbAvg + (g - rbAvg) * (1 - strength * 0.85)
      }

      // 将内侧干净前景色彩按半透明程度混合到边缘
      if (weightSum > 0) {
        const cleanR = sumR / weightSum
        const cleanG = sumG / weightSum
        const cleanB = sumB / weightSum
        const edgeFactor = (1 - alpha / 255) * strength
        r = r * (1 - edgeFactor) + cleanR * edgeFactor
        g = g * (1 - edgeFactor) + cleanG * edgeFactor
        b = b * (1 - edgeFactor) + cleanB * edgeFactor
      }

      out[idx] = Math.round(clamp(r, 0, 255))
      out[idx + 1] = Math.round(clamp(g, 0, 255))
      out[idx + 2] = Math.round(clamp(b, 0, 255))
    }
  }

  return out
}

/**
 * Nuke 级物理环境光包裹与环境色自适应融合合成器（Physical Light-Wrap & Ambient Albedo Harmonizer）
 *
 * 将带 Alpha 通道的前景（`fgPixels`）与新背景（`bgPixels`）无痕合成：
 * 1. 先执行 `decontaminateAlphaEdgeSpillRgba` 消除发丝白边/绿边
 * 2. 计算新背景的平均色温与亮度，对前景暗部/中间调施加微量的环境反射光融合（`ambientColorMatch`）
 * 3. 在前景轮廓内侧按距离衰减包裹一层来自新背景的柔化环境高光（`lightWrapIntensity`）
 */
export function compositeWithPhysicalLightWrapRgba(
  fgPixels: Uint8ClampedArray,
  bgPixels: Uint8ClampedArray,
  width: number,
  height: number,
  options?: {
    /** 环境光向前景轮廓内侧包裹的半径（像素），默认 6 */
    lightWrapRadiusPx?: number
    /** 环境光包裹强度 0..1，默认 0.45 */
    lightWrapIntensity?: number
    /** 前景受新背景环境光反射融合强度 0..1，默认 0.25 */
    ambientColorMatch?: number
    /** 发丝边缘去色溢强度 0..1，默认 0.85 */
    deSpillStrength?: number
  }
): Uint8ClampedArray {
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(1, Math.floor(height))
  const wrapRadius = clamp(Math.floor(options?.lightWrapRadiusPx ?? 6), 1, 20)
  const wrapIntensity = clamp01(options?.lightWrapIntensity ?? 0.45)
  const ambientMatch = clamp01(options?.ambientColorMatch ?? 0.25)
  const deSpillStrength = clamp01(options?.deSpillStrength ?? 0.85)

  const cleanFg = decontaminateAlphaEdgeSpillRgba(fgPixels, w, h, {
    strength: deSpillStrength,
    searchRadiusPx: Math.min(5, Math.max(2, Math.round(wrapRadius * 0.5)))
  })

  // 统计新背景的平均环境色（用于前景暗部/中间调的环境反射融合）
  let bgSumR = 0
  let bgSumG = 0
  let bgSumB = 0
  let bgCount = 0
  const sampleStep = Math.max(1, Math.floor((w * h) / 2048))
  for (let p = 0; p < w * h; p += sampleStep) {
    const i = p * 4
    bgSumR += bgPixels[i] ?? 128
    bgSumG += bgPixels[i + 1] ?? 128
    bgSumB += bgPixels[i + 2] ?? 128
    bgCount++
  }
  const bgMeanR = bgCount > 0 ? bgSumR / bgCount : 128
  const bgMeanG = bgCount > 0 ? bgSumG / bgCount : 128
  const bgMeanB = bgCount > 0 ? bgSumB / bgCount : 128

  const out = new Uint8ClampedArray(w * h * 4)

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4
      const fgA = (cleanFg[idx + 3] ?? 0) / 255
      const bgR = bgPixels[idx] ?? 0
      const bgG = bgPixels[idx + 1] ?? 0
      const bgB = bgPixels[idx + 2] ?? 0

      if (fgA <= 0.002) {
        out[idx] = bgR
        out[idx + 1] = bgG
        out[idx + 2] = bgB
        out[idx + 3] = 255
        continue
      }

      let fgR = cleanFg[idx] ?? 0
      let fgG = cleanFg[idx + 1] ?? 0
      let fgB = cleanFg[idx + 2] ?? 0

      // 1. 环境反射光自适应融合（暗部与中间调更容易吸收背景环境光色偏）
      if (ambientMatch > 0.01) {
        const fgLuma01 = (0.2126 * fgR + 0.7152 * fgG + 0.0722 * fgB) / 255
        const shadowMidWeight = (1 - Math.abs(fgLuma01 - 0.38)) * ambientMatch * 0.35
        fgR += (bgMeanR - 128) * shadowMidWeight
        fgG += (bgMeanG - 128) * shadowMidWeight
        fgB += (bgMeanB - 128) * shadowMidWeight
      }

      // 2. 物理环境光包裹（Light-Wrap）：检测邻域内的背景透明空洞占比与局部背景亮度
      if (wrapIntensity > 0.01) {
        let bgExposureSum = 0
        let wrapBrR = 0
        let wrapBrG = 0
        let wrapBrB = 0
        let sampleCnt = 0
        const rStep = Math.max(1, Math.floor(wrapRadius / 3))

        for (let dy = -wrapRadius; dy <= wrapRadius; dy += rStep) {
          const sy = clamp(y + dy, 0, h - 1)
          for (let dx = -wrapRadius; dx <= wrapRadius; dx += rStep) {
            const sx = clamp(x + dx, 0, w - 1)
            const nIdx = (sy * w + sx) * 4
            const nFgA = (cleanFg[nIdx + 3] ?? 0) / 255
            const bgTransparency = 1 - nFgA
            const dist = Math.hypot(dx, dy)
            const decay = Math.exp(-dist / Math.max(1, wrapRadius * 0.55))
            const weight = bgTransparency * decay
            bgExposureSum += weight
            wrapBrR += (bgPixels[nIdx] ?? bgR) * weight
            wrapBrG += (bgPixels[nIdx + 1] ?? bgG) * weight
            wrapBrB += (bgPixels[nIdx + 2] ?? bgB) * weight
            sampleCnt += decay
          }
        }

        if (bgExposureSum > 0.02 && sampleCnt > 0) {
          const edgeProximity = clamp01((bgExposureSum / sampleCnt) * 2.2)
          const localBgR = wrapBrR / bgExposureSum
          const localBgG = wrapBrG / bgExposureSum
          const localBgB = wrapBrB / bgExposureSum
          const localBgLuma = (0.2126 * localBgR + 0.7152 * localBgG + 0.0722 * localBgB) / 255
          const wrapAmount = edgeProximity * wrapIntensity * (0.35 + localBgLuma * 0.65)

          // Screen + 柔光混合包裹到前景边缘
          fgR = 255 - ((255 - clamp(fgR, 0, 255)) * (255 - localBgR * wrapAmount)) / 255
          fgG = 255 - ((255 - clamp(fgG, 0, 255)) * (255 - localBgG * wrapAmount)) / 255
          fgB = 255 - ((255 - clamp(fgB, 0, 255)) * (255 - localBgB * wrapAmount)) / 255
        }
      }

      // 3. 标准 Alpha Over 合成
      out[idx] = Math.round(clamp(fgR * fgA + bgR * (1 - fgA), 0, 255))
      out[idx + 1] = Math.round(clamp(fgG * fgA + bgG * (1 - fgA), 0, 255))
      out[idx + 2] = Math.round(clamp(fgB * fgA + bgB * (1 - fgA), 0, 255))
      out[idx + 3] = 255
    }
  }

  return out
}
