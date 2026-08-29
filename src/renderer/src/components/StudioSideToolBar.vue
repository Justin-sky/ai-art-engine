<template>
  <aside
    class="studio-side-rail"
    role="toolbar"
    :aria-label="`${t('studio.panel.assets')} / ${t('studio.panel.inspector')} / ${t('studio.panel.chat')}`"
  >
    <button
      v-for="item in items"
      :key="item.id"
      type="button"
      class="rail-btn"
      :class="{ 'is-active': isActive(item) }"
      :title="buttonTitle(item)"
      :aria-label="buttonTitle(item)"
      :aria-pressed="isActive(item)"
      @click="onToggle(item.id)"
    >
      <span
        class="rail-icon"
        aria-hidden="true"
      >{{ item.icon }}</span>
      <span class="rail-label">{{ item.label }}</span>
    </button>
  </aside>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { DockviewApi, IDockviewPanel } from 'dockview-vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import {
  resolveSidePanelSizeOptions,
  SIDE_PANEL_IDS,
  sidePanelCollapsed,
  toggleSidePanelCollapsed,
  type SidePanelId
} from '../editor/workbench/sidePanelCollapse'

const CHAT_PANEL_ID = 'chat'
const CHAT_PANEL_WIDTH = 320
const CHAT_PANEL_MIN_WIDTH = 220

const props = defineProps<{
  dockApi: DockviewApi | null
}>()

const { t } = useStudioI18n()

const RAIL_ICONS: Record<SidePanelId, string> = {
  assets: '▦',
  inspector: '☰'
}

type RailItem = {
  id: SidePanelId | typeof CHAT_PANEL_ID
  icon: string
  label: string
}

/** chat 是普通 dock 面板，不参与侧栏收起体系；这里单独维护其开关状态 */
const chatOpen = ref(false)

const items = computed<RailItem[]>(() => [
  ...SIDE_PANEL_IDS.map((id) => ({
    id,
    icon: RAIL_ICONS[id],
    label: t(`studio.panel.${id}`)
  })),
  { id: CHAT_PANEL_ID, icon: '◈', label: t('studio.panel.chat') }
])

function isActive(item: RailItem): boolean {
  if (item.id === CHAT_PANEL_ID) return chatOpen.value
  return !sidePanelCollapsed[item.id]
}

function buttonTitle(item: RailItem): string {
  const action = isActive(item) ? t('studio.panel.collapse') : t('studio.panel.expand')
  return `${action} · ${item.label}`
}

function onToggle(id: RailItem['id']): void {
  if (id === CHAT_PANEL_ID) {
    toggleChat()
    return
  }
  const api = props.dockApi?.getPanel(id)?.api
  if (!api) return
  toggleSidePanelCollapsed(api, resolveSidePanelSizeOptions(id))
}

function chatPanel(api: DockviewApi): IDockviewPanel | undefined {
  return api.getPanel(CHAT_PANEL_ID)
}

function syncChatState(api: DockviewApi): void {
  const panel = chatPanel(api)
  chatOpen.value = !!panel && panel.api.isVisible
}

/** dockview 面板级 API 无 setVisible，需作用于所在 group（与侧栏收起一致） */
function setChatVisible(panel: IDockviewPanel, visible: boolean): void {
  panel.api.group?.api.setVisible(visible)
}

function toggleChat(): void {
  const api = props.dockApi
  if (!api) return
  const panel = chatPanel(api)
  if (!panel) {
    api.addPanel({
      id: CHAT_PANEL_ID,
      component: 'chat',
      title: t('studio.panel.chat'),
      position: {
        referencePanel:
          api.getPanel('inspector')?.id ?? api.getPanel('assets')?.id ?? 'workspace',
        direction: 'right'
      },
      initialWidth: CHAT_PANEL_WIDTH,
      minimumWidth: CHAT_PANEL_MIN_WIDTH
    })
    syncChatState(api)
    return
  }
  const nextVisible = !panel.api.isVisible
  setChatVisible(panel, nextVisible)
  if (nextVisible) panel.api.setActive()
  syncChatState(api)
}

let disposables: Array<{ dispose(): void }> = []

watch(
  () => props.dockApi,
  (api) => {
    for (const d of disposables) d.dispose()
    disposables = []
    if (!api) return
    syncChatState(api)
    disposables = [
      api.onDidLayoutChange(() => syncChatState(api)),
      api.onDidRemovePanel((panel) => {
        if (panel.id === CHAT_PANEL_ID) chatOpen.value = false
      })
    ]
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  for (const d of disposables) d.dispose()
  disposables = []
})
</script>

<style scoped>
.studio-side-rail {
  flex-shrink: 0;
  width: 28px;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
  padding: 4px 0;
  border-left: 1px solid var(--border);
  background: var(--bg-elevated);
}

.rail-btn {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 4px;
  width: 100%;
  min-height: 72px;
  margin: 0;
  padding: 8px 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.rail-btn::before {
  content: '';
  position: absolute;
  top: 6px;
  bottom: 6px;
  right: 0;
  width: 2px;
  border-radius: 1px 0 0 1px;
  background: transparent;
}

.rail-btn:hover {
  color: var(--text);
  background: var(--bg-hover);
}

.rail-btn.is-active {
  color: var(--text);
  background: var(--bg-panel);
}

.rail-btn.is-active::before {
  background: var(--accent, #4c8bf5);
}

.rail-icon {
  flex-shrink: 0;
  font-size: 12px;
  line-height: 1;
}

.rail-label {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  font-size: 11px;
  line-height: 1.2;
  letter-spacing: 0.06em;
  user-select: none;
}
</style>
