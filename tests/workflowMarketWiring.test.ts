import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 工作流市场的接线守卫。
 *
 * 这块横跨「远端仓库格式 → 主进程管道 → IPC → 渲染层卡片」，没有单一类型能整体约束。
 * 这里钉住的是**改坏了会静默出错**的几处：分类枚举漂移、「使用」绕过既有落盘链路、
 * 安装不走原子管道、缺依赖先装后用、以及误删编辑器的插件系统（与市场分类同名但无关）。
 */
const read = (...parts: string[]): string => readFileSync(resolve(...parts), 'utf8')

const CARDS = read('src/renderer/src/features/marketplace/buildMarketplaceCards.ts')
const VIEW = read('src/renderer/src/views/MarketplaceView.vue')
const SERVICE = read('src/main/services/workflowMarketService.ts')
const PIPELINE = read('src/main/services/marketPipeline.ts')
const CONTRACT = read('src/shared/workflowMarket.ts')
const MAIN_IPC = read('src/main/ipc.ts')
const PRELOAD = read('src/preload/index.ts')
const IPC = read('src/shared/ipc.ts')
const EDITOR_EXTERNAL = read('src/renderer/src/editor/plugins/external.ts')

describe('分类枚举：plugins 已换成 workflows', () => {
  it('卡片模型只有 mcp / skills / workflows', () => {
    expect(CARDS).toMatch(/MarketplaceCategory = 'mcp' \| 'skills' \| 'workflows'/)
  })

  it('市场代码里不再出现 plugins 分类与相关标识', () => {
    expect(CARDS).not.toContain("'plugins'")
    expect(CARDS).not.toContain('pluginSourceKey')
    expect(CARDS).not.toContain('ExternalPluginManifest')
    expect(CARDS).not.toContain('listPlugins')
    expect(VIEW).not.toContain('listPlugins')
    expect(VIEW).not.toContain('plugins.value')
  })

  it('页签顺序含 workflows 且不含 plugins', () => {
    expect(VIEW).toMatch(/TABS: MarketplaceFilter\[\] = \['all', 'mcp', 'skills', 'workflows'\]/)
  })

  it('编辑器插件系统仍在（同名但无关，不得被误删）', () => {
    expect(EDITOR_EXTERNAL).toContain('loadExternalPlugins')
    expect(IPC).toContain("PLUGIN_LIST: 'plugin:list'")
    expect(PRELOAD).toContain('listPlugins')
  })
})

describe('远端契约：格式与兼容性在共享层判定', () => {
  it('索引 / 包 / 兼容性都有解析与判定函数', () => {
    expect(CONTRACT).toContain('parseWorkflowMarketIndex')
    expect(CONTRACT).toContain('parseWorkflowBundle')
    expect(CONTRACT).toContain('missingNodeTypes')
    expect(CONTRACT).toContain('workflowEntryBlockReason')
    expect(CONTRACT).toContain('compareSemver')
  })

  it('schemaVersion 过高时明确拒绝（而不是尽力解析）', () => {
    expect(CONTRACT).toMatch(/schemaTooNew/)
  })

  it('不引第三方依赖（semver 与 JSON 校验都是手写）', () => {
    expect(CONTRACT).not.toMatch(/from 'semver'/)
    expect(CONTRACT).not.toMatch(/from 'ajv'/)
  })
})

