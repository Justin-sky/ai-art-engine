import { describe, expect, it } from 'vitest'
import {
  analyzeAssetQc,
  applyAssetQcFringeFix,
  checkAssetQcNaming,
  findAlphaHoles,
  isSafeAssetName,
  resolveAssetQcOptions,
  summarizeAssetQc,
  suggestAssetQcName,
  type AssetQcInput
} from '../src/shared/gameAssets/assetQc'
import { extractAlphaPlane } from '../src/shared/gameAssets/stage2dAutoPart'

interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

const SOLID_BLUE: Rgba = { r: 30, g: 30, b: 200, a: 255 }
/** 抠图工具输出的未预乘透明像素：保留原背景色（白） */
const TRANSPARENT_WHITE: Rgba = { r: 255, g: 255, b: 255, a: 0 }
/** 白底抠图的羽化边缘：前景 × 0.5 + 白背景 × 0.5 */
const WHITE_BLENDED_EDGE: Rgba = { r: 143, g: 143, b: 227, a: 128 }

function makeImage(width: number, height: number, fill: Rgba = TRANSPARENT_WHITE): AssetQcInput {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = fill.r
    data[i * 4 + 1] = fill.g
    data[i * 4 + 2] = fill.b
    data[i * 4 + 3] = fill.a
  }
  return { data, width, height }
}

function paint(img: AssetQcInput, x: number, y: number, color: Rgba): void {
  const p = (y * img.width + x) * 4
  img.data[p] = color.r
  img.data[p + 1] = color.g
  img.data[p + 2] = color.b
  img.data[p + 3] = color.a
}

function fillRect(
  img: AssetQcInput,
  x0: number,
  y0: number,
  width: number,
  height: number,
  color: Rgba
): void {
  for (let y = y0; y < y0 + height; y += 1) {
    for (let x = x0; x < x0 + width; x += 1) paint(img, x, y, color)
  }
}

function alphaOf(img: AssetQcInput): Uint8Array {
  const alpha = extractAlphaPlane(img.data, img.width, img.height)
  if (!alpha) throw new Error('alpha plane unavailable')
  return alpha
}

/** 干净的抠图件：32×32 画布，中心 16×16 实心主体，四周是正常留白 */
function makeCleanCutout(): AssetQcInput {
  const img = makeImage(32, 32)
  fillRect(img, 8, 8, 16, 16, SOLID_BLUE)
  return img
}

/** 白底抠图残留：主体外圈一圈被白背景污染的羽化边缘 */
function makeFringedCutout(): AssetQcInput {
  const img = makeImage(32, 32)
  fillRect(img, 8, 8, 16, 16, SOLID_BLUE)
  for (let y = 7; y <= 24; y += 1) {
    paint(img, 7, y, WHITE_BLENDED_EDGE)
    paint(img, 24, y, WHITE_BLENDED_EDGE)
  }
  for (let x = 7; x <= 24; x += 1) {
    paint(img, x, 7, WHITE_BLENDED_EDGE)
    paint(img, x, 24, WHITE_BLENDED_EDGE)
  }
  return img
}

describe('资产质检：主体与外接框', () => {
  it('干净抠图件不报任何问题', () => {
    const report = analyzeAssetQc(makeCleanCutout())
    expect(report.issues).toEqual([])
    expect(report.metrics.bounds).toEqual({ x: 8, y: 8, width: 16, height: 16 })
    expect(report.metrics.coverage).toBeCloseTo(0.25, 4)
    expect(report.metrics.solidCount).toBe(256)
  })

  it('全透明资产报 error 级空图，不再给其余维度', () => {
    const report = analyzeAssetQc(makeImage(8, 8))
    expect(report.issues).toHaveLength(1)
    expect(report.issues[0]!.code).toBe('empty-image')
    expect(report.issues[0]!.severity).toBe('error')
    expect(report.issues[0]!.fixable).toBe(false)
    expect(report.metrics.bounds).toBeNull()
    expect(report.metrics.coverage).toBe(0)
  })

  it('主体贴住画布边时报可能被裁切（仅报告，不自动改画布）', () => {
    const img = makeImage(16, 16)
    fillRect(img, 0, 4, 8, 8, SOLID_BLUE)
    const issue = analyzeAssetQc(img).issues.find((item) => item.code === 'bounds-touch-edge')
    expect(issue).toBeDefined()
    expect(issue!.severity).toBe('warn')
    expect(issue!.fixable).toBe(false)
    expect(issue!.metrics.x).toBe(0)
  })

  it('尺寸超上限报 oversize', () => {
    const img = makeImage(9000, 1, SOLID_BLUE)
    const issue = analyzeAssetQc(img).issues.find((item) => item.code === 'oversize')
    expect(issue).toBeDefined()
    expect(issue!.metrics.maxSize).toBe(8192)
    expect(issue!.metrics.width).toBe(9000)
  })
})

