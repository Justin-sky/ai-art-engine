<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AssetInfo, AssetType } from '@shared/domain'
import type { HarnessEvent, HarnessStatus, McpActivity } from '@shared/ipc'
import { modalityConfig } from '@shared/modelProvider'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useChatHistory, type ChatMsg } from '../composables/useChatHistory'
import { resolveAssetPreviewUrl } from '../features/media/assetUrlCache'
import { copyTextToClipboard } from '../utils/copyText'
import { useProjectStore } from '../stores/project'
import ChatAssetPreview from './ChatAssetPreview.vue'
import ChatAssetPicker from './ChatAssetPicker.vue'

const CHAT_MODEL_KEY = 'studio.chat.model'

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
}

/** 切换会话：先保存当前，再加载目标 */
function onSessionChange(id: string): void {
  if (!id || id === activeId.value) return
  commitMessages([...messages.value])
  activateSession(id)
  loadActiveMessages()
  scrollToBottom()
}

function onNewSession(): void {
  commitMessages([...messages.value])
  createSession()
  loadActiveMessages()
  draft.value = ''
  scrollToBottom()
}

function onDeleteSession(): void {
  const session = activeSession.value
  if (!session) return
  if (!window.confirm(t('studio.chat.deleteConfirm'))) return
  removeSession(session.id)
  loadActiveMessages()
  draft.value = ''
  scrollToBottom()
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
  // 插入引用后自动补一个空格，避免用户紧接着输入中文时被解析成同一路径（如
  // `@x.png生成个3d模型`），也避免 buildTask 误判“未引用”而重复追加
  const start = replaceAt ? at : pos
  const tail = text.slice(pos)
  const sep = tail && !/^[\s@]/.test(tail) ? ' ' : ''
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
const draft = ref('')
const inputRef = ref<HTMLTextAreaElement | null>(null)
const overlayRef = ref<HTMLElement | null>(null)
/** 输入法组合期间：textareas 恢复实色显示并隐藏覆盖层，避免组合文本在透明层上闪烁 */
const composing = ref(false)
const running = ref(false)
const status = ref<HarnessStatus | null>(null)
const listRef = ref<HTMLElement | null>(null)

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
          providerLabel: p.label || p.providerKind
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
      // dsh-agent 等 harness 工具卡：同一会话内按 key 去重，
      // 状态变更时原地更新，不要保留一张"执行中"的同时再新增一张"完成"
      const key = `tool:${event.name}`
      const prev = findToolByKey(key)
      if (prev) {
        prev.state = event.state
        prev.detail = event.detail
      } else {
        messages.value.push({
          kind: 'tool',
          key,
          name: event.name,
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
    model: modelId.trim() || undefined,
    ...(providerId ? { providerId } : {})
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
  // 打开面板即做一次环境预检，未就绪时在面板顶部与空状态区给出具体原因
  await refreshStatus()
  await loadModels()
})

onBeforeUnmount(() => {
  stopEvent?.()
  stopActivity?.()
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
        <div
          v-if="msg.kind === 'user'"
          class="msg-row user"
        >
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
          v-else
          class="msg-tool"
          :class="msg.state"
        >
          <div class="msg-tool-head">
            <span class="tool-icon" />
            <span class="tool-name">{{ msg.name }}</span>
            <span class="tool-state">
              {{ msg.state === 'start' ? t('studio.chat.toolRunning') : msg.state === 'done' ? t('studio.chat.toolDone') : t('studio.chat.toolFailed') }}
            </span>
            <span
              v-if="msg.detail"
              class="tool-detail"
              :title="msg.detail"
            >{{ msg.detail }}</span>
            <button
              class="copy-btn"
              :class="{ copied: copiedIndex === i }"
              :title="t('studio.chat.copyTitle')"
              @click.stop="copyMessage(i, msg.detail || msg.name)"
            >
              {{ copiedIndex === i ? t('studio.chat.copied') : t('studio.chat.copy') }}
            </button>
          </div>
          <ChatAssetPreview
            v-if="msg.state === 'done' && msg.relativePath"
            :relative-path="msg.relativePath"
          />
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
          <select
            v-model="selectedKey"
            class="model-select"
            :disabled="running || !modelOptions.length"
            @focus="loadModels"
          >
            <option
              v-for="m in modelOptions"
              :key="modelKey(m.providerId, m.id)"
              :value="modelKey(m.providerId, m.id)"
            >
              {{ m.providerLabel }} · {{ m.label }}
            </option>
          </select>
          <span
            v-if="!modelOptions.length"
            class="model-empty"
          >{{ t('studio.chat.noModel') }}</span>
        </div>
        <button
          v-if="running"
          class="btn abort"
          @click="onAbort"
        >
          {{ t('studio.chat.stop') }}
        </button>
        <button
          v-else
          class="btn send"
          :disabled="!draft.trim()"
          @click="onSend"
        >
          {{ t('studio.chat.send') }}
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

.msg-tool {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  padding: 5px 8px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-muted);
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}

/* 状态行：icon + 名称 + 状态 + 详情；右侧预留复制按钮位置 */
.msg-tool .msg-tool-head {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding-right: 28px;
}

.msg-tool:hover .copy-btn {
  opacity: 1;
}

.msg-tool .tool-icon {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
  background: var(--accent);
}

.msg-tool.done .tool-icon {
  background: var(--success);
}

.msg-tool.error .tool-icon {
  background: var(--danger);
}

.msg-tool .tool-name {
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.msg-tool .tool-state {
  flex: none;
}

.msg-tool .tool-detail {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.model-select-wrap .model-select {
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

.model-select-wrap .model-select:disabled {
  opacity: 0.55;
  cursor: default;
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
</style>
