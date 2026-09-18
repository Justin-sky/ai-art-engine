import {
  buildBlenderJobTask,
  mergeBlenderJobOverlay,
  validateBlenderJobDelivery,
  type BlenderJobResult
} from '@shared/blenderDshJob'
import {
  buildRigRepairTaskHint,
  isRigQaPass,
  isTransientRigQa,
  shouldContinueTransientQaRetry,
  shouldStopRigAttempts,
  transientQaBackoffMs,
  type RigQaReport
} from '@shared/blenderRigSkinPipeline'
import { phaseFromHarnessEvent, summarizeHarnessLogLine } from '@shared/blenderDshLive'
import type { NodeExecuteContext } from '@shared/graph'
import type { HarnessEvent } from '@shared/ipc'
import { useBlenderDshLiveStore } from '../../../stores/blenderDshLive'
import { useGraphRunLogsStore } from '../../../stores/graphRunLogs'
import { inspectModelSkeleton } from './inspectModelSkeleton'

function failedCode(kind: 'rig' | 'pose' | 'anim'): string {
  if (kind === 'rig') return 'GRAPH_MODEL_RIG_FAILED'
  if (kind === 'anim') return 'GRAPH_MODEL_ANIM_FAILED'
  return 'GRAPH_MODEL_POSE_FAILED'
}

function appendHarnessLog(nodeId: string, event: HarnessEvent): void {
  const phase = phaseFromHarnessEvent(event)
  if (phase) useBlenderDshLiveStore().set(nodeId, phase)

  const store = useGraphRunLogsStore()
  const runId = store.activeRunId
  if (!runId) return
  const text = summarizeHarnessLogLine(event)
  if (!text) return
  store.append({
    runId,
    level: event.type === 'error' ? 'error' : 'info',
    kind: 'run_message',
    nodeId,
    message: text
  })
}

