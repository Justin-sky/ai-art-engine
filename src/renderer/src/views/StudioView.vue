<template>
  <div v-if="!project.isOpen" class="empty">
    <p>{{ t('studio.noProject') }}</p>
    <button class="primary" @click="router.push('/')">
      {{ t('studio.backHome') }}
    </button>
  </div>
  <div v-else class="studio">
    <div class="studio-toolbar">
      <div class="toolbar-panel-toggles toolbar-panel-toggles-left">
        <button
          type="button"
          class="panel-toggle-btn"
          :class="{ 'is-active': !sidePanelCollapsed.assets }"
          :title="`${!sidePanelCollapsed.assets ? t('studio.panel.collapse') : t('studio.panel.expand')} · ${t('studio.panel.assets')} (Ctrl+B)`"
          :aria-label="`${!sidePanelCollapsed.assets ? t('studio.panel.collapse') : t('studio.panel.expand')} · ${t('studio.panel.assets')}`"
          :aria-pressed="!sidePanelCollapsed.assets"
          @click="toggleSidePanel('assets')"
        >
          <svg
            class="panel-toggle-svg"
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="none"
            aria-hidden="true"
          >
            <rect
              x="1.5"
              y="2.5"
              width="13"
              height="11"
              rx="2"
              stroke="currentColor"
              stroke-width="1.3"
            />
            <line x1="6" y1="2.5" x2="6" y2="13.5" stroke="currentColor" stroke-width="1.3" />
            <rect
              v-if="!sidePanelCollapsed.assets"
              x="2.6"
              y="3.6"
              width="2.4"
              height="8.8"
              rx="0.6"
              fill="currentColor"
            />
          </svg>
          <span class="panel-toggle-label">{{ t('studio.panel.assets') }}</span>
        </button>
      </div>
      <span class="toolbar-sep" aria-hidden="true" />
      <span class="hint">{{ t('studio.toolbar.hint') }}</span>
      <button
        type="button"
        :disabled="!toolbarCanUndo"
        :title="t('studio.toolbar.undo')"
        @click="onToolbarUndo"
      >
        ↶
      </button>
      <button
        type="button"
        :disabled="!toolbarCanRedo"
        :title="t('studio.toolbar.redo')"
        @click="onToolbarRedo"
      >
        ↷
      </button>
      <button
        ref="tasksBtnEl"
        type="button"
        class="tasks-btn"
        data-graph-task-anchor
        :title="t('studio.toolbar.tasks')"
        :aria-label="t('studio.toolbar.tasksAria')"
        @click="taskStore.openDialog(tasksBtnEl)"
      >
        {{ t('studio.toolbar.tasks') }}
        <span v-if="busyCount > 0" class="tasks-badge">
          {{ busyCount }}
        </span>
      </button>
      <button
        type="button"
        class="tasks-btn"
        :title="t('studio.toolbar.logs')"
        :aria-label="t('studio.toolbar.logsAria')"
        @click="runLogsStore.openDialog()"
      >
        {{ t('studio.toolbar.logs') }}
        <span v-if="runLogsStore.activeRunId" class="tasks-badge live">·</span>
      </button>
      <span class="toolbar-sep" aria-hidden="true" />
      <div class="toolbar-panel-toggles toolbar-panel-toggles-right">
        <button
          type="button"
          class="panel-toggle-btn"
          :class="{ 'is-active': !sidePanelCollapsed.inspector }"
          :title="`${!sidePanelCollapsed.inspector ? t('studio.panel.collapse') : t('studio.panel.expand')} · ${t('studio.panel.inspector')} (Ctrl+I)`"
          :aria-label="`${!sidePanelCollapsed.inspector ? t('studio.panel.collapse') : t('studio.panel.expand')} · ${t('studio.panel.inspector')}`"
          :aria-pressed="!sidePanelCollapsed.inspector"
          @click="toggleSidePanel('inspector')"
        >
          <svg
            class="panel-toggle-svg"
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="none"
            aria-hidden="true"
          >
            <rect
              x="1.5"
              y="2.5"
              width="13"
              height="11"
              rx="2"
              stroke="currentColor"
              stroke-width="1.3"
            />
            <line x1="7" y1="2.5" x2="7" y2="13.5" stroke="currentColor" stroke-width="1.3" />
            <line x1="11" y1="2.5" x2="11" y2="13.5" stroke="currentColor" stroke-width="1.3" />
            <rect
              v-if="!sidePanelCollapsed.inspector"
              x="7.9"
              y="3.6"
              width="2.2"
              height="8.8"
              rx="0.5"
              fill="currentColor"
            />
          </svg>
          <span class="panel-toggle-label">{{ t('studio.panel.inspector') }}</span>
        </button>
        <button
          type="button"
          class="panel-toggle-btn"
          :class="{ 'is-active': chatPanelVisible }"
          :title="`${chatPanelVisible ? t('studio.panel.collapse') : t('studio.panel.expand')} · ${t('studio.panel.chat')} (Ctrl+J)`"
          :aria-label="`${chatPanelVisible ? t('studio.panel.collapse') : t('studio.panel.expand')} · ${t('studio.panel.chat')}`"
          :aria-pressed="chatPanelVisible"
          @click="toggleChatPanel()"
        >
          <svg
            class="panel-toggle-svg"
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="none"
            aria-hidden="true"
          >
            <rect
              x="1.5"
              y="2.5"
              width="13"
              height="11"
              rx="2"
              stroke="currentColor"
              stroke-width="1.3"
            />
            <line x1="10" y1="2.5" x2="10" y2="13.5" stroke="currentColor" stroke-width="1.3" />
            <rect
              v-if="chatPanelVisible"
              x="11"
              y="3.6"
              width="2.4"
              height="8.8"
              rx="0.6"
              fill="currentColor"
            />
          </svg>
          <span class="panel-toggle-label">{{ t('studio.panel.chat') }}</span>
        </button>
      </div>
    </div>
    <div class="studio-main">
      <WorkspaceToolbar class="studio-left-tool-rail" />
      <DockviewVue
        class="studio-dock"
        :theme="dockTheme"
        :components="dockComponents"
        :tab-components="dockTabComponents"
        default-tab-component="editorTab"
        :get-tab-context-menu-items="getTabContextMenuItems"
        floating-group-bounds="boundedWithinViewport"
        @ready="onReady"
      />
      <StudioSideToolBar :dock-api="dockApi" />
    </div>
    <SaveAssetDialog
      :open="saveDialogOpen"
      :default-name="saveDefaultName"
      :default-folder-id="saveDefaultFolderId"
      @confirm="onSaveDraftConfirm"
      @cancel="closeSaveDialog"
    />
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'StudioView' })
import {
  computed,
  defineComponent,
  h,
  markRaw,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch
} from 'vue'
import { useRouter } from 'vue-router'
import { DockviewVue, themeDark, themeLight } from 'dockview-vue'
import { themePreference } from '../editor/preferences'
import type {
  DockviewApi,
  DockviewGroupPanel,
  DockviewReadyEvent,
  GetTabContextMenuItemsParams,
  IDockviewPanel,
  VueComponent
} from 'dockview-vue'
import { isDraftAssetId } from '@shared/domain'
import { useProjectStore } from '../stores/project'
import { useWorkspaceStore } from '../stores/workspace'
import { useDraftStore } from '../stores/drafts'
import { useGraphTaskStore } from '../stores/graphTasks'
import { useGraphRunLogsStore } from '../stores/graphRunLogs'
import { useMcpActivitiesStore } from '../stores/mcpActivities'
import { useDraftSave } from '../composables/useDraftSave'
import SaveAssetDialog from '../components/SaveAssetDialog.vue'
import EditorDockTab from '../components/EditorDockTab.vue'
import StudioSideToolBar from '../components/StudioSideToolBar.vue'
import WorkspaceToolbar from '../components/WorkspaceToolbar.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import {
  createEditorWindowComponents,
  executeEditorCommand,
  listPersistentEditorWindowIds
} from '../editor/extensions'
import { useEditorKernel } from '../editor/kernel'
import { diveEditorHistory } from '../features/graph/ui/diveEditorHistory'
import { usePanelTitles } from '../editor/workbench/usePanelTitles'
import { useEditorPanelOpener } from '../editor/workbench/useEditorPanelOpener'
import { isEditorPanelGraphRunning } from '../editor/workbench/canCloseEditorPanel'
import { parseEditorPanelId } from '../editor/workbench/editorPanelIcon'
import {
  clearDockDropArtifacts,
  clearSidePanelDropTargetOverlays,
  configureSidePanelStackDropTargets,
  handleSidePanelLayoutMaybeStacked,
  handleSidePanelMoved,
  hasDockDropOverlayArtifacts,
  noteSidePanelWillStackDrop,
  registerSidePanelDockApi,
  registerSidePanelSizeProvider,
  rebalanceHorizontalColumns,
  rememberedExpandedSideWidth,
  resolveSidePanelSizeOptions,
  setChatPanelVisible,
  shouldPreventSidePanelDrop,
  shouldPreventSidePanelOverlay,
  sidePanelCollapsed,
  sidePanelInitialWidth,
  syncSidePanelCollapseState,
  toggleSidePanelCollapsed,
  type SidePanelId
} from '../editor/workbench/sidePanelCollapse'
import { promptAlert } from '../composables/useStudioPrompt'
import {
  DEFAULT_LAYOUT_ID,
  getActivePreset,
  isDockLayoutData,
  loadLayoutsState,
  saveLayoutsState,
  updateActiveLayoutData,
  healDockLayoutMissingPanelRefs,
  sanitizeSidePanelCollapseFromLayoutData,
  stripPanelsFromDockLayout,
  type StudioLayoutsState
} from '../utils/studioLayouts'

