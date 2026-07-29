<template>
  <div class="dive-view">
    <ShotEditorBody
      ref="bodyRef"
      :script-asset-id="scriptAssetId"
      :kind="kind"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useEditorDiveFrameFlush } from '../../composables/useEditorDiveFrameFlush'
import ShotEditorBody from '../ShotEditorBody.vue'

const props = defineProps<{
  frameKey: string
  scriptAssetId: string
  kind: 'image' | 'video'
}>()

const bodyRef = ref<InstanceType<typeof ShotEditorBody> | null>(null)

useEditorDiveFrameFlush(
  () => props.frameKey,
  () => bodyRef.value?.flushSave()
)
</script>

<style scoped>
.dive-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.dive-view > :deep(.shot-editor-body) {
  flex: 1;
  min-height: 0;
}
</style>
