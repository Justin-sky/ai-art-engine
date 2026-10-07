import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 对话里的「工作流」入口与对应的 Agent 工具。
 *
 * 这两半必须同时存在：面板插进输入框的是一句**引用**（标题 + id），
 * 真正把它变成工程内资产的是 Agent 侧的 `workflow_use_installed`。
 * 少任何一半，插入的内容都是死文本 —— 用户发了消息却什么也不会发生。
 */
const read = (...parts: string[]): string => readFileSync(resolve(...parts), 'utf8')

const CHAT = read('src/renderer/src/components/ChatPanel.vue')
const MCP = read('src/main/services/mcpServerService.ts')
const SERVICE = read('src/main/services/workflowMarketService.ts')
const IPC = read('src/shared/ipc.ts')

describe('对话面板：工作流入口', () => {
  it('触发按钮在技能旁边（同一个工具栏区块内）', () => {
    const toolbarAt = CHAT.indexOf('class="chat-toolbar"')
    const skillsAt = CHAT.indexOf('ref="skillsDropdownRef"')
    const workflowsAt = CHAT.indexOf('ref="workflowsDropdownRef"')
    expect(toolbarAt).toBeGreaterThan(0)
    expect(skillsAt).toBeGreaterThan(toolbarAt)
    expect(workflowsAt).toBeGreaterThan(skillsAt)
  })

  it('面板列的是**已安装**工作流，不是内置预设', () => {
    expect(CHAT).toContain('listInstalledWorkflows()')
    // 不该去拉远端目录：这是本机已装内容的入口
    expect(CHAT).not.toContain('fetchWorkflowMarket')
  })

  it('每次打开面板都重新拉（刚在市场装完就能看到）', () => {
    const toggle = CHAT.slice(CHAT.indexOf('function toggleWorkflows'))
    expect(toggle).toMatch(/void refreshInstalledWorkflows\(\)/)
  })

  it('选中后把引用插入输入框（走既有 insertPlainText，不另造插入逻辑）', () => {
    const fn = CHAT.slice(
      CHAT.indexOf('function insertWorkflowReference'),
      CHAT.indexOf('function insertWorkflowReference') + 700
    )
    expect(fn).toContain('insertPlainText(text)')
    // 插入后收起面板
    expect(fn).toMatch(/workflowsOpen\.value = false/)
  })

  it('引用文本带 id（Agent 靠它精确复现，而不是拿描述重新规划）', () => {
    const fn = CHAT.slice(
      CHAT.indexOf('function insertWorkflowReference'),
      CHAT.indexOf('function insertWorkflowReference') + 700
    )
    expect(fn).toMatch(/id: workflow\.id/)
    expect(fn).toContain("t('studio.chat.workflowInsert'")
  })

  it('包损坏的条目不插入引用，并说明原因', () => {
    const fn = CHAT.slice(
      CHAT.indexOf('function insertWorkflowReference'),
      CHAT.indexOf('function insertWorkflowReference') + 900
    )
    // 损坏的必须**提前返回**：否则会往输入框里放一句 Agent 用不了的引用
    expect(fn).toMatch(/if \(workflow\.broken\) return/)
    // 视觉与文案上也要能看出它不可用
    expect(CHAT).toContain('workflow-card')
    expect(CHAT).toMatch(/workflow\.broken/)
    expect(CHAT).toContain('studio.chat.workflowBroken')
  })

  it('点击外部 / ESC 也能收起（与其余下拉一致）', () => {
    const outside = CHAT.slice(CHAT.indexOf('function onModeOutside'))
    expect(outside).toMatch(/workflowsOpen\.value = false/)
    expect(outside).toMatch(/workflowsDropdownRef\.value/)
  })
})

