import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import {
  createNodeFromType,
  runGraph,
  type GraphDocument,
  type GraphNode,
  type GraphPersistedRunState,
  type GraphValue
} from '../src/shared/graph'
import { semanticTimelineValue } from '../src/shared/graph/execute/semanticTimelineValue'
import {
  finalizeSemanticBreakdown,
  makeTimeRange,
  migrateSemanticTimeline,
  type SemanticTimeline
} from '../src/shared/semanticTimeline'

/**
 * 「在视频重制节点上单独 Cook（执行当前）」二节点直连引擎守卫：
 * 1. 运行态 outputs 在内存里（刚跑过视频拆解）；
 * 2. 运行态已冲掉，但节点参数留有 `timelineJson`；
 * 3. 运行态与 `timelineJson` 都没有，按上游 `semantic.analyze` 参数里的 `semanticTimelineId` 从磁盘恢复；
 * 4. 控制组：上游确实没有时间线或镜头时，不出片并给出清晰原因；
 * 5. 上游时间线为 Vue `reactive` 代理时，传给主进程 IPC 的拼接请求仍可通过 `structuredClone`。
 */

function makeCookTimeline(shots = 2): SemanticTimeline {
  const raw = migrateSemanticTimeline(
    {
      id: 'stl.cook.1',
      schema: 'aiart.semantic-timeline@2',
      source: { assetId: 'asset-1', fps: 30, duration: shots * 5, width: 1080, height: 1920 },
      entities: [],
      dialogue: [
        {
          id: 'dlg.1',
          range: makeTimeRange(0.5, 2.5, 30),
          text: '口播一句',
          sourceText: '口播一句',
          granularity: 'sentence',
          confidence: 0.95,
          origin: 'analysis'
        }
      ],
      updatedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z'
    },
    {
      shots: Array.from({ length: shots }, (_, i) => ({
        id: `shot.${i + 1}`,
        range: makeTimeRange(i * 5, (i + 1) * 5, 30),
        keyframes: { first: `evidence/keyframes/s${i + 1}.jpg` },
        confidence: 0.9,
        forensics: {
          noiseSigma: 0.5,
          flatRatio: 0.12,
          meanFrameDiff: 6.0,
          dupRatio: 0.02,
          cameraMotionKind: 'smooth_move'
        }
      }))
    }
  )
  return finalizeSemanticBreakdown(raw, {
    provenance: { aigcImplicitLabel: { label: '1' }, evidence: [] }
  })
}

function node(typeId: string, id: string, params: Record<string, unknown> = {}): GraphNode {
  const created = createNodeFromType(typeId, { x: 0, y: 0 })
  created.id = id
  created.params = { ...created.params, ...params }
  return created
}

function graphAnalyzeToRebuild(
  analyzeParams: Record<string, unknown> = {},
  rebuildParams: Record<string, unknown> = {}
): GraphDocument {
  return {
    nodes: [
      node('semantic.analyze', 'n-analyze', analyzeParams),
      node('semantic.rebuild', 'n-rebuild', {
        remakeStrategy: 'fidelity',
        sourceRelativePath: 'Assets/src.mp4',
        ...rebuildParams
      })
    ],
    edges: [
      { id: 'e1', source: 'n-analyze', sourcePort: 'out', target: 'n-rebuild', targetPort: 'in' }
    ],
    viewport: { x: 0, y: 0, zoom: 1 }
  }
}

interface CookRun {
  output?: GraphValue
  rebuilt: Array<Record<string, unknown>>
  logs: string[]
}

async function cook(
  graph: GraphDocument,
  priorNodeStates: Record<string, GraphPersistedRunState>,
  diskTimeline: SemanticTimeline | null = null
): Promise<CookRun> {
  const rebuilt: Array<Record<string, unknown>> = []
  const logs: string[] = []
  const result = await runGraph(graph, {
    targetNodeId: 'n-rebuild',
    onlyTargetNode: true,
    locale: 'zh-CN',
    priorNodeStates,
    onLog: (_nodeId, message) => logs.push(message),
    generateVideo: vi.fn(async (input: { name?: string }) => ({
      assetId: `asset-${input.name}`,
      relativePath: `Build/${input.name}.mp4`,
      model: 'fake'
    })),
    rebuildSemanticVideo: vi.fn(async (input: Record<string, unknown>) => {
      rebuilt.push(input)
      return {
        ok: true,
        outputRelativePath: 'Output/cook.mp4',
        manifestRelativePath: 'Output/cook.json',
        clipCount: 1,
        burnedSubtitles: 0,
        keptAudio: true,
        notes: []
      }
    }),
    resolveProjectMediaUrl: async () => undefined,
    loadSemanticTimeline: async () => diskTimeline,
    loadSemanticEvidence: async () => ({
      shots: [],
      utterances: [],
      keyframes: {}
    })
  })
  return { output: result.states['n-rebuild']?.outputs?.['out-video'], rebuilt, logs }
}

describe('视频重制节点 Cook（二节点直连只跑当前节点）', () => {
  it('时间线在运行态里 → 直接送到视频重制节点并出片', async () => {
    const doc = makeCookTimeline(2)
    const run = await cook(graphAnalyzeToRebuild(), {
      'n-analyze': { status: 'done', outputs: { out: semanticTimelineValue(doc) } }
    })
    expect(run.rebuilt).toHaveLength(1)
    expect(run.output).toMatchObject({ kind: 'video', relativePath: 'Output/cook.mp4' })
  })

  it('运行态丢了、但上游节点参数留着 timelineJson → 照样出片', async () => {
    const doc = makeCookTimeline(2)
    const run = await cook(graphAnalyzeToRebuild({ timelineJson: JSON.stringify(doc) }), {
      'n-analyze': { status: 'done' }
    })
    expect(run.rebuilt).toHaveLength(1)
    expect(run.output).toMatchObject({ relativePath: 'Output/cook.mp4' })
  })

  it('运行态与参数缓存都没有 → 按上游 semanticTimelineId 从磁盘读回时间线后出片', async () => {
    const disk = makeCookTimeline(2)
    const run = await cook(
      graphAnalyzeToRebuild({ semanticTimelineId: 'stl.cook.1' }),
      { 'n-analyze': { status: 'done' } },
      disk
    )
    expect(run.rebuilt).toHaveLength(1)
    expect(run.output).toMatchObject({ relativePath: 'Output/cook.mp4' })
  })

  it('控制组：上游尚未产出有效时间线镜头时不出片，并给出清晰原因', async () => {
    const run = await cook(graphAnalyzeToRebuild(), { 'n-analyze': { status: 'done' } })
    expect(run.rebuilt).toHaveLength(0)
    expect(run.logs.join('\n')).toContain('没有可拼接的镜头')
  })

  it('上游时间线是 Vue reactive 代理时，拼接请求仍必须是可结构化克隆的纯数据', async () => {
    const doc = makeCookTimeline(2)
    const liveDoc = reactive(doc) as unknown as SemanticTimeline
    const run = await cook(graphAnalyzeToRebuild(), {
      'n-analyze': {
        status: 'done',
        outputs: { out: { kind: 'semanticTimeline', doc: liveDoc, text: JSON.stringify(doc) } }
      }
    })
    expect(run.rebuilt).toHaveLength(1)
    expect(() => structuredClone(run.rebuilt[0])).not.toThrow()
    expect(run.rebuilt[0]?.subtitles).toEqual([
      { sourceStartSec: 0.5, sourceEndSec: 2.5, text: '口播一句' }
    ])
  })
})
