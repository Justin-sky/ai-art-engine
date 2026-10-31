<script setup lang="ts">
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
  type Directive
} from 'vue'
import type { AssetInfo, AssetType } from '@shared/domain'
import type {
  ApprovalRequestView,
  AskUserQuestion,
  ChatMode,
  HarnessCanvasEventView,
  HarnessEvent,
  HarnessGoalView,
  HarnessScheduleView,
  HarnessSessionSearchHit,
  HarnessStatus,
  HarnessSubagentView,
  HarnessTodoItem,
  InstalledWorkflowRecordView,
  McpActivity,
  OneSentenceGameCardInfo,
  SessionSkill
} from '@shared/ipc'
import { modalityConfig, providerModelDisplayName } from '@shared/modelProvider'
import { detectChatSkillInstallOrSearchIntent } from '@shared/claudeSkill'
import { useStudioI18n } from '../composables/useStudioI18n'
import {
  resolveProjectChatScope,
  useChatHistory,
  type ChatMsg
} from '../composables/useChatHistory'
import { attachAnimatedImagePlayback } from '../features/media/animatedImagePlayback'
import { resolveAssetFileUrl, resolveAssetPreviewUrl } from '../features/media/assetUrlCache'
import { getChatAssetFingerprint } from '../features/media/chatAssetFingerprint'
import { copyTextToClipboard } from '../utils/copyText'
import { useProjectStore } from '../stores/project'
import { buildActiveWorkspaceContext } from '../features/mcp/buildActiveWorkspaceContext'
import { promptConfirm } from '../composables/useStudioPrompt'
import { estimateTokenCount } from '@shared/textTokens'
import { isImageLikePath, renderChatMarkdown, renderInlineChatRefs } from '@shared/chatMarkdown'
import { fingerprintMap, selectChangedFiles } from '@shared/git'
import {
  MAX_ROUND_OUTPUT_FILES,
  groupRoundOutputs,
  isDeliverableMediaPath,
  isHtmlMediaPath,
  normalizeOutputPathKey,
  selectRoundOutputs
} from '@shared/outputScan'
import {
  CHAT_SHOWCASE_STARTERS,
  buildZeroKeyLiveDemoGraph,
  type ChatShowcaseStarter
} from '@shared/chatShowcaseStarters'
import {
  classifyMcpStepKind,
  extractMcpToolStepsFromArgs,
  formatMcpToolDisplayName,
  stripMcpToolPrefix,
  type McpStepKind
} from '@shared/mcpToolOperationSummary'
import { resolveChatNextActions, type ChatNextActionPill } from '@shared/chatNextActions'
import { buildCanvasStarterGraph } from '@shared/graph'
import { isModelFilePath } from '@shared/import'
import { resolvePreviewMediaPath } from '@shared/media/thumbnailPath'
import { ensureModelPreviewUrl } from '../features/media/ensureModelPreviewUrl'
import { openGamePlaySandboxDialog } from '../features/media/gamePlaySandboxDialog'
import { readGraphRunText } from '../features/graph/readGraphRunText'
import { gameHtmlBrowserIssue } from '@shared/gamePlay'
import { useDraftSave } from '../composables/useDraftSave'
import ChatAssetPreview from './ChatAssetPreview.vue'
import ChatChangesCard from './ChatChangesCard.vue'
import ChatOneSentenceGameCard from './ChatOneSentenceGameCard.vue'
import ChatAssetPicker from './ChatAssetPicker.vue'
import ChatCopyIcon from './ChatCopyIcon.vue'
import ChatWishShrine from './ChatWishShrine.vue'
import SaveAssetDialog from './SaveAssetDialog.vue'
import {
  notifyWeatherTaskComplete,
  notifyWeatherTaskPulse,
  notifyWeatherTaskStart
} from '../graph/vfx/canvasWeatherEngine'

const CHAT_MODEL_KEY = 'studio.chat.model'
const CHAT_MODE_KEY = 'studio.chat.mode'
const CHAT_COMPOSER_HEIGHT_KEY = 'studio.chat.composerHeight'
const CHAT_MODES: ChatMode[] = ['craft', 'ask', 'plan']
const COMPOSER_HEIGHT_MIN = 64
const COMPOSER_HEIGHT_MAX = 420
const COMPOSER_HEIGHT_DEFAULT = 64

function readComposerHeight(): number {
  try {
    const n = Number(localStorage.getItem(CHAT_COMPOSER_HEIGHT_KEY))
    if (Number.isFinite(n)) {
      return Math.min(COMPOSER_HEIGHT_MAX, Math.max(COMPOSER_HEIGHT_MIN, Math.round(n)))
    }
  } catch {
    /* ignore */
  }
  return COMPOSER_HEIGHT_DEFAULT
}

/** 输入框可拖高度（向上拖变高），记住用户偏好 */
const composerHeight = ref(readComposerHeight())
let composerResizeStartY = 0
let composerResizeStartH = COMPOSER_HEIGHT_DEFAULT

function onComposerResizePointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  event.preventDefault()
  const handle = event.currentTarget
  if (!(handle instanceof HTMLElement)) return
  handle.setPointerCapture(event.pointerId)
  composerResizeStartY = event.clientY
  composerResizeStartH = composerHeight.value
  handle.classList.add('dragging')
}

function onComposerResizePointerMove(event: PointerEvent): void {
  const handle = event.currentTarget
  if (!(handle instanceof HTMLElement) || !handle.hasPointerCapture(event.pointerId)) return
  // 向上拖 → clientY 变小 → 高度增加
  const next = composerResizeStartH + (composerResizeStartY - event.clientY)
  composerHeight.value = Math.min(
    COMPOSER_HEIGHT_MAX,
    Math.max(COMPOSER_HEIGHT_MIN, Math.round(next))
  )
}

function onComposerResizePointerUp(event: PointerEvent): void {
  const handle = event.currentTarget
  if (!(handle instanceof HTMLElement)) return
  if (handle.hasPointerCapture(event.pointerId)) {
    handle.releasePointerCapture(event.pointerId)
  }
  handle.classList.remove('dragging')
  try {
    localStorage.setItem(CHAT_COMPOSER_HEIGHT_KEY, String(composerHeight.value))
  } catch {
    /* ignore */
  }
}

const { t, locale } = useStudioI18n()
const isEnChat = computed(() => /^en/i.test(locale.value))
const { createDraftAndOpen } = useDraftSave()
const showcaseStarters = CHAT_SHOWCASE_STARTERS

/** 历史会话：多会话持久化 + 输入框上方工具栏切换 */
const {
  sessions,
  activeId,
  activeSession,
  load: loadHistory,
  persist: persistHistory,
  create: createSession,
  rotateActive: rotateActiveSession,
  remove: removeSession,
  activate: activateSession,
  commitMessages,
  commitContextUsed,
  commitTodos,
  commitGoal,
  forkSession
} = useChatHistory()

/** 当前会话的 Todo 进度看板（由 dsh todo_write 工具实时推送） */
const sessionTodos = ref<HarnessTodoItem[]>([])
const todoBoardOpen = ref(false)
const todoDoneCount = computed(
  () => sessionTodos.value.filter((item) => item.status === 'completed').length
)

/** 当前会话的自主目标状态（由 dsh goal 工具或 /goal 指令实时推送） */
const sessionGoal = ref<HarnessGoalView | null>(null)
const goalDismissed = ref(false)

/** 当前会话的定时提醒列表（由 dsh schedule 插件实时推送） */
const sessionSchedules = ref<HarnessScheduleView[]>([])
const scheduleMenuOpen = ref(false)
const scheduleDropdownRef = ref<HTMLElement | null>(null)
const activeSchedules = computed(() =>
  sessionSchedules.value.filter((item) => item.status === 'active')
)

/** 跨会话全文搜索与会话导出状态 */
const searchModalOpen = ref(false)
const searchDropdownRef = ref<HTMLElement | null>(null)
const searchQuery = ref('')
const searchBusy = ref(false)
const searchHits = ref<HarnessSessionSearchHit[]>([])
const exportBusy = ref(false)

/** Stage 2：画布异步事件触发器最新通知（工作流完成或节点报错时提示审片/诊断） */
const latestCanvasEvent = ref<HarnessCanvasEventView | null>(null)

/** 许愿式编程浮窗：本轮结束状态与最近一条用户指令文本 */
const lastRoundOutcome = ref<'idle' | 'success' | 'error'>('idle')
const latestUserPromptText = computed(() => {
  for (let i = messages.value.length - 1; i >= 0; i--) {
    const m = messages.value[i]
    if (m?.kind === 'user') return m.text
  }
  return ''
})

/** Stage 3：子代理并发实时监控看板状态 */
const sessionSubagents = ref<HarnessSubagentView[]>([])
const subagentBoardOpen = ref(false)
const subagentFollowupTarget = ref<string | null>(null)
const subagentFollowupDraft = ref('')
const runningSubagentsCount = computed(
  () => sessionSubagents.value.filter((item) => item.status === 'running').length
)

/** @ 资产引用弹窗与已引用资产（工程内相对路径） */
const mentionOpen = ref(false)

/** 已引用资产：path 用于组装任务，名称/类型/缩略图用于 chips 预览 */
interface MentionAsset {
  path: string
  name: string
  type: AssetType
  thumbUrl: string
}
const referenced = ref<MentionAsset[]>([])
const project = useProjectStore()
let historyTimer: number | null = null

/** 从当前激活会话恢复消息与上下文用量 */
function loadActiveMessages(): void {
  messages.value = activeSession.value?.messages ? [...activeSession.value.messages] : []
  // 上下文用量随会话落盘：切回 / 重启后恢复上次 harness 上报的真实值，
  // 无记录（新会话或旧数据）时才回落本地估算，环形进度条不再重启即归零
  harnessContextUsed.value = activeSession.value?.contextUsed
  sessionTodos.value = activeSession.value?.todos ? [...activeSession.value.todos] : []
  sessionGoal.value = activeSession.value?.goal ?? null
  goalDismissed.value = false
  sessionSchedules.value = []
  sessionSubagents.value = []
  subagentFollowupTarget.value = null
  subagentFollowupDraft.value = ''
  latestCanvasEvent.value = null
}

/** 切换会话：先保存当前，再加载目标 */
function onSessionChange(id: string): void {
  if (!id || id === activeId.value) return
  commitMessages([...messages.value])
  // 真实上下文用量也归到切走前的会话：否则防抖窗口里那一次上报会跟着新会话一起丢掉
  commitContextUsed(harnessContextUsed.value)
  commitTodos([...sessionTodos.value])
  commitGoal(sessionGoal.value)
  activateSession(id)
  loadActiveMessages()
  // 队列属于「当前这段对话」：切走时清掉，避免排队中的消息发进另一个会话
  clearSendQueue()
  // 切换可能打断输入法组合（compositionend 丢失时 composing 残留，导致 Enter 无法发送），复位之
  composing.value = false
  scrollToBottom()
}

function onNewSession(): void {
  commitMessages([...messages.value])
  commitContextUsed(harnessContextUsed.value)
  commitTodos([...sessionTodos.value])
  commitGoal(sessionGoal.value)
  createSession()
  loadActiveMessages()
  // 新会话不应继承上一段对话的排队消息
  clearSendQueue()
  resetEditor()
  composing.value = false
  scrollToBottom()
  void nextTick(() => inputRef.value?.focus())
}

/**
 * `/clear`：清空当前对话上下文并换新 session id（不保留旧消息进历史列表位）。
 * 同步删除 dsh 磁盘会话，避免下一句被幽灵 resume。
 */
async function onClearCommand(): Promise<void> {
  // 挡住中止过程中迟到的 harness 事件，避免污染新会话
  ignoreHarnessEvents = true
  try {
    if (running.value) {
      await window.studio.abortHarnessTask()
      running.value = false
    }
    resetEditor()
    referenced.value = []
    pendingReasoning = ''
    // 换 session 后队列里的消息已无归属，一并清掉
    clearSendQueue()
    const oldId = rotateActiveSession()
    if (oldId && typeof window.studio?.deleteHarnessSession === 'function') {
      window.studio.deleteHarnessSession(oldId).catch(() => undefined)
    }
    loadActiveMessages()
    pushStatus(t('studio.chat.cleared'), 'warn')
    commitMessages([...messages.value])
    persistHistory()
    composing.value = false
    scrollToBottom()
    void nextTick(() => inputRef.value?.focus())
  } finally {
    window.setTimeout(() => {
      ignoreHarnessEvents = false
    }, 400)
  }
}

/** 本地斜杠指令（整行匹配，不发给模型） */
function isLocalSlashCommand(text: string): 'clear' | 'model' | 'skills' | null {
  const raw = text.trim().toLowerCase()
  if (raw === '/clear') return 'clear'
  if (raw === '/model') return 'model'
  if (raw === '/skills') return 'skills'
  return null
}

/** 对话面板支持的斜杠指令（输入 `/` 时弹出） */
type SlashCommandDef = {
  id: 'clear' | 'model' | 'skills'
  name: string
  /** i18n 描述键（相对 studio.chat） */
  descKey: 'slashClearDesc' | 'slashModelDesc' | 'slashSkillsDesc'
}

type SlashSkillItem = {
  id: `skill:${string}`
  name: string
  skillName: string
  descText: string
  argumentHint?: string
  skillContext?: 'inline' | 'fork'
}

type SlashMenuItem = SlashCommandDef | SlashSkillItem

const SLASH_COMMANDS: readonly SlashCommandDef[] = [
  { id: 'clear', name: '/clear', descKey: 'slashClearDesc' },
  { id: 'model', name: '/model', descKey: 'slashModelDesc' },
  { id: 'skills', name: '/skills', descKey: 'slashSkillsDesc' }
]

const slashOpen = ref(false)
const slashIndex = ref(0)
const slashFilter = ref('')

const slashItems = computed<SlashMenuItem[]>(() => {
  const q = slashFilter.value.trim().toLowerCase()
  const builtins = !q
    ? [...SLASH_COMMANDS]
    : SLASH_COMMANDS.filter(
        (c) => c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)
      )
  const skillItems: SlashSkillItem[] = sessionSkills.value
    .filter((s) => s.userInvocable !== false)
    .filter(
      (s) =>
        !q ||
        s.name.toLowerCase().includes(q) ||
        (s.titleZh?.toLowerCase().includes(q) ?? false) ||
        s.description.toLowerCase().includes(q)
    )
    .map((s) => ({
      id: `skill:${s.name}` as const,
      name: `/${s.name}`,
      skillName: s.name,
      descText: s.titleZh ? `${s.titleZh} · ${s.description}` : s.description,
      ...(s.argumentHint ? { argumentHint: s.argumentHint } : {}),
      ...(s.context ? { skillContext: s.context } : {})
    }))
  return [...builtins, ...skillItems]
})

function closeSlashMenu(): void {
  slashOpen.value = false
  slashFilter.value = ''
  slashIndex.value = 0
}

/** 光标前是否正在输入斜杠指令（行首或换行后的 `/xxx`） */
function matchSlashInput(before: string): { filter: string } | null {
  const m = /(?:^|\n)\/([a-zA-Z0-9_-]*)$/.exec(before)
  if (!m) return null
  return { filter: m[1] ?? '' }
}

function updateSlashMenuFromCursor(): void {
  if (composing.value || mentionOpen.value) {
    closeSlashMenu()
    return
  }
  const hit = matchSlashInput(textBeforeCursor())
  if (!hit) {
    closeSlashMenu()
    return
  }
  slashFilter.value = hit.filter
  if (!slashOpen.value) {
    slashOpen.value = true
    slashIndex.value = 0
    void refreshSessionSkills()
  } else if (slashIndex.value >= slashItems.value.length) {
    slashIndex.value = Math.max(0, slashItems.value.length - 1)
  }
}

/** 把光标前触发斜杠菜单的 `/xxx` 替换为 `/skill-name `，方便继续填写 `$ARGUMENTS` 或直接回车发送 */
function applySlashSkillToEditor(skillName: string): void {
  const el = inputRef.value
  if (!el) return
  el.focus()
  const before = textBeforeCursor()
  const sel = window.getSelection()
  const m = before.match(/\/[a-zA-Z0-9_-]*$/)
  if (sel && sel.rangeCount > 0 && m) {
    const r = sel.getRangeAt(0)
    if (r.endOffset >= m[0].length) {
      const cut = r.cloneRange()
      cut.setStart(r.endContainer, r.endOffset - m[0].length)
      cut.deleteContents()
    }
  }
  insertPlainText(`/${skillName} `)
}

async function applySlashCommand(cmd: SlashMenuItem): Promise<void> {
  closeSlashMenu()
  if ('skillName' in cmd) {
    applySlashSkillToEditor(cmd.skillName)
    return
  }
  resetEditor()
  if (cmd.id === 'clear') {
    await onClearCommand()
    return
  }
  if (cmd.id === 'model') {
    await onModelCommand()
    return
  }
  if (cmd.id === 'skills') {
    await onSkillsCommand()
  }
}

/**
 * `/skills`：打开统一的「已安装技能」列表（与工具栏技能按钮同一个面板）。
 *
 * 选中即把引用或 `/skill` 插入输入框 —— 与点击面板条目完全同一条路径，
 * 因此不会出现「从斜杠进和从按钮进行为不一样」的分叉。
 */
async function onSkillsCommand(): Promise<void> {
  await Promise.all([refreshInstalledWorkflows(), refreshSessionSkills()])
  if (!installedWorkflows.value.length && !standaloneSessionSkills.value.length) {
    // 静默打开一个空面板会让人以为功能坏了，明确说清去哪儿装
    pushStatus(t('studio.chat.workflowsEmpty'), 'error')
    return
  }
  modeOpen.value = false
  sessionOpen.value = false
  modelOpen.value = false
  skillsOpen.value = true
  void nextTick(() => {
    const trigger = skillsDropdownRef.value?.querySelector('button.skills-trigger')
    if (trigger instanceof HTMLElement) trigger.focus()
  })
}

/** `/model`：打开底部模型下拉列表 */
async function onModelCommand(): Promise<void> {
  await loadModels()
  if (!modelOptions.value.length) {
    pushStatus(t('studio.chat.noModel'), 'error')
    return
  }
  modeOpen.value = false
  sessionOpen.value = false
  skillsOpen.value = false
  modelOpen.value = true
  void nextTick(() => {
    const trigger = modelDropdownRef.value?.querySelector('button.model-trigger')
    if (trigger instanceof HTMLElement) trigger.focus()
  })
}

function onSlashNav(delta: number): void {
  if (!slashOpen.value || !slashItems.value.length) return
  const n = slashItems.value.length
  slashIndex.value = (slashIndex.value + delta + n) % n
}

function onSlashArrowKey(event: KeyboardEvent, delta: number): void {
  if (!slashOpen.value) return
  event.preventDefault()
  onSlashNav(delta)
}

function onComposerEnter(): void {
  if (slashOpen.value) {
    const item = slashItems.value[slashIndex.value]
    if (item) void applySlashCommand(item)
    else closeSlashMenu()
    return
  }
  void onSend()
}

function onComposerTab(): void {
  if (!slashOpen.value) return
  const item = slashItems.value[slashIndex.value]
  if (item) void applySlashCommand(item)
}

function onComposerTabKey(event: KeyboardEvent): void {
  if (!slashOpen.value) return
  event.preventDefault()
  onComposerTab()
}

function onComposerEscape(): void {
  if (slashOpen.value) {
    closeSlashMenu()
    return
  }
  if (mentionOpen.value) mentionOpen.value = false
}

/**
 * 删除**指定**会话（下拉列表里每一项后面的 ×）。
 *
 * 与旧版「删当前会话」按钮的区别：这里能删任意一条，因此要区分两种情形 ——
 * 删的是当前会话时要重载消息与草稿；删的是别的会话则**不动当前视图**
 * （否则删一条旁支会话会把正在编辑的内容清掉）。
 */
async function onDeleteSessionById(id: string): Promise<void> {
  const target = sessions.value.find((s) => s.id === id)
  if (!target) return
  /**
   * 记住当前的展开状态：确认弹窗在 `sessionDropdownRef` 之外，点它会命中
   * document 上的「点击外部即收起」监听，于是**确认/取消后列表都会自己关掉**。
   * 想连着删几条就得每次重新展开 —— 这里在弹窗结束后恢复原状态。
   */
  const wasOpen = sessionOpen.value
  // 用自绘确认弹窗替代 window.confirm：Windows 上原生 confirm/alert 关闭后主窗口会丢失
  // 键盘焦点（Electron 已知问题），导致输入框点击也无法聚焦，表现为「输入框不可输入」
  const ok = await promptConfirm({
    title: t('studio.chat.deleteSession'),
    message: t('studio.chat.deleteConfirm'),
    confirmLabel: t('common.delete')
  })
  sessionOpen.value = wasOpen
  if (!ok) return

  const wasActive = id === activeId.value
  removeSession(id)
  // 同步清理磁盘上的 dsh 持久化记录，避免同 id 会话被「幽灵恢复」
  window.studio.deleteHarnessSession(id).catch(() => undefined)

  if (wasActive) {
    loadActiveMessages()
    // 删除会话后落到了别的会话：队列同样不该跟着过来
    clearSendQueue()
    resetEditor()
    composing.value = false
    scrollToBottom()
  }
  // 确认弹窗关闭后重新聚焦输入框，双保险规避焦点丢失
  void nextTick(() => inputRef.value?.focus())
}

/** 输入框内容变化：同步文本模型；光标前是 @ 时弹出资产选择器（支持在指令文本中间引用） */
function onComposerInput(): void {
  syncDraftFromEditor()
  // 用户直接删除编辑区内的引用节点时，chips 同步移除
  const text = draft.value
  if (referenced.value.some((r) => !text.includes(`@${r.path}`))) {
    referenced.value = referenced.value.filter((r) => text.includes(`@${r.path}`))
  }
  if (composing.value) return
  const before = textBeforeCursor()
  // `/` 指令菜单优先于 @（互斥）
  if (matchSlashInput(before)) {
    mentionOpen.value = false
    updateSlashMenuFromCursor()
    return
  }
  closeSlashMenu()
  if (mentionOpen.value) return
  if (/@[^\s@]*$/.test(before)) mentionOpen.value = true
}

/** 音频没有可视化缩略图；3D 走离屏预览图，原文件不能当图片 */
function resolveMentionThumb(asset: AssetInfo): Promise<string> {
  if (asset.type === 'voice') return Promise.resolve('')
  if (asset.type === 'model' || asset.type === 'model3d') return ensureModelPreviewUrl(asset)
  // 预览路径口径与资产库 / 检查器一致：矢量图（SVG）与视频走原文件，静态图优先真缩略图
  const path =
    resolvePreviewMediaPath({
      relativePath: asset.relativePath,
      thumbnailPath: asset.thumbnailPath,
      type: asset.type
    }) || ''
  if (!path || isModelFilePath(path)) return Promise.resolve('')
  return resolveAssetPreviewUrl(path)
}

/** 把单个相对路径加入已引用列表（去重），并异步填充缩略图 */
function addReferencedPath(raw: string): void {
  const path = raw.replace(/\\/g, '/').trim()
  if (!path || referenced.value.some((r) => r.path === path)) return
  const known = new Map(
    project.assets.map((a) => [a.relativePath?.replace(/\\/g, '/').trim() ?? '', a])
  )
  const asset = known.get(path)
  if (asset) {
    referenced.value.push({ path, name: asset.name, type: asset.type, thumbUrl: '' })
    void resolveMentionThumb(asset)
      .then((url) => {
        const item = referenced.value.find((r) => r.path === path)
        if (item) item.thumbUrl = url
      })
      .catch(() => {
        /* chips 保留图标 fallback */
      })
    return
  }
  // 资产库可能尚未刷新到该文件（如刚粘贴落盘），直接用相对路径请求预览图
  referenced.value.push({ path, name: path.split('/').pop() ?? path, type: 'image', thumbUrl: '' })
  void resolveAssetPreviewUrl(path)
    .then((url) => {
      const item = referenced.value.find((r) => r.path === path)
      if (item) item.thumbUrl = url
    })
    .catch(() => {
      /* chips 保留图标 fallback */
    })
}

/** 编辑区内容序列化为文本模型：图片引用 → `@相对路径`，块级元素/换行 → \n */
function editorText(): string {
  const el = inputRef.value
  if (!el) return draft.value
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    if (node.nodeName === 'BR') return '\n'
    // 内联引用节点（span.editor-mention[data-path]，内嵌缩略图 img）→ 输出 @路径
    if (node instanceof HTMLElement && node.classList.contains('editor-mention')) {
      return node.dataset.path ? `@${node.dataset.path}` : ''
    }
    /**
     * 工作流引用块（span.editor-workflow-chip）→ 输出**完整引用文本**（含 id）。
     *
     * 输入框里它显示成一个小胶囊，但送到模型的内容与以前逐字相同 —— Agent 靠 id 调
     * `workflow_use_installed` 精确复现这条工作流，外观可以变，这段文本不能变。
     */
    if (node instanceof HTMLElement && node.classList.contains('editor-workflow-chip')) {
      return node.dataset.workflowText ?? ''
    }
    if (node instanceof HTMLImageElement) return node.dataset.path ? `@${node.dataset.path}` : ''
    let out = ''
    for (const c of node.childNodes) out += walk(c)
    const tag = (node as HTMLElement).tagName
    if (tag === 'DIV' || tag === 'P') out += '\n'
    return out
  }
  return walk(el)
}

/** 编辑区 → draft 同步（编辑区是唯一数据源，发送/构建任务以 draft 文本为准） */
function syncDraftFromEditor(): void {
  draft.value = editorText()
}

/** 清空编辑区与草稿 */
function resetEditor(): void {
  const el = inputRef.value
  if (el) el.replaceChildren()
  draft.value = ''
  closeSlashMenu()
}

/** 当前选区（无选区或选区在编辑区外时取编辑区末尾） */
function getEditorRange(): Range | null {
  const el = inputRef.value
  if (!el) return null
  const sel = window.getSelection()
  if (sel && sel.rangeCount > 0) {
    const r = sel.getRangeAt(0)
    if (el.contains(r.commonAncestorContainer)) return r
  }
  const r = document.createRange()
  r.selectNodeContents(el)
  r.collapse(false)
  return r
}

/** 光标前的纯文本（用于 @ 选择器触发判断） */
function textBeforeCursor(): string {
  const el = inputRef.value
  if (!el) return draft.value
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return editorText()
  const range = sel.getRangeAt(0)
  if (!el.contains(range.commonAncestorContainer)) return editorText()
  const clone = range.cloneRange()
  clone.selectNodeContents(el)
  clone.setEnd(range.endContainer, range.endOffset)
  return clone.toString()
}

/** 构造内联引用节点：图片显示缩略图（图文混排），其它资产显示 @路径 文本 chip */
function createMentionNode(path: string): HTMLElement {
  const span = document.createElement('span')
  span.className = 'editor-mention'
  span.dataset.path = path
  span.title = path
  span.contentEditable = 'false'
  const name = path.split('/').pop() ?? path
  if (isImageLikePath(path)) {
    const img = document.createElement('img')
    img.className = 'editor-mention-img'
    img.alt = name
    span.appendChild(img)
    void resolveAssetPreviewUrl(path)
      .then((url) => {
        if (img.isConnected) img.src = url
      })
      .catch(() => {
        if (img.isConnected) {
          img.remove()
          const label = document.createElement('span')
          label.className = 'editor-mention-label'
          label.textContent = `@${path}`
          span.appendChild(label)
        }
      })
  } else {
    const label = document.createElement('span')
    label.className = 'editor-mention-label'
    label.textContent = `@${path}`
    span.appendChild(label)
  }
  return span
}

/**
 * 在光标处插入内联引用节点（图片显示缩略图，非图片显示 @路径 chip），
 * 节点后自动补一个不换行空格，避免与后续文本粘连并防止误触发 @ 选择器。
 * 插入后光标移到补空格之后，便于连续插入（如多张图片粘贴）。
 */
function insertMentionNode(path: string): void {
  const el = inputRef.value
  if (!el) return
  el.focus()
  const range = getEditorRange()
  if (!range) return
  range.deleteContents()
  const node = createMentionNode(path)
  range.insertNode(node)
  const space = document.createTextNode('\u00A0')
  range.setStartAfter(node)
  range.setEndAfter(node)
  range.insertNode(space)
  addReferencedPath(path)
  syncDraftFromEditor()
  const sel = window.getSelection()
  if (sel) {
    const r = document.createRange()
    r.setStartAfter(space)
    r.setEndAfter(space)
    sel.removeAllRanges()
    sel.addRange(r)
  }
}

/** 工作流引用块的图标（常量，不含任何外部数据） */
const WORKFLOW_CHIP_ICON =
  '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">' +
  '<rect x="1.75" y="1.75" width="12.5" height="12.5" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
  '<rect x="5" y="8.75" width="6" height="2.5" rx="1.25" fill="currentColor"/></svg>'

/**
 * 构造工作流引用块：显示成「图标 + 标题」的**胶囊**，而不是把 标题 / id / 简介整段摊在输入框里。
 *
 * 完整引用文本（含 id 与简介）存在 `dataset.workflowText` 上，序列化时原样取出 ——
 * 输入框里看起来只是一个块，送给模型的内容与以前逐字相同（Agent 靠 id 精确复现工作流）。
 * `title` 也放同一段文本：悬停就能看到 id 与简介，不至于只剩一个标题让人猜。
 */
function createWorkflowChipNode(workflow: InstalledWorkflowRecordView): HTMLElement {
  const head = t('studio.chat.workflowInsert', { title: workflow.title, id: workflow.id })
  const text = workflow.summary ? `${head}：${workflow.summary}` : head
  const chip = document.createElement('span')
  chip.className = 'editor-workflow-chip'
  chip.dataset.workflowId = workflow.id
  chip.dataset.workflowText = text
  chip.title = text
  chip.contentEditable = 'false'
  const icon = document.createElement('span')
  icon.className = 'editor-workflow-icon'
  icon.innerHTML = WORKFLOW_CHIP_ICON
  const label = document.createElement('span')
  label.className = 'editor-workflow-label'
  label.textContent = workflow.title
  chip.append(icon, label)
  return chip
}

