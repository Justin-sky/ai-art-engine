/**
 * AI 对话历史会话（localStorage 持久化）。
 *
 * 会话结构：一组消息 + 标题 + 时间戳。消息内容均为可 JSON 序列化数据
 * （含工具卡的资产相对路径），因此可以直接落 localStorage，无需主进程参与。
 * 面板关闭 / 应用重启后，下次打开恢复上次会话。
 */
import { computed, ref } from 'vue'

export type ChatMsg =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; final?: boolean; reasoning?: string }
  | { kind: 'status'; text: string }
  | {
      kind: 'tool'
      /** 会话内唯一标识：`tool:<id|name>`（dsh-agent 工具，优先 callId）或 `mcp:<id>`（生成活动），用于原地更新状态 */
      key: string
      name: string
      state: 'start' | 'done' | 'error'
      detail?: string
      /** 工具调用实例 ID（dsh callId）：同一工具多次调用可区分；旧数据可能缺失 */
      id?: string
      /** MCP 生成活动关联资产的工程内相对路径：done 后据此在对话末尾生成独立预览卡（图片/视频/音频/3D） */
      relativePath?: string
    }
  | {
      kind: 'asset'
      /** 会话内唯一标识：`asset:<mcp activity id>`，与对应工具卡的 `mcp:<id>` 同源，用于去重 */
      key: string
      /** 生成资产在工程内的相对路径（图片/视频/音频/3D） */
      relativePath: string
    }
  | {
      kind: 'prompt'
      /** ask_user 提问 id（MCP 侧 requestId），回传选择时使用 */
      requestId: string
      question: string
      /** 选项列表（缺省时渲染层提供默认按钮） */
      options?: string[]
      /** 附加说明（可选） */
      hint?: string
      /** 用户选择结果（null=未答；非 null=已答） */
      answered?: string | null
    }

export interface ChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMsg[]
}

const SESSIONS_KEY = 'studio.chat.sessions.v1'
const ACTIVE_KEY = 'studio.chat.activeSessionId.v1'
/** 持久化上限：单会话最多保留的消息条数（超出丢弃最旧的 status / 历史轮次，避免无限膨胀） */
const MAX_MESSAGES_PER_SESSION = 600
/** 会话标题长度上限 */
const MAX_TITLE_LENGTH = 24

/** 会话历史按 agent 分命名空间：缺省 agent 沿用旧 key（兼容历史数据），其余 agent 各自独立 */
function sessionsKey(agentId: string): string {
  return !agentId || agentId === 'default' ? SESSIONS_KEY : `${SESSIONS_KEY}.${agentId}`
}
function activeKey(agentId: string): string {
  return !agentId || agentId === 'default' ? ACTIVE_KEY : `${ACTIVE_KEY}.${agentId}`
}

function readSessions(agentId: string): ChatSession[] {
  try {
    const raw = localStorage.getItem(sessionsKey(agentId))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (s): s is ChatSession =>
        !!s && typeof s === 'object' && typeof (s as ChatSession).id === 'string'
    )
  } catch {
    return []
  }
}

function writeSessions(sessions: ChatSession[], agentId: string): void {
  try {
    // 单会话消息过多时按需截断，避免 localStorage 超限
    const trimmed = sessions.map((s) =>
      s.messages.length > MAX_MESSAGES_PER_SESSION
        ? {
            ...s,
            messages: s.messages.slice(s.messages.length - MAX_MESSAGES_PER_SESSION)
          }
        : s
    )
    localStorage.setItem(sessionsKey(agentId), JSON.stringify(trimmed))
  } catch {
    // 存储失败（如超出配额）不阻塞聊天：历史只是尽力而为
  }
}

function createSessionId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** 由消息生成会话标题；无 user 消息时返回空串（界面 fallback 到本地化默认标题） */
function titleFromMessages(messages: ChatMsg[]): string {
  const first = messages.find((m) => m.kind === 'user')
  const raw = first?.kind === 'user' ? first.text : ''
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > MAX_TITLE_LENGTH ? text.slice(0, MAX_TITLE_LENGTH) + '…' : text
}

export function useChatHistory(agentId = 'default') {
  const sessions = ref<ChatSession[]>([])
  const activeId = ref('')

  /** 打开面板时加载本地历史，恢复上次会话；无任何历史则创建一个空会话 */
  function load(): void {
    sessions.value = readSessions(agentId)
    const saved = localStorage.getItem(activeKey(agentId))
    if (saved && sessions.value.some((s) => s.id === saved)) {
      activeId.value = saved
    } else if (sessions.value.length) {
      activeId.value = sessions.value[0]!.id
    } else {
      activeId.value = createSessionId()
      sessions.value = [
        { id: activeId.value, title: '', createdAt: Date.now(), updatedAt: Date.now(), messages: [] }
      ]
    }
    localStorage.setItem(activeKey(agentId), activeId.value)
  }

  /** 当前会话（始终存在；调用前需先 load） */
  const activeSession = computed(
    () => sessions.value.find((s) => s.id === activeId.value) ?? null
  )

  function persist(): void {
    writeSessions(sessions.value, agentId)
  }

  /** 新建空会话并激活 */
  function create(): void {
    const now = Date.now()
    const session: ChatSession = {
      id: createSessionId(),
      title: '',
      createdAt: now,
      updatedAt: now,
      messages: []
    }
    sessions.value = [session, ...sessions.value]
    activeId.value = session.id
    localStorage.setItem(activeKey(agentId), session.id)
    persist()
  }

  /** 删除会话；删除当前会话后自动激活最近一个 */
  function remove(id: string): void {
    sessions.value = sessions.value.filter((s) => s.id !== id)
    if (activeId.value === id) {
      activeId.value = sessions.value[0]?.id ?? ''
      if (activeId.value) {
        localStorage.setItem(activeKey(agentId), activeId.value)
      } else {
        localStorage.removeItem(activeKey(agentId))
        create()
        return
      }
    }
    persist()
  }

  /** 切换到指定会话 */
  function activate(id: string): void {
    if (!sessions.value.some((s) => s.id === id)) return
    activeId.value = id
    localStorage.setItem(activeKey(agentId), id)
  }

  /** 把消息写入当前会话（覆盖式，供外层在状态变化后调用） */
  function commitMessages(messages: ChatMsg[]): void {
    const index = sessions.value.findIndex((s) => s.id === activeId.value)
    if (index < 0) return
    const prev = sessions.value[index]!
    const derived = titleFromMessages(messages)
    sessions.value[index] = {
      ...prev,
      title: prev.title || derived,
      updatedAt: Date.now(),
      messages
    }
  }

  return { sessions, activeId, activeSession, load, persist, create, remove, activate, commitMessages }
}
