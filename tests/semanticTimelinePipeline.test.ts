import { describe, expect, it } from 'vitest'
import {
  createEmptySemanticTimeline,
  linkEntitiesFromDetections,
  makeTimeRange,
  migrateSemanticTimeline,
  parseJsonArray,
  segmentsToUtterances,
  semanticToScriptTimeline,
  singleShot,
  type SemanticAnalyzeResponse,
  type SemanticTimeline
} from '../src/shared/semanticTimeline'
import { ensureBuiltinNodeTypes } from '../src/shared/graph/builtins'
import { resolveNodeType } from '../src/shared/graph/registry'
import { executeSemanticAnalyzeNode } from '../src/shared/graph/execute/semanticTimeline'
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

  it('links boxes across shots into entities and stores normalized coordinates', () => {
    const d1 = {
      shotId: 'shot.a',
      range: makeTimeRange(0, 3, 30),
      frameWidth: 1000,
      frameHeight: 500,
      boxes: [{ label: 'person', confidence: 0.9, x: 100, y: 50, width: 200, height: 100 }]
    }
    const d2 = {
      shotId: 'shot.b',
      range: makeTimeRange(3, 6, 30),
      frameWidth: 1000,
      frameHeight: 500,
      boxes: [
        { label: 'person', confidence: 0.85, x: 110, y: 55, width: 190, height: 95 },
        { label: 'bottle', confidence: 0.8, x: 400, y: 200, width: 100, height: 150 }
      ]
    }
    const entities = linkEntitiesFromDetections([d1, d2])
    expect(entities.some((e) => e.kind === 'person' && e.appearances.length === 2)).toBe(true)
    expect(entities.some((e) => e.kind === 'product')).toBe(true)
    expect(entities[0]!.appearances[0]!.box).toEqual({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 })
  })

  it('parses fenced JSON arrays', () => {
    const text = '```json\n[{"shotId":"s1","subject":"host"}]\n```'
    expect(parseJsonArray<{ shotId: string }>(text)[0]!.shotId).toBe('s1')
  })

  it('converts SemanticTimeline into ScriptTimeline video and subtitle tracks', () => {
    const facts = {
      durationSec: 8,
      fps: 30,
      width: 1080,
      height: 1920,
      hasAudio: true
    }
    const shots = singleShot(8, 30)
    const utts = segmentsToUtterances(
      [{ startSec: 2, endSec: 4, text: '今天只要九十九元' }],
      30,
      'sentence'
    )
    const doc = migrateSemanticTimeline(createEmptySemanticTimeline('vid2', facts), {
      shots,
      utterances: utts
    })
    const script = semanticToScriptTimeline({
      timeline: doc,
      shots,
      utterances: utts,
      sourceRelativePath: 'Videos/a.mp4'
    })
    expect(script.clips.some((c) => c.track === 'video')).toBe(true)
    expect(script.clips.some((c) => c.track === 'subtitle')).toBe(true)
  })
})

describe('semanticTimeline 2-node graph pipeline', () => {
  it('registers only semantic.analyze and semantic.rebuild node types', () => {
    ensureBuiltinNodeTypes()
    for (const id of ['semantic.analyze', 'semantic.rebuild']) {
      expect(resolveNodeType({ typeId: id } as GraphNode)?.typeId).toBe(id)
    }
  })

  it('executeSemanticAnalyzeNode returns v2 SemanticTimeline with breakdown summary', async () => {
    const node = {
      id: 'n1',
      typeId: 'semantic.analyze',
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
    const value = out.out as { kind?: string; doc?: SemanticTimeline; text?: string }
    expect(value.kind).toBe('semanticTimeline')
    const doc = value.doc ?? (JSON.parse(String(value.text)) as SemanticTimeline)
    expect(doc.schema).toBe('aiart.semantic-timeline@2')
    expect(doc.breakdown?.summary.shotCount).toBe(1)
    expect(doc.dialogue?.[0]?.text).toBe('今天只要九十九')
  })

  it('analyze uses the upstream video, runs 4-axis VLM enrichment, saves timeline and patches node', async () => {
    const facts = { durationSec: 6, fps: 30, width: 1080, height: 1920, hasAudio: true }
    const shots = [
      {
        id: 'shot.a',
        range: makeTimeRange(0, 3, 30),
        keyframes: { first: 'evidence/keyframes/a.jpg', middle: 'evidence/keyframes/a.jpg' },
        confidence: 1
      },
      {
        id: 'shot.b',
        range: makeTimeRange(3, 6, 30),
        keyframes: { first: 'evidence/keyframes/b.jpg' },
        confidence: 1
      }
    ]
    const doc = migrateSemanticTimeline(createEmptySemanticTimeline('asset.vid', facts), { shots })
    const response: SemanticAnalyzeResponse = {
      timeline: doc,
      shots,
      utterances: segmentsToUtterances(
        [{ startSec: 1, endSec: 2.5, text: '新品首发立减一百' }],
        30,
        'sentence'
      ),
      keyframes: { 'shot.a': 'Semantic/x/evidence/keyframes/a.jpg' },
      sourceRelativePath: 'Assets/v.mp4',
      method: 'scene',
      notes: []
    }
    const requests: unknown[] = []
    const patches: unknown[] = []
    const saved: SemanticTimeline[] = []
    const node = {
      id: 'n1',
      typeId: 'semantic.analyze',
      title: 'x',
      params: { semanticLlm: true }
    } as unknown as GraphNode
    const ctx = {
      node,
      inputs: {
        in: [
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
        if (system?.includes('whole-video') || system?.includes('整片')) {
          return {
            model: 'm',
            text: JSON.stringify({
              summary: '电商口播带货短片',
              hook: '新品首发优惠',
              segments: [{ start: 0, end: 6, beat: 'Hook', copy: '新品首发立减一百' }]
            })
          }
        }
        return {
          model: 'm',
          text: JSON.stringify([
            {
              shotId: 'shot.a',
              baseLabel: 'ai_video',
              probs: { ai_video: 0.92 },
              visualDescription: '主播手持耳机在霓虹直播间讲解',
              cameraMotion: 'push in',
              layers: [{ kind: 'huazi', text: '首发立减', position: 'top' }]
            }
          ])
        }
      },
      patchNode: (p: unknown) => patches.push(p)
    } as unknown as NodeExecuteContext

    const out = await executeSemanticAnalyzeNode(ctx)
    const value = out.out as { kind?: string; doc?: SemanticTimeline }
    expect(value.kind).toBe('semanticTimeline')
    const result = value.doc!
    expect(requests[0]).toMatchObject({
      sourceAssetId: 'asset.vid',
      videoRelativePath: 'Assets/v.mp4'
    })
    expect(result.shots?.[0]?.visual?.description).toContain('主播手持耳机')
    expect(result.shots?.[0]?.layers?.[0]?.text).toBe('首发立减')
    expect(result.breakdown?.wholeVideo?.summary).toBe('电商口播带货短片')
    expect(saved).toHaveLength(1)
    expect(patches[0]).toMatchObject({
      params: { semanticTimelineId: doc.id, sourceRelativePath: 'Assets/v.mp4' }
    })
  })
})
