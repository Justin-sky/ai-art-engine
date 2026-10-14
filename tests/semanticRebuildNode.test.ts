import { describe, expect, it, vi } from 'vitest'
import {
  executeSemanticCompileNode,
  executeSemanticRebuildNode
} from '../src/shared/graph/execute/semanticTimeline'
import { SEMANTIC_TIMELINE_NODE_TYPES } from '../src/shared/graph/semanticTimelineNodes'
import { createNodeFromType, GraphPortType, type NodeExecuteContext } from '../src/shared/graph'
import {
  applySemanticEdit,
  buildPromptPlan,
  carryOverSemanticEdits,
  migrateSemanticTimeline,
  rebaselineSemanticTimeline,
  summarizeSemanticDiff,
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
  spoken: Array<Record<string, unknown>>
  patches: Array<Record<string, unknown>>
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
  const spoken: Array<Record<string, unknown>> = []
  const patches: Array<Record<string, unknown>> = []
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
    patchNode: (patch: { params?: Record<string, unknown> }) => {
      if (patch.params) patches.push(patch.params)
    },
    generateSpeech: vi.fn(async (input: { input: string; name?: string }) => {
      spoken.push(input)
      return { relativePath: `Audio/${input.name}.wav`, model: 'tts', voice: 'v' }
    }),
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
  return { ctx, generated, rebuilt, spoken, patches, logs }
}

/** 节点没有文本输出口了：清单写在节点参数 `rebuildLastReport` 上 */
function payloadOf(h: Harness): Record<string, unknown> {
  const last = [...h.patches].reverse().find((p) => typeof p.rebuildLastReport === 'string')
  expect(last, 'rebuildLastReport 没有写回节点').toBeTruthy()
  return JSON.parse(String(last!.rebuildLastReport)) as Record<string, unknown>
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
    expect(out).toEqual({})
    const payload = payloadOf(h)
    expect(payload.execute).toBe(false)
    expect(payload.generate).toEqual(['shot.1', 'shot.2'])
  })

  it('每镜上限截断：只生成上限内的镜头，并在日志里说明跳过多少', async () => {
    const h = harness(makePlan(3), { params: { rebuildMaxShots: 1 } })
    await executeSemanticRebuildNode(h.ctx)
    expect(h.generated).toHaveLength(1)
    expect(h.logs.some((l) => l.text.includes('已跳过 2 镜') && l.level === 'warn')).toBe(true)
    expect(payloadOf(h).skippedByLimit).toBe(2)
  })

  it('只有视频输出口，成片也记到节点参数供 Inspector 预览', async () => {
    const def = SEMANTIC_TIMELINE_NODE_TYPES.find((d) => d.typeId === 'semantic.rebuild')!
    const outs = def.ports.filter((p) => p.direction === 'out')
    expect(outs.map((p) => `${p.id}:${p.dataType}`)).toEqual(['out-video:video'])
    const h = harness(makePlan(1))
    const out = await executeSemanticRebuildNode(h.ctx)
    expect(Object.keys(out)).toEqual(['out-video'])
    expect(h.patches.some((p) => String(p.rebuildLastOutput ?? '').endsWith('output.mp4'))).toBe(
      true
    )
  })

  it('指令面板的整片指令追加到每镜提示词；分辨率 / 画幅读 generate* 参数', async () => {
    const plan = makePlan(1)
    const h = harness(plan, {
      params: {
        generateInstruction: '保持写实风格',
        generateResolution: '720p',
        generateAspectRatio: '9:16'
      }
    })
    await executeSemanticRebuildNode(h.ctx)
    expect(String(h.generated[0]!.prompt)).toContain(plan.shots[0]!.prompt)
    expect(String(h.generated[0]!.prompt)).toContain('保持写实风格')
    expect(h.generated[0]!.resolution).toBe('720p')
    expect(h.generated[0]!.aspectRatio).toBe('9:16')
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
    await executeSemanticRebuildNode(h.ctx)
    expect(h.generated.map((g) => g.key)).toEqual(['shot.2'])
    expect((h.rebuilt[0]!.clips as unknown[]).length).toBe(1)
    const failures = payloadOf(h).failures as Array<{ key: string }>
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
    expect(out).toEqual({})
    expect(empty.logs.some((l) => l.text.includes('没有收到提示词计划'))).toBe(true)

    // 没有拼接能力：**生成前**就报错（不能先花钱生成、最后拼不出片）
    const noRebuild = harness(makePlan(1), { withRebuild: false })
    await expect(executeSemanticRebuildNode(noRebuild.ctx)).rejects.toThrow(/没有成片拼接能力/)
    expect(noRebuild.generated).toHaveLength(0)
  })
})

