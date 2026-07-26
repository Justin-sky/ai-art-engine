<template>
  <div class="narrative-unit-editor-body">
    <div class="graph-row">
      <NodeGraphEditor
        v-if="activeUnitId"
        :key="`${narrativeAssetId}:${activeUnitId}`"
        ref="graphRef"
        class="unit-graph"
        :asset-id="narrativeAssetId"
        :narrative-unit-id="activeUnitId"
        scope="narrativeUnit"
        :hide-toolbar="hideGraphToolbar"
      />
      <p v-else class="empty">{{ t('narrative.strip.empty') }}</p>
    </div>
    <div class="units-section" :class="{ collapsed: !unitsExpanded }">
      <button
        type="button"
        class="units-collapse-btn"
        :title="unitsExpanded ? t('narrative.strip.collapse') : t('narrative.strip.expand')"
        :aria-label="unitsExpanded ? t('narrative.strip.collapse') : t('narrative.strip.expand')"
        :aria-expanded="unitsExpanded"
        @click="unitsExpanded = !unitsExpanded"
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path
            v-if="unitsExpanded"
            fill="currentColor"
            d="M3.2 9.8 8 5l4.8 4.8-.9.9L8 6.8 4.1 10.7z"
          />
          <path
            v-else
            fill="currentColor"
            d="M3.2 6.2 8 11l4.8-4.8-.9-.9L8 9.2 4.1 5.3z"
          />
        </svg>
        <span v-if="!unitsExpanded" class="units-collapse-label">{{ t('narrative.strip.title') }}</span>
      </button>
      <NarrativeUnitStrip
        v-show="unitsExpanded"
        ref="stripRef"
        class="unit-strip"
        :narrative-asset-id="narrativeAssetId"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useWorkspaceStore } from '../stores/workspace'
import NodeGraphEditor from './NodeGraphEditor.vue'
import NarrativeUnitStrip from './NarrativeUnitStrip.vue'

const props = withDefaults(
  defineProps<{
    narrativeAssetId: string
    hideGraphToolbar?: boolean
  }>(),
  {
    hideGraphToolbar: false
  }
)

const { t } = useStudioI18n()
const workspace = useWorkspaceStore()
const graphRef = ref<InstanceType<typeof NodeGraphEditor> | null>(null)
const stripRef = ref<InstanceType<typeof NarrativeUnitStrip> | null>(null)
const unitsExpanded = ref(true)

const narrativeAssetId = computed(() => props.narrativeAssetId)
const activeUnitId = computed(() => workspace.activeNarrativeUnitId)
const hideGraphToolbar = computed(() => props.hideGraphToolbar)

onMounted(() => {
  stripRef.value?.reload?.()
  workspace.focusNarrativeUnit()
})

async function flushSave(): Promise<void> {
  await graphRef.value?.flushSave?.()
}

defineExpose({ flushSave, reloadStrip: () => stripRef.value?.reload?.() })
</script>

<style scoped>
.narrative-unit-editor-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
}

.graph-row {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.unit-graph {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.empty {
  margin: auto;
  font-size: 12px;
  color: var(--text-muted);
}

.units-section {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--border);
  background: var(--bg-elevated);
  position: relative;
}

.units-collapse-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
  text-align: left;
}

.units-section:not(.collapsed) .units-collapse-btn {
  position: absolute;
  top: 4px;
  left: 4px;
  z-index: 2;
  width: 22px;
  height: 22px;
  padding: 0;
  justify-content: center;
  border-radius: 4px;
}

.units-section:not(.collapsed) .units-collapse-btn:hover {
  border: 1px solid var(--border);
  background: var(--bg-hover);
  color: var(--text);
}

.units-section.collapsed .units-collapse-btn {
  width: 100%;
}

.units-collapse-btn:hover {
  color: var(--text);
}

.units-collapse-label {
  font-weight: 600;
}

.unit-strip {
  flex-shrink: 0;
  height: 120px;
}

.units-section:not(.collapsed) .unit-strip :deep(.strip-toolbar) {
  padding-left: 30px;
}
</style>
