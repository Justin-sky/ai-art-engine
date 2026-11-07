import { describe, expect, it } from 'vitest'
import {
  applyBatchVariantToTimeline,
  applySemanticEdit,
  diffAgainstBaseline,
  finalizeSemanticBreakdown,
  migrateSemanticTimeline,
  planRemakeExecution,
  resolveShotDisplayPrompts,
  type EntityReplacement,
  type SemanticTimeline,
  type ShotEvidence
} from '../src/shared/semanticTimeline'

const range = (start: number, end: number) => ({
  start,
  end,
  startFrame: Math.round(start * 30),
  endFrame: Math.round(end * 30)
})

function buildBridgedBreakdownTimeline(): SemanticTimeline {
  const histA = Array.from({ length: 24 }, (_, i) => (i < 6 ? 0.15 : 0.005))
  const shots: ShotEvidence[] = [
    {
      id: 'shot.1',
      range: range(0, 2),
      keyframes: {
        first: 'evidence/keyframes/s1.first.jpg',
        last: 'evidence/keyframes/s1.last.jpg'
      },
      confidence: 0.9,
      transitionIn: 'cut',
      forensics: {
        noiseSigma: 0.52,
        flatRatio: 0.12,
        meanFrameDiff: 6.1,
        dupRatio: 0.02,
        cameraMotionKind: 'smooth_move',
        hsvHist: histA
      }
    },
    {
      id: 'shot.2',
      range: range(2, 3.5),
      keyframes: { first: 'evidence/keyframes/s2.first.jpg' },
      confidence: 0.95,
      transitionIn: 'cut',
      forensics: {
        noiseSigma: 0.35,
        flatRatio: 0.18,
        meanFrameDiff: 2.1,
        dupRatio: 0.04,
        cameraMotionKind: 'planar_zoom_pan',
        kenburnsScore: 0.92,
        zoomPerSec: 0.04,
        panPxPerSec: 0.02,
        panDirDeg: 0
      }
    },
    {
      id: 'shot.3',
      range: range(3.5, 5.5),
      keyframes: {
        first: 'evidence/keyframes/s3.first.jpg',
        last: 'evidence/keyframes/s3.last.jpg'
      },
      confidence: 0.91,
      transitionIn: 'cut',
      forensics: {
        noiseSigma: 0.5,
        flatRatio: 0.14,
        meanFrameDiff: 5.9,
        dupRatio: 0.03,
        cameraMotionKind: 'smooth_move',
        hsvHist: histA
      }
    },
    {
      id: 'shot.4',
      range: range(5.5, 7.0),
      keyframes: { first: 'evidence/keyframes/s4.first.jpg' },
      confidence: 0.98,
      transitionIn: 'cut',
      forensics: {
        meanFrameDiff: 0.22,
        dupRatio: 0.98,
        flatRatio: 0.55
      }
    },
    {
      id: 'shot.5',
      range: range(7.0, 9.0),
      keyframes: { first: 'evidence/keyframes/s5.first.jpg' },
      confidence: 0.94,
      transitionIn: 'cut',
      forensics: {
        noiseSigma: 0.08,
        flatRatio: 0.72,
        axisEdgeRatio: 0.78,
        palette95: 12,
        meanFrameDiff: 2.8,
        dupRatio: 0.25
      }
    }
  ]

  const base = migrateSemanticTimeline(
    {
      id: 'stl.remake.1',
      schema: 'aiart.semantic-timeline@2',
      source: { assetId: 'asset-remake', fps: 30, duration: 9, width: 1080, height: 1920 },
      evidence: {
        mediaFacts: { durationSec: 9, fps: 30, width: 1080, height: 1920, hasAudio: true },
        shotsPath: 'evidence/shots.json',
        utterancesPath: 'evidence/utterances.json',
        entitiesPath: 'evidence/entities.json',
        ocrPath: 'evidence/ocr.json',
        hashes: {}
      },
      entities: [
        {
          id: 'ent.host',
          kind: 'person',
          name: '主播', // cjk-ok
          pixelEditable: false,
          appearances: [
            { shotId: 'shot.1', range: range(0, 2) },
            { shotId: 'shot.3', range: range(3.5, 5.5) }
          ]
        }
      ],
      dialogue: [
        {
          id: 'dlg.1',
          range: range(0.2, 1.8),
          text: '开场三秒抓住注意力', // cjk-ok
          sourceText: '开场三秒抓住注意力', // cjk-ok
          granularity: 'sentence',
          confidence: 0.95,
          origin: 'analysis'
        },
        {
          id: 'dlg.2',
          range: range(3.6, 5.2),
          text: '核心卖点一镜看清', // cjk-ok
          sourceText: '核心卖点一镜看清', // cjk-ok
          granularity: 'sentence',
          confidence: 0.92,
          origin: 'analysis'
        }
      ],
      updatedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z'
    },
    { shots }
  )

  return finalizeSemanticBreakdown(base, {
    provenance: {
      aigcImplicitLabel: { label: '1', contentProducer: 'Seedance' },
      evidence: ['GB 45438 Label=1']
    }
  })
}

