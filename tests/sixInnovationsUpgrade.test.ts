import { describe, expect, it } from 'vitest'
import {
  applyCanvasMacroPlan,
  compileNaturalLanguageCanvasMacro,
  computeWatermarkPsnrDb,
  embedInvisiblePixelWatermarkRgba,
  estimatePseudoDepthMap,
  evaluateShotSequenceContinuity,
  extractImageStyleDna,
  extractInvisiblePixelWatermarkRgba,
  generateParallaxSequenceRgba,
  harmonizeShotSequenceRgba,
  parseCubeLut,
  renderLightingVariantGridRgba,
  renderPortraitVariantGridRgba,
  serializeCubeLutToText,
  synthesizeCubeLutFromStyleDna,
  type GraphDocument
} from '../src/shared/graph'

function makeSyntheticWarmRimPortraitRgba(width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const ny = y / Math.max(1, height - 1)
    for (let x = 0; x < width; x++) {
      const nx = x / Math.max(1, width - 1)
      const idx = (y * width + x) * 4
      // 右上侧强烈暖色主光 + 边缘亮轮廓光
      const rightTopLight = Math.max(0, nx * 0.7 + (1 - ny) * 0.5)
      const isEdge = nx < 0.12 || nx > 0.88 || ny < 0.12 || ny > 0.88
      const rimBoost = isEdge ? 55 : 0
      out[idx] = Math.min(255, Math.round(90 + rightTopLight * 135 + rimBoost))
      out[idx + 1] = Math.min(255, Math.round(65 + rightTopLight * 95 + rimBoost * 0.8))
      out[idx + 2] = Math.min(255, Math.round(45 + rightTopLight * 55 + rimBoost * 0.5))
      out[idx + 3] = 255
    }
  }
  return out
}