describe('主进程：安装必须走原子管道', () => {
  it('服务通过通用管道安装，不自己写文件', () => {
    expect(SERVICE).toContain('MarketPipeline')
    expect(SERVICE).toMatch(/getPipeline\(\)\.install\(/)
    // 自己拼 writeFileSync 到目标目录会绕过「先暂存再 rename」的原子性
    expect(SERVICE).not.toMatch(/writeFileSync\(join\(targetDir/)
  })

  it('管道在临时目录写、校验后 rename（失败会清暂存）', () => {
    expect(PIPELINE).toMatch(/mkdirSync\(staging/)
    expect(PIPELINE).toMatch(/this\.commitDirectory\(staging, plan\.targetDir\)/)
    expect(PIPELINE).toMatch(/rmSync\(staging, \{ recursive: true, force: true \}\)/)
  })

  it('更新时旧版本先挪到 .old，换入成功后才删（换入失败会挪回）', () => {
    expect(PIPELINE).toMatch(/renameSync\(targetDir, backup\)/)
    expect(PIPELINE).toMatch(/renameSync\(backup, targetDir\)/)
  })

  it('离线回退磁盘缓存并标记 stale', () => {
    // 按源读缓存（`readCatalogCache(url)`），回退结果必须标 stale 让界面能提示「可能过期」
    expect(PIPELINE).toMatch(/readCatalogCache\(input\.url\)/)
    expect(PIPELINE).toMatch(/stale: true/)
  })

  it('**缺节点类型时默认拒绝安装**（逃生门必须显式传参）', () => {
    expect(SERVICE).toMatch(/missingNodeTypes\(bundle, known\)/)
    expect(SERVICE).toMatch(/if \(missing\.length > 0 && !input\.acceptMissingTypes\)/)
  })

  it('安装记录与磁盘对账（目录被手删后不再显示已安装）', () => {
    expect(SERVICE).toMatch(/reconciled|existsSync\(join\(installedWorkflowsDir\(\)/)
  })

  it('封面转 data URL（渲染层 CSP 不允许 https 图片直连）', () => {
    expect(SERVICE).toMatch(/data:image\/png;base64/)
  })
})

describe('IPC 与 preload 齐备', () => {
  it('五个通道都有声明与 handler', () => {
    for (const channel of [
      'WORKFLOW_MARKET_FETCH',
      'WORKFLOW_MARKET_COVER',
      'WORKFLOW_MARKET_INSTALL',
      'WORKFLOW_MARKET_UNINSTALL',
      'WORKFLOW_MARKET_INSTALLED',
      'WORKFLOW_MARKET_BUNDLE'
    ]) {
      expect(IPC, `ipc.ts 缺 ${channel}`).toContain(channel)
      expect(MAIN_IPC, `main/ipc.ts 未注册 ${channel}`).toContain(`IpcChannels.${channel}`)
      expect(PRELOAD, `preload 未转发 ${channel}`).toContain(`IpcChannels.${channel}`)
    }
  })

  it('失败走 ok:false + reasonKey，不抛异常（断网是常态）', () => {
    expect(IPC).toMatch(/reasonKey\?: string/)
    expect(IPC).toMatch(/stale\?: boolean/)
  })
})

describe('渲染层：「使用」走既有落盘链路', () => {
  it('workflowMarket 的 category 用于二级筛选，且只在该页签生效', () => {
    expect(VIEW).toContain('workflowCategory')
    expect(VIEW).toMatch(
      /if \(category\.value !== 'workflows' \|\| !workflowCategory\.value\) return/
    )
  })

  it('**市场不再负责「使用」**：落盘动作归 AI 对话（那里才有要做什么的上下文）', () => {
    // 市场只做安装 / 卸载；落盘链路不该留在这里
    expect(VIEW).not.toMatch(/planAiWorkflow\(/)
    expect(VIEW).not.toMatch(/commitAiWorkflow\(/)
    expect(VIEW).not.toContain('useMarketWorkflow')
    expect(VIEW).not.toContain('readWorkflowBundle')
    // 但要留下「去哪儿用」的指引，不能删得无声无息
    expect(VIEW).toContain('marketplace.workflows.useInChatHint')
  })

  it('市场窗口彻底不依赖工程（应用级功能）', () => {
    // 「使用」需要在工程内落盘，因此原先要判断 project.isOpen；该动作移走后不再需要
    expect(VIEW).not.toContain('useProjectStore')
    expect(VIEW).not.toMatch(/project\.isOpen/)
  })

  it('缺依赖时先确认再装（acceptMissingTypes 是显式逃生门）', () => {
    expect(VIEW).toMatch(/missingConfirm/)
    expect(VIEW).toMatch(/acceptMissingTypes: missing\.length > 0/)
  })

  it('封面懒加载且有上限（避免一屏几十个请求）', () => {
    expect(VIEW).toContain('COVER_LAZY_LIMIT')
    expect(VIEW).toMatch(/fetchWorkflowCover/)
  })

  it('失败时不清空已有条目（断网仍能看到上次目录）', () => {
    // 失败原因必须能翻译给用户（而不是主进程硬编码文案）
    expect(VIEW).toMatch(/marketplace\.workflows\.reason\./)
    // 失败分支里不得把 workflowEntries 置空
    const failBlock = VIEW.slice(
      VIEW.indexOf('if (!result.ok) {'),
      VIEW.indexOf('workflowEntries.value = result.entries')
    )
    expect(failBlock).not.toMatch(/workflowEntries\.value = \[\]/)
  })

  it('**每次打开市场窗口都强制刷新目录**（产品要求）', () => {
    // onMounted 里必须传 force，否则回到 1 小时 TTL、用户得等或手点刷新
    const mountBlock = VIEW.slice(VIEW.indexOf('onMounted(async () => {'))
    expect(mountBlock).toMatch(/await loadWorkflowCatalog\(true\)/)
  })

  it('首次加载中不显示「共 0 条」（这个误解真实发生过）', () => {
    expect(VIEW).toContain('workflowLoading')
    // 模板里 loading 分支必须排在计数提示之前
    const hintAt = VIEW.indexOf('marketplace.workflows.sourceHint')
    const loadingAt = VIEW.indexOf('marketplace.workflows.loading')
    expect(loadingAt).toBeGreaterThan(0)
    expect(loadingAt).toBeLessThan(hintAt)
  })

  it('刷新失败但手上有旧内容时用软提示，不把列表顶掉', () => {
    expect(VIEW).toContain('workflowRefreshFailed')
    expect(VIEW).toContain('marketplace.workflows.refreshFailed')
    expect(VIEW).toMatch(/if \(workflowEntries\.value\.length > 0\)/)
  })

  it('**安装 / 使用 / 卸载在卡片上**，不必展开详情即可操作', () => {
    const detailAt = VIEW.indexOf('class="mp-detail"')
    expect(detailAt, '模板里应当有详情块').toBeGreaterThan(0)

    for (const action of ['installMarketWorkflow(card)', 'uninstallMarketWorkflow(card)']) {
      const at = VIEW.indexOf(action)
      expect(at, `${action} 应当出现在卡片动作行里`).toBeGreaterThan(0)
      expect(at, `${action} 必须在详情块**之前**（即卡片上）`).toBeLessThan(detailAt)
    }
  })

  it('同一动作只留一处（详情里不再重复一套按钮）', () => {
    // 两处各有一套会让「界面显示的状态」与「实际能点的」出现分叉。
    //
    // 注意用词边界计数：`installMarketWorkflow` 是 `uninstallMarketWorkflow` 的**子串**，
    // 直接 `split().length - 1` 会把卸载按钮也算成安装按钮（这个坑真的踩了一次）。
    const countWord = (needle: string): number =>
      VIEW.match(new RegExp(`(?<![A-Za-z])${needle.replace(/[()]/g, '\\$&')}`, 'g'))?.length ?? 0

    for (const action of ['installMarketWorkflow(card)', 'uninstallMarketWorkflow(card)']) {
      expect(countWord(action), `${action} 应当只出现 1 次`).toBe(1)
    }
  })
})

describe('远端缓存按源隔离', () => {
  it('磁盘缓存文件名带源指纹', () => {
    expect(PIPELINE).toContain('catalogPathFor')
    // 归一化的共享文件名不得再出现（它曾让镜像的缓存被当成主源的）
    expect(PIPELINE).not.toMatch(/catalogPath\b/)
  })

  it('新鲜数据优先于过期数据（逐源试完再退回 stale）', () => {
    expect(SERVICE).toContain('bestStale')
    expect(SERVICE).toMatch(/if \(!result\.stale\) \{/)
    expect(SERVICE).toMatch(/if \(!bestStale\) bestStale = view/)
  })

  it('上次成功的源落盘记住（跨重启不先撞死源）', () => {
    expect(SERVICE).toContain('preferred-source.json')
    expect(SERVICE).toContain('writePreferredSource')
    // 派生事实存缓存目录，不写回用户设置
    expect(SERVICE).not.toMatch(/settingsService\.set\(/)
  })
})
