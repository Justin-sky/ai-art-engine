import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'
import {
  PiApprovalBroker,
  PiAskUserBroker,
  PiTurnGovernance,
  inspectToolSandboxSafety,
  normalizeSandboxMode
} from '../src/main/agent/piGovernance'
import type { RuntimeAgentTool } from '../src/main/agent/piModelResolver'
import {
  approvalViewOf,
  isAssistantReportingSandboxBlock,
  normalizeApprovalDecision,
  resolvePromptSandboxModeIntent,
  shouldAppendAlwaysAllowOption
} from '../src/shared/dshApproval'
import type { ApprovalRequestView } from '../src/shared/dshApproval'
import type { AskUserQuestion } from '../src/shared/ipc'

const STUB_ASSISTANT = {} as unknown as AssistantMessage

function makeDummyTool(name: string): RuntimeAgentTool {
  return {
    name,
    label: name,
    description: name,
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ content: [{ type: 'text', text: 'ok' }], details: {} })
  }
}

describe('Pi 原生门禁（Craft / Plan / Ask）、ask_user 问答卡、单次权限审批卡与受限沙箱', () => {
  const WORKSPACE = resolve('F:/demo-studio-project')
  const SKILLS_DIR = resolve('C:/Users/Test/.aiart/dsh-harness/skills')

  it('1. Ask 模式：暴露 0 个工具，且对模型幻觉发出的任何工具调用一律硬拦截', async () => {
    const askBroker = new PiAskUserBroker({ emitQuestion: () => undefined })
    const approvalBroker = new PiApprovalBroker({ emitApproval: () => undefined })
    const gov = new PiTurnGovernance({
      mode: 'ask',
      sandboxMode: 'danger-full-access',
      workspaceRoot: WORKSPACE,
      skillsRoot: SKILLS_DIR,
      askUserBroker: askBroker,
      approvalBroker
    })

    expect(gov.filterNativeTools([makeDummyTool('read'), makeDummyTool('write')])).toEqual([])

    const res = await gov.beforeToolCall({
      assistantMessage: STUB_ASSISTANT,
      toolCall: { type: 'toolCall', id: 'c1', name: 'read', arguments: { path: 'README.md' } },
      args: { path: 'README.md' },
      context: { messages: [] }
    })
    expect(res?.block).toBe(true)
    expect(res?.reason).toContain('Ask')
  })

  it('2. Plan 模式：未确认前仅放行只读工具与 ask_user；取消回答保持锁定，自定义回答（fromCustom）精准解锁写与生成工具', async () => {
    const emittedQuestions: AskUserQuestion[] = []
    const askBroker = new PiAskUserBroker({
      emitQuestion: (q) => emittedQuestions.push(q)
    })
    const approvalBroker = new PiApprovalBroker({ emitApproval: () => undefined })
    let planConfirmedHookCount = 0

    const gov = new PiTurnGovernance({
      sessionId: 'sess-plan-1',
      mode: 'plan',
      sandboxMode: 'workspace-write',
      workspaceRoot: WORKSPACE,
      skillsRoot: SKILLS_DIR,
      askUserBroker: askBroker,
      approvalBroker,
      onPlanConfirmed: () => {
        planConfirmedHookCount += 1
      }
    })

    const allNative = [
      makeDummyTool('read'),
      makeDummyTool('search'),
      makeDummyTool('write'),
      makeDummyTool('bash'),
      makeDummyTool('load_toolset'),
      gov.createAskUserTool()
    ]

    // 未确认计划前：write / bash 被隐藏，且直接调 write / graph_edit 会被 beforeToolCall 拦截
    const initialVisible = gov.filterNativeTools(allNative).map((t) => t.name)
    expect(initialVisible).toEqual(['read', 'search', 'load_toolset', 'ask_user'])

    const blockedWrite = await gov.beforeToolCall({
      assistantMessage: STUB_ASSISTANT,
      toolCall: { type: 'toolCall', id: 'w1', name: 'write', arguments: { path: 'a.txt' } },
      args: { path: 'a.txt' },
      context: { messages: [] }
    })
    expect(blockedWrite?.block).toBe(true)

    const blockedMcpEdit = await gov.beforeToolCall({
      assistantMessage: STUB_ASSISTANT,
      toolCall: { type: 'toolCall', id: 'g1', name: 'graph_edit', arguments: { ops: [] } },
      args: { ops: [] },
      context: { messages: [] }
    })
    expect(blockedMcpEdit?.block).toBe(true)

    // 情况 A：用户点击「取消」 -> 计划保持未确认态
    const askTool = gov.createAskUserTool()
    const pendingCancelPromise = askTool.execute('ask_call_1', {
      question: '是否按此三幕分镜方案执行？',
      options: ['确认执行', '取消']
    })
    expect(emittedQuestions).toHaveLength(1)
    expect(emittedQuestions[0]?.sessionId).toBe('sess-plan-1')
    askBroker.handleResponse({
      requestId: emittedQuestions[0]!.requestId,
      answer: '取消'
    })
    const cancelToolResult = await pendingCancelPromise
    expect((cancelToolResult.details as { cancelled: boolean }).cancelled).toBe(true)
    expect(gov.getAccessView().confirmed).toBe(false)
    expect(planConfirmedHookCount).toBe(0)

    // 情况 B：用户在自定义输入框填写「不要正面，改成侧脸特写后执行」(fromCustom: true)
    // 若未透传 fromCustom，宽松取消正则会把含否定词或特定短句误判；透传后应视为有效确认并解锁 Plan！
    const pendingConfirmPromise = askTool.execute('ask_call_2', {
      question: '请确认调整后的分镜计划',
      options: ['确认执行', '取消']
    })
    expect(emittedQuestions).toHaveLength(2)
    askBroker.handleResponse({
      requestId: emittedQuestions[1]!.requestId,
      answer: '不要正面，改成侧脸特写后直接执行',
      fromCustom: true
    })
    const confirmToolResult = await pendingConfirmPromise
    expect(confirmToolResult.details as { cancelled: boolean; planConfirmed: boolean }).toEqual({
      answer: '不要正面，改成侧脸特写后直接执行',
      fromCustom: true,
      cancelled: false,
      planConfirmed: true
    })
    expect(gov.getAccessView().confirmed).toBe(true)
    expect(planConfirmedHookCount).toBe(1)

    // 解锁后：write 与 graph_edit 均放行（工作区内写入免弹窗）
    expect(gov.filterNativeTools(allNative).map((t) => t.name)).toContain('write')
    const allowedWrite = await gov.beforeToolCall({
      assistantMessage: STUB_ASSISTANT,
      toolCall: {
        type: 'toolCall',
        id: 'w2',
        name: 'write',
        arguments: { path: 'docs/notes.md', content: '# ok' }
      },
      args: { path: 'docs/notes.md', content: '# ok' },
      context: { messages: [] }
    })
    expect(allowedWrite).toBeUndefined()

    const allowedGraphEdit = await gov.beforeToolCall({
      assistantMessage: STUB_ASSISTANT,
      toolCall: { type: 'toolCall', id: 'g2', name: 'graph_edit', arguments: { ops: [] } },
      args: { ops: [] },
      context: { messages: [] }
    })
    expect(allowedGraphEdit).toBeUndefined()
  })

  it('3. 受限模式 (workspace-write) vs 完全访问 (danger-full-access)：单次权限审批卡严格失败即关闭、仅生效一次', async () => {
    const emittedApprovals: ApprovalRequestView[] = []
    const approvalBroker = new PiApprovalBroker({
      emitApproval: (v) => emittedApprovals.push(v)
    })
    const askBroker = new PiAskUserBroker({ emitQuestion: () => undefined })

    const gov = new PiTurnGovernance({
      sessionId: 'sess-sandbox-1',
      mode: 'craft',
      sandboxMode: 'workspace-write',
      workspaceRoot: WORKSPACE,
      skillsRoot: SKILLS_DIR,
      askUserBroker: askBroker,
      approvalBroker
    })

    // 1) 工作区内写入直接放行，不弹审批卡
    const inWorkspaceRes = await gov.beforeToolCall({
      assistantMessage: STUB_ASSISTANT,
      toolCall: {
        type: 'toolCall',
        id: 'in_ws',
        name: 'write',
        arguments: { path: resolve(WORKSPACE, 'src/index.ts'), content: 'export {}' }
      },
      args: { path: resolve(WORKSPACE, 'src/index.ts'), content: 'export {}' },
      context: { messages: [] }
    })
    expect(inWorkspaceRes).toBeUndefined()
    expect(emittedApprovals).toHaveLength(0)

    // 2) 工作区外写入触发单次审批卡 -> 用户点「允许一次 (allow-once)」放行本次调用
    const outPath = resolve('D:/external-reverse-output/report.md')
    const firstOutPromise = gov.beforeToolCall({
      assistantMessage: STUB_ASSISTANT,
      toolCall: {
        type: 'toolCall',
        id: 'out_1',
        name: 'write',
        arguments: { path: outPath, content: '# report' }
      },
      args: { path: outPath, content: '# report' },
      context: { messages: [] }
    })
    expect(emittedApprovals).toHaveLength(1)
    expect(emittedApprovals[0]?.sessionId).toBe('sess-sandbox-1')
    expect(
      approvalBroker.handleResponse({
        requestId: emittedApprovals[0]!.requestId,
        decision: 'allow-once'
      })
    ).toBe(true)
    expect(await firstOutPromise).toBeUndefined()

    // 已消费的 requestId 再次提交返回 false（一次性消费）
    expect(
      approvalBroker.handleResponse({
        requestId: emittedApprovals[0]!.requestId,
        decision: 'allow-once'
      })
    ).toBe(false)

    // 3) 第二次工作区外写入必须重新弹审批卡（证明 allow-once 绝不静默持久化） -> 用户点「拒绝 (reject)」拦截
    const secondOutPromise = gov.beforeToolCall({
      assistantMessage: STUB_ASSISTANT,
      toolCall: {
        type: 'toolCall',
        id: 'out_2',
        name: 'write',
        arguments: { path: outPath, content: '# report 2' }
      },
      args: { path: outPath, content: '# report 2' },
      context: { messages: [] }
    })
    expect(emittedApprovals).toHaveLength(2)
    approvalBroker.handleResponse({
      requestId: emittedApprovals[1]!.requestId,
      decision: 'reject'
    })
    const rejectedRes = await secondOutPromise
    expect(rejectedRes?.block).toBe(true)

    // 4) 用户切换到「完全访问 (danger-full-access)」后，外部目录写入与脚本命令直接放行
    gov.setSandboxMode('danger-full-access')
    const fullAccessRes = await gov.beforeToolCall({
      assistantMessage: STUB_ASSISTANT,
      toolCall: {
        type: 'toolCall',
        id: 'out_3',
        name: 'write',
        arguments: { path: outPath, content: '# report 3' }
      },
      args: { path: outPath, content: '# report 3' },
      context: { messages: [] }
    })
    expect(fullAccessRes).toBeUndefined()
    expect(emittedApprovals).toHaveLength(2)
  })

  it('4. 结构性安全红线（.canvas.asset.json / $DSH_HOME/skills / 无头浏览器）即使在完全访问模式下也一律硬拦截', () => {
    // 禁止直接改 .canvas.asset.json
    const canvasSafety = inspectToolSandboxSafety({
      toolName: 'write',
      args: { path: 'Assets/main.canvas.asset.json', content: '{}' },
      sandboxMode: 'danger-full-access',
      workspaceRoot: WORKSPACE,
      skillsRoot: SKILLS_DIR
    })
    expect(canvasSafety.hardBlockReason).toContain('graph_edit')

    // 禁止直接改 $DSH_HOME/skills
    const skillSafety = inspectToolSandboxSafety({
      toolName: 'edit',
      args: { path: resolve(SKILLS_DIR, 'my-skill/SKILL.md') },
      sandboxMode: 'danger-full-access',
      workspaceRoot: WORKSPACE,
      skillsRoot: SKILLS_DIR
    })
    expect(skillSafety.hardBlockReason).toContain('skill_install')

    // 禁止在 bash 拉起 msedge / chrome 无头浏览器
    const browserSafety = inspectToolSandboxSafety({
      toolName: 'bash',
      args: { command: 'msedge.exe --headless --dump-dom https://example.com' },
      sandboxMode: 'danger-full-access',
      workspaceRoot: WORKSPACE,
      skillsRoot: SKILLS_DIR
    })
    expect(browserSafety.hardBlockReason).toContain('Headless/local browser launch is disabled')
  })

  it('5. 非交互后台作业 (interactive: false) 遇到受限沙箱边界时立即发出 sandbox_blocked 事件而非死等点击，且支持技能 allowed-tools 白名单免审', async () => {
    const blockedEvents: Array<{ toolName: string; detail?: string }> = []
    const gov = new PiTurnGovernance({
      mode: 'craft',
      sandboxMode: 'workspace-write',
      workspaceRoot: WORKSPACE,
      allowedSkillTools: ['Bash(python *)'],
      interactive: false,
      askUserBroker: new PiAskUserBroker({ emitQuestion: () => undefined }),
      approvalBroker: new PiApprovalBroker({ emitApproval: () => undefined }),
      onSandboxBlocked: (toolName, detail) => blockedEvents.push({ toolName, detail })
    })

    // 命中 allowed-tools 白名单的外部路径 python 命令自动放行
    const allowedSkillCmd = await gov.beforeToolCall({
      assistantMessage: STUB_ASSISTANT,
      toolCall: {
        type: 'toolCall',
        id: 'py_1',
        name: 'bash',
        arguments: { command: 'python D:/tools/unpack.py' }
      },
      args: { command: 'python D:/tools/unpack.py' },
      context: { messages: [] }
    })
    expect(allowedSkillCmd).toBeUndefined()

    // 未在白名单内的越界写入立即触发 sandbox_blocked 并安全拦截
    const blockedOutWrite = await gov.beforeToolCall({
      assistantMessage: STUB_ASSISTANT,
      toolCall: {
        type: 'toolCall',
        id: 'w_bg',
        name: 'write',
        arguments: { path: 'D:/outside/secret.txt', content: '123' }
      },
      args: { path: 'D:/outside/secret.txt', content: '123' },
      context: { messages: [] }
    })
    expect(blockedOutWrite?.block).toBe(true)
    expect(blockedEvents).toHaveLength(1)
    expect(blockedEvents[0]?.toolName).toBe('write')
  })

  it('6. 保持前端受限模式工具栏开关、审批卡纯函数与「总是允许」工程级持久化契约一致', () => {
    expect(normalizeSandboxMode(undefined)).toBe('workspace-write')
    expect(normalizeSandboxMode('invalid')).toBe('workspace-write')
    expect(normalizeSandboxMode('danger-full-access')).toBe('danger-full-access')

    expect(normalizeApprovalDecision('allow-once')).toBe('allow-once')
    expect(normalizeApprovalDecision('reject')).toBe('reject')
    expect(normalizeApprovalDecision('anything-else')).toBeNull()

    const view = approvalViewOf({
      requestId: 'r1',
      toolName: 'bash',
      reason: 'external write',
      answerFile: '/unused/in/pi'
    })
    expect(view).not.toHaveProperty('answerFile')
    expect(view.reason).toBe('external write')

    expect(
      isAssistantReportingSandboxBlock('受限模式下 IDA 确实起不来（255），而提权通道现在不可用。')
    ).toBe(true)
    expect(
      resolvePromptSandboxModeIntent('运行外部 IDA 脚本需要授权，是否允许？', '总是允许')
    ).toBe('danger-full-access')
    expect(shouldAppendAlwaysAllowOption('权限确认', ['允许一次', '拒绝'])).toBe(true)

    const chatPanelSrc = readFileSync(resolve('src/renderer/src/components/ChatPanel.vue'), 'utf8')
    const harnessSrc = readFileSync(resolve('src/main/agent/piHarnessService.ts'), 'utf8')
    expect(chatPanelSrc).toContain(
      "const CHAT_SANDBOX_RESTRICTED_KEY = 'studio.chat.sandboxRestricted'"
    )
    expect(chatPanelSrc).toContain('.setHarnessSandboxMode({')
    expect(harnessSrc).toContain('export function setHarnessSandboxMode(')
  })
})
