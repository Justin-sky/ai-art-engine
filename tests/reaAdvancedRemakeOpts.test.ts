import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import jpeg from 'jpeg-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNodeFromType, type NodeExecuteContext } from '../src/shared/graph'
import {
  executeSemanticAnalyzeNode,
  executeSemanticRebuildNode
} from '../src/shared/graph/execute/semanticTimeline'
import { semanticTimelineValue } from '../src/shared/graph/execute/semanticTimelineValue'
import { SEMANTIC_TIMELINE_NODE_TYPES } from '../src/shared/graph/semanticTimelineNodes'
import {
  applySemanticEdit,
  buildAssSubtitles,
  collectShotPackagingOverlayBoxes,
  collectTimelinePackagingOverlays,
  createEmptySemanticTimeline,
  finalizeSemanticBreakdown,
  makeTimeRange,
  migrateSemanticTimeline,
  planRemakeExecution,
  type SemanticTimeline
} from '../src/shared/semanticTimeline'
import {
  extractAllShotForensics,
  renderShotTriptychStrips,
  type SampledRgbTrack
} from '../src/main/services/semanticTimeline/forensics/visualForensics'
import { refineAudioAnalysisWithStems } from '../src/main/services/semanticTimeline/forensics/audioForensics'
import {
  generateHardCutFixture,
  probeMediaFacts
} from '../src/main/services/semanticTimeline/mediaFacts'
import {
  resolveFfmpegForSemantic,
  resolveFfprobeForSemantic
} from '../src/main/services/semanticTimeline/resolveFfmpeg'
import {
  buildAspectAwareVNorm,
  rebuildVideoFromSegments,
  snapSliceBoundsToCuts
} from '../src/main/services/semanticTimeline/segmentRebuild'

const hasFfmpeg = (() => {
  try {
    execFileSync(resolveFfmpegForSemantic(), ['-version'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 10_000
    })
    execFileSync(resolveFfprobeForSemantic(), ['-version'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 10_000
    })
    return true
  } catch {
    return false
  }
})()

function encodeTestJpeg(
  width: number,
  height: number,
  fill: (x: number, y: number) => [number, number, number]
): Buffer {
  const rgba = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = fill(x, y)
      const p = (y * width + x) * 4
      rgba[p] = r
      rgba[p + 1] = g
      rgba[p + 2] = b
      rgba[p + 3] = 255
    }
  }
  return jpeg.encode({ data: rgba, width, height }, 92).data
}

function makeToneWav(options: {
  sampleRate: number
  durationSec: number
  freqHz: number
  pulseBpm?: number
}): Buffer {
  const sr = options.sampleRate
  const count = Math.floor(sr * options.durationSec)
  const buf = Buffer.alloc(44 + count * 2)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + count * 2, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sr, 24)
  buf.writeUInt32LE(sr * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(count * 2, 40)

  const periodSec = options.pulseBpm ? 60 / options.pulseBpm : 0
  for (let i = 0; i < count; i += 1) {
    const t = i / sr
    const env = periodSec > 0 ? (t % periodSec < 0.08 ? 0.85 : 0.06) : 0.55
    // Include speech-band formant harmonics (2f0, 3f0, 5f0) so voice-band detector & F0 autocorrelation lock cleanly
    const wave =
      0.32 * Math.sin(2 * Math.PI * options.freqHz * t) +
      0.34 * Math.sin(4 * Math.PI * options.freqHz * t) +
      0.22 * Math.sin(6 * Math.PI * options.freqHz * t) +
      0.12 * Math.sin(10 * Math.PI * options.freqHz * t)
    const sample = Math.max(-32767, Math.min(32767, Math.round(env * wave * 32767)))
    buf.writeInt16LE(sample, 44 + i * 2)
  }
  return buf
}

