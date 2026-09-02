<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, type Directive } from 'vue'
import type { AssetInfo, AssetType } from '@shared/domain'
import type {
  AgentForwardEvent,
  AgentRuntimeStatus,
  AskUserQuestion,
  ChatMode,
  HarnessEvent,
  HarnessStatus,
  McpActivity,
  SessionSkill
} from '@shared/ipc'
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
import SaveAssetDialog from './SaveAssetDialog.vue'

const CHAT_MODEL_KEY = 'studio.chat.model'
const CHAT_MODE_KEY = 'studio.chat.mode'
const CHAT_MODES: ChatMode[] = ['craft', 'ask', 'plan']

const { t } = useStudioI18n()

/** 所属 agent：缺省 'default'。多 agent 面板为每个标签挂载一个实例，事件按 agentId 分流 */
const props = defineProps<{
  agentId?: string
  /** 全部 agent（含运行状态）：多 agent 面板传入以启用「转交」；单独使用时为空 */
  agents?: AgentRuntimeStatus[] | null
}>()
const agentId = props.agentId ?? 'default'

/** 转交请求（模式 B）：once 由 AgentPanel 切到目标标签后经 sendExternally 发送；live 则建立自动管道 */
const emit = defineEmits<{
  (
    e: 'forward-request',
    payload: { to: string; text: string; file?: string; live?: boolean }
  ): void
}>()

/** 历史会话：多会话持久化 + 输入框上方工具栏切换（会话历史按 agent 分命名空间） */
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
} = useChatHistory(agentId)

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
  resetEditor()
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
  // 同步清理磁盘上的 dsh 持久化记录，避免同 id 会话被「幽灵恢复」（按 agent 限定命名空间）
  window.studio.deleteHarnessSession(session.id, agentId).catch(() => undefined)
  loadActiveMessages()
  resetEditor()
  composing.value = false
  scrollToBottom()
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
  if (mentionOpen.value || composing.value) return
  const before = textBeforeCursor()
  if (/@[^\s@]*$/.test(before)) mentionOpen.value = true
}

/** 音频没有可视化缩略图，chips 直接显示音符图标，不请求预览 URL */
function resolveMentionThumb(asset: AssetInfo): Promise<string> {
  if (asset.type === 'voice') return Promise.resolve('')
  const path = asset.thumbnailPath?.trim() || asset.relativePath?.trim() || ''
  if (!path) return Promise.resolve('')
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

/** 扩展名判断是否为图片（决定内联引用以缩略图还是文本 chip 展示） */
function isImageLikePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|avif|svg|ico)$/i.test(path)
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
  if (running.value || composing.value) return
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
  if (running.value || composing.value) return
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

/** 解析媒体预览 URL：工程相对路径走资产缩略图；本地绝对路径直接构造 studio-media URL */
function resolveMediaUrl(path: string): Promise<string> {
  const p = path.replace(/\\/g, '/')
  if (isAbsoluteMediaPath(p)) {
    return Promise.resolve(`studio-media://local/?path=${encodeURIComponent(p)}&t=${Date.now()}`)
  }
  return resolveAssetPreviewUrl(p)
}

/** 消息气泡文本渲染：`@image:路径` / `@图片路径` → 卡片大图，其它 `@路径` → 文本 chip */
function renderMessageText(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc.replace(/@(?:(image:)\s*)?([^\s@]+)/g, (_m, prefix: string | undefined, raw: string) => {
    const path = raw.replace(/\\/g, '/')
    if (isImageLikePath(path)) {
      const name = path.split('/').pop() ?? path
      return `<div class="chat-msg-card"><img data-src="${path}" alt="${name}"><div class="chat-msg-card-name">${name}</div></div>`
    }
    return `<span class="inline-ref">@${prefix ?? ''}${raw}</span>`
  })
}

