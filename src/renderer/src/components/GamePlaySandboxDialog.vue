<template>
  <StudioFloatingWindow
    :open="state.open"
    :title="dialogTitle"
    :z-index="2200"
    :default-width="960"
    :default-height="640"
    :min-width="560"
    :min-height="400"
    body-class="pad-none"
    @close="closeGamePlaySandboxDialog"
  >
    <EditorDiveGamePlayView
      v-if="state.open"
      class="dialog-body"
      frame-key="dialog"
      :host-id="state.hostId || undefined"
      :node-id="state.nodeId || undefined"
      :game-play-asset-id="state.gamePlayAssetId || undefined"
      dialog-mode
    />
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import StudioFloatingWindow from './StudioFloatingWindow.vue'
import EditorDiveGamePlayView from './dive/EditorDiveGamePlayView.vue'
import {
  closeGamePlaySandboxDialog,
  gamePlaySandboxDialogState
} from '../features/media/gamePlaySandboxDialog'

const { t } = useI18n()
const state = gamePlaySandboxDialogState

const dialogTitle = computed(() => state.title || t('studio.dive.gamePlay.title'))
</script>

<style scoped>
.dialog-body {
  height: 100%;
  min-height: 480px;
}
</style>
