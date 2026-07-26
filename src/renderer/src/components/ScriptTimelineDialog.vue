<template>
  <StudioFloatingWindow
    v-if="mode === 'modal'"
    :open="true"
    variant="editor"
    :close-title="t('script.dialog.close')"
    :z-index="1200"
    :default-width="1440"
    :default-height="900"
    :min-width="960"
    :min-height="640"
    body-class="pad-none"
    @close="requestClose"
  >
    <template #title>
      <span class="app-mark">{{ t('script.dialog.timeline') }}</span>
    </template>

    <ScriptTimelineEditor
      ref="editorRef"
      class="timeline-body"
      :script-asset-id="scriptAssetId"
    />

    <template #footer>
      <span class="statusbar">{{ t('script.hint.timeline') }}</span>
    </template>
  </StudioFloatingWindow>

  <div v-else class="timeline-embed" :class="{ window: mode === 'window' }">
    <header class="titlebar" :class="{ drag: mode === 'window' }">
      <span class="app-mark no-drag">{{ t('script.dialog.timeline') }}</span>
      <span class="statusbar no-drag">{{ t('script.hint.timeline') }}</span>
    </header>
    <ScriptTimelineEditor
      ref="editorRef"
      class="timeline-body embed-body"
      :script-asset-id="scriptAssetId"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import ScriptTimelineEditor from './ScriptTimelineEditor.vue'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

withDefaults(
  defineProps<{
    scriptAssetId: string
    mode?: 'modal' | 'window'
  }>(),
  {
    mode: 'modal'
  }
)

const emit = defineEmits<{
  close: []
}>()

const { t } = useStudioI18n()
const editorRef = ref<InstanceType<typeof ScriptTimelineEditor> | null>(null)
let closing = false

async function flushSave(): Promise<void> {
  await editorRef.value?.flushSave()
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
.timeline-embed {
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

.timeline-embed.window .titlebar.drag {
  -webkit-app-region: drag;
  app-region: drag;
  padding-right: 140px;
  padding-top: 10px;
  min-height: 40px;
  box-sizing: border-box;
}

.timeline-embed.window .no-drag {
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

.timeline-body {
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
