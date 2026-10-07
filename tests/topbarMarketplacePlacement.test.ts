import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 顶栏里「插件市场」与「设置」的相对位置。
 *
 * 这两条都是**应用级**入口（装工作流/技能、改偏好），都不依赖当前工程，所以同放顶栏。
 * 位置是被明确要求过的（市场在设置左边），且很容易在后续调整顶栏时被无意挪走 ——
 * 而这类回归不会报错、只会让按钮换个地方，靠人肉 review 很容易漏。
 *
 * 用源码级守卫而不是挂载组件：本仓库的 vitest 是 node 环境，没有 jsdom / @vue/test-utils。
 */
const APP = readFileSync(resolve('src/renderer/src/App.vue'), 'utf8')
const STUDIO = readFileSync(resolve('src/renderer/src/views/StudioView.vue'), 'utf8')

/** 取 `topbar-actions` 这一段（到该 nav 结束），只看顶栏右侧分组内部 */
function topbarActions(): string {
  const start = APP.indexOf('class="topbar-actions"')
  expect(start, 'App.vue 里应当有 topbar-actions').toBeGreaterThan(-1)
  const end = APP.indexOf('</nav>', start)
  expect(end).toBeGreaterThan(start)
  return APP.slice(start, end)
}

describe('顶栏：插件市场在设置左边', () => {
  it('两者都在同一个顶栏分组里', () => {
    const block = topbarActions()
    expect(block).toContain("t('marketplace.open')")
    expect(block).toContain("t('app.nav.settings')")
  })

  it('市场的按钮**排在设置之前**', () => {
    const block = topbarActions()
    const market = block.indexOf("t('marketplace.open')")
    const settings = block.indexOf("t('app.nav.settings')")
    expect(market).toBeGreaterThan(-1)
    expect(settings).toBeGreaterThan(-1)
    expect(market, '插件市场必须排在设置左边').toBeLessThan(settings)
  })

  it('市场按钮唤起主进程窗口（保持单例与统一外观）', () => {
    expect(APP).toContain('window.studio.openMarketplaceWindow()')
    expect(topbarActions()).toContain('@click="openMarketplace"')
  })

  it('**是移动不是复制**：工作室工具栏里不再有市场按钮', () => {
    // 两个入口同时存在会让「装完在哪儿看」产生歧义，也让顶栏/工具栏的职责重叠
    expect(STUDIO).not.toContain('openMarketplaceWindow')
    expect(STUDIO).not.toContain("t('marketplace.open')")
  })

  it('文案仍走同一个 i18n 键（不新造键）', () => {
    expect(APP).toContain(':title="t(\'marketplace.open\')"')
    expect(APP).toContain(':aria-label="t(\'marketplace.open\')"')
  })
})
