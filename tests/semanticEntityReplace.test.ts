import { describe, expect, it, vi } from 'vitest'
import { executeSemanticRebuildNode } from '../src/shared/graph/execute/semanticTimeline'
import { createNodeFromType, GraphPortType, type NodeExecuteContext } from '../src/shared/graph'
import {
  applySemanticEdit,
  buildEntityRedrawPrompt,
  buildPromptPlan,
  carryOverSemanticEdits,
  collectShotReplacements,
  diffAgainstBaseline,
  maskBoxOverlap,
  migrateSemanticTimeline,
  normalizeEntityReplacement,
  rebaselineSemanticTimeline,
  referenceLegend,
  rewriteMentions,
  type EntityReplacement,
  type SemanticTimeline,
  type VideoPromptPlan
} from '../src/shared/semanticTimeline'

/**
 * 实体局部替换：换谁（掩码）/ 换成什么（参考图）/ 怎么换（指令）分开管；
 * 同镜多实体按实体逐个重绘，每遍只带自己的参考图，并扣掉已换好的区域。
 */

const range = (start: number, end: number) => ({
  start,
  end,
  startFrame: Math.floor(start * 30),
  endFrame: Math.floor(end * 30)
})

function makeDoc(): SemanticTimeline {
  const appearance = (shotId: string, s: number, e: number) => ({ shotId, range: range(s, e) })
  return migrateSemanticTimeline(
    {
      id: 'stl.rep.1',
      schema: 'aiart.semantic-timeline@1',
      source: { assetId: 'asset-1', fps: 30, duration: 12, width: 1080, height: 1920 },
      evidence: { mediaFacts: {}, hashes: {} },
      entities: [
        {
          id: 'ent.person.a',
          kind: 'person',
          name: 'A',
          appearances: [appearance('shot.1', 0, 4), appearance('shot.3', 8, 12)],
          pixelEditable: false
        },
        {
          id: 'ent.person.b',
          kind: 'person',
          name: 'B',
          appearances: [appearance('shot.2', 4, 8), appearance('shot.3', 8, 12)],
          pixelEditable: false
        }
      ],
      events: [],
      beats: [],
      intents: [],
      tracks: [],
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
        {
          id: 'shot.2',
          range: range(4, 8),
          keyframes: { middle: 'evidence/keyframes/2.jpg' },
          confidence: 1
        },
        {
          id: 'shot.3',
          range: range(8, 12),
          keyframes: { middle: 'evidence/keyframes/3.jpg' },
          confidence: 1
        }
      ]
    }
  )
}

const KF3 = 'Semantic/stl.rep.1/evidence/keyframes/3.jpg'

function replacement(
  name: string,
  shots: string[],
  box = { x: 0.1, y: 0.1, w: 0.3, h: 0.6 }
): EntityReplacement {
  return {
    instruction: `换成 @1 的${name}，保持动作`,
    references: [{ relativePath: `Assets/refs/${name}.png`, label: name }],
    masks: shots.map((shotId) => ({
      shotId,
      keyframeRelativePath: `Semantic/stl.rep.1/evidence/keyframes/${shotId.slice(5)}.jpg`,
      maskRelativePath: `Semantic/stl.rep.1/evidence/masks/${name}.${shotId}.png`,
      box,
      method: 'instance' as const
    }))
  }
}

const dirty = (doc: SemanticTimeline) => [...diffAgainstBaseline(doc).dirtyShots.keys()].sort()

