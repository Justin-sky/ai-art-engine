import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { executeSemanticEventNode } from '../src/shared/graph/execute/semanticTimeline'
import { createNodeFromType, GraphPortType, type NodeExecuteContext } from '../src/shared/graph'
import { parseEventLabels, type SemanticTimeline } from '../src/shared/semanticTimeline'

/**
 * 触发节点「事件标签过滤」的多值支持。
 *
 * 之前只能填一个字符串（`===` 精确匹配），串一条片子时想一次抓多个事件做不到。
 * 现在 `eventLabel` 允许**逗号分隔多值**（字段名不变，零迁移）。
 */

/** 最小可用的时间线文档：两个事件 + 两条对应意图 */
function doc(): SemanticTimeline {
  const range = (start: number, end: number) => ({
    start,
    end,
    startFrame: Math.round(start * 30),
    endFrame: Math.round(end * 30)
  })
  return {
    schema: 'aiart.semantic-timeline@1',
    id: 'stl.test',
    source: { assetId: 'asset-1', fps: 30, duration: 30, width: 1080, height: 1920 },
    vocabulary: 'commerce.v1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    evidence: {
      mediaFacts: { durationSec: 30, fps: 30, width: 1080, height: 1920, hasAudio: true },
      shotsPath: '',
      utterancesPath: '',
      entitiesPath: '',
      ocrPath: '',
      hashes: {}
    },
    events: [
      {
        id: 'ev.a',
        label: '京东福利价引导',
        type: '促销',
        timeRange: range(6, 14),
        evidence: []
      },
      { id: 'ev.b', label: '斜挎促销展示', type: '促销', timeRange: range(17, 22), evidence: [] },
      {
        id: 'ev.c',
        label: '最终抢购号召',
        type: '行动号召',
        timeRange: range(32, 34),
        evidence: []
      }
    ],
    beats: [],
    entities: [],
    ocr: [],
    intents: [
      {
        id: 'intent.a',
        trigger: 'ev.a',
        goal: '引导点击',
        techniques: [{ track: 'text', action: '福利价动态标签' }],
        reason: '',
        timeRange: range(6, 14)
      },
      {
        id: 'intent.b',
        trigger: 'ev.b',
        goal: '展示斜挎',
        techniques: [{ track: 'camera', action: '近景平视固定' }],
        reason: '',
        timeRange: range(17, 22)
      },
      {
        id: 'intent.c',
        trigger: 'ev.c',
        goal: '收束抢购',
        techniques: [{ track: 'text', action: '抢购字幕' }],
        reason: '',
        timeRange: range(32, 34)
      },
      {
        /**
         * 这条意图的 `trigger` 写的是**标签**而不是事件 id，且时间**不与任何事件重叠**
         * （100s 之外）—— 只有「按标签匹配 trigger」这条分支能把它选进来，
         * 时间重叠兜不住，这样那条分支才真正被测到。
         */
        id: 'intent.byLabel',
        trigger: '京东福利价引导',
        goal: '标签触发的意图',
        techniques: [{ track: 'audio', action: '提示音' }],
        reason: '',
        timeRange: range(100, 101)
      }
    ],
    edits: [],
    tracks: []
  } as unknown as SemanticTimeline
}

function ctxFor(eventLabel: string, log: string[] = []): NodeExecuteContext {
  const node = createNodeFromType('semantic.event', { x: 0, y: 0 })
  node.params = { ...node.params, eventLabel }
  const timeline = doc()
  return {
    node,
    locale: 'zh-CN',
    inputs: {
      in: [
        {
          kind: GraphPortType.semanticTimeline,
          doc: timeline,
          text: JSON.stringify(timeline)
        }
      ]
    },
    log: (message) => log.push(message)
  }
}

function payloadOf(result: Record<string, { kind: string; text?: string }>): {
  eventLabel: string
  eventLabels: string[]
  events: Array<{ id: string }>
  commands: Array<{ sourceIntentId?: string }>
  notes: string[]
} {
  const out = result.out
  expect(out?.kind).toBe('text')
  return JSON.parse(out?.text ?? '{}')
}

