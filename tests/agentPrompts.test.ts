import { describe, expect, it } from 'vitest'
import {
  buildAgentReviewPack,
  parseAgentVerdict,
  pickAgentPrompt
} from '../src/shared/graph'

describe('buildAgentReviewPack', () => {
  const pack = buildAgentReviewPack({
    checkZh: '- 数量与格式',
    checkEn: '- Count & format',
    targetZh: '变体矩阵',
    targetEn: 'Variant matrix',
    contextZh: '@1 为产品图，@2 为待审核变体。',
    contextEn: '@1 is the product image and @2 is the variants under review.'
  })

  it('embeds target, check, and protocol in system prompt', () => {
    expect(pack.systemPromptZh).toContain('审核对象：变体矩阵')
    expect(pack.systemPromptZh).toContain('- 数量与格式')
    expect(pack.systemPromptZh).toContain('## 结论: PASS')
    expect(pack.systemPromptEn).toContain('Review target: Variant matrix')
    expect(pack.systemPromptEn).toContain('## 结论: PASS')
  })

  it('embeds context in instruction', () => {
    expect(pack.instructionZh).toContain('@1 为产品图')
    expect(pack.instructionEn).toContain('@1 is the product image')
  })

  it('honors framework/pass-standard overrides', () => {
    const custom = buildAgentReviewPack({
      checkZh: 'c',
      checkEn: 'c',
      targetZh: 't',
      targetEn: 't',
      contextZh: 'x',
      contextEn: 'x',
      frameworkZh: '自定义框架',
      passStandardZh: '自定义标准'
    })
    expect(custom.systemPromptZh).toContain('自定义框架')
    expect(custom.systemPromptZh).toContain('自定义标准')
    expect(custom.systemPromptZh).not.toContain('资深质检审核员')
  })
})

describe('pickAgentPrompt', () => {
  const pack = {
    systemPromptZh: '系统',
    systemPromptEn: 'System',
    instructionZh: '指令',
    instructionEn: 'Instruction'
  }

  it('selects zh vs en and system vs instruction', () => {
    expect(pickAgentPrompt(pack, 'zh-CN', 'systemPrompt')).toBe('系统')
    expect(pickAgentPrompt(pack, 'en-US', 'systemPrompt')).toBe('System')
    expect(pickAgentPrompt(pack, 'zh-CN', 'instruction')).toBe('指令')
    expect(pickAgentPrompt(pack, 'en-US', 'instruction')).toBe('Instruction')
  })

  it('defaults non-en locale to zh', () => {
    expect(pickAgentPrompt(pack, undefined, 'systemPrompt')).toBe('系统')
    expect(pickAgentPrompt(pack, 'fr-FR', 'systemPrompt')).toBe('系统')
  })
})

describe('parseAgentVerdict', () => {
  it('parses PASS / FAIL / missing verdict', () => {
    expect(parseAgentVerdict('## 结论: PASS')).toEqual({ result: 'PASS', reason: '' })
    expect(parseAgentVerdict('## 结论: FAIL (原因: 主体不一致)')).toEqual({
      result: 'FAIL',
      reason: '主体不一致'
    })
    expect(parseAgentVerdict('没有结论')).toBeNull()
  })

  it('parses FAIL reasons on the next line and full-width punctuation', () => {
    expect(parseAgentVerdict('## 结论: FAIL\n原因：主体不一致')).toEqual({
      result: 'FAIL',
      reason: '主体不一致'
    })
    expect(parseAgentVerdict('## 结论：FAIL（原因：主光跳变）')).toEqual({
      result: 'FAIL',
      reason: '主光跳变'
    })
    expect(
      parseAgentVerdict('## 审核清单\n- 完整性：5/5\n\n## 结论: FAIL\n原因：缺少字段')
    ).toEqual({ result: 'FAIL', reason: '缺少字段' })
  })
})
