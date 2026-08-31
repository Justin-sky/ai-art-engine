<template>
  <div
    class="settings"
    tabindex="-1"
    @keydown="onSettingsKeydown"
  >
    <div class="panel">
      <h1>{{ t('settings.title') }}</h1>
      <p class="hint">
        {{ t('settings.hint') }}
      </p>

      <nav class="top-tabs">
        <button
          type="button"
          class="top-tab"
          :class="{ active: mainTab === 'general' }"
          @click="mainTab = 'general'"
        >
          {{ t('settings.section.general') }}
        </button>
        <button
          type="button"
          class="top-tab"
          :class="{ active: mainTab === 'models' }"
          @click="mainTab = 'models'"
        >
          {{ t('settings.section.models') }}
        </button>
        <button
          type="button"
          class="top-tab"
          :class="{ active: mainTab === 'objectStorage' }"
          @click="mainTab = 'objectStorage'"
        >
          {{ t('settings.section.objectStorage') }}
        </button>
        <button
          type="button"
          class="top-tab"
          :class="{ active: mainTab === 'mcp' }"
          @click="mainTab = 'mcp'"
        >
          {{ t('settings.section.mcp') }}
        </button>
        <button
          type="button"
          class="top-tab"
          :class="{ active: mainTab === 'skills' }"
          @click="mainTab = 'skills'"
        >
          {{ t('settings.section.skills') }}
        </button>
        <button
          type="button"
          class="top-tab"
          :class="{ active: mainTab === 'plugins' }"
          @click="mainTab = 'plugins'"
        >
          {{ t('settings.section.plugins') }}
        </button>
      </nav>

      <section v-show="mainTab === 'general'">
        <h2>{{ t('settings.section.general') }}</h2>
        <label>
          {{ t('settings.theme') }}
          <select v-model="form.theme">
            <option value="dark">{{ t('settings.themeDark') }}</option>
            <option value="light">{{ t('settings.themeLight') }}</option>
          </select>
        </label>
        <label>
          {{ t('settings.language') }}
          <select v-model="form.language">
            <option value="zh-CN">{{ t('settings.languageZh') }}</option>
            <option value="en-US">{{ t('settings.languageEn') }}</option>
          </select>
        </label>
        <label class="check">
          <input
            v-model="form.editor.autoSaveEnabled"
            type="checkbox"
          >
          {{ t('settings.autoSave.enabled') }}
        </label>
        <label>
          {{ t('settings.autoSave.interval') }}
          <div class="number-row">
            <input
              v-model.number="form.editor.autoSaveIntervalSec"
              type="number"
              min="1"
              max="3600"
              :disabled="!form.editor.autoSaveEnabled"
            >
            <span>{{ t('common.second') }}</span>
          </div>
        </label>

        <h2 class="about-heading">
          {{ t('settings.about.title') }}
        </h2>
        <div class="about-row">
          <div>
            <span class="about-label">{{ t('settings.about.version') }}</span>
            <strong>v{{ appVersion }}</strong>
          </div>
          <div class="about-actions">
            <button
              type="button"
              class="about-btn"
              :disabled="updateBusy"
              @click="checkUpdate"
            >
              {{ t('settings.about.checkUpdate') }}
            </button>
            <button
              v-if="updateReady"
              type="button"
              class="about-btn primary"
              @click="installUpdate"
            >
              {{ t('settings.about.installUpdate') }}
            </button>
          </div>
        </div>
        <p class="hint about-status">
          {{ updateStatus }}
        </p>
      </section>

      <section
        v-show="mainTab === 'models'"
        class="models-section"
      >
        <ModelsPanel :models="form.models" />
      </section>

      <section
        v-show="mainTab === 'objectStorage'"
        class="models-section"
      >
        <ObjectStoragePanel :object-storage="form.objectStorage" />
      </section>

      <section
        v-show="mainTab === 'mcp'"
        class="models-section"
      >
        <h2>{{ t('settings.mcp.title') }}</h2>
        <p class="hint">
          <template v-if="mcpInfo">
            <span class="mcp-running">{{ t('settings.mcp.running', { port: mcpInfo.port }) }}</span>
            · {{ mcpInfo.endpoint }}
          </template>
          <template v-else>
            {{ t('settings.mcp.notRunning') }}
          </template>
        </p>

        <label>
          {{ t('settings.mcp.port') }}
          <div class="number-row">
            <input
              v-model.number="portInput"
              type="number"
              min="1"
              max="65535"
              :disabled="mcpBusy"
            >
            <button
              type="button"
              class="about-btn primary"
              :disabled="mcpBusy"
              @click="applyMcpRestart(false)"
            >
              {{ mcpBusy
                ? t('settings.mcp.restarting')
                : mcpInfo
                  ? t('settings.mcp.restart')
                  : t('settings.mcp.start') }}
            </button>
          </div>
        </label>
        <p class="hint">
          {{ t('settings.mcp.portHint') }}
        </p>

        <div class="mcp-row">
          <span class="about-label">{{ t('settings.mcp.token') }}</span>
          <code class="mcp-value">{{ tokenVisible && mcpInfo ? mcpInfo.token : '••••••••••••••••' }}</code>
          <button
            v-if="mcpInfo"
            type="button"
            class="about-btn"
            @click="tokenVisible = !tokenVisible"
          >
            {{ t(tokenVisible ? 'settings.mcp.hide' : 'settings.mcp.show') }}
          </button>
          <button
            v-if="mcpInfo"
            type="button"
            class="about-btn"
            @click="copyMcp(mcpInfo.token)"
          >
            {{ t('settings.mcp.copy') }}
          </button>
          <button
            v-if="mcpInfo"
            type="button"
            class="about-btn"
            :disabled="mcpBusy"
            @click="applyMcpRestart(true)"
          >
            {{ t('settings.mcp.resetToken') }}
          </button>
          <button
            v-if="mcpInfo && !tokenEditing"
            type="button"
            class="about-btn"
            :disabled="mcpBusy"
            @click="startTokenEdit"
          >
            {{ t('settings.mcp.editToken') }}
          </button>
        </div>

        <div
          v-if="tokenEditing"
          class="mcp-row"
        >
          <span class="about-label">{{ t('settings.mcp.token') }}</span>
          <input
            v-model="tokenInput"
            type="text"
            class="mcp-token-input"
            spellcheck="false"
            :placeholder="t('settings.mcp.tokenPlaceholder')"
            :disabled="mcpBusy"
          >
          <button
            type="button"
            class="about-btn"
            :disabled="mcpBusy"
            @click="applyTokenEdit"
          >
            {{ t('settings.mcp.saveToken') }}
          </button>
          <button
            type="button"
            class="about-btn"
            :disabled="mcpBusy"
            @click="tokenEditing = false"
          >
            {{ t('settings.mcp.cancelEdit') }}
          </button>
        </div>

        <div
          v-if="mcpInfo"
          class="mcp-row"
        >
          <span class="about-label">{{ t('settings.mcp.endpoint') }}</span>
          <code class="mcp-value">{{ mcpInfo.endpoint }}</code>
          <button
            type="button"
            class="about-btn"
            @click="copyMcp(mcpInfo.endpoint)"
          >
            {{ t('settings.mcp.copy') }}
          </button>
        </div>

        <div
          v-if="mcpInfo"
          class="mcp-row"
        >
          <span class="about-label">{{ t('settings.mcp.command') }}</span>
          <code class="mcp-value mcp-cmd">{{ claudeCommand }}</code>
          <button
            type="button"
            class="about-btn"
            @click="copyMcp(claudeCommand)"
          >
            {{ t('settings.mcp.copy') }}
          </button>
        </div>

        <p
          v-if="mcpInfo"
          class="hint"
        >
          {{ t('settings.mcp.hint') }}
        </p>
      </section>

      <section
        v-show="mainTab === 'skills'"
        class="models-section"
      >
        <h2>{{ t('settings.section.skills') }}</h2>
        <SkillsPanel />
      </section>

      <section v-show="mainTab === 'plugins'">
        <h2>{{ t('settings.section.plugins') }}</h2>
        <p class="hint">
          {{ t('settings.plugins.hint') }}
        </p>
        <div
          v-for="plugin in plugins"
          :key="plugin.id"
          class="plugin-row"
        >
          <div>
            <strong>{{ plugin.displayName }}</strong>
            <span>{{ plugin.id }} · v{{ plugin.version }}</span>
          </div>
          <span>{{ t('settings.plugins.declarative') }}</span>
        </div>
        <p
          v-if="plugins.length === 0"
          class="hint"
        >
          {{ t('settings.plugins.empty') }}
        </p>
      </section>

      <div class="actions">
        <span
          v-if="message"
          class="msg"
          :class="{ error: isError, saving: saving }"
        >{{ message }}</span>
        <button
          type="button"
          @click="router.back()"
        >
          {{ t('common.back') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, toRaw, watch } from 'vue'
import { useRouter } from 'vue-router'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/domain'
import { normalizeModelsSettings } from '@shared/modelProvider'
import { normalizeObjectStorageSettings } from '@shared/objectStorage'
import type { ExternalPluginManifest, McpServerInfo } from '@shared/ipc'
import type { AppUpdateEvent } from '@shared/update'
import { setAppLocale } from '../i18n'
import { useStudioI18n } from '../composables/useStudioI18n'
import { applyAppTheme, applyEditorPreferences } from '../editor/preferences'
import { invalidateGenerateModelSettingsCache } from '../features/graph/model/generateModelOptions'
import ModelsPanel from '../components/settings/ModelsPanel.vue'
import ObjectStoragePanel from '../components/settings/ObjectStoragePanel.vue'
import SkillsPanel from '../components/settings/SkillsPanel.vue'

const DEBOUNCE_MS = 500

const { t } = useStudioI18n()
const router = useRouter()
const form = reactive<AppSettings>(cloneSettings(DEFAULT_SETTINGS))
const saving = ref(false)
const message = ref('')
const isError = ref(false)
const plugins = ref<ExternalPluginManifest[]>([])
const mainTab = ref<'general' | 'models' | 'objectStorage' | 'mcp' | 'skills' | 'plugins'>('general')
const appVersion = ref('…')
const updateStatus = ref('')
const updateBusy = ref(false)
const updateReady = ref(false)
const mcpInfo = ref<McpServerInfo | null>(null)
const tokenVisible = ref(false)
const tokenEditing = ref(false)
const tokenInput = ref('')
const portInput = ref<number | null>(null)
const mcpBusy = ref(false)
let stopUpdateListen: (() => void) | null = null

/** Claude Code HTTP 直连注册命令（一键复制） */
const claudeCommand = computed(() => {
  if (!mcpInfo.value) return ''
  return `claude mcp add --transport http aiartengine ${mcpInfo.value.endpoint} --header "Authorization: Bearer ${mcpInfo.value.token}"`
})

async function copyMcp(text: string): Promise<void> {
  await window.studio.writeClipboardText(text)
  message.value = t('settings.mcp.copied')
  isError.value = false
}

/** 应用端口修改（resetToken=true 时同时重置 token）并重启/启动 MCP 服务 */
async function applyMcpRestart(resetToken: boolean): Promise<void> {
  if (mcpBusy.value) return
  mcpBusy.value = true
  message.value = t('settings.mcp.restarting')
  isError.value = false
  try {
    const next = await window.studio.restartMcpServer({
      ...(portInput.value ? { port: portInput.value } : {}),
      resetToken
    })
    mcpInfo.value = next
    portInput.value = next?.port ?? null
    message.value = resetToken ? t('settings.mcp.tokenReset') : t('settings.mcp.restarted')
    isError.value = false
  } catch (e) {
    isError.value = true
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    mcpBusy.value = false
  }
}

function startTokenEdit(): void {
  tokenInput.value = mcpInfo.value?.token ?? ''
  tokenEditing.value = true
}

/** 保存自定义 token：校验后经 MCP_RESTART 应用（服务热重启，旧 token 立即失效） */
async function applyTokenEdit(): Promise<void> {
  if (mcpBusy.value) return
  const token = tokenInput.value.trim()
  if (!/^\S{8,128}$/.test(token)) {
    message.value = t('settings.mcp.tokenInvalid')
    isError.value = true
    return
  }
  mcpBusy.value = true
  message.value = t('settings.mcp.restarting')
  isError.value = false
  try {
    const next = await window.studio.restartMcpServer({ token })
    mcpInfo.value = next
    portInput.value = next?.port ?? null
    tokenEditing.value = false
    message.value = t('settings.mcp.tokenSaved')
  } catch (e) {
    isError.value = true
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    mcpBusy.value = false
  }
}

const updateStatusDefault = computed(() => t('settings.about.idle'))

function isEditableKeyTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    el.isContentEditable
  )
}

