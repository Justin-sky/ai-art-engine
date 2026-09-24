import {
  GAME_PLAY_DSH_TIMEOUT_MS,
  buildGamePlayJobTask,
  gamePlayDshError,
  type GamePlayDshMode
} from '@shared/gamePlayDshJob'
import type { NodeExecuteContext } from '@shared/graph'
import type { HarnessEvent } from '@shared/ipc'
import { useGraphRunLogsStore } from '../../../stores/graphRunLogs'

function appendHarnessLog(nodeId: string, event: HarnessEvent): void {
  const store = useGraphRunLogsStore()
  const runId = store.activeRunId
  if (!runId) return
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

export async function runGamePlayDshJob(
  input: Parameters<NonNullable<NodeExecuteContext['runGamePlayDshJob']>>[0]
): Promise<{
  projectRelativeDir: string
  gameMode: '2d' | '3d'
}> {
  const preferredMode = (input.preferredMode ?? 'auto') as GamePlayDshMode
  let seedOnly = input.seedOnly === true
  const reuseProjectDir =
    input.projectRelativeDir?.trim() || input.node.params.gamePlayProjectDir?.trim() || undefined

  if (!seedOnly) {
    try {
      const status = await window.studio.getHarnessStatus()
      if (!status?.dshReady || !status?.hasDeepseekKey || !status?.nodeOk) seedOnly = true
    } catch {
      seedOnly = true
    }
  }

  const prepareInput = {
    instruction: input.instruction,
    preferredMode,
    locale: input.locale,
    referenceNote: input.referenceNote,
    projectRelativeDir: reuseProjectDir
  }

  const prepared = seedOnly
    ? await window.studio.seedGamePlayProject(prepareInput)
    : await window.studio.prepareGamePlayDshJob(prepareInput)

  const resumed =
    !!reuseProjectDir &&
    prepared.projectRelativeDir.replace(/\\/g, '/') === reuseProjectDir.replace(/\\/g, '/')

  if (!seedOnly) {
    const task = buildGamePlayJobTask({
      instruction: input.instruction,
      locale: input.locale,
      preferredMode,
      projectAbs: prepared.projectAbs,
      resultAbs: prepared.resultAbs,
      briefAbs: prepared.briefAbs,
      referenceNote: input.referenceNote,
      resume: resumed
    })

    const onAbort = (): void => {
      void window.studio.abortHarnessTask()
    }
    input.signal?.addEventListener('abort', onAbort, { once: true })
    const stopHarnessLog = window.studio.onHarnessEvent((event) =>
      appendHarnessLog(input.node.id, event)
    )

    let waitOk = false
    let waitError = ''
    try {
      input.log?.(
        resumed
          ? `dsh：继续上次工程 ${prepared.projectRelativeDir}`
          : 'dsh：开始多轮生成 Node/esbuild 工程…'
      )
      const wait = await window.studio.runHarnessJobWait({
        task,
        mode: 'craft',
        sessionId: `graph:gameplay:${input.node.id}`,
        model: input.model,
        providerId: input.providerInstanceId,
        timeoutMs: input.timeoutMs ?? GAME_PLAY_DSH_TIMEOUT_MS
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
      throw new Error(waitError || gamePlayDshError('DSH'))
    }
  } else {
    input.log?.(
      resumed
        ? `无 dsh：复用样例工程 ${prepared.projectRelativeDir}`
        : '无 dsh：已写入样例 Node/esbuild 工程'
    )
  }

  const validated = await window.studio.validateGamePlayDshJob({
    projectAbs: prepared.projectAbs,
    resultAbs: prepared.resultAbs
  })
  if (!validated.ok) {
    throw new Error(validated.error || gamePlayDshError('RESULT'))
  }

  const gameMode: '2d' | '3d' =
    validated.gameMode === '3d' || preferredMode === '3d'
      ? '3d'
      : validated.gameMode === '2d' || preferredMode === '2d'
        ? '2d'
        : '2d'

  return {
    projectRelativeDir: prepared.projectRelativeDir,
    gameMode
  }
}

export async function buildGamePlayProjectForNode(
  input: Parameters<NonNullable<NodeExecuteContext['buildGamePlayProject']>>[0]
): Promise<{ html: string; buildHtmlRelativePath: string }> {
  input.log?.('cook：npm install + node build.mjs…')
  const built = await window.studio.buildGamePlayProject({
    projectRelativeDir: input.projectRelativeDir
  })
  for (const line of built.logs.slice(-20)) {
    input.log?.(line)
  }
  input.log?.(`cook：单文件 ${built.bytes}B`)
  return {
    html: built.html,
    buildHtmlRelativePath: built.buildHtmlRelativePath
  }
}
