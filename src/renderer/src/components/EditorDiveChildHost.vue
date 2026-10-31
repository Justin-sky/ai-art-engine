<template>
  <div
    v-if="frame"
    class="editor-dive-child"
    data-tutorial-id="graph-dive"
    :data-tutorial-view="viewFrame?.viewId"
  >
    <div
      v-if="viewFrame && viewComponent"
      class="editor-dive-view"
      :data-tutorial-id="tutorialDiveViewId(viewFrame.viewId)"
    >
      <component :is="viewComponent" :key="viewFrame.key" v-bind="viewBindings" />
    </div>
    <!--
      统一挂载当前资产帧或栈底需保活的宿主资产帧（activeOrKeptAssetFrame）：
      当子图内再下钻到节点工作台视图（如 gameSystem.workbench / novel.workbench / game.workbench）时，
      仅通过 v-show 隐藏而非卸载重挂 AssetEditor，从而保证 graphEditorHosts 中的宿主图与新建节点不丢失。
    -->
    <template v-if="activeOrKeptAssetFrame">
      <div
        v-show="Boolean(assetFrame && !viewFrame)"
        :key="`asset-host:${activeOrKeptAssetFrame.key}`"
        :class="assetFrame && !viewFrame ? 'editor-dive-asset-active' : 'editor-dive-keep-host'"
      >
        <AssetEditor
          v-if="
            activeOrKeptAssetFrame.kind === 'screenplay' || activeOrKeptAssetFrame.kind === 'asset'
          "
          :key="activeOrKeptAssetFrame.assetId"
          :asset-id="activeOrKeptAssetFrame.assetId"
          embedded
        />
        <BeatAssetEditor
          v-else-if="activeOrKeptAssetFrame.kind === 'beat'"
          :key="activeOrKeptAssetFrame.assetId"
          :beat-asset-id="activeOrKeptAssetFrame.assetId"
          embedded
        />
        <WorldElementEditor
          v-else-if="activeOrKeptAssetFrame.kind === 'world'"
          :key="activeOrKeptAssetFrame.assetId"
          :world-asset-id="activeOrKeptAssetFrame.assetId"
          embedded
        />
        <DirectorEditor
          v-else-if="activeOrKeptAssetFrame.kind === 'director'"
          :key="activeOrKeptAssetFrame.assetId"
          :director-asset-id="activeOrKeptAssetFrame.assetId"
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
import { tutorialDiveViewId } from '@shared/tutorialUi'

/** 异步加载，避免与各主编辑器互相静态引用形成环 */
const AssetEditor = defineAsyncComponent(() => import('./AssetEditor.vue'))
const BeatAssetEditor = defineAsyncComponent(() => import('./BeatAssetEditor.vue'))
const WorldElementEditor = defineAsyncComponent(() => import('./WorldElementEditor.vue'))
const DirectorEditor = defineAsyncComponent(() => import('./DirectorEditor.vue'))

/** 语义时间线视图单独提出，好让注册表的 key 与白名单标记留在同一行 */
const SemanticTimelineDiveView = defineAsyncComponent(
  () => import('./dive/EditorDiveSemanticTimelineView.vue')
)

const viewRegistry: Record<string, Component> = {
  'script.timeline': defineAsyncComponent(() => import('./dive/EditorDiveScriptTimelineView.vue')),
  'semantic.timeline': SemanticTimelineDiveView, // view-id-keep：dive 视图 id（不是节点类型）
  'world.editor': defineAsyncComponent(() => import('./dive/EditorDiveWorldEditorView.vue')),
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
  'node.adVariants': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.lighting': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.framePull': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.reshoot': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.portraitTexture': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.portrait': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.emotion': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.upscale': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.expand': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.redraw': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.erase': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.matte': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.crop': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.transform': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.gridSplit': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.iconPack': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.layerSplit': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.cutout': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.compose': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.align': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'node.stage2d': defineAsyncComponent(() => import('./dive/EditorDiveNodeToolHost.vue')),
  'anim.2d': defineAsyncComponent(() => import('./dive/EditorDiveAnim2dView.vue')),
  'comic.page': defineAsyncComponent(() => import('./dive/EditorDiveComicPageView.vue')),
  'film.workbench': defineAsyncComponent(() => import('./dive/EditorDiveFilmView.vue')),
  'novel.workbench': defineAsyncComponent(() => import('./dive/EditorDiveNovelView.vue')),
  'screenplay.workbench': defineAsyncComponent(() => import('./dive/EditorDiveScreenplayView.vue')),
  'gameSystem.workbench': defineAsyncComponent(() => import('./dive/EditorDiveGameSystemView.vue')),
  'game.workbench': defineAsyncComponent(() => import('./dive/EditorDiveGameNodeView.vue')),
  'gamePlay.sandbox': defineAsyncComponent(() => import('./dive/EditorDiveGamePlayView.vue'))
}