/**
 * 设置层盖在 KeepAlive 的 Studio 上：
 * - Delete/Backspace 会冒泡到节点图/资产库快捷键
 * - 非输入框时 Backspace（Mac 上标为 Delete）还会触发 history.back，从而关掉设置
 * 使用冒泡阶段：先让 input 处理删字，再 stopPropagation 挡住底层快捷键。
 */
function onSettingsKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    void router.back()
    return
  }
  if (e.key !== 'Backspace' && e.key !== 'Delete') return
  e.stopPropagation()
  if (!isEditableKeyTarget(e.target)) {
    e.preventDefault()
    return
  }
  // 光标在开头时 Backspace 在部分 Chromium/Electron 仍会 history.back
  if (e.key === 'Backspace') {
    const el = e.target
    if (
      (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
      el.selectionStart === 0 &&
      el.selectionEnd === 0
    ) {
      e.preventDefault()
    }
  }
}

function applyUpdateEvent(event: AppUpdateEvent): void {
  switch (event.type) {
    case 'checking':
      updateBusy.value = true
      updateReady.value = false
      updateStatus.value = t('settings.about.checking')
      break
    case 'available':
      updateBusy.value = true
      updateStatus.value = t('settings.about.available', { version: event.version })
      break
    case 'not-available':
      updateBusy.value = false
      updateReady.value = false
      updateStatus.value = t('settings.about.notAvailable')
      break
    case 'progress':
      updateBusy.value = true
      updateStatus.value = t('settings.about.progress', {
        percent: Math.max(0, Math.min(100, Math.round(event.percent)))
      })
      break
    case 'downloaded':
      updateBusy.value = false
      updateReady.value = true
      updateStatus.value = t('settings.about.downloaded', { version: event.version })
      break
    case 'error':
      updateBusy.value = false
      updateStatus.value = t('settings.about.error', { message: event.message })
      break
    case 'disabled':
      updateBusy.value = false
      updateStatus.value = t('settings.about.disabled')
      break
  }
}

