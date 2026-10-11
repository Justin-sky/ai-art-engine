import { describe, expect, it } from 'vitest'
import {
  SIDE_PANE_MAX_WIDTH,
  SIDE_PANE_MIN_WIDTH,
  TRACKS_PANE_MIN_WIDTH,
  appearanceSeekSeconds,
  clampSeekSeconds,
  clampSidePaneWidth,
  entityKindKey,
  resolveEvidenceRef,
  resolveSemanticTimelineViewTarget,
  resolveTriggerRange,
  semanticTimelineSummaryText,
  semanticTimelineTextFromRunState,
  sidePaneWidthFromPointer,
  sourceAspectRatio,
  trackLabelKey
} from '../src/renderer/src/features/graph/model/semanticTimelineView'
import { semanticTimelineValue } from '../src/shared/graph/execute/semanticTimelineValue'
import { SEMANTIC_TIMELINE_SCHEMA } from '../src/shared/semanticTimeline'
import type { SemanticTimeline } from '../src/shared/semanticTimeline'
import type { GraphNodeRunState } from '../src/shared/graph/execute/types'

/**
 * 「语义分析跑完怎么看结果」这条链路的回归守卫。
 *
 * 实测踩过：时间线输出从纯文本换成结构化值（`kind: 'semanticTimeline'`）后，
 * 卡片的载荷解析只认 `kind === 'text'` —— 双击节点变成**静默无响应**，用户找不到结果。
 */
