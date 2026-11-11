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

const ASSISTANT_SANDBOX_BLOCK_RE =
  /(?:受限模式|沙箱(?:环境|模式|限制)?)(?:下|中|内|里)?[^。\n]{0,28}(?:起不来|无法启动|无法运行|不能运行|无法访问|无法写入|无权限|拒绝访问|被拦截|被拒绝|受阻|跑不起来|不可用)|(?:沙箱提权|提权通道)[^。\n]{0,18}(?:不可用|失败|无法使用|超时)|\[sandbox:\s*file access denied|\bblocked by (?:the )?sandbox\b|\bsandbox[^.\n]{0,20}access denied\b/i // cjk-ok

/**
 * 识别助手正文是否在汇报「当前操作因受限模式 / 沙箱限制或提权通道不可用而受阻」。
 *
 * 典型场景：Windows 受限沙箱下，部分外部工具（如 IDA `idat64.exe`）直接以退出码 255 退出且无标准
 * `Access is denied` 文本，`tool/result` 未必带标准沙箱前缀，但模型诊断后会汇报「受限模式下 … 起不来」
 * 或「沙箱提权通道不可用」。集中放在 `@shared/dshApproval` 供渲染层与单测共用。
 */
export function isAssistantReportingSandboxBlock(text: unknown): boolean {
  if (typeof text !== 'string') return false
  const trimmed = text.trim()
  if (!trimmed) return false
  return ASSISTANT_SANDBOX_BLOCK_RE.test(trimmed)
}

const PROMPT_SANDBOX_TOPIC_RE =
  /(?:受限模式|完全访问|完全模式|沙箱|总是允许|始终允许|授权|sandbox|full[- ]access|always\s+allow|workspace-write)/i // cjk-ok
const ANSWER_ENABLE_FULL_ACCESS_RE =
  /(?:(?:开启|启用|切换(?:到|为)?|打开|使用|改为)\s*(?:完全访问|完全模式)|^(?:完全访问|完全模式)(?:模式)?$|总是允许|始终允许|全部允许|关闭受限模式|解除(?:沙箱|限制)|always\s+allow|enable\s+full[- ]access|switch\s+to\s+full[- ]access|^full[- ]access$)/i // cjk-ok
const ANSWER_NEGATION_RE =
  /(?:不开启|不启用|不要|暂不|拒绝|保持受限|维持受限|\bkeep\s+restricted\b|\bno\b)/i // cjk-ok
const ANSWER_ENABLE_RESTRICTED_RE =
  /(?:(?:开启|启用|切换(?:到|为)?|恢复)\s*受限模式|enable\s+(?:restricted\s+)?sandbox)/i // cjk-ok

const AUTH_PROMPT_TOPIC_RE =
  /(?:受限模式|完全访问|完全模式|沙箱|越界|提权|授权|权限|外部(?:工具|命令|目录)|跨目录|sandbox|escalat|permission)/i // cjk-ok
const AUTH_OPTION_ALLOW_RE = /(?:允许|同意|放行|开启|启用|授权|allow|approve|grant|enable)/i // cjk-ok
const AUTH_OPTION_ALWAYS_RE = /(?:总是允许|始终允许|全部允许|always\s+allow)/i // cjk-ok

/**
 * 判断 `ask_user` 提问卡是否属于沙箱/权限授权类提问，且尚未提供「总是允许」选项。
 */
export function shouldAppendAlwaysAllowOption(
  question: unknown,
  options?: ReadonlyArray<string>
): boolean {
  const q = typeof question === 'string' ? question.trim() : ''
  const opts = Array.isArray(options)
    ? options.map((o) => String(o ?? '').trim()).filter(Boolean)
    : []
  if (opts.some((o) => AUTH_OPTION_ALWAYS_RE.test(o))) return false
  if (opts.some((o) => /^(?:允许一次|allow\s+once)$/i.test(o))) return true // cjk-ok
  if (!AUTH_PROMPT_TOPIC_RE.test(`${q} ${opts.join(' ')}`)) return false
  return opts.length === 0 || opts.some((o) => AUTH_OPTION_ALLOW_RE.test(o))
}

/**
 * 若模型通过 `ask_user_question` 询问沙箱/受限模式/授权选择，识别用户的回答意图以同步切换真实沙箱状态与底部按钮。
 */
export function resolvePromptSandboxModeIntent(
  question: unknown,
  answer: unknown
): 'danger-full-access' | 'workspace-write' | null {
  const q = typeof question === 'string' ? question.trim() : ''
  const a = typeof answer === 'string' ? answer.trim() : ''
  if (!a || !PROMPT_SANDBOX_TOPIC_RE.test(`${q} ${a}`)) return null
  if (!ANSWER_NEGATION_RE.test(a) && ANSWER_ENABLE_FULL_ACCESS_RE.test(a)) {
    return 'danger-full-access'
  }
  if (ANSWER_ENABLE_RESTRICTED_RE.test(a)) {
    return 'workspace-write'
  }
  return null
}
