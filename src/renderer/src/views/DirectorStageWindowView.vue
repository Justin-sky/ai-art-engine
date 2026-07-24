<template>
  <div class="stage-window">
    <p v-if="error" class="error">{{ error }}</p>
    <DirectorStageDialog
      v-else-if="ready && directorAssetId"
      ref="stageRef"
      mode="window"
      :director-asset-id="directorAssetId"
      :processing-node-id="processingNodeId"
      @preview="onPreview"
      @close="onClose"
    />
    <p v-else class="loading">{{ t('director.stageWindow.loading') }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useProjectStore } from '../stores/project'
import { useDirectorStageGraphHost } from '../features/director/useDirectorStageGraphHost'
import DirectorStageDialog from '../components/DirectorStageDialog.vue'

const { t } = useStudioI18n()
const route = useRoute()
const project = useProjectStore()
const error = ref('')
const bootstrapped = ref(false)
const stageRef = ref<InstanceType<typeof DirectorStageDialog> | null>(null)
let stopCloseRequest: (() => void) | null = null
let closingWindow = false

const directorAssetId = computed(() => {
  const raw = route.query.directorAssetId
  return typeof raw === 'string' ? raw : ''
})

const processingNodeId = computed(() => {
  const raw = route.query.processingNodeId
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null
})

const { ready: graphReady } = useDirectorStageGraphHost(directorAssetId)
const ready = computed(() => bootstrapped.value && graphReady.value && !!directorAssetId.value)

onMounted(async () => {
  try {
    if (!directorAssetId.value) {
      error.value = t('director.stageWindow.missingAsset')
      return
    }
    const state = await window.studio.getOpenProjectState()
    if (!state) {
      error.value = t('director.stageWindow.noProject')
      return
    }
    project.loadFromResult(state)
    bootstrapped.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }

  stopCloseRequest = window.studio.onStageCloseRequest(async (payload) => {
    if (payload.directorAssetId !== directorAssetId.value) return
    if (
      processingNodeId.value &&
      payload.processingNodeId &&
      payload.processingNodeId !== processingNodeId.value
    ) {
      return
    }
    try {
      if (stageRef.value) await stageRef.value.requestClose()
      else await onClose()
    } catch {
      await onClose()
    }
  })
})

onBeforeUnmount(() => {
  stopCloseRequest?.()
  stopCloseRequest = null
})

function onPreview(url: string): void {
  if (!directorAssetId.value) return
  void window.studio.sendStagePreview(
    directorAssetId.value,
    url,
    processingNodeId.value ?? undefined
  )
}

async function onClose(): Promise<void> {
  if (closingWindow) return
  closingWindow = true
  if (!directorAssetId.value) {
    window.close()
    return
  }
  await window.studio.closeStageWindow(
    directorAssetId.value,
    processingNodeId.value ?? undefined
  )
}
</script>

<style scoped>
.stage-window {
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--bg-panel, #141516);
}

.error,
.loading {
  margin: 0;
  padding: 24px;
  color: var(--text-muted);
  font-size: 13px;
}

.error {
  color: #e57373;
}
</style>
