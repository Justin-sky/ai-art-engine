import { describe, expect, it } from 'vitest'
import {
  buildInstructionFinalPromptPreview,
  resolveInstructionFinalPreviewKind
} from '../src/shared/graph/execute/context'
import { listInstructionPresets } from '../src/shared/graph/instructionPresets'
import {
  parseDecisionQuestionsDetailed,
  stringifyDecisionQuestions
} from '../src/shared/decisionQuestionSchema'

/**
 * 「决策判定」（decisions.judge）节点指令窗口的预览契约。
 *
 * 与策划案踩过的是同一个坑：InstructionFinalPreviewKind 里没有决策判定，
 * 而 decisions.judge 既不匹配剧本也不匹配图片，于是 resolveInstructionFinalPreviewKind
 * 兜底成 'screenplay' —— 指令窗口会把**剧本规范**（「第一行必须是剧本名」等）
 * 当成「最终提示词」展示，用户以为决策模型收到的是那套东西。
 *
 * 决策判定其实没有提示词模板：发给模型的 state 与问题定义就是用户写的那份内容。
 */

const decisionsNode = { typeId: 'decisions.judge', assetType: undefined }
const screenplayNode = { typeId: 'asset.screenplay', assetType: 'screenplay' as const }

/** 剧本系统提示词独有的输出格式约束 */
const SCREENPLAY_MARK = '第一行必须是剧本名'

const QUESTIONS = [
  'is_ok | noul | 这个方案成立吗？ | 满足设定与逻辑 / 存在明显漏洞',
  'pick | choice | 选哪个方案？ | a:方案A; b:方案B'
].join('\n')

function preview(
  instruction: string,
  sources = [] as Array<{ index: number; title: string; text: string }>
): string {
  return buildInstructionFinalPromptPreview({
    kind: resolveInstructionFinalPreviewKind(decisionsNode, null),
    instructionRaw: instruction,
    sources,
    locale: 'zh-CN'
  })
}

describe('指令窗口最终提示词预览：决策判定', () => {
  it('decisions.judge 解析为 decisions，不再兜底成 screenplay', () => {
    expect(resolveInstructionFinalPreviewKind(decisionsNode, null)).toBe('decisions')
    // 剧本节点保持原样，别被这次改动波及
    expect(resolveInstructionFinalPreviewKind(screenplayNode, null)).toBe('screenplay')
  })

  it('预览就是用户写的问题清单，不套剧本规范 / 不加系统提示词区块', () => {
    const text = preview(QUESTIONS)
    expect(text).toContain('is_ok | noul')
    expect(text).toContain('pick | choice')
    expect(text).not.toContain(SCREENPLAY_MARK)
    // 决策请求没有 system 提示词，不应出现「系统提示词」区块
    expect(text).not.toContain('系统提示词')
  })

  it('@ 引用被展开成上游正文：预览 = 真正参与判定的状态', () => {
    const text = preview('is_ok | noul | @1 这个方案成立吗？ | 是 / 否', [
      { index: 1, title: '剧本', text: '今天天气怎样' }
    ])
    expect(text).toContain('今天天气怎样')
    expect(text).not.toContain('@1')
  })

  it('未写 @ 时上游正文仍会自动补进预览（与执行路径同口径）', () => {
    const text = preview('is_ok | noul | 成立吗？ | 是 / 否', [
      { index: 1, title: '剧本', text: '今天天气怎样' }
    ])
    expect(text).toContain('今天天气怎样')
  })

  it('决策判定没有指令预设（问题是结构化填的，「加一条」已起模板作用）', () => {
    expect(listInstructionPresets('decisions')).toEqual([])
  })

  /**
   * 表单模式的预览契约：它必须与文本模式**同源**。
   *
   * 实现方式是表单先序列化成同一份 DSL 再走同一套预览构建（@n 展开、decisions 种类），
   * 所以这里断言「表单 → DSL → 预览」与直接对 DSL 预览逐字节相同。
   * 若以后有人给表单另写一套预览，这条会红。
   */
  it('表单模式与文本模式的预览结果完全一致（表单先序列化成同一份 DSL）', () => {
    const sources = [{ index: 1, title: '剧本', text: '今天天气怎样' }]
    const previewForText = (instructionRaw: string): string =>
      buildInstructionFinalPromptPreview({
        kind: resolveInstructionFinalPreviewKind(decisionsNode, null),
        instructionRaw,
        sources,
        locale: 'zh-CN'
      })

    // 文本模式：用户手写的原文
    const textMode = previewForText(QUESTIONS)

    // 表单模式：从同一份原文解析出结构化问题，再序列化回 DSL 去预览
    const drafts = parseDecisionQuestionsDetailed(QUESTIONS).questions
    const formMode = previewForText(stringifyDecisionQuestions(drafts))

    expect(formMode).toBe(textMode)
  })

  it('表单里改内容后预览跟着变（序列化产物进入预览，而不是用旧原文）', () => {
    const sources = [{ index: 1, title: '剧本', text: '今天天气怎样' }]
    const drafts = parseDecisionQuestionsDetailed(QUESTIONS).questions
    drafts[0] = { ...drafts[0]!, instructions: '这个方案真的成立吗？' }
    const preview = buildInstructionFinalPromptPreview({
      kind: resolveInstructionFinalPreviewKind(decisionsNode, null),
      instructionRaw: stringifyDecisionQuestions(drafts),
      sources,
      locale: 'zh-CN'
    })
    expect(preview).toContain('这个方案真的成立吗？')
    expect(preview).toContain('今天天气怎样')
  })
})
