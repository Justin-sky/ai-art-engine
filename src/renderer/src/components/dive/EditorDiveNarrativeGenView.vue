<template>
  <div class="dive-view">
    <NarrativeUnitEditorBody
      ref="bodyRef"
      class="body"
      :narrative-asset-id="narrativeAssetId"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useWorkspaceStore } from '../../stores/workspace'
import { useEditorDiveFrameFlush } from '../../composables/useEditorDiveFrameFlush'
import { loadNarrativeCatalog } from '../../features/narrative/applyNarrativeCatalogOnOpen'
import NarrativeUnitEditorBody from '../NarrativeUnitEditorBody.vue'

const props = defineProps<{
  frameKey: string
  narrativeAssetId: string
}>()

const workspace = useWorkspaceStore()
const bodyRef = ref<InstanceType<typeof NarrativeUnitEditorBody> | null>(null)

useEditorDiveFrameFlush(
  () => props.frameKey,
  () => bodyRef.value?.flushSave()
)

onMounted(async () => {
  const rows = [...loadNarrativeCatalog(props.narrativeAssetId)].sort(
    (a, b) => a.order - b.order || a.title.localeCompare(b.title)
  )
  if (rows.length) {
    const current = workspace.activeNarrativeUnitId
    const keep = current && rows.some((row) => row.id === current) ? current : rows[0].id
    workspace.selectNarrativeUnit(keep, props.narrativeAssetId)
  } else {
    workspace.selectNarrativeUnit(null, props.narrativeAssetId)
  }
  await Promise.resolve()
  bodyRef.value?.reloadStrip?.()
  workspace.focusNarrativeUnit()
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
