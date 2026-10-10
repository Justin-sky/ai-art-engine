import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * 子代理接入面板：runner 跟踪本轮派生的子代理（含孙代理），把它们锚定到发起它们的
 * 顶层 subagent 调用上；面板模式经全局工具守卫约束整棵委托树。
 */

const RUNNER = resolve('src/main/services/aiartHeadlessRunner.template.mjs')

type Listener = (payload: Record<string, unknown>) => void

interface FakeEvent {
  type: string
  data?: Record<string, unknown>
}

interface FakeAgent {
  session: {
    header: Record<string, unknown>
    seq: number
    eventAt: (seq: number) => FakeEvent | undefined
  }
  status: 'idle' | 'running'
  injected: unknown[]
  inject: (message: unknown) => void
  whenIdle: () => Promise<void>
  events: FakeEvent[]
}

interface Tracker {
  children: Map<string, { anchorId?: string; resolved: boolean }>
  noteToolCall: (
    owner: string,
    anchorId: string | undefined,
    callId: string,
    toolName: string,
    args: unknown
  ) => void
  resolveAnchor: (child: unknown, force: boolean) => boolean
  isBusy: () => boolean
  dispose: () => void
}

interface RunnerModule {
  createDelegationTracker: (ctx: unknown, root: FakeAgent, mode: string) => Tracker
  registerDelegationGuard: (ctx: unknown, getMode: () => string) => void
}

function fakeAgent(header: Record<string, unknown>, events: FakeEvent[] = []): FakeAgent {
  const agent: FakeAgent = {
    events,
    session: {
      header,
      get seq() {
        return agent.events.length
      },
      eventAt: (seq) => agent.events[Number(seq)]
    },
    status: 'idle',
    injected: [],
    inject: (message) => agent.injected.push(message),
    whenIdle: async () => undefined
  }
  return agent
}

function fakeCtx(live: FakeAgent[] = []): {
  ctx: unknown
  emit: (event: string, payload: Record<string, unknown>) => void
  guards: Array<(exec: Record<string, unknown>) => string | undefined>
} {
  const listeners = new Map<string, Set<Listener>>()
  const guards: Array<(exec: Record<string, unknown>) => string | undefined> = []
  const ctx = {
    on(event: string, fn: Listener) {
      const set = listeners.get(event) ?? new Set()
      set.add(fn)
      listeners.set(event, set)
      return () => set.delete(fn)
    },
    get(service: string) {
      if (service === 'agents') return { list: () => [...live] }
      if (service !== 'tools') return undefined
      return {
        guard: (fn: (exec: Record<string, unknown>) => string | undefined) => guards.push(fn)
      }
    }
  }
  const emit = (event: string, payload: Record<string, unknown>): void => {
    for (const fn of listeners.get(event) ?? []) fn(payload)
  }
  return { ctx, emit, guards }
}

let dir = ''
let runner: RunnerModule

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'aiart-runner-'))
  const source = readFileSync(RUNNER, 'utf8').replace(
    '__DSH_NODE_MODULES_JSON__',
    JSON.stringify(resolve('node_modules'))
  )
  const file = join(dir, 'runner.mjs')
  writeFileSync(file, source)
  runner = (await import(pathToFileURL(file).href)) as RunnerModule
})

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

const subagentHeader = (id: string, parent: string): Record<string, unknown> => ({
  id,
  parentSession: parent,
  origin: 'subagent',
  delegationDepth: 1
})

