<template>
  <div class="dive-view">
    <DirectorStageShellInner
      :show-close="false"
      :window-chrome="false"
      @ready="onReady"
    />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, provide, ref } from 'vue'
import {
  clearActiveDirectorStageScene,
  setActiveDirectorStageScene
} from '../../features/director/activeDirectorStageScene'
import { directorStageSceneKey } from '../../features/director/stageSceneKey'
import { useDirectorStageScene } from '../../features/director/useDirectorStageScene'
import { useEditorDiveFrameFlush } from '../../composables/useEditorDiveFrameFlush'
import { useWorkspaceStore } from '../../stores/workspace'
import DirectorStageShellInner from '../DirectorStageShellInner.vue'

const props = defineProps<{
  frameKey: string
  directorAssetId: string
  processingNodeId?: string
}>()

const workspace = useWorkspaceStore()
const viewportEl = ref<HTMLDivElement | null>(null)
let mounted = false

const scene = useDirectorStageScene({
  directorAssetId: props.directorAssetId,
  processingNodeId: props.processingNodeId ?? null,
  viewportEl
})

provide(directorStageSceneKey, scene)
provide('directorViewportEl', viewportEl)
setActiveDirectorStageScene(scene)

useEditorDiveFrameFlush(props.frameKey, async () => {
  scene.flushPreview()
  await scene.saveNow()
})

function onReady(el: HTMLDivElement): void {
  viewportEl.value = el
  if (!mounted) {
    mounted = true
    scene.mount()
  }
}

onBeforeUnmount(() => {
  scene.flushPreview()
  clearActiveDirectorStageScene(scene)
  workspace.focusProjectGlobals()
})
</script>

<style scoped>
.dive-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.dive-view > :deep(.shell) {
  flex: 1;
  min-height: 0;
}
</style>
