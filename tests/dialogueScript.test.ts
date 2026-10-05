import { describe, expect, it } from 'vitest'
import {
  buildDialogueInputs,
  dialogueSpeakers,
  parseDialogueScript
} from '../src/shared/graph/dialogueScript'

/**
 * 多说话人对话稿的解析（ElevenLabs Text to Dialogue 的输入约定）。
 *
 * 端点要的是结构化 `inputs: [{ text, voice_id }]`，而图里的指令框只能给文本，
 * 所以约定「说话人: 台词」的行式写法 —— 与剧本对白同形。
 */
describe('对话稿解析', () => {
  it('识别行首的说话人前缀（中英文冒号都认）', () => {
    expect(parseDialogueScript('A: 你终于来了。\nB：路上堵车。')).toEqual([
      { speaker: 'A', text: '你终于来了。' },
      { speaker: 'B', text: '路上堵车。' }
    ])
  })

  it('没有说话人的行沿用上一段（旁白 / 连续独白）', () => {
    expect(parseDialogueScript('A: 第一句\n第二句\nB: 换人了')).toEqual([
      { speaker: 'A', text: '第一句' },
      { speaker: 'A', text: '第二句' },
      { speaker: 'B', text: '换人了' }
    ])
  })

  it('只在行首认前缀：正文里的冒号不能被当说话人', () => {
    // 「他说」后面是正文里的冒号，不该生成一个叫「他说」的说话人
    expect(parseDialogueScript('A: 他说：我不去。')).toEqual([
      { speaker: 'A', text: '他说：我不去。' }
    ])
  })

  it('前缀含标点 / 过长时不认（避免把正文第一句当说话人）', () => {
    // 超过 24 字的前缀不可能是说话人名，否则会把正文首句整个吞成「说话人」
    const longPrefix = '这是一段很长的没有冒号分隔的句子内容确实超过了二十四个字的长度上限'
    expect(parseDialogueScript(`${longPrefix}: 台词`)).toEqual([{ text: `${longPrefix}: 台词` }])
    // 含逗号的前缀不是说话人
    expect(parseDialogueScript('你好，世界: 台词')).toEqual([{ text: '你好，世界: 台词' }])
    // 边界：刚好 24 字仍认（两侧都不误伤）
    const exactly24 = '一二三四五六七八九十一二三四五六七八九十一二三四'
    expect(exactly24).toHaveLength(24)
    expect(parseDialogueScript(`${exactly24}: 台词`)).toEqual([
      { speaker: exactly24, text: '台词' }
    ])
  })

  it('空行忽略；只有前缀没台词的行不产出段落但保留说话人上下文', () => {
    expect(parseDialogueScript('A:\n\nB: 台词')).toEqual([{ speaker: 'B', text: '台词' }])
    expect(parseDialogueScript('A:\n接着说话')).toEqual([{ speaker: 'A', text: '接着说话' }])
    expect(parseDialogueScript('   \n  \n')).toEqual([])
  })

  it('说话人列表按首次出现顺序去重', () => {
    const lines = parseDialogueScript('B: 1\nA: 2\nB: 3')
    expect(dialogueSpeakers(lines)).toEqual(['B', 'A'])
  })

  it('映射到端点 inputs：每段解析出 voice_id，缺音色的段落报出下标', () => {
    const lines = parseDialogueScript('A: 你好\nB: 你好\nC: 你好')
    const { inputs, missingVoiceAt } = buildDialogueInputs(lines, { A: 'voice-a', B: '' })
    expect(inputs).toEqual([
      { text: '你好', voice: 'voice-a' }
      // B 的映射是空串 → 算缺失
    ])
    expect(missingVoiceAt).toEqual([1, 2])
  })

  it('没有绑定说话人时回退到节点音色（单音色配完整段对话）', () => {
    const lines = parseDialogueScript('A: 你好\nB: 我也好')
    const { inputs, missingVoiceAt } = buildDialogueInputs(lines, {}, 'fallback-voice')
    expect(missingVoiceAt).toEqual([])
    expect(inputs).toEqual([
      { text: '你好', voice: 'fallback-voice' },
      { text: '我也好', voice: 'fallback-voice' }
    ])
    // 说话人自己绑定的优先于回退
    const mapped = buildDialogueInputs(lines, { B: 'voice-b' }, 'fallback-voice')
    expect(mapped.inputs).toEqual([
      { text: '你好', voice: 'fallback-voice' },
      { text: '我也好', voice: 'voice-b' }
    ])
  })
})
