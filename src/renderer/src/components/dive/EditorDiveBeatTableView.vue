<template>
  <div class="dive-view">
    <BeatTable
      ref="tableRef"
      class="table-body"
      :beat-asset-id="beatAssetId"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useEditorDiveFrameFlush } from '../../composables/useEditorDiveFrameFlush'
import BeatTable from '../BeatTable.vue'

const props = defineProps<{
  frameKey: string
  beatAssetId: string
}>()

const tableRef = ref<InstanceType<typeof BeatTable> | null>(null)

useEditorDiveFrameFlush(
  () => props.frameKey,
  () => tableRef.value?.flushSave()
)
</script>

<style scoped>
.dive-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.table-body {
  flex: 1;
  min-height: 0;
}
</style>
