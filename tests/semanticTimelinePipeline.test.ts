import { describe, expect, it } from 'vitest'
import {
  assignBeatsHeuristic,
  draftsToEvents,
  expandVariantMatrix,
  heuristicEventsFromUtterances,
  inferIntentsFromEvents,
  linkEntitiesFromDetections,
  makeTimeRange,
  parseEventDrafts,
  parseJsonArray,
  planInvalidation,
  segmentsToUtterances,
  singleShot,
  validateSemanticPack,
  createEmptySemanticTimeline,
  freezeBuildDefinition,
  timelineVersionHash,
  compileDirectorCommands,
  BUILTIN_DIRECTOR_RULES,
  semanticToScriptTimeline,
  editId
} from '../src/shared/semanticTimeline'
import { loadBundledSemanticPacks } from '../src/main/services/semanticTimeline/packLoader'
import { ensureBuiltinNodeTypes } from '../src/shared/graph/builtins'
import { resolveNodeType } from '../src/shared/graph/registry'
import {
  executeSemanticAnalyzeNode,
  executeSemanticRepairNode,
  executeSemanticTriggerNode,
  executeSemanticVariantNode
} from '../src/shared/graph/execute/semanticTimeline'
import {
  applyStructuralEdits,
  instantiateRecipe,
  normalizeSemanticEdits,
  type SemanticAnalyzeResponse,
  type SemanticBuildRequest,
  type SemanticBuildResponse,
  type SemanticPack,
  type SemanticTimeline
} from '../src/shared/semanticTimeline'
import type { GraphNode } from '../src/shared/graph/types'
import type { NodeExecuteContext } from '../src/shared/graph/execute/types'

