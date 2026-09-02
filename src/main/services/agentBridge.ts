/**
 * Agent 桥（模式 B：自动转交管道）。
 *
 * 让一条「A ⇢ B」的管道在后台自动运作：
 * - A 每次成功完成任务（产生最终文本）后，主进程把其最终文本组装成新任务，
 *   自动派发给 B（接续 B 最近一次会话，保持上下文）；
 * - 任务文本会带上「来自 X」说明与可选的附加指令 / 工作区文件引用；
 * - B 正在运行时不抢占（跳过并提示），避免打断 B 正在执行的会话。
 *
 * 一次转交（用户把 A 的回答手动发给 B）不走这里——渲染层直接把目标 agent 标签
 * 激活后以其正常发送路径执行，会话归属天然一致。
 */
import { IpcChannels, type AgentForwardEvent, type AgentForwardInput, type AgentForwardResult, type AgentPipeInfo } from '@shared/ipc'
import { broadcastToAllWindows } from '../broadcast'
import { agentRegistry } from './agentRegistry'
import {
  getAgentLastSessionId,
  onAgentRuntimeDone,
  runHarnessTask,
  runtimeIsRunning
} from './deepseekHarnessService'

/** 内部管道实体：id + 配置 + 最近派发状态 */
type LivePipe = AgentPipeInfo

const pipes = new Map<string, LivePipe>()
let pipeSeq = 0

function nextPipeId(): string {
  pipeSeq += 1
  return `pipe-${Date.now().toString(36)}-${pipeSeq.toString(36)}`
}

/** 组装派发给 B 的任务文本：来源说明 + 附加指令 + 文件参考 + 转交正文 */
function composeText(pipe: LivePipe, finalText: string): string {
  const fromName = agentRegistry.get(pipe.from)?.name ?? pipe.from
  const parts: string[] = [`[来自 ${fromName} 的自动转交]`] // cjk-ok 转交任务文本（发送给模型的内容）
  if (pipe.instruction?.trim()) parts.push(pipe.instruction.trim())
  if (pipe.file?.trim()) {
    parts.push(
      `请先读取并参考工程工作区内的文件：${pipe.file.trim()}（相对工程根目录的路径）` // cjk-ok 转交任务文本（发送给模型的内容）
    )
  }
  parts.push(`以下是转交内容：\n${finalText}`) // cjk-ok 转交任务文本（发送给模型的内容）
  return parts.join('\n\n')
}

/** 把一条转交实际派发给 to（空闲校验 → run → 通知渲染层写入 B 的会话 UI） */
async function dispatch(pipe: LivePipe, finalText: string): Promise<void> {
  const text = composeText(pipe, finalText)
  const now = Date.now()
  // to 正在运行：不抢占，提示后跳过（管道保留，等下一次 A 完成）
  if (runtimeIsRunning(pipe.to)) {
    pipe.lastAt = now
    pipe.lastMessage = '目标 Agent 正在运行，本次已跳过' // cjk-ok 运行时状态文本（沿用 harness 服务的既有文案风格）
    const fromName = agentRegistry.get(pipe.from)?.name ?? pipe.from
    broadcastToAllWindows(IpcChannels.HARNESS_EVENT, {
      type: 'status',
      text: `收到「${fromName}」的自动转交，但当前正在运行，已跳过。`, // cjk-ok 运行时状态文本（沿用 harness 服务的既有文案风格）
      agentId: pipe.to
    })
    return
  }
  try {
    // 接续 B 最近一次会话（缺失时 dsh 自动新建），保证 B 记得此前上下文
    const sessionId = getAgentLastSessionId(pipe.to)
    const result = await runHarnessTask({ agentId: pipe.to, task: text, sessionId })
    if (result.started) {
      pipe.lastAt = now
      pipe.lastMessage = undefined
      const event: AgentForwardEvent = {
        pipeId: pipe.id,
        from: pipe.from,
        to: pipe.to,
        text,
        ...(sessionId ? { sessionId } : {}),
        at: now
      }
      broadcastToAllWindows(IpcChannels.AGENT_FORWARD_EVENT, event)
    } else {
      pipe.lastAt = now
      pipe.lastMessage = result.message ?? '派发失败' // cjk-ok 运行时状态文本
    }
  } catch (err) {
    pipe.lastAt = now
    pipe.lastMessage = err instanceof Error ? err.message : String(err)
  }
}

/** 订阅全部 agent 的「任务成功完成」：匹配管道 from 并派发 */
onAgentRuntimeDone(({ agentId, finalText }) => {
  if (!finalText) return
  for (const pipe of pipes.values()) {
    if (pipe.from === agentId) void dispatch(pipe, finalText)
  }
})

/** 建立 / 更新一条自动转交管道（from 缺省 'default'；同向已存在则更新配置） */
export async function forwardAgent(input: AgentForwardInput): Promise<AgentForwardResult> {
  const from = String(input?.from ?? '').trim() || 'default'
  const to = String(input?.to ?? '').trim()
  if (!from || !to || from === to) {
    return { ok: false, message: '转交双方必须是不同的 Agent' } // cjk-ok 运行时错误文本（沿用 harness 服务的既有文案风格）
  }
  if (!agentRegistry.get(from) || !agentRegistry.get(to)) {
    return { ok: false, message: 'Agent 不存在或已删除' } // cjk-ok 运行时错误文本（沿用 harness 服务的既有文案风格）
  }
  const instruction = input.instruction?.trim()
  const file = input.file?.trim()
  // 同向已有管道：更新指令/文件（幂等），不重复创建
  const existing = [...pipes.values()].find((p) => p.from === from && p.to === to)
  if (existing) {
    existing.instruction = instruction || undefined
    existing.file = file || undefined
    existing.lastMessage = undefined
    return { ok: true, pipe: { ...existing } }
  }
  const pipe: LivePipe = {
    id: nextPipeId(),
    from,
    to,
    ...(instruction ? { instruction } : {}),
    ...(file ? { file } : {})
  }
  pipes.set(pipe.id, pipe)
  return { ok: true, pipe: { ...pipe } }
}

/** 全部活动管道（按建立顺序） */
export function listAgentPipes(): AgentPipeInfo[] {
  return [...pipes.values()].map((p) => ({ ...p }))
}

/** 取消一条管道；返回剩余管道 */
export function cancelAgentPipe(pipeId: string): AgentPipeInfo[] {
  if (pipeId) pipes.delete(String(pipeId))
  return listAgentPipes()
}
