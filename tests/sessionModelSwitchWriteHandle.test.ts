import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

const RUNNER_PATH = resolve('src/main/services/aiartHeadlessRunner.template.mjs')
const HARNESS_SRC = readFileSync(resolve('src/main/services/deepseekHarnessService.ts'), 'utf8')

interface MockEvent {
  seq: number
  type: string
  data?: Record<string, unknown>
}

function createMockTurnHarness(opts?: {
  sessionExistsOnDisk?: boolean
  initialEvents?: MockEvent[]
  resumeFailuresBeforeSuccess?: number
  liveRegisteredAgent?: boolean
}) {
  const sessionId = 's_mwcye014_16jfwv'
  const events: MockEvent[] = [...(opts?.initialEvents ?? [])]
  let selectedRoute = { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.6' }
  let handleOwned = false
  let disposeCount = 0
  let createCount = 0
  let resumeCount = 0
  let remainingResumeFailures = opts?.resumeFailuresBeforeSuccess ?? 0

  const session = {
    header: { id: sessionId },
    get seq() {
      return events.length
    },
    eventAt(seq: number) {
      return events[seq]
    },
    events() {
      return [...events]
    }
  }

  const agentCtx = {
    on: () => () => {}
  }

  const agent = {
    ctx: agentCtx,
    session,
    status: 'idle',
    inbox: { hasPending: false },
    scope: {
      dispose: vi.fn(async () => {
        handleOwned = false
      })
    },
    model: {
      current: () => ({ ...selectedRoute }),
      select: vi.fn((next: { provider: string; model: string }) => {
        selectedRoute = { provider: next.provider, model: next.model }
      })
    },
    whenIdle: async () => {},
    cancel: vi.fn(),
    followup: vi.fn((msg: unknown) => {
      events.push({
        seq: events.length,
        type: 'user/message',
        data: { message: msg }
      })
      events.push({
        seq: events.length,
        type: 'assistant/message',
        data: {
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: `reply via ${selectedRoute.provider}/${selectedRoute.model}` }
            ]
          }
        }
      })
      events.push({
        seq: events.length,
        type: 'turn/end',
        data: { reason: { kind: 'completed' } }
      })
    })
  }

  const makeHandle = () => {
    handleOwned = true
    return {
      agent,
      dispose: vi.fn(async () => {
        disposeCount += 1
        handleOwned = false
      })
    }
  }

  let persistedExists = Boolean(opts?.sessionExistsOnDisk)

  const agents = {
    get: (id: string) => (opts?.liveRegisteredAgent && id === sessionId ? agent : undefined),
    create: vi.fn(
      async (params: {
        sessionId: string
        agentOptions: { provider: string; model: string }
        setup?: (aCtx: unknown, a: unknown) => void
      }) => {
        if (handleOwned) {
          throw new Error(
            `session "${params.sessionId}" is already owned by an active write handle`
          )
        }
        createCount += 1
        persistedExists = true
        selectedRoute = { ...params.agentOptions }
        params.setup?.(agentCtx, agent)
        return makeHandle()
      }
    ),
    resume: vi.fn(
      async (params: {
        resumeSessionId: string
        agentOptions: { provider: string; model: string }
        setup?: (aCtx: unknown, a: unknown) => void
      }) => {
        resumeCount += 1
        if (remainingResumeFailures > 0 || handleOwned) {
          if (remainingResumeFailures > 0) remainingResumeFailures -= 1
          throw new Error(
            `session "${params.resumeSessionId}" is already owned by an active write handle`
          )
        }
        selectedRoute = { ...params.agentOptions }
        params.setup?.(agentCtx, agent)
        return makeHandle()
      }
    )
  }

  const sessions = {
    flush: vi.fn(async () => {})
  }

  const sessionPersistence = {
    stat: vi.fn(async (id: string) => (persistedExists && id === sessionId ? { id } : undefined)),
    list: vi.fn(async () => (persistedExists ? [{ id: sessionId }] : []))
  }

  const services = new Map<string, unknown>([
    ['agents', agents],
    ['sessions', sessions],
    ['sessionPersistence', sessionPersistence]
  ])

  const ctx = {
    get: (key: string) => services.get(key),
    on: () => () => {}
  }

  const io = {
    stdout: { write: vi.fn() },
    stderr: { write: vi.fn() },
    exit: vi.fn()
  }

  return {
    sessionId,
    ctx,
    io,
    agent,
    agents,
    sessions,
    getSelectedRoute: () => selectedRoute,
    isHandleOwned: () => handleOwned,
    getDisposeCount: () => disposeCount,
    getCreateCount: () => createCount,
    getResumeCount: () => resumeCount
  }
}