describe('资产质检：抠图漏底（内部孔洞）', () => {
  it('主体内部透明孔洞被检出，且报出面积证据', () => {
    const img = makeImage(32, 32, SOLID_BLUE)
    fillRect(img, 14, 14, 4, 4, TRANSPARENT_WHITE)
    const issue = analyzeAssetQc(img).issues.find((item) => item.code === 'transparent-hole')
    expect(issue).toBeDefined()
    expect(issue!.severity).toBe('warn')
    // 镂空可能是刻意设计，因此只报告、不自动填
    expect(issue!.fixable).toBe(false)
    expect(issue!.metrics.count).toBe(1)
    expect(issue!.metrics.largestArea).toBe(16)
  })

  it('与画布边界连通的透明区是正常留白，不算孔洞', () => {
    const img = makeImage(16, 16, SOLID_BLUE)
    fillRect(img, 0, 0, 8, 16, TRANSPARENT_WHITE)
    expect(findAlphaHoles(alphaOf(img), 16, 16, { holeMinArea: 1 }).count).toBe(0)
  })

  it('小于最小面积的孔洞不报（抗锯齿噪点保护），放宽阈值即可检出', () => {
    const img = makeImage(32, 32, SOLID_BLUE)
    fillRect(img, 15, 15, 2, 2, TRANSPARENT_WHITE)
    expect(analyzeAssetQc(img).issues.some((item) => item.code === 'transparent-hole')).toBe(false)
    const loose = findAlphaHoles(alphaOf(img), 32, 32, { holeMinArea: 1 })
    expect(loose.count).toBe(1)
    expect(loose.largestArea).toBe(4)
    expect(loose.largestAt).toEqual({ x: 15, y: 15 })
  })

  it('多个孔洞按面积累计，最大孔洞单独报出', () => {
    const img = makeImage(40, 40, SOLID_BLUE)
    fillRect(img, 4, 4, 4, 4, TRANSPARENT_WHITE)
    fillRect(img, 20, 20, 6, 6, TRANSPARENT_WHITE)
    const holes = findAlphaHoles(alphaOf(img), 40, 40, { holeMinArea: 1 })
    expect(holes.count).toBe(2)
    expect(holes.largestArea).toBe(36)
    expect(holes.totalArea).toBe(52)
    expect(holes.largestAt).toEqual({ x: 20, y: 20 })
  })
})

