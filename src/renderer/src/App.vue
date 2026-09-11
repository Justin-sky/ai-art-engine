<template>
  <div class="app-shell">
    <header class="topbar">
      <ProjectOpenMenu />
      <div
        v-if="project.isOpen"
        class="topbar-meta"
      >
        <span class="muted">{{ project.config?.name }}</span>
        <span
          class="path"
          :title="project.rootPath ?? ''"
        >{{ shortPath }}</span>
      </div>
      <nav class="topbar-actions">
        <button
          type="button"
          class="topbar-btn"
          @click="goSettings"
        >
          {{ t('app.nav.settings') }}
        </button>
      </nav>
    </header>
    <main class="content">
      <!-- 设置打开时仍保留主界面，半透明遮罩才能透出后面内容 -->
      <KeepAlive :include="['HomeView', 'StudioView']">
        <HomeView
          v-if="mainView === 'home'"
          key="home"
        />
        <StudioView
          v-else-if="mainView === 'studio'"
          key="studio"
        />
      </KeepAlive>
      <SettingsView v-if="isSettings" />
    </main>
    <StudioPromptDialog />
    <GraphTaskListDialog />
    <GraphRunLogDialog />
    <MediaPreviewDialog />
    <CutoutDialog />
    <ComposerDialog />
    <FrameSheetPreviewDialog />
    <Motion2dActionPreviewDialog />
    <UiKitExtractDialog />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { isNavigationFailure, useRoute, useRouter } from 'vue-router'
import { useProjectStore } from './stores/project'
import { useWorkspaceStore } from './stores/workspace'
import { useMcpActivitiesStore } from './stores/mcpActivities'
import { registerMcpTaskRunner } from './features/mcp/mcpTaskRunner'
import { registerMcpRenderJobRunner } from './features/mcp/renderJobHandlers'
import { useStudioI18n } from './composables/useStudioI18n'
import HomeView from './views/HomeView.vue'
import StudioView from './views/StudioView.vue'
import SettingsView from './views/SettingsView.vue'
import StudioPromptDialog from './components/StudioPromptDialog.vue'
import GraphTaskListDialog from './components/GraphTaskListDialog.vue'
import GraphRunLogDialog from './components/GraphRunLogDialog.vue'
import MediaPreviewDialog from './components/MediaPreviewDialog.vue'
import CutoutDialog from './components/CutoutDialog.vue'
import ComposerDialog from './components/ComposerDialog.vue'
import FrameSheetPreviewDialog from './components/FrameSheetPreviewDialog.vue'
import Motion2dActionPreviewDialog from './components/Motion2dActionPreviewDialog.vue'
import UiKitExtractDialog from './components/UiKitExtractDialog.vue'
import ProjectOpenMenu from './components/ProjectOpenMenu.vue'
import { useEditorKernel } from './editor/kernel'
import { executeEditorCommand } from './editor/extensions'

const { t } = useStudioI18n()
const router = useRouter()
const route = useRoute()
const project = useProjectStore()
const workspace = useWorkspaceStore()
const editor = useEditorKernel()
const mcpActivities = useMcpActivitiesStore()

const isSettings = computed(() => route.name === 'settings')
const mainView = ref<'home' | 'studio'>('home')
let stopAssetUpdated: (() => void) | null = null
let stopAssetRemoved: (() => void) | null = null
let stopFoldersUpdated: (() => void) | null = null
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
  registerMcpTaskRunner()
  registerMcpRenderJobRunner()
  mcpActivities.setup()
  if (typeof window.studio?.onAssetUpdated === 'function') {
    stopAssetUpdated = window.studio.onAssetUpdated((asset) => {
      if (!project.isOpen) return
      const existed = project.assets.some((item) => item.id === asset.id)
      project.patchAssets([asset])
      // 新图片/视频资产入库后自动刷新资产库
      if (!existed) void project.scheduleRefreshLibrary()
    })
  }
  if (typeof window.studio?.onAssetRemoved === 'function') {
    stopAssetRemoved = window.studio.onAssetRemoved((assetId) => {
      if (!project.isOpen) return
      // 旁路（MCP）删除的资产：先关闭它的编辑器面板，避免留下悬空编辑窗
      workspace.closeEditorsForAssetIds([assetId])
      project.removeAssetLocal(assetId)
    })
  }
  if (typeof window.studio?.onFoldersUpdated === 'function') {
    stopFoldersUpdated = window.studio.onFoldersUpdated(() => {
      if (!project.isOpen) return
      // 目录树变化常伴随批量资产入库（如资产包导入），一并刷新资产列表
      void project.scheduleRefreshLibrary()
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
  stopAssetRemoved?.()
  stopAssetRemoved = null
  stopFoldersUpdated?.()
  stopFoldersUpdated = null
  stopVideoJobUpdated?.()
  stopVideoJobUpdated = null
  mcpActivities.teardown()
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
