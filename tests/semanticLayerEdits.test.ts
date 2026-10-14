import { describe, expect, it } from 'vitest'
import {
  applySemanticEdit,
  buildPromptPlan,
  carryOverSemanticEdits,
  diffAgainstBaseline,
  intentsRemovedWithEvent,
  migrateSemanticTimeline,
  rebaselineSemanticTimeline,
  shotSemanticInputs,
  type SemanticTimeline
} from '../src/shared/semanticTimeline'

/**
 * 语义层修改（事件 / 节拍 / 意图）→ 语义指纹 → 只重生成受影响的镜头。
 * 不变量：语义层零修改时全部直通；只改声音轨的手法不让画面重出。
 */

const range = (start: number, end: number) => ({
  start,
  end,
  startFrame: Math.floor(start * 30),
  endFrame: Math.floor(end * 30)
})

function makeDoc(): SemanticTimeline {
  const base = {
    id: 'stl.layer.1',
    schema: 'aiart.semantic-timeline@1',
    source: { assetId: 'asset-1', fps: 30, duration: 12, width: 1080, height: 1920 },
    evidence: { mediaFacts: {}, hashes: {} },
    entities: [],
    events: [
      {
        id: 'ev.hook',
        timeRange: range(0, 2),
        type: 'story',
        label: 'hook_line',
        description: '开场抛问题',
        importance: 0.6,
        entities: [],
        evidence: ['utt.1'],
        intents: [],
        confidence: 0.8,
        origin: 'analysis'
      },
      {
        id: 'ev.price',
        timeRange: range(9, 11),
        type: 'product',
        label: 'price_announce',
        description: '报价',
        importance: 0.9,
        entities: [],
        evidence: ['utt.2'],
        intents: ['intent.price'],
        confidence: 0.8,
        origin: 'analysis'
      }
    ],
    beats: [
      {
        id: 'beat.hook',
        type: 'hook',
        vocabulary: 'commerce.v1',
        timeRange: range(0, 4),
        emotion: { label: 'curious', intensity: 0.5 },
        description: '',
        events: ['ev.hook']
      },
      {
        id: 'beat.offer',
        type: 'offer',
        vocabulary: 'commerce.v1',
        timeRange: range(8, 12),
        emotion: { label: 'excited', intensity: 0.7 },
        description: '',
        events: ['ev.price']
      }
    ],
    intents: [
      {
        id: 'intent.price',
        trigger: 'ev.price',
        goal: 'sell',
        techniques: [
          { track: 'camera', action: 'push_in' },
          { track: 'audio', action: 'emphasis' }
        ],
        reason: '',
        origin: 'analysis'
      }
    ],
    tracks: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z'
  } as unknown as SemanticTimeline
  return migrateSemanticTimeline(base, {
    shots: [
      { id: 'shot.1', range: range(0, 4), keyframes: {}, confidence: 1 },
      { id: 'shot.2', range: range(4, 8), keyframes: {}, confidence: 1 },
      { id: 'shot.3', range: range(8, 12), keyframes: {}, confidence: 1 }
    ]
  })
}

const dirty = (doc: SemanticTimeline) => diffAgainstBaseline(doc).dirtyShots