const PANEL_IDS = ['workspace', 'assets', 'inspector'] as const
const CENTER_PANEL_ID = 'workspace'
const WORKSPACE_TOOLS_PANEL_ID = 'workspace-tools'
const CHAT_PANEL_ID = 'chat'
const CHAT_PANEL_MIN_WIDTH = 240
const dockTheme = computed(() => (themePreference.value === 'light' ? themeLight : themeDark))
const LOCKED_PANEL_IDS = new Set([CENTER_PANEL_ID, WORKSPACE_TOOLS_PANEL_ID])
/**
 * 现代简洁布局（左至右）：
 * [ 左侧工具条 ] | [ 资产面板 (assets) ] | [ 画布 (workspace) ] | [ 属性 (inspector) ] | [ 会话 (chat) ]
 */
const DEFAULT_LAYOUT_RATIO = {
  assets: 0.17,
  inspector: 0.18,
  chat: 0.21,
  minSide: 220,
  maxSide: 420
} as const
const VALID_DOCK_COMPONENTS = new Set(listPersistentEditorWindowIds())

const router = useRouter()
const { t, locale } = useStudioI18n()
const project = useProjectStore()
const workspace = useWorkspaceStore()
const drafts = useDraftStore()
const editor = useEditorKernel()
const taskStore = useGraphTaskStore()
const runLogsStore = useGraphRunLogsStore()
const mcpActivities = useMcpActivitiesStore()

/**
 * 任务按钮角标：工作流任务 + 运行中的 MCP 旁路活动（外部 Agent 触发的
 * 生成 / 单枚图标精修回炉等）。MCP 活动不进工作流任务系统，
 * 若不计入角标，Agent 触发期间界面上将毫无提示。
 */
