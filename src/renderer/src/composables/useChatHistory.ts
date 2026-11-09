/**
 * AI 对话历史会话（localStorage 持久化）。
 *
 * 会话结构：一组消息 + 标题 + 时间戳。消息内容均为可 JSON 序列化数据
 * （含工具卡的资产相对路径），因此可以直接落 localStorage，无需主进程参与。
 * 面板关闭 / 应用重启后，下次打开恢复上次会话。
 */
import { computed, ref } from 'vue'
import type { GitChangeFile } from '@shared/git'
import type {
  HarnessGoalView,
  HarnessPresentFile,
  HarnessTodoItem,
  OneSentenceGameCardInfo
} from '@shared/ipc'

export type ChatMsg =
  | { kind: 'user'; text: string; steered?: boolean }
  | { kind: 'assistant'; text: string; final?: boolean; reasoning?: string }
  | { kind: 'status'; text: string }
  | {
      kind: 'present'
      key: string
      callId: string
      turn: number
      files: HarnessPresentFile[]
    }
  | {
      kind: 'changes'
      /** 会话内唯一标识：`changes:<时间戳>`（同一轮只插一条，刷新时原地更新） */
      key: string
      /** 本轮变化文件快照（相对工程根；行级 diff 由卡片点开时按需拉取，不落 localStorage） */
      files: GitChangeFile[]
      /** 最近一次采集时刻（卡片显示「更新于 …」） */
      at: number
      /** 变更所在分支（detached / 未知为空） */
      branch?: string
    }
  | {
      kind: 'tool'
      /** 会话内唯一标识：`tool:<id|name>`（dsh-agent 工具，优先 callId）或 `mcp:<id>`（生成活动），用于原地更新状态 */
      key: string
      name: string
      state: 'start' | 'done' | 'error'
      detail?: string
      /** 工具调用拆解出的可读操作步骤列表（如「新建节点 n1『1. 剧本』」「连线 n1 → n2」「删除节点 n3」），在对话流中直接展示 */
      steps?: string[]
      /** 工具调用原始参数（JSON 字符串，仅 start 事件携带）：任务清单据此展示详细参数 */
      args?: string
      /** 工具调用实例 ID（dsh callId）：同一工具多次调用可区分；旧数据可能缺失 */
      id?: string
      /** 子代理的工具调用：所属顶层 subagent 卡片的 callId（嵌套展示在该卡片下） */
      parentId?: string
      /** MCP 生成活动关联资产的工程内相对路径：done 后据此在对话末尾生成独立预览卡（图片/视频/音频/3D） */
      relativePath?: string
    }
  | {
      kind: 'asset'
      /** 会话内唯一标识：`asset:<mcp activity id>`，与对应工具卡的 `mcp:<id>` 同源，用于去重 */
      key: string
      /** 生成资产在工程内的相对路径（图片/视频/音频/3D）：同批次产物里最早写入的一份，用作卡片预览 */
      relativePath: string
      /** 同一批次一起落盘的其它产物（扫盘聚合出卡时携带，写入时间升序）：卡内折叠展示，逐份可单独入库 */
      relatedPaths?: string[]
    }
  | {
      /**
       * 可玩 HTML 产物卡：卡上只有一个「试玩」按钮（点击直接开试玩窗口）。
       * 不并入 `asset` 卡——那张卡带「保存到资产库」与同批次折叠，与「只有试玩」的约定冲突；
       * 游戏已在 cook 成功时自动登记为 gamePlay 资产，不需要再让用户手动入库。
       */
      kind: 'game'
      /** 会话内唯一标识：`game:<assetId|activity id>`，同一工程重复 build 原地更新同一张卡 */
      key: string
      /** 游戏名（产物卡标题） */
      title: string
      /** 单文件 HTML 的工程内相对路径（试玩窗口按它读取） */
      htmlPath: string
    }
  | {
      /**
       * 一句话游戏卡（MCP `game_one_sentence_create`）：节点图已建好，卡上可打开画布 / 运行整图 /
       * 试玩，并带「生成后自动运行」复选框（默认不勾，写入 AppSettings.gameOneSentenceAutoRun）。
       */
      kind: 'oneSentenceGame'
      /** 会话内唯一标识：`osgame:<assetId>` */
      key: string
      info: OneSentenceGameCardInfo
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
      /**
       * 自定义回答的草稿。
       *
       * 模型给的选项只有 2–6 条，覆盖不到用户意图时用户可以直接写 —— 这是输入框绑定的文本。
       */
      draft?: string
      /** 用户选择结果（null=未答；非 null=已答） */
      answered?: string | null
    }
  | {
      /**
       * 审批卡：dsh 请求越过沙箱边界（沙箱升级）时插入，用户在卡上「允许一次 / 拒绝」。
       *
       * 与 `prompt` 分开一种消息：审批的决定词表是**闭集**且只放行一次，
       * 混进自由文本选项里迟早会被当成可持久化的偏好。
       */
      kind: 'approval'
      /** 审批请求 id（主进程生成），回传决定时使用 */
      requestId: string
      /** 需要审批的工具名（如 pwsh / write） */
      toolName: string
      /** dsh 给出的可读原因（原样展示，不做翻译） */
      reason?: string
      /** 用户决定（null=未决定；非 null=已决定）。缺省视为未决定（旧会话无此字段） */
      decision?: 'allow-once' | 'reject' | null
      /**
       * 请求已失效（本轮结束 / 进程已换）：按钮不再可点，且**没有放行**。
       * 与 `decision` 分开记：用户从未决定过，界面不该显示成「已拒绝」。
       */
      expired?: boolean
    }