describe('语义指纹：基线与脏检测', () => {
  it('分析结果打上语义指纹；零修改全部直通', () => {
    const doc = makeDoc()
    expect(Object.keys(doc.baseline?.semantic ?? {})).toEqual(['shot.1', 'shot.2', 'shot.3'])
    expect(dirty(doc).size).toBe(0)
    expect(buildPromptPlan({ timeline: doc, shots: [] }).shots.map((s) => s.strategy)).toEqual([
      'passthrough',
      'passthrough',
      'passthrough'
    ])
  })

  it('改意图的画面手法：只有它覆盖的镜头重新生成，原因是 intent', () => {
    const doc = applySemanticEdit(makeDoc(), {
      op: 'intent.update',
      target: 'intent.price',
      patch: {
        techniques: [
          { track: 'camera', action: 'orbit' },
          { track: 'audio', action: 'emphasis' }
        ]
      }
    })
    expect([...dirty(doc).keys()]).toEqual(['shot.3'])
    expect(dirty(doc).get('shot.3')).toContain('intent')
    expect(doc.edits?.at(-1)?.affectedShots).toEqual(['shot.3'])
    const plan = buildPromptPlan({ timeline: doc, shots: [] })
    expect(plan.shots.find((s) => s.shotId === 'shot.3')?.strategy).toBe('regenerate')
    expect(plan.shots.find((s) => s.shotId === 'shot.1')?.strategy).toBe('passthrough')
  })

  it('只改声音轨手法：画面不重生成', () => {
    const doc = applySemanticEdit(makeDoc(), {
      op: 'intent.update',
      target: 'intent.price',
      patch: {
        techniques: [
          { track: 'camera', action: 'push_in' },
          { track: 'audio', action: 'whisper' }
        ]
      }
    })
    expect(dirty(doc).size).toBe(0)
  })

  it('挪事件时间：移出的镜头和移入的镜头都重新生成', () => {
    const doc = applySemanticEdit(makeDoc(), {
      op: 'event.update',
      target: 'ev.hook',
      patch: { start: 5, end: 7 }
    })
    expect([...dirty(doc).keys()].sort()).toEqual(['shot.1', 'shot.2'])
    const ev = doc.events.find((e) => e.id === 'ev.hook')!
    expect(ev.timeRange).toEqual({ start: 5, end: 7, startFrame: 150, endFrame: 210 })
    expect(ev.origin).toBe('user')
  })

  it('改节拍类型：覆盖的镜头重新生成，原因是 beat', () => {
    const doc = applySemanticEdit(makeDoc(), {
      op: 'beat.update',
      target: 'beat.hook',
      patch: { type: 'problem', emotionIntensity: 0.9 }
    })
    expect([...dirty(doc).keys()]).toEqual(['shot.1'])
    expect(dirty(doc).get('shot.1')).toContain('beat')
    expect(doc.beats.find((b) => b.id === 'beat.hook')).toMatchObject({
      type: 'problem',
      emotion: { label: 'curious', intensity: 0.9 },
      origin: 'user'
    })
  })

  it('只改节拍情绪强度（规则不看强度）：不重生成', () => {
    const doc = applySemanticEdit(makeDoc(), {
      op: 'beat.update',
      target: 'beat.hook',
      patch: { emotionIntensity: 0.1 }
    })
    expect(dirty(doc).size).toBe(0)
  })
})

describe('语义层修改：级联与校验', () => {
  it('删事件：以它触发的意图一起删，节拍引用清掉；可预演', () => {
    const before = makeDoc()
    expect(intentsRemovedWithEvent(before, 'ev.price').map((i) => i.id)).toEqual(['intent.price'])
    const doc = applySemanticEdit(before, { op: 'event.remove', target: 'ev.price' })
    expect(doc.events.map((e) => e.id)).toEqual(['ev.hook'])
    expect(doc.intents).toHaveLength(0)
    expect(doc.beats.find((b) => b.id === 'beat.offer')?.events).toEqual([])
    expect(dirty(doc).get('shot.3')).toContain('event')
  })

  it('删意图：事件上的引用一并清掉', () => {
    const doc = applySemanticEdit(makeDoc(), { op: 'intent.remove', target: 'intent.price' })
    expect(doc.intents).toHaveLength(0)
    expect(doc.events.find((e) => e.id === 'ev.price')?.intents).toEqual([])
    expect([...dirty(doc).keys()]).toEqual(['shot.3'])
  })

  it('改意图触发事件：事件上的 intents 引用跟着走', () => {
    const doc = applySemanticEdit(makeDoc(), {
      op: 'intent.update',
      target: 'intent.price',
      patch: { trigger: 'ev.hook' }
    })
    expect(doc.events.find((e) => e.id === 'ev.hook')?.intents).toEqual(['intent.price'])
    expect(doc.events.find((e) => e.id === 'ev.price')?.intents).toEqual([])
    expect([...dirty(doc).keys()].sort()).toEqual(['shot.1', 'shot.3'])
  })

  it('改事件 label：按旧 label 触发的意图改成按 id 触发，不悄悄脱钩', () => {
    const base = makeDoc()
    const labelTriggered: SemanticTimeline = {
      ...base,
      intents: base.intents.map((i) => ({ ...i, trigger: 'price_announce' }))
    }
    const doc = applySemanticEdit(labelTriggered, {
      op: 'event.update',
      target: 'ev.price',
      patch: { label: 'price_reveal' }
    })
    expect(doc.intents[0]!.trigger).toBe('ev.price')
    expect(shotSemanticInputs(doc, range(8, 12)).intents.map((i) => i.id)).toEqual(['intent.price'])
  })

  it.each([
    ['event.update', 'ev.hook', { label: '  ' }, /label/],
    ['event.update', 'ev.hook', { importance: 1.5 }, /0\.\.1/],
    ['event.update', 'ev.hook', { start: 3, end: 2 }, /start < end/],
    ['event.update', 'ev.hook', { end: 99 }, /duration/],
    ['event.update', 'ev.hook', { type: 'nope' }, /event type/],
    ['intent.update', 'intent.price', { trigger: 'ev.missing' }, /existing event/],
    ['intent.update', 'intent.price', { techniques: [{ track: 'x', action: 'a' }] }, /track/],
    ['intent.update', 'intent.price', { techniques: [{ track: 'camera', action: '' }] }, /action/],
    ['intent.update', 'intent.price', { goal: '' }, /goal/],
    ['beat.update', 'beat.hook', { emotionIntensity: -1 }, /0\.\.1/],
    ['event.remove', 'ev.missing', {}, /not found/],
    ['intent.remove', 'intent.missing', {}, /not found/]
  ] as const)('%s %s %j → 拒绝', (op, target, patch, message) => {
    expect(() =>
      applySemanticEdit(makeDoc(), { op, target, patch: patch as Record<string, unknown> })
    ).toThrow(message)
  })
})

