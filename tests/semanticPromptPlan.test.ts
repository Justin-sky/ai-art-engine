import { describe, expect, it } from 'vitest'
import {
  applyPromptOverrides,
  buildPromptPlan,
  parsePromptPlan,
  planRebuildClips,
  summarizePromptPlan,
  serializePromptPlan,
  VIDEO_PROMPT_PLAN_SCHEMA,
  type SemanticTimeline,
  type ShotEvidence,
  type UtteranceEvidence
} from '../src/shared/semanticTimeline'
import { portsCompatible, portsCompatibleForMenu } from '../src/shared/graph/ports'
import { GraphPortType } from '../src/shared/graph/types'

/**
 * 提示词计划（语义编译 → 语义重建）的契约守卫。
 *
 * 这一层是**纯函数**：编译节点怎么把时间线变成提示词、重建节点要生成几次，
 * 全在这里定；节点执行器只负责调用模型与拼接视频。
 */

const range = (start: number, end: number) => ({ start, end, startFrame: 0, endFrame: 0 })

function makeTimeline(): SemanticTimeline {
  return {
    id: 'stl.prompt.1',
    schema: 'aiart.semantic-timeline@1',
    source: { assetId: 'asset-1', fps: 30, duration: 12, width: 1080, height: 1920 },
    evidence: { shots: 'evidence/shots.json', utterances: 'evidence/utterances.json' },
    entities: [
      {
        id: 'ent.bag',
        kind: 'product',
        name: '托特包',
        pixelEditable: true,
        appearances: [{ shotId: 'shot.1', range: range(0, 6) }]
      },
      {
        id: 'ent.host',
        kind: 'person',
        name: '主播',
        pixelEditable: false,
        appearances: [{ shotId: 'shot.2', range: range(6, 12) }]
      }
    ],
    events: [
      {
        id: 'ev.a',
        timeRange: range(0, 6),
        type: 'reveal',
        label: 'product_reveal',
        description: '从包里取出化妆包展示',
        importance: 0.8,
        entities: ['ent.bag'],
        evidence: ['shot.1'],
        intents: ['intent.a'],
        confidence: 0.9,
        origin: 'agent'
      },
      {
        id: 'ev.b',
        timeRange: range(6, 12),
        type: 'cta',
        label: 'price_announce',
        description: '主播口播福利价',
        importance: 0.9,
        entities: ['ent.host'],
        evidence: ['shot.2'],
        intents: [],
        confidence: 0.9,
        origin: 'agent'
      }
    ],
    beats: [],
    intents: [
      {
        id: 'intent.a',
        trigger: 'ev.a',
        goal: '强调容量',
        techniques: [{ track: 'camera', action: '特写拉开' }],
        reason: '',
        origin: 'agent'
      }
    ],
    tracks: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z'
  } as unknown as SemanticTimeline
}

const shots: ShotEvidence[] = [
  {
    id: 'shot.1',
    range: range(0, 6),
    keyframes: { middle: 'evidence/keyframes/shot1.jpg' },
    confidence: 1
  },
  { id: 'shot.2', range: range(6, 12), keyframes: {}, confidence: 1 }
]

const utterances: UtteranceEvidence[] = [
  {
    id: 'utt.1',
    range: range(6.5, 9),
    text: '现在下单只要九十九',
    granularity: 'sentence',
    confidence: 1
  }
]

const commands = [
  { kind: 'camera.pushIn', start: 0, end: 6, params: {}, reason: '', sourceIntentId: 'intent.a' },
  { kind: 'grade.warm', start: 6, end: 12, params: {}, reason: '' }
]

