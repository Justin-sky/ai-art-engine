import { describe, expect, it } from 'vitest'
import { AI_WORKFLOW_PRESET_IDS, getAiWorkflowPresetPlan, listNodeTypes } from '../src/shared/graph'
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
})
