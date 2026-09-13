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
import { useChatHistory } from '../src/renderer/src/composables/useChatHistory'

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
})
