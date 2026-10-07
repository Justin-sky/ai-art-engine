<template>
  <div class="app-shell">
    <!-- 插件市场是主进程单独开的窗口：该窗口只放市场视图，不挂主界面与顶栏 -->
    <MarketplaceView v-if="isMarketplace" />
    <template v-else>
      <header class="topbar">
        <ProjectOpenMenu />
        <div v-if="project.isOpen" class="topbar-meta">
          <span class="muted">{{ project.config?.name }}</span>
          <span class="path" :title="project.rootPath ?? ''">{{ shortPath }}</span>
        </div>
        <nav class="topbar-actions">
          <!--
            插件市场与设置同属「应用级」入口（装工作流/技能、改偏好），都不依赖当前工程，
            所以放在同一个顶栏分组里、紧挨设置左边；原先它挂在工作室工具栏里，只有开了工程才够得着。
          -->
          <button
            type="button"
            class="topbar-btn"
            :title="t('marketplace.open')"
            :aria-label="t('marketplace.open')"
            @click="openMarketplace"
          >
            {{ t('marketplace.open') }}
          </button>
          <button type="button" class="topbar-btn" @click="goSettings">
            {{ t('app.nav.settings') }}
          </button>
        </nav>
      </header>
      <main class="content">
        <!-- 设置打开时仍保留主界面，半透明遮罩才能透出后面内容 -->
        <KeepAlive :include="['HomeView', 'StudioView']">
          <HomeView v-if="mainView === 'home'" key="home" />
          <StudioView v-else-if="mainView === 'studio'" key="studio" />
        </KeepAlive>
        <SettingsView v-if="isSettings" />
      </main>
    </template>
    <!--
      录制 HUD 挂在**主界面这一层**（与下面那排对话框同级），不在 `isMarketplace` 分支里：
      插件市场是主进程单独开的窗口，录制的是主窗口，那边挂一份既没用又会多一个订阅。
      它自己按 `recording` 决定渲不渲染，未录制时不占 DOM。
    -->
    <RecordingHud />
    <StudioPromptDialog />
    <GraphTaskListDialog />
    <GraphRunLogDialog />
    <MediaPreviewDialog />
    <CutoutDialog />
    <ComposerDialog />
    <FrameSheetPreviewDialog />
    <Motion2dActionPreviewDialog />
    <GamePlaySandboxDialog />
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
import MarketplaceView from './views/MarketplaceView.vue'
import RecordingHud from './components/RecordingHud.vue'
import StudioPromptDialog from './components/StudioPromptDialog.vue'
import GraphTaskListDialog from './components/GraphTaskListDialog.vue'
import GraphRunLogDialog from './components/GraphRunLogDialog.vue'
import MediaPreviewDialog from './components/MediaPreviewDialog.vue'
import CutoutDialog from './components/CutoutDialog.vue'
import ComposerDialog from './components/ComposerDialog.vue'
import FrameSheetPreviewDialog from './components/FrameSheetPreviewDialog.vue'
import Motion2dActionPreviewDialog from './components/Motion2dActionPreviewDialog.vue'
import GamePlaySandboxDialog from './components/GamePlaySandboxDialog.vue'
import ProjectOpenMenu from './components/ProjectOpenMenu.vue'
import { useEditorKernel } from './editor/kernel'
import { executeEditorCommand } from './editor/extensions'
import { applyEditorPreferences } from './editor/preferences'
import { invalidateGenerateModelSettingsCache } from './features/graph/model/generateModelOptions'

const { t } = useStudioI18n()
const router = useRouter()
const route = useRoute()
const project = useProjectStore()
const workspace = useWorkspaceStore()
const editor = useEditorKernel()
const mcpActivities = useMcpActivitiesStore()

const isSettings = computed(() => route.name === 'settings')
/** 插件市场窗口：该路由下不渲染主界面（窗口是主进程单独开的） */
const isMarketplace = computed(() => route.name === 'marketplace')
const mainView = ref<'home' | 'studio'>('home')
let stopAssetUpdated: (() => void) | null = null
let stopAssetRemoved: (() => void) | null = null
let stopFoldersUpdated: (() => void) | null = null
let stopVideoJobUpdated: (() => void) | null = null
let stopSettingsUpdated: (() => void) | null = null

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

/**
 * 打开插件市场窗口（MCP / 技能 / 工作流 / 扩展）。
 *
 * 走主进程建窗而不是 `window.open`：主进程侧能保证单例（重复点只聚焦，不叠加），
 * 也能让新窗口自动套用同一套窗口外观（`browser-window-created` 统一处理）。
 */
function openMarketplace(): void {
  void window.studio.openMarketplaceWindow()
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
    stopAssetRemoved = window.studio.onAssetRemoved((payload) => {
      if (!project.isOpen) return
      // 载荷为 { id, path }：id 用于按引用收尾（关编辑器 + 内存 cache 摘除），
      // path 暂时不在这条路径上用——ChatPanel 单独订阅这一事件负责回退「已保存」标记。
      // 旁路（MCP）删除的资产：先关闭它的编辑器面板，避免留下悬空编辑窗
      workspace.closeEditorsForAssetIds([payload.id])
      project.removeAssetLocal(payload.id)
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
  /**
   * 设置被**任意窗口**保存时同步本窗口。
   *
   * 插件市场是独立窗口，它改 MCP 与 Blender 配置后主窗口不会自动知道 ——
   * 而编辑器偏好与生成模型下拉都是按窗口缓存的，不同步就会一直用旧值。
   */
  if (typeof window.studio?.onSettingsUpdated === 'function') {
    stopSettingsUpdated = window.studio.onSettingsUpdated((settings) => {
      applyEditorPreferences(settings)
      invalidateGenerateModelSettingsCache()
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
  stopSettingsUpdated?.()
  stopSettingsUpdated = null
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