function makeDoc(id = 'stl.view0001'): SemanticTimeline {
  return {
    id,
    schema: SEMANTIC_TIMELINE_SCHEMA,
    source: {
      assetId: 'asset-1',
      relativePath: 'Cache/Videos/a.mp4',
      duration: 3,
      fps: 30,
      width: 640,
      height: 360
    },
    vocabulary: 'commerce.v1',
    tracks: [],
    events: [
      {
        id: 'ev-1',
        type: 'story',
        label: '开场',
        timeRange: { start: 0, end: 1, startFrame: 0, endFrame: 30 },
        confidence: 0.9,
        origin: 'analysis',
        evidence: [],
        intents: []
      }
    ],
    beats: [
      { id: 'bt-1', label: 'hook', timeRange: { start: 0, end: 1, startFrame: 0, endFrame: 30 } }
    ],
    intents: [],
    entities: [],
    evidence: {
      mediaFacts: 'evidence/mediaFacts.json',
      shots: 'evidence/shots.json',
      utterances: 'evidence/utterances.json',
      entities: 'evidence/entities.json',
      ocr: 'evidence/ocr.json',
      hashes: { shots: '9', utterances: '8', entities: '16', ocr: '2' }
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  } as unknown as SemanticTimeline
}

function runStateWith(outputs: Record<string, unknown>): GraphNodeRunState {
  return { status: 'done', outputs } as unknown as GraphNodeRunState
}

describe('semanticTimelineView', () => {
  it('结构化值也能取出时间线文本（这是双击失效的那个 bug）', () => {
    const doc = makeDoc()
    const text = semanticTimelineTextFromRunState(runStateWith({ out: semanticTimelineValue(doc) }))
    expect(JSON.parse(text).id).toBe('stl.view0001')
    // 旧的纯文本值仍要认
    expect(
      semanticTimelineTextFromRunState(runStateWith({ out: { kind: 'text', text: ' {"a":1} ' } }))
    ).toBe('{"a":1}')
    // 别的 kind / 空输出 → 空串
    expect(
      semanticTimelineTextFromRunState(runStateWith({ out: { kind: 'image', id: 'x' } }))
    ).toBe('')
    expect(semanticTimelineTextFromRunState(undefined)).toBe('')
  })

  it('查看目标优先用本次运行输出（带 inline JSON）', () => {
    const doc = makeDoc()
    const target = resolveSemanticTimelineViewTarget(
      { params: {} },
      runStateWith({ out: semanticTimelineValue(doc) })
    )
    expect(target?.id).toBe('stl.view0001')
    expect(target?.json).toBeTruthy()
  })

  it('没有运行输出时退回参数里的 timelineJson', () => {
    const doc = makeDoc('stl.fromparams')
    const target = resolveSemanticTimelineViewTarget(
      { params: { timelineJson: JSON.stringify(doc) } },
      null
    )
    expect(target?.id).toBe('stl.fromparams')
    expect(target?.json).toBeTruthy()
  })

  it('只剩 semanticTimelineId 时也能打开（重开工程后按 id 读盘）', () => {
    const target = resolveSemanticTimelineViewTarget(
      { params: { semanticTimelineId: 'stl.fromdisk' } },
      null
    )
    expect(target).toEqual({ id: 'stl.fromdisk' })
  })

  /**
   * 点选 clip → 播放条跳过去：越界必须夹住，否则 `video.currentTime = 超出时长` 会被拒绝。
   */
  it('clampSeekSeconds：负数归零、越界夹到时长、时长未知时只保证非负', () => {
    expect(clampSeekSeconds(3.2, 35.6)).toBe(3.2)
    expect(clampSeekSeconds(-1, 35.6)).toBe(0)
    expect(clampSeekSeconds(40, 35.6)).toBe(35.6)
    expect(clampSeekSeconds(Number.NaN, 35.6)).toBe(0)
    // 时长还没解析出来（video.duration 为 NaN）时不能把 seek 归零
    expect(clampSeekSeconds(12.5, Number.NaN)).toBe(12.5)
    expect(clampSeekSeconds(12.5, 0)).toBe(12.5)
    expect(clampSeekSeconds(12.5, undefined)).toBe(12.5)
  })

  /**
   * 制作层片段（机位/声音/字幕/特效）的落点由 trigger 决定 —— 这条以前内联在模板里，
   * 且**机位/声音的片段根本没绑 @click**（点了没反应）。现在抽成纯函数并补用例。
   */
  it('resolveTriggerRange：按 id 或 label 命中事件，找不到给 0–1 兜底', () => {
    const events = [
      { id: 'ev-1', label: 'cta', timeRange: { start: 2, end: 5 } },
      { id: 'ev-2', label: 'hook', timeRange: { start: 0, end: 2 } }
    ]
    expect(resolveTriggerRange(events, 'ev-1')).toEqual({ start: 2, end: 5 })
    // 按 label 触发也要认（生成侧两种都出现过）
    expect(resolveTriggerRange(events, 'hook')).toEqual({ start: 0, end: 2 })
    expect(resolveTriggerRange(events, '  ev-1  ')).toEqual({ start: 2, end: 5 })
    // 找不到 / 空 trigger → 兜底 0–1，不能是负宽或 NaN（否则片段会整块消失）
    expect(resolveTriggerRange(events, 'nope')).toEqual({ start: 0, end: 1 })
    expect(resolveTriggerRange(events, '')).toEqual({ start: 0, end: 1 })
    // 事件时间为非法值时也要给出可用区间
    expect(
      resolveTriggerRange([{ id: 'x', timeRange: { start: Number.NaN, end: Number.NaN } }], 'x')
    ).toEqual({ start: 0, end: 1 })
    expect(resolveTriggerRange([{ id: 'y', timeRange: { start: 3, end: 3 } }], 'y')).toEqual({
      start: 3,
      end: 4
    })
  })

  /**
   * 两栏拖动：宽度收敛必须在纯函数里定死（拖过头把轨道挤没、或把右栏拖成 0 都是这里防的）。
   */
  it('clampSidePaneWidth / sidePaneWidthFromPointer：边界与「左栏不被挤没」', () => {
    expect(clampSidePaneWidth(500)).toBe(500)
    // 绝对边界
    expect(clampSidePaneWidth(100)).toBe(SIDE_PANE_MIN_WIDTH)
    expect(clampSidePaneWidth(5000)).toBe(SIDE_PANE_MAX_WIDTH)
    expect(clampSidePaneWidth(Number.NaN)).toBe(SIDE_PANE_MIN_WIDTH)
    // 已知编辑器总宽时，保证左栏至少 TRACKS_PANE_MIN_WIDTH（这里上限 900 先生效）
    expect(clampSidePaneWidth(900, 1200)).toBe(SIDE_PANE_MAX_WIDTH)
    expect(clampSidePaneWidth(500, 1200)).toBe(500)
    // 总宽不够时由「左栏保护」收紧：1000 - 280 = 720
    expect(clampSidePaneWidth(880, 1000)).toBe(1000 - TRACKS_PANE_MIN_WIDTH)
    // 窗口很窄（总宽 < 两个最小值之和）：右栏不小于 min 优先，不能出现负宽
    expect(clampSidePaneWidth(500, 400)).toBe(SIDE_PANE_MIN_WIDTH)
    expect(clampSidePaneWidth(500, 100)).toBe(SIDE_PANE_MIN_WIDTH)
  })

  it('拖动换算：右栏贴着编辑器右边缘，拖到哪算到哪', () => {
    // 编辑器右边缘 1000，鼠标在 600 → 右栏 400
    expect(sidePaneWidthFromPointer({ clientX: 600, editorRight: 1000, editorWidth: 1600 })).toBe(
      400
    )
    // 拖到最右（超出右边缘）→ 收敛到最小值，而不是 0 或负数
    expect(sidePaneWidthFromPointer({ clientX: 1400, editorRight: 1000, editorWidth: 1600 })).toBe(
      SIDE_PANE_MIN_WIDTH
    )
    // 拖到很左 → 收敛到最大值
    expect(sidePaneWidthFromPointer({ clientX: 0, editorRight: 1600, editorWidth: 1600 })).toBe(
      SIDE_PANE_MAX_WIDTH
    )
  })

  /**
   * 视频按素材实际比例自适应：元数据到位前用时间线记的宽高占位。
   */
  it('sourceAspectRatio：竖屏/横屏/方形都给出正确比例，非法值交给浏览器', () => {
    expect(sourceAspectRatio({ width: 1080, height: 1920 })).toBe('1080 / 1920')
    expect(sourceAspectRatio({ width: 1920, height: 1080 })).toBe('1920 / 1080')
    expect(sourceAspectRatio({ width: 720, height: 720 })).toBe('720 / 720')
    // 缺失 / 0 / 负数 / NaN → undefined（让浏览器用内在比例，别写出 0/0 这种无效声明）
    expect(sourceAspectRatio({})).toBeUndefined()
    expect(sourceAspectRatio({ width: 1080 })).toBeUndefined()
    expect(sourceAspectRatio({ width: 0, height: 1920 })).toBeUndefined()
    expect(sourceAspectRatio({ width: -10, height: 20 })).toBeUndefined()
    expect(sourceAspectRatio({ width: Number.NaN, height: 1080 })).toBeUndefined()
  })

  /**
   * 证据 id 可读化：`ev.c732c3a6d0` 这种哈希直接摆在面板上没人看得懂。
   */
  it('resolveEvidenceRef：查得到就查，查不到从 id 自身解析，绝不低于原始信息', () => {
    const ctx = {
      events: [
        { id: 'ev.c732c3a6d0', label: 'price_announce', timeRange: { start: 19.32, end: 22.5 } }
      ],
      beats: [{ id: 'beat.aaaa1111', type: 'hook', timeRange: { start: 0, end: 3 } }],
      intents: [{ id: 'intent.bbbb2222', goal: 'emphasize' }],
      entities: [{ id: 'ent.person.host', name: '主播' }],
      fps: 30,
      utterances: new Map([
        ['utt.007.49529d7876', { text: '通勤天天用的好东西', start: 0.38, end: 6.02 }]
      ]),
      shots: new Map([['shot.009.875', { start: 29.17, end: 31.2 }]])
    }
    // 事件：取 label + 时间
    expect(resolveEvidenceRef('ev.c732c3a6d0', ctx)).toEqual({
      raw: 'ev.c732c3a6d0',
      kind: 'event',
      detail: 'price_announce',
      startSec: 19.32,
      endSec: 22.5
    })
    // 话语：有原句就显示原句（长句截断）+ 时间
    const utt = resolveEvidenceRef('utt.007.49529d7876', ctx)
    expect(utt.kind).toBe('utterance')
    expect(utt.detail).toBe('通勤天天用的好东西')
    expect(utt.startSec).toBe(0.38)
    // 镜头：证据文件里有范围就用文件，序号来自 id
    expect(resolveEvidenceRef('shot.009.875', ctx)).toMatchObject({
      kind: 'shot',
      detail: '9',
      startSec: 29.17
    })
    // 实体 / 节拍 / 意图
    expect(resolveEvidenceRef('ent.person.host', ctx).detail).toBe('主播')
    expect(resolveEvidenceRef('beat.aaaa1111', ctx)).toMatchObject({ kind: 'beat', detail: 'hook' })
    expect(resolveEvidenceRef('intent.bbbb2222', ctx).detail).toBe('emphasize')
  })

  it('resolveEvidenceRef：没有证据文件时也能从 id 给出序号/时间，未知 id 退回原文', () => {
    // 空上下文：镜头时间可由「起始帧 / fps」算出
    const shot = resolveEvidenceRef('shot.009.875', { fps: 30 })
    expect(shot).toMatchObject({ kind: 'shot', detail: '9', startSec: 875 / 30 })
    // 话语至少给出序号（拿不到原句）
    expect(resolveEvidenceRef('utt.007.49529d7876', {}).detail).toBe('7')
    expect(resolveEvidenceRef('ocr.003.abcdef1234', {}).detail).toBe('3')
    // 事件查不到实体时给 hash 前缀，而不是「未知」
    expect(resolveEvidenceRef('ev.c732c3a6d0', {}).detail).toBe('c732c3')
    // 不认识的 id / 空串：原样保留，别把信息丢了
    expect(resolveEvidenceRef('weird-id', {})).toEqual({
      raw: 'weird-id',
      kind: 'unknown',
      detail: 'weird-id'
    })
    expect(resolveEvidenceRef('', {}).kind).toBe('unknown')
  })

  /**
   * 轨道 id / 实体 kind 都是机器值，界面必须过一层本地化（手法列表曾直接露出 `camera`）。
   */
  it('trackLabelKey / entityKindKey：已知 id 有键，未知 id 返回 undefined（调用方原样显示）', () => {
    expect(trackLabelKey('camera')).toBe('trackCamera')
    expect(trackLabelKey('audio')).toBe('trackAudio')
    expect(trackLabelKey('text')).toBe('trackText')
    expect(trackLabelKey('vfx')).toBe('trackVfx')
    // 意图手法里出现过的 id
    expect(trackLabelKey('character')).toBe('trackCharacter')
    expect(trackLabelKey('emotion')).toBe('trackEmotion')
    expect(trackLabelKey('edit')).toBe('trackEdit')
    // 层名复用；大小写与空格要容忍
    expect(trackLabelKey('story')).toBe('layerStory')
    expect(trackLabelKey('entity')).toBe('layerEntity')
    expect(trackLabelKey(' Camera ')).toBe('trackCamera')
    // 不认识的 id：交给调用方原样显示
    expect(trackLabelKey('lighting')).toBeUndefined()
    expect(trackLabelKey('')).toBeUndefined()

    expect(entityKindKey('person')).toBe('entityKindPerson')
    expect(entityKindKey('product')).toBe('entityKindProduct')
    expect(entityKindKey('logo')).toBe('entityKindLogo')
    expect(entityKindKey('PRODUCT')).toBe('entityKindProduct')
    expect(entityKindKey('face')).toBeUndefined()
    expect(entityKindKey('')).toBeUndefined()
  })

  /**
   * 实体片段点击：一个实体多镜头出现时会渲染多个片段，点哪个就要跳哪个。
   * （真 bug：以前无论点哪个都跳 appearances[0]。）
   */
  it('appearanceSeekSeconds：按被点的出现跳转，越界/缺失回退第一次，无出现给 undefined', () => {
    const appearances = [
      { range: { start: 3.5, end: 7.2 } },
      { range: { start: 17.12, end: 23.75 } },
      { range: { start: 29.6, end: 31.92 } }
    ]
    // 点第 1 / 2 / 3 个片段 → 各自的时间（这正是以前错的地方）
    expect(appearanceSeekSeconds(appearances, 0)).toBe(3.5)
    expect(appearanceSeekSeconds(appearances, 1)).toBe(17.12)
    expect(appearanceSeekSeconds(appearances, 2)).toBe(29.6)
    // 没传索引 / 越界 / 非整数 → 回退第一次出现
    expect(appearanceSeekSeconds(appearances)).toBe(3.5)
    expect(appearanceSeekSeconds(appearances, 9)).toBe(3.5)
    expect(appearanceSeekSeconds(appearances, -1)).toBe(3.5)
    expect(appearanceSeekSeconds(appearances, 1.5)).toBe(3.5)
    // 没有出现记录 / 时间非法 → undefined（调用方不动播放条，别跳 0）
    expect(appearanceSeekSeconds([], 0)).toBeUndefined()
    expect(appearanceSeekSeconds(undefined, 0)).toBeUndefined()
    expect(appearanceSeekSeconds([{ range: { start: Number.NaN, end: 1 } }], 0)).toBeUndefined()
  })

  /**
   * 「有没有时间线」的三种来源都要带上原视频路径 —— 语义时间线是透传节点，
   * 从上游解析时也靠这条把视频带进 dive。
   */
  it('resolveSemanticTimelineViewTarget 顺带带上 sourceRelativePath', () => {
    const video = 'Assets/logo/QQ20261010-204459.mp4'
    expect(
      resolveSemanticTimelineViewTarget(
        { params: { semanticTimelineId: 'stl.8f3a895ecf', sourceRelativePath: video } },
        null
      )
    ).toEqual({ id: 'stl.8f3a895ecf', sourceRelativePath: video })
    const doc = JSON.stringify({ id: 'stl.aaa', source: { assetId: 'a' } })
    expect(
      resolveSemanticTimelineViewTarget(
        { params: { timelineJson: doc, sourceRelativePath: video } },
        null
      )
    ).toEqual({ id: 'stl.aaa', json: doc, sourceRelativePath: video })
    // 既没 id 也没 JSON → null（调用方据此回落上游 / 给提示，而不是编假 id）
    expect(resolveSemanticTimelineViewTarget({ params: { timelineJson: '' } }, null)).toBeNull()
  })

  it('非法 / 不相干的 JSON 不算时间线目标', () => {
    expect(
      resolveSemanticTimelineViewTarget({ params: { timelineJson: '{oops' } }, null)
    ).toBeNull()
    // 有 id 但没有 source → 不是时间线文档
    expect(
      resolveSemanticTimelineViewTarget({ params: { timelineJson: '{"id":"stl.x"}' } }, null)
    ).toBeNull()
    expect(
      resolveSemanticTimelineViewTarget({ params: { timelineJson: '{"id":"other"}' } }, null)
    ).toBeNull()
    expect(
      resolveSemanticTimelineViewTarget({ params: { semanticTimelineId: 'not-an-id' } }, null)
    ).toBeNull()
  })

  it('输出摘要给 id 与规模（供卡片预览，不塞整份 JSON）', () => {
    const summary = semanticTimelineSummaryText(semanticTimelineValue(makeDoc()))
    expect(summary).toContain('stl.view0001')
    expect(summary).toContain('镜头 9')
    expect(summary).toContain('话语 8')
    expect(summary).toContain('实体 16')
    expect(summary).toContain('事件 1')
    expect(summary).toContain('节拍 1')
    // 摘要必须短（卡片上是一行）
    expect(summary.length).toBeLessThan(120)
    // 非该 kind → 空串
    expect(semanticTimelineSummaryText({ kind: 'text', text: 'hi' } as never)).toBe('')
    expect(semanticTimelineSummaryText(undefined)).toBe('')
  })
})
