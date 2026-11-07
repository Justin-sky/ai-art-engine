import { describe, expect, it } from 'vitest'
import { inferHostInterfaceFromGraph, materializeGraphPlan } from '../src/shared/graph'
import { buildVideoBreakdownRemakeSeedPlan } from '../src/renderer/src/features/aiWorkflow/presets'
import {
  applySemanticEdit,
  exportTimelineSubtitlesSrt,
  finalizeSemanticBreakdown,
  fuseShotClassification,
  migrateSemanticTimeline,
  parseReaShotVlmBatch,
  parseReaWholeVideoResponse,
  planRemakeExecution,
  renderBreakdownReportMd,
  type SemanticTimeline,
  type ShotEvidence
} from '../src/shared/semanticTimeline'

const range = (start: number, end: number) => ({
  start,
  end,
  startFrame: Math.round(start * 30),
  endFrame: Math.round(end * 30)
})

function buildSampleTimeline(): SemanticTimeline {
  const histA = Array.from({ length: 24 }, (_, i) => (i < 6 ? 0.15 : 0.005))
  const histUi = Array.from({ length: 24 }, (_, i) => (i >= 12 && i < 16 ? 0.24 : 0.002))

  const shots: ShotEvidence[] = [
    {
      id: 'shot.1',
      range: range(0, 4),
      keyframes: {
        first: 'evidence/keyframes/s1.first.jpg',
        last: 'evidence/keyframes/s1.last.jpg'
      },
      confidence: 0.9,
      transitionIn: 'cut',
      forensics: {
        noiseSigma: 0.55,
        flatRatio: 0.12,
        meanFrameDiff: 6.2,
        dupRatio: 0.02,
        cameraMotionKind: 'smooth_move',
        hsvHist: histA,
        aspects: {
          framing: { subjectKind: 'face', shotSize: 'mcu' },
          lighting: { ratio: 1.8, keySide: 'left', warmth: 16, subjectLuma: 140, bgLuma: 85 },
          grade: { sat: 0.32, contrast: 0.24, black: 6, shadowB: -8, highlightB: 12, meanL: 52 }
        }
      }
    },
    {
      id: 'shot.2',
      range: range(4, 6),
      keyframes: { first: 'evidence/keyframes/s2.first.jpg' },
      confidence: 0.92,
      transitionIn: 'cut',
      forensics: {
        noiseSigma: 0.15,
        flatRatio: 0.68,
        axisEdgeRatio: 0.72,
        palette95: 14,
        meanFrameDiff: 3.1,
        dupRatio: 0.15,
        hsvHist: histUi
      }
    },
    {
      id: 'shot.3',
      range: range(6, 10),
      keyframes: {
        first: 'evidence/keyframes/s3.first.jpg',
        last: 'evidence/keyframes/s3.last.jpg'
      },
      confidence: 0.9,
      transitionIn: 'dissolve',
      forensics: {
        noiseSigma: 0.52,
        flatRatio: 0.14,
        meanFrameDiff: 5.8,
        dupRatio: 0.03,
        cameraMotionKind: 'smooth_move',
        hsvHist: histA
      }
    },
    {
      id: 'shot.4',
      range: range(10, 14),
      keyframes: { first: 'evidence/keyframes/s4.first.jpg' },
      confidence: 0.95,
      transitionIn: 'fade',
      forensics: {
        noiseSigma: 0.4,
        flatRatio: 0.18,
        meanFrameDiff: 2.1,
        dupRatio: 0.04,
        cameraMotionKind: 'planar_zoom_pan',
        kenburnsScore: 0.91,
        zoomPerSec: 0.035,
        panPxPerSec: 0.02,
        panDirDeg: 0
      }
    },
    {
      id: 'shot.5',
      range: range(14, 16),
      keyframes: { first: 'evidence/keyframes/s5.first.jpg' },
      confidence: 0.98,
      transitionIn: 'cut',
      forensics: {
        meanFrameDiff: 0.25,
        dupRatio: 0.98,
        flatRatio: 0.55
      }
    }
  ]

  const raw: SemanticTimeline = {
    id: 'stl.rea.1',
    schema: 'aiart.semantic-timeline@2',
    source: { assetId: 'asset-v1', fps: 30, duration: 16, width: 1080, height: 1920 },
    evidence: {
      mediaFacts: { durationSec: 16, fps: 30, width: 1080, height: 1920, hasAudio: true },
      shotsPath: 'evidence/shots.json',
      utterancesPath: 'evidence/utterances.json',
      entitiesPath: 'evidence/entities.json',
      ocrPath: 'evidence/ocr.json',
      hashes: {}
    },
    entities: [
      {
        id: 'ent.hero',
        kind: 'person',
        name: '女主角',
        pixelEditable: false,
        appearances: [
          { shotId: 'shot.1', range: range(0, 4) },
          { shotId: 'shot.3', range: range(6, 10) }
        ]
      }
    ],
    dialogue: [
      {
        id: 'dlg.1',
        range: range(0.5, 3.5),
        text: '这一秒决定成败',
        sourceText: '这一秒决定成败',
        granularity: 'sentence',
        confidence: 0.95,
        origin: 'analysis'
      }
    ],
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z'
  }

  return migrateSemanticTimeline(raw, { shots })
}

