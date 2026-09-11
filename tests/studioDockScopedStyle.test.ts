import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * StudioView 里 dock 样式的「作用域穿透」守卫。
 *
 * 背景：dockview-vue 7.0.4 起 DockviewVue 的根节点是 Fragment（dock 容器 div + 面板 Teleport
 * 宿主），而 Vue 只会把父组件的 scoped 属性写到「单根」子组件的根元素上——内层 div 只拿到
 * `class="studio-dock"`，拿不到 `data-v-*`。因此裸写 `.studio-dock` 的 scoped 选择器会编译成
 * `.studio-dock[data-v-*]` 并全部失配：dock 被压成 0 宽（竖栏贴左边、中间整片空白且点不动）。
 *
 * 唯一稳的写法是从本组件自己的元素穿下去，即 `.studio-main :deep(.studio-dock …)`，
 * 编译结果 `.studio-main[data-v-*] .studio-dock …`。本测试锁住这条约定。
 */

const STUDIO_VIEW = 'src/renderer/src/views/StudioView.vue'
/** 内层 dock 容器仍然要带这个 class：布局查询与拖放清 overlay 都按它取元素 */
const DOCK_CLASS = 'studio-dock'
const SCOPE_ANCHOR = '.studio-main'

function readStudioView(): string {
  return readFileSync(STUDIO_VIEW, 'utf8')
}

/** 只取 `<style scoped>` 块的内容（模板里的 class 写法不参与选择器检查） */
function scopedStyleBlocks(source: string): string[] {
  const blocks: string[] = []
  const re = /<style([^>]*)>([\s\S]*?)<\/style>/g
  let match = re.exec(source)
  while (match) {
    if (/\bscoped\b/.test(match[1])) blocks.push(match[2])
    match = re.exec(source)
  }
  return blocks
}

/** 把 CSS 拆成「规则前导文本」（选择器，含 @media 之类的 at 前缀），注释先剥掉 */
function rulePreludes(css: string): string[] {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}')
    .map((chunk) => {
      const brace = chunk.lastIndexOf('{')
      return brace === -1 ? '' : chunk.slice(0, brace).trim()
    })
    .filter((prelude) => prelude.length > 0)
}

describe('StudioView dock 样式作用域守卫', () => {
  it('针对内层 dock 容器的 scoped 规则一律从 .studio-main :deep() 穿下去', () => {
    const blocks = scopedStyleBlocks(readStudioView())
    expect(blocks.length).toBeGreaterThan(0)

    const dockRules = blocks
      .flatMap((css) => rulePreludes(css))
      .filter((prelude) => prelude.includes(DOCK_CLASS))

    // 这些规则是 dock 的布局与视觉基线（flex: 1、面板背景、标签栏…），数量骤降说明被搬走了
    expect(dockRules.length).toBeGreaterThanOrEqual(20)

    const offenders = dockRules.filter((prelude) => !prelude.includes(SCOPE_ANCHOR))
    expect(offenders).toEqual([])
  })

  it('dock 容器在 .studio-main 里，且排在竖栏之前（竖栏落在最右）', () => {
    const source = readStudioView()
    const mainStart = source.indexOf('class="studio-main"')
    const dockStart = source.indexOf(`class="${DOCK_CLASS}"`)
    const railStart = source.indexOf('<StudioSideToolBar')

    expect(mainStart).toBeGreaterThan(-1)
    expect(dockStart).toBeGreaterThan(mainStart)
    expect(railStart).toBeGreaterThan(dockStart)
  })
})
