import {
  BLOCKOUT_DSH_TIMEOUT_MS,
  buildBlockoutJobTask,
  blockoutDshError
} from '@shared/blockoutDshJob'
import type { HarnessEvent } from '@shared/ipc'
import { useGraphRunLogsStore } from '../../stores/graphRunLogs'

export interface RunBlockoutDshJobInput {
  instruction: string
  locale?: string
  layoutMode: 'perspective' | 'panorama'
  systemPrompt: string
  userPrompt: string
  images: string[]
  model: string
  providerInstanceId: string
  timeoutMs?: number
  signal?: AbortSignal
  /** 写入执行日志的 runId；缺省时不挂 harness 流 */
  runId?: string
  logNodeId?: string
}

function appendHarnessLog(runId: string, nodeId: string, event: HarnessEvent): void {
  const store = useGraphRunLogsStore()
  let text = ''
  if (event.type === 'assistant' && 'text' in event && event.text?.trim()) {
    text = String(event.text).trim()
  } else if (event.type === 'tool' && event.name) {
    text = `[tool] ${event.name}`
  } else if (event.type === 'error' && event.message) {
    text = event.message
  } else if (event.type === 'status' && 'text' in event && event.text) {
    text = String(event.text)
  }
  if (!text) return
  store.append({
    runId,
    level: event.type === 'error' ? 'error' : 'info',
    kind: 'run_message',
    nodeId,
    message: text.slice(0, 2000)
  })
}

export async function runBlockoutDshJob(input: RunBlockoutDshJobInput): Promise<{
  resultText: string
  summary?: string
}> {
  const prepared = await window.studio.prepareBlockoutDshJob({
    instruction: input.instruction,
    locale: input.locale,
    layoutMode: input.layoutMode,
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    images: input.images
  })

  const task = buildBlockoutJobTask({
    instruction: input.instruction,
    locale: input.locale,
    layoutMode: input.layoutMode,
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    resultAbs: prepared.resultAbs,
    briefAbs: prepared.briefAbs,
    refRelativePaths: prepared.refRelativePaths
  })

  const onAbort = (): void => {
    void window.studio.abortHarnessTask()
  }
  input.signal?.addEventListener('abort', onAbort, { once: true })

  const runId = input.runId?.trim()
  const logNodeId = input.logNodeId?.trim() || 'director-blockout'
  const stopHarnessLog =
    runId && window.studio.onHarnessEvent
      ? window.studio.onHarnessEvent((event) => appendHarnessLog(runId, logNodeId, event))
      : () => undefined

  let waitOk = false
  let waitError = ''
  try {
    const wait = await window.studio.runHarnessJobWait({
      task,
      mode: 'craft',
      sessionId: `director:blockout:${prepared.jobId}`,
      model: input.model,
      providerId: input.providerInstanceId,
      timeoutMs: input.timeoutMs ?? BLOCKOUT_DSH_TIMEOUT_MS
    })
    waitOk = wait.ok
    waitError = wait.error?.trim() || ''
    if (!wait.ok) {
      void window.studio.abortHarnessTask()
    }
  } finally {
    stopHarnessLog()
    input.signal?.removeEventListener('abort', onAbort)
  }

  if (input.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  if (!waitOk) {
    throw new Error(waitError || blockoutDshError('DSH'))
  }

  const validated = await window.studio.validateBlockoutDshJob({
    resultAbs: prepared.resultAbs
  })
  if (!validated.ok || !validated.resultText?.trim()) {
    throw new Error(validated.error || blockoutDshError('RESULT'))
  }
  return {
    resultText: validated.resultText,
    summary: validated.summary
  }
}

/** dsh 是否可用于白模多轮（与 gamePlay 同口径） */
export async function isBlockoutDshReady(): Promise<boolean> {
  try {
    const status = await window.studio.getHarnessStatus()
    return !!(status?.dshReady && status?.hasDeepseekKey && status?.nodeOk)
  } catch {
    return false
  }
}
