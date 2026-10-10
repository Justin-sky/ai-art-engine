import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 语义时间线 dive 的轨道布局守卫（尺寸 / 字号 / 滚动 / 左侧固定栏）。
 *
 * 组件在 node 环境渲染不了（无 jsdom），所以按本仓库既有做法做源码守卫。
 *
 * **断言前必须剥掉 CSS 注释**：注释里为了解释原因常写着同样的声明字样
 * （例如「必须 `width: fit-content`」），直接 `toContain` 会让变异（把声明真删掉）
 * 依然通过 —— 这条是实测踩出来的。
 */
const source = readFileSync(
  join(process.cwd(), 'src/renderer/src/components/SemanticTimelineEditor.vue'),
  'utf8'
)

function cssBlock(selector: string): string {
  const raw = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`, 's').exec(source)?.[1] ?? ''
  return raw.replace(/\/\*[\s\S]*?\*\//g, '')
}

function pxOf(selector: string, prop: string): number {
  const value = new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`).exec(
    cssBlock(selector)
  )?.[1]
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
    const label = cssBlock('.stl-row-label')
    expect(label).toMatch(/position:\s*sticky/)
    expect(label).toMatch(/left:\s*0/)
    expect(label).toContain('var(--stl-gutter)')
    expect(label).not.toMatch(/position:\s*absolute/)
    // 标签栏不透明：滚动时轨道从它底下穿过而不透出来
    expect(label).toMatch(/background:\s*var\(--bg-panel\)/)
    // 模板里标签是轨道的**兄弟**节点（在流内），不是轨道的子节点
    expect(source).toContain('class="stl-row-label"')
    expect(source).not.toContain('stl-ent-label')
    const labelIndex = source.indexOf('class="stl-row-label"')
    const trackIndex = source.indexOf('class="stl-track"')
    expect(labelIndex).toBeGreaterThan(-1)
    expect(trackIndex).toBeGreaterThan(labelIndex)
    // 刻度尺要让开标签栏（0s 与轨道起点对齐）
    expect(cssBlock('.stl-ruler')).toContain('margin-left: var(--stl-gutter)')
    /**
     * 滚动区**左边不能有内边距**：sticky 标签只盖得住内容盒，盖不住 padding 区，
     * 于是横向滚动时轨道会从标签栏左侧那条缝里露出 12px 的块（实测见过）。
     */
    const scroll = cssBlock('.stl-scroll')
    expect(scroll).toMatch(/padding:\s*8px 12px 16px 0/)
    expect(scroll).not.toMatch(/padding:\s*8px 12px 16px;/)
  })

  /**
   * 层标题（剧情 / 角色·实体 / 制作）与空态（暂无实体）也要钉在左边。
   *
   * 关键点：必须 `width: fit-content` —— 块级元素撑满内容宽度时 sticky 没有可滑动余量，
   * 写了 `position: sticky` 也不生效（这条踩过）。
   */
  it('层标题与空态同样固定（sticky + 收缩宽度 + 不透明底）', () => {
    for (const selector of ['.stl-layer > header', '.stl-empty']) {
      const block = cssBlock(selector)
      expect(block, `${selector} 缺少样式`).toBeTruthy()
      expect(block, `${selector} 未 sticky`).toMatch(/position:\s*sticky/)
      expect(block, `${selector} 未钉左侧`).toMatch(/left:\s*0/)
      expect(block, `${selector} 未收缩宽度（sticky 会失效）`).toMatch(/width:\s*fit-content/)
      expect(block, `${selector} 缺不透明底（滚动时内容会透出）`).toMatch(
        /background:\s*var\(--bg-panel\)/
      )
    }
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
    const editor = cssBlock('.stl-editor')
    const scroll = cssBlock('.stl-scroll')
    expect(editor).toMatch(/flex:\s*1 1 auto/)
    expect(editor).not.toMatch(/min-height:\s*280px/)
    expect(scroll).toMatch(/overflow:\s*auto/)
    expect(scroll).toMatch(/min-width:\s*0/)
    expect(scroll).toMatch(/min-height:\s*0/)
  })
})
