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

function makeDoc(id = 'stl.view0001'): SemanticTimeline {
  return {
    id,
    schema: SEMANTIC_TIMELINE_SCHEMA,
    source: {
      assetId: 'asset-1',
      duration: 3,
      fps: 30,
      width: 640,
      height: 360
    },
    entities: [],
    shots: [],
    dialogue: [],
    breakdown: {
      summary: {
        verdict: '实拍 60% + AI 视频 40%',
        shotCount: 9,
        unitCount: 2,
        localUnitCount: 1,
        confidence: 0.85,
        mode: 'vlm_fused'
      },
      productionPlan: {
        units: [
          {
            id: 'G1',
            shotIds: ['shot.1', 'shot.3'],
            bridgedInsertShotIds: ['shot.2'],
            sceneHeader: '直播间',
            totalDurationSec: 4,
            conditioningMode: 'first_last_frame',
            referenceTags: ['@图片1'],
            imagePrompt: '主播首帧',
            videoPrompt: '主播讲解'
          },
          {
            id: 'G2',
            shotIds: ['shot.5'],
            bridgedInsertShotIds: [],
            sceneHeader: '产品台',
            totalDurationSec: 2,
            conditioningMode: 'first_frame',
            referenceTags: [],
            imagePrompt: '产品首帧',
            videoPrompt: '产品旋转展示'
          }
        ],
        localUnits: [
          {
            id: 'K1',
            shotId: 'shot.4',
            mode: 'ken_burns',
            durationSec: 2,
            imagePrompt: '静帧底图'
          }
        ],
        shootingSetups: [],
        protectedMaterials: []
      }
    },
    evidence: {
      mediaFacts: { durationSec: 3, fps: 30, width: 640, height: 360, hasAudio: true },
      shotsPath: 'evidence/shots.json',
      utterancesPath: 'evidence/utterances.json',
      entitiesPath: 'evidence/entities.json',
      ocrPath: 'evidence/ocr.json',
      hashes: { shots: '9', utterances: '8', entities: '16', ocr: '2' }
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function runStateWith(outputs: Record<string, unknown>): GraphNodeRunState {
  return { status: 'done', outputs } as unknown as GraphNodeRunState
}

describe('semanticTimelineView', () => {
  it('结构化值也能取出时间线文本（这是双击失效的那个 bug）', () => {
    const doc = makeDoc()
    const text = semanticTimelineTextFromRunState(runStateWith({ out: semanticTimelineValue(doc) }))
    expect(JSON.parse(text).id).toBe('stl.view0001')
    expect(
      semanticTimelineTextFromRunState(runStateWith({ out: { kind: 'text', text: ' {"a":1} ' } }))
    ).toBe('{"a":1}')
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

  it('clampSeekSeconds：负数归零、越界夹到时长、时长未知时只保证非负', () => {
    expect(clampSeekSeconds(3.2, 35.6)).toBe(3.2)
    expect(clampSeekSeconds(-1, 35.6)).toBe(0)
    expect(clampSeekSeconds(40, 35.6)).toBe(35.6)
    expect(clampSeekSeconds(Number.NaN, 35.6)).toBe(0)
    expect(clampSeekSeconds(12.5, Number.NaN)).toBe(12.5)
    expect(clampSeekSeconds(12.5, 0)).toBe(12.5)
    expect(clampSeekSeconds(12.5, undefined)).toBe(12.5)
  })

  it('clampSidePaneWidth / sidePaneWidthFromPointer：边界与「左栏不被挤没」', () => {
    expect(clampSidePaneWidth(500)).toBe(500)
    expect(clampSidePaneWidth(100)).toBe(SIDE_PANE_MIN_WIDTH)
    expect(clampSidePaneWidth(5000)).toBe(SIDE_PANE_MAX_WIDTH)
    expect(clampSidePaneWidth(Number.NaN)).toBe(SIDE_PANE_MIN_WIDTH)
    expect(clampSidePaneWidth(900, 1200)).toBe(SIDE_PANE_MAX_WIDTH)
    expect(clampSidePaneWidth(500, 1200)).toBe(500)
    expect(clampSidePaneWidth(880, 1000)).toBe(1000 - TRACKS_PANE_MIN_WIDTH)
    expect(clampSidePaneWidth(500, 400)).toBe(SIDE_PANE_MIN_WIDTH)
    expect(clampSidePaneWidth(500, 100)).toBe(SIDE_PANE_MIN_WIDTH)
  })

  it('拖动换算：右栏贴着编辑器右边缘，拖到哪算到哪', () => {
    expect(sidePaneWidthFromPointer({ clientX: 600, editorRight: 1000, editorWidth: 1600 })).toBe(
      400
    )
    expect(sidePaneWidthFromPointer({ clientX: 1400, editorRight: 1000, editorWidth: 1600 })).toBe(
      SIDE_PANE_MIN_WIDTH
    )
    expect(sidePaneWidthFromPointer({ clientX: 0, editorRight: 1600, editorWidth: 1600 })).toBe(
      SIDE_PANE_MAX_WIDTH
    )
  })

  it('sourceAspectRatio：竖屏/横屏/方形都给出正确比例，非法值交给浏览器', () => {
    expect(sourceAspectRatio({ width: 1080, height: 1920 })).toBe('1080 / 1920')
    expect(sourceAspectRatio({ width: 1920, height: 1080 })).toBe('1920 / 1080')
    expect(sourceAspectRatio({ width: 720, height: 720 })).toBe('720 / 720')
    expect(sourceAspectRatio({})).toBeUndefined()
    expect(sourceAspectRatio({ width: 1080 })).toBeUndefined()
    expect(sourceAspectRatio({ width: 0, height: 1920 })).toBeUndefined()
    expect(sourceAspectRatio({ width: -10, height: 20 })).toBeUndefined()
    expect(sourceAspectRatio({ width: Number.NaN, height: 1080 })).toBeUndefined()
  })

  it('resolveEvidenceRef：查得到就查，查不到从 id 自身解析，绝不低于原始信息', () => {
    const ctx = {
      entities: [{ id: 'ent.person.host', name: '主播' }],
      fps: 30,
      utterances: new Map([
        ['utt.007.49529d7876', { text: '通勤天天用的好东西', start: 0.38, end: 6.02 }]
      ]),
      shots: new Map([['shot.009.875', { start: 29.17, end: 31.2 }]])
    }
    const utt = resolveEvidenceRef('utt.007.49529d7876', ctx)
    expect(utt.kind).toBe('utterance')
    expect(utt.detail).toBe('通勤天天用的好东西')
    expect(utt.startSec).toBe(0.38)
    expect(resolveEvidenceRef('shot.009.875', ctx)).toMatchObject({
      kind: 'shot',
      detail: '9',
      startSec: 29.17
    })
    expect(resolveEvidenceRef('ent.person.host', ctx).detail).toBe('主播')
  })

  it('resolveEvidenceRef：没有证据文件时也能从 id 给出序号/时间，未知 id 退回原文', () => {
    const shot = resolveEvidenceRef('shot.009.875', { fps: 30 })
    expect(shot).toMatchObject({ kind: 'shot', detail: '9', startSec: 875 / 30 })
    expect(resolveEvidenceRef('utt.007.49529d7876', {}).detail).toBe('7')
    expect(resolveEvidenceRef('ocr.003.abcdef1234', {}).detail).toBe('3')
    expect(resolveEvidenceRef('weird-id', {})).toEqual({
      raw: 'weird-id',
      kind: 'unknown',
      detail: 'weird-id'
    })
    expect(resolveEvidenceRef('', {}).kind).toBe('unknown')
  })

  it('trackLabelKey / entityKindKey：已知 id 有键，未知 id 返回 undefined（调用方原样显示）', () => {
    expect(trackLabelKey('shots')).toBe('trackShots')
    expect(trackLabelKey('units')).toBe('trackUnits')
    expect(trackLabelKey('dialogue')).toBe('trackDialogue')
    expect(trackLabelKey('overlays')).toBe('trackOverlays')
    expect(trackLabelKey('footage')).toBe('layerFootage')
    expect(trackLabelKey('entity')).toBe('layerEntity')
    expect(trackLabelKey(' Shots ')).toBe('trackShots')
    expect(trackLabelKey('lighting')).toBeUndefined()
    expect(trackLabelKey('')).toBeUndefined()

    expect(entityKindKey('person')).toBe('entityKindPerson')
    expect(entityKindKey('product')).toBe('entityKindProduct')
    expect(entityKindKey('logo')).toBe('entityKindLogo')
    expect(entityKindKey('PRODUCT')).toBe('entityKindProduct')
    expect(entityKindKey('face')).toBeUndefined()
    expect(entityKindKey('')).toBeUndefined()
  })

  it('appearanceSeekSeconds：按被点的出现跳转，越界/缺失回退第一次，无出现给 undefined', () => {
    const appearances = [
      { range: { start: 3.5, end: 7.2 } },
      { range: { start: 17.12, end: 23.75 } },
      { range: { start: 29.6, end: 31.92 } }
    ]
    expect(appearanceSeekSeconds(appearances, 0)).toBe(3.5)
    expect(appearanceSeekSeconds(appearances, 1)).toBe(17.12)
    expect(appearanceSeekSeconds(appearances, 2)).toBe(29.6)
    expect(appearanceSeekSeconds(appearances)).toBe(3.5)
    expect(appearanceSeekSeconds(appearances, 9)).toBe(3.5)
    expect(appearanceSeekSeconds(appearances, -1)).toBe(3.5)
    expect(appearanceSeekSeconds(appearances, 1.5)).toBe(3.5)
    expect(appearanceSeekSeconds([], 0)).toBeUndefined()
    expect(appearanceSeekSeconds(undefined, 0)).toBeUndefined()
    expect(appearanceSeekSeconds([{ range: { start: Number.NaN, end: 1 } }], 0)).toBeUndefined()
  })

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
    expect(resolveSemanticTimelineViewTarget({ params: { timelineJson: '' } }, null)).toBeNull()
  })

  it('非法 / 不相干的 JSON 不算时间线目标', () => {
    expect(
      resolveSemanticTimelineViewTarget({ params: { timelineJson: '{oops' } }, null)
    ).toBeNull()
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

  it('输出摘要给 id、逆向结论、规模与单元数（供卡片预览，不塞整份 JSON）', () => {
    const summary = semanticTimelineSummaryText(semanticTimelineValue(makeDoc()))
    expect(summary).toContain('stl.view0001')
    expect(summary).toContain('实拍 60% + AI 视频 40%')
    expect(summary).toContain('镜头 9')
    expect(summary).toContain('话语 8')
    expect(summary).toContain('实体 16')
    expect(summary).toContain('单元 2+1')
    expect(summary.length).toBeLessThan(120)
    expect(semanticTimelineSummaryText({ kind: 'text', text: 'hi' } as never)).toBe('')
    expect(semanticTimelineSummaryText(undefined)).toBe('')
  })
})
