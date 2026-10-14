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
import { videoPromptsValue } from '../src/shared/graph/execute/videoPromptsValue'
import {
  buildPromptPlan,
  makeTimeRange,
  type SemanticTimeline,
  type VideoPromptPlan
} from '../src/shared/semanticTimeline'

/**
 * 「在语义重建节点上 Cook（执行当前）」这条路为什么不出片 —— 引擎侧回归守卫。
 *
 * 实测踩到：**只跑重建节点**时上游不执行，引擎走软快照向上游要值。而
 * `graphValueHasPayload` 不认 `videoPrompts`，编译节点的计划被判定成「无载荷」，
 * 于是引擎用**空输入**兜底执行了一次编译节点 → 重建节点拿到的是**空计划** →
 * 日志只有「没有可拼接的镜头，未出片」，既不出片也不报错。
 *
 * 这条链路要覆盖三种「计划从哪来」，缺任何一种都会退化成"点了没反应"：
 *   1. 运行态 outputs（同一次会话里刚编译过）；
 *   2. 节点参数 `planJson`（存档/撤销/任务快照把运行态冲掉之后）；
 *   3. 都没有的旧存档：按分析节点参数里的 `semanticTimelineId` 从磁盘读回时间线，
 *      **就地重编译**一次拿到计划。
 */

const makePlan = (shots = 2): VideoPromptPlan => {
  const timeline = {
    id: 'stl.cook.1',
    schema: 'aiart.semantic-timeline@1',
    source: { assetId: 'asset-1', fps: 30, duration: 12, width: 1080, height: 1920 },
    entities: [],
    events: [],
    beats: [],
    intents: [],
    tracks: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z'
  } as unknown as SemanticTimeline
  return buildPromptPlan({
    timeline,
    shots: Array.from({ length: shots }, (_, i) => ({
      id: `shot.${i + 1}`,
      range: makeTimeRange(i * 6, (i + 1) * 6, 30),
      keyframes: {},
      confidence: 1
    })),
    // 有镜头语言，提示词才非空（否则测的就不是"引擎有没有把计划送到"了）
    commands: Array.from({ length: shots }, (_, i) => ({
      kind: 'camera.pushIn',
      start: i * 6,
      end: (i + 1) * 6,
      params: {},
      reason: ''
    }))
  })
}

/** 磁盘上的时间线文档（v1 也认：编译会按证据内联镜头树） */
const makeDiskTimeline = (): SemanticTimeline =>
  ({
    id: 'stl.cook.1',
    schema: 'aiart.semantic-timeline@1',
    source: { assetId: 'asset-1', fps: 30, duration: 12, width: 1080, height: 1920 },
    entities: [],
    events: [{ id: 'ev.1', timeRange: makeTimeRange(0, 6, 30), label: 'hook' }],
    beats: [],
    intents: [],
    tracks: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z'
  }) as unknown as SemanticTimeline

function node(typeId: string, id: string, params: Record<string, unknown> = {}): GraphNode {
  const created = createNodeFromType(typeId, { x: 0, y: 0 })
  created.id = id
  created.params = { ...created.params, ...params }
  return created
}

/** 编译 → 重建 */
function graphCompileToRebuild(compileParams: Record<string, unknown> = {}): GraphDocument {
  return {
    nodes: [
      node('semantic.compile', 'n-compile', compileParams),
      node('semantic.rebuild', 'n-rebuild')
    ],
    edges: [
      { id: 'e1', source: 'n-compile', sourcePort: 'out', target: 'n-rebuild', targetPort: 'in' }
    ],
    viewport: { x: 0, y: 0, zoom: 1 }
  }
}

