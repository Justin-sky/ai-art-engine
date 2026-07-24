<template>
  <StudioFloatingWindow
    :open="true"
    variant="editor"
    :close-title="t('narrative.dialog.close')"
    :z-index="1200"
    :default-width="1100"
    :default-height="720"
    :min-width="720"
    :min-height="420"
    body-class="pad-none"
    @close="requestClose"
  >
    <template #title>
      <span class="app-mark">{{ t('narrative.dialog.editor') }}</span>
    </template>

    <NarrativeEditorBody
      ref="bodyRef"
      class="narrative-editor-body"
      :narrative-asset-id="narrativeAssetId"
    />

    <template #footer>
      <span class="statusbar">{{ t('narrative.hint.editor') }}</span>
    </template>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import NarrativeEditorBody from './NarrativeEditorBody.vue'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

defineProps<{
  narrativeAssetId: string
}>()

const emit = defineEmits<{
  close: []
}>()

const { t } = useStudioI18n()
const bodyRef = ref<InstanceType<typeof NarrativeEditorBody> | null>(null)
let closing = false

async function flushSave(): Promise<void> {
  await bodyRef.value?.flushSave()
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
.app-mark {
  flex-shrink: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.narrative-editor-body {
  flex: 1;
  min-height: 0;
  height: 100%;
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
