import { describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  executeSemanticAnalyzeNode,
  executeSemanticRebuildNode
} from '../src/shared/graph/execute/semanticTimeline'
import { semanticTimelineValue } from '../src/shared/graph/execute/semanticTimelineValue'
import { SEMANTIC_TIMELINE_NODE_TYPES } from '../src/shared/graph/semanticTimelineNodes'
import { graphValueHasPayload } from '../src/shared/graph/hostInput'
import { summarizeGraphValueForLog } from '../src/shared/graph/execute/runLog'
import {
  SEMANTIC_TIMELINE_SCHEMA,
  finalizeSemanticBreakdown,
  makeTimeRange,
  migrateSemanticTimeline,
  type SemanticTimeline
} from '../src/shared/semanticTimeline'
import type { GraphValue, NodeExecuteContext } from '../src/shared/graph/execute/types'

function makeDoc(id = 'stl.test0001'): SemanticTimeline {
  const migrated = migrateSemanticTimeline(
    {
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
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    },
    {
      shots: [
        {
          id: 'shot.1',
          range: makeTimeRange(0, 6, 24),
          keyframes: { first: 'evidence/keyframes/s1.jpg' },
          confidence: 0.95
        },
        {
          id: 'shot.2',
          range: makeTimeRange(6, 12, 24),
          keyframes: { first: 'evidence/keyframes/s2.jpg' },
          confidence: 0.95
        }
      ]
    }
  )
  return finalizeSemanticBreakdown(migrated)
}