function makeMovingTrackWithFrozenBanner(): SampledRgbTrack {
  const width = 160
  const height = 96
  const sampleFps = 4
  const frames: Uint8Array[] = []
  const lumaFrames: Float32Array[] = []
  const frameMeanY = new Float64Array(12)
  const frameStdY = new Float64Array(12)
  const frameHsvHist: number[][] = []

  for (let f = 0; f < 12; f += 1) {
    const rgb = new Uint8Array(width * height * 3)
    const luma = new Float32Array(width * height)
    let sumY = 0
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const p = y * width + x
        const idx = p * 3
        // Frozen high-contrast glyph-like banner at top band (y = 8..22, x = 24..136)
        if (y >= 8 && y < 22 && x >= 24 && x < 136) {
          const glyph = (Math.floor(x / 3) + Math.floor(y / 3)) % 2 === 0 ? 250 : 15
          rgb[idx] = glyph
          rgb[idx + 1] = glyph
          rgb[idx + 2] = 20
        } else {
          // Active moving background across frames
          rgb[idx] = (x * 3 + f * 29) & 255
          rgb[idx + 1] = (y * 4 + f * 37) & 255
          rgb[idx + 2] = ((x + y) * 2 + f * 19) & 255
        }
        const yVal = 0.299 * rgb[idx]! + 0.587 * rgb[idx + 1]! + 0.114 * rgb[idx + 2]!
        luma[p] = yVal
        sumY += yVal
      }
    }
    const mean = sumY / (width * height)
    let sq = 0
    for (let p = 0; p < luma.length; p += 1) {
      const d = luma[p]! - mean
      sq += d * d
    }
    frames.push(rgb)
    lumaFrames.push(luma)
    frameMeanY[f] = mean
    frameStdY[f] = Math.sqrt(sq / (width * height))
    frameHsvHist.push(Array.from({ length: 24 }, (_, k) => (k === 0 ? 0.5 : 0.02)))
  }
  return { width, height, sampleFps, frames, lumaFrames, frameMeanY, frameStdY, frameHsvHist }
}

