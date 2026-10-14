import { describe, expect, it } from 'vitest'
import {
  applySemanticEdit,
  migrateSemanticTimeline,
  type SemanticTimeline
} from '../src/shared/semanticTimeline'
import {
  keepSelection,
  resolveSelection,
  selectionClipKey,
  selectionImpact,
  selectionSpan,
  shotLabel
} from '../src/renderer/src/features/graph/model/semanticSelection'

const range = (start: number, end: number) => ({
  start,
  end,
  startFrame: Math.floor(start * 30),
  endFrame: Math.floor(end * 30)
})

function makeDoc(): SemanticTimeline {
  return migrateSemanticTimeline(
    {
      id: 'stl.sel.1',
      schema: 'aiart.semantic-timeline@1',
      source: { assetId: 'asset-1', fps: 30, duration: 12, width: 1080, height: 1920 },
      evidence: { mediaFacts: {}, hashes: {} },
      entities: [
        {
          id: 'ent.person.host',
          kind: 'person',
          name: 'Host',
          appearances: [
            { shotId: 'shot.1', range: range(0, 4) },
            { shotId: 'shot.3', range: range(8, 12) }
          ],
          pixelEditable: false
        }
      ],
      events: [
        {
          id: 'ev.price',
          timeRange: range(9, 11),
          type: 'product',
          label: 'price_announce',
          description: '',
          importance: 0.9,
          entities: [],
          evidence: ['utt.1'],
          intents: ['intent.price'],
          confidence: 0.8,
          origin: 'analysis'
        }
      ],
      beats: [],
      intents: [
        {
          id: 'intent.price',
          trigger: 'ev.price',
          goal: 'sell',
          techniques: [{ track: 'camera', action: 'push_in' }],
          reason: '',
          origin: 'analysis'
        }
      ],
      tracks: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z'
    } as unknown as SemanticTimeline,
    {
      shots: [
        { id: 'shot.1', range: range(0, 4), keyframes: {}, confidence: 1 },
        { id: 'shot.2', range: range(4, 8), keyframes: {}, confidence: 1 },
        { id: 'shot.3', range: range(8, 12), keyframes: {}, confidence: 1 }
      ]
    }
  )
}

describe('语义 dive 选中模型', () => {
  it('片段键：实体带出现序号、意图带轨道，其余只用 id', () => {
    expect(selectionClipKey({ kind: 'event', id: 'ev.price' })).toBe('ev.price')
    expect(selectionClipKey({ kind: 'entity', id: 'ent.a', clip: 1 })).toBe('ent.a#1')
    expect(selectionClipKey({ kind: 'intent', id: 'intent.a', clip: 'camera' })).toBe(
      'intent.a#camera'
    )
    expect(selectionClipKey(null)).toBeNull()
  })

  it('解析选中：实体出现序号越界时退回第一次；不存在的对象给 null', () => {
    const doc = makeDoc()
    const entity = resolveSelection(doc, { kind: 'entity', id: 'ent.person.host', clip: 9 })
    expect(entity?.kind === 'entity' && entity.appearance).toBe(0)
    expect(resolveSelection(doc, { kind: 'event', id: 'ev.none' })).toBeNull()
    const shot = resolveSelection(doc, { kind: 'shot', id: 'shot.2' })
    expect(shot?.kind === 'shot' && shot.index).toBe(1)
    expect(shotLabel(doc, 'shot.2')).toBe('S2')
  })

  it('时间范围：意图取触发事件，实体取被点的那次出现', () => {
    const doc = makeDoc()
    const intent = resolveSelection(doc, { kind: 'intent', id: 'intent.price', clip: 'camera' })!
    expect(selectionSpan(doc, intent)).toEqual({ start: 9, end: 11 })
    const entity = resolveSelection(doc, { kind: 'entity', id: 'ent.person.host', clip: 1 })!
    expect(selectionSpan(doc, entity)).toMatchObject({ start: 8, end: 12 })
  })

  it('影响范围：改完意图，覆盖的镜头立刻显示为将重新生成', () => {
    const before = makeDoc()
    const sel = { kind: 'intent' as const, id: 'intent.price' }
    expect(selectionImpact(before, resolveSelection(before, sel)!)).toEqual([
      { shotId: 'shot.3', label: 'S3', status: 'passthrough' }
    ])
    const after = applySemanticEdit(before, {
      op: 'intent.update',
      target: 'intent.price',
      patch: { techniques: [{ track: 'camera', action: 'orbit' }] }
    })
    expect(selectionImpact(after, resolveSelection(after, sel)!)).toEqual([
      { shotId: 'shot.3', label: 'S3', status: 'regenerate' }
    ])
  })

  it('实体影响它出现过的所有镜头', () => {
    const doc = makeDoc()
    const impact = selectionImpact(
      doc,
      resolveSelection(doc, { kind: 'entity', id: 'ent.person.host' })!
    )
    expect(impact.map((i) => i.label)).toEqual(['S1', 'S3'])
  })

  it('删除后选中自动清空；对象还在就保持', () => {
    const doc = makeDoc()
    const sel = { kind: 'event' as const, id: 'ev.price' }
    expect(keepSelection(doc, sel)).toBe(sel)
    const removed = applySemanticEdit(doc, { op: 'event.remove', target: 'ev.price' })
    expect(keepSelection(removed, sel)).toBeNull()
  })
})
