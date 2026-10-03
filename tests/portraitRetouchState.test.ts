import { describe, expect, it } from 'vitest'
import {
  PORTRAIT_PARAM_SPECS,
  PORTRAIT_PRESETS,
  PORTRAIT_STROKE_LIMIT,
  applyPortraitPreset,
  buildPortraitAiPrompt,
  changedPortraitParamCount,
  defaultPortraitRetouch,
  exportPortraitPreset,
  importPortraitPreset,
  normalizePortraitRetouch,
  normalizePortraitStrokes,
  portraitRetouchToNodePatch,
  portraitSpecsForGroup,
  portraitStrokesForTool,
  readPortraitRetouchFromNode
} from '../src/shared/graph/portraitRetouch'

/**
 * 人像处理参数契约（src/shared/graph/portraitRetouch.ts）。
 *
 * 这一层是 UI / 执行器 / 批量 / 预设的唯一真相来源，所以重点锁三件事：
 * 1. 默认值只从规格表来（不允许 UI 与执行器各写一份默认值）；
 * 2. 归一化必须把脏数据（缺字段、越界、枚举乱填、颜色非法）夹回来而不抛错；
 * 3. 预设导入导出可往返，且拒绝「来自更新版本」的预设。
 */

const ZERO_STATE = () =>
  normalizePortraitRetouch(
    Object.fromEntries(
      PORTRAIT_PARAM_SPECS.map((spec) => [spec.key, spec.kind === 'number' ? 0 : spec.default])
    )
  )

