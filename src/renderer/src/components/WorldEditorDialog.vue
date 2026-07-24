<template>
  <StudioFloatingWindow
    v-if="mode === 'modal'"
    :open="true"
    variant="editor"
    :close-title="t('world.dialog.close')"
    :z-index="1200"
    :default-width="1200"
    :default-height="760"
    :min-width="640"
    :min-height="400"
    body-class="pad-none"
    @close="requestClose"
  >
    <template #title>
      <WorldEditorTabs v-model="activeTab" />
    </template>

    <WorldEditorBody
      ref="bodyRef"
      :world-asset-id="worldAssetId"
      :active-tab="activeTab"
    />
  </StudioFloatingWindow>

  <div v-else class="world-editor-embed" :class="{ window: mode === 'window' }">
    <header class="titlebar" :class="{ drag: mode === 'window' }">
      <WorldEditorTabs v-model="activeTab" class="no-drag" />
      <span class="spacer" />
    </header>
    <WorldEditorBody
      ref="bodyRef"
      class="embed-body"
      :world-asset-id="worldAssetId"
      :active-tab="activeTab"
    />
  </div>
</template>

<script setup lang="ts">
import { provide, ref, watch } from 'vue'
import type { WorldElementKind } from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import { worldElementKindKey } from '../features/world/worldEditor'
import StudioFloatingWindow from './StudioFloatingWindow.vue'
import WorldEditorBody from './WorldEditorBody.vue'
import WorldEditorTabs from './WorldEditorTabs.vue'

const props = withDefaults(
  defineProps<{
    worldAssetId: string
    initialTab?: WorldElementKind
    mode?: 'modal' | 'window'
  }>(),
  {
    initialTab: 'characters',
    mode: 'modal'
  }
)

const emit = defineEmits<{
  close: []
}>()

const { t } = useStudioI18n()
const activeTab = ref<WorldElementKind>(props.initialTab)
provide(worldElementKindKey, activeTab)

const bodyRef = ref<InstanceType<typeof WorldEditorBody> | null>(null)
let closing = false

function setTab(tab: WorldElementKind): void {
  activeTab.value = tab
}

watch(
  () => props.initialTab,
  (tab) => {
    if (tab) activeTab.value = tab
  }
)

async function flushSave(): Promise<void> {
  await bodyRef.value?.flushSave()
}

async function requestClose(): Promise<void> {
  if (closing) return
  closing = true
  try {
    await flushSave()
    emit('close')
  } catch (error) {
    closing = false
    throw error
  }
}

defineExpose({
  flushSave,
  setTab,
  requestClose
})
</script>

<style scoped>
.world-editor-embed {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-panel);
  overflow: hidden;
}

.titlebar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  cursor: default;
  user-select: none;
}

.world-editor-embed.window .titlebar.drag {
  -webkit-app-region: drag;
  app-region: drag;
  padding-right: 140px;
  padding-top: 10px;
  min-height: 40px;
  box-sizing: border-box;
}

.world-editor-embed.window .no-drag {
  -webkit-app-region: no-drag;
  app-region: no-drag;
  cursor: default;
  user-select: auto;
}

.spacer {
  flex: 1;
}

.embed-body {
  flex: 1;
  min-height: 0;
}
</style>
