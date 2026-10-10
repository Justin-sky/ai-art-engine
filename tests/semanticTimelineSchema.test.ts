import { describe, expect, it } from 'vitest'
import {
  BUILTIN_DIRECTOR_RULES,
  COMMERCE_VOCABULARY,
  SEMANTIC_TIMELINE_SCHEMA,
  adaptiveSceneThreshold,
  assertValidEdit,
  buildShotsFromCutPoints,
  compileDirectorCommands,
  createEmptySemanticTimeline,
  evaluateFidelity,
  expandVariantMatrix,
  fillTemplate,
  filterEventsRequiringEvidence,
  freezeBuildDefinition,
  makeTimeRange,
  matchStableEventId,
  parseSceneCutPtsTimes,
  planInvalidation,
  rebuildTracks,
  roundtripDurationOk,
  shortHash,
  singleShot,
  timelineId,
  timelineVersionHash,
  validateSemanticPack,
  validateSemanticTimeline,
  type SemanticEdit,
  type SemanticEvent,
  type ShotEvidence
} from '../src/shared/semanticTimeline'

describe('semanticTimeline schema', () => {
  it('creates a valid empty document', () => {
    const doc = createEmptySemanticTimeline('vid-1', {
      durationSec: 60,
      fps: 30,
      width: 1080,
      height: 1920,
      hasAudio: true
    })
    expect(doc.schema).toBe(SEMANTIC_TIMELINE_SCHEMA)
    expect(doc.id).toBe(timelineId('vid-1'))
    expect(doc.tracks).toHaveLength(8)
    const v = validateSemanticTimeline(doc)
    expect(v.ok).toBe(true)
  })

  it('rejects analysis events without evidence', () => {
    const doc = createEmptySemanticTimeline('vid-1', {
      durationSec: 10,
      fps: 30,
      width: 1280,
      height: 720,
      hasAudio: false
    })
    const bad: SemanticEvent = {
      id: 'ev.x',
      timeRange: makeTimeRange(0, 1, 30),
      type: 'story',
      label: 'hook',
      description: 'x',
      importance: 0.5,
      entities: [],
      evidence: [],
      intents: [],
      confidence: 0.9,
      origin: 'analysis'
    }
    doc.events = [bad]
    expect(validateSemanticTimeline(doc).ok).toBe(false)
    expect(filterEventsRequiringEvidence(doc.events)).toEqual([])
  })

  it('keeps stable event ids across re-analysis', () => {
    const prev = [
      {
        id: 'ev.keep',
        label: 'price_announce',
        timeRange: makeTimeRange(10, 14, 30)
      }
    ]
    const id = matchStableEventId('price_announce', makeTimeRange(10.2, 13.8, 30), prev)
    expect(id).toBe('ev.keep')
  })

  it('shortHash is stable', () => {
    expect(shortHash('abc')).toBe(shortHash('abc'))
    expect(shortHash('abc')).not.toBe(shortHash('abd'))
  })
})

describe('shots + L0 roundtrip', () => {
  it('builds shots from cut points and merges short ones', () => {
    const shots = buildShotsFromCutPoints([1, 1.1, 5, 9], 10, 30, { minShotSec: 0.4 })
    expect(shots.length).toBeGreaterThanOrEqual(3)
    expect(shots[0]!.range.start).toBe(0)
    expect(shots[shots.length - 1]!.range.end).toBe(10)
    const rt = roundtripDurationOk(10, shots, 30)
    expect(rt.ok).toBe(true)
  })

  it('singleShot covers whole duration', () => {
    const shots = singleShot(12.5, 25)
    expect(shots).toHaveLength(1)
    expect(roundtripDurationOk(12.5, shots, 25).ok).toBe(true)
  })

  it('parses ffmpeg scene pts_time', () => {
    const stderr = 'n:12 pts:123 pts_time:1.234 foo\npts_time=3.5 bar'
    expect(parseSceneCutPtsTimes(stderr)).toEqual([1.234, 3.5])
  })

  it('adaptive threshold clamps by duration', () => {
    expect(adaptiveSceneThreshold(10)).toBeLessThan(0.35)
    expect(adaptiveSceneThreshold(120)).toBeGreaterThan(0.35)
  })
})

