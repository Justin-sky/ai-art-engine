import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SERVICE_SRC = readFileSync(resolve('src/main/services/deepseekHarnessService.ts'), 'utf8')
const RUNNER_SRC = readFileSync(
  resolve('src/main/services/aiartHeadlessRunner.template.mjs'),
  'utf8'
)
const CHAT_PANEL_SRC = readFileSync(resolve('src/renderer/src/components/ChatPanel.vue'), 'utf8')
const IPC_SRC = readFileSync(resolve('src/shared/ipc.ts'), 'utf8')

describe('DeepSeek Harness (@deepseek-ai/dsh) 全能力接入校验', () => {
  it('1. 接入 dsh 原生斜杠指令 (/compact, /goal, /feedback, /export)', () => {
    for (const cmd of ['compact', 'goal', 'feedback', 'export']) {
      expect(SERVICE_SRC).toContain(`name: '${cmd}'`)
    }
    expect(RUNNER_SRC).toContain('/^\\/(compact|goal|feedback)(?=$|\\s)/i')
    expect(RUNNER_SRC).toContain('commands.execute(agent, trimmedTask, [])')
    expect(SERVICE_SRC).toContain('/^\\/export(?=$|\\s)/i')
  })

  it('2. 接入 Todo 进度看板 (todo_write) 与多轮自主目标驱动器 (goal / goal-round-driver)', () => {
    expect(RUNNER_SRC).toContain("const TODO_BEGIN = '===BEGIN_TODO==='")
    expect(RUNNER_SRC).toContain("const GOAL_BEGIN = '===BEGIN_GOAL==='")
    expect(RUNNER_SRC).toContain("event.type === 'todo/write'")
    expect(RUNNER_SRC).toContain("event.type === 'goal/change'")
    expect(RUNNER_SRC).toContain("event.data?.message?.source?.plugin === 'goal-round-driver'")
    expect(SERVICE_SRC).toContain('emitTodoFromLine')
    expect(SERVICE_SRC).toContain('emitGoalFromLine')
    expect(CHAT_PANEL_SRC).toContain('class="harness-goal-bar"')
    expect(CHAT_PANEL_SRC).toContain('class="harness-todo-board"')
  })

  it('3. 接入会话内定时提醒与时间上下文 (@deepseek-ai/dsh-schedule + @deepseek-ai/dsh-time-context)', () => {
    expect(SERVICE_SRC).toContain("hasPkg('@deepseek-ai/dsh-time-context')")
    expect(SERVICE_SRC).toContain("hasPkg('@deepseek-ai/dsh-schedule')")
    expect(RUNNER_SRC).toContain("const SCHEDULE_BEGIN = '===BEGIN_SCHEDULE==='")
    expect(RUNNER_SRC).toContain("event.type === 'schedule/change'")
    expect(RUNNER_SRC).toContain('[aiart-runner] schedule_turn_start ')
    expect(SERVICE_SRC).toContain('activeScheduleCount > 0')
    expect(CHAT_PANEL_SRC).toContain('class="schedule-dropdown"')
  })

  it('4. 接入交付物专属呈现卡片 (@deepseek-ai/dsh-tool-present -> deliverables/presented)', () => {
    expect(SERVICE_SRC).toContain("hasPkg('@deepseek-ai/dsh-tool-present')")
    expect(RUNNER_SRC).toContain("const PRESENT_BEGIN = '===BEGIN_PRESENT==='")
    expect(RUNNER_SRC).toContain("event.type === 'deliverables/presented'")
    expect(SERVICE_SRC).toContain('emitPresentFromLine')
    expect(CHAT_PANEL_SRC).toContain('class="present-card"')
  })

  it('5. 接入外部子代理、Hooks 与可续跑 fork 子代理 (claude-code / codex / continuable fork)', () => {
    expect(SERVICE_SRC).toContain('backgroundMode: continuable')
    expect(SERVICE_SRC).toContain("hasPkg('@deepseek-ai/dsh-hooks-claude-code')")
    expect(SERVICE_SRC).toContain("hasPkg('@deepseek-ai/dsh-hooks-codex')")
    expect(SERVICE_SRC).toContain("hasPkg('@deepseek-ai/dsh-subagent-claude-code')")
    expect(SERVICE_SRC).toContain("hasPkg('@deepseek-ai/dsh-subagent-codex')")
  })

  it('6. 接入会话导出 (.zip)、回退/分叉 (Rewind/Fork) 与跨会话全文检索 (SQLite + JSONL/zstd)', () => {
    expect(SERVICE_SRC).toContain("hasPkg('@deepseek-ai/dsh-session-query-sqlite')")
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

  it('7. 接入 str_replace_editor 兼容工具 (@deepseek-ai/dsh-tool-str-replace-editor)', () => {
    expect(SERVICE_SRC).toContain("hasPkg('@deepseek-ai/dsh-tool-str-replace-editor')")
    expect(SERVICE_SRC).toContain('str_replace_editor')
  })

  it('8. [Stage 1] 盘中实时转向 (Mid-Turn Live Steering) + Node.js 原生 IPC 双通道升级', () => {
    expect(SERVICE_SRC).toContain("stdio: persistent ? ['pipe', 'pipe', 'pipe', 'ipc'] : undefined")
    expect(SERVICE_SRC).toContain("proc.on('message', (rawMsg: unknown) => {")
    expect(SERVICE_SRC).toContain('export async function steerHarnessTurn')
    expect(RUNNER_SRC).toContain('process.send({ __aiartEvent: true, ...event })')
    expect(RUNNER_SRC).toContain("process.on('message', (msg) => {")
    expect(RUNNER_SRC).toContain("if (op === 'steer') {")
    expect(RUNNER_SRC).toContain('[Live User Steering — apply immediately from the next step]')
    expect(IPC_SRC).toContain("HARNESS_STEER: 'harness:steer'")
    expect(CHAT_PANEL_SRC).toContain('onSteerNow')
    expect(CHAT_PANEL_SRC).toContain('onSteerQueued')
    expect(CHAT_PANEL_SRC).toContain('class="steered-badge"')
  })

  it('9. [Stage 2] 视觉多模态自检闭环 (Visual Self-Critique Loop) + 画布异步事件触发器 (Reactive Canvas Hooks)', () => {
    const MCP_SRC = readFileSync(resolve('src/main/services/mcpServerService.ts'), 'utf8')
    expect(MCP_SRC).toContain('export function readVisualCheckImagesForRelativePaths')
    expect(MCP_SRC).toContain('export function setCanvasTaskSettledHook')
    expect(MCP_SRC).toContain('mcpImages')
    expect(SERVICE_SRC).toContain('=== Visual Self-Critique & Director Verification Loop ===')
    expect(SERVICE_SRC).toContain('export async function notifyHarnessCanvasEvent')
    expect(SERVICE_SRC).toContain('setCanvasTaskSettledHook((report) => {')
    expect(IPC_SRC).toContain("HARNESS_CANVAS_EVENT: 'harness:canvas-event'")
    expect(CHAT_PANEL_SRC).toContain('class="harness-canvas-event-bar"')
    expect(CHAT_PANEL_SRC).toContain('onHandleCanvasEvent')
  })

  it('10. [Stage 3] 影视/美术领域专属子代理矩阵 (Domain Subagents) + 子代理并发实时监控看板 (Subagent Concurrency Board)', () => {
    for (const agentName of [
      'storyboard-director',
      'visual-asset-artist',
      'blender-3d-director',
      'timeline-audio-editor'
    ]) {
      expect(SERVICE_SRC).toContain(`name: '${agentName}'`)
    }
    expect(SERVICE_SRC).toContain('function writeDomainSubagentProfiles')
    expect(SERVICE_SRC).toContain('=== Studio Domain Subagent Matrix (Parallel Production) ===')
    expect(RUNNER_SRC).toContain("const SUBAGENT_BEGIN = '===BEGIN_SUBAGENT==='")
    expect(RUNNER_SRC).toContain('flushSubagentSnapshot')
    expect(CHAT_PANEL_SRC).toContain('class="harness-subagent-board"')
    expect(CHAT_PANEL_SRC).toContain('class="domain-subagent-bar"')
    expect(CHAT_PANEL_SRC).toContain('onSteerSubagent')
  })

  it('11. 对话输出期间再发消息稳定进入发送队列 (IPC 流式事件闭环 + running 竞态封闭 + 常驻启动不提前释放 turnActive)', () => {
    for (const ipcCase of [
      "case 'ready':",
      "case 'session_released':",
      "case 'prompt_start':",
      "case 'schedule_turn_start':",
      "case 'reasoning_begin':",
      "case 'reasoning_delta':",
      "case 'reasoning_end':",
      "case 'assistant_delta':",
      "case 'turn_done':"
    ]) {
      expect(SERVICE_SRC).toContain(ipcCase)
    }
    expect(RUNNER_SRC).toContain('Boolean(agent.inbox?.hasPending)')
    expect(SERVICE_SRC).toContain('running: turnActive')
    // 1) session-query-sqlite 在 dsh-base 已存在，必须作为顶层 patch 覆盖而非放进 - insert: 造成 duplicate loader entry id
    expect(SERVICE_SRC).toContain("'- id: session-query-sqlite'")
    expect(SERVICE_SRC).not.toContain("'    - id: session-query-sqlite'")
    // 2) tool-subagent-fork 补丁需保留必填字段 provider: fork 与 toolName: subagent_fork
    expect(SERVICE_SRC).toContain("'    provider: fork'")
    expect(SERVICE_SRC).toContain("'    toolName: subagent_fork'")
    // 3) resetWorkerState 立即以 false 唤醒 readyWaiters，避免子进程异常退出后 waitUntilReady 空等 180s
    expect(SERVICE_SRC).toContain('for (const w of pendingReady) w(false)')
    expect(SERVICE_SRC).toContain('if (wasPersistent && !wasReady)')
    // 4) ChatPanel 在预检/技能展开异步窗口内维持 preparingTask + running 守卫
    expect(CHAT_PANEL_SRC).toContain('let preparingTask = false')
    expect(CHAT_PANEL_SRC.replace(/\r\n/g, '\n')).toContain(
      'if (status.value?.running) {\n      running.value = true\n      enqueueSend(text'
    )
    // 5) 中断与发送队列强制插队同步守卫：杜绝非队首项卡在「正在中断…」及旧进程异步退出误杀新轮次
    expect(SERVICE_SRC).toContain('if (procAborted || child !== proc) return')
    expect(SERVICE_SRC).toContain('if (abortSeq !== myAbortSeq || !turnActive)')
    expect(CHAT_PANEL_SRC).toContain('async function abortCurrentRun(): Promise<void>')
    expect(CHAT_PANEL_SRC).not.toContain('if (!isFirst) return')
  })
})
