import { describe, expect, it, vi } from 'vitest'
import {
  executeSemanticAnalyzeNode,
  executeSemanticTriggerNode
} from '../src/shared/graph/execute/semanticTimeline'
import { semanticTimelineValue } from '../src/shared/graph/execute/semanticTimelineValue'
import { SEMANTIC_TIMELINE_NODE_TYPES } from '../src/shared/graph/semanticTimelineNodes'
import { graphValueHasPayload } from '../src/shared/graph/hostInput'
import { summarizeGraphValueForLog } from '../src/shared/graph/execute/runLog'
import { SEMANTIC_TIMELINE_SCHEMA } from '../src/shared/semanticTimeline'
import type { SemanticTimeline } from '../src/shared/semanticTimeline'
import type { GraphValue, NodeExecuteContext } from '../src/shared/graph/execute/types'

/**
 * 语义时间线的**值类型**（第 2 步）。
 *
 * 端口类型只是「能不能连」；值类型解决的是「连上之后传什么」：
 * - 产出侧给结构化值（`{ kind:'semanticTimeline', doc, text }`），时间线口不再来回 JSON.parse；
 * - 落到 text 口时由**引擎在端口边界**投影成文本（`semanticTimeline → text` 是允许的单向兼容）；
 * - 文本路径（节点参数 timelineJson / agent 手写 JSON）继续支持，不能因为值类型化就砍掉。
 */
