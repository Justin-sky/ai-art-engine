import { describe, expect, it } from 'vitest'
import { joinPartNames, togglePartName } from '../src/renderer/src/features/graph/model/meshOpParts'

describe('按部件操作的部件名选择', () => {
  it('切换入选状态：追加 / 移除 / 去重 / trim', () => {
    expect(togglePartName([], 'head')).toEqual(['head'])
    expect(togglePartName(['head'], 'head')).toEqual([])
    expect(togglePartName(['head'], '  torso  ')).toEqual(['head', 'torso'])
    expect(togglePartName(['head', 'torso'], 'head')).toEqual(['torso'])
    // 空白名不改变选择
    expect(togglePartName(['head'], '   ')).toEqual(['head'])
  })

  it('不修改传入数组（保持响应式只读语义）', () => {
    const list = ['head']
    togglePartName(list, 'torso')
    expect(list).toEqual(['head'])
  })

  it('回写指令框的文本与卡片解析口径一致（逗号分隔）', () => {
    expect(joinPartNames([])).toBe('')
    expect(joinPartNames(['head'])).toBe('head')
    expect(joinPartNames(['head', 'torso'])).toBe('head, torso')
    // 卡片按 /[,，\n]/ 拆分，join 出来的文本再解析回同一列表
    expect(
      joinPartNames(['head', 'torso'])
        .split(/[,，\n]/)
        .map((s) => s.trim())
    ).toEqual(['head', 'torso'])
  })
})
