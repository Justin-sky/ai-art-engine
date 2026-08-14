<template>
  <div class="dive-view">
    <ScriptTimelineEditor
      ref="editorRef"
      :script-asset-id="scriptAssetId"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useEditorDiveFrameFlush } from '../../composables/useEditorDiveFrameFlush'
import ScriptTimelineEditor from '../ScriptTimelineEditor.vue'

const props = defineProps<{
  frameKey: string
  scriptAssetId: string
}>()

const editorRef = ref<InstanceType<typeof ScriptTimelineEditor> | null>(null)

useEditorDiveFrameFlush(
  () => props.frameKey,
  () => editorRef.value?.flushSave()
)
</script>

<style scoped>
.dive-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.dive-view > :deep(.script-timeline-editor),
.dive-view > :deep(*) {
  flex: 1;
  min-height: 0;
}
</style>