/** 在光标处插入工作流引用块（与内联引用节点同样补一个不换行空格，避免与后续文字粘连） */
function insertWorkflowChip(workflow: InstalledWorkflowRecordView): void {
  const el = inputRef.value
  if (!el) return
  el.focus()
  const range = getEditorRange()
  if (!range) return
  range.deleteContents()
  const chip = createWorkflowChipNode(workflow)
  range.insertNode(chip)
  const space = document.createTextNode('\u00A0')
  range.setStartAfter(chip)
  range.setEndAfter(chip)
  range.insertNode(space)
  syncDraftFromEditor()
  const sel = window.getSelection()
  if (sel) {
    const r = document.createRange()
    r.setStartAfter(space)
    r.setEndAfter(space)
    sel.removeAllRanges()
    sel.addRange(r)
  }
}

/** 在光标处插入纯文本（粘贴文本时保持纯文本，不带富文本格式） */
function insertPlainText(text: string): void {
  const el = inputRef.value
  if (!el) return
  el.focus()
  const range = getEditorRange()
  if (!range) return
  range.deleteContents()
  const node = document.createTextNode(text)
  range.insertNode(node)
  syncDraftFromEditor()
  const sel = window.getSelection()
  if (sel) {
    const r = document.createRange()
    r.setStart(node, node.length)
    r.collapse(true)
    sel.removeAllRanges()
    sel.addRange(r)
  }
}

/**
 * @ 选择器确认：先删除光标前紧贴的触发用 @（若有），再把每个 `@相对路径`
 * 以内联引用节点插入光标处，并维护 referenced 列表；dsh 会直接解析文本中的内联引用。
 */
function onMentionConfirm(paths: string[]): void {
  mentionOpen.value = false
  const el = inputRef.value
  if (!el) return
  el.focus()
  // 删除触发点：光标前形如 `@xxx` 的片段（含 @ 本身）
  const before = textBeforeCursor()
  const sel = window.getSelection()
  const m = before.match(/@[^\s@]*$/)
  if (sel && sel.rangeCount > 0 && m) {
    const r = sel.getRangeAt(0)
    if (r.endOffset >= m[0].length) {
      const cut = r.cloneRange()
      cut.setStart(r.endContainer, r.endOffset - m[0].length)
      cut.deleteContents()
    }
  }
  for (const raw of paths) {
    const path = raw.replace(/\\/g, '/').trim()
    if (path) insertMentionNode(path)
  }
}

/** 判断文本是否像单个本地媒体文件路径（Windows / Unix / file://） */
function looksLikeMediaFilePath(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (/^file:\/\//i.test(t)) return true
  const p = t.replace(/\\/g, '/')
  if (!/^[A-Za-z]:\//.test(p) && !p.startsWith('/')) return false
  return /\.(png|jpe?g|gif|webp|bmp|mp4|mov|webm|mp3|wav|m4a|ogg|glb|gltf|obj|fbx)$/i.test(p)
}

/** File → data URL（粘贴截图/图片读取） */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('read file failed'))
    reader.readAsDataURL(file)
  })
}

/**
 * 输入框粘贴：支持截图 / 剪贴板图片。把图片落盘到工程资产库（Assets/Images/Paste），
 * 再以内联缩略图节点插入光标处（图文混排）——复用资产引用链路，模型可将图片作为参考图使用。
 * 剪贴板同时含文本（如复制图文）时先插入纯文本，再追加图片引用；
 * 若该文本只是文件系统路径，则跳过，避免裸路径残留。
 */
async function onComposerPaste(event: ClipboardEvent): Promise<void> {
  if (composing.value) return
  const clipboard = event.clipboardData
  if (!clipboard) return
  const images: File[] = []
  for (let i = 0; i < clipboard.items.length; i++) {
    const item = clipboard.items[i]
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) images.push(file)
    }
  }
  if (!images.length) return
  // 含图片时接管粘贴：避免把图片二进制 / 文件路径粘成文本
  event.preventDefault()
  const text = clipboard.getData('text/plain').trim()
  if (text && !looksLikeMediaFilePath(text)) insertPlainText(text)
  for (const file of images) {
    try {
      const dataUrl = await readFileAsDataUrl(file)
      if (!dataUrl) continue
      const relativePath = await window.studio.saveGraphRunMedia({
        dataUrl,
        key: `paste_${Date.now()}`,
        outputDir: 'Assets/Images/Paste'
      })
      if (!relativePath) continue
      // 落盘后刷新资产库，让新图出现在工程资产中；引用本身不依赖注册即可预览
      void project.scheduleRefreshLibrary()
      insertMentionNode(relativePath)
    } catch (error) {
      console.error('[ChatPanel] paste image failed', error)
    }
  }
}

/**
 * 输入框拖拽：支持从文件管理器拖入图片/视频/音频等媒体文件。
 * 统一落盘到工程资产库并以内联引用节点插入，避免浏览器默认插入裸路径文本。
 */
async function onComposerDrop(event: DragEvent): Promise<void> {
  if (composing.value) return
  const files = event.dataTransfer?.files
  if (!files?.length) return
  const mediaFiles: File[] = []
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    if (!file) continue
    if (
      file.type.startsWith('image/') ||
      file.type.startsWith('video/') ||
      file.type.startsWith('audio/')
    ) {
      mediaFiles.push(file)
    }
  }
  if (!mediaFiles.length) return
  event.preventDefault()
  for (const file of mediaFiles) {
    try {
      const dataUrl = await readFileAsDataUrl(file)
      if (!dataUrl) continue
      const relativePath = await window.studio.saveGraphRunMedia({
        dataUrl,
        key: `drop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        outputDir: 'Assets/Images/Paste'
      })
      if (!relativePath) continue
      void project.scheduleRefreshLibrary()
      insertMentionNode(relativePath)
    } catch (error) {
      console.error('[ChatPanel] drop media failed', error)
    }
  }
}

/** 移除引用：chips 同步删除编辑区内的对应内联引用节点 */
function removeMention(path: string): void {
  referenced.value = referenced.value.filter((r) => r.path !== path)
  const el = inputRef.value
  if (!el) return
  el.querySelectorAll<HTMLElement>('.editor-mention[data-path]').forEach((n) => {
    if (n.dataset.path === path) n.remove()
  })
  syncDraftFromEditor()
}

/** 用户气泡富文本：转义后把内联 `@相对路径` 高亮为引用样式（仅展示，不改变原文本） */
/** 判断路径是否为本地绝对路径（Windows 盘符路径或 Unix 绝对路径） */
function isAbsoluteMediaPath(path: string): boolean {
  const p = path.replace(/\\/g, '/')
  return /^[A-Za-z]:\//.test(p) || p.startsWith('/')
}

/** 解析媒体预览 URL：工程相对路径走资产缩略图（回退原图与资产表同名匹配）；本地绝对路径直接构造 studio-media URL */
async function resolveMediaUrl(path: string): Promise<string> {
  const p = path.replace(/\\/g, '/').trim()
  if (!p) return ''
  if (isAbsoluteMediaPath(p)) {
    return `studio-media://local/?path=${encodeURIComponent(p)}&t=${Date.now()}`
  }
  const preview = await resolveAssetPreviewUrl(p)
  if (preview) return preview
  const file = await resolveAssetFileUrl(p)
  if (file) return file
  // 若直接路径未命中（例如资产被移动到了子目录或写成了裸文件名 @5.jpg），从当前工程资产列表按相对路径后缀/文件名兜底匹配
  const baseName = p.split('/').pop()?.toLowerCase() ?? ''
  if (baseName && project.assets.length > 0) {
    const matched = project.assets.find((a) => {
      const rel = (a.relativePath ?? '').replace(/\\/g, '/').trim()
      if (!rel) return false
      const relLower = rel.toLowerCase()
      return (
        relLower === p.toLowerCase() ||
        relLower.endsWith(`/${baseName}`) ||
        a.name.trim().toLowerCase() === baseName
      )
    })
    const matchedRel = matched?.relativePath?.replace(/\\/g, '/').trim()
    if (matchedRel && matchedRel !== p) {
      return (await resolveAssetPreviewUrl(matchedRel)) || (await resolveAssetFileUrl(matchedRel))
    }
  }
  return ''
}

/** 助手气泡：Markdown 渲染（标题 / 列表 / 代码块 / 表格等），内联引用与图片卡片沿用既有语义 */
function renderChatBody(text: string): string {
  return renderChatMarkdown(text, { copyCode: t('studio.chat.copyCode') })
}

/**
 * 气泡内代码块复制：节点由 v-html 注入且数量不定，统一用事件委托处理；
 * 代码原文直接取同组 <code> 的文本，不必把内容再塞进属性。
 */
async function onCodeCopyClick(event: MouseEvent): Promise<void> {
  const button = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-copy-code]')
  if (!button) return
  const code = button.closest('.md-code')?.querySelector('code')?.textContent ?? ''
  if (!code) return
  if (!(await copyTextToClipboard(code))) return
  button.classList.add('copied')
  window.setTimeout(() => button.classList.remove('copied'), 1200)
}

/**
 * 消息气泡内图片卡片：把 data-src 解析为预览 URL；加载失败/文件缺失回退为文本 chip。
 * 动图（GIF）沿用资产卡口径：静态缩略图先顶上，进入视口后才换原文件播动画。
 *
 * 注意：StudioView 处于 KeepAlive 离屏缓存或 Dockview 面板尚未挂载到 document 时，
 * `img.isConnected` 为 false，但 `img.parentElement` 仍有效。
 * 绝不能用 `!img.isConnected` 提前丢弃已摘除 `data-src` 的 `<img>`，否则切回 StudioView 后会永久残留无 src 的破图。
 */
function resolveChatImages(root: HTMLElement): void {
  root.querySelectorAll<HTMLImageElement>('img[data-src]').forEach((img) => {
    const path = img.dataset.src
    if (!path) return
    img.dataset.chatSrc = path
    img.removeAttribute('data-src')
    const fallback = (): void => {
      if (!img.parentElement) return
      const chip = document.createElement('span')
      chip.className = 'inline-ref'
      chip.dataset.chatImgFallback = path
      chip.textContent = `@${path}`
      img.replaceWith(chip)
    }
    img.addEventListener('error', fallback, { once: true })
    resolveMediaUrl(path)
      .then((url) => {
        if (!img.parentElement) return
        if (!url) {
          fallback()
          return
        }
        img.src = url
        // 动图（GIF）：先显示静态缩略图，进入视口后才换原文件播动画
        attachAnimatedImagePlayback(img, path, url)
      })
      .catch(fallback)
  })
}

/**
 * 当工程完成打开 / 切换 / KeepAlive 激活或资产库刷新后，重新扫描消息列表中：
 * 1) 尚未赋上 `src` 的 `img[data-chat-src]`；
 * 2) 工程未就绪时临时降级为 `span[data-chat-img-fallback]` 的节点，恢复为图片卡片并重新解析。
 */
function retryUnresolvedChatImages(): void {
  const root = listRef.value
  if (!root) return
  root.querySelectorAll<HTMLImageElement>('img[data-chat-src]').forEach((img) => {
    if (!img.getAttribute('src') && img.dataset.chatSrc) {
      img.dataset.src = img.dataset.chatSrc
    }
  })
  root.querySelectorAll<HTMLElement>('span[data-chat-img-fallback]').forEach((chip) => {
    const path = chip.dataset.chatImgFallback
    if (!path) return
    const img = document.createElement('img')
    img.dataset.src = path
    img.dataset.chatSrc = path
    img.alt = path.split('/').pop() ?? path
    chip.replaceWith(img)
  })
  resolveChatImages(root)
}

/** v-chat-img：v-html 更新后同步解析气泡内图片卡片 */
const vChatImg: Directive = {
  mounted: (el) => resolveChatImages(el),
  updated: (el) => resolveChatImages(el)
}

/**
 * 发送文本：内联引用直接随文本发送（dsh 解析 @路径）；
 * 仅补充 chips 中未被文本引用的路径（兼容旧行为，用户手动删掉文本引用时不丢资产）。
 * 用子串判断是否已引用：路径后紧跟中文等非空白字符（如 `@x.png生成个3d模型`）
 * 时，按正则切分会把整段误判为路径导致“看似未引用”而重复追加，子串判断可避免。
 */
function buildTask(text: string): string {
  const extra = referenced.value.map((r) => r.path).filter((p) => !text.includes(`@${p}`))
  if (!extra.length) return text
  return text + '\n\n' + extra.map((p) => `@${p}`).join('\n')
}

const messages = ref<ChatMsg[]>([])
/** harness provider 报告的最新真实上下文 token（每轮 LLM 请求完成后更新，并随会话落盘） */
const harnessContextUsed = ref<number | undefined>(undefined)
/** 当前 agent 模式：craft（完整执行）/ ask（纯问答）/ plan（先规划后执行），持久化到本地 */
const savedMode = localStorage.getItem(CHAT_MODE_KEY) as ChatMode | null
const mode = ref<ChatMode>(savedMode && CHAT_MODES.includes(savedMode) ? savedMode : 'craft')
watch(mode, (value) => {
  localStorage.setItem(CHAT_MODE_KEY, value)
})
const modeOptions = computed(() => [
  { value: 'craft' as ChatMode, label: t('studio.chat.modeCraft') },
  { value: 'ask' as ChatMode, label: t('studio.chat.modeAsk') },
  { value: 'plan' as ChatMode, label: t('studio.chat.modePlan') }
])
/** 模式选择下拉的开合状态 */
const modeOpen = ref(false)
const modeDropdownRef = ref<HTMLElement | null>(null)
const currentModeLabel = computed(
  () => modeOptions.value.find((m) => m.value === mode.value)?.label ?? ''
)
function selectMode(value: ChatMode): void {
  mode.value = value
  modeOpen.value = false
}
/** 技能面板：统一展示已安装的市场技能（含画布工作流模板）、GitHub 技能、项目技能与自定义技能 */
const skillsOpen = ref(false)
const skillsDropdownRef = ref<HTMLElement | null>(null)
const sessionSkills = ref<SessionSkill[]>([])
const installedWorkflows = ref<InstalledWorkflowRecordView[]>([])
const workflowsLoading = ref(false)

/** 已加载技能 → 命中次数：skill 工具调用时累加，作为「命中依据」可视化 */
const loadedSkills = reactive<Record<string, number>>({})
const loadedSkillCount = computed(() => Object.keys(loadedSkills).length)
const loadedSkillTotal = computed(() => {
  let total = 0
  for (const key in loadedSkills) total += loadedSkills[key]
  return total
})

/** 过滤掉已由 installedWorkflows 承载的市场技能包（wf-<id>）与 dsh 内置斜杠指令，避免混淆已安装技能计数 */
const standaloneSessionSkills = computed(() => {
  const installedSkillNames = new Set(installedWorkflows.value.flatMap((w) => [w.id, `wf-${w.id}`]))
  return sessionSkills.value.filter((s) => s.kind !== 'builtin' && !installedSkillNames.has(s.name))
})

const unifiedSkillsCount = computed(
  () => installedWorkflows.value.length + standaloneSessionSkills.value.length
)

function workflowLoadedHits(workflow: InstalledWorkflowRecordView): number {
  const byWfPrefix = loadedSkills[`wf-${workflow.id}`] ?? 0
  const byId = loadedSkills[workflow.id] ?? 0
  return byWfPrefix || byId
}

async function refreshSessionSkills(): Promise<void> {
  try {
    sessionSkills.value = await window.studio.getSessionSkills()
  } catch {
    // 技能清单拉取失败不阻塞对话，保持上次快照
  }
}

/** 拉已安装工作流（每次打开面板都拉：刚在市场装完就能立刻看到） */
async function refreshInstalledWorkflows(): Promise<void> {
  workflowsLoading.value = true
  try {
    installedWorkflows.value = await window.studio.listInstalledWorkflows()
  } catch {
    // 拉取失败不阻塞对话，保持上次快照
  } finally {
    workflowsLoading.value = false
  }
}

function toggleSkills(): void {
  skillsOpen.value = !skillsOpen.value
  if (skillsOpen.value) {
    void refreshSessionSkills()
    void refreshInstalledWorkflows()
  }
}

function insertSkillSlashCommand(skill: SessionSkill): void {
  if (skill.userInvocable === false) return
  insertPlainText(`/${skill.name} `)
  skillsOpen.value = false
}

/**
 * 选中市场工作流技能 → 把**引用块**插入输入框。
 *
 * 刻意插入引用而不是直接执行：用户还要能补自己的要求再发送。
 * id 是关键 —— Agent 靠它调 `workflow_use_installed` 精确复现这条工作流，
 * 而不是拿描述去重新规划一个「差不多的」；它藏在引用块里（悬停可见），发送时原样带出。
 *
 * 输入框里显示成一个小胶囊（图标 + 标题），不再把「标题 + id + 简介」整段摊开 ——
 * 插一条工作流就占掉大半个输入框，剩不下地方写要求。
 */
function insertWorkflowReference(workflow: InstalledWorkflowRecordView): void {
  /**
   * 包损坏的不插入：那样只会往输入框里放一句 Agent 根本用不了的引用，
   * 用户发了消息才发现不对。卡片本身已经把原因写在简介位置了。
   */
  if (workflow.broken) return
  insertWorkflowChip(workflow)
  skillsOpen.value = false
}

/** skill 工具命中：detail 中带技能名（name / titleZh / titleEn）即标记为已加载 */
function markSkillLoaded(detail?: string): void {
  if (!detail) return
  const needle = detail.toLowerCase()
  for (const skill of sessionSkills.value) {
    const candidates = [skill.name, skill.titleZh, skill.titleEn].filter(
      (s): s is string => !!s && s.length > 0
    )
    if (candidates.some((s) => needle.includes(s.toLowerCase()))) {
      loadedSkills[skill.name] = (loadedSkills[skill.name] ?? 0) + 1
    }
  }
}

/** 点击下拉外部或按 ESC 收起菜单：注册在 document 上避免 trigger 内 stopPropagation 误关 */
function onModeOutside(e: MouseEvent | KeyboardEvent): void {
  if (
    !modeOpen.value &&
    !modelOpen.value &&
    !sessionOpen.value &&
    !skillsOpen.value &&
    !scheduleMenuOpen.value &&
    !searchModalOpen.value
  ) {
    return
  }
  if (e instanceof KeyboardEvent) {
    if (e.key === 'Escape') {
      modeOpen.value = false
      modelOpen.value = false
      sessionOpen.value = false
      skillsOpen.value = false
      scheduleMenuOpen.value = false
      searchModalOpen.value = false
    }
    return
  }
  if (modeDropdownRef.value && !modeDropdownRef.value.contains(e.target as Node)) {
    modeOpen.value = false
  }
  if (modelDropdownRef.value && !modelDropdownRef.value.contains(e.target as Node)) {
    modelOpen.value = false
  }
  if (sessionDropdownRef.value && !sessionDropdownRef.value.contains(e.target as Node)) {
    sessionOpen.value = false
  }
  if (skillsDropdownRef.value && !skillsDropdownRef.value.contains(e.target as Node)) {
    skillsOpen.value = false
  }
  if (scheduleDropdownRef.value && !scheduleDropdownRef.value.contains(e.target as Node)) {
    scheduleMenuOpen.value = false
  }
  if (searchDropdownRef.value && !searchDropdownRef.value.contains(e.target as Node)) {
    searchModalOpen.value = false
  }
}
const draft = ref('')
const inputRef = ref<HTMLElement | null>(null)
/** 输入法组合期间：跳过 @ 触发 / 粘贴接管，避免组合文本被误处理 */
const composing = ref(false)
const running = ref(false)
/** `/clear` 后短暂忽略 harness 事件，避免中止尾包写进新会话 */
let ignoreHarnessEvents = false
const status = ref<HarnessStatus | null>(null)
const listRef = ref<HTMLElement | null>(null)

/** 瞬时状态的配色相位；idle 表示当前没有状态要显示 */
type ActivityPhase = 'idle' | 'waiting' | 'warn' | 'error'

/**
 * 瞬时状态（正在启动 / 已提交给模型 / 仍在等待…）：只出现在顶部状态栏，
 * 不进消息流、不落盘 —— 它们是「此刻在做什么」，状态一变就作废，
 * 混进对话只会把真正的内容往下推。结果类信息走会话消息本身。
 */
const activity = ref('')
const activityPhase = ref<ActivityPhase>('idle')
let activityTimer: number | null = null
/** 状态在顶部保留多久后自动消失；够读完一句较长的等待/错误提示 */
const ACTIVITY_TTL_MS = 6000

/**
 * 任务清单：内嵌在消息流中，跟随各自任务的 user 消息展示（agent 风格 todo 卡）。
 * 返回第 userIndex 条 user 消息之后、下一条 user 消息之前的工具/生成活动卡；
 * 任务执行中状态实时更新，不持久化。
 */
function roundToolsAt(userIndex: number): Array<ChatMsg & { kind: 'tool' }> {
  const list = messages.value
  const out: Array<ChatMsg & { kind: 'tool' }> = []
  for (let i = userIndex + 1; i < list.length; i++) {
    const m = list[i]
    if (m.kind === 'user') break
    if (m.kind === 'tool') out.push(m)
  }
  return out
}

/**
 * 顶层卡片：主代理自己的调用。子代理的调用挂在对应 subagent 卡片下（见 subagentToolsOf）；
 * 父卡片不在本轮里（旧数据 / 匹配失败）时退回顶层，避免活动凭空消失。
 */
function taskToolsAt(userIndex: number): Array<ChatMsg & { kind: 'tool' }> {
  const tools = roundToolsAt(userIndex)
  const topIds = new Set(tools.filter((tm) => !tm.parentId && tm.id).map((tm) => tm.id))
  return tools.filter((tm) => !tm.parentId || !topIds.has(tm.parentId))
}

function subagentToolsOf(
  userIndex: number,
  parent: ChatMsg & { kind: 'tool' }
): Array<ChatMsg & { kind: 'tool' }> {
  if (!parent.id || parent.parentId) return []
  return roundToolsAt(userIndex).filter((tm) => tm.parentId === parent.id)
}

/**
 * 折叠态摘要：任务清单默认收起，标题旁给出「已完成/总数」，
 * 否则收起后完全看不出这轮跑到哪一步了。
 */
function taskToolsSummary(userIndex: number): string {
  const tools = taskToolsAt(userIndex)
  const done = tools.filter((tm) => tm.state === 'done').length
  return t('studio.chat.taskListSummary', { done, total: tools.length })
}

/** 任务清单里展示的一条工具参数（键值对） */
interface ToolArgEntry {
  key: string
  value: string
}

/** 单个参数值的展示文本：字符串原样、对象/数组转紧凑 JSON；超长截断避免撑爆卡片 */
function formatToolArgValue(value: unknown): string {
  let text: string
  if (typeof value === 'string') {
    text = value
  } else {
    const json = JSON.stringify(value)
    text = json === undefined ? String(value) : json
  }
  return text.length > 600 ? text.slice(0, 600) + '…' : text
}

/**
 * 工具调用详细参数：解析 runner 透传的 args JSON 为键值对，供任务清单逐条展示。
 * 解析失败或非对象时退化为单条原文，保证仍能看到 Agent 实际传入的命令参数。
 */
function toolArgs(tm: ChatMsg & { kind: 'tool' }): ToolArgEntry[] {
  const raw = tm.args?.trim()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return [{ key: 'args', value: formatToolArgValue(parsed) }]
    }
    return Object.entries(parsed as Record<string, unknown>).map(([key, value]) => ({
      key,
      value: formatToolArgValue(value)
    }))
  } catch {
    return [{ key: 'args', value: formatToolArgValue(raw) }]
  }
}

function toolDisplayName(tm: ChatMsg & { kind: 'tool' }): string {
  return formatMcpToolDisplayName(tm.name, isEnChat.value)
}

function toolShortCode(tm: ChatMsg & { kind: 'tool' }): string {
  const bare = stripMcpToolPrefix(tm.name)
  const display = formatMcpToolDisplayName(tm.name, isEnChat.value)
  return bare !== display ? bare : ''
}

function toolSteps(tm: ChatMsg & { kind: 'tool' }): string[] {
  if (Array.isArray(tm.steps) && tm.steps.length > 0) return tm.steps
  return extractMcpToolStepsFromArgs(tm.name, tm.args)
}

function stepKind(step: string): McpStepKind {
  return classifyMcpStepKind(step)
}

function stepIcon(step: string): string {
  const kind = classifyMcpStepKind(step)
  if (kind === 'add') return '+'
  if (kind === 'delete') return '−'
  if (kind === 'connect') return '→'
  if (kind === 'run') return '▶'
  if (kind === 'select') return '◎'
  if (kind === 'update') return '✎'
  return '•'
}

function isInlineStreamTool(tm: ChatMsg & { kind: 'tool' }): boolean {
  if (tm.name === 'dsh-agent' && tm.state !== 'error') return false
  if (tm.parentId) return false
  return true
}

function onCompositionEnd(): void {
  composing.value = false
  // 组合结束后再判断 `/` / `@` 触发
  onComposerInput()
}

/** 最近复制成功的消息索引，用于按钮上的“已复制”反馈 */
const copiedIndex = ref<number | null>(null)
let copyTimer: number | null = null

async function copyMessage(index: number, text: string): Promise<void> {
  if (!text) return
  // 走主进程 IPC（clipboard.writeText）优先：navigator.clipboard 依赖文档焦点，易静默失败
  const ok = await copyTextToClipboard(text)
  if (!ok) return
  copiedIndex.value = index
  if (copyTimer !== null) window.clearTimeout(copyTimer)
  copyTimer = window.setTimeout(() => {
    copiedIndex.value = null
  }, 1500)
}

/** 队列项：执行中点「发送」或「重发」入队，等本轮结束后按序发出 */
interface QueueItem {
  id: number
  text: string
  /** 来源消息下标（重发时用于按钮反馈）；手输的消息为 null */
  sourceIndex: number | null
  /** 用户点了「立即发送」：等当前轮真正停下来后必须发出去，不再回队 */
  forcing: boolean
}

const sendQueue = ref<QueueItem[]>([])
let queueSeq = 0
/** 出队中标记：中断是异步的，避免重入时把同一条重复发出 */
let draining = false
/** 新一轮发送前置预检/技能展开进行中：防止期间到达的迟到 done/error 事件提前把 running 置回 false */
let preparingTask = false
/** 客户端中断序号：用于在异步预检/启动期间识别用户已触发的新一轮中断 */
let clientAbortSeq = 0
/** 中断后短暂屏蔽旧进程残余流式事件自动拉起 running 的截止时间戳 */
let abortIgnoreUntil = 0
/** 重发反馈：最近一条加入队列的消息索引 */
const resendIndex = ref<number | null>(null)
let resendTimer: number | null = null

function queuePreview(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > 72 ? `${oneLine.slice(0, 72)}…` : oneLine
}

function enqueueSend(text: string, sourceIndex: number | null = null): void {
  sendQueue.value.push({
    id: ++queueSeq,
    text,
    sourceIndex,
    forcing: false
  })
  scrollToBottom()
}

function removeQueued(id: number): void {
  sendQueue.value = sendQueue.value.filter((item) => item.id !== id)
}

function clearSendQueue(): void {
  sendQueue.value = []
}

/** 一个可选的文本模型（来自任一已启用且带密钥的 provider 的 text 模态） */
interface ModelOption {
  providerId: string
  id: string
  label: string
  providerLabel: string
  /** 模型上下文窗口大小（token 数）；缺省时不显示上下文用量指示 */
  contextLength?: number
}

const modelOptions = ref<ModelOption[]>([])
/** 当前选中项：`providerId::modelId` 组合键，避免不同 provider 下同 id 模型冲突 */
const selectedKey = ref('')

