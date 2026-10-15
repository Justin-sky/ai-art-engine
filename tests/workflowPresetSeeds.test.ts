import { describe, expect, it } from 'vitest'
import {
  AI_WORKFLOW_PRESET_IDS,
  getAiWorkflowPresetPlan,
  listNodeTypes,
  parseComicPage
} from '../src/shared/graph'
import { nodeTypesOfPlan } from '../src/shared/workflowMarket'

/**
 * 内置预设必须是**可用的工作流** —— 它们是工作流市场的首批种子内容。
 *
 * 这条不变量一次守护两件事：
 * - 市场上线的第一批卡片确实能落盘（不是空壳）
 * - 预设引用的节点类型都在注册表里（否则市场内容一上线就「不可用」）
 */
describe('内置预设作为市场种子内容的基本条件', () => {
  const ids = AI_WORKFLOW_PRESET_IDS.filter((id) => id !== 'custom')

  it('每个非 custom 预设都有固化拓扑', () => {
    const missing = ids.filter((id) => !getAiWorkflowPresetPlan(id))
    expect(missing, `没有固化拓扑：${missing.join(', ')}`).toEqual([])
  })

  it('每个预设的节点类型都在注册表里（否则该预设不可用）', () => {
    const known = new Set(listNodeTypes().map((def) => def.typeId))
    expect(known.size).toBeGreaterThan(30)
    for (const id of ids) {
      const plan = getAiWorkflowPresetPlan(id)
      const unknown = nodeTypesOfPlan(plan!).filter((typeId) => !known.has(typeId))
      expect(unknown, `${id} 引用了未注册类型`).toEqual([])
    }
  })

  it('getAiWorkflowPresetPlan 返回副本（市场卡片不得改到预设注册表）', () => {
    const first = getAiWorkflowPresetPlan('shortDrama')!
    const before = first.nodes.length
    first.nodes.push({ key: 'polluted', typeId: 'note.text' })
    // 再取一次必须还是原来的节点数，否则说明返回的是内部引用
    expect(getAiWorkflowPresetPlan('shortDrama')!.nodes.length).toBe(before)
  })

  it('comicPublish 包含角色定妆锚点、多页分镜连线与预置的漫画页版式/斜切/特效/台词气泡', () => {
    const plan = getAiWorkflowPresetPlan('comicPublish')!
    const pages = plan.nodes.filter((n) => n.typeId === 'comic.page')
    expect(pages).toHaveLength(3)

    const anchorEdges = plan.edges.filter((e) => e.from === 'charAnchor' && e.toPort === 'in-image')
    expect(anchorEdges).toHaveLength(10)

    for (const pageNode of pages) {
      const parsed = parseComicPage(String(pageNode.params?.comicPage ?? ''))
      expect(parsed, pageNode.key).toBeTruthy()
      expect(parsed!.panels.length).toBeGreaterThanOrEqual(3)
      // 初始分格不绑死本地图片，等上游分镜图生成后按阅读顺序自动填入
      expect(parsed!.panels.every((p) => !p.imageUrl)).toBe(true)
      expect(parsed!.panels.some((p) => p.bubbles.length > 0)).toBe(true)
    }

    const page2 = parseComicPage(String(pages[1]!.params?.comicPage ?? ''))!
    expect(page2.panels.some((p) => Array.isArray(p.cornerOffsets))).toBe(true)
    expect(
      page2.panels.some((p) => p.effectType === 'speed-lines' || p.effectType === 'focus-lines')
    ).toBe(true)
  })
})