describe('semanticTimeline pipeline pure', () => {
  it('maps transcript segments to utterances with word granularity', () => {
    const utts = segmentsToUtterances(
      [
        {
          startSec: 0,
          endSec: 1.2,
          text: '今天只要九十九',
          words: [
            { text: '今天', startSec: 0, endSec: 0.3 },
            { text: '只要', startSec: 0.3, endSec: 0.6 },
            { text: '九十九', startSec: 0.6, endSec: 1.2 }
          ]
        }
      ],
      30,
      'word'
    )
    expect(utts).toHaveLength(1)
    expect(utts[0]!.granularity).toBe('word')
    expect(utts[0]!.words).toHaveLength(3)
  })

  it('links YOLO boxes across shots into entities', () => {
    const d1 = {
      shotId: 'shot.a',
      range: makeTimeRange(0, 3, 30),
      boxes: [{ label: 'person', confidence: 0.9, x: 10, y: 10, width: 40, height: 80 }]
    }
    const d2 = {
      shotId: 'shot.b',
      range: makeTimeRange(3, 6, 30),
      boxes: [
        { label: 'person', confidence: 0.85, x: 12, y: 12, width: 38, height: 78 },
        { label: 'bottle', confidence: 0.8, x: 100, y: 50, width: 20, height: 40 }
      ]
    }
    const entities = linkEntitiesFromDetections([d1, d2])
    expect(entities.some((e) => e.kind === 'person' && e.appearances.length === 2)).toBe(true)
    expect(entities.some((e) => e.kind === 'product')).toBe(true)
  })

  it('extracts heuristic events and intents from utterances', () => {
    const shots = singleShot(10, 30)
    const utts = segmentsToUtterances(
      [
        { startSec: 0, endSec: 2, text: '皮肤干燥卡粉怎么办' },
        { startSec: 5, endSec: 7, text: '今天只要九十九元' },
        { startSec: 8, endSec: 9.5, text: '点击下方链接购买' }
      ],
      30,
      'sentence'
    )
    const events = heuristicEventsFromUtterances(utts, shots, 30)
    expect(events.length).toBeGreaterThanOrEqual(2)
    expect(events.every((e) => e.evidence.length > 0)).toBe(true)
    const beats = assignBeatsHeuristic(events, 10, 30)
    expect(beats.length).toBe(7)
    const intents = inferIntentsFromEvents(events)
    expect(intents.some((i) => i.goal === 'sell')).toBe(true)
  })

  it('drops drafts without evidence', () => {
    const events = draftsToEvents(
      [
        {
          label: 'x',
          description: 'no evidence',
          start: 0,
          end: 1,
          evidence: []
        },
        {
          label: 'y',
          description: 'ok',
          start: 1,
          end: 2,
          evidence: ['shot.1']
        }
      ],
      30
    )
    expect(events).toHaveLength(1)
    expect(events[0]!.label).toBe('y')
  })

  it('parses fenced JSON arrays', () => {
    const text = '```json\n[{"shotId":"s1","subject":"host"}]\n```'
    expect(parseJsonArray<{ shotId: string }>(text)[0]!.shotId).toBe('s1')
    expect(
      parseEventDrafts('[{"label":"a","description":"d","start":0,"end":1,"evidence":["e"]}]')
    ).toHaveLength(1)
  })

  it('loads official market packs from workflow repo (or empty if absent)', () => {
    const packs = loadBundledSemanticPacks()
    // 开发态并列仓库应能读到 ≥5 个；CI 若未检出 workflow 仓则允许空
    if (packs.length > 0) {
      expect(packs.length).toBeGreaterThanOrEqual(5)
      expect(packs.every((p) => validateSemanticPack(p).ok)).toBe(true)
    }
    expect(expandVariantMatrix([{ key: 'a', values: [1, 2] }])).toHaveLength(2)
  })

  it('plans replaceEntity invalidation', () => {
    const facts = {
      durationSec: 6,
      fps: 30,
      width: 1080,
      height: 1920,
      hasAudio: true
    }
    const doc = createEmptySemanticTimeline('vid', facts)
    doc.entities = [
      {
        id: 'ent.product.bottle',
        kind: 'product',
        name: 'bottle',
        appearances: [{ shotId: 'shot.001.0', range: makeTimeRange(0, 3, 30) }],
        pixelEditable: true
      }
    ]
    const shots = singleShot(6, 30)
    const edit = {
      id: editId('replaceEntity'),
      kind: 'replaceEntity' as const,
      entityId: 'ent.product.bottle',
      newAssetId: 'asset.new',
      origin: 'user' as const,
      createdAt: new Date().toISOString()
    }
    const plan = planInvalidation({ timeline: doc, shots, edits: [edit] })
    expect(plan.targetLevel).toBe('L1')
    expect(plan.items.some((i) => i.action === 'recompute')).toBe(true)
    const def = freezeBuildDefinition(doc, [edit], plan, timelineVersionHash(doc))
    expect(def.editIds).toContain(edit.id)
  })

  it('compiles director rules and ScriptTimeline', () => {
    const facts = {
      durationSec: 8,
      fps: 30,
      width: 1080,
      height: 1920,
      hasAudio: true
    }
    let doc = createEmptySemanticTimeline('vid2', facts)
    const shots = singleShot(8, 30)
    const utts = segmentsToUtterances(
      [{ startSec: 2, endSec: 4, text: '今天只要九十九元' }],
      30,
      'sentence'
    )
    const events = heuristicEventsFromUtterances(utts, shots, 30)
    doc = {
      ...doc,
      events,
      beats: assignBeatsHeuristic(events, 8, 30),
      intents: inferIntentsFromEvents(events)
    }
    const cmds = compileDirectorCommands(doc, { rulePacks: [BUILTIN_DIRECTOR_RULES] })
    expect(cmds.length).toBeGreaterThanOrEqual(1)
    const script = semanticToScriptTimeline({
      timeline: doc,
      shots,
      utterances: utts,
      commands: cmds,
      sourceRelativePath: 'Videos/a.mp4'
    })
    expect(script.clips.some((c) => c.track === 'video')).toBe(true)
    expect(script.clips.some((c) => c.track === 'subtitle')).toBe(true)
  })
})

describe('semanticTimeline graph nodes', () => {
  it('registers semantic node types', () => {
    ensureBuiltinNodeTypes()
    for (const id of [
      'video.semanticAnalyze',
      'semantic.timeline',
      'semantic.trigger',
      'semantic.compile',
      'video.repair',
      'video.variant'
    ]) {
      expect(resolveNodeType({ typeId: id } as GraphNode)?.typeId).toBe(id)
    }
  })

  it('executeSemanticAnalyzeNode returns timeline json', async () => {
    const node = {
      id: 'n1',
      typeId: 'video.semanticAnalyze',
      category: 'note',
      title: 'x',
      params: {
        semanticDuration: 8,
        semanticFps: 30,
        utterancesJson: JSON.stringify([
          {
            id: 'utt.1',
            range: makeTimeRange(1, 2, 30),
            text: '今天只要九十九',
            granularity: 'sentence',
            confidence: 0.7
          }
        ])
      }
    } as unknown as GraphNode
    const ctx = { node, inputs: {} } as NodeExecuteContext
    const out = await executeSemanticAnalyzeNode(ctx)
    // 产出结构化值：doc 直接用；text 是给 text 口的规范投影（落到文本口时才用）
    const value = out.out as { kind?: string; doc?: SemanticTimeline; text?: string }
    expect(value.kind).toBe('semanticTimeline')
    const doc = value.doc ?? (JSON.parse(String(value.text)) as SemanticTimeline)
    expect(doc.schema).toBe('aiart.semantic-timeline@1')
    expect(doc.events.length).toBeGreaterThanOrEqual(1)
    expect(JSON.parse(String(value.text)).schema).toBe('aiart.semantic-timeline@1')
  })
})