function modelKey(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`
}

function splitModelKey(key: string): { providerId: string; modelId: string } {
  const idx = key.indexOf('::')
  return idx < 0
    ? { providerId: '', modelId: key }
    : { providerId: key.slice(0, idx), modelId: key.slice(idx + 2) }
}

/** 从设置汇总所有可用文本模型，并保留/回退当前选择 */
async function loadModels(): Promise<void> {
  try {
    const settings = await window.studio.getSettings()
    const providers = settings.models?.providers ?? []
    const options: ModelOption[] = []
    for (const p of providers) {
      if (!p.enabled || !p.apiKey?.trim()) continue
      const text = modalityConfig(p, 'text')
      const catalog = text.catalog ?? {}
      for (const id of text.selectedModelIds ?? []) {
        if (!id.trim()) continue
        options.push({
          providerId: p.id,
          id,
          // 目录只返回 id 的 provider（如 DeepSeek）用内置展示名兜底
          label: catalog[id]?.name?.trim() || providerModelDisplayName(p.providerKind, id),
          providerLabel: p.label || p.providerKind,
          // OpenRouter 等目录把 context_length 放在 capabilities 里
          contextLength: catalog[id]?.capabilities?.context_length as number | undefined
        })
      }
    }
    modelOptions.value = options

    const saved = localStorage.getItem(CHAT_MODEL_KEY)
    if (saved && options.some((o) => modelKey(o.providerId, o.id) === saved)) {
      selectedKey.value = saved
      return
    }
    // 回退：DeepSeek 官方默认 → 该 provider 首个模型 → 全局首个模型
    const ds = providers.find((p) => p.providerKind === 'deepseek' && p.enabled && p.apiKey?.trim())
    if (ds) {
      const def = modalityConfig(ds, 'text').defaultModelId?.trim()
      if (def && options.some((o) => o.providerId === ds.id && o.id === def)) {
        selectedKey.value = modelKey(ds.id, def)
        return
      }
      const first = options.find((o) => o.providerId === ds.id)
      if (first) {
        selectedKey.value = modelKey(first.providerId, first.id)
        return
      }
    }
    selectedKey.value = options[0] ? modelKey(options[0].providerId, options[0].id) : ''
  } catch {
    modelOptions.value = []
  }
}

watch(selectedKey, (value) => {
  if (value) localStorage.setItem(CHAT_MODEL_KEY, value)
})

/** 当前选中的模型项（找不到时为 undefined） */
const currentModel = computed<ModelOption | undefined>(() => {
  const key = selectedKey.value
  if (!key) return undefined
  return modelOptions.value.find((o) => modelKey(o.providerId, o.id) === key)
})
/** 模型选择下拉的开合状态 */
const modelOpen = ref(false)
const modelDropdownRef = ref<HTMLElement | null>(null)
function selectModel(key: string): void {
  selectedKey.value = key
  modelOpen.value = false
}
/** 会话选择下拉的开合状态 */
const sessionOpen = ref(false)
const sessionDropdownRef = ref<HTMLElement | null>(null)
function selectSession(id: string): void {
  onSessionChange(id)
  sessionOpen.value = false
}

/**
 * 常见文本模型上下文窗口（token）兜底：目录未携带 context_length 时使用，
 * 覆盖主流 OpenAI 兼容 provider 的常见模型 id（DeepSeek / Kimi / xAI / 智谱 / 千问 等）
 */
const MODEL_CONTEXT_FALLBACK: Record<string, number> = {
  'deepseek-flash': 1048576,
  'deepseek-v4-pro': 1048576,
  'kimi-k2': 131072,
  'kimi-k2-turbo': 131072,
  'moonshot-v1-8k': 8192,
  'moonshot-v1-32k': 32768,
  'moonshot-v1-128k': 131072,
  'glm-5.2': 200000,
  'glm-5.1': 200000,
  'glm-5': 200000,
  'glm-4': 131072,
  'glm-4-plus': 131072,
  'glm-4-flash': 131072,
  'grok-3': 131072,
  'grok-3-mini': 131072,
  'grok-4': 131072,
  'gpt-6.1-sol': 1048576,
  'gpt-6.1-terra': 1048576,
  'gpt-6-astra': 1048576,
  'gpt-6-sol': 1048576,
  'gpt-6-luna': 1048576,
  'gpt-6.1': 1048576,
  'gpt-6': 1048576,
  'gpt-5.5': 1048576,
  'gpt-5.4': 1048576,
  'gpt-5.4-pro': 1048576,
  'gpt-5.4-mini': 1048576,
  'gpt-5.3': 400000,
  'gpt-5.2': 400000,
  'gpt-5.1': 400000,
  'gpt-5': 400000,
  'gpt-5-mini': 400000,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4.1': 1048576,
  'gpt-4.1-mini': 1048576,
  'o4-mini': 200000,
  'o3-pro': 200000,
  o1: 200000,
  o3: 200000,
  'claude-opus-4-6': 1000000,
  'claude-sonnet-4-6': 1000000,
  'claude-sonnet-4': 200000,
  'claude-sonnet-4-5': 200000,
  'claude-opus-4': 200000,
  'gemini-2.5-flash': 1048576,
  'gemini-2.5-pro': 1048576,
  'qwen3.7-max': 1000000,
  'qwen3.7-plus': 1000000,
  'qwen-max': 32768,
  'qwen-plus': 131072,
  'qwen-turbo': 1000000,
  'qwen-long': 10000000
}

/** 未命中任何映射时的默认上下文窗口（token），取主流文本模型的保守下限 */
const DEFAULT_CONTEXT_LENGTH = 64000

/** 当前模型的上下文窗口大小（token）；未选中模型时为 0（不显示用量指示） */
const contextTotal = computed<number>(() => {
  const m = currentModel.value
  if (!m) return 0
  const raw = m.contextLength
  if (Number.isFinite(raw) && (raw as number) > 0) return raw as number
  // 目录未携带 context_length 时，按模型 id 匹配常见上下文窗口兜底，避免大窗口模型被 64K 低估
  return MODEL_CONTEXT_FALLBACK[m.id] ?? DEFAULT_CONTEXT_LENGTH
})

/** 把 token 数格式化为 "106.4K" 风格（<1K 显示整数，>=1K 一位小数 + K） */
function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n < 1000) return String(Math.round(n))
  const k = n / 1000
  const s = (Math.round(k * 10) / 10).toFixed(1)
  return s.replace(/\.0$/, '') + 'K'
}

/**
 * 估算当前会话已用 token：user / assistant 的 text + reasoning 累加，
 * 草稿也会被一起发给模型，一并算入以便用户提前看到用量接近上限
 */
const contextUsed = computed<number>(() => {
  // harness 每轮请求后报告真实上下文 token（含系统提示/工具定义/历史），优先使用；
  // 尚无 harness 数据（新会话或旧记录未落盘）时回退本地估算
  if (typeof harnessContextUsed.value === 'number' && harnessContextUsed.value >= 0) {
    return harnessContextUsed.value
  }
  let text = ''
  for (const m of messages.value) {
    if (m.kind === 'user') text += m.text
    else if (m.kind === 'assistant') {
      text += m.text
      if (m.reasoning) text += m.reasoning
    }
  }
  if (draft.value) text += draft.value
  return estimateTokenCount(text)
})

/** 上下文用量显示文本："106.4K / 168.0K · 63.3%"；无总量时为空串 */
const contextUsageText = computed<string>(() => {
  const total = contextTotal.value
  if (!total) return ''
  const used = contextUsed.value
  const pct = Math.min(999, (used / total) * 100)
  const pctStr = (Math.round(pct * 10) / 10).toFixed(1).replace(/\.0$/, '')
  return `${formatTokenCount(used)} / ${formatTokenCount(total)} · ${pctStr}%`
})

/** 用量比例（0-1），驱动环形进度条与警告色 */
const usageRatio = computed<number>(() => {
  const total = contextTotal.value
  if (!total) return 0
  return Math.min(1, contextUsed.value / total)
})

/**
 * 环形进度条百分比（如 "63.3%"），驱动 conic-gradient 进度。
 * 会话初期 token 占比常不足 1%，弧线 <1px 几乎不可见；
 * 因此有内容时至少显示 3% 的弧线，让进度增长有清晰反馈。
 */
const ringPct = computed<string>(() => {
  const raw = usageRatio.value * 100
  const pct = raw <= 0 ? 0 : Math.max(3, raw)
  return `${Math.round(pct * 10) / 10}%`
})

/**
 * 防抖落盘历史会话：消息与上下文用量共用同一个窗口。
 * 流式期间工具卡状态频繁更新、每轮 LLM 请求又各上报一次 context，避免高频写 localStorage。
 */
function scheduleHistoryPersist(): void {
  if (historyTimer !== null) window.clearTimeout(historyTimer)
  historyTimer = window.setTimeout(() => {
    historyTimer = null
    commitMessages([...messages.value])
    // 上下文用量与消息同批落盘：重启后环形进度条仍显示上次上报的真实值
    commitContextUsed(harnessContextUsed.value)
    commitTodos([...sessionTodos.value])
    commitGoal(sessionGoal.value)
    persistHistory()
  }, 400)
}

watch(messages, scheduleHistoryPersist, { deep: true })

let stopEvent: (() => void) | null = null
let stopActivity: (() => void) | null = null
/** 订阅 ASSET_REMOVED 的清理器：用户在资产库面板 / MCP 删除资产时回退「已保存」状态 */
let stopAssetRemoved: (() => void) | null = null
/** 本次任务在消息数组中的起点：状态更新只作用于该索引之后的工具卡，避免跨任务误更新重名卡 */
let sessionStart = 0
/** 本轮产物扫盘基线：发送前记录时刻，运行结束后只收这之后落盘的 Output / Cache 媒体 */
let roundStartAt = 0
/** 本次任务已收到但尚未绑定到 assistant 消息的思考过程文本（runner 先输出 reasoning 再输出回答） */
let pendingReasoning = ''

/** 在当前会话范围内按 key 查找已渲染的工具卡（返回响应式代理，可原地更新状态） */
function findToolByKey(key: string): (ChatMsg & { kind: 'tool' }) | undefined {
  const list = messages.value
  for (let i = list.length - 1; i >= sessionStart; i--) {
    const m = list[i]
    if (m.kind === 'tool' && m.key === key) return m
  }
  return undefined
}

const ready = computed(
  () => !!status.value?.nodeOk && !!status.value?.mcpRunning && !!status.value?.hasDeepseekKey
)
const statusText = computed(() => {
  const s = status.value
  if (!s) return t('studio.chat.checking')
  if (ready.value) return t('studio.chat.ready')
  return s.message ?? t('studio.chat.unavailable')
})
const statusWarn = computed(() => !!status.value && !ready.value)
/** dsh 工作区：当前打开的工程根目录（未打开工程时为空） */
const workspace = computed(() => status.value?.workspace?.trim() ?? '')
const workspaceLabel = computed(() => {
  const w = workspace.value
  if (!w) return ''
  const parts = w.split(/[\\/]/).filter((s) => s.length > 0)
  return parts[parts.length - 1] ?? w
})

function scrollToBottom(): void {
  void nextTick(() => {
    if (listRef.value) listRef.value.scrollTop = listRef.value.scrollHeight
  })
}

/** 消息流超出可视区且未贴底时显示「回到底部」箭头按钮 */
const showScrollToBottom = ref(false)

function onChatScroll(): void {
  const el = listRef.value
  if (!el) return
  showScrollToBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight > 48
}

function scrollToBottomSmooth(): void {
  listRef.value?.scrollTo({ top: listRef.value.scrollHeight, behavior: 'smooth' })
}

function pushAssistant(text: string, replace = false): void {
  const last = messages.value[messages.value.length - 1]
  if (!replace && last?.kind === 'assistant' && !last.final) {
    last.text += text
  } else if (replace && last?.kind === 'assistant') {
    // final 事件：把流式输出的同一条 assistant 覆盖为完整最终文本，避免重复显示
    last.text = text
    last.final = true
  } else {
    messages.value.push({
      kind: 'assistant',
      text,
      final: replace,
      ...(pendingReasoning ? { reasoning: pendingReasoning } : {})
    })
    pendingReasoning = ''
  }
  scrollToBottom()
}

/**
 * 显示一条瞬时状态。
 *
 * phase 由调用方按语义给出（或来自主进程事件里的 tone），**不解析文案**：
 * 文案随语言与上游措辞变化，靠关键字归类必然漂移（英文界面还会整片失效）。
 */
function pushStatus(text: string, phase: Exclude<ActivityPhase, 'idle'> = 'waiting'): void {
  if (!text) return
  // 相邻重复的整句直接忽略（错误除外：重复报错也值得让用户看见），避免同一条反复刷新计时
  if (text === activity.value && phase !== 'error') return

  // 相位只降不升：运行中出过的错不会被后续等待类文案盖掉，等它自然过期
  activityPhase.value = activityPhase.value === 'error' && phase !== 'error' ? 'error' : phase
  activity.value = text

  // 定时清除：状态只描述「此刻」，跑完/失败后不该永久占着顶部
  if (activityTimer !== null) window.clearTimeout(activityTimer)
  activityTimer = window.setTimeout(() => {
    activity.value = ''
    activityPhase.value = 'idle'
    activityTimer = null
  }, ACTIVITY_TTL_MS)
}

/** 重新拉取 harness 状态；失败时保留上一次状态，不影响会话本身 */
async function refreshStatus(): Promise<void> {
  try {
    status.value = await window.studio.getHarnessStatus()
    if (status.value?.running && !running.value && Date.now() >= abortIgnoreUntil) {
      running.value = true
    }
  } catch {
    // 状态刷新失败不影响会话本身：保留上一次状态
  }
}

function onHarnessEvent(event: HarnessEvent): void {
  if (ignoreHarnessEvents) return
  const inAbortCooldown = !running.value && !preparingTask && Date.now() < abortIgnoreUntil
  switch (event.type) {
    case 'assistant':
      if (inAbortCooldown) return
      if (!running.value) running.value = true
      pushAssistant(event.text)
      break
    case 'status':
      // 相位由主进程给出（见 HarnessEvent.tone），这里不解析文案
      pushStatus(event.text, event.tone ?? 'waiting')
      break
    case 'tool': {
      if (event.state === 'start' && inAbortCooldown) return
      if (event.state === 'start' && !running.value) running.value = true
      if (event.state === 'start') {
        notifyWeatherTaskPulse({
          preferLightning: /graph_|canvas_|node_|cook|gen|split|render/i.test(event.name)
        })
      }
      // dsh-agent 等 harness 工具卡：同一会话内按 key 去重（优先 callId 实例，无则按名字回退），
      // 状态变更时原地更新，不要保留一张"执行中"的同时再新增一张"完成"
      // 子代理的 callId 只在它自己的会话内唯一，挂上父卡片 id 才能与主代理的卡片区分
      const key = event.parentId
        ? `tool:${event.parentId}/${event.id ?? event.name}`
        : `tool:${event.id ?? event.name}`
      const prev = findToolByKey(key)
      if (prev) {
        prev.state = event.state
        // 摘要在 done 事件里可能缺省，仅在携带时覆盖，避免清掉 start 已记的详情
        if (event.detail !== undefined) prev.detail = event.detail
        if (event.steps?.length) prev.steps = event.steps
        // 详细参数只在 start 事件下发，保留不覆盖
        if (event.args !== undefined) prev.args = event.args
      } else {
        const fallbackSteps = event.steps?.length
          ? event.steps
          : extractMcpToolStepsFromArgs(event.name, event.args)
        messages.value.push({
          kind: 'tool',
          key,
          name: event.name,
          ...(event.id ? { id: event.id } : {}),
          ...(event.parentId ? { parentId: event.parentId } : {}),
          state: event.state,
          ...(event.detail !== undefined ? { detail: event.detail } : {}),
          ...(fallbackSteps.length ? { steps: fallbackSteps } : {}),
          ...(event.args !== undefined ? { args: event.args } : {})
        })
      }
      // 技能命中依据：skill 工具调用时在技能调试视图中标记「已加载」
      if (event.name === 'skill') markSkillLoaded(event.detail)
      if (event.state === 'done' && /skill_(install|uninstall)$/i.test(event.name)) {
        void refreshSessionSkills()
        void refreshInstalledWorkflows()
      }
      scrollToBottom()
      break
    }
    case 'reasoning':
      if (inAbortCooldown) return
      if (!running.value) running.value = true
      // 思考过程：先于回答到达，暂存到下一次 assistant 消息上
      pendingReasoning = event.text
      break
    case 'context':
      // provider 报告的精确输入上下文 token：多轮会话为最新一次 LLM 请求的完整输入
      harnessContextUsed.value = event.used
      // 顺手落盘：重启 / 切走再切回时环形进度条恢复这次的真实用量，而不是回退到偏小的本地估算
      scheduleHistoryPersist()
      break
    case 'todo':
      sessionTodos.value = event.todos ?? []
      scheduleHistoryPersist()
      break
    case 'goal':
      sessionGoal.value = event.goal
      if (event.goal?.phase === 'active') {
        goalDismissed.value = false
      }
      scheduleHistoryPersist()
      break
    case 'present': {
      const key = `present:${event.callId}`
      const existing = messages.value.find(
        (m): m is ChatMsg & { kind: 'present' } => m.kind === 'present' && m.key === key
      )
      if (existing) {
        existing.files = event.files
        existing.turn = event.turn
      } else {
        messages.value.push({
          kind: 'present',
          key,
          callId: event.callId,
          turn: event.turn,
          files: event.files
        })
      }
      scrollToBottom()
      scheduleHistoryPersist()
      break
    }
    case 'schedule':
      sessionSchedules.value = event.schedules ?? []
      break
    case 'steered':
      pushStatus(t('studio.chat.steeredStatus'), 'waiting')
      break
    case 'subagent':
      sessionSubagents.value = event.subagents ?? []
      if (
        sessionSubagents.value.some((s) => s.status === 'running') &&
        sessionSubagents.value.length === 1
      ) {
        subagentBoardOpen.value = true
      }
      break
    case 'canvas-event':
      latestCanvasEvent.value = event.event
      break
    case 'final': {
      // 流式期间文本已通过 assistant 事件实时显示，这里仅标记本轮回答完成，避免被末尾工具/交付卡错位覆盖
      let targetAssistant: (ChatMsg & { kind: 'assistant' }) | undefined
      for (let i = messages.value.length - 1; i >= sessionStart; i--) {
        const m = messages.value[i]
        if (m?.kind === 'user') break
        if (m?.kind === 'assistant') {
          targetAssistant = m
          break
        }
      }
      if (targetAssistant) {
        if (!targetAssistant.text && event.text) {
          targetAssistant.text = event.text
        }
        targetAssistant.final = true
      } else if (event.text) {
        pushAssistant(event.text, true)
      }
      break
    }
    case 'done':
      lastRoundOutcome.value = 'success'
      if (!preparingTask) running.value = false
      notifyWeatherTaskComplete('ai-chat')
      // 本轮结束：未决定的审批请求已随主进程丢弃，卡片标记失效（未放行）
      expirePendingApprovals()
      // 运行结束：采集本轮 git 变更（有改动才追加预览卡）
      void captureGitChanges()
      // 同时扫本轮直接落盘的产物（Output / Cache 下的媒体），逐条追加产物卡
      void captureRoundOutputs()
      // 同步刷新已安装技能清单（本轮对话可能安装了 GitHub 或市场技能）
      void refreshSessionSkills()
      void refreshInstalledWorkflows()
      break
    case 'error': {
      lastRoundOutcome.value = 'error'
      pushStatus(event.message, 'error')
      if (!preparingTask) running.value = false
      notifyWeatherTaskComplete('ai-chat')
      expirePendingApprovals()
      const errMsg = (event.message ?? '').trim()
      if (errMsg) {
        const agentCard = findToolByKey('tool:dsh-agent')
        if (agentCard && !agentCard.detail) {
          agentCard.detail = errMsg
          commitMessages([...messages.value])
          scheduleHistoryPersist()
        }
      }
      // 失败前可能已经有产物落盘：同样扫一遍，别让「跑到一半报错」这一轮彻底没有卡
      void captureRoundOutputs()
      break
    }
  }
}

/** 控制当前会话的自主目标状态（暂停 / 恢复 / 结束） */
async function onControlGoal(action: 'pause' | 'resume' | 'complete'): Promise<void> {
  if (typeof window.studio?.controlHarnessGoal === 'function') {
    await window.studio.controlHarnessGoal({ action }).catch(() => undefined)
  }
  if (sessionGoal.value) {
    if (action === 'pause') {
      sessionGoal.value = { ...sessionGoal.value, activation: 'paused' }
    } else if (action === 'resume') {
      sessionGoal.value = { ...sessionGoal.value, phase: 'active', activation: 'armed' }
    } else if (action === 'complete') {
      sessionGoal.value = { ...sessionGoal.value, phase: 'completed', activation: 'paused' }
    }
    scheduleHistoryPersist()
  }
}

/** 取消会话定时提醒 */
async function onCancelSchedule(scheduleId: string): Promise<void> {
  if (typeof window.studio?.deleteHarnessSchedule === 'function') {
    await window.studio.deleteHarnessSchedule({ scheduleId }).catch(() => undefined)
  }
  sessionSchedules.value = sessionSchedules.value.map((item) =>
    item.id === scheduleId ? { ...item, status: 'deleted' } : item
  )
}

/** 打开或定位 present 工具交付的文件 */
async function onOpenPresentFile(filePath: string, revealInFolder = false): Promise<void> {
  if (typeof window.studio?.openHarnessFile !== 'function') return
  await window.studio.openHarnessFile({ path: filePath, revealInFolder }).catch(() => undefined)
}

/** 导出当前会话为 dsh .zip 归档包 */
async function onExportCurrentSession(): Promise<void> {
  const sid = activeSession.value?.id
  if (!sid || exportBusy.value || typeof window.studio?.exportHarnessSession !== 'function') return
  exportBusy.value = true
  try {
    const res = await window.studio.exportHarnessSession({ sessionId: sid })
    if (res.canceled) return
    if (res.ok && res.path) {
      pushStatus(`${t('studio.chat.exportSuccess')}: ${res.path}`, 'waiting')
    } else {
      pushStatus(res.error ?? t('studio.chat.exportEmpty'), 'error')
    }
  } catch (err) {
    pushStatus(err instanceof Error ? err.message : String(err), 'error')
  } finally {
    exportBusy.value = false
  }
}

/**
 * 会话回退或分叉（Rewind / Fork）：
 * 计算该条用户消息属于第几个 user 轮次（keepTurns），
 * 调用主进程对底层 dsh .jsonl.zstd 会话日志做截断或克隆分叉，并同步前端消息流。
 */
async function onRewindAtMessage(msgIndex: number, fork: boolean): Promise<void> {
  const sid = activeSession.value?.id
  if (!sid || running.value) return
  let userTurnOrdinal = 0
  for (let i = 0; i <= msgIndex; i++) {
    if (messages.value[i]?.kind === 'user') userTurnOrdinal++
  }
  const keepTurns = Math.max(0, userTurnOrdinal - 1)
  const targetMsg = messages.value[msgIndex]
  const draftToRestore = targetMsg?.kind === 'user' ? targetMsg.text : ''

  if (!fork) {
    const ok = await promptConfirm({
      title: t('studio.chat.rewindTitle'),
      message: t('studio.chat.rewindConfirm'),
      confirmLabel: t('studio.chat.rewindTitle')
    })
    if (!ok) return
  }

  const slicedMessages = messages.value.slice(0, msgIndex)
  const targetSessionId = fork
    ? `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    : sid
  if (fork) {
    forkSession(targetSessionId, slicedMessages, ' (Fork)')
  }

  if (typeof window.studio?.rewindHarnessSession === 'function') {
    await window.studio
      .rewindHarnessSession({
        sessionId: sid,
        keepTurns,
        ...(fork ? { forkSessionId: targetSessionId } : {})
      })
      .catch(() => undefined)
  }

  if (fork) {
    loadActiveMessages()
    pushStatus(t('studio.chat.forkSuccess'), 'waiting')
  } else {
    messages.value = slicedMessages
    commitMessages([...messages.value])
    persistHistory()
    pushStatus(t('studio.chat.rewindSuccess'), 'waiting')
  }

  if (draftToRestore) {
    resetEditor()
    insertPlainText(draftToRestore)
  }
}

/** 跨会话全文检索（搜索本地前端会话 + 底层 dsh SQLite / .jsonl.zstd 归档） */
async function onRunSessionSearch(): Promise<void> {
  const q = searchQuery.value.trim()
  if (!q) {
    searchHits.value = []
    return
  }
  searchBusy.value = true
  try {
    const hits: HarnessSessionSearchHit[] = []
    const seen = new Set<string>()
    const lower = q.toLowerCase()
    for (const s of sessions.value) {
      for (const m of s.messages) {
        if ((m.kind === 'user' || m.kind === 'assistant') && m.text.toLowerCase().includes(lower)) {
          const idx = m.text.toLowerCase().indexOf(lower)
          const start = Math.max(0, idx - 30)
          const snippet = m.text.slice(start, idx + q.length + 60).replace(/\s+/g, ' ')
          hits.push({
            sessionId: s.id,
            title: s.title || t('studio.chat.newChat'),
            snippet,
            updatedAt: new Date(s.updatedAt).toISOString()
          })
          seen.add(s.id)
          break
        }
      }
    }
    if (typeof window.studio?.searchHarnessSessions === 'function') {
      const remote = await window.studio.searchHarnessSessions({ query: q, limit: 20 })
      for (const h of remote.hits ?? []) {
        if (seen.has(h.sessionId)) continue
        const localMatch = sessions.value.find((s) => s.id === h.sessionId)
        if (!localMatch) continue
        hits.push({
          ...h,
          title: localMatch.title || h.title || h.sessionId.slice(0, 8)
        })
        seen.add(h.sessionId)
      }
    }
    searchHits.value = hits
  } catch {
    searchHits.value = []
  } finally {
    searchBusy.value = false
  }
}

function onSelectSearchHit(hit: HarnessSessionSearchHit): void {
  searchModalOpen.value = false
  if (sessions.value.some((s) => s.id === hit.sessionId)) {
    onSessionChange(hit.sessionId)
  }
}

/**
 * Git 变更预览：只读拉取工程当前变更（vs HEAD），在对话中展示「这一轮 agent 改了什么」。
 * 基线指纹在发送前建立，运行结束时只筛出真正有变化的文件，因此每一轮最多出一张卡。
 */
let gitBaseline = new Map<string, string>()
/** 采集互斥：done 回调与卡片「刷新」可能同时触发 */
let gitChangesBusy = false
/** 工程不可预览时的原因只说明一次，避免每轮都刷提示 */
let gitUnavailableNotified = false

const currentProjectChatScope = computed(() =>
  resolveProjectChatScope(project.config?.id, project.rootPath)
)

// 切换 / 新建 / 关闭工程后：
// 1. 先将旧工程的当前会话状态落盘到旧工程作用域；
// 2. 切换会话作用域到新工程（新建工程因具有全新 config.id，自动初始化为空白新会话，绝不带入其它工程的 AI 会话）；
// 3. 重置 Git 基线、引用资产与排队队列，并刷新工程级技能。
watch(currentProjectChatScope, (nextScope, prevScope) => {
  if (nextScope === prevScope) return
  gitBaseline = new Map()
  gitUnavailableNotified = false
  commitMessages([...messages.value])
  commitContextUsed(harnessContextUsed.value)
  commitTodos([...sessionTodos.value])
  commitGoal(sessionGoal.value)
  persistHistory()
  if (running.value) {
    void window.studio?.abortHarnessTask?.()
    running.value = false
  }
  clearSendQueue()
  referenced.value = []
  resetEditor()
  composing.value = false
  sessionOpen.value = false
  searchModalOpen.value = false
  searchHits.value = []
  todoBoardOpen.value = false
  subagentBoardOpen.value = false
  scheduleMenuOpen.value = false
  loadHistory(nextScope)
  loadActiveMessages()
  void nextTick(() => retryUnresolvedChatImages())
  void refreshSessionSkills()
  void refreshInstalledWorkflows()
  void refreshStatus()
})

watch([() => project.sessionEpoch, () => project.rootPath, () => project.assets.length], () => {
  void nextTick(() => retryUnresolvedChatImages())
})

/** 发送前静默记录基线（不插卡）；失败时退化为「下次采集视为首轮」 */
async function resetGitBaseline(): Promise<void> {
  try {
    const status = await window.studio.getGitStatus()
    gitBaseline = status.isRepo ? fingerprintMap(status.files) : new Map()
  } catch {
    gitBaseline = new Map()
  }
}

/** 运行结束：采集本轮变更，确有改动才插入预览卡（无改动不打扰） */
async function captureGitChanges(): Promise<void> {
  if (gitChangesBusy) return
  gitChangesBusy = true
  try {
    const status = await window.studio.getGitStatus()
    if (!status.isRepo) {
      // 不可预览（未装 git / 非仓库）时说明一次原因，否则用户会以为功能没生效
      if (!gitUnavailableNotified && status.reason !== 'no-project') {
        gitUnavailableNotified = true
        pushStatus(
          t(
            status.reason === 'no-git'
              ? 'studio.chat.gitChangesNoGit'
              : 'studio.chat.gitChangesNotRepo'
          ),
          'warn'
        )
      }
      return
    }
    const changed = selectChangedFiles(gitBaseline, status.files)
    gitBaseline = fingerprintMap(status.files)
    if (!changed.length) return
    messages.value.push({
      kind: 'changes',
      key: `changes:${Date.now()}`,
      files: changed,
      at: Date.now(),
      ...(status.branch ? { branch: status.branch } : {})
    })
    scrollToBottom()
    commitMessages([...messages.value])
    persistHistory()
  } catch {
    // 预览是旁路能力：读不到就跳过，不打断会话
  } finally {
    gitChangesBusy = false
  }
}

/** 卡片「刷新」：重采当前变更并原地更新该卡（无新变化时只刷新时间戳） */
async function refreshGitChanges(target: Extract<ChatMsg, { kind: 'changes' }>): Promise<void> {
  if (gitChangesBusy) return
  gitChangesBusy = true
  try {
    const status = await window.studio.getGitStatus()
    if (!status.isRepo) return
    const changed = selectChangedFiles(gitBaseline, status.files)
    gitBaseline = fingerprintMap(status.files)
    if (changed.length) {
      const merged = new Map(target.files.map((file) => [file.path, file]))
      for (const file of changed) merged.set(file.path, file)
      target.files = [...merged.values()]
    }
    target.at = Date.now()
    commitMessages([...messages.value])
    persistHistory()
  } catch {
    // 同上：失败静默，保留原有快照
  } finally {
    gitChangesBusy = false
  }
}

/** 已在对话里出过产物卡的路径：产物卡（含卡内折叠的同批次产物）与工具卡（旧数据的卡内预览）都算，同一文件不重复出卡 */
function shownOutputPaths(): Set<string> {
  const shown = new Set<string>()
  const add = (relativePath: string): void => {
    const key = normalizeOutputPathKey(relativePath)
    if (key) shown.add(key)
  }
  for (const msg of messages.value) {
    if (msg.kind === 'asset') {
      add(msg.relativePath)
      for (const related of msg.relatedPaths ?? []) add(related)
    } else if (msg.kind === 'game') {
      add(msg.htmlPath)
    } else if (msg.kind === 'tool' && msg.relativePath) {
      add(msg.relativePath)
    }
  }
  return shown
}

let roundOutputBusy = false
/**
 * 运行结束：扫描本轮直接落盘到 `Output/` 与 `Cache/` 的产物，按批次追加产物卡。
 * 补的是 **不经 MCP 活动** 的那部分产出（脚本写出的 SVG / 帧序列等）——它们此前
 * 只进工程目录、对话里一张卡都没有；已由活动卡展示过的路径跳过，超出上限只提示数量。
 *
 * 同一次跑动常在几十毫秒内连出多份文件（矢量源 / 烘焙位图 / 帧序列，再叠上节点参数
 * 预览的物化副本），逐文件出卡会在对话流里连排多张几乎相同的图——因此按批次聚合成
 * 一张卡（`groupRoundOutputs`），卡内以「含 N 个产物」角标展开成员。
 */
