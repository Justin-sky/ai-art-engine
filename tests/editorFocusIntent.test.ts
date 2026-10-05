import { describe, expect, it } from 'vitest'
import { pointInRect, resolveEditorFocusIntent } from '../src/renderer/src/utils/editorFocusIntent'

/**
 * 「点进空指令框后第一下按键被吃掉」的判定契约。
 *
 * 编辑区（.editor-area）比 textarea 大一圈：textarea 只有内容区，外面是编辑区的内边距。
 * 点在那一圈 padding 上时，浏览器不会把焦点给 textarea —— 焦点留在画布上，
 * 用户敲的第一下按键就发给画布了，第二下才正常。
 */
const rect = { left: 100, right: 400, top: 200, bottom: 300 }

describe('pointInRect', () => {
  it('边界算在盒子内（含内边距）', () => {
    expect(pointInRect(rect, { clientX: 100, clientY: 200 })).toBe(true)
    expect(pointInRect(rect, { clientX: 400, clientY: 300 })).toBe(true)
  })

  it('盒子外的点判为外部', () => {
    expect(pointInRect(rect, { clientX: 99, clientY: 250 })).toBe(false)
    expect(pointInRect(rect, { clientX: 401, clientY: 250 })).toBe(false)
    expect(pointInRect(rect, { clientX: 250, clientY: 199 })).toBe(false)
    expect(pointInRect(rect, { clientX: 250, clientY: 301 })).toBe(false)
  })
})

describe('resolveEditorFocusIntent', () => {
  it('点在哪都拦截：编辑器下方的内边距（就是第一下按键丢失的现场）', () => {
    // textarea 底边在 300，编辑区到 320（20px padding）：点 310 落在 textarea 外面
    expect(
      resolveEditorFocusIntent({
        alreadyFocused: false,
        rect,
        point: { clientX: 250, clientY: 310 }
      })
    ).toBe('takeover')
  })

  it('点在 textarea 内不拦：交给浏览器定位光标、保留按住拖动选文本', () => {
    expect(
      resolveEditorFocusIntent({
        alreadyFocused: false,
        rect,
        point: { clientX: 250, clientY: 250 }
      })
    ).toBe('native')
  })

  it('已经聚焦就不再动：否则点一下就把用户已有选区清掉', () => {
    expect(
      resolveEditorFocusIntent({
        alreadyFocused: true,
        rect,
        point: { clientX: 250, clientY: 310 }
      })
    ).toBe('native')
    expect(
      resolveEditorFocusIntent({
        alreadyFocused: true,
        rect,
        point: { clientX: 250, clientY: 250 }
      })
    ).toBe('native')
  })
})