async function checkUpdate(): Promise<void> {
  updateBusy.value = true
  updateStatus.value = t('settings.about.checking')
  try {
    const result = await window.studio.checkForUpdates()
    if (!result.enabled) {
      updateBusy.value = false
      updateStatus.value = t('settings.about.disabled')
    }
  } catch (e) {
    updateBusy.value = false
    updateStatus.value = t('settings.about.error', {
      message: e instanceof Error ? e.message : String(e)
    })
  }
}

async function installUpdate(): Promise<void> {
  const result = await window.studio.installUpdate()
  if (!result.ok) {
    updateStatus.value = t('settings.about.error', {
      message: result.message || 'install failed'
    })
  }
}

/** 加载完成前 / 写回规范化结果时，跳过自动保存 */
const suppressPersist = ref(true)

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let persistSeq = 0

/** reactive Proxy 不能直接 structuredClone，需先拍成纯对象 */
function cloneSettings(source: AppSettings): AppSettings {
  const raw = toRaw(source)
  return {
    language: raw.language,
    theme: raw.theme,
    defaultProjectPath: raw.defaultProjectPath,
    editor: { ...toRaw(raw.editor ?? DEFAULT_SETTINGS.editor) },
    models: normalizeModelsSettings(toRaw(raw.models ?? DEFAULT_SETTINGS.models)),
    objectStorage: normalizeObjectStorageSettings(
      toRaw(raw.objectStorage ?? DEFAULT_SETTINGS.objectStorage)
    ),
    seedance: { ...toRaw(raw.seedance) },
    llm: { ...toRaw(raw.llm) }
  }
}

