<template>
  <div class="settings" tabindex="-1" @keydown="onSettingsKeydown">
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
          :class="{ active: mainTab === 'yolo' }"
          @click="mainTab = 'yolo'"
        >
          {{ t('settings.section.yolo') }}
        </button>
        <button
          type="button"
          class="top-tab"
          :class="{ active: mainTab === 'ffmpeg' }"
          @click="mainTab = 'ffmpeg'"
        >
          {{ t('settings.section.ffmpeg') }}
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
          :class="{ active: mainTab === 'search' }"
          @click="mainTab = 'search'"
        >
          {{ t('settings.section.search') }}
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
          <input v-model="form.editor.autoSaveEnabled" type="checkbox" />
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
            />
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
            <button type="button" class="about-btn" :disabled="updateBusy" @click="checkUpdate">
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

      <section v-show="mainTab === 'models'" class="models-section">
        <ModelsPanel :models="form.models" />
      </section>

      <section v-show="mainTab === 'yolo'" class="models-section">
        <h2>{{ t('settings.section.yolo') }}</h2>
        <YoloModelsPanel v-model:yolo="form.yolo" />
      </section>

      <section v-show="mainTab === 'ffmpeg'" class="models-section">
        <h2>{{ t('settings.section.ffmpeg') }}</h2>
        <FfmpegPanel />
      </section>

      <section v-show="mainTab === 'objectStorage'" class="models-section">
        <ObjectStoragePanel :object-storage="form.objectStorage" />
      </section>

      <section v-show="mainTab === 'search'" class="models-section">
        <SearchProvidersPanel :search="form.search" @test-message="onSearchTestMessage" />
      </section>

      <div class="actions">
        <span v-if="message" class="msg" :class="{ error: isError, saving: saving }">{{
          message
        }}</span>
        <button type="button" @click="router.back()">
          {{ t('common.back') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, toRaw, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/domain'
import { normalizeModelsSettings } from '@shared/modelProvider'
import { normalizeObjectStorageSettings } from '@shared/objectStorage'
import { normalizeSearchSettings } from '@shared/searchProvider'
import type { AppUpdateEvent } from '@shared/update'
import { setAppLocale } from '../i18n'
import { useStudioI18n } from '../composables/useStudioI18n'
import { applyAppTheme, applyEditorPreferences } from '../editor/preferences'
import { invalidateGenerateModelSettingsCache } from '../features/graph/model/generateModelOptions'
import ModelsPanel from '../components/settings/ModelsPanel.vue'
import ObjectStoragePanel from '../components/settings/ObjectStoragePanel.vue'
import YoloModelsPanel from '../components/settings/YoloModelsPanel.vue'
import FfmpegPanel from '../components/settings/FfmpegPanel.vue'
import SearchProvidersPanel from '../components/settings/SearchProvidersPanel.vue'

const DEBOUNCE_MS = 500

const { t } = useStudioI18n()
const router = useRouter()
const form = reactive<AppSettings>(cloneSettings(DEFAULT_SETTINGS))
const saving = ref(false)
const message = ref('')

/** Blender 工具集：v-model 直接绑 form.blenderMcp，「应用并重连」按钮统一提交 */
const isError = ref(false)
const mainTab = ref<'general' | 'models' | 'yolo' | 'ffmpeg' | 'objectStorage' | 'search'>(
  'general'
)
const appVersion = ref('…')
const updateStatus = ref('')
const updateBusy = ref(false)
const updateReady = ref(false)
/** 下载进度取历史峰值，避免底层短暂回拨时 UI 像「下完又重来」 */
const updatePercentPeak = ref(0)

/** search provider 测试连接结果写到顶部消息条，便于用户感知 */
function onSearchTestMessage(payload: { ok: boolean; message: string }): void {
  message.value = payload.message
  isError.value = !payload.ok
}
let stopUpdateListen: (() => void) | null = null

const SETTINGS_TAB_QUERY_VALUES = new Set([
  'general',
  'models',
  'yolo',
  'ffmpeg',
  'objectStorage',
  'search'
])
const route = useRoute()
// 调用点（如缺 ffmpeg 时的「去设置下载」）以 route.query.tab 定位到具体 tab；
// 定位后清除 query，避免下次打开设置页仍停留在上次被引导的 tab。
watch(
  () => route.query.tab,
  (tab) => {
    if (typeof tab === 'string' && SETTINGS_TAB_QUERY_VALUES.has(tab)) {
      mainTab.value = tab as typeof mainTab.value
      if (route.query.tab === tab) {
        void router.replace({ query: {} })
      }
    }
  },
  { immediate: true }
)

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
      updatePercentPeak.value = 0
      updateStatus.value = t('settings.about.checking')
      break
    case 'available':
      updateBusy.value = true
      updatePercentPeak.value = 0
      updateStatus.value = t('settings.about.available', { version: event.version })
      break
    case 'not-available':
      updateBusy.value = false
      updateReady.value = false
      updatePercentPeak.value = 0
      updateStatus.value = t('settings.about.notAvailable')
      break
    case 'progress': {
      updateBusy.value = true
      const raw = Math.max(0, Math.min(100, Math.round(event.percent)))
      updatePercentPeak.value = Math.max(updatePercentPeak.value, raw)
      updateStatus.value = t('settings.about.progress', {
        percent: updatePercentPeak.value
      })
      break
    }
    case 'downloaded':
      updateBusy.value = false
      updateReady.value = true
      updatePercentPeak.value = 100
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
    search: normalizeSearchSettings(raw.search ?? DEFAULT_SETTINGS.search),
    objectStorage: normalizeObjectStorageSettings(
      toRaw(raw.objectStorage ?? DEFAULT_SETTINGS.objectStorage)
    ),
    seedance: { ...toRaw(raw.seedance) },
    llm: { ...toRaw(raw.llm) },
    yolo: { ...DEFAULT_SETTINGS.yolo, ...toRaw(raw.yolo) },
    blenderMcp: {
      ...DEFAULT_SETTINGS.blenderMcp,
      ...toRaw(raw.blenderMcp)
    },
    /**
     * 第三方 MCP 由**插件市场**管理，设置页只负责原样带走。
     * 这里若丢掉，设置页一次自动保存就会把用户添加的外部服务整表清空
     * （`setSettings` 是整对象替换）。
     */
    externalMcp: toRaw(raw.externalMcp ?? []).map((server) => ({ ...toRaw(server) })),
    /** 工作流市场源同理：设置页不编辑它，但必须带走，否则用户配的镜像地址会被写没 */
    workflowMarket: { source: toRaw(raw.workflowMarket?.source ?? '') }
  }
}