const busyCount = computed(
  () =>
    taskStore.runningCount +
    mcpActivities.activities.filter((activity) => activity.status === 'running').length
)

/**
 * 工具栏 ↶↷：内嵌 dive 编辑器（图层分离等）打开时代理到其草稿历史，
 * 否则驱动主图命令栈。详见 diveEditorHistory。
 */
const toolbarCanUndo = computed(
  () => diveEditorHistory.active.value?.canUndo() ?? editor.commands.canUndo.value
)
const toolbarCanRedo = computed(
  () => diveEditorHistory.active.value?.canRedo() ?? editor.commands.canRedo.value
)
function onToolbarUndo(): void {
  const history = diveEditorHistory.active.value
  if (history) {
    history.undo()
    return
  }
  void executeEditorCommand('editor.undo', editor)
}
function onToolbarRedo(): void {
  const history = diveEditorHistory.active.value
  if (history) {
    history.redo()
    return
  }
  void executeEditorCommand('editor.redo', editor)
}
const tasksBtnEl = ref<HTMLButtonElement | null>(null)
const { commitDraft, activeDraftId, defaultSaveName } = useDraftSave()
const dockApi = shallowRef<DockviewApi | null>(null)
const panelTitles = usePanelTitles(dockApi)
const panelOpener = useEditorPanelOpener({
  dockApi,
  centerReferenceId: (api) => centerReferenceId(api),
  title: panelTitles.title
})

const saveDialogOpen = ref(false)
const saveDraftId = ref<string | null>(null)
const saveDefaultName = ref('')
const saveDefaultFolderId = ref<string | null>(null)

const layouts = ref<StudioLayoutsState>(loadLayoutsState('Default'))

let saveTimer: ReturnType<typeof setTimeout> | null = null
let layoutDisposable: { dispose: () => void } | null = null
let removeDisposable: { dispose: () => void } | null = null
let moveDisposable: { dispose: () => void } | null = null
let dropDisposable: { dispose: () => void } | null = null
let willDropDisposable: { dispose: () => void } | null = null
let willShowOverlayDisposable: { dispose: () => void } | null = null
let willDragPanelDisposable: { dispose: () => void } | null = null
/** Suppress ensureCorePanels / persist while rebuilding layout */
let layoutMutating = false

function commitLayouts(next: StudioLayoutsState): void {
  layouts.value = next
  saveLayoutsState(next)
}

function sanitizeShellLayoutData(data: Record<string, unknown>): Record<string, unknown> {
  const shellOnly = stripDocumentEditorPanelsFromLayoutData(data)
  return sanitizeSidePanelCollapseFromLayoutData(shellOnly, {
    minSide: DEFAULT_LAYOUT_RATIO.minSide,
    fallbackWidth: (id) => rememberedExpandedSideWidth(id, sidePanelSizeOptions(id))
  })
}

function closeSaveDialog(): void {
  saveDialogOpen.value = false
  saveDraftId.value = null
}

function openSaveDialog(draftId: string): void {
  const draft = drafts.getDraft(draftId)
  if (!draft) return
  saveDraftId.value = draftId
  saveDefaultName.value = defaultSaveName(draftId)
  saveDefaultFolderId.value = draft.folderId ?? null
  saveDialogOpen.value = true
}

async function onSaveDraftConfirm(payload: {
  name: string
  folderId: string | null
}): Promise<void> {
  const draftId = saveDraftId.value
  if (!draftId) return
  try {
    await commitDraft(draftId, payload.name, payload.folderId, dockApi.value)
    closeSaveDialog()
  } catch (e) {
    console.error('[studio] save draft failed', e)
    alert(e instanceof Error ? e.message : String(e))
  }
}

const chatPanelVisible = ref(true)

function syncChatPanelState(api: DockviewApi): void {
  const panel = api.getPanel(CHAT_PANEL_ID)
  chatPanelVisible.value = !!panel && panel.api.isVisible
}

function toggleSidePanel(id: SidePanelId): void {
  const api = dockApi.value?.getPanel(id)?.api
  if (!api) return
  toggleSidePanelCollapsed(api, resolveSidePanelSizeOptions(id))
}

function toggleChatPanel(): void {
  const api = dockApi.value
  if (!api) return
  const { chat } = defaultSideWidths()
  const panel = api.getPanel(CHAT_PANEL_ID)
  if (!panel) {
    api.addPanel({
      id: CHAT_PANEL_ID,
      component: 'chat',
      title: t('studio.panel.chat'),
      position: {
        referencePanel: api.getPanel('inspector')?.id ?? CENTER_PANEL_ID,
        direction: 'right'
      },
      initialWidth: chat,
      minimumWidth: CHAT_PANEL_MIN_WIDTH
    })
    rebalanceHorizontalColumns(api, { chat })
    syncChatPanelState(api)
    return
  }
  const nextVisible = !panel.api.isVisible
  setChatPanelVisible(api, nextVisible, chat)
  syncChatPanelState(api)
}

