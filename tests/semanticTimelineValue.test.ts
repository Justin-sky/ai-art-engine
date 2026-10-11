import { describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  executeSemanticAnalyzeNode,
  executeSemanticCompileNode
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
      typeId: 'semantic.compile',
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

  /**
   * 拿不到视频输入时，分析节点会产出「只有 id 的空骨架」。
   *
   * 以前这条路径**完全静默**（只在"有 assetId 或路径"时才 warn）—— 下游拿到
   * `events: []` 却不知道原因（用户实测：触发节点输出两个空数组，全靠我后加的 notes 才定位到）。
   * 现在无论哪种情况都必须告警。
   */
  it('分析节点走到空骨架分支时必须告警（以前没有视频输入时是静默的）', async () => {
    const logs: Array<{ text: string; level?: string }> = []
    const ctx = {
      node: {
        id: 'n-skeleton',
        typeId: 'semantic.analyze',
        category: 'note',
        position: { x: 0, y: 0 },
        // 没有 sourceAssetId、上游也没有视频值 → 拿不到视频输入
        params: { semanticLlm: false }
      },
      inputs: {},
      // 注意：**不给** analyzeSemanticVideo（模拟主进程能力缺失）
      log: (text: string, level?: string) => logs.push({ text, level })
    } as unknown as NodeExecuteContext

    const out = await executeSemanticAnalyzeNode(ctx)
    expect((out.out as { kind: string }).kind).toBe('semanticTimeline')
    const warns = logs.filter((l) => l.level === 'warn').map((l) => l.text)
    expect(
      warns.some((t) => t.includes('没有解析到视频输入')),
      '空骨架分支必须给出可诊断的告警'
    ).toBe(true)
  })

  /**
   * 按节点指定模型：`runSkill` 一直在读 `params.generateModel`，但节点**从未声明**这两个参数 →
   * 实际永远吃到全局默认文本模型。实测踩过：默认模型未开通 → 三步富化全失败。
   */
  it('节点上的富化模型 / 转写覆盖会真的传下去', async () => {
    const doc = makeDoc('stl.override')
    const analyzeSemanticVideo = vi.fn(async () => ({
      timeline: doc,
      shots: [],
      utterances: [],
      keyframes: {},
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
      generateText: async (req: { model?: string; providerInstanceId?: string }) => {
        textCalls.push({ model: req.model, providerInstanceId: req.providerInstanceId })
        return { text: '[]' }
      },
      log: () => {}
    } as unknown as NodeExecuteContext

    await executeSemanticAnalyzeNode(ctx)

    // 转写覆盖一路传到能力调用
    expect(analyzeSemanticVideo).toHaveBeenCalledTimes(1)
    const analyzeArg = analyzeSemanticVideo.mock.calls[0]![0] as Record<string, unknown>
    expect(analyzeArg.transcribeModel).toBe('whisper-1')
    expect(analyzeArg.transcribeProviderInstanceId).toBe('inst-openai')
    // 实体检测（视觉大模型）复用同一个富化模型选择
    expect(analyzeArg.entityModel).toBe('deepseek/deepseek-v4.1-flash')
    expect(analyzeArg.entityProviderInstanceId).toBe('inst-openrouter')
    // 富化模型一路传到文本生成（三步都要带）
    expect(textCalls.length).toBeGreaterThan(0)
    for (const call of textCalls) {
      expect(call.model).toBe('deepseek/deepseek-v4.1-flash')
      expect(call.providerInstanceId).toBe('inst-openrouter')
    }
  })

  it('语义分析节点的定义声明了这四个覆盖参数（否则 UI 无从写起）', () => {
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

  /**
   * 上面两个参数是「声明了 + 传下去了」，但**检查器得能写**才有意义。
   * 组件没法在 node 环境渲染（没有 jsdom），所以按本仓库既有做法做源码守卫。
   */
  it('检查器把富化模型与转写实例写回节点参数（源码守卫）', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/SemanticTimelineInspector.vue'),
      'utf8'
    )
    // 读：从 providerInstanceId::model 还原成选择器的 key
    expect(source).toContain('preferredModelKey(p.generateProviderInstanceId, p.generateModel)')
    // 写：key 拆回两个参数
    expect(source).toContain('generateModel: enrich?.model ?? ')
    expect(source).toContain('generateProviderInstanceId: enrich?.providerInstanceId ?? ')
    expect(source).toContain('transcribeProviderInstanceId: transcribeInstanceId.value.trim()')
    // 模板里两个控件都绑上了、并且走同一套持久化
    expect(source).toContain('v-model="enrichModelKey"')
    expect(source).toContain('v-model="transcribeInstanceId"')
    expect(source.match(/@change="persistAnalyze"/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
    /**
     * 这里是**检查器**（`.fields label` 是纵向 flex、控件满宽），不能塞卡片工具栏用的
     * `InstructionModelSelect`：它的 max-width 是给节点头部设计的（图标会挤到另一行、
     * 下拉被截成 "OpenRout…"）。实测踩过，用普通 select 与同区其它字段保持一致。
     */
    expect(source).not.toContain('InstructionModelSelect')
    expect(source).toContain('<select v-model="enrichModelKey"')
  })

  /**
   * 实体检测从本地 YOLO 换成多模态大模型：这条链路要钉住，否则容易悄悄退回本地模型
   * （本地模型不需要 Key、跑得快，很容易被"顺手加回兜底"）。
   */
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
    // 检测模块本身也不许再碰本地 YOLO
    const vlm = readFileSync(
      join(root, 'src/main/services/semanticTimeline/entityDetectVlm.ts'),
      'utf8'
    )
    expect(vlm).not.toContain('yoloService')
    expect(vlm).toContain('modelProviderFacade.generateText')
  })

  /**
   * 实体检出 0 个时也必须落盘 + 明确提示。
   *
   * 实测踩到：旧代码只在 `length > 0` 时 `saveEntities`，于是 0 个时
   * `evidence/entities.json` 留下**上一次的 16 个实体**，而时间线文档里是 0 ——
   * 界面上「角色 / 实体」轨道空着、磁盘上却有数据，排查极易被带偏。
   */
  it('实体检出 0 个也要覆盖落盘并给出提示（不留旧快照）', () => {
    const service = readFileSync(
      join(process.cwd(), 'src/main/services/semanticTimeline/SemanticTimelineService.ts'),
      'utf8'
    )
    // 不再有「只在 > 0 时才采纳」的分支
    expect(service).not.toContain('if (det.entities.length > 0) {')
    // 无条件采纳 + 无条件落盘
    expect(service).toMatch(/entities = det\.entities\s*\n\s*saveEntities\(/)
    // 0 个时要有可诊断的提示（否则用户只看到轨道空着，不知道为什么）
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

    const out = await executeSemanticCompileNode(ctx)
    const plan = (out.out as { kind: string; plan?: { timelineId?: string; shots?: unknown[] } })
      .plan
    expect(plan?.timelineId).toBe('stl.badtext1')
    expect(plan?.shots?.length).toBeGreaterThanOrEqual(1)
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

    const out = await executeSemanticCompileNode(ctx)
    const plan = (out.out as { kind: string; plan?: { timelineId?: string } }).plan
    expect(plan?.timelineId).toBe('stl.fromtext')
  })

  it('语义编译拿到结构化时间线值时走 doc（出境是提示词计划口）', async () => {
    const def = SEMANTIC_TIMELINE_NODE_TYPES.find((d) => d.typeId === 'semantic.compile')
    expect(def?.execute).toBeTruthy()
    const doc = makeDoc('stl.passthru')
    const { ctx } = ctxWith({ in: [semanticTimelineValue(doc)] })
    const out = await def!.execute!(ctx)
    expect((out.out as { kind: string }).kind).toBe('videoPrompts')
    const plan = (out.out as { plan?: { timelineId?: string } }).plan
    expect(plan?.timelineId).toBe('stl.passthru')
  })
})
