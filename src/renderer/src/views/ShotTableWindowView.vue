<template>
  <div class="shot-table-window">
    <p v-if="error" class="error">{{ error }}</p>
    <ShotTableDialog
      v-else-if="ready && scriptAssetId"
      ref="tableRef"
      mode="window"
      :script-asset-id="scriptAssetId"
      @close="onClose"
    />
    <p v-else class="loading">{{ t('script.shotTableWindow.loading') }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { isDraftAssetId, shotScriptAssetId } from '@shared/domain'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useEditorDocumentSession } from '../composables/useEditorDocumentSession'
import { useProjectStore } from '../stores/project'
import { useWorkspaceStore } from '../stores/workspace'
import ShotTableDialog from '../components/ShotTableDialog.vue'

const { t } = useStudioI18n()
const route = useRoute()
const project = useProjectStore()
const workspace = useWorkspaceStore()
const error = ref('')
const bootstrapped = ref(false)
const tableRef = ref<InstanceType<typeof ShotTableDialog> | null>(null)
let stopCloseRequest: (() => void) | null = null
let closingWindow = false

const scriptAssetId = computed(() => {
  const raw = route.query.scriptAssetId
  return typeof raw === 'string' ? raw : ''
})

provide('scriptAssetId', scriptAssetId)

const ready = computed(() => bootstrapped.value && !!scriptAssetId.value)

useEditorDocumentSession({
  id: () => `editor:script-table:${scriptAssetId.value}`,
  save: async () => {
    await tableRef.value?.flushSave()
  },
  saveOnUnmount: false
})

async function ensureScopedSelection(): Promise<void> {
  const id = scriptAssetId.value
  if (!id || isDraftAssetId(id)) return
  const visible = project.shots.filter((s) => shotScriptAssetId(s) === id)
  if (!visible.length) return
  const currentId = project.activeShotId
  if (!(currentId && visible.some((s) => s.id === currentId))) {
    await project.selectShot(visible[0].id)
  }
  workspace.focusShot()
}

onMounted(async () => {
  try {
    if (!scriptAssetId.value) {
      error.value = t('script.shotTableWindow.missingAsset')
      return
    }
    const state = await window.studio.getOpenProjectState()
    if (!state) {
      error.value = t('script.shotTableWindow.noProject')
      return
    }
    project.loadFromResult(state)
    await project.refreshShots()
    bootstrapped.value = true
    await ensureScopedSelection()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }

  stopCloseRequest = window.studio.onShotTableCloseRequest(async (payload) => {
    if (payload.scriptAssetId !== scriptAssetId.value) return
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

watch(scriptAssetId, () => {
  void ensureScopedSelection()
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
  await window.studio.closeShotTableWindow(scriptAssetId.value)
}
</script>

<style scoped>
.shot-table-window {
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