async function captureRoundOutputs(): Promise<void> {
  if (roundOutputBusy || !roundStartAt || !project.isOpen) return
  if (typeof window.studio?.scanProjectOutputs !== 'function') return
  roundOutputBusy = true
  try {
    const { files } = await window.studio.scanProjectOutputs({ sinceMs: roundStartAt })
    if (!files.length) return
    const { picked, hidden: overflow } = selectRoundOutputs(files, {
      sinceMs: roundStartAt,
      exclude: shownOutputPaths(),
      limit: MAX_ROUND_OUTPUT_FILES
    })
    const { cards, hidden: folded } = groupRoundOutputs(picked)
    if (!cards.length) return
    const stamp = Date.now()
    for (let index = 0; index < cards.length; index++) {
      const card = cards[index]!
      await pushAsset(
        `asset:scan:${stamp}:${index}`,
        card.primary.relativePath,
        card.related.map((file) => file.relativePath)
      )
    }
    const hidden = overflow + folded
    if (hidden > 0) pushStatus(t('studio.chat.roundOutputsMore', { count: hidden }), 'warn')
  } catch {
    // 扫盘是旁路能力：读不到就跳过，不打断会话
  } finally {
    roundOutputBusy = false
  }
}

/** 活动产出的媒体相对路径：多产物清单优先，单产物字段保持兼容；按顺序去重 */
function activityMediaPaths(activity: McpActivity): string[] {
  const paths = [activity.relativePath, ...(activity.relativePaths ?? [])]
  const seen = new Set<string>()
  const result: string[] = []
  for (const path of paths) {
    const value = path?.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

/** 工具调用卡：dsh 通过 MCP 触发的生成活动，会话期间实时呈现 */
function onMcpActivity(activity: McpActivity): void {
  const state =
    activity.status === 'done' ? 'done' : activity.status === 'error' ? 'error' : 'start'
  const key = `mcp:${activity.id}`
  const prev = findToolByKey(key)
  const mediaPaths = state === 'done' || state === 'start' ? activityMediaPaths(activity) : []
  if (prev) {
    // 已有卡时无条件更新状态，即使任务已结束也可能收到延迟的 done/error 回调
    prev.state = state
    prev.detail = activity.error
    // 完成或运行中阶段产出了资产：把落盘相对路径记到卡上（新数据由对话末尾的独立预览卡展示）
    if (mediaPaths.length) prev.relativePath = mediaPaths[0]
  } else if (running.value) {
    // 只有任务仍在运行时才新增 MCP 活动卡，避免结束时再产生孤立的工具卡
    messages.value.push({
      kind: 'tool',
      key,
      name: activity.title || activity.tool,
      state,
      detail: activity.error,
      ...(mediaPaths.length ? { relativePath: mediaPaths[0] } : {})
    })
    scrollToBottom()
  }
  if (activity.tool === 'skill_install' || activity.tool === 'skill_uninstall') {
    if (state === 'done') {
      void refreshSessionSkills()
      void refreshInstalledWorkflows()
    }
    return
  }
  // 可玩 HTML：产物是单文件游戏，出的是一张「只有一个试玩按钮」的游戏卡，
  // 不走通用资产卡（那张卡带保存到资产库与同批次折叠，与约定冲突）
  if (activity.tool === 'gameplay_build') {
    if (state === 'done' && mediaPaths.length) {
      upsertGameCard(activity, mediaPaths[0]!)
    }
    return
  }
  // 一句话生成游戏：节点图已建好（未必已运行），出一张带「打开画布 / 运行 / 试玩 / 自动运行」的游戏卡
  if (activity.tool === 'game_one_sentence_create') {
    if (state === 'done' && activity.oneSentenceGame) {
      upsertOneSentenceGameCard(activity.oneSentenceGame)
    }
    return
  }
  // 生成完成且产出了资产：在对话末尾追加独立预览卡（图片/视频/音频/3D），
  // 仅在任务卡存在或任务仍运行时插入，避免产生孤立的预览卡；
  // 一次运行产出多件（如绘本逐页生图 + 最终合成视频）时按稳定路径 key 逐条出卡
  if (mediaPaths.length && (prev || running.value)) {
    // 与主产物同批的**附件**（世界随包返回的泼溅 / 全景）折叠进第一张卡，
    // 它们不是独立作品，逐条出卡会把「一次生成」拆成三张几乎相同的卡
    const attachments = (activity.relatedPaths ?? []).filter((path) => !!path?.trim())
    mediaPaths.forEach((path, index) => {
      const pathKey = normalizeOutputPathKey(path) || String(index)
      void pushAsset(
        index === 0 ? `asset:${activity.id}` : `asset:${activity.id}:${pathKey}`,
        path,
        index === 0 ? attachments : []
      )
    })
  }
}

/**
 * 游戏卡按 `assetId`（cook 成功时自动登记的 gamePlay 资产）原地更新：
 * 对话里「再暗一点」会反复 build，每个活动 id 都新出一张卡会把对话刷成一列重复卡。
 */
function upsertGameCard(activity: McpActivity, htmlPath: string): void {
  const key = `game:${activity.assetId || activity.id}`
  const title = activity.title || t('studio.chat.gamePlay.play')
  const prev = messages.value.find(
    (m): m is ChatMsg & { kind: 'game' } => m.kind === 'game' && m.key === key
  )
  if (prev) {
    prev.title = title
    prev.htmlPath = htmlPath
    return
  }
  messages.value.push({ kind: 'game', key, title, htmlPath })
  scrollToBottom()
}

/** 一句话游戏卡按资产 id 原地更新（同一张图重复创建只保留一张卡） */
function upsertOneSentenceGameCard(info: OneSentenceGameCardInfo): void {
  const key = `osgame:${info.assetId}`
  const prev = messages.value.find(
    (m): m is ChatMsg & { kind: 'oneSentenceGame' } => m.kind === 'oneSentenceGame' && m.key === key
  )
  if (prev) {
    prev.info = { ...info, scopeNotes: [...info.scopeNotes] }
    return
  }
  messages.value.push({
    kind: 'oneSentenceGame',
    key,
    info: { ...info, scopeNotes: [...info.scopeNotes] }
  })
  scrollToBottom()
}

/**
 * 游戏卡唯一的动作：交给系统默认程序（通常是浏览器）打开单文件游戏。
 *
 * 为什么不默认走应用内沙盒窗口：沙盒 iframe 没给 `allow-fullscreen`，指针锁定 / 音频设备
 * 也受限，重型 rAF 循环还会跑在应用渲染进程里；cook 出来的单文件本来就是自包含的
 * （IIFE 内联 + three 打包 + Canvas 贴图 + WebAudio 合成），浏览器里体验更好。
 *
 * 但 `file://` 对 `type="module"` 与相对引用会直接白屏（这两类在应用内沙盒里反而正常），
 * 所以开之前先自检；不可开或调起失败就退回应用内窗口，并把原因说清楚。
 */
function openHtmlSandbox(htmlPath: string, title?: string): void {
  openGamePlaySandboxDialog({ htmlPath, title: title || assetFileName(htmlPath) })
}

async function openHtmlInBrowser(htmlPath: string, title?: string): Promise<void> {
  await playGame({ htmlPath, title: title || assetFileName(htmlPath) })
}

async function playGame(
  msg: Pick<ChatMsg & { kind: 'game' }, 'htmlPath' | 'title'>
): Promise<void> {
  const fallback = (reasonKey?: string): void => {
    openGamePlaySandboxDialog({ htmlPath: msg.htmlPath, title: msg.title })
    if (reasonKey) pushStatus(t(reasonKey), 'warn')
  }
  let html = ''
  try {
    html = await readGraphRunText(msg.htmlPath)
  } catch {
    html = ''
  }
  const issue = gameHtmlBrowserIssue(html)
  if (issue) {
    fallback(
      issue === 'module-script'
        ? 'studio.chat.gamePlay.fallbackModule'
        : 'studio.chat.gamePlay.fallbackRelative'
    )
    return
  }
  try {
    await window.studio.openAssetWithDefaultApp(msg.htmlPath)
  } catch {
    fallback('studio.chat.gamePlay.openFailed')
  }
}

let pushAssetQueue: Promise<void> = Promise.resolve()

/** 生成完成的独立资产预览卡：同 key 去重，追加到对话末尾（原地更新路径以幂等处理延迟回调）。
 *  同时按文件内容指纹兜底——MCP `generate_*` 已一律落 Cache、不入资产库，但 agent 仍
 *  能通过 `asset_import` / 手工拷到 Assets/ 等方式把同一份媒体再次带进聊天流；
 *  指纹命中已有卡时新卡不再出，避免同一张图在对话里出现两次。
 *  通过队列串行化执行，防止多张卡并发 await 指纹计算时双方都尚未写入 messages 而漏掉去重。 */
function pushAsset(key: string, relativePath: string, relatedPaths: string[] = []): Promise<void> {
  const run = async (): Promise<void> => {
    const prev = messages.value.find(
      (m): m is ChatMsg & { kind: 'asset' } => m.kind === 'asset' && m.key === key
    )
    if (prev) {
      prev.relativePath = relativePath
      if (relatedPaths.length) prev.relatedPaths = relatedPaths
      else delete prev.relatedPaths
      scheduleHistoryPersist()
      return
    }
    let isDuplicate = false
    try {
      isDuplicate = await isDuplicateChatAsset(relativePath, key)
    } catch (err) {
      // 去重 IO 失败一律放行，避免吞掉合法资产卡
      console.warn('[ChatPanel] pushAsset dedup check failed', err)
    }
    if (isDuplicate) return
    messages.value.push({
      kind: 'asset',
      key,
      relativePath,
      ...(relatedPaths.length ? { relatedPaths } : {})
    })
    scrollToBottom()
    scheduleHistoryPersist()
  }
  const next = pushAssetQueue.then(run, run)
  pushAssetQueue = next
  return next
}

/** 内容指纹去重：同份文件若已在聊天流里被别的资产卡展示过则返回 true。
 *  只回看近 20 张卡（老历史一般不是重复源），指纹走 `getChatAssetFingerprint`
 *  内部缓存，重复路径不重复 IO。 */
async function isDuplicateChatAsset(relativePath: string, excludeKey: string): Promise<boolean> {
  const targetKey = normalizeOutputPathKey(relativePath)
  if (!targetKey) return false
  const recent = messages.value
    .filter((m): m is ChatMsg & { kind: 'asset' } => m.kind === 'asset' && m.key !== excludeKey)
    .slice(-20)
  for (const m of recent) {
    if (normalizeOutputPathKey(m.relativePath) === targetKey) return true
    if ((m.relatedPaths ?? []).some((p) => normalizeOutputPathKey(p) === targetKey)) return true
  }
  const targetFp = await getChatAssetFingerprint(relativePath)
  if (!targetFp) return false
  for (const m of recent) {
    const existFp = await getChatAssetFingerprint(m.relativePath)
    if (existFp && existFp === targetFp) return true
  }
  return false
}

/** 已展开成员清单的产物卡 key：同批次产物默认折叠，避免又变成一列几乎相同的图 */
const expandedAssetGroups = ref<Set<string>>(new Set())

function isAssetGroupOpen(key: string): boolean {
  return expandedAssetGroups.value.has(key)
}

/** 卡内产物总数：代表产物自己 + 折叠的同批次产物 */
function assetGroupCount(msg: ChatMsg & { kind: 'asset' }): number {
  return (msg.relatedPaths?.length ?? 0) + 1
}

function toggleAssetGroup(key: string): void {
  const next = new Set(expandedAssetGroups.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedAssetGroups.value = next
}

/** 卡内成员按文件名展示（含扩展名）：区分同一批次里的矢量源 / 位图 / 帧序列 */
function assetFileName(relativePath: string): string {
  return normalizeOutputPathKey(relativePath).split('/').pop() || relativePath
}

/** 是否已存在与任务卡 key（`mcp:<id>`）对应的独立资产卡（`asset:<id>`）：旧会话数据无独立卡时任务清单内回退展示预览 */
function hasAssetCard(toolKey: string): boolean {
  const assetKey = toolKey.startsWith('mcp:') ? `asset:${toolKey.slice('mcp:'.length)}` : ''
  if (!assetKey) return false
  return messages.value.some(
    (m) => m.kind === 'asset' && (m.key === assetKey || m.key.startsWith(`${assetKey}:`))
  )
}

/** 生成产物默认落 Cache/ 不进资产库：资产卡提供「保存到资产库」入口（弹窗选目录/文件名） */
const saveDialogOpen = ref(false)
const saveDialogDefaultName = ref('')
const saveDialogDefaultFolderId = ref<string | null>(null)
const saveDialogRef = ref<{
  setSaving: (v: boolean) => void
  setError: (m: string) => void
  setSourceMissing: (relativePath: string | null) => void
} | null>(null)
const savingAssetPath = ref('')
/** 本次会话已成功保存到资产库的产物路径：一张卡里折叠的每份产物各自判定「已保存」并禁用 */
const savedAssetPaths = ref<Set<string>>(new Set())
/**
 * 已保存源路径 → 资产 id：用户在资产库面板 / MCP 把对应资产删除时，主进程会
 * 广播 `ASSET_REMOVED { id, path }`，订阅回调由此反查把源路径从 savedAssetPaths
 * 里摘掉，让「已保存」标记正确回退为可再次点击保存。
 */
const savedAssetIdsByPath = new Map<string, string>()
let pendingSavePath = ''

function isAssetSaved(relativePath: string): boolean {
  return savedAssetPaths.value.has(normalizeOutputPathKey(relativePath))
}

/** 资产卡默认名称：取文件名 stem（去扩展名） */
function assetDefaultName(relativePath: string): string {
  return (
    relativePath
      .split('/')
      .pop()
      ?.replace(/\.[^.]+$/, '') || 'asset'
  )
}

/**
 * 路径是否已落在资产库目录（Assets/）内：`asset_import` 等活动回报的是已入库资产，
 * 卡上不该再出现「保存到资产库」按钮（点了会把已入库文件再复制一份重复资产）。
 */
function isLibraryRelativePath(relativePath: string): boolean {
  const normalized = relativePath?.replace(/\\/g, '/').replace(/^\.\//, '').trim() ?? ''
  return /^assets\//i.test(normalized)
}

function openSaveAsset(relativePath: string): void {
  const path = normalizeOutputPathKey(relativePath)
  if (!path || isAssetSaved(path)) return
  pendingSavePath = path
  saveDialogDefaultName.value = assetDefaultName(path)
  saveDialogDefaultFolderId.value = null
  saveDialogOpen.value = true
  // 打开对话框的瞬间异步 stat：Cache 被清理 / 路径越界时直接禁用确认按钮，
  // 避免用户填好名字再点保存才发现 fs.fileNotFound。后续每次点保存会再 stat 一次（onSaveAssetConfirm）。
  void window.studio
    .projectFileExists(path)
    .then((exists) => {
      if (pendingSavePath !== path) return
      saveDialogRef.value?.setSourceMissing(exists ? null : path)
    })
    .catch(() => {
      if (pendingSavePath !== path) return
      saveDialogRef.value?.setSourceMissing(null)
    })
}

function closeSaveAssetDialog(): void {
  if (savingAssetPath.value) return
  saveDialogOpen.value = false
}

/** 弹窗确认：把 Cache 产物复制到资产库目标文件夹并登记，成功后刷新资产浏览器 */
async function onSaveAssetConfirm(payload: {
  name: string
  folderId: string | null
}): Promise<void> {
  const path = pendingSavePath
  if (!path || savingAssetPath.value) return
  savingAssetPath.value = path
  saveDialogRef.value?.setSaving(true)
  try {
    // 二次 stat：对话框从打开到用户点确认可能跨分钟；期间 Cache 被清理会让主进程抛 fs.fileNotFound。
    const exists = await window.studio.projectFileExists(path)
    if (!exists) {
      saveDialogRef.value?.setError(
        t('dialog.saveAsset.sourceMissing', { name: path.split('/').pop() || path })
      )
      saveDialogRef.value?.setSourceMissing(path)
      return
    }
    const savedAsset = await window.studio.saveProjectAsset({
      relativePath: path,
      name: payload.name,
      folderId: payload.folderId
    })
    savedAssetPaths.value.add(path)
    // 记录 id↔源路径映射：主进程 ASSET_REMOVED 事件来时按 id 反查回退「已保存」标记
    if (savedAsset?.id) savedAssetIdsByPath.set(path, savedAsset.id)
    saveDialogOpen.value = false
    // 资产库同步刷新：新资产在资产浏览器中立即可见
    await project.scheduleRefreshLibrary()
  } catch (err) {
    saveDialogRef.value?.setError(err instanceof Error ? err.message : String(err))
  } finally {
    savingAssetPath.value = ''
  }
}

let stopAskUser: (() => void) | null = null
let stopApproval: (() => void) | null = null

/**
 * 主进程 ASSET_REMOVED 载荷 `{ id, path }` 到达时，把对应的「已保存」标记回退。
 * 反查按 id 优先（id 稳定，不会因路径归一化口径变化而漏命中）；
 * 按 path 命中是兜底（极端情况：刚保存完还没拉到 id 就被删除）。
 */
function onAssetRemoved(payload: { id: string; path: string }): void {
  let matchedSourcePath: string | undefined
  for (const [sourcePath, assetId] of savedAssetIdsByPath) {
    if (assetId === payload.id) {
      matchedSourcePath = sourcePath
      break
    }
  }
  // 兜底：用资产的目标路径命中（多张卡映射到同一个资产时也一并摘掉）
  if (!matchedSourcePath && payload.path) {
    const normalizedTarget = payload.path.replace(/\\/g, '/').replace(/^\.\//, '').trim()
    for (const sourcePath of [...savedAssetIdsByPath.keys()]) {
      const sourceBase = sourcePath.split('/').pop()
      const targetBase = normalizedTarget.split('/').pop()
      if (sourceBase && sourceBase === targetBase) {
        matchedSourcePath = sourcePath
        // 不 break：删一个资产可能同时清掉多张缓存卡的 id 映射
      }
    }
  }
  if (!matchedSourcePath) return
  savedAssetPaths.value.delete(matchedSourcePath)
  savedAssetIdsByPath.delete(matchedSourcePath)
}

/** agent 通过 ask_user 工具发起提问：在消息流中插入一条「问题 + 选项按钮」卡 */
function handleAskUser(question: AskUserQuestion): void {
  if (messages.value.some((m) => m.kind === 'prompt' && m.requestId === question.requestId)) return
  messages.value.push({
    kind: 'prompt',
    requestId: question.requestId,
    question: question.question,
    ...(question.options && question.options.length ? { options: question.options } : {}),
    ...(question.hint ? { hint: question.hint } : {}),
    answered: null
  })
  scrollToBottom()
}

/** prompt 卡的候选选项：缺省时提供默认按钮（继续 / 取消） */
function promptOptions(msg: ChatMsg & { kind: 'prompt' }): string[] {
  return msg.options?.length
    ? msg.options
    : [t('studio.chat.promptContinue'), t('studio.chat.promptCancel')]
}

/** 用户点击选项：回传选择给主进程（MCP ask_user 工具继续），并锁定按钮 */
async function answerPrompt(
  msg: ChatMsg & { kind: 'prompt' },
  option: string,
  fromCustom = false
): Promise<void> {
  if (msg.answered !== null && msg.answered !== undefined) return
  msg.answered = option
  try {
    await window.studio.answerAskUser({
      requestId: msg.requestId,
      answer: option,
      ...(fromCustom ? { fromCustom: true } : {})
    })
  } catch {
    // 主进程侧已超时 / 会话已结束：按钮已锁定，无副作用
  }
}

/**
 * 自定义回答：模型给的选项不一定覆盖用户的意图（它只有 2–6 条），所以输入框始终可用。
 *
 * 与点选项**走同一个回传函数**，因此「未答才回传」的守卫、锁定与已答展示都一致 ——
 * 另写一条路径就会分叉出「输入框能重复提交而按钮不能」这类差别。
 * `fromCustom` 只影响主进程判断「是否取消」的口径（见 `AskUserAnswer.fromCustom`）。
 */
async function submitPromptDraft(msg: ChatMsg & { kind: 'prompt' }): Promise<void> {
  const text = (msg.draft ?? '').trim()
  if (!text) return
  await answerPrompt(msg, text, true)
}

/**
 * dsh 请求越过沙箱边界（沙箱升级）：在消息流里插一条同意卡。
 *
 * 卡片**只提供「允许一次 / 拒绝」**，没有「总是允许」：dsh 的审批是一次性授权，
 * 持久化会静默放宽 agent 之后能跑的东西，而用户以为自己只同意过一次。
 */
function handleApprovalRequest(request: ApprovalRequestView): void {
  if (messages.value.some((m) => m.kind === 'approval' && m.requestId === request.requestId)) return
  messages.value.push({
    kind: 'approval',
    requestId: request.requestId,
    toolName: request.toolName,
    // 原因优先用 displayReason（上游若给出更贴近用户的表述），否则用 reason
    ...(request.displayReason || request.reason
      ? { reason: request.displayReason || request.reason }
      : {}),
    decision: null
  })
  scrollToBottom()
}

/**
 * 用户点击「允许一次 / 拒绝」：回传决定给主进程（写进回答文件，dsh 侧据此放行或拒绝）。
 *
 * 先锁按钮再回传，且**回传失败也保持已决定**：主进程会按拒绝兜底（`answerApproval`
 * 返回 false 表示这条请求已作废），卡片不该因为一次失败就重新变成可点的「允许」。
 */
async function answerApprovalRequest(
  msg: ChatMsg & { kind: 'approval' },
  decision: 'allow-once' | 'reject'
): Promise<void> {
  if (msg.decision !== null && msg.decision !== undefined) return
  msg.decision = decision
  try {
    await window.studio.answerApproval({ requestId: msg.requestId, decision })
  } catch {
    // 主进程不可达：请求随本轮一起失效，未放行
  }
}

/** 本轮结束时把未决定的审批卡标记为失效（主进程已丢弃对应请求，点也没用） */
function expirePendingApprovals(): void {
  for (const msg of messages.value) {
    // 保持 decision 为 null：用户**没有**决定过，界面不该显示「已拒绝」
    if (msg.kind === 'approval' && (msg.decision === null || msg.decision === undefined)) {
      msg.expired = true
    }
  }
}

/**
 * 采集当前左侧窗口打开的画布、Dive 面包屑栈、3D 导演台、分镜台、时间线、节点工具及工程内画布资产的完整上下文摘要。
 * 仅随 HarnessRunInput.canvasContext 下发给主进程 Agent，不污染用户的聊天输入气泡。
 */
function buildActiveCanvasContext(): string | undefined {
  return buildActiveWorkspaceContext()
}

/**
 * 对话发送前的在线技能预处理器：
 * 1. 当用户在对话中给出 GitHub 技能 URL 时，直接通过 `window.studio.inspectGitHubSkills` + `installGitHubSkills`
 *    完成宿主侧安装（不受沙箱限制），立即刷新已安装技能列表并在消息流插入 `skill_install` 完成卡，
 *    同时把发送给 harness 的任务改写为 `/<skill-name> ...`，由主进程 `preprocessSkillInvocation` 直接展开 `SKILL.md`。
 * 2. 当用户要求联网搜索并安装某类技能时，自动检索匹配的官方/市场技能并完成预安装与激活。
 */
async function preprocessChatOnlineSkillIntent(rawTask: string): Promise<string> {
  if (mode.value === 'ask') return rawTask
  if (rawTask.trim().startsWith('/')) return rawTask

  const intent = detectChatSkillInstallOrSearchIntent(rawTask)

  if (intent.githubUrls.length > 0 && intent.mentionsSkillOrInstall && mode.value === 'craft') {
    let primarySkillName = ''
    let primarySourceTag = ''
    for (const url of intent.githubUrls) {
      const callId = `chat-skill-install:${Date.now()}`
      onHarnessEvent({
        type: 'tool',
        id: callId,
        name: 'skill_install',
        state: 'start',
        detail: `Installing GitHub skill from ${url}`
      })
      try {
        const inspected = await window.studio.inspectGitHubSkills({ url })
        const candidates = inspected.skills ?? []
        if (!inspected.ok || !candidates.length) {
          onHarnessEvent({
            type: 'tool',
            id: callId,
            name: 'skill_install',
            state: 'error',
            detail: inspected.error ?? `No SKILL.md found at ${url}`
          })
          continue
        }
        const skillNames = candidates.map((c) => c.name)
        const installedRes = await window.studio.installGitHubSkills({
          url,
          skillNames,
          skillScriptsConsent: false
        })
        if (!installedRes.ok || !installedRes.installed.length) {
          onHarnessEvent({
            type: 'tool',
            id: callId,
            name: 'skill_install',
            state: 'error',
            detail: installedRes.error ?? `Failed to install skill from ${url}`
          })
          continue
        }
        await refreshSessionSkills()
        for (const sName of installedRes.installed) {
          markSkillLoaded(sName)
        }
        const srcTag = inspected.source
          ? `${inspected.source.owner}/${inspected.source.repo}@${inspected.source.resolvedRef}`
          : url
        if (!primarySkillName && installedRes.installed[0]) {
          primarySkillName = installedRes.installed[0]
          primarySourceTag = srcTag
        }
        onHarnessEvent({
          type: 'tool',
          id: callId,
          name: 'skill_install',
          state: 'done',
          detail: `${installedRes.installed.map((s) => `/${s}`).join(', ')} (${srcTag})`
        })
      } catch (err) {
        onHarnessEvent({
          type: 'tool',
          id: callId,
          name: 'skill_install',
          state: 'error',
          detail: err instanceof Error ? err.message : String(err)
        })
      }
    }
    commitMessages([...messages.value])
    persistHistory()
    if (primarySkillName) {
      return `/${primarySkillName} [System Note: The requested GitHub skill /${primarySkillName} (${primarySourceTag}) has ALREADY been downloaded and installed to $DSH_HOME/skills/${primarySkillName}/SKILL.md by the host application, and its full SKILL.md instructions are active above. NEVER use web_fetch, pwsh, write, or edit to re-download or write SKILL.md into $DSH_HOME/skills. Confirm to the user that /${primarySkillName} is installed and ready, then fulfill the user's request below:] ${rawTask}`
    }
  }

  if (intent.isOnlineSearchIntent && intent.matchedCurated.length > 0) {
    const searchCallId = `chat-skill-search:${Date.now()}`
    onHarnessEvent({
      type: 'tool',
      id: searchCallId,
      name: 'skill_search',
      state: 'done',
      detail: intent.matchedCurated.map((c) => `${c.name} (${c.url})`).join(', ')
    })
    if (intent.wantsInstall && mode.value === 'craft') {
      const top = intent.matchedCurated[0]
      const installCallId = `chat-skill-install:${Date.now()}`
      onHarnessEvent({
        type: 'tool',
        id: installCallId,
        name: 'skill_install',
        state: 'start',
        detail: `Installing /${top.name} from ${top.url}`
      })
      try {
        const inspected = await window.studio.inspectGitHubSkills({ url: top.url })
        const candidates = inspected.skills ?? []
        const res = await window.studio.installGitHubSkills({
          url: top.url,
          skillNames: candidates.length ? candidates.map((c) => c.name) : [top.name],
          skillScriptsConsent: false
        })
        if (res.ok && res.installed.length > 0) {
          await refreshSessionSkills()
          for (const sName of res.installed) markSkillLoaded(sName)
          const srcTag = inspected.source
            ? `${inspected.source.owner}/${inspected.source.repo}@${inspected.source.resolvedRef}`
            : top.url
          onHarnessEvent({
            type: 'tool',
            id: installCallId,
            name: 'skill_install',
            state: 'done',
            detail: `/${top.name} (${srcTag})`
          })
          commitMessages([...messages.value])
          persistHistory()
          return `/${top.name} [System Note: Online skill search matched and installed /${top.name} (${top.url}) into $DSH_HOME/skills/${top.name}/SKILL.md, and its full SKILL.md instructions are active above. NEVER use web_fetch, pwsh, write, or edit to write into $DSH_HOME/skills. Confirm to the user that /${top.name} is installed and fulfill their request below:] ${rawTask}`
        }
      } catch (err) {
        onHarnessEvent({
          type: 'tool',
          id: installCallId,
          name: 'skill_install',
          state: 'error',
          detail: err instanceof Error ? err.message : String(err)
        })
      }
    }
  }

  return rawTask
}

/**
 * 真正起一轮：把 task 作为用户消息落盘并交给 harness。
 * 手输 / 重发 / 队列出队都走这里，保证三种入口的行为完全一致。
 */
async function runTask(text: string, options: { sourceIndex?: number } = {}): Promise<void> {
  if (running.value || preparingTask) {
    enqueueSend(text, options.sourceIndex ?? null)
    return
  }
  // 立即置为 running 与 preparingTask，封闭 refreshStatus / 技能预处理等异步间隙内二次发送绕过队列的竞态窗口
  const myAbortSeq = clientAbortSeq
  abortIgnoreUntil = 0
  lastRoundOutcome.value = 'idle'
  running.value = true
  notifyWeatherTaskStart('ai-chat')
  preparingTask = true
  let taskForHarness = text
  try {
    // 发送前重新预检一次（Node 版本 / dsh 运行体 / MCP 服务 / 模型），
    // 不用挂载时的旧快照判断，避免按过期的“就绪”放行后才发现环境缺失
    await refreshStatus()
    if (clientAbortSeq !== myAbortSeq) {
      running.value = false
      return
    }
    // 若主进程此刻仍有上一轮任务在跑（如面板重挂载或后台定时轮次刚唤醒），直接转入发送队列等待
    if (status.value?.running) {
      running.value = true
      enqueueSend(text, options.sourceIndex ?? null)
      return
    }
    // 环境未就绪时不静默丢弃：把原因作为状态消息告知用户
    if (!ready.value) {
      running.value = false
      pushStatus(status.value?.message ?? t('studio.chat.unavailable'), 'error')
      return
    }
    const task = text
    const slashSkillMatch = /^\/([a-zA-Z0-9._-]+)(?:\s|$)/.exec(task.trim())
    if (slashSkillMatch?.[1]) markSkillLoaded(slashSkillMatch[1])
    pendingReasoning = ''
    // 发送前记录 git 变更基线：运行结束后据此对比出「这一轮改了什么」
    void resetGitBaseline()
    // 同一时刻记产物扫盘基线：运行结束后只收这之后落盘到 Output / Cache 的媒体
    roundStartAt = Date.now()
    sessionStart = messages.value.length
    messages.value.push({ kind: 'user', text: task })
    scrollToBottom()
    // 发送即落盘，避免依赖防抖窗口导致会话丢失
    commitMessages([...messages.value])
    persistHistory()
    if (options.sourceIndex !== undefined) {
      resendIndex.value = options.sourceIndex
      if (resendTimer !== null) window.clearTimeout(resendTimer)
      resendTimer = window.setTimeout(() => {
        resendIndex.value = null
      }, 1500)
    }
    taskForHarness = await preprocessChatOnlineSkillIntent(task)
  } finally {
    if (clientAbortSeq === myAbortSeq) {
      preparingTask = false
    }
  }
  if (clientAbortSeq !== myAbortSeq) {
    return
  }
  const { providerId, modelId } = splitModelKey(selectedKey.value)
  const canvasContext = buildActiveCanvasContext()
  const result = await window.studio.runHarnessTask({
    task: taskForHarness,
    // 会话 id：dsh 据此恢复/创建持久化 session，模型通过原生会话历史记住之前的聊天内容
    sessionId: activeSession.value?.id,
    model: modelId.trim() || undefined,
    ...(providerId ? { providerId } : {}),
    // 当前 agent 模式：main 进程按 craft/ask/plan 切换 dsh 的 system-prompt
    mode: mode.value,
    ...(canvasContext ? { canvasContext } : {})
  })
  if (clientAbortSeq !== myAbortSeq) {
    return
  }
  if (!result.started) {
    await refreshStatus()
    if (clientAbortSeq !== myAbortSeq) return
    if (status.value?.running) {
      running.value = true
      return
    }
    pushStatus(result.message ?? 'failed to start', 'error')
    running.value = false
  }
}

async function onSend(): Promise<void> {
  if (composing.value) return
  if (!draft.value.trim()) syncDraftFromEditor()
  const raw = draft.value.trim()
  if (!raw) return
  // 本地指令：不消耗模型、不依赖 MCP 就绪
  const slash = isLocalSlashCommand(raw)
  if (slash) {
    resetEditor()
    if (slash === 'clear') await onClearCommand()
    else if (slash === 'model') await onModelCommand()
    else if (slash === 'skills') await onSkillsCommand()
    return
  }
  const task = buildTask(raw)
  referenced.value = []
  resetEditor()
  // 正在执行：不丢弃输入，转入发送队列，等本轮结束后按序发出
  if (running.value || preparingTask) {
    enqueueSend(task)
    return
  }
  await runTask(task)
}

/**
 * 首屏「免 Key 秒开样板间」：立即打开预置 6 层仙侠装备 UI 与图层分离状态的交互画布，
 * 无需配置任何 API Key 即可双击进入图层分离工作台体验 3D 全息爆炸视图与 PSD/引擎导出。
 */
function onLaunchZeroKeyDemo(): void {
  const demoName = isEnChat.value
    ? 'Xianxia UI · 6-Layer 3D Showcase'
    : '仙侠装备界面UI · 6层3D样板间'
  createDraftAndOpen('canvas', {
    name: demoName,
    genParams: {
      canvasKind: 'free',
      graphJson: buildZeroKeyLiveDemoGraph(locale.value)
    }
  })
}

async function onClickShowcaseStarter(card: ChatShowcaseStarter): Promise<void> {
  if (!buildActiveCanvasContext()) {
    createDraftAndOpen('canvas', {
      name: isEnChat.value ? card.titleEn : card.titleZh,
      genParams: {
        canvasKind: 'free',
        graphJson: buildCanvasStarterGraph()
      }
    })
    await nextTick()
  }
  const promptText = isEnChat.value ? card.promptEn : card.promptZh
  const task = buildTask(promptText)
  if (running.value || preparingTask) {
    enqueueSend(task)
    return
  }
  await runTask(task)
}

function nextActionsForAsset(
  msg: Pick<ChatMsg & { kind: 'asset' }, 'relativePath' | 'relatedPaths'>
): ChatNextActionPill[] {
  return resolveChatNextActions(msg.relativePath, msg.relatedPaths ?? [])
}

async function openDeliverableFile(relativePath: string): Promise<void> {
  try {
    await window.studio.openAssetWithDefaultApp(relativePath)
  } catch {
    // ignore
  }
}

async function onClickNextActionPill(
  msg: Pick<ChatMsg & { kind: 'asset' }, 'relativePath' | 'relatedPaths'>,
  pill: ChatNextActionPill
): Promise<void> {
  const allPaths = [msg.relativePath, ...(msg.relatedPaths ?? [])].filter(Boolean)
  const psdOrTarget = allPaths.find((p) => p.toLowerCase().endsWith('.psd')) || msg.relativePath
  if (pill.localAction === 'open-default-app' || pill.localAction === 'reveal-in-folder') {
    await openDeliverableFile(psdOrTarget)
    return
  }
  const promptText = isEnChat.value ? pill.promptEn : pill.promptZh
  if (!promptText.trim()) return
  const task = buildTask(promptText)
  if (running.value || preparingTask) {
    enqueueSend(task)
    return
  }
  await runTask(task)
}

async function abortCurrentRun(): Promise<void> {
  clientAbortSeq++
  abortIgnoreUntil = Date.now() + 600
  preparingTask = false
  for (let i = messages.value.length - 1; i >= sessionStart; i--) {
    const m = messages.value[i]
    if (m?.kind === 'tool' && m.state === 'start') {
      m.state = 'done'
    }
  }
  try {
    await window.studio.abortHarnessTask()
  } finally {
    preparingTask = false
    running.value = false
    void captureRoundOutputs()
  }
}

async function onAbort(): Promise<void> {
  const prevDraining = draining
  // 阻塞 watch(running) 在主进程真正完成 abortHarnessTask 前抢跑 drainQueue
  draining = true
  for (const q of sendQueue.value) q.forcing = false
  // 先本地退出 running，避免主进程杀进程慢时按钮一直停在「停止」
  preparingTask = false
  running.value = false
  try {
    await abortCurrentRun()
  } finally {
    draining = prevDraining
  }
  if (!draining && sendQueue.value.length > 0) {
    void drainQueue()
  }
}

/**
 * 重发：把已发出的用户消息再发一遍。
 * 执行中同样入队（与输入框发送一致），执行空闲则直接发出。
 */
async function onResend(index: number): Promise<void> {
  const msg = messages.value[index]
  if (!msg || msg.kind !== 'user' || !msg.text.trim()) return
  if (running.value || preparingTask) {
    enqueueSend(msg.text, index)
    return
  }
  await runTask(msg.text, { sourceIndex: index })
}

/**
 * 出队：本轮结束后按序发出队首。
 * 只能在本轮真正停止时调用（watch running / 中断流程），否则会打乱正在跑的一轮。
 */
async function drainQueue(): Promise<void> {
  if (draining || running.value || preparingTask) return
  const item = sendQueue.value[0]
  if (!item) return
  draining = true
  let dequeued: QueueItem | undefined
  try {
    // 环境未就绪时把队首留在队列里并说明原因，避免静默丢弃整条队列
    await refreshStatus()
    if (running.value || preparingTask) return
    if (!ready.value) {
      pushStatus(status.value?.message ?? t('studio.chat.unavailable'), 'error')
      return
    }
    if (status.value?.running) {
      running.value = true
      return
    }
    dequeued = sendQueue.value.shift()
    if (!dequeued) return
    dequeued.forcing = false
    // 出队即重置全部强制标记：forcing 只决定「出队时要不要中断」，用过即失效
    for (const q of sendQueue.value) q.forcing = false
  } finally {
    // 在 await runTask 之前释放 draining：runTask 入口同步置 running = true / preparingTask = true，
    // 提前释放 draining 可确保常驻进程冷启动等待期间用户仍能对队列后续项点「立即发送」中断
    draining = false
  }
  if (!dequeued) return
  await runTask(
    dequeued.text,
    dequeued.sourceIndex === null ? {} : { sourceIndex: dequeued.sourceIndex }
  )
  // runTask 可能提前返回（预检未就绪 / 主进程拒绝启动）：这一轮没跑起来就放回队首，
  // 否则用户排队的那句话会凭空消失
  if (!running.value && !preparingTask && !sendQueue.value.some((q) => q.id === dequeued!.id)) {
    dequeued.forcing = false
    sendQueue.value.unshift(dequeued)
  }
}

async function startQueuedSend(item: QueueItem, force: boolean): Promise<void> {
  if (draining) return
  // 这条已经被前面的流程排掉了
  if (!sendQueue.value.some((q) => q.id === item.id)) return
  // 此刻已空闲且不在预检：直接取出该条发出，无需中断
  if (!running.value && !preparingTask) {
    draining = true
    try {
      sendQueue.value = sendQueue.value.filter((q) => q.id !== item.id)
      item.forcing = false
      for (const q of sendQueue.value) q.forcing = false
    } finally {
      draining = false
    }
    await runTask(item.text, item.sourceIndex === null ? {} : { sourceIndex: item.sourceIndex })
    if (!running.value && !preparingTask && !sendQueue.value.some((q) => q.id === item.id)) {
      item.forcing = false
      sendQueue.value.unshift(item)
    }
    return
  }
  if (!force) return
  // 支持队列中任意位置（含第 2、第 N 条）点「立即发送」：
  // 立即中断当前执行轮次并插队发出该条，其余排队项保持在队列中等待本轮结束
  draining = true
  item.forcing = true
  let shouldSend = false
  try {
    await abortCurrentRun()
    if (sendQueue.value.some((q) => q.id === item.id)) {
      sendQueue.value = sendQueue.value.filter((q) => q.id !== item.id)
      shouldSend = true
    }
    item.forcing = false
    for (const q of sendQueue.value) q.forcing = false
  } finally {
    item.forcing = false
    draining = false
  }
  if (!shouldSend) {
    if (sendQueue.value.length > 0) void drainQueue()
    return
  }
  await runTask(item.text, item.sourceIndex === null ? {} : { sourceIndex: item.sourceIndex })
  // 同上：中断后若这一轮没跑起来，重置 forcing 后把消息放回队首而不是丢掉或卡在「正在中断…」
  if (!running.value && !preparingTask && !sendQueue.value.some((q) => q.id === item.id)) {
    item.forcing = false
    sendQueue.value.unshift(item)
  }
}

/** 立即发送：中断当前执行，马上发这条 */
function forceQueuedSend(id: number): void {
  const item = sendQueue.value.find((q) => q.id === id)
  if (!item) return
  void startQueuedSend(item, true)
}

/**
 * Stage 1：盘中实时转向（Mid-Turn Live Steering）
 * 在 Agent 运行期间，不中断当前轮次与已启动工具，将用户新指令直接通过 IPC 注入给正在运行的 Agent。
 */
async function onSteerNow(): Promise<void> {
  if (composing.value || !running.value) return
  const raw = draft.value.trim()
  if (!raw) return
  const task = buildTask(raw)
  referenced.value = []
  resetEditor()
  if (typeof window.studio?.steerHarnessTurn === 'function') {
    const res = await window.studio.steerHarnessTurn({ text: task }).catch(() => ({ ok: false }))
    if (res?.ok) {
      messages.value.push({ kind: 'user', text: task, steered: true })
      scrollToBottom()
      commitMessages([...messages.value])
      persistHistory()
      pushStatus(t('studio.chat.steeredStatus'), 'waiting')
      return
    }
  }
  enqueueSend(task)
}

/**
 * 将发送队列中的一条消息立即提升为盘中实时转向（不中断当前轮次，直接注入）。
 */
async function onSteerQueued(id: number): Promise<void> {
  const item = sendQueue.value.find((q) => q.id === id)
  if (!item) return
  if (running.value && typeof window.studio?.steerHarnessTurn === 'function') {
    const res = await window.studio
      .steerHarnessTurn({ text: item.text })
      .catch(() => ({ ok: false }))
    if (res?.ok) {
      sendQueue.value = sendQueue.value.filter((q) => q.id !== id)
      messages.value.push({ kind: 'user', text: item.text, steered: true })
      scrollToBottom()
      commitMessages([...messages.value])
      persistHistory()
      pushStatus(t('studio.chat.steeredStatus'), 'waiting')
      return
    }
  }
  void startQueuedSend(item, true)
}

/**
 * Stage 3：向指定子代理会话发送追问或盘中转向（支持运行中实时注入或已完成子代理的多轮续写）。
 */
async function onSteerSubagent(sub: HarnessSubagentView): Promise<void> {
  const text = subagentFollowupDraft.value.trim()
  if (!text) return
  subagentFollowupDraft.value = ''
  subagentFollowupTarget.value = null
  if (running.value && typeof window.studio?.steerHarnessTurn === 'function') {
    const res = await window.studio
      .steerHarnessTurn({ text, subagentSessionId: sub.sessionId })
      .catch(() => ({ ok: false }))
    if (res?.ok) {
      messages.value.push({
        kind: 'user',
        text: `[@${sub.agentType} (${sub.sessionId})] ${text}`,
        steered: true
      })
      scrollToBottom()
      commitMessages([...messages.value])
      persistHistory()
      pushStatus(t('studio.chat.steeredStatus'), 'waiting')
      return
    }
  }
  const dispatchPrompt = `[Continue subagent session_id="${sub.sessionId}" (@${sub.agentType})] ${text}`
  if (running.value) {
    enqueueSend(dispatchPrompt)
  } else {
    await runTask(dispatchPrompt)
  }
}

/**
 * Stage 2：响应画布异步事件触发器（节点报错一键诊断修复 / 工作流跑完一键审片接力）
 */
async function onHandleCanvasEvent(action: 'diagnose' | 'review'): Promise<void> {
  const ev = latestCanvasEvent.value
  if (!ev) return
  latestCanvasEvent.value = null
  const refs = (ev.outputPaths ?? []).map((p) => `@${p}`).join(' ')
  const prompt =
    action === 'diagnose'
      ? `[Reactive Canvas Hook — Node Error Diagnosis] Canvas event: ${ev.summary}${
          ev.error ? `\nError detail: ${ev.error}` : ''
        }\nPlease inspect the active canvas node parameters/connections, diagnose the root cause, and fix or retry it.`
      : `[Reactive Canvas Hook — Director Visual Review] Canvas workflow finished: ${ev.summary}${
          refs ? `\nGenerated outputs: ${refs}` : ''
        }\nPlease visually inspect the outputs for composition, character consistency, and quality, then advise or execute the next production step.`
  if (running.value && typeof window.studio?.steerHarnessTurn === 'function') {
    const res = await window.studio.steerHarnessTurn({ text: prompt }).catch(() => ({ ok: false }))
    if (res?.ok) {
      messages.value.push({ kind: 'user', text: prompt, steered: true })
      scrollToBottom()
      commitMessages([...messages.value])
      persistHistory()
      pushStatus(t('studio.chat.steeredStatus'), 'waiting')
      return
    }
    enqueueSend(prompt)
    return
  }
  await runTask(prompt)
}

/**
 * 本轮结束（正常 done / 报错 / 用户中断）后自动发出队首。
 * running 的每个 false 落点都会触发一次，队列空时是空操作；
 * 只有用户点了「立即发送」才会在运行中中断当前轮去插队。
 */
watch(running, (isRunning) => {
  if (isRunning) {
    notifyWeatherTaskStart('ai-chat')
  } else {
    notifyWeatherTaskComplete('ai-chat')
    void drainQueue()
  }
})

onMounted(async () => {
  // 按当前工程作用域恢复历史会话（新建工程自动创建独立空白会话），再订阅事件流
  loadHistory(currentProjectChatScope.value)
  loadActiveMessages()
  void refreshSessionSkills()
  void refreshInstalledWorkflows()
  stopEvent = window.studio.onHarnessEvent(onHarnessEvent)
  stopActivity = window.studio.onMcpActivityUpdated(onMcpActivity)
  stopAskUser = window.studio.onAskUser(handleAskUser)
  stopApproval = window.studio.onApprovalRequest(handleApprovalRequest)
  // 订阅资产移除事件：用户在资产库 / MCP 删除时让对话产物卡上的「已保存」状态回退
  if (typeof window.studio?.onAssetRemoved === 'function') {
    stopAssetRemoved = window.studio.onAssetRemoved(onAssetRemoved)
  }
  // 模式选择下拉：点外部或 ESC 收起；用 document 监听，trigger 用 .stop 防止冒泡立即关
  document.addEventListener('click', onModeOutside)
  document.addEventListener('keydown', onModeOutside)
  // 打开面板即做一次环境预检，未就绪时在面板顶部与空状态区给出具体原因
  await refreshStatus()
  await loadModels()
  // 闲时预热常驻 dsh：就绪后首条消息跳过 Cordis/MCP 冷启动
  if (typeof window.studio?.prewarmHarness === 'function') {
    void window.studio.prewarmHarness()
  }
})

onActivated(() => {
  void nextTick(() => retryUnresolvedChatImages())
})

onBeforeUnmount(() => {
  stopEvent?.()
  stopActivity?.()
  stopAskUser?.()
  stopApproval?.()
  stopAssetRemoved?.()
  document.removeEventListener('click', onModeOutside)
  document.removeEventListener('keydown', onModeOutside)
  if (copyTimer !== null) window.clearTimeout(copyTimer)
  if (historyTimer !== null) window.clearTimeout(historyTimer)
  if (activityTimer !== null) window.clearTimeout(activityTimer)
  // 卸载前把当前消息与上下文用量落盘，避免切换面板丢失最后一段对话与真实用量
  commitMessages([...messages.value])
  commitContextUsed(harnessContextUsed.value)
  commitTodos([...sessionTodos.value])
  commitGoal(sessionGoal.value)
  persistHistory()
})
</script>

<template>
  <div class="chat-panel">
    <div class="chat-status" :class="{ warn: statusWarn }">
      <!--
        当前会话标题放在面板最上方：它回答的是「我在看哪段对话」，
        属于整块面板的上下文，而不该被塞进输入框旁边一个小按钮里。
      -->
      <span
        v-if="activeSession"
        class="chat-session-title"
        :title="activeSession.title || t('studio.chat.newChat')"
      >
        {{ activeSession.title || t('studio.chat.newChat') }}
      </span>
      <span class="dot" />
      <span class="status-text">{{ statusText }}</span>
      <!-- 瞬时状态：正在启动 / 已提交给模型 / 仍在等待…，只在状态栏出现，不进消息流 -->
      <span
        v-if="activity"
        class="chat-activity"
        :class="activityPhase"
        :title="activity"
        aria-live="polite"
      >
        {{ activity }}
      </span>
      <span v-if="workspace" class="chat-workspace" :title="workspace">{{ workspaceLabel }}</span>
    </div>

    <!-- 自主目标状态条（dsh goal 工具或 /goal 激活时呈现，支持暂停 / 恢复 / 结束） -->
    <div
      v-if="sessionGoal && !goalDismissed"
      class="harness-goal-bar"
      :class="[sessionGoal.phase, sessionGoal.activation]"
    >
      <div class="goal-bar-main">
        <span class="goal-badge">
          {{
            sessionGoal.phase === 'completed'
              ? t('studio.chat.goalCompleted')
              : sessionGoal.activation === 'paused'
                ? t('studio.chat.goalPaused')
                : t('studio.chat.goalActive')
          }}
        </span>
        <span class="goal-objective" :title="sessionGoal.objective">
          {{ sessionGoal.objective }}
        </span>
        <span v-if="(sessionGoal.roundsSinceUser ?? 0) > 0" class="goal-rounds">
          {{ t('studio.chat.goalRound', { round: sessionGoal.roundsSinceUser ?? 0 }) }}
        </span>
      </div>
      <div class="goal-bar-actions">
        <button
          v-if="sessionGoal.phase === 'active' && sessionGoal.activation === 'armed'"
          type="button"
          class="goal-btn"
          @click="onControlGoal('pause')"
        >
          {{ t('studio.chat.goalPause') }}
        </button>
        <button
          v-if="sessionGoal.phase === 'active' && sessionGoal.activation === 'paused'"
          type="button"
          class="goal-btn primary"
          @click="onControlGoal('resume')"
        >
          {{ t('studio.chat.goalResume') }}
        </button>
        <button
          v-if="sessionGoal.phase === 'active'"
          type="button"
          class="goal-btn"
          @click="onControlGoal('complete')"
        >
          {{ t('studio.chat.goalComplete') }}
        </button>
        <button
          v-if="sessionGoal.phase === 'completed'"
          type="button"
          class="goal-btn icon"
          @click="goalDismissed = true"
        >
          ×
        </button>
      </div>
    </div>

    <!-- Todo 进度看板（dsh todo_write 工具实时驱动，可折叠） -->
    <div v-if="sessionTodos.length" class="harness-todo-board">
      <button type="button" class="todo-board-head" @click="todoBoardOpen = !todoBoardOpen">
        <span class="todo-board-title">{{ t('studio.chat.todoBoardTitle') }}</span>
        <span class="todo-board-progress">
          {{
            t('studio.chat.todoBoardProgress', {
              done: todoDoneCount,
              total: sessionTodos.length
            })
          }}
        </span>
        <span class="todo-board-chevron" :class="{ open: todoBoardOpen }">▾</span>
      </button>
      <ul v-if="todoBoardOpen" class="todo-board-list">
        <li
          v-for="item in sessionTodos"
          :key="item.id"
          class="todo-board-item"
          :class="item.status"
        >
          <span class="todo-status-icon">
            {{
              item.status === 'completed'
                ? '✓'
                : item.status === 'in_progress'
                  ? '●'
                  : item.status === 'cancelled'
                    ? '✕'
                    : '○'
            }}
          </span>
          <span class="todo-item-content">{{ item.content }}</span>
          <span v-if="item.priority" class="todo-priority" :class="item.priority">
            {{ item.priority }}
          </span>
        </li>
      </ul>
    </div>

    <!-- Stage 3：子代理并发实时监控看板（Subagent Concurrency Board） -->
    <div v-if="sessionSubagents.length" class="harness-subagent-board">
      <button
        type="button"
        class="subagent-board-head"
        @click="subagentBoardOpen = !subagentBoardOpen"
      >
        <span class="subagent-board-title">{{ t('studio.chat.subagentBoardTitle') }}</span>
        <span class="subagent-board-summary">
          {{
            t('studio.chat.subagentBoardSummary', {
              running: runningSubagentsCount,
              total: sessionSubagents.length
            })
          }}
        </span>
        <span class="todo-board-chevron" :class="{ open: subagentBoardOpen }">▾</span>
      </button>
      <ul v-if="subagentBoardOpen" class="subagent-board-list">
        <li
          v-for="sub in sessionSubagents"
          :key="sub.sessionId"
          class="subagent-board-item"
          :class="sub.status"
        >
          <div class="subagent-item-top">
            <span class="subagent-status-badge" :class="sub.status">
              {{
                sub.status === 'running'
                  ? t('studio.chat.subagentStatusRunning')
                  : sub.status === 'idle'
                    ? t('studio.chat.subagentStatusIdle')
                    : sub.status === 'error'
                      ? t('studio.chat.subagentStatusError')
                      : t('studio.chat.subagentStatusCompleted')
              }}
            </span>
            <code class="subagent-type-tag">@{{ sub.agentType }}</code>
            <span class="subagent-desc" :title="sub.description">{{ sub.description }}</span>
            <span class="subagent-calls">
              {{ t('studio.chat.subagentCalls', { count: sub.toolCount }) }}
            </span>
            <button
              type="button"
              class="subagent-followup-toggle"
              @click.stop="
                subagentFollowupTarget =
                  subagentFollowupTarget === sub.sessionId ? null : sub.sessionId
              "
            >
              {{ t('studio.chat.subagentFollowupBtn') }}
            </button>
          </div>
          <div v-if="sub.activeTool" class="subagent-active-tool">
            {{ t('studio.chat.subagentActiveTool', { tool: sub.activeTool }) }}
          </div>
          <div
            v-if="subagentFollowupTarget === sub.sessionId"
            class="subagent-followup-row"
            @click.stop
          >
            <input
              v-model="subagentFollowupDraft"
              type="text"
              class="subagent-followup-input"
              :placeholder="t('studio.chat.subagentFollowupPlaceholder')"
              @keydown.stop
              @keydown.enter.prevent="onSteerSubagent(sub)"
            />
            <button
              type="button"
              class="subagent-followup-send"
              :disabled="!subagentFollowupDraft.trim()"
              @click.stop="onSteerSubagent(sub)"
            >
              {{ t('studio.chat.steerNow') }}
            </button>
          </div>
        </li>
      </ul>
    </div>

    <!-- Stage 2：画布异步事件触发器横幅（Reactive Canvas Event Hook） -->
    <div v-if="latestCanvasEvent" class="harness-canvas-event-bar" :class="latestCanvasEvent.kind">
      <div class="canvas-event-main">
        <span class="canvas-event-badge">
          {{ t('studio.chat.canvasEventBannerTitle') }}
        </span>
        <span class="canvas-event-summary" :title="latestCanvasEvent.summary">
          {{ latestCanvasEvent.summary }}
        </span>
      </div>
      <div class="canvas-event-actions">
        <button
          v-if="latestCanvasEvent.kind === 'node_error'"
          type="button"
          class="canvas-event-btn danger"
          @click="onHandleCanvasEvent('diagnose')"
        >
          {{ t('studio.chat.canvasEventDiagnoseBtn') }}
        </button>
        <button
          v-else
          type="button"
          class="canvas-event-btn primary"
          @click="onHandleCanvasEvent('review')"
        >
          {{ t('studio.chat.canvasEventReviewBtn') }}
        </button>
        <button
          type="button"
          class="canvas-event-dismiss"
          :title="t('studio.chat.canvasEventDismiss')"
          @click="latestCanvasEvent = null"
        >
          ×
        </button>
      </div>
    </div>

    <div class="chat-messages-wrap">
      <!-- 许愿式编程（Vibe Coding）二次元流星祈愿浮窗：发送指令后在会话面板上方浮动祈福 -->
      <ChatWishShrine
        :running="running"
        :session-id="activeSession?.id"
        :session-title="activeSession?.title"
        :prompt-text="latestUserPromptText"
        :activity-text="activity"
        :outcome="lastRoundOutcome"
        :is-en="isEnChat"
      />
      <div ref="listRef" class="chat-messages" @scroll="onChatScroll">
        <div v-if="!messages.length" class="chat-empty">
          <div class="chat-empty-hero">
            <div class="chat-empty-title">{{ t('studio.chat.empty') }}</div>
            <div v-if="statusWarn && status?.message" class="chat-empty-hint">
              {{ status.message }}
            </div>
            <div class="zero-key-demo-banner">
              <div class="zero-key-demo-info">
                <span class="zero-key-demo-badge">⚡ ZERO-KEY LIVE DEMO</span>
                <strong class="zero-key-demo-title">
                  {{
                    isEnChat
                      ? 'Instant 6-Layer Xianxia UI + 3D Exploded PSD Workbench'
                      : '免配 Key 秒开：仙侠装备 UI · 6 层 3D 爆炸拆解样板间'
                  }}
                </strong>
                <span class="zero-key-demo-desc">
                  {{
                    isEnChat
                      ? 'Pre-loaded with 6 transparent UI layers & auto-grouped folders. Test 3D exploded view, PSD export, and HTML5/Godot/Unity exporters in 1 click.'
                      : '内置 6 张高清矢量透明图层与游戏 UI 自动分组，一键体验「🧊 3D 全息层叠爆炸视图」、导出真实 PSD 与可点击 HTML5/Godot/Unity 预制体。'
                  }}
                </span>
              </div>
              <button type="button" class="zero-key-demo-btn" @click="onLaunchZeroKeyDemo">
                {{ isEnChat ? '🚀 Open Live Demo' : '🚀 秒开样板间' }}
              </button>
            </div>
          </div>

          <div class="showcase-starter-section">
            <div class="showcase-starter-header">
              <span>{{
                isEnChat
                  ? '✨ 1-Click Blockbuster Workflows'
                  : '✨ 一句话爆款创作配方（点击即在当前画布搭图运行）'
              }}</span>
            </div>
            <div class="showcase-starter-grid">
              <button
                v-for="card in showcaseStarters"
                :key="card.id"
                type="button"
                class="showcase-starter-card"
                @click="onClickShowcaseStarter(card)"
              >
                <div class="showcase-card-top">
                  <span class="showcase-card-icon" :style="{ background: card.accent }">
                    {{ card.icon }}
                  </span>
                  <span class="showcase-card-badge">
                    {{ isEnChat ? card.badgeEn : card.badgeZh }}
                  </span>
                </div>
                <div class="showcase-card-title">
                  {{ isEnChat ? card.titleEn : card.titleZh }}
                </div>
                <div class="showcase-card-desc">
                  {{ isEnChat ? card.descEn : card.descZh }}
                </div>
                <div class="showcase-card-foot">
                  <code class="showcase-card-pipeline">{{ card.pipelineTag }}</code>
                  <span class="showcase-card-go">▶</span>
                </div>
              </button>
            </div>
          </div>
        </div>
        <template v-for="(msg, i) in messages" :key="`${activeId}:${i}`">
          <template v-if="msg.kind === 'user'">
            <div class="msg-row user">
              <!-- 操作条：常显在气泡上方，动作均用图标 -->
              <div class="bubble-actions">
                <ChatCopyIcon :copied="copiedIndex === i" @copy="copyMessage(i, msg.text)" />
                <!-- 重发本条：执行中入队（见 onResend），空闲时直接再发一轮 -->
                <button
                  class="bubble-action"
                  :class="{ done: resendIndex === i }"
                  :title="
                    resendIndex === i ? t('studio.chat.resendQueued') : t('studio.chat.resendTitle')
                  "
                  @click.stop="onResend(i)"
                >
                  <svg
                    viewBox="0 0 16 16"
                    width="13"
                    height="13"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M13 8 A5 5 0 1 1 11 4" />
                    <path d="M13 2.4 V5 H10.4" />
                  </svg>
                </button>
                <!-- 会话回退：截断此轮及之后的消息，并恢复本条到输入框 -->
                <button
                  class="bubble-action"
                  :disabled="running"
                  :title="t('studio.chat.rewindTitle')"
                  @click.stop="onRewindAtMessage(i, false)"
                >
                  <svg
                    viewBox="0 0 16 16"
                    width="13"
                    height="13"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M6.5 4 L2.5 8 L6.5 12" />
                    <path d="M3 8 H11 A2.5 2.5 0 0 1 13.5 10.5 V12" />
                  </svg>
                </button>
                <!-- 会话分叉：从此处克隆出一个独立新会话分支 -->
                <button
                  class="bubble-action"
                  :disabled="running"
                  :title="t('studio.chat.forkTitle')"
                  @click.stop="onRewindAtMessage(i, true)"
                >
                  <svg
                    viewBox="0 0 16 16"
                    width="13"
                    height="13"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="5" cy="3.5" r="1.5" />
                    <circle cx="11" cy="3.5" r="1.5" />
                    <circle cx="8" cy="12.5" r="1.5" />
                    <path d="M5 5 V7.5 C5 9 8 9 8 11" />
                    <path d="M11 5 V7.5 C11 9 8 9 8 11" />
                  </svg>
                </button>
              </div>
              <div class="bubble user" :class="{ steered: msg.steered }">
                <span v-if="msg.steered" class="steered-badge">{{
                  t('studio.chat.steeredBadge')
                }}</span>
                <div class="bubble-text" v-chat-img v-html="renderInlineChatRefs(msg.text)" />
              </div>
            </div>
            <!-- 任务清单：跟随任务消息内嵌展示（agent 风格），默认展开以直接呈现 MCP 操作 -->
            <details v-if="taskToolsAt(i).length" class="task-list-card" open>
              <summary class="task-list-title">
                {{ t('studio.chat.taskList') }}
                <span class="task-list-summary">{{ taskToolsSummary(i) }}</span>
              </summary>
              <ul class="task-list">
                <li
                  v-for="tm in taskToolsAt(i)"
                  :key="tm.key"
                  class="task-item"
                  :class="tm.state"
                  :title="tm.detail"
                >
                  <span class="task-dot" />
                  <span class="task-name">{{ toolDisplayName(tm) }}</span>
                  <span v-if="toolShortCode(tm)" class="task-code-badge">{{
                    toolShortCode(tm)
                  }}</span>
                  <span class="task-state">
                    {{
                      tm.state === 'start'
                        ? t('studio.chat.toolRunning')
                        : tm.state === 'done'
                          ? t('studio.chat.toolDone')
                          : t('studio.chat.toolFailed')
                    }}
                  </span>
                  <ul v-if="toolSteps(tm).length" class="task-step-list">
                    <li
                      v-for="(step, sIdx) in toolSteps(tm)"
                      :key="sIdx"
                      class="task-step-item"
                      :class="`step-${stepKind(step)}`"
                    >
                      <span class="tool-step-icon" aria-hidden="true">{{ stepIcon(step) }}</span>
                      <span class="tool-step-text">{{ step }}</span>
                    </li>
                  </ul>
                  <!-- 详细参数/摘要：执行中自动展开，命令完成后折叠为一行摘要，可手动点开展开 -->
                  <details
                    v-if="toolArgs(tm).length || tm.detail"
                    class="task-params"
                    :open="tm.state === 'start'"
                  >
                    <summary class="task-params-summary">
                      {{ tm.detail || t('studio.chat.toolParams') }}
                    </summary>
                    <div v-if="toolArgs(tm).length" class="task-param-list">
                      <span
                        v-for="p in toolArgs(tm)"
                        :key="p.key"
                        class="task-param"
                        :title="`${p.key}: ${p.value}`"
                      >
                        <span class="task-param-key">{{ p.key }}</span>
                        <span class="task-param-value">{{ p.value }}</span>
                      </span>
                    </div>
                    <div v-else-if="tm.detail" class="task-detail" :title="tm.detail">
                      {{ tm.detail }}
                    </div>
                  </details>
                  <!-- 旧会话数据无独立资产卡时回退到卡内预览；新数据一律走对话末尾的独立预览卡 -->
                  <ChatAssetPreview
                    v-if="tm.state === 'done' && tm.relativePath && !hasAssetCard(tm.key)"
                    :relative-path="tm.relativePath"
                  />
                  <!-- 子代理活动：嵌套在发起它的 subagent 卡片下，执行中展开 -->
                  <details
                    v-if="subagentToolsOf(i, tm).length"
                    class="subagent-tools"
                    :open="tm.state === 'start'"
                  >
                    <summary class="subagent-tools-summary">
                      {{
                        t('studio.chat.subagentSteps', {
                          done: subagentToolsOf(i, tm).filter((c) => c.state === 'done').length,
                          total: subagentToolsOf(i, tm).length
                        })
                      }}
                    </summary>
                    <ul class="subagent-tool-list">
                      <li
                        v-for="ct in subagentToolsOf(i, tm)"
                        :key="ct.key"
                        class="subagent-tool"
                        :class="ct.state"
                        :title="ct.detail"
                      >
                        <span class="task-dot" />
                        <span class="task-name">{{ ct.name }}</span>
                        <span v-if="ct.detail" class="subagent-tool-detail">{{ ct.detail }}</span>
                      </li>
                    </ul>
                  </details>
                </li>
              </ul>
            </details>
          </template>
          <div v-else-if="msg.kind === 'assistant'" class="msg-row assistant">
            <div class="bubble assistant">
              <div class="bubble-actions">
                <ChatCopyIcon :copied="copiedIndex === i" @copy="copyMessage(i, msg.text)" />
              </div>
              <details v-if="msg.reasoning" class="reasoning">
                <summary>{{ t('studio.chat.thinking') }}</summary>
                <pre>{{ msg.reasoning }}</pre>
              </details>
              <div
                v-chat-img
                class="md-body"
                @click="onCodeCopyClick"
                v-html="renderChatBody(msg.text)"
              />
            </div>
          </div>
          <!-- 可玩 HTML 产物卡：只有一个「试玩」按钮，点击直接开试玩窗口 -->
          <div v-else-if="msg.kind === 'game'" class="msg-row asset">
            <div class="asset-card game-card">
              <div class="game-card-head">
                <span class="game-card-icon" aria-hidden="true">🎮</span>
                <span class="game-card-title" :title="msg.title">{{ msg.title }}</span>
              </div>
              <button type="button" class="play-btn" @click.stop="playGame(msg)">
                ▶ {{ t('studio.chat.gamePlay.play') }}
              </button>
            </div>
          </div>
          <!-- 一句话游戏卡：节点图已建好，可打开画布 / 运行整图 / 试玩，并可勾选「生成后自动运行」 -->
          <div v-else-if="msg.kind === 'oneSentenceGame'" class="msg-row asset">
            <div class="asset-card">
              <ChatOneSentenceGameCard :info="msg.info" />
            </div>
          </div>
          <!-- 独立资产预览卡：生成完成（图片/视频/音频/3D/HTML）时追加到对话末尾，与任务清单的状态卡分离 -->
          <div v-else-if="msg.kind === 'asset'" class="msg-row asset">
            <div class="asset-card">
              <ChatAssetPreview :relative-path="msg.relativePath" />
              <!-- 同批次产物（矢量源 / 烘焙位图 / 帧序列等）折叠在同一张卡里：展开后逐份仍可单独入库 -->
              <ul v-if="isAssetGroupOpen(msg.key)" class="asset-card-group">
                <li v-for="path in msg.relatedPaths ?? []" :key="path">
                  <span class="asset-group-name" :title="path">{{ assetFileName(path) }}</span>
                  <template v-if="isHtmlMediaPath(path)">
                    <button type="button" class="save-btn" @click.stop="openHtmlSandbox(path)">
                      {{ t('studio.chat.gamePlay.previewWindow') }}
                    </button>
                    <button type="button" class="save-btn" @click.stop="openHtmlInBrowser(path)">
                      {{ t('studio.chat.gamePlay.openBrowser') }}
                    </button>
                  </template>
                  <span v-else-if="isLibraryRelativePath(path)" class="library-tag">
                    {{ t('studio.chat.alreadyInLibrary') }}
                  </span>
                  <button
                    v-else
                    class="save-btn"
                    :class="{ saved: isAssetSaved(path) }"
                    :disabled="savingAssetPath === path || isAssetSaved(path)"
                    :title="t('studio.chat.saveToLibraryTitle')"
                    @click.stop="openSaveAsset(path)"
                  >
                    {{
                      isAssetSaved(path)
                        ? t('studio.chat.savedToLibrary')
                        : savingAssetPath === path
                          ? t('common.saving')
                          : t('studio.chat.saveToLibrary')
                    }}
                  </button>
                </li>
              </ul>
              <!-- 生成产物默认落 Cache/ 不进资产库：提供手动保存登记入口（HTML 提供浮窗预览与浏览器打开） -->
              <div class="asset-card-actions">
                <button
                  v-if="msg.relatedPaths?.length"
                  class="group-btn"
                  :class="{ open: isAssetGroupOpen(msg.key) }"
                  :title="t('studio.chat.assetGroupTitle')"
                  @click.stop="toggleAssetGroup(msg.key)"
                >
                  {{ t('studio.chat.assetGroupCount', { count: assetGroupCount(msg) }) }}
                </button>
                <button
                  v-if="isDeliverableMediaPath(msg.relativePath)"
                  type="button"
                  class="save-btn"
                  @click.stop="openDeliverableFile(msg.relativePath)"
                >
                  🚀 {{ isEnChat ? 'Open' : '打开文件' }}
                </button>
                <template v-if="isHtmlMediaPath(msg.relativePath)">
                  <button
                    type="button"
                    class="save-btn"
                    @click.stop="openHtmlSandbox(msg.relativePath)"
                  >
                    {{ t('studio.chat.gamePlay.previewWindow') }}
                  </button>
                  <button
                    type="button"
                    class="save-btn"
                    @click.stop="openHtmlInBrowser(msg.relativePath)"
                  >
                    {{ t('studio.chat.gamePlay.openBrowser') }}
                  </button>
                </template>
                <span
                  v-else-if="isLibraryRelativePath(msg.relativePath)"
                  class="library-tag"
                  :title="t('studio.chat.alreadyInLibraryTitle')"
                >
                  {{ t('studio.chat.alreadyInLibrary') }}
                </span>
                <button
                  v-else
                  class="save-btn"
                  :class="{ saved: isAssetSaved(msg.relativePath) }"
                  :disabled="savingAssetPath === msg.relativePath || isAssetSaved(msg.relativePath)"
                  :title="t('studio.chat.saveToLibraryTitle')"
                  @click.stop="openSaveAsset(msg.relativePath)"
                >
                  {{
                    isAssetSaved(msg.relativePath)
                      ? t('studio.chat.savedToLibrary')
                      : savingAssetPath === msg.relativePath
                        ? t('common.saving')
                        : t('studio.chat.saveToLibrary')
                  }}
                </button>
              </div>
              <!-- 上下文追击胶囊（Next-Action Pills）：一键拆 PSD / 2x 超分 / 3D 打光 / 动效延展 -->
              <div v-if="nextActionsForAsset(msg).length" class="asset-next-pills">
                <button
                  v-for="pill in nextActionsForAsset(msg)"
                  :key="pill.id"
                  type="button"
                  class="next-action-pill"
                  :disabled="running && !pill.localAction"
                  @click.stop="onClickNextActionPill(msg, pill)"
                >
                  <span class="next-pill-icon" aria-hidden="true">{{ pill.icon }}</span>
                  <span class="next-pill-label">
                    {{ isEnChat ? pill.labelEn : pill.labelZh }}
                  </span>
                </button>
              </div>
            </div>
          </div>
          <!-- Git 变更预览卡：一轮运行结束且确有改动时追加，展示 agent 改了哪些文件 -->
          <div v-else-if="msg.kind === 'changes'" class="msg-row changes">
            <ChatChangesCard
              :files="msg.files"
              :at="msg.at"
              :branch="msg.branch"
              @refresh="refreshGitChanges(msg)"
            />
          </div>
          <!-- present 交付物卡：dsh present 工具显式向用户交付的关键产物或文档 -->
          <div v-else-if="msg.kind === 'present'" class="msg-row present">
            <div class="present-card">
              <div class="present-card-head">
                <span class="present-card-icon" aria-hidden="true">📦</span>
                <span class="present-card-title">{{ t('studio.chat.presentTitle') }}</span>
                <span class="present-card-count">{{ msg.files.length }}</span>
              </div>
              <ul class="present-file-list">
                <li v-for="file in msg.files" :key="file.path" class="present-file-item">
                  <div class="present-file-info" :title="file.path">
                    <span class="present-file-name">{{ assetFileName(file.path) }}</span>
                    <span v-if="file.caption" class="present-file-caption">{{ file.caption }}</span>
                    <span class="present-file-path">{{ file.path }}</span>
                  </div>
                  <div class="present-file-actions">
                    <button
                      type="button"
                      class="present-btn"
                      @click.stop="onOpenPresentFile(file.path, false)"
                    >
                      {{ t('studio.chat.presentOpenFile') }}
                    </button>
                    <button
                      type="button"
                      class="present-btn"
                      @click.stop="onOpenPresentFile(file.path, true)"
                    >
                      {{ t('studio.chat.presentRevealFile') }}
                    </button>
                  </div>
                </li>
              </ul>
            </div>
          </div>
          <div v-else-if="msg.kind === 'status'" class="msg-status">
            <ChatCopyIcon
              class="status-copy"
              :copied="copiedIndex === i"
              @copy="copyMessage(i, msg.text)"
            />
            <div class="bubble-text" v-chat-img v-html="renderInlineChatRefs(msg.text)" />
          </div>
          <div v-else-if="msg.kind === 'prompt'" class="msg-prompt">
            <div class="prompt-question" v-chat-img v-html="renderInlineChatRefs(msg.question)" />
            <div
              v-if="msg.hint"
              class="prompt-hint"
              v-chat-img
              v-html="renderInlineChatRefs(msg.hint)"
            />
            <div class="prompt-options">
              <button
                v-for="opt in promptOptions(msg)"
                :key="opt"
                class="prompt-option"
                :class="{ chosen: msg.answered === opt }"
                :disabled="msg.answered !== null && msg.answered !== undefined"
                @click="answerPrompt(msg, opt)"
              >
                {{ opt }}
              </button>
            </div>
            <!--
              自定义回答：模型给的选项就那几条，覆盖不到用户意图时不该被迫二选一。
              只在未答时出现；Enter 与按钮走**同一条**回传路径（含「未答才回传」的守卫）。
              `@keydown.stop` 是必须的：面板上还有全局键盘处理（斜杠菜单、快捷键），
              回车与方向键在输入框里不该被它们截走。
            -->
            <div v-if="msg.answered === null || msg.answered === undefined" class="prompt-custom">
              <input
                v-model="msg.draft"
                class="prompt-custom-input"
                type="text"
                :placeholder="t('studio.chat.promptCustomPlaceholder')"
                :aria-label="t('studio.chat.promptCustomPlaceholder')"
                @keydown.stop
                @keydown.enter.prevent="submitPromptDraft(msg)"
              />
              <button
                type="button"
                class="prompt-custom-send"
                :disabled="!(msg.draft ?? '').trim()"
                @click="submitPromptDraft(msg)"
              >
                {{ t('studio.chat.promptCustomSend') }}
              </button>
            </div>
            <div v-if="msg.answered !== null && msg.answered !== undefined" class="prompt-answered">
              {{ t('studio.chat.promptAnswered', { answer: msg.answered }) }}
            </div>
          </div>
          <!--
            审批卡：dsh 请求越过沙箱边界时出现。只有「允许一次 / 拒绝」两个选项 ——
            没有「总是允许」（dsh 的授权设计成一次性，持久化会静默放宽 agent 的权限面）。
          -->
          <div v-else-if="msg.kind === 'approval'" class="msg-prompt approval">
            <div class="prompt-question">{{ t('studio.chat.approvalTitle') }}</div>
            <div class="prompt-hint">
              {{ t('studio.chat.approvalTool', { tool: msg.toolName }) }}
            </div>
            <div v-if="msg.reason" class="prompt-hint approval-reason">{{ msg.reason }}</div>
            <div class="prompt-options">
              <button
                type="button"
                class="prompt-option"
                :class="{ chosen: msg.decision === 'allow-once' }"
                :disabled="msg.expired || (msg.decision !== null && msg.decision !== undefined)"
                @click="answerApprovalRequest(msg, 'allow-once')"
              >
                {{ t('studio.chat.approvalAllowOnce') }}
              </button>
              <button
                type="button"
                class="prompt-option"
                :class="{ chosen: msg.decision === 'reject' }"
                :disabled="msg.expired || (msg.decision !== null && msg.decision !== undefined)"
                @click="answerApprovalRequest(msg, 'reject')"
              >
                {{ t('studio.chat.approvalReject') }}
              </button>
            </div>
            <div v-if="msg.decision === 'allow-once'" class="prompt-answered">
              {{ t('studio.chat.approvalAllowedOnce') }}
            </div>
            <div v-else-if="msg.decision === 'reject'" class="prompt-answered">
              {{ t('studio.chat.approvalRejected') }}
            </div>
            <div v-else-if="msg.expired" class="prompt-answered">
              {{ t('studio.chat.approvalExpired') }}
            </div>
            <div class="prompt-hint">{{ t('studio.chat.approvalOnceHint') }}</div>
          </div>
          <!-- MCP 与工具操作流卡片：按实际调用时序在对话流中直接展示创建节点、删除节点、连线等操作 -->
          <div
            v-else-if="msg.kind === 'tool' && isInlineStreamTool(msg)"
            class="msg-row tool-stream-row"
          >
            <div class="tool-stream-card" :class="msg.state">
              <div class="tool-stream-head">
                <span class="task-dot" />
                <span class="tool-stream-title">{{ toolDisplayName(msg) }}</span>
                <span v-if="toolShortCode(msg)" class="task-code-badge">{{
                  toolShortCode(msg)
                }}</span>
                <span class="tool-stream-state">
                  {{
                    msg.state === 'start'
                      ? t('studio.chat.toolRunning')
                      : msg.state === 'done'
                        ? t('studio.chat.toolDone')
                        : t('studio.chat.toolFailed')
                  }}
                </span>
              </div>
              <ul v-if="toolSteps(msg).length" class="tool-stream-steps">
                <li
                  v-for="(step, sIdx) in toolSteps(msg)"
                  :key="sIdx"
                  class="tool-stream-step"
                  :class="`step-${stepKind(step)}`"
                >
                  <span class="tool-step-icon" aria-hidden="true">{{ stepIcon(step) }}</span>
                  <span class="tool-step-text">{{ step }}</span>
                </li>
              </ul>
              <div v-else-if="msg.detail" class="tool-stream-detail">
                {{ msg.detail }}
              </div>
            </div>
          </div>
        </template>
        <div v-if="running" class="msg-status running">
          <span class="dots"><i /><i /><i /></span>
        </div>
      </div>

      <button
        v-show="showScrollToBottom"
        type="button"
        class="chat-scroll-bottom"
        :title="t('studio.chat.scrollToBottom')"
        @click="scrollToBottomSmooth"
      >
        <svg
          class="chat-scroll-bottom-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </div>

    <div class="chat-input">
      <div
        class="chat-input-resize"
        role="separator"
        :aria-orientation="'horizontal'"
        :aria-valuemin="COMPOSER_HEIGHT_MIN"
        :aria-valuemax="COMPOSER_HEIGHT_MAX"
        :aria-valuenow="composerHeight"
        :aria-label="t('studio.chat.resizeComposer')"
        :title="t('studio.chat.resizeComposer')"
        @pointerdown="onComposerResizePointerDown"
        @pointermove="onComposerResizePointerMove"
        @pointerup="onComposerResizePointerUp"
        @pointercancel="onComposerResizePointerUp"
      />
      <!-- 发送队列：置于工具栏之上，执行中排队的消息在此列出，可立即发送（中断当前轮）或移除 -->
      <div v-if="sendQueue.length" class="send-queue">
        <div class="send-queue-head">
          <span class="send-queue-title">{{ t('studio.chat.queueTitle') }}</span>
          <span class="send-queue-count">{{ sendQueue.length }}</span>
          <span class="send-queue-hint">{{ t('studio.chat.queueHint') }}</span>
        </div>
        <ul class="send-queue-list">
          <li
            v-for="item in sendQueue"
            :key="item.id"
            class="send-queue-item"
            :class="{ forcing: item.forcing }"
          >
            <span class="send-queue-text" :title="item.text">{{ queuePreview(item.text) }}</span>
            <span v-if="item.forcing" class="send-queue-forcing">
              {{ t('studio.chat.queueForcing') }}
            </span>
            <span class="send-queue-actions">
              <!-- Stage 1：盘中实时转向（不中断当前轮次，直接注入） -->
              <button
                v-if="running"
                type="button"
                class="queue-btn steer"
                :disabled="item.forcing"
                :title="t('studio.chat.queueSteerNowTitle')"
                @click.stop="onSteerQueued(item.id)"
              >
                ⚡
              </button>
              <!-- 立即发送：中断当前轮，马上发这条。向上箭头与输入框的发送按钮同一隐喻 -->
              <button
                type="button"
                class="queue-btn"
                :disabled="item.forcing"
                :title="t('studio.chat.queueSendNowTitle')"
                @click.stop="forceQueuedSend(item.id)"
              >
                <svg
                  viewBox="0 0 16 16"
                  width="13"
                  height="13"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M8 13 V3.5" />
                  <path d="M4 7.5 L8 3.5 L12 7.5" />
                </svg>
              </button>
              <button
                type="button"
                class="queue-btn danger"
                :title="t('studio.chat.queueRemoveTitle')"
                @click.stop="removeQueued(item.id)"
              >
                <svg
                  viewBox="0 0 16 16"
                  width="13"
                  height="13"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.7"
                  stroke-linecap="round"
                  aria-hidden="true"
                >
                  <path d="M4.5 4.5 L11.5 11.5" />
                  <path d="M11.5 4.5 L4.5 11.5" />
                </svg>
              </button>
            </span>
          </li>
        </ul>
      </div>
      <div class="chat-toolbar">
        <!-- 统一技能面板：展示已安装的市场技能（含画布工作流模板）、GitHub 技能、项目技能与自定义技能 -->
        <div
          ref="skillsDropdownRef"
          class="skills-dropdown workflows-dropdown"
          :class="{ open: skillsOpen }"
        >
          <button
            type="button"
            class="skills-trigger"
            :class="{ active: skillsOpen }"
            :title="t('studio.chat.skillsTitle')"
            :aria-label="t('studio.chat.skills')"
            @click.stop="toggleSkills()"
          >
            <svg
              class="skills-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="m22 2-2 6-2-6h4Z" />
              <path d="M14 8 6 3l-4 4 5 8" />
              <path d="M8 8 3 12" />
              <circle cx="15" cy="19" r="4" />
              <circle cx="19" cy="15" r="4" />
              <path d="M3 21l3-3" />
            </svg>
            <span v-if="loadedSkillTotal > 0 || unifiedSkillsCount > 0" class="skills-badge">
              {{ loadedSkillTotal > 0 ? loadedSkillTotal : unifiedSkillsCount }}
            </span>
          </button>
          <div v-show="skillsOpen" class="skills-menu workflows-menu">
            <div class="skills-menu-head">
              <span>{{ t('studio.chat.skillsTitle') }}</span>
              <span v-if="unifiedSkillsCount > 0" class="skills-menu-meta">
                {{
                  t('studio.chat.skillsMeta', {
                    loaded: loadedSkillCount,
                    total: unifiedSkillsCount
                  })
                }}
              </span>
            </div>
            <p v-if="workflowsLoading && unifiedSkillsCount === 0" class="skills-empty">
              {{ t('studio.chat.workflowsLoading') }}
            </p>
            <p v-else-if="unifiedSkillsCount === 0" class="skills-empty">
              {{ t('studio.chat.skillsEmpty') }}
            </p>
            <template v-else>
              <ul v-if="installedWorkflows.length" class="workflow-cards">
                <li
                  v-for="workflow in installedWorkflows"
                  :key="workflow.id"
                  class="workflow-card"
                  :class="{ broken: workflow.broken, loaded: workflowLoadedHits(workflow) > 0 }"
                  :title="workflow.broken ? t('studio.chat.workflowBroken') : workflow.summary"
                  @click="insertWorkflowReference(workflow)"
                >
                  <span class="workflow-card-main">
                    <span class="workflow-card-title">
                      {{ workflow.title }}
                      <code>{{ workflow.id }}</code>
                      <span v-if="workflowLoadedHits(workflow) > 0" class="skill-hit-count">
                        ×{{ workflowLoadedHits(workflow) }}
                      </span>
                    </span>
                    <span class="workflow-card-summary">
                      {{
                        workflow.broken
                          ? t('studio.chat.workflowBroken')
                          : workflow.summary || t('studio.chat.workflowNoSummary')
                      }}
                    </span>
                    <span class="workflow-card-meta">
                      {{
                        t('studio.chat.workflowNodes', {
                          nodes: workflow.nodeCount,
                          edges: workflow.edgeCount
                        })
                      }}
                      · v{{ workflow.version }}
                    </span>
                  </span>
                  <span class="workflow-card-insert">{{
                    t('studio.chat.workflowInsertAction')
                  }}</span>
                </li>
              </ul>
              <ul v-if="standaloneSessionSkills.length" class="skills-list">
                <li
                  v-for="skill in standaloneSessionSkills"
                  :key="skill.name"
                  class="skill-item"
                  :class="{
                    loaded: (loadedSkills[skill.name] ?? 0) > 0,
                    invocable: skill.userInvocable !== false
                  }"
                  @click="insertSkillSlashCommand(skill)"
                >
                  <span class="skill-check">
                    {{ (loadedSkills[skill.name] ?? 0) > 0 ? '✓' : '' }}
                  </span>
                  <span class="skill-item-main">
                    <span class="skill-item-name">
                      {{ skill.titleZh || skill.name }}
                      <code v-if="skill.userInvocable !== false"
                        >/{{ skill.name
                        }}{{ skill.argumentHint ? ` ${skill.argumentHint}` : '' }}</code
                      >
                      <code v-else>{{ skill.name }}</code>
                      <code v-if="skill.context === 'fork'">fork</code>
                      <code v-if="skill.model">{{ skill.model }}</code>
                    </span>
                    <span class="skill-item-desc">{{ skill.description }}</span>
                  </span>
                  <span v-if="(loadedSkills[skill.name] ?? 0) > 0" class="skill-hit-count">
                    ×{{ loadedSkills[skill.name] }}
                  </span>
                </li>
              </ul>
            </template>
          </div>
        </div>
        <!-- 三模式选择：下拉式（Craft/Ask/Plan），触发按钮显示当前模式图标+名称+箭头 -->
        <div
          ref="modeDropdownRef"
          class="mode-dropdown"
          :class="{ open: modeOpen }"
          :title="t('studio.chat.modeTitle')"
        >
          <button
            type="button"
            class="mode-trigger"
            :disabled="running"
            @click.stop="modeOpen = !modeOpen"
          >
            <span class="mode-icon-box" :class="`mode-icon-${mode}`">
              <svg
                v-if="mode === 'craft'"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
                <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
                <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
                <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
                <path
                  d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"
                />
              </svg>
              <svg
                v-else-if="mode === 'ask'"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z" />
              </svg>
              <svg
                v-else
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
                <path
                  d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"
                />
                <path d="m9 14 2 2 4-4" />
              </svg>
            </span>
            <span class="mode-trigger-label">{{ currentModeLabel }}</span>
            <svg
              class="mode-chevron"
              :class="{ rotated: modeOpen }"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          <ul v-show="modeOpen" class="mode-menu">
            <li v-for="m in modeOptions" :key="m.value">
              <button
                type="button"
                class="mode-item"
                :class="{ active: mode === m.value }"
                @click.stop="selectMode(m.value)"
              >
                <span class="mode-icon-box" :class="`mode-icon-${m.value}`">
                  <svg
                    v-if="m.value === 'craft'"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
                    <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
                    <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
                    <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
                    <path
                      d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"
                    />
                  </svg>
                  <svg
                    v-else-if="m.value === 'ask'"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z" />
                  </svg>
                  <svg
                    v-else
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
                    <path
                      d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"
                    />
                    <path d="m9 14 2 2 4-4" />
                  </svg>
                </span>
                <span class="mode-item-label">{{ m.label }}</span>
                <svg
                  v-if="mode === m.value"
                  class="mode-check"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </button>
            </li>
          </ul>
        </div>
        <span class="toolbar-spacer" />
        <!--
          用量环与引用资产按钮**合成一个不可拆分的单元**。
          工具栏是 `flex-wrap: wrap`（面板由 dockview 承载、可拖窄），
          两者若各占一个 flex 项，窄面板下会被折到两行去。
          包成一个 flex 项后，要么都在第一行，要么整体折到下一行 —— 始终同行。
        -->
        <div class="toolbar-end">
          <!-- 会话定时提醒：当 dsh schedule 插件创建了会话内提醒时展示，支持查看与取消 -->
          <div
            v-if="sessionSchedules.length > 0"
            ref="scheduleDropdownRef"
            class="schedule-dropdown"
          >
            <button
              type="button"
              class="tool-btn schedule-trigger"
              :class="{ active: activeSchedules.length > 0 }"
              :title="t('studio.chat.scheduleTitle')"
              @click.stop="scheduleMenuOpen = !scheduleMenuOpen"
            >
              <span aria-hidden="true">⏰</span>
              <span class="schedule-badge">{{ activeSchedules.length }}</span>
            </button>
            <div v-show="scheduleMenuOpen" class="schedule-menu">
              <div class="schedule-menu-head">{{ t('studio.chat.scheduleTitle') }}</div>
              <p v-if="!sessionSchedules.length" class="schedule-empty">
                {{ t('studio.chat.scheduleEmpty') }}
              </p>
              <ul v-else class="schedule-list">
                <li
                  v-for="sch in sessionSchedules"
                  :key="sch.id"
                  class="schedule-item"
                  :class="sch.status"
                >
                  <div class="schedule-item-main">
                    <span class="schedule-item-summary">{{ sch.summary }}</span>
                    <span class="schedule-item-meta">
                      {{ sch.timing }}
                      <template v-if="sch.nextRunAt">
                        · {{ new Date(sch.nextRunAt).toLocaleTimeString() }}
                      </template>
                    </span>
                  </div>
                  <button
                    v-if="sch.status === 'active'"
                    type="button"
                    class="schedule-cancel-btn"
                    @click.stop="onCancelSchedule(sch.id)"
                  >
                    {{ t('studio.chat.scheduleCancel') }}
                  </button>
                </li>
              </ul>
            </div>
          </div>
          <div
            v-if="contextUsageText"
            class="context-usage"
            :class="{ warn: usageRatio >= 0.85, active: running }"
            :title="contextUsageText"
          >
            <div class="ctx-ring" :style="{ '--ctx-pct': ringPct }" aria-hidden="true" />
          </div>
          <button
            class="tool-btn mention"
            :title="t('studio.chat.mentionTitle')"
            @click="mentionOpen = true"
          >
            {{ t('studio.chat.mentionButton') }}
          </button>
        </div>
      </div>
      <div v-if="referenced.length" class="mention-chips">
        <span v-for="item in referenced" :key="item.path" class="mention-chip" :title="item.path">
          <img v-if="item.thumbUrl" class="chip-thumb" :src="item.thumbUrl" alt="" />
          <span v-else-if="item.type === 'voice'" class="chip-icon">🎵</span>
          <span v-else-if="item.type === 'model' || item.type === 'model3d'" class="chip-icon"
            >🧊</span
          >
          <span v-else class="chip-icon">📄</span>
          <span class="chip-name">{{ item.name }}</span>
          <button
            class="chip-remove"
            :title="t('studio.chat.removeMention')"
            @click="removeMention(item.path)"
          >
            ×
          </button>
        </span>
      </div>
      <div class="composer">
        <div
          v-show="slashOpen"
          class="slash-menu"
          role="listbox"
          :aria-label="t('studio.chat.slashMenu')"
        >
          <div class="slash-menu-title">{{ t('studio.chat.slashMenu') }}</div>
          <button
            v-for="(cmd, i) in slashItems"
            :key="cmd.id"
            type="button"
            class="slash-item"
            role="option"
            :class="{ active: i === slashIndex }"
            :aria-selected="i === slashIndex"
            @mousedown.prevent="applySlashCommand(cmd)"
            @mouseenter="slashIndex = i"
          >
            <span class="slash-name">
              {{ cmd.name }}
              <code v-if="'argumentHint' in cmd && cmd.argumentHint" class="slash-hint">{{
                cmd.argumentHint
              }}</code>
              <code v-if="'skillContext' in cmd && cmd.skillContext === 'fork'" class="slash-hint"
                >fork</code
              >
            </span>
            <span class="slash-desc">{{
              'descKey' in cmd ? t(`studio.chat.${cmd.descKey}`) : cmd.descText
            }}</span>
          </button>
          <div v-if="!slashItems.length" class="slash-empty">{{ t('studio.chat.slashEmpty') }}</div>
        </div>
        <div
          ref="inputRef"
          class="composer-editor"
          :class="{ composing }"
          :style="{ height: `${composerHeight}px` }"
          contenteditable="true"
          role="textbox"
          :aria-label="t('studio.chat.placeholder')"
          :data-placeholder="t('studio.chat.placeholder')"
          @input="onComposerInput"
          @paste="onComposerPaste"
          @drop.prevent="onComposerDrop"
          @dragover.prevent
          @compositionstart="composing = true"
          @compositionend="onCompositionEnd"
          @keydown.enter.exact.prevent="onComposerEnter"
          @keydown.escape.prevent="onComposerEscape"
          @keydown.arrow-down.exact="onSlashArrowKey($event, 1)"
          @keydown.arrow-up.exact="onSlashArrowKey($event, -1)"
          @keydown.tab.exact="onComposerTabKey"
        />
      </div>
      <!--
        会话管理与「模型」同一行。触发器是「历史」按钮而不是当前会话标题 ——
        标题已移到面板最上方的状态栏（那里才是「我在看哪段对话」该出现的位置），
        按钮因此可以做得紧凑，把宽度让给模型名。
      -->
      <div class="chat-actions">
        <div
          ref="sessionDropdownRef"
          class="session-dropdown"
          :class="{ open: sessionOpen }"
          :title="t('studio.chat.sessionSelect')"
        >
          <button
            type="button"
            class="tool-btn"
            :title="t('studio.chat.sessionSelect')"
            :aria-label="t('studio.chat.sessionSelect')"
            :disabled="running || !sessions.length"
            @click.stop="sessionOpen = !sessionOpen"
          >
            <span class="session-trigger-label">
              {{ t('studio.chat.sessionSelect') }}
            </span>
            <svg
              class="session-chevron"
              :class="{ rotated: sessionOpen }"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          <ul v-show="sessionOpen" class="session-menu">
            <li v-for="s in sessions" :key="s.id" class="session-list-item">
              <button
                type="button"
                class="session-item"
                :class="{ active: s.id === activeId }"
                @click.stop="selectSession(s.id)"
              >
                <span class="session-item-label">{{ s.title || t('studio.chat.newChat') }}</span>
                <svg
                  v-if="s.id === activeId"
                  class="session-check"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </button>
              <!--
                删除做成每项后面的 ×，而不是工具栏上一个「删当前会话」按钮 ——
                后者只能删当前那条，要先切过去才能删，且分不清删的是哪一个。
                注意：按钮不能嵌套，所以这一项是 li 里的两个并排按钮。
              -->
              <button
                type="button"
                class="session-item-remove"
                :title="t('studio.chat.deleteSession')"
                :aria-label="t('studio.chat.deleteSession')"
                :disabled="running"
                @click.stop="onDeleteSessionById(s.id)"
              >
                ×
              </button>
            </li>
          </ul>
        </div>
        <!-- 新建会话：纯图标（+），省下文字宽度；含义靠 title / aria-label 说明 -->
        <button
          class="tool-btn icon-only"
          :title="t('studio.chat.newSession')"
          :aria-label="t('studio.chat.newSession')"
          :disabled="running"
          @click="onNewSession"
        >
          <svg
            viewBox="0 0 16 16"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <path d="M8 3.5 V12.5" />
            <path d="M3.5 8 H12.5" />
          </svg>
        </button>
        <!-- 跨会话搜索：检索前端历史与底层 dsh SQLite / .jsonl.zstd 会话日志 -->
        <div ref="searchDropdownRef" class="search-dropdown">
          <button
            type="button"
            class="tool-btn icon-only"
            :title="t('studio.chat.searchSessionsTitle')"
            :aria-label="t('studio.chat.searchSessionsTitle')"
            @click.stop="searchModalOpen = !searchModalOpen"
          >
            <svg
              viewBox="0 0 16 16"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <circle cx="7" cy="7" r="4.2" />
              <path d="M10.2 10.2 L13.5 13.5" />
            </svg>
          </button>
          <div v-show="searchModalOpen" class="search-popover" @click.stop>
            <div class="search-input-row">
              <input
                v-model="searchQuery"
                type="text"
                class="search-input"
                :placeholder="t('studio.chat.searchSessionsPlaceholder')"
                @keydown.stop
                @keydown.enter.prevent="onRunSessionSearch"
              />
              <button
                type="button"
                class="search-go-btn"
                :disabled="searchBusy"
                @click="onRunSessionSearch"
              >
                {{ t('studio.chat.searchSessionsTitle') }}
              </button>
            </div>
            <div
              v-if="!searchHits.length && searchQuery.trim() && !searchBusy"
              class="search-empty"
            >
              {{ t('studio.chat.searchSessionsEmpty') }}
            </div>
            <ul v-else-if="searchHits.length" class="search-hit-list">
              <li
                v-for="hit in searchHits"
                :key="hit.sessionId"
                class="search-hit-item"
                @click="onSelectSearchHit(hit)"
              >
                <span class="search-hit-title">{{ hit.title || hit.sessionId }}</span>
                <span class="search-hit-snippet">{{ hit.snippet }}</span>
              </li>
            </ul>
          </div>
        </div>
        <!-- 导出当前会话为 dsh .zip 归档包 -->
        <button
          type="button"
          class="tool-btn icon-only"
          :disabled="!messages.length || exportBusy"
          :title="t('studio.chat.exportSession')"
          :aria-label="t('studio.chat.exportSession')"
          @click="onExportCurrentSession"
        >
          <svg
            viewBox="0 0 16 16"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M8 2.5 V10.5" />
            <path d="M5 7.5 L8 10.5 L11 7.5" />
            <path d="M3 13 H13" />
          </svg>
        </button>
        <div class="model-select-wrap">
          <span class="model-label">{{ t('studio.chat.model') }}</span>
          <div
            ref="modelDropdownRef"
            class="model-dropdown"
            :class="{ open: modelOpen }"
            :title="currentModel ? `${currentModel.providerLabel} · ${currentModel.label}` : ''"
          >
            <button
              type="button"
              class="model-trigger"
              :disabled="running || !modelOptions.length"
              @click.stop="modelOpen = !modelOpen"
              @focus="loadModels"
            >
              <span class="model-trigger-label">
                {{
                  currentModel
                    ? `${currentModel.providerLabel} · ${currentModel.label}`
                    : t('studio.chat.noModel')
                }}
              </span>
              <svg
                class="model-chevron"
                :class="{ rotated: modelOpen }"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <ul v-show="modelOpen" class="model-menu">
              <li v-for="m in modelOptions" :key="modelKey(m.providerId, m.id)">
                <button
                  type="button"
                  class="model-item"
                  :class="{ active: selectedKey === modelKey(m.providerId, m.id) }"
                  @click.stop="selectModel(modelKey(m.providerId, m.id))"
                >
                  <span class="model-item-label">{{ m.providerLabel }} · {{ m.label }}</span>
                  <svg
                    v-if="selectedKey === modelKey(m.providerId, m.id)"
                    class="model-check"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </button>
              </li>
            </ul>
          </div>
          <span v-if="!modelOptions.length" class="model-empty">{{
            t('studio.chat.noModel')
          }}</span>
        </div>
        <button
          v-if="running"
          class="btn icon-btn abort"
          :title="t('studio.chat.stop')"
          @click="onAbort"
        >
          <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">
            <rect x="4" y="4" width="8" height="8" rx="1.5" />
          </svg>
        </button>
        <button
          v-if="running && draft.trim()"
          type="button"
          class="btn steer-btn"
          :title="t('studio.chat.steerNowTitle')"
          @click="onSteerNow"
        >
          {{ t('studio.chat.steerNow') }}
        </button>
        <button
          v-if="!running || draft.trim()"
          class="btn icon-btn send"
          :disabled="!draft.trim()"
          :title="t('studio.chat.send')"
          @click="onSend"
        >
          <svg
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M8 12 V4" />
            <path d="M4.5 7.5 L8 4 L11.5 7.5" />
          </svg>
        </button>
      </div>
    </div>

    <ChatAssetPicker
      :open="mentionOpen"
      :excluded-paths="referenced.map((r) => r.path)"
      @confirm="onMentionConfirm"
      @cancel="mentionOpen = false"
    />

    <!-- 保存生成产物到资产库：选择目标文件夹与文件名（复用全局保存资产弹窗） -->
    <SaveAssetDialog
      ref="saveDialogRef"
      :open="saveDialogOpen"
      :default-name="saveDialogDefaultName"
      :default-folder-id="saveDialogDefaultFolderId"
      :title="t('studio.chat.saveToLibraryTitle')"
      :subtitle="t('studio.chat.saveToLibrarySubtitle')"
      @confirm="onSaveAssetConfirm"
      @cancel="closeSaveAssetDialog"
    />
  </div>
</template>

<style scoped>
.chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-panel);
  color: var(--text);
}

.chat-status {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-muted);
}

.chat-status .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
  background: var(--success);
}