function ctxWith(
  typeId: 'semantic.analyze' | 'semantic.rebuild',
  inputs: Record<string, GraphValue[]>,
  extra: Partial<NodeExecuteContext> = {}
) {
  const patchNode = vi.fn()
  const log = vi.fn()
  const ctx = {
    node: {
      id: 'n1',
      typeId,
      category: 'note',
      position: { x: 0, y: 0 },
      params: typeId === 'semantic.rebuild' ? { semanticExecute: false } : {}
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
    doc.evidence.hashes = { shots: '9', utterances: '8', entities: '16', ocr: '0' }

    const snapshot = summarizeGraphValueForLog(semanticTimelineValue(doc))
    expect(snapshot.kind).toBe('semanticTimeline')
    expect(snapshot.assetId).toBe('stl.logsnap')
    expect(snapshot.itemCount).toBe(2) // inline shots
    expect(snapshot.shotsCount).toBe(9)
    expect(snapshot.utterancesCount).toBe(8)
    expect(snapshot.entitiesCount).toBe(16)
    expect(JSON.stringify(snapshot).length).toBeLessThan(400)
  })

  it('多模态四轴鉴别失败时给出清晰告警并保留本地物理取证判定', async () => {
    const doc = makeDoc('stl.llmfail')
    const analyzeSemanticVideo = vi.fn(async () => ({
      timeline: doc,
      shots: [
        {
          id: 'shot.a',
          range: { start: 0, end: 3, startFrame: 0, endFrame: 72 },
          keyframes: { first: 'evidence/keyframes/a.jpg', middle: 'evidence/keyframes/a.jpg' },
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
        params: { sourceAssetId: 'asset-1', semanticLlm: true }
      },
      locale: 'zh-CN',
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
    const summary = warns.find((t) => t.includes('保留本地物理取证判定'))
    expect(summary, '缺少多模态鉴别回退告警').toBeTruthy()
    expect(summary).toContain('deepseek-v4-1-flash-260910')
  })

  it('分析节点走到空骨架分支时必须告警，且不凭空伪造假镜头', async () => {
    const logs: Array<{ text: string; level?: string }> = []
    const ctx = {
      node: {
        id: 'n-skeleton',
        typeId: 'semantic.analyze',
        category: 'note',
        position: { x: 0, y: 0 },
        params: { semanticLlm: false }
      },
      locale: 'zh-CN',
      inputs: {},
      log: (text: string, level?: string) => logs.push({ text, level })
    } as unknown as NodeExecuteContext

    const out = await executeSemanticAnalyzeNode(ctx)
    const val = out.out as { kind: string; doc?: SemanticTimeline }
    expect(val.kind).toBe('semanticTimeline')
    expect(val.doc?.shots ?? []).toHaveLength(0)
    const warns = logs.filter((l) => l.level === 'warn').map((l) => l.text)
    expect(
      warns.some((t) => t.includes('没有解析到视频输入')),
      '空骨架分支必须给出可诊断的告警'
    ).toBe(true)
  })

  it('节点上的富化模型 / 转写覆盖会一路传到分析服务与多模态调用', async () => {
    const doc = makeDoc('stl.override')
    const analyzeSemanticVideo = vi.fn(async () => ({
      timeline: doc,
      shots: [
        {
          id: 'shot.1',
          range: makeTimeRange(0, 4, 24),
          keyframes: { first: 'evidence/keyframes/s1.jpg' },
          confidence: 0.9
        }
      ],
      utterances: [],
      keyframes: { 'shot.1': 'evidence/keyframes/s1.jpg' },
      sourceRelativePath: '',
      method: 'scene' as const,
      notes: []
    }))
    const textCalls: Array<{ model?: string; providerInstanceId?: string }> = []
    const ctx = {
      node: {
        id: 'n1',
        typeId: 'semantic.analyze',
        category: 'note',
        position: { x: 0, y: 0 },
        params: {
          sourceAssetId: 'asset-1',
          semanticLlm: true,
          generateModel: 'deepseek/deepseek-v4.1-flash',
          generateProviderInstanceId: 'inst-openrouter',
          transcribeModel: 'whisper-1',
          transcribeProviderInstanceId: 'inst-openai'
        }
      },
      inputs: {},
      analyzeSemanticVideo,
      resolveProjectMediaUrl: async (rel: string) => `file:///${rel}`,
      generateText: async (req: { model?: string; providerInstanceId?: string }) => {
        textCalls.push({ model: req.model, providerInstanceId: req.providerInstanceId })
        return { text: '[]' }
      },
      log: () => {}
    } as unknown as NodeExecuteContext

    await executeSemanticAnalyzeNode(ctx)

    expect(analyzeSemanticVideo).toHaveBeenCalledTimes(1)
    const analyzeArg = analyzeSemanticVideo.mock.calls[0]![0] as Record<string, unknown>
    expect(analyzeArg.transcribeModel).toBe('whisper-1')
    expect(analyzeArg.transcribeProviderInstanceId).toBe('inst-openai')
    expect(analyzeArg.entityModel).toBe('deepseek/deepseek-v4.1-flash')
    expect(analyzeArg.entityProviderInstanceId).toBe('inst-openrouter')
    expect(textCalls.length).toBeGreaterThan(0)
    for (const call of textCalls) {
      expect(call.model).toBe('deepseek/deepseek-v4.1-flash')
      expect(call.providerInstanceId).toBe('inst-openrouter')
    }
  })

  it('语义分析节点的定义声明了四个模型覆盖参数', () => {
    const def = SEMANTIC_TIMELINE_NODE_TYPES.find((d) => d.typeId === 'semantic.analyze')
    const params = def?.defaultParams?.() ?? {}
    for (const key of [
      'generateModel',
      'generateProviderInstanceId',
      'transcribeModel',
      'transcribeProviderInstanceId'
    ]) {
      expect(key in params, `缺少参数 ${key}`).toBe(true)
      expect(params[key as keyof typeof params]).toBe('')
    }
  })

  it('检查器把富化模型与转写实例写回节点参数（源码守卫）', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/SemanticTimelineInspector.vue'),
      'utf8'
    )
    expect(source).toContain('preferredModelKey(p.generateProviderInstanceId, p.generateModel)')
    expect(source).toContain('generateModel: enrich?.model ?? ')
    expect(source).toContain('generateProviderInstanceId: enrich?.providerInstanceId ?? ')
    expect(source).toContain('transcribeProviderInstanceId: transcribeInstanceId.value.trim()')
    expect(source).toContain('v-model="enrichModelKey"')
    expect(source).toContain('v-model="transcribeInstanceId"')
    expect(source.match(/@change="persistAnalyze"/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
    expect(source).not.toContain('InstructionModelSelect')
    expect(source).toContain('<select v-model="enrichModelKey"')
  })

  it('实体检测走视觉大模型，且本地 YOLO 实体检测已移除（源码守卫）', () => {
    const root = process.cwd()
    const service = readFileSync(
      join(root, 'src/main/services/semanticTimeline/SemanticTimelineService.ts'),
      'utf8'
    )
    expect(service).toContain("from './entityDetectVlm'")
    expect(service).not.toContain("from './entityDetect'")
    expect(service).not.toContain('detectEntitiesForShots')
    expect(service).not.toContain('yoloService')
    expect(existsSync(join(root, 'src/main/services/semanticTimeline/entityDetect.ts'))).toBe(false)
    const vlm = readFileSync(
      join(root, 'src/main/services/semanticTimeline/entityDetectVlm.ts'),
      'utf8'
    )
    expect(vlm).not.toContain('yoloService')
    expect(vlm).toContain('modelProviderFacade.generateText')
  })

  it('实体检出 0 个也要覆盖落盘并给出提示（不留旧快照）', () => {
    const service = readFileSync(
      join(process.cwd(), 'src/main/services/semanticTimeline/SemanticTimelineService.ts'),
      'utf8'
    )
    expect(service).not.toContain('if (det.entities.length > 0) {')
    expect(service).toMatch(/entities = det\.entities\s*\n\s*saveEntities\(/)
    expect(service).toMatch(/det\.entities\.length === 0[\s\S]{0,240}?returned 0 entities/)
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
    const { ctx, patchNode } = ctxWith(
      'semantic.analyze',
      { in: [{ kind: 'video', id: 'v1', relativePath: 'Cache/Videos/a.mp4' }] },
      { analyzeSemanticVideo }
    )

    const out = await executeSemanticAnalyzeNode(ctx)
    const value = out.out as { kind: string; doc?: SemanticTimeline; text?: string }
    expect(value.kind).toBe('semanticTimeline')
    expect(value.doc?.id).toBe('stl.abc12345')
    expect(patchNode).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ semanticTimelineId: 'stl.abc12345' })
      })
    )
  })

  it('下游视频重制消费结构化值时直接使用 doc（坏文本也不影响），且手写 timelineJson 参数仍可用', async () => {
    const doc = makeDoc('stl.badtext1')
    const broken: GraphValue = {
      kind: 'semanticTimeline',
      doc,
      text: '{ this is not json'
    }
    const { ctx, patchNode } = ctxWith('semantic.rebuild', { in: [broken] })
    await executeSemanticRebuildNode(ctx)
    const reportCall = patchNode.mock.calls.find(
      (c) => typeof c[0]?.params?.rebuildLastReport === 'string'
    )
    expect(reportCall).toBeTruthy()
    expect(JSON.parse(reportCall![0].params.rebuildLastReport).timelineId).toBe('stl.badtext1')

    // 手写 timelineJson 参数兜底
    const docFromText = makeDoc('stl.fromtext')
    const { ctx: textCtx, patchNode: textPatch } = ctxWith('semantic.rebuild', { in: [] })
    ;(textCtx.node as { params: Record<string, unknown> }).params = {
      semanticExecute: false,
      timelineJson: JSON.stringify(docFromText)
    }
    await executeSemanticRebuildNode(textCtx)
    const textReportCall = textPatch.mock.calls.find(
      (c) => typeof c[0]?.params?.rebuildLastReport === 'string'
    )
    expect(JSON.parse(textReportCall![0].params.rebuildLastReport).timelineId).toBe('stl.fromtext')
  })
})