describe('Six Innovative Capabilities Suite', () => {
  it('1. AI Style & Lighting DNA Reverse-Engineering + .cube 3D LUT synthesis round-trip', () => {
    const w = 48
    const h = 48
    const pixels = makeSyntheticWarmRimPortraitRgba(w, h)
    const dna = extractImageStyleDna(pixels, w, h, ' WongKarWai_Ref ')

    expect(dna.title).toBe('WongKarWai_Ref')
    // 暖调（红 > 蓝）
    expect(dna.warmthScore).toBeGreaterThan(0.1)
    // 右侧偏上来光：estimatedYaw > 0, estimatedPitch > 0
    expect(dna.estimatedYaw).toBeGreaterThan(0)
    expect(dna.estimatedPitch).toBeGreaterThan(0)
    expect(dna.keyLightColorHex).toMatch(/^#[0-9a-f]{6}$/i)
    expect(dna.recommendedPortraitPatch.colorTemp).toBeDefined()
    expect(dna.recommendedLightingSetup.yaw).toBe(dna.estimatedYaw)

    // 合成 9×9×9 .cube 3D LUT 并序列化再由 parseCubeLut 解析回环验证
    const cube = synthesizeCubeLutFromStyleDna(dna, 9)
    expect(cube.size).toBe(9)
    expect(cube.table.length).toBe(9 * 9 * 9 * 3)

    const cubeText = serializeCubeLutToText(cube)
    expect(cubeText).toContain('LUT_3D_SIZE 9')
    const reparsed = parseCubeLut(cubeText, cube.name)
    expect(reparsed).not.toBeNull()
    expect(reparsed!.size).toBe(9)
    expect(reparsed!.table.length).toBe(9 * 9 * 9 * 3)
  })

  it('2. Parallel Universe Live Variant Matrix & Client Contact Sheet (Portrait & Lighting 2x2)', () => {
    const w = 32
    const h = 24
    const src = makeSyntheticWarmRimPortraitRgba(w, h)

    const portraitSheet = renderPortraitVariantGridRgba(src, w, h)
    expect(portraitSheet.cells.length).toBe(4)
    expect(portraitSheet.width).toBeGreaterThan(w)
    expect(portraitSheet.height).toBeGreaterThan(h)
    expect(portraitSheet.pixels.length).toBe(portraitSheet.width * portraitSheet.height * 4)

    const lightingSheet = renderLightingVariantGridRgba(src, w, h)
    expect(lightingSheet.cells.length).toBe(4)
    expect(lightingSheet.pixels.length).toBe(lightingSheet.width * lightingSheet.height * 4)
  })

  it('3. Single-Image 2.5D Parallax Camera Rig & Hitchcock Dolly Zoom sequence', () => {
    const w = 36
    const h = 28
    const src = makeSyntheticWarmRimPortraitRgba(w, h)
    const depth = estimatePseudoDepthMap(src, w, h)
    expect(depth.length).toBe(w * h)
    // 中心区域深度应显著高于四角远景
    const centerDepth = depth[Math.floor(h * 0.46) * w + Math.floor(w * 0.5)]!
    const cornerDepth = depth[0]!
    expect(centerDepth).toBeGreaterThan(cornerDepth)

    const seq = generateParallaxSequenceRgba(src, w, h, {
      preset: 'dolly-zoom',
      frameCount: 5,
      intensity: 1.2
    })
    expect(seq.frames.length).toBe(5)
    expect(seq.frames[0]!.length).toBe(w * h * 4)
    // 首帧与尾帧像素应发生视差位移变化
    let diffSum = 0
    for (let i = 0; i < seq.frames[0]!.length; i += 4) {
      diffSum += Math.abs(seq.frames[4]![i]! - seq.frames[0]![i]!)
    }
    expect(diffSum).toBeGreaterThan(100)
  })

  it('4. Cross-Shot Visual Continuity Radar & Auto-Harmonizer', () => {
    const w = 24
    const h = 24
    const makeSolidShot = (r: number, g: number, b: number): Uint8ClampedArray => {
      const buf = new Uint8ClampedArray(w * h * 4)
      for (let i = 0; i < buf.length; i += 4) {
        buf[i] = r + ((i / 4) % 15)
        buf[i + 1] = g + ((i / 4) % 15)
        buf[i + 2] = b + ((i / 4) % 15)
        buf[i + 3] = 255
      }
      return buf
    }

    const shots = [
      {
        shotId: 'shot-1',
        title: '分镜1（暖中调）',
        pixels: makeSolidShot(155, 125, 95),
        width: w,
        height: h
      },
      {
        shotId: 'shot-2',
        title: '分镜2（极暗冷蓝跳色）',
        pixels: makeSolidShot(25, 40, 140),
        width: w,
        height: h
      },
      {
        shotId: 'shot-3',
        title: '分镜3（暖中调回归）',
        pixels: makeSolidShot(150, 120, 92),
        width: w,
        height: h
      }
    ]

    const reportBefore = evaluateShotSequenceContinuity(shots)
    expect(reportBefore.issues.length).toBeGreaterThan(0)
    expect(reportBefore.continuityScore).toBeLessThan(85)
    expect(
      reportBefore.issues.some((iss) => iss.kind === 'luma-jump' || iss.kind === 'color-temp-drift')
    ).toBe(true)

    // 一键以 Shot 0 为锚点拉平全片色彩
    const harmonized = harmonizeShotSequenceRgba(shots, 0, 0.95)
    const reportAfter = evaluateShotSequenceContinuity(
      harmonized.map((s, idx) => ({ ...s, title: shots[idx]!.title }))
    )
    expect(reportAfter.continuityScore).toBeGreaterThan(reportBefore.continuityScore)
  })

  it('5. Invisible Pixel Steganography & Provenance Watermark (LSB + CRC32 + PSNR > 50dB)', () => {
    const w = 64
    const h = 64
    const original = makeSyntheticWarmRimPortraitRgba(w, h)
    const payload = {
      schema: 'aiae.pixel-watermark.v1' as const,
      author: 'AI Art Engine Studio',
      workflowHash: 'sha256:9f86d081884c7d',
      nodeType: 'image.portrait',
      recipeSummary: 'skin=standard,tone=film,lut=kodak2383',
      timestamp: 1792420000000
    }

    const watermarked = embedInvisiblePixelWatermarkRgba(original, payload)
    const psnr = computeWatermarkPsnrDb(original, watermarked)
    // LSB 水印人眼完全不可见，PSNR > 50 dB
    expect(psnr).toBeGreaterThan(50)

    const extracted = extractInvisiblePixelWatermarkRgba(watermarked)
    expect(extracted.valid).toBe(true)
    expect(extracted.payload).not.toBeNull()
    expect(extracted.payload!.author).toBe('AI Art Engine Studio')
    expect(extracted.payload!.recipeSummary).toBe('skin=standard,tone=film,lut=kodak2383')
    expect(extracted.crc32Hex).toMatch(/^[0-9a-f]{8}$/)
  })

  it('6. Natural-Language Canvas Macro & Batch Selector Compiler', () => {
    const doc: GraphDocument = {
      version: 1,
      nodes: [
        {
          id: 'n-portrait-1',
          typeId: 'image.portrait',
          title: '女主精修节点',
          x: 0,
          y: 0,
          params: {}
        },
        {
          id: 'n-lighting-1',
          typeId: 'image.lighting',
          title: '主光打光台',
          x: 300,
          y: 0,
          params: {}
        },
        {
          id: 'n-gen-1',
          typeId: 'image.generate',
          title: '概念生图',
          x: 600,
          y: 0,
          params: {}
        }
      ],
      edges: []
    }

    const plan = compileNaturalLanguageCanvasMacro(
      '把所有人像节点切为富士胶片感并开启冷白皮，把打光节点改为伦勃朗光且亮度调到 88，生图节点改成 16:9 画幅',
      doc
    )

    expect(plan.matchedNodeCount).toBe(3)
    const nextDoc = applyCanvasMacroPlan(doc, plan)

    const pNode = nextDoc.nodes.find((n) => n.id === 'n-portrait-1')!
    expect(pNode.params?.portraitRetouch?.lutId).toBe('fuji')
    expect(pNode.params?.portraitRetouch?.skinWhiten).toBe('strong')

    const lNode = nextDoc.nodes.find((n) => n.id === 'n-lighting-1')!
    expect(lNode.params?.lightingSetup?.presetId).toBe('rembrandt')
    expect(lNode.params?.lightingSetup?.brightness).toBe(88)

    const gNode = nextDoc.nodes.find((n) => n.id === 'n-gen-1')!
    expect(gNode.params?.generateAspectRatio).toBe('16:9')
  })
})
