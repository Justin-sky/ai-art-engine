<template>
  <StudioFloatingWindow
    v-if="mode === 'modal'"
    :open="true"
    variant="editor"
    :close-title="t('script.dialog.close')"
    :z-index="1200"
    :default-width="1200"
    :default-height="760"
    :min-width="640"
    :min-height="400"
    body-class="pad-none"
    @close="requestClose"
  >
    <template #title>
      <span class="app-mark">{{ t('script.dialog.shotTable') }}</span>
    </template>

    <ShotTable
      ref="tableRef"
      class="shot-table-body"
      :script-asset-id="scriptAssetId"
      :world-element-outputs="worldElementOutputs"
    />

    <template #footer>
      <span class="statusbar">{{ t('script.hint.table') }}</span>
    </template>
  </StudioFloatingWindow>

  <div v-else class="shot-table-embed" :class="{ window: mode === 'window' }">
    <header class="titlebar" :class="{ drag: mode === 'window' }">
      <span class="app-mark no-drag">{{ t('script.dialog.shotTable') }}</span>
      <span class="statusbar no-drag">{{ t('script.hint.table') }}</span>
    </header>
    <ShotTable
      ref="tableRef"
      class="shot-table-body embed-body"
      :script-asset-id="scriptAssetId"
      :world-element-outputs="worldElementOutputs"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { WorldElementGenResult } from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import ShotTable from './ShotTable.vue'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

withDefaults(
  defineProps<{
    scriptAssetId: string
    mode?: 'modal' | 'window'
    worldElementOutputs?: WorldElementGenResult[]
  }>(),
  {
    mode: 'modal',
    worldElementOutputs: () => []
  }
)

const emit = defineEmits<{
  close: []
}>()

const { t } = useStudioI18n()
const tableRef = ref<InstanceType<typeof ShotTable> | null>(null)
let closing = false

async function flushSave(): Promise<void> {
  await tableRef.value?.flushSave()
}

async function requestClose(): Promise<void> {
  if (closing) return
  closing = true
  try {
    await flushSave()
    emit('close')
  } catch (error) {
    closing = false
    throw error
  }
}

defineExpose({
  flushSave,
  requestClose
})
</script>

<style scoped>
.shot-table-embed {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-panel);
  overflow: hidden;
}

.titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  cursor: default;
  user-select: none;
}

.shot-table-embed.window .titlebar.drag {
  -webkit-app-region: drag;
  app-region: drag;
  padding-right: 140px;
  padding-top: 10px;
  min-height: 40px;
  box-sizing: border-box;
}

.shot-table-embed.window .no-drag {
  -webkit-app-region: no-drag;
  app-region: no-drag;
  cursor: default;
  user-select: auto;
}

.app-mark {
  flex-shrink: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.shot-table-body {
  flex: 1;
  min-height: 0;
  height: 100%;
}

.embed-body {
  flex: 1;
  min-height: 0;
}

.statusbar {
  font-size: 11px;
  color: var(--text-muted);
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