function fixtureTimeline(): { doc: SemanticTimeline; shots: ReturnType<typeof singleShot> } {
  const facts = { durationSec: 9, fps: 30, width: 1080, height: 1920, hasAudio: true }
  const doc = createEmptySemanticTimeline('asset.vid', facts)
  const shots = [
    {
      id: 'shot.a',
      range: makeTimeRange(0, 3, 30),
      keyframes: { middle: 'evidence/keyframes/a.jpg' },
      confidence: 1
    },
    { id: 'shot.b', range: makeTimeRange(3, 6, 30), keyframes: {}, confidence: 1 },
    { id: 'shot.c', range: makeTimeRange(6, 9, 30), keyframes: {}, confidence: 1 }
  ]
  const utts = segmentsToUtterances(
    [{ startSec: 6.5, endSec: 8, text: '今天只要九十九元' }],
    30,
    'sentence'
  )
  const events = heuristicEventsFromUtterances(utts, shots, 30)
  return {
    doc: {
      ...doc,
      events,
      beats: [
        {
          id: 'beat.hook',
          type: 'hook',
          vocabulary: 'commerce.v1',
          timeRange: makeTimeRange(0, 3, 30),
          emotion: { label: 'neutral', intensity: 0.4 },
          description: '',
          events: []
        },
        {
          id: 'beat.demo',
          type: 'demo',
          vocabulary: 'commerce.v1',
          timeRange: makeTimeRange(3, 6, 30),
          emotion: { label: 'neutral', intensity: 0.4 },
          description: '',
          events: []
        },
        {
          id: 'beat.offer',
          type: 'offer',
          vocabulary: 'commerce.v1',
          timeRange: makeTimeRange(6, 9, 30),
          emotion: { label: 'neutral', intensity: 0.4 },
          description: '',
          events: []
        }
      ],
      intents: inferIntentsFromEvents(events),
      entities: [
        {
          id: 'ent.product.bottle-1',
          kind: 'product',
          name: 'bottle-1',
          appearances: [
            {
              shotId: 'shot.b',
              range: makeTimeRange(3, 6, 30),
              box: { x: 0.4, y: 0.4, w: 0.2, h: 0.3 }
            }
          ],
          pixelEditable: true
        }
      ]
    },
    shots
  }
}

function fakeBuild(calls: SemanticBuildRequest[]) {
  return async (input: SemanticBuildRequest): Promise<SemanticBuildResponse> => {
    calls.push(input)
    const plan = planInvalidation({ timeline: input.timeline, shots: [], edits: input.edits })
    const definition = freezeBuildDefinition(input.timeline, input.edits, plan, 'h')
    const rel = `Semantic/${input.timeline.id}/builds/${definition.id}/output${input.label ? `.${input.label}` : ''}.mp4`
    return {
      plan,
      definition,
      manifest: {
        id: definition.id,
        definitionId: definition.id,
        status: 'done',
        startedAt: '',
        finishedAt: 'now',
        outputRelativePath: rel,
        shotActions: []
      },
      outputRelativePath: rel,
      notes: []
    }
  }
}

