import { describe, expect, it } from 'vitest'
import { insertMentionToken } from '../src/renderer/src/utils/mentionInsert'

/**
 * 指令框 `@` 引用插入的光标落点。
 *
 * 回归对象：回车选中引用后光标跑到正文中间（`@N` 之前）。
 * 原因是光标在 `nextTick` 里从会被 `closeMenu()` 重置成 -1 的 `mentionStart` 再算一次，
 * 于是 `cursor = -1 + token.length + 1`。这里锁定「光标必须紧跟在 token 与空格之后」。
 */
describe('insertMentionToken', () => {
  it('光标落在 @N 与其后空格之后', () => {
    const { text, cursor } = insertMentionToken('提取出@', 3, 4, '@1')
    expect(text).toBe('提取出@1 ')
    expect(cursor).toBe(6)
    expect(text.slice(0, cursor)).toBe('提取出@1 ')
    // 光标处即文本末尾，接着打字不会插到正文中间
    expect(cursor).toBe(text.length)
  })

  it('引用插在正文中间时，光标仍在引用之后而不是靠前', () => {
    const { text, cursor } = insertMentionToken('提取出@中的人物', 3, 4, '@2')
    expect(text).toBe('提取出@2 中的人物')
    expect(text.slice(0, cursor)).toBe('提取出@2 ')
    // 关键回归：旧实现会得到 cursor = -1 + 2 + 1 = 2（跑到「提取」中间）
    expect(cursor).toBeGreaterThan(3)
  })

  it('支持带查询词的替换（@1 输入了一半就用回车补全）', () => {
    const { text, cursor } = insertMentionToken('a@12 b', 1, 4, '@1')
    // 被替换掉的查询串 `@12` 之后原本还有一个空格，插入的空格不去重
    expect(text).toBe('a@1  b')
    expect(text.slice(0, cursor)).toBe('a@1 ')
  })

  it('insertText 比 token 长时按实际插入文本算光标', () => {
    const token = '角色 严格参考@3'
    const { text, cursor } = insertMentionToken('参考@', 2, 3, token)
    expect(text).toBe('参考角色 严格参考@3 ')
    expect(cursor).toBe(text.length)
  })

  it('空文本 / 越界下标不产生 NaN 或负光标', () => {
    expect(insertMentionToken('', 0, 0, '@1')).toEqual({ text: '@1 ', cursor: 3 })
    // 越界下标夹到文本末尾：光标仍停在 token 与空格之后
    const out = insertMentionToken('abc', 99, 99, '@1')
    expect(out).toEqual({ text: 'abc@1 ', cursor: 6 })
    const negative = insertMentionToken('abc', -5, -1, '@1')
    expect(negative.cursor).toBe(3)
    expect(negative.text).toBe('@1 abc')
  })
})
