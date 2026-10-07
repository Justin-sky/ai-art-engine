import { existsSync, readFileSync } from 'node:fs'
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

  it('装了 window.open 策略，外链才会交给系统浏览器', () => {
    // 不装的话窗口里 window.open('https://…') 会走 Electron 默认行为：
    // 在应用内再开一个 BrowserWindow，而不是打开系统浏览器
    expect(WINDOW_SERVICE).toContain('installWindowOpenHandler(window)')
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
  it('顶栏有插件市场按钮并调用 IPC（放在设置左边）', () => {
    /*
      市场原先挂在工作室工具栏里 —— 那样只有**开了工程**才够得着，而它和设置一样是
      应用级入口（装工作流/技能、改偏好），都不依赖当前工程。现在两者同在顶栏，
      市场在设置左边。位置本身由 topbarMarketplacePlacement.test.ts 钉住。
    */
    expect(APP).toMatch(/@click="openMarketplace"/)
    expect(APP).toMatch(/window\.studio\.openMarketplaceWindow\(\)/)
    expect(APP).toContain("t('marketplace.open')")
  })

  it('工作室工具栏不再有市场按钮（移动而非复制）', () => {
    expect(STUDIO).not.toContain('openMarketplace')
    expect(STUDIO).not.toContain("t('marketplace.open')")
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

describe('第三方 MCP：中继与注入', () => {
  const MCP_SERVICE = read('src/main/services/mcpServerService.ts')
  const HARNESS = read('src/main/services/deepseekHarnessService.ts')

  it('MCP 服务路由 /mcp/ext/<id>，且停用的服务直接 403', () => {
    expect(MCP_SERVICE).toContain('externalMcpIdFromPath(url)')
    expect(MCP_SERVICE).toMatch(/configured\.enabled[\s\S]{0,160}403/)
  })

  it('中继给外部工具名加命名空间（防与内建 72 个工具撞名）', () => {
    expect(MCP_SERVICE).toMatch(/namespaceExternalMcpTool\(server\.id, tool\.name\)/)
    expect(MCP_SERVICE).toMatch(/stripExternalMcpToolPrefix\(server\.id, name\)/)
  })

  it('中继沿用同一套模式护栏（Ask 全禁 / Plan 未确认只放行只读）', () => {
    // 这是「第三方工具不成为绕过 Plan/Ask 的后门」的关键：拒绝逻辑必须在应用侧
    expect(MCP_SERVICE).toMatch(
      /denialReasonForTool\(toolAccessOf\(name\), accessViewFor\(callCtx\)\)/
    )
    expect(MCP_SERVICE).toMatch(/isToolVisible\(toolAccessOf\(tool\.name\), view\)/)
  })

  it('配置一变就重建处理器与会话（否则改完地址要等重启才生效）', () => {
    expect(MCP_SERVICE).toContain('externalMcpHandlerConfig')
    expect(MCP_SERVICE).toMatch(/dropExternalMcpSession\(server\.id\)/)
  })

  it('关闭 MCP 服务时关掉外部会话（防 stdio 孤儿进程）', () => {
    const closes = MCP_SERVICE.match(/closeAllExternalMcpSessions\(\)/g) ?? []
    expect(closes.length).toBeGreaterThanOrEqual(2) // closeMcpServer 与 stopMcpServer
    expect(MCP_SERVICE).toMatch(/externalMcpHandlers\.clear\(\)/)
  })

  it('dsh 每轮配置注入每条可用的外部服务，指向应用中继端点', () => {
    expect(HARNESS).toMatch(/settingsService\.get\(\)\.externalMcp/)
    expect(HARNESS).toMatch(/externalMcpEndpoint\(port, configured\.id\)/)
    // 未启用 / 未配好的不挂：挂上去只会变成每次调用的报错
    expect(HARNESS).toMatch(/if \(!configured \|\| !configured\.enabled\) continue/)
    expect(HARNESS).toMatch(/if \(externalMcpUnusableReason\(configured\)\) continue/)
  })

  it('注入的 mcp-client 带上模式 / runId 头（与内建工具面同等受约束）', () => {
    expect(HARNESS).toMatch(/mcp-ext-[\s\S]{0,900}accessHeaders\(mode, runId\)/)
  })

  it('超时用该服务自己的配置，而不是内建那两条的 2 小时', () => {
    expect(HARNESS).toMatch(/toolCallTimeoutMs: \$\{configured\.timeoutMs\}/)
  })

  it('第三方服务变化会重建常驻 worker（否则新工具这轮不出现）', () => {
    expect(HARNESS).toContain('externalMcpFp: externalMcpFingerprint()')
    expect(HARNESS).toMatch(/function externalMcpFingerprint/)
  })

  it('IPC 探测失败返回 ok:false 而不是抛错（原因要能显示在卡片上）', () => {
    expect(MAIN_IPC).toMatch(/MCP_EXTERNAL_PROBE[\s\S]{0,1400}return \{ ok: false, error:/)
    expect(MAIN_IPC).toMatch(/namespaceExternalMcpTool\(server\.id, tool\.name\)/)
  })

  it('设置页保存时必须原样带走 externalMcp（否则一次自动保存就清空）', () => {
    // setSettings 是整对象替换：设置页表单里没这一段就会把它写没
    expect(SETTINGS).toContain('externalMcp')
    expect(SETTINGS).toMatch(/form\.externalMcp\.splice/)
  })

  it('「添加 MCP 服务」弹对话框，不是页内表单', () => {
    const DIALOG = read('src/renderer/src/components/marketplace/ExternalMcpAddDialog.vue')
    // 按钮只负责开对话框
    expect(MARKETPLACE).toMatch(/@click="addOpen = true"/)
    expect(MARKETPLACE).toContain('<ExternalMcpAddDialog')
    // 页内不能残留表单控件：参数面板整体搬进了对话框
    expect(MARKETPLACE).not.toContain('mp-add-form')
    expect(MARKETPLACE).not.toMatch(/v-model="draft\./)
    // 对话框用与任务列表同一套窗口外壳
    expect(DIALOG).toContain('StudioFloatingWindow')
  })

  it('对话框负责校验与预检，父级只负责落盘', () => {
    const DIALOG = read('src/renderer/src/components/marketplace/ExternalMcpAddDialog.vue')
    expect(DIALOG).toContain('draftToExternalMcpServer')
    expect(DIALOG).toMatch(/probeExternalMcp\(converted\.server\)/)
    // 预检失败不 emit：连不上就不保存
    expect(DIALOG).toMatch(/if \(!result\.ok\) \{[\s\S]{0,200}return/)
    // 表单不自己写设置：setSettings 是整对象替换，只有父级持有完整设置
    // （只断言真正的调用形态：注释里会提到这个词）
    expect(DIALOG).not.toMatch(/window\.studio\.setSettings\(/)
    expect(MARKETPLACE).toMatch(/onExternalAdded[\s\S]{0,600}persistExternal\(\)/)
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

  it('没有「网页市场」入口（本仓库没有远端注册表，不做假入口）', () => {
    expect(MARKETPLACE).not.toContain('webMarket')
    expect(MARKETPLACE).not.toContain('WEB_MARKET_URL')
    // 只保留开发者文档这一个外链
    expect(MARKETPLACE).toContain('DEV_DOCS_URL')
  })

  it('「开发者文档」按钮指向官网的插件市场开发者文档，而不是用户手册', () => {
    /*
      按钮文案是「开发者文档」，作者要的是发布格式 / 技能包契约 / 脚本同意流 / 索引派生规则
      —— 那些只在 `website/developers.html`（源头是 `docs/MARKETPLACE.md`）里；
      用户手册讲的是「怎么用市场」。指错了不会报错，只会让开发者找不到该看的东西，所以钉一下。
    */
    const at = MARKETPLACE.indexOf('const DEV_DOCS_URL')
    expect(at, '应当能找到 DEV_DOCS_URL').toBeGreaterThan(-1)
    const line = MARKETPLACE.slice(at, MARKETPLACE.indexOf('\n', at))
    expect(line).toContain('developers.html')
    expect(line).not.toContain('/manual.html')
  })

  it('官网首页的开发者文档链接存在（导航项指向真实页面）', () => {
    // 导航里插了链接而页面没建 = 死链；这条盯的是"两半都要在"
    const INDEX = read('website/index.html')
    expect(INDEX).toContain('<a href="developers.html">开发者文档</a>')
    expect(existsSync(resolve('website/developers.html'))).toBe(true)
    expect(existsSync(resolve('website/developers.en.html'))).toBe(true)
  })

  it('外链策略收在一处，两个窗口共用（只装一处就会出现按窗口而异的行为）', () => {
    const POLICY = read('src/main/windowOpenPolicy.ts')
    const MAIN = read('src/main/index.ts')
    // 策略本体只有一份：外链走 shell.openExternal，同源才放行
    expect(POLICY).toMatch(/shell\.openExternal\(details\.url\)/)
    expect(POLICY).toMatch(/return \{ action: 'deny' \}/)
    expect(POLICY).toMatch(/export function installWindowOpenHandler/)
    // 两个窗口都调用它
    expect(MAIN).toContain('installWindowOpenHandler(window)')
    expect(WINDOW_SERVICE).toContain('installWindowOpenHandler(window)')
    // 主进程里不该再各自内联一份 setWindowOpenHandler
    const inline = (MAIN.match(/setWindowOpenHandler\(/g) ?? []).length
    expect(inline).toBe(0)
  })
})