describe('语义层修改：旧文档与重新分析', () => {
  it('旧文档（基线没有语义指纹）：加载时补齐，零修改仍然零脏；补齐后修改照常生效', () => {
    const doc = makeDoc()
    const legacy: SemanticTimeline = {
      ...doc,
      baseline: { shots: doc.baseline!.shots, dialogue: doc.baseline!.dialogue, createdAt: 'x' }
    }
    const migrated = migrateSemanticTimeline(legacy)
    expect(Object.keys(migrated.baseline?.semantic ?? {})).toHaveLength(3)
    expect(dirty(migrated).size).toBe(0)
    const edited = applySemanticEdit(migrated, { op: 'intent.remove', target: 'intent.price' })
    expect([...dirty(edited).keys()]).toEqual(['shot.3'])
  })

  it('重设基线（富化后）：语义层修改仍算改过', () => {
    const edited = applySemanticEdit(makeDoc(), {
      op: 'event.update',
      target: 'ev.hook',
      patch: { description: '换一个开场问题' }
    })
    const rebased = rebaselineSemanticTimeline(edited)
    expect([...dirty(rebased).keys()]).toEqual(['shot.1'])
  })

  it('重新分析：改过的事件、删掉的意图都带到新文档', () => {
    let edited = applySemanticEdit(makeDoc(), {
      op: 'event.update',
      target: 'ev.hook',
      patch: { description: '换一个开场问题' }
    })
    edited = applySemanticEdit(edited, { op: 'intent.remove', target: 'intent.price' })
    const carried = rebaselineSemanticTimeline(carryOverSemanticEdits(edited, makeDoc()))
    expect(carried.events.find((e) => e.id === 'ev.hook')?.description).toBe('换一个开场问题')
    expect(carried.intents).toHaveLength(0)
    expect([...dirty(carried).keys()].sort()).toEqual(['shot.1', 'shot.3'])
  })

  it('重新分析后同 id 的事件不在了：用户改过的事件追加回来', () => {
    const edited = applySemanticEdit(makeDoc(), {
      op: 'event.update',
      target: 'ev.hook',
      patch: { description: '用户写的开场' }
    })
    const fresh = makeDoc()
    const withoutHook: SemanticTimeline = {
      ...fresh,
      events: fresh.events.filter((e) => e.id !== 'ev.hook')
    }
    const carried = carryOverSemanticEdits(edited, withoutHook)
    expect(carried.events.find((e) => e.id === 'ev.hook')?.description).toBe('用户写的开场')
  })
})