describe('rea-video 4-axis breakdown, Bayesian fusion & multi-route remake plan', () => {
  it('enforces hard physical invariants: frozen frames -> static_hold, rigid zoom/pan -> still_motion', () => {
    const frozen = fuseShotClassification({
      durationSec: 2.5,
      forensics: { meanFrameDiff: 0.2, dupRatio: 0.97 },
      vlmProbs: { ai_video: 0.9, live_action: 0.1 }
    })
    expect(frozen.label).toBe('static_hold')

    const kb = fuseShotClassification({
      durationSec: 3.0,
      forensics: {
        cameraMotionKind: 'planar_zoom_pan',
        kenburnsScore: 0.92,
        zoomPerSec: 0.04,
        panPxPerSec: 0.025,
        meanFrameDiff: 2.4
      },
      vlmProbs: { live_action: 0.85, still_motion: 0.15 }
    })
    expect(kb.label).toBe('still_motion')
  })

  it('caps confidence and flags disputed=true when forensics and VLM strongly disagree', () => {
    const disputed = fuseShotClassification({
      durationSec: 4.0,
      provenance: { make: 'Apple', model: 'iPhone 16 Pro', evidence: [] },
      forensics: {
        noiseSigma: 2.8,
        cameraMotionKind: 'handheld_like',
        signFlipRate: 0.42,
        meanFrameDiff: 8.5
      },
      vlmProbs: { ai_video: 0.88, live_action: 0.12 },
      vlmEvidence: ['Hands look slightly smoothed']
    })
    expect(disputed.disputed).toBe(true)
    expect(disputed.confidence).toBeLessThanOrEqual(0.7)
  })

  it('batches same-scene AI shots across short UI inserts into Generation Unit G1 and routes Ken Burns / static holds to local_ffmpeg', () => {
    const finalized = finalizeSemanticBreakdown(buildSampleTimeline(), {
      provenance: {
        aigcImplicitLabel: { label: '1', contentProducer: 'Seedance' },
        evidence: ['GB 45438 Label=1 (Seedance)']
      },
      audioAnalysis: {
        hasAudio: true,
        rmsDbfs: -16.4,
        peakDbfs: -1.2,
        perClipAudio: { atCutsDb: 9.4, withinShotsDb: 2.1, ratio: 4.48, resetsAtCuts: true },
        voice: { present: true, speechRatio: 0.55, f0MedianHz: 215, genderHint: 'female' },
        music: { present: true, bpm: 124, key: 'A minor', beatSyncedCutRatio: 0.6 },
        sfx: {
          present: true,
          events: [{ time: 4.0, kind: 'whoosh', syncedTo: 'cut', source: 'deterministic' }]
        }
      }
    })

    const shots = finalized.shots!
    expect(shots[0]!.base?.label).toBe('ai_video')
    expect(shots[2]!.base?.label).toBe('ai_video')
    expect(shots[3]!.base?.label).toBe('still_motion')
    expect(shots[4]!.base?.label).toBe('static_hold')

    // Shot 1 (0-4s) and Shot 3 (6-10s) share histA and bridge the 2s UI insert (Shot 2) -> grouped into G1!
    const units = finalized.breakdown!.productionPlan.units
    expect(units).toHaveLength(1)
    expect(units[0]!.id).toBe('G1')
    expect(units[0]!.shotIds).toEqual(['shot.1', 'shot.3'])
    expect(units[0]!.bridgedInsertShotIds).toEqual(['shot.2'])
    expect(units[0]!.referenceTags).toContain('@图片1')

    // Shot 4 & Shot 5 routed to zero-cost local FFmpeg units K1, K2
    expect(finalized.breakdown!.productionPlan.localUnits.map((u) => u.shotId)).toEqual([
      'shot.4',
      'shot.5'
    ])

    // Sound source detects per-clip AI native audio
    expect(finalized.breakdown!.audioAnalysis?.soundSources?.voice?.source).toBe('ai_video_native')

    // Direct 2-node remake planning (fidelity): G1 batched once, K1/K2 routed to localClips (0 paid video API calls for them!)
    const rebuild = planRemakeExecution(finalized, { strategy: 'fidelity' })
    expect(rebuild.units.map((u) => u.key)).toEqual(['G1'])
    expect(rebuild.localClips.map((c) => c.key)).toEqual(['shot.4', 'shot.5'])
    expect(rebuild.units.flatMap((u) => u.shotSlices.map((s) => s.shotId))).not.toContain('shot.4')
    expect(rebuild.units.flatMap((u) => u.shotSlices.map((s) => s.shotId))).not.toContain('shot.5')

    // Report & SRT export
    const md = renderBreakdownReportMd(finalized, 'zh')
    expect(md).toContain('G1')
    expect(md).toContain('K1')
    expect(md).toContain('Seedance')
    const srt = exportTimelineSubtitlesSrt(finalized)
    expect(srt).toContain('00:00:00,500 --> 00:00:03,500')
    expect(srt).toContain('这一秒决定成败')
  })

  it('supports instant reviewOverrideLabel, shot.split, and shot.merge while preserving clean baseline passthrough', () => {
    const doc = finalizeSemanticBreakdown(buildSampleTimeline(), {
      provenance: { aigcImplicitLabel: { label: '1' }, evidence: [] }
    })

    // 1. User overrides shot.2 from screen_capture/code_render to live_action -> instant re-plan to S1 without marking shot dirty!
    const overridden = applySemanticEdit(doc, {
      op: 'shot.update',
      target: 'shot.2',
      patch: { reviewOverrideLabel: 'live_action' }
    })
    expect(overridden.shots![1]!.base?.label).toBe('live_action')
    expect(overridden.shots![1]!.base?.decidedBy).toBe('review_override')
    expect(overridden.breakdown!.productionPlan.shootingSetups[0]!.shotIds).toContain('shot.2')
    const planAfterOverride = planRemakeExecution(overridden, { strategy: 'edit' })
    expect(planAfterOverride.segments.find((s) => s.key === 'shot.2')?.kind).toBe('source')

    // 2. Split shot.1 (0..4s) at 2.0s -> 6 shots total, both halves remain passthrough in edit strategy
    const splitDoc = applySemanticEdit(overridden, {
      op: 'shot.split',
      target: 'shot.1',
      patch: { splitAtSec: 2.0 }
    })
    expect(splitDoc.shots).toHaveLength(6)
    expect(splitDoc.shots![0]!.range).toMatchObject({ start: 0, end: 2 })
    expect(splitDoc.shots![1]!.range).toMatchObject({ start: 2, end: 4 })
    const splitPlan = planRemakeExecution(splitDoc, { strategy: 'edit' })
    expect(splitPlan.segments[0]!.kind).toBe('source')
    expect(splitPlan.segments[1]!.kind).toBe('source')

    // 3. Merge them back -> 5 shots total, still passthrough
    const mergedDoc = applySemanticEdit(splitDoc, {
      op: 'shot.merge',
      target: 'shot.1'
    })
    expect(mergedDoc.shots).toHaveLength(5)
    expect(mergedDoc.shots![0]!.range).toMatchObject({ start: 0, end: 4 })
    expect(planRemakeExecution(mergedDoc, { strategy: 'edit' }).segments[0]!.kind).toBe('source')
  })

  it('parses VLM shot batch & whole-video responses cleanly', () => {
    const batch = parseReaShotVlmBatch(
      '```json\n[{"shotId":"shot.1","baseLabel":"live_action","probs":{"live_action":0.9},"evidence":["natural skin pores"],"aiEdits":[{"kind":"lip_sync","confidence":0.8,"evidence":"jaw blur"}],"layers":[{"kind":"huazi","text":"爆款揭秘","position":"top"}],"realMaterials":[{"kind":"product","description":"耳机实拍","realMaterial":true}]}]\n```'
    )
    expect(batch).toHaveLength(1)
    expect(batch[0]!.baseLabel).toBe('live_action')
    expect(batch[0]!.aiEdits?.[0]?.kind).toBe('lip_sync')
    expect(batch[0]!.layers?.[0]?.kind).toBe('huazi')
    expect(batch[0]!.realMaterials?.[0]?.realMaterial).toBe(true)

    const whole = parseReaWholeVideoResponse(
      '{"summary":"数码测评短视频","hook":"前3秒抛出痛点","narration":{"type":"tts","voice":"沉稳男声"},"segments":[{"start":0,"end":4,"beat":"Hook","copy":"为什么总是断连"}]}'
    )
    expect(whole?.summary).toBe('数码测评短视频')
    expect(whole?.narration?.type).toBe('tts')
    expect(whole?.segments).toHaveLength(1)
  })

  it('materializes the built-in Video Breakdown & Remake 2-node workflow seed plan cleanly with zero warnings', () => {
    const seedPlan = buildVideoBreakdownRemakeSeedPlan('Video Breakdown & Remake')
    const materialized = materializeGraphPlan(seedPlan, {
      scope: 'subgraphAsset',
      assetType: 'subgraph'
    })
    expect(materialized.ok).toBe(true)
    expect(materialized.warnings).toEqual([])
    expect(materialized.document?.nodes.map((n) => n.typeId)).toEqual([
      'semantic.analyze',
      'semantic.rebuild',
      'graph.boundary.input',
      'graph.boundary.output'
    ])
    const hostIface = inferHostInterfaceFromGraph(materialized.document!)
    expect(hostIface.inputs.map((i) => i.dataType)).toEqual(
      expect.arrayContaining(['video', 'image'])
    )
    expect(hostIface.outputs.map((o) => o.dataType)).toContain('video')
  })
})
