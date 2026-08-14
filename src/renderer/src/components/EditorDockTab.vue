<template>
  <div class="dv-default-tab editor-tab">
    <span
      v-if="icon"
      class="editor-tab-icon"
      aria-hidden="true"
    >
      <WorkspaceItemIcon
        :icon="icon"
        :size="14"
      />
    </span>
    <span class="dv-default-tab-content editor-tab-content">{{ title }}</span>
    <div
      v-if="showClose"
      class="dv-default-tab-action"
      role="button"
      :aria-label="t('studio.tabMenu.close')"
      @pointerdown.stop.prevent
      @click.stop.prevent="onClose"
    >
      <svg
        class="dv-svg editor-tab-close-icon"
        width="8"
        height="8"
        viewBox="0 0 28 28"
        aria-hidden="true"
      >
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
import { useStudioI18n } from '../composables/useStudioI18n'
import { promptAlert } from '../composables/useStudioPrompt'
import WorkspaceItemIcon from './WorkspaceItemIcon.vue'

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