describe('planner', () => {
  it('marks only entity shots for replaceEntity', () => {
    const doc = createEmptySemanticTimeline('vid', {
      durationSec: 10,
      fps: 30,
      width: 1080,
      height: 1920,
      hasAudio: true
    })
    const shots: ShotEvidence[] = buildShotsFromCutPoints([3, 7], 10, 30)
    doc.entities = [
      {
        id: 'ent.product.bottle',
        kind: 'product',
        name: 'bottle',
        appearances: [{ shotId: shots[1]!.id, range: shots[1]!.range }],
        pixelEditable: true
      }
    ]
    const edit: SemanticEdit = {
      id: 'edit.1',
      kind: 'replaceEntity',
      origin: 'user',
      createdAt: new Date().toISOString(),
      entityId: 'ent.product.bottle',
      newAssetId: 'asset-new'
    }
    const plan = planInvalidation({ timeline: doc, shots, edits: [edit] })
    expect(plan.targetLevel).toBe('L1')
    const videoItems = plan.items.filter((i) => i.productId.endsWith('.video'))
    const recomputed = videoItems.filter((i) => i.action === 'recompute')
    expect(recomputed.some((i) => i.productId.startsWith(shots[1]!.id))).toBe(true)
    expect(plan.cost.paidShotCount).toBe(1)
    const def = freezeBuildDefinition(doc, [edit], plan, timelineVersionHash(doc))
    expect(def.editIds).toEqual(['edit.1'])
    expect(def.frozenAt).toBeTruthy()
  })

  it('rewrite without lipSync stays L3 and local', () => {
    const doc = createEmptySemanticTimeline('vid', {
      durationSec: 5,
      fps: 30,
      width: 100,
      height: 100,
      hasAudio: true
    })
    const shots = singleShot(5, 30)
    const edit: SemanticEdit = {
      id: 'e2',
      kind: 'rewriteUtterance',
      origin: 'user',
      createdAt: new Date().toISOString(),
      utteranceId: 'utt.1',
      newText: 'hello'
    }
    const plan = planInvalidation({ timeline: doc, shots, edits: [edit] })
    expect(plan.targetLevel).toBe('L3')
    expect(plan.cost.paidSeconds).toBe(0)
  })
})

describe('compiler + packs + qc', () => {
  it('compiles price_announce to push_in', () => {
    const doc = createEmptySemanticTimeline('vid', {
      durationSec: 20,
      fps: 30,
      width: 1080,
      height: 1920,
      hasAudio: true
    })
    doc.events = [
      {
        id: 'ev.1',
        timeRange: makeTimeRange(8, 12, 30),
        type: 'product',
        label: 'price_announce',
        description: 'price',
        importance: 0.9,
        entities: [],
        evidence: ['shot.001'],
        intents: [],
        confidence: 0.8,
        origin: 'analysis'
      }
    ]
    const cmds = compileDirectorCommands(rebuildTracks(doc), {
      rulePacks: [BUILTIN_DIRECTOR_RULES]
    })
    expect(cmds.some((c) => c.kind === 'camera.push_in')).toBe(true)
  })

  it('validates semantic packs and expands variant matrix', () => {
    expect(
      validateSemanticPack({
        schemaVersion: 1,
        id: 'commerce-vocab',
        title: 'Commerce',
        kind: 'vocabulary',
        vocabulary: COMMERCE_VOCABULARY
      }).ok
    ).toBe(true)
    const rows = expandVariantMatrix([
      { key: 'product', values: ['a', 'b'] },
      { key: 'hook', values: ['h1', 'h2'] }
    ])
    expect(rows).toHaveLength(4)
    expect(fillTemplate('use {{product}}', { product: 'cream' })).toBe('use cream')
  })

  it('evaluates L1 fidelity thresholds', () => {
    const pass = evaluateFidelity('L1', {
      psnrOutsideMask: 50,
      ssimOutsideMask: 0.995,
      frameDelta: 0,
      audioSampleMatch: true,
      durationMatch: true
    })
    expect(pass.passed).toBe(true)
    const fail = evaluateFidelity('L1', {
      psnrOutsideMask: 30,
      ssimOutsideMask: 0.9,
      durationMatch: true
    })
    expect(fail.passed).toBe(false)
  })

  it('assertValidEdit checks required fields', () => {
    expect(
      assertValidEdit({
        id: 'x',
        kind: 'replaceEntity',
        origin: 'user',
        createdAt: '',
        entityId: '',
        newAssetId: 'a'
      } as SemanticEdit).ok
    ).toBe(false)
  })
})
