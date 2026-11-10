/**
 * 对话历史的上下文用量持久化（`ChatSession.contextUsed`）。
 *
 * 回归背景：对话输入框右侧的环形进度条优先显示 harness 每轮 LLM 请求后上报的真实上下文
 * token（含系统提示 / 工具定义 / 历史），而该值此前只存在渲染层内存里：重启应用、切换会话、
 * 关掉面板都会清空，界面于是回退到「只数用户与助手文本」的本地估算（不含系统提示、工具定义
 * 与工具结果），用户看到的就是「重开软件后进度从几百 K 掉到几 K，像没保存」。
 *
 * 这里覆盖持久化链路本身：写盘 → 换实例（模拟重启）→ 读回 → 恢复；并覆盖脏数据与
 * 「用量上报不得搅乱会话列表顺序」两条约定。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  computeNextAutomationRunAt,
  extractProjectFolderName,
  formatChatSessionRelativeAge,
  formatTimeOfDay12h,
  formatTimeOfDay24h,
  isUntitledDraftSession,
  normalizeTimeOfDay,
  resolveProjectChatScope,
  useChatHistory
} from '../src/renderer/src/composables/useChatHistory'

/** 内存版 localStorage：同一实例内共享，用来模拟「重启应用后浏览器存储仍在」 */
class MemoryStorage {
  private store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
}

const SESSIONS_KEY = 'studio.chat.sessions.v1'

/** 装一个干净的存储并返回它，便于直接检查落盘内容 */
function installStorage(seed?: string): MemoryStorage {
  const storage = new MemoryStorage()
  if (seed !== undefined) storage.setItem(SESSIONS_KEY, seed)
  vi.stubGlobal('localStorage', storage)
  return storage
}

/**
 * 造一条落盘会话记录（其余字段取最小值，测试只关心里面的 contextUsed）。
 * `contextUsedLiteral` 传原始 JSON 片段而非 JS 值：脏数据用例需要 `1e999` 这类
 * 经 JSON.stringify 会被改写成 `null` 的字面量。
 */
function sessionJson(id: string, contextUsedLiteral?: string): string {
  const extra = contextUsedLiteral === undefined ? '' : `,"contextUsed":${contextUsedLiteral}`
  return `[{"id":"${id}","title":"t","createdAt":1,"updatedAt":1,"messages":[]${extra}}]`
}

