import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isReactive, ref } from 'vue'
import { SEMANTIC_TIMELINE_SCHEMA, applySemanticEdit } from '../src/shared/semanticTimeline'
import type { SemanticTimeline } from '../src/shared/semanticTimeline'
import { semanticTimelineSavePayload } from '../src/renderer/src/features/graph/model/semanticTimelineSave'

/**
 * 「语义分析节点 → 修改参数 → 落盘」这条链路的回归守卫。
 *
 * 实测踩到：dive 里的文档是 `ref<SemanticTimeline>` 的响应式代理，`applySemanticEdit` 只做
 * `{ ...doc }` / `doc.shots.map(...)` 浅拷贝 —— 代理会留在产物里。代理过 contextBridge /
 * `ipcRenderer.invoke` 要结构化克隆，Chromium 直接报 `An object could not be cloned.`，
 * 界面显示「保存失败：An object could not be cloned.」，改多少次都存不下去。
 */
const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8')

function makeShot(id: string): NonNullable<SemanticTimeline['shots']>[number] {
  const range = { start: 0, end: 2, startFrame: 0, endFrame: 60 }
  return {
    id,
    range,
    sourceSegment: { start: 0, end: 2 },
    keyframes: { first: 'evidence/keyframes/0.jpg' },
    camera: { shotSize: 'medium', angle: 'eye_level', motion: 'static' },
    visual: { description: '主播举着商品', style: 'clean', lighting: 'soft' },
    subjects: [{ entityId: 'ent.host', name: '主播', action: '举商品' }],
    dialogueIds: ['dlg.1'],
    textLayerIds: [],
    origin: 'analysis'
  }
}

function makeDoc(): SemanticTimeline {
  return {
    id: 'stl.save0001',
    schema: SEMANTIC_TIMELINE_SCHEMA,
    source: { assetId: 'asset-1', fps: 30, duration: 4, width: 1080, height: 1920 },
    evidence: {
      mediaFacts: 'evidence/mediaFacts.json',
      shots: 'evidence/shots.json',
      utterances: 'evidence/utterances.json',
      entities: 'evidence/entities.json',
      ocr: 'evidence/ocr.json',
      hashes: { shots: '1', utterances: '1', entities: '1', ocr: '0' }
    },
    entities: [
      {
        id: 'ent.host',
        kind: 'person',
        name: '主播',
        appearances: [
          { shotId: 'shot.1', range: { start: 0, end: 2, startFrame: 0, endFrame: 60 } }
        ],
        pixelEditable: true
      }
    ],
    events: [
      {
        id: 'ev.1',
        timeRange: { start: 0, end: 2, startFrame: 0, endFrame: 60 },
        type: 'story',
        label: 'hook',
        description: '开场',
        importance: 0.8,
        entities: ['ent.host'],
        evidence: ['shot.1'],
        intents: [],
        confidence: 0.9,
        origin: 'analysis'
      }
    ],
    beats: [
      {
        id: 'bt.1',
        label: 'hook',
        timeRange: { start: 0, end: 2, startFrame: 0, endFrame: 60 }
      }
    ],
    intents: [],
    tracks: [],
    shots: [makeShot('shot.1'), makeShot('shot.2')],
    dialogue: [
      {
        id: 'dlg.1',
        range: { start: 0.2, end: 1.8, startFrame: 6, endFrame: 54 },
        text: '通勤天天用的好东西',
        sourceText: '通勤天天用的好东西',
        speaker: 'spk.1',
        granularity: 'sentence',
        confidence: 0.9,
        origin: 'analysis'
      }
    ],
    baseline: {
      shots: { 'shot.1': 'a' },
      dialogue: { 'dlg.1': 'b' },
      createdAt: '2026-01-01T00:00:00.000Z'
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  } as SemanticTimeline
}

/** dive 视图里的文档：`timeline.value` 就是这样一个深层代理 */
function liveDoc(): SemanticTimeline {
  return ref(makeDoc()).value
}

describe('语义时间线落盘：代理必须先拍成纯数据', () => {
  it('改动后的文档经 IPC 载荷可结构化克隆，内容一字不差', () => {
    const live = liveDoc()
    // 自检：这确实是响应式代理（否则本用例会退化成没覆盖到真正的问题）
    expect(isReactive(live)).toBe(true)

    const edited = applySemanticEdit(live, {
      op: 'shot.update',
      target: 'shot.1',
      patch: { visual: { ...live.shots![0]!.visual, description: '主播举着商品微笑' } }
    })

    const payload = semanticTimelineSavePayload(edited)
    // 就是这一步以前抛 DataCloneError: An object could not be cloned.
    expect(() => structuredClone(payload)).not.toThrow()
    // 载荷必须是纯数据，内容与界面上的文档一致
    expect(isReactive(payload)).toBe(false)
    expect(payload).toEqual(JSON.parse(JSON.stringify(edited)))
    expect(payload.shots?.[0]?.visual.description).toBe('主播举着商品微笑')
    expect(payload.edits?.at(-1)?.op).toBe('shot.update')
    // 没被改的镜头也要原样带过去（浅拷贝最容易在这里漏代理）
    expect(payload.shots?.[1]?.id).toBe('shot.2')
  })

  it('基线：裸代理确实过不了结构化克隆（问题本身，不是猜测）', () => {
    const live = liveDoc()
    expect(() => structuredClone(live)).toThrowError(/could not be cloned/)
    expect(() => structuredClone(semanticTimelineSavePayload(live))).not.toThrow()
  })

  it('两处落盘调用都走语义载荷（防止有人绕过 helper 直连 IPC）', () => {
    const dive = read('src/renderer/src/components/dive/EditorDiveSemanticTimelineView.vue')
    const caps = read('src/renderer/src/features/graph/model/semanticGraphCapabilities.ts')
    for (const src of [dive, caps]) {
      expect(src).toMatch(/semanticSaveTimeline\(\s*semanticTimelineSavePayload\(doc\)\s*\)/)
      // 裸的 `window.studio.semanticSaveTimeline(x)` 一律不许留
      expect(src).not.toMatch(/semanticSaveTimeline\((?!\s*semanticTimelineSavePayload)/)
    }
  })
})
