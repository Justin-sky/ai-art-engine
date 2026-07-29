<template>
  <div class="dive-view">
    <NarrativeTable
      ref="tableRef"
      class="table-body"
      :narrative-asset-id="narrativeAssetId"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useEditorDiveFrameFlush } from '../../composables/useEditorDiveFrameFlush'
import NarrativeTable from '../NarrativeTable.vue'

const props = defineProps<{
  frameKey: string
  narrativeAssetId: string
}>()

const tableRef = ref<InstanceType<typeof NarrativeTable> | null>(null)

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