function isEditableKeyboardTarget(target: HTMLElement | null): boolean {
  if (!target) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function onGlobalKeyDown(e: KeyboardEvent): void {
  if (!(e.ctrlKey || e.metaKey)) return
  const target = e.target as HTMLElement | null
  if (target?.closest('.sfw-mask')) return
  const key = e.key.toLowerCase()

  if (!e.shiftKey && !e.altKey && !isEditableKeyboardTarget(target)) {
    if (key === 'b') {
      e.preventDefault()
      toggleSidePanel('assets')
      return
    }
    if (key === 'i') {
      e.preventDefault()
      toggleSidePanel('inspector')
      return
    }
    if (key === 'j') {
      e.preventDefault()
      toggleChatPanel()
      return
    }
  }

  if (key !== 's') return
  const draftId = activeDraftId()
  e.preventDefault()
  if (draftId) {
    openSaveDialog(draftId)
    return
  }
  void executeEditorCommand('editor.saveAll', editor).catch((error) => {
    console.error('[studio] save documents failed', error)
  })
}

function cleanupDraftEditor(panelId: string, prefix: string, consume: (id: string) => void): void {
  const id = panelId.slice(prefix.length)
  if (isDraftAssetId(id)) drafts.removeDraft(id)
  consume(id)
}

const dockTabComponents: Record<string, VueComponent> = {
  editorTab: markRaw(EditorDockTab) as unknown as VueComponent,
  lockedTab: markRaw(
    defineComponent({
      name: 'LockedTab',
      props: {
        params: { type: Object, required: true }
      },
      setup(props) {
        const title = computed(() => {
          const raw = props.params as {
            api?: { title?: string }
            params?: { api?: { title?: string } }
          }
          return String(raw.api?.title ?? raw.params?.api?.title ?? t('studio.panel.workspace'))
        })
        return () =>
          h('div', { class: 'dv-default-tab locked-tab' }, [
            h('span', { class: 'dv-default-tab-content' }, title.value)
          ])
      }
    })
  ) as unknown as VueComponent
}

const dockComponents: Record<string, VueComponent> = createEditorWindowComponents({
  t: (key, params) => t(key, params ?? {})
})

function readDockWidth(): number {
  const el = document.querySelector('.studio-dock')
  if (el instanceof HTMLElement && el.clientWidth > 0) return el.clientWidth
  return window.innerWidth > 0 ? window.innerWidth : 1600
}

function clampRange(width: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, width)))
}

function defaultSideWidths(totalWidth = readDockWidth()): {
  assets: number
  inspector: number
  chat: number
} {
  return {
    assets: clampRange(totalWidth * DEFAULT_LAYOUT_RATIO.assets, 220, 320),
    inspector: clampRange(totalWidth * DEFAULT_LAYOUT_RATIO.inspector, 240, 340),
    chat: clampRange(totalWidth * DEFAULT_LAYOUT_RATIO.chat, CHAT_PANEL_MIN_WIDTH, 420)
  }
}

function sidePanelSizeOptions(id: SidePanelId) {
  const widths = defaultSideWidths()
  return {
    minSide: DEFAULT_LAYOUT_RATIO.minSide,
    maxSide: DEFAULT_LAYOUT_RATIO.maxSide,
    defaultWidth: widths[id]
  }
}

function applySidePanelCollapseSync(api: DockviewApi): void {
  syncSidePanelCollapseState(api, sidePanelSizeOptions)
  syncChatPanelState(api)
  // 布局 fromJSON / moveTo 后尺寸可能下一帧才稳定，再同步一次去掉灰洞
  requestAnimationFrame(() => {
    if (dockApi.value !== api) return
    syncSidePanelCollapseState(api, sidePanelSizeOptions)
    syncChatPanelState(api)
  })
}

function corePanelTitles(): Record<(typeof PANEL_IDS)[number] | 'chat', string> {
  return {
    workspace: t('studio.panel.workspace'),
    assets: t('studio.panel.assets'),
    inspector: t('studio.panel.inspector'),
    chat: t('studio.panel.chat')
  }
}

/** 布局持久化会存下旧语言标题，切换语言后需强制刷新 */
function applyCorePanelTitles(api: DockviewApi): void {
  const titles = corePanelTitles()
  for (const id of [...PANEL_IDS, 'chat'] as const) {
    const panel = api.getPanel(id)
    if (panel) panel.api.setTitle(titles[id])
  }
}

function applyDefaultLayoutSizes(api: DockviewApi): void {
  applySidePanelCollapseSync(api)
  const totalWidth = readDockWidth()
  const { assets, inspector, chat } = defaultSideWidths(totalWidth)
  rebalanceHorizontalColumns(api, { assets, inspector, chat })
}

function centerReferenceId(api: DockviewApi): string {
  return api.getPanel(CENTER_PANEL_ID)?.id ?? CENTER_PANEL_ID
}

function configureWorkspaceToolsPanel(api: DockviewApi): void {
  const legacyTools = api.getPanel(WORKSPACE_TOOLS_PANEL_ID)
  if (legacyTools) api.removePanel(legacyTools)
}

function addDefaultPanels(api: DockviewApi): void {
  const { assets, inspector, chat } = defaultSideWidths()
  api.addPanel({
    id: CENTER_PANEL_ID,
    component: 'workspace',
    title: t('studio.panel.workspace'),
    tabComponent: 'lockedTab'
  })
  // 左栏：资产面板（紧邻最左侧固定工具条右侧、画布左侧）
  const assetsInit = sidePanelInitialWidth('assets', assets, DEFAULT_LAYOUT_RATIO.minSide, {
    useRememberedWidth: false
  })
  api.addPanel({
    id: 'assets',
    component: 'assets',
    title: t('studio.panel.assets'),
    position: { referencePanel: CENTER_PANEL_ID, direction: 'left' },
    initialWidth: assetsInit.initialWidth,
    minimumWidth: assetsInit.minimumWidth,
    ...(assetsInit.maximumWidth != null ? { maximumWidth: assetsInit.maximumWidth } : {})
  })
  // 中右栏：属性面板（位于画布右侧）
  const inspectorInit = sidePanelInitialWidth(
    'inspector',
    inspector,
    DEFAULT_LAYOUT_RATIO.minSide,
    {
      useRememberedWidth: false
    }
  )
  api.addPanel({
    id: 'inspector',
    component: 'inspector',
    title: t('studio.panel.inspector'),
    position: { referencePanel: CENTER_PANEL_ID, direction: 'right' },
    initialWidth: inspectorInit.initialWidth,
    minimumWidth: inspectorInit.minimumWidth,
    ...(inspectorInit.maximumWidth != null ? { maximumWidth: inspectorInit.maximumWidth } : {})
  })
  // 最右栏：AI 会话面板（位于属性面板右侧）
  api.addPanel({
    id: CHAT_PANEL_ID,
    component: 'chat',
    title: t('studio.panel.chat'),
    position: { referencePanel: 'inspector', direction: 'right' },
    initialWidth: chat,
    minimumWidth: CHAT_PANEL_MIN_WIDTH
  })
  api.getPanel(CENTER_PANEL_ID)?.api.setActive()
}

