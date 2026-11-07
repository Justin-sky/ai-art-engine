import { describe, expect, it } from 'vitest'
import {
  applySemanticEdit,
  migrateSemanticTimeline,
  type SemanticSelection,
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
      schema: 'aiart.semantic-timeline@2',
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
      dialogue: [
        {
          id: 'dlg.1',
          range: range(8.5, 11.5),
          text: '现在下单立省五十',
          sourceText: '现在下单立省五十',
          granularity: 'sentence',
          confidence: 0.9,
          origin: 'analysis'
        }
      ],
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
  it('片段键：实体带出现序号，镜头与台词只用 id', () => {
    expect(selectionClipKey({ kind: 'shot', id: 'shot.1' })).toBe('shot.1')
    expect(selectionClipKey({ kind: 'dialogue', id: 'dlg.1' })).toBe('dlg.1')
    expect(selectionClipKey({ kind: 'entity', id: 'ent.a', clip: 1 })).toBe('ent.a#1')
    expect(selectionClipKey(null)).toBeNull()
  })

  it('解析选中：实体出现序号越界时退回第一次；不存在的对象或未知 kind 给 null', () => {
    const doc = makeDoc()
    const entity = resolveSelection(doc, { kind: 'entity', id: 'ent.person.host', clip: 9 })
    expect(entity?.kind === 'entity' && entity.appearance).toBe(0)
    expect(resolveSelection(doc, { kind: 'shot', id: 'shot.none' })).toBeNull()
    expect(
      resolveSelection(doc, {
        kind: 'legacy' as never,
        id: 'ev.none'
      } as unknown as SemanticSelection)
    ).toBeNull()
    const shot = resolveSelection(doc, { kind: 'shot', id: 'shot.2' })
    expect(shot?.kind === 'shot' && shot.index).toBe(1)
    expect(shotLabel(doc, 'shot.2')).toBe('S2')
  })

  it('时间范围：镜头与台词取自身区间，实体取被点的那次出现', () => {
    const doc = makeDoc()
    const dlg = resolveSelection(doc, { kind: 'dialogue', id: 'dlg.1' })!
    expect(selectionSpan(doc, dlg)).toMatchObject({ start: 8.5, end: 11.5 })
    const entity = resolveSelection(doc, { kind: 'entity', id: 'ent.person.host', clip: 1 })!
    expect(selectionSpan(doc, entity)).toMatchObject({ start: 8, end: 12 })
  })

  it('影响范围：改完镜头或实体后，覆盖的镜头立刻显示为将重新生成', () => {
    const before = makeDoc()
    const sel = { kind: 'shot' as const, id: 'shot.3' }
    expect(selectionImpact(before, resolveSelection(before, sel)!)).toEqual([
      { shotId: 'shot.3', label: 'S3', status: 'passthrough' }
    ])
    const after = applySemanticEdit(before, {
      op: 'shot.update',
      target: 'shot.3',
      patch: { visual: { style: '胶片复古' } }
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

  it('对象不存在时自动清空选中；对象仍在（包括软删除镜头）则保持选中供恢复', () => {
    const doc = makeDoc()
    const sel = { kind: 'shot' as const, id: 'shot.2' }
    expect(keepSelection(doc, sel)).toBe(sel)
    const softRemoved = applySemanticEdit(doc, { op: 'shot.remove', target: 'shot.2' })
    expect(keepSelection(softRemoved, sel)).toBe(sel)
    expect(keepSelection(doc, { kind: 'entity', id: 'ent.missing' })).toBeNull()
  })
})