describe('语义事件节点：事件标签过滤', () => {
  it('parseEventLabels：多分隔符（逗号/中文逗号/**顿号**/分号/换行）、去重、去空白', () => {
    expect(parseEventLabels('a')).toEqual(['a'])
    expect(parseEventLabels('a, b，c')).toEqual(['a', 'b', 'c'])
    // 顿号：中文里最自然的分隔方式，不支持就会把整串当一个标签（实测踩到）
    expect(parseEventLabels('秒杀与包邮字幕、斜挎促销展示')).toEqual([
      '秒杀与包邮字幕',
      '斜挎促销展示'
    ])
    expect(parseEventLabels('a;b；c\nd')).toEqual(['a', 'b', 'c', 'd'])
    expect(parseEventLabels(' 京东福利价引导 , 斜挎促销展示 ')).toEqual([
      '京东福利价引导',
      '斜挎促销展示'
    ])
    expect(parseEventLabels('a,a,a')).toEqual(['a'])
    expect(parseEventLabels('a,, ,b')).toEqual(['a', 'b'])
    // 英文短语不能因为空格被切开
    expect(parseEventLabels('price announce')).toEqual(['price announce'])
    expect(parseEventLabels('price announce, final cta')).toEqual(['price announce', 'final cta'])
    expect(parseEventLabels('')).toEqual([])
    expect(parseEventLabels(undefined)).toEqual([])
    expect(parseEventLabels(123)).toEqual([])
  })

  it('留空 = 全部事件 + 全部命令（eventLabels 为空数组）', async () => {
    const payload = payloadOf(await executeSemanticEventNode(ctxFor('')))
    expect(payload.eventLabel).toBe('')
    expect(payload.eventLabels).toEqual([])
    expect(payload.events).toHaveLength(3)
    // 4 条意图（含 trigger 写标签的那条）全部产出命令
    expect(payload.commands).toHaveLength(4)
  })

  it('单个标签：只留该事件与它的命令', async () => {
    const payload = payloadOf(await executeSemanticEventNode(ctxFor('京东福利价引导')))
    expect(payload.eventLabels).toEqual(['京东福利价引导'])
    expect(payload.events.map((e) => e.id)).toEqual(['ev.a'])
    // intent.byLabel 的 trigger 写的是标签（时间在 100s 之外）→ 只有按标签匹配那条路能选到它
    expect(payload.commands.map((c) => c.sourceIntentId).sort()).toEqual([
      'intent.a',
      'intent.byLabel'
    ])
  })

  it('多个标签（逗号分隔）：两个事件与它们各自的命令都要在', async () => {
    const payload = payloadOf(
      await executeSemanticEventNode(ctxFor('京东福利价引导, 最终抢购号召'))
    )
    expect(payload.eventLabels).toEqual(['京东福利价引导', '最终抢购号召'])
    expect(payload.events.map((e) => e.id)).toEqual(['ev.a', 'ev.c'])
    expect(payload.commands.map((c) => c.sourceIntentId).sort()).toEqual([
      'intent.a',
      'intent.byLabel',
      'intent.c'
    ])
  })

  it('填 type 也能多选（同类型多条一起命中，去重后不重复）', async () => {
    const payload = payloadOf(await executeSemanticEventNode(ctxFor('促销')))
    expect(payload.events.map((e) => e.id)).toEqual(['ev.a', 'ev.b'])
    expect(payload.commands.map((c) => c.sourceIntentId).sort()).toEqual([
      'intent.a',
      'intent.b',
      'intent.byLabel'
    ])
  })

  it('顿号分隔的多标签也能命中（中文用户最常用的写法）', async () => {
    const payload = payloadOf(
      await executeSemanticEventNode(ctxFor('京东福利价引导、最终抢购号召'))
    )
    expect(payload.eventLabels).toEqual(['京东福利价引导', '最终抢购号召'])
    expect(payload.events.map((e) => e.id)).toEqual(['ev.a', 'ev.c'])
    expect(payload.notes).toEqual([])
  })

  it('输出自带 notes：没命中和"输入没事件"要区分开（不再只给两个空数组）', async () => {
    // 有事件但没命中 → 提示里给出可用标签
    const miss = payloadOf(await executeSemanticEventNode(ctxFor('不存在的标签')))
    expect(miss.events).toEqual([])
    expect(miss.commands).toEqual([])
    expect(miss.notes).toHaveLength(1)
    expect(miss.notes[0]).toContain('没有事件匹配')
    expect(miss.notes[0]).toContain('可用标签')
    expect(miss.notes[0]).toContain('京东福利价引导')

    // 输入文档根本没有事件 → 指向上游分析节点，而不是让用户怀疑过滤词
    const empty = doc()
    empty.events = []
    const node = createNodeFromType('semantic.event', { x: 0, y: 0 })
    node.params = { ...node.params, eventLabel: '京东福利价引导' }
    const res = await executeSemanticEventNode({
      node,
      locale: 'zh-CN',
      inputs: {
        in: [{ kind: GraphPortType.semanticTimeline, doc: empty, text: JSON.stringify(empty) }]
      }
    } as unknown as NodeExecuteContext)
    const payload = JSON.parse((res.out as { text: string }).text)
    expect(payload.events).toEqual([])
    expect(payload.notes[0]).toContain('没有事件')
    expect(payload.notes[0]).toContain('语义分析')
    // 带上文档 id 与证据计数，方便和磁盘上的 timeline.json 对照
    expect(payload.notes[0]).toContain('stl.test')
    expect(payload.notes[0]).toContain('镜头')
  })

  it('上游是"只有 id 的空骨架"时，按 id 从磁盘兜底（不再对着 events: [] 干瞪眼）', async () => {
    const real = doc()
    const skeleton = doc()
    skeleton.events = []
    skeleton.beats = []
    skeleton.intents = []
    const node = createNodeFromType('semantic.event', { x: 0, y: 0 })
    node.params = { ...node.params, eventLabel: '京东福利价引导' }
    const log: string[] = []
    const res = await executeSemanticEventNode({
      node,
      locale: 'zh-CN',
      inputs: {
        in: [
          { kind: GraphPortType.semanticTimeline, doc: skeleton, text: JSON.stringify(skeleton) }
        ]
      },
      loadSemanticTimeline: async (id: string) => (id === real.id ? real : null),
      log: (m: string) => log.push(m)
    } as unknown as NodeExecuteContext)
    const payload = JSON.parse((res.out as { text: string }).text)
    // 用磁盘那份：事件与命令都回来了
    expect(payload.events.map((e: { id: string }) => e.id)).toEqual(['ev.a'])
    expect(payload.commands.length).toBeGreaterThan(0)
    expect(log.some((line) => line.includes('空骨架'))).toBe(true)
  })

  it('没有 loadSemanticTimeline 能力时保持原样（骨架照样输出 + notes 说明）', async () => {
    const skeleton = doc()
    skeleton.events = []
    const node = createNodeFromType('semantic.event', { x: 0, y: 0 })
    node.params = { ...node.params, eventLabel: '京东福利价引导' }
    const res = await executeSemanticEventNode({
      node,
      locale: 'zh-CN',
      inputs: {
        in: [
          { kind: GraphPortType.semanticTimeline, doc: skeleton, text: JSON.stringify(skeleton) }
        ]
      }
    } as unknown as NodeExecuteContext)
    const payload = JSON.parse((res.out as { text: string }).text)
    expect(payload.events).toEqual([])
    expect(payload.notes[0]).toContain('没有事件')
  })

  it('填事件 id 同样生效；标签不存在时给 warn 且事件/命令都为空', async () => {
    const logged: string[] = []
    const byId = payloadOf(await executeSemanticEventNode(ctxFor('ev.b', logged)))
    expect(byId.events.map((e) => e.id)).toEqual(['ev.b'])
    expect(logged).toEqual([])

    const missing = payloadOf(
      await executeSemanticEventNode(ctxFor('不存在的标签, 也不存在', logged))
    )
    expect(missing.events).toEqual([])
    expect(missing.commands).toEqual([])
    // 中英都带上了要匹配的多个标签，便于排查
    expect(logged.some((line) => line.includes('不存在的标签') && line.includes('也不存在'))).toBe(
      true
    )
  })

  /**
   * 磁盘兜底这条能力链路要**端到端**存在（typecheck 也会兜，但显式钉住更清楚）：
   * 渲染侧装配 → 引擎透传 → IPC 通道 → preload → main 处理器。
   */
  it('loadSemanticTimeline 能力接线完整（渲染侧 → 引擎 → IPC → preload → main）', () => {
    const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')
    expect(read('src/renderer/src/features/graph/model/semanticGraphCapabilities.ts')).toContain(
      'loadSemanticTimeline: (timelineId) => window.studio.semanticLoadTimeline(timelineId)'
    )
    expect(read('src/shared/graph/execute/engine.ts')).toContain(
      'loadSemanticTimeline: options.loadSemanticTimeline'
    )
    expect(read('src/shared/ipc.ts')).toContain("SEMANTIC_LOAD_TIMELINE: 'semantic:loadTimeline'")
    expect(read('src/shared/ipc.ts')).toContain('semanticLoadTimeline: (')
    expect(read('src/preload/index.ts')).toContain(
      'semanticLoadTimeline: (timelineId) =>\n    ipcRenderer.invoke(IpcChannels.SEMANTIC_LOAD_TIMELINE, timelineId)'
    )
    expect(read('src/main/ipc.ts')).toContain('semanticLoadTimelineForGraph(')
    expect(read('src/main/services/semanticTimeline/graphBridge.ts')).toContain(
      'export function semanticLoadTimelineForGraph('
    )
  })
})
