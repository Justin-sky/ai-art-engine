import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 「一键工作流」入口从顶栏移到工作区「新建」。
 *
 * 这个入口特殊：它**不创建资产**，而是打开预设选择对话框，而对话框的全部状态
 * （预设、模型、宽高比、预览）留在 `StudioView` —— 那份状态不能提到模块作用域，
 * 因为编排器内部要调用 Pinia store，模块加载期调用会失败。
 *
 * 因此是「工作区发请求信号 + StudioView 监听后打开」的两段式。
 * 这层间接一旦断掉，表现是**点了没反应**（没有报错），所以两端都要钉住。
 */
const read = (...parts: string[]): string => readFileSync(resolve(...parts), 'utf8')

/**
 * 剥离注释后再断言。
 *
 * 本文件多处用「源码里不得出现某标识符」来守边界，而**解释性注释里恰恰会写出那个标识符**
 * ——例如「不能引入 `useProjectStore`」这句注释本身就会让断言失败。
 * 这类假失败在本仓库已踩过三次（另两次是 `right: 0` 与 `installMarketWorkflow` 计数）。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

const STUDIO = read('src/renderer/src/views/StudioView.vue')
const WORKSPACE = read('src/renderer/src/components/WorkspaceMain.vue')
const BRIDGE = read('src/renderer/src/features/aiWorkflow/openRequest.ts')

describe('入口已从顶栏移走', () => {
  it('顶栏不再有「一键工作流」按钮', () => {
    // 按钮曾被渲染成 `{{ t('aiWorkflow.shortAction') }}`，现在只有工作区里有
    expect(STUDIO).not.toContain('aiWorkflow.shortAction')
    expect(STUDIO).not.toContain("t('aiWorkflow.title')")
  })

  it('对话框仍挂在 StudioView（状态与实例都没搬走）', () => {
    expect(STUDIO).toContain('AiCreateWorkflowDialog')
    expect(STUDIO).toContain('useAiCreateWorkflow')
  })
})

describe('请求信号把两端接起来', () => {
  it('信号模块只做传信，不引入 Pinia store', () => {
    expect(BRIDGE).toContain('aiWorkflowOpenRequest')
    expect(BRIDGE).toContain('requestAiWorkflowDialog')
    /*
      关键：它必须在模块作用域安全 —— 一旦 import 了 store，加载期调用就会炸。
      断言的是**代码**（剥离注释后）只从 vue 取 ref，而不是「文件里不能出现这个词」
      —— 注释里为了说明原因正好会写出 store 的名字。
    */
    const code = stripComments(BRIDGE)
    const imports = [...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])
    expect(imports).toEqual(['vue'])
    expect(code).not.toMatch(/useProjectStore|useGraphRunLogsStore/)
  })

  it('StudioView 监听信号并真的打开对话框', () => {
    expect(STUDIO).toContain('aiWorkflowOpenRequest')
    const at = STUDIO.indexOf('watch(aiWorkflowOpenRequest')
    expect(at, 'StudioView 应当监听该信号').toBeGreaterThan(0)
    expect(STUDIO.slice(at, at + 200)).toContain('openAiWorkflowDialog()')
  })

  it('工作区的点击会发出请求', () => {
    const at = WORKSPACE.indexOf('async function onCreate')
    const fn = WORKSPACE.slice(at, at + 900)
    expect(fn).toContain('requestAiWorkflowDialog()')
  })
})

describe('工作区「新建」条目', () => {
  it('条目排在最前（它是最省事的起步路径）', () => {
    const at = WORKSPACE.indexOf('const createItems = computed')
    const block = WORKSPACE.slice(at, at + 500)
    // 第一项就是 aiWorkflow，而不是排在四个资产条目之后
    expect(block.indexOf("kind: 'aiWorkflow'")).toBeLessThan(
      block.indexOf('listRegisteredToolbarItems')
    )
  })

  it('**不把 aiWorkflow 塞进工具栏注册表**（那里的条目都带 assetType）', () => {
    // 塞进去会让左侧工具栏也冒出这一项，而且占位 assetType 会被别的消费方当真
    expect(WORKSPACE).not.toMatch(/listRegisteredToolbarItems[\s\S]{0,200}aiWorkflow/)
    // 也不该出现在共享注册表里
    const shared = read('src/shared/workspaceToolbar.ts')
    expect(shared).not.toContain('aiWorkflow')
  })

  it('**onCreate 必须先按 kind 分支**，再访问 item（否则 aiWorkflow 条目没有 item）', () => {
    const at = WORKSPACE.indexOf('async function onCreate')
    // 同样要剥注释：解释这条约束的注释里就写着 `entry.item`
    const fn = stripComments(WORKSPACE.slice(at, at + 900))
    const branchAt = fn.indexOf("entry.kind === 'aiWorkflow'")
    const itemAt = fn.indexOf('const item = entry.item')
    expect(branchAt, '必须先判断 kind').toBeGreaterThan(-1)
    expect(itemAt, '应当通过 const item = entry.item 取值').toBeGreaterThan(-1)
    expect(branchAt, '分支必须早于取 item').toBeLessThan(itemAt)
    // 也不能在分支里就给 busyId 赋值（它没有 item.id）
    expect(branchAt).toBeLessThan(fn.indexOf('busyId.value ='))
  })

  it('图标 / 标签 / 提示都按 kind 分别取，不复用资产条目的字段', () => {
    expect(WORKSPACE).toMatch(/function createItemLabel\(entry: CreateEntry\)/)
    expect(WORKSPACE).toMatch(
      /if \(entry\.kind === 'aiWorkflow'\) return t\('aiWorkflow\.shortAction'\)/
    )
    expect(WORKSPACE).toMatch(/function createItemIcon\(entry: CreateEntry\)/)
    expect(WORKSPACE).toMatch(/function createItemTooltip\(entry: CreateEntry\)/)
  })

  it('模板用 entry 而不是 item 渲染（字段已不再是同一个形状）', () => {
    expect(WORKSPACE).toContain('v-for="entry in createItems"')
    expect(WORKSPACE).toContain('createItemIcon(entry)')
    expect(WORKSPACE).toContain('createItemLabel(entry)')
  })
})

describe('文档与入口位置一致', () => {
  const DOCS = [
    'README.md',
    'website/manual.html',
    'website/manual-workspace.html',
    'website/manual-workflow.html',
    'website/quickstart.html',
    'website/guide-short-video.html',
    'website/tutorial-script/shortdrama-agent-tutorial-script.md',
    'website/tutorial-script/gameui-tutorial-script.md'
  ]

  it('没有文档再把「一键工作流」说成顶栏入口', () => {
    for (const doc of DOCS) {
      const text = read(doc)
      // 允许出现「顶栏 剧集流水线 / 设置 / Logo」等**其它**顶栏元素
      expect(text, `${doc} 仍把一键工作流说成顶栏入口`).not.toMatch(
        /顶栏[「『]?一键工作流|点击顶栏的?<strong>一键工作流|顶栏打开一键工作流/
      )
    }
  })

  it('README 与快速上手已改为工作区「新建」', () => {
    expect(read('README.md')).toContain('工作区「新建」')
    expect(read('website/quickstart.html')).toContain('工作区的「新建」')
  })
})