describe('Same-session model & provider switching without SessionAlreadyOwnedError', () => {
  it('releases the session write handle immediately after an idle turn and cleanly resumes with a switched model/provider', async () => {
    const mod = (await import(pathToFileURL(RUNNER_PATH).href)) as {
      runOneTurn: (
        ctx: unknown,
        io: unknown,
        opts: Record<string, unknown>
      ) => Promise<{ text: string }>
    }

    const h = createMockTurnHarness()
    const agentSlot = { handle: undefined, sessionId: '', model: '', provider: '' }

    // Turn 1 on OpenRouter Claude
    await mod.runOneTurn(h.ctx, h.io, {
      task: '分析配表并生成策划案',
      sessionId: h.sessionId,
      mode: 'craft',
      sandboxMode: 'workspace-write',
      runId: '1',
      selection: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.6' },
      answerAskUserQuestion: async () => ({ answers: [] }),
      agentSlot
    })

    // Write handle MUST be disposed immediately after Turn 1 since no schedule/armed goal is active
    expect(h.getCreateCount()).toBe(1)
    expect(h.getDisposeCount()).toBe(1)
    expect(h.isHandleOwned()).toBe(false)
    expect(agentSlot.handle).toBeUndefined()

    // Turn 2 in the SAME session (`s_mwcye014_16jfwv`), switched to DeepSeek Reasoner (even on a newly spawned worker slot!)
    const freshWorkerSlot = { handle: undefined, sessionId: '', model: '', provider: '' }
    await mod.runOneTurn(h.ctx, h.io, {
      task: '现在把完整策划案写入画布节点',
      sessionId: h.sessionId,
      mode: 'craft',
      sandboxMode: 'workspace-write',
      runId: '2',
      selection: { provider: 'deepseek-official', model: 'deepseek-reasoner' },
      answerAskUserQuestion: async () => ({ answers: [] }),
      agentSlot: freshWorkerSlot
    })

    expect(h.getResumeCount()).toBe(1)
    expect(h.getSelectedRoute()).toEqual({
      provider: 'deepseek-official',
      model: 'deepseek-reasoner'
    })
    expect(h.isHandleOwned()).toBe(false)
  })

  it('hot-switches the active model in place without closing/reopening the write handle when an armed goal retains the session', async () => {
    const mod = (await import(pathToFileURL(RUNNER_PATH).href)) as {
      runOneTurn: (
        ctx: unknown,
        io: unknown,
        opts: Record<string, unknown>
      ) => Promise<{ text: string }>
    }

    // Seed an active paused/armed goal check: let Turn 1 emit a goal/change start, then simulate paused on loop check
    const h = createMockTurnHarness({
      initialEvents: [
        {
          seq: 0,
          type: 'goal/change',
          data: {
            action: 'start',
            goalId: 'g_1',
            title: 'Complete GDD',
            objective: 'Write SLG GDD to canvas'
          }
        }
      ]
    })
    const agentSlot = { handle: undefined, sessionId: '', model: '', provider: '' }

    // Turn 1 retains the write handle because `extractGoalState` sees an active armed goal in session events
    await mod.runOneTurn(h.ctx, h.io, {
      task: '第一轮分析',
      sessionId: h.sessionId,
      mode: 'craft',
      sandboxMode: 'workspace-write',
      runId: '1',
      selection: { provider: 'openai-1', model: 'gpt-5.4' },
      answerAskUserQuestion: async () => ({ answers: [] }),
      agentSlot
    })

    expect(h.isHandleOwned()).toBe(true)
    expect(h.getDisposeCount()).toBe(0)
    expect(agentSlot.handle).toBeDefined()

    // Turn 2 switches model on the retained handle: MUST hot-switch in place without calling dispose() or resume()
    await mod.runOneTurn(h.ctx, h.io, {
      task: '切换到 gpt-5.4-mini 继续执行',
      sessionId: h.sessionId,
      mode: 'craft',
      sandboxMode: 'workspace-write',
      runId: '2',
      selection: { provider: 'openai-1', model: 'gpt-5.4-mini' },
      answerAskUserQuestion: async () => ({ answers: [] }),
      agentSlot
    })

    expect(h.getDisposeCount()).toBe(0)
    expect(h.getResumeCount()).toBe(0)
    expect(h.agent.model.select).toHaveBeenCalledWith({
      provider: 'openai-1',
      model: 'gpt-5.4-mini'
    })
    expect(h.getSelectedRoute()).toEqual({
      provider: 'openai-1',
      model: 'gpt-5.4-mini'
    })
  })

  it('retries agents.resume with backoff when an exiting worker briefly holds the Windows session write semaphore', async () => {
    const mod = (await import(pathToFileURL(RUNNER_PATH).href)) as {
      runOneTurn: (
        ctx: unknown,
        io: unknown,
        opts: Record<string, unknown>
      ) => Promise<{ text: string }>
    }

    const h = createMockTurnHarness({
      sessionExistsOnDisk: true,
      resumeFailuresBeforeSuccess: 2
    })
    const agentSlot = { handle: undefined, sessionId: '', model: '', provider: '' }

    await mod.runOneTurn(h.ctx, h.io, {
      task: '切换模型后继续',
      sessionId: h.sessionId,
      mode: 'craft',
      sandboxMode: 'workspace-write',
      runId: '3',
      selection: { provider: 'google-1', model: 'gemini-2.5-pro' },
      answerAskUserQuestion: async () => ({ answers: [] }),
      agentSlot
    })

    // Failed twice with `already owned by an active write handle`, succeeded on attempt 3
    expect(h.getResumeCount()).toBe(3)
    expect(h.getSelectedRoute()).toEqual({
      provider: 'google-1',
      model: 'gemini-2.5-pro'
    })
  })

  it('recovers and hot-updates model selection when same-process agents.get() holds a leaked live session', async () => {
    const mod = (await import(pathToFileURL(RUNNER_PATH).href)) as {
      runOneTurn: (
        ctx: unknown,
        io: unknown,
        opts: Record<string, unknown>
      ) => Promise<{ text: string }>
    }

    const h = createMockTurnHarness({
      sessionExistsOnDisk: true,
      resumeFailuresBeforeSuccess: 99,
      liveRegisteredAgent: true
    })
    const agentSlot = { handle: undefined, sessionId: '', model: '', provider: '' }

    await mod.runOneTurn(h.ctx, h.io, {
      task: '同进程恢复并应用新模型',
      sessionId: h.sessionId,
      mode: 'craft',
      sandboxMode: 'workspace-write',
      runId: '4',
      selection: { provider: 'openrouter', model: 'google/gemini-2.5-pro' },
      answerAskUserQuestion: async () => ({ answers: [] }),
      agentSlot
    })

    expect(h.getResumeCount()).toBe(1)
    expect(h.getSelectedRoute()).toEqual({
      provider: 'openrouter',
      model: 'google/gemini-2.5-pro'
    })
  })

  it('enforces same-session slot affinity across provider changes and awaits old worker exit in deepseekHarnessService', () => {
    // 1. selectOrCreateSlotForInput reuses idle slot with matching `lastSessionId` even when `workerFingerprint` differs
    const selectFnStart = HARNESS_SRC.indexOf('function selectOrCreateSlotForInput(')
    const selectFnEnd = HARNESS_SRC.indexOf('export async function runHarnessJobWait(')
    expect(selectFnStart).toBeGreaterThan(0)
    const selectFnBody = HARNESS_SRC.slice(selectFnStart, selectFnEnd)
    expect(selectFnBody).toContain(
      'if (isSlotIdle(slot) && slot.lastSessionId === targetSessionId)'
    )

    // 2. ensurePersistentWorkerUnlocked checks bootedModelIds and awaits gracefulShutdownAndKillSlotChild
    const ensureFnStart = HARNESS_SRC.indexOf('async function ensurePersistentWorkerUnlocked(')
    const ensureFnEnd = HARNESS_SRC.indexOf('function resolveProjectCanvasContext(')
    expect(ensureFnStart).toBeGreaterThan(0)
    const ensureFnBody = HARNESS_SRC.slice(ensureFnStart, ensureFnEnd)
    expect(ensureFnBody).toContain('slot.bootedModelIds.has(modelId)')
    expect(ensureFnBody).toContain('await gracefulShutdownAndKillSlotChild(slot)')
    expect(ensureFnBody).toContain('slot.pendingExitPromise')

    // 3. startHarnessOnSlot proactively releases target session from any other worker slots before resuming
    expect(HARNESS_SRC).toContain('await releaseSessionFromOtherSlots(effectiveSessionId, slot)')
    expect(HARNESS_SRC).toContain('function waitForChildProcessExit(')
  })
})
