import { describe, expect, it, vi } from 'vitest'
import { executeSemanticRebuildNode } from '../src/shared/graph/execute/semanticTimeline'
import { videoPromptsValue } from '../src/shared/graph/execute/videoPromptsValue'
import { createNodeFromType, GraphPortType, type NodeExecuteContext } from '../src/shared/graph'
import {
  buildPromptPlan,
  type SemanticTimeline,
  type VideoPromptPlan
} from '../src/shared/semanticTimeline'

/**
 * 语义重建执行器的行为守卫。
 *
 * 这条路径会**花钱**（逐镜调用视频模型），所以最要紧的不是"能跑通"，而是：
 * - `semanticExecute=false` 时**一次模型都不调**（先看清单再开）；
 * - 每镜上限截断、无提示词的镜头跳过，都要在日志与输出里写明白；
 * - 单镜失败跳过、全部失败才报错；
 * - 首帧能取到时走图生视频，取不到时必须显式说明退化成文生视频。
 */

const range = (start: number, end: number) => ({ start, end, startFrame: 0, endFrame: 0 })

function makePlan(shots = 2): VideoPromptPlan {
  const timeline = {
    id: 'stl.rebuild.1',
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
      range: range(i * 6, (i + 1) * 6),
      keyframes: i === 0 ? { middle: 'evidence/keyframes/shot1.jpg' } : {},
      confidence: 1
    })),
    commands: Array.from({ length: shots }, (_, i) => ({
      kind: 'camera.pushIn',
      start: i * 6,
      end: (i + 1) * 6,
      params: {},
      reason: ''
    }))
  })
}

interface Harness {
  ctx: NodeExecuteContext
  generated: Array<Record<string, unknown>>
  rebuilt: Array<Record<string, unknown>>
  logs: Array<{ text: string; level?: string }>
}

function harness(
  plan: VideoPromptPlan | null,
  options: {
    params?: Record<string, unknown>
    failKeys?: string[]
    withRebuild?: boolean
    firstFrameUrl?: string | undefined
  } = {}
): Harness {
  const node = createNodeFromType('semantic.rebuild', { x: 0, y: 0 })
  node.params = { ...node.params, ...(options.params ?? {}) }
  const generated: Array<Record<string, unknown>> = []
  const rebuilt: Array<Record<string, unknown>> = []
  const logs: Array<{ text: string; level?: string }> = []
  const inputs = plan
    ? {
        in: [
          {
            kind: GraphPortType.videoPrompts,
            plan,
            text: JSON.stringify(plan)
          }
        ]
      }
    : {}
  const ctx = {
    node,
    locale: 'zh-CN',
    inputs,
    log: (text: string, level?: string) => logs.push({ text, level }),
    resolveProjectMediaUrl: async () =>
      options.firstFrameUrl === undefined ? 'file:///kf.jpg' : options.firstFrameUrl,
    generateVideo: vi.fn(
      async (input: { prompt: string; name?: string; firstFrameImageUrl?: string }) => {
        const key = String(input.name ?? '').replace(/^rebuild-/, '')
        if (options.failKeys?.includes(key)) throw new Error(`boom ${key}`)
        generated.push({ ...input, key })
        return { assetId: `asset-${key}`, relativePath: `Build/${key}.mp4`, model: 'fake' }
      }
    ),
    ...(options.withRebuild === false
      ? {}
      : {
          rebuildSemanticVideo: vi.fn(async (input: Record<string, unknown>) => {
            rebuilt.push(input)
            return {
              ok: true,
              outputRelativePath: 'Semantic/stl.rebuild.1/rebuilds/r1/output.mp4',
              manifestRelativePath: 'Semantic/stl.rebuild.1/rebuilds/r1/manifest.json',
              clipCount: (input.clips as unknown[]).length,
              burnedSubtitles: 3,
              keptAudio: true,
              notes: ['note-from-service']
            }
          })
        })
  } as unknown as NodeExecuteContext
  return { ctx, generated, rebuilt, logs }
}

function payloadOf(out: Record<string, unknown>): Record<string, unknown> {
  const value = out.out as { kind: string; text: string }
  return JSON.parse(value.text) as Record<string, unknown>
}

