import { describe, expect, it } from 'vitest'
import {
  applyOpticalLensLabRgba,
  applyWorkflowAutoCacheOptimization,
  auditGoldenComposition,
  buildCameraExifProfileMetadata,
  compositeWithPhysicalLightWrapRgba,
  computeVisualSaliencyMap,
  decontaminateAlphaEdgeSpillRgba,
  embedCameraMetadataInPngBytes,
  estimateWorkflowCostAndCriticalPath,
  extractCameraMetadataFromPngBytes,
  inferBalloonEmotionFromText,
  planSmartBalloonLayout,
  purifyAiArtifactsAndInjectSensorGrainRgba,
  renderEyeTrackingHeatmapRgba,
  renderSmartBalloonsToSvgOverlay,
  type GraphDocument
} from '../src/shared/graph'

function makeTestPortraitSceneRgba(width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const ny = (y + 0.5) / height
    for (let x = 0; x < width; x++) {
      const nx = (x + 0.5) / width
      const idx = (y * width + x) * 4
      // 在黄金三分点 (0.33, 0.35) 处放置高暖度亮主体，其余为深蓝暗背景
      const distToSubject = Math.hypot(nx - 0.33, ny - 0.35)
      if (distToSubject < 0.18) {
        out[idx] = 248
        out[idx + 1] = 195
        out[idx + 2] = 145
        out[idx + 3] = 255
      } else {
        out[idx] = 24
        out[idx + 1] = 32
        out[idx + 2] = 52
        out[idx + 3] = 255
      }
    }
  }
  return out
}