/*
  顶部会话标题：可收缩 + ellipsis，右侧一条细分隔线把它和「就绪度 / 活动」区分开。
  `max-width` 防止长标题把状态信息挤没。
*/
.chat-status .chat-session-title {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 45%;
  padding-right: 6px;
  border-right: 1px solid var(--border);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-weight: 600;
}

.chat-status.warn .dot {
  background: var(--warning);
}

.chat-status .status-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 瞬时状态段：夹在「就绪度」与工作区之间，长文案截断而不是换行撑高状态栏 */
.chat-status .chat-activity {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-muted);
}

/* 等待类：与就绪度同色，靠左侧分隔点划开 */
.chat-status .chat-activity.waiting::before {
  content: '·';
  margin-right: 6px;
}

.chat-status .chat-activity.warn {
  color: var(--warning);
}

.chat-status .chat-activity.error {
  color: var(--danger);
}

.chat-status .chat-workspace {
  flex: none;
  margin-left: auto;
  max-width: 40%;
  padding: 0 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-elevated);
  font-size: 11px;
  color: var(--text-muted);
}

/* 任务清单：内嵌在消息流中跟随任务消息展示（agent 风格 todo 卡），状态实时更新 */
.task-list-card {
  margin: 2px 0 0;
  padding: 8px 10px 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel);
}