const props = defineProps<{
  frame: EditorDiveFrame | null
  frames?: EditorDiveFrame[]
}>()

const assetFrame = computed(() => (isEditorDiveAssetFrame(props.frame) ? props.frame : null))
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
  const hostId =
    'hostId' in meta && typeof meta.hostId === 'string'
      ? meta.hostId.trim()
      : meta.viewId === 'script.timeline' && meta.scriptAssetId
        ? `asset:${meta.scriptAssetId.trim()}`
        : meta.viewId === 'director.stage' && meta.directorAssetId
          ? `asset:${meta.directorAssetId.trim()}`
          : ''
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

const activeOrKeptAssetFrame = computed<EditorDiveAssetFrame | null>(
  () => assetFrame.value ?? keepAssetFrame.value
)

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
      return {
        ...base,
        scriptAssetId: meta.scriptAssetId,
        timelineNodeId: meta.timelineNodeId
      }
    case 'world.editor':
      return {
        ...base,
        worldAssetId: meta.worldAssetId,
        tab: meta.tab,
        worldGenNodeId: meta.worldGenNodeId
      }
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
    case 'anim.2d':
      return { ...base, hostId: meta.hostId, nodeId: meta.nodeId }
    case 'comic.page':
      return { ...base, hostId: meta.hostId, nodeId: meta.nodeId }
    case 'film.workbench':
      return { ...base, hostId: meta.hostId, nodeId: meta.nodeId }
    case 'novel.workbench':
      return { ...base, hostId: meta.hostId, nodeId: meta.nodeId }
    case 'screenplay.workbench':
      return { ...base, hostId: meta.hostId, nodeId: meta.nodeId }
    case 'gameSystem.workbench':
      return { ...base, hostId: meta.hostId, nodeId: meta.nodeId }
    case 'game.workbench':
      return { ...base, hostId: meta.hostId, nodeId: meta.nodeId }
    case 'gamePlay.sandbox':
      return {
        ...base,
        hostId: meta.hostId,
        nodeId: meta.nodeId,
        gamePlayAssetId: meta.gamePlayAssetId
      }
    case 'semantic.timeline': // view-id-keep：dive 视图 id（不是节点类型）
      return {
        ...base,
        timelineId: meta.timelineId,
        sourceAssetId: meta.sourceAssetId,
        sourceRelativePath: meta.sourceRelativePath,
        resultRelativePath: meta.resultRelativePath,
        timelineJson: meta.timelineJson,
        graphHostId: meta.hostId,
        graphNodeId: meta.nodeId
      }
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

/**
 * 视图包装层：以前**完全没样式**，高度链断在这一层 ——
 * `.editor-dive-child` 是 flex 列，但这层是 auto 高度的普通块，
 * 里面的 `.dive-view { height: 100% }` 于是解析成 auto（内容高度），
 * 结果 dive 只长内容那么高，窗口下部分留一片宿主画布背景（实测踩到）。
 * 让它做「透明」的 flex 透传：高度继下去、子项自己撑满。
 */
.editor-dive-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.editor-dive-view > :deep(*) {
  flex: 1 1 auto;
  min-height: 0;
}

.editor-dive-asset-active {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.editor-dive-asset-active > :deep(.asset-editor),
.editor-dive-asset-active > :deep(.beat-asset-editor),
.editor-dive-asset-active > :deep(.world-element-editor),
.editor-dive-asset-active > :deep(.script-editor),
.editor-dive-asset-active > :deep(.director-editor),
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