export interface ChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMsg[]
  /**
   * 该会话最近一次 harness 上报的真实上下文 token（含系统提示 / 工具定义 / 历史）。
   * 落盘后重启或切回会话时，对话输入框右侧的环形进度条仍显示上次真实用量，
   * 而不是回退到只算消息文本的本地估算（进度看着像「没保存」）。缺省表示从未上报过。
   */
  contextUsed?: number
  /** 会话内持久化的 Todo 进度看板 */
  todos?: HarnessTodoItem[]
  /** 会话内持久化的多轮 Goal 状态 */
  goal?: HarnessGoalView | null
  /** 是否在左侧栏中置顶该会话 */
  pinned?: boolean
}

/** Codex 风格 Projects 树中的单个本地项目记录 */
export interface ChatProjectEntry {
  /** 会话隔离作用域标识（id:xxx 或 path:xxx） */
  scope: string
  /** 项目显示名称（默认取目录名，如 ai-art-engine / clientdev_2021） */
  name: string
  /** 本地目录绝对路径 */
  rootPath: string
  /** Studio 工程 ID（若为外部代码/游戏目录则缺省） */
  projectId?: string
  /** 最近活动时间戳 */
  updatedAt: number
  /** 是否在 Projects 树中折叠该项目的会话列表 */
  collapsed?: boolean
}

/** Projects 树中的分组视图：项目信息 + 该项目下的会话列表与激活会话 */
export interface ChatProjectTreeGroup extends ChatProjectEntry {
  sessions: ChatSession[]
  activeSessionId: string
}

/** 工作空间下跨工程聚合可见的单条会话（携带所属工程标识、名称与根目录） */
export interface ChatWorkspaceSessionItem extends ChatSession {
  projectScope: string
  projectName: string
  projectRootPath: string
}

export type ChatAutomationFrequency =
  'every_day' | 'weekdays' | 'every_monday' | 'every_hour' | 'every_30m'

/** Codex 风格 Automations 定时任务配置 */
export interface ChatAutomationItem {
  id: string
  title: string
  modelId: string
  frequency: ChatAutomationFrequency
  /** 24小时制 HH:mm，如 "09:00" 表示 9:00 AM */
  timeOfDay: string
  instructions: string
  projectScope: string
  workspaceScope: string
  enabled: boolean
  createdAt: number
  updatedAt: number
  nextRunAt: number
  lastRunAt?: number
}

const SESSIONS_KEY = 'studio.chat.sessions.v1'
const ACTIVE_KEY = 'studio.chat.activeSessionId.v1'
const PROJECTS_KEY = 'studio.chat.projects.v1'
const AUTOMATIONS_KEY = 'studio.chat.automations.v1'
/** 持久化上限：单会话最多保留的消息条数（超出丢弃最旧的 status / 历史轮次，避免无限膨胀） */
const MAX_MESSAGES_PER_SESSION = 600
/** 会话标题长度上限 */
const MAX_TITLE_LENGTH = 24

/** 从目录绝对路径提取紧凑项目文件夹名（如 `F:\work\clientdev_2021` -> `clientdev_2021`） */
export function extractProjectFolderName(
  rootPath?: string | null,
  fallbackName?: string | null
): string {
  const cleaned = (rootPath ?? '').replace(/\\/g, '/').replace(/\/+$/, '').trim()
  if (cleaned) {
    const parts = cleaned.split('/').filter(Boolean)
    const last = parts[parts.length - 1]
    if (last) return last
  }
  const fb = (fallbackName ?? '').trim()
  return fb || 'workspace'
}

