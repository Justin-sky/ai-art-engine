import type { Agent, AgentMessage } from '@earendil-works/pi-agent-core'
import type { AssistantMessage, ImageContent, ToolResultMessage } from '@earendil-works/pi-ai'
import type { ChatMode, HarnessGoalView, HarnessTodoItem } from '@shared/ipc'
import {
  isPiContextOrPayloadOverflowError,
  isPiTransientUpstreamError,
  isPiUnsupportedImageError
} from './piModelResolver'
import { compactPiContextMessages } from './piSessionStore'

export const DEFAULT_MAX_LENGTH_CONTINUATIONS = 5
export const DEFAULT_MAX_TODO_CONTINUATIONS = 4
export const DEFAULT_MAX_OVERFLOW_COMPACTIONS = 3
export const DEFAULT_MAX_TRANSIENT_RETRIES = 4

export const LENGTH_CONTINUATION_PROMPT =
  '[System: Your previous response hit the output token limit before completing. Continue directly from where you stopped; keep internal reasoning brief and immediately emit the next tool call or final answer.]'

function extractAssistantPlainText(msg: AssistantMessage): string {
  if (!msg || !Array.isArray(msg.content)) return ''
  return msg.content
    .filter(
      (b): b is { type: 'text'; text: string } => b.type === 'text' && typeof b.text === 'string'
    )
    .map((b) => b.text)
    .join('\n')
    .trim()
}

function looksLikeExplicitUserQuestionOrHardBlocker(text: string): boolean {
  if (!text) return false
  const trimmed = text.trim()
  const tail = trimmed.slice(-260)
  if (/[?？]\s*$/.test(tail)) return true
  return /(?:请先在「?设置|未配置可用|缺少.*(?:密钥|API\s*Key)|余额不足|额度不足|需要你确认|请告诉我你希望|请选择|无法继续执行)/i.test(
    tail
  )
}

export interface PiFinishTurnControllerOptions {
  getAgent: () => Agent | null
  getMode: () => ChatMode
  getTodos: () => ReadonlyArray<HarnessTodoItem>
  getGoal?: () => HarnessGoalView | null
  setGoal?: (next: HarnessGoalView | null) => void
  onGoalUpdated?: (goal: HarnessGoalView) => void
  onTurnCounted?: () => void
  initialTodosActivated?: boolean
  maxLengthContinuations?: number
  maxTodoContinuations?: number
}

export interface PiFinishTurnController {
  markTodosActivated: () => void
  markBlockingInteraction: () => void
  consumeForceCompactFlag: () => boolean
  finishTurn: (turn: {
    message: AssistantMessage
    toolResults: ToolResultMessage[]
  }) => { action: 'continue' } | undefined
}

/**
 * 统一管控单轮结束时的自动续跑决策：
 * 1) `stopReason === 'length'`（输出截断或输入挤占窗口导致极短输出）时自动续写，并在疑似窗口挤压时触发下一轮强制压缩；
 * 2) 自主多轮 `/goal` 激活态自动推进下一轮；
 * 3) Craft 模式下若本轮激活过 `todo_write` 待办清单且仍有 `pending` / `in_progress` 项未完成，
 *    当模型中途仅发了一句过渡说明（如“接下来我检查并重绘第 1 帧”）而意外停止时，自动提醒继续执行工具直至收尾。
 */
