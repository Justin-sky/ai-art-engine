import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SERVICE_SRC = readFileSync(resolve('src/main/agent/piHarnessService.ts'), 'utf8')
const PERSONA_SRC = readFileSync(resolve('src/main/agent/piPersona.ts'), 'utf8')
const SESSION_SRC = readFileSync(resolve('src/main/agent/piSessionStore.ts'), 'utf8')
const WORKSPACE_TOOLS_SRC = readFileSync(resolve('src/main/agent/piWorkspaceTools.ts'), 'utf8')
const LAZY_SRC = readFileSync(resolve('src/main/agent/mcpLazyToolsets.ts'), 'utf8')
const CHAT_PANEL_SRC = readFileSync(resolve('src/renderer/src/components/ChatPanel.vue'), 'utf8')
const IPC_SRC = readFileSync(resolve('src/shared/ipc.ts'), 'utf8')

describe('Pi Agent Core (@earendil-works/pi-agent-core) 全能力接入校验', () => {
  it('1. 接入原生斜杠指令 (/compact, /goal, /feedback, /export)', () => {
    for (const cmd of ['compact', 'goal', 'feedback', 'export']) {
      expect(SERVICE_SRC).toContain(`name: '${cmd}'`)
    }
    expect(SERVICE_SRC).toContain('/^\\/compact(?=$|\\s)/i')
    expect(SERVICE_SRC).toContain('/^\\/goal(?=$|\\s)/i')
    expect(SERVICE_SRC).toContain('/^\\/feedback(?=$|\\s)/i')
    expect(SERVICE_SRC).toContain('/^\\/export(?=$|\\s)/i')
  })

  it('2. 接入 Todo 进度看板 (todo_write) 与多轮自主目标驱动器 (goal_manage + finishTurn)', () => {
    expect(SERVICE_SRC).toContain("name: 'todo_write'")
    expect(SERVICE_SRC).toContain("name: 'goal_manage'")
    expect(SERVICE_SRC).toContain("type: 'todo'")
    expect(SERVICE_SRC).toContain("type: 'goal'")
    expect(SERVICE_SRC).toContain("return { action: 'continue' }")
    expect(CHAT_PANEL_SRC).toContain('class="harness-goal-bar"')
    expect(CHAT_PANEL_SRC).toContain('class="harness-todo-board"')
  })

  it('3. 接入会话内定时提醒 (schedule_manage)', () => {
    expect(SERVICE_SRC).toContain("name: 'schedule_manage'")
    expect(SERVICE_SRC).toContain("type: 'schedule'")
    expect(SERVICE_SRC).toContain('export async function deleteHarnessSchedule')
    expect(CHAT_PANEL_SRC).toContain('class="schedule-dropdown"')
  })

  it('4. 接入交付物专属呈现卡片 (present_files)', () => {
    expect(SERVICE_SRC).toContain("name: 'present_files'")
    expect(SERVICE_SRC).toContain("type: 'present'")
    expect(CHAT_PANEL_SRC).toContain('class="present-card"')
  })

  it('5. 接入 MCP 工具按需懒加载引擎 (load_toolset + MAX_ACTIVE_TOOLS <= 96 < 128)', () => {
    expect(LAZY_SRC).toContain('export const MAX_ACTIVE_TOOLS = 96')
    expect(LAZY_SRC).toContain("name: 'load_toolset'")
    expect(SERVICE_SRC).toContain('prepareNextTurnWithContext')
    expect(SERVICE_SRC).toContain('enforceOpenAiToolsLimitPayload')
  })

  it('6. 接入无锁会话导出 (.zip)、回退/分叉 (Rewind/Fork) 与跨会话全文检索', () => {
    expect(SESSION_SRC).toContain('export async function buildPiSessionExportZip')
    expect(SESSION_SRC).toContain('export function rewindPiSession')
    expect(SESSION_SRC).toContain('export function searchPiSessions')
    expect(SERVICE_SRC).toContain('export async function exportHarnessSession')
    expect(SERVICE_SRC).toContain('export async function rewindHarnessSession')
    expect(SERVICE_SRC).toContain('export async function searchHarnessSessions')
    expect(IPC_SRC).toContain("HARNESS_EXPORT_SESSION: 'harness:export-session'")
    expect(IPC_SRC).toContain("HARNESS_REWIND_SESSION: 'harness:rewind-session'")
    expect(IPC_SRC).toContain("HARNESS_SEARCH_SESSIONS: 'harness:search-sessions'")
    expect(CHAT_PANEL_SRC).toContain('onRewindAtMessage(i, false)')
    expect(CHAT_PANEL_SRC).toContain('onRewindAtMessage(i, true)')
    expect(CHAT_PANEL_SRC).toContain('onExportCurrentSession')
    expect(CHAT_PANEL_SRC).toContain('onRunSessionSearch')
  })

  it('7. 接入精简原生工作区工具集 (read / write / edit / search / bash)', () => {
    for (const toolName of ['read', 'write', 'edit', 'search', 'bash']) {
      expect(WORKSPACE_TOOLS_SRC).toContain(`name: '${toolName}'`)
    }
    expect(WORKSPACE_TOOLS_SRC).toContain('windowsHide: true')
  })

  it('8. 盘中实时转向 (Mid-Turn Live Steering via agent.steer)', () => {
    expect(SERVICE_SRC).toContain('export async function steerHarnessTurn')
    expect(SERVICE_SRC).toContain('runner.agent.steer(')
    expect(SERVICE_SRC).toContain('[Live User Steering]')
    expect(IPC_SRC).toContain("HARNESS_STEER: 'harness:steer'")
    expect(CHAT_PANEL_SRC).toContain('onSteerNow')
    expect(CHAT_PANEL_SRC).toContain('onSteerQueued')
    expect(CHAT_PANEL_SRC).toContain('class="steered-badge"')
  })

  it('9. 视觉多模态自检闭环 (Visual Self-Critique) + 画布异步事件触发器 (Reactive Canvas Hooks)', () => {
    const MCP_SRC = readFileSync(resolve('src/main/services/mcpServerService.ts'), 'utf8')
    expect(MCP_SRC).toContain('export function readVisualCheckImagesForRelativePaths')
    expect(MCP_SRC).toContain('export function setCanvasTaskSettledHook')
    expect(MCP_SRC).toContain('mcpImages')
    expect(PERSONA_SRC).toContain('Visual Self-Critique')
    expect(SERVICE_SRC).toContain('export async function notifyHarnessCanvasEvent')
    expect(SERVICE_SRC).toContain('setCanvasTaskSettledHook((report) => {')
    expect(IPC_SRC).toContain("HARNESS_CANVAS_EVENT: 'harness:canvas-event'")
    expect(CHAT_PANEL_SRC).toContain('class="harness-canvas-event-bar"')
    expect(CHAT_PANEL_SRC).toContain('onHandleCanvasEvent')
  })

  it('10. 影视/美术领域专属子代理矩阵 (Domain Subagents) + 子代理并发实时监控看板', () => {
    for (const agentName of [
      'storyboard-director',
      'visual-asset-artist',
      'blender-3d-director',
      'timeline-audio-editor'
    ]) {
      expect(PERSONA_SRC).toContain(`name: '${agentName}'`)
    }
    expect(SERVICE_SRC).toContain("name: 'spawn_subagent'")
    expect(SERVICE_SRC).toContain("type: 'subagent'")
    expect(CHAT_PANEL_SRC).toContain('class="harness-subagent-board"')
    expect(CHAT_PANEL_SRC).toContain('onSteerSubagent')
  })

  it('11. 对话输出期间再发消息稳定进入发送队列 + 中断与会话级队列隔离', () => {
    expect(SERVICE_SRC).toContain('runningSessionIds')
    expect(SERVICE_SRC).toContain('if (runner.running) {\n    runner.queue.push(item)')
    expect(CHAT_PANEL_SRC).toContain('let preparingTask = false')
    expect(CHAT_PANEL_SRC.replace(/\r\n/g, '\n')).toContain(
      'if (isSessionRunningInMain(targetSessionId)) {\n      rt.running = true\n      enqueueSend(text'
    )
    expect(CHAT_PANEL_SRC).toContain('async function abortCurrentRun(): Promise<void>')
    expect(CHAT_PANEL_SRC).not.toContain('if (!isFirst) return')
  })

  it('12. 交付物卡片「打开」在工作区打开、「定位文件」在系统资源管理器打开', () => {
    expect(SERVICE_SRC).toContain('export function classifyHarnessFileKind')
    expect(SERVICE_SRC).toContain('shell.showItemInFolder(absPath)')
    expect(SERVICE_SRC).toContain("if (input.mode === 'read')")
    expect(SERVICE_SRC).toContain('extraWorkspaces: input?.extraWorkspaces')
    expect(CHAT_PANEL_SRC).toContain("revealInFolder: true,\n        mode: 'reveal'")
    expect(CHAT_PANEL_SRC).toContain("mode: 'read'")
    expect(CHAT_PANEL_SRC).toContain('workspaceStore.openWorkspaceFile({')
  })

  it('13. Projects 工程树支持放大镜一键分析、右键常用操作菜单与目录打开', () => {
    expect(SERVICE_SRC).toContain('if (stat.isDirectory())')
    expect(SERVICE_SRC).toContain('await shell.openPath(absPath)')
    expect(CHAT_PANEL_SRC).toContain(
      'onAnalyzeChatProject(group.scope, group.name, group.rootPath)'
    )
    expect(CHAT_PANEL_SRC).toContain('class="chat-project-ctx-menu"')
  })

  it('14. 多会话并行执行（最多 6 会话并发、槽位隔离、按会话事件路由与独立中止）', () => {
    expect(SERVICE_SRC).toContain('const MAX_PARALLEL_SESSIONS = 6')
    expect(SERVICE_SRC).toContain('function emitHarnessEvent(')
    expect(SERVICE_SRC).toContain('export function abortHarnessTask(sessionId?: string): void')
    expect(CHAT_PANEL_SRC).toContain('const sessionRuntimes = reactive')
    expect(CHAT_PANEL_SRC).toContain('function handleBackgroundHarnessEvent(')
    expect(CHAT_PANEL_SRC).toContain('window.studio.abortHarnessTask(targetSid || undefined)')
    expect(CHAT_PANEL_SRC).toContain('class="chat-parallel-badge"')
  })
})