/* 默认折叠：标题行即 summary，可点开看每一步；收起时底部留白由 padding 收掉 */
.task-list-card:not([open]) {
  padding-bottom: 8px;
}

.task-list-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 4px;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
}

.task-list-card:not([open]) .task-list-title {
  margin-bottom: 0;
}

/* 原生 summary 的三角标记换成自绘，与卡片风格统一 */
.task-list-title::marker,
.task-list-title::-webkit-details-marker {
  display: none;
  content: '';
}

.task-list-title::before {
  content: '';
  flex: none;
  width: 0;
  height: 0;
  border-left: 4px solid currentColor;
  border-top: 3.5px solid transparent;
  border-bottom: 3.5px solid transparent;
  transition: transform 0.12s ease;
}

.task-list-card[open] .task-list-title::before {
  transform: rotate(90deg);
}

.task-list-summary {
  font-weight: 400;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.task-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.task-item {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--text-muted);
}

.task-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
  flex-shrink: 0;
}

.task-item.start .task-dot {
  background: var(--accent);
  animation: task-pulse 1.2s ease-in-out infinite;
}

.task-item.done .task-dot {
  background: var(--success);
}

.task-item.error .task-dot {
  background: var(--danger);
}

@keyframes task-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

.task-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-state {
  font-size: 11px;
  flex-shrink: 0;
}

