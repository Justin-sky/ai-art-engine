import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 语义时间线 dive 的轨道尺寸/字号守卫。
 *
 * 需求是「轨道高一点、字大一点」—— 这类纯样式调整最容易被后续改动悄悄改回去
 * （组件在 node 环境渲染不了，测不到计算样式），所以把下限钉在源码里。
 */
const source = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/SemanticTimelineEditor.vue'),
  'utf8'
)

/** 取某个选择器块里的 px 值 */
function pxOf(selector: string, prop: string): number {
  const block = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`, 's').exec(source)?.[1] ?? ''
  const value = new RegExp(`${prop}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`).exec(block)?.[1]
  expect(value, `${selector} 缺少 ${prop}`).toBeTruthy()
  return Number(value)
}

describe('SemanticTimelineEditor 轨道尺寸与字号', () => {
  it('轨道足够高（≥40px），且块与上下留白加起来正好填满', () => {
    const track = pxOf('.stl-track', 'height')
    const block = pxOf('.stl-block', 'height')
    const top = pxOf('.stl-block', 'top')
    expect(track).toBeGreaterThanOrEqual(40)
    expect(block).toBeGreaterThanOrEqual(28)
    // 5 + 30 + 5 = 40：块不溢出轨道，也不塌在顶部
    expect(top * 2 + block).toBeLessThanOrEqual(track)
  })

  it('轨道上的字号足够大（块文字 ≥13px，标签/刻度 ≥12px）', () => {
    expect(pxOf('.stl-block', 'font-size')).toBeGreaterThanOrEqual(13)
    expect(pxOf('.stl-row-label', 'font-size')).toBeGreaterThanOrEqual(13)
    expect(pxOf('.stl-tick', 'font-size')).toBeGreaterThanOrEqual(12)
    expect(pxOf('.stl-layer > header', 'font-size')).toBeGreaterThanOrEqual(13)
  })

  /**
   * 轨道名必须**固定在最左边**，而且不能压在块上。
   *
   * 旧做法是 `position: absolute; left: 6px` 放在轨道里 —— 横向滚动时名字跟着跑，
   * 块从 0s 开始时还直接压在名字上。现在是「左侧标签栏（sticky + 在流内占位）+ 右侧轨道」。
   */
  it('轨道名固定在左侧栏（sticky + 在流内占位，不绝对定位压块）', () => {
    const label = /\.stl-row-label\s*\{([^}]*)\}/s.exec(source)?.[1] ?? ''
    expect(label).toContain('position: sticky')
    expect(label).toContain('left: 0')
    expect(label).toContain('var(--stl-gutter)')
    expect(label).not.toContain('position: absolute')
    // 标签栏不透明：滚动时轨道从它底下穿过而不透出来
    expect(label).toContain('background: var(--bg-panel)')
    // 模板里标签是轨道的**兄弟**节点（在流内），不是轨道的子节点
    expect(source).toContain('class="stl-row-label"')
    expect(source).not.toContain('stl-ent-label')
    const labelIndex = source.indexOf('class="stl-row-label"')
    const trackIndex = source.indexOf('class="stl-track"')
    expect(labelIndex).toBeGreaterThan(-1)
    expect(trackIndex).toBeGreaterThan(labelIndex)
    // 刻度尺要让开标签栏（0s 与轨道起点对齐）
    const ruler = /\.stl-ruler\s*\{([^}]*)\}/s.exec(source)?.[1] ?? ''
    expect(ruler).toContain('margin-left: var(--stl-gutter)')
    /**
     * 滚动区**左边不能有内边距**：sticky 标签只盖得住内容盒，盖不住 padding 区，
     * 于是横向滚动时轨道会从标签栏左侧那条缝里露出 12px 的块（实测见过）。
     */
    const scroll = /\.stl-scroll\s*\{([^}]*)\}/s.exec(source)?.[1] ?? ''
    expect(scroll).toContain('padding: 8px 12px 16px 0')
    expect(scroll).not.toContain('padding: 8px 12px 16px;')
  })

  /**
   * 横向滚动条必须落在**可见区底部**。
   *
   * 实测踩过：编辑器不给高度、随内容长高，于是 `.stl-scroll` 的横向滚动条被推到内容最底部 ——
   * 轨道一多，视口里根本够不到它（只能先把整个视图滚到底）。
   * 修法是让编辑器吃满可用高度、由 `.stl-scroll` 自己滚；flex 子项还必须显式 `min-*: 0`，
   * 否则默认 `auto` 会撑开而不滚。
   */
  it('滚动区由编辑器内部承担（编辑器吃满高度 + min-*: 0）', () => {
    const editor = /\.stl-editor\s*\{([^}]*)\}/s.exec(source)?.[1] ?? ''
    const scroll = /\.stl-scroll\s*\{([^}]*)\}/s.exec(source)?.[1] ?? ''
    expect(editor).toContain('flex: 1 1 auto')
    expect(editor).not.toMatch(/min-height:\s*280px/)
    expect(scroll).toContain('overflow: auto')
    expect(scroll).toContain('min-width: 0')
    expect(scroll).toContain('min-height: 0')
  })
})
