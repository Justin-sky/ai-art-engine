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
      <span class="app-mark">{{ dialogTitle }}</span>
    </template>

    <ShotEditorBody ref="bodyRef" :script-asset-id="scriptAssetId" :kind="kind" />

    <template #footer>
      <span class="statusbar">{{ statusHint }}</span>
    </template>
  </StudioFloatingWindow>

  <div v-else class="shot-editor-embed" :class="{ window: mode === 'window' }">
    <header class="titlebar" :class="{ drag: mode === 'window' }">
      <span class="app-mark no-drag">{{ dialogTitle }}</span>
      <span class="statusbar no-drag">{{ statusHint }}</span>
    </header>
    <ShotEditorBody
      ref="bodyRef"
      class="embed-body"
      :script-asset-id="scriptAssetId"
      :kind="kind"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import ShotEditorBody from './ShotEditorBody.vue'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

const props = withDefaults(
  defineProps<{
    scriptAssetId: string
    mode?: 'modal' | 'window'
    kind?: 'image' | 'video'
  }>(),
  {
    mode: 'modal',
    kind: 'video'
  }
)

const emit = defineEmits<{
  close: []
}>()

const { t } = useStudioI18n()
const bodyRef = ref<InstanceType<typeof ShotEditorBody> | null>(null)
let closing = false

const dialogTitle = computed(() =>
  props.kind === 'image' ? t('script.dialog.shotImageEditor') : t('script.dialog.shotVideoEditor')
)

const statusHint = computed(() =>
  props.kind === 'image' ? t('script.hint.imageGraph') : t('script.hint.videoGraph')
)

async function requestClose(): Promise<void> {
  if (closing) return
  closing = true
  try {
    await bodyRef.value?.flushSave()
    emit('close')
  } catch (error) {
    closing = false
    throw error
  }
}

defineExpose({
  flushSave: () => bodyRef.value?.flushSave(),
  requestClose
})
</script>

<style scoped>
.shot-editor-embed {
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

.shot-editor-embed.window .titlebar.drag {
  -webkit-app-region: drag;
  app-region: drag;
  padding-right: 140px;
  padding-top: 10px;
  min-height: 40px;
  box-sizing: border-box;
}

.shot-editor-embed.window .no-drag {
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