/** 消息气泡内图片卡片：把 data-src 解析为预览 URL；加载失败/文件缺失回退为文本 chip */
function resolveChatImages(root: HTMLElement): void {
  root.querySelectorAll<HTMLImageElement>('img[data-src]').forEach((img) => {
    const path = img.dataset.src
    if (!path) return
    img.removeAttribute('data-src')
    const fallback = (): void => {
      if (!img.isConnected) return
      const chip = document.createElement('span')
      chip.className = 'inline-ref'
      chip.textContent = `@${path}`
      img.replaceWith(chip)
    }
    img.addEventListener('error', fallback, { once: true })
    resolveMediaUrl(path)
      .then((url) => {
        if (!img.isConnected) return
        if (!url) {
          fallback()
          return
        }
        img.src = url
      })
      .catch(fallback)
  })
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
  const extra = referenced.value
    .map((r) => r.path)
    .filter((p) => !text.includes(`@${p}`))
  if (!extra.length) return text
  return text + '\n\n' + extra.map((p) => `@${p}`).join('\n')
}

const messages = ref<ChatMsg[]>([])
/** harness provider 报告的最新真实上下文 token（每轮 LLM 请求完成后更新；切换会话后失效） */
const harnessContextUsed = ref<number | undefined>(undefined)

/** —— 转交（模式 B：把回答/任务发给其他 Agent） —— */
/** 父级未传 agent 列表时现场拉取（独立使用场景的回退） */
const localAgents = ref<AgentRuntimeStatus[] | null>(null)
const allAgents = computed<AgentRuntimeStatus[]>(() => props.agents ?? localAgents.value ?? [])
/** 可转交目标：排除自己（仅自己时无入口） */
const forwardTargets = computed(() => allAgents.value.filter((a) => a.agentId !== agentId))
const forwardOpen = ref(false)
/** 转交正文（once）或附加指令（live，可空） */
const forwardText = ref('')
/** 目标 agent id */
const forwardTo = ref('')
/** true = 建立自动转交管道：本 agent 每次完成任务后把结果自动发给目标 */
const forwardLive = ref(false)
/** 附带工作区文件（工程内相对路径，可选） */
const forwardFile = ref('')
const forwardBusy = ref(false)

async function openForward(text?: string): Promise<void> {
  if (!allAgents.value.length) {
    try {
      localAgents.value = await window.studio.listAgents()
    } catch {
      localAgents.value = []
    }
  }
  if (!forwardTargets.value.length) return
  forwardText.value = text ?? ''
  forwardTo.value = forwardTargets.value[0]!.agentId
  forwardLive.value = false
  forwardFile.value = ''
  forwardOpen.value = true
}

function closeForward(): void {
  if (forwardBusy.value) return
  forwardOpen.value = false
}

/** 提交转交：once → 切到目标标签以其会话发送；live → 请求主进程建立自动管道 */
async function submitForward(): Promise<void> {
  const to = forwardTo.value
  if (!to || forwardBusy.value) return
  const file = forwardFile.value.trim() || undefined
  if (forwardLive.value) {
    forwardBusy.value = true
    try {
      emit('forward-request', { to, text: forwardText.value.trim(), file, live: true })
      forwardOpen.value = false
    } finally {
      forwardBusy.value = false
    }
    return
  }
  const body = forwardText.value.trim()
  if (!body) return
  // once：给目标 agent 的任务文本 = 来源说明 + 正文 + 可选文件参考
  const fromName = allAgents.value.find((a) => a.agentId === agentId)?.name ?? agentId
  const parts: string[] = []
  parts.push(`[来自「${fromName}」Agent 的转交任务]`) // cjk-ok 转交任务文本（发送给模型的任务内容）
  parts.push(body)
  if (file) {
    parts.push(`请先读取并参考工程工作区内的文件：${file}（相对工程根目录的路径）`) // cjk-ok 转交任务文本（发送给模型的任务内容）
  }
  forwardBusy.value = true
  try {
    emit('forward-request', { to, text: parts.join('\n\n'), live: false })
    forwardOpen.value = false
  } finally {
    forwardBusy.value = false
  }
}
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
/** 技能调试视图：会话可用技能清单（内置快照 + 用户自定义） */
const skillsOpen = ref(false)
const skillsDropdownRef = ref<HTMLElement | null>(null)
const sessionSkills = ref<SessionSkill[]>([])
/** 已加载技能 → 命中次数：skill 工具调用时累加，作为「命中依据」可视化 */
const loadedSkills = reactive<Record<string, number>>({})
const loadedSkillCount = computed(() => Object.keys(loadedSkills).length)
const loadedSkillTotal = computed(() => {
  let total = 0
  for (const key in loadedSkills) total += loadedSkills[key]
  return total
})

