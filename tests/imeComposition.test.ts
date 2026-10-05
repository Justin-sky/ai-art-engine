import { describe, expect, it } from 'vitest'
import { isCompositionInput } from '../src/renderer/src/utils/imeComposition'

/**
 * 「中文输入时第一个字母无效」的守卫契约。
 *
 * 组词期间一旦把值回写宿主，宿主会更新节点参数并 bumpRevision，
 * 重建 textarea 的 value → 浏览器丢弃正在进行的组词 → 第一个字母看起来"没敲进去"。
 */
describe('isCompositionInput', () => {
  it('组件标记组词中：即使 input 事件没带 isComposing 也要拦住', () => {
    // 有些路径（以及 compositionstart 之后的那次 input）只在组件侧知道正在组词
    expect(isCompositionInput(true, {})).toBe(true)
    expect(isCompositionInput(true, null)).toBe(true)
    expect(isCompositionInput(true, undefined)).toBe(true)
  })

  it('input 事件自带 isComposing=true 也要拦住（组件标记可能还没设上）', () => {
    expect(isCompositionInput(false, { isComposing: true })).toBe(true)
  })

  it('正常输入照常上屏', () => {
    expect(isCompositionInput(false, { isComposing: false })).toBe(false)
    expect(isCompositionInput(false, {})).toBe(false)
    expect(isCompositionInput(false, null)).toBe(false)
  })

  it('非布尔型 isComposing 不误判（DOM 事件取值的宽松写法）', () => {
    // 只有严格等于 true 才算组词：避免 'false' / 1 之类脏值把输入堵死
    expect(isCompositionInput(false, { isComposing: 'true' as never })).toBe(false)
    expect(isCompositionInput(false, { isComposing: 1 as never })).toBe(false)
  })
})