function createDefaultLayout(api: DockviewApi): void {
  layoutMutating = true
  try {
    api.clear()
    addDefaultPanels(api)
    requestAnimationFrame(() => {
      configureWorkspaceToolsPanel(api)
      applyDefaultLayoutSizes(api)
    })
  } finally {
    layoutMutating = false
  }
}

function ensureCorePanels(api: DockviewApi): void {
  if (layoutMutating) return

  const legacyTools = api.getPanel(WORKSPACE_TOOLS_PANEL_ID)
  if (legacyTools) api.removePanel(legacyTools)

  const titleMap = corePanelTitles()

  if (!api.getPanel(CENTER_PANEL_ID)) {
    const ref = api.panels.find(
      (p) =>
        p.id.startsWith('canvas-editor-') ||
        p.id.startsWith('director-editor-') ||
        p.id.startsWith('screenplay-editor-') ||
        p.id.startsWith('asset-editor-')
    )
    api.addPanel({
      id: CENTER_PANEL_ID,
      component: 'workspace',
      title: titleMap.workspace,
      tabComponent: 'lockedTab',
      inactive: true,
      ...(ref
        ? { position: { referencePanel: ref.id, direction: 'within' as const } }
        : { floating: { width: 720, height: 480 } })
    })
  }

  const centerId = centerReferenceId(api)
  const { assets, inspector, chat } = defaultSideWidths()

  if (!api.getPanel('assets')) {
    const assetsInit = sidePanelInitialWidth('assets', assets, DEFAULT_LAYOUT_RATIO.minSide)
    api.addPanel({
      id: 'assets',
      component: 'assets',
      title: titleMap.assets,
      position: { referencePanel: centerId, direction: 'left' },
      initialWidth: assetsInit.initialWidth,
      minimumWidth: assetsInit.minimumWidth,
      ...(assetsInit.maximumWidth != null ? { maximumWidth: assetsInit.maximumWidth } : {})
    })
  }

  if (!api.getPanel('inspector')) {
    const inspectorInit = sidePanelInitialWidth(
      'inspector',
      inspector,
      DEFAULT_LAYOUT_RATIO.minSide
    )
    api.addPanel({
      id: 'inspector',
      component: 'inspector',
      title: titleMap.inspector,
      position: { referencePanel: centerId, direction: 'right' },
      initialWidth: inspectorInit.initialWidth,
      minimumWidth: inspectorInit.minimumWidth,
      ...(inspectorInit.maximumWidth != null ? { maximumWidth: inspectorInit.maximumWidth } : {})
    })
  }

  // AI 会话面板：位于属性面板右侧
  if (!api.getPanel(CHAT_PANEL_ID)) {
    api.addPanel({
      id: CHAT_PANEL_ID,
      component: 'chat',
      title: titleMap.chat,
      position: {
        referencePanel: api.getPanel('inspector')?.id ?? centerId,
        direction: 'right'
      },
      initialWidth: chat,
      minimumWidth: CHAT_PANEL_MIN_WIDTH
    })
  }

  applySidePanelCollapseSync(api)
}

function isStoredLayoutCompatible(raw: string): boolean {
  try {
    const data = JSON.parse(raw) as {
      panels?: Record<string, { views?: Array<{ contentComponent?: string }> }>
    }
    if (!data?.panels || typeof data.panels !== 'object') return false

    for (const panel of Object.values(data.panels)) {
      for (const view of panel.views ?? []) {
        const component = view.contentComponent
        if (component && !VALID_DOCK_COMPONENTS.has(component)) return false
      }
    }
    return true
  } catch {
    return false
  }
}

function persistLayout(api: DockviewApi): void {
  if (layoutMutating) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      const data = api.toJSON() as unknown
      if (!isDockLayoutData(data)) return
      // 布局只固化壳层展开几何；侧栏收起偏好走 localStorage，不写进 dock JSON
      const shellOnly = sanitizeShellLayoutData(data)
      const next = updateActiveLayoutData(layouts.value, shellOnly)
      if (next !== layouts.value) commitLayouts(next)
    } catch {
      // ignore
    }
  }, 250)
}

/** 文档编辑器属于工程会话，不应随 dock 布局跨工程保留 */
function removeDocumentEditorPanels(api: DockviewApi): void {
  for (const panel of [...api.panels]) {
    if (panel.id === WORKSPACE_TOOLS_PANEL_ID || parseEditorPanelId(panel.id)) {
      api.removePanel(panel)
    }
  }
  workspace.resetSession()
}

function stripDocumentEditorPanelsFromLayoutData(
  data: Record<string, unknown>
): Record<string, unknown> {
  return stripPanelsFromDockLayout(
    data,
    (panelId) => panelId === WORKSPACE_TOOLS_PANEL_ID || parseEditorPanelId(panelId) != null
  )
}

