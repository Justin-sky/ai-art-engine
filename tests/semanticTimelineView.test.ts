import { describe, expect, it } from 'vitest'
import {
  resolveSemanticTimelineViewTarget,
  semanticTimelineSummaryText,
  semanticTimelineTextFromRunState
} from '../src/renderer/src/features/graph/model/semanticTimelineView'
import { semanticTimelineValue } from '../src/shared/graph/execute/semanticTimelineValue'
import { SEMANTIC_TIMELINE_SCHEMA } from '../src/shared/semanticTimeline'
import type { SemanticTimeline } from '../src/shared/semanticTimeline'
import type { GraphNodeRunState } from '../src/shared/graph/execute/types'

/**
 * 「语义分析跑完怎么看结果」这条链路的回归守卫。
 *
 * 实测踩过：时间线输出从纯文本换成结构化值（`kind: 'semanticTimeline'`）后，
 * 卡片的载荷解析只认 `kind === 'text'` —— 双击节点变成**静默无响应**，用户找不到结果。
 */
function makeDoc(id = 'stl.view0001'): SemanticTimeline {
  return {
    id,
    schema: SEMANTIC_TIMELINE_SCHEMA,
    source: {
      assetId: 'asset-1',
      relativePath: 'Cache/Videos/a.mp4',
      duration: 3,
      fps: 30,
      width: 640,
      height: 360
    },
    vocabulary: 'commerce.v1',
    tracks: [],
    events: [
      {
        id: 'ev-1',
        type: 'story',
        label: '开场',
        timeRange: { start: 0, end: 1, startFrame: 0, endFrame: 30 },
        confidence: 0.9,
        origin: 'analysis',
        evidence: [],
        intents: []
      }
    ],
    beats: [
      { id: 'bt-1', label: 'hook', timeRange: { start: 0, end: 1, startFrame: 0, endFrame: 30 } }
    ],
    intents: [],
    entities: [],
    evidence: {
      mediaFacts: 'evidence/mediaFacts.json',
      shots: 'evidence/shots.json',
      utterances: 'evidence/utterances.json',
      entities: 'evidence/entities.json',
      ocr: 'evidence/ocr.json',
      hashes: { shots: '9', utterances: '8', entities: '16', ocr: '2' }
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  } as unknown as SemanticTimeline
}

function runStateWith(outputs: Record<string, unknown>): GraphNodeRunState {
  return { status: 'done', outputs } as unknown as GraphNodeRunState
}

describe('semanticTimelineView', () => {
  it('结构化值也能取出时间线文本（这是双击失效的那个 bug）', () => {
    const doc = makeDoc()
    const text = semanticTimelineTextFromRunState(runStateWith({ out: semanticTimelineValue(doc) }))
    expect(JSON.parse(text).id).toBe('stl.view0001')
    // 旧的纯文本值仍要认
    expect(
      semanticTimelineTextFromRunState(runStateWith({ out: { kind: 'text', text: ' {"a":1} ' } }))
    ).toBe('{"a":1}')
    // 别的 kind / 空输出 → 空串
    expect(
      semanticTimelineTextFromRunState(runStateWith({ out: { kind: 'image', id: 'x' } }))
    ).toBe('')
    expect(semanticTimelineTextFromRunState(undefined)).toBe('')
  })

  it('查看目标优先用本次运行输出（带 inline JSON）', () => {
    const doc = makeDoc()
    const target = resolveSemanticTimelineViewTarget(
      { params: {} },
      runStateWith({ out: semanticTimelineValue(doc) })
    )
    expect(target?.id).toBe('stl.view0001')
    expect(target?.json).toBeTruthy()
  })

  it('没有运行输出时退回参数里的 timelineJson', () => {
    const doc = makeDoc('stl.fromparams')
    const target = resolveSemanticTimelineViewTarget(
      { params: { timelineJson: JSON.stringify(doc) } },
      null
    )
    expect(target?.id).toBe('stl.fromparams')
    expect(target?.json).toBeTruthy()
  })

  it('只剩 semanticTimelineId 时也能打开（重开工程后按 id 读盘）', () => {
    const target = resolveSemanticTimelineViewTarget(
      { params: { semanticTimelineId: 'stl.fromdisk' } },
      null
    )
    expect(target).toEqual({ id: 'stl.fromdisk' })
  })

  it('非法 / 不相干的 JSON 不算时间线目标', () => {
    expect(
      resolveSemanticTimelineViewTarget({ params: { timelineJson: '{oops' } }, null)
    ).toBeNull()
    // 有 id 但没有 source → 不是时间线文档
    expect(
      resolveSemanticTimelineViewTarget({ params: { timelineJson: '{"id":"stl.x"}' } }, null)
    ).toBeNull()
    expect(
      resolveSemanticTimelineViewTarget({ params: { timelineJson: '{"id":"other"}' } }, null)
    ).toBeNull()
    expect(
      resolveSemanticTimelineViewTarget({ params: { semanticTimelineId: 'not-an-id' } }, null)
    ).toBeNull()
  })

  it('输出摘要给 id 与规模（供卡片预览，不塞整份 JSON）', () => {
    const summary = semanticTimelineSummaryText(semanticTimelineValue(makeDoc()))
    expect(summary).toContain('stl.view0001')
    expect(summary).toContain('镜头 9')
    expect(summary).toContain('话语 8')
    expect(summary).toContain('实体 16')
    expect(summary).toContain('事件 1')
    expect(summary).toContain('节拍 1')
    // 摘要必须短（卡片上是一行）
    expect(summary.length).toBeLessThan(120)
    // 非该 kind → 空串
    expect(semanticTimelineSummaryText({ kind: 'text', text: 'hi' } as never)).toBe('')
    expect(semanticTimelineSummaryText(undefined)).toBe('')
  })
})