describe('entity.replace：校验与指纹', () => {
  it('非法输入拒绝：路径逃出工程、镜头不存在、@n 超出参考图数量、空框', () => {
    const doc = makeDoc()
    const ok = replacement('A', ['shot.1'])
    expect(() =>
      normalizeEntityReplacement({ ...ok, references: [{ relativePath: '../x.png' }] }, doc)
    ).toThrow(/project-relative/)
    expect(() =>
      normalizeEntityReplacement({ ...ok, masks: [{ ...ok.masks[0]!, shotId: 'shot.9' }] }, doc)
    ).toThrow(/not a shot/)
    expect(() => normalizeEntityReplacement({ ...ok, instruction: '用 @2' }, doc)).toThrow(/@2/)
    expect(() =>
      normalizeEntityReplacement(
        { ...ok, masks: [{ ...ok.masks[0]!, box: { x: 0, y: 0, w: 0, h: 0.2 } }] },
        doc
      )
    ).toThrow(/empty/)
  })

  it('同一镜重新点选 = 覆盖（只保留最后一份掩码）', () => {
    const doc = makeDoc()
    const rep = replacement('A', ['shot.1'])
    const twice = {
      ...rep,
      masks: [rep.masks[0]!, { ...rep.masks[0]!, maskRelativePath: 'Semantic/x/new.png' }]
    }
    expect(normalizeEntityReplacement(twice, doc).masks).toEqual([
      { ...rep.masks[0]!, maskRelativePath: 'Semantic/x/new.png' }
    ])
  })

  it('只改 A 的替换：只有 A 出现的镜头变脏，原因是 replace；B 独占的镜头不动', () => {
    const doc = applySemanticEdit(makeDoc(), {
      op: 'entity.replace',
      target: 'ent.person.a',
      patch: { replacement: replacement('A', ['shot.1']) }
    })
    expect(dirty(doc)).toEqual(['shot.1', 'shot.3'])
    expect(diffAgainstBaseline(doc).dirtyShots.get('shot.1')).toContain('replace')
  })

  it('清除替换（null）后回到零脏；旧字段 reference 在第一次替换时迁移掉', () => {
    const legacy = applySemanticEdit(makeDoc(), {
      op: 'entity.update',
      target: 'ent.person.a',
      patch: { referenceAssetId: 'asset-old' }
    })
    const replaced = applySemanticEdit(legacy, {
      op: 'entity.replace',
      target: 'ent.person.a',
      patch: { replacement: replacement('A', ['shot.1']) }
    })
    const entity = replaced.entities.find((e) => e.id === 'ent.person.a')!
    expect(entity.reference).toBeUndefined()
    expect(entity.replacement?.references).toHaveLength(1)
    const cleared = applySemanticEdit(makeDoc(), {
      op: 'entity.replace',
      target: 'ent.person.a',
      patch: { replacement: null }
    })
    expect(dirty(cleared)).toEqual([])
  })

  it('重设基线后替换仍算改过；重新分析时替换跟着带过去', () => {
    const edited = applySemanticEdit(makeDoc(), {
      op: 'entity.replace',
      target: 'ent.person.a',
      patch: { replacement: replacement('A', ['shot.1']) }
    })
    expect(dirty(rebaselineSemanticTimeline(edited))).toEqual(['shot.1', 'shot.3'])
    const carried = rebaselineSemanticTimeline(carryOverSemanticEdits(edited, makeDoc()))
    expect(carried.entities.find((e) => e.id === 'ent.person.a')?.replacement?.masks).toHaveLength(
      1
    )
    expect(dirty(carried)).toEqual(['shot.1', 'shot.3'])
  })
})

describe('按镜收集：有序、显式绑定', () => {
  it('同镜两个实体：按实体顺序，各带自己的参考图与掩码', () => {
    let doc = applySemanticEdit(makeDoc(), {
      op: 'entity.replace',
      target: 'ent.person.a',
      patch: { replacement: replacement('A', ['shot.3']) }
    })
    doc = applySemanticEdit(doc, {
      op: 'entity.replace',
      target: 'ent.person.b',
      patch: { replacement: replacement('B', ['shot.3'], { x: 0.5, y: 0.1, w: 0.3, h: 0.6 }) }
    })
    const shot3 = doc.shots!.find((s) => s.id === 'shot.3')!
    const reps = collectShotReplacements(doc, shot3)
    expect(reps.map((r) => r.entityName)).toEqual(['A', 'B'])
    expect(reps.map((r) => r.references[0]!.relativePath)).toEqual([
      'Assets/refs/A.png',
      'Assets/refs/B.png'
    ])
    // 只在 shot.3 点了 B：shot.2 里 B 有替换但没掩码 → 只能兜底
    const shot2 = doc.shots!.find((s) => s.id === 'shot.2')!
    expect(collectShotReplacements(doc, shot2)[0]!.mask).toBeUndefined()
  })

  it('提示词工具：@n 改写成图片编号；兜底的参考图编号说明写明谁是谁', () => {
    expect(rewriteMentions('换成 @1 和 @2', 2, 'en')).toBe(
      '换成 reference image 3 和 reference image 4'
    )
    expect(
      referenceLegend(
        [
          { name: 'A', count: 2 },
          { name: 'B', count: 1 }
        ],
        'zh'
      )
    ).toBe('参考图1-2：A；参考图3：B')
    const prompt = buildEntityRedrawPrompt({
      entityName: 'A',
      instruction: '换成 @1',
      referenceCount: 1
    })
    expect(prompt).toContain('image 3')
    expect(prompt).toContain('User request: 换成 reference image 3')
    expect(
      maskBoxOverlap({ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.25, y: 0, w: 0.5, h: 0.5 })
    ).toBeCloseTo(0.5)
  })
})

// ─── 重建：首帧逐个重绘 → 图生视频 ───────────────────────────────────────────

function twoEntityPlan(): VideoPromptPlan {
  let doc = applySemanticEdit(makeDoc(), {
    op: 'entity.replace',
    target: 'ent.person.a',
    patch: { replacement: replacement('A', ['shot.3']) }
  })
  doc = applySemanticEdit(doc, {
    op: 'entity.replace',
    target: 'ent.person.b',
    patch: { replacement: replacement('B', ['shot.3'], { x: 0.5, y: 0.1, w: 0.3, h: 0.6 }) }
  })
  return buildPromptPlan({ timeline: doc, shots: [], sourceRelativePath: 'Assets/src.mp4' })
}