function tryRestoreLayout(api: DockviewApi): boolean {
  const active = getActivePreset(layouts.value)
  const candidates: unknown[] = []
  if (active.data) candidates.push(active.data)

  for (const data of candidates) {
    if (!isDockLayoutData(data)) continue
    const healed = sanitizeSidePanelCollapseFromLayoutData(healDockLayoutMissingPanelRefs(data), {
      minSide: DEFAULT_LAYOUT_RATIO.minSide,
      fallbackWidth: (id) => rememberedExpandedSideWidth(id, sidePanelSizeOptions(id))
    })
    const raw = JSON.stringify(healed)
    if (!isStoredLayoutCompatible(raw)) continue
    try {
      api.fromJSON(healed as unknown as Parameters<DockviewApi['fromJSON']>[0])
      removeDocumentEditorPanels(api)
      ensureCorePanels(api)
      applyCorePanelTitles(api)
      applySidePanelCollapseSync(api)
      if (api.panels.length === 0) {
        api.clear()
        continue
      }
      return true
    } catch {
      // try next
    }
  }
  return false
}

/**
 * 兜底收尾：落点被拒时 onDidMovePanel / onDidDrop 都不会触发，半透明落点框会残留。
 *
 * 注意：pointerup 以 capture 注册，早于 dockview 完成 drop。若同步清掉
 * `.dv-drop-target-*`，会打断落位，出现「灰框闪过但参数面板没到灰框位置」。
 * 因此只在双 rAF 之后、且仍有残留时再清。
 */
function cleanupStrayDockDropOverlays(): void {
  const api = dockApi.value
  if (!api) return
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (dockApi.value !== api) return
      const root = typeof document !== 'undefined' ? document.querySelector('.studio-dock') : null
      if (!hasDockDropOverlayArtifacts(root)) return
      clearDockDropArtifacts(api)
    })
  })
}

function onReady(event: DockviewReadyEvent): void {
  const api = event.api
  dockApi.value = api
  registerSidePanelDockApi(api)
  layoutDisposable?.dispose()
  removeDisposable?.dispose()
  moveDisposable?.dispose()
  dropDisposable?.dispose()
  willDropDisposable?.dispose()
  willShowOverlayDisposable?.dispose()
  willDragPanelDisposable?.dispose()

  try {
    if (!tryRestoreLayout(api)) {
      createDefaultLayout(api)
    } else {
      configureWorkspaceToolsPanel(api)
      applyCorePanelTitles(api)
      applySidePanelCollapseSync(api)
    }
  } catch (err) {
    console.error('[studio] layout init failed', err)
    api.clear()
    createDefaultLayout(api)
  }

  // 拖动一开始就锁死侧栏 zones，避免首帧仍含 left/right
  willDragPanelDisposable = api.onWillDragPanel((event) => {
    if (event.panel.id === 'assets' || event.panel.id === 'inspector') {
      configureSidePanelStackDropTargets(api)
    }
  })
  layoutDisposable = api.onDidLayoutChange(() => {
    persistLayout(api)
    handleSidePanelLayoutMaybeStacked(api)
    syncChatPanelState(api)
    // location 变更会重置 drop zones，需维持上下 1/2 激活区
    configureSidePanelStackDropTargets(api)
  })
  willShowOverlayDisposable = api.onWillShowOverlay((event) => {
    const draggingId = event.getData()?.panelId
    // 侧栏互拖：先重新断言只允许 top/bottom/center，避免 location 重置带回 left/right
    if (typeof draggingId === 'string' && (draggingId === 'assets' || draggingId === 'inspector')) {
      configureSidePanelStackDropTargets(api)
    }
    if (shouldPreventSidePanelOverlay(event)) {
      event.preventDefault()
      // 锚点模式：preventDefault 后 _state 已空但 _model 可能仍挂着灰框
      clearSidePanelDropTargetOverlays(api)
    }
  })
  willDropDisposable = api.onWillDrop((event) => {
    const draggingId = event.getData()?.panelId
    if (typeof draggingId === 'string' && (draggingId === 'assets' || draggingId === 'inspector')) {
      configureSidePanelStackDropTargets(api)
    }
    if (shouldPreventSidePanelDrop(event)) {
      event.preventDefault()
      clearSidePanelDropTargetOverlays(api)
      return
    }
    noteSidePanelWillStackDrop(api, String(event.position), event.group, event.getData()?.panelId)
  })
  dropDisposable = api.onDidDrop((event) => {
    const movedId = event.getData()?.panelId
    noteSidePanelWillStackDrop(api, String(event.position), event.group, movedId)
    if (typeof movedId === 'string' && movedId) {
      handleSidePanelMoved(api, movedId)
      return
    }
    // 非面板拖放（外部文件等）同样要清掉落点覆盖层
    clearDockDropArtifacts(api)
    handleSidePanelLayoutMaybeStacked(api)
  })
  moveDisposable = api.onDidMovePanel((event) => {
    handleSidePanelMoved(api, event.panel.id)
  })
  removeDisposable = api.onDidRemovePanel((panel) => {
    if (panel.id.startsWith('asset-editor-')) {
      cleanupDraftEditor(panel.id, 'asset-editor-', workspace.consumeAssetEditor)
    }
    if (panel.id.startsWith('screenplay-editor-')) {
      cleanupDraftEditor(panel.id, 'screenplay-editor-', workspace.consumeScreenplayEditor)
    }
    if (panel.id.startsWith('canvas-editor-')) {
      cleanupDraftEditor(panel.id, 'canvas-editor-', workspace.consumeCanvasEditor)
    }
    if (panel.id.startsWith('director-editor-')) {
      cleanupDraftEditor(panel.id, 'director-editor-', workspace.consumeDirectorEditor)
    }
    if (panel.id === CHAT_PANEL_ID) {
      chatPanelVisible.value = false
    }
    if ((PANEL_IDS as readonly string[]).includes(panel.id)) {
      ensureCorePanels(api)
    }
  })

  panelOpener.openPending()
  panelTitles.apply()
}

