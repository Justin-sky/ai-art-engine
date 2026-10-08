import { describe, expect, it } from 'vitest'

/**
 * 「口播=画面」的硬约束（审查发现的静默空场）。
 *
 * 教学录制里 caption/narration 写到的每个操作都必须在画面上真的发生；
 * 而 doClick / doDblClick / doContextMenu / fillText 全靠 tutorialId 定位。
 * 旧实现：不传 tutorialId 时**静默跳过**动作、工具却回 ok —— agent 以为点了，
 * 成片里什么都没有（正是「嘴上说点了、其实没点」）。现在必须直接报错。
 *
 * 导入真实实现（不是源码字符串匹配）：这条约束曾经只被一个 toContain 守着。
 */
import { assertTutorialActionTarget } from '../src/main/services/mcpServerService'

describe('教学动作必须带 tutorialId', () => {
  it('doClick 不带 tutorialId → 报错（而不是静默跳过）', () => {
    expect(() =>
      assertTutorialActionTarget({ wantsPointer: true, fillText: null, tutorialId: undefined })
    ).toThrow(/必须同时给 tutorialId/)
  })

  it('fillText 不带 tutorialId → 报错', () => {
    expect(() =>
      assertTutorialActionTarget({ wantsPointer: false, fillText: '你好', tutorialId: undefined })
    ).toThrow(/必须同时给 tutorialId/)
  })

  it('空字符串 tutorialId 也算没给（不能拿它绕过去）', () => {
    expect(() =>
      assertTutorialActionTarget({ wantsPointer: true, fillText: null, tutorialId: '' })
    ).toThrow(/必须同时给 tutorialId/)
  })

  it('带了 tutorialId → 放行', () => {
    expect(() =>
      assertTutorialActionTarget({ wantsPointer: true, fillText: null, tutorialId: 'graph-run' })
    ).not.toThrow()
    expect(() =>
      assertTutorialActionTarget({
        wantsPointer: false,
        fillText: '文本',
        tutorialId: 'graph-instruction-input'
      })
    ).not.toThrow()
  })

  it('纯讲解步骤（没有动作、没有填写）不需要 tutorialId', () => {
    expect(() =>
      assertTutorialActionTarget({ wantsPointer: false, fillText: null, tutorialId: undefined })
    ).not.toThrow()
  })
})