describe('rea-video 3-step remake optimizations (perception, clean-plate/adapt, lip-sync & ASS)', () => {
  const tempDirs: string[] = []
  const makeTempDir = (): string => {
    const dir = join(
      tmpdir(),
      `aiart-rea-opt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    )
    mkdirSync(dir, { recursive: true })
    tempDirs.push(dir)
    return dir
  }

  afterEach(() => {
    for (const d of tempDirs.splice(0)) {
      try {
        rmSync(d, { recursive: true, force: true })
      } catch {
        /* ignore cleanup race */
      }
    }
  })

  it('Step 1: enables semanticLlm by default on semantic.analyze while honoring explicit semanticLlm=false', async () => {
    const analyzeDef = SEMANTIC_TIMELINE_NODE_TYPES.find((d) => d.typeId === 'semantic.analyze')!
    expect(analyzeDef.defaultParams().semanticLlm).toBe(true)

    const baseDoc = migrateSemanticTimeline(
      createEmptySemanticTimeline('asset.v1', {
        durationSec: 4,
        fps: 30,
        width: 1080,
        height: 1920,
        hasAudio: true
      }),
      {
        shots: [
          {
            id: 'shot.1',
            range: makeTimeRange(0, 4, 30),
            keyframes: { strip: 'evidence/keyframes/shot.1.strip.jpg' },
            confidence: 0.95
          }
        ]
      }
    )

    const generateText = vi.fn(async () => ({
      model: 'vlm',
      text: JSON.stringify([
        {
          shotId: 'shot.1',
          baseLabel: 'live_action',
          visualDescription: '手持运镜展示咖啡机萃取浓缩液',
          layers: [{ kind: 'huazi', text: '浓香油脂', position: 'top' }]
        }
      ])
    }))

    const nodeDefault = createNodeFromType('semantic.analyze', { x: 0, y: 0 })
    const outDefault = await executeSemanticAnalyzeNode({
      node: nodeDefault,
      inputs: { in: [{ kind: 'video', id: 'v1', relativePath: 'Assets/v.mp4' }] },
      analyzeSemanticVideo: async () => ({
        timeline: baseDoc,
        shots: [
          {
            id: 'shot.1',
            range: makeTimeRange(0, 4, 30),
            keyframes: { strip: 'evidence/keyframes/shot.1.strip.jpg' },
            confidence: 0.95
          }
        ],
        utterances: [],
        keyframes: { 'shot.1': 'Semantic/stl.1/evidence/keyframes/shot.1.strip.jpg' },
        sourceRelativePath: 'Assets/v.mp4',
        method: 'scene',
        notes: []
      }),
      resolveProjectMediaUrl: async (rel) => `file:///${rel}`,
      generateText
    } as unknown as NodeExecuteContext)

    expect(generateText).toHaveBeenCalled()
    const enriched = (outDefault.out as { doc: SemanticTimeline }).doc
    expect(enriched.shots?.[0]?.visual?.description).toContain('咖啡机')

    generateText.mockClear()
    const nodeOff = createNodeFromType('semantic.analyze', { x: 0, y: 0 })
    nodeOff.params = { ...nodeOff.params, semanticLlm: false }
    await executeSemanticAnalyzeNode({
      node: nodeOff,
      inputs: { in: [{ kind: 'video', id: 'v1', relativePath: 'Assets/v.mp4' }] },
      analyzeSemanticVideo: async () => ({
        timeline: baseDoc,
        shots: [],
        utterances: [],
        keyframes: {},
        sourceRelativePath: 'Assets/v.mp4',
        method: 'scene',
        notes: []
      }),
      generateText
    } as unknown as NodeExecuteContext)
    expect(generateText).not.toHaveBeenCalled()
  })

  it('Step 1: stitches 3-frame temporal triptych strips and refines audio forensics with 44.1kHz separated stems', async () => {
    const dir = makeTempDir()
    const tlDir = join(dir, 'Semantic', 'stl.strip')
    const kfDir = join(tlDir, 'evidence', 'keyframes')
    mkdirSync(kfDir, { recursive: true })

    writeFileSync(
      join(kfDir, 'shot.1.first.jpg'),
      encodeTestJpeg(160, 90, () => [220, 40, 40])
    )
    writeFileSync(
      join(kfDir, 'shot.1.middle.jpg'),
      encodeTestJpeg(160, 90, () => [40, 200, 60])
    )
    writeFileSync(
      join(kfDir, 'shot.1.last.jpg'),
      encodeTestJpeg(160, 90, () => [40, 80, 220])
    )

    const stripped = renderShotTriptychStrips(
      tlDir,
      [
        {
          id: 'shot.1',
          range: makeTimeRange(0, 3, 30),
          keyframes: {
            first: 'evidence/keyframes/shot.1.first.jpg',
            middle: 'evidence/keyframes/shot.1.middle.jpg',
            last: 'evidence/keyframes/shot.1.last.jpg'
          },
          confidence: 0.95
        }
      ],
      { width: 160, height: 90 }
    )
    expect(stripped[0]!.keyframes.strip).toBe('evidence/keyframes/shot.1.strip.jpg')
    const stripAbs = join(tlDir, stripped[0]!.keyframes.strip!)
    expect(existsSync(stripAbs)).toBe(true)
    const decoded = jpeg.decode(readFileSync(stripAbs), { useTArray: true })
    expect(decoded.width).toBeGreaterThan(decoded.height * 3)

    // High-sample-rate (44.1kHz) separated stems -> anti-aliased decimation + clean F0 & BPM refinement
    const vocalsAbs = join(dir, 'vocals_44k.wav')
    const accAbs = join(dir, 'acc_44k.wav')
    writeFileSync(vocalsAbs, makeToneWav({ sampleRate: 44100, durationSec: 4, freqHz: 195 }))
    writeFileSync(
      accAbs,
      makeToneWav({ sampleRate: 44100, durationSec: 6, freqHz: 261.63, pulseBpm: 120 })
    )

    const refined = refineAudioAnalysisWithStems(
      {
        hasAudio: true,
        rmsDbfs: -18,
        silenceRatio: 0.1,
        voice: { present: false, speechRatio: 0 },
        music: { present: false },
        sfx: { present: false },
        soundSources: []
      },
      {
        cutTimesSec: [2],
        vocalsWavAbs: vocalsAbs,
        accompanimentWavAbs: accAbs,
        utterances: [
          {
            id: 'u1',
            range: makeTimeRange(0.2, 3.8, 30),
            text: '清晰人声测试',
            granularity: 'sentence',
            confidence: 0.9
          }
        ]
      }
    )
    expect(refined.voice.f0MedianHz).toBeGreaterThanOrEqual(180)
    expect(refined.voice.f0MedianHz).toBeLessThanOrEqual(210)
    expect(refined.music.present).toBe(true)
    expect(refined.music.bpm).toBeDefined()
  })

  it('Step 1: detects frozen packaging overlay boxes on moving video and snaps multi-shot cuts + full-bleed crop', async () => {
    const track = makeMovingTrackWithFrozenBanner()
    const analyzedShots = extractAllShotForensics(
      [{ id: 's1', range: makeTimeRange(0, 3, 24), keyframes: {}, confidence: 1 }],
      track
    )
    const frozenBoxes = analyzedShots[0]!.forensics?.frozenOverlayBoxes ?? []
    expect(frozenBoxes.length).toBeGreaterThan(0)
    expect(frozenBoxes[0]!.band).toBe('top')

    // Aspect-aware vNorm: close aspect ratio uses full-bleed increase+crop; extreme mismatch uses decrease+pad
    const fullBleed = buildAspectAwareVNorm(1024, 1792, 1080, 1920, 30)
    expect(fullBleed).toContain('force_original_aspect_ratio=increase,crop=1080:1920')

    const letterbox = buildAspectAwareVNorm(1920, 1080, 1080, 1920, 30)
    expect(letterbox).toContain('force_original_aspect_ratio=decrease,pad=1080:1920')

    // Snap proportional slice [0, 1.85] on a 4.5s multi-shot clip with real cuts at [1.52, 3.04]
    const snapped = snapSliceBoundsToCuts(0, 1.85, 4.5, [1.52, 3.04])
    expect(snapped.snapped).toBe(true)
    expect(snapped.startSec).toBe(0)
    expect(snapped.durationSec).toBeCloseTo(1.52, 2)
  })

  it('Step 1: splits long G1 units by model maxUnitDurationSec, chains tail frames, and hits unit fingerprint cache on rerun', async () => {
    const hsv = Array.from({ length: 24 }, (_, k) => (k === 2 ? 0.85 : 0.01))
    const raw = migrateSemanticTimeline(
      {
        id: 'stl.chain.cache',
        schema: 'aiart.semantic-timeline@2',
        source: { assetId: 'asset-1', fps: 30, duration: 8, width: 1080, height: 1920 },
        entities: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      } as unknown as SemanticTimeline,
      {
        shots: [
          {
            id: 'shot.1',
            range: makeTimeRange(0, 4, 30),
            keyframes: { first: 'evidence/keyframes/s1.jpg' },
            confidence: 0.95,
            forensics: { cameraMotionKind: 'smooth_move', hsvHist: hsv, noiseSigma: 0.5 }
          },
          {
            id: 'shot.2',
            range: makeTimeRange(4, 8, 30),
            keyframes: {},
            confidence: 0.95,
            forensics: { cameraMotionKind: 'smooth_move', hsvHist: hsv, noiseSigma: 0.5 }
          }
        ]
      }
    )
    const doc = finalizeSemanticBreakdown(raw, {
      provenance: { aigcImplicitLabel: { label: '1' }, evidence: [] }
    })

    // 1) Disallowing multi-shot drops back to single-shot tasks linked via chainFromUnitKey
    const singleOnly = planRemakeExecution(doc, {
      strategy: 'fidelity',
      allowMultiShot: false
    })
    expect(singleOnly.units.map((u) => u.key)).toEqual(['shot.1', 'shot.2'])
    expect(singleOnly.units[1]!.chainFromUnitKey).toBe('shot.1')

    // 2) Model supporting max 6s splits 8s G1 into G1.1 + G1.2 linked via chainFromUnitKey='G1.1'
    const planned6s = planRemakeExecution(doc, {
      strategy: 'fidelity',
      allowMultiShot: true,
      maxUnitDurationSec: 6
    })
    expect(planned6s.units.map((u) => u.key)).toEqual(['G1.1', 'G1.2'])
    expect(planned6s.units[1]!.chainFromUnitKey).toBe('G1.1')

    const node = createNodeFromType('semantic.rebuild', { x: 0, y: 0 })
    node.params = {
      ...node.params,
      remakeStrategy: 'fidelity',
      sourceRelativePath: 'Assets/src.mp4'
    }

    const generatedCalls: Array<{ key: string; firstFrameImageUrl?: string }> = []
    const runWithNode = async (timelineDoc: SemanticTimeline) => {
      await executeSemanticRebuildNode({
        node,
        locale: 'zh-CN',
        inputs: { in: [semanticTimelineValue(timelineDoc)] },
        patchNode: (patch) => {
          if (patch.params) node.params = { ...node.params, ...patch.params }
        },
        resolveVideoGenerateCapabilities: async () => ({
          params: {
            durations: [6],
            resolutions: ['720p'],
            aspectRatios: ['9:16'],
            supportedFrameImages: ['first_frame'],
            supportsAudio: false,
            supportsSeed: true
          },
          portLimits: { maxImages: 1, maxVideos: 0, maxVoices: 0, durations: [6] }
        }),
        resolveProjectMediaUrl: async (rel) => `file:///${rel}`,
        resolveVideoFrameImageUrls: async (items) => [
          `tail-frame-of:${items[0]?.relativePath ?? ''}`
        ],
        generateVideo: async (req) => {
          const key = String(req.name ?? '').replace(/^rebuild-/, '')
          generatedCalls.push({ key, firstFrameImageUrl: req.firstFrameImageUrl })
          return { assetId: `a-${key}`, relativePath: `Build/${key}.mp4`, model: 'model-6s' }
        },
        rebuildSemanticVideo: async (input) => ({
          ok: true,
          outputRelativePath: 'Semantic/stl.chain.cache/rebuilds/r1/output.mp4',
          manifestRelativePath: 'Semantic/stl.chain.cache/rebuilds/r1/manifest.json',
          clipCount: input.clips.length
        })
      } as unknown as NodeExecuteContext)
    }

    await runWithNode(doc)
    expect(generatedCalls).toEqual([
      {
        key: 'G1.1',
        firstFrameImageUrl: 'file:///Semantic/stl.chain.cache/evidence/keyframes/s1.jpg'
      },
      {
        key: 'G1.2',
        firstFrameImageUrl: 'tail-frame-of:Build/G1.1.mp4'
      }
    ])
    expect(node.params?.rebuildUnitCacheJson).toBeTruthy()

    // Second run with identical timeline + params: 100% cache hit -> 0 generateVideo calls!
    generatedCalls.length = 0
    await runWithNode(doc)
    expect(generatedCalls).toHaveLength(0)
    const report2 = JSON.parse(String(node.params?.rebuildLastReport ?? '{}')) as {
      cacheHits?: string[]
    }
    expect(report2.cacheHits).toEqual(['G1.1', 'G1.2'])
  })

  it('Step 2: strips burned-in packaging overlays before I2V and locks original shot composition in adapt anchor synthesis', async () => {
    const base = migrateSemanticTimeline(
      {
        id: 'stl.step2',
        schema: 'aiart.semantic-timeline@2',
        source: { assetId: 'asset-1', fps: 30, duration: 4, width: 1080, height: 1920 },
        entities: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      } as unknown as SemanticTimeline,
      {
        shots: [
          {
            id: 'shot.1',
            range: makeTimeRange(0, 4, 30),
            keyframes: { first: 'evidence/keyframes/s1.jpg' },
            confidence: 0.95,
            forensics: {
              cameraMotionKind: 'smooth_move',
              noiseSigma: 0.5,
              frozenOverlayBoxes: [{ x: 0.12, y: 0.08, w: 0.76, h: 0.1, band: 'top' }]
            }
          }
        ]
      }
    )
    let doc = finalizeSemanticBreakdown(base, {
      provenance: { aigcImplicitLabel: { label: '1' }, evidence: [] }
    })
    doc = {
      ...doc,
      shots: doc.shots!.map((s) => ({
        ...s,
        layers: [
          {
            id: 'lyr.huazi.1',
            kind: 'huazi',
            text: '爆款直降',
            position: 'top',
            box: { x: 0.12, y: 0.08, w: 0.76, h: 0.1 },
            editable: true,
            range: s.range
          },
          {
            id: 'lyr.scene.1',
            kind: 'scene_text',
            text: 'CAFE',
            position: 'middle',
            box: { x: 0.4, y: 0.4, w: 0.2, h: 0.1 },
            editable: false,
            range: s.range
          }
        ]
      }))
    }

    const boxes = collectShotPackagingOverlayBoxes(doc, doc.shots![0]!)
    expect(boxes.some((b) => b.kind === 'huazi')).toBe(true)
    expect(boxes.some((b) => b.kind === 'scene_text')).toBe(false)

    // 2A: Fidelity mode strips overlays into Semantic/<id>/clean/clean-G1.png before I2V
    const imageCalls: Array<{ prompt: string; inputReferences?: string[] }> = []
    const videoCalls: Array<{ firstFrameImageUrl?: string }> = []
    const fidelityNode = createNodeFromType('semantic.rebuild', { x: 0, y: 0 })
    fidelityNode.params = {
      ...fidelityNode.params,
      remakeStrategy: 'fidelity',
      sourceRelativePath: 'Assets/src.mp4'
    }
    await executeSemanticRebuildNode({
      node: fidelityNode,
      locale: 'zh-CN',
      inputs: { in: [semanticTimelineValue(doc)] },
      readProjectImageDataUrl: async (rel) => `data:orig:${rel}`,
      resolveProjectMediaUrl: async (rel) => `file:///${rel}`,
      generateImage: async (req) => {
        imageCalls.push({ prompt: req.prompt, inputReferences: req.inputReferences })
        return { images: ['data:cleaned-plate'], model: 'img' }
      },
      saveRunMedia: async ({ key, outputDir }) => `${outputDir}/${key}.png`,
      generateVideo: async (req) => {
        videoCalls.push({ firstFrameImageUrl: req.firstFrameImageUrl })
        return { assetId: 'v1', relativePath: 'Build/G1.mp4', model: 'vid' }
      },
      rebuildSemanticVideo: async (input) => ({
        ok: true,
        outputRelativePath: 'out.mp4',
        manifestRelativePath: 'm.json',
        clipCount: input.clips.length
      })
    } as unknown as NodeExecuteContext)

    expect(imageCalls).toHaveLength(1)
    expect(imageCalls[0]!.inputReferences).toEqual([
      'data:orig:Semantic/stl.step2/evidence/keyframes/s1.jpg'
    ])
    expect(videoCalls[0]!.firstFrameImageUrl).toBe('file:///Semantic/stl.step2/clean/clean-G1.png')

    // 2B: Adapt mode with upstream product image locks composition via [baseFrameDataUrl, productRefUrl]
    imageCalls.length = 0
    videoCalls.length = 0
    const adaptNode = createNodeFromType('semantic.rebuild', { x: 0, y: 0 })
    adaptNode.params = {
      ...adaptNode.params,
      remakeStrategy: 'adapt',
      sourceRelativePath: 'Assets/src.mp4'
    }
    await executeSemanticRebuildNode({
      node: adaptNode,
      locale: 'zh-CN',
      inputs: {
        in: [semanticTimelineValue(doc)],
        'in-images': [{ kind: 'image', id: 'prod1', dataUrl: 'data:new-product-bottle' }]
      },
      readProjectImageDataUrl: async (rel) => `data:orig:${rel}`,
      resolveProjectMediaUrl: async (rel) => `file:///${rel}`,
      generateImage: async (req) => {
        imageCalls.push({ prompt: req.prompt, inputReferences: req.inputReferences })
        return { images: ['data:adapted-anchor'], model: 'img' }
      },
      saveRunMedia: async ({ key, outputDir }) => `${outputDir}/${key}.png`,
      generateVideo: async (req) => {
        videoCalls.push({ firstFrameImageUrl: req.firstFrameImageUrl })
        return { assetId: 'v1', relativePath: 'Build/G1.mp4', model: 'vid' }
      },
      rebuildSemanticVideo: async (input) => ({
        ok: true,
        outputRelativePath: 'out.mp4',
        manifestRelativePath: 'm.json',
        clipCount: input.clips.length
      })
    } as unknown as NodeExecuteContext)

    expect(imageCalls).toHaveLength(1)
    expect(imageCalls[0]!.inputReferences).toEqual([
      'data:orig:Semantic/stl.step2/evidence/keyframes/s1.jpg',
      'data:new-product-bottle'
    ])
    expect(imageCalls[0]!.prompt).toContain('构图与机位锁定')
    expect(videoCalls[0]!.firstFrameImageUrl).toBe(
      'file:///Semantic/stl.step2/anchors/anchor-G1.png'
    )
  })

  it('Step 3: drives avatar_tts units via lip-sync audio_url+image_url, attaches video_url for reference_video, and builds ASS packaging script', async () => {
    const raw = migrateSemanticTimeline(
      {
        id: 'stl.step3',
        schema: 'aiart.semantic-timeline@2',
        source: { assetId: 'asset-1', fps: 24, duration: 4, width: 640, height: 360 },
        entities: [
          {
            id: 'ent.host',
            kind: 'person',
            name: '口播主播',
            appearances: [{ shotId: 'shot.1', range: makeTimeRange(0, 4, 24) }],
            pixelEditable: false
          }
        ],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      } as unknown as SemanticTimeline,
      {
        shots: [
          {
            id: 'shot.1',
            range: makeTimeRange(0, 4, 24),
            keyframes: { first: 'evidence/keyframes/host.jpg' },
            confidence: 0.96,
            forensics: {
              cameraMotionKind: 'locked',
              meanFrameDiff: 2.1,
              dupRatio: 0.08
            }
          }
        ],
        utterances: [
          {
            id: 'utt.1',
            range: makeTimeRange(0.2, 3.6, 24),
            text: '欢迎来到直播间',
            granularity: 'sentence',
            confidence: 0.95
          }
        ]
      }
    )

    let avatarDoc = finalizeSemanticBreakdown(raw)
    avatarDoc = finalizeSemanticBreakdown({
      ...avatarDoc,
      shots: avatarDoc.shots!.map((s) => ({
        ...s,
        base: {
          label: 'avatar',
          probs: { avatar: 0.94 },
          confidence: 0.94,
          decidedBy: 'review_override',
          reviewOverrideLabel: 'avatar',
          evidence: ['talking head']
        },
        layers: [
          {
            id: 'lyr.top',
            kind: 'title',
            text: '官方旗舰店直发',
            position: 'top',
            editable: true,
            range: makeTimeRange(0, 4, 24)
          },
          {
            id: 'lyr.huazi',
            kind: 'huazi',
            text: '限时秒杀 ¥99',
            position: 'middle',
            editable: true,
            range: makeTimeRange(0.5, 3.5, 24)
          }
        ]
      }))
    })
    expect(avatarDoc.shots![0]!.replication?.executor).toBe('avatar_tts')

    // Editing dialogue in edit mode automatically triggers lip-sync regeneration on avatar_tts shot
    avatarDoc = applySemanticEdit(avatarDoc, {
      op: 'dialogue.update',
      target: 'utt.1',
      patch: { text: '今天下单立省五十元' }
    })

    const videoReqs: Array<Record<string, unknown>> = []
    const rebuildReqs: Array<Record<string, unknown>> = []
    const node = createNodeFromType('semantic.rebuild', { x: 0, y: 0 })
    node.params = {
      ...node.params,
      remakeStrategy: 'edit',
      generateModel: 'doubao-seedance-2-0',
      rebuildCleanOverlays: false,
      sourceRelativePath: 'Assets/src.mp4'
    }

    await executeSemanticRebuildNode({
      node,
      locale: 'zh-CN',
      inputs: { in: [semanticTimelineValue(avatarDoc)] },
      generateSpeech: async (req) => ({
        relativePath: `Audio/${req.name}.wav`,
        model: 'tts',
        voice: 'female'
      }),
      resolveProjectMediaUrl: async (rel) => `file:///${rel}`,
      generateVideo: async (req) => {
        videoReqs.push(req as unknown as Record<string, unknown>)
        return { assetId: 'v-lip', relativePath: 'Build/shot.1.mp4', model: 'doubao-seedance-2-0' }
      },
      rebuildSemanticVideo: async (req) => {
        rebuildReqs.push(req as unknown as Record<string, unknown>)
        return {
          ok: true,
          outputRelativePath: 'Semantic/stl.step3/rebuilds/r1/output.mp4',
          manifestRelativePath: 'Semantic/stl.step3/rebuilds/r1/manifest.json',
          clipCount: req.clips.length
        }
      }
    } as unknown as NodeExecuteContext)

    expect(videoReqs).toHaveLength(1)
    expect(videoReqs[0]!.generateAudio).toBe(true)
    expect(videoReqs[0]!.firstFrameImageUrl).toBeUndefined()
    expect(videoReqs[0]!.inputReferences).toEqual([
      {
        kind: 'image_url',
        url: 'file:///Semantic/stl.step3/evidence/keyframes/host.jpg'
      },
      {
        kind: 'audio_url',
        url: 'file:///Audio/dub-utt.1.wav'
      }
    ])
    expect(rebuildReqs[0]!.packagingOverlays).toEqual([
      expect.objectContaining({ text: '官方旗舰店直发', kind: 'title', position: 'top' }),
      expect.objectContaining({ text: '限时秒杀 ¥99', kind: 'huazi', position: 'middle' })
    ])

    // Also verify reference_video motion conditioning attaches { kind: 'video_url' } on Seedance
    let refVideoDoc = finalizeSemanticBreakdown({
      ...raw,
      shots: raw.shots!.map((s) => ({
        ...s,
        base: {
          label: 'live_action',
          probs: { live_action: 0.9 },
          confidence: 0.9,
          decidedBy: 'review_override',
          reviewOverrideLabel: 'live_action',
          evidence: ['dance motion']
        }
      }))
    })
    refVideoDoc = {
      ...refVideoDoc,
      shots: refVideoDoc.shots!.map((s) => ({
        ...s,
        replication: {
          ...s.replication!,
          mode: 'reference_video',
          executor: 'reshoot',
          videoPrompt: '舞者按原视频节奏完成转身动作'
        }
      }))
    }
    videoReqs.length = 0
    const refNode = createNodeFromType('semantic.rebuild', { x: 0, y: 0 })
    refNode.params = {
      ...refNode.params,
      remakeStrategy: 'fidelity',
      generateModel: 'doubao-seedance-2-0',
      sourceRelativePath: 'Assets/src.mp4'
    }
    await executeSemanticRebuildNode({
      node: refNode,
      locale: 'zh-CN',
      inputs: { in: [semanticTimelineValue(refVideoDoc)] },
      resolveProjectMediaUrl: async (rel) => `file:///${rel}`,
      generateVideo: async (req) => {
        videoReqs.push(req as unknown as Record<string, unknown>)
        return { assetId: 'v-ref', relativePath: 'Build/shot.1.mp4', model: 'doubao-seedance-2-0' }
      },
      rebuildSemanticVideo: async (req) => ({
        ok: true,
        outputRelativePath: 'Semantic/stl.step3/rebuilds/r2/output.mp4',
        manifestRelativePath: 'Semantic/stl.step3/rebuilds/r2/manifest.json',
        clipCount: req.clips.length
      })
    } as unknown as NodeExecuteContext)
    expect(videoReqs).toHaveLength(1)
    expect(videoReqs[0]!.inputReferences).toContainEqual({
      kind: 'video_url',
      url: 'file:///Assets/src.mp4'
    })

    // Verify ASS subtitle script generation (Dialogue + TitleTop + animated Huazi)
    const overlays = collectTimelinePackagingOverlays(avatarDoc)
    const assBuilt = buildAssSubtitles({
      width: 640,
      height: 360,
      cues: [{ startSec: 0.2, endSec: 3.6, text: '今天下单立省五十元' }],
      packagingOverlays: overlays
    })
    expect(assBuilt.assText).toContain('PlayResX: 640')
    expect(assBuilt.assText).toContain('Style: Huazi,')
    expect(assBuilt.assText).toContain('\\fscx108\\fscy108')
    expect(assBuilt.assText).toContain('限时秒杀 ¥99')
    expect(assBuilt.assText).toContain('官方旗舰店直发')
  })

  it.runIf(hasFfmpeg)(
    'Step 3 (ffmpeg): burns ASS packaging overlays into output video via FFmpeg',
    async () => {
      const dir = makeTempDir()
      const srcRel = 'Assets/src.mp4'
      const srcAbs = join(dir, srcRel)
      mkdirSync(join(dir, 'Assets'), { recursive: true })
      await generateHardCutFixture(srcAbs)

      const ffmpegOut = await rebuildVideoFromSegments({
        projectRoot: dir,
        workDirRelativePath: 'Semantic/stl.step3/rebuilds/r1/work',
        outputRelativePath: 'Semantic/stl.step3/rebuilds/r1/output.mp4',
        sourceRelativePath: srcRel,
        segments: [
          { key: 's1', kind: 'source', durationSec: 2.0, sourceStartSec: 0, sourceEndSec: 2.0 }
        ],
        subtitles: [{ sourceStartSec: 0.2, sourceEndSec: 1.8, text: '今天下单立省五十元' }],
        packagingOverlays: [
          {
            sourceStartSec: 0.2,
            sourceEndSec: 1.8,
            text: '限时秒杀 ¥99',
            kind: 'huazi',
            position: 'middle'
          }
        ],
        burnSubtitles: true,
        keepAudio: false,
        width: 320,
        height: 180,
        fps: 24
      })
      expect(ffmpegOut.ok).toBe(true)
      expect(existsSync(join(dir, 'Semantic/stl.step3/rebuilds/r1/work/subtitles.ass'))).toBe(true)
      const probed = await probeMediaFacts(join(dir, ffmpegOut.outputRelativePath))
      expect(probed.width).toBe(320)
      expect(probed.height).toBe(180)
      expect(probed.durationSec).toBeGreaterThan(1.5)
    }
  )
})