describe('useChatHistory 的上下文用量持久化', () => {
  beforeEach(() => {
    installStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('换实例（模拟重启）后仍能读回上次上报的真实用量', () => {
    const before = useChatHistory()
    before.load()
    before.commitMessages([{ kind: 'user', text: 'first turn' }])
    before.commitContextUsed(412_345)
    before.persist()

    // 重启：新实例读同一份存储
    const after = useChatHistory()
    after.load()
    expect(after.activeSession.value?.contextUsed).toBe(412_345)
  })

  it('用量按会话隔离：切回旧会话拿到自己那份，新会话保持缺省', () => {
    const history = useChatHistory()
    history.load()
    history.commitMessages([{ kind: 'user', text: 'a' }])
    history.commitContextUsed(111_000)
    history.persist()
    const firstId = history.activeId.value

    history.create()
    history.commitMessages([{ kind: 'user', text: 'b' }])
    history.persist()
    const secondId = history.activeId.value
    expect(secondId).not.toBe(firstId)
    expect(history.activeSession.value?.contextUsed).toBeUndefined()

    history.activate(firstId)
    expect(history.activeSession.value?.contextUsed).toBe(111_000)
    history.activate(secondId)
    expect(history.activeSession.value?.contextUsed).toBeUndefined()
  })

  it('用量上报只改该字段，不动 updatedAt（不搅乱会话列表顺序）', () => {
    const history = useChatHistory()
    history.load()
    history.commitMessages([{ kind: 'user', text: 'a' }])
    const updatedAt = history.activeSession.value?.updatedAt
    const title = history.activeSession.value?.title

    history.commitContextUsed(999_000)

    expect(history.activeSession.value?.contextUsed).toBe(999_000)
    expect(history.activeSession.value?.updatedAt).toBe(updatedAt)
    expect(history.activeSession.value?.title).toBe(title)
  })

  it('缺省记为「从未上报」，重复写入 undefined 不产生字段', () => {
    const storage = installStorage()
    const history = useChatHistory()
    history.load()
    expect(history.activeSession.value?.contextUsed).toBeUndefined()

    history.commitContextUsed(undefined)
    history.persist()

    const raw = storage.getItem(SESSIONS_KEY) ?? ''
    expect(raw).not.toContain('contextUsed')
  })

  it.each([
    ['负数', '-1'],
    ['字符串', '"abc"'],
    ['null', 'null'],
    ['溢出为 Infinity', '1e999']
  ])('丢弃脏数据（%s）：视为无记录，交给渲染层回退估算', (_label, literal) => {
    installStorage(sessionJson('s_dirty', literal))
    const history = useChatHistory()
    history.load()

    expect(history.activeSession.value?.contextUsed).toBeUndefined()
  })

  it('合法用量原样保留（含 0）', () => {
    installStorage(sessionJson('s_zero', '0'))
    const history = useChatHistory()
    history.load()

    expect(history.activeSession.value?.contextUsed).toBe(0)
  })

  it('按项目（config.id / rootPath）严格隔离 AI 会话：新建项目绝不带入其它项目的历史会话，切回原项目可恢复', () => {
    installStorage()
    const history = useChatHistory()

    // 项目 A 中有对话历史与多个会话
    const scopeA = resolveProjectChatScope('proj-uuid-a', 'F:\\Projects\\Alpha')
    history.load(scopeA)
    const projASession1 = history.activeId.value
    history.commitMessages([
      { kind: 'user', text: '项目A的第一条消息' },
      { kind: 'assistant', text: '项目A的回复', final: true }
    ])
    history.persist()
    history.create()
    const projASession2 = history.activeId.value
    history.commitMessages([{ kind: 'user', text: '项目A的第二段对话' }])
    history.persist()
    expect(history.sessions.value).toHaveLength(2)

    // 新建项目 B：使用全新的 project.config.id，会话列表应为全新空白会话，绝不包含项目 A 的任何会话
    const scopeB = resolveProjectChatScope('proj-uuid-b', 'F:\\Projects\\Beta')
    history.load(scopeB)
    expect(history.sessions.value).toHaveLength(1)
    expect(history.activeId.value).not.toBe(projASession1)
    expect(history.activeId.value).not.toBe(projASession2)
    expect(history.activeSession.value?.messages).toEqual([])
    expect(history.activeSession.value?.title).toBe('')

    // 在项目 B 中写入消息并保存
    history.commitMessages([{ kind: 'user', text: '项目B的独立消息' }])
    history.persist()

    // 切回项目 A：完整恢复项目 A 的 2 个会话与当前激活会话
    history.load(scopeA)
    expect(history.sessions.value).toHaveLength(2)
    expect(history.activeId.value).toBe(projASession2)
    expect(history.activeSession.value?.messages).toEqual([
      { kind: 'user', text: '项目A的第二段对话' }
    ])
  })

  it('支持 Codex 风格多项目树（Projects -> Conversations）：添加外部项目、跨项目切换会话、新建与移除项目', () => {
    installStorage()
    const history = useChatHistory()

    // 1. 注册主工程 ai-art-engine
    const p1 = history.registerProject({
      projectId: 'proj-aiart',
      rootPath: 'F:\\aircraft\\gitee\\ai-art-engine',
      activate: true
    })
    expect(p1?.name).toBe('ai-art-engine')
    expect(history.activeProject.value?.name).toBe('ai-art-engine')
    history.commitMessages([{ kind: 'user', text: 'Comic Page Node Redesign' }])
    history.persist()
    const s1Id = history.activeId.value

    // 在 ai-art-engine 下再建一个空白未命名会话
    history.create()
    const s2Untitled = history.activeSession.value!
    expect(isUntitledDraftSession(s2Untitled)).toBe(true)

    // 2. 添加第二个外部项目 clientdev_2021 并自动切换过去
    const p2 = history.addExternalProject('D:\\repos\\clientdev_2021')
    expect(p2?.name).toBe('clientdev_2021')
    expect(history.activeProject.value?.rootPath).toBe('D:\\repos\\clientdev_2021')
    history.commitMessages([{ kind: 'user', text: 'Arena Ranking UI Bug Fix' }])
    history.persist()
    const clientSessionId = history.activeId.value

    // 3. 检查 projectTree 完整包含两个项目及其各自会话
    const tree = history.projectTree.value
    expect(tree).toHaveLength(2)
    expect(tree.map((g) => g.name)).toEqual(['clientdev_2021', 'ai-art-engine'])

    // 4. 从 Projects 树点击切回 ai-art-engine 的第一条会话
    history.activateProjectSession(p1!.scope, s1Id)
    expect(history.activeProject.value?.name).toBe('ai-art-engine')
    expect(history.activeSession.value?.title).toBe('Comic Page Node Redesign')

    // 5. 在非当前激活的 clientdev_2021 项目下直接新建会话
    const createdInClient = history.createSessionInProject(p2!.scope)
    expect(history.activeProject.value?.name).toBe('clientdev_2021')
    expect(createdInClient.id).not.toBe(clientSessionId)
    expect(history.sessions.value).toHaveLength(2)

    // 6. 移除外部项目 clientdev_2021 后自动回退到主工程 ai-art-engine
    history.removeProject(p2!.scope, p1!.scope)
    expect(history.projectTree.value).toHaveLength(1)
    expect(history.activeProject.value?.name).toBe('ai-art-engine')
  })

  it('extractProjectFolderName 与 formatChatSessionRelativeAge 格式化符合 Codex 规范', () => {
    expect(extractProjectFolderName('F:\\aircraft\\gitee\\ai-art-engine\\')).toBe('ai-art-engine')
    expect(extractProjectFolderName('/Users/dev/clientdev_2021')).toBe('clientdev_2021')
    const now = 1_700_000_000_000
    expect(formatChatSessionRelativeAge(now - 6 * 86_400_000, now)).toBe('6d')
    expect(formatChatSessionRelativeAge(now - 3 * 86_400_000, now)).toBe('3d')
    expect(formatChatSessionRelativeAge(now - 4 * 3_600_000, now)).toBe('4h')
    expect(formatChatSessionRelativeAge(now - 15 * 60_000, now)).toBe('15m')
  })

  it('工作空间（Workspace）自身会话归属 workspaceSessions（Conversations 区），不显示在 Projects 工程树下，且添加的外部工程与工作空间会话均直接可见', () => {
    const history = useChatHistory()
    const wsScope = resolveProjectChatScope('ws_demo21', 'F:/workspaces/demo21')
    history.setWorkspaceScope(wsScope, 'F:/workspaces/demo21')
    history.load(wsScope)

    // 1. 当前工作空间 demo21 的会话属于工作空间会话（workspaceSessions），绝不作为工程文件夹出现在 projectTree 下
    history.commitMessages([{ kind: 'user', text: 'Main Workspace Plan' }])
    history.persist()
    expect(history.projectTree.value).toHaveLength(0)
    expect(history.workspaceSessions.value).toHaveLength(1)
    expect(history.workspaceSessions.value[0]?.title).toBe('Main Workspace Plan')

    // 即使误调 registerProject 传入当前工作空间自身路径，也会被拦截，不进入 Projects 树
    const selfAttempt = history.registerProject({
      projectId: 'ws_demo21',
      rootPath: 'F:/workspaces/demo21'
    })
    expect(selfAttempt).toBeNull()
    expect(history.projectTree.value).toHaveLength(0)

    // 2. 在 AI 对话中添加另外两个外部工程到此工作空间（显示在 Projects 下）
    const ext1 = history.addExternalProject('F:/work/clientdev_2021')
    expect(ext1?.name).toBe('clientdev_2021')
    history.commitMessages([{ kind: 'user', text: 'Arena Ranking Bug Fix' }])
    history.persist()

    const ext2 = history.addExternalProject('F:/work/Client_Harmony')
    expect(ext2?.name).toBe('Client_Harmony')
    history.commitMessages([{ kind: 'user', text: 'HarmonyOS Login Flow' }])
    history.persist()

    // Projects 树仅包含添加的两个外部工程，不包含工作空间自身 demo21
    expect(history.projectTree.value.map((g) => g.name)).toEqual([
      'Client_Harmony',
      'clientdev_2021'
    ])
    // 工作空间自身的会话始终在 workspaceSessions 中直接可见
    expect(history.workspaceSessions.value.map((s) => s.title)).toEqual(['Main Workspace Plan'])

    // 3. 在外部工程激活态下点击「+ New Conversation」（createWorkspaceSession），直接在工作空间 Conversations 下新建会话
    const newWsSession = history.createWorkspaceSession()
    expect(history.scope.value).toBe(wsScope)
    expect(history.workspaceSessions.value).toHaveLength(2)
    expect(history.activeSession.value?.id).toBe(newWsSession.id)

    // 4. 切换到另一个新建工作空间 ws_beta，不会串入 demo21 挂载的外部工程列表
    const betaScope = resolveProjectChatScope('ws_beta', 'F:/workspaces/beta-studio')
    history.setWorkspaceScope(betaScope, 'F:/workspaces/beta-studio')
    history.load(betaScope)
    expect(history.projectTree.value).toHaveLength(0)
  })

  it('Automations 定时任务支持创建、12 小时制格式化、下次触发时间计算、启停与重开恢复', () => {
    expect(formatTimeOfDay12h('09:00')).toBe('9:00 AM')
    expect(formatTimeOfDay12h('13:30')).toBe('1:30 PM')
    expect(formatTimeOfDay12h('00:00')).toBe('12:00 AM')
    expect(formatTimeOfDay12h('12:00')).toBe('12:00 PM')

    expect(normalizeTimeOfDay('18:05')).toBe('18:05')
    expect(normalizeTimeOfDay('18：05')).toBe('18:05')
    expect(normalizeTimeOfDay('9:5')).toBe('09:05')
    expect(normalizeTimeOfDay('930')).toBe('09:30')
    expect(normalizeTimeOfDay('1805')).toBe('18:05')
    expect(normalizeTimeOfDay('23:59')).toBe('23:59')
    expect(normalizeTimeOfDay('18')).toBe('18:00')
    expect(normalizeTimeOfDay('1:30 PM')).toBe('13:30')
    expect(formatTimeOfDay24h('9:05')).toBe('09:05')

    const baseMorning = new Date(2026, 10, 9, 8, 15, 0, 0).getTime()
    const next9am = computeNextAutomationRunAt('every_day', '09:00', baseMorning)
    const next9amDate = new Date(next9am)
    expect(next9amDate.getHours()).toBe(9)
    expect(next9amDate.getMinutes()).toBe(0)
    expect(next9amDate.getDate()).toBe(9)

    const history = useChatHistory()
    const wsScope = resolveProjectChatScope('ws_demo21', 'F:/workspaces/demo21')
    history.setWorkspaceScope(wsScope, 'F:/workspaces/demo21')
    history.load(wsScope)

    const created = history.createAutomation({
      title: 'Overnight Bug Summary',
      modelId: 'Flash',
      frequency: 'every_day',
      timeOfDay: '09:00',
      instructions: 'Summarize new bugs assigned to me and anything that changed overnight.'
    })
    expect(created).not.toBeNull()
    expect(created?.title).toBe('Overnight Bug Summary')
    expect(created?.modelId).toBe('Flash')
    expect(created?.frequency).toBe('every_day')
    expect(created?.timeOfDay).toBe('09:00')
    expect(created?.enabled).toBe(true)
    expect(history.automations.value).toHaveLength(1)

    // 暂停与恢复
    history.toggleAutomationEnabled(created!.id)
    expect(history.automations.value[0]?.enabled).toBe(false)
    history.toggleAutomationEnabled(created!.id)
    expect(history.automations.value[0]?.enabled).toBe(true)

    // 标记执行完成并顺延下次触发时间
    const prevNext = history.automations.value[0]!.nextRunAt
    history.markAutomationTriggered(created!.id, prevNext + 1000)
    expect(history.automations.value[0]?.lastRunAt).toBe(prevNext + 1000)
    expect(history.automations.value[0]!.nextRunAt).toBeGreaterThan(prevNext)

    // 模拟重开应用后依然持久化存在
    const history2 = useChatHistory()
    history2.setWorkspaceScope(wsScope, 'F:/workspaces/demo21')
    history2.load(wsScope)
    expect(history2.automations.value).toHaveLength(1)
    expect(history2.automations.value[0]?.title).toBe('Overnight Bug Summary')

    // 删除定时任务
    history2.removeAutomation(created!.id)
    expect(history2.automations.value).toHaveLength(0)
  })
})