describe('createDelegationTracker', () => {
  it('只跟踪本轮主代理派生的子孙代理', () => {
    const { ctx, emit } = fakeCtx()
    const root = fakeAgent({ id: 'root' })
    const tracker = runner.createDelegationTracker(ctx, root, 'craft')
    const child = fakeAgent(subagentHeader('c1', 'root'))
    const grandchild = fakeAgent(subagentHeader('g1', 'c1'))
    const stranger = fakeAgent(subagentHeader('x1', 'other-root'))
    emit('agent/created', { agent: child })
    emit('agent/created', { agent: grandchild })
    emit('agent/created', { agent: stranger })
    expect([...tracker.children.keys()]).toEqual(['c1', 'g1'])
    tracker.dispose()
    emit('agent/created', { agent: fakeAgent(subagentHeader('c2', 'root')) })
    expect(tracker.children.has('c2')).toBe(false)
  })

  it('按 description 标签把子代理锚定到对应调用，孙代理继承顶层锚点', () => {
    const { ctx, emit } = fakeCtx()
    const root = fakeAgent({ id: 'root' })
    const tracker = runner.createDelegationTracker(ctx, root, 'craft')
    const child = fakeAgent(subagentHeader('c1', 'root'))
    emit('agent/created', { agent: child })
    child.events.push({ type: 'subagent/descriptor', data: { label: 'search refs' } })

    const childEntry = tracker.children.get('c1')
    expect(tracker.resolveAnchor(childEntry, false)).toBe(false)

    tracker.noteToolCall('root', undefined, 'call-a', 'subagent', '{"description":"draft"}')
    tracker.noteToolCall('root', undefined, 'call-b', 'subagent', { description: 'search refs' })
    tracker.noteToolCall('root', undefined, 'call-r', 'read', '{"path":"a"}')
    expect(tracker.resolveAnchor(childEntry, false)).toBe(true)
    expect(childEntry?.anchorId).toBe('call-b')

    const grandchild = fakeAgent(subagentHeader('g1', 'c1'))
    emit('agent/created', { agent: grandchild })
    tracker.noteToolCall('c1', 'call-b', 'inner-1', 'subagent_fork', '{}')
    const grandEntry = tracker.children.get('g1')
    expect(tracker.resolveAnchor(grandEntry, false)).toBe(true)
    expect(grandEntry?.anchorId).toBe('call-b')
  })

  it('收尾强制解析：找不到调用时不挂锚点，活动退回顶层', () => {
    const { ctx, emit } = fakeCtx()
    const tracker = runner.createDelegationTracker(ctx, fakeAgent({ id: 'root' }), 'craft')
    emit('agent/created', { agent: fakeAgent(subagentHeader('c1', 'root')) })
    const entry = tracker.children.get('c1')
    expect(tracker.resolveAnchor(entry, true)).toBe(true)
    expect(entry?.anchorId).toBeUndefined()
  })

  it('子代理会话开始时注入面板模式说明', () => {
    const { ctx, emit } = fakeCtx()
    runner.createDelegationTracker(ctx, fakeAgent({ id: 'root' }), 'plan')
    const child = fakeAgent(subagentHeader('c1', 'root'))
    const stranger = fakeAgent(subagentHeader('x1', 'elsewhere'))
    emit('agent/created', { agent: child })
    emit('agent/session-start', { agent: child, source: 'startup' })
    emit('agent/session-start', { agent: stranger, source: 'startup' })
    expect(stranger.injected).toHaveLength(0)
    expect(child.injected).toHaveLength(1)
    expect(JSON.stringify(child.injected[0])).toContain('panel mode: Plan')
  })

  it('收编上一轮仍存活的子孙代理，只上报本轮新事件，并按 send_message 挂卡片', () => {
    const root = fakeAgent({ id: 'root' })
    const child = fakeAgent(subagentHeader('c1', 'root'), [
      { type: 'subagent/descriptor', data: { label: 'old' } },
      { type: 'tool/call', data: { callId: 'old-1', name: 'read' } }
    ])
    const grandchild = fakeAgent(subagentHeader('g1', 'c1'))
    const stranger = fakeAgent(subagentHeader('x1', 'other-root'))
    const { ctx } = fakeCtx([root, child, grandchild, stranger])
    const tracker = runner.createDelegationTracker(ctx, root, 'craft')

    expect([...tracker.children.keys()]).toEqual(['c1', 'g1'])
    const entry = tracker.children.get('c1') as unknown as { lastSeq: number; anchorId?: string }
    expect(entry.lastSeq).toBe(2)

    // 本轮还没有任何调用唤醒它：先不挂，也不会误认领本轮的 subagent 调用
    tracker.noteToolCall('root', undefined, 'call-new', 'subagent', '{"description":"other"}')
    expect(tracker.resolveAnchor(entry, false)).toBe(false)

    tracker.noteToolCall('root', undefined, 'call-wake', 'send_message', {
      agent_id: 'c1',
      message: 'continue'
    })
    expect(tracker.resolveAnchor(entry, false)).toBe(true)
    expect(entry.anchorId).toBe('call-wake')

    // 同一轮再次唤醒：之后的活动挂到新卡片
    tracker.noteToolCall('root', undefined, 'call-wake-2', 'send_message', '{"agent_id":"c1"}')
    expect(entry.anchorId).toBe('call-wake-2')
  })

  it('收编的子代理只在面板模式变化时补注模式说明', () => {
    const root = fakeAgent({ id: 'root' })
    const child = fakeAgent(subagentHeader('c1', 'root'))
    const { ctx } = fakeCtx([root, child])
    runner.createDelegationTracker(ctx, root, 'craft').dispose()
    runner.createDelegationTracker(ctx, root, 'craft').dispose()
    expect(child.injected).toHaveLength(1)
    runner.createDelegationTracker(ctx, root, 'plan').dispose()
    expect(child.injected).toHaveLength(2)
    expect(JSON.stringify(child.injected[1])).toContain('panel mode: Plan')
  })

  it('有子代理在跑时 isBusy 为真', () => {
    const { ctx, emit } = fakeCtx()
    const tracker = runner.createDelegationTracker(ctx, fakeAgent({ id: 'root' }), 'craft')
    const child = fakeAgent(subagentHeader('c1', 'root'))
    emit('agent/created', { agent: child })
    expect(tracker.isBusy()).toBe(false)
    child.status = 'running'
    expect(tracker.isBusy()).toBe(true)
    emit('agent/disposed', { agent: child })
    expect(tracker.isBusy()).toBe(false)
  })
})

describe('registerDelegationGuard', () => {
  it('Ask 模式拒绝委托；子代理不能向用户提问', () => {
    const { ctx, guards } = fakeCtx()
    let mode = 'ask'
    runner.registerDelegationGuard(ctx, () => mode)
    expect(guards).toHaveLength(1)
    const guard = guards[0]
    const root = fakeAgent({ id: 'root' })
    const child = fakeAgent(subagentHeader('c1', 'root'))

    expect(guard({ name: 'subagent', agent: root })).toMatch(/Ask mode/)
    expect(guard({ name: 'send_message', agent: root })).toMatch(/Ask mode/)
    expect(guard({ name: 'interrupt_agent', agent: root })).toMatch(/Ask mode/)
    expect(guard({ name: 'read', agent: root })).toBeUndefined()

    mode = 'craft'
    expect(guard({ name: 'subagent', agent: root })).toBeUndefined()
    expect(guard({ name: 'ask_user_question', agent: root })).toBeUndefined()
    expect(guard({ name: 'ask_user_question', agent: child })).toMatch(/cannot ask the user/)
  })
})