/* 任务清单：工具调用详细参数（键值对），整行换行；执行中展开、完成后折叠 */
.task-params {
  flex: 1 1 100%;
  min-width: 0;
  margin: 2px 0 0 16px;
}

.task-params-summary {
  cursor: pointer;
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: none;
  -webkit-user-select: none;
}

.task-params[open] > .task-params-summary {
  margin-bottom: 2px;
}

.task-param-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 6px;
  border-left: 2px solid var(--border);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-muted);
}

.task-param {
  display: flex;
  gap: 6px;
  min-width: 0;
}

.task-param-key {
  flex-shrink: 0;
  color: var(--accent);
  opacity: 0.9;
}

.task-param-key::after {
  content: ':';
}

.task-param-value {
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

/* 无参数工具：折叠块内展开后展示 runner 给出的一行摘要 */
.task-params .task-detail {
  padding: 4px 6px;
  border-left: 2px solid var(--border);
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-muted);
  overflow-wrap: anywhere;
  word-break: break-word;
}

/* 子代理活动：嵌套在 subagent 卡片下，左侧竖线标出层级 */
.subagent-tools {
  flex: 1 1 100%;
  min-width: 0;
  margin: 2px 0 0 16px;
}

.subagent-tools-summary {
  cursor: pointer;
  font-size: 11px;
  color: var(--text-muted);
  user-select: none;
  -webkit-user-select: none;
}

.subagent-tool-list {
  list-style: none;
  margin: 4px 0 0;
  padding: 2px 0 2px 8px;
  border-left: 2px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.subagent-tool {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.subagent-tool .task-dot {
  width: 6px;
  height: 6px;
}

.subagent-tool.start .task-dot {
  background: var(--accent);
  animation: task-pulse 1.2s ease-in-out infinite;
}

.subagent-tool.done .task-dot {
  background: var(--success);
}

.subagent-tool.error .task-dot {
  background: var(--danger);
}

.subagent-tool .task-name {
  flex: 0 0 auto;
}

.subagent-tool-detail {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.8;
}

/* 任务清单内的资产预览更紧凑 */
.task-list .chat-asset-preview .chat-asset-media {
  max-height: 180px;
}

.task-code-badge {
  flex-shrink: 0;
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  line-height: 1.3;
}

.task-step-list,
.tool-stream-steps {
  flex: 1 1 100%;
  list-style: none;
  margin: 4px 0 2px 16px;
  padding: 4px 8px;
  border-left: 2px solid var(--border);
  background: var(--bg-panel);
  border-radius: 0 6px 6px 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.tool-stream-steps {
  margin: 6px 0 0;
}

.task-step-item,
.tool-stream-step {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text);
  word-break: break-word;
}

.tool-step-icon {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--text-muted);
}

.step-add .tool-step-icon {
  color: var(--success);
}

.step-delete .tool-step-icon {
  color: var(--danger);
}

.step-connect .tool-step-icon,
.step-run .tool-step-icon,
.step-update .tool-step-icon {
  color: var(--accent);
}

.tool-step-text {
  flex: 1 1 auto;
  min-width: 0;
}

.msg-row.tool-stream-row {
  justify-content: flex-start;
}

.tool-stream-card {
  width: 100%;
  min-width: 0;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  font-size: 12px;
}

.tool-stream-card.start .task-dot {
  background: var(--accent);
  animation: task-pulse 1.2s ease-in-out infinite;
}

.tool-stream-card.done .task-dot {
  background: var(--success);
}

.tool-stream-card.error .task-dot {
  background: var(--danger);
}

.tool-stream-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.tool-stream-title {
  flex: 1 1 auto;
  min-width: 0;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-stream-state {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.tool-stream-detail {
  margin-top: 4px;
  padding-left: 14px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-muted);
  word-break: break-word;
}

.chat-messages-wrap {
  flex: 1;
  min-height: 0;
  position: relative;
}

.chat-messages {
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.chat-scroll-bottom {
  position: absolute;
  right: 14px;
  bottom: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--bg-elevated);
  color: var(--text-muted);
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  transition:
    color 0.15s,
    border-color 0.15s,
    background 0.15s;
}

.chat-scroll-bottom:hover {
  color: var(--text);
  border-color: var(--accent);
}

.chat-scroll-bottom-icon {
  width: 14px;
  height: 14px;
}

.chat-empty {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  margin: auto 0;
  text-align: center;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-muted);
}

/* 环境未就绪时的具体原因（Node / dsh 运行体 / MCP / 模型），避免只看到顶部一行被截断的提示 */
.chat-empty-hint {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  text-align: left;
  color: var(--warning);
  word-break: break-word;
}

.msg-row {
  display: flex;
}

.msg-row.user {
  /* 纵向排列：操作条在上，气泡在下；两者都靠右对齐 */
  flex-direction: column;
  align-items: flex-end;
  justify-content: flex-end;
}

.bubble {
  position: relative;
  max-width: 88%;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  border: 1px solid var(--border);
  /* 覆盖全局 body { user-select: none }，支持拖选复制消息文字 */
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}

.bubble.user {
  background: var(--accent-18);
}

.bubble-text {
  word-break: break-word;
}

/* 用户气泡中内联的 @资产引用：高亮便于识别，非纯路径文本 */
.bubble.assistant {
  background: var(--bg-elevated);
  /* 边线与任务清单卡片保持一致（var(--border)） */
  width: 100%;
}

/* 独立资产预览卡：生成完成（图片/视频/音频/3D）追加到对话末尾 */
.msg-row.asset {
  justify-content: flex-start;
}

.asset-card {
  width: 100%;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel);
  overflow: hidden;
}

/* 可玩 HTML 产物卡：标题一行 + 唯一的「试玩」按钮 */
.game-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.game-card-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.game-card-icon {
  flex-shrink: 0;
  font-size: 13px;
  line-height: 1;
}

.game-card-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--text);
}

.play-btn {
  align-self: flex-start;
  padding: 4px 12px;
  border: 1px solid var(--accent, #4c8bf5);
  border-radius: 6px;
  background: transparent;
  color: var(--accent, #4c8bf5);
  font-size: 12px;
  cursor: pointer;
}

.play-btn:hover {
  background: color-mix(in srgb, var(--accent, #4c8bf5) 16%, transparent);
}

.asset-card-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 6px;
}

/* 已入库资产（Assets/ 下路径）的标记：替代无意义的「保存到资产库」按钮 */
.library-tag {
  font-size: 11px;
  color: var(--text-muted);
}

/* 同批次产物清单：默认收起，靠「含 N 个产物」角标展开，避免对话流里连排几乎相同的图 */
.asset-card-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
}

.asset-card-group li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 6px;
  border: 1px dashed var(--border);
  border-radius: 4px;
  background: var(--bg-elevated);
}

.asset-group-name {
  margin-right: auto;
  min-width: 0;
  overflow: hidden;
  font-size: 11px;
  color: var(--text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-btn {
  margin-right: auto;
  padding: 2px 10px;
  font-size: 11px;
  line-height: 1.6;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  cursor: pointer;
}

.group-btn::before {
  content: '▸';
  margin-right: 4px;
  font-size: 9px;
}

.group-btn.open::before {
  content: '▾';
}

.group-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.save-btn {
  padding: 2px 10px;
  font-size: 11px;
  line-height: 1.6;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  cursor: pointer;
}

.save-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}

.save-btn.saved {
  color: var(--success);
  border-color: var(--success);
  cursor: default;
}

.save-btn:disabled {
  opacity: 0.7;
  cursor: default;
}

.bubble pre {
  margin: 0;
  font: inherit;
  white-space: pre-wrap;
  word-break: break-word;
}

/* 思考过程：折叠在回答上方，默认收起，点击展开 */
.bubble .reasoning {
  margin: 0 0 8px;
  padding: 5px 8px;
  border: 1px dashed var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
}

.bubble .reasoning summary {
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
}

.bubble .reasoning pre {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--text-muted);
  max-height: 200px;
  overflow-y: auto;
}

/* 气泡上方的操作条：复制 / 重发等图标按钮，默认隐藏，鼠标移到该条消息上才浮现 */
.bubble-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 3px;
}

/* 图标按钮：正方形，尺寸与气泡内文字协调 */
.bubble-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  cursor: pointer;
  /* 默认隐身；隐藏时不接收点击，避免看不见的地方误触 */
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.12s ease,
    color 0.12s ease,
    border-color 0.12s ease,
    background 0.12s ease;
}

.bubble-action:hover {
  background: var(--bg-hover);
  color: var(--text);
}

/* hover 该条消息：浮现其操作按钮。三种消息类型各自的悬停容器不同 */
.msg-row.user:hover .bubble-action,
.bubble.assistant:hover .bubble-action,
.msg-status:hover .bubble-action {
  opacity: 1;
  pointer-events: auto;
}

/* 动作已生效（复制成功 / 已加入发送队列）：常显高亮，让用户看到反馈。
   放在 hover 规则之后，避免鼠标移开时反馈态被盖掉 */
.bubble-action.done {
  opacity: 1;
  pointer-events: auto;
  color: var(--success);
  border-color: var(--success);
}

/* 助手气泡的操作条：绝对定位到气泡右上角，不占正文流。
   正文留出右侧空间，避免长段落顶到按钮底下。 */
.bubble.assistant > .bubble-actions {
  position: absolute;
  top: 4px;
  right: 4px;
  margin: 0;
}

.bubble.assistant > .bubble-actions ~ .md-body {
  padding-right: 26px;
}

.msg-status {
  position: relative;
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
  line-height: 1.6;
  /* 给右上角常显的复制图标留位，长文本不会顶到它下面 */
  padding-right: 28px;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}

/* 状态行右上角的复制图标：表格行内绝对定位，不参与居中排版 */
.msg-status > .status-copy {
  position: absolute;
  top: 0;
  right: 0;
}

.msg-status.running {
  display: flex;
  justify-content: center;
  padding: 2px 0;
}

.dots i {
  display: inline-block;
  width: 5px;
  height: 5px;
  margin: 0 2px;
  border-radius: 50%;
  background: var(--text-muted);
  animation: chat-dots 1.2s infinite ease-in-out;
}

.dots i:nth-child(2) {
  animation-delay: 0.2s;
}

.dots i:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes chat-dots {
  0%,
  60%,
  100% {
    opacity: 0.3;
    transform: translateY(0);
  }
  30% {
    opacity: 1;
    transform: translateY(-3px);
  }
}

/* ask_user 提问卡：问题 + 选项按钮列表 + 已选状态 */
.msg-prompt {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 6px 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-input);
}

.prompt-question {
  font-size: 13px;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
  -webkit-user-select: text;
}

.prompt-hint {
  font-size: 12px;
  color: var(--text-muted);
  white-space: pre-wrap;
  word-break: break-word;
}

.prompt-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.prompt-option {
  border: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
  line-height: 1;
  padding: 6px 14px;
  border-radius: 999px;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background 0.15s;
}

.prompt-option:hover:not(:disabled) {
  border-color: var(--accent, var(--text-muted));
}

.prompt-option:disabled {
  cursor: default;
  opacity: 0.65;
}

.prompt-option.chosen {
  border-color: var(--accent, var(--text-muted));
  background: var(--accent, var(--bg-panel));
  font-weight: 600;
}

.prompt-answered {
  font-size: 12px;
  color: var(--text-muted);
  user-select: none;
  -webkit-user-select: none;
}

/* 自定义回答：与选项按钮同一套视觉语言，但刻意更低调 —— 选项仍是主路径，输入框是补充 */
.prompt-custom {
  display: flex;
  align-items: center;
  gap: 6px;
}

.prompt-custom-input {
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--text);
  font-size: 12px;
  font-family: inherit;
  padding: 6px 10px;
  border-radius: 6px;
  outline: none;
}

.prompt-custom-input:focus {
  border-color: var(--accent, var(--text-muted));
}

.prompt-custom-input::placeholder {
  color: var(--text-muted);
}

.prompt-custom-send {
  flex: none;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--text);
  font-size: 12px;
  line-height: 1;
  padding: 7px 12px;
  border-radius: 6px;
  cursor: pointer;
}

.prompt-custom-send:hover:not(:disabled) {
  border-color: var(--accent, var(--text-muted));
}

.prompt-custom-send:disabled {
  cursor: default;
  opacity: 0.5;
}

/* 审批卡：与提问卡同一套骨架，但用警告色边框 —— 它拦下的是一次权限扩张 */
.msg-prompt.approval {
  border-color: var(--warn, var(--accent, var(--border)));
}

.approval-reason {
  color: var(--text);
  font-family: var(--font-mono, monospace);
  user-select: text;
  -webkit-user-select: text;
}

.chat-input {
  position: relative;
  border-top: 1px solid var(--border);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 顶边拖条：向上拖可加高输入框 */
.chat-input-resize {
  position: absolute;
  top: -3px;
  left: 0;
  right: 0;
  height: 7px;
  z-index: 5;
  cursor: ns-resize;
  touch-action: none;
}

.chat-input-resize::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 50%;
  width: 36px;
  height: 3px;
  transform: translateX(-50%);
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-muted) 45%, transparent);
  opacity: 0;
  transition: opacity 0.12s ease;
}

.chat-input-resize:hover::after,
.chat-input-resize.dragging::after {
  opacity: 1;
}

.chat-input-resize.dragging::after {
  background: var(--accent);
}

/* 输入框上方工具栏：会话切换 / 新建 / 删除 / @ 引用资产 */
.chat-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  /* 窄面板下换行，而不是把按钮压扁 */
  flex-wrap: wrap;
}

/* 技能调试视图下拉：会话可用技能清单 + 已加载命中次数 */
.skills-dropdown {
  position: relative;
  flex: none;
  flex-shrink: 0;
}

/*
  技能 / 工作流触发器只显示图标（文字由 title / aria-label 承担）。
  因此内边距左右对称、并收到最小 —— 有徽标时宽度自然被徽标撑开。
*/
.skills-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 26px;
  height: 26px;
  padding: 0 6px;
  background: var(--bg-elevated, var(--bg-panel));
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  font: inherit;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition:
    background 0.15s,
    border-color 0.15s;
}

.skills-trigger:hover,
.skills-trigger.active {
  border-color: var(--text-muted);
}

.skills-icon {
  width: 14px;
  height: 14px;
  color: var(--text-muted);
  flex: none;
}

.skills-badge {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--accent, #4f7cff);
  color: #fff;
  font-size: 10px;
  line-height: 16px;
  text-align: center;
  flex: none;
}

.skills-menu {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  z-index: 30;
  width: 320px;
  max-height: 320px;
  overflow-y: auto;
  padding: 6px;
  margin: 0;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.32);
}

.skills-menu-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 4px 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.skills-menu-meta {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-muted);
}

.skills-empty {
  padding: 12px 8px;
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.skills-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.skill-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 6px;
  border-radius: 7px;
}

.skill-item:hover {
  background: var(--bg-elevated);
}

.skill-item.loaded {
  background: var(--bg-elevated);
}

.skill-check {
  flex: none;
  width: 15px;
  height: 15px;
  margin-top: 1px;
  border-radius: 50%;
  border: 1px solid var(--border);
  color: #fff;
  background: var(--accent, #4f7cff);
  font-size: 10px;
  line-height: 13px;
  text-align: center;
}

.skill-item:not(.loaded) .skill-check {
  background: transparent;
  border-color: var(--border);
}

.skill-item-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.skill-item-name {
  font-size: 12px;
  color: var(--text);
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
}

.skill-item-name code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  color: var(--text-muted);
}

