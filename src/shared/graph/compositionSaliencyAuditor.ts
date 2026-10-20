/**
 * 「人眼注视追踪」显著性热力图与黄金构图诊断仪
 * （Eye-Tracking Visual Saliency Heatmap & Golden Composition Auditor）
 *
 * 1. 基于多尺度中心-周边对比度、肤色/暖调视觉引力、局部高频边缘密度计算人眼 3 秒视觉显著性场（`0..1`）
 * 2. 渲染科学级 Turbo/Inferno 伪彩热力云图叠加层（`renderEyeTrackingHeatmapRgba`）
 * 3. 自动评测三分法（Rule of Thirds）、黄金螺旋（Fibonacci Spiral）、中轴对称、对角线张力与头顶留白得分
 * 4. 自动给出最优二次黄金构图裁切框（`recommendedCropBox`）与全图最干净的「最佳文案/Logo 负空间安全区」（`copywritingSafeZone`）
 */

export interface NormalizedRect {
  x: number
  y: number
  width: number
  height: number
}

export interface CopywritingSafeZone extends NormalizedRect {
  regionId:
    'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top-center' | 'bottom-center'
  regionNameZh: string
  regionNameEn: string
  /** 区域内平均视觉干扰显著度 0..1（越低越适合排字） */
  meanSaliency: number
  /** 区域平均背景亮度 0..1 */
  meanLuma: number
  /** 自动推荐的高反差文字主色 Hex */
  recommendedTextColorHex: '#ffffff' | '#111827'
}