describe('会话管理与模型同一行', () => {
  it('会话控件在 chat-actions（模型所在的那一行）内，且在模型之前', () => {
    const actionsAt = CHAT.indexOf('class="chat-actions"')
    const sessionAt = CHAT.indexOf('class="session-dropdown"')
    const modelAt = CHAT.indexOf('class="model-select-wrap"')
    expect(actionsAt).toBeGreaterThan(0)
    expect(sessionAt).toBeGreaterThan(actionsAt)
    expect(modelAt).toBeGreaterThan(sessionAt)
    // 与模型同属一行：两者之间不能再有行容器（composer 之后才轮到这一行）
    const composerAt = CHAT.indexOf('class="composer"')
    expect(composerAt).toBeLessThan(actionsAt)
  })

  it('删除不再占工具栏位置（那一行只剩 新建）', () => {
    // 会话下拉**之后**到模型选择器之间，就是原来放删除按钮的位置
    const afterDropdown = CHAT.slice(
      CHAT.indexOf("t('studio.chat.newSession')"),
      CHAT.indexOf('class="model-select-wrap"')
    )
    expect(afterDropdown).toContain('onNewSession')
    expect(afterDropdown).not.toContain('onDeleteSessionById')
    // 旧按钮独有的显式标记不该残留
    expect(CHAT).not.toContain('v-if="sessions.length > 1"')
  })

  it('删除做成会话列表里每一项后面的 ×', () => {
    const menuStart = CHAT.indexOf('class="session-menu"')
    const menuEnd = CHAT.indexOf('</ul>', menuStart)
    const menu = CHAT.slice(menuStart, menuEnd)
    expect(menu).toContain('session-item-remove')
    expect(menu).toMatch(/onDeleteSessionById\(s\.id\)/)
  })

  it('**按钮不能嵌套**：列表项是 li 里的两个并排按钮', () => {
    const menuStart = CHAT.indexOf('class="session-menu"')
    const menuEnd = CHAT.indexOf('</ul>', menuStart)
    const menu = CHAT.slice(menuStart, menuEnd)
    const liStart = menu.indexOf('class="session-list-item"')
    const liEnd = menu.indexOf('</li>', liStart)
    const li = menu.slice(liStart, liEnd)
    // 一个 li 里恰好两个 <button，且互不包含（靠 </button> 的出现顺序与数量判断）
    const opens = li.split('<button').length - 1
    const closes = li.split('</button>').length - 1
    expect(opens, '列表项里应当是两个按钮').toBe(2)
    expect(closes).toBe(2)
    // `button` 内不得再出现 `button`：以第一个 </button> 为界，其后才轮到第二个 <button
    const firstClose = li.indexOf('</button>')
    const secondOpen = li.indexOf('<button', li.indexOf('<button') + 1)
    expect(secondOpen).toBeGreaterThan(firstClose)
  })

  it('删的是当前会话才重载视图（删旁支不该清掉正在编辑的内容）', () => {
    const fn = CHAT.slice(
      CHAT.indexOf('async function onDeleteSessionById'),
      CHAT.indexOf('async function onDeleteSessionById') + 1400
    )
    expect(fn).toMatch(/const wasActive = id === activeId\.value/)
    expect(fn).toMatch(/if \(wasActive\) \{/)
    // 仍然要清理磁盘上的 dsh 持久化记录，避免幽灵恢复
    expect(fn).toContain('deleteHarnessSession')
  })

  it('确认弹窗后恢复列表展开状态（否则连着删几条每次都要重新展开）', () => {
    const fn = CHAT.slice(
      CHAT.indexOf('async function onDeleteSessionById'),
      CHAT.indexOf('async function onDeleteSessionById') + 1400
    )
    expect(fn).toMatch(/const wasOpen = sessionOpen\.value/)
    expect(fn).toMatch(/sessionOpen\.value = wasOpen/)
  })

  it('工具栏里不再残留会话控件（防止两处都有）', () => {
    const toolbar = CHAT.slice(
      CHAT.indexOf('class="chat-toolbar"'),
      CHAT.indexOf('class="mention-chips"')
    )
    // 工具栏到 composer 之间不该再有会话下拉
    expect(toolbar).not.toContain('sessionDropdownRef')
  })

  it('**旧的独立行包装已移除**（否则会多出一整行高度）', () => {
    expect(CHAT).not.toContain('session-row')
  })

  it('会话下拉限宽，把剩余宽度让给模型名', () => {
    const css = CHAT.slice(CHAT.indexOf('.chat-actions .session-dropdown'))
    const block = css.slice(0, 240)
    expect(block).toMatch(/flex:\s*0 1 /)
    expect(block).toMatch(/min-width:/)

    /**
     * 宽度上限刻意钉住：用户先后要求 220px → 160px → 140px。
     * 断言上限而不是精确值，既守住意图，又不妨碍以后微调。
     */
    const basis = Number(block.match(/flex:\s*0 1 (\d+)px/)?.[1] ?? 0)
    expect(basis).toBeGreaterThan(0)
    expect(basis, '会话下拉不该被改回更宽').toBeLessThanOrEqual(150)
  })

  it('窄宽度要靠收紧内边距补偿 —— × 固定占 22px，不收紧标题就只剩几个字', () => {
    const menuPadding = Number(
      CHAT.slice(CHAT.indexOf('.session-menu {')).match(/padding:\s*(\d+)px/)?.[1] ?? 99
    )
    expect(menuPadding, '菜单内边距应当收紧').toBeLessThanOrEqual(4)

    /*
      锚点必须带换行：`.session-item {` 也是 `.session-list-item .session-item {` 的子串，
      直接 indexOf 会取到前者（那条规则只有 flex/width，没有 padding），断言会假失败。
      同样性质的坑在计数 `installMarketWorkflow` 时也踩过一次。
    */
    const itemStart = CHAT.indexOf('\n.session-item {')
    expect(itemStart, '应当能找到 .session-item 规则').toBeGreaterThan(0)
    const itemBlock = CHAT.slice(itemStart, itemStart + 400)

    const padMatch = itemBlock.match(/padding:\s*\d+px\s+(\d+)px/)
    expect(padMatch, '列表项应当有横向内边距声明').toBeTruthy()
    expect(Number(padMatch![1]), '列表项横向内边距应当收紧').toBeLessThanOrEqual(8)

    // 标签与图标的间距也要收紧（原为 10px）
    const gap = Number(itemBlock.match(/gap:\s*(\d+)px/)?.[1] ?? 99)
    expect(gap, '列表项间距应当收紧').toBeLessThanOrEqual(8)
  })

  it('会话菜单的 min-width 不超过触发器宽度（否则会横向溢出到面板外）', () => {
    const trigger = CHAT.slice(CHAT.indexOf('.chat-actions .session-dropdown'))
    const basis = Number(trigger.match(/flex:\s*0 1 (\d+)px/)?.[1] ?? 0)
    const menu = CHAT.slice(CHAT.indexOf('.session-menu {'))
    const minWidth = Number(menu.match(/min-width:\s*(\d+)px/)?.[1] ?? 0)
    expect(minWidth).toBeGreaterThan(0)
    expect(minWidth, '菜单最小宽度不该超过触发器').toBeLessThanOrEqual(basis)
  })

  it('spacer 仍必须是 flex: 1（会话下拉移走后它是唯一撑开「@」的元素）', () => {
    const css = CHAT.slice(CHAT.indexOf('.chat-toolbar .toolbar-spacer'))
    expect(css.slice(0, 240)).toMatch(/flex:\s*1/)
  })
})

describe('Agent 工具：能精确使用已安装工作流', () => {
  it('两个工具都注册了', () => {
    expect(MCP).toContain("name: 'workflow_list_installed'")
    expect(MCP).toContain("name: 'workflow_use_installed'")
  })

  it('列表工具来自已安装详情（含 broken 标记）', () => {
    expect(MCP).toContain('listInstalledWorkflowDetails()')
    expect(MCP).toMatch(/broken: item\.broken/)
  })

  it('使用工具按 id 读回**已装的那份**，而不是重新规划', () => {
    expect(MCP).toContain('readInstalledWorkflowPlan(id)')
    // 关键：useSeedOnly + seedPlan 走既有落盘链路，拓扑原样
    expect(MCP).toMatch(/useSeedOnly: true/)
    expect(MCP).toMatch(/seedPlan: installed\.bundle\.plan/)
    expect(MCP).toContain('commitAiWorkflow')
  })

  it('读取失败时给出明确错误（含 id 与原因键），不静默返回空', () => {
    const handler = MCP.slice(
      MCP.indexOf("name: 'workflow_use_installed'"),
      MCP.indexOf("name: 'video_job_list'")
    )
    expect(handler).toMatch(/throw new Error\(/)
    expect(handler).toContain('installed.reasonKey')
    expect(handler).toMatch(/assertProjectOpen\(\)/)
  })

  it('落盘后通知界面聚焦新资产（与 workflow_commit 一致）', () => {
    const handler = MCP.slice(
      MCP.indexOf("name: 'workflow_use_installed'"),
      MCP.indexOf("name: 'video_job_list'")
    )
    expect(handler).toContain('MCP_WORKFLOW_FOCUS')
    expect(handler).toContain('ASSET_UPDATED')
  })
})

describe('契约：已安装清单带上展示字段', () => {
  it('InstalledWorkflowRecordView 含标题 / 简介 / 规模 / 损坏标记', () => {
    const block = IPC.slice(IPC.indexOf('export interface InstalledWorkflowRecordView'))
    for (const field of ['title', 'summary', 'nodeCount', 'edgeCount', 'broken']) {
      expect(block.slice(0, 600), `缺字段 ${field}`).toContain(field)
    }
  })

  it('服务侧实现与契字段对齐（读包内 workflow.json 补齐）', () => {
    expect(SERVICE).toContain('listInstalledWorkflowDetails')
    expect(SERVICE).toMatch(/parseWorkflowBundle\(JSON\.parse\(readFileSync\(file/)
  })
})
