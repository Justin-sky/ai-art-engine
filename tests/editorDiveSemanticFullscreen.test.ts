import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 语义时间线 dive 的**全屏浮层**守卫。
 *
 * 需求：这个视图直接铺满整个窗口（不要全屏按钮、不要 Esc 退出）。
 * 组件在 node 环境渲染不了（无 jsdom），按仓库既有做法做源码守卫。
 */
const source = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/dive/EditorDiveSemanticTimelineView.vue'),
  'utf8'
)

/** 去掉注释再断言：注释里常写着同样的字样，直接 toContain 会造成假通过 */
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')
const styleBlock = /<style scoped>([\s\S]*?)<\/style>/.exec(code)?.[1] ?? ''

describe('EditorDiveSemanticTimelineView 全屏浮层', () => {
  it('无条件 Teleport 到 body（不是可切换的 :disabled）', () => {
    expect(code).toContain('<Teleport to="body">')
    expect(code).not.toContain(':disabled="!fullscreen"')
  })

  it('没有全屏按钮、没有 Esc 处理', () => {
    expect(code).not.toContain('toggleFullscreen')
    expect(code).not.toContain('fullscreen-btn')
    expect(code).not.toContain('dive-toolbar')
    expect(code).not.toContain("'Escape'")
    expect(code).not.toContain('addEventListener')
  })

  it('浮层铺满窗口：fixed + inset 0 + 高层级，且不遮住 9999 的悬浮提示', () => {
    const full = /\.dive-fullscreen\s*\{([^}]*)\}/s.exec(styleBlock)?.[1] ?? ''
    expect(full).toBeTruthy()
    expect(full).toMatch(/position:\s*fixed/)
    expect(full).toMatch(/inset:\s*0/)
    const z = Number(/z-index:\s*(\d+)/.exec(full)?.[1] ?? 0)
    expect(z, '要盖住应用内最高弹层 5200').toBeGreaterThan(5200)
    expect(z, '不能盖住 9999 的 OverflowTip').toBeLessThan(9999)
  })

  /**
   * 浮层会盖住宿主渲染的返回条 —— 必须自己再渲染一份，否则用户退不出去。
   */
  it('浮层自带 dive 返回条（用宿主 provide 的上下文，否则没法退出）', () => {
    expect(code).toContain('inject(editorDiveKey')
    expect(code).toContain('<EditorDiveBar')
    expect(code).toContain(':frames="diveBar.frames"')
    expect(code).toContain('@pop-to="diveBar.popTo"')
    expect(code).toContain('v-if="diveBar"')
  })
})
