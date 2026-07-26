<template>
  <div class="shot-editor-window">
    <p v-if="error" class="error">{{ error }}</p>
    <ShotEditorDialog
      v-else-if="ready && scriptAssetId"
      ref="editorRef"
      mode="window"
      :kind="kind"
      :script-asset-id="scriptAssetId"
      @close="onClose"
    />
    <p v-else class="loading">{{ loadingText }}</p>
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
import ShotEditorDialog from '../components/ShotEditorDialog.vue'

const { t } = useStudioI18n()
const route = useRoute()
const project = useProjectStore()
const workspace = useWorkspaceStore()
const error = ref('')
const bootstrapped = ref(false)
const editorRef = ref<InstanceType<typeof ShotEditorDialog> | null>(null)
let stopCloseRequest: (() => void) | null = null
let closingWindow = false

const scriptAssetId = computed(() => {
  const raw = route.query.scriptAssetId
  return typeof raw === 'string' ? raw : ''
})

const kind = computed<'image' | 'video'>(() => {
  const raw = route.query.kind
  return raw === 'image' ? 'image' : 'video'
})

const loadingText = computed(() =>
  kind.value === 'image'
    ? t('script.shotImageEditorWindow.loading')
    : t('script.shotVideoEditorWindow.loading')
)

provide('scriptAssetId', scriptAssetId)

const ready = computed(() => bootstrapped.value && !!scriptAssetId.value)

useEditorDocumentSession({
  id: () => `editor:script:${kind.value}:${scriptAssetId.value}`,
  save: async () => {
    await editorRef.value?.flushSave()
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
      error.value =
        kind.value === 'image'
          ? t('script.shotImageEditorWindow.missingAsset')
          : t('script.shotVideoEditorWindow.missingAsset')
      return
    }
    const state = await window.studio.getOpenProjectState()
    if (!state) {
      error.value =
        kind.value === 'image'
          ? t('script.shotImageEditorWindow.noProject')
          : t('script.shotVideoEditorWindow.noProject')
      return
    }
    project.loadFromResult(state)
    await project.refreshShots()
    bootstrapped.value = true
    await ensureScopedSelection()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }

  stopCloseRequest = window.studio.onShotEditorCloseRequest(async (payload) => {
    if (payload.scriptAssetId !== scriptAssetId.value) return
    if (payload.kind && payload.kind !== kind.value) return
    try {
      if (editorRef.value) await editorRef.value.requestClose()
      else await onClose()
    } catch {
      await onClose()
    }
  })
})

watch([scriptAssetId, kind], () => {
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
  await window.studio.closeShotEditorWindow(scriptAssetId.value, kind.value)
}
</script>

<style scoped>
.shot-editor-window {
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
  color: #e57373;
}
</style>
