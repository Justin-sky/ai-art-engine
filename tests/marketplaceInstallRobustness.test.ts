import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 市场「安装」按钮**不能静默失效**。
 *
 * 起因是一个真实报障：点安装「完全没反应、也没有任何提示」。查下来安装链路在主进程里是通的
 *（端到端跑过：目录 → 安装 → 技能落盘 → 记账），所以问题只可能在渲染层把点击**静默吞掉**。
 * 当时有三处都能造成这种表现，且都不报错：
 *
 * 1. `if (installingId.value) return` —— 任意一张卡在装（尤其卡在安装后重新拉目录，
 *    最坏要等每个市场源各自超时）时，**其它所有卡**的安装按钮都会静默失效；
 * 2. 两个 `window.confirm` 在 `try` **之外** —— 弹窗一旦被宿主拒绝而抛错，
 *    异常直接从 async 函数逃出去：按钮不变、没有提示、`installingId` 也没设上；
 * 3. `await loadWorkflowCatalog(true)` 在 `try` 内、`finally` 之前 —— 刷新慢就把按钮
 *    长时间锁在「安装中…」。
 *
 * 这三条现在都被钉住。任何一条被改回去，「点了没反应」就会复发且依然**不会报错**。
 */
const VIEW = readFileSync(resolve('src/renderer/src/views/MarketplaceView.vue'), 'utf8')

/** 截取一个顶层函数体（到下一个顶层注释块为止） */
/**
 * 取一个函数的**完整函数体**。
 *
 * 早先是切到下一个 `/**` 为止 —— 两个函数之间没有文档注释时，它会把**下一个函数**也切进来，
 * 于是「断言 A 里有 X」可能被 B 里的 X 满足：给 `installMarketWorkflow` 断言封面缓存失效时，
 * 就真的被 `uninstallMarketWorkflow` 里那一句骗过去了（变异测试才发现的）。
 * 现在按花括号配对取，并跳过字符串/模板串里的括号。
 */
function fnBody(name: string): string {
  const at = VIEW.indexOf(`async function ${name}`)
  expect(at, `应当能找到 ${name}`).toBeGreaterThan(-1)
  let depth = 0
  let quote: string | null = null
  for (let i = VIEW.indexOf('{', at); i < VIEW.length; i += 1) {
    const c = VIEW[i]
    if (quote) {
      if (c === '\\') i += 1
      else if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') quote = c
    else if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) return VIEW.slice(at, i + 1)
    }
  }
  return VIEW.slice(at)
}

