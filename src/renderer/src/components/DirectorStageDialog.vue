<template>
  <StudioFloatingWindow
    v-if="mode === 'modal'"
    :open="true"
    :show-titlebar="false"
    :show-close="false"
    :z-index="1200"
    :default-width="1100"
    :default-height="720"
    :min-width="640"
    :min-height="480"
    body-class="pad-none"
    @close="requestClose"
  >
    <DirectorStageShellInner :show-close="true" @close="requestClose" @ready="onReady" />
  </StudioFloatingWindow>
  <div v-else class="stage-embed" :class="{ window: mode === 'window' }">
    <DirectorStageShellInner
      :show-close="false"
      :window-chrome="mode === 'window'"
      @close="requestClose"
      @ready="onReady"
    />
  </div>
</template>

<script setup lang="ts">
import { provide, ref } from 'vue'
import { directorStageSceneKey } from '../features/director/stageSceneKey'
import { useDirectorStageScene } from '../features/director/useDirectorStageScene'
import DirectorStageShellInner from './DirectorStageShellInner.vue'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

const props = withDefaults(
  defineProps<{
    directorAssetId: string
    processingNodeId?: string | null
    mode?: 'modal' | 'embed' | 'window'
  }>(),
  { mode: 'modal', processingNodeId: null }
)

const emit = defineEmits<{
  close: []
  preview: [url: string]
}>()

const viewportEl = ref<HTMLDivElement | null>(null)
let mounted = false
let closing = false

const scene = useDirectorStageScene({
  directorAssetId: props.directorAssetId,
  processingNodeId: props.processingNodeId,
  viewportEl,
  onPreview: (url) => emit('preview', url)
})

provide(directorStageSceneKey, scene)
provide('directorViewportEl', viewportEl)

function onReady(el: HTMLDivElement): void {
  viewportEl.value = el
  if (!mounted) {
    mounted = true
    scene.mount()
  }
}

async function requestClose(): Promise<void> {
  if (closing) return
  closing = true
  try {
    scene.flushPreview()
    await scene.saveNow()
    emit('close')
  } catch (error) {
    closing = false
    throw error
  }
}

defineExpose({
  getViewer: scene.getViewer,
  setViewer: scene.setViewer,
  flushPreview: scene.flushPreview,
  saveNow: scene.saveNow,
  requestClose
})
</script>

<style scoped>
.stage-embed {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  border-left: 1px solid var(--border);
  background: var(--bg-panel);
  overflow: hidden;
}

.stage-embed.window {
  border-left: none;
}
</style>
