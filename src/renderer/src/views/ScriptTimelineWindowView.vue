<template>
  <div class="script-timeline-window">
    <p v-if="error" class="error">{{ error }}</p>
    <ScriptTimelineDialog
      v-else-if="ready && scriptAssetId"
      ref="dialogRef"
      mode="window"
      :script-asset-id="scriptAssetId"
      @close="onClose"
    />
    <p v-else class="loading">{{ t('script.timelineWindow.loading') }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useEditorDocumentSession } from '../composables/useEditorDocumentSession'
import { useProjectStore } from '../stores/project'
import ScriptTimelineDialog from '../components/ScriptTimelineDialog.vue'

const { t } = useStudioI18n()
const route = useRoute()
const project = useProjectStore()
const error = ref('')
const bootstrapped = ref(false)
const dialogRef = ref<InstanceType<typeof ScriptTimelineDialog> | null>(null)
let stopCloseRequest: (() => void) | null = null
let closingWindow = false

const scriptAssetId = computed(() => {
  const raw = route.query.scriptAssetId
  return typeof raw === 'string' ? raw : ''
})

provide('scriptAssetId', scriptAssetId)

const ready = computed(() => bootstrapped.value && !!scriptAssetId.value)

useEditorDocumentSession({
  id: () => `editor:script-timeline:${scriptAssetId.value}`,
  save: async () => {
    await dialogRef.value?.flushSave()
  },
  saveOnUnmount: false
})

onMounted(async () => {
  try {
    if (!scriptAssetId.value) {
      error.value = t('script.timelineWindow.missingAsset')
      return
    }
    const state = await window.studio.getOpenProjectState()
    if (!state) {
      error.value = t('script.timelineWindow.noProject')
      return
    }
    project.loadFromResult(state)
    await project.refreshShots()
    bootstrapped.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }

  stopCloseRequest = window.studio.onScriptTimelineCloseRequest(async (payload) => {
    if (payload.scriptAssetId !== scriptAssetId.value) return
    try {
      if (dialogRef.value) {
        await dialogRef.value.requestClose()
        return
      }
      await onClose()
    } catch {
      await onClose()
    }
  })
})

onBeforeUnmount(() => {
  stopCloseRequest?.()
  stopCloseRequest = null
})

async function onClose(): Promise<void> {
  if (closingWindow) return
  closingWindow = true
  if (!scriptAssetId.value) {
    window.close()
    return
  }
  await window.studio.closeScriptTimelineWindow(scriptAssetId.value)
}
</script>

<style scoped>
.script-timeline-window {
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--bg-panel);
}

.error,
.loading {
  margin: 0;
  padding: 24px;
  color: var(--text-muted);
  font-size: 13px;
}

.error {
  color: var(--danger);
}
</style>
