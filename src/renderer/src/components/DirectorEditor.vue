<template>
  <div class="director-editor">
    <div v-if="showDiveShellBar && diveContext" class="dive-shell-bar">
      <EditorDiveBar
        :root-title="diveContext.rootTitle"
        :frames="diveContext.frames"
        @pop-to="diveContext.popTo"
      />
    </div>

    <div v-if="!embedded && !diving" class="toolbar">
      <span>{{ t('director.title') }}</span>
      <span class="spacer" />
      <span class="hint">{{ t('director.hint.graph') }}</span>
      <GraphToolbarCollapseBtn v-model="toolbarCollapsed" />
    </div>
    <NodeGraphEditor
      v-show="!diving"
      class="director-graph"
      :asset-id="directorAssetId"
      :hide-toolbar="!embedded && toolbarCollapsed"
    />
    <EditorDiveChildHost :frame="diving ? diveTop : null" :frames="diveFrames" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useEditorDiveHost } from '../composables/useEditorDiveHost'
import { useAssetRecord } from '../composables/useAssetRecord'
import { isEditorDiveViewFrame } from '../features/graph/model/editorDive'
import { useWorkspaceStore } from '../stores/workspace'
import NodeGraphEditor from './NodeGraphEditor.vue'
import GraphToolbarCollapseBtn from './GraphToolbarCollapseBtn.vue'
import EditorDiveBar from './EditorDiveBar.vue'
import EditorDiveChildHost from './EditorDiveChildHost.vue'

const props = defineProps<{
  directorAssetId: string
  embedded?: boolean
}>()

const { t } = useStudioI18n()
const workspace = useWorkspaceStore()
const { asset: directorAsset } = useAssetRecord(props.directorAssetId)
const toolbarCollapsed = ref(false)

const rootTitle = computed(
  () => directorAsset.value?.name?.trim() || t('studio.dive.root')
)
const { diving, diveTop, diveFrames, diveContext } = useEditorDiveHost({
  kind: 'director',
  assetId: () => props.directorAssetId,
  rootTitle,
  enabled: () => !props.embedded
})
const showDiveShellBar = computed(
  () => !props.embedded && diving.value && isEditorDiveViewFrame(diveTop.value)
)

onBeforeUnmount(() => {
  if (!props.embedded) workspace.consumeDirectorEditor(props.directorAssetId)
})
</script>

<style scoped>
.director-editor {
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

.director-graph {
  flex: 1;
  min-height: 0;
}
</style>
