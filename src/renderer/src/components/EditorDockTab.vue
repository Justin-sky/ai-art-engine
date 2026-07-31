<template>
  <div
    class="dv-default-tab editor-tab"
    :class="{ 'is-side-collapsed': sideCollapsed, 'has-side-collapse': showSideCollapse }"
  >
    <span v-if="icon && !sideCollapsed" class="editor-tab-icon" aria-hidden="true">{{ icon }}</span>
    <span v-if="!sideCollapsed" class="dv-default-tab-content editor-tab-content">{{ title }}</span>
    <button
      v-if="showSideCollapse"
      type="button"
      class="editor-tab-collapse"
      :title="sideCollapsed ? t('studio.panel.expand') : t('studio.panel.collapse')"
      :aria-label="sideCollapsed ? t('studio.panel.expand') : t('studio.panel.collapse')"
      :aria-expanded="!sideCollapsed"
      @pointerdown.stop.prevent
      @click.stop.prevent="onToggleSideCollapse"
    >
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
        <path
          v-if="sideCollapsed"
          fill="currentColor"
          d="M9.8 3.2 5 8l4.8 4.8.9-.9L6.8 8 10.7 4.1z"
        />
        <path
          v-else
          fill="currentColor"
          d="M6.2 3.2 11 8l-4.8 4.8-.9-.9L9.2 8 5.3 4.1z"
        />
      </svg>
    </button>
    <div
      v-if="showClose && !sideCollapsed"
      class="dv-default-tab-action"
      role="button"
      :aria-label="t('studio.tabMenu.close')"
      @pointerdown.stop.prevent
      @click.stop.prevent="onClose"
    >
      <svg class="dv-svg editor-tab-close-icon" width="8" height="8" viewBox="0 0 28 28" aria-hidden="true">
        <path
          d="M2.1 27.3L0 25.2L11.55 13.65L0 2.1L2.1 0L13.65 11.55L25.2 0L27.3 2.1L15.75 13.65L27.3 25.2L25.2 27.3L13.65 15.75L2.1 27.3Z"
        />
      </svg>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { DockviewPanelApi } from 'dockview-vue'
import { isClosableDockTab, resolveEditorPanelIcon } from '../editor/workbench/editorPanelIcon'
import { isEditorPanelGraphRunning } from '../editor/workbench/canCloseEditorPanel'
import {
  isSidePanelId,
  resolveSidePanelSizeOptions,
  sidePanelCollapsed,
  toggleSidePanelCollapsed
} from '../editor/workbench/sidePanelCollapse'
import { useStudioI18n } from '../composables/useStudioI18n'
import { promptAlert } from '../composables/useStudioPrompt'

type TabParams = {
  api?: DockviewPanelApi
  title?: string
  params?: TabParams
}

const props = defineProps<{
  params: TabParams
}>()

const { t } = useStudioI18n()
const titleRevision = ref(0)
let titleDisposable: { dispose(): void } | null = null

function readTabApi(): DockviewPanelApi | undefined {
  return props.params.api ?? props.params.params?.api
}

function readFallbackTitle(): string {
  return String(props.params.title ?? props.params.params?.title ?? '')
}

function detachTitleListener(): void {
  titleDisposable?.dispose()
  titleDisposable = null
}

function attachTitleListener(api: DockviewPanelApi | undefined): void {
  detachTitleListener()
  if (!api) return
  titleDisposable = api.onDidTitleChange(() => {
    titleRevision.value++
  })
}

watch(
  () => readTabApi()?.id,
  () => {
    attachTitleListener(readTabApi())
    titleRevision.value++
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  detachTitleListener()
})

const panelId = computed(() => readTabApi()?.id ?? '')
const title = computed(() => {
  void titleRevision.value
  const api = readTabApi()
  return String(api?.title ?? readFallbackTitle())
})
const icon = computed(() => resolveEditorPanelIcon(panelId.value))
const showClose = computed(() =>
  isClosableDockTab(panelId.value, readTabApi()?.tabComponent)
)
const showSideCollapse = computed(() => isSidePanelId(panelId.value))
const sideCollapsed = computed(() => {
  const id = panelId.value
  return isSidePanelId(id) ? sidePanelCollapsed[id] : false
})

function onToggleSideCollapse(): void {
  const api = readTabApi()
  if (!api || !isSidePanelId(api.id)) return
  toggleSidePanelCollapsed(api, resolveSidePanelSizeOptions(api.id))
}

async function onClose(): Promise<void> {
  const api = readTabApi()
  if (!api) return
  if (isEditorPanelGraphRunning(api.id)) {
    await promptAlert({
      title: t('common.tip'),
      message: t('studio.tabMenu.waitNodeRun')
    })
    return
  }
  api.close()
}
</script>

<style scoped>
.editor-tab.has-side-collapse:not(.is-side-collapsed) {
  padding-right: 34px;
}

.editor-tab-collapse {
  position: absolute;
  top: 50%;
  right: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  margin: 0;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transform: translateY(-50%);
}

.editor-tab-collapse:hover {
  border-color: var(--border);
  color: var(--text);
  background: var(--bg-hover);
}

.editor-tab.is-side-collapsed {
  justify-content: center;
  padding: 0 2px;
  gap: 0;
}

.editor-tab.is-side-collapsed .editor-tab-collapse {
  position: static;
  transform: none;
}
</style>