export function createPiFinishTurnController(
  opts: PiFinishTurnControllerOptions
): PiFinishTurnController {
  const maxLengthContinuations = opts.maxLengthContinuations ?? DEFAULT_MAX_LENGTH_CONTINUATIONS
  const maxTodoContinuations = opts.maxTodoContinuations ?? DEFAULT_MAX_TODO_CONTINUATIONS

  let lengthContinuationCount = 0
  let todoContinuationCount = 0
  let consecutiveNoToolTodoNudges = 0
  let todosActivated = Boolean(opts.initialTodosActivated)
  let blockedInCurrentTurn = false
  let forceCompactNextTurn = false

  return {
    markTodosActivated() {
      todosActivated = true
    },
    markBlockingInteraction() {
      blockedInCurrentTurn = true
    },
    consumeForceCompactFlag() {
      const flag = forceCompactNextTurn
      forceCompactNextTurn = false
      return flag
    },
    finishTurn(turn) {
      opts.onTurnCounted?.()
      const agent = opts.getAgent()
      const hadBlockedInteraction = blockedInCurrentTurn
      blockedInCurrentTurn = false

      if (turn.toolResults.length > 0) {
        consecutiveNoToolTodoNudges = 0
      }

      // 1) 输出被 max_tokens 截断且本轮未产生工具调用：自动续写；若输出极短（<=64 tokens）说明输入窗口承压，标记下一轮强制压缩
      if (turn.message.stopReason === 'length' && turn.toolResults.length === 0) {
        const outTokens = turn.message.usage?.output ?? 0
        if (outTokens <= 64) {
          forceCompactNextTurn = true
        }
        if (agent && lengthContinuationCount < maxLengthContinuations) {
          lengthContinuationCount += 1
          agent.steer({
            role: 'user',
            content: LENGTH_CONTINUATION_PROMPT,
            timestamp: Date.now()
          })
          return { action: 'continue' }
        }
      } else if (turn.message.stopReason !== 'length') {
        lengthContinuationCount = 0
      }

      // 2) 多轮自主 Goal 推进
      const goal = opts.getGoal?.() ?? null
      if (
        agent &&
        goal &&
        goal.phase === 'active' &&
        goal.activation === 'armed' &&
        turn.toolResults.length === 0 &&
        !hadBlockedInteraction
      ) {
        const currentRound = goal.round ?? 1
        const maxRounds = goal.maxRounds ?? 8
        if (currentRound < maxRounds) {
          const updatedGoal: HarnessGoalView = { ...goal, round: currentRound + 1 }
          opts.setGoal?.(updatedGoal)
          opts.onGoalUpdated?.(updatedGoal)
          agent.steer({
            role: 'user',
            content: `[Autonomous Goal Round ${currentRound + 1}/${maxRounds}] Continue executing objective "${goal.objective}". Verify completed deliverables; once all criteria are satisfied, call goal_manage({ action: "complete", summary: "..." }).`,
            timestamp: Date.now()
          })
          return { action: 'continue' }
        }
        const endedGoal: HarnessGoalView = { ...goal, phase: 'ended', activation: 'disarmed' }
        opts.setGoal?.(endedGoal)
        opts.onGoalUpdated?.(endedGoal)
      }

      // 3) Craft 模式待办清单半途防断：有未完成 todo 且模型既未调工具、也未向用户提问时自动接力
      if (
        agent &&
        opts.getMode() === 'craft' &&
        todosActivated &&
        !hadBlockedInteraction &&
        turn.message.stopReason === 'stop' &&
        turn.toolResults.length === 0
      ) {
        const incomplete = opts
          .getTodos()
          .filter((item) => item.status === 'pending' || item.status === 'in_progress')
        if (
          incomplete.length > 0 &&
          consecutiveNoToolTodoNudges < 1 &&
          todoContinuationCount < maxTodoContinuations
        ) {
          const text = extractAssistantPlainText(turn.message)
          if (!looksLikeExplicitUserQuestionOrHardBlocker(text)) {
            consecutiveNoToolTodoNudges += 1
            todoContinuationCount += 1
            const preview = incomplete
              .slice(0, 4)
              .map((t) => t.content)
              .join('；')
            agent.steer({
              role: 'user',
              content: `[System: Your active todo checklist still has ${incomplete.length} unfinished item(s) (${preview}). Do not stop mid-pipeline — immediately call the next tool to complete the remaining work, or mark finished items as "completed" via todo_write if all work is genuinely done.]`,
              timestamp: Date.now()
            })
            return { action: 'continue' }
          }
        }
      }

      return undefined
    }
  }
}

function popTrailingFailedAssistantMessages(messages: ReadonlyArray<AgentMessage>): AgentMessage[] {
  const copy = [...messages]
  while (copy.length > 0) {
    const tail = copy[copy.length - 1]
    if (tail && tail.role === 'assistant' && tail.stopReason === 'error') {
      copy.pop()
      continue
    }
    break
  }
  return copy
}

function ensureContinuableTranscriptTail(messages: ReadonlyArray<AgentMessage>): AgentMessage[] {
  const copy = [...messages]
  let lastNonSystem: AgentMessage | undefined
  for (let i = copy.length - 1; i >= 0; i -= 1) {
    if (copy[i].role !== 'system') {
      lastNonSystem = copy[i]
      break
    }
  }
  if (!lastNonSystem || lastNonSystem.role === 'assistant') {
    copy.push({
      role: 'user',
      content:
        '[System: Upstream request was interrupted and recovered automatically. Continue directly from where you left off.]',
      timestamp: Date.now()
    })
  }
  return copy
}

function stripImagesFromMessagesForTextFallback(
  messages: ReadonlyArray<AgentMessage>
): AgentMessage[] {
  return messages.map((msg) => {
    if ((msg.role === 'user' || msg.role === 'toolResult') && Array.isArray(msg.content)) {
      let changed = false
      const nextContent = msg.content.map((b) => {
        if (b.type === 'image') {
          changed = true
          return {
            type: 'text' as const,
            text: '[当前模型网关不支持直接输入图片块，已自动转为纯文本占位]'
          }
        }
        return b
      })
      return changed ? { ...msg, content: nextContent } : msg
    }
    return msg
  })
}

async function abortableDelay(
  ms: number,
  isAborted: () => boolean,
  signal?: AbortSignal
): Promise<void> {
  if (ms <= 0 || isAborted() || signal?.aborted) return
  await new Promise<void>((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })
}

export interface RunPiAgentWithSelfHealingOptions {
  agent: Agent
  prompt: string
  images?: ImageContent[]
  isAborted?: () => boolean
  signal?: AbortSignal
  onStatus?: (text: string, tone: 'waiting' | 'warn' | 'error') => void
  maxOverflowCompactions?: number
  maxTransientRetries?: number
  retryDelaysMs?: ReadonlyArray<number>
}

