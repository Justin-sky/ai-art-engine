<template>
  <div class="narrative-asset-editor">
    <div class="toolbar">
      <span>{{ t('studio.editor.narrative') }}</span>
      <span class="spacer" />
      <span class="hint">{{ t('narrative.asset.hint') }}</span>
    </div>
    <NodeGraphEditor ref="narrativeGraphRef" class="narrative-graph" :asset-id="narrativeAssetId" />
    <NarrativeTableDialog
      v-if="tableOpen"
      ref="tableDialogRef"
      :narrative-asset-id="narrativeAssetId"
      @close="tableOpen = false"
    />
    <NarrativeEditorDialog
      v-if="editorOpen"
      ref="editorDialogRef"
      :narrative-asset-id="narrativeAssetId"
      @close="editorOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, provide, ref } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { narrativeEditorKey } from '../features/narrative/narrativeEditor'
import { narrativeTableKey } from '../features/narrative/narrativeTable'
import { useWorkspaceStore } from '../stores/workspace'
import NodeGraphEditor from './NodeGraphEditor.vue'
import NarrativeEditorDialog from './NarrativeEditorDialog.vue'
import NarrativeTableDialog from './NarrativeTableDialog.vue'

const props = defineProps<{
  narrativeAssetId: string
}>()

const { t } = useStudioI18n()
const workspace = useWorkspaceStore()
const narrativeGraphRef = ref<InstanceType<typeof NodeGraphEditor> | null>(null)
const tableDialogRef = ref<InstanceType<typeof NarrativeTableDialog> | null>(null)
const editorDialogRef = ref<InstanceType<typeof NarrativeEditorDialog> | null>(null)
const tableOpen = ref(false)
const editorOpen = ref(false)

provide('narrativeAssetId', computed(() => props.narrativeAssetId))

async function openTable(): Promise<void> {
  await narrativeGraphRef.value?.flushSave?.()
  tableOpen.value = true
}

async function openEditor(): Promise<void> {
  await narrativeGraphRef.value?.flushSave?.()
  editorOpen.value = true
}

provide(narrativeTableKey, {
  openNarrativeTable: () => {
    void openTable()
  }
})

provide(narrativeEditorKey, {
  openNarrativeEditor: () => {
    void openEditor()
  }
})

onBeforeUnmount(() => {
  workspace.consumeNarrativeEditor(props.narrativeAssetId)
})
</script>

<style scoped>
.narrative-asset-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-panel);
  position: relative;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  flex-shrink: 0;
}

.spacer {
  flex: 1;
}

.hint {
  color: var(--text-muted);
  font-size: 11px;
}

.narrative-graph {
  flex: 1;
  min-height: 0;
}
</style>
