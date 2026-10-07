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

  it('选中后把引用插入输入框（走既有插入逻辑，不另造一套）', () => {
    const fn = CHAT.slice(
      CHAT.indexOf('function insertWorkflowReference'),
      CHAT.indexOf('function insertWorkflowReference') + 900
    )
    /*
      这里曾断言 `insertPlainText(text)`。后来改成插入**引用块**（胶囊）——
      摊开成一段文本会把「标题 + id + 简介」整段塞进输入框，剩不下地方写要求。
      插入仍然复用既有的光标插入逻辑（`insertWorkflowChip`，与 `insertMentionNode` 同源）。
    */
    expect(fn).toContain('insertWorkflowChip(workflow)')
    // 插入后收起面板
    expect(fn).toMatch(/workflowsOpen\.value = false/)
  })

  it('引用文本带 id（Agent 靠它精确复现，而不是拿描述重新规划）', () => {
    /*
      id 仍在，只是**组装位置**搬到了 `createWorkflowChipNode`（引用块把完整文本存在
      `dataset.workflowText` 上，序列化时原样取出）。断言跟着搬家，但这条不变量的分量没变：
      id 丢了 Agent 就会改去"重新规划一个差不多的"，而界面上看不出任何异常。
      （更完整的端到端守卫见「插入工作流显示成引用块」那组。）
    */
    const fn = CHAT.slice(
      CHAT.indexOf('function createWorkflowChipNode'),
      CHAT.indexOf('function insertWorkflowChip')
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

describe('插入工作流显示成引用块（胶囊），而不是摊开成一段文本', () => {
  /** 取一个函数体（到下一个顶层注释块为止） */
  function fnBody(name: string): string {
    const at = CHAT.indexOf(`function ${name}`)
    expect(at, `应当能找到 ${name}`).toBeGreaterThan(-1)
    const end = CHAT.indexOf('\n/**', at)
    return CHAT.slice(at, end > at ? end : undefined)
  }

  it('插入走引用块而不是纯文本', () => {
    const body = fnBody('insertWorkflowReference')
    expect(body).toContain('insertWorkflowChip(workflow)')
    // 摊开成文本正是这次要改掉的形态：标题 + id + 简介会占掉大半个输入框
    expect(body).not.toContain('insertPlainText(')
  })

  it('**序列化后端到端不变**：引用块仍还原出含 id 的完整文本', () => {
    /*
      这是本次改动最容易出错、也最难发现的地方：外观从一段文本变成一个小胶囊，
      但送给模型的文本必须逐字不变 —— Agent 靠 id 调 `workflow_use_installed`
      精确复现工作流；id 一旦丢了，它就会改去"重新规划一个差不多的"，
      而界面上看不出任何异常。
    */
    const editorText = CHAT.slice(
      CHAT.indexOf('function editorText'),
      CHAT.indexOf('function syncDraftFromEditor')
    )
    expect(editorText, 'editorText 必须认识引用块').toContain(
      "classList.contains('editor-workflow-chip')"
    )
    expect(editorText, '并且返回存在节点上的完整文本').toContain('dataset.workflowText')

    // 那段完整文本由 workflowInsert 模板产出，模板里必须有 id
    const chip = fnBody('createWorkflowChipNode')
    expect(chip).toContain(
      "t('studio.chat.workflowInsert', { title: workflow.title, id: workflow.id })"
    )
    expect(chip).toContain('chip.dataset.workflowText = text')
    // 悬停要能看到 id 与简介，否则用户只看到一个标题
    expect(chip).toContain('chip.title = text')
  })

  it('胶囊带图标与标题、且不可编辑（整块一起删）', () => {
    const chip = fnBody('createWorkflowChipNode')
    expect(chip).toContain("chip.className = 'editor-workflow-chip'")
    expect(chip).toContain("icon.className = 'editor-workflow-icon'")
    expect(chip).toContain("label.className = 'editor-workflow-label'")
    expect(chip).toContain('label.textContent = workflow.title')
    expect(chip).toContain("chip.contentEditable = 'false'")
  })

  it('样式是胶囊（圆角 999px），并带悬停强调', () => {
    const css = CHAT.slice(CHAT.indexOf('.editor-workflow-chip {'))
    const block = css.slice(0, css.indexOf('.editor-workflow-label'))
    expect(block).toContain('border-radius: 999px')
    expect(block).toContain('inline-flex')
    expect(block).toContain('var(--accent)')
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

  it('新建会话是**纯图标**按钮，且仍有无障碍名称', () => {
    const at = CHAT.indexOf('class="tool-btn icon-only"')
    expect(at, '新建会话应当用 icon-only 样式').toBeGreaterThan(0)
    const button = CHAT.slice(at, at + 500)
    expect(button).toContain('onNewSession')
    // 图标按钮没有可见文字，含义只能靠 title / aria-label —— 两者都必须有
    expect(button).toMatch(/:title="t\('studio\.chat\.newSession'\)"/)
    expect(button).toMatch(/:aria-label="t\('studio\.chat\.newSession'\)"/)
    // 不该再渲染文字
    expect(button).not.toMatch(/\{\{\s*t\('studio\.chat\.newSession'\)\s*\}\}/)
  })

  it('**基础 .tool-btn 规则不得再限定在 chat-toolbar 下**', () => {
    // 原先只有 `.chat-toolbar .tool-btn`，于是落在 chat-actions 里的「新建」
    // 完全没有样式，一直是浏览器默认按钮外观
    expect(CHAT).toMatch(/\n\.tool-btn \{/)
    expect(CHAT).not.toMatch(/\n\.chat-toolbar \.tool-btn \{/)
    // icon-only 的尺寸规则也要在
    expect(CHAT).toMatch(/\n\.tool-btn\.icon-only \{/)
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

  it('触发器是紧凑的「历史」按钮，不再吸收剩余宽度（那部分让给模型名）', () => {
    const block = CHAT.slice(
      CHAT.indexOf('.chat-actions .session-dropdown'),
      CHAT.indexOf('.chat-actions .session-dropdown') + 240
    )
    expect(block).toMatch(/flex:\s*none/)
    // 不该再有「按标题撑开」的宽度设定 —— 标题已经移到面板顶部
    expect(block).not.toMatch(/flex:\s*0 1 \d+px/)
  })

  it('触发器显示的是「历史会话」而不是当前标题', () => {
    const at = CHAT.indexOf('class="session-trigger-label"')
    const block = CHAT.slice(at, at + 200)
    expect(block).toContain("t('studio.chat.sessionSelect')")
    // 当前标题不该再出现在触发器里
    expect(block).not.toContain('activeSession?.title')
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

  it('**菜单宽度必须独立于触发器**（跟随它会缩成按钮那么窄）', () => {
    const menu = CHAT.slice(CHAT.indexOf('.session-menu {'))
    // 必须剥掉注释再匹配：注释里为了说明这个陷阱，恰好写了 `right: 0` 这几个字
    const block = menu.slice(0, 400).replace(/\/\*[\s\S]*?\*\//g, '')
    // 必须有显式宽度
    expect(block).toMatch(/width:\s*\d+px/)
    /*
      且**不能**同时用 `right: 0`：触发器现在只有约 60px 宽（「历史会话」+ 箭头），
      `left: 0; right: 0` 会把列表压到和按钮一样窄，标题全被截掉。
      这是本次改动最容易回归的点。
    */
    expect(block).not.toMatch(/right:\s*0/)
  })

  it('spacer 仍必须是 flex: 1（它把「环 + @」那一组推到行尾）', () => {
    const css = CHAT.slice(CHAT.indexOf('.chat-toolbar .toolbar-spacer'))
    expect(css.slice(0, 240)).toMatch(/flex:\s*1/)
  })
})

describe('技能 / 工作流触发器只显示图标', () => {
  it('两个触发器都不再渲染文字标签', () => {
    expect(CHAT).not.toContain('skills-label')
    // 也不该用其它方式把可见文案塞进触发器
    for (const key of ["t('studio.chat.skills')", "t('studio.chat.workflows')"]) {
      const at = CHAT.indexOf(key)
      expect(at, `${key} 仍应作为无障碍名称存在`).toBeGreaterThan(0)
      // 只出现在 :aria-label 里，不出现在可见文本插值中
      expect(CHAT.slice(at - 20, at), `${key} 不该出现在可见文本里（应改为 aria-label）`).toContain(
        'aria-label'
      )
    }
  })

  it('图标按钮必须有无障碍名称（否则读屏只会念「按钮」）', () => {
    expect(CHAT).toMatch(/:aria-label="t\('studio\.chat\.skills'\)"/)
    expect(CHAT).toMatch(/:aria-label="t\('studio\.chat\.workflows'\)"/)
    // 悬浮说明也保留
    expect(CHAT).toContain('studio.chat.skillsTitle')
    expect(CHAT).toContain('studio.chat.workflowsTitle')
  })

  it('`.skills-label` 样式规则已删除（不留死规则）', () => {
    expect(CHAT).not.toMatch(/\n\.skills-label\s*\{/)
  })

  it('触发器按图标按钮设尺寸，且徽标宽度不撑破', () => {
    const css = CHAT.slice(CHAT.indexOf('\n.skills-trigger {'))
    const block = css.slice(0, 400).replace(/\/\*[\s\S]*?\*\//g, '')
    expect(block).toMatch(/min-width:\s*26px/)
    expect(block).toMatch(/height:\s*26px/)
    // 徽标用 min-width 而不是固定宽，多位数也不会撑歪
    const badge = CHAT.slice(CHAT.indexOf('\n.skills-badge {'))
    expect(badge.slice(0, 200)).toMatch(/min-width:/)
  })
})

describe('/workflow 斜杠指令', () => {
  it('指令已注册且带 i18n 描述键', () => {
    expect(CHAT).toMatch(/id: 'workflow', name: '\/workflow', descKey: 'slashWorkflowDesc'/)
    // 类型联合也要放开，否则 TS 会拒绝新增的 id / descKey
    expect(CHAT).toMatch(/id: 'clear' \| 'model' \| 'workflow'/)
    expect(CHAT).toMatch(/'slashClearDesc' \| 'slashModelDesc' \| 'slashWorkflowDesc'/)
  })

  it('applySlashCommand 会分发到 onWorkflowCommand', () => {
    const at = CHAT.indexOf('async function applySlashCommand')
    const fn = CHAT.slice(at, at + 700)
    expect(fn).toMatch(/cmd\.id === 'workflow'/)
    expect(fn).toContain('onWorkflowCommand()')
  })

  it('**复用同一个已安装工作流面板**，不另造一份列表', () => {
    const at = CHAT.indexOf('async function onWorkflowCommand')
    expect(at, 'onWorkflowCommand 应当存在').toBeGreaterThan(0)
    const fn = CHAT.slice(at, at + 900)
    expect(fn).toContain('refreshInstalledWorkflows()')
    expect(fn).toMatch(/workflowsOpen\.value = true/)
    // 不该出现第二套列表数据源
    expect(CHAT).not.toContain('slashWorkflows')
  })

  it('没有已装工作流时给出提示，而不是静默打开空面板', () => {
    const at = CHAT.indexOf('async function onWorkflowCommand')
    const fn = CHAT.slice(at, at + 900)
    expect(fn).toMatch(/if \(!installedWorkflows\.value\.length\)/)
    expect(fn).toContain('pushStatus(')
    expect(fn).toContain('studio.chat.workflowsEmpty')
  })

  it('打开前会收起其它下拉（避免两个面板叠着）', () => {
    const at = CHAT.indexOf('async function onWorkflowCommand')
    const fn = CHAT.slice(at, at + 900)
    for (const menu of ['modeOpen', 'sessionOpen', 'skillsOpen', 'modelOpen']) {
      expect(fn, `应当收起 ${menu}`).toMatch(new RegExp(`${menu}\\.value = false`))
    }
  })

  it('两个语言都有该描述键', () => {
    const zh = read('src/renderer/src/i18n/locales/zh-CN.ts')
    const en = read('src/renderer/src/i18n/locales/en-US.ts')
    expect(zh).toContain('slashWorkflowDesc:')
    expect(en).toContain('slashWorkflowDesc:')
  })
})

describe('模型上下文环与引用资产按钮同行', () => {
  it('两者在同一个 `.toolbar-end` 单元里（因此不会被折到两行）', () => {
    const groupAt = CHAT.indexOf('class="toolbar-end"')
    expect(groupAt, '工具行末尾应当有一个不可拆分的单元').toBeGreaterThan(0)
    // 取到该单元闭合（`</div>` 之后紧跟工具栏闭合）
    const group = CHAT.slice(groupAt, CHAT.indexOf('</div>\n      </div>', groupAt))
    expect(group, '用量环应在单元内').toContain('class="context-usage"')
    expect(group, '引用资产按钮应在单元内').toContain('class="tool-btn mention"')
    // 顺序：环在 @ 左边
    expect(group.indexOf('class="context-usage"')).toBeLessThan(
      group.indexOf('class="tool-btn mention"')
    )
  })

  it('单元必须是 `flex: none`（自己是一个整体，不与环/@ 各自换行）', () => {
    const css = CHAT.slice(CHAT.indexOf('.chat-toolbar .toolbar-end'))
    const block = css.slice(0, 240)
    expect(block).toMatch(/display:\s*flex/)
    expect(block).toMatch(/flex:\s*none/)
  })

  it('工具栏确实会换行 —— 这正是必须包成一个单元的原因', () => {
    const css = CHAT.slice(CHAT.indexOf('.chat-toolbar {'))
    expect(css.slice(0, 160)).toMatch(/flex-wrap:\s*wrap/)
  })

  it('**只此一处**（移走时不能留下旧的）', () => {
    expect(CHAT.split('class="context-usage"').length - 1).toBe(1)
  })

  it('不再出现在 composer 下面的那一行（模型选择器 / 发送键之间）', () => {
    const actionsAt = CHAT.indexOf('class="chat-actions"')
    const actions = CHAT.slice(actionsAt, CHAT.indexOf('</template>', actionsAt))
    expect(actions).not.toContain('class="context-usage"')
  })

  it('工具栏里的尺寸按按钮尺度收一档（否则把工具栏顶高）', () => {
    const scoped = CHAT.slice(CHAT.indexOf('.chat-toolbar .ctx-ring'))
    expect(scoped.slice(0, 300)).toMatch(/width:\s*24px/)
  })
})

describe('当前会话标题显示在面板最上方', () => {
  it('标题在 chat-status 内，且排在状态点之前（即面板顶部最左）', () => {
    const statusAt = CHAT.indexOf('class="chat-status"')
    const titleAt = CHAT.indexOf('class="chat-session-title"')
    const dotAt = CHAT.indexOf('class="dot"')
    expect(statusAt).toBeGreaterThan(0)
    expect(titleAt).toBeGreaterThan(statusAt)
    expect(dotAt).toBeGreaterThan(titleAt)
  })

  it('在消息区**之前**（确实是面板顶部，不是底部工具栏）', () => {
    const titleAt = CHAT.indexOf('class="chat-session-title"')
    const messagesAt = CHAT.indexOf('class="chat-messages-wrap"')
    expect(messagesAt).toBeGreaterThan(titleAt)
  })

  it('长标题可收缩 + ellipsis，且有 max-width 不挤掉状态信息', () => {
    const css = CHAT.slice(CHAT.indexOf('.chat-status .chat-session-title'))
    const block = css.slice(0, 400)
    expect(block).toMatch(/text-overflow:\s*ellipsis/)
    expect(block).toMatch(/min-width:\s*0/)
    expect(block).toMatch(/max-width:\s*\d+%/)
  })

  it('只此一处显示当前标题（触发器里不再重复）', () => {
    // 模板里标题只渲染一次
    expect(CHAT.split('class="chat-session-title"').length - 1).toBe(1)

    const at = CHAT.indexOf('class="chat-session-title"')
    const block = CHAT.slice(at, at + 260)
    // `v-if="activeSession"` 守着，所以这里用的是非可选链访问
    expect(block).toContain('activeSession.title')

    // 触发器里不得再出现当前标题（它只显示「历史会话」）
    const triggerAt = CHAT.indexOf('class="session-trigger-label"')
    const trigger = CHAT.slice(triggerAt, triggerAt + 200)
    expect(trigger).not.toContain('activeSession')
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
