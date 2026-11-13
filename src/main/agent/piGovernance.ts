import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { isAbsolute, relative, resolve as resolvePath } from 'node:path'
import type { BeforeToolCallContext, BeforeToolCallResult } from '@earendil-works/pi-agent-core'
import { matchesAllowedTool } from '@shared/claudeSkill'
import {
  type ApprovalAnswer,
  type ApprovalDecision,
  type ApprovalRequestView
} from '@shared/dshApproval'
import type { AskUserAnswer, AskUserQuestion, ChatMode, HarnessSandboxMode } from '@shared/ipc'
import {
  denialReasonForTool,
  isCancelAnswer,
  normalizeChatMode,
  toolAccessOf,
  type McpAccessView
} from '@shared/mcpModeAccess'
import {
  prepareLooseToolArguments,
  type RuntimeAgentTool,
  type RuntimeToolResult
} from './piModelResolver'

const DEFAULT_INTERACTION_TIMEOUT_MS = 10 * 60_000

/** Plan 模式下未确认计划前允许暴露和调用的只读/协调类原生工具 */
const PLAN_UNCONFIRMED_NATIVE_TOOLS = new Set<string>([
  'read',
  'search',
  'load_toolset',
  'ask_user',
  'ask_user_question',
  'todo_write'
])

/** 全部内置原生工具名集合（不走 MCP toolAccessOf 表，由原生门禁单独判定） */
const ALL_NATIVE_TOOL_NAMES = new Set<string>([
  'read',
  'write',
  'edit',
  'str_replace_editor',
  'search',
  'bash',
  'load_toolset',
  'ask_user',
  'ask_user_question',
  'todo_write',
  'present_files',
  'spawn_subagent',
  'goal_manage',
  'schedule_manage'
])

export function normalizeSandboxMode(raw?: string | null): HarnessSandboxMode {
  return raw === 'danger-full-access' ? 'danger-full-access' : 'workspace-write'
}

export function isPathInsideRoot(candidateAbs: string, rootAbs: string): boolean {
  const normCandidate = resolvePath(candidateAbs)
  const normRoot = resolvePath(rootAbs)
  const rel = relative(normRoot, normCandidate)
  if (!rel) return true
  if (rel.startsWith('..') || isAbsolute(rel)) return false
  return true
}

/**
 * 禁止直接用原生文件/Shell 工具读写 `.canvas.asset.json` 或 `$DSH_HOME/skills`：
 * - `.canvas.asset.json` 必须通过 `graph_read` / `graph_edit` 实时操作，直接改盘不会刷新 WebGL/Vue 画布且会被覆盖；
 * - `$DSH_HOME/skills` 必须通过宿主特权工具 `skill_install` / `skill_uninstall` 管理。
 */
export function checkStudioStructuralFilePolicy(
  targetPath: string,
  workspaceRoot: string,
  skillsRoot?: string
): string | null {
  const trimmed = targetPath.trim()
  if (!trimmed) return null
  const abs = isAbsolute(trimmed) ? resolvePath(trimmed) : resolvePath(workspaceRoot, trimmed)
  const normalizedPosix = abs.replace(/\\/g, '/').toLowerCase()

  if (normalizedPosix.endsWith('.canvas.asset.json')) {
    return '禁止直接通过文件工具读写 `.canvas.asset.json`：画布文件受前端编辑器实时状态接管，直接改盘不会更新画布且会被覆盖。请改用 `graph_read` 与 `graph_edit` 工具实时操作画布节点。'
  }
  if (skillsRoot && isPathInsideRoot(abs, skillsRoot)) {
    return '禁止直接用文件工具修改技能目录 `$DSH_HOME/skills`：请调用 Studio 内建工具 `skill_install` 或 `skill_uninstall` 进行安装与卸载。'
  }
  return null
}

/**
 * 拦截在子进程中拉起无头或桌面 Chromium/Edge 浏览器的 Shell 命令。
 */
