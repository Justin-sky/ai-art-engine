import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 卡片双击的分发顺序契约（GraphNodeCard.onPreviewDblClick）。
 *
 * 曾经的缺陷：策划案（asset.gameSystem）节点双击弹出的是正文记事本，而不是生成指令框。
 * 原因是分发里只有 `instructionKind === 'screenplay'` 这一条「有生成面板的文本资产」
 * 分支，策划案没有对应分支，于是一路落到下方「预览区已有正文 → 打开记事本」——
 * 可策划案节点**天生就有正文预览**，永远抢不过记事本那一条。
 *
 * 这里按源码顺序断言：策划案分支必须存在，且排在记事本兜底之前。
 * 纯文本溯源是刻意的——这段是深埋在 4000 行卡片组件里的 if 链，
 * 用渲染级测试去覆盖会拖进整张图画布；顺序本身才是回归点。
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

describe('卡片双击分发：策划案生成', () => {
  const body = dblClickBody()

  it('策划案与剧本共用一个「展开生成指令面板」分支', () => {
    expect(body).toMatch(
      /if \(instructionKind\.value === 'screenplay' \|\| instructionKind\.value === 'gameSystem'\) \{\s*\n\s*instructionOpen\.value = !instructionOpen\.value/
    )
  })

  it('该分支排在「预览区已有正文 → 打开记事本」兜底之前（否则正文预览会把双击抢走）', () => {
    const generatePanelAt = body.indexOf("instructionKind.value === 'gameSystem'")
    // 定位真正的兜底：那条以「预览区已有正文」为条件的判断之后紧跟的 textOpen
    const fallbackGuardAt = body.indexOf('textPreview.value &&')
    expect(generatePanelAt).toBeGreaterThan(-1)
    expect(fallbackGuardAt).toBeGreaterThan(-1)
    const fallbackEmitAt = body.indexOf("emit('textOpen', props.node.id)", fallbackGuardAt)
    expect(fallbackEmitAt).toBeGreaterThan(fallbackGuardAt)
    expect(generatePanelAt).toBeLessThan(fallbackGuardAt)
  })

  it('预览区双击提示也按「开生成面板」展示，与分发一致', () => {
    expect(card).toMatch(
      /if \(instructionKind\.value === 'screenplay' \|\| instructionKind\.value === 'gameSystem'\) \{\s*\n\s*return t\('graph\.generateNode\.instructionHint'\)/
    )
  })
})
