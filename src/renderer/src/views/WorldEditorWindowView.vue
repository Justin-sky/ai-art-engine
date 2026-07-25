<template>
  <div class="world-editor-window">
    <p v-if="error" class="error">{{ error }}</p>
    <WorldEditorDialog
      v-else-if="ready && worldAssetId"
      ref="editorRef"
      mode="window"
      :world-asset-id="worldAssetId"
      :initial-tab="initialTab"
      @close="onClose"
    />
    <p v-else class="loading">{{ t('world.editorWindow.loading') }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { WorldElementKind } from '@shared/graph'
import { WORLD_ELEMENT_KINDS } from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useEditorDocumentSession } from '../composables/useEditorDocumentSession'
import { useProjectStore } from '../stores/project'
import WorldEditorDialog from '../components/WorldEditorDialog.vue'

const { t } = useStudioI18n()
const route = useRoute()
const project = useProjectStore()
const error = ref('')
const bootstrapped = ref(false)
const editorRef = ref<InstanceType<typeof WorldEditorDialog> | null>(null)
let stopCloseRequest: (() => void) | null = null
let stopSetTab: (() => void) | null = null
let closingWindow = false

const worldAssetId = computed(() => {
  const raw = route.query.worldAssetId
  return typeof raw === 'string' ? raw : ''
})

provide('worldAssetId', worldAssetId)

function parseTab(raw: unknown): WorldElementKind {
  if (typeof raw === 'string' && (WORLD_ELEMENT_KINDS as readonly string[]).includes(raw)) {
    return raw as WorldElementKind
  }
  return 'characters'
}

const routeTab = computed(() => parseTab(route.query.tab))
const initialTab = ref<WorldElementKind>(routeTab.value)

const ready = computed(() => bootstrapped.value && !!worldAssetId.value)

useEditorDocumentSession({
  id: () => `editor:world:${worldAssetId.value}`,
  save: async () => {
    await editorRef.value?.flushSave()
  },
  saveOnUnmount: false
})

onMounted(async () => {
  try {
    if (!worldAssetId.value) {
      error.value = t('world.editorWindow.missingAsset')
      return
    }
    const state = await window.studio.getOpenProjectState()
    if (!state) {
      error.value = t('world.editorWindow.noProject')
      return
    }
    project.loadFromResult(state)
    initialTab.value = routeTab.value
    bootstrapped.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }

  stopCloseRequest = window.studio.onWorldEditorCloseRequest(async (payload) => {
    if (payload.worldAssetId !== worldAssetId.value) return
    try {
      if (editorRef.value) await editorRef.value.requestClose()
      else await onClose()
    } catch {
      await onClose()
    }
  })

  stopSetTab = window.studio.onWorldEditorSetTab((payload) => {
    if (payload.worldAssetId && payload.worldAssetId !== worldAssetId.value) return
    editorRef.value?.setTab(payload.tab)
  })
})

onBeforeUnmount(() => {
  stopCloseRequest?.()
  stopCloseRequest = null
  stopSetTab?.()
  stopSetTab = null
})

async function onClose(): Promise<void> {
  if (closingWindow) return
  closingWindow = true
  if (!worldAssetId.value) {
    window.close()
    return
  }
  await window.studio.closeWorldEditorWindow(worldAssetId.value)
}
</script>

<style scoped>
.world-editor-window {
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
