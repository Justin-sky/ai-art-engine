<template>
  <StudioFloatingWindow
    :open="state.open"
    :title="windowTitle"
    :z-index="2200"
    :default-width="defaultWidth"
    :default-height="defaultHeight"
    :min-width="420"
    :min-height="320"
    body-class="pad-none media-preview-body"
    @close="closeMediaPreviewDialog"
  >
    <EditorDiveMediaPreview
      v-if="state.open"
      frame-key="media-preview-dialog"
      :media-kind="state.mediaKind"
      :url="state.url"
      :relative-path="state.relativePath || undefined"
      :title="state.title || undefined"
      :text="state.text || undefined"
    />
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import {
  closeMediaPreviewDialog,
  mediaPreviewDialogState
} from '../features/media/mediaPreviewDialog'
import EditorDiveMediaPreview from './dive/EditorDiveMediaPreview.vue'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

const { t } = useStudioI18n()
const state = mediaPreviewDialogState

const windowTitle = computed(() => {
  if (state.title) return state.title
  if (state.mediaKind === 'video') return t('graph.preview.videoTitle')
  if (state.mediaKind === 'audio') return t('graph.preview.audioTitle')
  if (state.mediaKind === 'text') return t('graph.notepad.title')
  return t('graph.preview.imageTitle')
})

const defaultWidth = computed(() => (state.mediaKind === 'text' ? 720 : 960))
const defaultHeight = computed(() => (state.mediaKind === 'text' ? 640 : 680))
</script>

<style scoped>
:deep(.media-preview-body) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0;
}

:deep(.media-preview) {
  min-height: 360px;
}
</style>
