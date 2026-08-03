<template>
  <div class="dive-view">
    <BeatEditorBody
      ref="bodyRef"
      class="body"
      :beat-asset-id="beatAssetId"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useWorkspaceStore } from '../../stores/workspace'
import { useEditorDiveFrameFlush } from '../../composables/useEditorDiveFrameFlush'
import { loadBeatCatalog } from '../../features/beat/applyBeatCatalogOnOpen'
import BeatEditorBody from '../BeatEditorBody.vue'

const props = defineProps<{
  frameKey: string
  beatAssetId: string
}>()

const workspace = useWorkspaceStore()
const bodyRef = ref<InstanceType<typeof BeatEditorBody> | null>(null)

useEditorDiveFrameFlush(
  () => props.frameKey,
  () => bodyRef.value?.flushSave()
)

onMounted(async () => {
  const rows = [...loadBeatCatalog(props.beatAssetId)].sort(
    (a, b) => a.order - b.order || a.title.localeCompare(b.title)
  )
  if (rows.length) {
    const current = workspace.activeBeatId
    const keep = current && rows.some((row) => row.id === current) ? current : rows[0].id
    workspace.selectBeatUnit(keep, props.beatAssetId)
  } else {
    workspace.selectBeatUnit(null, props.beatAssetId)
  }
  await Promise.resolve()
  bodyRef.value?.reloadStrip?.()
  workspace.focusBeatUnit()
})
</script>

<style scoped>
.dive-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.body {
  flex: 1;
  min-height: 0;
}
</style>