/**
 * v2 逆向工程闭环：分析 → （修改）→ 编译 → 重建。
 * 不变量：零修改时**一次生成都不调**，成片全由原片段直通拼成；只有改过的镜头才生成，
 * 改过的台词才配音，删掉的镜头不进成片。
 */
describe('语义重建 v2：直通 / 修改 / 配音', () => {
  function makeDoc(): SemanticTimeline {
    const base = {
      id: 'stl.v2.1',
      schema: 'aiart.semantic-timeline@1',
      source: { assetId: 'asset-1', fps: 30, duration: 12, width: 1080, height: 1920 },
      evidence: { mediaFacts: {}, hashes: {} },
      entities: [
        {
          id: 'ent.person.host',
          kind: 'person',
          name: '主播',
          appearances: [{ shotId: 'shot.1', range: range(0, 4) }],
          pixelEditable: false
        }
      ],
      events: [],
      beats: [],
      intents: [],
      tracks: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z'
    } as unknown as SemanticTimeline
    return migrateSemanticTimeline(base, {
      shots: [
        {
          id: 'shot.1',
          range: range(0, 4),
          keyframes: { middle: 'evidence/keyframes/1.jpg' },
          confidence: 1
        },
        { id: 'shot.2', range: range(4, 8), keyframes: {}, confidence: 1 },
        { id: 'shot.3', range: range(8, 12), keyframes: {}, confidence: 1 }
      ],
      utterances: [
        {
          id: 'utt.1',
          range: range(1, 3),
          text: '这个包很能装',
          granularity: 'sentence',
          confidence: 0.8
        },
        {
          id: 'utt.2',
          range: range(9, 11),
          text: '现在下单九十九',
          granularity: 'sentence',
          confidence: 0.8
        }
      ]
    })
  }

  function planOf(doc: SemanticTimeline): VideoPromptPlan {
    return buildPromptPlan({ timeline: doc, shots: [], sourceRelativePath: 'Assets/src.mp4' })
  }

  it('迁移：v1 文档升到 @2，内联镜头树 / 台词并打基线', () => {
    const doc = makeDoc()
    expect(doc.schema).toBe('aiart.semantic-timeline@2')
    expect(doc.shots?.map((s) => s.id)).toEqual(['shot.1', 'shot.2', 'shot.3'])
    expect(doc.shots?.[0]!.subjects[0]!.entityId).toBe('ent.person.host')
    expect(doc.dialogue?.map((d) => d.sourceText)).toEqual(['这个包很能装', '现在下单九十九'])
    expect(Object.keys(doc.baseline?.shots ?? {})).toHaveLength(3)
    expect(summarizeSemanticDiff(doc)).toEqual({ dirtyShots: 0, removedShots: 0, dirtyDialogue: 0 })
    // 首帧路径统一成工程相对
    expect(planOf(doc).shots[0]!.firstFrameRelativePath).toBe(
      'Semantic/stl.v2.1/evidence/keyframes/1.jpg'
    )
  })

  it('零修改：全部直通原片，一次模型都不调（还原原片）', async () => {
    const plan = planOf(makeDoc())
    expect(plan.shots.every((s) => s.strategy === 'passthrough')).toBe(true)
    const h = harness(plan)
    const out = await executeSemanticRebuildNode(h.ctx)
    expect(h.generated).toHaveLength(0)
    expect(h.spoken).toHaveLength(0)
    const segments = h.rebuilt[0]!.segments as Array<{ kind: string; sourceStartSec: number }>
    expect(segments.map((s) => s.kind)).toEqual(['source', 'source', 'source'])
    expect(segments.map((s) => s.sourceStartSec)).toEqual([0, 4, 8])
    expect(out['out-video']).toBeTruthy()
  })

  it('改一镜：只生成这一镜，其余直通；换风格的原因写进计划', async () => {
    const doc = applySemanticEdit(makeDoc(), {
      op: 'shot.update',
      target: 'shot.2',
      patch: { visual: { style: '赛博朋克霓虹' } }
    })
    const plan = planOf(doc)
    const shot2 = plan.shots.find((s) => s.shotId === 'shot.2')!
    expect(shot2.strategy).toBe('regenerate')
    expect(shot2.changeReasons).toContain('visual')
    expect(shot2.prompt).toContain('赛博朋克霓虹')
    const h = harness(plan)
    await executeSemanticRebuildNode(h.ctx)
    expect(h.generated.map((g) => g.key)).toEqual(['shot.2'])
    const segments = h.rebuilt[0]!.segments as Array<{ key: string; kind: string }>
    expect(segments.map((s) => `${s.key}:${s.kind}`)).toEqual([
      'shot.1:source',
      'shot.2:generate',
      'shot.3:source'
    ])
  })

  it('换实体（主播改名 / 换参考）：它出现的镜头都要重新生成', () => {
    const doc = applySemanticEdit(makeDoc(), {
      op: 'entity.update',
      target: 'ent.person.host',
      patch: { name: '虚拟主播' }
    })
    const plan = planOf(doc)
    expect(plan.shots.find((s) => s.shotId === 'shot.1')!.strategy).toBe('regenerate')
    expect(plan.shots.find((s) => s.shotId === 'shot.1')!.prompt).toContain('虚拟主播')
    expect(plan.shots.find((s) => s.shotId === 'shot.2')!.strategy).toBe('passthrough')
  })

  it('改台词：画面直通，只给这一句重新配音，字幕用新台词', async () => {
    const doc = applySemanticEdit(makeDoc(), {
      op: 'dialogue.update',
      target: 'utt.2',
      patch: { text: '今天下单只要七十九' }
    })
    const plan = planOf(doc)
    expect(plan.dubs?.map((d) => d.id)).toEqual(['utt.2'])
    expect(plan.subtitles?.map((s) => s.text)).toContain('今天下单只要七十九')
    const h = harness(plan)
    await executeSemanticRebuildNode(h.ctx)
    expect(h.generated).toHaveLength(0)
    expect(h.spoken.map((s) => s.input)).toEqual(['今天下单只要七十九'])
    const dubs = h.rebuilt[0]!.dubs as Array<{ id: string; sourceStartSec: number }>
    expect(dubs).toEqual([
      expect.objectContaining({
        id: 'utt.2',
        sourceStartSec: 9,
        relativePath: 'Audio/dub-utt.2.wav'
      })
    ])
  })

  it('删镜：不进成片；全部重新生成开关打开时每镜都生成', async () => {
    const doc = applySemanticEdit(makeDoc(), { op: 'shot.remove', target: 'shot.3' })
    const plan = planOf(doc)
    expect(plan.removedShotIds).toEqual(['shot.3'])
    expect(plan.shots.map((s) => s.shotId)).toEqual(['shot.1', 'shot.2'])
    const h = harness(plan, { params: { rebuildRegenerateAll: true } })
    await executeSemanticRebuildNode(h.ctx)
    // shot.1 有主体 → 生成；shot.2 没有任何可写进提示词的内容 → 不能凭空生成，退回原片段
    expect(h.generated.map((g) => g.key)).toEqual(['shot.1'])
    const segments = h.rebuilt[0]!.segments as Array<{ key: string; kind: string }>
    expect(segments.map((s) => `${s.key}:${s.kind}`)).toEqual(['shot.1:generate', 'shot.2:source'])
    expect(payloadOf(h).skippedEmpty).toBe(1)
  })

  it('换参考资产（旧字段，没有点选目标）：兜底参考图生视频，参考图编号写进提示词', async () => {
    const doc = applySemanticEdit(makeDoc(), {
      op: 'entity.update',
      target: 'ent.person.host',
      patch: { referenceAssetId: 'asset-ref' }
    })
    const plan = planOf(doc)
    // 计划里是显式绑定的替换（实体 → 参考图），不再是无序的 referenceAssetIds
    expect(plan.shots[0]!.referenceAssetIds).toBeUndefined()
    expect(plan.shots[0]!.replacements).toEqual([
      {
        entityId: 'ent.person.host',
        entityName: '主播',
        instruction: '',
        references: [{ assetId: 'asset-ref' }]
      }
    ])
    const h = harness(plan)
    ;(h.ctx as { resolveAssetImageUrl?: unknown }).resolveAssetImageUrl = async (id: string) =>
      `data:image/png;base64,${id}`
    await executeSemanticRebuildNode(h.ctx)
    expect(h.generated.map((g) => g.key)).toEqual(['shot.1'])
    expect(h.generated[0]!.firstFrameImageUrl).toBeUndefined()
    expect(h.generated[0]!.inputReferences).toEqual([
      { kind: 'image_url', url: 'data:image/png;base64,asset-ref' }
    ])
    expect(h.generated[0]!.prompt).toContain('参考图1：主播')
  })

  it('重新分析：上一版的修改带到新文档上，重设基线也不会吞掉修改', () => {
    const edited = applySemanticEdit(
      applySemanticEdit(makeDoc(), {
        op: 'dialogue.update',
        target: 'utt.1',
        patch: { text: '这个包超能装' }
      }),
      { op: 'shot.update', target: 'shot.3', patch: { camera: { motion: '环绕' } } }
    )
    const carried = rebaselineSemanticTimeline(carryOverSemanticEdits(edited, makeDoc()))
    expect(carried.dialogue?.find((d) => d.id === 'utt.1')?.text).toBe('这个包超能装')
    expect(summarizeSemanticDiff(carried)).toEqual({
      dirtyShots: 1,
      removedShots: 0,
      dirtyDialogue: 1
    })
  })

  it('编译要求（指令面板）追加到每镜提示词，整片提示词随之重算', async () => {
    const node = createNodeFromType('semantic.compile', { x: 0, y: 0 })
    node.params = { ...node.params, generateInstruction: '写实质感' }
    const doc = applySemanticEdit(makeDoc(), {
      op: 'shot.update',
      target: 'shot.2',
      patch: { visual: { style: '霓虹' } }
    })
    const ctx = {
      node,
      locale: 'zh-CN',
      inputs: { in: [{ kind: 'semanticTimeline', doc, text: JSON.stringify(doc) }] },
      log: () => undefined
    } as unknown as NodeExecuteContext
    const out = await executeSemanticCompileNode(ctx)
    const plan = (out.out as { plan: VideoPromptPlan }).plan
    for (const shot of plan.shots.filter((s) => s.prompt.trim())) {
      expect(shot.prompt.endsWith('写实质感')).toBe(true)
    }
    expect(plan.fullPrompt).toContain('写实质感')
    // 脏检测不受编译要求影响：只有改过的那一镜重新生成
    expect(plan.shots.filter((s) => s.strategy === 'regenerate').map((s) => s.shotId)).toEqual([
      'shot.2'
    ])
  })

  it('生成失败的镜头退回原片段（成片不缺镜）', async () => {
    const doc = applySemanticEdit(makeDoc(), {
      op: 'shot.prompt',
      target: 'shot.1',
      patch: { prompt: '主播在海边' }
    })
    const h = harness(planOf(doc), { failKeys: ['shot.1'] })
    await executeSemanticRebuildNode(h.ctx)
    const segments = h.rebuilt[0]!.segments as Array<{ key: string; kind: string }>
    expect(segments.map((s) => `${s.key}:${s.kind}`)).toEqual([
      'shot.1:source',
      'shot.2:source',
      'shot.3:source'
    ])
  })
})
