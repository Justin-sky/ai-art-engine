<template>
  <div class="beat-asset-editor">
    <div v-if="showDiveShellBar && diveContext" class="dive-shell-bar">
      <EditorDiveBar
        :root-title="diveContext.rootTitle"
        :frames="diveContext.frames"
        @pop-to="diveContext.popTo"
      />
    </div>

    <div v-if="!embedded && !diving" class="toolbar">
      <span>{{ t('studio.editor.beat') }}</span>
      <span class="spacer" />
      <span class="hint">{{ t('beat.asset.hint') }}</span>
      <GraphToolbarCollapseBtn v-model="toolbarCollapsed" />
    </div>

    <NodeGraphEditor
      v-show="!diving"
      ref="beatGraphRef"
      class="beat-main"
      :asset-id="beatAssetId"
      :hide-toolbar="!embedded && toolbarCollapsed"
    />

    <EditorDiveChildHost :frame="diving ? diveTop : null" :frames="diveFrames" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, provide, ref } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useEditorDocumentSession } from '../composables/useEditorDocumentSession'
import { useEditorDiveHost } from '../composables/useEditorDiveHost'
import { useAssetRecord } from '../composables/useAssetRecord'
import { editorDiveFlush } from '../features/graph/model/editorDiveFlush'
import { isEditorDiveViewFrame } from '../features/graph/model/editorDive'
import { useWorkspaceStore } from '../stores/workspace'
import NodeGraphEditor from './NodeGraphEditor.vue'
import GraphToolbarCollapseBtn from './GraphToolbarCollapseBtn.vue'
import EditorDiveBar from './EditorDiveBar.vue'
import EditorDiveChildHost from './EditorDiveChildHost.vue'

const props = defineProps<{
  beatAssetId: string
  /** 嵌在外层 dive 内时不作为 dive 根、不 consume */
  embedded?: boolean
}>()

const { t } = useStudioI18n()
const workspace = useWorkspaceStore()
const { asset: beatAsset } = useAssetRecord(props.beatAssetId)
const beatGraphRef = ref<InstanceType<typeof NodeGraphEditor> | null>(null)
const toolbarCollapsed = ref(false)

const rootTitle = computed(
  () => beatAsset.value?.name?.trim() || t('studio.dive.root')
)
const { diving, diveTop, diveFrames, diveContext } = useEditorDiveHost({
  kind: 'beat',
  assetId: () => props.beatAssetId,
  rootTitle,
  enabled: () => !props.embedded
})
const showDiveShellBar = computed(
  () => !props.embedded && diving.value && isEditorDiveViewFrame(diveTop.value)
)

provide('beatAssetId', computed(() => props.beatAssetId))

useEditorDocumentSession({
  id: () => `editor:beat:${props.beatAssetId}`,
  save: async () => {
    const top = diveTop.value
    if (top) await editorDiveFlush.flush(top.key)
    await beatGraphRef.value?.flushSave?.()
  },
  saveOnUnmount: false
})

onBeforeUnmount(() => {
  if (!props.embedded) workspace.consumeBeatEditor(props.beatAssetId)
})
</script>

<style scoped>
.beat-asset-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.dive-shell-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
  flex-shrink: 0;
}

.toolbar .spacer {
  flex: 1;
}

.hint {
  font-size: 12px;
  color: var(--text-muted);
}

.beat-main {
  flex: 1;
  min-height: 0;
}
</style>