function applyToForm(cloned: AppSettings): void {
  form.language = cloned.language
  form.theme = cloned.theme
  form.defaultProjectPath = cloned.defaultProjectPath
  Object.assign(form.editor, cloned.editor)
  Object.assign(form.seedance, cloned.seedance)
  Object.assign(form.llm, cloned.llm)
  // 就地替换 providers，避免拉取模型 await 期间整表替换导致设置页引用失效
  form.models.providers.splice(0, form.models.providers.length, ...cloned.models.providers)
  form.objectStorage.providers.splice(
    0,
    form.objectStorage.providers.length,
    ...cloned.objectStorage.providers
  )
}

function schedulePersist(): void {
  if (suppressPersist.value) return
  if (debounceTimer) clearTimeout(debounceTimer)
  message.value = t('settings.saving')
  isError.value = false
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void persistSettings()
  }, DEBOUNCE_MS)
}

async function persistSettings(): Promise<void> {
  if (suppressPersist.value) return
  const seq = ++persistSeq
  saving.value = true
  isError.value = false
  try {
    const payload = cloneSettings(form)
    const saved = await window.studio.setSettings(payload)
    if (seq !== persistSeq) return
    invalidateGenerateModelSettingsCache()

    setAppLocale(saved.language)
    applyEditorPreferences(saved)
    if (!saved.editor.autoSaveEnabled) {
      await window.studio.discardAutosave().catch(() => undefined)
    }

    // 仅当规范化改动了结构时才静默写回，避免无意义循环
    const normalized = cloneSettings(saved)
    const current = cloneSettings(form)
    if (JSON.stringify(normalized) !== JSON.stringify(current)) {
      suppressPersist.value = true
      applyToForm(normalized)
      suppressPersist.value = false
    }

    if (seq === persistSeq) {
      message.value = t('settings.saved')
    }
  } catch (e) {
    if (seq !== persistSeq) return
    isError.value = true
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (seq === persistSeq) saving.value = false
  }
}