.skill-item-desc {
  font-size: 11px;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.skill-hit-count {
  flex: none;
  font-size: 11px;
  font-weight: 600;
  color: var(--accent, #4f7cff);
  margin-top: 1px;
}

/*
  已安装工作流：沿用市场卡片的观感（标题 + id + 简介 + 规模），但更紧凑 ——
  这里是输入框上方的浮层，不是主界面。
*/
.workflows-menu {
  width: 360px;
  max-height: 340px;
}

.workflow-cards {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.workflow-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: var(--bg-elevated, var(--bg-panel));
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
}

.workflow-card:hover {
  border-color: var(--accent, #4f7cff);
}

/* 包损坏：仍然列出来（用户会奇怪「我明明装过」），但不可点、并说明原因 */
.workflow-card.broken {
  opacity: 0.6;
  cursor: not-allowed;
}

.workflow-card.broken:hover {
  border-color: var(--border);
}

.workflow-card-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}

.workflow-card-title {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  min-width: 0;
}

.workflow-card-title code {
  font-size: 10px;
  font-weight: 400;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workflow-card-summary {
  font-size: 11px;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.workflow-card-meta {
  font-size: 10px;
  color: var(--text-muted);
}

.workflow-card-insert {
  flex: none;
  font-size: 11px;
  font-weight: 600;
  color: var(--accent, #4f7cff);
}

/* 三模式选择下拉（Craft / Ask / Plan，参考截图：图标方块 + 文字 + 箭头） */
.mode-dropdown {
  position: relative;
  flex: none;
  flex-shrink: 0;
}

.mode-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px 4px 4px;
  background: var(--bg-elevated, var(--bg-panel));
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  font: inherit;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition:
    background 0.15s,
    border-color 0.15s;
}

.mode-trigger:hover:not(:disabled) {
  border-color: var(--text-muted);
}

.mode-trigger:disabled {
  cursor: default;
  opacity: 0.65;
}

.mode-icon-box {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  flex: none;
  overflow: hidden;
}

.mode-icon-box svg {
  width: 14px;
  height: 14px;
  display: block;
}

/* 三个模式图标方块同色（深色底 + 灰色图标），选中态由对勾与文字加粗体现 */
.mode-icon-craft,
.mode-icon-ask,
.mode-icon-plan {
  background: var(--bg-input);
  color: var(--text-muted);
  border: 1px solid var(--border);
}

.mode-trigger-label {
  font-weight: 600;
  letter-spacing: 0.01em;
}

.mode-chevron {
  width: 12px;
  height: 12px;
  color: var(--text-muted);
  flex: none;
  transition: transform 0.18s ease;
}

.mode-chevron.rotated {
  transform: rotate(180deg);
}

.mode-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 30;
  min-width: 168px;
  padding: 4px;
  margin: 0;
  list-style: none;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
}

.mode-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 9px;
  background: transparent;
  color: var(--text-muted);
  border: none;
  border-radius: 7px;
  font: inherit;
  font-size: 12px;
  line-height: 1;
  text-align: left;
  cursor: pointer;
  transition:
    background 0.12s,
    color 0.12s;
}

.mode-item:hover {
  background: var(--bg-elevated);
  color: var(--text);
}

.mode-item.active {
  color: var(--text);
  background: var(--bg-elevated);
  font-weight: 600;
}

.mode-item-label {
  flex: 1;
}

.mode-check {
  width: 13px;
  height: 13px;
  color: var(--accent, #8b5cf6);
  flex: none;
}

.session-dropdown {
  position: relative;
  flex: 1;
  min-width: 0;
}

/*
  触发器现在是 `.tool-btn`（固定四字「历史会话」+ 箭头），
  原先那套 `width: 100%` / `flex: 1` / ellipsis 的规则是给「显示长标题」用的，已无用。
*/
.session-trigger-label {
  white-space: nowrap;
}

.session-chevron {
  flex: none;
  width: 12px;
  height: 12px;
  color: var(--text-muted);
  transition: transform 0.18s ease;
}

.session-chevron.rotated {
  transform: rotate(180deg);
}

.session-menu {
  position: absolute;
  bottom: calc(100% + 6px);
  /*
    宽度必须**脱离触发器**独立指定：触发器现在是紧凑的「历史」按钮（约 60px），
    若继续用 `left: 0; right: 0` 跟随它，列表会被压成 60px 宽、标题全被截掉。
    `left: 0` + 固定宽度 = 从按钮左缘向右展开（它在行首，右侧有空间）。
  */
  left: 0;
  width: 140px;
  z-index: 30;
  max-height: 280px;
  overflow-y: auto;
  margin: 0;
  /* 内边距压到最小，把省下的宽度留给标题（列表项里还有 × 要占位） */
  padding: 3px;
  list-style: none;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
}

/*
  列表项 = 「选择」按钮 + 「删除 ×」并排（按钮不能嵌套，所以是两个兄弟按钮）。
  选择按钮吃掉宽度，× 固定大小。
*/
.session-list-item {
  display: flex;
  align-items: center;
  gap: 2px;
}

.session-list-item .session-item {
  flex: 1;
  min-width: 0;
  width: auto;
}

.session-item-remove {
  flex: none;
  width: 22px;
  height: 22px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--text-muted);
  border: none;
  border-radius: 6px;
  font: inherit;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}

.session-item-remove:hover:not(:disabled) {
  color: var(--danger, #ff5c5c);
  background: var(--bg-hover);
}

.session-item-remove:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.session-item {
  display: flex;
  align-items: center;
  /* 间距收紧：列表整体变窄后，内边距是唯一还能让给标题的空间（× 固定要占 22px） */
  gap: 6px;
  width: 100%;
  padding: 6px 7px;
  background: transparent;
  color: var(--text-muted);
  border: none;
  border-radius: 7px;
  font: inherit;
  font-size: 12px;
  line-height: 1.3;
  text-align: left;
  cursor: pointer;
  transition:
    background 0.12s ease,
    color 0.12s ease;
}

.session-item:hover {
  background: var(--bg-elevated);
  color: var(--text);
}

.session-item.active {
  background: var(--bg-elevated);
  color: var(--text);
  font-weight: 600;
}

.session-item-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-check {
  flex: none;
  width: 13px;
  height: 13px;
  color: var(--accent);
}

/*
  基础规则不再限定在 `.chat-toolbar` 下（样式块是 scoped，只影响本组件）。
  原先只写了 `.chat-toolbar .tool-btn`，导致「新建会话」按钮落在 `.chat-actions` 里
  完全没有样式 —— 一直是浏览器默认按钮外观。
*/
.tool-btn {
  /* flex 布局：按钮里普遍是「图标 + 文字」或「纯图标」，用行内块会出现基线错位 */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  flex: none;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.5;
  cursor: pointer;
}

.tool-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}

.tool-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

/* 纯图标按钮：正方、居中，与图标按钮同一尺度 */
.tool-btn.icon-only {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
}

.chat-toolbar .tool-btn.mention {
  color: var(--accent-fg);
  border-color: var(--accent-45);
  background: var(--accent-18);
  font-weight: 600;
  min-width: 30px;
  text-align: center;
}

/*
  会话管理独占一行。
  会话下拉 `flex: 1` 撑满剩余宽度（标题需要空间），新建 / 删除靠右紧跟其后。
*/
/*
  会话下拉与模型选择器共用一行。
  会话限宽（可收缩到 140px），把剩余宽度让给模型名；两者都能 ellipsis，因此压缩不会溢出。
*/
/*
  会话下拉现在是「历史」按钮，宽度由内容决定，不再吸收剩余空间
  （剩余宽度归模型选择器）。
*/
.chat-actions .session-dropdown {
  flex: none;
}

.chat-toolbar .toolbar-spacer {
  /*
    必须是真的可伸缩：它吸收工具行的剩余空间，把右侧那一组推到行尾。
  */
  flex: 1;
  width: auto;
}

/*
  「用量环 + 引用资产」单元：`flex: none` 让它作为一个整体参与换行 ——
  工具栏在窄面板下会折行，若不包起来，两者会被拆到两行。
*/
.chat-toolbar .toolbar-end {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}

/* 已引用资产 chips（输入框上方） */
.mention-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.mention-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 240px;
  padding: 2px 6px 2px 4px;
  border: 1px solid var(--accent-45);
  border-radius: 999px;
  background: var(--accent-18);
  color: var(--accent-fg);
  font-size: 11px;
  line-height: 1.6;
  white-space: nowrap;
  overflow: hidden;
}

/* 缩略图：图片/视频资产在 chip 内的小尺寸预览 */
.mention-chip .chip-thumb {
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  object-fit: cover;
  background: var(--bg-input);
}

.mention-chip .chip-icon {
  flex: none;
  font-size: 13px;
  line-height: 1;
  opacity: 0.85;
}

.mention-chip .chip-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.mention-chip .chip-remove {
  flex: none;
  width: 14px;
  height: 14px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  font-size: 13px;
  line-height: 14px;
  cursor: pointer;
}

.mention-chip .chip-remove:hover {
  background: color-mix(in srgb, var(--accent) 25%, transparent);
}

/* 发送队列：执行中排队的消息，位于输入框上方 */
.send-queue {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
}

.send-queue-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-muted);
}

.send-queue-title {
  font-weight: 600;
  color: var(--text);
}

.send-queue-count {
  min-width: 16px;
  padding: 0 5px;
  border-radius: 8px;
  background: var(--accent-18);
  color: var(--text);
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.send-queue-hint {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.send-queue-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.send-queue-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 6px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--text);
}

.send-queue-item:hover {
  background: var(--bg-hover);
}

/* 强制插队中：这一条正在等当前轮中断，给出进行态提示 */
.send-queue-item.forcing {
  border: 1px solid var(--accent);
  background: var(--accent-18);
}

.send-queue-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.send-queue-forcing {
  flex: none;
  font-size: 11px;
  color: var(--text-muted);
}

.send-queue-actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
}

/* 队列行内的操作按钮：纯图标正方形，提示走 title */
.queue-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  cursor: pointer;
  transition:
    color 0.12s ease,
    border-color 0.12s ease,
    background 0.12s ease;
}

.queue-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}

.queue-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.queue-btn.danger:hover:not(:disabled) {
  border-color: var(--danger);
  color: var(--danger);
}

/* 输入区：contenteditable 富文本，支持文本与图片内联引用混排 */
.composer {
  position: relative;
}

.slash-menu {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + 4px);
  z-index: 20;
  max-height: 220px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated, var(--bg-panel, var(--bg)));
  box-shadow: 0 8px 24px color-mix(in srgb, #000 28%, transparent);
  padding: 6px;
}

.slash-menu-title {
  padding: 4px 8px 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-muted);
  text-transform: uppercase;
}

.slash-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  margin: 0;
  padding: 8px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  font: inherit;
}

.slash-item:hover,
.slash-item.active {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
}

.slash-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.slash-hint {
  padding: 1px 5px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg-panel);
  font-size: 10px;
  font-weight: 400;
  color: var(--text-muted);
}

.skill-item.invocable {
  cursor: pointer;
}

.slash-desc {
  font-size: 12px;
  color: var(--text-muted);
}

.slash-empty {
  padding: 10px;
  font-size: 12px;
  color: var(--text-muted);
}

.composer-editor {
  width: 100%;
  min-height: 64px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px;
  background: var(--bg-input);
  color: var(--text);
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  box-sizing: border-box;
  outline: none;
  resize: none;
}

.composer-editor:focus {
  border-color: var(--accent-45);
}

/* 空输入时的占位提示 */
.composer-editor:empty::before {
  content: attr(data-placeholder);
  color: color-mix(in srgb, var(--text) 38%, transparent);
  pointer-events: none;
}

/* 输入法组合期间：保持实色显示，避免组合文本闪烁 */
.composer-editor.composing {
  color: var(--text);
}

.chat-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 6px;
}

.model-select-wrap {
  flex: 1 1 120px;
  min-width: 110px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.model-select-wrap .model-label {
  flex: none;
}

.model-dropdown {
  position: relative;
  flex: 1;
  min-width: 0;
}

.model-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  padding: 3px 6px;
  background: var(--bg-input);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.model-trigger:disabled {
  opacity: 0.55;
  cursor: default;
}

.model-trigger-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}

.model-chevron {
  flex: none;
  width: 12px;
  height: 12px;
  color: var(--text-muted);
  transition: transform 0.18s ease;
}

.model-chevron.rotated {
  transform: rotate(180deg);
}

.model-menu {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  left: 0;
  z-index: 30;
  min-width: 200px;
  max-height: 280px;
  overflow-y: auto;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);
}

.model-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 9px;
  background: transparent;
  color: var(--text-muted);
  border: none;
  border-radius: 7px;
  font: inherit;
  font-size: 12px;
  line-height: 1.3;
  text-align: left;
  cursor: pointer;
  transition:
    background 0.12s ease,
    color 0.12s ease;
}

.model-item:hover {
  background: var(--bg-elevated);
  color: var(--text);
}

.model-item.active {
  background: var(--bg-elevated);
  color: var(--text);
  font-weight: 600;
}

.model-item-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-check {
  flex: none;
  width: 13px;
  height: 13px;
  color: var(--accent);
}

.model-select-wrap .model-empty {
  flex: none;
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.btn {
  padding: 5px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.btn:hover:not(:disabled) {
  background: var(--bg-hover);
}

.btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.btn.send {
  background: var(--accent-18);
  border-color: var(--accent-45);
  color: var(--accent-fg);
}

.btn.send:hover:not(:disabled) {
  background: var(--accent-25);
}

.btn.abort {
  border-color: var(--danger);
  color: var(--danger-muted);
}

/* 圆形图标按钮（发送 / 停止），覆盖 .btn 默认 padding/border-radius */
.btn.icon-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  flex: 0 0 auto;
}

/* 上下文用量指示（Cursor 风格：环形进度条 + 百分比 · 已用 / 总额） */
.context-usage {
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: none;
  background: transparent;
}

/* 环形进度条：conic-gradient + mask 镂空成圆环，空用量时也显示完整淡环 */
.ctx-ring {
  flex: 0 0 auto;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: conic-gradient(var(--accent) var(--ctx-pct), var(--accent-12) 0);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 5px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 5px));
}

/*
  工具栏里的用量环按工具栏的按钮尺度收一档。
  28px 是照着发送按钮定的；工具栏按钮只有 ~24px，照搬会让它成为整行最高的元素、
  把工具栏顶高，看起来也不像「引用资产」的同伴。
*/
.chat-toolbar .ctx-ring {
  width: 24px;
  height: 24px;
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px));
}

.context-usage.warn {
  color: var(--danger);
  border-color: var(--danger);
}

.context-usage.warn .ctx-ring {
  background: conic-gradient(
    var(--danger) var(--ctx-pct),
    color-mix(in srgb, var(--danger) 12%, transparent) 0
  );
}

/* 生成中：进度环缓慢旋转，表示正在使用上下文 */
.context-usage.active .ctx-ring {
  animation: ctx-ring-spin 1.2s linear infinite;
}

@keyframes ctx-ring-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 自主目标状态条（Goal Bar） */
.harness-goal-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--accent) 10%, var(--bg-panel));
  font-size: 12px;
}

.harness-goal-bar.completed {
  background: color-mix(in srgb, var(--success) 10%, var(--bg-panel));
}

.harness-goal-bar.paused {
  background: color-mix(in srgb, var(--warning, #eab308) 10%, var(--bg-panel));
}

.goal-bar-main {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.goal-badge {
  flex: none;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--accent-25);
  color: var(--accent-fg);
  font-size: 11px;
  font-weight: 600;
}

.goal-objective {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}

.goal-rounds {
  flex: none;
  color: var(--text-muted);
  font-size: 11px;
}

.goal-bar-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}

.goal-btn {
  padding: 2px 7px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-input);
  color: var(--text);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.goal-btn:hover {
  border-color: var(--accent);
}

.goal-btn.primary {
  border-color: var(--accent);
  background: var(--accent-20);
  color: var(--accent-fg);
}

/* Todo 进度看板 */
.harness-todo-board {
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated, var(--bg-panel));
  font-size: 12px;
}

.todo-board-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 5px 10px;
  border: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}

.todo-board-title {
  font-weight: 600;
}

.todo-board-progress {
  color: var(--text-muted);
  font-size: 11px;
}

.todo-board-chevron {
  margin-left: auto;
  color: var(--text-muted);
  transition: transform 0.15s ease;
}

.todo-board-chevron.open {
  transform: rotate(180deg);
}

.todo-board-list {
  margin: 0;
  padding: 2px 10px 8px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 160px;
  overflow-y: auto;
}

.todo-board-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text);
}

.todo-board-item.completed {
  color: var(--text-muted);
  text-decoration: line-through;
}

.todo-board-item.in_progress {
  color: var(--accent-fg);
  font-weight: 500;
}

.todo-status-icon {
  flex: none;
  width: 14px;
  text-align: center;
}

.todo-item-content {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.todo-priority {
  flex: none;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--bg-input);
  color: var(--text-muted);
  font-size: 10px;
}

/* Present 交付物卡 */
.present-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-input);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.present-card-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
}

.present-card-count {
  padding: 0 6px;
  border-radius: 999px;
  background: var(--accent-20);
  color: var(--accent-fg);
  font-size: 11px;
}

.present-file-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.present-file-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
}

.present-file-info {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.present-file-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.present-file-caption {
  font-size: 11px;
  color: var(--text);
}

.present-file-path {
  font-size: 10px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.present-file-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}

.present-btn {
  padding: 3px 7px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-input);
  color: var(--text);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.present-btn:hover {
  border-color: var(--accent);
}

/* 会话定时提醒（Schedule Dropdown） */
.schedule-dropdown,
.search-dropdown {
  position: relative;
  display: inline-flex;
}

.schedule-trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.schedule-badge {
  font-size: 11px;
  font-weight: 600;
}

.schedule-menu,
.search-popover {
  position: absolute;
  bottom: calc(100% + 6px);
  right: 0;
  z-index: 35;
  width: 280px;
  max-height: 260px;
  overflow-y: auto;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.search-popover {
  left: 0;
  right: auto;
  width: 300px;
}

.schedule-menu-head {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 6px;
}

.schedule-list,
.search-hit-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.schedule-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 5px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 11px;
}

.schedule-item.deleted {
  opacity: 0.5;
  text-decoration: line-through;
}

.schedule-item-main {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.schedule-item-summary {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.schedule-item-meta {
  font-size: 10px;
  color: var(--text-muted);
}

.schedule-cancel-btn,
.search-go-btn {
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-input);
  color: var(--text);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.search-input-row {
  display: flex;
  gap: 4px;
  margin-bottom: 6px;
}

.search-input {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-input);
  color: var(--text);
  font: inherit;
  font-size: 12px;
}

.search-empty,
.schedule-empty {
  margin: 4px 0;
  font-size: 11px;
  color: var(--text-muted);
}

.search-hit-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 5px 6px;
  border-radius: 5px;
  cursor: pointer;
}

.search-hit-item:hover {
  background: var(--bg-hover);
}

.search-hit-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.search-hit-snippet {
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Stage 1：盘中实时转向徽标与按钮 */
.steered-badge {
  display: inline-block;
  margin-bottom: 4px;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--accent-fg);
  font-size: 10px;
  font-weight: 600;
}

.steer-btn {
  padding: 4px 8px;
  border: 1px solid var(--accent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent) 18%, var(--bg-input));
  color: var(--accent-fg);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.steer-btn:hover {
  background: color-mix(in srgb, var(--accent) 28%, var(--bg-input));
}

.queue-btn.steer {
  color: var(--accent-fg);
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
}

/* Stage 2：画布异步事件触发器横幅 */
.harness-canvas-event-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0 10px 6px;
  padding: 6px 10px;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent) 10%, var(--bg-panel));
  font-size: 12px;
}

.harness-canvas-event-bar.node_error {
  border-color: color-mix(in srgb, var(--danger, #e5534b) 55%, var(--border));
  background: color-mix(in srgb, var(--danger, #e5534b) 12%, var(--bg-panel));
}

.canvas-event-main {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.canvas-event-badge {
  flex: none;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--bg-input);
  font-size: 11px;
  font-weight: 600;
}

.canvas-event-summary {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}

.canvas-event-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}

.canvas-event-btn {
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-input);
  color: var(--text);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.canvas-event-btn.primary {
  border-color: var(--accent);
  color: var(--accent-fg);
}

.canvas-event-btn.danger {
  border-color: color-mix(in srgb, var(--danger, #e5534b) 65%, var(--border));
  color: var(--danger, #e5534b);
}

.canvas-event-dismiss {
  padding: 2px 6px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 14px;
}

/* Stage 3：子代理并发实时监控看板 */
.harness-subagent-board {
  margin: 0 10px 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel);
  overflow: hidden;
}

.subagent-board-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}

.subagent-board-title {
  font-weight: 600;
}

.subagent-board-summary {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-muted);
}

.subagent-board-list {
  margin: 0;
  padding: 0 10px 8px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.subagent-board-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  font-size: 11px;
}

.subagent-item-top {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.subagent-status-badge {
  flex: none;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  background: var(--bg-panel);
  color: var(--text-muted);
}

.subagent-status-badge.running {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--accent-fg);
}

.subagent-status-badge.completed {
  background: color-mix(in srgb, var(--success, #2da44e) 20%, transparent);
  color: var(--success, #2da44e);
}

.subagent-status-badge.error {
  background: color-mix(in srgb, var(--danger, #e5534b) 20%, transparent);
  color: var(--danger, #e5534b);
}

.subagent-type-tag {
  flex: none;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--bg-panel);
  font-family: var(--mono);
  font-size: 10px;
}

.subagent-desc {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}

.subagent-calls {
  flex: none;
  color: var(--text-muted);
  font-size: 10px;
}

.subagent-followup-toggle {
  flex: none;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-panel);
  color: var(--text);
  font: inherit;
  font-size: 10px;
  cursor: pointer;
}

.subagent-active-tool {
  font-size: 10px;
  color: var(--accent-fg);
  font-family: var(--mono);
}

.subagent-followup-row {
  display: flex;
  gap: 4px;
  margin-top: 2px;
}

.subagent-followup-input {
  flex: 1;
  min-width: 0;
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-panel);
  color: var(--text);
  font: inherit;
  font-size: 11px;
}

.subagent-followup-send {
  padding: 3px 8px;
  border: 1px solid var(--accent);
  border-radius: 4px;
  background: color-mix(in srgb, var(--accent) 18%, var(--bg-panel));
  color: var(--accent-fg);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
</style>

<style>
/* 输入区内联引用节点由 createMentionNode 动态创建，不带 scoped 的 data-v 属性，
   因此 scoped 样式对其不生效——这里用全局样式保证小缩略图正确渲染。
   类名 .editor-mention* 足够独特，不影响其它组件。 */
.editor-mention {
  display: inline-flex;
  align-items: center;
  vertical-align: text-bottom;
  max-width: 140px;
  margin: 0 1px;
  border-radius: 4px;
  overflow: hidden;
  cursor: default;
}

.editor-mention-img {
  display: block;
  width: auto;
  height: 24px;
  max-width: 120px;
  object-fit: cover;
  border-radius: 4px;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent);
  background: var(--bg-input);
}

.editor-mention-label {
  display: inline-block;
  padding: 0 6px;
  border: 1px solid var(--accent-45);
  border-radius: 4px;
  background: var(--accent-18);
  color: var(--accent-fg);
  font-size: 12px;
  line-height: 1.6;
  white-space: nowrap;
}

/* 输入区里的工作流引用块：同样由 DOM 动态创建，需要全局样式。
   形状按需求做成**胶囊**（图标 + 标题），不再把标题/id/简介摊成一行文本。 */
.editor-workflow-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  vertical-align: text-bottom;
  max-width: 240px;
  margin: 0 2px;
  padding: 1px 9px 1px 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
  line-height: 1.7;
  white-space: nowrap;
  cursor: default;
}

/* 悬停/聚焦时给出强调色边框：与截图里选中态一致，也提示"这是一整块、会一起删" */
.editor-workflow-chip:hover,
.editor-workflow-chip:focus-within {
  border-color: var(--accent);
  background: var(--bg-hover);
}

.editor-workflow-icon {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  color: var(--text-muted);
}

.editor-workflow-chip:hover .editor-workflow-icon {
  color: var(--accent);
}

.editor-workflow-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 对话消息气泡内图片卡片：v-html 注入的节点同样不带 scoped 的 data-v 属性，
   因此放在全局样式。用户要求发送出的图片以大卡片预览，不再用缩略图。 */
.chat-msg-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 240px;
  margin: 6px 0;
  padding: 6px;
  border-radius: 8px;
  background: var(--bg-input);
  box-shadow: 0 0 0 1px var(--border);
}

.chat-msg-card img {
  display: block;
  width: 100%;
  height: auto;
  max-height: 280px;
  object-fit: contain;
  border-radius: 6px;
}

.chat-msg-card img:not([src]),
.chat-msg-card img[src=''] {
  display: none;
}

.chat-msg-card-name {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 消息气泡内 `@路径` 文本 chip（v-html 注入，非 scoped；status/prompt 等消息同样适用） */
.inline-ref {
  color: var(--accent-fg);
  background: var(--accent-25);
  border-radius: 3px;
  padding: 0 3px;
  word-break: break-all;
}

/* 图片卡片本体是 span（避免块级元素出现在 <p> 里被浏览器拆包），卡片名要显式占一行 */
.chat-msg-card-name {
  display: block;
}

/* 助手气泡的 Markdown 正文（v-html 注入，非 scoped）。
   气泡本身是 pre-wrap（保留用户输入的换行），Markdown 的块级元素要改回普通空白处理。 */
.md-body {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text);
  white-space: normal;
  word-break: break-word;
}

.md-body > :first-child {
  margin-top: 0;
}

.md-body > :last-child {
  margin-bottom: 0;
}

.md-body p {
  margin: 0 0 8px;
}

.md-body h1,
.md-body h2,
.md-body h3,
.md-body h4,
.md-body h5,
.md-body h6 {
  margin: 12px 0 6px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
}

.md-body h1 {
  font-size: 16px;
}

.md-body h2 {
  font-size: 15px;
}

.md-body h3 {
  font-size: 14px;
}

.md-body ul,
.md-body ol {
  margin: 0 0 8px;
  padding-left: 20px;
}

.md-body li {
  margin: 2px 0;
}

.md-body blockquote {
  margin: 0 0 8px;
  padding-left: 10px;
  border-left: 2px solid var(--border);
  color: var(--text-muted);
}

.md-body hr {
  height: 1px;
  margin: 10px 0;
  border: none;
  background: var(--border);
}

.md-body a.md-link {
  color: var(--accent-fg);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.md-body table {
  display: block;
  width: max-content;
  max-width: 100%;
  overflow-x: auto;
  margin: 0 0 8px;
  border-collapse: collapse;
  font-size: 12px;
}

.md-body th,
.md-body td {
  padding: 3px 8px;
  border: 1px solid var(--border);
  text-align: left;
}

.md-body th {
  background: var(--bg-panel);
  font-weight: 600;
}

.md-code-inline {
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--bg-input);
  font-family: var(--mono);
  font-size: 12px;
}

.md-code {
  margin: 0 0 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--bg-panel);
}

.md-code-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 6px 2px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-input);
}

.md-code-lang {
  font-size: 11px;
  color: var(--text-muted);
}

.md-code-lang:empty {
  display: none;
}

.md-code-copy {
  display: inline-flex;
  align-items: center;
  padding: 2px 5px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
}

.md-code-copy:hover {
  border-color: var(--border);
  color: var(--text);
}

.md-code-copy .md-icon-done {
  display: none;
}

.md-code-copy.copied {
  color: var(--success);
}

.md-code-copy.copied .md-icon-copy {
  display: none;
}

.md-code-copy.copied .md-icon-done {
  display: block;
}

/* 代码块正文：按行展示（长行横向滚动），不受气泡普通换行处理影响 */
.md-body .md-pre {
  margin: 0;
  padding: 8px;
  overflow-x: auto;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre;
  word-break: normal;
  color: var(--text);
  background: none;
}

.md-body .md-pre code {
  font-family: inherit;
}

.chat-empty-hero {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  margin-bottom: 12px;
}

.chat-empty-title {
  font-size: 13px;
  color: var(--text-muted);
}

.zero-key-demo-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  box-sizing: border-box;
  padding: 12px 14px;
  border-radius: 10px;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, #f59e0b 16%, var(--bg-elevated)),
    color-mix(in srgb, #6366f1 16%, var(--bg-panel))
  );
  border: 1px solid color-mix(in srgb, #f59e0b 45%, var(--border));
  text-align: left;
}

.zero-key-demo-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 160px;
  flex: 1 1 180px;
}

.zero-key-demo-badge {
  align-self: flex-start;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  background: linear-gradient(135deg, #f59e0b, #ef4444);
  color: #fff;
}

.zero-key-demo-title {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--text);
}

.zero-key-demo-desc {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

.zero-key-demo-btn {
  flex-shrink: 0;
  padding: 7px 12px;
  border-radius: 8px;
  border: 1px solid rgba(251, 191, 36, 0.55);
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #fff;
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}

.zero-key-demo-btn:hover {
  filter: brightness(1.08);
}

.showcase-starter-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  text-align: left;
}

.showcase-starter-header {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--text-muted);
}

.showcase-starter-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr));
  gap: 8px;
  width: 100%;
}

.showcase-starter-card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  gap: 6px;
  padding: 10px 11px;
  border-radius: 9px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-elevated) 88%, transparent);
  color: var(--text);
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.16s ease,
    transform 0.16s ease;
}

.showcase-starter-card:hover {
  border-color: var(--accent);
  transform: translateY(-1px);
}

.showcase-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 6px;
}

.showcase-card-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  font-size: 13px;
}

.showcase-card-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
}

.showcase-card-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
  line-height: 1.3;
}

.showcase-card-desc {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.35;
}

.showcase-card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  width: 100%;
  min-width: 0;
  margin-top: auto;
  padding-top: 4px;
}

.showcase-card-pipeline {
  font-size: 10px;
  color: var(--text-muted);
  font-family: var(--mono);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.showcase-card-go {
  font-size: 10px;
  color: var(--accent);
}

.asset-next-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding-top: 6px;
  border-top: 1px dashed color-mix(in srgb, var(--border) 70%, transparent);
}

.next-action-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
  background: color-mix(in srgb, var(--accent) 10%, var(--bg-elevated));
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.next-action-pill:hover:not(:disabled) {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 22%, var(--bg-elevated));
}

.next-action-pill:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.next-pill-icon {
  font-size: 11px;
}
</style>