export interface GoldenCompositionAuditReport {
  /** 综合构图美学评分 0..100 */
  overallScore: number
  /** 视觉注意力重心归一化坐标 (0..1) */
  visualCenter: { x: number; y: number }
  /** 峰值视觉焦点归一化坐标 (0..1) */
  peakFocusPoint: { x: number; y: number }
  /** 五大构图法则单项分 0..100 */
  ruleScores: {
    ruleOfThirds: number
    goldenSpiral: number
    centerSymmetry: number
    diagonalBalance: number
    headroomBalance: number
  }
  bestMatchedRule: 'rule-of-thirds' | 'golden-spiral' | 'center-symmetry' | 'diagonal'
  /** 推荐二次构图黄金裁切框（将峰值焦点锚定到最近的三分点/黄金点） */
  recommendedCropBox: NormalizedRect
  /** 自动寻址出的最佳标题/字幕/Logo 摆放负空间矩形区 */
  copywritingSafeZone: CopywritingSafeZone
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * 计算单张图像的归一化人眼视觉显著性场（`Float32Array`，长度 `width * height`，`1.0` = 最吸引眼球的核心焦点）
 */
export function computeVisualSaliencyMap(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): Float32Array {
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(1, Math.floor(height))
  const total = w * h
  const saliency = new Float32Array(total)

  // 1. 计算全图平均亮度与色度基线（用于 Center-Surround 全局反差显著性）
  let sumLuma = 0
  let sumR = 0
  let sumG = 0
  let sumB = 0
  const step = Math.max(1, Math.floor(total / 2048))
  let count = 0
  for (let p = 0; p < total; p += step) {
    const i = p * 4
    const r = (pixels[i] ?? 0) / 255
    const g = (pixels[i + 1] ?? 0) / 255
    const b = (pixels[i + 2] ?? 0) / 255
    sumLuma += 0.2126 * r + 0.7152 * g + 0.0722 * b
    sumR += r
    sumG += g
    sumB += b
    count++
  }
  const meanLuma = count > 0 ? sumLuma / count : 0.5
  const meanR = count > 0 ? sumR / count : 0.5
  const meanG = count > 0 ? sumG / count : 0.5
  const meanB = count > 0 ? sumB / count : 0.5

  let maxVal = 1e-5

  for (let y = 0; y < h; y++) {
    const ny = (y + 0.5) / h
    const yDown = Math.min(h - 1, y + 1)
    for (let x = 0; x < w; x++) {
      const nx = (x + 0.5) / w
      const xRight = Math.min(w - 1, x + 1)
      const i = (y * w + x) * 4

      const r = (pixels[i] ?? 0) / 255
      const g = (pixels[i + 1] ?? 0) / 255
      const b = (pixels[i + 2] ?? 0) / 255
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b

      // A. 全局稀有度反差（与全图背景色差越大越抓眼）
      const colorDist = Math.hypot(r - meanR, g - meanG, b - meanB)
      const lumaContrast = Math.abs(luma - meanLuma)

      // B. 局部高频纹理与边缘能量（眼睛优先注视清晰细节）
      const iRight = (y * w + xRight) * 4
      const iDown = (yDown * w + x) * 4
      const rRight = (pixels[iRight] ?? 0) / 255
      const gRight = (pixels[iRight + 1] ?? 0) / 255
      const rDown = (pixels[iDown] ?? 0) / 255
      const gDown = (pixels[iDown + 1] ?? 0) / 255
      const edgeEnergy = clamp01(
        (Math.abs(r - rRight) + Math.abs(g - gRight) + Math.abs(r - rDown) + Math.abs(g - gDown)) *
          2.4
      )

      // C. 人类视觉暖色与肤色偏好先验（Warmth / Skin-Tone Opponency）
      const warmSalience = clamp01((r - b) * 1.15 + (r - g) * 0.45)

      // D. 温和的视野先验（画幅极端四角边缘权重微降，但保留三分点高敏度）
      const borderDist = Math.hypot((nx - 0.5) / 0.65, (ny - 0.48) / 0.65)
      const spatialPrior = Math.exp(-borderDist * borderDist * 0.45)

      const val =
        (colorDist * 0.34 + lumaContrast * 0.22 + edgeEnergy * 0.26 + warmSalience * 0.18) *
        (0.65 + spatialPrior * 0.35)

      saliency[y * w + x] = val
      if (val > maxVal) maxVal = val
    }
  }

  for (let i = 0; i < total; i++) {
    saliency[i] = clamp01(saliency[i]! / maxVal)
  }

  return saliency
}

/**
 * 将视觉显著性值 `0..1` 映射为科学级热力图伪彩 RGB（深蓝 -> 青绿 -> 亮黄 -> 炽红 -> 白热核心）
 */
function saliencyToHeatmapRgb(s: number): [number, number, number] {
  const v = clamp01(s)
  if (v < 0.25) {
    const t = v / 0.25
    return [Math.round(15 + t * 10), Math.round(25 + t * 155), Math.round(95 + t * 145)]
  }
  if (v < 0.5) {
    const t = (v - 0.25) / 0.25
    return [Math.round(25 + t * 145), Math.round(180 + t * 65), Math.round(240 - t * 170)]
  }
  if (v < 0.78) {
    const t = (v - 0.5) / 0.28
    return [Math.round(170 + t * 85), Math.round(245 - t * 135), Math.round(70 - t * 55)]
  }
  const t = (v - 0.78) / 0.22
  return [255, Math.round(110 + t * 130), Math.round(15 + t * 210)]
}

/**
 * 渲染「人眼 3 秒注视热力图」叠加画面（底图自动压暗去饱和，突出高注视度热力云团）
 */
export function renderEyeTrackingHeatmapRgba(
  sourcePixels: Uint8ClampedArray,
  width: number,
  height: number,
  saliencyMap?: Float32Array,
  blendAlpha = 0.68
): Uint8ClampedArray {
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(1, Math.floor(height))
  const sal = saliencyMap ?? computeVisualSaliencyMap(sourcePixels, w, h)
  const alpha = clamp01(blendAlpha)
  const out = new Uint8ClampedArray(w * h * 4)

  for (let p = 0; p < w * h; p++) {
    const i = p * 4
    const r = sourcePixels[i] ?? 0
    const g = sourcePixels[i + 1] ?? 0
    const b = sourcePixels[i + 2] ?? 0
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    // 将原图转为暗调灰底，让热力色标清晰可读
    const baseGray = luma * 0.55

    const s = sal[p] ?? 0
    const [hr, hg, hb] = saliencyToHeatmapRgb(s)
    // 显著度越高的地方热力层越不透明
    const localBlend = clamp01(alpha * (0.28 + s * 0.72))

    out[i] = Math.round(baseGray * (1 - localBlend) + hr * localBlend)
    out[i + 1] = Math.round(baseGray * (1 - localBlend) + hg * localBlend)
    out[i + 2] = Math.round(baseGray * (1 - localBlend) + hb * localBlend)
    out[i + 3] = sourcePixels[i + 3] ?? 255
  }

  return out
}

/**
 * 执行黄金构图美学诊断，并自动计算「最佳二次黄金裁切框」与「最佳文案/Logo 负空间安全区」
 */
export function auditGoldenComposition(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  saliencyMap?: Float32Array
): GoldenCompositionAuditReport {
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(1, Math.floor(height))
  const sal = saliencyMap ?? computeVisualSaliencyMap(pixels, w, h)

  // 1. 计算视觉质量重心（Center of Visual Mass）与最高显著性峰值点
  let sumWeight = 0
  let sumWx = 0
  let sumWy = 0
  let peakVal = -1
  let peakX = 0.5
  let peakY = 0.5

  for (let y = 0; y < h; y++) {
    const ny = (y + 0.5) / h
    for (let x = 0; x < w; x++) {
      const nx = (x + 0.5) / w
      const s = sal[y * w + x] ?? 0
      // 高显著区三次方加权，精准锁定主体重心
      const wgt = s * s * s + 1e-5
      sumWeight += wgt
      sumWx += nx * wgt
      sumWy += ny * wgt
      if (s > peakVal) {
        peakVal = s
        peakX = nx
        peakY = ny
      }
    }
  }

  const cx = sumWeight > 0 ? sumWx / sumWeight : 0.5
  const cy = sumWeight > 0 ? sumWy / sumWeight : 0.5

  // 2. 评测五大构图法则得分
  // (A) 三分法（距离四个 1/3 交点最近的距离）
  const thirdsPoints: Array<[number, number]> = [
    [1 / 3, 1 / 3],
    [2 / 3, 1 / 3],
    [1 / 3, 2 / 3],
    [2 / 3, 2 / 3]
  ]
  let minThirdsDist = Infinity
  let nearestThirdPt: [number, number] = [1 / 3, 1 / 3]
  for (const pt of thirdsPoints) {
    const d = Math.hypot(peakX - pt[0], peakY - pt[1])
    if (d < minThirdsDist) {
      minThirdsDist = d
      nearestThirdPt = pt
    }
  }
  const ruleOfThirds = Math.round(clamp(100 - minThirdsDist * 210, 35, 100))

  // (B) 斐波那契黄金螺旋点 (0.382 / 0.618)
  const goldenPoints: Array<[number, number]> = [
    [0.382, 0.382],
    [0.618, 0.382],
    [0.382, 0.618],
    [0.618, 0.618]
  ]
  const minGoldenDist = Math.min(...goldenPoints.map((pt) => Math.hypot(cx - pt[0], cy - pt[1])))
  const goldenSpiral = Math.round(clamp(100 - minGoldenDist * 220, 35, 100))

  // (C) 中轴对称构图（水平重心接近 0.5）
  const centerSymmetry = Math.round(clamp(100 - Math.abs(cx - 0.5) * 260, 30, 100))

  // (D) 对角线张力（重心接近主/副对角线 y=x 或 y=1-x）
  const diagDist = Math.min(Math.abs(cy - cx), Math.abs(cy - (1 - cx))) / Math.SQRT2
  const diagonalBalance = Math.round(clamp(100 - diagDist * 240, 35, 100))

  // (E) 头顶留白与垂直平衡（最佳视觉重心在 y ∈ [0.36, 0.52]）
  const headroomDev = cy < 0.36 ? 0.36 - cy : cy > 0.56 ? cy - 0.56 : 0
  const headroomBalance = Math.round(clamp(100 - headroomDev * 280, 40, 100))

  const ruleRanking: Array<{
    id: GoldenCompositionAuditReport['bestMatchedRule']
    score: number
  }> = [
    { id: 'rule-of-thirds', score: ruleOfThirds },
    { id: 'golden-spiral', score: goldenSpiral },
    { id: 'center-symmetry', score: centerSymmetry },
    { id: 'diagonal', score: diagonalBalance }
  ]
  ruleRanking.sort((a, b) => b.score - a.score)
  const bestMatchedRule = ruleRanking[0]!.id

  const overallScore = Math.round(
    clamp(
      ruleRanking[0]!.score * 0.45 + ruleRanking[1]!.score * 0.25 + headroomBalance * 0.3,
      0,
      100
    )
  )

  // 3. 计算推荐二次黄金构图裁切框（保持 88% 画幅，平移窗口使峰值点贴合最近的三分点）
  const cropScale = 0.88
  const targetX = clamp(peakX - nearestThirdPt[0] * cropScale, 0, 1 - cropScale)
  const targetY = clamp(peakY - nearestThirdPt[1] * cropScale, 0, 1 - cropScale)
  const recommendedCropBox: NormalizedRect = {
    x: Number(targetX.toFixed(4)),
    y: Number(targetY.toFixed(4)),
    width: cropScale,
    height: cropScale
  }

  // 4. 自动寻址最佳「文案/标题/Logo 留白负空间安全区」（扫描 6 个候选版式区，挑显著度最低、最不挡主体的一块）
  const candidateZones: Array<{
    id: CopywritingSafeZone['regionId']
    zh: string
    en: string
    rect: NormalizedRect
  }> = [
    {
      id: 'top-left',
      zh: '左上角留白区',
      en: 'Top-Left Negative Space',
      rect: { x: 0.05, y: 0.05, width: 0.38, height: 0.22 }
    },
    {
      id: 'top-right',
      zh: '右上角留白区',
      en: 'Top-Right Negative Space',
      rect: { x: 0.57, y: 0.05, width: 0.38, height: 0.22 }
    },
    {
      id: 'bottom-left',
      zh: '左下角字幕/标题区',
      en: 'Bottom-Left Title Zone',
      rect: { x: 0.05, y: 0.72, width: 0.42, height: 0.22 }
    },
    {
      id: 'bottom-right',
      zh: '右下角落款/角标区',
      en: 'Bottom-Right Badge Zone',
      rect: { x: 0.53, y: 0.72, width: 0.42, height: 0.22 }
    },
    {
      id: 'top-center',
      zh: '顶部通栏海报标题区',
      en: 'Top Banner Header Zone',
      rect: { x: 0.15, y: 0.04, width: 0.7, height: 0.18 }
    },
    {
      id: 'bottom-center',
      zh: '底部电影字幕通栏区',
      en: 'Bottom Subtitle Banner Zone',
      rect: { x: 0.12, y: 0.76, width: 0.76, height: 0.18 }
    }
  ]

  let bestZone: CopywritingSafeZone | null = null
  for (const cand of candidateZones) {
    const x0 = clamp(Math.floor(cand.rect.x * w), 0, w - 1)
    const x1 = clamp(Math.ceil((cand.rect.x + cand.rect.width) * w), x0 + 1, w)
    const y0 = clamp(Math.floor(cand.rect.y * h), 0, h - 1)
    const y1 = clamp(Math.ceil((cand.rect.y + cand.rect.height) * h), y0 + 1, h)

    let sSum = 0
    let lSum = 0
    let cnt = 0
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        sSum += sal[y * w + x] ?? 0
        const idx = (y * w + x) * 4
        const l =
          (0.2126 * (pixels[idx] ?? 0) +
            0.7152 * (pixels[idx + 1] ?? 0) +
            0.0722 * (pixels[idx + 2] ?? 0)) /
          255
        lSum += l
        cnt++
      }
    }

    const meanSal = cnt > 0 ? sSum / cnt : 0.5
    const meanLuma = cnt > 0 ? lSum / cnt : 0.5
    const zoneObj: CopywritingSafeZone = {
      ...cand.rect,
      regionId: cand.id,
      regionNameZh: cand.zh,
      regionNameEn: cand.en,
      meanSaliency: Number(meanSal.toFixed(4)),
      meanLuma: Number(meanLuma.toFixed(4)),
      recommendedTextColorHex: meanLuma > 0.56 ? '#111827' : '#ffffff'
    }

    if (!bestZone || zoneObj.meanSaliency < bestZone.meanSaliency) {
      bestZone = zoneObj
    }
  }

  return {
    overallScore,
    visualCenter: {
      x: Number(cx.toFixed(4)),
      y: Number(cy.toFixed(4))
    },
    peakFocusPoint: {
      x: Number(peakX.toFixed(4)),
      y: Number(peakY.toFixed(4))
    },
    ruleScores: {
      ruleOfThirds,
      goldenSpiral,
      centerSymmetry,
      diagonalBalance,
      headroomBalance
    },
    bestMatchedRule,
    recommendedCropBox,
    copywritingSafeZone: bestZone!
  }
}
