<template>
  <div class="world-element-editor">
    <div class="toolbar">
      <span>{{ t('studio.editor.world') }}</span>
      <span class="spacer" />
      <span class="hint">{{ t('world.asset.hint') }}</span>
    </div>
    <NodeGraphEditor ref="worldGraphRef" class="world-graph" :asset-id="worldAssetId" />
    <WorldEditorDialog
      v-if="editorOpen"
      ref="editorDialogRef"
      :world-asset-id="worldAssetId"
      :initial-tab="editorInitialTab"
      @close="editorOpen = false"
    />
    <WorldTableDialog
      v-if="tableOpen"
      ref="tableDialogRef"
      :world-asset-id="worldAssetId"
      @close="tableOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, provide, ref } from 'vue'
import { isDraftAssetId } from '@shared/domain'
import type { WorldElementKind } from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import { worldEditorKey } from '../features/world/worldEditor'
import { worldTableKey } from '../features/world/worldTable'
import { useWorkspaceStore } from '../stores/workspace'
import NodeGraphEditor from './NodeGraphEditor.vue'
import WorldEditorDialog from './WorldEditorDialog.vue'
import WorldTableDialog from './WorldTableDialog.vue'

const props = defineProps<{
  worldAssetId: string
}>()

const { t } = useStudioI18n()
const workspace = useWorkspaceStore()
const worldGraphRef = ref<InstanceType<typeof NodeGraphEditor> | null>(null)
const editorDialogRef = ref<InstanceType<typeof WorldEditorDialog> | null>(null)
const tableDialogRef = ref<InstanceType<typeof WorldTableDialog> | null>(null)
const editorOpen = ref(false)
const tableOpen = ref(false)
const editorInitialTab = ref<WorldElementKind>('characters')

provide('worldAssetId', computed(() => props.worldAssetId))

async function openEditor(tab: WorldElementKind = 'characters'): Promise<void> {
  await worldGraphRef.value?.flushSave?.()

  if (isDraftAssetId(props.worldAssetId)) {
    editorInitialTab.value = tab
    editorOpen.value = true
    void nextTick(() => {
      editorDialogRef.value?.setTab?.(tab)
    })
    return
  }
  void window.studio.openWorldEditorWindow(props.worldAssetId, tab)
}

async function openTable(): Promise<void> {
  await worldGraphRef.value?.flushSave?.()
  if (isDraftAssetId(props.worldAssetId)) {
    tableOpen.value = true
    return
  }
  void window.studio.openWorldTableWindow(props.worldAssetId)
}

provide(worldEditorKey, {
  openWorldEditor: (tab) => {
    void openEditor(tab ?? 'characters')
  }
})

provide(worldTableKey, {
  openWorldTable: () => {
    void openTable()
  }
})

onBeforeUnmount(() => {
  workspace.consumeWorldEditor(props.worldAssetId)
})
</script>

<style scoped>
.world-element-editor {
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
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.spacer {
  flex: 1;
}

.hint {
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.world-graph {
  flex: 1;
  min-height: 0;
}
</style>
