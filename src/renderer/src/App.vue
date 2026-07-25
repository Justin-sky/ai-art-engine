<template>
  <div class="app-shell" :class="{ 'stage-only': isChromeLessWindow }">
    <header v-if="!isChromeLessWindow" class="topbar">
      <button type="button" class="brand" title="AI Art Engine" @click="goHome">
        <img class="brand-logo" :src="logoUrl" alt="" />
        <span class="brand-name">AI Art Engine</span>
      </button>
      <div class="topbar-meta" v-if="project.isOpen">
        <span class="muted">{{ project.config?.name }}</span>
        <span class="path" :title="project.rootPath ?? ''">{{ shortPath }}</span>
      </div>
      <nav class="topbar-actions">
        <button type="button" class="topbar-btn" @click="goSettings">
          {{ t('app.nav.settings') }}
        </button>
      </nav>
    </header>
    <main class="content">
      <DirectorStageWindowView v-if="isStageWindow" />
      <ShotPreviewWindowView v-else-if="isShotPreviewWindow" />
      <ShotEditorWindowView v-else-if="isShotEditorWindow" />
      <ShotTableWindowView v-else-if="isShotTableWindow" />
      <WorldEditorWindowView v-else-if="isWorldEditorWindow" />
      <WorldTableWindowView v-else-if="isWorldTableWindow" />
      <template v-else>
        <!-- 设置打开时仍保留主界面，半透明遮罩才能透出后面内容 -->
        <KeepAlive :include="['HomeView', 'StudioView']">
          <HomeView v-if="mainView === 'home'" key="home" />
          <StudioView v-else-if="mainView === 'studio'" key="studio" />
        </KeepAlive>
        <SettingsView v-if="isSettings" />
      </template>
    </main>
    <StudioPromptDialog v-if="showOverlayDialogs" />
    <GraphTaskListDialog v-if="showOverlayDialogs" />
    <GraphRunLogDialog v-if="showOverlayDialogs" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { isNavigationFailure, useRoute, useRouter } from 'vue-router'
import { useProjectStore } from './stores/project'
import { useStudioI18n } from './composables/useStudioI18n'
import HomeView from './views/HomeView.vue'
import StudioView from './views/StudioView.vue'
import SettingsView from './views/SettingsView.vue'
import DirectorStageWindowView from './views/DirectorStageWindowView.vue'
import ShotPreviewWindowView from './views/ShotPreviewWindowView.vue'
import ShotEditorWindowView from './views/ShotEditorWindowView.vue'
import ShotTableWindowView from './views/ShotTableWindowView.vue'
import WorldEditorWindowView from './views/WorldEditorWindowView.vue'
import WorldTableWindowView from './views/WorldTableWindowView.vue'
import StudioPromptDialog from './components/StudioPromptDialog.vue'
import GraphTaskListDialog from './components/GraphTaskListDialog.vue'
import GraphRunLogDialog from './components/GraphRunLogDialog.vue'
import { useEditorKernel } from './editor/kernel'
import { executeEditorCommand } from './editor/extensions'
import logoUrl from './assets/logo-mark.png'

const { t } = useStudioI18n()
const router = useRouter()
const route = useRoute()
const project = useProjectStore()
const editor = useEditorKernel()

const isSettings = computed(() => route.name === 'settings')
const isStageWindow = computed(() => route.name === 'stage')
const isShotPreviewWindow = computed(() => route.name === 'shot-preview')
const isShotEditorWindow = computed(() => route.name === 'shot-editor')
const isShotTableWindow = computed(() => route.name === 'shot-table')
const isWorldEditorWindow = computed(() => route.name === 'world-editor')
const isWorldTableWindow = computed(() => route.name === 'world-table')
const isChromeLessWindow = computed(
  () =>
    isStageWindow.value ||
    isShotPreviewWindow.value ||
    isShotEditorWindow.value ||
    isShotTableWindow.value ||
    isWorldEditorWindow.value ||
    isWorldTableWindow.value
)
/** 分镜 / 世界元素独立窗仍需要任务列表 / 运行日志 / Prompt */
const showOverlayDialogs = computed(
  () =>
    !isChromeLessWindow.value ||
    isShotEditorWindow.value ||
    isShotTableWindow.value ||
    isWorldEditorWindow.value ||
    isWorldTableWindow.value
)
const mainView = ref<'home' | 'studio'>('home')
let stopAssetUpdated: (() => void) | null = null
let stopVideoJobUpdated: (() => void) | null = null

watch(
  () => route.name,
  (name) => {
    if (name === 'home' || name === 'studio') {
      mainView.value = name
    }
  },
  { immediate: true }
)

const shortPath = computed(() => {
  const p = project.rootPath
  if (!p) return ''
  return p.length > 48 ? '…' + p.slice(-46) : p
})

function goHome(): void {
  void router.push('/')
}

async function goSettings(): Promise<void> {
  try {
    await router.push({ name: 'settings' })
  } catch (error) {
    if (isNavigationFailure(error)) return
    throw error
  }
}

function onEditorShortcut(event: KeyboardEvent): void {
  if (!(event.ctrlKey || event.metaKey)) return
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable=\"true\"]')) return
  const key = event.key.toLowerCase()
  if (key === 'z' && !event.shiftKey) {
    if (!editor.commands.canUndo.value) return
    event.preventDefault()
    void executeEditorCommand('editor.undo', editor)
  } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
    if (!editor.commands.canRedo.value) return
    event.preventDefault()
    void executeEditorCommand('editor.redo', editor)
  }
}

onMounted(() => {
  window.addEventListener('keydown', onEditorShortcut)
  if (typeof window.studio?.onAssetUpdated === 'function') {
    stopAssetUpdated = window.studio.onAssetUpdated((asset) => {
      if (!project.isOpen) return
      const existed = project.assets.some((item) => item.id === asset.id)
      project.patchAssets([asset])
      // 新图片/视频资产入库后自动刷新资产库
      if (!existed) void project.scheduleRefreshLibrary()
    })
  }
  if (typeof window.studio?.onVideoJobUpdated === 'function') {
    stopVideoJobUpdated = window.studio.onVideoJobUpdated((job) => {
      if (!project.isOpen) return
      if (job.status === 'succeeded') void project.scheduleRefreshLibrary()
    })
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onEditorShortcut)
  stopAssetUpdated?.()
  stopAssetUpdated = null
  stopVideoJobUpdated?.()
  stopVideoJobUpdated = null
})
</script>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 16px;
  height: 40px;
  padding: 0 14px;
  padding-left: max(14px, env(titlebar-area-x, 0px));
  /* env(titlebar-area-*) 不可用时需为 Win 叠加标题栏控件预留空间，否则右侧按钮无法点击 */
  padding-right: max(
    148px,
    calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 14px)
  );
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  -webkit-app-region: drag;
  app-region: drag;
}

.brand {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.brand-logo {
  display: block;
  height: 26px;
  width: 26px;
  object-fit: contain;
}

.brand-name {
  margin-left: 8px;
  color: var(--text);
  font-size: 14px;
  font-weight: 650;
  letter-spacing: -0.01em;
  white-space: nowrap;
}

.topbar-meta {
  display: flex;
  gap: 10px;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.muted {
  color: var(--text-muted);
}

.path {
  color: var(--text-muted);
  font-family: var(--mono);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.topbar-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.topbar-btn {
  -webkit-app-region: no-drag;
  app-region: no-drag;
}

.content {
  position: relative;
  flex: 1;
  min-height: 0;
}
</style>
