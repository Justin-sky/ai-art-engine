import { describe, expect, it, vi } from 'vitest'
import { executeSemanticRebuildNode } from '../src/shared/graph/execute/semanticTimeline'
import { semanticTimelineValue } from '../src/shared/graph/execute/semanticTimelineValue'
import { SEMANTIC_TIMELINE_NODE_TYPES } from '../src/shared/graph/semanticTimelineNodes'
import { createNodeFromType, type NodeExecuteContext } from '../src/shared/graph'
import {
  applySemanticEdit,
  carryOverSemanticEdits,
  finalizeSemanticBreakdown,
  migrateSemanticTimeline,
  planRemakeExecution,
  rebaselineSemanticTimeline,
  summarizeSemanticDiff,
  type SemanticTimeline
} from '../src/shared/semanticTimeline'

const range = (start: number, end: number) => ({
  start,
  end,
  startFrame: Math.round(start * 30),
  endFrame: Math.round(end * 30)
})

function makeFidelityTimeline(shotSeconds: number[]): SemanticTimeline {
  const total = shotSeconds.reduce((sum, sec) => sum + sec, 0)
  let cursor = 0
  const spans = shotSeconds.map((sec) => {
    const span = { start: cursor, end: cursor + sec }
    cursor += sec
    return span
  })
  const migrated = migrateSemanticTimeline(
    {
      id: 'stl.rebuild.1',
      schema: 'aiart.semantic-timeline@2',
      source: { assetId: 'asset-1', fps: 30, duration: total, width: 1080, height: 1920 },
      entities: [
        {
          id: 'ent.host',
          kind: 'person',
          name: '主播',
          appearances: spans.map((sp, i) => ({
            shotId: `shot.${i + 1}`,
            range: range(sp.start, sp.end)
          })),
          pixelEditable: false
        }
      ],
      updatedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z'
    },
    {
      shots: spans.map((span, i) => ({
        id: `shot.${i + 1}`,
        range: range(span.start, span.end),
        keyframes: i === 0 ? { first: 'evidence/keyframes/shot1.jpg' } : {},
        confidence: 0.92,
        forensics: {
          noiseSigma: 0.55,
          flatRatio: 0.12,
          meanFrameDiff: 6.2,
          dupRatio: 0.02,
          cameraMotionKind: 'smooth_move',
          // Distinct histograms so each shot becomes its own G1, G2... unit
          hsvHist: Array.from({ length: 24 }, (_, k) => (k === i * 4 ? 0.8 : 0.01))
        }
      }))
    }
  )
  return finalizeSemanticBreakdown(migrated, {
    provenance: { aigcImplicitLabel: { label: '1' }, evidence: [] }
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
  timeline: SemanticTimeline | null,
  options: {
    params?: Record<string, unknown>
    failKeys?: string[]
    withRebuild?: boolean
    firstFrameUrl?: string | undefined
    enforceModelDurations?: boolean
  } = {}
): Harness {
  const node = createNodeFromType('semantic.rebuild', { x: 0, y: 0 })
  node.params = {
    ...node.params,
    sourceRelativePath: 'Assets/src.mp4',
    ...(options.params ?? {})
  }
  const generated: Array<Record<string, unknown>> = []
  const rebuilt: Array<Record<string, unknown>> = []
  const spoken: Array<Record<string, unknown>> = []
  const patches: Array<Record<string, unknown>> = []
  const logs: Array<{ text: string; level?: string }> = []
  const inputs = timeline ? { in: [semanticTimelineValue(timeline)] } : {}
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
      async (input: {
        prompt: string
        name?: string
        firstFrameImageUrl?: string
        duration?: number
      }) => {
        const key = String(input.name ?? '').replace(/^rebuild-/, '')
        if (options.failKeys?.includes(key)) throw new Error(`boom ${key}`)
        if (options.enforceModelDurations && Number(input.duration ?? 0) < 4) {
          throw new Error(
            `提交视频生成失败: HTTP 400: Duration ${input.duration}s is not supported for this model. Supported durations: 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15s`
          )
        }
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

function payloadOf(h: Harness): Record<string, unknown> {
  const last = [...h.patches].reverse().find((p) => typeof p.rebuildLastReport === 'string')
  expect(last, 'rebuildLastReport 没有写回节点').toBeTruthy()
  return JSON.parse(String(last!.rebuildLastReport)) as Record<string, unknown>
}

describe('视频重制节点（1:1 分流复刻与批量单元生成）', () => {
  it('按 G1..Gk 单元调用视频生成（有首帧走图生视频），再交给本地拼接出成片', async () => {
    const doc = makeFidelityTimeline([6, 6])
    const h = harness(doc, { params: { remakeStrategy: 'fidelity' } })
    const out = await executeSemanticRebuildNode(h.ctx)

    expect(h.generated).toHaveLength(2)
    expect(h.generated.map((g) => g.key)).toEqual(['G1', 'G2'])
    expect(h.generated[0]!.duration).toBe(6)
    expect(h.generated[0]!.firstFrameImageUrl).toBe('file:///kf.jpg')
    expect(h.generated[1]!.firstFrameImageUrl).toBeUndefined()
    expect(h.logs.some((l) => l.text.includes('G2') && l.text.includes('文生视频'))).toBe(true)

    expect(h.rebuilt).toHaveLength(1)
    const rebuildInput = h.rebuilt[0]!
    expect((rebuildInput.clips as unknown[]).length).toBe(2)
    expect(rebuildInput.keepAudio).toBe(true)
    expect(rebuildInput.burnSubtitles).toBe(true)
    expect(rebuildInput.timelineId).toBe('stl.rebuild.1')

    expect((out['out-video'] as { relativePath: string }).relativePath).toContain('output.mp4')
    expect(h.logs.some((l) => l.text.includes('note-from-service'))).toBe(true)
  })

  it('semanticExecute=false：一次模型都不调，只产出预演清单', async () => {
    const h = harness(makeFidelityTimeline([6, 6]), {
      params: { remakeStrategy: 'fidelity', semanticExecute: false }
    })
    const out = await executeSemanticRebuildNode(h.ctx)
    expect(h.generated).toHaveLength(0)
    expect(h.rebuilt).toHaveLength(0)
    expect(out).toEqual({})
    const payload = payloadOf(h)
    expect(payload.execute).toBe(false)
    expect(payload.generate).toEqual(['G1', 'G2'])
  })

  it('单元上限截断：只生成上限内的单元，并在日志里说明跳过多少', async () => {
    const h = harness(makeFidelityTimeline([6, 6, 6]), {
      params: { remakeStrategy: 'fidelity', rebuildMaxShots: 1 }
    })
    await executeSemanticRebuildNode(h.ctx)
    expect(h.generated).toHaveLength(1)
    expect(h.logs.some((l) => l.text.includes('已跳过 2 镜') && l.level === 'warn')).toBe(true)
    expect(payloadOf(h).skippedByLimit).toBe(2)
  })

  it('时长不被模型接受时，按上游给出的档位重试一次（而不是白丢一单元）', async () => {
    const h = harness(makeFidelityTimeline([2, 6]), {
      params: { remakeStrategy: 'fidelity' },
      enforceModelDurations: true
    })
    await executeSemanticRebuildNode(h.ctx)

    expect(h.generated.map((g) => [g.key, g.duration])).toEqual([
      ['G1', 4],
      ['G2', 6]
    ])
    expect(h.logs.some((l) => l.text.includes('模型不接受 2s') && l.text.includes('改用 4s'))).toBe(
      true
    )
    expect(h.rebuilt).toHaveLength(1)
    expect((h.rebuilt[0]!.clips as unknown[]).length).toBe(2)
  })

  it('只有视频输出口，成片也记到节点参数供 Inspector 预览', async () => {
    const def = SEMANTIC_TIMELINE_NODE_TYPES.find((d) => d.typeId === 'semantic.rebuild')!
    const outs = def.ports.filter((p) => p.direction === 'out')
    expect(outs.map((p) => `${p.id}:${p.dataType}`)).toEqual(['out-video:video'])
    const h = harness(makeFidelityTimeline([6]), { params: { remakeStrategy: 'fidelity' } })
    const out = await executeSemanticRebuildNode(h.ctx)
    expect(Object.keys(out)).toEqual(['out-video'])
    expect(h.patches.some((p) => String(p.rebuildLastOutput ?? '').endsWith('output.mp4'))).toBe(
      true
    )
  })

  it('指令面板的整片指令追加到提示词；分辨率 / 画幅读 generate* 参数', async () => {
    const doc = makeFidelityTimeline([6])
    const h = harness(doc, {
      params: {
        remakeStrategy: 'adapt',
        generateInstruction: '保持写实风格',
        generateResolution: '720p',
        generateAspectRatio: '9:16'
      }
    })
    await executeSemanticRebuildNode(h.ctx)
    expect(String(h.generated[0]!.prompt)).toContain('保持写实风格')
    expect(h.generated[0]!.resolution).toBe('720p')
    expect(h.generated[0]!.aspectRatio).toBe('9:16')
  })

  it('单单元失败：自动退回原片段兜底，其余照常拼接', async () => {
    const h = harness(makeFidelityTimeline([6, 6]), {
      params: { remakeStrategy: 'fidelity' },
      failKeys: ['G1']
    })
    await executeSemanticRebuildNode(h.ctx)
    expect(h.generated.map((g) => g.key)).toEqual(['G2'])
    expect((h.rebuilt[0]!.clips as unknown[]).length).toBe(1)
    const failures = payloadOf(h).failures as Array<{ key: string }>
    expect(failures.map((f) => f.key)).toEqual(['G1'])
    const segments = h.rebuilt[0]!.segments as Array<{ key: string; kind: string }>
    expect(segments.map((s) => `${s.key}:${s.kind}`)).toEqual(['shot.1:source', 'shot.2:generate'])
  })

  it('全部失败：抛错（节点要红，不能假装成功）', async () => {
    const h = harness(makeFidelityTimeline([6, 6]), {
      params: { remakeStrategy: 'fidelity' },
      failKeys: ['G1', 'G2']
    })
    await expect(executeSemanticRebuildNode(h.ctx)).rejects.toThrow(/所有镜头单元均生成失败/)
  })

  it('没有语义时间线 / 没有拼接能力：都要有明确反应，不能静默', async () => {
    const empty = harness(null)
    const out = await executeSemanticRebuildNode(empty.ctx)
    expect(out).toEqual({})
    expect(empty.logs.some((l) => l.text.includes('没有收到语义时间线'))).toBe(true)

    const noRebuild = harness(makeFidelityTimeline([6]), {
      params: { remakeStrategy: 'fidelity' },
      withRebuild: false
    })
    await expect(executeSemanticRebuildNode(noRebuild.ctx)).rejects.toThrow(/没有成片拼接能力/)
    expect(noRebuild.generated).toHaveLength(0)
  })
})

describe('局部改片策略（remakeStrategy="edit"）：直通 / 修改 / 配音 / 单镜重跑', () => {
  function makeEditDoc(): SemanticTimeline {
    return migrateSemanticTimeline(
      {
        id: 'stl.v2.1',
        schema: 'aiart.semantic-timeline@2',
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
        updatedAt: '2026-01-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z'
      } as unknown as SemanticTimeline,
      {
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
      }
    )
  }

  it('零修改：全部直通原片，一次模型都不调', async () => {
    const doc = makeEditDoc()
    expect(summarizeSemanticDiff(doc)).toEqual({ dirtyShots: 0, removedShots: 0, dirtyDialogue: 0 })
    const h = harness(doc, { params: { remakeStrategy: 'edit' } })
    const out = await executeSemanticRebuildNode(h.ctx)
    expect(h.generated).toHaveLength(0)
    expect(h.spoken).toHaveLength(0)
    const segments = h.rebuilt[0]!.segments as Array<{ kind: string; sourceStartSec: number }>
    expect(segments.map((s) => s.kind)).toEqual(['source', 'source', 'source'])
    expect(segments.map((s) => s.sourceStartSec)).toEqual([0, 4, 8])
    expect(out['out-video']).toBeTruthy()
  })

  it('改一镜：只生成这一镜，其余直通', async () => {
    const doc = applySemanticEdit(makeEditDoc(), {
      op: 'shot.update',
      target: 'shot.2',
      patch: { visual: { style: '赛博朋克霓虹' } }
    })
    const planned = planRemakeExecution(doc, { strategy: 'edit' })
    expect(planned.units).toHaveLength(1)
    expect(planned.units[0]!.changeReasons).toContain('visual')
    expect(planned.units[0]!.videoPrompt).toContain('赛博朋克霓虹')

    const h = harness(doc, { params: { remakeStrategy: 'edit' } })
    await executeSemanticRebuildNode(h.ctx)
    expect(h.generated.map((g) => g.key)).toEqual(['shot.2'])
    const segments = h.rebuilt[0]!.segments as Array<{ key: string; kind: string }>
    expect(segments.map((s) => `${s.key}:${s.kind}`)).toEqual([
      'shot.1:source',
      'shot.2:generate',
      'shot.3:source'
    ])
  })

  it('改台词：画面直通，只给这一句重新配音，字幕用新台词', async () => {
    const doc = applySemanticEdit(makeEditDoc(), {
      op: 'dialogue.update',
      target: 'utt.2',
      patch: { text: '今天下单只要七十九' }
    })
    const h = harness(doc, { params: { remakeStrategy: 'edit' } })
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

  it('删镜：被删镜头不进入拼接段；单镜重跑参数 rebuildOnlyShotIds 只重跑目标镜头并自动清空', async () => {
    const doc = applySemanticEdit(makeEditDoc(), { op: 'shot.remove', target: 'shot.3' })
    const h = harness(doc, {
      params: { remakeStrategy: 'adapt', rebuildOnlyShotIds: 'shot.1' }
    })
    await executeSemanticRebuildNode(h.ctx)
    expect(h.generated.map((g) => g.key)).toEqual(['shot.1'])
    const segments = h.rebuilt[0]!.segments as Array<{ key: string; kind: string }>
    expect(segments.map((s) => `${s.key}:${s.kind}`)).toEqual(['shot.1:generate', 'shot.2:source'])
    expect(h.patches.some((p) => p.rebuildOnlyShotIds === '')).toBe(true)
  })

  it('换参考资产（没有掩码）：兜底走参考图生视频，参考图编号写进提示词', async () => {
    const doc = applySemanticEdit(makeEditDoc(), {
      op: 'entity.update',
      target: 'ent.person.host',
      patch: { referenceAssetId: 'asset-ref' }
    })
    const h = harness(doc, { params: { remakeStrategy: 'edit' } })
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
      applySemanticEdit(makeEditDoc(), {
        op: 'dialogue.update',
        target: 'utt.1',
        patch: { text: '这个包超能装' }
      }),
      { op: 'shot.update', target: 'shot.3', patch: { camera: { motion: '环绕' } } }
    )
    const carried = rebaselineSemanticTimeline(carryOverSemanticEdits(edited, makeEditDoc()))
    expect(carried.dialogue?.find((d) => d.id === 'utt.1')?.text).toBe('这个包超能装')
    expect(summarizeSemanticDiff(carried)).toEqual({
      dirtyShots: 1,
      removedShots: 0,
      dirtyDialogue: 1
    })
  })
})