async function refreshSessionSkills(): Promise<void> {
  try {
    sessionSkills.value = await window.studio.getSessionSkills()
  } catch {
    // 技能清单拉取失败不阻塞对话，保持上次快照
  }
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
  if (!modeOpen.value && !modelOpen.value && !sessionOpen.value && !skillsOpen.value) return
  if (e instanceof KeyboardEvent) {
    if (e.key === 'Escape') {
      modeOpen.value = false
      modelOpen.value = false
      sessionOpen.value = false
      skillsOpen.value = false
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
}
const draft = ref('')
const inputRef = ref<HTMLElement | null>(null)
/** 输入法组合期间：跳过 @ 触发 / 粘贴接管，避免组合文本被误处理 */
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
let stopForward: (() => void) | null = null
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
  // 只处理本 agent 的事件：default agent 的事件不带 agentId，按 'default' 匹配
  if ((event.agentId ?? 'default') !== agentId) return
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
      // 技能命中依据：skill 工具调用时在技能调试视图中标记「已加载」
      if (event.name === 'skill') markSkillLoaded(event.detail)
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
    // 完成且产出了资产：把落盘相对路径记到卡上（新数据由对话末尾的独立预览卡展示）
    if (state === 'done' && activity.relativePath) {
      prev.relativePath = activity.relativePath
    }
  } else if (running.value) {
    // 只有任务仍在运行时才新增 MCP 活动卡，避免结束时再产生孤立的工具卡
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
  // 生成完成且产出了资产：在对话末尾追加独立预览卡（图片/视频/音频/3D），
  // 仅在任务卡存在或任务仍运行时插入，避免产生孤立的预览卡
  if (state === 'done' && activity.relativePath && (prev || running.value)) {
    pushAsset(`asset:${activity.id}`, activity.relativePath)
  }
}

/** 生成完成的独立资产预览卡：同 key 去重，追加到对话末尾（原地更新路径以幂等处理延迟回调） */
function pushAsset(key: string, relativePath: string): void {
  const prev = messages.value.find(
    (m): m is ChatMsg & { kind: 'asset' } => m.kind === 'asset' && m.key === key
  )
  if (prev) {
    prev.relativePath = relativePath
    return
  }
  messages.value.push({ kind: 'asset', key, relativePath })
  scrollToBottom()
}

/** 是否已存在与任务卡 key（`mcp:<id>`）对应的独立资产卡（`asset:<id>`）：旧会话数据无独立卡时任务清单内回退展示预览 */
function hasAssetCard(toolKey: string): boolean {
  const assetKey = toolKey.startsWith('mcp:') ? `asset:${toolKey.slice('mcp:'.length)}` : ''
  if (!assetKey) return false
  return messages.value.some((m) => m.kind === 'asset' && m.key === assetKey)
}

/** 生成产物默认落 Cache/ 不进资产库：资产卡提供「保存到资产库」入口（弹窗选目录/文件名） */
const saveDialogOpen = ref(false)
const saveDialogDefaultName = ref('')
const saveDialogDefaultFolderId = ref<string | null>(null)
const saveDialogRef = ref<{ setSaving: (v: boolean) => void; setError: (m: string) => void } | null>(
  null
)
const savingAssetKey = ref('')
/** 本次会话已成功保存到资产库的资产卡 key（`asset:<id>`），按钮置为「已保存」并禁用 */
const savedAssetKeys = ref<Set<string>>(new Set())
let pendingSaveAssetKey = ''

function isAssetSaved(key: string): boolean {
  return savedAssetKeys.value.has(key)
}

/** 资产卡默认名称：取文件名 stem（去扩展名） */
function assetDefaultName(relativePath: string): string {
  return relativePath.split('/').pop()?.replace(/\.[^.]+$/, '') || 'asset'
}

function openSaveAsset(msg: ChatMsg & { kind: 'asset' }): void {
  if (isAssetSaved(msg.key)) return
  pendingSaveAssetKey = msg.key
  saveDialogDefaultName.value = assetDefaultName(msg.relativePath)
  saveDialogDefaultFolderId.value = null
  saveDialogOpen.value = true
}

function closeSaveAssetDialog(): void {
  if (savingAssetKey.value) return
  saveDialogOpen.value = false
}

/** 弹窗确认：把 Cache 产物复制到资产库目标文件夹并登记，成功后刷新资产浏览器 */
async function onSaveAssetConfirm(payload: { name: string; folderId: string | null }): Promise<void> {
  const target = messages.value.find((m) => m.kind === 'asset' && m.key === pendingSaveAssetKey)
  if (!target || target.kind !== 'asset' || savingAssetKey.value) return
  savingAssetKey.value = target.key
  saveDialogRef.value?.setSaving(true)
  try {
    await window.studio.saveProjectAsset({
      relativePath: target.relativePath,
      name: payload.name,
      folderId: payload.folderId
    })
    savedAssetKeys.value.add(target.key)
    saveDialogOpen.value = false
    // 资产库同步刷新：新资产在资产浏览器中立即可见
    await project.scheduleRefreshLibrary()
  } catch (err) {
    saveDialogRef.value?.setError(err instanceof Error ? err.message : String(err))
  } finally {
    savingAssetKey.value = ''
  }
}

let stopAskUser: (() => void) | null = null

/** agent 通过 ask_user 工具发起提问：在消息流中插入一条「问题 + 选项按钮」卡 */
function handleAskUser(question: AskUserQuestion): void {
  // 只处理本 agent 的提问
  if ((question.agentId ?? 'default') !== agentId) return
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
    await window.studio.answerAskUser({ requestId: msg.requestId, answer: option, agentId })
  } catch {
    // 主进程侧已超时 / 会话已结束：按钮已锁定，无副作用
  }
}

