<template>
  <div class="dive-view">
    <WorldTable
      ref="tableRef"
      class="table-body"
      :world-asset-id="worldAssetId"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useEditorDiveFrameFlush } from '../../composables/useEditorDiveFrameFlush'
import WorldTable from '../WorldTable.vue'

const props = defineProps<{
  frameKey: string
  worldAssetId: string
}>()

const tableRef = ref<InstanceType<typeof WorldTable> | null>(null)

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
