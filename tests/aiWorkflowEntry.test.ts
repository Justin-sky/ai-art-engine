import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 「一键工作流」快捷入口已从顶栏与空工作区首页移除：
 * - 工作流浏览与实例化统一收敛到顶栏「技能市场（MarketplaceView）」；
 * - 未打开画布时在右侧 AI 会话中输入任务会自动新建并打开自由画布执行；
 * - 空工作区首页（WorkspaceMain.vue）仅保留纯粹的核心创作资产入口（freeCanvas / subgraph / screenplay / motion）。
 */
const read = (...parts: string[]): string => readFileSync(resolve(...parts), 'utf8')

const STUDIO = read('src/renderer/src/views/StudioView.vue')
const WORKSPACE = read('src/renderer/src/components/WorkspaceMain.vue')

describe('一键工作流快捷入口已从顶栏与工作区移除', () => {
  it('顶栏与 StudioView 不再挂载「一键工作流」按钮与弹窗', () => {
    expect(STUDIO).not.toContain('aiWorkflow.shortAction')
    expect(STUDIO).not.toContain("t('aiWorkflow.title')")
    expect(STUDIO).not.toContain('AiCreateWorkflowDialog')
  })

  it('工作区首页「新建」仅保留核心资产条目，不再包含 aiWorkflow 快捷操作', () => {
    expect(WORKSPACE).not.toContain('aiWorkflow')
    expect(WORKSPACE).not.toContain('requestAiWorkflowDialog')
    expect(WORKSPACE).toContain("new Set(['freeCanvas', 'subgraph', 'screenplay', 'motion'])")
  })

  it('工具栏注册表不包含 aiWorkflow 伪资产条目', () => {
    const shared = read('src/shared/workspaceToolbar.ts')
    expect(shared).not.toContain('aiWorkflow')
  })
})