async function onSend(): Promise<void> {
  if (composing.value) return
  const raw = draft.value.trim()
  if (!raw || running.value) return
  const task = buildTask(raw)
  resetEditor()
  referenced.value = []
  await sendTask(task)
}

/**
 * 以本 agent 当前会话发送一条任务（用户输入与「转交」共用一条发送路径：
 * 推送 user 消息 → 置运行态 → runHarnessTask；失败返回 false）。
 */
async function sendTask(task: string): Promise<boolean> {
  if (!task) return false
  if (running.value) {
    // 转交等外部触发发送时给出明确反馈，而不是静默丢弃
    pushStatus(t('studio.chat.forwardBusy'))
    return false
  }
  // 发送前重新预检一次（Node 版本 / dsh 运行体 / MCP 服务 / 模型），
  // 不用挂载时的旧快照判断，避免按过期的“就绪”放行后才发现环境缺失
  await refreshStatus()
  // 环境未就绪时不静默丢弃：把原因作为状态消息告知用户
  if (!ready.value) {
    pushStatus(status.value?.message ?? t('studio.chat.unavailable'))
    return false
  }
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
    // 目标 agent：主进程按其路由到独立 dsh 运行时与持久化目录
    agentId,
    // 当前 agent 模式：main 进程按 craft/ask/plan 切换 dsh 的 system-prompt
    mode: mode.value
  })
  if (!result.started) {
    pushStatus(result.message ?? 'failed to start')
    running.value = false
    // 启动被主进程预检查拒绝（如 MCP 已停、Node 不达标），同步状态栏
    void refreshStatus()
    return false
  }
  return true
}

