<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AssetInfo, AssetType } from '@shared/domain'
import type { AskUserQuestion, ChatMode, HarnessEvent, HarnessStatus, McpActivity } from '@shared/ipc'
import { modalityConfig } from '@shared/modelProvider'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useChatHistory, type ChatMsg } from '../composables/useChatHistory'
import { resolveAssetPreviewUrl } from '../features/media/assetUrlCache'
import { copyTextToClipboard } from '../utils/copyText'
import { useProjectStore } from '../stores/project'
import { promptConfirm } from '../composables/useStudioPrompt'
import { estimateTokenCount } from '@shared/textTokens'
import ChatAssetPreview from './ChatAssetPreview.vue'
import ChatAssetPicker from './ChatAssetPicker.vue'

const CHAT_MODEL_KEY = 'studio.chat.model'
const CHAT_MODE_KEY = 'studio.chat.mode'
const CHAT_MODES: ChatMode[] = ['craft', 'ask', 'plan']

const { t } = useStudioI18n()

/** 历史会话：多会话持久化 + 输入框上方工具栏切换 */
const {
  sessions,
  activeId,
  activeSession,
  load: loadHistory,
  persist: persistHistory,
  create: createSession,
  remove: removeSession,
  activate: activateSession,
  commitMessages
} = useChatHistory()

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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 供 CSS background-image:url() 内联样式使用的转义（防止引号/括号破坏属性） */
function cssBackgroundUrl(url: string): string {
  return url
    .replace(/\\/g, '/')
    .replace(/'/g, '%27')
    .replace(/"/g, '%22')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\s/g, '%20')
}

/** 从当前激活会话恢复消息 */
function loadActiveMessages(): void {
  messages.value = activeSession.value?.messages ? [...activeSession.value.messages] : []
  // 切换会话后 harness 报告的上文不再适用，回退本地估算兜底
  harnessContextUsed.value = undefined
}

/** 切换会话：先保存当前，再加载目标 */
function onSessionChange(id: string): void {
  if (!id || id === activeId.value) return
  commitMessages([...messages.value])
  activateSession(id)
  loadActiveMessages()
  // 切换可能打断输入法组合（compositionend 丢失时 composing 残留，导致 Enter 无法发送），复位之
  composing.value = false
  scrollToBottom()
}

function onNewSession(): void {
  commitMessages([...messages.value])
  createSession()
  loadActiveMessages()
  draft.value = ''
  composing.value = false
  scrollToBottom()
  void nextTick(() => inputRef.value?.focus())
}

async function onDeleteSession(): Promise<void> {
  const session = activeSession.value
  if (!session) return
  // 用自绘确认弹窗替代 window.confirm：Windows 上原生 confirm/alert 关闭后主窗口会丢失
  // 键盘焦点（Electron 已知问题），导致输入框点击也无法聚焦，表现为「输入框不可输入」
  const ok = await promptConfirm({
    title: t('studio.chat.deleteSession'),
    message: t('studio.chat.deleteConfirm'),
    confirmLabel: t('common.delete')
  })
  if (!ok) return
  removeSession(session.id)
  // 同步清理磁盘上的 dsh 持久化记录，避免同 id 会话被「幽灵恢复」
  window.studio.deleteHarnessSession(session.id).catch(() => undefined)
  loadActiveMessages()
  draft.value = ''
  composing.value = false
  scrollToBottom()
  // 确认弹窗关闭后重新聚焦输入框，双保险规避焦点丢失
  void nextTick(() => inputRef.value?.focus())
}

/** 输入框内容变化：光标前是 @ 时弹出资产选择器（支持在指令文本中间引用） */
function onComposeInput(): void {
  if (mentionOpen.value || composing.value) return
  const el = inputRef.value
  const pos = el?.selectionStart ?? draft.value.length
  const before = draft.value.slice(0, pos)
  if (/@[^\s@]*$/.test(before)) mentionOpen.value = true
}

/** 音频没有可视化缩略图，chips 直接显示音符图标，不请求预览 URL */
function resolveMentionThumb(asset: AssetInfo): Promise<string> {
  if (asset.type === 'voice') return Promise.resolve('')
  const path = asset.thumbnailPath?.trim() || asset.relativePath?.trim() || ''
  if (!path) return Promise.resolve('')
  return resolveAssetPreviewUrl(path)
}

/**
 * @ 选择器确认：把 `@相对路径` 内联插入指令文本（替换触发用的 @，未触发时插入光标处），
 * 同时维护 referenced 列表供 chips 预览；dsh 会直接解析文本中的内联引用。
 */
function onMentionConfirm(paths: string[]): void {
  mentionOpen.value = false
  const el = inputRef.value
  const text = draft.value
  const pos = el?.selectionStart ?? text.length
  const at = text.lastIndexOf('@', pos - 1)
  // 仅当 @ 紧贴光标左侧（触发点）时替换；否则按普通文本处理，引用插入到光标处
  const replaceAt = at >= 0 && at === pos - 1
  const insertText = paths
    .map((p) => p.replace(/\\/g, '/').trim())
    .filter((p) => p.length > 0)
    .map((p) => `@${p}`)
    .join(' ')
  if (!insertText) return
  // 插入引用后始终补一个空格：既避免用户紧接着输入中文时被解析成同一路径（如
  // `@x.png生成个3d模型`），也避免光标留在 `@路径` 末尾时输入下一个字符再次触发
  // 资产选择器（onComposeInput 的 /@[^\s@]*$/ 匹配）；发送前会 trim，末尾空格无影响。
  // 仅当尾部已有空白或紧接另一个 @（连续引用）时不再补。
  const start = replaceAt ? at : pos
  const tail = text.slice(pos)
  const sep = !/^[\s@]/.test(tail) ? ' ' : ''
  draft.value = text.slice(0, start) + insertText + sep + tail
  // 引用去重 + chips 预览（与内联文本同步维护）
  const existing = new Set(referenced.value.map((r) => r.path))
  const known = new Map(
    project.assets.map((a) => [a.relativePath?.replace(/\\/g, '/').trim() ?? '', a])
  )
  for (const raw of paths) {
    const path = raw.replace(/\\/g, '/').trim()
    if (!path || existing.has(path)) continue
    existing.add(path)
    const asset = known.get(path)
    if (!asset) {
      referenced.value.push({
        path,
        name: path.split('/').pop() ?? path,
        type: 'image',
        thumbUrl: ''
      })
      continue
    }
    referenced.value.push({ path, name: asset.name, type: asset.type, thumbUrl: '' })
    void resolveMentionThumb(asset)
      .then((url) => {
        const item = referenced.value.find((r) => r.path === path)
        if (item) item.thumbUrl = url
      })
      .catch(() => {
        /* chips 保留图标 fallback */
      })
  }
  // 光标移到插入内容（含补的空格）之后，便于继续输入
  const cursor = start + insertText.length + sep.length
  void nextTick(() => {
    if (!el) return
    el.focus()
    el.setSelectionRange(cursor, cursor)
  })
}

/** 移除引用：chips 同步删除指令文本中的内联 `@路径` */
function removeMention(path: string): void {
  referenced.value = referenced.value.filter((r) => r.path !== path)
  draft.value = draft.value
    .replace(new RegExp(`@${escapeRegExp(path)}(?=[\\s@]|$)`, 'g'), '')
    .replace(/ {2,}/g, ' ')
    .trimStart()
}

/** 用户气泡富文本：转义后把内联 `@相对路径` 高亮为引用样式（仅展示，不改变原文本） */
function renderInlineRefs(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc.replace(/@([^\s@]+)/g, '<span class="inline-ref">@$1</span>')
}

/**
 * 发送文本：内联引用直接随文本发送（dsh 解析 @路径）；
 * 仅补充 chips 中未被文本引用的路径（兼容旧行为，用户手动删掉文本引用时不丢资产）。
 * 用子串判断是否已引用：路径后紧跟中文等非空白字符（如 `@x.png生成个3d模型`）
 * 时，按正则切分会把整段误判为路径导致“看似未引用”而重复追加，子串判断可避免。
 */
function buildTask(text: string): string {
  const extra = referenced.value
    .map((r) => r.path)
    .filter((p) => !text.includes(`@${p}`))
  if (!extra.length) return text
  return text + '\n\n' + extra.map((p) => `@${p}`).join('\n')
}

const messages = ref<ChatMsg[]>([])
/** harness provider 报告的最新真实上下文 token（每轮 LLM 请求完成后更新；切换会话后失效） */
const harnessContextUsed = ref<number | undefined>(undefined)
/** 当前 agent 模式：craft（完整执行）/ ask（纯问答）/ plan（先规划后执行），持久化到本地 */
const savedMode = localStorage.getItem(CHAT_MODE_KEY) as ChatMode | null
const mode = ref<ChatMode>(savedMode && CHAT_MODES.includes(savedMode) ? savedMode : 'craft')
watch(mode, (value) => {
  localStorage.setItem(CHAT_MODE_KEY, value)
})
const modeOptions = computed(() =>
  [
    { value: 'craft' as ChatMode, label: t('studio.chat.modeCraft') },
    { value: 'ask' as ChatMode, label: t('studio.chat.modeAsk') },
    { value: 'plan' as ChatMode, label: t('studio.chat.modePlan') }
  ]
)
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
/** 点击下拉外部或按 ESC 收起菜单：注册在 document 上避免 trigger 内 stopPropagation 误关 */
function onModeOutside(e: MouseEvent | KeyboardEvent): void {
  if (!modeOpen.value && !modelOpen.value) return
  if (e instanceof KeyboardEvent) {
    if (e.key === 'Escape') {
      modeOpen.value = false
      modelOpen.value = false
    }
    return
  }
  if (modeDropdownRef.value && !modeDropdownRef.value.contains(e.target as Node)) {
    modeOpen.value = false
  }
  if (modelDropdownRef.value && !modelDropdownRef.value.contains(e.target as Node)) {
    modelOpen.value = false
  }
}
const draft = ref('')
const inputRef = ref<HTMLTextAreaElement | null>(null)
const overlayRef = ref<HTMLElement | null>(null)
/** 输入法组合期间：textareas 恢复实色显示并隐藏覆盖层，避免组合文本在透明层上闪烁 */
const composing = ref(false)
const running = ref(false)
const status = ref<HarnessStatus | null>(null)
const listRef = ref<HTMLElement | null>(null)

/**
 * 任务清单：内嵌在消息流中，跟随各自任务的 user 消息展示（agent 风格 todo 卡）。
 * 返回第 userIndex 条 user 消息之后、下一条 user 消息之前的工具/生成活动卡；
 * 任务执行中状态实时更新，不持久化。
 */
function taskToolsAt(userIndex: number): Array<ChatMsg & { kind: 'tool' }> {
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
 * 输入区覆盖层 HTML：转义后的指令文本，其中内联 `@路径` 渲染为行内图片/图标预览。
 * 引用 token 文本保留（透明）占位，保证与 textarea 的换行逐字对齐；
 * 预览图绝对定位、宽度不参与布局，因此不改变换行。
 */
const draftPreview = computed<string>(() => {
  const esc = escapeHtml(draft.value)
  // 长路径优先替换为占位符，避免短路径是长路径前缀时破坏已生成的嵌套结构
  const refs = [...referenced.value].sort((a, b) => b.path.length - a.path.length)
  const hits: Array<[string, MentionAsset]> = []
  let html = esc
  for (const r of refs) {
    const token = escapeHtml(`@${r.path}`)
    if (!html.includes(token)) continue
    const ph = `\uE000${hits.length}\uE000`
    html = html.split(token).join(ph)
    hits.push([ph, r])
  }
  for (const [ph, r] of hits) {
    const media = r.thumbUrl
      ? `<span class="draft-ref-media" style="background-image:url('${cssBackgroundUrl(r.thumbUrl)}')"></span>`
      : `<span class="draft-ref-media draft-ref-ico">${r.type === 'voice' ? '🎵' : '📄'}</span>`
    html = html.split(ph).join(
      `<span class="draft-ref" title="${escapeHtml(r.path)}">` +
        `<span class="draft-ref-text">${escapeHtml(`@${r.path}`)}</span>${media}</span>`
    )
  }
  return html
})

/** 覆盖层与 textarea 同步滚动（字体/行高一致，行序对齐） */
function onComposerScroll(): void {
  const el = inputRef.value
  const ov = overlayRef.value
  if (!el || !ov) return
  ov.scrollTop = el.scrollTop
  ov.scrollLeft = el.scrollLeft
}

function onCompositionEnd(): void {
  composing.value = false
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
          label: catalog[id]?.name?.trim() || id,
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
    const ds = providers.find(
      (p) => p.providerKind === 'deepseek' && p.enabled && p.apiKey?.trim()
    )
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

/**
 * 常见文本模型上下文窗口（token）兜底：目录未携带 context_length 时使用，
 * 覆盖主流 OpenAI 兼容 provider 的常见模型 id（DeepSeek / Kimi / xAI / 智谱 / 千问 等）
 */
const MODEL_CONTEXT_FALLBACK: Record<string, number> = {
  'deepseek-chat': 65536,
  'deepseek-reasoner': 65536,
  'kimi-k2': 131072,
  'kimi-k2-turbo': 131072,
  'moonshot-v1-8k': 8192,
  'moonshot-v1-32k': 32768,
  'moonshot-v1-128k': 131072,
  'glm-4': 131072,
  'glm-4-plus': 131072,
  'glm-4-flash': 131072,
  'grok-3': 131072,
  'grok-3-mini': 131072,
  'grok-4': 131072,
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4.1': 1048576,
  'gpt-4.1-mini': 1048576,
  'o1': 200000,
  'o3': 200000,
  'claude-sonnet-4': 200000,
  'claude-sonnet-4-5': 200000,
  'claude-opus-4': 200000,
  'gemini-2.5-flash': 1048576,
  'gemini-2.5-pro': 1048576,
  'qwen-max': 32768,
  'qwen-plus': 131072,
  'qwen-turbo': 1000000,
  'qwen-long': 10000000
}

/** 未命中任何映射时的默认上下文窗口（token），与 DeepSeek 官方 64K 一致 */
const DEFAULT_CONTEXT_LENGTH = 64000

/** 当前模型的上下文窗口大小（token）；未选中模型时为 0（不显示用量指示） */
const contextTotal = computed<number>(() => {
  const m = currentModel.value
  if (!m) return 0
  const raw = m.contextLength
  return Number.isFinite(raw) && (raw as number) > 0 ? (raw as number) : DEFAULT_CONTEXT_LENGTH
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
  // 尚无 harness 数据（空闲期、恢复历史会话）时回退本地估算
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

/** 消息变化后防抖落盘历史会话（流式期间工具卡状态频繁更新，避免高频写 localStorage） */
watch(
  messages,
  () => {
    if (historyTimer !== null) window.clearTimeout(historyTimer)
    historyTimer = window.setTimeout(() => {
      commitMessages([...messages.value])
      persistHistory()
    }, 400)
  },
  { deep: true }
)

let stopEvent: (() => void) | null = null
let stopActivity: (() => void) | null = null
/** 本次任务在消息数组中的起点：状态更新只作用于该索引之后的工具卡，避免跨任务误更新重名卡 */
let sessionStart = 0
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
  () =>
    !!status.value?.nodeOk &&
    !!status.value?.mcpRunning &&
    !!status.value?.hasDeepseekKey
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

function pushStatus(text: string): void {
  messages.value.push({ kind: 'status', text })
  scrollToBottom()
}

/** 重新拉取 harness 状态；失败时保留上一次状态，不影响会话本身 */
async function refreshStatus(): Promise<void> {
  try {
    status.value = await window.studio.getHarnessStatus()
  } catch {
    // 状态刷新失败不影响会话本身：保留上一次状态
  }
}

function onHarnessEvent(event: HarnessEvent): void {
  switch (event.type) {
    case 'assistant':
      pushAssistant(event.text)
      break
    case 'status':
      pushStatus(event.text)
      break
    case 'tool': {
      // dsh-agent 等 harness 工具卡：同一会话内按 key 去重（优先 callId 实例，无则按名字回退），
      // 状态变更时原地更新，不要保留一张"执行中"的同时再新增一张"完成"
      const key = `tool:${event.id ?? event.name}`
      const prev = findToolByKey(key)
      if (prev) {
        prev.state = event.state
        prev.detail = event.detail
      } else {
        messages.value.push({
          kind: 'tool',
          key,
          name: event.name,
          ...(event.id ? { id: event.id } : {}),
          state: event.state,
          detail: event.detail
        })
      }
      scrollToBottom()
      break
    }
    case 'reasoning':
      // 思考过程：先于回答到达，暂存到下一次 assistant 消息上
      pendingReasoning = event.text
      break
    case 'context':
      // provider 报告的精确输入上下文 token：多轮会话为最新一次 LLM 请求的完整输入
      harnessContextUsed.value = event.used
      break
    case 'final': {
      // 流式期间文本已通过 assistant 事件实时显示，这里仅标记回答完成，避免覆盖丢失内容
      const last = messages.value[messages.value.length - 1]
      if (last?.kind === 'assistant') {
        last.final = true
      } else {
        pushAssistant(event.text, true)
      }
      break
    }
    case 'done':
      running.value = false
      break
    case 'error':
      pushStatus(event.message)
      running.value = false
      break
  }
}

/** 工具调用卡：dsh 通过 MCP 触发的生成活动，会话期间实时呈现 */
function onMcpActivity(activity: McpActivity): void {
  const state =
    activity.status === 'done' ? 'done' : activity.status === 'error' ? 'error' : 'start'
  const key = `mcp:${activity.id}`
  const prev = findToolByKey(key)
  if (prev) {
    // 已有卡时无条件更新状态，即使任务已结束也可能收到延迟的 done/error 回调
    prev.state = state
    prev.detail = activity.error
    // 完成且产出了资产：把落盘相对路径记到卡上，供卡内直接预览
    if (state === 'done' && activity.relativePath) {
      prev.relativePath = activity.relativePath
    }
    return
  }
  // 只有任务仍在运行时才新增 MCP 活动卡，避免结束时再产生孤立的工具卡
  if (!running.value) return
  messages.value.push({
    kind: 'tool',
    key,
    name: activity.title || activity.tool,
    state,
    detail: activity.error,
    ...(state === 'done' && activity.relativePath ? { relativePath: activity.relativePath } : {})
  })
  scrollToBottom()
}

let stopAskUser: (() => void) | null = null

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
async function answerPrompt(msg: ChatMsg & { kind: 'prompt' }, option: string): Promise<void> {
  if (msg.answered !== null && msg.answered !== undefined) return
  msg.answered = option
  try {
    await window.studio.answerAskUser({ requestId: msg.requestId, answer: option })
  } catch {
    // 主进程侧已超时 / 会话已结束：按钮已锁定，无副作用
  }
}

async function onSend(): Promise<void> {
  if (composing.value) return
  const raw = draft.value.trim()
  if (!raw || running.value) return
  // 发送前重新预检一次（Node 版本 / dsh 运行体 / MCP 服务 / 模型），
  // 不用挂载时的旧快照判断，避免按过期的“就绪”放行后才发现环境缺失
  await refreshStatus()
  // 环境未就绪时不静默丢弃：把原因作为状态消息告知用户
  if (!ready.value) {
    pushStatus(status.value?.message ?? t('studio.chat.unavailable'))
    return
  }
  const task = buildTask(raw)
  draft.value = ''
  referenced.value = []
  pendingReasoning = ''
  sessionStart = messages.value.length
  messages.value.push({ kind: 'user', text: task })
  scrollToBottom()
  running.value = true
  // 发送即落盘，避免依赖防抖窗口导致会话丢失
  commitMessages([...messages.value])
  persistHistory()
  const { providerId, modelId } = splitModelKey(selectedKey.value)
  const result = await window.studio.runHarnessTask({
    task,
    // 会话 id：dsh 据此恢复/创建持久化 session，模型通过原生会话历史记住之前的聊天内容
    sessionId: activeSession.value?.id,
    model: modelId.trim() || undefined,
    ...(providerId ? { providerId } : {}),
    // 当前 agent 模式：main 进程按 craft/ask/plan 切换 dsh 的 system-prompt
    mode: mode.value
  })
  if (!result.started) {
    pushStatus(result.message ?? 'failed to start')
    running.value = false
    // 启动被主进程预检查拒绝（如 MCP 已停、Node 不达标），同步状态栏
    void refreshStatus()
  }
}

async function onAbort(): Promise<void> {
  await window.studio.abortHarnessTask()
}

onMounted(async () => {
  // 恢复历史会话（上次会话或新建），再订阅事件流
  loadHistory()
  loadActiveMessages()
  stopEvent = window.studio.onHarnessEvent(onHarnessEvent)
  stopActivity = window.studio.onMcpActivityUpdated(onMcpActivity)
  stopAskUser = window.studio.onAskUser(handleAskUser)
  // 模式选择下拉：点外部或 ESC 收起；用 document 监听，trigger 用 .stop 防止冒泡立即关
  document.addEventListener('click', onModeOutside)
  document.addEventListener('keydown', onModeOutside)
  // 打开面板即做一次环境预检，未就绪时在面板顶部与空状态区给出具体原因
  await refreshStatus()
  await loadModels()
})

onBeforeUnmount(() => {
  stopEvent?.()
  stopActivity?.()
  stopAskUser?.()
  document.removeEventListener('click', onModeOutside)
  document.removeEventListener('keydown', onModeOutside)
  if (copyTimer !== null) window.clearTimeout(copyTimer)
  if (historyTimer !== null) window.clearTimeout(historyTimer)
  // 卸载前把当前消息落盘，避免切换面板丢失最后一段对话
  commitMessages([...messages.value])
  persistHistory()
})
</script>

<template>
  <div class="chat-panel">
    <div
      class="chat-status"
      :class="{ warn: statusWarn }"
    >
      <span class="dot" />
      <span class="status-text">{{ statusText }}</span>
      <span
        v-if="workspace"
        class="chat-workspace"
        :title="workspace"
      >{{ workspaceLabel }}</span>
    </div>

    <div
      ref="listRef"
      class="chat-messages"
    >
      <div
        v-if="!messages.length"
        class="chat-empty"
      >
        {{ t('studio.chat.empty') }}
        <div
          v-if="statusWarn && status?.message"
          class="chat-empty-hint"
        >
          {{ status.message }}
        </div>
      </div>
      <template
        v-for="(msg, i) in messages"
        :key="i"
      >
        <template v-if="msg.kind === 'user'">
          <div class="msg-row user">
            <div class="bubble user">
              <span v-html="renderInlineRefs(msg.text)" />
              <button
                class="copy-btn"
                :class="{ copied: copiedIndex === i }"
                :title="t('studio.chat.copyTitle')"
                @click.stop="copyMessage(i, msg.text)"
              >
                {{ copiedIndex === i ? t('studio.chat.copied') : t('studio.chat.copy') }}
              </button>
            </div>
          </div>
          <!-- 任务清单：跟随任务消息内嵌展示（agent 风格），状态实时更新 -->
          <div
            v-if="taskToolsAt(i).length"
            class="task-list-card"
          >
            <div class="task-list-title">{{ t('studio.chat.taskList') }}</div>
            <ul class="task-list">
              <li
                v-for="tm in taskToolsAt(i)"
                :key="tm.key"
                class="task-item"
                :class="tm.state"
                :title="tm.detail"
              >
                <span class="task-dot" />
                <span class="task-name">{{ tm.name }}</span>
                <span class="task-state">
                  {{ tm.state === 'start' ? t('studio.chat.toolRunning') : tm.state === 'done' ? t('studio.chat.toolDone') : t('studio.chat.toolFailed') }}
                </span>
                <ChatAssetPreview
                  v-if="tm.state === 'done' && tm.relativePath"
                  :relative-path="tm.relativePath"
                />
              </li>
            </ul>
          </div>
        </template>
        <div
          v-else-if="msg.kind === 'assistant'"
          class="msg-row assistant"
        >
          <div class="bubble assistant">
            <details
              v-if="msg.reasoning"
              class="reasoning"
            >
              <summary>{{ t('studio.chat.thinking') }}</summary>
              <pre>{{ msg.reasoning }}</pre>
            </details>
            <pre>{{ msg.text }}</pre>
            <button
              class="copy-btn"
              :class="{ copied: copiedIndex === i }"
              :title="t('studio.chat.copyTitle')"
              @click.stop="copyMessage(i, msg.text)"
            >
              {{ copiedIndex === i ? t('studio.chat.copied') : t('studio.chat.copy') }}
            </button>
          </div>
        </div>
        <div
          v-else-if="msg.kind === 'status'"
          class="msg-status"
        >
          {{ msg.text }}
          <button
            class="copy-btn"
            :class="{ copied: copiedIndex === i }"
            :title="t('studio.chat.copyTitle')"
            @click.stop="copyMessage(i, msg.text)"
          >
            {{ copiedIndex === i ? t('studio.chat.copied') : t('studio.chat.copy') }}
          </button>
        </div>
        <div
          v-else-if="msg.kind === 'prompt'"
          class="msg-prompt"
        >
          <div class="prompt-question">{{ msg.question }}</div>
          <div
            v-if="msg.hint"
            class="prompt-hint"
          >
            {{ msg.hint }}
          </div>
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
          <div
            v-if="msg.answered !== null && msg.answered !== undefined"
            class="prompt-answered"
          >
            {{ t('studio.chat.promptAnswered', { answer: msg.answered }) }}
          </div>
        </div>
      </template>
      <div
        v-if="running"
        class="msg-status running"
      >
        <span class="dots"><i /><i /><i /></span>
      </div>
    </div>

    <div class="chat-input">
      <div class="chat-toolbar">
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
            <span
              class="mode-icon-box"
              :class="`mode-icon-${mode}`"
            >
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
                <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
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
                <rect
                  width="8"
                  height="4"
                  x="8"
                  y="2"
                  rx="1"
                  ry="1"
                />
                <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
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
          <ul
            v-show="modeOpen"
            class="mode-menu"
          >
            <li
              v-for="m in modeOptions"
              :key="m.value"
            >
              <button
                type="button"
                class="mode-item"
                :class="{ active: mode === m.value }"
                @click.stop="selectMode(m.value)"
              >
                <span
                  class="mode-icon-box"
                  :class="`mode-icon-${m.value}`"
                >
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
                    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
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
                    <rect
                      width="8"
                      height="4"
                      x="8"
                      y="2"
                      rx="1"
                      ry="1"
                    />
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
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
        <select
          :value="activeId"
          class="session-select"
          :title="t('studio.chat.sessionSelect')"
          :disabled="running || !sessions.length"
          @change="onSessionChange(($event.target as HTMLSelectElement).value)"
        >
          <option
            v-for="s in sessions"
            :key="s.id"
            :value="s.id"
          >
            {{ s.title || t('studio.chat.newChat') }}
          </option>
        </select>
        <button
          class="tool-btn"
          :title="t('studio.chat.newSession')"
          :disabled="running"
          @click="onNewSession"
        >
          {{ t('studio.chat.newSession') }}
        </button>
        <button
          v-if="sessions.length > 1"
          class="tool-btn"
          :title="t('studio.chat.deleteSession')"
          :disabled="running"
          @click="onDeleteSession"
        >
          {{ t('studio.chat.deleteSession') }}
        </button>
        <span class="toolbar-spacer" />
        <button
          class="tool-btn mention"
          :disabled="running"
          @click="mentionOpen = true"
        >
          {{ t('studio.chat.mentionButton') }}
        </button>
      </div>
      <div
        v-if="referenced.length"
        class="mention-chips"
      >
        <span
          v-for="item in referenced"
          :key="item.path"
          class="mention-chip"
          :title="item.path"
        >
          <img
            v-if="item.thumbUrl"
            class="chip-thumb"
            :src="item.thumbUrl"
            alt=""
          >
          <span
            v-else-if="item.type === 'voice'"
            class="chip-icon"
          >🎵</span>
          <span
            v-else
            class="chip-icon"
          >📄</span>
          <span class="chip-name">{{ item.name }}</span>
          <button
            class="chip-remove"
            :title="t('studio.chat.removeMention')"
            @click="removeMention(item.path)"
          >×</button>
        </span>
      </div>
      <div class="composer">
        <div
          v-show="!composing"
          ref="overlayRef"
          class="composer-overlay"
          v-html="draftPreview"
        />
        <textarea
          ref="inputRef"
          v-model="draft"
          rows="3"
          :placeholder="t('studio.chat.placeholder')"
          :disabled="running"
          :class="{ composing }"
          @input="onComposeInput"
          @scroll="onComposerScroll"
          @compositionstart="composing = true"
          @compositionend="onCompositionEnd"
          @keydown.enter.exact.prevent="onSend"
        />
      </div>
      <div class="chat-actions">
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
                {{ currentModel ? `${currentModel.providerLabel} · ${currentModel.label}` : t('studio.chat.noModel') }}
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
              ><path d="m6 9 6 6 6-6" /></svg>
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
                  ><path d="M20 6 9 17l-5-5" /></svg>
                </button>
              </li>
            </ul>
          </div>
          <span
            v-if="!modelOptions.length"
            class="model-empty"
          >{{ t('studio.chat.noModel') }}</span>
        </div>
        <div
          v-if="contextUsageText"
          class="context-usage"
          :class="{ warn: usageRatio >= 0.85, active: running }"
          :title="contextUsageText"
        >
          <div
            class="ctx-ring"
            :style="{ '--ctx-pct': ringPct }"
            aria-hidden="true"
          />
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
          v-else
          class="btn icon-btn send"
          :disabled="!draft.trim()"
          :title="t('studio.chat.send')"
          @click="onSend"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
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

.chat-status.warn .dot {
  background: var(--warning);
}

.chat-status .status-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.task-list-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 4px;
  user-select: none;
  -webkit-user-select: none;
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

/* 任务清单内的资产预览更紧凑 */
.task-list .chat-asset-preview .chat-asset-media {
  max-height: 180px;
}

.chat-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.chat-empty {
  margin: auto;
  max-width: 240px;
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
  /* 覆盖全局 body { user-select: none }，支持拖选复制消息文字 */
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}

.bubble.user {
  background: var(--accent-18);
}

/* 用户气泡中内联的 @资产引用：高亮便于识别，非纯路径文本 */
.bubble.user .inline-ref {
  color: var(--accent-fg);
  background: var(--accent-25);
  border-radius: 3px;
  padding: 0 3px;
  word-break: break-all;
}

.bubble.assistant {
  background: var(--bg-elevated);
  width: 100%;
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

.copy-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  padding: 2px 8px;
  font-size: 11px;
  line-height: 1.5;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.msg-row:hover .copy-btn {
  opacity: 1;
}

.copy-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.copy-btn.copied {
  opacity: 1;
  color: var(--success);
  border-color: var(--success);
}

.msg-status {
  position: relative;
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
  line-height: 1.6;
  padding-right: 28px;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}

.msg-status.running {
  display: flex;
  justify-content: center;
  padding: 2px 0;
}

.msg-status:hover .copy-btn {
  opacity: 1;
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

.chat-input {
  border-top: 1px solid var(--border);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 输入框上方工具栏：会话切换 / 新建 / 删除 / @ 引用资产 */
.chat-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
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

.chat-toolbar .session-select {
  flex: 1;
  min-width: 0;
  padding: 3px 6px;
  background: var(--bg-input);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  font: inherit;
  font-size: 12px;
}

.chat-toolbar .session-select:disabled {
  opacity: 0.55;
  cursor: default;
}

.chat-toolbar .tool-btn {
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

.chat-toolbar .tool-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}

.chat-toolbar .tool-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.chat-toolbar .tool-btn.mention {
  color: var(--accent-fg);
  border-color: var(--accent-45);
  background: var(--accent-18);
}

.chat-toolbar .toolbar-spacer {
  flex: none;
  width: 1px;
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

/* 输入区：textarea 文本透明（由覆盖层显示），保留光标/滚动/选区，引用 token 仍可编辑 */
.chat-input textarea {
  position: relative;
  z-index: 2;
  width: 100%;
  resize: none;
  background: transparent;
  color: transparent;
  caret-color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px;
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
  box-sizing: border-box;
  scrollbar-width: none;
}

/* 隐藏滚动条但不禁止滚动：保证内容宽度与覆盖层一致（滚动条会吃掉内容宽度导致换行错位） */
.chat-input textarea::-webkit-scrollbar {
  display: none;
}

.chat-input textarea:focus {
  outline: none;
  border-color: var(--accent-45);
}

/* 输入法组合期间：textarea 恢复实色，隐藏覆盖层，避免组合文本闪烁 */
.chat-input textarea.composing {
  color: var(--text);
}

.composer {
  position: relative;
}

/* 覆盖层：与 textarea 同字体/内边距/换行，逐字对齐；仅展示不拦截事件 */
.composer-overlay {
  position: absolute;
  inset: 0;
  z-index: 1;
  overflow: hidden;
  pointer-events: none;
  background: var(--bg-input);
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 8px;
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
  box-sizing: border-box;
}

/* 内联引用：透明文本保留宽度保证换行一致；预览图/图标绝对定位叠加显示 */
.draft-ref {
  position: relative;
  display: inline-block;
  vertical-align: text-bottom;
}

.draft-ref-text {
  color: transparent;
}

.draft-ref-media {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  height: 18px;
  max-width: 96px;
  border-radius: 3px;
  background-color: var(--bg-input);
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
}

.draft-ref-ico {
  font-size: 13px;
  line-height: 18px;
  background: none;
}

.chat-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.model-select-wrap {
  flex: 1;
  min-width: 0;
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
</style>