async function runPoseOrAnimJob(
  input: Parameters<NonNullable<NodeExecuteContext['runBlenderDshJob']>>[0],
  prepared: Awaited<ReturnType<typeof window.studio.prepareBlenderDshJob>>
): Promise<{ relativePath: string; result: BlenderJobResult }> {
  const live = useBlenderDshLiveStore()
  const task = buildBlenderJobTask({
    kind: input.kind,
    instruction: input.instruction,
    locale: input.locale,
    inputAbs: prepared.inputAbs,
    outputAbs: prepared.outputAbs,
    resultAbs: prepared.resultAbs,
    skillId: input.skillId,
    briefAbs: prepared.briefAbs
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
    const wait = await window.studio.runHarnessJobWait({
      task,
      mode: 'craft',
      sessionId: `graph:${input.node.id}`,
      model: input.model,
      providerId: input.providerInstanceId,
      timeoutMs: input.timeoutMs
    })
    waitOk = wait.ok
    waitError = wait.error || ''
    if (!waitOk) await window.studio.abortHarnessTask().catch(() => undefined)

    live.set(input.node.id, 'finalize')
    const done = await window.studio.finalizeBlenderDshJob({
      jobId: prepared.jobId,
      kind: input.kind,
      key: `${input.node.id}_${Date.now()}`,
      requireRigQaPass: false
    })
    let result = done.result
    if (input.kind === 'rig' && done.relativePath && !result.rigMeta?.bones.length) {
      const bones = await inspectModelSkeleton({ relativePath: done.relativePath }).catch(() => [])
      if (bones.length) {
        const names = bones.map((bone) => bone.name)
        result = mergeBlenderJobOverlay(result, {
          ok: true,
          kind: 'rig',
          rigMeta: { armature: 'Armature', bones: names, vertexGroups: [] }
        })
      }
    }
    const delivered = { ...done, result }
    const invalid = validateBlenderJobDelivery({
      kind: input.kind,
      result,
      outputExists: !!delivered.relativePath
    })
    if (!invalid) return delivered
    if (!waitOk) throw new Error(`${failedCode(input.kind)}:${waitError || 'dsh'}`)
    throw new Error(invalid)
  } finally {
    if (!waitOk) void window.studio.abortHarnessTask()
    input.signal?.removeEventListener('abort', onAbort)
    stopHarnessLog()
  }
}

async function runRigIterativeJob(
  input: Parameters<NonNullable<NodeExecuteContext['runBlenderDshJob']>>[0],
  prepared: Awaited<ReturnType<typeof window.studio.prepareBlenderDshJob>>
): Promise<{ relativePath: string; result: BlenderJobResult }> {
  const live = useBlenderDshLiveStore()
  const onAbort = (): void => {
    void window.studio.abortHarnessTask()
  }
  input.signal?.addEventListener('abort', onAbort, { once: true })
  const stopHarnessLog = window.studio.onHarnessEvent((event) =>
    appendHarnessLog(input.node.id, event)
  )

  let lastQa: RigQaReport | undefined
  let previousFingerprint = ''
  let stuckStreak = 0
  let lastResult: BlenderJobResult = { ok: false, kind: 'rig', error: 'GRAPH_MODEL_RIG_QA' }
  let terminateReason: string | undefined

  try {
    for (let attempt = 1; ; attempt++) {
      if (input.signal?.aborted) {
        terminateReason = 'dsh_failed'
        lastResult = {
          ok: false,
          kind: 'rig',
          error: 'GRAPH_MODEL_RIG_FAILED',
          ...(lastQa ? { rigQa: lastQa } : {})
        }
        break
      }
      live.set(input.node.id, attempt === 1 ? 'blender' : 'blender')
      const repairHint = attempt > 1 && lastQa ? buildRigRepairTaskHint(lastQa) : undefined
      const task = buildBlenderJobTask({
        kind: 'rig',
        instruction: input.instruction,
        locale: input.locale,
        inputAbs: prepared.inputAbs,
        outputAbs: prepared.outputAbs,
        resultAbs: prepared.resultAbs,
        skillId: input.skillId,
        briefAbs: prepared.briefAbs,
        attempt,
        repairHint
      })

      const wait = await window.studio.runHarnessJobWait({
        task,
        mode: 'craft',
        sessionId: `graph:${input.node.id}:rig:${attempt}`,
        model: input.model,
        providerId: input.providerInstanceId,
        timeoutMs: input.timeoutMs || 6_000_000
      })
      if (!wait.ok) {
        lastResult = {
          ok: false,
          kind: 'rig',
          error: `${failedCode('rig')}:${wait.error || 'dsh'}`,
          ...(lastQa ? { rigQa: lastQa } : {})
        }
        terminateReason = 'dsh_failed'
        break
      }

      live.set(input.node.id, 'qa')
      let evaluated = await window.studio.evaluateBlenderDshJob({
        jobId: prepared.jobId,
        attempt,
        captureScreenshots: true
      })
      // 瞬时 MCP 断线：不限次只重跑 QA，不烧 dsh；用户 abort 或拿到非瞬时结果才停
      for (
        let qaRetry = 0;
        shouldContinueTransientQaRetry(qaRetry) && isTransientRigQa(evaluated.result.rigQa);
        qaRetry++
      ) {
        if (input.signal?.aborted) break
        await new Promise((r) => setTimeout(r, transientQaBackoffMs(qaRetry)))
        live.set(input.node.id, 'qa')
        evaluated = await window.studio.evaluateBlenderDshJob({
          jobId: prepared.jobId,
          attempt,
          captureScreenshots: qaRetry % 3 === 2
        })
      }
      lastResult = evaluated.result
      lastQa = evaluated.result.rigQa
      if (!lastQa) {
        continue
      }

      if (input.signal?.aborted) {
        terminateReason = 'dsh_failed'
        lastResult = {
          ...lastResult,
          error: 'GRAPH_MODEL_RIG_FAILED',
          rigQa: lastQa
        }
        break
      }

      // 仍瞬时：场景保留，继续下一轮 dsh 前先不判 stuck；由下一轮再评估
      if (isTransientRigQa(lastQa)) {
        stuckStreak = 0
        previousFingerprint = ''
        continue
      }

      if (lastQa.fingerprint && lastQa.fingerprint === previousFingerprint) {
        stuckStreak += 1
      } else {
        stuckStreak = 0
      }
      const decision = shouldStopRigAttempts({
        attempt,
        qa: lastQa,
        previousFingerprint,
        stuckStreak
      })
      previousFingerprint = lastQa.fingerprint

      if (decision.stop && decision.reason === 'pass' && isRigQaPass(lastQa)) {
        live.set(input.node.id, 'finalize')
        const done = await window.studio.finalizeBlenderDshJob({
          jobId: prepared.jobId,
          kind: 'rig',
          key: `${input.node.id}_${Date.now()}`,
          requireRigQaPass: true
        })
        const result = mergeBlenderJobOverlay(done.result, {
          ok: true,
          kind: 'rig',
          rigMeta: done.result.rigMeta || lastResult.rigMeta,
          rigQa: lastQa
        })
        const invalid = validateBlenderJobDelivery({
          kind: 'rig',
          result,
          outputExists: !!done.relativePath
        })
        if (invalid) throw new Error(invalid)
        return { relativePath: done.relativePath, result }
      }

      if (decision.stop) {
        terminateReason = decision.reason
        break
      }
    }

    const code =
      terminateReason === 'stuck'
        ? 'GRAPH_MODEL_RIG_STUCK'
        : terminateReason === 'dsh_failed'
          ? lastResult.error ||
            (isTransientRigQa(lastQa) ? 'GRAPH_MODEL_RIG_MCP' : 'GRAPH_MODEL_RIG_FAILED')
          : 'GRAPH_MODEL_RIG_QA'
    throw Object.assign(new Error(code), { rigQa: lastQa, result: lastResult })
  } finally {
    input.signal?.removeEventListener('abort', onAbort)
    stopHarnessLog()
  }
}

export async function runBlenderDshJob(
  input: Parameters<NonNullable<NodeExecuteContext['runBlenderDshJob']>>[0]
): Promise<{ relativePath: string; result: BlenderJobResult }> {
  const live = useBlenderDshLiveStore()
  live.set(input.node.id, 'probe')
  const blender = await window.studio.getBlenderMcpInfo({ probe: true })

  if (!blender?.enabled || !blender.connected) {
    const code =
      input.kind === 'rig'
        ? 'GRAPH_MODEL_RIG_MCP'
        : input.kind === 'anim'
          ? 'GRAPH_MODEL_ANIM_MCP'
          : 'GRAPH_MODEL_POSE_MCP'
    live.clear(input.node.id)
    throw new Error(code)
  }

  live.set(input.node.id, 'prepare')
  let prepared: Awaited<ReturnType<typeof window.studio.prepareBlenderDshJob>>
  try {
    prepared = await window.studio.prepareBlenderDshJob({
      kind: input.kind,
      sourceRelativePath: input.sourceRelativePath,
      instruction: input.instruction,
      locale: input.locale,
      skillId: input.skillId
    })
  } catch (error) {
    live.clear(input.node.id)
    throw error
  }

  try {
    if (input.kind === 'rig') {
      return await runRigIterativeJob(input, prepared)
    }
    return await runPoseOrAnimJob(input, prepared)
  } finally {
    live.clear(input.node.id)
    await window.studio.cleanupBlenderDshJob(prepared.jobId).catch(() => undefined)
  }
}
