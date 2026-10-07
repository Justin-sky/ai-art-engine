import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 插件市场窗口的**接线**守卫。
 *
 * 市场是独立系统窗口，横跨主进程（建窗 + 广播）、preload（转发）、渲染层（路由 + 视图）
 * 与设置页（迁出三块）。这条链没有类型能整体约束，所以按源码断言钉住 ——
 * 任何一处被改坏（比如把设置页的 MCP 页签加回来、或忘了单例复用）这里会红。
 *
 * 窗口本身依赖 Electron，无法在此环境实例化；因此不测运行时行为，只测结构契约。
 */
const read = (...parts: string[]): string => readFileSync(resolve(...parts), 'utf8')

const IPC = read('src/shared/ipc.ts')
const MAIN_IPC = read('src/main/ipc.ts')
const PRELOAD = read('src/preload/index.ts')
const WINDOW_SERVICE = read('src/main/services/marketplaceWindow.ts')
const APP = read('src/renderer/src/App.vue')
const ROUTER = read('src/renderer/src/router/index.ts')
const STUDIO = read('src/renderer/src/views/StudioView.vue')
const SETTINGS = read('src/renderer/src/views/SettingsView.vue')
const MARKETPLACE = read('src/renderer/src/views/MarketplaceView.vue')

describe('IPC 通道与转发', () => {
  it('声明了市场窗口与设置广播两条通道', () => {
    expect(IPC).toMatch(/MARKETPLACE_OPEN_WINDOW: 'marketplace:open-window'/)
    expect(IPC).toMatch(/SETTINGS_UPDATED: 'settings:updated'/)
  })

  it('StudioApi 暴露 openMarketplaceWindow 与 onSettingsUpdated', () => {
    expect(IPC).toMatch(/openMarketplaceWindow: \(\) => Promise<void>/)
    expect(IPC).toMatch(
      /onSettingsUpdated: \(callback: \(settings: AppSettings\) => void\) => \(\) => void/
    )
  })

  it('preload 两条都转发（订阅返回取消函数）', () => {
    expect(PRELOAD).toContain('IpcChannels.MARKETPLACE_OPEN_WINDOW')
    expect(PRELOAD).toContain('IpcChannels.SETTINGS_UPDATED')
    expect(PRELOAD).toMatch(/removeListener\(IpcChannels\.SETTINGS_UPDATED/)
  })
})

describe('主进程：设置广播与市场窗口', () => {
  it('SETTINGS_SET 保存后广播给所有窗口', () => {
    // 不广播时主窗口读不到市场窗口改过的编辑器偏好与模型下拉
    expect(MAIN_IPC).toMatch(
      /SETTINGS_SET[\s\S]{0,420}broadcastToAllWindows\(IpcChannels\.SETTINGS_UPDATED/
    )
  })

  it('注册了市场窗口 handler', () => {
    expect(MAIN_IPC).toMatch(/MARKETPLACE_OPEN_WINDOW[\s\S]{0,120}openMarketplaceWindow\(\)/)
  })

  it('窗口是单例：已存在则聚焦，不叠加', () => {
    expect(WINDOW_SERVICE).toMatch(/isDestroyed\(\)[\s\S]{0,160}show\(\)[\s\S]{0,80}focus\(\)/)
    expect(WINDOW_SERVICE).toMatch(/window\.on\('closed'/)
  })

  it('webPreferences 与主窗口一致（preload / contextIsolation）', () => {
    expect(WINDOW_SERVICE).toMatch(/preload: join\(__dirname, '\.\.\/preload\/index\.js'\)/)
    expect(WINDOW_SERVICE).toMatch(/contextIsolation: true/)
    expect(WINDOW_SERVICE).toMatch(/sandbox: false/)
  })

  it('构造参数里必须带 windowChromeOptions（否则出现原生 + 自绘两层标题栏）', () => {
    // applyChromeToWindow 只调 setTitleBarOverlay，而叠加标题栏要求创建时就 'hidden'；
    // 漏掉这一项时窗口会顶着原生标题栏 + 视图内自绘标题栏两层
    expect(WINDOW_SERVICE).toMatch(/\.\.\.settingsService\.windowChromeOptions\(\)/)
  })

  it('设置服务侧说明了这个陷阱（防止有人再把构造参数删掉）', () => {
    const settings = read('src/main/services/settingsService.ts')
    expect(settings).toMatch(/它不能代替 `windowChromeOptions\(\)`/)
  })

  it('dev 与生产两条载入路径都指向 /marketplace 路由', () => {
    expect(WINDOW_SERVICE).toMatch(/ELECTRON_RENDERER_URL[\s\S]{0,160}#\$\{MARKETPLACE_ROUTE\}/)
    expect(WINDOW_SERVICE).toMatch(/loadFile\([\s\S]{0,200}hash: MARKETPLACE_ROUTE/)
  })
})

describe('渲染层：路由与 App 外壳', () => {
  it('注册了 marketplace 路由', () => {
    expect(ROUTER).toMatch(/path: '\/marketplace', name: 'marketplace'/)
  })

  it('市场路由下不渲染顶栏与主界面（该窗口只放市场视图）', () => {
    expect(APP).toMatch(/const isMarketplace = computed\(\(\) => route\.name === 'marketplace'\)/)
    expect(APP).toMatch(/<MarketplaceView v-if="isMarketplace" \/>/)
  })

  it('App 订阅设置广播并同步本窗口偏好', () => {
    expect(APP).toMatch(/onSettingsUpdated\(\(settings\) => \{[\s\S]{0,220}applyEditorPreferences/)
    expect(APP).toContain('invalidateGenerateModelSettingsCache()')
    // 订阅必须在卸载时取消
    expect(APP).toMatch(/stopSettingsUpdated\?\.\(\)/)
  })
})

describe('入口与设置页迁移', () => {
  it('工作室工具栏有插件市场按钮并调用 IPC', () => {
    expect(STUDIO).toMatch(/@click="openMarketplace"/)
    expect(STUDIO).toMatch(/window\.studio\.openMarketplaceWindow\(\)/)
    expect(STUDIO).toContain("t('marketplace.open')")
  })

  it('设置页不再有 mcp / skills / plugins 三个页签与区块', () => {
    expect(SETTINGS).not.toContain("mainTab === 'mcp'")
    expect(SETTINGS).not.toContain("mainTab === 'skills'")
    expect(SETTINGS).not.toContain("mainTab === 'plugins'")
    // 页签值集合也要清干净
    expect(SETTINGS).not.toMatch(/SETTINGS_TAB_QUERY_VALUES[\s\S]{0,220}'mcp'/)
  })

  it('设置页不再有跳转市场的入口（按约定的选择）', () => {
    expect(SETTINGS).not.toContain('openMarketplaceWindow')
    expect(SETTINGS).not.toContain("t('marketplace.open')")
  })

  it('设置页不再残留已迁走的 MCP / 技能逻辑', () => {
    for (const gone of [
      'applyMcpRestart',
      'applyTokenEdit',
      'applyBlenderRestart',
      'refreshBlenderStatus',
      'claudeCommand',
      'copyMcp'
    ]) {
      expect(SETTINGS, `设置页仍残留 ${gone}`).not.toContain(gone)
    }
  })

  it('孤儿组件 SkillsPanel 已删除（职能并入市场）', () => {
    expect(() => read('src/renderer/src/components/settings/SkillsPanel.vue')).toThrow()
  })
})

describe('市场视图：窗口样式与任务列表一致', () => {
  it('标题区用同一套 eyebrow + 标题写法', () => {
    expect(MARKETPLACE).toContain('marketplace.eyebrow')
    expect(MARKETPLACE).toMatch(/class="eyebrow"/)
    expect(MARKETPLACE).toMatch(/\.eyebrow \{[\s\S]{0,200}text-transform: uppercase/)
  })

  it('页签用下划线式（与任务列表一致），不是胶囊式', () => {
    expect(MARKETPLACE).toMatch(/\.mp-tab\.active \{[\s\S]{0,120}border-bottom-color: #5a9dff/)
  })

  it('窗口无窗壳，标题栏兼作拖动条并给系统按钮留位', () => {
    // 不设 app-region: drag 时无边框窗口完全无法拖动
    expect(MARKETPLACE).toMatch(/\.mp-titlebar \{[\s\S]{0,600}-webkit-app-region: drag/)
    expect(MARKETPLACE).toMatch(/\.mp-titlebar \{[\s\S]{0,600}padding-right: max\(148px/)
    // 标题栏内的按钮必须取消拖动，否则点不动
    expect(MARKETPLACE).toMatch(/\.mp-title-actions \{[\s\S]{0,200}-webkit-app-region: no-drag/)
  })

  it('内容区自己滚动，标题栏固定', () => {
    expect(MARKETPLACE).toMatch(/\.mp-body \{[\s\S]{0,200}overflow: auto/)
  })

  it('只用已定义的主题变量（--bg-app 这个坑曾把窗口底色变成透明）', () => {
    expect(MARKETPLACE).not.toContain('var(--bg-app)')
    expect(MARKETPLACE).toMatch(/background: var\(--bg-panel\)/)
  })

  it('技能专属段落只在「技能」页签下出现（曾挂在页签判断之外，每个分类都冒出来）', () => {
    // 两个技能的 section 必须在同一个 `category === 'skills'` 判断里；
    // 挂在页签判断之外时，MCP / 扩展页签底部也会出现「技能目录 / 技能模板参数」
    const gated = MARKETPLACE.match(/<section v-if="category === 'skills'"/g) ?? []
    expect(gated).toHaveLength(1)
    // 除了这一个带条件的 section，不应再有其它 v-if 的 mp-section
    const ungated =
      MARKETPLACE.match(/<section(?![^>]*category === 'skills')[^>]*class="mp-section"/g) ?? []
    expect(ungated).toEqual([])
  })
})

describe('市场视图：设置落盘不做整表覆盖', () => {
  it('先读最新设置再只替换自己负责的片段', () => {
    // setSettings 是整对象替换：不先 getSettings 会覆盖另一个窗口刚改的字段
    expect(MARKETPLACE).toMatch(
      /const latest = await window\.studio\.getSettings\(\)[\s\S]{0,200}setSettings\(\{ \.\.\.latest, blenderMcp/
    )
  })

  it('MCP 端口 / token 走 restartMcpServer，不经过 setSettings', () => {
    const serverCard = read('src/renderer/src/components/marketplace/McpServerCard.vue')
    expect(serverCard).toContain('window.studio.restartMcpServer')
    expect(serverCard).not.toContain('window.studio.setSettings')
  })

  it('外部链接走 window.open（主进程 setWindowOpenHandler 转 shell.openExternal）', () => {
    expect(MARKETPLACE).toMatch(/window\.open\(url, '_blank'/)
  })
})
