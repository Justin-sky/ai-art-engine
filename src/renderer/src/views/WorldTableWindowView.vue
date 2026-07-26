<template>
  <div class="world-table-window">
    <p v-if="error" class="error">{{ error }}</p>
    <WorldTableDialog
      v-else-if="ready && worldAssetId"
      ref="tableRef"
      mode="window"
      :world-asset-id="worldAssetId"
      @close="onClose"
    />
    <p v-else class="loading">{{ t('world.tableWindow.loading') }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useEditorDocumentSession } from '../composables/useEditorDocumentSession'
import { useProjectStore } from '../stores/project'
import WorldTableDialog from '../components/WorldTableDialog.vue'

const { t } = useStudioI18n()
const route = useRoute()
const project = useProjectStore()
const error = ref('')
const bootstrapped = ref(false)
const tableRef = ref<InstanceType<typeof WorldTableDialog> | null>(null)
let stopCloseRequest: (() => void) | null = null
let closingWindow = false

const worldAssetId = computed(() => {
  const raw = route.query.worldAssetId
  return typeof raw === 'string' ? raw : ''
})

provide('worldAssetId', worldAssetId)

const ready = computed(() => bootstrapped.value && !!worldAssetId.value)

useEditorDocumentSession({
  id: () => `editor:world-table:${worldAssetId.value}`,
  save: async () => {
    await tableRef.value?.flushSave()
  },
  saveOnUnmount: false
})

onMounted(async () => {
  try {
    if (!worldAssetId.value) {
      error.value = t('world.tableWindow.missingAsset')
      return
    }
    const state = await window.studio.getOpenProjectState()
    if (!state) {
      error.value = t('world.tableWindow.noProject')
      return
    }
    project.loadFromResult(state)
    bootstrapped.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }

  stopCloseRequest = window.studio.onWorldTableCloseRequest(async (payload) => {
    if (payload.worldAssetId !== worldAssetId.value) return
    try {
      if (tableRef.value) {
        await tableRef.value.requestClose()
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
  if (!worldAssetId.value) {
    window.close()
    return
  }
  await window.studio.closeWorldTableWindow(worldAssetId.value)
}
</script>

<style scoped>
.world-table-window {
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
