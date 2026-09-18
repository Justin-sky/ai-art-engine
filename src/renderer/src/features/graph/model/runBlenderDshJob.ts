import {
  buildBlenderJobTask,
  mergeBlenderJobOverlay,
  validateBlenderJobDelivery,
  type BlenderJobResult
} from '@shared/blenderDshJob'
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

  const task = buildBlenderJobTask({
    kind: input.kind,
    instruction: input.instruction,
    locale: input.locale,
    inputAbs: prepared.inputAbs,
    outputAbs: prepared.outputAbs,
    resultAbs: prepared.resultAbs,
    skillId: input.skillId
  })

  const onAbort = (): void => {
    void window.studio.abortHarnessTask()
  }
  input.signal?.addEventListener('abort', onAbort, { once: true })
  const stopHarnessLog = window.studio.onHarnessEvent((event) => appendHarnessLog(input.node.id, event))

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
      key: `${input.node.id}_${Date.now()}`
    })
    let result = done.result
    if (input.kind === 'rig' && done.relativePath && !result.rigMeta?.bones.length) {
      const bones = await inspectModelSkeleton({ relativePath: done.relativePath }).catch(() => [])
      if (bones.length) {
        const names = bones.map((bone) => bone.name)
        result = mergeBlenderJobOverlay(result, {
          ok: true,
          kind: 'rig',
          rigMeta: { armature: names[0] ? 'Armature' : '', bones: names, vertexGroups: names }
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
    live.clear(input.node.id)
    await window.studio.cleanupBlenderDshJob(prepared.jobId).catch(() => undefined)
  }
}