describe('Six Masterpiece Upgrades Suite', () => {
  it('1. Optical Lens Physics & Analog Halation Lab (ARRI Anamorphic & Kodak Halation)', () => {
    const w = 48
    const h = 36
    const src = makeTestPortraitSceneRgba(w, h)

    const anamorphic = applyOpticalLensLabRgba(src, w, h, {
      preset: 'arri-anamorphic',
      halationStrength: 0.75,
      anamorphicStreakStrength: 0.8
    })
    expect(anamorphic.length).toBe(w * h * 4)

    // 紧邻高光边缘右侧 (0.53) 的暗背景像素应收到胶片红晕与变形宽银幕拉丝的显著提亮
    const streakSampleX = Math.floor(w * 0.53)
    const streakSampleY = Math.floor(h * 0.35)
    const sampleIdx = (streakSampleY * w + streakSampleX) * 4
    expect(anamorphic[sampleIdx]!).toBeGreaterThan(src[sampleIdx]!)
    expect(anamorphic[sampleIdx + 2]!).toBeGreaterThan(src[sampleIdx + 2]!)
  })

  it('2. Sub-Pixel Hair De-Fringing & Physical Light-Wrap Compositor', () => {
    const w = 32
    const h = 32
    const fg = new Uint8ClampedArray(w * h * 4)
    const bg = new Uint8ClampedArray(w * h * 4)

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        // 明亮暖橙色新背景
        bg[i] = 245
        bg[i + 1] = 175
        bg[i + 2] = 95
        bg[i + 3] = 255

        const dist = Math.hypot(x - 16, y - 16)
        if (dist < 8) {
          // 内部纯净深棕发色前景
          fg[i] = 65
          fg[i + 1] = 45
          fg[i + 2] = 35
          fg[i + 3] = 255
        } else if (dist < 10.5) {
          // 半透明边缘，人为注入严重绿幕色溢 (G=235)
          fg[i] = 70
          fg[i + 1] = 235
          fg[i + 2] = 65
          fg[i + 3] = 128
        }
      }
    }

    const deSpilled = decontaminateAlphaEdgeSpillRgba(fg, w, h, { strength: 0.9 })
    // 检查半透明边缘像素 (x=7, y=16, dist=9) 的绿色溢是否被显著压制
    const edgeIdx = (16 * w + 7) * 4
    expect(deSpilled[edgeIdx + 1]!).toBeLessThan(fg[edgeIdx + 1]! - 60)

    const composited = compositeWithPhysicalLightWrapRgba(fg, bg, w, h, {
      lightWrapRadiusPx: 5,
      lightWrapIntensity: 0.65,
      ambientColorMatch: 0.35
    })
    expect(composited.length).toBe(w * h * 4)
    // 靠近前景边缘的内侧像素 (x=9, y=16, dist=7) 应受到暖色背景环境光包裹提亮
    const innerEdgeIdx = (16 * w + 9) * 4
    expect(composited[innerEdgeIdx]!).toBeGreaterThan(fg[innerEdgeIdx]!)
  })

  it('3. AI-Artifact Purifier & Camera EXIF PNG Metadata Injector', () => {
    const w = 32
    const h = 32
    const noisy = new Uint8ClampedArray(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        // 构造周期性高频微棋盘格振荡 (+14 / -14)
        const checker = (x + y) % 2 === 0 ? 14 : -14
        noisy[i] = 128 + checker
        noisy[i + 1] = 128 + checker
        noisy[i + 2] = 128 + checker
        noisy[i + 3] = 255
      }
    }

    const purified = purifyAiArtifactsAndInjectSensorGrainRgba(noisy, w, h, {
      decheckerStrength: 0.85,
      sensorNoiseStrength: 0.2,
      seed: 42
    })
    expect(purified.artifactReductionScore).toBeGreaterThan(15)

    // 验证 PNG 真机 EXIF 元数据写入与无损解析回环
    const minimalPng = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0,
      0, 0, 31, 21, 196, 137, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130
    ])
    const meta = buildCameraExifProfileMetadata('hasselblad-x2d')
    const embeddedPng = embedCameraMetadataInPngBytes(minimalPng, meta)
    const extractedMeta = extractCameraMetadataFromPngBytes(embeddedPng)

    expect(extractedMeta).not.toBeNull()
    expect(extractedMeta!.make).toBe('Hasselblad')
    expect(extractedMeta!.model).toBe('X2D 100C')
    expect(extractedMeta!.lensModel).toContain('90V')
  })

  it('4. Eye-Tracking Saliency Heatmap & Golden Composition Auditor', () => {
    const w = 60
    const h = 45
    const src = makeTestPortraitSceneRgba(w, h)
    const sal = computeVisualSaliencyMap(src, w, h)
    expect(sal.length).toBe(w * h)

    const heatmap = renderEyeTrackingHeatmapRgba(src, w, h, sal)
    expect(heatmap.length).toBe(w * h * 4)

    const report = auditGoldenComposition(src, w, h, sal)
    expect(report.overallScore).toBeGreaterThanOrEqual(60)
    // 主体位于左上 (0.33, 0.35)，因此右下角留白区的平均显著度一定远低于主体区
    expect(report.copywritingSafeZone.meanSaliency).toBeLessThan(0.35)
    expect(report.recommendedCropBox.width).toBeGreaterThan(0.5)
  })

  it('5. Smart Manga/Webtoon Balloon Layout & Emotion SVG Typesetter', () => {
    const w = 80
    const h = 60
    const src = makeTestPortraitSceneRgba(w, h)

    expect(inferBalloonEmotionFromText('混蛋！！给我住手！！')).toBe('shout')
    expect(inferBalloonEmotionFromText('……（小声）别出声')).toBe('whisper')
    expect(inferBalloonEmotionFromText('（他居然早就发现了？）')).toBe('thought')
    expect(inferBalloonEmotionFromText('【三年后·新东京港】')).toBe('narration')

    const avoidFaceBox = { x: 0.2, y: 0.2, width: 0.26, height: 0.3 }
    const plan = planSmartBalloonLayout(
      src,
      w,
      h,
      [
        { id: 'd1', speaker: 'A', text: '混蛋！！给我住手！！' },
        { id: 'd2', speaker: 'B', text: '【夜幕降临，决战一触即发】' }
      ],
      {
        readingOrder: 'ltr',
        avoidZones: [avoidFaceBox]
      }
    )

    expect(plan.balloons.length).toBe(2)
    expect(plan.balloons[0]!.emotion).toBe('shout')
    expect(plan.balloons[1]!.emotion).toBe('narration')
    expect(plan.balloons[1]!.tailTip).toBeNull()

    const svg = renderSmartBalloonsToSvgOverlay(plan)
    expect(svg).toContain('<svg')
    expect(svg).toContain('<polygon')
    expect(svg).toContain('混蛋！！给我')
    expect(svg).toContain('住手！！')
  })

  it('6. Workflow Token/Cost Estimator & Critical-Path Auto-Cache Optimizer', () => {
    const doc: GraphDocument = {
      version: 1,
      nodes: [
        {
          id: 'n-gen-cached',
          typeId: 'image.generate',
          title: '分镜底图生成',
          x: 0,
          y: 0,
          params: {
            generateCount: 2,
            generateResolution: '2K',
            generateInstruction: '赛博朋克雨夜街头少女特写',
            generatedImages: [{ dataUrl: 'data:image/png;base64,AAA' }]
          }
        },
        {
          id: 'n-gen-dup',
          typeId: 'image.generate',
          title: '重复分镜底图',
          x: 0,
          y: 200,
          params: {
            generateCount: 1,
            generateInstruction: '赛博朋克雨夜街头少女特写'
          }
        },
        {
          id: 'n-video-heavy',
          typeId: 'video.generate',
          title: '图生视频主镜头',
          x: 360,
          y: 0,
          params: {
            generateDuration: 5
          }
        }
      ],
      edges: [
        {
          id: 'e1',
          fromNodeId: 'n-gen-cached',
          fromPortId: 'out',
          toNodeId: 'n-video-heavy',
          toPortId: 'in-image'
        }
      ]
    }

    const report = estimateWorkflowCostAndCriticalPath(doc)
    expect(report.totalEstimatedApiCalls).toBe(4)
    expect(report.criticalPathNodeIds).toEqual(['n-gen-cached', 'n-video-heavy'])
    expect(report.redundantCookNodes.map((n) => n.nodeId)).toContain('n-gen-cached')
    expect(report.duplicatePromptGroups.length).toBe(1)

    const optimized = applyWorkflowAutoCacheOptimization(doc, report)
    expect(optimized.lockedNodeIds).toEqual(['n-gen-cached'])
    expect(optimized.estimatedSavedCredits).toBeGreaterThan(0)

    const reportAfter = estimateWorkflowCostAndCriticalPath(optimized.document)
    expect(reportAfter.totalEstimatedCredits).toBeLessThan(report.totalEstimatedCredits)
    expect(reportAfter.criticalPathLatencySec).toBeLessThan(report.criticalPathLatencySec)
  })
})
