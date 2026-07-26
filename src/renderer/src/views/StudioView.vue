<template>
  <div v-if="!project.isOpen" class="empty">
    <p>{{ t('studio.noProject') }}</p>
    <button class="primary" @click="router.push('/')">{{ t('studio.backHome') }}</button>
  </div>
  <div v-else class="studio">
    <div class="studio-toolbar">
      <span class="hint">{{ t('studio.toolbar.hint') }}</span>
      <button
        type="button"
        :disabled="!editor.commands.canUndo.value"
        :title="t('studio.toolbar.undo')"
        @click="executeEditorCommand('editor.undo', editor)"
      >
        ↶
      </button>
      <button
        type="button"
        :disabled="!editor.commands.canRedo.value"
        :title="t('studio.toolbar.redo')"
        @click="executeEditorCommand('editor.redo', editor)"
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
        <span v-if="taskStore.runningCount > 0" class="tasks-badge">
          {{ taskStore.runningCount }}
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
      <label class="layout-field">
        <span class="layout-label">{{ t('studio.layout.select') }}</span>
        <select :value="layouts.activeId" @change="onLayoutSelect">
          <option v-for="preset in layouts.presets" :key="preset.id" :value="preset.id">
            {{ presetLabel(preset) }}
          </option>
        </select>
      </label>
      <button type="button" @click="openSaveLayoutDialog">{{ t('studio.layout.save') }}</button>
      <button type="button" @click="exportActiveLayout">{{ t('studio.layout.export') }}</button>
      <button type="button" @click="triggerImportLayout">{{ t('studio.layout.import') }}</button>
      <button
        v-if="canDeleteActive"
        type="button"
        @click="removeActiveLayout"
      >
        {{ t('studio.layout.delete') }}
      </button>
      <input
        ref="importInputEl"
        type="file"
        accept=".json,application/json"
        hidden
        @change="onImportFile"
      />
    </div>
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
    <SaveAssetDialog
      :open="saveDialogOpen"
      :default-name="saveDefaultName"
      :default-folder-id="saveDefaultFolderId"
      @confirm="onSaveDraftConfirm"
      @cancel="closeSaveDialog"
    />
    <SaveLayoutDialog
      :open="saveLayoutOpen"
      :default-name="saveLayoutDefaultName"
      @confirm="onSaveLayoutConfirm"
      @cancel="closeSaveLayoutDialog"
    />
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'StudioView' })
import { computed, defineComponent, h, markRaw, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
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
import { useDraftSave } from '../composables/useDraftSave'
import SaveAssetDialog from '../components/SaveAssetDialog.vue'
import SaveLayoutDialog from '../components/SaveLayoutDialog.vue'
import EditorDockTab from '../components/EditorDockTab.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import {
  createEditorWindowComponents,
  executeEditorCommand,
  listPersistentEditorWindowIds
} from '../editor/extensions'
import { useEditorKernel } from '../editor/kernel'
import { usePanelTitles } from '../editor/workbench/usePanelTitles'
import { useEditorPanelOpener } from '../editor/workbench/useEditorPanelOpener'
import { isEditorPanelGraphRunning } from '../editor/workbench/canCloseEditorPanel'
import { parseEditorPanelId } from '../editor/workbench/editorPanelIcon'
import { promptAlert } from '../composables/useStudioPrompt'
import {
  DEFAULT_LAYOUT_ID,
  buildLayoutFile,
  deleteLayout,
  downloadLayoutFile,
  getActivePreset,
  isDockLayoutData,
  loadLayoutsState,
  readLayoutFileFromInput,
  saveLayoutsState,
  updateActiveLayoutData,
  upsertNamedLayout,
  healDockLayoutMissingPanelRefs,
  stripPanelsFromDockLayout,
  type StudioLayoutPreset,
  type StudioLayoutsState
} from '../utils/studioLayouts'