describe('安装：点击不会被静默吞掉', () => {
  it('只挡同一张卡的重复点击，不封杀其它卡', () => {
    const body = fnBody('installMarketWorkflow')
    expect(body).toContain('installingId.value === id')
    // 旧的全局闸门：任意一张卡在装，其它卡点了也毫无反应
    expect(body).not.toContain('if (!id || installingId.value) return')
  })

  it('两个确认框都在 try 里（弹窗实现抛错要变成一句报错，而不是消失）', () => {
    const body = fnBody('installMarketWorkflow')
    const tryAt = body.indexOf('try {')
    const confirmAt = body.indexOf('await promptConfirm(')
    const ipcAt = body.indexOf('installWorkflowMarket(')
    expect(tryAt, '应当有 try').toBeGreaterThan(-1)
    expect(confirmAt).toBeGreaterThan(-1)
    // 确认发生在 try 内、且早于发起安装
    expect(confirmAt, '确认必须在 try 内').toBeGreaterThan(tryAt)
    expect(confirmAt, '确认必须早于发起安装').toBeLessThan(ipcAt)
  })

  it('安装后的目录刷新是**静默**的，不点亮「刷新目录」按钮', () => {
    /*
      报障：点安装/重新安装时，顶部的「刷新目录」按钮自己转起来了。
      因为那一版把安装后的重新拉目录放在清除安装态之后，而 `loadWorkflowCatalog`
      无条件点亮 `workflowRefreshing` —— 而那个状态**就是**刷新按钮的文字与禁用态。
      后台刷新借用了"用户按了刷新"的状态表达，把动作归属搞错了。
    */
    const body = fnBody('installMarketWorkflow')
    expect(body).toContain('await loadWorkflowCatalog(true, { silent: true })')
    // 静默刷新要发生在清除安装态之前：安装进度由安装按钮表达，不借刷新按钮
    expect(body.indexOf('await loadWorkflowCatalog(true, { silent: true })')).toBeLessThan(
      body.indexOf('installingId.value = null')
    )
  })

  it('「刷新目录」按钮自己仍然走非静默刷新', () => {
    /*
      用户手动刷新时，按钮该转就要转 —— 静默只用于后台刷新。
      手动那次现在多走一层 `refreshWorkflowCatalog()`（它顺手丢掉封面缓存，见下一条），
      所以这里断言的是**那条路径**，而不是模板里直接写 loadWorkflowCatalog。
    */
    expect(VIEW).toContain('@click="refreshWorkflowCatalog()"')
    const refresh = VIEW.slice(VIEW.indexOf('async function refreshWorkflowCatalog'))
    const refreshBody = refresh.slice(0, refresh.indexOf('\n}'))
    expect(refreshBody, '手动刷新必须是非静默的').toContain('loadWorkflowCatalog(true)')
    expect(refreshBody, '手动刷新不能走 silent').not.toContain('silent')

    const body = VIEW.slice(VIEW.indexOf('async function loadWorkflowCatalog'))
    expect(body).toContain('if (!options.silent) workflowRefreshing.value = true')
    expect(body).toContain('if (!options.silent) workflowRefreshing.value = false')
  })

  it('封面缓存有失效路径：装 / 卸 / 手动刷新都不该继续显示旧封面', () => {
    /*
      两份缓存都要清才有效：渲染层 `workflowCovers` 只拉「还没有封面」的条目，
      主进程另有 `coverMemo`。只清一边，用户看到的现象就是「重装了还是没有封面」
      —— 而这正是 15 条官方封面从 1×1 占位图换成真图之后踩到的。
    */
    expect(VIEW).toContain('function invalidateCovers(')
    expect(fnBody('installMarketWorkflow'), '装完要丢掉这条的封面缓存').toContain(
      'invalidateCovers([id])'
    )
    expect(fnBody('uninstallMarketWorkflow'), '卸完要丢掉这条的封面缓存').toContain(
      'invalidateCovers([id])'
    )
    // 手动刷新要丢全部：用户按这个按钮就是要重新去远端拿一遍
    const refresh = VIEW.slice(VIEW.indexOf('async function refreshWorkflowCatalog'))
    expect(refresh.slice(0, refresh.indexOf('\n}'))).toContain('invalidateCovers()')
  })

  it('卸载后的刷新同样是静默的', () => {
    expect(fnBody('uninstallMarketWorkflow')).toContain(
      'await loadWorkflowCatalog(true, { silent: true })'
    )
  })

  it('卸载的确认框同样在 try 里', () => {
    const body = fnBody('uninstallMarketWorkflow')
    const tryAt = body.indexOf('try {')
    const confirmAt = body.indexOf('await promptConfirm(')
    expect(tryAt).toBeGreaterThan(-1)
    expect(confirmAt).toBeGreaterThan(tryAt)
  })
})

describe('市场一律用应用自己的弹窗，不用原生的系统对话框', () => {
  it('视图里没有 window.confirm（原生弹窗样式与应用无关，也不跟主题走）', () => {
    // 卸载（删除）曾用 window.confirm，弹出来是 Chromium 的系统对话框，与卡片完全不是一个样式
    const code = VIEW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    expect(code).not.toContain('window.confirm')
    expect(code).not.toContain('window.alert')
  })

  it('确认统一走 promptConfirm（它的正文支持换行，脚本清单才列得下）', () => {
    expect(VIEW).toContain("import { promptConfirm } from '../composables/useStudioPrompt'")
    expect(VIEW).toContain('await promptConfirm({')
  })

  it('删除类操作都确认过：卸载工作流 / 删除外部服务', () => {
    for (const fn of ['uninstallMarketWorkflow', 'removeServer']) {
      expect(fnBody(fn), `${fn} 应当有确认`).toContain('await promptConfirm({')
    }
  })
})