describe('semanticTimeline edits / recipes', () => {
  it('normalizes edit drafts and drops invalid ones', () => {
    const { edits, issues } = normalizeSemanticEdits([
      { kind: 'dropBeat', beatId: 'beat.demo' },
      { kind: 'replaceEntity', entityId: 'ent.x' },
      { kind: 'nope' }
    ])
    expect(edits).toHaveLength(1)
    expect(edits[0]!.id).toMatch(/^edit\./)
    expect(edits[0]!.origin).toBe('user')
    expect(issues).toHaveLength(2)
  })

  it('applies dropBeat / reorderBeats to the shot sequence', () => {
    const { doc, shots } = fixtureTimeline()
    const dropped = applyStructuralEdits(
      doc,
      shots,
      normalizeSemanticEdits([{ kind: 'dropBeat', beatId: 'beat.demo' }]).edits
    )
    expect(dropped.map((s) => s.id)).toEqual(['shot.a', 'shot.c'])
    const reordered = applyStructuralEdits(
      doc,
      shots,
      normalizeSemanticEdits([{ kind: 'reorderBeats', beatIds: ['beat.offer', 'beat.hook'] }]).edits
    )
    expect(reordered.map((s) => s.id)).toEqual(['shot.c', 'shot.a', 'shot.b'])
  })

  it('expands recipe slots as a cartesian product and reports missing slots', () => {
    const recipe = {
      id: 'recipe.replace_product.v1',
      title: 'Replace product',
      slots: [{ key: 'productAssetId', kind: 'asset' as const, label: 'Product' }],
      editTemplates: [
        {
          kind: 'replaceEntity' as const,
          entityId: 'ent.product.bottle-1',
          newAssetId: '{{productAssetId}}'
        }
      ],
      targetLevel: 'L1' as const
    }
    const ok = instantiateRecipe(recipe, { productAssetId: ['a1', 'a2'] })
    expect(ok.rows.map((r) => r.edits[0]!.newAssetId)).toEqual(['a1', 'a2'])
    expect(ok.rows[1]!.slots).toEqual({ productAssetId: 'a2' })
    expect(instantiateRecipe(recipe, {}).missingSlots).toEqual(['productAssetId'])
  })

  it('stores normalized boxes on entity appearances when frame size is known', () => {
    const entities = linkEntitiesFromDetections([
      {
        shotId: 's1',
        range: makeTimeRange(0, 1, 30),
        frameWidth: 1000,
        frameHeight: 500,
        boxes: [{ label: 'bottle', confidence: 0.9, x: 100, y: 50, width: 200, height: 100 }]
      }
    ])
    expect(entities[0]!.appearances[0]!.box).toEqual({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 })
  })
})