/**
 * 自动转交派发（模式 B live）：主进程已把任务派给本 agent 的 dsh 运行时，
 * 这里只把任务文本写入会话 UI（保证用户看得到 B 收到了什么）。
 */
function onAgentForward(event: AgentForwardEvent): void {
  if (event.to !== agentId) return
  // 目标会话优先切到主进程记录的那个（存在时），保证 UI 与 dsh 会话一致
  if (event.sessionId && sessions.value.some((s) => s.id === event.sessionId)) {
    if (activeId.value !== event.sessionId) {
      activateSession(event.sessionId)
      loadActiveMessages()
    }
  }
  messages.value.push({ kind: 'user', text: event.text })
  running.value = true
  commitMessages([...messages.value])
  persistHistory()
  scrollToBottom()
}

async function onAbort(): Promise<void> {
  await window.studio.abortHarnessTask(agentId)
}

onMounted(async () => {
  // 恢复历史会话（上次会话或新建），再订阅事件流
  loadHistory()
  loadActiveMessages()
  void refreshSessionSkills()
  stopEvent = window.studio.onHarnessEvent(onHarnessEvent)
  stopActivity = window.studio.onMcpActivityUpdated(onMcpActivity)
  stopAskUser = window.studio.onAskUser(handleAskUser)
  stopForward = window.studio.onAgentForward(onAgentForward)
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
  stopForward?.()
  document.removeEventListener('click', onModeOutside)
  document.removeEventListener('keydown', onModeOutside)
  if (copyTimer !== null) window.clearTimeout(copyTimer)
  if (historyTimer !== null) window.clearTimeout(historyTimer)
  // 卸载前把当前消息落盘，避免切换面板丢失最后一段对话
  commitMessages([...messages.value])
  persistHistory()
})

