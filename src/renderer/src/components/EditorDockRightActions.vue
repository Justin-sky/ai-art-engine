<template>
  <div v-if="isChatGroup" class="editor-dock-right-actions">
    <button
      type="button"
      class="chat-tab-fullscreen-btn"
      :class="{ 'is-active': isChatFullscreen }"
      :title="buttonTitle"
      :aria-label="buttonTitle"
      :aria-pressed="isChatFullscreen"
      @pointerdown.stop
      @mousedown.stop
      @dblclick.stop
      @click.stop="onToggle"
    >
      <svg
        class="chat-tab-fs-svg"
        viewBox="0 0 16 16"
        width="13"
        height="13"
        fill="none"
        aria-hidden="true"
      >
        <path
          v-if="!isChatFullscreen"
          d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"
          stroke="currentColor"
          stroke-width="1.45"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          v-else
          d="M6 2.5V6H2.5M10 2.5V6h3.5M13.5 10H10v3.5M2.5 10H6v3.5"
          stroke="currentColor"
          stroke-width="1.45"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span class="chat-tab-fs-label">
        {{ isChatFullscreen ? t('studio.fullscreen.exit') : t('studio.fullscreen.enter') }}
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { DockviewGroupPanel, IDockviewPanel } from 'dockview-vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useWorkspaceFullscreen } from '../composables/useWorkspaceFullscreen'

type HeaderActionParams = {
  group?: DockviewGroupPanel
  activePanel?: IDockviewPanel
  panels?: readonly IDockviewPanel[]
}

const props = defineProps<{
  params: HeaderActionParams
}>()

const { t } = useStudioI18n()
const { isChatFullscreen, toggleChatFullscreen } = useWorkspaceFullscreen()

const groupRef = shallowRef<DockviewGroupPanel | null>(null)
const activePanelId = ref('')
let groupDisposables: Array<{ dispose(): void }> = []

function clearGroupDisposables(): void {
  for (const d of groupDisposables) {
    d.dispose()
  }
  groupDisposables = []
}

function syncFromGroup(group: DockviewGroupPanel | null): void {
  if (!group) return
  activePanelId.value = group.activePanel?.id ?? ''
}

function attachGroup(group: DockviewGroupPanel | undefined): void {
  if (!group || group === groupRef.value) return
  clearGroupDisposables()
  groupRef.value = group
  syncFromGroup(group)
  groupDisposables.push(
    group.api.onDidActivePanelChange(() => syncFromGroup(group)),
    group.model.onDidAddPanel(() => syncFromGroup(group)),
    group.model.onDidRemovePanel(() => syncFromGroup(group))
  )
}

watch(
  () => props.params?.group,
  (group) => {
    if (group) {
      attachGroup(group)
    } else if (groupRef.value) {
      syncFromGroup(groupRef.value)
    }
  },
  { immediate: true }
)

watch(
  () => props.params?.activePanel?.id,
  (id) => {
    if (typeof id === 'string') {
      activePanelId.value = id
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  clearGroupDisposables()
})

const isChatGroup = computed(() => activePanelId.value === 'chat')

const buttonTitle = computed(() =>
  isChatFullscreen.value
    ? t('studio.fullscreen.exitChatTitle')
    : t('studio.fullscreen.enterChatTitle')
)

function onToggle(): void {
  toggleChatFullscreen()
}
</script>

<style scoped>
.editor-dock-right-actions {
  display: inline-flex;
  align-items: center;
  height: 100%;
  padding-right: 6px;
}

.chat-tab-fullscreen-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 22px;
  padding: 0 7px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  flex-shrink: 0;
  cursor: pointer;
  transition:
    color 0.14s ease,
    background 0.14s ease,
    border-color 0.14s ease;
}

.chat-tab-fullscreen-btn:hover {
  color: var(--text);
  background: var(--bg-hover);
  border-color: color-mix(in srgb, var(--text) 24%, var(--border));
}

.chat-tab-fullscreen-btn.is-active {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, var(--bg-elevated));
  border-color: var(--accent);
}

.chat-tab-fs-svg {
  flex-shrink: 0;
  display: block;
}

.chat-tab-fs-label {
  line-height: 1;
}
</style>