describe('资产质检：边缘白边与自动返工闭环', () => {
  it('白底抠图残留的亮边被检出，并标记为可自动返工', () => {
    const report = analyzeAssetQc(makeFringedCutout())
    const issue = report.issues.find((item) => item.code === 'edge-fringe')
    expect(issue).toBeDefined()
    expect(issue!.severity).toBe('warn')
    expect(issue!.fixable).toBe(true)
    expect(report.metrics.translucentCount).toBe(68)
    // 边缘亮度显著高于实心主体：这是「背景色残留」的量化证据
    expect(report.metrics.lumaDelta).toBeGreaterThan(32)
    expect(report.metrics.lumaDelta).toBeCloseTo(103, 0)
  })

  it('去污染返工后边缘亮度偏移回到阈值内（修复闭环可验证）', () => {
    const img = makeFringedCutout()
    const before = analyzeAssetQc(img)
    applyAssetQcFringeFix(img)
    const after = analyzeAssetQc(img)

    expect(after.metrics.lumaDelta).toBeLessThan(before.metrics.lumaDelta)
    expect(after.metrics.lumaDelta).toBeLessThan(32)
    expect(after.issues.some((item) => item.code === 'edge-fringe')).toBe(false)
    // 去污染只改颜色通道，alpha 与主体外接框原样保留
    expect(after.metrics.bounds).toEqual(before.metrics.bounds)
    expect(after.metrics.translucentCount).toBe(before.metrics.translucentCount)
    expect(after.metrics.solidCount).toBe(before.metrics.solidCount)
  })

  it('半透明像素过少时不判边缘问题（阈值保护）', () => {
    const img = makeCleanCutout()
    paint(img, 7, 7, { r: 250, g: 250, b: 250, a: 128 })
    const report = analyzeAssetQc(img)
    expect(report.metrics.translucentCount).toBe(1)
    expect(report.issues.some((item) => item.code === 'edge-fringe')).toBe(false)
  })

  it('孤立半透明碎屑报 info 级，不误判为边缘白边', () => {
    const img = makeImage(32, 32)
    fillRect(img, 8, 8, 8, 8, SOLID_BLUE)
    let placed = 0
    for (const y of [2, 30]) {
      for (let x = 2; x <= 30 && placed < 24; x += 2) {
        paint(img, x, y, { r: 255, g: 255, b: 255, a: 128 })
        placed += 1
      }
    }
    expect(placed).toBe(24)
    const report = analyzeAssetQc(img)
    expect(report.metrics.noiseCount).toBe(24)
    const noise = report.issues.find((item) => item.code === 'alpha-noise')
    expect(noise).toBeDefined()
    expect(noise!.severity).toBe('info')
    expect(noise!.fixable).toBe(false)
    // 碎屑虽近白，但半透明像素太少，不该升级成边缘白边
    expect(report.issues.some((item) => item.code === 'edge-fringe')).toBe(false)
  })
})

describe('资产质检：命名规范与参数归一化', () => {
  it('kebab-case 通过；含空白 / 下划线 / 大写视为不合规', () => {
    expect(isSafeAssetName('hero-idle-01')).toBe(true)
    expect(isSafeAssetName('hero_idle')).toBe(false)
    expect(isSafeAssetName('Hero-Idle')).toBe(false)
    expect(isSafeAssetName('  ')).toBe(false)
  })

  it('不合规命名给 info 级问题，并可由原名推导建议名', () => {
    const issue = checkAssetQcNaming('Hero Idle_02')
    expect(issue?.code).toBe('naming')
    expect(issue?.severity).toBe('info')
    expect(issue?.fixable).toBe(false)
    expect(checkAssetQcNaming('hero-idle-02')).toBeNull()
    expect(suggestAssetQcName('Hero Idle_02.PNG')).toBe('hero-idle-02')
    expect(suggestAssetQcName('主角 待机.png')).toBe('主角-待机')
  })

  it('阈值归一化：越界值夹取回可用区间', () => {
    const opts = resolveAssetQcOptions({ holeRatio: 5, alphaSolid: -3, minTranslucent: -1 })
    expect(opts.holeRatio).toBe(1)
    expect(opts.alphaSolid).toBe(1)
    expect(opts.minTranslucent).toBe(0)
    expect(resolveAssetQcOptions(null).fringeLumaDelta).toBe(32)
  })
})

describe('资产质检：批量汇总', () => {
  it('汇总问题计数与可自动返工的问题码', () => {
    const clean = analyzeAssetQc(makeCleanCutout())
    const fringed = analyzeAssetQc(makeFringedCutout())
    const empty = analyzeAssetQc(makeImage(8, 8))
    const summary = summarizeAssetQc([clean, fringed, empty])
    expect(summary.total).toBe(3)
    expect(summary.flagged).toBe(2)
    expect(summary.errors).toBe(1)
    expect(summary.fixable).toEqual(['edge-fringe'])
  })
})
