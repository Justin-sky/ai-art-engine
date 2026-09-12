/**
 * 对话模式对 MCP 工具面的授权分级 —— Ask / Plan / Craft 的硬约束，而不只是 system prompt 里的提示。
 *
 * 背景：面板上的三种模式原先只写进 persona，模型不听话时 Ask 照样能改工程、Plan 在用户确认前
 * 照样能直接生成（生成类要花额度、产物不可逆）。这里把「模式」提升为工具面约束：请求方在 MCP
 * 请求头声明模式（`X-AIArt-Mode` / `X-AIArt-Run-Id`），服务端据此收窄 `tools/list`，并在越权的
 * `tools/call` 上直接拒绝。
 *
 * 边界（重要）：只有对话面板（dsh 子进程）会带模式头。外部 Agent（Claude Code / Codex，经 stdio
 * 桥或 HTTP 直连）不带，视为无限制——它们由用户自己配置与授权，不属于面板模式的管辖范围。因此
 * 模式必须绑定在「请求」上，不能做成 MCP 服务的全局开关。
 */

import type { ChatMode } from './ipc'

/** 工具副作用等级：read 只读；write 改工程 / 资产 / 文件 / 任务；generate 花模型额度或长耗时产出 */
export type McpToolAccess = 'read' | 'write' | 'generate'

/** 单次请求的授权视图：mode 缺省表示无声明（外部客户端），一律放行 */
export interface McpAccessView {
  mode?: ChatMode
  /** Plan 模式专用：用户是否已对本次运行的计划点了确认（经 ask_user 回答置位） */
  confirmed?: boolean
}

/**
 * 请求头名：由 dsh 的 mcp-client 配置（writeDshConfig 写 cordis.patch.yml）随每次运行下发。
 * 小写是故意与 Node 的 `req.headers` 取值口径一致（HTTP 头本身大小写不敏感）。
 */
export const MCP_MODE_HEADER = 'x-aiart-mode'
export const MCP_RUN_ID_HEADER = 'x-aiart-run-id'

/**
 * 模式与运行 id 的请求头载荷：值一律转成字符串。
 * dsh-mcp-client 的 headers schema 是 `{ [key: string]: string }`——纯数字的 runId（如 `1`）
 * 会被 YAML 解析成 number，让整棵插件树校验失败、dsh 直接起不来（配置期错误，面板上表现为
 * 每次发消息都「异常退出」）。用数据而非手拼文本产出，类型系统即可挡住这类回归。
 */
export function accessHeaders(mode: ChatMode, runId: string): Record<string, string> {
  return { [MCP_MODE_HEADER]: String(mode), [MCP_RUN_ID_HEADER]: String(runId) }
}

const CHAT_MODES: readonly ChatMode[] = ['craft', 'ask', 'plan']

export function isChatMode(value: unknown): value is ChatMode {
  return typeof value === 'string' && (CHAT_MODES as readonly string[]).includes(value)
}

/** 归一化模式：非法 / 缺省取值按 craft 处理（不做额外限制，行为与升级前一致） */
export function normalizeChatMode(value: unknown): ChatMode {
  return isChatMode(value) ? value : 'craft'
}

/**
 * 只读工具：不写盘、不改工程、不消耗模型额度。
 * `timeline_preview` 虽然要跑 ffmpeg 真渲染，但只回画面、不落盘资产，算只读（规划阶段先看画面有用）；
 * `asset_qc` 体检只回报告不写盘；`ask_user` 是提问通道，Plan 模式要靠它拿确认，必须可见。
 */
const READ_TOOLS = new Set([
  'app_status',
  'project_list',
  'project_memory_read',
  'voice_profile_list',
  'asset_list',
  'asset_read_file',
  'asset_qc',
  'timeline_read',
  'timeline_preview',
  'models_list',
  'storage_status',
  'folder_list',
  'workflow_list_presets',
  'graph_node_types',
  'graph_read',
  'task_status',
  'video_job_list',
  'video_job_get',
  'ask_user'
])

/**
 * 生成类：同步阻塞等待模型产出、消耗额度且产物不可逆（`transcribe_audio` 走 ASR 模型，同理）。
 */
const GENERATE_TOOLS = new Set([
  'generate_image',
  'generate_video',
  'generate_model3d',
  'generate_speech',
  'generate_music',
  'workflow_plan',
  'transcribe_audio'
])

/**
 * 工具副作用等级。**未登记的工具一律按 write**：新增工具默认受 Plan 首轮限制（安全侧兜底），
 * 忘登记不会变成越权漏洞，只会让它在计划确认前不可用。
 */
export function toolAccessOf(name: string): McpToolAccess {
  if (READ_TOOLS.has(name)) return 'read'
  if (GENERATE_TOOLS.has(name)) return 'generate'
  return 'write'
}

/** Ask 模式拒绝文案（写给模型看：要给出下一步可执行的指引，而不是干巴巴的 forbidden） */
const ASK_DENIED =
  'Ask 模式（只问答）不提供任何工具：请直接用文字回答用户的问题。' +
  '如果本轮确实需要动手（改工程 / 生成内容），请在回答里说明打算怎么做，并提示用户把面板上的模式切到 Craft 或 Plan 后再发一次。'

/** Plan 模式未确认时的拒绝文案 */
const PLAN_DENIED =
  'Plan 模式在用户确认计划之前不允许执行「写工程 / 生成内容」类操作。' +
  '请先用 ask_user_question 提交分步计划并等待用户选择（Proceed / Adjust / Cancel）；' +
  '用户确认后，同一条消息内即可直接调用工具执行。'

/** 该工具在当前授权视图下是否应出现在 tools/list */
export function isToolVisible(access: McpToolAccess, view: McpAccessView): boolean {
  if (!view.mode) return true // 外部客户端：无声明 = 无限制
  if (view.mode === 'ask') return false
  if (view.mode === 'plan' && !view.confirmed) return access === 'read'
  return true
}

/**
 * `tools/call` 是否放行：放行返回 null，拒绝返回给模型看的原因。
 * 与 isToolVisible 同一套规则——工具列表里没有的东西被调用（模型幻觉 / 陈旧工具清单）也要挡住。
 */
export function denialReasonForTool(access: McpToolAccess, view: McpAccessView): string | null {
  if (!view.mode) return null
  if (view.mode === 'ask') return ASK_DENIED
  if (view.mode === 'plan' && !view.confirmed && access !== 'read') return PLAN_DENIED
  return null
}

/**
 * Plan 模式用：ask_user 的回答是否等于「取消 / 拒绝」。
 * 取消时保持锁定（不放行写 / 生成类工具）——模型若在用户点了 Cancel 之后仍继续调工具，会被挡住。
 * 选择本身是模型给的自由文本，这里按常见取消语义兜底匹配。
 */
const CANCEL_ANSWER =
  /(cancel|stop|abort|discard|reject|dismiss|^no\b|取消|放弃|停止|终止|不要|不用|否)/i

export function isCancelAnswer(answer: string | null | undefined): boolean {
  if (typeof answer !== 'string' || !answer.trim()) return true // 取消 / 超时统一为 null，同样不放行
  return CANCEL_ANSWER.test(answer)
}
