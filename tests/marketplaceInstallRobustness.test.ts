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
function fnBody(name: string): string {
  const at = VIEW.indexOf(`async function ${name}`)
  expect(at, `应当能找到 ${name}`).toBeGreaterThan(-1)
  const end = VIEW.indexOf('\n/**', at)
  return VIEW.slice(at, end > at ? end : undefined)
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

  it('重新拉目录在安装态清除之后（刷新慢不该锁住按钮）', () => {
    const body = fnBody('installMarketWorkflow')
    const clearAt = body.indexOf('installingId.value = null')
    const reloadAt = body.indexOf('await loadWorkflowCatalog(true)')
    expect(clearAt).toBeGreaterThan(-1)
    expect(reloadAt).toBeGreaterThan(-1)
    expect(reloadAt, '刷新目录必须在清除安装态之后').toBeGreaterThan(clearAt)
  })

  it('刷新目录失败不会被当成安装失败', () => {
    const body = fnBody('installMarketWorkflow')
    const reloadAt = body.indexOf('await loadWorkflowCatalog(true)')
    const tail = body.slice(reloadAt)
    // 刷新那一步要有自己的 catch，不能落进上面的 catch（那会把「已安装」翻成报错）
    expect(tail).toContain('catch')
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
