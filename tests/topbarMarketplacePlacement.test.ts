import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 左侧工具栏底部「技能市场（图标）」与「设置（齿轮图标）」的位置守卫。
 *
 * - 技能市场与设置均移至左侧竖向工具栏（`WorkspaceToolbar.vue`）最下方（`margin-top: auto`）；
 * - 技能市场按钮位于设置齿轮按钮上方，两者统一使用 SVG 图标按钮与浮动提示；
 * - 顶栏（`App.vue`）与工作室横栏（`StudioView.vue`）不再重复放置文字按钮。
 */
const APP = readFileSync(resolve('src/renderer/src/App.vue'), 'utf8')
const STUDIO = readFileSync(resolve('src/renderer/src/views/StudioView.vue'), 'utf8')
const WORKSPACE_TOOLBAR = readFileSync(
  resolve('src/renderer/src/components/WorkspaceToolbar.vue'),
  'utf8'
)

describe('左侧工具栏底部技能市场图标与设置齿轮图标按钮', () => {
  it('顶栏不再放置文字版技能市场或设置按钮', () => {
    expect(APP).not.toContain("t('marketplace.open')")
    expect(APP).not.toContain("t('app.nav.settings')")
  })

  it('技能市场与设置按钮位于左侧工具栏（WorkspaceToolbar）最下方，且市场在设置上方', () => {
    const createLoop = WORKSPACE_TOOLBAR.indexOf('v-for="item in displayItems"')
    const marketBtn = WORKSPACE_TOOLBAR.indexOf('class="tool-btn tool-btn-marketplace"')
    const settingsBtn = WORKSPACE_TOOLBAR.indexOf('class="tool-btn tool-btn-settings"')
    expect(createLoop).toBeGreaterThan(-1)
    expect(marketBtn).toBeGreaterThan(createLoop)
    expect(settingsBtn).toBeGreaterThan(marketBtn)
    expect(WORKSPACE_TOOLBAR).toContain("t('marketplace.open')")
    expect(WORKSPACE_TOOLBAR).toContain('<MarketplaceIcon')
    expect(WORKSPACE_TOOLBAR).toContain("t('app.nav.settings')")
    expect(WORKSPACE_TOOLBAR).toContain('<SettingsGearIcon')
    expect(WORKSPACE_TOOLBAR).toMatch(/\.tool-btn-marketplace\s*\{[\s\S]*?margin-top:\s*auto/)
  })

  it('市场按钮唤起主进程窗口（保持单例与统一外观）', () => {
    expect(WORKSPACE_TOOLBAR).toContain('window.studio.openMarketplaceWindow()')
    expect(WORKSPACE_TOOLBAR).toContain('@click="openMarketplace"')
  })

  it('**是移动不是复制**：工作室横栏里不再有市场按钮', () => {
    expect(STUDIO).not.toContain('openMarketplaceWindow')
    expect(STUDIO).not.toContain("t('marketplace.open')")
  })

  it('文案仍走同一个 i18n 键（不新造键）', () => {
    expect(WORKSPACE_TOOLBAR).toContain(':aria-label="t(\'marketplace.open\')"')
    expect(WORKSPACE_TOOLBAR).toContain("showTip($event, t('marketplace.open'))")
  })
})