/**
 * 将时间戳格式化为 Codex 风格紧凑相对时间（如 `6d`、`3d`、`5h`、`12m`、`1m`）。
 */
export function formatChatSessionRelativeAge(updatedAt: number, now = Date.now()): string {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return ''
  const diffMs = Math.max(0, now - updatedAt)
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return '1m'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(diffMs / 3_600_000)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(diffMs / 86_400_000)
  if (days < 30) return `${days}d`
  const months = Math.max(1, Math.floor(days / 30))
  return `${months}mo`
}

/** 判断会话是否为尚未命名的空白草稿会话（Codex 风格显示 `Untitled Conversation` + 蓝点指示器） */
export function isUntitledDraftSession(
  session: Pick<ChatSession, 'title' | 'messages'> | null | undefined
): boolean {
  if (!session) return false
  return !session.title.trim() && session.messages.length === 0
}

/** 将 "HH:mm"（如 "09:00"、"13:30"）格式化为 12 小时制文案（如 "9:00 AM"、"1:30 PM"） */
export function formatTimeOfDay12h(timeOfDay: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec((timeOfDay ?? '').trim())
  const rawHour = match ? Math.min(23, Math.max(0, Number(match[1]))) : 9
  const minute = match ? match[2]! : '00'
  const period = rawHour >= 12 ? 'PM' : 'AM'
  const hour12 = rawHour % 12 === 0 ? 12 : rawHour % 12
  return `${hour12}:${minute} ${period}`
}

/** 计算定时任务（Automation）的下一次触发时间戳 */
export function computeNextAutomationRunAt(
  frequency: ChatAutomationFrequency,
  timeOfDay: string,
  now = Date.now()
): number {
  if (frequency === 'every_30m') return now + 30 * 60_000
  if (frequency === 'every_hour') return now + 60 * 60_000
  const match = /^(\d{1,2}):(\d{2})$/.exec((timeOfDay ?? '').trim())
  const hours = match ? Math.min(23, Math.max(0, Number(match[1]))) : 9
  const mins = match ? Math.min(59, Math.max(0, Number(match[2]))) : 0
  const candidate = new Date(now)
  candidate.setHours(hours, mins, 0, 0)
  if (candidate.getTime() <= now) {
    candidate.setDate(candidate.getDate() + 1)
  }
  if (frequency === 'weekdays') {
    while (candidate.getDay() === 0 || candidate.getDay() === 6) {
      candidate.setDate(candidate.getDate() + 1)
    }
  } else if (frequency === 'every_monday') {
    while (candidate.getDay() !== 1) {
      candidate.setDate(candidate.getDate() + 1)
    }
  }
  return candidate.getTime()
}

/**
 * 计算工程级会话隔离作用域标识：
 * - 优先使用工程唯一 ID（`project.config.id`，每次新建项目均为全新 UUID，即使复用同一磁盘路径也不会串入旧项目会话）；
 * - 其次回退归一化后的工程根路径（`rootPath`）；
 * - 未打开工程或单测无参调用时返回空串 `""`（使用默认键，保持向后兼容）。
 */
export function resolveProjectChatScope(
  projectId?: string | null,
  rootPath?: string | null
): string {
  const id = projectId?.trim()
  if (id) return `id:${id}`
  const root = rootPath?.trim()
  if (root) return `path:${root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()}`
  return ''
}

export function sessionsStorageKey(scope = ''): string {
  const normalized = scope.trim()
  return normalized ? `${SESSIONS_KEY}:${normalized}` : SESSIONS_KEY
}

export function activeSessionStorageKey(scope = ''): string {
  const normalized = scope.trim()
  return normalized ? `${ACTIVE_KEY}:${normalized}` : ACTIVE_KEY
}

export function projectsStorageKey(workspaceScope = ''): string {
  const normalized = workspaceScope.trim()
  return normalized ? `${PROJECTS_KEY}:${normalized}` : PROJECTS_KEY
}

function readSessions(scope = ''): ChatSession[] {
  try {
    const raw = localStorage.getItem(sessionsStorageKey(scope))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (s): s is ChatSession =>
          !!s && typeof s === 'object' && typeof (s as ChatSession).id === 'string'
      )
      .map(withoutInvalidContextUsed)
  } catch {
    return []
  }
}