/**
 * 执行 Pi Agent 主循环并内置三层故障自愈：
 * 1) 上下文或 8 MB 请求体字节超限（`400: The total text input size exceeds 8 MB` / `context_length_exceeded` / `413`）：
 *    弹出失败帧 -> 按 1~3 级紧急强度渐进压缩历史载荷 -> `agent.continue()` 原地无感续跑；
 * 2) 模型网关拒绝多模态图片块（`image_url not supported`）：
 *    自动剥离消息中的图片块并将当前模型降级为纯文本输入后无缝续跑；
 * 3) 上游瞬时抖动（`429`、`500/502/503/504`、`fetch failed`、SSE 半途断流、`socket hang up`）：
 *    弹出失败帧 -> 指数退避等待 -> `agent.continue()` 从断点恢复，不丢失任何已完成工具成果。
 */
export async function runPiAgentWithSelfHealing(
  opts: RunPiAgentWithSelfHealingOptions
): Promise<void> {
  const { agent, prompt, images, signal, onStatus } = opts
  const isAborted = opts.isAborted ?? (() => Boolean(signal?.aborted))
  const maxOverflowCompactions = opts.maxOverflowCompactions ?? DEFAULT_MAX_OVERFLOW_COMPACTIONS
  const maxTransientRetries = opts.maxTransientRetries ?? DEFAULT_MAX_TRANSIENT_RETRIES
  const retryDelays = opts.retryDelaysMs ?? [1_500, 3_000, 6_000, 10_000]

  await agent.prompt(prompt, images && images.length > 0 ? images : undefined)

  let overflowAttempts = 0
  let transientAttempts = 0
  let lastTransientMsgFloor = 0
  let strippedUnsupportedImages = false

  while (!isAborted() && !signal?.aborted) {
    const currentMessages = agent.state.messages
    const last = currentMessages[currentMessages.length - 1]
    if (!last || last.role !== 'assistant' || last.stopReason !== 'error') {
      break
    }

    const contextWindow = agent.state.model.contextWindow || 131_072

    // 分支 A：上下文窗口溢出或请求体总字节超过网关 8 MB 限制 -> 渐进压缩并续跑
    if (
      isPiContextOrPayloadOverflowError(last, contextWindow) &&
      overflowAttempts < maxOverflowCompactions
    ) {
      overflowAttempts += 1
      const level = Math.min(3, overflowAttempts) as 1 | 2 | 3
      const maxTextBytes = level === 1 ? 2_400_000 : level === 2 ? 1_100_000 : 420_000
      const maxTotalPayloadBytes = level === 1 ? 3_500_000 : level === 2 ? 1_600_000 : 580_000
      const withoutFailed = popTrailingFailedAssistantMessages(currentMessages)
      const compacted = ensureContinuableTranscriptTail(
        compactPiContextMessages(withoutFailed, {
          contextWindow,
          force: true,
          emergencyLevel: level,
          maxTextBytes,
          maxTotalPayloadBytes
        })
      )
      agent.state.messages = compacted
      onStatus?.(
        `上下文或载荷体积触及网关上限，已自动完成第 ${overflowAttempts} 级压缩瘦身并继续执行…`,
        'warn'
      )
      await agent.continue()
      continue
    }

    // 分支 B：模型网关不支持多模态图片输入 -> 剥离图片块并切换纯文本模式续跑
    if (isPiUnsupportedImageError(last) && !strippedUnsupportedImages) {
      strippedUnsupportedImages = true
      const withoutFailed = popTrailingFailedAssistantMessages(currentMessages)
      const textOnly = ensureContinuableTranscriptTail(
        stripImagesFromMessagesForTextFallback(withoutFailed)
      )
      agent.state.model = { ...agent.state.model, input: ['text'] }
      agent.state.messages = textOnly
      onStatus?.('当前模型网关不支持直接传入视觉图片，已自动降级为纯文本模式继续执行…', 'warn')
      await agent.continue()
      continue
    }

    // 分支 C：上游 429 / 5xx / 网络闪断 / 流半途断开 -> 退避重连续跑（若期间已推进新轮次则重置重试计数）
    const withoutFailed = popTrailingFailedAssistantMessages(currentMessages)
    if (withoutFailed.length > lastTransientMsgFloor) {
      transientAttempts = 0
      lastTransientMsgFloor = withoutFailed.length
    }

    if (isPiTransientUpstreamError(last) && transientAttempts < maxTransientRetries) {
      transientAttempts += 1
      const delayMs = retryDelays[Math.min(transientAttempts - 1, retryDelays.length - 1)] ?? 3_000
      agent.state.messages = ensureContinuableTranscriptTail(withoutFailed)
      const briefReason = String(last.errorMessage || '连接中断')
        .replace(/\s+/g, ' ')
        .slice(0, 90)
      onStatus?.(
        `模型服务瞬时波动（${briefReason}），正在进行第 ${transientAttempts}/${maxTransientRetries} 次自动恢复…`,
        'warn'
      )
      await abortableDelay(delayMs, isAborted, signal)
      if (isAborted() || signal?.aborted) break
      await agent.continue()
      continue
    }

    break
  }
}