watch(locale, () => {
  const api = dockApi.value
  if (api) applyCorePanelTitles(api)
})

function resetLayout(): void {
  const api = dockApi.value
  if (!api) return
  commitLayouts({ ...layouts.value, activeId: DEFAULT_LAYOUT_ID })

  layoutMutating = true
  try {
    api.clear()
    addDefaultPanels(api)
    requestAnimationFrame(() => {
      configureWorkspaceToolsPanel(api)
      applyDefaultLayoutSizes(api)
    })
  } finally {
    layoutMutating = false
  }
  persistLayout(api)
}

function floatPanel(api: DockviewApi, panel: IDockviewPanel): void {
  if (panel.api.location.type === 'floating') return
  api.addFloatingGroup(panel, {
    width: 360,
    height: 420
  })
}

function isClosablePanel(panel: IDockviewPanel): boolean {
  if (LOCKED_PANEL_IDS.has(panel.id)) return false
  if (panel.api.tabComponent === 'lockedTab') return false
  return true
}

function closePanels(api: DockviewApi, panels: readonly IDockviewPanel[]): void {
  let blocked = false
  for (const panel of panels) {
    if (!isClosablePanel(panel)) continue
    if (isEditorPanelGraphRunning(panel.id)) {
      blocked = true
      continue
    }
    if (api.getPanel(panel.id)) api.removePanel(panel)
  }
  if (blocked) {
    void promptAlert({
      title: t('common.tip'),
      message: t('studio.tabMenu.waitNodeRun')
    })
  }
}

type TabContextMenuItem = 'separator' | { label: string; action: () => void }

function getCloseTabMenuItems(
  api: DockviewApi,
  group: DockviewGroupPanel,
  panel: IDockviewPanel
): TabContextMenuItem[] {
  const panels = group.panels
  const index = panels.findIndex((item) => item.id === panel.id)
  if (index < 0) return []

  const closable = panels.filter(isClosablePanel)
  if (closable.length === 0) return []

  const items: TabContextMenuItem[] = []
  const others = panels.filter((item) => item.id !== panel.id && isClosablePanel(item))
  const left = panels.slice(0, index).filter(isClosablePanel)
  const right = panels.slice(index + 1).filter(isClosablePanel)

  if (isClosablePanel(panel)) {
    items.push({
      label: t('studio.tabMenu.close'),
      action: () => {
        if (isEditorPanelGraphRunning(panel.id)) {
          void promptAlert({
            title: t('common.tip'),
            message: t('studio.tabMenu.waitNodeRun')
          })
          return
        }
        api.removePanel(panel)
      }
    })
  }
  if (others.length > 0) {
    items.push({
      label: t('studio.tabMenu.closeOthers'),
      action: () => closePanels(api, others)
    })
  }
  if (right.length > 0) {
    items.push({
      label: t('studio.tabMenu.closeRight'),
      action: () => closePanels(api, right)
    })
  }
  if (left.length > 0) {
    items.push({
      label: t('studio.tabMenu.closeLeft'),
      action: () => closePanels(api, left)
    })
  }
  if (closable.length > 1) {
    items.push({
      label: t('studio.tabMenu.closeAll'),
      action: () => closePanels(api, closable)
    })
  }
  return items
}

function getTabContextMenuItems(params: GetTabContextMenuItemsParams) {
  const { panel, group, api } = params
  const items: TabContextMenuItem[] = []
  if (panel.id !== CENTER_PANEL_ID && !LOCKED_PANEL_IDS.has(panel.id)) {
    items.push({
      label: t('studio.tabMenu.float'),
      action: () => floatPanel(api, panel)
    })
    items.push({
      label: t('studio.tabMenu.detach'),
      action: () => {
        void api.addPopoutGroup(panel)
      }
    })
  }

  const closeItems = getCloseTabMenuItems(api, group, panel)
  if (closeItems.length > 0) {
    if (items.length > 0) items.push('separator')
    items.push(...closeItems)
  }

  if (items.length > 0) items.push('separator')
  items.push({
    label: t('studio.tabMenu.resetAll'),
    action: () => resetLayout()
  })
  return items
}

onMounted(() => {
  registerSidePanelSizeProvider(sidePanelSizeOptions)
  window.addEventListener('keydown', onGlobalKeyDown)
  window.addEventListener('pointerup', cleanupStrayDockDropOverlays, true)
  window.addEventListener('pointercancel', cleanupStrayDockDropOverlays, true)
})

onBeforeUnmount(() => {
  registerSidePanelSizeProvider(null)
  registerSidePanelDockApi(null)
  window.removeEventListener('keydown', onGlobalKeyDown)
  window.removeEventListener('pointerup', cleanupStrayDockDropOverlays, true)
  window.removeEventListener('pointercancel', cleanupStrayDockDropOverlays, true)
  if (saveTimer) clearTimeout(saveTimer)
  layoutDisposable?.dispose()
  removeDisposable?.dispose()
  moveDisposable?.dispose()
  dropDisposable?.dispose()
  willDropDisposable?.dispose()
  willShowOverlayDisposable?.dispose()
  willDragPanelDisposable?.dispose()
  layoutDisposable = null
  removeDisposable = null
  moveDisposable = null
  dropDisposable = null
  willDropDisposable = null
  willShowOverlayDisposable = null
  willDragPanelDisposable = null
  dockApi.value = null
})
</script>

<style scoped>
.empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-muted);
}

.studio {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg);
}

.studio-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
  flex-shrink: 0;
}

