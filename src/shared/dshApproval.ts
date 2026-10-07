/**
 * dsh 审批（`approval/request`）在应用侧的契约与纯逻辑。
 *
 * ## 为什么单独一个文件
 *
 * 这条链路横跨三方：dsh 侧的应答插件（生成到 `$DSH_HOME` 的 .mjs，读不了本模块）、
 * 主进程（解析标记行、写回答文件）、渲染层（弹同意卡）。**只有放行 / 拒绝这两个词
 * 与标记行格式需要三方完全一致**，一旦漂移就是安全问题，所以格式与判定都集中在这里，
 * 主进程与测试共用同一份实现，而不是各写一遍正则。
 *
 * ## 失败即关闭是这里的第一原则
 *
 * dsh 只认 `allowed-once` 一种放行（且一次性）。因此本模块所有解析函数「认不出来就返回
 * null / reject」——**绝不猜测、绝不默认放行**：解析不了就当成没有决定，让 dsh 侧超时
 * 收敛到 `unavailable`（工具调用失败），而不是让一个坏载荷变成一次授权。
 */

/** dsh 审批结果词表（与 `@deepseek-ai/dsh-user-approval` 的 `ApprovalOutcome` 一致） */
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/**
 * 用户在同意卡上的两个选择。
 *
 * 刻意**没有**「总是允许」：dsh 的授权设计成一次性，持久化授权会让 agent 之后能跑的
 * 东西被静默放宽，而用户以为自己只同意了一次。
 */
export type ApprovalDecision = 'allow-once' | 'reject'

/** dsh 侧插件写到 stdout 的标记行前缀（插件模板里有同名常量，两侧由测试钉住） */
export const APPROVAL_MARKER = '===BEGIN_APPROVAL==='

/** 标记行载荷（dsh 侧插件 → 主进程） */
export interface ApprovalMarkerPayload {
  requestId: string
  /** 需要审批的工具名（如 pwsh / write） */
  toolName: string
  /** dsh 的工具调用 id（同一工具多次调用可区分） */
  callId?: string
  /** dsh 给出的可读原因（沙箱升级时形如 `escalate sandbox to danger-full-access: …`） */
  reason?: string
  /** 与 reason 同义的上游附加字段；上游没有就缺省 */
  displayReason?: string
  /** 主进程把用户决定写进这个文件，dsh 侧轮询读取 */
  answerFile: string
}

/** 主进程 → 渲染层：一条待用户决定的审批（**不含 answerFile**，界面不需要也不该知道路径） */
export interface ApprovalRequestView {
  requestId: string
  toolName: string
  callId?: string
  reason?: string
  displayReason?: string
}

/** 渲染层 → 主进程：用户对某条审批的决定 */
export interface ApprovalAnswer {
  requestId: string
  decision: ApprovalDecision
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 解析 dsh 侧插件发来的标记行；不是本标记行或载荷不完整时返回 null。
 *
 * `answerFile` 必须有：没有它就无法把决定送回，这条请求只能按「没有审批通道」处理
 * （dsh 侧轮询等不到文件，收敛到 `unavailable`）。这里返回 null 而不是抛错，
 * 是为了让主进程的 stdout 解析循环保持「坏行不影响其它行」。
 */
export function parseApprovalMarker(line: string): ApprovalMarkerPayload | null {
  if (!line.startsWith(APPROVAL_MARKER)) return null
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(line.slice(APPROVAL_MARKER.length).trim()) as Record<string, unknown>
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const requestId = asText(parsed.requestId)
  const answerFile = asText(parsed.answerFile)
  if (!requestId || !answerFile) return null
  const callId = asText(parsed.callId)
  const reason = asText(parsed.reason)
  const displayReason = asText(parsed.displayReason)
  return {
    requestId,
    // 工具名缺失时给一个占位，界面照样能问「要不要允许这个工具」；不能因为缺字段就当成放行
    toolName: asText(parsed.toolName) || 'tool',
    ...(callId ? { callId } : {}),
    ...(reason ? { reason } : {}),
    ...(displayReason ? { displayReason } : {}),
    answerFile
  }
}

/** 标记行载荷 → 界面视图（去掉 answerFile：界面拿不到路径，也就无法伪造放行） */
export function approvalViewOf(payload: ApprovalMarkerPayload): ApprovalRequestView {
  return {
    requestId: payload.requestId,
    toolName: payload.toolName,
    ...(payload.callId ? { callId: payload.callId } : {}),
    ...(payload.reason ? { reason: payload.reason } : {}),
    ...(payload.displayReason ? { displayReason: payload.displayReason } : {})
  }
}

/**
 * 归一化渲染层传来的决定：只认 `allow-once` 与 `reject` 两个字面量，其余返回 null。
 *
 * 这里**不接受**任何近似写法（'allow'、'allowOnce'、true…）：放宽等于给未来的调用方
 * 留一条「以为在放行、其实认不出」的路，而认不出时的默认行为必须是拒绝。
 */
export function normalizeApprovalDecision(value: unknown): ApprovalDecision | null {
  return value === 'allow-once' || value === 'reject' ? value : null
}

/**
 * 回答文件的正文（主进程写、dsh 侧插件读）。
 *
 * 用显式对象而不是裸字符串：dsh 侧对「不是 allow-once 的东西」一律不放行，
 * 但把决定写成带键的对象，读侧才能区分「写坏了」与「用户拒绝了」。
 */
export function approvalAnswerFileText(decision: ApprovalDecision): string {
  return `${JSON.stringify({ decision })}\n`
}

/**
 * 渲染层传来的决定 → **实际写盘的内容**：认不出的决定按拒绝写。
 *
 * 这是主进程唯一一条把「用户意图」变成「回答文件」的路径，所以它单独成一个纯函数：
 * 安全性质（除 `allow-once` 外永远不放行）因此可以被测试直接执行，而不是靠读源码确认。
 * 认不出时按拒绝而不是「什么都不写」：用户已经点过了，让他干等 5 分钟超时没有意义 ——
 * 而拒绝与超时对 dsh 都是「不放行」，安全性没有区别。
 */
export function approvalAnswerForDecision(decision: unknown): string {
  return approvalAnswerFileText(normalizeApprovalDecision(decision) ?? 'reject')
}