describe('semanticTimeline executors with injected capabilities', () => {
  it('analyze uses the upstream video, runs the LLM pass and patches the node', async () => {
    const { doc, shots } = fixtureTimeline()
    const response: SemanticAnalyzeResponse = {
      timeline: doc,
      shots,
      utterances: segmentsToUtterances(
        [{ startSec: 6.5, endSec: 8, text: '今天只要九十九元' }],
        30,
        'sentence'
      ),
      keyframes: { 'shot.a': 'Semantic/x/evidence/keyframes/a.jpg' },
      sourceRelativePath: 'Assets/v.mp4',
      method: 'scene',
      notes: ['transcribe failed: none']
    }
    const requests: unknown[] = []
    const patches: unknown[] = []
    const saved: SemanticTimeline[] = []
    const node = {
      id: 'n1',
      typeId: 'video.semanticAnalyze',
      title: 'x',
      params: { vocabulary: 'commerce.v1', semanticLlm: true }
    } as unknown as GraphNode
    const ctx = {
      node,
      inputs: {
        'in-video': [
          { kind: 'asset', assetId: 'asset.vid', assetType: 'video', relativePath: 'Assets/v.mp4' }
        ]
      },
      analyzeSemanticVideo: async (req: unknown) => {
        requests.push(req)
        return response
      },
      saveSemanticTimeline: async (d: SemanticTimeline) => {
        saved.push(d)
      },
      resolveProjectMediaUrl: async (rel: string) => `file:///${rel}`,
      generateText: async ({ system }: { system?: string }) => {
        if (system?.includes('导演助理')) {
          return {
            model: 'm',
            text: JSON.stringify([
              {
                label: 'product_reveal',
                description: '产品出现',
                start: 3,
                end: 5,
                evidence: ['shot.b', 'bogus.id']
              },
              { label: 'ghost', description: '无证据', start: 0, end: 1, evidence: ['bogus.id'] }
            ])
          }
        }
        if (system?.includes('摄影')) {
          return {
            model: 'm',
            text: JSON.stringify([{ shotId: 'shot.a', subject: 'host', cameraMotion: 'push in' }])
          }
        }
        return { model: 'm', text: '[]' }
      },
      patchNode: (p: unknown) => patches.push(p)
    } as unknown as NodeExecuteContext
    const out = await executeSemanticAnalyzeNode(ctx)
    const value = out.out as { kind?: string; doc?: SemanticTimeline; text?: string }
    expect(value.kind).toBe('semanticTimeline')
    const result = value.doc ?? (JSON.parse(String(value.text)) as SemanticTimeline)
    expect(requests[0]).toMatchObject({
      sourceAssetId: 'asset.vid',
      videoRelativePath: 'Assets/v.mp4'
    })
    const labels = result.events.map((e) => e.label)
    expect(labels).toContain('product_reveal')
    expect(labels).toContain('push_in')
    expect(labels).not.toContain('ghost')
    expect(result.events.find((e) => e.label === 'product_reveal')!.evidence).toEqual(['shot.b'])
    expect(saved).toHaveLength(1)
    expect(patches[0]).toMatchObject({
      params: { semanticTimelineId: doc.id, sourceRelativePath: 'Assets/v.mp4' }
    })
  })

  it('trigger keeps commands overlapping the matched events', async () => {
    const { doc } = fixtureTimeline()
    const node = {
      id: 't',
      typeId: 'semantic.trigger',
      params: { eventLabel: 'price_announce' }
    } as unknown as GraphNode
    const out = await executeSemanticTriggerNode({
      node,
      inputs: { in: [{ kind: 'text', text: JSON.stringify(doc) }] }
    } as unknown as NodeExecuteContext)
    const parsed = JSON.parse(out.out && out.out.kind === 'text' ? out.out.text : '{}')
    expect(parsed.events.map((e: { label: string }) => e.label)).toEqual(['price_announce'])
    expect(parsed.commands.length).toBeGreaterThanOrEqual(1)
  })

  it('repair builds and emits a video', async () => {
    const { doc, shots } = fixtureTimeline()
    const calls: SemanticBuildRequest[] = []
    const node = {
      id: 'r',
      typeId: 'video.repair',
      params: { editsJson: JSON.stringify([{ kind: 'dropBeat', beatId: 'beat.demo' }]) }
    } as unknown as GraphNode
    const out = await executeSemanticRepairNode({
      node,
      inputs: { in: [{ kind: 'text', text: JSON.stringify(doc) }] },
      loadSemanticEvidence: async () => ({ shots, utterances: [], keyframes: {} }),
      buildSemanticVideo: fakeBuild(calls)
    } as unknown as NodeExecuteContext)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.edits[0]!.kind).toBe('dropBeat')
    const video = out['out-video']
    expect(video && video.kind === 'video' ? video.relativePath : '').toMatch(/\.mp4$/)
  })

  it('variant expands a market recipe into one build per slot value', async () => {
    const { doc, shots } = fixtureTimeline()
    const calls: SemanticBuildRequest[] = []
    const pack: SemanticPack = {
      schemaVersion: 1,
      id: 'variant-replace-product',
      title: 'Replace product',
      kind: 'recipe',
      recipe: {
        id: 'recipe.replace_product.v1',
        title: 'Replace product',
        slots: [{ key: 'productAssetId', kind: 'asset', label: 'Product' }],
        editTemplates: [
          {
            kind: 'replaceEntity',
            entityId: 'ent.product.bottle-1',
            newAssetId: '{{productAssetId}}'
          }
        ],
        targetLevel: 'L1'
      }
    }
    const node = {
      id: 'v',
      typeId: 'video.variant',
      params: {
        recipeId: 'recipe.replace_product.v1',
        recipeSlotsJson: JSON.stringify({ productAssetId: ['p1', 'p2'] })
      }
    } as unknown as GraphNode
    const out = await executeSemanticVariantNode({
      node,
      inputs: { in: [{ kind: 'text', text: JSON.stringify(doc) }] },
      listSemanticPacks: async () => [pack],
      loadSemanticEvidence: async () => ({ shots, utterances: [], keyframes: {} }),
      buildSemanticVideo: fakeBuild(calls)
    } as unknown as NodeExecuteContext)
    expect(calls.map((c) => (c.edits[0] as { newAssetId: string }).newAssetId)).toEqual([
      'p1',
      'p2'
    ])
    expect(calls.map((c) => c.label)).toEqual(['v1', 'v2'])
    const videos = out['out-videos']
    expect(videos && videos.kind === 'videos' ? videos.items.length : 0).toBe(2)
  })

  it('variant fails loudly when recipe slots are missing', async () => {
    const { doc } = fixtureTimeline()
    const node = {
      id: 'v',
      typeId: 'video.variant',
      params: { recipeId: 'recipe.replace_product.v1' }
    } as unknown as GraphNode
    const pack = {
      schemaVersion: 1,
      id: 'p',
      title: 'p',
      kind: 'recipe',
      recipe: {
        id: 'recipe.replace_product.v1',
        title: 'r',
        slots: [{ key: 'productAssetId', kind: 'asset', label: 'x' }],
        editTemplates: [],
        targetLevel: 'L1'
      }
    } as SemanticPack
    await expect(
      executeSemanticVariantNode({
        node,
        inputs: { in: [{ kind: 'text', text: JSON.stringify(doc) }] },
        listSemanticPacks: async () => [pack]
      } as unknown as NodeExecuteContext)
    ).rejects.toThrow(/productAssetId/)
  })
})