function applyToForm(cloned: AppSettings): void {
  form.language = cloned.language
  form.theme = cloned.theme
  form.defaultProjectPath = cloned.defaultProjectPath
  Object.assign(form.editor, cloned.editor)
  Object.assign(form.seedance, cloned.seedance)
  Object.assign(form.llm, cloned.llm)
  // yolo 目录等属于持久化设置，必须回填否则打开设置页保存会静默覆盖为默认值
  Object.assign(form.yolo, cloned.yolo)
  // 就地替换 providers，避免拉取模型 await 期间整表替换导致设置页引用失效
  form.models.providers.splice(0, form.models.providers.length, ...cloned.models.providers)
  form.search.providers.splice(0, form.search.providers.length, ...cloned.search.providers)
  form.objectStorage.providers.splice(
    0,
    form.objectStorage.providers.length,
    ...cloned.objectStorage.providers
  )
  // 同上：不回填会让「打开设置页 → 自动保存」把用户已存的主机 / 端口 / 护栏状态写回默认值
  Object.assign(form.blenderMcp, cloned.blenderMcp)
  // 第三方 MCP 同上：不回填会把用户添加的外部服务整表清空（改由市场管理，设置页只带走）
  form.externalMcp.splice(0, form.externalMcp.length, ...cloned.externalMcp)
  // 工作流市场源同理
  form.workflowMarket.source = cloned.workflowMarket.source
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
  const [s, version] = await Promise.all([
    window.studio.getSettings(),
    window.studio.getAppVersion()
  ])
  appVersion.value = version
  applyToForm(cloneSettings(s))
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
