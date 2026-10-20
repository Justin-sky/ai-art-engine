import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 顶栏「插件市场」与左侧工具栏底部「设置（齿轮 icon）」的位置守卫。
 *
 * - 插件市场放在顶栏右侧分组（`topbar-actions`）；
 * - 设置按钮移至左侧竖向工具栏（`WorkspaceToolbar.vue`）的最下方（`margin-top: auto`），并采用齿轮 SVG 图标。
 *
 * 用源码级守卫而不是挂载组件：本仓库的 vitest 是 node 环境，没有 jsdom / @vue/test-utils。
 */
const APP = readFileSync(resolve('src/renderer/src/App.vue'), 'utf8')
const STUDIO = readFileSync(resolve('src/renderer/src/views/StudioView.vue'), 'utf8')
const WORKSPACE_TOOLBAR = readFileSync(
  resolve('src/renderer/src/components/WorkspaceToolbar.vue'),
  'utf8'
)

/** 取 `topbar-actions` 这一段（到该 nav 结束），只看顶栏右侧分组内部 */
function topbarActions(): string {
  const start = APP.indexOf('class="topbar-actions"')
  expect(start, 'App.vue 里应当有 topbar-actions').toBeGreaterThan(-1)
  const end = APP.indexOf('</nav>', start)
  expect(end).toBeGreaterThan(start)
  return APP.slice(start, end)
}

describe('顶栏插件市场与左侧工具栏底部设置齿轮按钮', () => {
  it('顶栏保留插件市场按钮，不再放文字版设置按钮', () => {
    const block = topbarActions()
    expect(block).toContain("t('marketplace.open')")
    expect(block).not.toContain("t('app.nav.settings')")
  })

  it('设置按钮位于左侧工具栏（WorkspaceToolbar）最下方且使用齿轮图标', () => {
    const createLoop = WORKSPACE_TOOLBAR.indexOf('v-for="item in displayItems"')
    const settingsBtn = WORKSPACE_TOOLBAR.indexOf('class="tool-btn tool-btn-settings"')
    expect(createLoop).toBeGreaterThan(-1)
    expect(settingsBtn).toBeGreaterThan(createLoop)
    expect(WORKSPACE_TOOLBAR).toContain("t('app.nav.settings')")
    expect(WORKSPACE_TOOLBAR).toContain('<SettingsGearIcon')
    expect(WORKSPACE_TOOLBAR).toMatch(/\.tool-btn-settings\s*\{[\s\S]*?margin-top:\s*auto/)
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
