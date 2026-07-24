import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  GraphRunLogApiCall,
  GraphRunLogEvent,
  GraphRunLogMode,
  GraphRunLogSession,
  GraphRunLogSessionStatus
} from '@shared/graph'

const MAX_SESSIONS = 50
const MAX_EVENTS_PER_SESSION = 500
const MAX_API_CALLS_PER_SESSION = 100

export const useGraphRunLogsStore = defineStore('graphRunLogs', () => {
  const sessions = ref<GraphRunLogSession[]>([])
  const activeRunId = ref<string | null>(null)
  const dialogOpen = ref(false)
  const selectedRunId = ref<string | null>(null)

  const selectedSession = computed(() => {
    const id = selectedRunId.value
    if (!id) return sessions.value[0] ?? null
    return sessions.value.find((s) => s.runId === id) ?? sessions.value[0] ?? null
  })

  function openDialog(runId?: string | null): void {
    dialogOpen.value = true
    if (runId) selectedRunId.value = runId
    else if (activeRunId.value) selectedRunId.value = activeRunId.value
    else if (!selectedRunId.value && sessions.value[0]) {
      selectedRunId.value = sessions.value[0].runId
    }
  }

  function closeDialog(): void {
    dialogOpen.value = false
  }

  function selectSession(runId: string): void {
    selectedRunId.value = runId
  }

  function beginRun(input: {
    runId: string
    title: string
    hostId?: string
    mode: GraphRunLogMode
    targetNodeId?: string
    targetNodeTitle?: string
    message?: string
  }): void {
    const startedAt = Date.now()
    const session: GraphRunLogSession = {
      runId: input.runId,
      title: input.title,
      hostId: input.hostId,
      mode: input.mode,
      targetNodeId: input.targetNodeId,
      startedAt,
      status: 'running',
      events: [
        {
          id: `${input.runId}-start`,
          runId: input.runId,
          ts: startedAt,
          level: 'info',
          kind: 'run_start',
          hostId: input.hostId,
          mode: input.mode,
          nodeId: input.targetNodeId,
          nodeTitle: input.targetNodeTitle,
          message: input.message,
          status: 'running'
        }
      ],
      apiCalls: []
    }
    sessions.value = [session, ...sessions.value].slice(0, MAX_SESSIONS)
    activeRunId.value = input.runId
    selectedRunId.value = input.runId
  }

  function replaceSession(runId: string, next: GraphRunLogSession): void {
    const index = sessions.value.findIndex((s) => s.runId === runId)
    if (index < 0) return
    const copy = sessions.value.slice()
    copy[index] = next
    sessions.value = copy
  }

  function append(event: Omit<GraphRunLogEvent, 'id' | 'ts'> & { id?: string; ts?: number }): void {
    const session = sessions.value.find((s) => s.runId === event.runId)
    if (!session) return
    const nextEvent: GraphRunLogEvent = {
      ...event,
      id: event.id ?? `${event.runId}-${session.events.length + 1}-${Date.now()}`,
      ts: event.ts ?? Date.now()
    }
    let events = [...session.events, nextEvent]
    if (events.length > MAX_EVENTS_PER_SESSION) {
      events = events.slice(events.length - MAX_EVENTS_PER_SESSION)
    }
    replaceSession(event.runId, { ...session, events, apiCalls: session.apiCalls ?? [] })
  }

  function appendApiCall(
    runId: string,
    call: Omit<GraphRunLogApiCall, 'id' | 'ts'> & { id?: string; ts?: number }
  ): void {
    const session = sessions.value.find((s) => s.runId === runId)
    if (!session) return
    const next: GraphRunLogApiCall = {
      ...call,
      id: call.id ?? `${runId}-api-${(session.apiCalls?.length ?? 0) + 1}-${Date.now()}`,
      ts: call.ts ?? Date.now()
    }
    let apiCalls = [...(session.apiCalls ?? []), next]
    if (apiCalls.length > MAX_API_CALLS_PER_SESSION) {
      apiCalls = apiCalls.slice(apiCalls.length - MAX_API_CALLS_PER_SESSION)
    }
    replaceSession(runId, { ...session, apiCalls })
  }

  function endRun(input: {
    runId: string
    status: Exclude<GraphRunLogSessionStatus, 'running'>
    message?: string
    errorCode?: string
  }): void {
    const session = sessions.value.find((s) => s.runId === input.runId)
    if (!session || session.status !== 'running') return
    const endedAt = Date.now()
    const endEvent: GraphRunLogEvent = {
      id: `${input.runId}-end`,
      runId: input.runId,
      ts: endedAt,
      level: input.status === 'done' ? 'info' : input.status === 'stopped' ? 'warn' : 'error',
      kind: 'run_end',
      hostId: session.hostId,
      mode: session.mode,
      message: input.message,
      errorCode: input.errorCode,
      durationMs: Math.max(0, endedAt - session.startedAt),
      status:
        input.status === 'done' ? 'done' : input.status === 'stopped' ? 'error' : 'error'
    }
    replaceSession(input.runId, {
      ...session,
      endedAt,
      status: input.status,
      events: [...session.events, endEvent]
    })
    if (activeRunId.value === input.runId) activeRunId.value = null
  }

  function clear(): void {
    sessions.value = []
    activeRunId.value = null
    selectedRunId.value = null
  }

  function clearSession(runId: string): void {
    sessions.value = sessions.value.filter((s) => s.runId !== runId)
    if (selectedRunId.value === runId) {
      selectedRunId.value = sessions.value[0]?.runId ?? null
    }
    if (activeRunId.value === runId) activeRunId.value = null
  }

  function clearForProjectSwitch(): void {
    clear()
    dialogOpen.value = false
  }

  function formatSessionPlainText(session: GraphRunLogSession): string {
    const lines = [
      `# ${session.title}`,
      `runId=${session.runId}`,
      `mode=${session.mode}`,
      `status=${session.status}`,
      `startedAt=${new Date(session.startedAt).toISOString()}`,
      session.endedAt ? `endedAt=${new Date(session.endedAt).toISOString()}` : null,
      ''
    ].filter((line): line is string => line !== null)

    for (const event of session.events) {
      const time = new Date(event.ts).toISOString()
      const parts = [
        time,
        event.level,
        event.kind,
        event.nodeTitle || event.nodeId || '',
        event.status || '',
        event.durationMs != null ? `${event.durationMs}ms` : '',
        event.errorCode || '',
        event.message || ''
      ]
      lines.push(parts.filter(Boolean).join(' | '))
    }

    const apiCalls = session.apiCalls ?? []
    if (apiCalls.length) {
      lines.push('', '## API calls')
      for (const call of apiCalls) {
        lines.push(
          '',
          `### ${call.kind} node=${call.nodeId}${call.durationMs != null ? ` ${call.durationMs}ms` : ''}`,
          'request:',
          JSON.stringify(call.request, null, 2)
        )
        if (call.response) {
          lines.push('response:', JSON.stringify(call.response, null, 2))
        }
        if (call.error) lines.push(`error: ${call.error}`)
      }
    }
    return lines.join('\n')
  }

  return {
    sessions,
    activeRunId,
    dialogOpen,
    selectedRunId,
    selectedSession,
    openDialog,
    closeDialog,
    selectSession,
    beginRun,
    append,
    appendApiCall,
    endRun,
    clear,
    clearSession,
    clearForProjectSwitch,
    formatSessionPlainText
  }
})