function harness(
  plan: VideoPromptPlan,
  options: { failImageAt?: number; noRedraw?: boolean } = {}
) {
  const node = createNodeFromType('semantic.rebuild', { x: 0, y: 0 })
  const images: Array<{ prompt: string; inputReferences?: string[] }> = []
  const masks: Array<{ maskDataUrl: string; protectMaskDataUrls: string[] }> = []
  const videos: Array<Record<string, unknown>> = []
  let saved = 0
  const ctx = {
    node,
    locale: 'zh-CN',
    inputs: { in: [{ kind: GraphPortType.videoPrompts, plan, text: JSON.stringify(plan) }] },
    log: () => {},
    patchNode: () => {},
    resolveProjectMediaUrl: async (rel: string) => `file:///${rel}`,
    readProjectImageDataUrl: async (rel: string) => `data:${rel}`,
    ...(options.noRedraw
      ? {}
      : {
          composeEntityMask: vi.fn(
            async (input: { maskDataUrl: string; protectMaskDataUrls: string[] }) => {
              masks.push(input)
              return { dataUrl: `eff:${input.maskDataUrl}`, coverage: 0.2, protectedRatio: 0 }
            }
          ),
          composeImageRedrawCanvas: async (input: {
            sourceDataUrl: string
            state: { maskDataUrl: string }
          }) => ({
            dataUrl: `holed:${input.sourceDataUrl}`,
            maskDataUrl: `mask:${input.state.maskDataUrl}`,
            width: 1080,
            height: 1920
          }),
          generateImage: vi.fn(async (input: { prompt: string; inputReferences?: string[] }) => {
            images.push(input)
            if (options.failImageAt === images.length) throw new Error('image boom')
            return { images: [`gen${images.length}`], model: 'img' }
          }),
          saveRunMedia: async () => `Semantic/stl.rep.1/replace/pass${++saved}.png`
        }),
    generateVideo: vi.fn(async (input: { name?: string }) => {
      videos.push(input)
      return { assetId: 'a', relativePath: `Build/${input.name}.mp4`, model: 'v' }
    }),
    rebuildSemanticVideo: async (input: { clips: unknown[] }) => ({
      ok: true,
      outputRelativePath: 'out.mp4',
      manifestRelativePath: 'm.json',
      clipCount: input.clips.length,
      burnedSubtitles: 0,
      keptAudio: true,
      notes: []
    })
  } as unknown as NodeExecuteContext
  return { ctx, images, masks, videos }
}

describe('重建：同镜换两个实体', () => {
  it('逐个重绘：每遍只带自己的参考图，第二遍以第一遍结果为底图、扣掉 A 的区域；最后图生视频', async () => {
    const h = harness(twoEntityPlan())
    await executeSemanticRebuildNode(h.ctx)

    const shot3Images = h.images.slice(-2)
    // 第一遍：原关键帧挖空 + 掩码 + A 的参考图（只有 A 的）
    expect(shot3Images[0]!.inputReferences).toEqual([
      `holed:data:${KF3}`,
      'mask:eff:data:Semantic/stl.rep.1/evidence/masks/A.shot.3.png',
      'data:Assets/refs/A.png'
    ])
    // 第二遍：底图是第一遍落盘后的结果；只带 B 的参考图
    expect(shot3Images[1]!.inputReferences![0]).toMatch(
      /^holed:data:Semantic\/stl\.rep\.1\/replace\/pass\d\.png$/
    )
    expect(shot3Images[1]!.inputReferences![2]).toBe('data:Assets/refs/B.png')
    expect(shot3Images[1]!.inputReferences).not.toContain('data:Assets/refs/A.png')
    // 保护区：处理 B 时扣掉 A 的原始掩码
    const lastMask = h.masks.at(-1)!
    expect(lastMask.protectMaskDataUrls).toEqual([
      'data:Semantic/stl.rep.1/evidence/masks/A.shot.3.png'
    ])

    const video3 = h.videos.find((v) => v.name === 'rebuild-shot.3')!
    expect(String(video3.firstFrameImageUrl)).toMatch(/replace\/pass\d\.png$/)
    expect(video3.inputReferences).toBeUndefined()
    expect(String(video3.prompt)).toContain('A、B已替换为新形象')
  })

  it('任一遍失败：整镜放弃首帧编辑，参考图按实体顺序兜底并写明编号', async () => {
    const h = harness(twoEntityPlan(), { failImageAt: 2 })
    await executeSemanticRebuildNode(h.ctx)
    const video3 = h.videos.find((v) => v.name === 'rebuild-shot.3')!
    expect(video3.firstFrameImageUrl).toBeUndefined()
    expect(video3.inputReferences).toEqual([
      { kind: 'image_url', url: 'data:Assets/refs/A.png' },
      { kind: 'image_url', url: 'data:Assets/refs/B.png' }
    ])
    expect(String(video3.prompt)).toContain('参考图1：A；参考图2：B')
  })

  it('环境没有重绘能力：直接兜底，不调用图片模型', async () => {
    const h = harness(twoEntityPlan(), { noRedraw: true })
    await executeSemanticRebuildNode(h.ctx)
    expect(h.images).toHaveLength(0)
    const video3 = h.videos.find((v) => v.name === 'rebuild-shot.3')!
    expect((video3.inputReferences as unknown[]).length).toBe(2)
  })
})