watch(form, () => schedulePersist(), { deep: true })
watch(
  () => form.theme,
  (theme) => {
    applyAppTheme(theme === 'light' ? 'light' : 'dark')
  }
)

onMounted(async () => {
  updateStatus.value = updateStatusDefault.value
  stopUpdateListen = window.studio.onUpdateEvent(applyUpdateEvent)
  const [s, installedPlugins, version, mcp] = await Promise.all([
    window.studio.getSettings(),
    window.studio.listPlugins(),
    window.studio.getAppVersion(),
    window.studio.getMcpInfo()
  ])
  appVersion.value = version
  applyToForm(cloneSettings(s))
  plugins.value = installedPlugins
  mcpInfo.value = mcp
  portInput.value = mcp?.port ?? null
  await nextTick()
  suppressPersist.value = false
})

onBeforeUnmount(() => {
  stopUpdateListen?.()
  stopUpdateListen = null
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
    void persistSettings()
  }
})
</script>

<style scoped>
.settings {
  position: absolute;
  inset: 0;
  z-index: 200;
  overflow: auto;
  padding: 32px;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  background: var(--overlay);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.panel {
  width: min(720px, 100%);
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 22px 22px 18px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--panel-glass);
  box-shadow: 0 18px 48px var(--shadow);
}

h1 {
  font-size: 22px;
}

.hint {
  color: var(--text-muted);
  line-height: 1.5;
}

.top-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.top-tab {
  padding: 7px 14px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.top-tab.active {
  color: var(--text);
  background: var(--bg-elevated);
  border-color: var(--border);
}

section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  background: var(--panel-inset);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.models-section {
  gap: 12px;
}

.plugin-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 0;
  border-top: 1px solid var(--border);
}

.plugin-row div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.plugin-row span {
  color: var(--text-muted);
  font-size: 11px;
}

h2 {
  font-size: 14px;
  margin-bottom: 4px;
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--text-muted);
}

.check {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  color: var(--text);
}

.check input {
  width: auto;
}

.number-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.number-row input {
  flex: 1;
}

.number-row span {
  color: var(--text-muted);
}

.actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  align-items: center;
}

.msg {
  color: var(--success);
  font-size: 12px;
  margin-right: auto;
}

.msg.error {
  color: var(--danger-muted);
}

.msg.saving {
  color: var(--text-muted);
}

.about-heading {
  margin-top: 10px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}

.about-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.about-label {
  display: block;
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 2px;
}

.about-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.about-btn {
  padding: 7px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  cursor: pointer;
}

.about-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.about-btn.primary {
  background: rgba(47, 107, 255, 0.22);
  border-color: rgba(47, 107, 255, 0.45);
}

.about-status {
  margin: 0;
}

.mcp-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.mcp-running {
  color: var(--success);
}

  .mcp-token-input {
    flex: 1 1 240px;
    min-width: 0;
    padding: 6px 10px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--panel);
    color: var(--ink);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
  }

  .mcp-value {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  overflow-wrap: anywhere;
}

.mcp-cmd {
  max-width: 520px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
