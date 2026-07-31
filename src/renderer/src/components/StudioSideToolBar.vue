<template>
  <aside
    class="studio-side-rail"
    role="toolbar"
    :aria-label="`${t('studio.panel.assets')} / ${t('studio.panel.inspector')}`"
  >
    <button
      v-for="item in items"
      :key="item.id"
      type="button"
      class="rail-btn"
      :class="{ 'is-active': !sidePanelCollapsed[item.id] }"
      :title="buttonTitle(item)"
      :aria-label="buttonTitle(item)"
      :aria-pressed="!sidePanelCollapsed[item.id]"
      @click="onToggle(item.id)"
    >
      <span class="rail-icon" aria-hidden="true">{{ item.icon }}</span>
      <span class="rail-label">{{ item.label }}</span>
    </button>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { DockviewApi } from 'dockview-vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import {
  resolveSidePanelSizeOptions,
  SIDE_PANEL_IDS,
  sidePanelCollapsed,
  toggleSidePanelCollapsed,
  type SidePanelId
} from '../editor/workbench/sidePanelCollapse'

const props = defineProps<{
  dockApi: DockviewApi | null
}>()

const { t } = useStudioI18n()

const RAIL_ICONS: Record<SidePanelId, string> = {
  assets: '▦',
  inspector: '☰'
}

const items = computed(() =>
  SIDE_PANEL_IDS.map((id) => ({
    id,
    icon: RAIL_ICONS[id],
    label: t(`studio.panel.${id}`)
  }))
)

function buttonTitle(item: { id: SidePanelId; label: string }): string {
  const action = sidePanelCollapsed[item.id] ? t('studio.panel.expand') : t('studio.panel.collapse')
  return `${action} · ${item.label}`
}

function onToggle(id: SidePanelId): void {
  const api = props.dockApi?.getPanel(id)?.api
  if (!api) return
  toggleSidePanelCollapsed(api, resolveSidePanelSizeOptions(id))
}
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
