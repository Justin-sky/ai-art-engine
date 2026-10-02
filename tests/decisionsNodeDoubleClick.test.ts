import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 卡片双击的分发顺序契约（GraphNodeCard.onPreviewDblClick）。
 *
 * 曾经的缺陷：决策判定（decisions.judge）节点双击弹出的是一张只读的正文记事本，
 * 而不是可编辑的「判定问题」面板 —— 判定节点天生的正文预览（结论摘要）永远
 * 抢在最后那条「预览区已有正文 → 打开记事本」兜底之前把双击吃掉，
 * 而记事本只回正文、编辑不了问题清单。
 *
 * 这里按源码顺序断言：决策分支必须存在、必须排在记事本兜底之前，
 * 且预览区双击提示与分发保持一致。纯文本溯源是刻意的 —— 这段是深埋在 4000 行
 * 卡片组件里的 if 链，顺序本身才是回归点（同 gameSystemNodeDoubleClick.test.ts）。
 */

const CARD_PATH = join(process.cwd(), 'src/renderer/src/components/GraphNodeCard.vue')
const card = readFileSync(CARD_PATH, 'utf8')

/** 双击分发函数体（到下一个顶层函数定义为止） */
function dblClickBody(): string {
  const start = card.indexOf('function onPreviewDblClick()')
  expect(start).toBeGreaterThan(-1)
  const rest = card.slice(start + 10)
  const nextFn = rest.search(/\n(?:async )?function [a-zA-Z]/)
  return nextFn > 0 ? rest.slice(0, nextFn) : rest
}

describe('卡片双击分发：决策判定', () => {
  const body = dblClickBody()

  it('决策节点走「展开判定问题面板」分支', () => {
    expect(body).toMatch(
      /if \(props\.node\.typeId === 'decisions\.judge'\) \{\s*\n\s*instructionOpen\.value = !instructionOpen\.value/
    )
  })

  it('该分支排在「预览区已有正文 → 打开记事本」兜底之前', () => {
    const decisionsAt = body.indexOf("props.node.typeId === 'decisions.judge'")
    const fallbackGuardAt = body.indexOf('textPreview.value &&')
    expect(decisionsAt).toBeGreaterThan(-1)
    expect(fallbackGuardAt).toBeGreaterThan(-1)
    expect(decisionsAt).toBeLessThan(fallbackGuardAt)
  })

  it('预览区双击提示也按「开判定问题面板」展示，与分发一致', () => {
    expect(card).toMatch(
      /if \(props\.node\.typeId === 'decisions\.judge'\) \{\s*\n\s*return t\('graph\.generateNode\.instructionHint'\)/
    )
  })

  it('卡片渲染决策面板，且面板只写 decisionQuestions 与决策模型', () => {
    // 面板标签自带 v-if 守卫（模板里标签先于属性，按同一元素的区间断言）
    expect(card).toMatch(
      /<DecisionsQuestionsPanel\s+v-if="instructionOpen && node\.typeId === 'decisions\.judge'/
    )

    const panel = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/DecisionsQuestionsPanel.vue'),
      'utf8'
    )
    expect(panel).toMatch(/decisionQuestions: questions\.value/)
    // 模型选择器按 decisions 模态加载，避免列出文本模型
    expect(panel).toMatch(/loadGenerateModelOptions\('decisions'/)
  })

  /**
   * 「有可选模型时不要显示去设置里配置的提示」。
   *
   * 两处渲染这个提示的地方都必须以「列表为空」为前置条件，
   * 并用 emptyReason 说明成因（否则只会干瞪一个空下拉）。
   */
  it('模型列表非空时，不显示任何「请先在设置…」提示', () => {
    const panel = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/DecisionsQuestionsPanel.vue'),
      'utf8'
    )
    const inspector = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/DecisionsJudgeInspector.vue'),
      'utf8'
    )
    // 卡内面板：提示以 !modelOptions.length 为前置
    expect(panel).toMatch(/v-if="!modelOptions\.length && emptyHint"/)
    // Inspector：提示以 modelOptions.length === 0 为前置
    expect(inspector).toMatch(/v-if="modelOptions\.length === 0"/)
    // emptyHint 必须由 emptyReason 驱动，而不是无条件回落到「去设置」文案
    for (const src of [panel, inspector]) {
      expect(src).toMatch(/if \(!reason \|\| reason === 'unknown'\)/)
      expect(src).toMatch(/modelEmpty\.\$\{reason\}/)
    }
  })

  it('每次展开/选中都清掉设置短缓存后重读，避免缓存过期仍显示未配置', () => {
    const panel = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/DecisionsQuestionsPanel.vue'),
      'utf8'
    )
    const inspector = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/DecisionsJudgeInspector.vue'),
      'utf8'
    )
    for (const src of [panel, inspector]) {
      expect(src).toMatch(/invalidateGenerateModelSettingsCache\(\)/)
    }
  })

  /**
   * 样式契约：判定问题面板必须复用卡片那张浮层（绝对定位到节点下方 + 绿框 + 投影），
   * 曾经的缺陷是自绘成卡内 inline 面板 —— 位置、边框、投影全和其它节点的
   * 生成指令面板不一致。这里锁定「用共享类名」而不是「自己写定位」。
   */
  it('复用卡片的 instruction-panel 浮层类名，不自行定位', () => {
    const panel = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/DecisionsQuestionsPanel.vue'),
      'utf8'
    )
    expect(panel).toMatch(/class="instruction-panel"/)
    expect(panel).toMatch(/class="instruction-panel-label"/)
    // 共享类名由卡片 scoped 样式提供，父级作用域会落到子组件根元素上
    expect(card).toMatch(/\.instruction-panel \{[\s\S]{0,220}position: absolute;/)
    expect(card).toMatch(/\.instruction-panel-label \{/)
    // 面板自己不应再声明定位（否则会与共享浮层打架）
    expect(panel).not.toMatch(/position: absolute/)
  })
})
