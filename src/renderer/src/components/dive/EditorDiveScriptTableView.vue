<template>
  <div class="dive-view">
    <ShotTable
      ref="tableRef"
      class="table-body"
      :script-asset-id="scriptAssetId"
      :world-element-outputs="worldElementOutputs"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { WorldElementGenResult } from '@shared/graph'
import { useWorkspaceStore } from '../../stores/workspace'
import { useEditorDiveFrameFlush } from '../../composables/useEditorDiveFrameFlush'
import { applyShotSplitJson } from '../../features/script/applyShotSplitOnOpen'
import { readShotTableWorldOutputs } from '../../features/script/readShotTableWorldOutputs'
import ShotTable from '../ShotTable.vue'

const props = defineProps<{
  frameKey: string
  scriptAssetId: string
}>()

const workspace = useWorkspaceStore()
const tableRef = ref<InstanceType<typeof ShotTable> | null>(null)
const worldElementOutputs = ref<WorldElementGenResult[]>([])

useEditorDiveFrameFlush(
  () => props.frameKey,
  () => tableRef.value?.flushSave()
)

onMounted(async () => {
  try {
    await applyShotSplitJson(props.scriptAssetId)
  } catch {
    /* 保留已有分镜 */
  }
  worldElementOutputs.value = readShotTableWorldOutputs(props.scriptAssetId)
  // 与脚本/世界编辑器一致：打开时显示工程全局参数；点某一行仍会 focusShot
  workspace.focusProjectGlobals()
})
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
