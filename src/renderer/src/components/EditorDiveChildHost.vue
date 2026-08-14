<template>
  <div
    v-if="frame"
    class="editor-dive-child"
  >
    <component
      :is="viewComponent"
      v-if="viewFrame && viewComponent"
      :key="viewFrame.key"
      v-bind="viewBindings"
    />
    <AssetEditor
      v-else-if="
        assetFrame &&
          (assetFrame.kind === 'screenplay' || assetFrame.kind === 'asset')
      "
      :key="assetFrame.assetId"
      :asset-id="assetFrame.assetId"
      embedded
    />
    <BeatAssetEditor
      v-else-if="assetFrame && assetFrame.kind === 'beat'"
      :key="assetFrame.assetId"
      :beat-asset-id="assetFrame.assetId"
      embedded
    />
    <WorldElementEditor
      v-else-if="assetFrame && assetFrame.kind === 'world'"
      :key="assetFrame.assetId"
      :world-asset-id="assetFrame.assetId"
      embedded
    />
    <DirectorEditor
      v-else-if="assetFrame && assetFrame.kind === 'director'"
      :key="assetFrame.assetId"
      :director-asset-id="assetFrame.assetId"
      embedded
    />
    <!--
      子图内打开节点工具时，dive 栈顶会替换子图编辑器；这里把目标子图编辑器以隐藏方式
      继续挂载，保证 NodeGraphEditor 的工具宿主（dialog 状态 / 保存 / 预览）仍然可用。
    -->
    <template v-if="keepAssetFrame">
      <div
        v-show="false"
        :key="`keep:${keepAssetFrame.key}`"
        class="editor-dive-keep-host"
      >
        <AssetEditor
          v-if="keepAssetFrame.kind === 'screenplay' || keepAssetFrame.kind === 'asset'"
          :asset-id="keepAssetFrame.assetId"
          embedded
        />
        <BeatAssetEditor
          v-else-if="keepAssetFrame.kind === 'beat'"
          :beat-asset-id="keepAssetFrame.assetId"
          embedded
        />
        <WorldElementEditor
          v-else-if="keepAssetFrame.kind === 'world'"
          :world-asset-id="keepAssetFrame.assetId"
          embedded
        />
        <DirectorEditor
          v-else-if="keepAssetFrame.kind === 'director'"
          :director-asset-id="keepAssetFrame.assetId"
          embedded
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, type Component } from 'vue'
import {
  isEditorDiveAssetFrame,
  isEditorDiveViewFrame,
  type EditorDiveAssetFrame,
  type EditorDiveFrame,
  type EditorDiveNodeToolViewId
} from '../features/graph/model/editorDive'

/** 异步加载，避免与各主编辑器互相静态引用形成环 */
const AssetEditor = defineAsyncComponent(() => import('./AssetEditor.vue'))
const BeatAssetEditor = defineAsyncComponent(() => import('./BeatAssetEditor.vue'))
const WorldElementEditor = defineAsyncComponent(() => import('./WorldElementEditor.vue'))
const DirectorEditor = defineAsyncComponent(() => import('./DirectorEditor.vue'))

const viewRegistry: Record<string, Component> = {
  'script.timeline': defineAsyncComponent(() => import('./dive/EditorDiveScriptTimelineView.vue')),
  'world.editor': defineAsyncComponent(() => import('./dive/EditorDiveWorldEditorView.vue')),
  'world.table': defineAsyncComponent(() => import('./dive/EditorDiveWorldTableView.vue')),
  'beat.gen': defineAsyncComponent(() => import('./dive/EditorDiveBeatGenView.vue')),
  'beat.table': defineAsyncComponent(() => import('./dive/EditorDiveBeatTableView.vue')),
  'director.stage': defineAsyncComponent(() => import('./dive/EditorDiveDirectorStageView.vue')),
  'ui.split': defineAsyncComponent(() => import('./dive/EditorDiveUiSplitView.vue')),
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
  'node.framePull': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.reshoot': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.portraitTexture': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.emotion': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.expand': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.redraw': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.erase': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.matte': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.crop': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.gridSplit': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue'))
}

const props = defineProps<{
  frame: EditorDiveFrame | null
  frames?: EditorDiveFrame[]
}>()

const assetFrame = computed(() =>
  isEditorDiveAssetFrame(props.frame) ? props.frame : null
)
const viewFrame = computed(() => (isEditorDiveViewFrame(props.frame) ? props.frame : null))

const allFrames = computed<EditorDiveFrame[]>(() => {
  if (props.frames && props.frames.length) return props.frames
  return props.frame ? [props.frame] : []
})

/**
 * 节点工具视图打开时，如果它的 hostId 指向 dive 栈里某个资产帧，
 * 需要把该资产帧的编辑器继续隐藏挂载，工具宿主才不会随栈顶替换而丢失。
 */
const keepAssetFrame = computed<EditorDiveAssetFrame | null>(() => {
  const frames = allFrames.value
  const top = frames[frames.length - 1]
  if (!top || top.type !== 'view') return null
  const meta = top.meta
  if (!('hostId' in meta) || !meta.hostId) return null
  const hostId = meta.hostId.trim()
  if (!hostId.startsWith('asset:')) return null
  for (let i = frames.length - 2; i >= 0; i--) {
    const frame = frames[i]
    if (!isEditorDiveAssetFrame(frame)) continue
    // 画布资产当前不走嵌入式编辑，跳过避免渲染空壳
    if (frame.kind === 'canvas') continue
    const prefix = `asset:${frame.assetId}`
    if (hostId === prefix || hostId.startsWith(`${prefix}:`)) return frame
  }
  return null
})

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
    case 'script.timeline':
      return { ...base, scriptAssetId: meta.scriptAssetId }
    case 'world.editor':
      return {
        ...base,
        worldAssetId: meta.worldAssetId,
        tab: meta.tab,
        worldGenNodeId: meta.worldGenNodeId
      }
    case 'world.table':
      return { ...base, worldAssetId: meta.worldAssetId }
    case 'beat.gen':
    case 'beat.table':
      return { ...base, beatAssetId: meta.beatAssetId }
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
    case 'ui.split':
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
.editor-dive-child > :deep(.beat-asset-editor),
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