.toolbar-panel-toggles {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.toolbar-sep {
  width: 1px;
  height: 14px;
  background: var(--border);
  flex-shrink: 0;
}

.panel-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 7px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  transition:
    background 0.14s ease,
    color 0.14s ease,
    border-color 0.14s ease;
}

.panel-toggle-btn:hover {
  color: var(--text);
  background: var(--bg-hover);
}

.panel-toggle-btn.is-active {
  color: var(--text);
  background: var(--accent-25);
  border-color: var(--accent);
}

.panel-toggle-svg {
  flex-shrink: 0;
  display: block;
}

.panel-toggle-label {
  white-space: nowrap;
  user-select: none;
}

.hint {
  color: var(--text-muted);
  font-size: 12px;
  margin-right: auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tasks-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transform-origin: center center;
}

.tasks-badge {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--accent-25);
  color: var(--accent-fg);
  font-size: 10px;
  line-height: 16px;
  text-align: center;
}

.tasks-badge.live {
  min-width: 10px;
  padding: 0;
  background: rgba(61, 180, 120, 0.35);
  color: #7dcea0;
}

.studio-main {
  flex: 1;
  display: flex;
  min-height: 0;
  min-width: 0;
}

.studio-left-tool-rail {
  width: 44px;
  flex: 0 0 44px;
  height: 100%;
}

/*
 * dockview-vue 7.0.4 起 DockviewVue 的根节点是 Fragment（dock 容器 div + 面板 Teleport 宿主），
 * 而父组件的 scoped 属性只会落到「单根」子组件的根元素上——所以内层 div 只拿得到 class
 * `studio-dock`，拿不到 `data-v-*`，直接写 `.studio-dock` 的 scoped 规则会全部失配
 * （dock 被压成 0 宽：竖栏贴左边、中间整片空白且点不动）。
 * 因此这里一律从本组件自己的元素 `.studio-main` 用 `:deep()` 穿下去，
 * 编译结果 `.studio-main[data-v-*] .studio-dock …` 能稳定命中。新增规则请沿用该前缀。
 */
.studio-main :deep(.studio-dock) {
  flex: 1;
  min-height: 0;
  min-width: 0;
}

.studio-main :deep(.studio-dock .panel-fill) {
  height: 100%;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
}

.studio-main :deep(.studio-dock .dv-tabs-and-actions-container) {
  background: var(--bg-elevated);
}

/* 标签栏可滚动，但不显示横向滚动条 */
.studio-main :deep(.studio-dock .dv-tabs-and-actions-container .dv-tabs-container) {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.studio-main
  :deep(.studio-dock .dv-tabs-and-actions-container .dv-tabs-container::-webkit-scrollbar) {
  display: none;
  width: 0;
  height: 0;
}

.studio-main :deep(.studio-dock .dv-tabs-and-actions-container .dv-scrollbar-horizontal) {
  display: none !important;
}

.studio-main :deep(.studio-dock .dv-groupview) {
  background: var(--bg);
}

.studio-main :deep(.studio-dock .dv-panel) {
  background: var(--bg-panel);
}

.studio-main :deep(.studio-dock .dv-floating-titlebar) {
  background: var(--bg-elevated);
}

.studio-main :deep(.studio-dock .locked-tab) {
  padding: 0 10px;
  display: flex;
  align-items: center;
  height: 100%;
}

.studio-main :deep(.studio-dock .editor-tab) {
  position: relative;
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  max-width: 100%;
  width: 100%;
  height: 100%;
  padding: 0 16px 0 6px;
  box-sizing: border-box;
}

.studio-main :deep(.studio-dock .editor-tab .dv-default-tab-content) {
  flex: 1 1 auto;
  min-width: 0;
  margin-right: 0;
  padding-right: 2px;
}

.studio-main :deep(.studio-dock .editor-tab .dv-default-tab-action) {
  position: absolute;
  top: 2px;
  right: 2px;
  padding: 1px;
  width: 12px;
  height: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  line-height: 0;
}

.studio-main :deep(.studio-dock .editor-tab .dv-default-tab-action .editor-tab-close-icon) {
  width: 8px;
  height: 8px;
  display: block;
}

/* 覆盖 dockview：选中标签也仅在悬停时显示关闭按钮 */
.studio-main :deep(.studio-dock .dv-tab .editor-tab .dv-default-tab-action) {
  visibility: hidden;
}

.studio-main :deep(.studio-dock .dv-tab:hover .editor-tab .dv-default-tab-action) {
  visibility: visible;
}

@media (hover: none) {
  .studio-main :deep(.studio-dock .dv-tab .editor-tab .dv-default-tab-action) {
    visibility: visible;
  }
}

.studio-main :deep(.studio-dock .editor-tab-icon) {
  flex-shrink: 0;
  font-size: 12px;
  line-height: 1;
}

.studio-main :deep(.studio-dock .editor-tab-content) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-main :deep(.studio-dock .workspace-tools-shell) {
  height: 100%;
  min-height: 0;
  overflow: visible;
  background: var(--bg-elevated);
}

.studio-main :deep(.studio-dock .workspace-tools-shell .workspace-toolbar) {
  height: 100%;
  border-right: none;
}

/* setVisible 是主路径；若组仍残留在布局里，用 CSS 压掉 0 宽灰条 */
.studio-main :deep(.studio-dock .dv-groupview.studio-side-collapsed) {
  border: none !important;
  min-width: 0 !important;
  max-width: 0 !important;
  width: 0 !important;
  overflow: hidden !important;
  opacity: 0;
  pointer-events: none;
}

/* 锚点容器勿用 JS remove（会弄坏 dockview _model）；仅隐藏空壳 */
.studio-main :deep(.studio-dock .dv-drop-target-container:empty) {
  display: none !important;
  pointer-events: none !important;
}
</style>