const PANEL_IDS = ['workspace-tools', 'workspace', 'assets', 'inspector'] as const
const CENTER_PANEL_ID = 'workspace'
const WORKSPACE_TOOLS_PANEL_ID = 'workspace-tools'
const dockTheme = computed(() =>
  themePreference.value === 'light' ? themeLight : themeDark
)
const WORKSPACE_TOOLS_WIDTH = 44
const LOCKED_PANEL_IDS = new Set([CENTER_PANEL_ID, WORKSPACE_TOOLS_PANEL_ID])
/** 默认布局：资产与参数同宽，各约占 25%（上限放宽以便更宽） */
const DEFAULT_LAYOUT_RATIO = {
  side: 0.25,
  minSide: 300,
  maxSide: 480
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
const saveLayoutOpen = ref(false)
const saveLayoutDefaultName = ref('')
const importInputEl = ref<HTMLInputElement | null>(null)

const canDeleteActive = computed(() => {
  const active = getActivePreset(layouts.value)
  return active.id !== DEFAULT_LAYOUT_ID && !active.builtIn
})

let saveTimer: ReturnType<typeof setTimeout> | null = null
let layoutDisposable: { dispose: () => void } | null = null
let removeDisposable: { dispose: () => void } | null = null
/** Suppress ensureCorePanels / persist while rebuilding layout */
let layoutMutating = false

function presetLabel(preset: StudioLayoutPreset): string {
  if (preset.id === DEFAULT_LAYOUT_ID) return t('studio.layout.default')
  return preset.name
}

function commitLayouts(next: StudioLayoutsState): void {
  layouts.value = next
  saveLayoutsState(next)
}

function closeSaveLayoutDialog(): void {
  saveLayoutOpen.value = false
}

function openSaveLayoutDialog(): void {
  const active = getActivePreset(layouts.value)
  saveLayoutDefaultName.value =
    active.id === DEFAULT_LAYOUT_ID ? t('studio.layout.newName') : active.name
  saveLayoutOpen.value = true
}

function onSaveLayoutConfirm(name: string): void {
  const api = dockApi.value
  if (!api) return
  const data = api.toJSON() as unknown
  if (!isDockLayoutData(data)) {
    alert(t('studio.layout.invalid'))
    return
  }
  const shellOnly = stripDocumentEditorPanelsFromLayoutData(data)
  if (!isDockLayoutData(shellOnly)) {
    alert(t('studio.layout.invalid'))
    return
  }
  const active = getActivePreset(layouts.value)
  try {
    const next = upsertNamedLayout(layouts.value, name, shellOnly, {
      targetId: active.id === DEFAULT_LAYOUT_ID ? null : active.id
    })
    commitLayouts(next)
    closeSaveLayoutDialog()
  } catch {
    alert(t('validation.nameRequired'))
  }
}

function onLayoutSelect(event: Event): void {
  const id = (event.target as HTMLSelectElement).value
  void applyLayoutById(id)
}

async function applyLayoutById(id: string): Promise<void> {
  const api = dockApi.value
  if (!api) return
  const preset = layouts.value.presets.find((p) => p.id === id)
  if (!preset) return
  const previousId = layouts.value.activeId
  commitLayouts({ ...layouts.value, activeId: id })
  if (preset.id === DEFAULT_LAYOUT_ID || !preset.data) {
    resetLayout()
    return
  }
  const raw = JSON.stringify(preset.data)
  if (!isStoredLayoutCompatible(raw)) {
    console.error('[studio] stored layout incompatible', preset.id)
    commitLayouts({ ...layouts.value, activeId: previousId })
    return
  }
  applyStoredLayout(api, healDockLayoutMissingPanelRefs(preset.data))
}

function applyStoredLayout(api: DockviewApi, data: Record<string, unknown>): void {
  layoutMutating = true
  try {
    api.clear()
    api.fromJSON(data as unknown as Parameters<DockviewApi['fromJSON']>[0])
    removeDocumentEditorPanels(api)
    ensureCorePanels(api)
    applyCorePanelTitles(api)
    configureWorkspaceToolsPanel(api)
  } catch (err) {
    console.error('[studio] apply layout failed', err)
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

function exportActiveLayout(): void {
  const api = dockApi.value
  if (!api) return
  const data = api.toJSON() as unknown
  if (!isDockLayoutData(data)) {
    alert(t('studio.layout.invalid'))
    return
  }
  const active = getActivePreset(layouts.value)
  const name = active.id === DEFAULT_LAYOUT_ID ? t('studio.layout.default') : active.name
  downloadLayoutFile(buildLayoutFile(name, stripDocumentEditorPanelsFromLayoutData(data)))
}

function triggerImportLayout(): void {
  importInputEl.value?.click()
}

async function onImportFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const imported = await readLayoutFileFromInput(file)
    const shellOnly = stripDocumentEditorPanelsFromLayoutData(imported.layout)
    if (!isDockLayoutData(shellOnly)) {
      alert(t('studio.layout.invalidFile'))
      return
    }
    const next = upsertNamedLayout(layouts.value, imported.name, shellOnly)
    commitLayouts(next)
    const api = dockApi.value
    if (api) applyStoredLayout(api, shellOnly)
  } catch (e) {
    console.error('[studio] import layout failed', e)
    alert(t('studio.layout.invalidFile'))
  }
}

function removeActiveLayout(): void {
  const active = getActivePreset(layouts.value)
  if (active.id === DEFAULT_LAYOUT_ID) return
  if (!confirm(t('studio.layout.deleteConfirm', { name: active.name }))) return
  const next = deleteLayout(layouts.value, active.id)
  commitLayouts(next)
  void applyLayoutById(next.activeId)
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

async function onSaveDraftConfirm(payload: { name: string; folderId: string | null }): Promise<void> {
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

function onGlobalKeyDown(e: KeyboardEvent): void {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return
  const target = e.target as HTMLElement | null
  if (target?.closest('.sfw-mask')) return
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

async function exportCanvas(): Promise<string | null> {
  return workspace.exportCanvasForActiveShot()
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
  t: (key, params) => t(key, params ?? {}),
  exportCanvas
})

function readDockWidth(): number {
  const el = document.querySelector('.studio-dock')
  if (el instanceof HTMLElement && el.clientWidth > 0) return el.clientWidth
  return window.innerWidth > 0 ? window.innerWidth : 1600
}

function clampSideWidth(width: number): number {
  return Math.round(
    Math.min(DEFAULT_LAYOUT_RATIO.maxSide, Math.max(DEFAULT_LAYOUT_RATIO.minSide, width))
  )
}

function defaultSideWidths(totalWidth = readDockWidth()): { assets: number; inspector: number } {
  const side = clampSideWidth(totalWidth * DEFAULT_LAYOUT_RATIO.side)
  return { assets: side, inspector: side }
}

function corePanelTitles(): Record<(typeof PANEL_IDS)[number], string> {
  return {
    'workspace-tools': t('studio.panel.tools'),
    workspace: t('studio.panel.workspace'),
    assets: t('studio.panel.assets'),
    inspector: t('studio.panel.inspector')
  }
}

/** 布局持久化会存下旧语言标题，切换语言后需强制刷新 */
function applyCorePanelTitles(api: DockviewApi): void {
  const titles = corePanelTitles()
  for (const id of PANEL_IDS) {
    const panel = api.getPanel(id)
    if (panel) panel.api.setTitle(titles[id])
  }
}

function applyDefaultLayoutSizes(api: DockviewApi): void {
  const { assets, inspector } = defaultSideWidths()
  // Dockview 会从左侧相邻组腾出空间；先设右侧参数栏，再设资产栏，
  // 避免参数栏的第二次 resize 把资产栏重新压窄。
  api.getPanel('inspector')?.api.setSize({ width: inspector })
  api.getPanel('assets')?.api.setSize({ width: assets })
}

function centerReferenceId(api: DockviewApi): string {
  return api.getPanel(CENTER_PANEL_ID)?.id ?? CENTER_PANEL_ID
}

function addWorkspaceToolsPanel(api: DockviewApi, referencePanelId: string): void {
  if (api.getPanel(WORKSPACE_TOOLS_PANEL_ID)) return
  api.addPanel({
    id: WORKSPACE_TOOLS_PANEL_ID,
    component: 'workspaceToolbar',
    title: t('studio.panel.tools'),
    tabComponent: 'lockedTab',
    position: { referencePanel: referencePanelId, direction: 'left' },
    initialWidth: WORKSPACE_TOOLS_WIDTH,
    minimumWidth: WORKSPACE_TOOLS_WIDTH,
    maximumWidth: WORKSPACE_TOOLS_WIDTH
  })
  configureWorkspaceToolsPanel(api)
}

function configureWorkspaceToolsPanel(api: DockviewApi): void {
  const panel = api.getPanel(WORKSPACE_TOOLS_PANEL_ID)
  if (!panel) return
  const group = panel.group as { header?: { hidden?: boolean } }
  if (group.header) group.header.hidden = true
}

function addDefaultPanels(api: DockviewApi): void {
  const { assets, inspector } = defaultSideWidths()
  api.addPanel({
    id: CENTER_PANEL_ID,
    component: 'workspace',
    title: t('studio.panel.workspace'),
    tabComponent: 'lockedTab'
  })
  addWorkspaceToolsPanel(api, CENTER_PANEL_ID)
  api.addPanel({
    id: 'assets',
    component: 'assets',
    title: t('studio.panel.assets'),
    position: { referencePanel: CENTER_PANEL_ID, direction: 'right' },
    initialWidth: assets,
    minimumWidth: DEFAULT_LAYOUT_RATIO.minSide
  })
  api.addPanel({
    id: 'inspector',
    component: 'inspector',
    title: t('studio.panel.inspector'),
    position: { referencePanel: 'assets', direction: 'right' },
    initialWidth: inspector,
    minimumWidth: DEFAULT_LAYOUT_RATIO.minSide
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

  const titleMap = corePanelTitles()

  if (!api.getPanel(CENTER_PANEL_ID)) {
    const ref = api.panels.find(
      (p) =>
        p.id.startsWith('script-editor-') ||
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
  addWorkspaceToolsPanel(api, centerId)
  const { assets, inspector } = defaultSideWidths()

  if (!api.getPanel('assets')) {
    api.addPanel({
      id: 'assets',
      component: 'assets',
      title: titleMap.assets,
      position: { referencePanel: centerId, direction: 'right' },
      initialWidth: assets,
      minimumWidth: DEFAULT_LAYOUT_RATIO.minSide
    })
  }

  if (!api.getPanel('inspector')) {
    const assetsRef = api.getPanel('assets')?.id ?? centerId
    api.addPanel({
      id: 'inspector',
      component: 'inspector',
      title: titleMap.inspector,
      position: { referencePanel: assetsRef, direction: 'right' },
      initialWidth: inspector,
      minimumWidth: DEFAULT_LAYOUT_RATIO.minSide
    })
  }
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
      // 布局只固化壳层面板；文档编辑器 tab 在恢复/切换工程时剥离
      const shellOnly = stripDocumentEditorPanelsFromLayoutData(data)
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
    if (parseEditorPanelId(panel.id)) api.removePanel(panel)
  }
  workspace.resetSession()
}

function stripDocumentEditorPanelsFromLayoutData(
  data: Record<string, unknown>
): Record<string, unknown> {
  return stripPanelsFromDockLayout(data, (panelId) => parseEditorPanelId(panelId) != null)
}

function tryRestoreLayout(api: DockviewApi): boolean {
  const active = getActivePreset(layouts.value)
  const candidates: unknown[] = []
  if (active.data) candidates.push(active.data)

  for (const data of candidates) {
    if (!isDockLayoutData(data)) continue
    const raw = JSON.stringify(data)
    if (!isStoredLayoutCompatible(raw)) continue
    try {
      api.fromJSON(data as unknown as Parameters<DockviewApi['fromJSON']>[0])
      removeDocumentEditorPanels(api)
      ensureCorePanels(api)
      applyCorePanelTitles(api)
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

function onReady(event: DockviewReadyEvent): void {
  const api = event.api
  dockApi.value = api
  layoutDisposable?.dispose()
  removeDisposable?.dispose()

  try {
    if (!tryRestoreLayout(api)) {
      createDefaultLayout(api)
    } else {
      configureWorkspaceToolsPanel(api)
      applyCorePanelTitles(api)
    }
  } catch (err) {
    console.error('[studio] layout init failed', err)
    api.clear()
    createDefaultLayout(api)
  }

  layoutDisposable = api.onDidLayoutChange(() => {
    persistLayout(api)
  })
  removeDisposable = api.onDidRemovePanel((panel) => {
    if (panel.id.startsWith('asset-editor-')) {
      cleanupDraftEditor(panel.id, 'asset-editor-', workspace.consumeAssetEditor)
    }
    if (panel.id.startsWith('screenplay-editor-')) {
      cleanupDraftEditor(panel.id, 'screenplay-editor-', workspace.consumeScreenplayEditor)
    }
    if (panel.id.startsWith('script-editor-')) {
      cleanupDraftEditor(panel.id, 'script-editor-', workspace.consumeScriptEditor)
    }
    if (panel.id.startsWith('canvas-editor-')) {
      cleanupDraftEditor(panel.id, 'canvas-editor-', workspace.consumeCanvasEditor)
    }
    if (panel.id.startsWith('director-editor-')) {
      cleanupDraftEditor(panel.id, 'director-editor-', workspace.consumeDirectorEditor)
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

type TabContextMenuItem =
  | 'separator'
  | { label: string; action: () => void }

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
  window.addEventListener('keydown', onGlobalKeyDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeyDown)
  if (saveTimer) clearTimeout(saveTimer)
  layoutDisposable?.dispose()
  removeDisposable?.dispose()
  layoutDisposable = null
  removeDisposable = null
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
  gap: 10px;
  height: 32px;
  padding: 0 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
  flex-shrink: 0;
}

.hint {
  color: var(--text-muted);
  font-size: 12px;
  margin-right: auto;
}

.layout-field {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  font-size: 12px;
}

.layout-field select {
  min-width: 140px;
  max-width: 220px;
}

.layout-label {
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

.studio-dock {
  flex: 1;
  min-height: 0;
  width: 100%;
}

.studio-dock :deep(.panel-fill) {
  height: 100%;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
}

.studio-dock :deep(.dv-tabs-and-actions-container) {
  background: var(--bg-elevated);
}

/* 标签栏可滚动，但不显示横向滚动条 */
.studio-dock :deep(.dv-tabs-and-actions-container .dv-tabs-container) {
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.studio-dock :deep(.dv-tabs-and-actions-container .dv-tabs-container::-webkit-scrollbar) {
  display: none;
  width: 0;
  height: 0;
}

.studio-dock :deep(.dv-tabs-and-actions-container .dv-scrollbar-horizontal) {
  display: none !important;
}

.studio-dock :deep(.dv-groupview) {
  background: var(--bg);
}

.studio-dock :deep(.dv-panel) {
  background: var(--bg-panel);
}

.studio-dock :deep(.dv-floating-titlebar) {
  background: var(--bg-elevated);
}

.studio-dock :deep(.locked-tab) {
  padding: 0 10px;
  display: flex;
  align-items: center;
  height: 100%;
}

.studio-dock :deep(.editor-tab) {
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

.studio-dock :deep(.editor-tab .dv-default-tab-content) {
  flex: 1 1 auto;
  min-width: 0;
  margin-right: 0;
  padding-right: 2px;
}

.studio-dock :deep(.editor-tab .dv-default-tab-action) {
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

.studio-dock :deep(.editor-tab .dv-default-tab-action .editor-tab-close-icon) {
  width: 8px;
  height: 8px;
  display: block;
}

/* 覆盖 dockview：选中标签也仅在悬停时显示关闭按钮 */
.studio-dock :deep(.dv-tab .editor-tab .dv-default-tab-action) {
  visibility: hidden;
}

.studio-dock :deep(.dv-tab:hover .editor-tab .dv-default-tab-action) {
  visibility: visible;
}

@media (hover: none) {
  .studio-dock :deep(.dv-tab .editor-tab .dv-default-tab-action) {
    visibility: visible;
  }
}

.studio-dock :deep(.editor-tab-icon) {
  flex-shrink: 0;
  font-size: 12px;
  line-height: 1;
}

.studio-dock :deep(.editor-tab-content) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-dock :deep(.workspace-tools-shell) {
  height: 100%;
  min-height: 0;
  overflow: visible;
  background: var(--bg-elevated);
}

.studio-dock :deep(.workspace-tools-shell .workspace-toolbar) {
  height: 100%;
  border-right: none;
}
</style>