/** 上下文用量是可选字段：非有限非负数（手改 localStorage / 旧版脏数据）一律丢弃，交给渲染层回退本地估算 */
function withoutInvalidContextUsed(session: ChatSession): ChatSession {
  const used = session.contextUsed
  if (typeof used === 'number' && Number.isFinite(used) && used >= 0) return session
  delete session.contextUsed
  return session
}

function writeSessions(sessions: ChatSession[], scope = ''): void {
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
    localStorage.setItem(sessionsStorageKey(scope), JSON.stringify(trimmed))
  } catch {
    // 存储失败（如超出配额）不阻塞聊天：历史只是尽力而为
  }
}

function readChatProjects(workspaceScope = ''): ChatProjectEntry[] {
  try {
    const raw = localStorage.getItem(projectsStorageKey(workspaceScope))
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (item): item is ChatProjectEntry =>
          !!item &&
          typeof item === 'object' &&
          typeof (item as ChatProjectEntry).scope === 'string' &&
          typeof (item as ChatProjectEntry).rootPath === 'string' &&
          Boolean((item as ChatProjectEntry).scope.trim()) &&
          Boolean((item as ChatProjectEntry).rootPath.trim())
      )
      .map((item) => ({
        scope: item.scope.trim(),
        name: extractProjectFolderName(item.rootPath, item.name),
        rootPath: item.rootPath.trim(),
        ...(item.projectId?.trim() ? { projectId: item.projectId.trim() } : {}),
        updatedAt:
          typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt)
            ? item.updatedAt
            : Date.now(),
        ...(item.collapsed ? { collapsed: true } : {})
      }))
  } catch {
    return []
  }
}

function writeChatProjects(projects: ChatProjectEntry[], workspaceScope = ''): void {
  try {
    localStorage.setItem(projectsStorageKey(workspaceScope), JSON.stringify(projects))
  } catch {
    // ignore quota error
  }
}

function readChatAutomations(): ChatAutomationItem[] {
  try {
    const raw = localStorage.getItem(AUTOMATIONS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is ChatAutomationItem =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as ChatAutomationItem).id === 'string' &&
        typeof (item as ChatAutomationItem).instructions === 'string' &&
        Boolean((item as ChatAutomationItem).instructions.trim())
    )
  } catch {
    return []
  }
}

