<template>
  <StudioFloatingWindow
    :open="state.open"
    :title="state.title || t('sheetPreview.title')"
    :z-index="2200"
    :default-width="1080"
    :default-height="760"
    :min-width="640"
    :min-height="460"
    body-class="pad-none sheet-preview-body"
    @close="closeFrameSheetPreviewDialog"
  >
    <SheetFramePreview
      v-if="state.open"
      :url="state.url"
      :initial-rows="state.rows"
      :initial-cols="state.cols"
    />
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { useStudioI18n } from '../composables/useStudioI18n'
import {
  closeFrameSheetPreviewDialog,
  frameSheetPreviewDialogState
} from '../features/media/frameSheetPreviewDialog'
import SheetFramePreview from './SheetFramePreview.vue'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

const { t } = useStudioI18n()
const state = frameSheetPreviewDialogState
</script>

<style scoped>
::deep(.sheet-preview-body) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0;
}
</style>