describe('视频生成提示词计划', () => {
  it('规则拼装：实体 / 事件 / 运镜 / 意图 / 台词各就各位，首帧来自关键帧', () => {
    const plan = buildPromptPlan({
      timeline: makeTimeline(),
      shots,
      utterances,
      commands,
      sourceRelativePath: 'Assets/video.mp4'
    })
    expect(plan.schema).toBe(VIDEO_PROMPT_PLAN_SCHEMA)
    expect(plan.timelineId).toBe('stl.prompt.1')
    expect(plan.sourceRelativePath).toBe('Assets/video.mp4')
    expect(plan.settings).toMatchObject({ width: 1080, height: 1920, fps: 30, durationSec: 12 })
    expect(plan.shots.map((s) => s.shotId)).toEqual(['shot.1', 'shot.2'])

    const first = plan.shots[0]!
    expect(first.prompt).toContain('托特包')
    expect(first.prompt).toContain('从包里取出化妆包展示')
    expect(first.prompt).toContain('镜头缓慢推进')
    expect(first.prompt).toContain('特写拉开')
    expect(first.entities).toEqual(['托特包（商品）']) // product 在中文下本地化为「商品」
    expect(first.eventLabels).toEqual(['product_reveal'])
    expect(first.sourceIntentIds).toEqual(['intent.a'])
    expect(first.firstFrameRelativePath).toBe('Semantic/stl.prompt.1/evidence/keyframes/shot1.jpg')
    expect(first.negativePrompt).toBeTruthy()

    const second = plan.shots[1]!
    expect(second.prompt).toContain('主播（人物）') // person 在中文下本地化为「人物」
    expect(second.prompt).toContain('现在下单只要九十九')
    expect(second.prompt).toContain('整体暖色调')
    expect(second.firstFrameRelativePath).toBeUndefined() // 没有关键帧 → 重建要退化，必须显式暴露
    expect(plan.fullPrompt).toContain('托特包')
    expect(plan.fullPrompt).toContain('主播')
  })

  it('字段不全的时间线（空骨架 / 手写 JSON）不抛错，也不硬编造内容', () => {
    const bare = {
      id: 'stl.bare',
      source: { assetId: 'a', fps: 24, duration: 3 }
    } as unknown as SemanticTimeline
    const plan = buildPromptPlan({
      timeline: bare,
      shots: [{ id: 'shot.1', range: range(0, 3), keyframes: {}, confidence: 1 }]
    })
    expect(plan.shots).toHaveLength(1)
    expect(plan.shots[0]!.prompt).toBe('')
    expect(plan.fullPrompt).toBe('')
    // 未知命令类型保留 kind，不编造中文
    const withUnknown = buildPromptPlan({
      timeline: bare,
      shots: [{ id: 'shot.1', range: range(0, 3), keyframes: {}, confidence: 1 }],
      commands: [{ kind: 'vfx.sparkle', start: 0, end: 3, params: {}, reason: '' }]
    })
    expect(withUnknown.shots[0]!.prompt).toBe('')
  })

  it('英文语言下提示词与负面词跟着换', () => {
    const plan = buildPromptPlan({ timeline: makeTimeline(), shots, commands, lang: 'en' })
    expect(plan.lang).toBe('en')
    expect(plan.shots[0]!.prompt).toContain('slow push-in')
    expect(plan.shots[0]!.entities[0]).toContain('(product)')
    expect(plan.shots[0]!.negativePrompt).toContain('blurry')
  })

  it('人工覆盖：两种写法都认，坏 JSON 原样返回，fullPrompt 跟着重算', () => {
    const plan = buildPromptPlan({ timeline: makeTimeline(), shots, commands })
    const byMap = applyPromptOverrides(plan, JSON.stringify({ 'shot.1': '换成俯拍特写' }))
    expect(byMap.shots[0]!.prompt).toBe('换成俯拍特写')
    expect(byMap.fullPrompt).toContain('换成俯拍特写')
    expect(byMap.shots[0]!.modelAuthored).toBe(false)

    const byArray = applyPromptOverrides(
      plan,
      JSON.stringify([{ shotId: 'shot.2', prompt: '口播收尾', negativePrompt: '无字幕' }])
    )
    expect(byArray.shots[1]!.prompt).toBe('口播收尾')
    expect(byArray.shots[1]!.negativePrompt).toBe('无字幕')

    // 坏 JSON / 空 / 对不上的 id：原样返回（不能让编译节点因人工覆盖而失败）
    expect(applyPromptOverrides(plan, '{oops')).toBe(plan)
    expect(applyPromptOverrides(plan, '')).toBe(plan)
    expect(applyPromptOverrides(plan, JSON.stringify({ 'shot.9': 'x' })).shots[0]!.prompt).toBe(
      plan.shots[0]!.prompt
    )
  })

  it('摘要与序列化往返', () => {
    const plan = buildPromptPlan({ timeline: makeTimeline(), shots, commands, utterances })
    expect(summarizePromptPlan(plan)).toEqual({
      shots: 2,
      withFirstFrame: 1,
      withPrompt: 2,
      modelAuthored: 0
    })
    const round = parsePromptPlan(serializePromptPlan(plan))
    expect(round?.shots.map((s) => s.shotId)).toEqual(plan.shots.map((s) => s.shotId))
    // 不是本 schema / 不是 JSON → null
    expect(parsePromptPlan('{"schema":"other","shots":[]}')).toBeNull()
    expect(parsePromptPlan('{}')).toBeNull()
    expect(parsePromptPlan('')).toBeNull()
    expect(summarizePromptPlan(null).shots).toBe(0)
  })

  it('重建计划：逐镜头 / 整片两种模式 + 上限截断 + 空提示词跳过', () => {
    const plan = buildPromptPlan({ timeline: makeTimeline(), shots, commands, utterances })

    const shotsMode = planRebuildClips(plan, { mode: 'shots' })
    expect(shotsMode.mode).toBe('shots')
    expect(shotsMode.clips.map((c) => c.key)).toEqual(['shot.1', 'shot.2'])
    expect(shotsMode.clips[0]!.firstFrameRelativePath).toBe(
      'Semantic/stl.prompt.1/evidence/keyframes/shot1.jpg'
    )
    expect(shotsMode.clips[0]!.durationSec).toBe(6)
    expect(shotsMode.skippedByLimit).toBe(0)

    const capped = planRebuildClips(plan, { mode: 'shots', maxShots: 1 })
    expect(capped.clips).toHaveLength(1)
    expect(capped.skippedByLimit).toBe(1)

    const full = planRebuildClips(plan, { mode: 'full' })
    expect(full.mode).toBe('full')
    expect(full.clips).toHaveLength(1)
    expect(full.clips[0]!.key).toBe('full')
    expect(full.clips[0]!.durationSec).toBe(12)
    expect(full.clips[0]!.prompt).toContain('托特包')

    // 没有任何提示词 → 一次都不生成（不能"生成了个空提示词"）
    const empty = planRebuildClips({ ...plan, shots: [], fullPrompt: '' }, { mode: 'shots' })
    expect(empty.clips).toEqual([])
    expect(empty.skippedEmpty).toBe(0)
    expect(planRebuildClips(null).clips).toEqual([])

    // 无提示词的镜头被跳过并计数
    const partial = planRebuildClips(
      { ...plan, shots: plan.shots.map((s, i) => (i === 1 ? { ...s, prompt: '' } : s)) },
      { mode: 'shots' }
    )
    expect(partial.clips.map((c) => c.key)).toEqual(['shot.1'])
    expect(partial.skippedEmpty).toBe(1)
  })

  it('端口口径：提示词 → 文本单向兼容；菜单口径不含投影', () => {
    expect(portsCompatible(GraphPortType.videoPrompts, GraphPortType.text)).toBe(true)
    expect(portsCompatible(GraphPortType.videoPrompts, GraphPortType.videoPrompts)).toBe(true)
    expect(portsCompatible(GraphPortType.text, GraphPortType.videoPrompts)).toBe(false)
    expect(portsCompatible(GraphPortType.semanticTimeline, GraphPortType.videoPrompts)).toBe(false)
    expect(portsCompatibleForMenu(GraphPortType.videoPrompts, GraphPortType.text)).toBe(false)
    expect(portsCompatibleForMenu(GraphPortType.videoPrompts, GraphPortType.videoPrompts)).toBe(
      true
    )
  })

  /**
   * 提示词质量回归（真实数据暴露的问题：无上限 + 全量拼接时单镜近千字、整片 5313 字，
   * 模型会截断，主体与动作反被切掉）。
   */
  it('质量：未知命令不原样吐、非画面轨道不进、事件按重要度取前 3', () => {
    const timeline = makeTimeline()
    // 5 个与同一镜重叠的事件，重要度递减 → 只应取前 3
    timeline.events = Array.from({ length: 5 }, (_, i) => ({
      id: `ev.${i}`,
      timeRange: range(0, 6),
      type: 'reveal',
      label: `label_${i}`,
      description: `事件描述${i}`,
      importance: 1 - i * 0.1,
      entities: [],
      evidence: [],
      intents: [],
      confidence: 1,
      origin: 'agent'
    })) as never
    timeline.intents = [
      {
        id: 'intent.picture',
        trigger: 'ev.0',
        goal: '强调容量',
        techniques: [
          { track: 'camera', action: '特写拉开' },
          { track: 'light', action: '柔光' },
          { track: 'audio', action: '口播重音+BGM推进' },
          { track: 'edit', action: '硬切特写' }
        ],
        reason: '',
        origin: 'agent'
      }
    ] as never

    const plan = buildPromptPlan({
      timeline,
      shots: [{ id: 'shot.1', range: range(0, 6), keyframes: {}, confidence: 1 }],
      commands: [
        { kind: 'camera.pushIn', start: 0, end: 6, params: {}, reason: '' },
        // 规则包把中文动作塞进 kind：不能原样拼进提示词
        { kind: 'light.价格弹跳与箭头', start: 0, end: 6, params: {}, reason: '' },
        { kind: 'camera.固定中景', start: 0, end: 6, params: {}, reason: '' }
      ]
    })
    const prompt = plan.shots[0]!.prompt

    expect(prompt).not.toContain('价格弹跳与箭头')
    expect(prompt).not.toContain('固定中景')
    expect(prompt).not.toContain('口播重音')
    expect(prompt).not.toContain('硬切特写')
    // 画面轨道的技术动作进得来
    expect(prompt).toContain('特写拉开')
    expect(prompt).toContain('柔光')
    expect(prompt).toContain('镜头缓慢推进')
    // 事件只取前 3（重要度最高的）
    expect(prompt).toContain('事件描述0')
    expect(prompt).toContain('事件描述1')
    expect(prompt).toContain('事件描述2')
    expect(prompt).not.toContain('事件描述3')
    expect(prompt).not.toContain('事件描述4')
    // camera 字段只收去重后的镜头语言
    expect(plan.shots[0]!.camera).toBe('镜头缓慢推进')
  })

  /**
   * 长度上限单独一条：输入**故意超长**（真实数据里单镜近千字），否则断言是空的
   * （取消上限也照样通过 —— 变异验证发现的）。
   */
  it('质量：超长输入被按分隔符截断到上限内（单镜 220 / 整片 600）', () => {
    const timeline = makeTimeline()
    timeline.events = Array.from({ length: 5 }, (_, i) => ({
      id: `ev.long.${i}`,
      timeRange: range(0, 6),
      type: 'reveal',
      label: `long_${i}`,
      description: `事件描述${i}${'补充说明'.repeat(30)}`,
      importance: 1 - i * 0.1,
      entities: [],
      evidence: [],
      intents: [],
      confidence: 1,
      origin: 'agent'
    })) as never
    const plan = buildPromptPlan({
      timeline,
      shots: [{ id: 'shot.1', range: range(0, 6), keyframes: {}, confidence: 1 }]
    })
    const prompt = plan.shots[0]!.prompt
    expect(prompt.length).toBeGreaterThan(100) // 确实被截断过（不是本来就短）
    expect(prompt.length).toBeLessThanOrEqual(220)
    expect(plan.fullPrompt.length).toBeLessThanOrEqual(600)
  })

  /**
   * 实体收口：只留画面主体（人物/商品/物体/背景）且取前几个。
   * 真实数据里一镜挂 11 个实体（含 OCR 文字 / logo / 音色），把 220 字预算吃光。
   */
  it('质量：实体只留画面主体、按优先级取前 3，OCR 文字 / logo / 音色不进提示词', () => {
    const timeline = makeTimeline()
    timeline.entities = [
      {
        id: 'e.voice',
        kind: 'voice',
        name: '男声口播',
        pixelEditable: false,
        appearances: [{ shotId: 'shot.1', range: range(0, 6) }]
      },
      {
        id: 'e.text',
        kind: 'text',
        name: '0.01元起！包邮！',
        pixelEditable: false,
        appearances: [{ shotId: 'shot.1', range: range(0, 6) }]
      },
      {
        id: 'e.logo',
        kind: 'logo',
        name: '京东 logo',
        pixelEditable: false,
        appearances: [{ shotId: 'shot.1', range: range(0, 6) }]
      },
      {
        id: 'e.bg',
        kind: 'background',
        name: '办公室桌面',
        pixelEditable: false,
        appearances: [{ shotId: 'shot.1', range: range(0, 6) }]
      },
      {
        id: 'e.obj',
        kind: 'object',
        name: '红白条纹小旗',
        pixelEditable: false,
        appearances: [{ shotId: 'shot.1', range: range(0, 6) }]
      },
      {
        id: 'e.p',
        kind: 'product',
        name: '灰色腰包',
        pixelEditable: true,
        appearances: [{ shotId: 'shot.1', range: range(0, 6) }]
      },
      {
        id: 'e.person',
        kind: 'person',
        name: '蓝西装男士',
        pixelEditable: false,
        appearances: [{ shotId: 'shot.1', range: range(0, 6) }]
      }
    ] as never

    const plan = buildPromptPlan({
      timeline,
      shots: [{ id: 'shot.1', range: range(0, 6), keyframes: {}, confidence: 1 }]
    })
    const prompt = plan.shots[0]!.prompt
    // 非画面主体不进
    expect(prompt).not.toContain('男声口播')
    expect(prompt).not.toContain('0.01元起')
    expect(prompt).not.toContain('京东 logo')
    // 主体按优先级取前 3：person > product > object
    expect(plan.shots[0]!.entities).toEqual([
      '蓝西装男士（人物）',
      '灰色腰包（商品）',
      '红白条纹小旗（object）'
    ])
    expect(prompt).not.toContain('办公室桌面')
  })
})
