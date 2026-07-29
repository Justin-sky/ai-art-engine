<template>
  <div v-if="frame" class="editor-dive-child">
    <component
      :is="viewComponent"
      v-if="viewFrame && viewComponent"
      :key="viewFrame.key"
      v-bind="viewBindings"
    />
    <AssetEditor
      v-else-if="assetFrame && (assetFrame.kind === 'screenplay' || assetFrame.kind === 'asset')"
      :key="assetFrame.assetId"
      :asset-id="assetFrame.assetId"
      embedded
    />
    <NarrativeAssetEditor
      v-else-if="assetFrame && assetFrame.kind === 'narrative'"
      :key="assetFrame.assetId"
      :narrative-asset-id="assetFrame.assetId"
      embedded
    />
    <WorldElementEditor
      v-else-if="assetFrame && assetFrame.kind === 'world'"
      :key="assetFrame.assetId"
      :world-asset-id="assetFrame.assetId"
      embedded
    />
    <ScriptEditor
      v-else-if="assetFrame && assetFrame.kind === 'script'"
      :key="assetFrame.assetId"
      :script-asset-id="assetFrame.assetId"
      embedded
    />
    <DirectorEditor
      v-else-if="assetFrame && assetFrame.kind === 'director'"
      :key="assetFrame.assetId"
      :director-asset-id="assetFrame.assetId"
      embedded
    />
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, type Component } from 'vue'
import {
  isEditorDiveAssetFrame,
  isEditorDiveViewFrame,
  type EditorDiveFrame,
  type EditorDiveNodeToolViewId
} from '../features/graph/model/editorDive'

/** 异步加载，避免与各主编辑器互相静态引用形成环 */
const AssetEditor = defineAsyncComponent(() => import('./AssetEditor.vue'))
const NarrativeAssetEditor = defineAsyncComponent(() => import('./NarrativeAssetEditor.vue'))
const WorldElementEditor = defineAsyncComponent(() => import('./WorldElementEditor.vue'))
const ScriptEditor = defineAsyncComponent(() => import('./ScriptEditor.vue'))
const DirectorEditor = defineAsyncComponent(() => import('./DirectorEditor.vue'))

const viewRegistry: Record<string, Component> = {
  'script.shotImage': defineAsyncComponent(() => import('./dive/EditorDiveScriptShotView.vue')),
  'script.shotVideo': defineAsyncComponent(() => import('./dive/EditorDiveScriptShotView.vue')),
  'script.shotTable': defineAsyncComponent(() => import('./dive/EditorDiveScriptTableView.vue')),
  'script.timeline': defineAsyncComponent(() => import('./dive/EditorDiveScriptTimelineView.vue')),
  'world.editor': defineAsyncComponent(() => import('./dive/EditorDiveWorldEditorView.vue')),
  'world.table': defineAsyncComponent(() => import('./dive/EditorDiveWorldTableView.vue')),
  'narrative.gen': defineAsyncComponent(() => import('./dive/EditorDiveNarrativeGenView.vue')),
  'narrative.table': defineAsyncComponent(() => import('./dive/EditorDiveNarrativeTableView.vue')),
  'director.stage': defineAsyncComponent(() => import('./dive/EditorDiveDirectorStageView.vue')),
  'media.preview': defineAsyncComponent(() => import('./dive/EditorDiveMediaPreview.vue')),
  'node.instruction': defineAsyncComponent(() => import('./dive/EditorDiveInstructionView.vue')),
  'node.notepad': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.textsPreview': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.selectImage': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.selectVideo': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.selectVoice': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.selectText': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.multiAngle': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.lighting': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.portraitTexture': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.emotion': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.upscale': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.expand': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.redraw': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.erase': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.matte': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.crop': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.gridSplit': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue'))
}

const props = defineProps<{
  frame: EditorDiveFrame | null
}>()

const assetFrame = computed(() =>
  isEditorDiveAssetFrame(props.frame) ? props.frame : null
)
const viewFrame = computed(() => (isEditorDiveViewFrame(props.frame) ? props.frame : null))

const viewComponent = computed(() => {
  const frame = viewFrame.value
  if (!frame) return null
  return viewRegistry[frame.viewId] ?? null
})

const viewBindings = computed(() => {
  const frame = viewFrame.value
  if (!frame) return {}
  const meta = frame.meta
  const base = { frameKey: frame.key }
  switch (meta.viewId) {
    case 'script.shotImage':
      return { ...base, scriptAssetId: meta.scriptAssetId, kind: 'image' as const }
    case 'script.shotVideo':
      return { ...base, scriptAssetId: meta.scriptAssetId, kind: 'video' as const }
    case 'script.shotTable':
    case 'script.timeline':
      return { ...base, scriptAssetId: meta.scriptAssetId }
    case 'world.editor':
      return { ...base, worldAssetId: meta.worldAssetId, tab: meta.tab }
    case 'world.table':
      return { ...base, worldAssetId: meta.worldAssetId }
    case 'narrative.gen':
    case 'narrative.table':
      return { ...base, narrativeAssetId: meta.narrativeAssetId }
    case 'director.stage':
      return {
        ...base,
        directorAssetId: meta.directorAssetId,
        processingNodeId: meta.processingNodeId
      }
    case 'media.preview':
      return {
        ...base,
        mediaKind: meta.mediaKind,
        url: meta.url,
        relativePath: meta.relativePath,
        title: meta.title,
        text: meta.text
      }
    case 'node.instruction':
      return { ...base, hostId: meta.hostId, nodeId: meta.nodeId }
    default:
      return {
        ...base,
        viewId: meta.viewId as EditorDiveNodeToolViewId,
        hostId: meta.hostId,
        nodeId: meta.nodeId,
        mode: meta.mode
      }
  }
})
</script>

<style scoped>
.editor-dive-child {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.editor-dive-child > :deep(.asset-editor),
.editor-dive-child > :deep(.narrative-asset-editor),
.editor-dive-child > :deep(.world-element-editor),
.editor-dive-child > :deep(.script-editor),
.editor-dive-child > :deep(.director-editor),
.editor-dive-child > :deep(.dive-view),
.editor-dive-child > :deep(.dive-node-tool),
.editor-dive-child > :deep(.media-preview) {
  flex: 1;
  min-height: 0;
  height: 100%;
}
</style>
