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
