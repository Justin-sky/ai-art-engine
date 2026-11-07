import { describe, expect, it, vi } from 'vitest'
import { createNodeFromType, createOutputGraphNode, runGraph } from '../src/shared/graph'
import { graphOutputNodeId } from '../src/shared/graph/types'
import {
  SEMANTIC_TIMELINE_SCHEMA,
  finalizeSemanticBreakdown,
  makeTimeRange,
  migrateSemanticTimeline,
  type SemanticTimeline
} from '../src/shared/semanticTimeline'

/**
 * 语义时间线值经图引擎贯通守卫：
 * 1. `semantic.analyze` → `semantic.rebuild` → 视频输出口：结构化 `semanticTimeline` 直连贯通并产出成片；
 * 2. `semantic.analyze` → 文本输出口：端口边界单向投影成规范 JSON 文本。
 */

function makeDoc(): SemanticTimeline {
  const migrated = migrateSemanticTimeline(
    {
      id: 'stl.engine01',
      schema: SEMANTIC_TIMELINE_SCHEMA,
      source: { assetId: 'asset-1', fps: 24, duration: 8, width: 1920, height: 1080 },
      evidence: {
        mediaFacts: { durationSec: 8, fps: 24, width: 1920, height: 1080, hasAudio: true },
        shotsPath: 'shots.json',
        utterancesPath: 'utterances.json',
        entitiesPath: 'entities.json',
        ocrPath: 'ocr.json',
        hashes: {}
      },
      entities: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    },
    {
      shots: [
        {
          id: 'shot.1',
          range: makeTimeRange(0, 4, 24),
          keyframes: { first: 'evidence/keyframes/s1.jpg' },
          confidence: 0.9
        },
        {
          id: 'shot.2',
          range: makeTimeRange(4, 8, 24),
          keyframes: { first: 'evidence/keyframes/s2.jpg' },
          confidence: 0.9
        }
      ]
    }
  )
  return finalizeSemanticBreakdown(migrated)
}

function buildTextGraph() {
  const analyze = createNodeFromType(
    'semantic.analyze',
    { x: 0, y: 0 },
    { params: { sourceAssetId: 'asset-1' } }
  )
  const output = createOutputGraphNode('text', { x: 480, y: 0 }, { id: graphOutputNodeId('text') })
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

function buildRebuildGraph() {
  const analyze = createNodeFromType(
    'semantic.analyze',
    { x: 0, y: 0 },
    { params: { sourceAssetId: 'asset-1' } }
  )
  const rebuild = createNodeFromType(
    'semantic.rebuild',
    { x: 240, y: 0 },
    { params: { remakeStrategy: 'edit' } }
  )
  const output = createOutputGraphNode(
    'video',
    { x: 520, y: 0 },
    { id: graphOutputNodeId('video') }
  )
  return {
    doc: {
      nodes: [analyze, rebuild, output],
      edges: [
        { id: 'e1', source: analyze.id, target: rebuild.id, sourcePort: 'out', targetPort: 'in' },
        {
          id: 'e2',
          source: rebuild.id,
          target: output.id,
          sourcePort: 'out-video',
          targetPort: 'in'
        }
      ],
      viewport: { x: 0, y: 0, zoom: 1 }
    },
    analyzeId: analyze.id,
    rebuildId: rebuild.id,
    outputId: output.id
  }
}

function capability() {
  const doc = makeDoc()
  return vi.fn(async () => ({
    timeline: doc,
    shots: [
      { id: 'shot.1', range: makeTimeRange(0, 4, 24), keyframes: {}, confidence: 0.9 },
      { id: 'shot.2', range: makeTimeRange(4, 8, 24), keyframes: {}, confidence: 0.9 }
    ],
    utterances: [],
    keyframes: {},
    sourceRelativePath: 'Cache/Videos/a.mp4',
    method: 'scene' as const,
    notes: []
  }))
}

describe('语义时间线值经引擎贯通', () => {
  it('二节点直连：分析节点产出的结构化时间线直通重制节点并产出成片视频', async () => {
    const { doc, rebuildId, outputId } = buildRebuildGraph()
    const rebuiltInputs: Array<Record<string, unknown>> = []
    const result = await runGraph(doc, {
      stepDelayMs: 1,
      analyzeSemanticVideo: capability(),
      rebuildSemanticVideo: vi.fn(async (input: Record<string, unknown>) => {
        rebuiltInputs.push(input)
        return {
          ok: true,
          outputRelativePath: 'Output/direct_rebuilt.mp4',
          manifestRelativePath: 'Output/direct_rebuilt.json',
          clipCount: 0,
          burnedSubtitles: 0,
          keptAudio: true,
          notes: []
        }
      })
    })

    expect(result.ok, result.error).toBe(true)
    expect(result.states?.[rebuildId]?.status).toBe('done')
    expect(rebuiltInputs).toHaveLength(1)
    expect(rebuiltInputs[0]?.timelineId).toBe('stl.engine01')
    expect(JSON.stringify(result.states?.[outputId]?.outputs)).toContain(
      'Output/direct_rebuilt.mp4'
    )
  })

  it('落到文本口时被投影成文本（时间线 → text 的单向兼容真的可用）', async () => {
    const { doc, outputId } = buildTextGraph()
    const result = await runGraph(doc, { stepDelayMs: 1, analyzeSemanticVideo: capability() })

    expect(result.ok, result.error).toBe(true)
    const serialized = JSON.stringify(result.states?.[outputId]?.outputs)
    expect(serialized).toContain('stl.engine01')
    expect(serialized).toContain(SEMANTIC_TIMELINE_SCHEMA)
  })

  it('分析节点本身产出结构化值（引擎里就是 semanticTimeline kind）', async () => {
    const { doc, analyzeId } = buildTextGraph()
    const result = await runGraph(doc, { stepDelayMs: 1, analyzeSemanticVideo: capability() })

    const out = result.states?.[analyzeId]?.outputs?.out as { kind?: string } | undefined
    expect(out?.kind).toBe('semanticTimeline')
  })
})
