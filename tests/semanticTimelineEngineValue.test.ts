import { describe, expect, it, vi } from 'vitest'
import { createNodeFromType, createOutputGraphNode, runGraph } from '../src/shared/graph'
import { graphOutputNodeId } from '../src/shared/graph/types'
import { SEMANTIC_TIMELINE_SCHEMA } from '../src/shared/semanticTimeline'
import type { SemanticTimeline } from '../src/shared/semanticTimeline'

/**
 * 语义时间线**经引擎贯通**的两件事（只测 executor 会绕过引擎那一层）：
 *
 * 1. 结构化时间线值能穿过引擎到达时间线口（消费侧拿到 doc，不必解析文本）；
 * 2. 它落到 **text 口**时由引擎在端口边界投影成文本 —— `semanticTimeline → text`
 *    是允许的单向兼容，投影不做实的话就是「连得上但读不到」。
 */

function makeDoc(): SemanticTimeline {
  return {
    id: 'stl.engine01',
    schema: SEMANTIC_TIMELINE_SCHEMA,
    source: { assetId: 'asset-1', fps: 24, duration: 12, width: 1920, height: 1080 },
    evidence: {
      mediaFacts: { durationSec: 12, fps: 24, width: 1920, height: 1080, hasAudio: true },
      shotsPath: 'shots.json',
      utterancesPath: 'utterances.json',
      entitiesPath: 'entities.json',
      ocrPath: 'ocr.json',
      hashes: {}
    },
    entities: [],
    events: [
      {
        id: 'ev-1',
        type: 'story',
        label: '开场镜头',
        timeRange: { start: 0, end: 2, startFrame: 0, endFrame: 48 },
        confidence: 0.9,
        origin: 'analysis',
        evidence: []
      }
    ],
    beats: [],
    intents: [],
    tracks: [],
    edits: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function buildGraph(options: { viaTrigger?: boolean } = {}) {
  // 分析节点用 sourceAssetId 指定来源，就不必再挂一个视频源节点
  const analyze = createNodeFromType(
    'video.semanticAnalyze',
    { x: 0, y: 0 },
    { params: { sourceAssetId: 'asset-1' } }
  )
  const output = createOutputGraphNode('text', { x: 480, y: 0 }, { id: graphOutputNodeId('text') })
  // 引擎会跳过「不通向任何输出节点」的节点，所以两条路都要接到边界输出
  if (!options.viaTrigger) {
    return {
      doc: {
        nodes: [analyze, output],
        edges: [
          { id: 'e1', source: analyze.id, target: output.id, sourcePort: 'out', targetPort: 'in' }
        ],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      analyzeId: analyze.id,
      outputId: output.id
    }
  }
  const trigger = createNodeFromType('semantic.trigger', { x: 240, y: 0 })
  return {
    doc: {
      nodes: [analyze, trigger, output],
      edges: [
        { id: 'e1', source: analyze.id, target: trigger.id, sourcePort: 'out', targetPort: 'in' },
        { id: 'e2', source: trigger.id, target: output.id, sourcePort: 'out', targetPort: 'in' }
      ],
      viewport: { x: 0, y: 0, zoom: 1 }
    },
    analyzeId: analyze.id,
    triggerId: trigger.id,
    outputId: output.id
  }
}

function capability() {
  return vi.fn(async () => ({
    timeline: makeDoc(),
    shots: [],
    utterances: [],
    keyframes: {},
    sourceRelativePath: 'Cache/Videos/a.mp4',
    method: 'scene' as const,
    notes: []
  }))
}

describe('语义时间线值经引擎贯通', () => {
  it('结构化值到达时间线口：触发节点消费 doc，事件进入下游输出', async () => {
    const { doc, triggerId, outputId } = buildGraph({ viaTrigger: true })
    const result = await runGraph(doc, { stepDelayMs: 1, analyzeSemanticVideo: capability() })

    expect(result.ok, result.error).toBe(true)
    expect(result.states?.[triggerId]?.status).toBe('done')
    expect(JSON.stringify(result.states?.[triggerId]?.outputs)).toContain('开场镜头')
    // 触发节点吃的是 doc（不是坏文本），所以下游输出里能看到该事件
    expect(JSON.stringify(result.states?.[outputId]?.outputs)).toContain('开场镜头')
  })

  it('落到文本口时被投影成文本（时间线 → text 的单向兼容真的可用）', async () => {
    const { doc, outputId } = buildGraph()
    const result = await runGraph(doc, { stepDelayMs: 1, analyzeSemanticVideo: capability() })

    expect(result.ok, result.error).toBe(true)
    const serialized = JSON.stringify(result.states?.[outputId]?.outputs)
    // 文本边界输出里应当能看到整份时间线（说明投影成了文本，而不是「连上但空」）
    expect(serialized).toContain('stl.engine01')
    expect(serialized).toContain(SEMANTIC_TIMELINE_SCHEMA)
  })

  it('分析节点本身产出结构化值（引擎里就是 semanticTimeline kind）', async () => {
    const { doc, analyzeId } = buildGraph()
    const result = await runGraph(doc, { stepDelayMs: 1, analyzeSemanticVideo: capability() })

    const out = result.states?.[analyzeId]?.outputs?.out as { kind?: string } | undefined
    expect(out?.kind).toBe('semanticTimeline')
  })
})