export function checkBrowserLaunchCommandPolicy(command: string): string | null {
  const text = String(command ?? '')
  if (!text.trim()) return null
  const browserBinary =
    /\b(msedge|chrome|chromium|google-chrome|brave|playwright\s+open|puppeteer)(?:\.exe)?\b/i
  const browserFlags = /(--headless|--remote-debugging-port|--dump-dom|--screenshot)/i
  if (
    browserBinary.test(text) &&
    (browserFlags.test(text) || /\b(msedge|chrome)(?:\.exe)?\b/i.test(text))
  ) {
    return [
      'Headless/local browser launch is disabled in shell commands.',
      'To rasterize or visually inspect SVG/HTML, call `render_svg`.',
      'To render and extract external web pages or articles with embedded figures, call `load_toolset({ toolsets: ["skills_web_vision"] })` and then `web_extract_article({ url })`.'
    ].join(' ')
  }
  return null
}

export interface SandboxInspectionResult {
  /** 硬阻断原因（即使审批也不允许，例如篡改 `.canvas.asset.json` 或拉起浏览器） */
  hardBlockReason?: string
  /** 受限模式（workspace-write）下需要用户单次审批的原因；undefined 表示安全直通 */
  approvalReason?: string
}

function extractCommandExternalPaths(
  command: string,
  allowedRoots: ReadonlyArray<string>
): string[] {
  const escaped: string[] = []
  // Windows 盘符绝对路径（如 C:\foo 或 D:/bar），排除常见无害开关
  const winMatches = command.match(/\b[A-Za-z]:[\\/][^\s"'`|;&><]+/g) ?? []
  for (const raw of winMatches) {
    const cleaned = raw.replace(/[,;)]+$/, '')
    if (!allowedRoots.some((root) => isPathInsideRoot(cleaned, root))) {
      escaped.push(cleaned)
    }
  }
  if (process.platform !== 'win32') {
    const posixMatches =
      command.match(/(?:^|\s)(\/(?:Users|home|etc|var|opt|usr|root)[^\s"'`|;&><]*)/g) ?? []
    for (const raw of posixMatches) {
      const cleaned = raw.trim()
      if (!allowedRoots.some((root) => isPathInsideRoot(cleaned, root))) {
        escaped.push(cleaned)
      }
    }
  }
  return Array.from(new Set(escaped))
}

/**
 * 评估一次原生工具调用在当前沙箱模式下的安全性。
 */
export function inspectToolSandboxSafety(opts: {
  toolName: string
  args: Record<string, unknown>
  sandboxMode: HarnessSandboxMode
  workspaceRoot: string
  extraAllowedWriteRoots?: ReadonlyArray<string>
  skillsRoot?: string
}): SandboxInspectionResult {
  const { toolName, args, sandboxMode, workspaceRoot, skillsRoot } = opts
  const allowedWriteRoots = [
    resolvePath(workspaceRoot),
    resolvePath(tmpdir()),
    ...(opts.extraAllowedWriteRoots ?? []).map((r) => resolvePath(r))
  ]

  // 1) 文件读取（禁止直读 .canvas.asset.json）
  if (toolName === 'read') {
    const rawPath = String(args.path ?? args.file_path ?? '')
    if (rawPath.trim().toLowerCase().endsWith('.canvas.asset.json')) {
      return {
        hardBlockReason:
          '禁止直接读取 `.canvas.asset.json`：请调用 `graph_read` 获取当前实时画布结构与节点参数。'
      }
    }
    return {}
  }

  // 2) 文件写入 / 编辑
  if (toolName === 'write' || toolName === 'edit' || toolName === 'str_replace_editor') {
    const rawPath = String(args.path ?? args.file_path ?? '')
    const structural = checkStudioStructuralFilePolicy(rawPath, workspaceRoot, skillsRoot)
    if (structural) {
      return { hardBlockReason: structural }
    }
    if (sandboxMode === 'danger-full-access' || !rawPath.trim()) {
      return {}
    }
    const targetAbs = isAbsolute(rawPath)
      ? resolvePath(rawPath)
      : resolvePath(workspaceRoot, rawPath)
    const insideAllowed = allowedWriteRoots.some((root) => isPathInsideRoot(targetAbs, root))
    if (!insideAllowed) {
      return {
        approvalReason: `受限模式下请求写入工作区外路径：${targetAbs}`
      }
    }
    return {}
  }

  // 3) Shell 命令执行（bash）
  if (toolName === 'bash') {
    const command = String(args.command ?? '')
    const browserBlock = checkBrowserLaunchCommandPolicy(command)
    if (browserBlock) {
      return { hardBlockReason: browserBlock }
    }
    if (command.toLowerCase().includes('.canvas.asset.json')) {
      return {
        hardBlockReason:
          '禁止通过终端命令读写 `.canvas.asset.json`：请改用 `graph_read` 与 `graph_edit` 实时操作画布。'
      }
    }
    if (
      skillsRoot &&
      (command.toLowerCase().includes('dsh-harness/skills') ||
        command.toLowerCase().includes('dsh-harness\\skills'))
    ) {
      return {
        hardBlockReason:
          '禁止通过终端命令直接写入 `$DSH_HOME/skills`：请使用 `skill_install` 工具安装技能。'
      }
    }

    if (sandboxMode === 'danger-full-access') {
      return {}
    }

    // 受限模式下检测高危破坏性命令或跨工作区写入/全局安装
    const destructivePattern =
      /\b(rm\s+-rf\s+\/|del\s+\/[sqf]|rd\s+\/s|rmdir\s+\/s|Remove-Item\b.*-Recurse.*-Force|git\s+reset\s+--hard|git\s+clean\s+-fd|git\s+push\b.*--force|reg\s+(add|delete)|sc\s+(stop|delete)|format\s+[a-z]:|npm\s+(i|install)\s+-g|pip\s+install\b)/i
    if (destructivePattern.test(command)) {
      return {
        approvalReason: `受限模式下执行高敏感终端命令需确认：${command.slice(0, 180)}`
      }
    }

    const writeRedirectOrMutate =
      /(?:>>?|Out-File|Set-Content|Add-Content|Copy-Item|Move-Item|Remove-Item|\bcp\b|\bmv\b|\brm\b|\bmkdir\b)/i
    const escapedPaths = extractCommandExternalPaths(command, allowedWriteRoots)
    if (escapedPaths.length > 0 && writeRedirectOrMutate.test(command)) {
      return {
        approvalReason: `受限模式下命令涉及工作区外路径修改（${escapedPaths[0]}）：${command.slice(0, 160)}`
      }
    }

    if (args.cwd && typeof args.cwd === 'string') {
      const cwdAbs = isAbsolute(args.cwd)
        ? resolvePath(args.cwd)
        : resolvePath(workspaceRoot, args.cwd)
      if (!allowedWriteRoots.some((root) => isPathInsideRoot(cwdAbs, root))) {
        return {
          approvalReason: `受限模式下请求在工作区外目录执行命令（cwd: ${cwdAbs}）`
        }
      }
    }
  }

  return {}
}

interface PendingAskEntry {
  sessionId?: string
  onValidConfirm?: () => void
  resolve: (answer: AskUserAnswer) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * 进程内原生 `ask_user` 问答协调器（零临时文件轮询，支持多会话并发与自定义输入 `fromCustom`）。
 */
export class PiAskUserBroker {
  private readonly pending = new Map<string, PendingAskEntry>()
  private readonly emitQuestion: (question: AskUserQuestion) => void
  private readonly timeoutMs: number

  constructor(opts: { emitQuestion: (question: AskUserQuestion) => void; timeoutMs?: number }) {
    this.emitQuestion = opts.emitQuestion
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_INTERACTION_TIMEOUT_MS
  }

  ask(opts: {
    question: string
    options?: string[]
    hint?: string
    sessionId?: string
    signal?: AbortSignal
    onValidConfirm?: () => void
  }): Promise<AskUserAnswer> {
    const requestId = `harness:${randomUUID()}`
    if (opts.signal?.aborted) {
      return Promise.resolve({ requestId, answer: null })
    }

    return new Promise<AskUserAnswer>((resolve) => {
      const cleanupAbort = (): void => {
        if (opts.signal) opts.signal.removeEventListener('abort', onAbort)
      }
      const finish = (payload: AskUserAnswer): void => {
        const entry = this.pending.get(requestId)
        if (!entry) return
        this.pending.delete(requestId)
        clearTimeout(entry.timer)
        cleanupAbort()
        resolve(payload)
      }
      const onAbort = (): void => {
        finish({ requestId, answer: null })
      }
      const timer = setTimeout(() => {
        finish({ requestId, answer: null })
      }, this.timeoutMs)

      this.pending.set(requestId, {
        sessionId: opts.sessionId,
        onValidConfirm: opts.onValidConfirm,
        resolve: finish,
        timer
      })
      if (opts.signal) {
        opts.signal.addEventListener('abort', onAbort, { once: true })
      }

      this.emitQuestion({
        requestId,
        question: opts.question,
        ...(opts.options?.length ? { options: opts.options } : {}),
        ...(opts.hint ? { hint: opts.hint } : {}),
        ...(opts.sessionId ? { sessionId: opts.sessionId } : {})
      })
    })
  }

  /**
   * 接收渲染层用户的选择或自定义输入回传；
   * 若在 Plan 模式下且用户回答非取消（严格透传 `payload.fromCustom === true`），立即触发计划放行回调。
   */
  handleResponse(payload: AskUserAnswer): boolean {
    const requestId = typeof payload?.requestId === 'string' ? payload.requestId.trim() : ''
    if (!requestId) return false
    const entry = this.pending.get(requestId)
    if (!entry) return false

    const hasValidAnswer =
      typeof payload.answer === 'string' &&
      payload.answer.trim().length > 0 &&
      !isCancelAnswer(payload.answer, payload.fromCustom === true)

    if (hasValidAnswer && entry.onValidConfirm) {
      entry.onValidConfirm()
    }
    entry.resolve({
      requestId,
      answer: typeof payload.answer === 'string' ? payload.answer : null,
      ...(payload.fromCustom ? { fromCustom: true } : {})
    })
    return true
  }

  cancelSession(sessionId?: string): void {
    for (const [requestId, entry] of this.pending.entries()) {
      if (!sessionId || entry.sessionId === sessionId) {
        entry.resolve({ requestId, answer: null })
      }
    }
  }
}

interface PendingApprovalEntry {
  sessionId?: string
  resolve: (decision: ApprovalDecision | 'cancelled') => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * 进程内单次权限审批卡协调器（失败即关闭，仅 `'allow-once'` 放行当次调用）。
 */
export class PiApprovalBroker {
  private readonly pending = new Map<string, PendingApprovalEntry>()
  private readonly emitApproval: (view: ApprovalRequestView) => void
  private readonly timeoutMs: number

  constructor(opts: { emitApproval: (view: ApprovalRequestView) => void; timeoutMs?: number }) {
    this.emitApproval = opts.emitApproval
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_INTERACTION_TIMEOUT_MS
  }

  requestApproval(opts: {
    toolName: string
    callId?: string
    reason: string
    displayReason?: string
    sessionId?: string
    signal?: AbortSignal
  }): Promise<ApprovalDecision | 'cancelled'> {
    const requestId = `approval:${randomUUID()}`
    if (opts.signal?.aborted) {
      return Promise.resolve('cancelled')
    }

    return new Promise<ApprovalDecision | 'cancelled'>((resolve) => {
      const cleanupAbort = (): void => {
        if (opts.signal) opts.signal.removeEventListener('abort', onAbort)
      }
      const finish = (decision: ApprovalDecision | 'cancelled'): void => {
        const entry = this.pending.get(requestId)
        if (!entry) return
        this.pending.delete(requestId)
        clearTimeout(entry.timer)
        cleanupAbort()
        resolve(decision)
      }
      const onAbort = (): void => finish('cancelled')
      const timer = setTimeout(() => finish('cancelled'), this.timeoutMs)

      this.pending.set(requestId, {
        sessionId: opts.sessionId,
        resolve: finish,
        timer
      })
      if (opts.signal) {
        opts.signal.addEventListener('abort', onAbort, { once: true })
      }

      this.emitApproval({
        requestId,
        toolName: opts.toolName || 'tool',
        ...(opts.callId ? { callId: opts.callId } : {}),
        reason: opts.reason,
        displayReason: opts.displayReason ?? opts.reason,
        ...(opts.sessionId ? { sessionId: opts.sessionId } : {})
      })
    })
  }

  /**
   * 接收渲染层同意卡点击回传；仅识别明确的 `'allow-once'` 或 `'reject'`，
   * 请求不存在或已过期时返回 `false`，供前端将过期卡片置为失效态。
   */
  handleResponse(payload: ApprovalAnswer): boolean {
    const requestId = typeof payload?.requestId === 'string' ? payload.requestId.trim() : ''
    if (!requestId) return false
    const entry = this.pending.get(requestId)
    if (!entry) return false

    const decision: ApprovalDecision = payload.decision === 'allow-once' ? 'allow-once' : 'reject'
    entry.resolve(decision)
    return true
  }

  cancelSession(sessionId?: string): void {
    for (const entry of this.pending.values()) {
      if (!sessionId || entry.sessionId === sessionId) {
        entry.resolve('cancelled')
      }
    }
  }
}

export interface TurnGovernanceConfig {
  sessionId?: string
  mode: ChatMode
  sandboxMode: HarnessSandboxMode
  workspaceRoot: string
  extraAllowedWriteRoots?: string[]
  skillsRoot?: string
  /** 当前激活的斜杠技能免确认工具白名单（Claude Code `allowed-tools` 规范） */
  allowedSkillTools?: string[]
  /** 是否存在前端用户交互界面（后台自动作业设为 false，受阻时发出 sandbox_blocked 而非无限挂起等点击） */
  interactive?: boolean
  askUserBroker: PiAskUserBroker
  approvalBroker: PiApprovalBroker
  onPlanConfirmed?: () => void
  onSandboxBlocked?: (toolName: string, detail?: string) => void
}

/**
 * 单轮 / 会话级统一治理控制器：
 * 将 Craft / Plan / Ask 模式门禁、`ask_user` 计划解锁、技能 `allowed-tools` 白名单、
 * 受限沙箱越界检测与单次权限审批卡汇聚到 Pi 原生 `beforeToolCall` 与工具列表过滤器中。
 */
export class PiTurnGovernance {
  private mode: ChatMode
  private planConfirmed = false
  private sandboxMode: HarnessSandboxMode
  private workspaceRoot: string
  private readonly extraAllowedWriteRoots: string[]
  private readonly skillsRoot?: string
  private allowedSkillTools: string[]
  private readonly interactive: boolean
  private readonly sessionId?: string
  private readonly askUserBroker: PiAskUserBroker
  private readonly approvalBroker: PiApprovalBroker
  private readonly onPlanConfirmed?: () => void
  private readonly onSandboxBlocked?: (toolName: string, detail?: string) => void

  constructor(config: TurnGovernanceConfig) {
    this.sessionId = config.sessionId
    this.mode = normalizeChatMode(config.mode) ?? 'craft'
    this.sandboxMode = normalizeSandboxMode(config.sandboxMode)
    this.workspaceRoot = config.workspaceRoot
    this.extraAllowedWriteRoots = config.extraAllowedWriteRoots ?? []
    this.skillsRoot = config.skillsRoot
    this.allowedSkillTools = config.allowedSkillTools ?? []
    this.interactive = config.interactive !== false
    this.askUserBroker = config.askUserBroker
    this.approvalBroker = config.approvalBroker
    this.onPlanConfirmed = config.onPlanConfirmed
    this.onSandboxBlocked = config.onSandboxBlocked
  }

  getAccessView(): McpAccessView {
    return {
      mode: this.mode,
      confirmed: this.planConfirmed
    }
  }

  getSandboxMode(): HarnessSandboxMode {
    return this.sandboxMode
  }

  setSandboxMode(next: HarnessSandboxMode): void {
    this.sandboxMode = normalizeSandboxMode(next)
  }

  setMode(nextMode: ChatMode, resetPlanConfirmation = true): void {
    this.mode = normalizeChatMode(nextMode) ?? 'craft'
    if (resetPlanConfirmation) {
      this.planConfirmed = false
    }
  }

  setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root
  }

  setAllowedSkillTools(patterns: string[]): void {
    this.allowedSkillTools = patterns
  }

  confirmPlan(): void {
    if (this.planConfirmed) return
    this.planConfirmed = true
    this.onPlanConfirmed?.()
  }

  /** 过滤当前模式下可暴露给模型的原生工具集合 */
  filterNativeTools(tools: ReadonlyArray<RuntimeAgentTool>): RuntimeAgentTool[] {
    if (this.mode === 'ask') return []
    if (this.mode === 'plan' && !this.planConfirmed) {
      return tools.filter((tool) => PLAN_UNCONFIRMED_NATIVE_TOOLS.has(tool.name))
    }
    return [...tools]
  }

  private isSkillAutoApproved(toolName: string, args: Record<string, unknown>): boolean {
    if (!this.allowedSkillTools.length) return false
    const cmd = toolName === 'bash' ? String(args.command ?? '') : undefined
    const mappedName =
      toolName === 'bash'
        ? 'Bash'
        : toolName === 'read'
          ? 'Read'
          : toolName === 'write'
            ? 'Write'
            : toolName === 'edit' || toolName === 'str_replace_editor'
              ? 'Edit'
              : toolName
    return (
      matchesAllowedTool(this.allowedSkillTools, toolName, cmd) ||
      matchesAllowedTool(this.allowedSkillTools, mappedName, cmd)
    )
  }

  /**
   * Pi `AgentOptions.beforeToolCall` 钩子：在任何工具真正执行前完成硬拦截或交互审批。
   */
  async beforeToolCall(
    ctx: BeforeToolCallContext,
    signal?: AbortSignal
  ): Promise<BeforeToolCallResult | undefined> {
    const toolName = ctx.toolCall.name
    const args = prepareLooseToolArguments(ctx.args)

    // 1) Ask 模式：任何工具调用一律硬拦截
    if (this.mode === 'ask') {
      return {
        block: true,
        reason:
          '当前对话为 Ask（提问）模式：只回答问题，不允许调用工具或修改任何资产。如需动手执行，请在输入栏上方切回 Craft 或 Plan 模式。'
      }
    }

    // 2) Plan 模式未确认前：只放行只读工具与 ask_user / load_toolset / todo_write
    if (this.mode === 'plan' && !this.planConfirmed) {
      if (ALL_NATIVE_TOOL_NAMES.has(toolName)) {
        if (!PLAN_UNCONFIRMED_NATIVE_TOOLS.has(toolName)) {
          return {
            block: true,
            reason:
              '当前对话为 Plan（计划）模式，用户尚未确认执行计划：请先向用户给出清晰步骤说明，并调用 `ask_user` 请求确认；仅在用户确认后才允许修改文件、执行命令或启动子代理。'
          }
        }
      } else {
        const denial = denialReasonForTool(toolAccessOf(toolName), this.getAccessView())
        if (denial) {
          return { block: true, reason: denial }
        }
      }
    }

    // 3) 结构护栏与受限沙箱检查
    const safety = inspectToolSandboxSafety({
      toolName,
      args,
      sandboxMode: this.sandboxMode,
      workspaceRoot: this.workspaceRoot,
      extraAllowedWriteRoots: this.extraAllowedWriteRoots,
      skillsRoot: this.skillsRoot
    })

    if (safety.hardBlockReason) {
      return { block: true, reason: safety.hardBlockReason }
    }

    if (safety.approvalReason) {
      if (this.isSkillAutoApproved(toolName, args)) {
        return undefined
      }
      if (!this.interactive) {
        this.onSandboxBlocked?.(toolName, safety.approvalReason)
        return {
          block: true,
          reason: `${safety.approvalReason}（当前为非交互模式，无法弹出审批卡；如需跨目录或高权限执行，请切换至完全访问模式）`
        }
      }

      const decision = await this.approvalBroker.requestApproval({
        toolName,
        callId: ctx.toolCall.id,
        reason: safety.approvalReason,
        displayReason: safety.approvalReason,
        sessionId: this.sessionId,
        signal
      })

      if (decision !== 'allow-once') {
        return {
          block: true,
          reason:
            decision === 'reject'
              ? `用户已拒绝本次权限请求（${safety.approvalReason}）。请在不越界的前提下调整方案，或询问用户意见。`
              : `权限审批已取消或超时（${safety.approvalReason}）。`
        }
      }
    }

    return undefined
  }

  /**
   * 创建进程内原生 `ask_user` 工具（同时支持传入 `questions` 数组或扁平 `{ question, options, hint }`）。
   */
  createAskUserTool(toolName: 'ask_user' | 'ask_user_question' = 'ask_user'): RuntimeAgentTool {
    return {
      name: toolName,
      label: '向用户提问确认 (Ask User)',
      description:
        'Ask the user a concise question with 2-6 clear options (plus custom input support in UI) and wait for their choice. Mandatory in Plan mode to confirm the execution plan before writing files or generating assets, and whenever user preference disambiguation is needed.',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'The question to ask the user.'
          },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: '2-6 concise, self-contained option labels for the user to click.'
          },
          hint: {
            type: 'string',
            description: 'Optional supplementary context shown below the question.'
          },
          questions: {
            type: 'array',
            description:
              'Optional Claude-Code compatible questions array [{ question, header?, options?: [{ label, description? } | string] }].',
            items: {
              type: 'object',
              properties: {
                question: { type: 'string' },
                header: { type: 'string' },
                options: { type: 'array', items: {} }
              }
            }
          }
        }
      },
      executionMode: 'sequential',
      prepareArguments: (raw) => prepareLooseToolArguments(raw),
      execute: async (
        _toolCallId,
        params: Record<string, unknown>,
        signal
      ): Promise<RuntimeToolResult> => {
        let question = typeof params.question === 'string' ? params.question.trim() : ''
        let hint = typeof params.hint === 'string' ? params.hint.trim() : undefined
        let options: string[] | undefined = Array.isArray(params.options)
          ? params.options
              .map((o) =>
                typeof o === 'string'
                  ? o.trim()
                  : o &&
                      typeof o === 'object' &&
                      typeof (o as { label?: unknown }).label === 'string'
                    ? String((o as { label: string }).label).trim()
                    : ''
              )
              .filter(Boolean)
          : undefined

        // 兼容 Claude Code AskUserQuestion 的 `{ questions: [...] }` 结构
        if (!question && Array.isArray(params.questions) && params.questions.length > 0) {
          const first = params.questions[0] as Record<string, unknown>
          if (first && typeof first === 'object') {
            question = typeof first.question === 'string' ? first.question.trim() : ''
            if (!hint && typeof first.header === 'string') {
              hint = first.header.trim()
            }
            if (!options && Array.isArray(first.options)) {
              options = first.options
                .map((item) => {
                  if (typeof item === 'string') return item.trim()
                  if (item && typeof item === 'object') {
                    const label = String((item as { label?: unknown }).label ?? '').trim()
                    const desc = String(
                      (item as { description?: unknown }).description ?? ''
                    ).trim()
                    return label && desc ? `${label} — ${desc}` : label
                  }
                  return ''
                })
                .filter(Boolean)
            }
          }
        }

        if (!question) {
          question = '请确认是否按上述方案继续执行？'
        }
        if (!options || options.length === 0) {
          options =
            this.mode === 'plan' && !this.planConfirmed
              ? ['确认执行计划', '调整方案', '取消']
              : ['继续', '取消']
        }

        const response = await this.askUserBroker.ask({
          question,
          options: options.slice(0, 6),
          hint,
          sessionId: this.sessionId,
          signal,
          onValidConfirm:
            this.mode === 'plan' && !this.planConfirmed ? () => this.confirmPlan() : undefined
        })

        const cancelled =
          response.answer === null || isCancelAnswer(response.answer, response.fromCustom === true)

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                answered: response.answer !== null,
                answer: response.answer,
                fromCustom: Boolean(response.fromCustom),
                cancelled,
                ...(this.mode === 'plan' ? { planConfirmed: this.planConfirmed } : {})
              })
            }
          ],
          details: {
            answer: response.answer,
            fromCustom: Boolean(response.fromCustom),
            cancelled,
            planConfirmed: this.planConfirmed
          }
        }
      }
    }
  }
}