describe('planRemakeExecution & G1..Gk / K1..Kk multi-route remake engine', () => {
  it('edit strategy: zero modifications produce 0 AI calls, 0 local clips, and 100% source passthrough', () => {
    const doc = buildBridgedBreakdownTimeline()
    const plan = planRemakeExecution(doc, { strategy: 'edit' })

    expect(plan.units).toHaveLength(0)
    expect(plan.localClips).toHaveLength(0)
    expect(plan.dubs).toHaveLength(0)
    expect(plan.generatedShots).toBe(0)
    expect(plan.passthroughShots).toBe(5)
    expect(plan.segments.map((s) => `${s.key}:${s.kind}`)).toEqual([
      'shot.1:source',
      'shot.2:source',
      'shot.3:source',
      'shot.4:source',
      'shot.5:source'
    ])
  })

  it('edit strategy: editing a single shot regenerates only that shot; editing unit.prompt batches G1 with proportional slices', () => {
    const doc = buildBridgedBreakdownTimeline()

    // 1. Edit only shot.1 inside G1 (shot.1 + shot.3) -> only shot.1 regenerates!
    const oneShotEdited = applySemanticEdit(doc, {
      op: 'shot.prompt',
      target: 'shot.1',
      patch: { prompt: '主播手持新款耳机特写，暖色逆光' } // cjk-ok
    })
    const singlePlan = planRemakeExecution(oneShotEdited, { strategy: 'edit' })
    expect(singlePlan.units).toHaveLength(1)
    expect(singlePlan.units[0]!.shotSlices.map((s) => s.shotId)).toEqual(['shot.1'])
    expect(singlePlan.segments.map((s) => `${s.key}:${s.kind}`)).toEqual([
      'shot.1:generate',
      'shot.2:source',
      'shot.3:source',
      'shot.4:source',
      'shot.5:source'
    ])

    // 2. Edit G1 unit prompt via unit.prompt -> batches shot.1 (2s) + shot.3 (2s) into 1 G1 task!
    const unitEdited = applySemanticEdit(doc, {
      op: 'unit.prompt',
      target: 'G1',
      patch: {
        videoPrompt: '赛博朋克直播间主播讲解数码新品，多机位顺滑切换', // cjk-ok
        imagePrompt: '赛博朋克主播首帧参考图' // cjk-ok
      }
    })
    expect(diffAgainstBaseline(unitEdited).dirtyShots.get('shot.1')).toContain('unit_prompt')
    expect(diffAgainstBaseline(unitEdited).dirtyShots.get('shot.3')).toContain('unit_prompt')

    const unitPlan = planRemakeExecution(unitEdited, { strategy: 'edit' })
    expect(unitPlan.units).toHaveLength(1)
    const g1 = unitPlan.units[0]!
    expect(g1.key).toBe('G1')
    expect(g1.shotSlices.map((s) => s.shotId)).toEqual(['shot.1', 'shot.3'])
    expect(g1.durationSec).toBeCloseTo(4.0)
    expect(g1.videoPrompt).toContain('赛博朋克直播间') // cjk-ok
    expect(g1.imagePrompt).toContain('赛博朋克主播首帧') // cjk-ok
    expect(g1.shotSlices).toEqual([
      expect.objectContaining({
        shotId: 'shot.1',
        durationSec: 2,
        offsetRatio: 0,
        durationRatio: 0.5
      }),
      expect.objectContaining({
        shotId: 'shot.3',
        durationSec: 2,
        offsetRatio: 0.5,
        durationRatio: 0.5
      })
    ])

    // Bridged insert shot.2 stays untouched source passthrough in edit mode!
    expect(unitPlan.segments.find((s) => s.key === 'shot.2')?.kind).toBe('source')
    expect(unitPlan.segments.find((s) => s.key === 'shot.1')).toMatchObject({
      kind: 'generate',
      clipOffsetRatio: 0,
      clipDurationRatio: 0.5
    })
    expect(unitPlan.segments.find((s) => s.key === 'shot.3')).toMatchObject({
      kind: 'generate',
      clipOffsetRatio: 0.5,
      clipDurationRatio: 0.5
    })
  })

  it('fidelity strategy: batches bridged G1 once, routes K1/K2 to zero-cost local FFmpeg, and protects screen_capture real footage', () => {
    const doc = buildBridgedBreakdownTimeline()
    const plan = planRemakeExecution(doc, { strategy: 'fidelity' })

    // 1 paid AI call (G1 covering shot.1 + shot.3 = 4s total)
    expect(plan.units).toHaveLength(1)
    expect(plan.units[0]!.key).toBe('G1')
    expect(plan.units[0]!.shotSlices.map((s) => s.shotId)).toEqual(['shot.1', 'shot.3'])
    expect(plan.units[0]!.durationSec).toBeCloseTo(4.0)

    // 2 zero-cost local FFmpeg clips: shot.2 (ken_burns) and shot.4 (static_hold)
    expect(plan.localClips.map((c) => `${c.key}:${c.mode}`)).toEqual([
      'shot.2:ken_burns',
      'shot.4:static_hold'
    ])

    // shot.5 is screen_capture / code_render -> protected passthrough!
    expect(plan.segments.find((s) => s.key === 'shot.5')?.kind).toBe('source')
    expect(plan.passthroughShots).toBe(1)
    expect(plan.generatedShots).toBe(2)
  })

  it('adapt strategy & single-shot rerun (onlyShotIds) apply global instruction, entity replacements, and targeted reruns', () => {
    const rep: EntityReplacement = {
      instruction: '换成 @1 的虚拟偶像', // cjk-ok
      references: [{ relativePath: 'Assets/refs/vtuber.png', label: '虚拟偶像' }], // cjk-ok
      masks: []
    }
    const adaptedDoc = applySemanticEdit(buildBridgedBreakdownTimeline(), {
      op: 'entity.replace',
      target: 'ent.host',
      patch: { replacement: rep }
    })

    const adaptPlan = planRemakeExecution(adaptedDoc, {
      strategy: 'adapt',
      instruction: '整体采用日系胶片色调' // cjk-ok
    })
    expect(adaptPlan.units).toHaveLength(1)
    expect(adaptPlan.units[0]!.videoPrompt).toContain('整体采用日系胶片色调') // cjk-ok
    expect(adaptPlan.units[0]!.replacements).toHaveLength(1)
    expect(adaptPlan.units[0]!.replacements[0]!.entityName).toBe('主播') // cjk-ok

    // Single-shot rerun: onlyShotIds=['shot.3'] runs ONLY shot.3, keeping everything else passthrough!
    const rerunPlan = planRemakeExecution(adaptedDoc, {
      strategy: 'adapt',
      onlyShotIds: ['shot.3']
    })
    expect(rerunPlan.units).toHaveLength(1)
    expect(rerunPlan.units[0]!.shotSlices.map((s) => s.shotId)).toEqual(['shot.3'])
    expect(rerunPlan.localClips).toHaveLength(0)
    expect(rerunPlan.segments.map((s) => `${s.key}:${s.kind}`)).toEqual([
      'shot.1:source',
      'shot.2:source',
      'shot.3:generate',
      'shot.4:source',
      'shot.5:source'
    ])
  })

  it('resolveShotDisplayPrompts and applyBatchVariantToTimeline reflect overrides and promote edit -> adapt cleanly', () => {
    const doc = buildBridgedBreakdownTimeline()
    const withUnitOverride = applySemanticEdit(doc, {
      op: 'unit.prompt',
      target: 'G1',
      patch: { videoPrompt: '自定义 G1 视频提示词' } // cjk-ok
    })
    const displayMap = resolveShotDisplayPrompts(withUnitOverride)
    expect(displayMap['shot.1']).toContain('自定义 G1 视频提示词') // cjk-ok
    expect(displayMap['shot.3']).toContain('自定义 G1 视频提示词') // cjk-ok

    // Pure whole-video persona/style variant promotes edit -> adapt so all generative units adopt the style
    const { promotesToAdapt: pureStylePromotes } = applyBatchVariantToTimeline(doc, {
      id: 'var-style-only',
      title: 'Style Only Variant',
      instruction: '赛博霓虹夜景风格', // cjk-ok
      dubVoice: 'alloy'
    })
    expect(pureStylePromotes).toBe(true)

    // Targeted per-shot / entity override variant updates promptOverride, dialogue, and entity replacement cleanly
    const { timeline: variantDoc, promotesToAdapt: targetedPromotes } = applyBatchVariantToTimeline(
      doc,
      {
        id: 'var-en-cyber',
        title: 'Cyberpunk Variant',
        instruction: '赛博霓虹夜景风格', // cjk-ok
        dubVoice: 'alloy',
        dialogueOverrides: {
          '#1': '三秒颠覆你的认知' // cjk-ok
        },
        shotPromptOverrides: {
          'shot.3': '全息悬浮产品特写镜头' // cjk-ok
        },
        entityReferenceOverrides: {
          主播: 'asset-vtuber-1' // cjk-ok
        }
      }
    )

    expect(targetedPromotes).toBe(false)
    expect(variantDoc.dialogue?.[0]?.text).toBe('三秒颠覆你的认知') // cjk-ok
    expect(variantDoc.shots?.find((s) => s.id === 'shot.3')?.promptOverride).toBe(
      '全息悬浮产品特写镜头' // cjk-ok
    )
    expect(variantDoc.entities[0]?.replacement?.references[0]?.assetId).toBe('asset-vtuber-1')
  })
})
