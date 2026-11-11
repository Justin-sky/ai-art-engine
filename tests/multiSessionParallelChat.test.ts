import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  clearActiveHarnessRunState,
  clearAllWorkerSlotHarnessRunStates,
  resolveHarnessAwareAccessView,
  resolveHarnessRunForContext,
  setActiveHarnessRunState,
  setWorkerSlotHarnessRunState,
  type HarnessRunAccessState
} from '../src/shared/harnessActiveRunAccess'
import { denialReasonForTool, isToolVisible } from '../src/shared/mcpModeAccess'
import { mcpActivityService } from '../src/main/services/mcpActivityService'
import { useChatHistory } from '../src/renderer/src/composables/useChatHistory'

function createMemoryLocalStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null
    },
    key(index: number) {
      return [...store.keys()][index] ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(key, String(value))
    }
  }
}

describe('多会话并行执行（Multi-Session Parallel Chat）核心隔离与路由校验', () => {
  beforeEach(() => {
    clearActiveHarnessRunState()
    clearAllWorkerSlotHarnessRunStates()
    mcpActivityService.setSessionResolver(null)
    vi.stubGlobal('localStorage', createMemoryLocalStorage())
  })

  it('1. 并发槽位（x-aiart-worker-slot）模式与 Plan 确认状态完全隔离，互不串扰', () => {
    const accessMap = new Map<string, HarnessRunAccessState>([
      ['run-ask', { mode: 'ask', confirmed: false }],
      ['run-plan', { mode: 'plan', confirmed: false }],
      ['run-craft', { mode: 'craft', confirmed: true }]
    ])

    setWorkerSlotHarnessRunState('slot-1', {
      runId: 'run-ask',
      mode: 'ask',
      sessionId: 'sess-a',
      workspace: 'F:/proj-a'
    })
    setWorkerSlotHarnessRunState('slot-2', {
      runId: 'run-plan',
      mode: 'plan',
      sessionId: 'sess-b',
      workspace: 'F:/proj-b'
    })
    setWorkerSlotHarnessRunState('slot-3', {
      runId: 'run-craft',
      mode: 'craft',
      sessionId: 'sess-c',
      workspace: 'F:/proj-c'
    })
    // 即使旧版全局镜像指向 Ask 会话，其它槽位也不受影响
    setActiveHarnessRunState('run-ask', 'ask', 'sess-a')

    // slot-1 (Ask)：仅只读工具可见，禁止 write / generate
    const askView = resolveHarnessAwareAccessView({ workerSlot: 'slot-1' }, accessMap)
    expect(askView.mode).toBe('ask')
    expect(askView.confirmed).toBe(false)
    expect(isToolVisible('write', askView)).toBe(false)
    expect(denialReasonForTool('write', askView)).toBeTruthy()
    expect(resolveHarnessRunForContext({ workerSlot: 'slot-1' })?.sessionId).toBe('sess-a')

    // slot-2 (Plan 未确认)：未确认前保持 Plan 未放行，确认后立即放行且不影响 slot-1
    const planBefore = resolveHarnessAwareAccessView({ workerSlot: 'slot-2' }, accessMap)
    expect(planBefore.mode).toBe('plan')
    expect(planBefore.confirmed).toBe(false)
    expect(denialReasonForTool('write', planBefore)).toBeTruthy()

    accessMap.set('run-plan', { mode: 'plan', confirmed: true })
    const planAfter = resolveHarnessAwareAccessView({ workerSlot: 'slot-2' }, accessMap)
    expect(planAfter.mode).toBe('plan')
    expect(planAfter.confirmed).toBe(true)
    expect(denialReasonForTool('write', planAfter)).toBeNull()
    expect(resolveHarnessAwareAccessView({ workerSlot: 'slot-1' }, accessMap).mode).toBe('ask')

    // slot-3 (Craft)：始终拥有完整读写与生成权限
    const craftView = resolveHarnessAwareAccessView({ workerSlot: 'slot-3' }, accessMap)
    expect(craftView.mode).toBe('craft')
    expect(craftView.confirmed).toBe(true)
    expect(denialReasonForTool('write', craftView)).toBeNull()
    expect(resolveHarnessRunForContext({ workerSlot: 'slot-3' })?.sessionId).toBe('sess-c')

    // 空闲的 slot-4（如预热中的新槽位拉取 tools/list）不会被 slot-1 的 Ask 误裁剪工具清单
    const idleSlotView = resolveHarnessAwareAccessView({ workerSlot: 'slot-4' }, accessMap)
    expect(idleSlotView).toEqual({})
    expect(isToolVisible('write', idleSlotView)).toBe(true)
    expect(resolveHarnessRunForContext({ workerSlot: 'slot-4' })).toBeNull()
  })

  it('2. mcpActivityService 自动将并发工具调用活动打上对应会话的 sessionId 标签', () => {
    let activeAsyncLocalSession: string | undefined
    mcpActivityService.setSessionResolver(() => activeAsyncLocalSession)

    activeAsyncLocalSession = 'sess-project-1'
    const id1 = mcpActivityService.begin({ tool: 'graph_edit', title: '搭建分镜节点图' })

    activeAsyncLocalSession = 'sess-project-2'
    const id2 = mcpActivityService.begin({ tool: 'generate_image', title: '生成角色立绘' })

    const id3 = mcpActivityService.begin({
      tool: 'task_run',
      title: '运行工作流',
      sessionId: 'explicit-session-id'
    })

    const list = mcpActivityService.list()
    expect(list.find((a) => a.id === id1)?.sessionId).toBe('sess-project-1')
    expect(list.find((a) => a.id === id2)?.sessionId).toBe('sess-project-2')
    expect(list.find((a) => a.id === id3)?.sessionId).toBe('explicit-session-id')
  })

  it('3. useChatHistory 支持前台会话编辑期间，同工作区及跨外部工程的后台并行会话实时落盘消息、上下文与 Todo', () => {
    const history = useChatHistory()
    history.setWorkspaceScope('proj-main', 'F:/studio/main-project')
    history.load('proj-main')

    const fgSession1 = history.activeSession.value!
    history.commitMessages([{ kind: 'user', text: '主工程会话 1 正在生成分镜' }])
    history.persist()

    // 在同一工作空间下新建会话 2 并激活为当前前台会话
    const fgSession2 = history.createWorkspaceSession()
    expect(fgSession2.id).not.toBe(fgSession1.id)
    expect(history.activeId.value).toBe(fgSession2.id)

    // 再挂载一个外部工程目录（如 F:/code/clientdev_2021）并在其中拥有独立会话，随后切回主工程会话 2
    const extEntry = history.addExternalProject('F:/code/clientdev_2021', 'clientdev_2021')!
    expect(extEntry).toBeTruthy()
    const extSession = history.activeSession.value!
    history.commitMessages([{ kind: 'user', text: '分析 clientdev_2021 架构' }])
    history.persist()

    // 用户切回主工程的会话 2 继续交互
    history.activateProjectSession('proj-main', fgSession2.id)
    expect(history.activeId.value).toBe(fgSession2.id)

    // 模拟后台并行运行：
    // (A) 同工作区的后台会话 fgSession1 流式追加回答与上下文用量
    history.updateSessionById(fgSession1.id, (s) => {
      s.messages.push({ kind: 'assistant', text: '分镜节点已搭建完成。', final: true })
    })
    history.commitContextUsed(42_500, fgSession1.id)
    history.commitTodos(
      [{ id: 't1', content: '生成第一幕分镜', status: 'completed' }],
      fgSession1.id
    )

    // (B) 跨工程目录（clientdev_2021）的后台会话 extSession 同时流式追加工具卡与回答
    history.updateSessionById(extSession.id, (s) => {
      s.messages.push({
        kind: 'tool',
        key: 'tool:read_1',
        name: 'read',
        state: 'done',
        detail: 'package.json'
      })
      s.messages.push({
        kind: 'assistant',
        text: 'clientdev_2021 核心模块梳理完毕。',
        final: true
      })
    })
    history.commitContextUsed(88_000, extSession.id)

    // 当前前台会话 fgSession2 完全不受干扰
    expect(history.activeId.value).toBe(fgSession2.id)
    expect(history.activeSession.value?.messages).toEqual([])

    // 切回同工作区后台会话 fgSession1：流式结果、上下文 token、Todo 完整保留
    history.activate(fgSession1.id)
    expect(history.activeSession.value?.messages).toHaveLength(2)
    expect(history.activeSession.value?.messages[1]).toMatchObject({
      kind: 'assistant',
      text: '分镜节点已搭建完成。',
      final: true
    })
    expect(history.activeSession.value?.contextUsed).toBe(42_500)
    expect(history.activeSession.value?.todos).toEqual([
      { id: 't1', content: '生成第一幕分镜', status: 'completed' }
    ])

    // 切到外部工程会话 extSession：跨工程后台并行写入的消息与上下文 token 同样完整保留
    expect(history.getSessionScope(extSession.id)).toBe(extEntry.scope)
    history.activateProjectSession(extEntry.scope, extSession.id)
    expect(history.activeSession.value?.messages).toHaveLength(3)
    expect(history.activeSession.value?.messages[2]).toMatchObject({
      kind: 'assistant',
      text: 'clientdev_2021 核心模块梳理完毕。',
      final: true
    })
    expect(history.activeSession.value?.contextUsed).toBe(88_000)
  })
})