/** 分析 → 编译 → 重建（旧存档：两个上游都是 done 但没有产物） */
function graphAnalyzeToRebuild(): GraphDocument {
  return {
    nodes: [
      node('semantic.analyze', 'n-analyze', { semanticTimelineId: 'stl.cook.1' }),
      node('semantic.compile', 'n-compile'),
      node('semantic.rebuild', 'n-rebuild')
    ],
    edges: [
      { id: 'e1', source: 'n-analyze', sourcePort: 'out', target: 'n-compile', targetPort: 'in' },
      { id: 'e2', source: 'n-compile', sourcePort: 'out', target: 'n-rebuild', targetPort: 'in' }
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
    listSemanticPacks: async () => [],
    loadSemanticTimeline: async () => diskTimeline,
    loadSemanticEvidence: async () => ({
      shots: Array.from({ length: 2 }, (_, i) => ({
        id: `shot.${i + 1}`,
        range: makeTimeRange(i * 6, (i + 1) * 6, 30),
        keyframes: {},
        confidence: 1
      })),
      utterances: [],
      keyframes: {}
    })
  })
  return { output: result.states['n-rebuild']?.outputs?.['out-video'], rebuilt, logs }
}

describe('语义重建节点 Cook（只跑当前节点）', () => {
  it('计划在运行态里 → 真的送到重建节点并出片', async () => {
    const run = await cook(graphCompileToRebuild(), {
      'n-compile': { status: 'done', outputs: { out: videoPromptsValue(makePlan(2)) } }
    })
    expect(run.rebuilt).toHaveLength(1)
    expect(run.output).toMatchObject({ kind: 'video', relativePath: 'Output/cook.mp4' })
  })

  it('运行态丢了、但节点参数还留着 planJson → 照样出片', async () => {
    const plan = makePlan(2)
    const run = await cook(graphCompileToRebuild({ planJson: JSON.stringify(plan) }), {
      // 存档把 outputs 冲没了，节点状态还是 done
      'n-compile': { status: 'done' }
    })
    expect(run.rebuilt).toHaveLength(1)
    expect(run.output).toMatchObject({ relativePath: 'Output/cook.mp4' })
  })

  it('旧存档（运行态与参数缓存都没有）→ 按 id 从磁盘读回时间线重编译后出片', async () => {
    const run = await cook(
      graphAnalyzeToRebuild(),
      { 'n-analyze': { status: 'done' }, 'n-compile': { status: 'done' } },
      makeDiskTimeline()
    )
    expect(run.rebuilt).toHaveLength(1)
    expect(run.output).toMatchObject({ relativePath: 'Output/cook.mp4' })
  })

  it('控制组：上游确实没有计划时不出片，而且日志要说清原因与下一步', async () => {
    const run = await cook(graphCompileToRebuild(), { 'n-compile': { status: 'done' } })
    expect(run.rebuilt).toHaveLength(0)
    expect(run.logs.join('\n')).toContain('上游提示词计划是空的')
    expect(run.logs.join('\n')).toContain('没有可拼接的镜头')
  })

  /**
   * 实测踩到（7.5.1 之后仍未修）：成片前的拼接请求带上了**响应式代理**，
   * 过 contextBridge / IPC 结构化克隆直接失败 —— 整趟跑了 4 分半、生成成功 2 镜，
   * 最后一步报 `An object could not be cloned.`，一段成片都拿不到。
   *
   * 代理来自运行态：`priorNodeStates` 是会话的 `reactive(runStates)`，取出来的计划是 Proxy，
   * 而计划里的 `subtitles` 会原样进拼接请求。这里用 `structuredClone` 复现 IPC 的判定。
   */
  it('上游计划是响应式代理时，拼接请求仍必须是可结构化克隆的纯数据', async () => {
    const plan = {
      ...makePlan(2),
      subtitles: [{ sourceStartSec: 0, sourceEndSec: 2, text: '口播一句' }]
    }
    const livePlan = reactive(plan) as unknown as VideoPromptPlan
    const run = await cook(graphCompileToRebuild(), {
      'n-compile': {
        status: 'done',
        outputs: { out: { kind: 'videoPrompts', plan: livePlan, text: JSON.stringify(plan) } }
      }
    })
    expect(run.rebuilt).toHaveLength(1)
    expect(() => structuredClone(run.rebuilt[0])).not.toThrow()
    expect(run.rebuilt[0]?.subtitles).toEqual([
      { sourceStartSec: 0, sourceEndSec: 2, text: '口播一句' }
    ])
  })
})
