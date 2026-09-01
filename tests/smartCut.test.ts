import { describe, expect, it } from 'vitest'
import {
  applySmartCutPlan,
  buildSmartCutPrompt,
  parseSmartCutPlan,
  SMART_CUT_MAX_DURATION_SEC,
  SMART_CUT_MIN_DURATION_SEC,
  type SmartCutPlan
} from '../src/shared/graph/smartCut'
import type { ScriptTimelineClip, ScriptTimelineSource } from '../src/shared/graph/scriptTimeline'

function source(id: string, extra: Partial<ScriptTimelineSource> = {}): ScriptTimelineSource {
  return {
    id,
    title: `素材${id}`,
    origin: 'input',
    mediaKind: 'video',
    durationSec: 6,
    ...extra
  }
}

function clip(id: string, track: ScriptTimelineClip['track'], startSec: number): ScriptTimelineClip {
  return {
    id,
    track,
    sourceId: `s-${id}`,
    title: id,
    startSec,
    durationSec: 3
  }
}

const SOURCES = [
  source('a', { nodeTitle: '开场：城市黎明' }),
  source('b', { nodeTitle: '主角登场' }),
  source('c', { nodeTitle: '冲突高潮' }),
  source('d', { nodeTitle: '结尾黑场' })
]

describe('smartCut.buildSmartCutPrompt', () => {
  it('包含素材清单、时长与分镜描述', () => {
    const prompt = buildSmartCutPrompt({ sources: SOURCES, locale: 'zh-CN' })
    expect(prompt).toContain('素材a')
    expect(prompt).toContain('开场：城市黎明')
    expect(prompt).toContain('素材ID:')
    expect(prompt).toContain('"edits"')
  })

  it('英文 prompt 输出英文', () => {
    const prompt = buildSmartCutPrompt({ sources: SOURCES, locale: 'en-US' })
    expect(prompt).toContain('Available video sources')
    expect(prompt).not.toContain('你是专业短视频剪辑师')
  })

  it('超量素材截断到 maxItems', () => {
    const many = Array.from({ length: 60 }, (_, i) => source(`m${i}`))
    const prompt = buildSmartCutPrompt({ sources: many, maxItems: 10, locale: 'zh-CN' })
    expect(prompt).toContain('m1')
    expect(prompt).not.toContain('m45')
    expect(prompt).toContain('参考前 10 条')
  })
})

describe('smartCut.parseSmartCutPlan', () => {
  it('解析合法 JSON', () => {
    const text = `{
      "edits": [
        { "sourceId": "b", "durationSec": 4, "transitionType": "dissolve", "transitionSec": 0.5 },
        { "sourceId": "a" }
      ],
      "totalDurationSec": 60
    }`
    const plan = parseSmartCutPlan(text)
    expect(plan).not.toBeNull()
    expect(plan!.edits).toHaveLength(2)
    expect(plan!.edits[0]).toMatchObject({ sourceId: 'b', durationSec: 4, transitionType: 'dissolve', transitionSec: 0.5 })
    expect(plan!.edits[1]).toMatchObject({ sourceId: 'a' })
    expect(plan!.totalDurationSec).toBe(60)
  })

  it('容忍代码围栏与前后废话', () => {
    const text = '好的，方案如下：\n```json\n{"edits":[{"sourceId":"c","durationSec":99}]}\n```\n希望有帮助'
    const plan = parseSmartCutPlan(text)
    expect(plan).not.toBeNull()
    expect(plan!.edits[0]!.durationSec).toBe(SMART_CUT_MAX_DURATION_SEC)
  })

  it('丢弃非法转场 / 非法时长，未知素材保留到应用期过滤', () => {
    const plan = parseSmartCutPlan(
      '{"edits":[{"sourceId":"a","durationSec":-3,"transitionType":"explode"},{"sourceId":"zz"},{"sourceId":"b"}]}'
    )
    expect(plan!.edits).toHaveLength(3)
    expect(plan!.edits[0]).toEqual({ sourceId: 'a' })
    expect(plan!.edits[1]).toEqual({ sourceId: 'zz' })
    expect(plan!.edits[2]).toEqual({ sourceId: 'b' })
  })

  it('非法输入返回 null', () => {
    expect(parseSmartCutPlan('')).toBeNull()
    expect(parseSmartCutPlan('{"foo":1}')).toBeNull()
    expect(parseSmartCutPlan('{"edits":[]}')).toBeNull()
    expect(parseSmartCutPlan('not json at all')).toBeNull()
  })
})

describe('smartCut.applySmartCutPlan', () => {
  it('按方案重排视频轨并保留其他轨', () => {
    const clips = [
      clip('v1', 'video', 0),
      clip('v2', 'video', 3),
      clip('voice1', 'voice', 0),
      clip('music1', 'music', 0)
    ]
    const plan: SmartCutPlan = {
      edits: [
        { sourceId: 'c', durationSec: 2, transitionType: 'dissolve', transitionSec: 0.4 },
        { sourceId: 'a' }
      ]
    }
    const { clips: next, totalDurationSec } = applySmartCutPlan({ clips, sources: SOURCES, plan })
    const video = next.filter((c) => c.track === 'video')
    expect(video).toHaveLength(2)
    expect(video[0]!.sourceId).toBe('c')
    expect(video[0]!.durationSec).toBe(2)
    expect(video[0]!.transitionType).toBe('dissolve')
    expect(video[1]!.sourceId).toBe('a')
    expect(video[1]!.durationSec).toBe(6)
    expect(video[1]!.startSec).toBe(2)
    expect(totalDurationSec).toBe(8)
    // 其他轨保留
    expect(next.filter((c) => c.track === 'voice')).toHaveLength(1)
    expect(next.filter((c) => c.track === 'music')).toHaveLength(1)
  })

  it('缺失素材自动跳过，空方案返回原状', () => {
    const clips = [clip('v1', 'video', 0)]
    const missing = applySmartCutPlan({
      clips,
      sources: SOURCES,
      plan: { edits: [{ sourceId: 'not-exist' }] }
    })
    expect(missing.clips.filter((c) => c.track === 'video')).toHaveLength(0)
    expect(missing.totalDurationSec).toBe(0)

    const empty = applySmartCutPlan({ clips, sources: SOURCES, plan: { edits: [] } })
    expect(empty.clips.filter((c) => c.track === 'video')).toHaveLength(0)
  })

  it('时长收敛到安全区间', () => {
    const plan: SmartCutPlan = { edits: [{ sourceId: 'b', durationSec: 10000 }] }
    const { clips } = applySmartCutPlan({ clips: [], sources: SOURCES, plan })
    expect(clips[0]!.durationSec).toBe(SMART_CUT_MAX_DURATION_SEC)

    const planMin: SmartCutPlan = { edits: [{ sourceId: 'b', durationSec: 0.01 }] }
    const { clips: clipsMin } = applySmartCutPlan({ clips: [], sources: SOURCES, plan: planMin })
    expect(clipsMin[0]!.durationSec).toBe(SMART_CUT_MIN_DURATION_SEC)
  })

  it('none 转场不写 transition 字段', () => {
    const plan: SmartCutPlan = { edits: [{ sourceId: 'b', transitionType: 'none' }] }
    const { clips } = applySmartCutPlan({ clips: [], sources: SOURCES, plan })
    expect(clips[0]!.transitionType).toBeUndefined()
  })
})