describe('语义重建节点', () => {
  it('逐镜头模式：每镜一次生成（首帧走图生视频），再交给本地拼接出成片', async () => {
    const plan = makePlan(2)
    const h = harness(plan)
    const out = await executeSemanticRebuildNode(h.ctx)

    expect(h.generated).toHaveLength(2)
    expect(h.generated.map((g) => g.key)).toEqual(['shot.1', 'shot.2'])
    // 参数来自计划：提示词、时长、每镜名字
    expect(String(h.generated[0]!.prompt)).toBe(plan.shots[0]!.prompt)
    expect(h.generated[0]!.duration).toBe(6)
    // 第一镜有首帧 → 图生视频；第二镜没有 → 不发首帧（日志里也要说明退化）
    expect(h.generated[0]!.firstFrameImageUrl).toBe('file:///kf.jpg')
    expect(h.generated[1]!.firstFrameImageUrl).toBeUndefined()
    expect(h.logs.some((l) => l.text.includes('shot.2') && l.text.includes('文生视频'))).toBe(true)

    // 拼接收到两段 + 音轨/字幕开关
    expect(h.rebuilt).toHaveLength(1)
    const rebuildInput = h.rebuilt[0]!
    expect((rebuildInput.clips as unknown[]).length).toBe(2)
    expect(rebuildInput.keepAudio).toBe(true)
    expect(rebuildInput.burnSubtitles).toBe(true)
    expect(rebuildInput.timelineId).toBe('stl.rebuild.1')

    // 成片从视频口输出
    expect((out['out-video'] as { relativePath: string }).relativePath).toContain('output.mp4')
    // 拼接服务的 notes 会转成 warn 日志
    expect(h.logs.some((l) => l.text.includes('note-from-service'))).toBe(true)
  })

  it('semanticExecute=false：一次模型都不调，只产出清单', async () => {
    const h = harness(makePlan(2), { params: { semanticExecute: false } })
    const out = await executeSemanticRebuildNode(h.ctx)
    expect(h.generated).toHaveLength(0)
    expect(h.rebuilt).toHaveLength(0)
    const payload = payloadOf(out)
    expect(payload.execute).toBe(false)
    expect((payload.planned as { clips: unknown[] }).clips).toHaveLength(2)
  })

  it('每镜上限截断：只生成上限内的镜头，并在日志里说明跳过多少', async () => {
    const h = harness(makePlan(3), { params: { rebuildMaxShots: 1 } })
    const out = await executeSemanticRebuildNode(h.ctx)
    expect(h.generated).toHaveLength(1)
    expect(h.logs.some((l) => l.text.includes('已跳过 2 镜') && l.level === 'warn')).toBe(true)
    expect((payloadOf(out).planned as { skippedByLimit: number }).skippedByLimit).toBe(2)
  })

  it('整片模式：只生成一次，用整片提示词与总时长', async () => {
    const plan = makePlan(2)
    const h = harness(plan, { params: { rebuildMode: 'full' } })
    await executeSemanticRebuildNode(h.ctx)
    expect(h.generated).toHaveLength(1)
    expect(h.generated[0]!.key).toBe('full')
    expect(String(h.generated[0]!.prompt)).toBe(plan.fullPrompt)
    expect(h.generated[0]!.duration).toBe(12)
  })

  it('单镜失败：跳过并记录，其余照常拼接', async () => {
    const h = harness(makePlan(2), { failKeys: ['shot.1'] })
    const out = await executeSemanticRebuildNode(h.ctx)
    expect(h.generated.map((g) => g.key)).toEqual(['shot.2'])
    expect((h.rebuilt[0]!.clips as unknown[]).length).toBe(1)
    const failures = payloadOf(out).failures as Array<{ key: string }>
    expect(failures.map((f) => f.key)).toEqual(['shot.1'])
    expect(h.logs.some((l) => l.text.includes('shot.1 生成失败'))).toBe(true)
  })

  it('全部失败：抛错（节点要红，不能假装成功）', async () => {
    const h = harness(makePlan(2), { failKeys: ['shot.1', 'shot.2'] })
    await expect(executeSemanticRebuildNode(h.ctx)).rejects.toThrow(/所有镜头都生成失败/)
  })

  it('没有提示词计划 / 没有拼接能力：都要有明确反应，不能静默', async () => {
    const empty = harness(null)
    const out = await executeSemanticRebuildNode(empty.ctx)
    expect(out.out).toBeTruthy()
    expect(empty.logs.some((l) => l.text.includes('没有收到提示词计划'))).toBe(true)

    const noRebuild = harness(makePlan(1), { withRebuild: false })
    const partial = await executeSemanticRebuildNode(noRebuild.ctx)
    expect(noRebuild.generated).toHaveLength(1)
    expect(payloadOf(partial).rebuild).toBeNull()
    expect(noRebuild.logs.some((l) => l.text.includes('没有拼接能力'))).toBe(true)
  })
})