function makeDoc(id = 'stl.test0001'): SemanticTimeline {
  return {
    id,
    schema: SEMANTIC_TIMELINE_SCHEMA,
    source: { assetId: 'asset-1', fps: 24, duration: 12, width: 1920, height: 1080 },
    evidence: {
      mediaFacts: {
        durationSec: 12,
        fps: 24,
        width: 1920,
        height: 1080,
        hasAudio: true
      },
      shotsPath: 'shots.json',
      utterancesPath: 'utterances.json',
      entitiesPath: 'entities.json',
      ocrPath: 'ocr.json',
      hashes: { shots: '2' }
    },
    entities: [],
    events: [],
    beats: [],
    intents: [],
    tracks: [],
    edits: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function ctxWith(inputs: Record<string, GraphValue[]>, extra: Partial<NodeExecuteContext> = {}) {
  const patchNode = vi.fn()
  const log = vi.fn()
  const ctx = {
    node: {
      id: 'n1',
      typeId: 'semantic.trigger',
      category: 'note',
      position: { x: 0, y: 0 },
      params: {}
    },
    inputs,
    patchNode,
    log,
    ...extra
  } as unknown as NodeExecuteContext
  return { ctx, patchNode, log }
}

describe('语义时间线值类型', () => {
  it('semanticTimelineValue：同时带 doc 与规范 JSON 文本（文本可解析回同一份文档）', () => {
    const doc = makeDoc()
    const value = semanticTimelineValue(doc)
    expect(value.kind).toBe('semanticTimeline')
    expect(value.doc).toBe(doc)
    expect(JSON.parse(value.text)).toEqual(doc)
  })

  it('语义时间线值算「有载荷」（边界/宿主软解析不会把它当空）', () => {
    const doc = makeDoc()
    expect(graphValueHasPayload(semanticTimelineValue(doc))).toBe(true)
    // 空文本 + 空 doc 才算没载荷
    expect(
      graphValueHasPayload({
        kind: 'semanticTimeline',
        doc: undefined as unknown as SemanticTimeline,
        text: ''
      })
    ).toBe(false)
  })

  it('日志摘要能看懂时间线规模（不再只剩 kind）', () => {
    const doc = makeDoc('stl.logsnap')
    doc.events = [
      {
        id: 'ev-1',
        type: 'story',
        label: '开场',
        timeRange: { start: 0, end: 1, startFrame: 0, endFrame: 24 },
        confidence: 0.9,
        origin: 'analysis',
        evidence: []
      }
    ] as SemanticTimeline['events']
    doc.evidence.hashes = { shots: '9', utterances: '8', entities: '16', ocr: '0' }

    const snapshot = summarizeGraphValueForLog(semanticTimelineValue(doc))
    expect(snapshot.kind).toBe('semanticTimeline')
    expect(snapshot.assetId).toBe('stl.logsnap')
    expect(snapshot.itemCount).toBe(1) // events
    expect(snapshot.shotsCount).toBe(9)
    expect(snapshot.utterancesCount).toBe(8)
    expect(snapshot.entitiesCount).toBe(16)
    // 不要把这整份文档塞进日志
    expect(JSON.stringify(snapshot).length).toBeLessThan(400)
  })

  /**
   * 富化整体失败时，必须有一条**能指导下一步**的汇总告警。
   *
   * 实测踩过：模型未开通 → 三步全失败 → 节点仍报 done、时间线仍有启发式事件，
   * 用户从结果上完全看不出「镜头描述与导演意图是空的」，三条分散的 warn 也拼不出结论。
   */
  it('三步富化全失败时汇总成一条可执行告警，且仍产出启发式时间线', async () => {
    const doc = makeDoc('stl.llmfail')
    doc.events = [
      {
        id: 'ev-1',
        type: 'story',
        label: '开场',
        timeRange: { start: 0, end: 1, startFrame: 0, endFrame: 24 },
        confidence: 0.9,
        origin: 'analysis',
        evidence: []
      }
    ] as SemanticTimeline['events']
    const analyzeSemanticVideo = vi.fn(async () => ({
      timeline: doc,
      shots: [
        {
          id: 'shot.a',
          range: { start: 0, end: 3, startFrame: 0, endFrame: 72 },
          keyframes: { middle: 'evidence/keyframes/a.jpg' },
          confidence: 1
        }
      ],
      utterances: [],
      keyframes: { 'shot.a': 'evidence/keyframes/a.jpg' },
      sourceRelativePath: 'Cache/Videos/a.mp4',
      method: 'scene' as const,
      notes: []
    }))
    const logs: Array<{ text: string; level?: string }> = []
    const ctx = {
      node: {
        id: 'n1',
        typeId: 'semantic.analyze',
        category: 'note',
        position: { x: 0, y: 0 },
        // semanticLlm 打开才会走三步富化
        params: { sourceAssetId: 'asset-1', semanticLlm: true }
      },
      inputs: {},
      analyzeSemanticVideo,
      resolveProjectMediaUrl: async (rel: string) => `file:///${rel}`,
      generateText: async () => {
        throw new Error(
          '文本生成失败: Your account 2102221174 has not activated the model deepseek-v4-1-flash-260910'
        )
      },
      log: (text: string, level?: string) => logs.push({ text, level })
    } as unknown as NodeExecuteContext

    const out = await executeSemanticAnalyzeNode(ctx)
    expect((out.out as { kind: string }).kind).toBe('semanticTimeline')

    const warns = logs.filter((l) => l.level === 'warn').map((l) => l.text)
    const summary = warns.find((t) => t.includes('语义富化有'))
    expect(summary, '缺少富化失败的汇总告警').toBeTruthy()
    expect(summary).toContain('3/3')
    expect(summary).toContain('semantic.shotDescribe')
    expect(summary).toContain('semantic.eventExtract')
    expect(summary).toContain('semantic.directorInfer')
    // 原因要带出来（含模型名），并给出可执行的下一步
    expect(summary).toContain('deepseek-v4-1-flash-260910')
    expect(summary).toContain('设置')
  })

  it('语义分析节点（有分析能力）产出结构化值，并把 timelineId 写回参数', async () => {
    const doc = makeDoc('stl.abc12345')
    const analyzeSemanticVideo = vi.fn(async () => ({
      timeline: doc,
      shots: [],
      utterances: [],
      keyframes: {},
      sourceRelativePath: 'Cache/Videos/a.mp4',
      method: 'scene' as const,
      notes: []
    }))
    // 必须给出来源（上游视频或 sourceAssetId），否则会走启发式分支、用不到这个能力
    const { ctx, patchNode } = ctxWith(
      { 'in-video': [{ kind: 'video', relativePath: 'Cache/Videos/a.mp4' }] },
      { analyzeSemanticVideo }
    )

    const out = await executeSemanticAnalyzeNode(ctx)
    const value = out.out as { kind: string; doc?: SemanticTimeline; text?: string }
    expect(value.kind).toBe('semanticTimeline')
    expect(value.doc?.id).toBe('stl.abc12345')
    expect(JSON.parse(String(value.text))).toEqual(doc)
    expect(patchNode).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ semanticTimelineId: 'stl.abc12345' })
      })
    )
  })

  it('语义分析节点（无分析能力，启发式兜底）同样产出结构化值', async () => {
    const { ctx } = ctxWith({ 'in-video': [] })
    const out = await executeSemanticAnalyzeNode(ctx)
    const value = out.out as { kind: string; doc?: SemanticTimeline }
    expect(value.kind).toBe('semanticTimeline')
    expect(value.doc?.schema).toBe(SEMANTIC_TIMELINE_SCHEMA)
  })

  /**
   * 关键判别：给一个**文本是坏 JSON、doc 却合法**的值。
   * 如果消费侧还走「读文本 → JSON.parse」就会抛；能正常跑完就证明它用的是 doc。
   */
  it('下游消费结构化值时不再解析文本（坏文本也不影响）', async () => {
    const doc = makeDoc('stl.badtext1')
    doc.events = [
      {
        id: 'ev-1',
        type: 'story',
        label: '开场',
        timeRange: { start: 0, end: 1, startFrame: 0, endFrame: 24 },
        confidence: 0.9,
        origin: 'analysis',
        evidence: []
      }
    ] as SemanticTimeline['events']
    const broken: GraphValue = {
      kind: 'semanticTimeline',
      doc,
      text: '{ this is not json'
    }
    const { ctx } = ctxWith({ in: [broken] })

    const out = await executeSemanticTriggerNode(ctx)
    const text = (out.out as { kind: 'text'; text: string }).text
    expect(JSON.parse(text).events[0].label).toBe('开场')
  })

  it('文本路径仍然可用：手写 timelineJson 参数照旧被解析', async () => {
    const doc = makeDoc('stl.fromtext')
    doc.events = [
      {
        id: 'ev-2',
        type: 'story',
        label: '来自文本',
        timeRange: { start: 0, end: 1, startFrame: 0, endFrame: 24 },
        confidence: 0.5,
        origin: 'user',
        evidence: []
      }
    ] as SemanticTimeline['events']
    const { ctx } = ctxWith({ in: [] })
    ;(ctx.node as { params: Record<string, unknown> }).params = {
      timelineJson: JSON.stringify(doc)
    }

    const out = await executeSemanticTriggerNode(ctx)
    const text = (out.out as { kind: 'text'; text: string }).text
    expect(JSON.parse(text).events[0].label).toBe('来自文本')
  })

  it('语义时间线节点透传结构化值（不被序列化成文本）', async () => {
    const def = SEMANTIC_TIMELINE_NODE_TYPES.find((d) => d.typeId === 'semantic.timeline')
    expect(def?.execute).toBeTruthy()
    const doc = makeDoc('stl.passthru')
    const { ctx } = ctxWith({ in: [semanticTimelineValue(doc)] })
    const out = await def!.execute!(ctx)
    expect((out.out as { kind: string }).kind).toBe('semanticTimeline')
    expect((out.out as { doc?: SemanticTimeline }).doc?.id).toBe('stl.passthru')
  })

  it('语义时间线节点收到文本时仍按文本透传（老工程/手写 JSON 不受影响）', async () => {
    const def = SEMANTIC_TIMELINE_NODE_TYPES.find((d) => d.typeId === 'semantic.timeline')
    const { ctx } = ctxWith({ in: [{ kind: 'text', text: '{"hello":1}' }] })
    const out = await def!.execute!(ctx)
    expect(out.out).toEqual({ kind: 'text', text: '{"hello":1}' })
  })
})