function writeChatAutomations(list: ChatAutomationItem[]): void {
  try {
    localStorage.setItem(AUTOMATIONS_KEY, JSON.stringify(list))
  } catch {
    // ignore quota error
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

export function useChatHistory() {
  const sessions = ref<ChatSession[]>([])
  const activeId = ref('')
  const scope = ref('')
  /** 当前工作空间作用域标识：工作空间本身的会话显示在下方 Conversations，不混入 Projects 工程树 */
  const workspaceScope = ref('')
  const workspaceRootPath = ref('')
  const projects = ref<ChatProjectEntry[]>([])
  const automations = ref<ChatAutomationItem[]>(readChatAutomations())
  const treeRevision = ref(0)

  function bumpTree(): void {
    treeRevision.value++
  }

  function isWorkspaceSelfEntry(p: Pick<ChatProjectEntry, 'scope' | 'rootPath'>): boolean {
    const ws = workspaceScope.value
    const wsRoot = workspaceRootPath.value
    if (ws && p.scope === ws) return true
    if (wsRoot) {
      const pRoot = p.rootPath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
      if (pRoot && pRoot === wsRoot) return true
    }
    return false
  }

  /** 切换顶层工作空间作用域，加载该工作空间下挂载的其它工程列表（自动剔除工作空间自身） */
  function setWorkspaceScope(
    nextWorkspaceScope: string,
    nextWorkspaceRootPath?: string | null
  ): void {
    const norm = nextWorkspaceScope.trim()
    workspaceScope.value = norm
    workspaceRootPath.value = (nextWorkspaceRootPath ?? '')
      .replace(/\\/g, '/')
      .replace(/\/+$/, '')
      .toLowerCase()
    const rawList = readChatProjects(norm)
    const filtered = rawList.filter((p) => !isWorkspaceSelfEntry(p))
    projects.value = filtered
    if (filtered.length !== rawList.length) {
      writeChatProjects(filtered, norm)
    }
    bumpTree()
  }

  function ensureProjectHasInitialSession(targetScope: string): ChatSession[] {
    const existing = readSessions(targetScope)
    if (existing.length > 0) return existing
    const now = Date.now()
    const initial: ChatSession = {
      id: createSessionId(),
      title: '',
      createdAt: now,
      updatedAt: now,
      messages: []
    }
    writeSessions([initial], targetScope)
    localStorage.setItem(activeSessionStorageKey(targetScope), initial.id)
    return [initial]
  }

  /** 打开面板或切换工程时加载对应工程作用域下的本地历史，恢复上次会话；无任何历史则创建一个空会话 */
  function load(projectScope?: string): void {
    if (projectScope !== undefined) {
      scope.value = projectScope.trim()
    }
    if (!projects.value.length) {
      projects.value = readChatProjects(workspaceScope.value).filter(
        (p) => !isWorkspaceSelfEntry(p)
      )
    }
    const activeKey = activeSessionStorageKey(scope.value)
    sessions.value = readSessions(scope.value)
    const saved = localStorage.getItem(activeKey)
    if (saved && sessions.value.some((s) => s.id === saved)) {
      activeId.value = saved
    } else if (sessions.value.length) {
      activeId.value = sessions.value[0]!.id
    } else {
      activeId.value = createSessionId()
      sessions.value = [
        {
          id: activeId.value,
          title: '',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: []
        }
      ]
    }
    localStorage.setItem(activeKey, activeId.value)
    bumpTree()
  }

  /**
   * 在当前工作空间的 Projects 树中登记或更新一个本地工程目录。
   * 若该工程已有同 rootPath 的旧条目（例如先作为外部目录添加，后作为主工程打开），自动合并去重。
   */
  function registerProject(input: {
    projectId?: string | null
    rootPath?: string | null
    name?: string | null
    activate?: boolean
  }): ChatProjectEntry | null {
    const rootPath = (input.rootPath ?? '').trim()
    if (!rootPath) return null
    const targetScope = resolveProjectChatScope(input.projectId, rootPath)
    if (!targetScope) return null
    const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    // 工作空间自身的会话归属于工作空间（Conversations），不作为子工程挂在 Projects 树下
    if (isWorkspaceSelfEntry({ scope: targetScope, rootPath })) {
      ensureProjectHasInitialSession(workspaceScope.value || targetScope)
      if (input.activate) {
        load(workspaceScope.value || targetScope)
      } else {
        bumpTree()
      }
      return null
    }
    const folderName = extractProjectFolderName(rootPath, input.name)
    if (!projects.value.length) {
      projects.value = readChatProjects(workspaceScope.value).filter(
        (p) => !isWorkspaceSelfEntry(p)
      )
    }
    const existingIdx = projects.value.findIndex(
      (p) =>
        p.scope === targetScope ||
        p.rootPath.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === normalizedRoot
    )
    const now = Date.now()
    let entry: ChatProjectEntry
    if (existingIdx >= 0) {
      const prev = projects.value[existingIdx]!
      entry = {
        ...prev,
        scope: prev.scope || targetScope,
        name: folderName || prev.name,
        rootPath,
        ...(input.projectId?.trim() ? { projectId: input.projectId.trim() } : {}),
        updatedAt: now
      }
      const nextList = [...projects.value]
      nextList[existingIdx] = entry
      projects.value = nextList
    } else {
      entry = {
        scope: targetScope,
        name: folderName,
        rootPath,
        ...(input.projectId?.trim() ? { projectId: input.projectId.trim() } : {}),
        updatedAt: now
      }
      projects.value = [entry, ...projects.value]
    }
    writeChatProjects(projects.value, workspaceScope.value)
    ensureProjectHasInitialSession(entry.scope)
    if (input.activate) {
      load(entry.scope)
    } else {
      bumpTree()
    }
    return entry
  }

  /** 添加其它本地工程目录（如 `clientdev_2021` / `ai-art-engine`）到当前工作空间并切换到该工程 */
  function addExternalProject(rootPath: string, name?: string): ChatProjectEntry | null {
    return registerProject({
      rootPath,
      name,
      activate: true
    })
  }

  /** 从当前工作空间的 Projects 树中移除一个工程（不影响磁盘文件） */
  function removeProject(targetScope: string, fallbackScope?: string): void {
    const norm = targetScope.trim()
    if (!norm) return
    projects.value = projects.value.filter((p) => p.scope !== norm)
    writeChatProjects(projects.value, workspaceScope.value)
    if (scope.value === norm) {
      const nextScope = fallbackScope?.trim() || projects.value[0]?.scope || ''
      load(nextScope)
    } else {
      bumpTree()
    }
  }

  /** 折叠 / 展开某个项目文件夹下的会话列表 */
  function toggleProjectCollapsed(targetScope: string): void {
    const norm = targetScope.trim()
    const idx = projects.value.findIndex((p) => p.scope === norm)
    if (idx < 0) return
    const cur = projects.value[idx]!
    const nextList = [...projects.value]
    nextList[idx] = {
      ...cur,
      collapsed: !cur.collapsed
    }
    projects.value = nextList
    writeChatProjects(projects.value, workspaceScope.value)
    bumpTree()
  }

  /** 当前激活的项目条目 */
  const activeProject = computed<ChatProjectEntry | null>(() => {
    void treeRevision.value
    return projects.value.find((p) => p.scope === scope.value) ?? null
  })

  /** Codex 风格 Projects -> Conversations 树视图（仅展示添加到此工作空间的其它工程，不含工作空间自身） */
  const projectTree = computed<ChatProjectTreeGroup[]>(() => {
    void treeRevision.value
    return projects.value
      .filter((proj) => !isWorkspaceSelfEntry(proj))
      .map((proj) => {
        if (proj.scope === scope.value) {
          return {
            ...proj,
            sessions: sessions.value,
            activeSessionId: activeId.value
          }
        }
        const list = ensureProjectHasInitialSession(proj.scope)
        const savedActive = localStorage.getItem(activeSessionStorageKey(proj.scope)) ?? ''
        const resolvedActive = list.some((s) => s.id === savedActive)
          ? savedActive
          : (list[0]?.id ?? '')
        return {
          ...proj,
          sessions: list,
          activeSessionId: resolvedActive
        }
      })
  })

  /**
   * 属于当前工作空间自身的会话列表（显示在左侧栏下方 Conversations 区，不显示在 Projects 工程文件夹下）：
   * 即使当前切换到某个外部工程的会话，工作空间自身的会话依然直接可见。
   */
  const workspaceSessions = computed<ChatSession[]>(() => {
    void treeRevision.value
    const ws = workspaceScope.value
    if (scope.value === ws) {
      return sessions.value
    }
    return ensureProjectHasInitialSession(ws)
  })

  /**
   * 当前工作空间自身会话 + 工作空间下所有已添加工程的全部会话（汇总列表）：
   * 无论当前聚焦在工作空间还是某个外部工程，所有会话都直接可见。
   */
  const allWorkspaceSessions = computed<ChatWorkspaceSessionItem[]>(() => {
    void treeRevision.value
    const aggregated: ChatWorkspaceSessionItem[] = []
    const coveredScopes = new Set<string>()
    const ws = workspaceScope.value
    coveredScopes.add(ws)
    for (const s of workspaceSessions.value) {
      aggregated.push({
        ...s,
        projectScope: ws,
        projectName: '',
        projectRootPath: ''
      })
    }
    for (const group of projectTree.value) {
      coveredScopes.add(group.scope)
      for (const s of group.sessions) {
        aggregated.push({
          ...s,
          projectScope: group.scope,
          projectName: group.name,
          projectRootPath: group.rootPath
        })
      }
    }
    if (!coveredScopes.has(scope.value)) {
      for (const s of sessions.value) {
        aggregated.push({
          ...s,
          projectScope: scope.value,
          projectName: '',
          projectRootPath: ''
        })
      }
    }
    return aggregated.sort((a, b) => {
      const pinDiff = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
      if (pinDiff !== 0) return pinDiff
      return b.updatedAt - a.updatedAt
    })
  })

  /** 当前会话（始终存在；调用前需先 load） */
  const activeSession = computed(() => sessions.value.find((s) => s.id === activeId.value) ?? null)

  function persist(): void {
    writeSessions(sessions.value, scope.value)
    bumpTree()
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
    localStorage.setItem(activeSessionStorageKey(scope.value), session.id)
    persist()
  }

  /** 在工作空间自身（Conversations 区）下新建会话并切换到该会话 */
  function createWorkspaceSession(): ChatSession {
    if (scope.value !== workspaceScope.value) {
      persist()
      load(workspaceScope.value)
    }
    create()
    return activeSession.value!
  }

  /** 在指定项目文件夹下新建会话并切换到该会话 */
  function createSessionInProject(targetScope: string): ChatSession {
    const norm = targetScope.trim()
    if (norm && norm !== scope.value) {
      persist()
      load(norm)
    }
    // 展开目标项目文件夹
    const pIdx = projects.value.findIndex((p) => p.scope === scope.value)
    if (pIdx >= 0 && projects.value[pIdx]?.collapsed) {
      const copy = [...projects.value]
      copy[pIdx] = { ...copy[pIdx]!, collapsed: false, updatedAt: Date.now() }
      projects.value = copy
      writeChatProjects(projects.value, workspaceScope.value)
    }
    create()
    return activeSession.value!
  }

  /** 激活任意项目文件夹下的指定会话 */
  function activateProjectSession(targetScope: string, sessionId: string): void {
    const norm = targetScope.trim()
    if (norm && norm !== scope.value) {
      persist()
      load(norm)
    }
    activate(sessionId)
    bumpTree()
  }

  /** 删除任意项目文件夹下的指定会话 */
  function removeProjectSession(targetScope: string, sessionId: string): void {
    const norm = targetScope.trim()
    if (!norm || norm === scope.value) {
      remove(sessionId)
      return
    }
    const activeKey = activeSessionStorageKey(norm)
    const remaining = readSessions(norm).filter((s) => s.id !== sessionId)
    if (remaining.length === 0) {
      const now = Date.now()
      const fresh: ChatSession = {
        id: createSessionId(),
        title: '',
        createdAt: now,
        updatedAt: now,
        messages: []
      }
      writeSessions([fresh], norm)
      localStorage.setItem(activeKey, fresh.id)
    } else {
      writeSessions(remaining, norm)
      const savedActive = localStorage.getItem(activeKey)
      if (!savedActive || savedActive === sessionId) {
        localStorage.setItem(activeKey, remaining[0]!.id)
      }
    }
    bumpTree()
  }

  /** 置顶 / 取消置顶任意项目下的指定会话 */
  function togglePinProjectSession(targetScope: string, sessionId: string): void {
    const norm = targetScope.trim()
    if (!norm || norm === scope.value) {
      const idx = sessions.value.findIndex((s) => s.id === sessionId)
      if (idx < 0) return
      const cur = sessions.value[idx]!
      const next = { ...cur, pinned: !cur.pinned }
      const copy = [...sessions.value]
      copy[idx] = next
      copy.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
      sessions.value = copy
      persist()
      return
    }
    const list = readSessions(norm)
    const idx = list.findIndex((s) => s.id === sessionId)
    if (idx < 0) return
    const cur = list[idx]!
    list[idx] = { ...cur, pinned: !cur.pinned }
    list.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
    writeSessions(list, norm)
    bumpTree()
  }

  /**
   * `/clear`：在当前列表位上轮换会话 id 并清空消息 / 上下文用量。
   * 返回旧 id，供调用方删除 dsh 磁盘持久化，避免幽灵 resume。
   */
  function rotateActive(): string | null {
    const index = sessions.value.findIndex((s) => s.id === activeId.value)
    const oldId = activeId.value || null
    const now = Date.now()
    const next: ChatSession = {
      id: createSessionId(),
      title: '',
      createdAt: now,
      updatedAt: now,
      messages: []
    }
    if (index < 0) {
      sessions.value = [next, ...sessions.value]
    } else {
      const copy = [...sessions.value]
      copy[index] = next
      sessions.value = copy
    }
    activeId.value = next.id
    localStorage.setItem(activeSessionStorageKey(scope.value), next.id)
    persist()
    return oldId && oldId !== next.id ? oldId : null
  }

  /** 删除会话；删除当前会话后自动激活最近一个 */
  function remove(id: string): void {
    const activeKey = activeSessionStorageKey(scope.value)
    sessions.value = sessions.value.filter((s) => s.id !== id)
    if (activeId.value === id) {
      activeId.value = sessions.value[0]?.id ?? ''
      if (activeId.value) {
        localStorage.setItem(activeKey, activeId.value)
      } else {
        localStorage.removeItem(activeKey)
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
    localStorage.setItem(activeSessionStorageKey(scope.value), id)
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

  /**
   * 记录当前会话最近一次 harness 上报的真实上下文 token（环形进度条据此在重启 / 切回会话后恢复）。
   * 刻意不更新 updatedAt：用量上报不是会话活动，不该把会话列表顺序搅乱。
   */
  function commitContextUsed(used: number | undefined): void {
    const index = sessions.value.findIndex((s) => s.id === activeId.value)
    if (index < 0) return
    const prev = sessions.value[index]!
    if (prev.contextUsed === used) return
    sessions.value[index] = { ...prev, contextUsed: used }
  }

  function commitTodos(todos: HarnessTodoItem[] | undefined): void {
    const index = sessions.value.findIndex((s) => s.id === activeId.value)
    if (index < 0) return
    const prev = sessions.value[index]!
    sessions.value[index] = { ...prev, todos }
  }

  function commitGoal(goal: HarnessGoalView | null | undefined): void {
    const index = sessions.value.findIndex((s) => s.id === activeId.value)
    if (index < 0) return
    const prev = sessions.value[index]!
    sessions.value[index] = { ...prev, goal }
  }

  /** 从指定轮次分叉出一个带给定 id 与初始消息的新会话并激活 */
  function forkSession(newId: string, messages: ChatMsg[], titleSuffix = ''): void {
    const now = Date.now()
    const baseTitle = titleFromMessages(messages)
    const session: ChatSession = {
      id: newId,
      title: baseTitle ? `${baseTitle}${titleSuffix}` : '',
      createdAt: now,
      updatedAt: now,
      messages: [...messages]
    }
    sessions.value = [session, ...sessions.value]
    activeId.value = session.id
    localStorage.setItem(activeSessionStorageKey(scope.value), session.id)
    persist()
  }

  /** 新建 Codex 风格 Automation 定时任务 */
  function createAutomation(input: {
    title?: string
    modelId?: string
    frequency: ChatAutomationFrequency
    timeOfDay?: string
    instructions: string
    projectScope?: string
    now?: number
  }): ChatAutomationItem | null {
    const instructions = input.instructions.trim()
    if (!instructions) return null
    const now = input.now ?? Date.now()
    const timeOfDay = (input.timeOfDay ?? '09:00').trim() || '09:00'
    const item: ChatAutomationItem = {
      id: `auto_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      title: (input.title ?? '').trim() || 'Untitled',
      modelId: (input.modelId ?? '').trim(),
      frequency: input.frequency,
      timeOfDay,
      instructions,
      projectScope: (input.projectScope ?? scope.value).trim(),
      workspaceScope: workspaceScope.value,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      nextRunAt: computeNextAutomationRunAt(input.frequency, timeOfDay, now)
    }
    automations.value = [item, ...automations.value]
    writeChatAutomations(automations.value)
    return item
  }

  /** 删除指定 Automation 定时任务 */
  function removeAutomation(id: string): void {
    automations.value = automations.value.filter((a) => a.id !== id)
    writeChatAutomations(automations.value)
  }

  /** 启用 / 暂停指定 Automation 定时任务 */
  function toggleAutomationEnabled(id: string, now = Date.now()): void {
    automations.value = automations.value.map((a) => {
      if (a.id !== id) return a
      const nextEnabled = !a.enabled
      return {
        ...a,
        enabled: nextEnabled,
        updatedAt: now,
        nextRunAt: nextEnabled
          ? computeNextAutomationRunAt(a.frequency, a.timeOfDay, now)
          : a.nextRunAt
      }
    })
    writeChatAutomations(automations.value)
  }

  /** 标记某条 Automation 已触发执行并推进其下一次运行时间 */
  function markAutomationTriggered(id: string, now = Date.now()): ChatAutomationItem | null {
    let found: ChatAutomationItem | null = null
    automations.value = automations.value.map((a) => {
      if (a.id !== id) return a
      const updated: ChatAutomationItem = {
        ...a,
        lastRunAt: now,
        updatedAt: now,
        nextRunAt: computeNextAutomationRunAt(a.frequency, a.timeOfDay, now)
      }
      found = updated
      return updated
    })
    writeChatAutomations(automations.value)
    return found
  }

  return {
    sessions,
    activeId,
    activeSession,
    scope,
    workspaceScope,
    projects,
    automations,
    activeProject,
    projectTree,
    workspaceSessions,
    allWorkspaceSessions,
    setWorkspaceScope,
    load,
    persist,
    create,
    createWorkspaceSession,
    createSessionInProject,
    rotateActive,
    remove,
    removeProjectSession,
    togglePinProjectSession,
    activate,
    activateProjectSession,
    registerProject,
    addExternalProject,
    removeProject,
    toggleProjectCollapsed,
    createAutomation,
    removeAutomation,
    toggleAutomationEnabled,
    markAutomationTriggered,
    commitMessages,
    commitContextUsed,
    commitTodos,
    commitGoal,
    forkSession
  }
}
