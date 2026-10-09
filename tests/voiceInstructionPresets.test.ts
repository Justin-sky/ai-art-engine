import { describe, expect, it } from 'vitest'
import {
  listInstructionPresets,
  type InstructionPresetKind
} from '../src/shared/graph/instructionPresets'

/** 声音相关节点指令面板必须有可点的预设，不能再是空数组。 */
const VOICE_KINDS: InstructionPresetKind[] = ['voice', 'dialogue', 'sfx', 'music']

describe('声音相关指令预设', () => {
  it.each(VOICE_KINDS)('%s 至少有一条预设且 body 非空', (kind) => {
    const list = listInstructionPresets(kind)
    expect(list.length, kind).toBeGreaterThan(0)
    for (const item of list) {
      expect(item.id, item.id).toBeTruthy()
      expect(item.titleKey, item.id).toMatch(/^graph\.inspector\.generate\.presets\./)
      expect(item.body.trim(), item.id).not.toBe('')
    }
  })

  it('音效预设描述的是声音事件，不是多说话人对白格式', () => {
    for (const item of listInstructionPresets('sfx')) {
      // 「A: 台词」/「向导: …」这种对话行不该出现在音效预设里
      expect(item.body, item.id).not.toMatch(/^(?:[A-Za-z]|[\u4e00-\u9fff]{1,4})\s*[:：]\s*\S/m)
    }
  })

  it('对话预设每条都含说话人行', () => {
    for (const item of listInstructionPresets('dialogue')) {
      expect(item.body, item.id).toMatch(/[:：]/)
    }
  })
})