describe('portraitRetouch 参数契约', () => {
  it('默认值全部来自规格表，且每个参数都有 i18n labelKey', () => {
    const state = defaultPortraitRetouch()
    for (const spec of PORTRAIT_PARAM_SPECS) {
      expect(spec.labelKey.length).toBeGreaterThan(0)
      expect(state[spec.key]).toBe(spec.default)
    }
    expect(state.v).toBe(1)
  })

  it('参数 key 不重复（重复会让面板渲染两次、归一化互相覆盖）', () => {
    const keys = PORTRAIT_PARAM_SPECS.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('归一化夹取越界数值并按步长取整', () => {
    const state = normalizePortraitRetouch({ skinSmoothing: 999, exposure: -999, sharpness: 12.4 })
    expect(state.skinSmoothing).toBe(100)
    expect(state.exposure).toBe(-100)
    expect(state.sharpness).toBe(12)
  })

  it('归一化丢弃非法枚举与颜色，回落到默认', () => {
    const state = normalizePortraitRetouch({
      lutId: 'not-a-lut',
      bgMode: 'explode' as never,
      bgColor: 'red',
      makeupPresetId: 'nude'
    })
    expect(state.lutId).toBe('none')
    expect(state.bgMode).toBe('keep')
    expect(state.bgColor).toBe('#ffffff')
    expect(state.makeupPresetId).toBe('nude')
  })

  it('归一化补齐缺失字段并忽略非数值脏值', () => {
    const state = normalizePortraitRetouch({ skinSmoothing: 'x' as never, faceSlim: null as never })
    expect(state.skinSmoothing).toBe(30)
    expect(state.faceSlim).toBe(0)
  })

  it('读节点参数与写回 patch 走同一条归一化', () => {
    const fromNode = readPortraitRetouchFromNode({ portraitRetouch: { skinWhiten: 250 } })
    expect(fromNode.skinWhiten).toBe(100)
    const patch = portraitRetouchToNodePatch({ ...fromNode, contrast: 500 } as never)
    expect(patch.portraitRetouch.contrast).toBe(100)
  })

  it('统计已改动参数数量（卡片角标「已修 N 项」）', () => {
    expect(changedPortraitParamCount(defaultPortraitRetouch())).toBe(0)
    const two = { ...defaultPortraitRetouch(), faceSlim: 40, makeupPresetId: 'nude' } as never
    expect(changedPortraitParamCount(two)).toBe(2)
  })

  it('按分组取规格（面板按组渲染）', () => {
    const face = portraitSpecsForGroup('face')
    expect(face.length).toBeGreaterThan(10)
    expect(face.every((spec) => spec.group === 'face')).toBe(true)
    expect(portraitSpecsForGroup('color').some((spec) => spec.key === 'lutId')).toBe(true)
  })

  it('应用预设：以默认值为底叠加覆盖，且不受传入脏底影响', () => {
    const state = applyPortraitPreset('bride', { skinSmoothing: -50, lutId: 'bogus' as never })
    expect(state.makeupPresetId).toBe('bride')
    expect(state.skinSmoothing).toBeGreaterThan(40)
    expect(state.lutId).toBe('warmFilm')
    expect(PORTRAIT_PRESETS.some((p) => p.id === 'bride')).toBe(true)
  })

  it('未知预设 id 退化为默认值（不抛错）', () => {
    const state = applyPortraitPreset('nope')
    expect(state).toEqual(defaultPortraitRetouch())
  })

  it('预设导出可原样导入（含笔画）', () => {
    const state = { ...ZERO_STATE(), faceSlim: 30, makeupPresetId: 'portrait' } as never
    const strokes = normalizePortraitStrokes([
      {
        tool: 'liquify',
        mode: 'push',
        size: 0.1,
        hardness: 60,
        strength: 50,
        points: [{ x: 0.5, y: 0.5, dx: 0.02, dy: 0 }]
      }
    ])
    const text = exportPortraitPreset('我的写真', state, strokes)
    const parsed = importPortraitPreset(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.name).toBe('我的写真')
    expect(parsed.state.faceSlim).toBe(30)
    expect(parsed.strokes).toHaveLength(1)
    expect(parsed.strokes[0].mode).toBe('push')
  })

  it('预设导入区分「不是 JSON」「不是本应用预设」「版本过新」', () => {
    expect(importPortraitPreset('{oops')).toEqual({ ok: false, reason: 'invalid-json' })
    expect(importPortraitPreset(JSON.stringify({ kind: 'other' }))).toEqual({
      ok: false,
      reason: 'not-preset'
    })
    const future = JSON.stringify({ kind: 'portrait-preset', v: 99, name: 'x', state: {} })
    expect(importPortraitPreset(future)).toEqual({ ok: false, reason: 'version' })
  })

  it('笔画归一化：丢弃非法工具、夹取笔刷参数、限制总量', () => {
    const strokes = normalizePortraitStrokes([
      { tool: 'bogus' as never, points: [{ x: 0.5, y: 0.5 }] },
      { tool: 'heal', size: 5, hardness: 999, strength: -20, points: [{ x: 2, y: -1 }] },
      { tool: 'liquify', points: [] }
    ])
    expect(strokes).toHaveLength(1)
    expect(strokes[0].size).toBe(1)
    expect(strokes[0].hardness).toBe(100)
    expect(strokes[0].strength).toBe(0)
    expect(strokes[0].points[0]).toEqual({ x: 1, y: 0 })
    // 液化缺省子模式补 push
    const liquify = normalizePortraitStrokes([{ tool: 'liquify', points: [{ x: 0.1, y: 0.1 }] }])
    expect(liquify[0].mode).toBe('push')
    // 上限截断
    const many = Array.from({ length: PORTRAIT_STROKE_LIMIT + 50 }, () => ({
      tool: 'heal' as const,
      points: [{ x: 0.5, y: 0.5 }]
    }))
    expect(normalizePortraitStrokes(many)).toHaveLength(PORTRAIT_STROKE_LIMIT)
  })

  it('按工具筛选笔画', () => {
    const strokes = normalizePortraitStrokes([
      { tool: 'heal', points: [{ x: 0.1, y: 0.1 }] },
      { tool: 'liquify', points: [{ x: 0.2, y: 0.2 }] }
    ])
    expect(portraitStrokesForTool(strokes, 'heal')).toHaveLength(1)
    expect(portraitStrokesForTool(strokes, 'bgMask')).toHaveLength(0)
  })

  it('AI 工具提示词带上「保持原样」的约束，拼接用户补充', () => {
    const erase = buildPortraitAiPrompt('erase')
    expect(erase.length).toBeGreaterThan(10)
    const withUser = buildPortraitAiPrompt('erase', '把左边路人去掉')
    expect(withUser.endsWith('把左边路人去掉')).toBe(true)
  })
})