// 暴露给外层（AgentPanel 的「转交」流程使用）：以本面板当前会话发送一条任务 / 读取当前会话 id
defineExpose({
  sendExternally: (text: string): Promise<boolean> => sendTask(String(text ?? '').trim()),
  getActiveSessionId: (): string | undefined => activeId.value || undefined
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

    <div class="chat-messages-wrap">
      <div
        ref="listRef"
        class="chat-messages"
        @scroll="onChatScroll"
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
                <div
                  class="bubble-text"
                  v-chat-img
                  v-html="renderMessageText(msg.text)"
                />
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
                  <!-- 旧会话数据无独立资产卡时回退到卡内预览；新数据一律走对话末尾的独立预览卡 -->
                  <ChatAssetPreview
                    v-if="tm.state === 'done' && tm.relativePath && !hasAssetCard(tm.key)"
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
              <pre
                v-chat-img
                v-html="renderMessageText(msg.text)"
              />
              <button
                v-if="forwardTargets.length > 0"
                class="forward-btn"
                :title="t('studio.chat.forwardTitle')"
                @click.stop="openForward(msg.text)"
              >
                ⤳
              </button>
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
          <!-- 独立资产预览卡：生成完成（图片/视频/音频/3D）时追加到对话末尾，与任务清单的状态卡分离 -->
          <div
            v-else-if="msg.kind === 'asset'"
            class="msg-row asset"
          >
            <div class="asset-card">
              <ChatAssetPreview :relative-path="msg.relativePath" />
              <!-- 生成产物默认落 Cache/ 不进资产库：提供手动保存登记入口 -->
              <div class="asset-card-actions">
                <button
                  class="save-btn"
                  :class="{ saved: isAssetSaved(msg.key) }"
                  :disabled="savingAssetKey === msg.key || isAssetSaved(msg.key)"
                  :title="t('studio.chat.saveToLibraryTitle')"
                  @click.stop="openSaveAsset(msg)"
                >
                  {{
                    isAssetSaved(msg.key)
                      ? t('studio.chat.savedToLibrary')
                      : savingAssetKey === msg.key
                        ? t('common.saving')
                        : t('studio.chat.saveToLibrary')
                  }}
                </button>
              </div>
            </div>
          </div>
          <div
            v-else-if="msg.kind === 'status'"
            class="msg-status"
          >
            <div
              class="bubble-text"
              v-chat-img
              v-html="renderMessageText(msg.text)"
            />
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
            <div
              class="prompt-question"
              v-chat-img
              v-html="renderMessageText(msg.question)"
            />
            <div
              v-if="msg.hint"
              class="prompt-hint"
              v-chat-img
              v-html="renderMessageText(msg.hint)"
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
      <div class="chat-toolbar">
        <!-- 技能调试视图：展示会话可用技能清单与已加载命中次数 -->
        <div
          ref="skillsDropdownRef"
          class="skills-dropdown"
          :class="{ open: skillsOpen }"
        >
          <button
            type="button"
            class="skills-trigger"
            :class="{ active: skillsOpen }"
            :title="t('studio.chat.skillsTitle')"
            @click.stop="skillsOpen = !skillsOpen"
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
            <span class="skills-label">{{ t('studio.chat.skills') }}</span>
            <span
              v-if="loadedSkillCount > 0"
              class="skills-badge"
            >{{ loadedSkillTotal }}</span>
          </button>
          <div
            v-show="skillsOpen"
            class="skills-menu"
          >
            <div class="skills-menu-head">
              <span>{{ t('studio.chat.skillsTitle') }}</span>
              <span
                v-if="sessionSkills.length"
                class="skills-menu-meta"
              >
                {{ t('studio.chat.skillsMeta', { loaded: loadedSkillCount, total: sessionSkills.length }) }}
              </span>
            </div>
            <p
              v-if="sessionSkills.length === 0"
              class="skills-empty"
            >
              {{ t('studio.chat.skillsEmpty') }}
            </p>
            <ul
              v-else
              class="skills-list"
            >
              <li
                v-for="skill in sessionSkills"
                :key="skill.name"
                class="skill-item"
                :class="{ loaded: (loadedSkills[skill.name] ?? 0) > 0 }"
              >
                <span class="skill-check">
                  {{ (loadedSkills[skill.name] ?? 0) > 0 ? '✓' : '' }}
                </span>
                <span class="skill-item-main">
                  <span class="skill-item-name">
                    {{ skill.titleZh || skill.name }}
                    <code v-if="!skill.titleZh || skill.kind === 'custom'">{{ skill.name }}</code>
                  </span>
                  <span class="skill-item-desc">{{ skill.description }}</span>
                </span>
                <span
                  v-if="(loadedSkills[skill.name] ?? 0) > 0"
                  class="skill-hit-count"
                >
                  ×{{ loadedSkills[skill.name] }}
                </span>
              </li>
            </ul>
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
        <div
          ref="sessionDropdownRef"
          class="session-dropdown"
          :class="{ open: sessionOpen }"
          :title="t('studio.chat.sessionSelect')"
        >
          <button
            type="button"
            class="session-trigger"
            :disabled="running || !sessions.length"
            @click.stop="sessionOpen = !sessionOpen"
          >
            <span class="session-trigger-label">
              {{ activeSession?.title || t('studio.chat.newChat') }}
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
            ><path d="m6 9 6 6 6-6" /></svg>
          </button>
          <ul v-show="sessionOpen" class="session-menu">
            <li v-for="s in sessions" :key="s.id">
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
                ><path d="M20 6 9 17l-5-5" /></svg>
              </button>
            </li>
          </ul>
        </div>
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
          :title="t('studio.chat.mentionTitle')"
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
          ref="inputRef"
          class="composer-editor"
          :class="{ composing }"
          :contenteditable="!running"
          role="textbox"
          :aria-label="t('studio.chat.placeholder')"
          :data-placeholder="t('studio.chat.placeholder')"
          @input="onComposerInput"
          @paste="onComposerPaste"
          @drop.prevent="onComposerDrop"
          @dragover.prevent
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

    <!-- 转交（模式 B）：把本条回答 / 任务交给其他 Agent -->
    <Teleport to="body">
      <div
        v-if="forwardOpen"
        class="forward-mask"
        @click.self="closeForward"
      >
        <div
          class="forward-dialog"
          @keydown.esc="closeForward"
        >
          <div class="forward-head">
            {{ t('studio.chat.forwardTitle') }}
            <button
              class="forward-x"
              :title="t('studio.chat.close')"
              @click="closeForward"
            >×</button>
          </div>
          <label class="forward-field">
            <span class="forward-label">{{ t('studio.chat.forwardTo') }}</span>
            <select v-model="forwardTo">
              <option
                v-for="a in forwardTargets"
                :key="a.agentId"
                :value="a.agentId"
              >{{ a.name }}（{{ a.agentId }}）</option>
            </select>
          </label>
          <label class="forward-field forward-live">
            <input
              v-model="forwardLive"
              type="checkbox"
            />
            <span>{{ t('studio.chat.forwardLive') }}</span>
          </label>
          <label class="forward-field">
            <span class="forward-label">
              {{ forwardLive ? t('studio.chat.forwardInstruction') : t('studio.chat.forwardText') }}
            </span>
            <textarea
              v-model="forwardText"
              rows="5"
              :placeholder="forwardLive ? t('studio.chat.forwardInstructionHint') : ''"
            />
          </label>
          <label class="forward-field">
            <span class="forward-label">{{ t('studio.chat.forwardFile') }}</span>
            <input
              v-model="forwardFile"
              :placeholder="t('studio.chat.forwardFilePlaceholder')"
            />
          </label>
          <div class="forward-actions">
            <button
              class="btn"
              @click="closeForward"
            >{{ t('studio.chat.cancel') }}</button>
            <button
              class="btn primary"
              :disabled="forwardBusy || !forwardTo || (!forwardLive && !forwardText.trim())"
              @click="submitForward"
            >
              {{ forwardLive ? t('studio.chat.forwardSetup') : t('studio.chat.forwardSend') }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
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
  transition: color 0.15s, border-color 0.15s, background 0.15s;
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

.asset-card-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 6px;
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

.forward-btn {
  position: absolute;
  top: 4px;
  left: 4px;
  width: 22px;
  height: 22px;
  padding: 0;
  font-size: 13px;
  line-height: 1;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.msg-row:hover .forward-btn {
  opacity: 1;
}

.forward-btn:hover {
  background: var(--bg-hover);
  color: var(--text);
}

/* 转交对话框（Teleport 到 body，仍是本组件作用域） */
.forward-mask {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}

.forward-dialog {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(460px, calc(100vw - 48px));
  max-height: calc(100vh - 120px);
  overflow-y: auto;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elevated);
  color: var(--text);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}

.forward-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
}

.forward-x {
  padding: 0 4px;
  border: none;
  background: none;
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
}

.forward-x:hover {
  color: var(--text);
}

.forward-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
}

.forward-field select,
.forward-field textarea,
.forward-field input {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel);
  color: var(--text);
  font: inherit;
}

.forward-label {
  color: var(--text-muted);
}

.forward-live {
  flex-direction: row;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: var(--text);
}

.forward-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
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

/* 技能调试视图下拉：会话可用技能清单 + 已加载命中次数 */
.skills-dropdown {
  position: relative;
  flex: none;
  flex-shrink: 0;
}

.skills-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 9px 4px 7px;
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

.skills-label {
  font-weight: 600;
  letter-spacing: 0.01em;
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

.session-trigger {
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

.session-trigger:disabled {
  opacity: 0.55;
  cursor: default;
}

.session-trigger-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
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
  right: 0;
  left: 0;
  z-index: 30;
  min-width: 180px;
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

.session-item {
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
  font-weight: 600;
  min-width: 30px;
  text-align: center;
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

/* 输入区：contenteditable 富文本，支持文本与图片内联引用混排 */
.composer-editor {
  width: 100%;
  min-height: 64px;
  max-height: 180px;
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
</style>
