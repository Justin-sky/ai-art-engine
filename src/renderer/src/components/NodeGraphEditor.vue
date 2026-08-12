<template>
  <div
    ref="rootEl"
    class="node-graph"
    @wheel.prevent="onWheel"
    @dragover.prevent="onDragOver"
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <div v-if="!hideToolbar" class="graph-toolbar">
      <EditorDiveBar
        v-if="diveNavActive && editorDive"
        :root-title="editorDive.rootTitle"
        :frames="editorDive.frames"
        @pop-to="editorDive.popTo"
      />
      <span v-else class="hint">{{ t('graph.toolbar.hint') }}</span>
      <div class="tools">
        <template v-if="isRunning">
          <button
            type="button"
            class="play-control playing"
            :title="t('graph.play.stop')"
            :aria-label="t('graph.play.stopAria')"
            @click="stopWorkflow"
          >
            <span class="play-glyph" aria-hidden="true">
              <MediaRunIcon kind="stop" />
            </span>
          </button>
        </template>
        <template v-else-if="toolbarSelectedNode">
          <button
            type="button"
            class="play-control"
            :title="toolbarCurrentNodeLabel"
            :aria-label="toolbarCurrentNodeLabel"
            @click="onToolbarRunCurrent"
          >
            <span class="play-glyph" aria-hidden="true">
              <MediaRunIcon :kind="toolbarCurrentIsRerun ? 'replay' : 'play'" />
            </span>
          </button>
          <button
            type="button"
            class="play-control"
            :title="t('graph.play.runUpstreamSkip')"
            :aria-label="t('graph.play.runUpstreamSkip')"
            @click="onToolbarRunUpstreamSkip"
          >
            <span class="play-glyph" aria-hidden="true">
              <MediaRunIcon kind="forward" />
            </span>
          </button>
          <button
            type="button"
            class="play-control"
            :title="t('graph.play.runUpstreamForce')"
            :aria-label="t('graph.play.runUpstreamForce')"
            @click="onToolbarRunUpstreamForce"
          >
            <span class="play-glyph" aria-hidden="true">
              <MediaRunIcon kind="rewind" />
            </span>
          </button>
          <button
            v-if="toolbarSelectedIsOutput"
            type="button"
            class="play-control"
            :title="t('graph.play.enqueue')"
            :aria-label="t('graph.play.enqueue')"
            @click="onEnqueueWorkflowClick"
          >
            <span class="play-glyph" aria-hidden="true">
              <MediaRunIcon kind="queue" />
            </span>
          </button>
        </template>
        <button type="button" :class="{ active: linkingFrom || linkingTo || rewireSession }" @click="cancelLink">
          {{ linkingFrom || linkingTo || rewireSession ? t('graph.link.cancel') : t('graph.link.start') }}
        </button>
        <button
          type="button"
          class="edge-style-btn"
          :title="t('graph.edgeStyle.cycleTitle', { style: t(`graph.edgeStyle.${edgePathStyle}`) })"
          :aria-label="t('graph.edgeStyle.cycleTitle', { style: t(`graph.edgeStyle.${edgePathStyle}`) })"
          @click="cycleEdgePathStyle"
        >
          <svg
            v-if="edgePathStyle === 'curve'"
            viewBox="0 0 16 16"
            width="16"
            height="16"
            aria-hidden="true"
          >
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              d="M2 12 C6 12 6 4 14 4"
            />
          </svg>
          <svg
            v-else-if="edgePathStyle === 'orthogonal'"
            viewBox="0 0 16 16"
            width="16"
            height="16"
            aria-hidden="true"
          >
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M2 12 H8 V4 H14"
            />
          </svg>
          <svg v-else viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-dasharray="2.5 2"
              d="M2 12 C6 12 6 4 14 4"
            />
            <path
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
              d="M3.5 3.5 L12.5 12.5"
            />
          </svg>
          <span class="edge-style-label">{{ t(`graph.edgeStyle.${edgePathStyle}`) }}</span>
        </button>
        <span class="tool-mode-group" role="group" :aria-label="t('graph.toolbar.toolMode')">
          <button
            type="button"
            class="tool-mode-btn"
            :class="{ active: viewportToolMode === 'select' }"
            :title="t('graph.toolbar.selectTitle')"
            :aria-label="t('graph.toolbar.selectTitle')"
            :aria-pressed="viewportToolMode === 'select'"
            @click="setViewportToolMode('select')"
          >
            <!-- 选择：实心鼠标光标箭头 -->
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path
                fill="currentColor"
                d="M3 1.4v12.2l3.15-3.05 1.85 4.45 1.85-.75-1.85-4.4H12.9Z"
              />
            </svg>
          </button>
          <button
            type="button"
            class="tool-mode-btn"
            :class="{ active: viewportToolMode === 'pan' }"
            :title="t('graph.toolbar.panTitle')"
            :aria-label="t('graph.toolbar.panTitle')"
            :aria-pressed="viewportToolMode === 'pan'"
            @click="setViewportToolMode('pan')"
          >
            <!-- 平移：鼠标实心抓取手形（Material pan_tool） -->
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                fill="currentColor"
                d="M23 5.5V20c0 2.2-1.8 4-4 4h-7.3c-1.08 0-2.1-.43-2.85-1.19L1 14.83s1.26-1.23 1.3-1.25c.22-.19.49-.29.79-.29.22 0 .42.06.6.16.04.01 4.31 2.46 4.31 2.46V4c0-.83.67-1.5 1.5-1.5S11 3.17 11 4v7h1V1.5c0-.83.67-1.5 1.5-1.5S15 .67 15 1.5V11h1V2.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5V11h1V5.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5z"
              />
            </svg>
          </button>
        </span>
        <button type="button" @click="fitView">{{ t('graph.fitView') }}</button>
        <button
          v-if="canGroupSelection"
          type="button"
          @click="groupSelectedNodes"
        >
          {{ t('graph.group.action') }}
        </button>
        <button
          v-if="canUngroupSelection"
          type="button"
          @click="ungroupSelectedNodes"
        >
          {{ t('graph.group.ungroup') }}
        </button>
        <button
          v-if="canEncapsulateSelection"
          type="button"
          :title="t('graph.hostInterface.encapsulate')"
          @click="encapsulateSelectedAsHost"
        >
          {{ t('graph.hostInterface.encapsulateAction') }}
        </button>
        <button
          v-if="isEpisodePipelineGraph"
          type="button"
          class="episode-pipeline-btn"
          :title="t('graph.episodePipeline.openTitle')"
          @click="openEpisodePipeline"
        >
          {{ t('graph.episodePipeline.open') }}
        </button>
        <span ref="zoomLabelEl" class="zoom">100%</span>
      </div>
    </div>
    <div
      v-if="runMessage"
      class="run-banner"
      :class="{ error: runFailed, ok: runSucceeded }"
      role="status"
      :title="t('graph.run.dismissHint')"
      @click="dismissRunBanner"
    >
      <span class="run-banner-text">{{ runMessage }}</span>
      <button
        v-if="lastLogRunId"
        type="button"
        class="run-banner-log"
        @click.stop="openRunLog(lastLogRunId)"
      >
        {{ t('graph.logs.viewLog') }}
      </button>
    </div>
    <div
      v-if="dropError"
      class="run-banner error"
      role="status"
      :title="t('graph.run.dismissHint')"
      @click="dismissDropError"
    >
      {{ dropError }}
    </div>

    <GraphLayoutFloatingBar
      v-model:snap-enabled="snapToGridEnabled"
      v-model:grid-visible="gridVisible"
      v-model:minimap-visible="minimapVisible"
      :selected-count="selectedLayoutNodes.length"
      @align="applyAlign"
      @distribute="applyDistribute"
      @auto-layout="applyAutoLayout"
      @collapse-all-previews="setAllNodePreviewsCollapsed(true)"
      @expand-all-previews="setAllNodePreviewsCollapsed(false)"
    />

    <GraphMinimap
      v-if="minimapVisible"
      :nodes="graph.nodes"
      :viewport="graph.viewport"
      :host-width="viewportHostSize.w"
      :host-height="viewportHostSize.h"
      :selected-node-ids="selectedNodeIds"
      @pan-to="panViewportToWorldCenter"
    />

    <GraphRadialMenu
      v-if="radialMenu"
      :x="radialMenu.x"
      :y="radialMenu.y"
      :anchor-x="radialAnchor?.x"
      :anchor-y="radialAnchor?.y"
      :items="radialMenuItems"
      :hint="t('graph.radial.hint')"
      @pick="onRadialPick"
      @cancel="closeRadialMenu"
      @update:hovered-id="radialHoveredId = $event"
    />

    <div
      ref="viewportEl"
      class="graph-viewport"
      :class="{
        'drop-over': dropOver,
        selecting: !!selectionBox,
        'grid-off': !gridVisible,
        'dragging-nodes': isDraggingNodes
      }"
      @contextmenu.prevent="onContextMenu"
      @pointerdown="onViewportPointerDown"
      @pointermove="onViewportPointerMove"
      @pointerleave="onViewportPointerLeave"
    >
      <div class="grid-layer" :class="{ hidden: !gridVisible }" aria-hidden="true">
        <div ref="gridMinorEl" class="grid-pattern grid-pattern-minor" />
        <div ref="gridMajorEl" class="grid-pattern grid-pattern-major" />
      </div>
      <div
        v-if="selectionBox"
        class="selection-marquee"
        :style="{
          left: `${selectionBox.x}px`,
          top: `${selectionBox.y}px`,
          width: `${selectionBox.w}px`,
          height: `${selectionBox.h}px`
        }"
      />
      <div ref="worldBackEl" class="graph-world graph-world-back">
        <div
          v-for="frame in renderedGroupFrames"
          :key="frame.id"
          class="graph-group"
          :class="{ selected: frame.selected, live: isDraggingNodes }"
          :style="{
            left: `${frame.x}px`,
            top: `${frame.y}px`,
            width: `${frame.w}px`,
            height: `${frame.h}px`
          }"
        >
          <div
            v-if="editingGroupId !== frame.id"
            class="graph-group-label"
            @pointerdown.stop="onGroupLabelDragStart(frame.id, $event)"
            @dblclick.stop="startGroupTitleEdit(frame.id, frame.title)"
          >
            {{ frame.title }}
          </div>
          <input
            v-else
            ref="groupTitleInputEl"
            v-model="groupTitleDraft"
            class="graph-group-label-input"
            :placeholder="t('graph.group.renamePlaceholder')"
            @pointerdown.stop
            @dblclick.stop
            @blur="commitGroupTitleEdit"
            @keydown.enter.prevent="commitGroupTitleEdit"
            @keydown.esc.prevent="cancelGroupTitleEdit"
          />
        </div>
      </div>
      <canvas ref="edgesCanvasEl" class="edges-canvas" aria-hidden="true" />
      <div ref="worldEl" class="graph-world">
        <component
          v-for="{ node, card } in renderedGraphCards"
          :key="node.id"
          :is="card.component"
          :node="node"
          :selected="isNodeSelected(node.id)"
          :connecting="isLinkHighlightNode(node.id)"
          :link-mode="isPortLinkMode"
          :force-show-chrome="selectedNodeIds.size > 0 && !isResizingNode"
          :suppress-chrome="isResizingNode"
          :snap-highlight-port-ids="snapHighlightPortIdsFor(node.id)"
          :snap-ready-port-ids="snapReadyPortIdsFor(node.id)"
          :asset="assetFor(node)"
          :run-status="runStates[node.id]?.status"
          :run-error="runStates[node.id]?.error"
          :run-state="runStates[node.id]"
          :is-graph-running="isRunning"
          :host-id="graphHostId"
          @drag-start="onNodeDragStart"
          @text-change="onNoteTextChange"
          @title-change="onNodeTitleChange"
          @size-change="onNodeSizeChange"
          @out-port-down="onOutPortDown"
          @in-port-down="onInPortDown"
          @select-image-open="onSelectImageOpen"
          @select-video-open="onSelectVideoOpen"
          @select-voice-open="onSelectVoiceOpen"
          @select-text-open="onSelectTextOpen"
          @texts-open="onTextsOpen"
          @text-open="onTextOpen"
          @ui-split-open="onUiSplitOpen"
          @resize-start="onNodeResizeStartWrapped"
          @run-toggle="onNodeRunToggle"
        />
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="ctxMenu"
        ref="ctxMenuEl"
        class="ctx-menu"
        :style="{ left: `${ctxMenu.x}px`, top: `${ctxMenu.y}px` }"
        @mousedown.stop
        @click.stop
      >
      <template v-if="ctxMenu.kind === 'selection'">
        <div class="ctx-title">{{ t('graph.context.selection') }}</div>
        <template v-if="selectedLayoutNodes.length >= 2">
          <button type="button" @click="applyAlign('left'); closeCtxMenu()">
            {{ t('graph.layout.alignLeft') }}
          </button>
          <button type="button" @click="applyAlign('centerX'); closeCtxMenu()">
            {{ t('graph.layout.alignCenterX') }}
          </button>
          <button type="button" @click="applyAlign('right'); closeCtxMenu()">
            {{ t('graph.layout.alignRight') }}
          </button>
          <button type="button" @click="applyAlign('top'); closeCtxMenu()">
            {{ t('graph.layout.alignTop') }}
          </button>
          <button type="button" @click="applyAlign('centerY'); closeCtxMenu()">
            {{ t('graph.layout.alignCenterY') }}
          </button>
          <button type="button" @click="applyAlign('bottom'); closeCtxMenu()">
            {{ t('graph.layout.alignBottom') }}
          </button>
          <button
            v-if="selectedLayoutNodes.length >= 3"
            type="button"
            @click="applyDistribute('horizontal'); closeCtxMenu()"
          >
            {{ t('graph.layout.distributeH') }}
          </button>
          <button
            v-if="selectedLayoutNodes.length >= 3"
            type="button"
            @click="applyDistribute('vertical'); closeCtxMenu()"
          >
            {{ t('graph.layout.distributeV') }}
          </button>
          <button type="button" @click="applyAutoLayout(); closeCtxMenu()">
            {{ t('graph.layout.auto') }}
          </button>
          <div class="ctx-sep" aria-hidden="true" />
        </template>
        <button
          v-if="canGroupSelection"
          type="button"
          @click="groupSelectedNodes(); closeCtxMenu()"
        >
          {{ t('graph.group.action') }}
        </button>
        <button
          v-if="canUngroupSelection"
          type="button"
          @click="ungroupSelectedNodes(); closeCtxMenu()"
        >
          {{ t('graph.group.ungroup') }}
        </button>
        <button
          v-if="canEncapsulateSelection"
          type="button"
          @click="encapsulateSelectedAsHost(); closeCtxMenu()"
        >
          {{ t('graph.hostInterface.encapsulate') }}
        </button>
        <div
          v-if="canGroupSelection || canUngroupSelection || canEncapsulateSelection"
          class="ctx-sep"
          aria-hidden="true"
        />
        <button type="button" :disabled="!canCopySelection" @click="copySelectedNodes(); closeCtxMenu()">
          {{ t('graph.context.copy') }}
        </button>
        <button type="button" :disabled="!canPasteClipboard" @click="void pasteClipboardNodes(); closeCtxMenu()">
          {{ t('graph.context.paste') }}
        </button>
      </template>
      <template v-else>
        <div class="ctx-title">
          <template v-if="ctxMenu.linkFromNodeId || ctxMenu.linkToNodeId">
            {{ t('graph.context.addAndConnect') }}
            <span v-if="connectMenuPortTypeLabel" class="ctx-port-type">{{ connectMenuPortTypeLabel }}</span>
          </template>
          <template v-else>{{ t('graph.context.addNode') }}</template>
        </div>
        <button
          v-for="item in rootAddableMenuItems"
          :key="`${item.typeId}:${item.title ?? ''}`"
          type="button"
          @click="addNodeFromMenu(item)"
        >
          <span class="ctx-icon"><WorkspaceItemIcon :icon="item.icon" :size="14" /></span>
          <span class="ctx-label">{{ item.label }}</span>
          <span v-if="item.portTypeLabel" class="ctx-item-type">{{ item.portTypeLabel }}</span>
        </button>
        <div
          v-for="group in resourceAddableMenuGroups"
          :key="group.id"
          class="ctx-submenu"
          @pointerenter="openCtxSubmenu(group.id)"
          @pointerleave="closeCtxSubmenu(group.id)"
        >
          <button
            type="button"
            class="ctx-submenu-trigger"
            :class="{ open: ctxSubmenu === group.id, pinned: ctxSubmenuPinned && ctxSubmenu === group.id }"
            @click="toggleCtxSubmenu(group.id)"
          >
            <span class="ctx-icon"><WorkspaceItemIcon :icon="group.icon" :size="14" /></span>
            <span class="ctx-label">{{ group.label }}</span>
            <span class="ctx-submenu-arrow" aria-hidden="true">›</span>
          </button>
          <div
            v-if="ctxSubmenu === group.id"
            class="ctx-submenu-panel"
            :class="{
              'open-left': submenuFlip.left,
              'open-up': submenuFlip.up
            }"
          >
        <button
          v-for="item in group.items"
          :key="`${item.typeId}:${item.title ?? ''}`"
          type="button"
          @click="addNodeFromMenu(item)"
        >
              <span class="ctx-icon"><WorkspaceItemIcon :icon="item.icon" :size="14" /></span>
              <span class="ctx-label">{{ item.label }}</span>
              <span v-if="item.portTypeLabel" class="ctx-item-type">{{ item.portTypeLabel }}</span>
            </button>
          </div>
        </div>
        <div
          v-if="(ctxMenu.linkFromNodeId || ctxMenu.linkToNodeId) && addableMenuItems.length === 0"
          class="ctx-empty"
        >
          {{ t('graph.context.noCompatibleNodes') }}
        </div>
      </template>
      </div>
    </Teleport>

    <!-- 选取器等 Dialog：独立渲染层，避免 open 时整图重渲 -->
    <NodeGraphEditorDialogLayer />
    <SaveAssetDialog
      ref="encapsulateSaveDialogRef"
      :open="encapsulateSaveOpen"
      :default-name="encapsulateSaveDefaultName"
      :default-folder-id="encapsulateSaveDefaultFolderId"
      :title="t('graph.hostInterface.nameTitle')"
      :subtitle="t('graph.hostInterface.saveMessage')"
      @confirm="onEncapsulateSaveConfirm"
      @cancel="closeEncapsulateSaveDialog"
    />

    <!-- 剧集流水线独立窗口：不占画布，可同时操作节点 -->
    <StudioFloatingWindow
      v-if="episodePipelineOpen"
      :open="true"
      :title="episodePipelineTitle"
      :z-index="1200"
      :default-width="1120"
      :default-height="720"
      :min-width="760"
      :min-height="480"
      body-class="pad-none"
      @close="closeEpisodePipeline"
    >
      <EpisodePipelineView
        :frame-key="'episode-pipeline'"
        :host-asset-id="props.assetId ?? ''"
      />
    </StudioFloatingWindow>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  reactive,
  ref,
  watch
} from 'vue'
import { resolveGraphCard } from '../graph/cards/registry'
import GraphLayoutFloatingBar from './GraphLayoutFloatingBar.vue'
import GraphMinimap from './GraphMinimap.vue'
import EditorDiveBar from './EditorDiveBar.vue'
import NodeGraphEditorDialogLayer from './NodeGraphEditorDialogLayer.vue'
import SaveAssetDialog from './SaveAssetDialog.vue'
import StudioFloatingWindow from './StudioFloatingWindow.vue'
import {
  editorDiveKey,
  isEditorDiveAssetFrame
} from '../features/graph/model/editorDive'
import {
  graphEditorDialogsKey,
  type GraphEditorDialogsApi
} from '../features/graph/ui/graphEditorDialogsKey'
import { graphEditorNodeTools } from '../features/graph/ui/graphEditorNodeTools'
import GraphRadialMenu, { type RadialMenuItem } from './GraphRadialMenu.vue'
import MediaRunIcon from './icons/MediaRunIcon.vue'
import WorkspaceItemIcon from './WorkspaceItemIcon.vue'
import { playFlyToGraphTasks } from '../features/graph/ui/flyToGraphTasks'
import { useProjectStore } from '../stores/project'
import {
  useWorkspaceStore,
  STUDIO_ASSET_DRAG_MIME,
  STUDIO_ASSET_ID_DRAG_MIME,
  STUDIO_ASSET_IDS_DRAG_MIME,
  STUDIO_BEAT_UNIT_DRAG_MIME,
  STUDIO_BEAT_UNIT_ID_DRAG_MIME
} from '../stores/workspace'
import { useDraftStore } from '../stores/drafts'
import { useGraphTaskStore, type GraphTaskTarget } from '../stores/graphTasks'
import { worldElementKindKey } from '../features/world/worldElementKindKey'
import { detectImportAssetType, isImportablePath } from '@shared/import'
import { compareNames } from '@shared/folderTree'
import { persistAssetRecord, useAssetRecord } from '../composables/useAssetRecord'
import {
  ANIM2D_ASSET_ICON,
  ASSET_TYPE_ICONS,
  isDraftAssetId,
  isImportedMediaRefAsset,
  normalizeProjectStyleImages,
  resolveMediaOutputDir,
  type AssetInfo,
  type AssetType
} from '@shared/domain'
import { assetMediaHostDirs } from '@shared/assetPackage/pathname'
import { saveGraphRunMediaForNode } from '../features/graph/saveGraphRunMediaForNode'
import { saveGraphRunTextForNode } from '../features/graph/saveGraphRunTextForNode'
import { readGraphRunText } from '../features/graph/readGraphRunText'
import { resolveAssetText } from '../features/media/resolveAssetText'
import { collectWorldElementOutputs, previewWorldElementOutputsFromSubgraphs } from '../features/world/worldElementPipeline'
import { collectBeatUnitTexts } from '../features/beat/beatPipeline'
import { applyWorldCatalog, loadWorldCatalog } from '../features/world/applyWorldCatalogOnOpen'
import {
  applyBeatCatalog,
  loadBeatCatalog
} from '../features/beat/applyBeatCatalogOnOpen'
import {
  canConnectFromNodeType,
  canConnectNodes,
  canConnectToNodeType,
  findCompatibleInPort,
  findInPort,
  findOutPort,
  resolveSnapConnectEdges,
  resolveSnapDragPreview,
  snapConnectThresholdWorld,
  snapPortKey,
  connectEdgesWithShortcutPrune,
  type SnapConnectCandidate,
  canScopeAcceptDraggedAsset,
  cloneGraphDocument,
  buildGraphClipboardPayload,
  applyGraphClipboardPayload,
  serializeGraphClipboardPayload,
  parseGraphClipboardPayload,
  GRAPH_CLIPBOARD_PASTE_OFFSET,
  type GraphClipboardPayload,
  createAssetGraphNode,
  createParamsForScope,
  createGraphGroupId,
  createNodeFromType,
  getGroupBounds,
  getNodeDefaultSize,
  getNodeSize,
  getNodePortCenter,
  getNodeType,
  getNodesBounds,
  getScopeHostIdSuffix,
  isNodeDeletable,
  isNodeGroupable,
  isDirectorProcessingNode,
  isProcessingAssetNode,
  isAssetHostNode,
  isBatchSubgraphCookNode,
  isAssetRefNode,
  isAssetRefInputHostType,
  encapsulateSelection,
  pickWorldElementStateForMigration,
  cloneHostInterface,
  pruneEdgesForHostInterface,
  readHostInterfaceFromGenParams,
  type HostInterfaceDocument,
  readHostSchemaVersion,
  HOST_INTERFACE_SCHEMA_VERSION,
  resolveHostInputSlotsForHostOpen,
  resolveBoundaryInputValuesFromParents,
  applyBoundaryInputValues,
  isBoundaryInputNode,
  hydrateHostInputSlotSpecs,
  type ResolveHostInputSlotsOptions,
  isHostInputSlotNode,
  listAddableNodeTypes,
  nextGraphGroupTitle,
  normalizeAssetGraph,
  normalizeScopedGraph,
  onNodeTypeRegistryChanged,
  replaceGraphDocument,
  resolveGraphScope,
  resolveNodeGroupAfterMove,
  sanitizeGraphGroups,
  assetTypeToGraphNodeTitle,
  resolveNodeTextContent,
  alignNodes,
  autoLayoutNodes,
  distributeNodes,
  type AlignMode,
  type DistributeMode,
  type GraphAddScope,
  flattenImagesValues,
  flattenTextsValues,
  flattenVideosValues,
  flattenVoicesValues,
  graphValueHasPayload,
  imageItemKey,
  isWorldGenImageOutPortId,
  softResolveSourceOutput,
  WORLD_GEN_IMAGE_OUT_PORTS,
  worldGenImageGroupOutputs,
  textItemKey,
  videoItemKey,
  voiceItemKey,
  pickImageItem,
  pickTextItem,
  pickVideoItem,
  pickVoiceItem,
  resolveAssetTextFromGenParams,
  resolveMotionImageItems,
  createBeatRefNode,
  readWorldElementGraphForNode,
  LEGACY_WORLD_GEN_NODE_ID,
  inferElementWorkflowHostInterface,
  withWorldElementGraphForNode,
  readBeatGraphFromGenParams,
  withBeatGraph,
  readBoundBeatIdFromNodeParams,
  type WorldElementKind,
  type BeatRow,
  type GraphImageItem,
  type GraphTextItem,
  type GraphVideoItem,
  type GraphVoiceItem,
  type GraphDocument,
  type GraphEdge,
  type GraphNode,
  type GraphNodeParams,
  type GraphNodeTextField,
  type GraphNodeTypeId,
  type GraphPortDataType,
  type MultiAngleCameraState,
  multiAngleCameraToNodePatch,
  readMultiAngleCameraFromNode,
  type LightingSetupState,
  lightingSetupToNodePatch,
  readLightingSetupFromNode,
  type PortraitTextureState,
  portraitTextureToNodePatch,
  readPortraitTextureFromNode,
  type EmotionPadState,
  emotionPadToNodePatch,
  readEmotionPadFromNode,
  type ImageExpandState,
  type ImageRedrawState,
  type ImageEraseState,
  type ImageMatteState,
  type ImageCropState,
  type ImageGridSplitState,
  readImageExpandFromNode,
  readImageRedrawFromNode,
  readImageEraseFromNode,
  readImageMatteFromNode,
  readImageCropFromNode,
  readImageGridSplitFromNode,
  stringifyWorldElementCatalog,
  stringifyBeatRows,
  formatBeatRefText,
  parseBeatJson,
  EPISODE_AGENT_BEATBOARD,
  EPISODE_AGENT_BREAKDOWN,
  EPISODE_AGENT_DIRECTOR,
  EPISODE_AGENT_MOTION,
  EPISODE_AGENT_SEQUENCE,
  catalogTextFromValue,
  isBoundaryOutputNode,
  isGraphOutputTerminalNode,
  GraphPortType,
  WORLD_ELEMENT_KINDS
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import { promptAlert } from '../composables/useStudioPrompt'
import { useEditorKernel } from '../editor/kernel'
import { editorPreferences } from '../editor/preferences'
import { useGraphCommands } from '../graph/useGraphCommands'
import {
  clientToGraphWorld,
  collectMarqueeHits,
  getNodeWorldBounds,
  graphCenterPosition,
  rectsIntersect,
  type GraphRect,
  viewportBoxToWorldRect
} from '../graph/geometry'
import {
  computeEdgeScreenGeometry,
  computeTempEdgeScreen,
  drawGraphEdges,
  hitTestEdges,
  nearerEdgeEndpoint,
  nextGraphEdgePathStyle,
  parseGraphEdgePathStyle,
  type EdgeColors,
  type EdgeScreenGeometry,
  type GraphEdgePathStyle
} from '../graph/edgeCanvas'
import { applyGraphGridStyle } from '../graph/gridCanvas'
import { useGraphNodeInteraction } from '../graph/useGraphNodeInteraction'
import { graphPreviewVisibilityKey } from '../features/media/graphPreviewVisibility'
import {
  clearAssetUrlCaches,
  resolveAssetFileUrl as resolveCachedAssetFileUrl
} from '../features/media/assetUrlCache'
import {
  graphEditorHosts,
  buildIncomingEdgeRefs,
  reorderIncomingEdgesByIds
} from '../features/graph/model/graphEditorHosts'
import {
  bumpGraphPasteGeneration,
  getMemoryGraphClipboard,
  setMemoryGraphClipboard
} from '../features/graph/model/graphClipboardMemory'
import {
  DIRECTOR_STAGES_BY_NODE_KEY,
  createFreshDirectorStage,
  patchGenParamsWithNodeStage,
  removeNodeStagesFromGenParams
} from '../features/director/directorStageBinding'
import { graphRunHosts } from '../features/graph/model/graphRunHosts'
import { liftHostOutputsFromInnerGraph } from '../features/graph/model/liftHostOutputsFromInner'
import { resolveGraphNodeDisplayTitle } from '../features/graph/model/graphNodeDisplayTitle'
import { useGraphRunSession } from '../features/graph/controllers/useGraphRunSession'
import { useGraphRunLogsStore } from '../stores/graphRunLogs'
import { toPlain } from '../utils/toPlain'
import { placeFixedMenu } from '../utils/clampFixedMenuPosition'

const { t, graphTypeLabel, assetTypeLabel, locale } = useStudioI18n()
const project = useProjectStore()
const workspace = useWorkspaceStore()
const taskStore = useGraphTaskStore()
const runLogsStore = useGraphRunLogsStore()
const editor = useEditorKernel()
const EpisodePipelineView = defineAsyncComponent(
  () => import('./dive/EditorDiveEpisodePipelineView.vue')
)
/** 挂载时绑定的工程根路径；切换工程后卸载时禁止写回旧图 */
const boundRootPath = project.rootPath
const props = withDefaults(
  defineProps<{
    /** 传入时作为资产级通用节点图；未传入则编辑当前分镜节点图。 */
    assetId?: string
    /** 显式指定画布 scope；未传入则按资产类型 / 分镜工作流解析。 */
    scope?: GraphAddScope
    /** 世界元素四类子画布 kind（优先于 inject） */
    worldElementKind?: WorldElementKind
    /** 所属 world.gen 节点 id；elementWorkflow 画布按节点读写独立子图 */
    worldGenNodeId?: string
    /** 场细化画布：当前单元 id（与 assetId + scope=beatUnit 合用） */
    beatId?: string
    /** 嵌入底栏等场景隐藏图工具条，运行/参数走外层 Inspector */
    hideToolbar?: boolean
  }>(),
  {
    hideToolbar: false
  }
)
const isAssetGraph = computed(() => !!props.assetId)
const { asset: graphAsset } = useAssetRecord(props.assetId ?? '')
const graphScope = computed(
  () =>
    props.scope ??
    resolveGraphScope({
      assetId: props.assetId,
      assetType: graphAsset.value?.type
    })
)
const draftStore = useDraftStore()
provide('graphScope', graphScope)

const editorDive = inject(editorDiveKey, null)
/** 资产 dive 栈顶宿主图画布显示面包屑；视图帧由编辑器壳层显示 */
const diveNavActive = computed(() => {
  if (!editorDive || editorDive.frames.length === 0 || !props.assetId) return false
  if (props.beatId || graphScope.value === 'beatUnit') return false
  const top = editorDive.frames[editorDive.frames.length - 1]
  return isEditorDiveAssetFrame(top) && props.assetId === top.assetId
})

const worldElementKindInjected = inject(worldElementKindKey, null)
const worldElementKind = computed((): WorldElementKind | null => {
  if (props.worldElementKind) return props.worldElementKind
  if (!worldElementKindInjected) return null
  if (typeof worldElementKindInjected === 'string') return worldElementKindInjected
  return worldElementKindInjected.value
})
const isElementWorkflowGraph = computed(
  () => isAssetGraph.value && graphScope.value === 'elementWorkflow' && !!worldElementKind.value
)
/** 世界元素管线宿主：世界元素资产图、内嵌世界节点链的自由画布、或封装了世界节点链的子图资产 */
const isWorldElementPipelineHost = computed(
  () =>
    graphScope.value === 'worldAsset' ||
    graphScope.value === 'canvasAsset' ||
    graphScope.value === 'subgraphAsset'
)
const worldElementNodeId = computed(() => {
  const id = props.worldGenNodeId?.trim() || ''
  // 旧版默认节点走资产级共享子图（宿主 id 不带节点后缀）
  return id === LEGACY_WORLD_GEN_NODE_ID ? '' : id
})
const isBeatUnitGraph = computed(
  () =>
    isAssetGraph.value &&
    graphScope.value === 'beatUnit' &&
    !!props.beatId?.trim()
)

const previewVisibleNodeIds = ref<ReadonlySet<string>>(new Set())
const previewVisibilityRevision = ref(0)
let previewVisibilityRaf = 0

function updatePreviewVisibility(): void {
  const host = viewportEl.value
  if (!host) return
  const margin = 320
  const zoom = Math.max(0.001, graph.viewport.zoom)
  const worldLeft = (-graph.viewport.x - margin) / zoom
  const worldTop = (-graph.viewport.y - margin) / zoom
  const worldRight = (-graph.viewport.x + host.clientWidth + margin) / zoom
  const worldBottom = (-graph.viewport.y + host.clientHeight + margin) / zoom
  const next = new Set<string>()
  for (const node of graph.nodes) {
    const { w, h } = getNodeSize(node)
    const left = node.position.x
    const top = node.position.y
    const right = left + w
    const bottom = top + h
    if (right < worldLeft || left > worldRight || bottom < worldTop || top > worldBottom) continue
    next.add(node.id)
  }
  const prev = previewVisibleNodeIds.value
  if (prev.size === next.size) {
    let same = true
    for (const id of next) {
      if (!prev.has(id)) {
        same = false
        break
      }
    }
    if (same) return
  }
  previewVisibleNodeIds.value = next
  previewVisibilityRevision.value += 1
}

function requestPreviewVisibilityUpdate(): void {
  if (previewVisibilityRaf) return
  previewVisibilityRaf = requestAnimationFrame(() => {
    previewVisibilityRaf = 0
    updatePreviewVisibility()
  })
}

/** 缩放/平移手势期间不刷新预览可见性，避免每帧触发节点卡重载 */
let viewportGestureIdleTimer: ReturnType<typeof setTimeout> | null = null
/** 连续滚轮期间复用 rect，避免每事件强制 layout */
let wheelRectCache: { left: number; top: number; height: number; until: number } | null = null

function scheduleViewportGestureIdle(): void {
  if (viewportGestureIdleTimer) clearTimeout(viewportGestureIdleTimer)
  viewportGestureIdleTimer = setTimeout(() => {
    viewportGestureIdleTimer = null
    wheelRectCache = null
    // 手势结束：保证最后一帧已落屏，再写回 reactive 并恢复边动画
    if (viewportTransformRaf) {
      cancelAnimationFrame(viewportTransformRaf)
      flushViewportTransform()
    }
    endViewportGestureVisual()
    // 网格已随视口同步；停手后只补预览可见性与落盘
    requestPreviewVisibilityUpdate()
    scheduleViewportSave()
  }, 140)
}

provide(graphPreviewVisibilityKey, {
  visibleNodeIds: previewVisibleNodeIds,
  revision: previewVisibilityRevision
})
const graphHostId = computed(() => {
  const base = props.assetId
    ? `asset:${props.assetId}`
    : 'asset:unscoped'
  if (isElementWorkflowGraph.value && worldElementKind.value) {
    return worldElementNodeId.value
      ? `${base}:element:${worldElementKind.value}:${worldElementNodeId.value}`
      : `${base}:element:${worldElementKind.value}`
  }
  if (isBeatUnitGraph.value && props.beatId) {
    return `${base}:unit:${props.beatId}`
  }
  const suffix = getScopeHostIdSuffix(graphScope.value)
  if (!props.assetId && suffix) return `${base}:${suffix}`
  return base
})
const graphDocumentId = computed(() => `graph:${graphHostId.value}`)

function activeDocumentId(): string {
  return graphDocumentId.value
}

function syncHostInterfaceSnapshots(doc: GraphDocument): GraphDocument {
  let next = cloneGraphDocument(doc)
  for (const node of next.nodes) {
    if (node.params.assetHost !== true || !node.assetId) continue
    if (!isAssetRefInputHostType(node.assetType)) continue
    const asset = project.assets.find((item) => item.id === node.assetId)
    if (!asset) continue
    const genParams = asset.genParams as Record<string, unknown> | undefined
    const schemaVersion = readHostSchemaVersion(genParams)
    if (
      node.params.hostSchemaVersion === schemaVersion &&
      node.params.hostInterfaceSnapshot
    ) {
      continue
    }
    const iface = readHostInterfaceFromGenParams(genParams, asset.type)
    node.params = {
      ...node.params,
      hostInterfaceSnapshot: cloneHostInterface(iface),
      hostSchemaVersion: schemaVersion
    }
    next = pruneEdgesForHostInterface(next, node.id, iface)
  }
  return next
}

function applyGraphDocument(doc: GraphDocument): void {
  const synced = syncHostInterfaceSnapshots(doc)
  replaceGraphDocument(graph, synced)
  runStateBridge.importFromDocument(synced)
  syncLiveViewportFromGraph()
  // 图整体替换（加载/撤销/重做/外部应用）后重算可见集合并重绘边
  refreshGraphRenderWindow(true)
  requestEdgeRender()
}

function collectParentGraphsForHost(hostAssetId: string): GraphDocument[] {
  const parents: GraphDocument[] = []
  const seen = new WeakSet<object>()
  const pushRaw = (raw: unknown): void => {
    if (!raw || typeof raw !== 'object') return
    if (seen.has(raw)) return
    const doc = raw as GraphDocument
    if (!Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) return
    if (!doc.nodes.some((n) => n.assetId === hostAssetId)) return
    seen.add(raw)
    parents.push(doc)
  }
  // 其它已打开编辑器的实时图（含未落盘连线 / runStates）优先
  for (const live of graphEditorHosts.listLiveDocuments()) {
    pushRaw(live)
  }
  for (const asset of project.assets) {
    // 宿主自身 graphJson 可能含同 assetId 的加工/引用节点，不能当作外层父图
    if (asset.id === hostAssetId) continue
    pushRaw(asset.genParams?.graphJson)
  }
  for (const draft of draftStore.drafts) {
    if (draft.id === hostAssetId) continue
    pushRaw(draft.genParams?.graphJson)
  }
  // 当前打开的其它图画布（本实例）；须先判断 assetId，避免 setup 初始化 graph 时触达 TDZ
  if (props.assetId !== hostAssetId && graph.nodes.some((n) => n.assetId === hostAssetId)) {
    pushRaw(buildGraphJson())
  }
  return parents
}

function hostInputResolveOptions(): ResolveHostInputSlotsOptions {
  return {
    resolveAssetText: (assetId) => {
      const asset = project.assets.find((a) => a.id === assetId)
      if (!asset) {
        const draft = draftStore.getDraft(assetId)
        if (!draft) return undefined
        return resolveAssetTextFromGenParams(draft.genParams, {})
      }
      return resolveAssetTextFromGenParams(asset.genParams, {})
    },
    resolveAssetGenParams: (assetId) => {
      const live = graphEditorHosts.getLiveAssetDocument(assetId)
      const base = isDraftAssetId(assetId)
        ? (draftStore.getDraft(assetId)?.genParams as Record<string, unknown> | undefined)
        : (project.assets.find((a) => a.id === assetId)?.genParams as
            | Record<string, unknown>
            | undefined)
      if (live) return { ...(base ?? {}), graphJson: live }
      return base
    },
    resolveLiveAssetGraph: (assetId) =>
      graphEditorHosts.getLiveAssetDocument(assetId) ?? undefined
  }
}

function resolveParentHostInputSlots(hostAssetId: string | null | undefined) {
  if (!hostAssetId) return undefined
  // 仅主资产图画布同步输入接口；场 / 世界元素子图不参与
  if (isBeatUnitGraph.value || isElementWorkflowGraph.value) {
    return undefined
  }
  if (!isAssetRefInputHostType(graphAsset.value?.type)) return undefined
  return resolveHostInputSlotsForHostOpen(
    graphAsset.value.type,
    collectParentGraphsForHost(hostAssetId),
    hostAssetId,
    hostInputResolveOptions()
  )
}

/**
 * dive / 切入内图时把父图入端口的值注入 boundary 输入节点。
 * 内图单独执行时 boundary 输入只读自身 params，故必须落到节点上。
 */
function syncBoundaryInputsFromParents(): boolean {
  const hostAssetId = props.assetId ?? graphAsset.value?.id ?? null
  if (!hostAssetId) return false
  if (!graph.nodes.some((node) => isBoundaryInputNode(node))) return false
  const values = resolveBoundaryInputValuesFromParents(
    collectParentGraphsForHost(hostAssetId),
    hostAssetId,
    hostInputResolveOptions()
  )
  if (!Object.keys(values).length) return false
  return applyBoundaryInputValues(graph.nodes, values)
}

/** 当前宿主资产已保存的端口接口；缺失时回落到类型默认模板 */
function resolveHostInterfaceForGraph(): HostInterfaceDocument | null {
  const host = graphAsset.value
  if (!host || !isAssetRefInputHostType(host.type)) return null
  return readHostInterfaceFromGenParams(
    host.genParams as Record<string, unknown> | undefined,
    host.type
  )
}

function normalizeGraphForHost(raw: GraphDocument | null | undefined): GraphDocument {
  const host = graphAsset.value
  const hostAssetId = props.assetId ?? host?.id ?? null
  return normalizeScopedGraph(graphScope.value, raw, {
    assetType: host?.type,
    hostAssetId,
    hasMediaFile: !!host?.relativePath?.trim(),
    parentHostInputSlots: resolveParentHostInputSlots(hostAssetId),
    hostInterface: resolveHostInterfaceForGraph()
  })
}

function readAssetGraph(): GraphDocument {
  if (isBeatUnitGraph.value && props.beatId && props.assetId) {
    const gen =
      (isDraftAssetId(props.assetId)
        ? draftStore.getDraft(props.assetId)?.genParams
        : graphAsset.value?.genParams) ?? undefined
    const raw = readBeatGraphFromGenParams(gen, props.beatId)
    return normalizeScopedGraph(graphScope.value, raw, {
      assetType: graphAsset.value?.type ?? 'beat',
      hostAssetId: props.assetId
    })
  }
  if (isElementWorkflowGraph.value && worldElementKind.value && props.assetId) {
    const gen =
      (isDraftAssetId(props.assetId)
        ? draftStore.getDraft(props.assetId)?.genParams
        : graphAsset.value?.genParams) ?? undefined
    const raw = readWorldElementGraphForNode(
      gen,
      worldElementNodeId.value || LEGACY_WORLD_GEN_NODE_ID,
      worldElementKind.value
    )
    return normalizeScopedGraph(graphScope.value, raw, {
      assetType: graphAsset.value?.type ?? 'world',
      hostAssetId: props.assetId,
      hostInterface: inferElementWorkflowHostInterface(raw)
    })
  }
  const raw = graphAsset.value?.genParams?.graphJson
  const host = graphAsset.value
  const hostAssetId = props.assetId ?? host?.id ?? null
  return normalizeAssetGraph(raw as GraphDocument | null | undefined, host?.type, {
    hostAssetId,
    hasMediaFile: !!host?.relativePath?.trim(),
    parentHostInputSlots: resolveParentHostInputSlots(hostAssetId),
    hostInterface: resolveHostInterfaceForGraph()
  })
}

/** 资产图最近一次落盘 Promise；flushSave 需 await，避免关窗丢写 */
let assetGraphPersist: Promise<unknown> | null = null

function trackAssetGraphPersist(promise: Promise<unknown>): void {
  assetGraphPersist = promise.finally(() => {
    if (assetGraphPersist === promise) assetGraphPersist = null
  })
}

function commitAssetGraph(): boolean {
  if (project.rootPath !== boundRootPath) return false
  const asset = graphAsset.value
  if (!asset || !props.assetId) return false
  const graphJson = buildGraphJson()
  const latest =
    (isDraftAssetId(props.assetId)
      ? null
      : project.assets.find((item) => item.id === props.assetId)) ?? asset

  if (isBeatUnitGraph.value && props.beatId) {
    const plain = toPlain(graphJson)
    if (isDraftAssetId(props.assetId)) {
      const draft = draftStore.getDraft(props.assetId)
      // 再读一次最新 genParams，降低与 catalog 落盘的竞态丢字段
      const latestGen = draftStore.getDraft(props.assetId)?.genParams ?? draft?.genParams
      draftStore.updateDraft(props.assetId, {
        genParams: withBeatGraph(latestGen, props.beatId, plain)
      })
      return true
    }
    const write = persistAssetRecord(props.assetId, {
      genParams: withBeatGraph(
        (project.assets.find((item) => item.id === props.assetId)?.genParams as
          | Record<string, unknown>
          | undefined) ?? (latest.genParams as Record<string, unknown> | undefined),
        props.beatId,
        plain
      )
    }).catch((error) => {
      console.error('[NodeGraphEditor] beat unit graph save failed', error)
    })
    trackAssetGraphPersist(write)
    return true
  }

  if (isElementWorkflowGraph.value && worldElementKind.value) {
    const plain = toPlain(graphJson)
    if (isDraftAssetId(props.assetId)) {
      const draft = draftStore.getDraft(props.assetId)
      draftStore.updateDraft(props.assetId, {
        genParams: withWorldElementGraphForNode(
          draft?.genParams,
          worldElementNodeId.value || LEGACY_WORLD_GEN_NODE_ID,
          worldElementKind.value,
          plain
        )
      })
      return true
    }
    const write = persistAssetRecord(props.assetId, {
      genParams: withWorldElementGraphForNode(
        latest.genParams as Record<string, unknown> | undefined,
        worldElementNodeId.value || LEGACY_WORLD_GEN_NODE_ID,
        worldElementKind.value,
        plain
      )
    }).catch((error) => {
      console.error('[NodeGraphEditor] world element graph save failed', error)
    })
    trackAssetGraphPersist(write)
    return true
  }

  const write = persistAssetRecord(props.assetId, {
    genParams: { ...(latest.genParams ?? {}), graphJson }
  }).catch((error) => {
    console.error('[NodeGraphEditor] asset graph save failed', error)
  })
  trackAssetGraphPersist(write)
  return true
}

function loadGraphFromAsset(): void {
  applyGraphDocument(readAssetGraph())
  if (syncBoundaryInputsFromParents()) scheduleSave()
  void hydrateHostInputSlotTextsInGraph()
}

interface HostInputCarrier {
  node: GraphNode
  portId: string
  index: number
  dataType: GraphPortDataType
}

/**
 * 承载宿主入端口值的节点：HDA 的 boundary 输入，以及存量 graph.input.slot。
 * boundary 每端口一个节点，无 index 概念，统一按 index 0 参与槽位匹配。
 */
function hostInputCarriers(): HostInputCarrier[] {
  const carriers: HostInputCarrier[] = []
  for (const node of graph.nodes) {
    if (isBoundaryInputNode(node)) {
      carriers.push({
        node,
        portId: node.params.hostBoundaryPort?.portId ?? 'in',
        index: 0,
        dataType: node.params.hostBoundaryPort?.dataType ?? GraphPortType.text
      })
      continue
    }
    if (isHostInputSlotNode(node)) {
      carriers.push({
        node,
        portId: node.params.hostInputSlot?.portId ?? 'in',
        index: node.params.hostInputSlot?.index ?? 0,
        dataType: node.params.hostInputSlot?.dataType ?? GraphPortType.text
      })
    }
  }
  return carriers
}

/** 把已解析的槽位正文写回图中空输入接口（不覆盖已有非空正文） */
function applyHostInputSlotTexts(
  specs: Array<{ portId: string; index: number; text?: string; previewRelativePath?: string }>
): boolean {
  const carriers = hostInputCarriers()
  let changed = false
  for (const spec of specs) {
    if (!spec.text?.trim()) continue
    const carrier = carriers.find((c) => c.portId === spec.portId && c.index === spec.index)
    if (!carrier || carrier.node.params.text?.trim()) continue
    carrier.node.params = {
      ...carrier.node.params,
      text: spec.text,
      ...(spec.previewRelativePath?.trim()
        ? { previewRelativePath: spec.previewRelativePath.trim() }
        : {})
    }
    changed = true
  }
  return changed
}

/** 外层文本常仅有 relativePath / 旁挂文件：打开宿主后补全文到输入接口 */
async function hydrateHostInputSlotTextsInGraph(): Promise<void> {
  const carriers = hostInputCarriers()
  if (!carriers.length) return
  let changed = false
  const finish = (): void => {
    if (!changed) return
    scheduleSave()
    graphEditorHosts.bumpRevision()
  }

  // 1) 路径旁挂 → 读文件
  const specs = await hydrateHostInputSlotSpecs(
    carriers.map((carrier) => ({
      portId: carrier.portId,
      index: carrier.index,
      dataType: carrier.dataType,
      text: carrier.node.params.text,
      previewRelativePath: carrier.node.params.previewRelativePath
    })),
    readGraphRunText
  )
  changed = applyHostInputSlotTexts(specs) || changed

  // 2) 再软解析一次（含 live 源资产内图），补目录口 / 同步正文
  const hostAssetId = props.assetId
  if (!hostAssetId || !isAssetRefInputHostType(graphAsset.value?.type)) {
    finish()
    return
  }
  const refreshed = resolveParentHostInputSlots(hostAssetId)
  if (refreshed?.length) {
    changed = applyHostInputSlotTexts(refreshed) || changed
  }

  // 3) 文本口仍空：按父图入边异步读上游资产正文（剧本 sidecar 等）
  const emptyTextSlots = hostInputCarriers().filter(
    (carrier) => carrier.dataType === GraphPortType.text && !carrier.node.params.text?.trim()
  )
  if (!emptyTextSlots.length) {
    finish()
    return
  }

  for (const parent of collectParentGraphsForHost(hostAssetId)) {
    const hostNode = parent.nodes.find((n) => n.assetId === hostAssetId && isAssetHostNode(n))
    if (!hostNode) continue
    const edges = parent.edges
      .filter((edge) => edge.target === hostNode.id)
      .slice()
      .sort((a, b) => parent.edges.indexOf(a) - parent.edges.indexOf(b))
    const filledIndexByPort = new Map<string, number>()
    for (const edge of edges) {
      const targetPort = edge.targetPort ?? 'in'
      const source = parent.nodes.find((n) => n.id === edge.source)
      if (!source) continue
      let text = source.params.text?.trim() || source.params.resultText?.trim() || ''
      if (!text && source.assetId) {
        try {
          text = (await resolveAssetText(source.assetId))?.trim() ?? ''
        } catch {
          text = ''
        }
      }
      if (!text) continue
      const nextIndex = filledIndexByPort.get(targetPort) ?? 0
      const carrier = emptyTextSlots.find(
        (item) =>
          item.portId === targetPort &&
          item.index === nextIndex &&
          !item.node.params.text?.trim()
      )
      if (!carrier) continue
      carrier.node.params = { ...carrier.node.params, text }
      changed = true
      filledIndexByPort.set(targetPort, nextIndex + 1)
    }
  }
  finish()
}

/**
 * 打开 / 再次切入宿主面板：只同步 boundary 入端口值与预览正文。
 * HDA 不再创建 classic graph.input.slot（「文本输入/图片输入」）。
 */
function syncHostInputSlotsFromParents(): void {
  if (isBeatUnitGraph.value || isElementWorkflowGraph.value) return
  const hostAssetId = props.assetId ?? graphAsset.value?.id ?? null
  if (!hostAssetId) return
  const boundaryChanged = syncBoundaryInputsFromParents()
  if (boundaryChanged) {
    scheduleSave()
    graphEditorHosts.bumpRevision()
  }
  void hydrateHostInputSlotTextsInGraph().then(() => {
    scheduleSave()
    graphEditorHosts.bumpRevision()
  })
}

/** session 创建前占位；创建后接到真实导出/导入 */
const runStateBridge = {
  exportForDocument: (_nodeIds: string[]): GraphDocument['runStates'] => undefined,
  importFromDocument: (_doc: GraphDocument): void => undefined
}

function buildGraphJson(): GraphDocument {
  return cloneGraphDocument({
    nodes: graph.nodes,
    edges: graph.edges,
    groups: graph.groups ?? [],
    viewport: graph.viewport,
    runStates: runStateBridge.exportForDocument(graph.nodes.map((n) => n.id))
  })
}

function applyCommandSnapshot(snapshot: GraphDocument): void {
  applyGraphDocument(snapshot)
  if (selectedGroupId.value) {
    const validGroups = new Set((graph.groups ?? []).map((group) => group.id))
    if (!validGroups.has(selectedGroupId.value)) {
      selectedGroupId.value = null
      workspace.selectGraphGroup(null)
    }
  }
  if (selectedNodeIds.value.size > 0) {
    const valid = new Set(graph.nodes.map((node) => node.id))
    const next = new Set([...selectedNodeIds.value].filter((id) => valid.has(id)))
    if (next.size !== selectedNodeIds.value.size) selectedNodeIds.value = next
  }
  if (selectedEdgeIds.value.size > 0) {
    const valid = new Set(graph.edges.map((edge) => edge.id))
    const next = new Set([...selectedEdgeIds.value].filter((id) => valid.has(id)))
    if (next.size !== selectedEdgeIds.value.size) selectedEdgeIds.value = next
  }
  applyViewportTransform(true)
  requestPreviewVisibilityUpdate()
  scheduleSave()
}

const { recordGraphChange } = useGraphCommands({
  scope: () => `document:${activeDocumentId()}`,
  buildSnapshot: buildGraphJson,
  applySnapshot: applyCommandSnapshot
})

const rootEl = ref<HTMLElement | null>(null)
const viewportEl = ref<HTMLElement | null>(null)
const viewportHostSize = ref({ w: 0, h: 0 })

function syncViewportHostSize(): void {
  const host = viewportEl.value
  if (!host) return
  const w = host.clientWidth
  const h = host.clientHeight
  if (viewportHostSize.value.w === w && viewportHostSize.value.h === h) return
  viewportHostSize.value = { w, h }
}
const gridMinorEl = ref<HTMLElement | null>(null)
const gridMajorEl = ref<HTMLElement | null>(null)
const graph = reactive<GraphDocument>(normalizeGraphForHost(null))
const selectedNodeIds = ref<Set<string>>(new Set())
const selectedGroupId = ref<string | null>(null)
const selectedEdgeIds = ref<Set<string>>(new Set())
const selectionBox = ref<{ x: number; y: number; w: number; h: number } | null>(null)
const isDraggingNodes = ref(false)
const groupLayoutRevision = ref(0)
const linkingFrom = ref<string | null>(null)
const linkingFromPort = ref<string | null>(null)
const linkingTo = ref<string | null>(null)
const linkingToPort = ref<string | null>(null)
const tempEdgeEnd = ref<{ x: number; y: number } | null>(null)
/** 拖节点重合：兼容端口高亮 / 靠近可连预览 */
const snapHighlightPortKeys = ref<Set<string>>(new Set())
const snapReadyPortKeys = ref<Set<string>>(new Set())
const snapHighlightNodeIds = ref<Set<string>>(new Set())
const snapPreviewCandidates = ref<SnapConnectCandidate[]>([])
/** 批量拖线改接：固定端列表 + 正在拖动的一端 */
const rewireSession = ref<{
  movingEnd: 'source' | 'target'
  fixed: Array<{ nodeId: string; portId: string }>
} | null>(null)
const dropOver = ref(false)
const dropError = ref('')
let dropErrorTimer: ReturnType<typeof setTimeout> | null = null
/** 非 ref：Space 就绪态不触发 Vue 重渲染 */
let spacePan = false
/** 视口工具：选择（框选/点选）或平移（左键拖动画布） */
const viewportToolMode = ref<'select' | 'pan'>('select')
/** 中键临时平移时记下的原工具，松开后还原；null 表示未处于临时切换 */
let transientPanRestoreMode: 'select' | 'pan' | null = null
/** 指针是否在视口内（用于空格弹出右键菜单） */
const pointerOverViewport = ref(false)
const lastPointerClient = { x: 0, y: 0 }
const ctxSubmenu = ref<string | null>(null)
/** 点击分组后固定子菜单，pointerleave 不再收起（拉线添加与右键同一套） */
const ctxSubmenuPinned = ref(false)
const ctxMenuEl = ref<HTMLElement | null>(null)
const submenuFlip = ref({ left: false, up: false })
type CtxMenuState = {
  x: number
  y: number
  worldX: number
  worldY: number
  kind?: 'selection' | 'add'
  linkFromNodeId?: string
  linkFromPortId?: string
  linkToNodeId?: string
  linkToPortId?: string
}
const ctxMenu = ref<CtxMenuState | null>(null)
const nodeTypeRevision = ref(0)
const {
  runStates,
  isRunning,
  runMessage,
  runFailed,
  runSucceeded,
  lastRunResult,
  lastLogRunId,
  runningTargetNodeId,
  runWorkflow,
  runToNode,
  runToNodeSkippingDone,
  runNodeOnly,
  runHostCook,
  stopWorkflow,
  toggleNodeRun,
  nodeStatus,
  exportRunStatesSnapshot,
  importRunStatesSnapshot
} = useGraphRunSession({
  buildGraph: buildGraphJson,
  commitLocal: () => {
    scheduleSave()
  },
  afterRunCommit: async ({ graph: settled, runStates: settledStates }) => {
    // 仅资产主图 dive：内层直接跑出口时抬升到父宿主（与 Cook 子图写回对齐）
    if (isBeatUnitGraph.value || isElementWorkflowGraph.value) return
    const assetId = props.assetId?.trim()
    if (!assetId) return
    await liftHostOutputsFromInnerGraph(assetId, settled, settledStates)
  },
  t: (key, params) => t(key, params ?? {}),
  locale: () => String(locale.value),
  hostId: () => graphHostId.value,
  runTitle: () => {
    return graphAsset.value?.name?.trim() || t('graph.logs.defaultTitle')
  },
  resolveNodeTitle: (node, fallbackId) =>
    resolveGraphNodeDisplayTitle(node, {
      scope: graphScope.value,
      t: (key, params) => t(key, params ?? {}),
      graphTypeLabel,
      fallbackId
    }),
  generateText: (input) => window.studio.generateText(input),
  generateImage: (input) => window.studio.generateImage(input),
  saveRunMedia: (input) =>
    saveGraphRunMediaForNode({
      ...input,
      hostAssetId: props.assetId ?? null
    }),
  saveRunText: (input) =>
    saveGraphRunTextForNode({
      ...input,
      hostAssetId: props.assetId ?? null
    }),
  readRunText: readGraphRunText,
  generateVideo: async (input) => {
    const hostAsset = graphAsset.value
    const dirs = assetMediaHostDirs(hostAsset ?? null, project.folders)
    const outputDir = resolveMediaOutputDir({
      mediaOutputDir: input.outputDir,
      cacheOutputDir: project.config?.cacheOutputDir,
      hostRelativePath: dirs.hostRelativePath,
      hostFolderDir: dirs.hostFolderDir,
      hostAssetName: dirs.hostAssetName,
      kind: 'video'
    })
    const value = await window.studio.generateVideo({ ...input, outputDir })
    // Cache/ 默认不进资产库；仅显式写到 Assets/ 时刷新
    if (outputDir === 'Assets' || outputDir.startsWith('Assets/')) {
      await project.scheduleRefreshLibrary()
    }
    return value
  },
  generateSpeech: async (input) => {
    const hostAsset = graphAsset.value
    const dirs = assetMediaHostDirs(hostAsset ?? null, project.folders)
    const outputDir = resolveMediaOutputDir({
      mediaOutputDir: input.outputDir,
      cacheOutputDir: project.config?.cacheOutputDir,
      hostRelativePath: dirs.hostRelativePath,
      hostFolderDir: dirs.hostFolderDir,
      hostAssetName: dirs.hostAssetName,
      kind: 'voice'
    })
    const value = await window.studio.generateSpeech({ ...input, outputDir })
    if (outputDir === 'Assets' || outputDir.startsWith('Assets/')) {
      await project.refreshAssets()
    }
    return value
  },
  resolveAssetGenParams: (assetId) => {
    const live = graphEditorHosts.getLiveAssetDocument(assetId)
    const base = isDraftAssetId(assetId)
      ? (draftStore.getDraft(assetId)?.genParams as Record<string, unknown> | undefined)
      : (project.assets.find((asset) => asset.id === assetId)?.genParams as
          | Record<string, unknown>
          | undefined)
    if (live) {
      return { ...(base ?? {}), graphJson: live }
    }
    return base
  },
  resolveLiveAssetGraph: (assetId) =>
    graphEditorHosts.getLiveAssetDocument(assetId) ?? undefined,
  hasAsset: (assetId) => {
    if (isDraftAssetId(assetId)) return !!draftStore.getDraft(assetId)
    return project.assets.some((asset) => asset.id === assetId)
  },
  resolveAssetName: (assetId) => {
    if (isDraftAssetId(assetId)) {
      return draftStore.getDraft(assetId)?.name?.trim() || undefined
    }
    return project.assets.find((asset) => asset.id === assetId)?.name?.trim() || undefined
  },
  resolveHostAssetName: () => graphAsset.value?.name?.trim() || undefined,
  resolveProjectStyleImages: () =>
    normalizeProjectStyleImages(project.config?.styleImages),
  resolveBeatUnit: (beatId) => {
    const id = beatId.trim()
    if (!id) return null
    const beatAssetId = props.assetId
    if (!beatAssetId || graphScope.value !== 'beatUnit') return null
    return loadBeatCatalog(beatAssetId).find((row) => row.id === id) ?? null
  },
  collectWorldElementOutputs: async (signal, options) => {
    if (!isWorldElementPipelineHost.value) return null
    const worldId = props.assetId
    if (!worldId) return null
    // Cook 子图 / 整链：先跑齐四类元素子图，再收集；执行当前只收集已有结果
    if (options?.cookBatch) {
      const batch = taskStore.enqueueWorldElementBatch({
        worldAssetId: worldId,
        nodeId: options?.nodeId,
        onlyMissing: false
      })
      await taskStore.waitForTaskIds(batch.taskIds)
    }
    return collectWorldElementOutputs({
      worldAssetId: worldId,
      nodeId: options?.nodeId,
      signal
    })
  },
  resolveWorldElementOutputs: (node) => {
    const worldId = props.assetId?.trim()
    if (!worldId || !isWorldElementPipelineHost.value) return []
    return previewWorldElementOutputsFromSubgraphs({
      worldAssetId: worldId,
      nodeId: node?.id
    })
  },
  collectBeatUnitTexts: async (signal) => {
    if (graphScope.value !== 'beatAsset') return null
    const beatId = props.assetId
    if (!beatId) return null
    return collectBeatUnitTexts({
      beatAssetId: beatId,
      signal
    })
  },
  runHostInnerGraph: (input) => taskStore.runHostInnerGraph(input),
  resolveWorldCatalogJson: () => {
    if (!isWorldElementPipelineHost.value) return null
    const worldId = props.assetId
    if (!worldId) return null
    const catalog = loadWorldCatalog(worldId)
    const total = WORLD_ELEMENT_KINDS.reduce((sum, kind) => sum + catalog[kind].length, 0)
    if (!total) return null
    return stringifyWorldElementCatalog(catalog)
  },
  importWorldCatalogJson: async (jsonText, sourceNodeId) => {
    if (!isWorldElementPipelineHost.value) return
    const worldId = props.assetId
    if (!worldId) return
    if (sourceNodeId) {
      const source = graph.nodes.find((node) => node.id === sourceNodeId)
      if (source?.typeId === 'world.gen') {
        await applyWorldCatalog(worldId, jsonText, sourceNodeId)
        return
      }
      // 表格/提取运行：目录沿边流入其下游 world.gen 节点
      const downstreamGens = graph.edges
        .filter((edge) => edge.source === sourceNodeId)
        .map((edge) => graph.nodes.find((node) => node.id === edge.target))
        .filter(
          (node): node is GraphNode =>
            !!node && node.typeId === 'world.gen'
        )
      for (const gen of downstreamGens) {
        await applyWorldCatalog(worldId, jsonText, gen.id)
      }
      if (downstreamGens.length) return
    }
    await applyWorldCatalog(worldId, jsonText)
  },
  resolveBeatCatalogJson: () => {
    if (graphScope.value !== 'beatAsset') return null
    const beatId = props.assetId
    if (!beatId) return null
    const rows = loadBeatCatalog(beatId)
    if (!rows.length) return null
    return stringifyBeatRows(rows)
  },
  importBeatCatalogJson: async (jsonText) => {
    if (graphScope.value !== 'beatAsset') return
    const beatId = props.assetId
    if (!beatId) return
    await applyBeatCatalog(beatId, jsonText)
  },
  onNodePatch: (nodeId, patch) => {
    const live = graph.nodes.find((n) => n.id === nodeId)
    if (!live) return
    if (patch.params) {
      live.params = { ...live.params, ...patch.params }
    }
    if (patch.title !== undefined) live.title = patch.title
    // 通知 Inspector 输出预览等订阅方刷新（如 beat.split 写回 params.text）
    graphEditorHosts.bumpRevision()
    scheduleSave()
  }
})

function openRunLog(runId: string): void {
  runLogsStore.openDialog(runId)
}

runStateBridge.exportForDocument = (nodeIds) => exportRunStatesSnapshot(nodeIds)
runStateBridge.importFromDocument = (doc) => {
  importRunStatesSnapshot(doc.runStates, doc.nodes.map((n) => n.id))
}
// 首次加载可能发生在 session 接线前，这里用当前图再灌一次
importRunStatesSnapshot(
  graph.runStates,
  graph.nodes.map((n) => n.id)
)

function currentGraphTaskTarget(): GraphTaskTarget | null {
  if (!props.assetId) return null
  // 侧栏子图各自落在 genParams 的子字段，不能按整资产主图写回
  if (isElementWorkflowGraph.value && worldElementKind.value) {
    return {
      kind: 'world-element',
      worldAssetId: props.assetId,
      elementKind: worldElementKind.value,
      hostId: graphHostId.value,
      nodeId: worldElementNodeId.value || undefined
    }
  }
  if (isBeatUnitGraph.value && props.beatId?.trim()) {
    return {
      kind: 'beat-unit',
      beatAssetId: props.assetId,
      beatId: props.beatId.trim(),
      hostId: graphHostId.value
    }
  }
  return {
    kind: 'asset',
    assetId: props.assetId,
    hostId: graphHostId.value
  }
}

function blockNodeRunForActiveTask(): boolean {
  const target = currentGraphTaskTarget()
  if (!target || !taskStore.hasActiveTaskForTarget(target)) return false
  void promptAlert({
    title: t('graph.tasks.nodeRunBlockedTitle'),
    message: t('graph.tasks.nodeRunBlockedMessage')
  })
  return true
}

function onNodeRunToggle(nodeId: string): void {
  if (!isRunning.value && blockNodeRunForActiveTask()) return
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (
    node &&
    isAssetRefNode(node) &&
    node.assetId &&
    !project.assets.some((a) => a.id === node.assetId) &&
    !(isDraftAssetId(node.assetId) && draftStore.getDraft(node.assetId))
  ) {
    return
  }
  toggleNodeRun(nodeId)
}

async function guardedRunToNode(nodeId: string) {
  if (blockNodeRunForActiveTask()) return null
  // 边界输出：只软透传上游缓存，不重跑生成链
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (node && isBoundaryOutputNode(node)) return runNodeOnly(nodeId)
  return runToNode(nodeId)
}

async function guardedRunToNodeSkippingDone(nodeId: string) {
  if (blockNodeRunForActiveTask()) return null
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (node && isBoundaryOutputNode(node)) return runNodeOnly(nodeId)
  return runToNodeSkippingDone(nodeId)
}

async function guardedRunNodeOnly(nodeId: string) {
  if (blockNodeRunForActiveTask()) return null
  return runNodeOnly(nodeId)
}

async function guardedRunHostCook(nodeId: string) {
  if (blockNodeRunForActiveTask()) return null
  return runHostCook(nodeId)
}

const toolbarSelectedNodeId = computed(() => {
  if (workspace.selectedGraphHostId !== graphHostId.value) return null
  return workspace.selectedGraphNodeId
})

const toolbarSelectedNode = computed(() => {
  const id = toolbarSelectedNodeId.value
  if (!id) return null
  return graph.nodes.find((n) => n.id === id) ?? null
})

/** 当前画布是否为剧集流水线（含宫格/动态格选择节点或阶段生成节点） */
const isEpisodePipelineGraph = computed(() =>
  graph.nodes.some(
    (n) =>
      n.typeId === 'episode.anchorSelect' ||
      n.typeId === 'episode.cellSelect' ||
      (n.typeId === 'prompt.optimize' &&
        typeof n.params?.episodeStep === 'string' &&
        !!n.params.episodeStep)
  )
)

const toolbarSelectedIsOutput = computed(() => {
  const node = toolbarSelectedNode.value
  return !!node && isGraphOutputTerminalNode(node)
})

const toolbarCurrentNodeLabel = computed(() => {
  const id = toolbarSelectedNodeId.value
  if (!id) return t('graph.nodeRun.execute')
  const status = nodeStatus(id)
  if (status === 'done' || status === 'error') return t('graph.nodeRun.rerun')
  return t('graph.nodeRun.execute')
})

const toolbarCurrentIsRerun = computed(() => {
  const id = toolbarSelectedNodeId.value
  if (!id) return false
  const status = nodeStatus(id)
  return status === 'done' || status === 'error'
})

function onToolbarRunCurrent(): void {
  const id = toolbarSelectedNodeId.value
  if (!id) return
  void guardedRunNodeOnly(id)
}

function onToolbarRunUpstreamSkip(): void {
  const id = toolbarSelectedNodeId.value
  if (!id) return
  void guardedRunToNodeSkippingDone(id)
}

function onToolbarRunUpstreamForce(): void {
  const id = toolbarSelectedNodeId.value
  if (!id) return
  void guardedRunToNode(id)
}

const episodePipelineOpen = ref(false)
const episodePipelineTitle = computed(
  () => graphAsset.value?.name?.trim() || t('graph.episodePipeline.open')
)

/** 打开剧集流水线独立窗口：画布全局控制，不挂在任何节点上 */
function openEpisodePipeline(): void {
  const assetId = props.assetId?.trim()
  if (!assetId) return
  episodePipelineOpen.value = true
}

function closeEpisodePipeline(): void {
  episodePipelineOpen.value = false
}

// 从宿主节点返回上级（dive 栈回退）时自动关闭剧集流水线窗口
watch(
  () => editorDive?.frames.length ?? 0,
  (length, prev) => {
    if (!episodePipelineOpen.value) return
    if (length < prev) closeEpisodePipeline()
  }
)

function onEnqueueWorkflowClick(event: MouseEvent): void {
  const from =
    (event.currentTarget instanceof HTMLElement ? event.currentTarget : null) ??
    (event.target instanceof HTMLElement ? event.target.closest('button') : null)
  void enqueueWorkflowTask(from)
}

/** Houdini 式执行环菜单：按住 C 打开，移到扇区后松开执行 */
const radialMenu = ref<{ x: number; y: number } | null>(null)
const radialHoveredId = ref<string | null>(null)

const radialMenuItems = computed((): RadialMenuItem[] => {
  if (isRunning.value) {
    return [
      {
        id: 'stop',
        label: t('graph.radial.stop'),
        icon: 'stop' as const
      }
    ]
  }
  if (!toolbarSelectedNode.value) return []
  const items: RadialMenuItem[] = [
    {
      id: 'run-current',
      label: toolbarCurrentIsRerun.value
        ? t('graph.radial.rerunCurrent')
        : t('graph.radial.runCurrent'),
      icon: (toolbarCurrentIsRerun.value ? 'replay' : 'play') as 'replay' | 'play'
    }
  ]
  // 宿主 / 批量子图编排：显式 Cook 子图；「执行当前」默认不入队嵌套子图
  if (
    toolbarSelectedNode.value &&
    (isAssetHostNode(toolbarSelectedNode.value) ||
      isBatchSubgraphCookNode(toolbarSelectedNode.value))
  ) {
    items.push({
      id: 'cook-host',
      label: t('graph.radial.cookSubgraph'),
      icon: 'cook' as const
    })
  }
  items.push(
    {
      id: 'run-skip',
      label: t('graph.radial.runSkip'),
      icon: 'forward' as const
    },
    {
      id: 'run-force',
      label: t('graph.radial.runForce'),
      icon: 'rewind' as const
    }
  )
  if (toolbarSelectedIsOutput.value) {
    items.push({
      id: 'enqueue',
      label: t('graph.radial.enqueue'),
      icon: 'queue' as const
    })
  }
  return items
})

const radialAnchor = computed(() => {
  const node =
    toolbarSelectedNode.value ??
    (isRunning.value && runningTargetNodeId.value
      ? (graph.nodes.find((n) => n.id === runningTargetNodeId.value) ?? null)
      : null)
  if (!node) return null
  const host = viewportEl.value
  if (!host) return null
  const rect = host.getBoundingClientRect()
  const { w, h } = getNodeSize(node)
  const worldX = node.position.x + w / 2
  const worldY = node.position.y + h / 2
  return {
    x: rect.left + graph.viewport.x + worldX * graph.viewport.zoom,
    y: rect.top + graph.viewport.y + worldY * graph.viewport.zoom
  }
})

function canOpenRadialMenu(): boolean {
  if (!pointerOverViewport.value) return false
  if (isRunning.value) return true
  return !!toolbarSelectedNode.value
}

function openRadialMenuAtPointer(): boolean {
  if (!canOpenRadialMenu()) return false
  if (radialMenuItems.value.length === 0) return false
  closeCtxMenu()
  radialHoveredId.value = null
  radialMenu.value = { x: lastPointerClient.x, y: lastPointerClient.y }
  return true
}

function closeRadialMenu(): void {
  radialMenu.value = null
  radialHoveredId.value = null
}

function onRadialPick(id: string): void {
  closeRadialMenu()
  if (id === 'stop') {
    stopWorkflow()
    return
  }
  if (id === 'enqueue') {
    void enqueueWorkflowTask(null)
    return
  }
  if (id === 'run-current') {
    onToolbarRunCurrent()
    return
  }
  if (id === 'cook-host') {
    const nodeId = toolbarSelectedNodeId.value
    if (nodeId) void guardedRunHostCook(nodeId)
    return
  }
  if (id === 'run-skip') {
    onToolbarRunUpstreamSkip()
    return
  }
  if (id === 'run-force') {
    onToolbarRunUpstreamForce()
  }
}

function commitRadialMenu(): void {
  const id = radialHoveredId.value
  if (!radialMenu.value) return
  if (id) {
    onRadialPick(id)
    return
  }
  closeRadialMenu()
}

function isEditableKeyTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    !!el.isContentEditable
  )
}

async function enqueueWorkflowTask(fromEl?: HTMLElement | null): Promise<void> {
  commitAssetGraph()
  const graphDoc = buildGraphJson()
  const target = currentGraphTaskTarget()
  if (!target) {
    void promptAlert({
      title: t('graph.tasks.enqueueFailedTitle'),
      message: t('graph.tasks.enqueueFailedNoTarget')
    })
    return
  }
  // 图内可能有多条互不相干的输出链（如世界元素每项一条），只跑选中汇点的上游
  const selectedOutput = graphDoc.nodes.find(
    (node) => node.id === toolbarSelectedNodeId.value && isGraphOutputTerminalNode(node)
  )
  const outputCount = graphDoc.nodes.filter((node) => isGraphOutputTerminalNode(node)).length
  const baseTitle = graphAsset.value?.name || t('graph.play.confirmAllTitle')
  const branchLabel =
    selectedOutput && outputCount > 1
      ? selectedOutput.title?.trim() || selectedOutput.params.hostBoundaryPort?.portId?.trim() || ''
      : ''
  const title = branchLabel ? `${baseTitle} · ${branchLabel}` : baseTitle
  const result = taskStore.enqueueWorkflow({
    title,
    graph: graphDoc,
    target,
    targetNodeIds: selectedOutput ? [selectedOutput.id] : undefined,
    // 多条输出链并行入队时复用已完成的共同上游，避免重复 cook
    priorNodeStates: graphDoc.runStates,
    skipCompletedNodes: true
  })
  if (!result.ok) {
    void promptAlert({
      title: t('graph.tasks.duplicateTitle'),
      message: t('graph.tasks.duplicateMessage')
    })
    return
  }
  if (fromEl) {
    await playFlyToGraphTasks(fromEl, title)
  }
  taskStore.openDialog(document.querySelector<HTMLElement>('[data-graph-task-anchor]'))
}

const zoomLabelEl = ref<HTMLElement | null>(null)
let lastZoomPercent = -1
let viewportTransformRaf = 0
/** 手势期临时视口；pointermove 只更新它，响应式视口由 rAF 每帧合并写回 */
const liveViewport = { x: 0, y: 0, zoom: 1 }
/** 手势降载 class 直写 DOM，避免 ref 触发整树重渲染 */
let viewportGesturing = false
/** 只挂载视口附近的节点和连线；大范围 overscan 避免平移时频繁增删组件 */
const graphRenderWindow = ref<GraphRect | null>(null)
/**
 * 窗口内可见节点 id 集合：只在平移越过窗口、缩放或节点增删时重算。
 * 渲染列表按此集合过滤，避免逐帧读取每个节点 position，
 * 从而保证拖动单个节点时列表 computed 不失效、被拖节点即时跟手。
 */
const renderedNodeIds = ref<Set<string>>(new Set())
const GRAPH_RENDER_OVERSCAN_MIN = 720
const GRAPH_RENDER_OVERSCAN_RATIO = 0.85
const GRAPH_RENDER_GUARD_RATIO = 0.28

/**
 * 世界层不再使用固定 12000×9000 尺寸：两层皆 0 尺寸、子节点 overflow 可见，
 * 合成层边界只等于可见节点的并集，避免超大 GPU 图层在缩放时整层重栅格化。
 * worldBackEl 承载分组框（在边之下），worldEl 承载节点（在边之上）。
 */
const worldEl = ref<HTMLElement | null>(null)
const worldBackEl = ref<HTMLElement | null>(null)
const edgesCanvasEl = ref<HTMLCanvasElement | null>(null)

function syncLiveViewportFromGraph(): void {
  liveViewport.x = graph.viewport.x
  liveViewport.y = graph.viewport.y
  liveViewport.zoom = graph.viewport.zoom
}

function commitLiveViewportToGraph(): void {
  graph.viewport.x = liveViewport.x
  graph.viewport.y = liveViewport.y
  graph.viewport.zoom = liveViewport.zoom
}

function viewportWorldRect(paddingScreen: number): GraphRect | null {
  const host = viewportEl.value
  if (!host) return null
  return viewportBoxToWorldRect(
    {
      x: -paddingScreen,
      y: -paddingScreen,
      w: host.clientWidth + paddingScreen * 2,
      h: host.clientHeight + paddingScreen * 2
    },
    liveViewport
  )
}

function rectContains(outer: GraphRect, inner: GraphRect): boolean {
  return (
    outer.left <= inner.left &&
    outer.top <= inner.top &&
    outer.right >= inner.right &&
    outer.bottom >= inner.bottom
  )
}

/**
 * 节点/边虚拟化窗口仅在视口接近 overscan 边缘时更新。
 * 普通平移帧只移动合成层，不触发 Vue 节点树 patch。
 */
function refreshGraphRenderWindow(force = false): void {
  const host = viewportEl.value
  if (!host) return
  const overscan = Math.max(
    GRAPH_RENDER_OVERSCAN_MIN,
    Math.max(host.clientWidth, host.clientHeight) * GRAPH_RENDER_OVERSCAN_RATIO
  )
  const current = graphRenderWindow.value
  if (!force && current) {
    const guardRect = viewportWorldRect(overscan * GRAPH_RENDER_GUARD_RATIO)
    if (guardRect && rectContains(current, guardRect)) return
  }
  graphRenderWindow.value = viewportWorldRect(overscan)
  updateRenderedNodeIds()
}

/**
 * 重算窗口内节点 id 集合。仅在窗口变化/节点增删时调用，不在拖动帧里执行，
 * 因此渲染列表 computed 不会因单个节点位移而失效。
 */
function updateRenderedNodeIds(): void {
  const window = graphRenderWindow.value
  if (!window) {
    if (renderedNodeIds.value.size > 0) renderedNodeIds.value = new Set()
    return
  }
  const next = new Set<string>()
  for (const node of graph.nodes) {
    if (rectsIntersect(getNodeWorldBounds(node), window)) next.add(node.id)
  }
  const prev = renderedNodeIds.value
  if (prev.size === next.size) {
    let same = true
    for (const id of next) {
      if (!prev.has(id)) {
        same = false
        break
      }
    }
    if (same) return
  }
  renderedNodeIds.value = next
}

function syncWorldTransform(): void {
  const { x, y, zoom } = liveViewport
  // translate3d 促合成层；与网格同帧直写，避免 Vue 重渲染。两层共用同一变换。
  const transform = `translate3d(${x}px, ${y}px, 0) scale(${zoom})`
  if (worldEl.value) worldEl.value.style.transform = transform
  if (worldBackEl.value) worldBackEl.value.style.transform = transform
}

function syncGridLayer(): void {
  const minor = gridMinorEl.value
  const major = gridMajorEl.value
  if (!minor || !major) return
  applyGraphGridStyle({ minor, major }, liveViewport)
}

function syncZoomLabel(): void {
  const next = Math.round(liveViewport.zoom * 100)
  if (lastZoomPercent === next) return
  lastZoomPercent = next
  if (zoomLabelEl.value) zoomLabelEl.value.textContent = `${next}%`
}

function flushViewportTransform(): void {
  viewportTransformRaf = 0
  syncWorldTransform()
  syncGridLayer()
  refreshGraphRenderWindow()
  // 每帧写回一次即可：命中测试/坐标换算保持新鲜，又不会被 pointermove 打满
  commitLiveViewportToGraph()
  syncZoomLabel()
  syncEdgesForViewport()
}

/**
 * 视口变化时的边同步：平移与缩放都优先用 Canvas 的 CSS transform（translate+scale）近似，
 * 每帧 O(1)、彻底跟手；仅当变换后 Canvas 不再覆盖视口（会露白）或缩放比超出清晰度阈值时，
 * 才做一次真正重绘并把基准视口归位。手势结束（idle）会再补一帧清晰重绘。
 */
function syncEdgesForViewport(): void {
  const s = liveViewport.zoom / edgeRenderViewport.zoom
  const tx =
    liveViewport.x + EDGE_CANVAS_OVERSCAN - s * (edgeRenderViewport.x + EDGE_CANVAS_OVERSCAN)
  const ty =
    liveViewport.y + EDGE_CANVAS_OVERSCAN - s * (edgeRenderViewport.y + EDGE_CANVAS_OVERSCAN)
  // 变换后 Canvas 在视口坐标下的可视矩形（transform-origin 0 0，元素左上位于视口 -OVERSCAN）
  const host = viewportEl.value
  const vw = host ? host.clientWidth : 0
  const vh = host ? host.clientHeight : 0
  const left = -EDGE_CANVAS_OVERSCAN + tx
  const top = -EDGE_CANVAS_OVERSCAN + ty
  const right = left + s * edgeCanvasCssW
  const bottom = top + s * edgeCanvasCssH
  const coversViewport = left <= 0 && top <= 0 && right >= vw && bottom >= vh
  const zoomInBudget = s >= EDGE_ZOOM_REDRAW_MIN && s <= EDGE_ZOOM_REDRAW_MAX
  if (!coversViewport || !zoomInBudget) {
    renderEdgesNow()
    return
  }
  applyEdgeCanvasTransform(tx, ty, s)
}

/* ── 边 Canvas 渲染引擎 ─────────────────────────────────────────────
 * 边不再是 SVG DOM，而是画在一张覆盖视口的 Canvas 上（屏幕坐标）。
 * 触发重绘的来源：视口变换（flushViewportTransform 内直调）、节点拖动/缩放、
 * 连线、选择变化、边增删（一次性 requestEdgeRender）、流动动画（持续循环）。
 */
let edgeRenderRaf = 0
let edgeFlowRaf = 0
let edgeHoverRaf = 0
let edgeCanvasCssW = 0
let edgeCanvasCssH = 0
let edgeHoverActive = false
let cachedEdgeColors: EdgeColors | null = null
/** Canvas 向四周扩出的 overscan（CSS px），使平移用 transform 位移时不易露白 */
const EDGE_CANVAS_OVERSCAN = 600
/** 缩放近似阈值：位图缩放比在此区间内用 transform 近似，超出则重绘归位（兼顾清晰度） */
const EDGE_ZOOM_REDRAW_MIN = 0.7
const EDGE_ZOOM_REDRAW_MAX = 1.25
/** 当前 Canvas 位图内容对应的视口；平移/缩放用 transform，与此基准求差。
 *  zoom 初始设为 -1（不可能值），保证首帧必然走一次真正重绘。 */
const edgeRenderViewport = { x: 0, y: 0, zoom: -1 }

function resolveEdgeColors(): EdgeColors {
  if (cachedEdgeColors) return cachedEdgeColors
  const root = rootEl.value
  const fallback: EdgeColors = {
    edge: '#5a8fd4',
    selected: '#3d8bfd',
    temp: '#f0a020'
  }
  if (!root) return fallback
  const style = getComputedStyle(root)
  const accent = style.getPropertyValue('--accent').trim()
  const warning = style.getPropertyValue('--warning').trim()
  cachedEdgeColors = {
    edge: '#5a8fd4',
    selected: accent || fallback.selected,
    temp: warning || fallback.temp
  }
  return cachedEdgeColors
}

/** 按（视口 + overscan）CSS 尺寸与 dpr 调整 Canvas 位图分辨率与定位 */
function resizeEdgeCanvas(): void {
  const canvas = edgesCanvasEl.value
  const host = viewportEl.value
  if (!canvas || !host) return
  const cssW = host.clientWidth + EDGE_CANVAS_OVERSCAN * 2
  const cssH = host.clientHeight + EDGE_CANVAS_OVERSCAN * 2
  const dpr = Math.max(1, window.devicePixelRatio || 1)
  edgeCanvasCssW = cssW
  edgeCanvasCssH = cssH
  const pxW = Math.round(cssW * dpr)
  const pxH = Math.round(cssH * dpr)
  if (canvas.width !== pxW || canvas.height !== pxH) {
    canvas.width = pxW
    canvas.height = pxH
  }
  canvas.style.width = `${cssW}px`
  canvas.style.height = `${cssH}px`
  canvas.style.left = `${-EDGE_CANVAS_OVERSCAN}px`
  canvas.style.top = `${-EDGE_CANVAS_OVERSCAN}px`
  // 以左上角为变换基准，方便平移/缩放近似的坐标推导
  canvas.style.transformOrigin = '0 0'
}

/** 平移/缩放近似：整体位移+缩放 Canvas 位图，避免逐帧重绘 */
function applyEdgeCanvasTransform(tx: number, ty: number, s: number): void {
  const canvas = edgesCanvasEl.value
  if (!canvas) return
  canvas.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${s})`
}

/** 收集当前应绘制的边（含少量离屏 overscan，与节点虚拟化一致） */
function collectEdgeGeometry(): EdgeScreenGeometry[] {
  const window = graphRenderWindow.value
  const vis = renderedNodeIds.value
  const nodeById = new Map<string, GraphNode>()
  for (const node of graph.nodes) nodeById.set(node.id, node)
  const geoms: EdgeScreenGeometry[] = []
  for (const edge of graph.edges) {
    if (window && vis.size > 0 && !vis.has(edge.source) && !vis.has(edge.target)) continue
    const source = nodeById.get(edge.source)
    const target = nodeById.get(edge.target)
    if (!source || !target) continue
    geoms.push(
      computeEdgeScreenGeometry(edge, source, target, liveViewport, edgePathStyle.value)
    )
  }
  return geoms
}

let lastEdgeGeometry: EdgeScreenGeometry[] = []

function renderEdgesNow(): void {
  const canvas = edgesCanvasEl.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  if (edgeCanvasCssW === 0 || edgeCanvasCssH === 0) resizeEdgeCanvas()

  const geoms = collectEdgeGeometry()
  lastEdgeGeometry = geoms
  const dpr = Math.max(1, window.devicePixelRatio || 1)

  const tempScreens = resolveTempEdgeWorlds().map((tempWorld) =>
    computeTempEdgeScreen(tempWorld.from, tempWorld.to, liveViewport, edgePathStyle.value)
  )

  const flowIds =
    !viewportGesturing && hasSelectionFlow.value ? selectedNodeIds.value : new Set<string>()

  drawGraphEdges(ctx, geoms, tempScreens.length > 0 ? tempScreens : null, {
    dpr,
    width: edgeCanvasCssW,
    height: edgeCanvasCssH,
    offsetX: EDGE_CANVAS_OVERSCAN,
    offsetY: EDGE_CANVAS_OVERSCAN,
    zoom: liveViewport.zoom,
    selectedEdgeIds: selectedEdgeIds.value,
    flowEdgeIds: flowIds,
    flowTimeMs: performance.now(),
    reduceEffects: viewportGesturing,
    colors: resolveEdgeColors(),
    pathStyle: edgePathStyle.value
  })

  // 记录基准视口并把平移 transform 归零：位图已按当前视口绘制
  edgeRenderViewport.x = liveViewport.x
  edgeRenderViewport.y = liveViewport.y
  edgeRenderViewport.zoom = liveViewport.zoom
  const identity = 'translate3d(0px, 0px, 0px) scale(1)'
  if (canvas.style.transform !== identity) {
    canvas.style.transform = identity
  }
}

/** 一次性重绘（rAF 合帧），用于离散变化：选择/边增删/程序化移动 */
function requestEdgeRender(): void {
  if (edgeRenderRaf) return
  edgeRenderRaf = requestAnimationFrame(() => {
    edgeRenderRaf = 0
    renderEdgesNow()
  })
}

function edgeFlowActive(): boolean {
  return !viewportGesturing && hasSelectionFlow.value
}

function edgeFlowTick(): void {
  if (!edgeFlowActive()) {
    edgeFlowRaf = 0
    // 收尾再画一帧，清掉最后的流动残影
    renderEdgesNow()
    return
  }
  renderEdgesNow()
  edgeFlowRaf = requestAnimationFrame(edgeFlowTick)
}

/** 依据选中节点是否存在相连边（出边 / 入边），启停流动动画循环 */
function syncEdgeFlowLoop(): void {
  if (edgeFlowActive()) {
    if (!edgeFlowRaf) edgeFlowRaf = requestAnimationFrame(edgeFlowTick)
  } else if (edgeFlowRaf) {
    cancelAnimationFrame(edgeFlowRaf)
    edgeFlowRaf = 0
    renderEdgesNow()
  } else {
    requestEdgeRender()
  }
}

/** 合并到每帧一次；fitView / 快照恢复等需要即时落屏时传 immediate */
function applyViewportTransform(immediate = false): void {
  if (immediate) {
    if (viewportTransformRaf) {
      cancelAnimationFrame(viewportTransformRaf)
      viewportTransformRaf = 0
    }
    flushViewportTransform()
    return
  }
  if (viewportTransformRaf) return
  viewportTransformRaf = requestAnimationFrame(flushViewportTransform)
}

function beginViewportGesture(): void {
  // 新手势接管视口时取消上一段滚轮的 idle，避免平移中途恢复边动画
  if (viewportGestureIdleTimer) {
    clearTimeout(viewportGestureIdleTimer)
    viewportGestureIdleTimer = null
  }
  if (viewportGesturing) return
  viewportGesturing = true
  rootEl.value?.classList.add('viewport-gesturing')
  // 手势期停掉流动循环，降低合成压力
  if (edgeFlowRaf) {
    cancelAnimationFrame(edgeFlowRaf)
    edgeFlowRaf = 0
  }
}

function endViewportGestureVisual(): void {
  if (!viewportGesturing) return
  viewportGesturing = false
  rootEl.value?.classList.remove('viewport-gesturing')
  // 手势结束：把 transform 近似的位图落回真正重绘（清晰、基准归位）
  renderEdgesNow()
  // 恢复流动动画/完整效果
  syncEdgeFlowLoop()
}

watch(
  () => [workspace.selectedGraphNodeId, workspace.selectedGraphHostId] as const,
  ([id, hostId]) => {
    const nextId = hostId === graphHostId.value ? id : null
    // null = 多选/清空，本地 selectedNodeIds 由框选或拖动起始自行维护
    if (!nextId) return
    selectedGroupId.value = null
    // 已是该节点的单选则跳过；多选时不应再被 workspace 单 id 压扁（交互层会传 null）
    if (selectedNodeIds.value.size === 1 && selectedNodeIds.value.has(nextId)) return
    selectedNodeIds.value = new Set([nextId])
    selectedEdgeIds.value = new Set()
  }
)

watch(
  () => [workspace.selectedGraphGroupId, workspace.selectedGraphHostId] as const,
  ([groupId, hostId]) => {
    if (hostId !== graphHostId.value || !groupId) return
    const memberIds = graph.nodes
      .filter((node) => node.groupId === groupId)
      .map((node) => node.id)
    if (memberIds.length === 0) return
    selectedGroupId.value = groupId
    selectedNodeIds.value = new Set(memberIds)
    selectedEdgeIds.value = new Set()
  }
)

function isNodeSelected(nodeId: string): boolean {
  return selectedNodeIds.value.has(nodeId)
}

function ensureGraphGroups(): void {
  if (!graph.groups) graph.groups = []
}

function pruneGraphGroups(): void {
  ensureGraphGroups()
  graph.groups = sanitizeGraphGroups(graph)
}

const selectedGroupableNodeIds = computed(() =>
  graph.nodes
    .filter((node) => selectedNodeIds.value.has(node.id) && isNodeGroupable(node))
    .map((node) => node.id)
)

const snapToGridEnabled = ref(false)

const GRID_VISIBLE_KEY = 'aiartengine.graph.gridVisible'
const gridVisible = ref(localStorage.getItem(GRID_VISIBLE_KEY) !== '0')
watch(gridVisible, (visible) => {
  try {
    localStorage.setItem(GRID_VISIBLE_KEY, visible ? '1' : '0')
  } catch {
    /* ignore */
  }
})

const MINIMAP_VISIBLE_KEY = 'aiartengine.graph.minimapVisible'
const minimapVisible = ref(localStorage.getItem(MINIMAP_VISIBLE_KEY) !== '0')
watch(minimapVisible, (visible) => {
  try {
    localStorage.setItem(MINIMAP_VISIBLE_KEY, visible ? '1' : '0')
  } catch {
    /* ignore */
  }
})

const EDGE_PATH_STYLE_KEY = 'aiartengine.graph.edgePathStyle'
const edgePathStyle = ref<GraphEdgePathStyle>(
  parseGraphEdgePathStyle(localStorage.getItem(EDGE_PATH_STYLE_KEY))
)
watch(edgePathStyle, (style) => {
  try {
    localStorage.setItem(EDGE_PATH_STYLE_KEY, style)
  } catch {
    /* ignore */
  }
  requestEdgeRender()
})

function cycleEdgePathStyle(): void {
  edgePathStyle.value = nextGraphEdgePathStyle(edgePathStyle.value)
}

const selectedLayoutNodes = computed(() =>
  graph.nodes.filter((node) => selectedNodeIds.value.has(node.id))
)

const canGroupSelection = computed(() => selectedGroupableNodeIds.value.length >= 1)

const canUngroupSelection = computed(() =>
  graph.nodes.some((node) => selectedNodeIds.value.has(node.id) && !!node.groupId)
)

const groupFrames = computed(() => {
  void groupLayoutRevision.value
  ensureGraphGroups()
  for (const node of graph.nodes) {
    if (!node.groupId) continue
    void node.position.x
    void node.position.y
    void node.size?.w
    void node.size?.h
    void node.params.previewCollapsed
  }
  return (graph.groups ?? [])
    .map((group) => {
      const bounds = getGroupBounds(graph.nodes, group.id)
      if (!bounds) return null
      const memberIds = graph.nodes.filter((node) => node.groupId === group.id).map((node) => node.id)
      const selected =
        selectedGroupId.value === group.id ||
        memberIds.some((id) => selectedNodeIds.value.has(id))
      return {
        id: group.id,
        title: group.title?.trim() || t('graph.group.defaultName'),
        selected,
        ...bounds
      }
    })
    .filter((frame): frame is NonNullable<typeof frame> => !!frame)
})

const renderedGroupFrames = computed(() => {
  const window = graphRenderWindow.value
  if (!window) return groupFrames.value
  return groupFrames.value.filter(
    (frame) =>
      frame.selected ||
      rectsIntersect(
        {
          left: frame.x,
          top: frame.y,
          right: frame.x + frame.w,
          bottom: frame.y + frame.h
        },
        window
      )
  )
})

function groupSelectedNodes(): void {
  if (!canGroupSelection.value) return
  const before = buildGraphJson()
  ensureGraphGroups()
  const groupId = createGraphGroupId()
  const title = nextGraphGroupTitle(graph.groups ?? [], t('graph.group.defaultName'))
  graph.groups!.push({ id: groupId, title })
  const selected = new Set(selectedGroupableNodeIds.value)
  for (const node of graph.nodes) {
    if (!selected.has(node.id)) continue
    node.groupId = groupId
  }
  pruneGraphGroups()
  scheduleSave()
  recordGraphChange('group-nodes', before)
}

function ungroupSelectedNodes(): void {
  if (!canUngroupSelection.value) return
  const before = buildGraphJson()
  for (const node of graph.nodes) {
    if (!selectedNodeIds.value.has(node.id) || !node.groupId) continue
    delete node.groupId
  }
  pruneGraphGroups()
  scheduleSave()
  recordGraphChange('ungroup-nodes', before)
}

const canEncapsulateSelection = computed(
  () => selectedNodeIds.value.size >= 1 && !isElementWorkflowGraph.value
)

/** 复制后递增，驱动粘贴按钮可用性 */
const graphClipboardEpoch = ref(0)
const canCopySelection = computed(() =>
  graph.nodes.some((node) => selectedNodeIds.value.has(node.id) && isNodeDeletable(node))
)
const canPasteClipboard = computed(() => {
  void graphClipboardEpoch.value
  return !!getMemoryGraphClipboard()
})

const encapsulateSaveOpen = ref(false)
const encapsulateSaveDefaultName = ref('')
const encapsulateSaveDefaultFolderId = ref<string | null>(null)
const encapsulateSaveDialogRef = ref<{
  setSaving: (value: boolean) => void
  setError: (message: string) => void
} | null>(null)
const encapsulatePendingNodeIds = ref<string[] | null>(null)
const encapsulateSaving = ref(false)

function closeEncapsulateSaveDialog(): void {
  if (encapsulateSaving.value) return
  encapsulateSaveOpen.value = false
  encapsulatePendingNodeIds.value = null
}

function encapsulateSelectedAsHost(): void {
  if (!canEncapsulateSelection.value || encapsulateSaving.value) return
  const ids = [...selectedNodeIds.value]
  encapsulatePendingNodeIds.value = ids
  encapsulateSaveDefaultName.value = `${t('graph.hostInterface.defaultName')} ${ids.length}`
  encapsulateSaveDefaultFolderId.value = graphAsset.value?.folderId ?? null
  encapsulateSaveOpen.value = true
}

async function onEncapsulateSaveConfirm(payload: {
  name: string
  folderId: string | null
}): Promise<void> {
  const ids = encapsulatePendingNodeIds.value
  if (!ids?.length || encapsulateSaving.value) return
  const before = buildGraphJson()
  let createdAssetId = ''
  encapsulateSaving.value = true
  encapsulateSaveDialogRef.value?.setSaving(true)
  try {
    const created = await window.studio.createAsset({
      type: 'subgraph',
      name: payload.name,
      folderId: payload.folderId,
      genParams: {
        schemaVersion: HOST_INTERFACE_SCHEMA_VERSION
      }
    })
    createdAssetId = created.id
    const result = encapsulateSelection(before, {
      selectedNodeIds: ids,
      hostAssetId: created.id,
      hostAssetName: created.name
    })
    // 迁移被封装 world.gen 节点的世界元素状态（四类子图 + 指纹），
    // 避免封装后已生成数据丢失、图片输出为空
    const migratedWorldState = pickWorldElementStateForMigration(
      graphAsset.value?.genParams as Record<string, unknown> | undefined,
      before.nodes
        .filter((node) => ids.includes(node.id) && node.typeId === 'world.gen')
        .map((node) => node.id)
    )
    // IPC 不能传 Vue Proxy；toPlain 剥离响应式后再写回定义资产
    await window.studio.updateAsset(
      toPlain({
        ...created,
        genParams: {
          ...(created.genParams ?? {}),
          ...migratedWorldState,
          graphJson: result.innerDocument,
          hostInterface: result.hostInterface,
          schemaVersion: HOST_INTERFACE_SCHEMA_VERSION
        }
      })
    )
    await project.refreshAssets()
    replaceGraphDocument(graph, toPlain(result.parentDocument))
    setSingleNodeSelection(result.hostNodeId)
    workspace.selectGraphNode(result.hostNodeId, graphHostId.value)
    scheduleSave()
    recordGraphChange('encapsulate-host', before)
    requestEdgeRender()
    graphEditorHosts.bumpRevision()
    encapsulateSaveOpen.value = false
    encapsulatePendingNodeIds.value = null
  } catch (err) {
    if (createdAssetId) {
      try {
        await window.studio.deleteAsset(createdAssetId)
        await project.refreshAssets()
      } catch (cleanupError) {
        console.error('[NodeGraphEditor] cleanup failed host asset', cleanupError)
      }
    }
    console.error('[NodeGraphEditor] encapsulate failed', err)
    encapsulateSaveDialogRef.value?.setError(
      err instanceof Error ? err.message : t('graph.hostInterface.encapsulateFailed')
    )
  } finally {
    encapsulateSaving.value = false
  }
}

const editingGroupId = ref<string | null>(null)
const groupTitleDraft = ref('')
const groupTitleInputEl = ref<HTMLInputElement | null>(null)

function startGroupTitleEdit(groupId: string, title: string): void {
  editingGroupId.value = groupId
  groupTitleDraft.value = title
  void nextTick(() => {
    groupTitleInputEl.value?.focus()
    groupTitleInputEl.value?.select()
  })
}

function commitGroupTitleEdit(): void {
  const groupId = editingGroupId.value
  if (!groupId) return
  editingGroupId.value = null
  ensureGraphGroups()
  const group = graph.groups!.find((item) => item.id === groupId)
  if (!group) return
  const next = groupTitleDraft.value.trim() || t('graph.group.defaultName')
  if (group.title === next) return
  const before = buildGraphJson()
  group.title = next
  scheduleSave()
  recordGraphChange('rename-group', before)
}

function cancelGroupTitleEdit(): void {
  editingGroupId.value = null
}

function bumpGroupLayout(nodeIds?: string[]): void {
  if (nodeIds) {
    const affectsGroup = nodeIds.some((nodeId) => {
      const node = graph.nodes.find((item) => item.id === nodeId)
      return !!node?.groupId
    })
    if (!affectsGroup) return
  }
  groupLayoutRevision.value += 1
}

function detachDraggedNodesFromGroup(nodeIds: string[]): void {
  let changed = false
  for (const nodeId of nodeIds) {
    const node = graph.nodes.find((item) => item.id === nodeId)
    if (!node?.groupId) continue
    delete node.groupId
    changed = true
  }
  if (changed) pruneGraphGroups()
  groupLayoutRevision.value += 1
}

function syncMovedNodesGroupMembership(context: {
  nodeIds: string[]
  nodeStarts: Map<string, { x: number; y: number }>
}): void {
  let changed = false

  for (const nodeId of context.nodeIds) {
    const node = graph.nodes.find((item) => item.id === nodeId)
    if (!node || node.groupId) continue
    if (resolveNodeGroupAfterMove(graph, nodeId)) changed = true
  }
  if (changed) pruneGraphGroups()
}

const renderedGraphEdges = computed(() => {
  const window = graphRenderWindow.value
  if (!window) return graph.edges
  // 端点落在可见集合或选中集内即渲染；不读 position，避免拖动节点时全量重算过滤。
  // 边随节点移动的逐帧跟手由 Canvas 重绘（renderEdgesNow）承担。
  const vis = renderedNodeIds.value
  const selected = selectedNodeIds.value
  return graph.edges.filter(
    (edge) =>
      vis.has(edge.source) ||
      vis.has(edge.target) ||
      selected.has(edge.source) ||
      selected.has(edge.target)
  )
})

// 节点增删时重算可见集合（新建/粘贴/删除后立即出现或移除）。
// 拖动只改 position，不改数量，因此不会触发这里，保持跟手。
watch(
  () => graph.nodes.length,
  () => refreshGraphRenderWindow(true)
)

/** 选中节点是否存在相连边（出边或入边），用于决定 Canvas 流动动画是否需要持续绘制 */
const hasSelectionFlow = computed(() => {
  if (selectedNodeIds.value.size === 0) return false
  const selected = selectedNodeIds.value
  return renderedGraphEdges.value.some(
    (edge) => selected.has(edge.source) || selected.has(edge.target)
  )
})

// 待绘制边集合变化（边增删 / 窗口 / 可见节点集变化）→ 一次性重绘
watch(renderedGraphEdges, () => requestEdgeRender())
// 边端点/连线数据深层变化（改端口等）→ 一次性重绘；edges 数组轻量，深监听开销可忽略
watch(() => graph.edges, () => requestEdgeRender(), { deep: true })
// 选中边高亮变化 → 重绘
watch(selectedEdgeIds, () => requestEdgeRender())
// 收起/展开预览会改有效节点高度（getNodeSize），需重算连线与分组框
watch(
  () => graph.nodes.map((node) => String(node.params.previewCollapsed)).join('|'),
  () => {
    groupLayoutRevision.value += 1
    requestEdgeRender()
  }
)
// 选中节点变化影响流动高亮 → 启停流动循环
watch([selectedNodeIds, hasSelectionFlow], () => syncEdgeFlowLoop())

function clearSelection(): void {
  selectedNodeIds.value = new Set()
  selectedEdgeIds.value = new Set()
  selectedGroupId.value = null
  // 所有图（含普通资产 image/video/audio）空白处统一工程全局参数
  workspace.focusProjectGlobals()
}

function setGroupSelection(groupId: string): void {
  const memberIds = graph.nodes
    .filter((node) => node.groupId === groupId)
    .map((node) => node.id)
  if (memberIds.length === 0) return
  selectedGroupId.value = groupId
  selectedNodeIds.value = new Set(memberIds)
  selectedEdgeIds.value = new Set()
  workspace.selectGraphGroup(groupId, graphHostId.value)
}

function setSingleNodeSelection(nodeId: string): void {
  selectedGroupId.value = null
  selectedNodeIds.value = new Set([nodeId])
  selectedEdgeIds.value = new Set()
  workspace.selectGraphNode(nodeId, graphHostId.value)
}

function setSingleEdgeSelection(edgeId: string): void {
  selectedEdgeIds.value = new Set([edgeId])
  selectedNodeIds.value = new Set()
  selectedGroupId.value = null
  workspace.selectGraphNode(null, graphHostId.value)
}

function isLinkHighlightNode(nodeId: string): boolean {
  if (linkingFrom.value === nodeId || linkingTo.value === nodeId) return true
  if (snapHighlightNodeIds.value.has(nodeId)) return true
  const session = rewireSession.value
  return !!session?.fixed.some((fixed) => fixed.nodeId === nodeId)
}

const isPortLinkMode = computed(
  () =>
    !!(linkingFrom.value || linkingTo.value || rewireSession.value) ||
    snapHighlightNodeIds.value.size > 0
)

function clearSnapDragPreview(): void {
  if (
    snapHighlightPortKeys.value.size === 0 &&
    snapReadyPortKeys.value.size === 0 &&
    snapHighlightNodeIds.value.size === 0 &&
    snapPreviewCandidates.value.length === 0
  ) {
    return
  }
  snapHighlightPortKeys.value = new Set()
  snapReadyPortKeys.value = new Set()
  snapHighlightNodeIds.value = new Set()
  snapPreviewCandidates.value = []
}

function updateSnapDragPreview(draggedNodeIds: string[]): void {
  const preview = resolveSnapDragPreview({
    nodes: graph.nodes,
    edges: graph.edges,
    draggedNodeIds,
    thresholdWorld: snapConnectThresholdWorld(graph.viewport.zoom)
  })
  snapHighlightPortKeys.value = preview.highlightPortKeys
  snapHighlightNodeIds.value = preview.highlightNodeIds
  snapPreviewCandidates.value = preview.connectCandidates
  const ready = new Set<string>()
  for (const c of preview.connectCandidates) {
    ready.add(snapPortKey(c.sourceId, c.sourcePort))
    ready.add(snapPortKey(c.targetId, c.targetPort))
  }
  snapReadyPortKeys.value = ready
}

const emptySnapPortIds = new Set<string>()

function snapHighlightPortIdsFor(nodeId: string): Set<string> {
  const keys = snapHighlightPortKeys.value
  if (keys.size === 0) return emptySnapPortIds
  const ids = new Set<string>()
  const prefix = `${nodeId}::`
  for (const key of keys) {
    if (key.startsWith(prefix)) ids.add(key.slice(prefix.length))
  }
  return ids
}

function snapReadyPortIdsFor(nodeId: string): Set<string> {
  const keys = snapReadyPortKeys.value
  if (keys.size === 0) return emptySnapPortIds
  const ids = new Set<string>()
  const prefix = `${nodeId}::`
  for (const key of keys) {
    if (key.startsWith(prefix)) ids.add(key.slice(prefix.length))
  }
  return ids
}

function setMarqueeSelection(nodeIds: string[], edgeIds: string[]): void {
  selectedNodeIds.value = new Set(nodeIds)
  selectedEdgeIds.value = new Set(edgeIds)
  selectedGroupId.value = null
  if (nodeIds.length === 1 && edgeIds.length === 0) {
    workspace.selectGraphNode(nodeIds[0], graphHostId.value)
  } else {
    workspace.selectGraphNode(null, graphHostId.value)
  }
}

/** Ctrl+A 全选画布所有节点 */
function selectAllNodes(): void {
  const nodeIds = graph.nodes.map((node) => node.id)
  setMarqueeSelection(nodeIds, [])
  refreshGraphRenderWindow(true)
  requestEdgeRender()
}

const renderedGraphCards = computed(() =>
  graph.nodes
    .filter((node) => {
      const window = graphRenderWindow.value
      if (!window) return true
      // 只按预算好的可见集合 + 交互态判断，绝不读取 position，
      // 否则拖动任一节点都会让整份列表 computed 失效并全量重排。
      // 选中节点始终挂载，避免「端口拉线创建后」因可见集未刷新而整卡不显示。
      return (
        renderedNodeIds.value.has(node.id) ||
        selectedNodeIds.value.has(node.id) ||
        isLinkHighlightNode(node.id)
      )
    })
    .map((node) => {
      const card = resolveGraphCard(node)
      return card ? { node, card } : null
    })
    .filter((item): item is { node: GraphNode; card: NonNullable<ReturnType<typeof resolveGraphCard>> } => item != null)
)

type AddableMenuItem = {
  typeId: GraphNodeTypeId
  label: string
  icon: string
  portTypeLabel: string
  /** 菜单预设：创建时覆盖节点标题 / 参数（剧集 Agent 等） */
  title?: string
  params?: Partial<GraphNodeParams>
}

type ResourceMenuGroupId = Extract<
  AssetType,
  | 'image'
  | 'video'
  | 'voice'
  | 'screenplay'
  | 'motion'
  | 'world'
  | 'beat'
> | 'episode'
  | 'imageRefine'
  | 'imageEdit'
  | 'text'
  | 'prompt'
  | 'game'
  | 'motionFx'

/** 右键菜单按资源类型分组；组内顺序即展示顺序 */
const CONTEXT_MENU_RESOURCE_GROUPS: Array<{
  id: ResourceMenuGroupId
  typeIds: readonly string[]
}> = [
  {
    id: 'image',
    typeIds: ['asset.image', 'image.select']
  },
  {
    id: 'imageRefine',
    typeIds: [
      'image.multiAngle',
      'image.lighting',
      'image.emotion',
      'image.portraitTexture'
    ]
  },
  {
    id: 'imageEdit',
    typeIds: [
      'image.upscale',
      'image.expand',
      'image.redraw',
      'image.erase',
      'image.matte',
      'image.crop',
      'image.gridSplit'
    ]
  },
  {
    id: 'video',
    typeIds: ['asset.video', 'video.lipSync', 'video.select', 'video.framePull', 'video.reshoot']
  },
  {
    id: 'voice',
    typeIds: ['asset.voice', 'voice.select']
  },
  {
    id: 'screenplay',
    typeIds: ['asset.screenplay']
  },
  {
    id: 'text',
    typeIds: ['play.script', 'text.select']
  },
  {
    id: 'prompt',
    typeIds: ['prompt.optimize', 'image.toPrompt']
  },
  {
    id: 'game',
    typeIds: ['asset.gameSystem', 'ui.split', 'ui.gen']
  },
  {
    id: 'motionFx',
    typeIds: ['frame.animGen', 'anim.2d']
  },
  {
    id: 'beat',
    typeIds: [
      'asset.beat',
      'beat.select',
      'beat.split',
      'beat.table',
      'beat.gen',
      'beat.unitGen',
      'beat.unitRef'
    ]
  },
  {
    id: 'world',
    typeIds: ['asset.world', 'world.extract', 'world.table', 'world.gen']
  },
  {
    id: 'motion',
    typeIds: ['asset.motion']
  },
  {
    id: 'episode',
    typeIds: ['episode.anchorSelect', 'episode.cellSelect']
  }
]

/** 剧集 Agent 流水线手动创建预设：右键「剧集」分组直接生成配置好的 prompt.optimize */
const EPISODE_AGENT_PRESET_ITEMS: AddableMenuItem[] = [
  {
    typeId: 'prompt.optimize',
    label: t('graph.episodeAgent.breakdown'),
    icon: '✨',
    portTypeLabel: '',
    title: '分镜师·节拍拆解表',
    params: {
      episodeStep: 'breakdown',
      episodeScopeKey: 'ep01',
      generateSystemPrompt: EPISODE_AGENT_BREAKDOWN.systemPromptZh,
      generateInstruction: EPISODE_AGENT_BREAKDOWN.instructionZh
    }
  },
  {
    typeId: 'prompt.optimize',
    label: t('graph.episodeAgent.beatboard'),
    icon: '✨',
    portTypeLabel: '',
    title: '分镜师·9宫格分镜表',
    params: {
      episodeStep: 'beatboard',
      episodeScopeKey: 'ep01',
      generateSystemPrompt: EPISODE_AGENT_BEATBOARD.systemPromptZh,
      generateInstruction: EPISODE_AGENT_BEATBOARD.instructionZh
    }
  },
  {
    typeId: 'prompt.optimize',
    label: t('graph.episodeAgent.sequence'),
    icon: '✨',
    portTypeLabel: '',
    title: '分镜师·4宫格动态分镜表',
    params: {
      episodeStep: 'sequence',
      episodeScopeKey: 'ep01',
      generateSystemPrompt: EPISODE_AGENT_SEQUENCE.systemPromptZh,
      generateInstruction: EPISODE_AGENT_SEQUENCE.instructionZh
    }
  },
  {
    typeId: 'prompt.optimize',
    label: t('graph.episodeAgent.motion'),
    icon: '✨',
    portTypeLabel: '',
    title: '动画师·动态提示词表',
    params: {
      episodeStep: 'motion',
      episodeScopeKey: 'ep01',
      generateSystemPrompt: EPISODE_AGENT_MOTION.systemPromptZh,
      generateInstruction: EPISODE_AGENT_MOTION.instructionZh
    }
  },
  {
    typeId: 'prompt.optimize',
    label: t('graph.episodeAgent.review'),
    icon: '✨',
    portTypeLabel: '',
    title: '导演审核',
    params: {
      episodeScopeKey: 'ep01',
      generateSystemPrompt: EPISODE_AGENT_DIRECTOR.systemPromptZh,
      generateInstruction: EPISODE_AGENT_DIRECTOR.instructionZh
    }
  }
]

const CONTEXT_MENU_GROUPED_TYPE_IDS = new Set(
  CONTEXT_MENU_RESOURCE_GROUPS.flatMap((group) => [...group.typeIds])
)

function isOutputContextMenuType(typeId: string): boolean {
  return typeId.startsWith('output.')
}

const addableMenuItems = computed((): AddableMenuItem[] => {
  void nodeTypeRevision.value
  void locale.value
  const linkFromId = ctxMenu.value?.linkFromNodeId
  const linkToId = ctxMenu.value?.linkToNodeId
  const source = linkFromId ? graph.nodes.find((n) => n.id === linkFromId) : undefined
  const target = linkToId ? graph.nodes.find((n) => n.id === linkToId) : undefined
  const connectDataType = resolveConnectMenuDataType()
  return menuAddableNodeTypes()
    .filter((def) => {
      const typeParams = createParamsForScope(graphScope.value, def.typeId as GraphNodeTypeId)
      if (source && connectDataType) {
        return canConnectToNodeType(source, def, {
          sourcePort: ctxMenu.value?.linkFromPortId ?? undefined,
          dataType: connectDataType,
          typeParams
        })
      }
      if (target && connectDataType) {
        return canConnectFromNodeType(target, def, {
          targetPort: ctxMenu.value?.linkToPortId ?? undefined,
          dataType: connectDataType,
          typeParams
        })
      }
      if (source || target) return false
      return true
    })
    .map((def) => ({
      typeId: def.typeId as GraphNodeTypeId,
      label:
        def.typeId === 'output.timeline'
          ? t('graph.titles.timelineOutput')
          : graphTypeLabel(def.typeId),
      icon: def.icon ?? '◇',
      portTypeLabel: connectDataType ? t(`graph.port.types.${connectDataType}`) : ''
    }))
})

/** 未归入资源类型的节点（备注、提示词优化等）留在根菜单 */
const rootAddableMenuItems = computed(() =>
  addableMenuItems.value
    .filter((item) => !CONTEXT_MENU_GROUPED_TYPE_IDS.has(item.typeId))
    .slice()
    .sort((a, b) => compareNames(a.label, b.label))
)

const resourceAddableMenuGroups = computed(() => {
  const byTypeId = new Map(addableMenuItems.value.map((item) => [item.typeId, item]))
  return CONTEXT_MENU_RESOURCE_GROUPS.map((group) => {
    const items = group.typeIds
      .map((typeId) => byTypeId.get(typeId as GraphNodeTypeId))
      .filter((item): item is AddableMenuItem => item != null)
      .concat(group.id === 'episode' ? EPISODE_AGENT_PRESET_ITEMS : [])
      .sort((a, b) => compareNames(a.label, b.label))
    return {
      id: group.id,
      label:
        group.id === 'episode'
          ? t(`graph.context.groups.${group.id}`)
          : group.id === 'imageRefine' ||
              group.id === 'imageEdit' ||
              group.id === 'text' ||
              group.id === 'prompt' ||
              group.id === 'game' ||
              group.id === 'motionFx'
            ? t(`graph.context.groups.${group.id}`)
          : assetTypeLabel(group.id),
      icon:
        group.id === 'episode'
          ? '📽️'
          : group.id === 'imageRefine'
            ? '🎨'
            : group.id === 'imageEdit'
              ? '🛠️'
            : group.id === 'text'
              ? '📝'
              : group.id === 'prompt'
                ? '✨'
              : group.id === 'game'
                ? '🕹️'
                : group.id === 'motionFx'
                  ? ANIM2D_ASSET_ICON
                : (ASSET_TYPE_ICONS[group.id] ?? '◇'),
      items
    }
  })
    .filter((group) => group.items.length > 0)
    .sort((a, b) => compareNames(a.label, b.label))
})

const connectMenuPortTypeLabel = computed(() => {
  const dataType = resolveConnectMenuDataType()
  return dataType ? t(`graph.port.types.${dataType}`) : ''
})

function resolveConnectMenuDataType(): GraphPortDataType | null {
  const menu = ctxMenu.value
  if (!menu) return null
  if (menu.linkFromNodeId) {
    const source = graph.nodes.find((n) => n.id === menu.linkFromNodeId)
    if (!source) return null
    return findOutPort(source, menu.linkFromPortId)?.dataType ?? null
  }
  if (menu.linkToNodeId) {
    const target = graph.nodes.find((n) => n.id === menu.linkToNodeId)
    if (!target) return null
    return findInPort(target, menu.linkToPortId)?.dataType ?? null
  }
  return null
}

function assetFor(node: GraphNode): AssetInfo | null {
  if (node.category === 'output') return graphAsset.value
  if (isProcessingAssetNode(node) && graphAsset.value && node.assetType === graphAsset.value.type) {
    return graphAsset.value
  }
  if (!node.assetId) return null
  return project.assets.find((a) => a.id === node.assetId) ?? null
}

/** 临时连线（拖拽建边 / 批量改接 / 节点吸附预览）在世界坐标下的两端；供 Canvas 直接绘制 */
function resolveTempEdgeWorlds(): Array<{ from: { x: number; y: number }; to: { x: number; y: number } }> {
  // 拖节点靠近：不依赖光标临时端点
  if (snapPreviewCandidates.value.length > 0 && !tempEdgeEnd.value) {
    const out: Array<{ from: { x: number; y: number }; to: { x: number; y: number } }> = []
    for (const c of snapPreviewCandidates.value) {
      const source = graph.nodes.find((n) => n.id === c.sourceId)
      const target = graph.nodes.find((n) => n.id === c.targetId)
      if (!source || !target) continue
      out.push({
        from: getNodePortCenter(source, 'right', c.sourcePort),
        to: getNodePortCenter(target, 'left', c.targetPort)
      })
    }
    return out
  }
  const end = tempEdgeEnd.value
  if (!end) return []
  const session = rewireSession.value
  if (session) {
    const out: Array<{ from: { x: number; y: number }; to: { x: number; y: number } }> = []
    for (const fixed of session.fixed) {
      const node = graph.nodes.find((n) => n.id === fixed.nodeId)
      if (!node) continue
      if (session.movingEnd === 'target') {
        out.push({
          from: getNodePortCenter(node, 'right', fixed.portId),
          to: end
        })
      } else {
        out.push({
          from: end,
          to: getNodePortCenter(node, 'left', fixed.portId)
        })
      }
    }
    return out
  }
  if (linkingFrom.value) {
    const node = graph.nodes.find((n) => n.id === linkingFrom.value)
    if (!node) return []
    // 多选：从每个选中节点相同的输出口各拉一条预览线
    const batch = new Set([linkingFrom.value, ...selectedNodeIds.value])
    const out: Array<{ from: { x: number; y: number }; to: { x: number; y: number } }> = []
    for (const id of batch) {
      const n = graph.nodes.find((item) => item.id === id)
      if (!n) continue
      const port = findOutPort(n, linkingFromPort.value ?? undefined)
      if (!port) continue
      out.push({ from: getNodePortCenter(n, 'right', port.id), to: end })
    }
    return out
  }
  if (linkingTo.value) {
    const node = graph.nodes.find((n) => n.id === linkingTo.value)
    if (!node) return []
    // 多选：从光标到每个选中节点相同的输入口各拉一条预览线
    const batch = new Set([linkingTo.value, ...selectedNodeIds.value])
    const out: Array<{ from: { x: number; y: number }; to: { x: number; y: number } }> = []
    for (const id of batch) {
      const n = graph.nodes.find((item) => item.id === id)
      if (!n) continue
      const port = findInPort(n, linkingToPort.value ?? undefined)
      if (!port) continue
      out.push({ from: end, to: getNodePortCenter(n, 'left', port.id) })
    }
    return out
  }
  return []
}

function scheduleSave(): void {
  commitAssetGraph()
  editor.documents.markDirty(activeDocumentId())
}

async function flushSaveToDisk(): Promise<void> {
  commitAssetGraph()
  if (assetGraphPersist) await assetGraphPersist
}

async function persistGraph(): Promise<void> {
  commitAssetGraph()
  await flushSaveToDisk()
}

async function flushSave(): Promise<void> {
  // 关窗/切镜必须强制落盘：跑图结果可能只在内存 runStates，未必触发过 markDirty
  await persistGraph()
}

function isLeftButtonPanArmed(): boolean {
  return spacePan || viewportToolMode.value === 'pan'
}

function setViewportToolMode(mode: 'select' | 'pan'): void {
  // 用户手动点工具时取消中键临时态，以点击为准
  transientPanRestoreMode = null
  viewportToolMode.value = mode
  rootEl.value?.classList.toggle('tool-pan', mode === 'pan')
  // 切到平移时清掉边悬停光标，避免和 grab 抢样式
  if (mode === 'pan' && viewportEl.value) clearEdgeHoverCursor(viewportEl.value)
}

/** 中键按下：工具栏临时切到平移高亮；不改动用户真正选中的工具（记在 restore 里） */
function beginTransientPanToolHighlight(): void {
  if (transientPanRestoreMode != null) return
  transientPanRestoreMode = viewportToolMode.value
  if (viewportToolMode.value === 'pan') return
  viewportToolMode.value = 'pan'
  rootEl.value?.classList.add('tool-pan')
  if (viewportEl.value) clearEdgeHoverCursor(viewportEl.value)
}

/** 中键松开：还原工具栏到按下前的模式 */
function endTransientPanToolHighlight(): void {
  if (transientPanRestoreMode == null) return
  const restore = transientPanRestoreMode
  transientPanRestoreMode = null
  viewportToolMode.value = restore
  rootEl.value?.classList.toggle('tool-pan', restore === 'pan')
}

function onViewportPointerDown(e: PointerEvent): void {
  if (e.button !== 0 || isLeftButtonPanArmed()) return
  if ((e.target as HTMLElement).closest('.graph-node, .graph-note, .port, .graph-group-label')) return
  const host = viewportEl.value
  if (!host) return

  // 边已改为 Canvas 绘制，无 DOM 命中；在空白点击时先做屏幕坐标命中测试
  const hitEdgeId = hitTestEdgeAt(e.clientX, e.clientY)
  if (hitEdgeId) {
    onEdgePointerDown(hitEdgeId, e)
    return
  }

  cancelLink()
  const rect = host.getBoundingClientRect()
  const startX = e.clientX - rect.left
  const startY = e.clientY - rect.top
  selectionBox.value = { x: startX, y: startY, w: 0, h: 0 }

  const onMove = (ev: PointerEvent): void => {
    const x = ev.clientX - rect.left
    const y = ev.clientY - rect.top
    selectionBox.value = {
      x: Math.min(startX, x),
      y: Math.min(startY, y),
      w: Math.abs(x - startX),
      h: Math.abs(y - startY)
    }
  }

  const onUp = (ev: PointerEvent): void => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
    const box = selectionBox.value
    selectionBox.value = null
    if (!box || (box.w < 4 && box.h < 4)) {
      clearSelection()
      return
    }
    const worldRect = viewportBoxToWorldRect(box, graph.viewport)
    const { nodeIds, edgeIds } = collectMarqueeHits(graph, worldRect, edgePathStyle.value)
    if (nodeIds.length === 0 && edgeIds.length === 0) {
      clearSelection()
      return
    }
    setMarqueeSelection(nodeIds, edgeIds)
    if (ev.pointerType === 'mouse') e.preventDefault()
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

/** 拖线改接：超过该像素位移后摘起连线（点击仅选中） */
const EDGE_REWIRE_DRAG_PX = 5

function onEdgePointerDown(edgeId: string, e: PointerEvent): void {
  if (e.button !== 0) return
  cancelLink()

  // Shift / Ctrl / ⌘：加减选；点中已选中的边则保留多选以便批量拖线
  if (e.shiftKey || e.ctrlKey || e.metaKey) {
    const next = new Set(selectedEdgeIds.value)
    if (next.has(edgeId)) next.delete(edgeId)
    else next.add(edgeId)
    selectedEdgeIds.value = next
    selectedNodeIds.value = new Set()
    selectedGroupId.value = null
    workspace.selectGraphNode(null, graphHostId.value)
    if (!next.has(edgeId)) return
  } else if (!selectedEdgeIds.value.has(edgeId)) {
    setSingleEdgeSelection(edgeId)
  } else {
    selectedNodeIds.value = new Set()
    selectedGroupId.value = null
    workspace.selectGraphNode(null, graphHostId.value)
  }

  const edge = graph.edges.find((item) => item.id === edgeId)
  if (!edge) return
  const host = viewportEl.value
  if (!host) return
  const rect = host.getBoundingClientRect()
  const geom = lastEdgeGeometry.find((g) => g.id === edgeId)
  const movingEnd: 'source' | 'target' = geom
    ? nearerEdgeEndpoint(geom, e.clientX - rect.left, e.clientY - rect.top)
    : 'target'
  const batch = graph.edges.filter((item) => selectedEdgeIds.value.has(item.id))
  const edgesToRewire = batch.length > 0 ? batch : [edge]
  const startX = e.clientX
  const startY = e.clientY
  let started = false

  const onMove = (ev: PointerEvent): void => {
    if (started) return
    if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < EDGE_REWIRE_DRAG_PX) return
    started = true
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
    beginEdgesRewire(edgesToRewire, movingEnd, ev)
  }

  const onUp = (): void => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

/** 屏幕坐标下命中最近的边，容差随缩放放大以匹配原 14px 命中带 */
function hitTestEdgeAt(clientX: number, clientY: number): string | null {
  const host = viewportEl.value
  if (!host) return null
  const rect = host.getBoundingClientRect()
  const px = clientX - rect.left
  const py = clientY - rect.top
  const tolerance = Math.max(6, 7 * liveViewport.zoom)
  if (edgePathStyle.value === 'hidden') return null
  return hitTestEdges(lastEdgeGeometry, px, py, tolerance)
}

function screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
  const rect = viewportEl.value!.getBoundingClientRect()
  // 与画面合成层一致，使用 liveViewport（手势期 graph.viewport 可能尚未写回）
  return clientToGraphWorld(clientX, clientY, rect, liveViewport)
}

/** 画布缩放范围（相对旧版再扩大：原 0.35～2 → 0.01～10） */
const GRAPH_ZOOM_MIN = 0.01
const GRAPH_ZOOM_MAX = 10
const GRAPH_ZOOM_SENSITIVITY = 0.999
/** 适配视图时略收一点上限，避免贴边过近 */
const GRAPH_FIT_ZOOM_MAX = 3.2
let viewportSaveTimer: ReturnType<typeof setTimeout> | null = null

function getWheelViewportRect(host: HTMLElement): { left: number; top: number; height: number } {
  const now = performance.now()
  if (wheelRectCache && wheelRectCache.until > now) {
    return wheelRectCache
  }
  const rect = host.getBoundingClientRect()
  wheelRectCache = {
    left: rect.left,
    top: rect.top,
    height: rect.height,
    until: now + 120
  }
  return wheelRectCache
}

function normalizeWheelDeltaY(e: WheelEvent, hostHeight: number): number {
  // DOM_DELTA_LINE / PAGE → 近似像素，避免鼠标滚轮与触控板手感割裂
  if (e.deltaMode === 1) return e.deltaY * 16
  if (e.deltaMode === 2) return e.deltaY * hostHeight
  return e.deltaY
}

function onWheel(e: WheelEvent): void {
  // 播放控件上滚动不缩放画布，避免误触
  if ((e.target as HTMLElement | null)?.closest?.('.transport')) return
  const host = viewportEl.value
  if (!host) return

  const rect = getWheelViewportRect(host)
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top
  const oldZoom = liveViewport.zoom
  const dy = normalizeWheelDeltaY(e, rect.height)
  const next = Math.min(
    GRAPH_ZOOM_MAX,
    Math.max(GRAPH_ZOOM_MIN, oldZoom * GRAPH_ZOOM_SENSITIVITY ** dy)
  )
  if (next === oldZoom) return

  beginViewportGesture()
  // 以光标为锚点缩放；只改 liveViewport，rAF 合帧写 DOM
  const worldX = (mx - liveViewport.x) / oldZoom
  const worldY = (my - liveViewport.y) / oldZoom
  liveViewport.zoom = next
  liveViewport.x = mx - worldX * next
  liveViewport.y = my - worldY * next

  applyViewportTransform()
  // 预览可见性延后到手势结束，避免缩放中触发节点卡重载
  scheduleViewportGestureIdle()
}

function scheduleViewportSave(): void {
  if (viewportSaveTimer) clearTimeout(viewportSaveTimer)
  viewportSaveTimer = setTimeout(() => {
    viewportSaveTimer = null
    commitAssetGraph()
    editor.documents.markDirty(activeDocumentId())
  }, 160)
}

function applyLayoutMutation(label: string, mutate: (nodes: GraphNode[]) => void): void {
  const nodes = selectedLayoutNodes.value
  if (nodes.length < 2) return
  const before = buildGraphJson()
  mutate(nodes)
  bumpGroupLayout(nodes.map((node) => node.id))
  scheduleSave()
  recordGraphChange(label, before)
  requestEdgeRender()
}

function applyAlign(mode: AlignMode): void {
  applyLayoutMutation(`align-${mode}`, (nodes) => alignNodes(nodes, mode))
}

function applyDistribute(mode: DistributeMode): void {
  applyLayoutMutation(`distribute-${mode}`, (nodes) => distributeNodes(nodes, mode))
}

function applyAutoLayout(): void {
  applyLayoutMutation('auto-layout', (nodes) => autoLayoutNodes(nodes, graph.edges))
}

/** 折叠 / 展开全部节点预览 */
function setAllNodePreviewsCollapsed(collapsed: boolean): void {
  if (graph.nodes.length === 0) return
  const before = buildGraphJson()
  let changed = false
  for (const node of graph.nodes) {
    if (node.params.previewCollapsed === collapsed) continue
    node.params = { ...node.params, previewCollapsed: collapsed }
    changed = true
  }
  if (!changed) return
  scheduleSave()
  recordGraphChange(collapsed ? 'collapse-all-previews' : 'expand-all-previews', before)
  requestEdgeRender()
}

function fitView(): void {
  const host = viewportEl.value
  if (!host) return
  const targets =
    selectedLayoutNodes.value.length > 0 ? selectedLayoutNodes.value : graph.nodes
  const bounds = getNodesBounds(targets, 48)
  if (!bounds || bounds.w <= 0 || bounds.h <= 0) {
    graph.viewport.x = 40
    graph.viewport.y = 40
    graph.viewport.zoom = 1
  } else {
    const pad = 56
    const zoomX = (host.clientWidth - pad * 2) / bounds.w
    const zoomY = (host.clientHeight - pad * 2) / bounds.h
    const zoom = Math.min(
      GRAPH_FIT_ZOOM_MAX,
      Math.max(GRAPH_ZOOM_MIN, Math.min(zoomX, zoomY))
    )
    graph.viewport.zoom = zoom
    graph.viewport.x = host.clientWidth / 2 - (bounds.x + bounds.w / 2) * zoom
    graph.viewport.y = host.clientHeight / 2 - (bounds.y + bounds.h / 2) * zoom
  }
  syncLiveViewportFromGraph()
  applyViewportTransform(true)
  requestPreviewVisibilityUpdate()
  scheduleSave()
}

/** 小地图：将指定世界坐标置于视口中心（保持当前缩放） */
function panViewportToWorldCenter(worldX: number, worldY: number): void {
  const host = viewportEl.value
  if (!host) return
  beginViewportGesture()
  liveViewport.x = host.clientWidth / 2 - worldX * liveViewport.zoom
  liveViewport.y = host.clientHeight / 2 - worldY * liveViewport.zoom
  applyViewportTransform(true)
  scheduleViewportGestureIdle()
}

function menuAddableNodeTypes() {
  return listAddableNodeTypes(graphScope.value)
}

function closeCtxMenu(): void {
  ctxMenu.value = null
  ctxSubmenu.value = null
  ctxSubmenuPinned.value = false
  submenuFlip.value = { left: false, up: false }
}

async function showCtxMenu(next: CtxMenuState): Promise<void> {
  const preferredX = next.x
  const preferredY = next.y
  ctxSubmenu.value = null
  ctxSubmenuPinned.value = false
  submenuFlip.value = { left: false, up: false }
  ctxMenu.value = next
  await nextTick()
  const el = ctxMenuEl.value
  if (!el || !ctxMenu.value) return
  const placed = placeFixedMenu(el, preferredX, preferredY)
  if (placed.x !== ctxMenu.value.x || placed.y !== ctxMenu.value.y) {
    ctxMenu.value = { ...ctxMenu.value, ...placed }
  }
}

function openCtxSubmenu(kind: string): void {
  // 已固定时悬停其他分组不抢开，避免误关已点开的面板
  if (ctxSubmenuPinned.value && ctxSubmenu.value && ctxSubmenu.value !== kind) return
  ctxSubmenu.value = kind
  void repositionCtxSubmenu()
}

/** 点击分组：固定展开；再点同一分组则收起 */
function toggleCtxSubmenu(kind: string): void {
  if (ctxSubmenu.value === kind && ctxSubmenuPinned.value) {
    ctxSubmenu.value = null
    ctxSubmenuPinned.value = false
    submenuFlip.value = { left: false, up: false }
    return
  }
  ctxSubmenuPinned.value = true
  ctxSubmenu.value = kind
  void repositionCtxSubmenu()
}

function closeCtxSubmenu(kind: string): void {
  if (ctxSubmenuPinned.value) return
  if (ctxSubmenu.value === kind) {
    ctxSubmenu.value = null
    submenuFlip.value = { left: false, up: false }
  }
}

async function repositionCtxSubmenu(): Promise<void> {
  submenuFlip.value = { left: false, up: false }
  await nextTick()
  const panel = ctxMenuEl.value?.querySelector('.ctx-submenu-panel') as HTMLElement | null
  if (!panel || !ctxSubmenu.value) return
  const rect = panel.getBoundingClientRect()
  const margin = 8
  submenuFlip.value = {
    left: rect.right > window.innerWidth - margin,
    up: rect.bottom > window.innerHeight - margin
  }
}

function onViewportPointerMove(e: PointerEvent): void {
  pointerOverViewport.value = true
  lastPointerClient.x = e.clientX
  lastPointerClient.y = e.clientY
  scheduleEdgeHoverUpdate(e)
}

function clearEdgeHoverCursor(host: HTMLElement): void {
  if (edgeHoverRaf) {
    cancelAnimationFrame(edgeHoverRaf)
    edgeHoverRaf = 0
  }
  if (edgeHoverActive) {
    host.style.cursor = ''
    edgeHoverActive = false
  }
}

/**
 * 悬停光标命中检测按 rAF 节流：pointermove 只做廉价排除，
 * 真正的贝塞尔命中测试每帧至多一次，避免大量边时移动鼠标掉帧。
 */
function scheduleEdgeHoverUpdate(e: PointerEvent): void {
  const host = viewportEl.value
  if (!host) return
  if (
    isPanning ||
    isLeftButtonPanArmed() ||
    isDraggingNodes.value ||
    linkingFrom.value ||
    linkingTo.value ||
    rewireSession.value ||
    selectionBox.value ||
    (e.target as HTMLElement).closest('.graph-node, .graph-note, .port, .graph-group-label')
  ) {
    clearEdgeHoverCursor(host)
    return
  }
  if (edgeHoverRaf) return
  edgeHoverRaf = requestAnimationFrame(() => {
    edgeHoverRaf = 0
    const hit = hitTestEdgeAt(lastPointerClient.x, lastPointerClient.y)
    if (!!hit !== edgeHoverActive) {
      edgeHoverActive = !!hit
      host.style.cursor = hit ? 'pointer' : ''
    }
  })
}

function onViewportPointerLeave(): void {
  pointerOverViewport.value = false
  if (viewportEl.value) clearEdgeHoverCursor(viewportEl.value)
}

function openCtxMenuAt(clientX: number, clientY: number): void {
  if (
    selectedNodeIds.value.size > 0 &&
    (canGroupSelection.value || canUngroupSelection.value || selectedLayoutNodes.value.length >= 2)
  ) {
    void showCtxMenu({
      x: clientX,
      y: clientY,
      worldX: 0,
      worldY: 0,
      kind: 'selection'
    })
    return
  }
  const pos = screenToWorld(clientX, clientY)
  void showCtxMenu({ x: clientX, y: clientY, worldX: pos.x, worldY: pos.y, kind: 'add' })
}

function onContextMenu(e: MouseEvent): void {
  if ((e.target as HTMLElement).closest('.graph-node, .graph-note')) return
  openCtxMenuAt(e.clientX, e.clientY)
}

/** 空格键：指针在画布空白处时于鼠标位置打开与右键相同的菜单 */
function tryOpenCtxMenuAtPointer(): boolean {
  const host = viewportEl.value
  if (!host || !pointerOverViewport.value) return false
  const { x, y } = lastPointerClient
  const el = document.elementFromPoint(x, y) as HTMLElement | null
  if (!el || (el !== host && !host.contains(el))) return false
  if (el.closest('.graph-node, .graph-note, .ctx-menu')) return false
  openCtxMenuAt(x, y)
  return true
}

function centerPosition(typeId: GraphNodeTypeId | GraphNode['category'], worldX: number, worldY: number) {
  return graphCenterPosition(typeId, worldX, worldY)
}

function writeDirectorGenParams(nextGenParams: Record<string, unknown>): void {
  const assetId = props.assetId
  if (!assetId) return
  const idx = project.assets.findIndex((item) => item.id === assetId)
  if (idx >= 0) {
    project.assets[idx] = {
      ...project.assets[idx],
      genParams: nextGenParams
    }
  }
  void persistAssetRecord(assetId, { genParams: nextGenParams })
}

function seedFreshStageForNode(node: GraphNode, graphJson: GraphDocument): void {
  const asset = graphAsset.value
  if (!asset || !props.assetId || graphScope.value !== 'directorAsset') return
  if (!isDirectorProcessingNode(node)) return
  const nextGenParams = patchGenParamsWithNodeStage(
    asset.genParams,
    node.id,
    createFreshDirectorStage(node)
  )
  writeDirectorGenParams({ ...nextGenParams, graphJson })
}

function removeStagesForNodeIds(nodeIds: string[], graphJson: GraphDocument): void {
  const asset = graphAsset.value
  // 自由画布等作用域同样会内嵌导演台节点：只要资产带 stagesByNodeId 就清理，避免孤儿舞台残留
  if (!asset || !props.assetId || !nodeIds.length) return
  const genParams = asset.genParams
  if (
    !genParams ||
    typeof genParams !== 'object' ||
    !(DIRECTOR_STAGES_BY_NODE_KEY in genParams)
  ) {
    return
  }
  const nextGenParams = removeNodeStagesFromGenParams(genParams, nodeIds, graphJson)
  writeDirectorGenParams({ ...nextGenParams, graphJson })
}

function addNodeFromMenu(item: AddableMenuItem): void {
  const typeId = item.typeId
  const menu = ctxMenu.value
  if (!menu) return
  const before = buildGraphJson()
  const linkFromId = menu.linkFromNodeId
  const linkToId = menu.linkToNodeId
  const def = getNodeType(typeId)
  /** 画布 / 分镜图 / 分镜视频窗等可添加多个输出，不复用 singleton */
  const allowMultipleOutputs = false
  const existing =
    !allowMultipleOutputs && def?.singletonId != null
      ? graph.nodes.find((n) => n.id === def.singletonId)
      : undefined

  let node: GraphNode
  if (existing) {
    node = existing
    if (isOutputContextMenuType(typeId) && def) {
      const next = createNodeFromType(typeId, { ...existing.position }, { id: existing.id })
      const sameType = existing.typeId === typeId
      const sameParams =
        existing.params.outputKind === next.params.outputKind &&
        existing.params.inputDataType === next.params.inputDataType
      if (!sameType || !sameParams) {
        const prevId = existing.id
        existing.typeId = next.typeId
        existing.category = next.category
        existing.params = { ...next.params }
        existing.title = graphTypeLabel(typeId)
        // 输出类型变更时同步规范单例 id（image-output / video-output …）
        if (def.singletonId && prevId !== def.singletonId && !graph.nodes.some((n) => n.id === def.singletonId)) {
          existing.id = def.singletonId
          for (const edge of graph.edges) {
            if (edge.source === prevId) edge.source = def.singletonId
            if (edge.target === prevId) edge.target = def.singletonId
          }
        }
        const inPort = findInPort(existing)
        if (inPort) {
          graph.edges = graph.edges.filter((edge) => {
            if (edge.target !== existing.id) return true
            const source = graph.nodes.find((n) => n.id === edge.source)
            if (!source) return false
            return canConnectNodes(source, existing, {
              sourcePort: edge.sourcePort,
              targetPort: edge.targetPort ?? inPort.id
            })
          })
        }
      }
    }
  } else {
    const extraParams = createParamsForScope(graphScope.value, typeId)
    node = createNodeFromType(typeId, centerPosition(typeId, menu.worldX, menu.worldY), {
      params: { ...extraParams, ...item.params },
      title: item.title ?? graphTypeLabel(typeId),
      // 显式新 id，避免 createNodeFromType 落入 output 的 singletonId
      ...(allowMultipleOutputs ? { id: `node-${crypto.randomUUID()}` } : {})
    })
    graph.nodes.push(node)
  }

  const createdDirectorProcessing =
    !existing &&
    typeId === 'asset.motion' &&
    graphScope.value === 'directorAsset' &&
    isDirectorProcessingNode(node)

  if (linkFromId) {
    const source = graph.nodes.find((n) => n.id === linkFromId)
    const sourcePort = menu.linkFromPortId ?? findOutPort(source!)?.id ?? 'out'
    if (
      source &&
      canConnectNodes(source, node, { sourcePort })
    ) {
      const outPort = findOutPort(source, sourcePort)
      const inPort = outPort
        ? findCompatibleInPort(node, outPort.dataType)
        : undefined
      if (outPort && inPort) {
        graph.edges = connectEdgesWithShortcutPrune(graph.edges, {
          sourceId: linkFromId,
          targetId: node.id,
          sourcePort: outPort.id,
          targetPort: inPort.id,
          edgeId: `edge-${crypto.randomUUID()}`
        })
      }
    }
  } else if (linkToId) {
    const target = graph.nodes.find((n) => n.id === linkToId)
    const targetPort = menu.linkToPortId ?? undefined
    if (
      target &&
      canConnectNodes(node, target, { targetPort })
    ) {
      const outPort = findOutPort(node)
      const inPort = outPort
        ? findCompatibleInPort(target, outPort.dataType, targetPort)
        : undefined
      if (outPort && inPort) {
        graph.edges = connectEdgesWithShortcutPrune(graph.edges, {
          sourceId: node.id,
          targetId: linkToId,
          sourcePort: outPort.id,
          targetPort: inPort.id,
          edgeId: `edge-${crypto.randomUUID()}`
        })
      }
    }
  }

  // 先关 Teleport 菜单，再改选中，避免同帧 Teleport 卸载与 Inspector 动态组件互换打架
  closeCtxMenu()
  // 同步刷新虚拟化窗口，确保新建节点本帧即可挂载（不依赖异步 watch）
  refreshGraphRenderWindow(true)
  if (!renderedNodeIds.value.has(node.id)) {
    const next = new Set(renderedNodeIds.value)
    next.add(node.id)
    renderedNodeIds.value = next
  }
  requestPreviewVisibilityUpdate()
  requestEdgeRender()
  recordGraphChange(linkFromId || linkToId ? 'add-and-connect-node' : 'add-node', before)
  if (linkFromId || linkToId) graphEditorHosts.bumpRevision()
  // 每个新导演台编辑节点拥有独立全新场景
  if (createdDirectorProcessing) {
    seedFreshStageForNode(node, buildGraphJson())
    editor.documents.markDirty(activeDocumentId())
  } else {
    scheduleSave()
  }
  void nextTick(() => {
    setSingleNodeSelection(node.id)
  })
}

function onNoteTextChange(nodeId: string, text: string): void {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node || node.category !== 'note') return
  const before = buildGraphJson()
  node.params.text = text
  scheduleSave()
  recordGraphChange('edit-note', before)
}

function onNodeTitleChange(nodeId: string, title: string): void {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  const trimmed = title.trim()
  const assetId = node.assetId?.trim()
  const linkedAsset =
    assetId && isAssetRefNode(node)
      ? project.assets.find((a) => a.id === assetId)
      : undefined
  // 画布节点显示名与资产库原名解耦；改资产名请走资产浏览器
  const prev = node.title?.trim() || linkedAsset?.name?.trim() || ''
  if (trimmed === prev) return

  const before = buildGraphJson()
  if (trimmed) node.title = trimmed
  else delete node.title
  scheduleSave()
  recordGraphChange('rename-node', before)
}

/** 预览图/视频加载后按像素比自动适配节点尺寸（用户手动缩放后不再改） */
function onNodeSizeChange(nodeId: string, size: { w: number; h: number }): void {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  if (node.params.sizeManuallyResized === true) return
  const cur = getNodeSize(node)
  if (Math.abs(cur.w - size.w) < 1 && Math.abs(cur.h - size.h) < 1) return
  node.size = { w: size.w, h: size.h }
  scheduleSave()
  requestEdgeRender()
}

function isSelfAssetDrop(asset: Pick<AssetInfo, 'id'>): boolean {
  return !!props.assetId && asset.id === props.assetId
}

function showDropError(message: string): void {
  dropError.value = message
  if (dropErrorTimer) clearTimeout(dropErrorTimer)
  dropErrorTimer = setTimeout(() => {
    dropError.value = ''
    dropErrorTimer = null
  }, 3000)
}

function dismissDropError(): void {
  dropError.value = ''
  if (dropErrorTimer) {
    clearTimeout(dropErrorTimer)
    dropErrorTimer = null
  }
}

function dismissRunBanner(): void {
  runMessage.value = ''
  runFailed.value = false
  runSucceeded.value = false
}

function setNodeAsset(
  nodeId: string,
  asset: { assetId: string; assetType: AssetType; name: string } | null
): void {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node || node.category !== 'asset') return
  if (asset && isSelfAssetDrop({ id: asset.assetId })) return
  if (asset) {
    // 宿主实例画布唯一；普通引用可与其它节点共享同一 assetId
    if (isAssetHostNode(node)) {
      const takenByHost = graph.nodes.some(
        (n) => n.id !== nodeId && n.assetId === asset.assetId && isAssetHostNode(n)
      )
      if (takenByHost) return
    }
    const before = buildGraphJson()
    node.assetId = asset.assetId
    node.assetType = asset.assetType
    node.title = assetTypeToGraphNodeTitle(asset.assetType, asset.name)
    scheduleSave()
    recordGraphChange('set-node-asset', before)
  } else {
    const before = buildGraphJson()
    delete node.assetId
    scheduleSave()
    recordGraphChange('clear-node-asset', before)
  }
}

function canAcceptAssetDrop(asset: AssetInfo | null): boolean {
  if (!asset) return false
  if (isSelfAssetDrop(asset)) return false
  return canScopeAcceptDraggedAsset(graphScope.value, asset.type)
}

function isStudioAssetDrag(e: DragEvent): boolean {
  if (workspace.draggingAsset) return true
  const types = e.dataTransfer ? Array.from(e.dataTransfer.types) : []
  return (
    types.includes(STUDIO_ASSET_DRAG_MIME) ||
    types.includes(STUDIO_ASSET_ID_DRAG_MIME) ||
    types.includes(STUDIO_ASSET_IDS_DRAG_MIME)
  )
}

/** 仅在明确是系统文件拖入、且不是资产库拖放时成立 */
function hasExternalFiles(e: DragEvent): boolean {
  if (isStudioAssetDrag(e)) return false
  const types = e.dataTransfer ? Array.from(e.dataTransfer.types) : []
  return types.includes('Files')
}

function getDroppedFilePaths(e: DragEvent): string[] {
  const list = e.dataTransfer?.files
  if (!list?.length) return []
  const paths: string[] = []
  for (let i = 0; i < list.length; i++) {
    const path = window.studio.getPathForFile(list[i])
    if (path) paths.push(path)
  }
  return paths
}

function dropPositionAt(clientX: number, clientY: number): { x: number; y: number } {
  const pos = screenToWorld(clientX, clientY)
  const { w, h } = getNodeDefaultSize('asset')
  return { x: pos.x - w / 2, y: pos.y - h / 2 }
}

function onDragOver(e: DragEvent): void {
  // 节点用 pointer 拖动，勿把预览图的原生 Files 拖拽当成可导入
  if (isDraggingNodes.value) {
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
    dropOver.value = false
    return
  }
  // 资产库拖放优先（Chromium 有时也会带上 Files 类型）
  if (isStudioAssetDrag(e) || workspace.resolveDraggedAsset(e)) {
    const asset = workspace.resolveDraggedAsset(e)
    if (asset && isSelfAssetDrop(asset)) {
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'
      return
    }
    if (asset && !canAcceptAssetDrop(asset)) return
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    closeCtxMenu()
    dropOver.value = true
    return
  }
  if (hasExternalFiles(e)) {
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    closeCtxMenu()
    dropOver.value = true
  }
}

function onDragLeave(): void {
  dropOver.value = false
}

async function importDroppedFilesOntoGraph(
  paths: string[],
  clientX: number,
  clientY: number
): Promise<void> {
  const accepted = paths.filter((path) => {
    try {
      return canScopeAcceptDraggedAsset(graphScope.value, detectImportAssetType(path))
    } catch {
      return false
    }
  })
  if (!accepted.length) {
    showDropError(t('graph.error.unsupportedDrop'))
    return
  }
  try {
    const result = await window.studio.importAssets({ filePaths: accepted })
    project.patchAssets(result.imported)
    if (!result.imported.length) {
      const detail = result.skipped.map((s) => s.reason).join('; ') || t('graph.error.noneImportable')
      showDropError(t('graph.error.importFailed', { detail }))
      return
    }
    const origin = dropPositionAt(clientX, clientY)
    let offset = 0
    for (const asset of result.imported) {
      if (!canAcceptAssetDrop(asset)) continue
      addAssetNode(asset, { x: origin.x + offset, y: origin.y + offset })
      offset += 28
    }
  } catch (err) {
    showDropError(
      t('graph.error.importFailed', {
        detail: err instanceof Error ? err.message : String(err)
      })
    )
  }
}

async function onDrop(e: DragEvent): Promise<void> {
  dropOver.value = false

  // 节点拖动松手时可能冒泡出带 Files 的原生 drop，直接忽略
  if (isDraggingNodes.value) return

  // 0b) 场栏拖入 → 创建绑定该单元的参考节点
  const droppedUnit = resolveDroppedBeatUnit(e)
  if (droppedUnit) {
    if (graphScope.value !== 'beatUnit') {
      showDropError(t('graph.error.unsupportedDrop'))
      return
    }
    dropError.value = ''
    addBeatUnitRefNode(droppedUnit, dropPositionAt(e.clientX, e.clientY))
    return
  }

  // 1) 资产库引用优先，避免被误判成「系统文件拖入」
  const asset = workspace.resolveDraggedAsset(e)
  if (asset) {
    if (isSelfAssetDrop(asset)) {
      showDropError(t('graph.error.selfAssetDrop'))
      workspace.setDraggingAsset(null)
      return
    }
    if (!canAcceptAssetDrop(asset)) {
      showDropError(t('graph.error.unsupportedDrop'))
      workspace.setDraggingAsset(null)
      return
    }
    dropError.value = ''
    const result = addAssetNode(asset, dropPositionAt(e.clientX, e.clientY))
    if (result === 'rejected') {
      showDropError(t('graph.error.alreadyOnGraph'))
    }
    workspace.setDraggingAsset(null)
    return
  }

  // 2) 资产库拖放但未能解析资产：静默忽略，不要提示「没有可导入的文件」
  if (isStudioAssetDrag(e)) {
    workspace.setDraggingAsset(null)
    return
  }

  // 3) 仅处理带真实本地路径的系统文件；预览图/页内拖拽常有 files 却无 path，勿报错
  const allPaths = getDroppedFilePaths(e)
  const paths = allPaths.filter(isImportablePath)
  if (paths.length) {
    await importDroppedFilesOntoGraph(paths, e.clientX, e.clientY)
    return
  }
  if (allPaths.length > 0) {
    showDropError(t('graph.error.noneImportable'))
  }
}

function resolveDroppedBeatUnit(e: DragEvent): BeatRow | null {
  const raw = e.dataTransfer?.getData(STUDIO_BEAT_UNIT_DRAG_MIME)
  let id = e.dataTransfer?.getData(STUDIO_BEAT_UNIT_ID_DRAG_MIME) || ''
  if (!id && raw) {
    try {
      const parsed = JSON.parse(raw) as { id?: string }
      if (typeof parsed.id === 'string') id = parsed.id
    } catch {
      /* ignore */
    }
  }
  if (!id || !props.assetId) return null
  return loadBeatCatalog(props.assetId).find((row) => row.id === id) ?? null
}

function addBeatUnitRefNode(unit: BeatRow, position: { x: number; y: number }): boolean {
  const existing = graph.nodes.find(
    (n) =>
      n.typeId === 'beat.unitRef' && readBoundBeatIdFromNodeParams(n.params) === unit.id
  )
  if (existing) {
    workspace.selectGraphNode(existing.id, graphHostId.value)
    return true
  }
  const before = buildGraphJson()
  const node = createBeatRefNode(unit, position)
  graph.nodes.push(node)
  recordGraphChange('add-beat-unit-ref', before)
  scheduleSave()
  graphEditorHosts.bumpRevision()
  workspace.selectGraphNode(node.id, graphHostId.value)
  return true
}

/** 拖入后是否应建成宿主实例（与 createAssetGraphNode 的 assetHost 条件一致） */
function wouldDropAsAssetHost(asset: AssetInfo): boolean {
  return isAssetRefInputHostType(asset.type) && !isImportedMediaRefAsset(asset)
}

/**
 * 拖入资产节点。
 * - 普通引用：允许同一资产多次拖入，生成多个图中引用节点
 * - 宿主实例：画布唯一；已存在则选中已有节点
 */
function addAssetNode(
  asset: AssetInfo,
  position: { x: number; y: number }
): 'created' | 'focused' | 'rejected' {
  if (isSelfAssetDrop(asset)) return 'rejected'
  const asHost = wouldDropAsAssetHost(asset)
  if (asHost) {
    const existing = graph.nodes.find((n) => n.assetId === asset.id && isAssetHostNode(n))
    if (existing) {
      setSingleNodeSelection(existing.id)
      workspace.selectGraphNode(existing.id, graphHostId.value)
      return 'focused'
    }
  }
  const before = buildGraphJson()
  const node = createAssetGraphNode(asset.id, asset.type, asset.name, position, {
    assetHost: asHost,
    hostInterfaceSnapshot: asHost
      ? readHostInterfaceFromGenParams(
          asset.genParams as Record<string, unknown> | undefined,
          asset.type
        )
      : undefined,
    hostSchemaVersion: asHost
      ? readHostSchemaVersion(asset.genParams as Record<string, unknown> | undefined)
      : undefined
  })
  if (asset.type === 'motion') {
    const items = resolveMotionImageItems(
      asset.genParams as Record<string, unknown> | undefined,
      null
    )
    if (items.length) {
      node.params = {
        ...node.params,
        cameraShots: items.map((image, index) => ({
          id: image.id ?? `shot:${index}`,
          dataUrl: image.dataUrl,
          createdAt: image.createdAt ?? new Date().toISOString()
        })),
        previewDataUrl: items[0]?.dataUrl
      }
    }
  } else if (asset.type === 'screenplay') {
    // 拖入时尽量带上正文，单节点运行软快照即使解析失败也有兜底
    const text = resolveAssetTextFromGenParams(
      asset.genParams as Record<string, unknown> | undefined,
      null
    )
    if (text) {
      node.params = { ...node.params, text }
    } else if (asset.type === 'screenplay') {
      void resolveAssetText(asset.id).then((body) => {
        const live = graph.nodes.find((n) => n.id === node.id)
        if (!live || live.params.text?.trim()) return
        const next = body?.trim() ?? ''
        if (!next) return
        live.params = { ...live.params, text: next }
        graphEditorHosts.bumpRevision()
        scheduleSave()
      })
    }
  }
  graph.nodes.push(node)
  setSingleNodeSelection(node.id)
  refreshGraphRenderWindow(true)
  if (!renderedNodeIds.value.has(node.id)) {
    const next = new Set(renderedNodeIds.value)
    next.add(node.id)
    renderedNodeIds.value = next
  }
  requestPreviewVisibilityUpdate()
  requestEdgeRender()
  scheduleSave()
  recordGraphChange('add-asset-node', before)
  return 'created'
}

const graphNodeInteraction = useGraphNodeInteraction({
  graph,
  selectedNodeIds,
  selectedEdgeIds,
  selectNode: (nodeId) => {
    selectedGroupId.value = null
    workspace.selectGraphNode(nodeId, graphHostId.value)
  },
  buildSnapshot: buildGraphJson,
  scheduleSave,
  recordChange: recordGraphChange,
  snapToGrid: () => snapToGridEnabled.value,
  onNodesDragStart: (nodeIds) => {
    isDraggingNodes.value = true
    clearSnapDragPreview()
    bumpGroupLayout(nodeIds)
    requestEdgeRender()
  },
  onNodesDragMove: (context) => {
    if (context.flickExitReached) {
      detachDraggedNodesFromGroup(context.nodeIds)
    }
    bumpGroupLayout(context.nodeIds)
    updateSnapDragPreview(context.nodeIds)
    // 拖动每帧重绘边，使连线端点跟随节点 / 吸附预览
    requestEdgeRender()
  },
  onNodesDragEnd: (context) => {
    isDraggingNodes.value = false
    if (!context.didMove) {
      clearSnapDragPreview()
      return
    }
    bumpGroupLayout(context.nodeIds)
    if (!context.fromGroupLabel) syncMovedNodesGroupMembership(context)
    // Houdini 风格：松手后端口靠近且类型兼容则自动连线（并入同次 move-node 撤销）
    const snaps =
      snapPreviewCandidates.value.length > 0
        ? snapPreviewCandidates.value
        : resolveSnapConnectEdges({
            nodes: graph.nodes,
            edges: graph.edges,
            draggedNodeIds: context.nodeIds,
            thresholdWorld: snapConnectThresholdWorld(graph.viewport.zoom)
          })
    clearSnapDragPreview()
    for (const snap of snaps) {
      connectNodes(snap.sourceId, snap.targetId, snap.sourcePort, snap.targetPort, {
        skipHistory: true
      })
    }
    // 拖动结束后按最终位置重算可见集合（拖出视口的节点在此被正确剔除）
    refreshGraphRenderWindow(true)
    requestEdgeRender()
  }
})
const { onNodeDragStart, onNodeResizeStart } = graphNodeInteraction
/** 右下角拉升尺寸中：隐藏标题栏/控件，保持节点预览干净 */
const isResizingNode = ref(false)

function onNodeResizeStartWrapped(nodeId: string, event: PointerEvent): void {
  const node = graph.nodes.find((item) => item.id === nodeId)
  if (!node) return
  const resizingInGroup = !!node.groupId
  isResizingNode.value = true
  onNodeResizeStart(nodeId, event)
  // 缩放会改变端口中心，边端点需随之逐帧重绘（无论是否在分组内）
  const onMove = (): void => {
    if (resizingInGroup) bumpGroupLayout([nodeId])
    requestEdgeRender()
  }
  const onUp = (): void => {
    isResizingNode.value = false
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
    if (resizingInGroup) isDraggingNodes.value = false
    requestEdgeRender()
  }
  if (resizingInGroup) isDraggingNodes.value = true
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

const GROUP_LABEL_CLICK_THRESHOLD = 4

function onGroupLabelDragStart(groupId: string, event: PointerEvent): void {
  if (editingGroupId.value) return
  const memberIds = graph.nodes.filter((node) => node.groupId === groupId).map((node) => node.id)
  if (memberIds.length === 0) return

  const startX = event.clientX
  const startY = event.clientY
  let dragStarted = false

  const cleanup = (): void => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
  }

  const onMove = (ev: PointerEvent): void => {
    if (dragStarted) return
    if (
      Math.hypot(ev.clientX - startX, ev.clientY - startY) >= GROUP_LABEL_CLICK_THRESHOLD
    ) {
      dragStarted = true
      cleanup()
      onNodeDragStart(memberIds[0], event, { moveWholeGroup: true })
    }
  }

  const onUp = (): void => {
    if (!dragStarted) setGroupSelection(groupId)
    cleanup()
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

function findLinkTarget(
  clientX: number,
  clientY: number
): { nodeId: string; portId: string } | null {
  const hits = document.elementsFromPoint(clientX, clientY)
  for (const el of hits) {
    const portEl = el.closest('.port.in') as HTMLElement | null
    if (!portEl) continue
    const nodeEl = portEl.closest('[data-node-id]') as HTMLElement | null
    const nodeId = nodeEl?.dataset.nodeId
    const portId = portEl.dataset.portId
    if (!nodeId || !portId) continue
    if (!graph.nodes.some((n) => n.id === nodeId)) continue
    return { nodeId, portId }
  }
  return null
}

function findLinkSource(
  clientX: number,
  clientY: number
): { nodeId: string; portId: string } | null {
  const hits = document.elementsFromPoint(clientX, clientY)
  for (const el of hits) {
    const portEl = el.closest('.port.out') as HTMLElement | null
    if (!portEl) continue
    const nodeEl = portEl.closest('[data-node-id]') as HTMLElement | null
    const nodeId = nodeEl?.dataset.nodeId
    const portId = portEl.dataset.portId
    if (!nodeId || !portId) continue
    if (!graph.nodes.some((n) => n.id === nodeId)) continue
    return { nodeId, portId }
  }
  return null
}

function onOutPortDown(nodeId: string, portId: string, e: PointerEvent): void {
  linkingFrom.value = nodeId
  linkingFromPort.value = portId
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  const captureEl = e.currentTarget as HTMLElement | null
  const update = (ev: PointerEvent): void => {
    tempEdgeEnd.value = screenToWorld(ev.clientX, ev.clientY)
    requestEdgeRender()
  }
  update(e)
  const onUp = (ev: PointerEvent): void => {
    if (captureEl?.hasPointerCapture(ev.pointerId)) {
      captureEl.releasePointerCapture(ev.pointerId)
    }
    const sourceId = linkingFrom.value
    const sourcePort = linkingFromPort.value ?? 'out'
    const targetHit = findLinkTarget(ev.clientX, ev.clientY)
    if (targetHit && sourceId) {
      // 多选：从选中节点中找出所有具备相同输出口的节点，一起连到目标端口（合并为一次撤销）
      const batchIds = [...new Set([sourceId, ...selectedNodeIds.value])].filter(
        (id) => id !== targetHit.nodeId
      )
      if (batchIds.length > 1) {
        const before = buildGraphJson()
        let connected = 0
        for (const id of batchIds) {
          if (
            connectNodes(id, targetHit.nodeId, sourcePort, targetHit.portId, {
              skipHistory: true
            })
          ) {
            connected += 1
          }
        }
        if (connected > 0) {
          recordGraphChange('connect-nodes', before)
          scheduleSave()
          graphEditorHosts.bumpRevision()
        }
      } else {
        connectNodes(sourceId, targetHit.nodeId, sourcePort, targetHit.portId)
      }
    } else if (sourceId) {
      const source = graph.nodes.find((n) => n.id === sourceId)
      const outPort = source ? findOutPort(source, sourcePort) : undefined
      const hasConnectable =
        source &&
        outPort &&
        menuAddableNodeTypes().some((def) =>
          canConnectToNodeType(source, def, {
            sourcePort,
            dataType: outPort.dataType,
            typeParams: createParamsForScope(graphScope.value, def.typeId as GraphNodeTypeId)
          })
        )
      if (hasConnectable) {
        const pos = screenToWorld(ev.clientX, ev.clientY)
        void showCtxMenu({
          x: ev.clientX,
          y: ev.clientY,
          worldX: pos.x,
          worldY: pos.y,
          kind: 'add',
          linkFromNodeId: sourceId,
          linkFromPortId: sourcePort
        })
      }
    }
    cancelLink()
    window.removeEventListener('pointermove', update)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
  }
  window.addEventListener('pointermove', update)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

function onInPortDown(nodeId: string, portId: string, e: PointerEvent): void {
  if (linkingFrom.value) {
    connectNodes(
      linkingFrom.value,
      nodeId,
      linkingFromPort.value ?? undefined,
      portId
    )
    cancelLink()
    return
  }

  // 已有入边时：拖动输入口 = 摘起该口全部入边改接（可一次拖多条）
  const incoming = graph.edges.filter(
    (edge) => edge.target === nodeId && (edge.targetPort ?? 'in') === portId
  )
  if (incoming.length > 0) {
    const startX = e.clientX
    const startY = e.clientY
    let started = false
    const onMove = (ev: PointerEvent): void => {
      if (started) return
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < EDGE_REWIRE_DRAG_PX) return
      started = true
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      beginEdgesRewire(incoming, 'target', ev)
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return
  }

  linkingTo.value = nodeId
  linkingToPort.value = portId
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  const captureEl = e.currentTarget as HTMLElement | null
  const update = (ev: PointerEvent): void => {
    tempEdgeEnd.value = screenToWorld(ev.clientX, ev.clientY)
    requestEdgeRender()
  }
  update(e)
  const onUp = (ev: PointerEvent): void => {
    if (captureEl?.hasPointerCapture(ev.pointerId)) {
      captureEl.releasePointerCapture(ev.pointerId)
    }
    const targetId = linkingTo.value
    const targetPort = linkingToPort.value ?? undefined
    const sourceHit = findLinkSource(ev.clientX, ev.clientY)
    if (sourceHit && targetId) {
      // 多选：从选中节点中找出所有具备相同输入口的节点，一起接入来源端口（合并为一次撤销）
      const batchIds = [...new Set([targetId, ...selectedNodeIds.value])].filter(
        (id) => id !== sourceHit.nodeId
      )
      if (batchIds.length > 1) {
        const before = buildGraphJson()
        let connected = 0
        for (const id of batchIds) {
          if (
            connectNodes(sourceHit.nodeId, id, sourceHit.portId, targetPort, {
              skipHistory: true
            })
          ) {
            connected += 1
          }
        }
        if (connected > 0) {
          recordGraphChange('connect-nodes', before)
          scheduleSave()
          graphEditorHosts.bumpRevision()
        }
      } else {
        connectNodes(sourceHit.nodeId, targetId, sourceHit.portId, targetPort)
      }
    } else if (targetId) {
      const target = graph.nodes.find((n) => n.id === targetId)
      const inPort = target ? findInPort(target, targetPort) : undefined
      const hasConnectable =
        target &&
        inPort &&
        menuAddableNodeTypes().some((def) =>
          canConnectFromNodeType(target, def, {
            targetPort,
            dataType: inPort.dataType,
            typeParams: createParamsForScope(graphScope.value, def.typeId as GraphNodeTypeId)
          })
        )
      if (hasConnectable) {
        const pos = screenToWorld(ev.clientX, ev.clientY)
        void showCtxMenu({
          x: ev.clientX,
          y: ev.clientY,
          worldX: pos.x,
          worldY: pos.y,
          kind: 'add',
          linkToNodeId: targetId,
          linkToPortId: targetPort
        })
      }
    }
    cancelLink()
    window.removeEventListener('pointermove', update)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
  }
  window.addEventListener('pointermove', update)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

/**
 * 摘起一条或多条已有连线的同一端，拖到兼容端口批量改接；落空则全部断开。
 * movingEnd=target：固定各源端，改接到同一输入口；movingEnd=source：固定各目标端，改接到同一输出口。
 */
function beginEdgesRewire(
  edges: GraphEdge[],
  movingEnd: 'source' | 'target',
  e: PointerEvent
): void {
  const unique = new Map<string, GraphEdge>()
  for (const edge of edges) {
    if (graph.edges.some((item) => item.id === edge.id)) unique.set(edge.id, edge)
  }
  if (unique.size === 0) return
  const batch = [...unique.values()]
  const before = buildGraphJson()
  const removeIds = new Set(batch.map((edge) => edge.id))
  graph.edges = graph.edges.filter((item) => !removeIds.has(item.id))
  if ([...removeIds].some((id) => selectedEdgeIds.value.has(id))) {
    selectedEdgeIds.value = new Set(
      [...selectedEdgeIds.value].filter((id) => !removeIds.has(id))
    )
  }
  scheduleSave()
  graphEditorHosts.bumpRevision()

  rewireSession.value = {
    movingEnd,
    fixed: batch.map((edge) =>
      movingEnd === 'target'
        ? { nodeId: edge.source, portId: edge.sourcePort ?? 'out' }
        : { nodeId: edge.target, portId: edge.targetPort ?? 'in' }
    )
  }
  linkingFrom.value = null
  linkingFromPort.value = null
  linkingTo.value = null
  linkingToPort.value = null

  const update = (ev: PointerEvent): void => {
    tempEdgeEnd.value = screenToWorld(ev.clientX, ev.clientY)
    requestEdgeRender()
  }
  update(e)

  const finish = (ev: PointerEvent): void => {
    window.removeEventListener('pointermove', update)
    window.removeEventListener('pointerup', finish)
    window.removeEventListener('pointercancel', finish)
    const session = rewireSession.value
    let okCount = 0
    if (session) {
      if (session.movingEnd === 'target') {
        const targetHit = findLinkTarget(ev.clientX, ev.clientY)
        if (targetHit) {
          for (const fixed of session.fixed) {
            if (
              connectNodes(fixed.nodeId, targetHit.nodeId, fixed.portId, targetHit.portId, {
                skipHistory: true
              })
            ) {
              okCount += 1
            }
          }
        }
      } else {
        const sourceHit = findLinkSource(ev.clientX, ev.clientY)
        if (sourceHit) {
          for (const fixed of session.fixed) {
            if (
              connectNodes(sourceHit.nodeId, fixed.nodeId, sourceHit.portId, fixed.portId, {
                skipHistory: true
              })
            ) {
              okCount += 1
            }
          }
        }
      }
    }
    cancelLink()
    recordGraphChange(okCount > 0 ? 'rewire-edge' : 'disconnect-edge', before)
  }

  window.addEventListener('pointermove', update)
  window.addEventListener('pointerup', finish)
  window.addEventListener('pointercancel', finish)
}

function connectNodes(
  sourceId: string,
  targetId: string,
  sourcePortId?: string,
  targetPortId?: string,
  options?: { skipHistory?: boolean }
): boolean {
  if (sourceId === targetId) return false
  const source = graph.nodes.find((n) => n.id === sourceId)
  const target = graph.nodes.find((n) => n.id === targetId)
  if (!source || !target) return false
  const outPort = findOutPort(source, sourcePortId)
  if (!outPort) return false
  const inPort = findCompatibleInPort(target, outPort.dataType, targetPortId)
  if (!inPort) return false
  if (
    !canConnectNodes(source, target, {
      sourcePort: outPort.id,
      targetPort: inPort.id
    })
  ) {
    return false
  }
  const before = options?.skipHistory ? null : buildGraphJson()
  // 若源已能到达目标（如 A→B→C→D 再连 A→D），先断开目标口上的原入边
  graph.edges = connectEdgesWithShortcutPrune(graph.edges, {
    sourceId,
    targetId,
    sourcePort: outPort.id,
    targetPort: inPort.id,
    edgeId: `edge-${crypto.randomUUID()}`
  })
  scheduleSave()
  if (before) {
    recordGraphChange('connect-nodes', before)
  }
  graphEditorHosts.bumpRevision()
  return true
}

function removeGraphEdge(edgeId: string): void {
  if (!graph.edges.some((edge) => edge.id === edgeId)) return
  const before = buildGraphJson()
  graph.edges = graph.edges.filter((edge) => edge.id !== edgeId)
  if (selectedEdgeIds.value.has(edgeId)) {
    const next = new Set(selectedEdgeIds.value)
    next.delete(edgeId)
    selectedEdgeIds.value = next
  }
  scheduleSave()
  recordGraphChange('delete-edges', before)
  graphEditorHosts.bumpRevision()
}

function reorderGraphIncomingEdges(nodeId: string, orderedEdgeIds: string[]): void {
  const next = reorderIncomingEdgesByIds(graph.edges, nodeId, orderedEdgeIds)
  if (!next) return
  const before = buildGraphJson()
  graph.edges = next
  scheduleSave()
  recordGraphChange('reorder-edges', before)
  graphEditorHosts.bumpRevision()
}

function cancelLink(): void {
  linkingFrom.value = null
  linkingFromPort.value = null
  linkingTo.value = null
  linkingToPort.value = null
  rewireSession.value = null
  tempEdgeEnd.value = null
  requestEdgeRender()
}

const notepad = reactive({
  open: false,
  nodeId: '' as string,
  title: '',
  text: '',
  field: null as GraphNodeTextField | null,
  editable: true
})

function nodeDisplayTitle(node: GraphNode): string {
  const custom = node.title?.trim()
  if (custom) return custom
  if (node.typeId) return graphTypeLabel(node.typeId)
  return t('graph.defaultNode')
}

function openTextNotepad(nodeId: string): void {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  const content = resolveNodeTextContent(node, runStates[nodeId])
  if (!content) return
  // 先写正文再 open：DialogLayer 用 v-if 挂载，必须让首帧 props.text 已就绪
  notepad.nodeId = nodeId
  notepad.title = nodeDisplayTitle(node)
  notepad.text = content.text ?? ''
  notepad.field = content.field
  notepad.editable = content.field !== null
  notepad.open = true
}

function onTextOpen(nodeId: string): void {
  openTextNotepad(nodeId)
}

/** UI 界面拆分：双击进入内图（懒创建子图资产并打开资产编辑器） */
function onUiSplitOpen(nodeId: string): void {
  if (editorDive) {
    const node = graph.nodes.find((n) => n.id === nodeId)
    void editorDive.diveView(
      { viewId: 'ui.split', hostId: graphHostId.value, nodeId },
      node ? nodeDisplayTitle(node) : undefined
    )
  }
}

function closeTextNotepad(): void {
  notepad.open = false
  notepad.nodeId = ''
  notepad.text = ''
  notepad.field = null
}

function saveTextNotepad(text: string): void {
  const nodeId = notepad.nodeId
  const field = notepad.field
  if (!nodeId || !field) return
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  if ((node.params[field] ?? '') === text) {
    notepad.text = text
    return
  }
  const before = buildGraphJson()
  node.params[field] = text
  notepad.text = text
  scheduleSave()
  recordGraphChange('edit-node-text', before)
}

const selectImage = reactive({
  open: false,
  nodeId: '' as string,
  title: '',
  items: [] as GraphImageItem[],
  selectedImageId: '' as string
})

function resolveWorldElementOutputsForSelect(
  node?: GraphNode
): import('@shared/graph').WorldElementGenResult[] {
  const worldId = props.assetId?.trim()
  if (!worldId) return []
  return previewWorldElementOutputsFromSubgraphs({
    worldAssetId: worldId,
    nodeId: node?.id
  })
}

function resolveWorldGenPortImages(source: GraphNode, sourcePort: string): GraphImageItem[] {
  if (!isWorldGenImageOutPortId(sourcePort)) return []
  const softOpts = {
    resolveWorldElementOutputs: resolveWorldElementOutputsForSelect
  }
  // soft：params / runStates / 子图边界（与执行快照同源）
  const soft = softResolveSourceOutput(buildGraphJson(), source.id, sourcePort, softOpts)
  if (soft && graphValueHasPayload(soft)) {
    return flattenImagesValues([soft])
  }
  // 再直读子图（world.gen 未执行且 params 为空时）
  const groups = worldGenImageGroupOutputs(resolveWorldElementOutputsForSelect(source))
  const fromSubgraphs = groups[sourcePort]
  if (fromSubgraphs && graphValueHasPayload(fromSubgraphs)) {
    return flattenImagesValues([fromSubgraphs])
  }
  return []
}

function collectSelectImageItems(nodeId: string): GraphImageItem[] {
  const items: GraphImageItem[] = []
  const seen = new Set<string>()
  const pushItem = (item: GraphImageItem): void => {
    const dataUrl = item.dataUrl?.trim() || ''
    const relativePath = item.relativePath?.trim() || ''
    // 生成图落盘后常清空 dataUrl，仅保留 relativePath
    if (!dataUrl && !relativePath) return
    const keys = [item.id?.trim(), relativePath, dataUrl].filter((k): k is string => !!k)
    if (keys.some((k) => seen.has(k))) return
    for (const k of keys) seen.add(k)
    const title = item.title?.trim() || ''
    items.push({
      ...item,
      dataUrl,
      ...(title ? { title } : {}),
      ...(relativePath ? { relativePath } : {})
    })
  }

  for (const edge of graph.edges) {
    if (edge.target !== nodeId) continue
    if ((edge.targetPort ?? 'in') !== 'in') continue
    const source = graph.nodes.find((n) => n.id === edge.source)
    if (!source) continue

    const sourcePort = edge.sourcePort ?? 'out'
    if (source.typeId === 'world.gen') {
      const ports = isWorldGenImageOutPortId(sourcePort)
        ? [sourcePort]
        : WORLD_GEN_IMAGE_OUT_PORTS.map((port) => port.id)
      for (const port of ports) {
        for (const item of resolveWorldGenPortImages(source, port)) pushItem(item)
      }
      continue
    }

    // 宿主节点：按边上的源端口解析对应的内部边界输出，
    // 不能读合并后的节点画廊（generatedImages），否则每个端口都会拿到全部图片
    if (isAssetHostNode(source)) {
      const soft = softResolveSourceOutput(
        buildGraphJson(),
        source.id,
        sourcePort,
        {}
      )
      if (soft && graphValueHasPayload(soft)) {
        for (const item of flattenImagesValues([soft])) pushItem(item)
      }
      continue
    }

    const generatedImages = source.params.generatedImages ?? []
    if (generatedImages.length) {
      for (const [index, gen] of generatedImages.entries()) {
        pushItem({
          id: gen.id?.trim() || `${source.id}:generated:${index}`,
          dataUrl: gen.dataUrl?.trim() || '',
          createdAt: gen.createdAt,
          ...(gen.relativePath?.trim() ? { relativePath: gen.relativePath.trim() } : {})
        })
      }
      continue
    }

    const cameraShots = source.params.cameraShots ?? []
    if (cameraShots.length) {
      for (const shot of cameraShots) {
        pushItem({
          id: shot.id,
          dataUrl: shot.dataUrl?.trim() || '',
          createdAt: shot.createdAt,
          ...(shot.relativePath?.trim() ? { relativePath: shot.relativePath.trim() } : {})
        })
      }
      continue
    }

    const runOut = runStates[source.id]?.outputs?.[sourcePort]
    if (runOut) {
      for (const item of flattenImagesValues([runOut])) pushItem(item)
      if (runOut.kind === 'asset' && runOut.assetType === 'image' && runOut.assetId) {
        const asset = project.assets.find((item) => item.id === runOut.assetId)
        const path = asset?.thumbnailPath?.trim() || asset?.relativePath?.trim() || ''
        if (path) {
          pushItem({
            id: runOut.assetId,
            dataUrl: '',
            relativePath: path
          })
        }
      }
    }

    if (source.params.previewDataUrl?.trim() || source.params.previewRelativePath?.trim()) {
      pushItem({
        id: `${source.id}:preview`,
        dataUrl: source.params.previewDataUrl?.trim() || '',
        ...(source.params.previewRelativePath?.trim()
          ? { relativePath: source.params.previewRelativePath.trim() }
          : {})
      })
    }

    // 拖入的图片资产引用
    if (source.assetType === 'image' && source.assetId) {
      const asset = project.assets.find((item) => item.id === source.assetId)
      const path = asset?.thumbnailPath?.trim() || asset?.relativePath?.trim() || ''
      if (path) {
        pushItem({
          id: source.assetId,
          dataUrl: '',
          relativePath: path,
          ...(asset?.name?.trim() ? { title: asset.name.trim() } : {})
        })
      }
    }

    // 拖入的导演台资产引用：站位图在资产 genParams.stage / graphJson 中
    if (source.assetType === 'motion' && source.assetId && source.params.assetRef) {
      const asset = project.assets.find((item) => item.id === source.assetId)
      for (const item of resolveMotionImageItems(
        asset?.genParams as Record<string, unknown> | undefined,
        source.params
      )) {
        pushItem(item)
      }
    }
  }
  return items
}

function onSelectImageOpen(nodeId: string): void {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  const items = collectSelectImageItems(nodeId)
  const selectedKey = node.params.selectedImageId?.trim() || ''
  const selected =
    pickImageItem(items, selectedKey) ?? (items[0] ? items[0] : undefined)
  selectImage.open = true
  selectImage.nodeId = nodeId
  selectImage.title = nodeDisplayTitle(node)
  selectImage.items = items
  selectImage.selectedImageId = selected
    ? imageItemKey(selected, Math.max(0, items.indexOf(selected)))
    : ''
}

function closeSelectImage(): void {
  selectImage.open = false
  selectImage.nodeId = ''
  selectImage.items = []
  selectImage.selectedImageId = ''
}

function saveSelectImage(selectedImageId: string): void {
  const nodeId = selectImage.nodeId
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  const items = selectImage.items
  const picked = pickImageItem(items, selectedImageId)
  const before = buildGraphJson()
  const previewDataUrl = picked?.dataUrl?.trim() ? picked.dataUrl : undefined
  const previewRelativePath = picked?.relativePath?.trim() ? picked.relativePath : undefined
  node.params = {
    ...node.params,
    selectedImageId,
    previewDataUrl,
    previewRelativePath
  }
  selectImage.selectedImageId = selectedImageId
  scheduleSave()
  recordGraphChange('select-image', before)
  closeSelectImage()
}

const selectVideo = reactive({
  open: false,
  nodeId: '' as string,
  title: '',
  items: [] as GraphVideoItem[],
  selectedVideoId: '' as string
})

function collectSelectVideoItems(nodeId: string): GraphVideoItem[] {
  const items: GraphVideoItem[] = []
  const seen = new Set<string>()
  const pushItem = (item: GraphVideoItem): void => {
    const dataUrl = item.dataUrl?.trim() || ''
    const relativePath = item.relativePath?.trim() || ''
    if (!dataUrl && !relativePath) return
    // id / path / dataUrl 任一命中即去重，避免 preview 与图库同文件不同 id 重复
    const keys = [item.id?.trim(), relativePath, dataUrl].filter((k): k is string => !!k)
    if (keys.some((k) => seen.has(k))) return
    for (const k of keys) seen.add(k)
    items.push({
      ...item,
      ...(dataUrl ? { dataUrl } : {}),
      ...(relativePath ? { relativePath } : {})
    })
  }

  for (const edge of graph.edges) {
    if (edge.target !== nodeId) continue
    if ((edge.targetPort ?? 'in') !== 'in') continue
    const source = graph.nodes.find((n) => n.id === edge.source)
    if (!source) continue

    // 与生成节点 Inspector 一致：有累计图库时只认图库，不再叠 preview / runOut
    const gallery = source.params.generatedVideos ?? []
    if (gallery.length) {
      for (const [index, gen] of gallery.entries()) {
        pushItem({
          id: gen.id?.trim() || `${source.id}:generated:${index}`,
          ...(gen.dataUrl?.trim() ? { dataUrl: gen.dataUrl.trim() } : {}),
          createdAt: gen.createdAt,
          ...(gen.relativePath?.trim() ? { relativePath: gen.relativePath.trim() } : {})
        })
      }
      continue
    }

    const sourcePort = edge.sourcePort ?? 'out'
    const runOut = runStates[source.id]?.outputs?.[sourcePort]
    if (runOut) {
      for (const item of flattenVideosValues([runOut])) pushItem(item)
      if (runOut.kind === 'asset' && runOut.assetType === 'video' && runOut.assetId) {
        const asset = project.assets.find((item) => item.id === runOut.assetId)
        const path = asset?.relativePath?.trim() || ''
        if (path) {
          pushItem({
            id: runOut.assetId,
            relativePath: path
          })
        }
      }
    }

    if (source.params.previewRelativePath?.trim() || source.params.previewDataUrl?.trim()) {
      pushItem({
        id: `${source.id}:preview`,
        ...(source.params.previewDataUrl?.trim()
          ? { dataUrl: source.params.previewDataUrl.trim() }
          : {}),
        ...(source.params.previewRelativePath?.trim()
          ? { relativePath: source.params.previewRelativePath.trim() }
          : {})
      })
    }

    if (source.assetType === 'video' && source.assetId) {
      const asset = project.assets.find((item) => item.id === source.assetId)
      const path = asset?.relativePath?.trim() || ''
      if (path) {
        pushItem({
          id: source.assetId,
          relativePath: path
        })
      }
    }
  }
  return items
}

function onSelectVideoOpen(nodeId: string): void {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  const items = collectSelectVideoItems(nodeId)
  const selected =
    pickVideoItem(items, node.params.selectedVideoId) ??
    (items[0] ? items[0] : undefined)
  selectVideo.open = true
  selectVideo.nodeId = nodeId
  selectVideo.title = nodeDisplayTitle(node)
  selectVideo.items = items
  selectVideo.selectedVideoId = selected
    ? videoItemKey(selected, Math.max(0, items.indexOf(selected)))
    : ''
}

function closeSelectVideo(): void {
  selectVideo.open = false
  selectVideo.nodeId = ''
  selectVideo.items = []
  selectVideo.selectedVideoId = ''
}

function saveSelectVideo(selectedVideoId: string): void {
  const nodeId = selectVideo.nodeId
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  const items = selectVideo.items
  const picked = pickVideoItem(items, selectedVideoId)
  const before = buildGraphJson()
  const previewDataUrl = picked?.dataUrl?.trim() ? picked.dataUrl : undefined
  const previewRelativePath = picked?.relativePath?.trim() ? picked.relativePath : undefined
  node.params = {
    ...node.params,
    selectedVideoId,
    previewDataUrl,
    previewRelativePath
  }
  selectVideo.selectedVideoId = selectedVideoId
  scheduleSave()
  recordGraphChange('select-video', before)
  closeSelectVideo()
}

const selectVoice = reactive({
  open: false,
  nodeId: '' as string,
  title: '',
  items: [] as GraphVoiceItem[],
  selectedVoiceId: '' as string
})

function collectSelectVoiceItems(nodeId: string): GraphVoiceItem[] {
  const items: GraphVoiceItem[] = []
  const seen = new Set<string>()
  const pushItem = (item: GraphVoiceItem): void => {
    const relativePath = item.relativePath?.trim() || ''
    if (!relativePath) return
    const keys = [item.id?.trim(), relativePath].filter((k): k is string => !!k)
    if (keys.some((k) => seen.has(k))) return
    for (const k of keys) seen.add(k)
    items.push({
      ...item,
      relativePath
    })
  }

  for (const edge of graph.edges) {
    if (edge.target !== nodeId) continue
    if ((edge.targetPort ?? 'in') !== 'in') continue
    const source = graph.nodes.find((n) => n.id === edge.source)
    if (!source) continue

    const gallery = source.params.generatedVoices ?? []
    if (gallery.length) {
      for (const [index, gen] of gallery.entries()) {
        pushItem({
          id: gen.id?.trim() || `${source.id}:generated:${index}`,
          createdAt: gen.createdAt,
          ...(gen.relativePath?.trim() ? { relativePath: gen.relativePath.trim() } : {})
        })
      }
      continue
    }

    const sourcePort = edge.sourcePort ?? 'out'
    const runOut = runStates[source.id]?.outputs?.[sourcePort]
    if (runOut) {
      for (const item of flattenVoicesValues([runOut])) pushItem(item)
      if (runOut.kind === 'asset' && runOut.assetType === 'voice' && runOut.assetId) {
        const asset = project.assets.find((item) => item.id === runOut.assetId)
        const path = asset?.relativePath?.trim() || ''
        if (path) {
          pushItem({
            id: runOut.assetId,
            relativePath: path
          })
        }
      }
    }

    if (source.params.previewRelativePath?.trim()) {
      pushItem({
        id: `${source.id}:preview`,
        relativePath: source.params.previewRelativePath.trim()
      })
    }

    if (source.assetType === 'voice' && source.assetId) {
      const asset = project.assets.find((item) => item.id === source.assetId)
      const path = asset?.relativePath?.trim() || ''
      if (path) {
        pushItem({
          id: source.assetId,
          relativePath: path
        })
      }
    }
  }
  return items
}

function onSelectVoiceOpen(nodeId: string): void {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  const items = collectSelectVoiceItems(nodeId)
  const selected =
    pickVoiceItem(items, node.params.selectedVoiceId) ??
    (items[0] ? items[0] : undefined)
  selectVoice.open = true
  selectVoice.nodeId = nodeId
  selectVoice.title = nodeDisplayTitle(node)
  selectVoice.items = items
  selectVoice.selectedVoiceId = selected
    ? voiceItemKey(selected, Math.max(0, items.indexOf(selected)))
    : ''
}

function closeSelectVoice(): void {
  selectVoice.open = false
  selectVoice.nodeId = ''
  selectVoice.items = []
  selectVoice.selectedVoiceId = ''
}

function saveSelectVoice(selectedVoiceId: string): void {
  const nodeId = selectVoice.nodeId
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  const items = selectVoice.items
  const picked = pickVoiceItem(items, selectedVoiceId)
  const before = buildGraphJson()
  const previewRelativePath = picked?.relativePath?.trim() ? picked.relativePath : undefined
  node.params = {
    ...node.params,
    selectedVoiceId,
    previewRelativePath
  }
  selectVoice.selectedVoiceId = selectedVoiceId
  scheduleSave()
  recordGraphChange('select-voice', before)
  closeSelectVoice()
}

const selectText = reactive({
  open: false,
  nodeId: '' as string,
  title: '',
  items: [] as GraphTextItem[],
  selectedTextId: '' as string
})

function collectSelectTextItems(nodeId: string): GraphTextItem[] {
  const items: GraphTextItem[] = []
  const seen = new Set<string>()
  const pushItem = (item: GraphTextItem): void => {
    const text = typeof item.text === 'string' ? item.text : ''
    const relativePath = item.relativePath?.trim() || ''
    if (!text.trim() && !relativePath) return
    const keys = [item.id?.trim(), relativePath, text.trim() || ''].filter(
      (k): k is string => !!k
    )
    if (keys.some((k) => seen.has(k))) return
    for (const k of keys) seen.add(k)
    items.push({
      ...item,
      text,
      ...(relativePath ? { relativePath } : {})
    })
  }

  for (const edge of graph.edges) {
    if (edge.target !== nodeId) continue
    if ((edge.targetPort ?? 'in') !== 'in') continue
    const source = graph.nodes.find((n) => n.id === edge.source)
    if (!source) continue

    const gallery = source.params.generatedTexts ?? []
    if (gallery.length) {
      for (const [index, gen] of gallery.entries()) {
        pushItem({
          id: gen.id?.trim() || `${source.id}:generated:${index}`,
          text: gen.text?.trim() || '',
          createdAt: gen.createdAt,
          ...(gen.relativePath?.trim() ? { relativePath: gen.relativePath.trim() } : {})
        })
      }
      continue
    }

    const sourcePort = edge.sourcePort ?? 'out'
    const runOut = runStates[source.id]?.outputs?.[sourcePort]
    if (runOut) {
      for (const item of flattenTextsValues([runOut])) pushItem(item)
    }

    if (source.params.text?.trim() || source.params.previewRelativePath?.trim()) {
      pushItem({
        id: `${source.id}:preview`,
        text: source.params.text?.trim() || '',
        ...(source.params.previewRelativePath?.trim()
          ? { relativePath: source.params.previewRelativePath.trim() }
          : {})
      })
    }
  }
  return items
}

function collectSelectBeatItems(nodeId: string): GraphTextItem[] {
  const items: GraphTextItem[] = []
  const seen = new Set<string>()
  const pushRow = (row: BeatRow): void => {
    if (!row.id || seen.has(row.id)) return
    seen.add(row.id)
    items.push({
      id: row.id,
      title: `#${row.order} ${row.title}`.trim(),
      text: formatBeatRefText(row)
    })
  }

  for (const edge of graph.edges) {
    if (edge.target !== nodeId) continue
    if ((edge.targetPort ?? 'in') !== 'in') continue
    const source = graph.nodes.find((n) => n.id === edge.source)
    if (!source) continue
    const sourcePort = edge.sourcePort ?? 'out'
    const runOut = runStates[source.id]?.outputs?.[sourcePort]
    const catalog =
      catalogTextFromValue(runOut, GraphPortType.beat) ||
      source.params.text?.trim() ||
      ''
    for (const row of parseBeatJson(catalog) ?? []) pushRow(row)
    if (source.assetId && (source.assetType === 'beat' || source.typeId === 'asset.beat')) {
      for (const row of loadBeatCatalog(source.assetId)) pushRow(row)
    }
  }
  return items
}

function onSelectTextOpen(nodeId: string): void {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  const isBeat = node.typeId === 'beat.select'
  const items = isBeat
    ? collectSelectBeatItems(nodeId)
    : collectSelectTextItems(nodeId)
  const selectedId = isBeat
    ? node.params.selectedBeatId?.trim() || ''
    : node.params.selectedTextId?.trim() || ''
  const selected =
    pickTextItem(items, selectedId) ?? (items[0] ? items[0] : undefined)
  selectText.open = true
  selectText.nodeId = nodeId
  selectText.title = isBeat
    ? t('graph.selectBeat.appMark')
    : nodeDisplayTitle(node)
  selectText.items = items
  selectText.selectedTextId = selected
    ? textItemKey(selected, Math.max(0, items.indexOf(selected)))
    : ''
}

function closeSelectText(): void {
  selectText.open = false
  selectText.nodeId = ''
  selectText.items = []
  selectText.selectedTextId = ''
}

async function saveSelectText(selectedTextId: string): Promise<void> {
  const nodeId = selectText.nodeId
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  const items = selectText.items
  const picked = pickTextItem(items, selectedTextId)
  const before = buildGraphJson()
  if (node.typeId === 'beat.select') {
    const beatId = picked?.id?.trim() || selectedTextId
    const text = picked?.text?.trim() || ''
    node.params = {
      ...node.params,
      selectedBeatId: beatId,
      text
    }
    selectText.selectedTextId = selectedTextId
    scheduleSave()
    recordGraphChange('select-beat', before)
    closeSelectText()
    return
  }
  let text = picked?.text?.trim() || ''
  const previewRelativePath = picked?.relativePath?.trim() || undefined
  if (!text && previewRelativePath) {
    try {
      text = (await readGraphRunText(previewRelativePath))?.trim() || ''
    } catch {
      text = ''
    }
  }
  node.params = {
    ...node.params,
    selectedTextId,
    text,
    previewRelativePath
  }
  selectText.selectedTextId = selectedTextId
  scheduleSave()
  recordGraphChange('select-text', before)
  closeSelectText()
}

const textsPreview = reactive({
  open: false,
  nodeId: '' as string,
  title: '',
  items: [] as GraphTextItem[]
})

function collectTextOutputItems(nodeId: string): GraphTextItem[] {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return []
  const fromRun = (items: GraphTextItem[] | undefined): GraphTextItem[] =>
    (items ?? []).filter((item) => item.text?.trim() || item.relativePath?.trim())

  const out = runStates[nodeId]?.outputs?.out
  if (out?.kind === 'texts' && out.items.length) return fromRun(out.items)
  if (out?.kind === 'output') {
    if (out.texts?.length) return fromRun(out.texts)
    if (out.notes.length) {
      return out.notes
        .map((note, index) => ({
          id: `note:${index}`,
          text: note.text
        }))
        .filter((item) => item.text.trim())
    }
  }

  // 未重跑输出时：回退读取上游剧本生成节点的累计 generatedTexts
  const upstreamTexts: GraphTextItem[] = []
  const seen = new Set<string>()
  for (const edge of graph.edges) {
    if (edge.target !== nodeId) continue
    const source = graph.nodes.find((n) => n.id === edge.source)
    if (!source) continue
    const generated = source.params.generatedTexts ?? []
    for (const [index, item] of generated.entries()) {
      if (!item.text?.trim() && !item.relativePath?.trim()) continue
      const key = item.id?.trim() || `${source.id}:${index}`
      if (seen.has(key)) continue
      seen.add(key)
      upstreamTexts.push({
        ...(item.id ? { id: item.id } : { id: key }),
        text: item.text ?? '',
        ...(item.createdAt ? { createdAt: item.createdAt } : {}),
        ...(item.relativePath ? { relativePath: item.relativePath } : {})
      })
    }
    const sourceOut = runStates[source.id]?.outputs?.out
    if (sourceOut?.kind === 'texts') {
      for (const [index, item] of sourceOut.items.entries()) {
        if (!item.text?.trim() && !item.relativePath?.trim()) continue
        const key = item.id?.trim() || `run:${source.id}:${index}`
        if (seen.has(key)) continue
        seen.add(key)
        upstreamTexts.push(item)
      }
    }
  }
  if (upstreamTexts.length) return upstreamTexts

  const resultText = node.params.resultText?.trim()
  if (resultText) return [{ id: 'resultText', text: resultText }]
  return []
}

function onTextsOpen(nodeId: string): void {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  textsPreview.nodeId = nodeId
  textsPreview.title = nodeDisplayTitle(node)
  textsPreview.items = collectTextOutputItems(nodeId)
  textsPreview.open = true
}

function closeTextsPreview(): void {
  textsPreview.open = false
  textsPreview.nodeId = ''
  textsPreview.title = ''
  textsPreview.items = []
}

const multiAngle = reactive({
  open: false,
  nodeId: '' as string,
  previewUrl: '' as string,
  panelPrompt: '' as string,
  camera: null as MultiAngleCameraState | null,
  generateModel: '' as string,
  generateProviderInstanceId: '' as string
})

async function resolveAssetFileUrl(relativePath?: string | null): Promise<string> {
  const path = relativePath?.trim()
  if (!path) return ''
  try {
    return await resolveCachedAssetFileUrl(path)
  } catch {
    return ''
  }
}

async function resolveNodeOwnPreviewUrl(nodeId: string): Promise<string> {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return ''
  const ownDataUrl = node.params.previewDataUrl?.trim()
  if (ownDataUrl) return ownDataUrl
  return resolveAssetFileUrl(node.params.previewRelativePath)
}

async function resolveNodeUpstreamPreviewUrl(nodeId: string): Promise<string> {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return ''

  for (const edge of graph.edges) {
    if (edge.target !== nodeId) continue
    if ((edge.targetPort ?? 'in') !== 'in') continue
    const source = graph.nodes.find((n) => n.id === edge.source)
    if (!source) continue

    const runOut = runStates[source.id]?.outputs?.out
    if (runOut) {
      for (const item of flattenImagesValues([runOut])) {
        if (item.dataUrl?.trim()) return item.dataUrl
        const url = await resolveAssetFileUrl(item.relativePath)
        if (url) return url
      }
      if (runOut.kind === 'asset' && runOut.assetType === 'image' && runOut.assetId) {
        const asset = project.assets.find((item) => item.id === runOut.assetId)
        const url = await resolveAssetFileUrl(asset?.thumbnailPath || asset?.relativePath)
        if (url) return url
      }
    }

    if (source.params.previewDataUrl?.trim()) return source.params.previewDataUrl
    const sourcePreview = await resolveAssetFileUrl(source.params.previewRelativePath)
    if (sourcePreview) return sourcePreview

    for (const shot of source.params.cameraShots ?? []) {
      if (shot.dataUrl?.trim()) return shot.dataUrl
      const url = await resolveAssetFileUrl(shot.relativePath)
      if (url) return url
    }

    if (source.assetType === 'image' && source.assetId) {
      const asset = project.assets.find((item) => item.id === source.assetId)
      const url = await resolveAssetFileUrl(asset?.thumbnailPath || asset?.relativePath)
      if (url) return url
    }

    if (source.assetType === 'motion' && source.assetId && source.params.assetRef) {
      const asset = project.assets.find((item) => item.id === source.assetId)
      for (const item of resolveMotionImageItems(
        asset?.genParams as Record<string, unknown> | undefined,
        source.params
      )) {
        if (item.dataUrl?.trim()) return item.dataUrl
        const url = await resolveAssetFileUrl(item.relativePath)
        if (url) return url
      }
    }
  }
  return ''
}

/**
 * 编辑窗源图。
 * preferUpstream：几何类编辑（裁剪、宫格、扩图、重绘等）的框选坐标要落在执行时的输入图上，
 * 节点自身预览是上一次的运行产物，只能作为兜底。
 */
async function resolveNodeEditorSourceUrl(
  nodeId: string,
  options?: { preferUpstream?: boolean }
): Promise<string> {
  if (options?.preferUpstream) {
    const upstream = await resolveNodeUpstreamPreviewUrl(nodeId)
    if (upstream) return upstream
    return resolveNodeOwnPreviewUrl(nodeId)
  }
  const own = await resolveNodeOwnPreviewUrl(nodeId)
  if (own) return own
  return resolveNodeUpstreamPreviewUrl(nodeId)
}

/** 编辑窗先打开，再异步填源图；关闭或换节点时丢弃过期结果 */
let editorSourceLoadSeq = 0
async function fillEditorSourceUrl(
  nodeId: string,
  assign: (url: string) => void,
  isCurrent: () => boolean,
  options?: { preferUpstream?: boolean }
): Promise<void> {
  const seq = ++editorSourceLoadSeq
  const url = await resolveNodeEditorSourceUrl(nodeId, options)
  if (seq !== editorSourceLoadSeq || !isCurrent()) return
  assign(url)
}

async function onMultiAngleOpen(nodeId: string): Promise<void> {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  multiAngle.nodeId = nodeId
  multiAngle.camera = readMultiAngleCameraFromNode(node.params)
  multiAngle.panelPrompt = node.params.text ?? ''
  multiAngle.generateModel = node.params.generateModel ?? ''
  multiAngle.generateProviderInstanceId = node.params.generateProviderInstanceId ?? ''
  multiAngle.previewUrl = ''
  multiAngle.open = true
  await fillEditorSourceUrl(
    nodeId,
    (url) => {
      multiAngle.previewUrl = url
    },
    () => multiAngle.open && multiAngle.nodeId === nodeId
  )
}

function closeMultiAngle(): void {
  multiAngle.open = false
  multiAngle.nodeId = ''
  multiAngle.previewUrl = ''
  multiAngle.panelPrompt = ''
  multiAngle.camera = null
  multiAngle.generateModel = ''
  multiAngle.generateProviderInstanceId = ''
}

function applyMultiAngleParams(
  payload: ReturnType<typeof multiAngleCameraToNodePatch> & {
    text: string
    generateModel: string
    generateProviderInstanceId: string
  },
  options?: { refreshUpstreamPreview?: boolean }
): void {
  const nodeId = multiAngle.nodeId
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  const { text, generateModel, generateProviderInstanceId, ...cameraPatch } = payload

  let previewDataUrl = node.params.previewDataUrl
  let previewRelativePath = node.params.previewRelativePath
  if (options?.refreshUpstreamPreview) {
    for (const edge of graph.edges) {
      if (edge.target !== nodeId) continue
      if ((edge.targetPort ?? 'in') !== 'in') continue
      const source = graph.nodes.find((n) => n.id === edge.source)
      if (!source) continue
      if (source.params.previewDataUrl?.trim()) {
        previewDataUrl = source.params.previewDataUrl
      }
      if (source.params.previewRelativePath?.trim()) {
        previewRelativePath = source.params.previewRelativePath
      }
      if (source.assetType === 'image' && source.assetId) {
        const asset = project.assets.find((item) => item.id === source.assetId)
        const path = asset?.thumbnailPath || asset?.relativePath
        if (path?.trim()) previewRelativePath = path
      }
      const runOut = runStates[source.id]?.outputs?.out
      if (runOut) {
        const item = flattenImagesValues([runOut])[0]
        if (item?.dataUrl?.trim()) previewDataUrl = item.dataUrl
        if (item?.relativePath?.trim()) previewRelativePath = item.relativePath
      }
    }
  }

  node.params = {
    ...node.params,
    ...cameraPatch,
    text,
    generateModel,
    generateProviderInstanceId,
    previewDataUrl,
    previewRelativePath
  }
  scheduleSave()
  graphEditorHosts.bumpRevision()
}

function previewMultiAngle(
  payload: ReturnType<typeof multiAngleCameraToNodePatch> & {
    text: string
    generateModel: string
    generateProviderInstanceId: string
  }
): void {
  applyMultiAngleParams(payload)
}

function saveMultiAngle(
  payload: ReturnType<typeof multiAngleCameraToNodePatch> & {
    text: string
    generateModel: string
    generateProviderInstanceId: string
  }
): void {
  const nodeId = multiAngle.nodeId
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  const before = buildGraphJson()
  applyMultiAngleParams(payload, { refreshUpstreamPreview: true })
  multiAngle.camera = payload.multiAngleCamera
  multiAngle.panelPrompt = payload.text
  multiAngle.generateModel = payload.generateModel
  multiAngle.generateProviderInstanceId = payload.generateProviderInstanceId
  recordGraphChange('multi-angle', before)
  closeMultiAngle()
}

const lighting = reactive({
  open: false,
  nodeId: '' as string,
  previewUrl: '' as string,
  setup: null as LightingSetupState | null,
  generateModel: '' as string,
  generateProviderInstanceId: '' as string
})

async function onLightingOpen(nodeId: string): Promise<void> {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  lighting.nodeId = nodeId
  lighting.setup = readLightingSetupFromNode(node.params)
  lighting.generateModel = node.params.generateModel ?? ''
  lighting.generateProviderInstanceId = node.params.generateProviderInstanceId ?? ''
  lighting.previewUrl = ''
  lighting.open = true
  await fillEditorSourceUrl(
    nodeId,
    (url) => {
      lighting.previewUrl = url
    },
    () => lighting.open && lighting.nodeId === nodeId
  )
}

function closeLighting(): void {
  lighting.open = false
  lighting.nodeId = ''
  lighting.previewUrl = ''
  lighting.setup = null
  lighting.generateModel = ''
  lighting.generateProviderInstanceId = ''
}

function applyLightingParams(
  payload: ReturnType<typeof lightingSetupToNodePatch> & {
    generateModel: string
    generateProviderInstanceId: string
  },
  options?: { refreshUpstreamPreview?: boolean }
): void {
  const nodeId = lighting.nodeId
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  const { generateModel, generateProviderInstanceId, ...setupPatch } = payload

  let previewDataUrl = node.params.previewDataUrl
  let previewRelativePath = node.params.previewRelativePath
  if (options?.refreshUpstreamPreview) {
    for (const edge of graph.edges) {
      if (edge.target !== nodeId) continue
      if ((edge.targetPort ?? 'in') !== 'in') continue
      const source = graph.nodes.find((n) => n.id === edge.source)
      if (!source) continue
      if (source.params.previewDataUrl?.trim()) {
        previewDataUrl = source.params.previewDataUrl
      }
      if (source.params.previewRelativePath?.trim()) {
        previewRelativePath = source.params.previewRelativePath
      }
      if (source.assetType === 'image' && source.assetId) {
        const asset = project.assets.find((item) => item.id === source.assetId)
        const path = asset?.thumbnailPath || asset?.relativePath
        if (path?.trim()) previewRelativePath = path
      }
      const runOut = runStates[source.id]?.outputs?.out
      if (runOut) {
        const item = flattenImagesValues([runOut])[0]
        if (item?.dataUrl?.trim()) previewDataUrl = item.dataUrl
        if (item?.relativePath?.trim()) previewRelativePath = item.relativePath
      }
    }
  }

  node.params = {
    ...node.params,
    ...setupPatch,
    generateModel,
    generateProviderInstanceId,
    previewDataUrl,
    previewRelativePath
  }
  scheduleSave()
  graphEditorHosts.bumpRevision()
}

function previewLighting(
  payload: ReturnType<typeof lightingSetupToNodePatch> & {
    generateModel: string
    generateProviderInstanceId: string
  }
): void {
  applyLightingParams(payload)
}

function saveLighting(
  payload: ReturnType<typeof lightingSetupToNodePatch> & {
    generateModel: string
    generateProviderInstanceId: string
  }
): void {
  const nodeId = lighting.nodeId
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  const before = buildGraphJson()
  applyLightingParams(payload, { refreshUpstreamPreview: true })
  lighting.setup = payload.lightingSetup
  lighting.generateModel = payload.generateModel
  lighting.generateProviderInstanceId = payload.generateProviderInstanceId
  recordGraphChange('lighting', before)
  closeLighting()
}

const framePull = reactive({
  open: false,
  hostId: '' as string,
  nodeId: '' as string
})

function onFramePullOpen(nodeId: string): void {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  framePull.hostId = graphHostId.value
  framePull.nodeId = nodeId
  framePull.open = true
}

function closeFramePull(): void {
  framePull.open = false
  framePull.hostId = ''
  framePull.nodeId = ''
}

const reshoot = reactive({
  open: false,
  hostId: '' as string,
  nodeId: '' as string
})

function onReshootOpen(nodeId: string): void {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  reshoot.hostId = graphHostId.value
  reshoot.nodeId = nodeId
  reshoot.open = true
}

function closeReshoot(): void {
  reshoot.open = false
  reshoot.hostId = ''
  reshoot.nodeId = ''
}

const portraitTexture = reactive({
  open: false,
  nodeId: '' as string,
  setup: null as PortraitTextureState | null,
  generateModel: '' as string,
  generateProviderInstanceId: '' as string
})

function onPortraitTextureOpen(nodeId: string): void {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  portraitTexture.nodeId = nodeId
  portraitTexture.setup = readPortraitTextureFromNode(node.params)
  portraitTexture.generateModel = node.params.generateModel ?? ''
  portraitTexture.generateProviderInstanceId = node.params.generateProviderInstanceId ?? ''
  portraitTexture.open = true
}

function closePortraitTexture(): void {
  portraitTexture.open = false
  portraitTexture.nodeId = ''
  portraitTexture.setup = null
  portraitTexture.generateModel = ''
  portraitTexture.generateProviderInstanceId = ''
}

function applyPortraitTextureParams(
  payload: ReturnType<typeof portraitTextureToNodePatch> & {
    generateModel: string
    generateProviderInstanceId: string
  }
): void {
  const nodeId = portraitTexture.nodeId
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  const { generateModel, generateProviderInstanceId, ...setupPatch } = payload
  node.params = {
    ...node.params,
    ...setupPatch,
    generateModel,
    generateProviderInstanceId
  }
  scheduleSave()
  graphEditorHosts.bumpRevision()
}

function previewPortraitTexture(
  payload: ReturnType<typeof portraitTextureToNodePatch> & {
    generateModel: string
    generateProviderInstanceId: string
  }
): void {
  applyPortraitTextureParams(payload)
}

function savePortraitTexture(
  payload: ReturnType<typeof portraitTextureToNodePatch> & {
    generateModel: string
    generateProviderInstanceId: string
  }
): void {
  const nodeId = portraitTexture.nodeId
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  const before = buildGraphJson()
  applyPortraitTextureParams(payload)
  portraitTexture.setup = payload.portraitTexture
  portraitTexture.generateModel = payload.generateModel
  portraitTexture.generateProviderInstanceId = payload.generateProviderInstanceId
  recordGraphChange('portrait-texture', before)
  closePortraitTexture()
}

const emotion = reactive({
  open: false,
  nodeId: '' as string,
  previewUrl: '' as string,
  setup: null as EmotionPadState | null,
  generateModel: '' as string,
  generateProviderInstanceId: '' as string
})

async function onEmotionOpen(nodeId: string): Promise<void> {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  emotion.nodeId = nodeId
  emotion.setup = readEmotionPadFromNode(node.params)
  emotion.generateModel = node.params.generateModel ?? ''
  emotion.generateProviderInstanceId = node.params.generateProviderInstanceId ?? ''
  emotion.previewUrl = ''
  emotion.open = true
  await fillEditorSourceUrl(
    nodeId,
    (url) => {
      emotion.previewUrl = url
    },
    () => emotion.open && emotion.nodeId === nodeId
  )
}

function closeEmotion(): void {
  emotion.open = false
  emotion.nodeId = ''
  emotion.previewUrl = ''
  emotion.setup = null
  emotion.generateModel = ''
  emotion.generateProviderInstanceId = ''
}

function applyEmotionParams(
  payload: ReturnType<typeof emotionPadToNodePatch> & {
    generateModel: string
    generateProviderInstanceId: string
  },
  options?: { refreshUpstreamPreview?: boolean }
): void {
  const nodeId = emotion.nodeId
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  const { generateModel, generateProviderInstanceId, ...emotionPatch } = payload

  let previewDataUrl = node.params.previewDataUrl
  let previewRelativePath = node.params.previewRelativePath
  if (options?.refreshUpstreamPreview) {
    for (const edge of graph.edges) {
      if (edge.target !== nodeId) continue
      if ((edge.targetPort ?? 'in') !== 'in') continue
      const source = graph.nodes.find((n) => n.id === edge.source)
      if (!source) continue
      if (source.params.previewDataUrl?.trim()) {
        previewDataUrl = source.params.previewDataUrl
      }
      if (source.params.previewRelativePath?.trim()) {
        previewRelativePath = source.params.previewRelativePath
      }
      if (source.assetType === 'image' && source.assetId) {
        const asset = project.assets.find((item) => item.id === source.assetId)
        const path = asset?.thumbnailPath || asset?.relativePath
        if (path?.trim()) previewRelativePath = path
      }
      const runOut = runStates[source.id]?.outputs?.out
      if (runOut) {
        const item = flattenImagesValues([runOut])[0]
        if (item?.dataUrl?.trim()) previewDataUrl = item.dataUrl
        if (item?.relativePath?.trim()) previewRelativePath = item.relativePath
      }
    }
  }

  node.params = {
    ...node.params,
    ...emotionPatch,
    generateModel,
    generateProviderInstanceId,
    previewDataUrl,
    previewRelativePath
  }
  scheduleSave()
  graphEditorHosts.bumpRevision()
}

function previewEmotion(
  payload: ReturnType<typeof emotionPadToNodePatch> & {
    generateModel: string
    generateProviderInstanceId: string
  }
): void {
  applyEmotionParams(payload)
}

function saveEmotion(
  payload: ReturnType<typeof emotionPadToNodePatch> & {
    generateModel: string
    generateProviderInstanceId: string
  }
): void {
  const nodeId = emotion.nodeId
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  const before = buildGraphJson()
  applyEmotionParams(payload, { refreshUpstreamPreview: true })
  emotion.setup = payload.emotionPad
  emotion.generateModel = payload.generateModel
  emotion.generateProviderInstanceId = payload.generateProviderInstanceId
  recordGraphChange('emotion', before)
  closeEmotion()
}

const expand = reactive({
  open: false,
  nodeId: '' as string,
  setup: null as ImageExpandState | null,
  sourceUrl: '',
  sourceLoading: false,
  generateModel: '',
  generateProviderInstanceId: ''
})

async function onExpandOpen(nodeId: string): Promise<void> {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  expand.nodeId = nodeId
  expand.setup = readImageExpandFromNode(node.params)
  expand.sourceUrl = ''
  expand.sourceLoading = true
  expand.generateModel = node.params.generateModel ?? ''
  expand.generateProviderInstanceId = node.params.generateProviderInstanceId ?? ''
  expand.open = true
  await fillEditorSourceUrl(
    nodeId,
    (url) => {
      expand.sourceUrl = url
      expand.sourceLoading = false
    },
    () => expand.open && expand.nodeId === nodeId,
    { preferUpstream: true }
  )
  if (expand.open && expand.nodeId === nodeId) expand.sourceLoading = false
}

function closeExpand(): void {
  expand.open = false
  expand.nodeId = ''
  expand.setup = null
  expand.sourceUrl = ''
  expand.sourceLoading = false
  expand.generateModel = ''
  expand.generateProviderInstanceId = ''
}

function previewExpand(payload: {
  imageExpand: ImageExpandState
  generateModel: string
  generateProviderInstanceId: string
}): void {
  const node = graph.nodes.find((n) => n.id === expand.nodeId)
  if (!node) return
  node.params = { ...node.params, ...payload }
  scheduleSave()
  graphEditorHosts.bumpRevision()
}

function saveExpand(payload: {
  imageExpand: ImageExpandState
  generateModel: string
  generateProviderInstanceId: string
}): void {
  const nodeId = expand.nodeId
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  const before = buildGraphJson()
  node.params = {
    ...node.params,
    ...payload
  }
  expand.setup = payload.imageExpand
  expand.generateModel = payload.generateModel
  expand.generateProviderInstanceId = payload.generateProviderInstanceId
  scheduleSave()
  graphEditorHosts.bumpRevision()
  recordGraphChange('expand', before)
  closeExpand()
}

const redraw = reactive({
  open: false,
  nodeId: '' as string,
  setup: null as ImageRedrawState | null,
  sourceUrl: '',
  sourceLoading: false,
  generateModel: '',
  generateProviderInstanceId: ''
})

async function onRedrawOpen(nodeId: string): Promise<void> {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  redraw.nodeId = nodeId
  redraw.setup = readImageRedrawFromNode(node.params)
  redraw.sourceUrl = ''
  redraw.sourceLoading = true
  redraw.generateModel = node.params.generateModel ?? ''
  redraw.generateProviderInstanceId = node.params.generateProviderInstanceId ?? ''
  redraw.open = true
  await fillEditorSourceUrl(
    nodeId,
    (url) => {
      redraw.sourceUrl = url
      redraw.sourceLoading = false
    },
    () => redraw.open && redraw.nodeId === nodeId,
    { preferUpstream: true }
  )
  if (redraw.open && redraw.nodeId === nodeId) redraw.sourceLoading = false
}

function closeRedraw(): void {
  redraw.open = false
  redraw.nodeId = ''
  redraw.setup = null
  redraw.sourceUrl = ''
  redraw.sourceLoading = false
  redraw.generateModel = ''
  redraw.generateProviderInstanceId = ''
}

function previewRedraw(payload: {
  imageRedraw?: ImageRedrawState
  imageErase?: ImageEraseState
  imageMatte?: ImageMatteState
  generateModel: string
  generateProviderInstanceId: string
}): void {
  if (!payload.imageRedraw) return
  const node = graph.nodes.find((n) => n.id === redraw.nodeId)
  if (!node) return
  node.params = {
    ...node.params,
    imageRedraw: payload.imageRedraw,
    generateModel: payload.generateModel,
    generateProviderInstanceId: payload.generateProviderInstanceId
  }
  scheduleSave()
  graphEditorHosts.bumpRevision()
}

function applyRedrawPayload(payload: {
  imageRedraw: ImageRedrawState
  generateModel: string
  generateProviderInstanceId: string
}): string | null {
  const nodeId = redraw.nodeId
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return null
  const before = buildGraphJson()
  node.params = {
    ...node.params,
    ...payload
  }
  redraw.setup = payload.imageRedraw
  redraw.generateModel = payload.generateModel
  redraw.generateProviderInstanceId = payload.generateProviderInstanceId
  scheduleSave()
  graphEditorHosts.bumpRevision()
  recordGraphChange('redraw', before)
  return nodeId
}

function saveRedraw(payload: {
  imageRedraw?: ImageRedrawState
  imageErase?: ImageEraseState
  generateModel: string
  generateProviderInstanceId: string
}): void {
  if (!payload.imageRedraw) return
  if (
    !applyRedrawPayload({
      imageRedraw: payload.imageRedraw,
      generateModel: payload.generateModel,
      generateProviderInstanceId: payload.generateProviderInstanceId
    })
  )
    return
  closeRedraw()
}

const erase = reactive({
  open: false,
  nodeId: '' as string,
  setup: null as ImageEraseState | null,
  sourceUrl: '',
  sourceLoading: false,
  generateModel: '',
  generateProviderInstanceId: ''
})

async function onEraseOpen(nodeId: string): Promise<void> {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  erase.nodeId = nodeId
  erase.setup = readImageEraseFromNode(node.params)
  erase.sourceUrl = ''
  erase.sourceLoading = true
  erase.generateModel = node.params.generateModel ?? ''
  erase.generateProviderInstanceId = node.params.generateProviderInstanceId ?? ''
  erase.open = true
  await fillEditorSourceUrl(
    nodeId,
    (url) => {
      erase.sourceUrl = url
      erase.sourceLoading = false
    },
    () => erase.open && erase.nodeId === nodeId,
    { preferUpstream: true }
  )
  if (erase.open && erase.nodeId === nodeId) erase.sourceLoading = false
}

function closeErase(): void {
  erase.open = false
  erase.nodeId = ''
  erase.setup = null
  erase.sourceUrl = ''
  erase.sourceLoading = false
  erase.generateModel = ''
  erase.generateProviderInstanceId = ''
}

function previewErase(payload: {
  imageErase?: ImageEraseState
  imageRedraw?: ImageRedrawState
  imageMatte?: ImageMatteState
  generateModel: string
  generateProviderInstanceId: string
}): void {
  if (!payload.imageErase) return
  const node = graph.nodes.find((n) => n.id === erase.nodeId)
  if (!node) return
  node.params = {
    ...node.params,
    imageErase: payload.imageErase,
    generateModel: payload.generateModel,
    generateProviderInstanceId: payload.generateProviderInstanceId
  }
  scheduleSave()
  graphEditorHosts.bumpRevision()
}

function applyErasePayload(payload: {
  imageErase: ImageEraseState
  generateModel: string
  generateProviderInstanceId: string
}): string | null {
  const nodeId = erase.nodeId
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return null
  const before = buildGraphJson()
  node.params = {
    ...node.params,
    ...payload
  }
  erase.setup = payload.imageErase
  erase.generateModel = payload.generateModel
  erase.generateProviderInstanceId = payload.generateProviderInstanceId
  scheduleSave()
  graphEditorHosts.bumpRevision()
  recordGraphChange('erase', before)
  return nodeId
}

function saveErase(payload: {
  imageErase?: ImageEraseState
  imageRedraw?: ImageRedrawState
  imageMatte?: ImageMatteState
  generateModel: string
  generateProviderInstanceId: string
}): void {
  if (!payload.imageErase) return
  if (
    !applyErasePayload({
      imageErase: payload.imageErase,
      generateModel: payload.generateModel,
      generateProviderInstanceId: payload.generateProviderInstanceId
    })
  )
    return
  closeErase()
}

const matte = reactive({
  open: false,
  nodeId: '' as string,
  setup: null as ImageMatteState | null,
  sourceUrl: '',
  sourceLoading: false,
  generateModel: '',
  generateProviderInstanceId: ''
})

async function onMatteOpen(nodeId: string): Promise<void> {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  matte.nodeId = nodeId
  matte.setup = readImageMatteFromNode(node.params)
  matte.sourceUrl = ''
  matte.sourceLoading = true
  matte.generateModel = node.params.generateModel ?? ''
  matte.generateProviderInstanceId = node.params.generateProviderInstanceId ?? ''
  matte.open = true
  await fillEditorSourceUrl(
    nodeId,
    (url) => {
      matte.sourceUrl = url
      matte.sourceLoading = false
    },
    () => matte.open && matte.nodeId === nodeId,
    { preferUpstream: true }
  )
  if (matte.open && matte.nodeId === nodeId) matte.sourceLoading = false
}

function closeMatte(): void {
  matte.open = false
  matte.nodeId = ''
  matte.setup = null
  matte.sourceUrl = ''
  matte.sourceLoading = false
  matte.generateModel = ''
  matte.generateProviderInstanceId = ''
}

function previewMatte(payload: {
  imageErase?: ImageEraseState
  imageRedraw?: ImageRedrawState
  imageMatte?: ImageMatteState
  generateModel: string
  generateProviderInstanceId: string
}): void {
  if (!payload.imageMatte) return
  const node = graph.nodes.find((n) => n.id === matte.nodeId)
  if (!node) return
  node.params = {
    ...node.params,
    imageMatte: payload.imageMatte,
    generateModel: payload.generateModel,
    generateProviderInstanceId: payload.generateProviderInstanceId
  }
  scheduleSave()
  graphEditorHosts.bumpRevision()
}

function applyMattePayload(payload: {
  imageMatte: ImageMatteState
  generateModel: string
  generateProviderInstanceId: string
}): string | null {
  const nodeId = matte.nodeId
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return null
  const before = buildGraphJson()
  node.params = {
    ...node.params,
    ...payload
  }
  matte.setup = payload.imageMatte
  matte.generateModel = payload.generateModel
  matte.generateProviderInstanceId = payload.generateProviderInstanceId
  scheduleSave()
  graphEditorHosts.bumpRevision()
  recordGraphChange('matte', before)
  return nodeId
}

function saveMatte(payload: {
  imageErase?: ImageEraseState
  imageRedraw?: ImageRedrawState
  imageMatte?: ImageMatteState
  generateModel: string
  generateProviderInstanceId: string
}): void {
  if (!payload.imageMatte) return
  if (
    !applyMattePayload({
      imageMatte: payload.imageMatte,
      generateModel: payload.generateModel,
      generateProviderInstanceId: payload.generateProviderInstanceId
    })
  )
    return
  closeMatte()
}

const crop = reactive({
  open: false,
  nodeId: '' as string,
  setup: null as ImageCropState | null,
  sourceUrl: '',
  sourceLoading: false
})

async function onCropOpen(nodeId: string): Promise<void> {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  crop.nodeId = nodeId
  crop.setup = readImageCropFromNode(node.params)
  crop.sourceUrl = ''
  crop.sourceLoading = true
  crop.open = true
  await fillEditorSourceUrl(
    nodeId,
    (url) => {
      crop.sourceUrl = url
      crop.sourceLoading = false
    },
    () => crop.open && crop.nodeId === nodeId,
    { preferUpstream: true }
  )
  if (crop.open && crop.nodeId === nodeId) crop.sourceLoading = false
}

function closeCrop(): void {
  crop.open = false
  crop.nodeId = ''
  crop.setup = null
  crop.sourceUrl = ''
  crop.sourceLoading = false
}

function previewCrop(payload: { imageCrop: ImageCropState }): void {
  const node = graph.nodes.find((n) => n.id === crop.nodeId)
  if (!node) return
  node.params = { ...node.params, ...payload }
  scheduleSave()
  graphEditorHosts.bumpRevision()
}

function saveCrop(payload: { imageCrop: ImageCropState }): void {
  const nodeId = crop.nodeId
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  const before = buildGraphJson()
  node.params = {
    ...node.params,
    ...payload
  }
  crop.setup = payload.imageCrop
  scheduleSave()
  graphEditorHosts.bumpRevision()
  recordGraphChange('crop', before)
  closeCrop()
}

const gridSplit = reactive({
  open: false,
  nodeId: '' as string,
  setup: null as ImageGridSplitState | null,
  sourceUrl: '',
  sourceLoading: false
})

async function onGridSplitOpen(nodeId: string): Promise<void> {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  gridSplit.nodeId = nodeId
  gridSplit.setup = readImageGridSplitFromNode(node.params)
  gridSplit.sourceUrl = ''
  gridSplit.sourceLoading = true
  gridSplit.open = true
  await fillEditorSourceUrl(
    nodeId,
    (url) => {
      gridSplit.sourceUrl = url
      gridSplit.sourceLoading = false
    },
    () => gridSplit.open && gridSplit.nodeId === nodeId,
    { preferUpstream: true }
  )
  if (gridSplit.open && gridSplit.nodeId === nodeId) gridSplit.sourceLoading = false
}

function closeGridSplit(): void {
  gridSplit.open = false
  gridSplit.nodeId = ''
  gridSplit.setup = null
  gridSplit.sourceUrl = ''
  gridSplit.sourceLoading = false
}

function previewGridSplit(payload: { imageGridSplit: ImageGridSplitState }): void {
  const node = graph.nodes.find((n) => n.id === gridSplit.nodeId)
  if (!node) return
  node.params = { ...node.params, ...payload }
  scheduleSave()
  graphEditorHosts.bumpRevision()
}

function saveGridSplit(payload: { imageGridSplit: ImageGridSplitState }): void {
  const nodeId = gridSplit.nodeId
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return
  const before = buildGraphJson()
  node.params = {
    ...node.params,
    ...payload
  }
  gridSplit.setup = payload.imageGridSplit
  scheduleSave()
  graphEditorHosts.bumpRevision()
  recordGraphChange('gridSplit', before)
  closeGridSplit()
}

/** Dialog：选取器 + 文本预览；图片/视频预览走全局 MediaPreviewDialog；图片编辑等仅 Dive */
const graphDialogsApi = {
  notepad,
  selectImage,
  selectVideo,
  selectVoice,
  selectText,
  textsPreview,
  multiAngle,
  lighting,
  framePull,
  reshoot,
  portraitTexture,
  emotion,
  expand,
  redraw,
  erase,
  matte,
  crop,
  gridSplit,
  closeTextNotepad,
  saveTextNotepad,
  closeSelectImage,
  saveSelectImage,
  closeSelectVideo,
  saveSelectVideo,
  closeSelectVoice,
  saveSelectVoice,
  closeSelectText,
  saveSelectText,
  closeTextsPreview,
  closeMultiAngle,
  previewMultiAngle,
  saveMultiAngle,
  closeLighting,
  previewLighting,
  saveLighting,
  closeFramePull,
  closeReshoot,
  closePortraitTexture,
  previewPortraitTexture,
  savePortraitTexture,
  closeEmotion,
  previewEmotion,
  saveEmotion,
  closeExpand,
  previewExpand,
  saveExpand,
  closeRedraw,
  previewRedraw,
  saveRedraw,
  closeErase,
  previewErase,
  saveErase,
  closeMatte,
  previewMatte,
  saveMatte,
  closeCrop,
  previewCrop,
  saveCrop,
  closeGridSplit,
  previewGridSplit,
  saveGridSplit
} as GraphEditorDialogsApi

provide(graphEditorDialogsKey, graphDialogsApi)

/** 非 ref：避免起手/松手时 Vue 重渲染整棵节点树 */
let isPanning = false
let panStart = { x: 0, y: 0 }
let panViewport = { x: 0, y: 0 }
let panPointerId: number | null = null

function syncViewportPanningClass(): void {
  rootEl.value?.classList.toggle('viewport-panning', isPanning || spacePan)
}

function onPanMove(e: PointerEvent): void {
  if (!isPanning) return
  if (panPointerId != null && e.pointerId !== panPointerId) return
  // 只记坐标，rAF 合帧写 transform，避免 pointermove 超过刷新率时重复 paint
  liveViewport.x = panViewport.x + (e.clientX - panStart.x)
  liveViewport.y = panViewport.y + (e.clientY - panStart.y)
  applyViewportTransform()
}

function onPanEnd(e?: PointerEvent): void {
  if (e && panPointerId != null && e.pointerId !== panPointerId) return
  const host = viewportEl.value
  if (host && panPointerId != null) {
    try {
      host.releasePointerCapture(panPointerId)
    } catch {
      /* already released */
    }
  }
  panPointerId = null
  isPanning = false
  spacePan = false
  syncViewportPanningClass()
  endTransientPanToolHighlight()
  window.removeEventListener('pointermove', onPanMove)
  window.removeEventListener('pointerup', onPanEnd)
  window.removeEventListener('pointercancel', onPanEnd)
  // 抬手立刻落最后一帧，避免松手时差一帧
  if (viewportTransformRaf) {
    cancelAnimationFrame(viewportTransformRaf)
    flushViewportTransform()
  }
  scheduleViewportGestureIdle()
}

function beginViewportPan(e: PointerEvent): void {
  // 阻断中键默认「自动滚动」模式，否则刚按下会明显顿一下
  e.preventDefault()
  e.stopPropagation()
  beginViewportGesture()
  isPanning = true
  // 中键平移：工具栏临时高亮「平移」，松手还原
  if (e.button === 1) beginTransientPanToolHighlight()
  syncViewportPanningClass()
  panPointerId = e.pointerId
  panStart = { x: e.clientX, y: e.clientY }
  panViewport = { x: liveViewport.x, y: liveViewport.y }
  const host = viewportEl.value
  if (host) {
    try {
      host.setPointerCapture(e.pointerId)
    } catch {
      /* capture unsupported */
    }
  }
  // passive: true — move 仅更新数值，不 preventDefault
  window.addEventListener('pointermove', onPanMove, { passive: true })
  window.addEventListener('pointerup', onPanEnd)
  window.addEventListener('pointercancel', onPanEnd)
}

function onWindowMouseDown(e: MouseEvent): void {
  const target = e.target as HTMLElement | null
  if (target?.closest('.ctx-menu')) return
  if (target?.closest('.radial-menu')) return
  closeCtxMenu()
  if (radialMenu.value) closeRadialMenu()
}

function onKeyDown(e: KeyboardEvent): void {
  // dive / 后台保活时画布被 v-show 隐藏但仍挂载：全局快捷键必须只响应可见画布，
  // 否则在子层按 Delete/Backspace 会误删外层仍处于选中状态的节点（如 world.gen）。
  if (!isGraphViewportVisible()) return
  if (e.code === 'Escape' && radialMenu.value) {
    e.preventDefault()
    closeRadialMenu()
    return
  }
  if (e.code === 'KeyC' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (!isEditableKeyTarget(e.target)) {
      if (radialMenu.value) {
        e.preventDefault()
        return
      }
      if (openRadialMenuAtPointer()) {
        e.preventDefault()
        return
      }
    }
  }
  if (e.code === 'Space' && !e.repeat) {
    if (!isEditableKeyTarget(e.target)) {
      // 菜单已开时再次空格关闭；否则在画布空白处打开
      if (ctxMenu.value) {
        e.preventDefault()
        closeCtxMenu()
        return
      }
      if (radialMenu.value) {
        e.preventDefault()
        closeRadialMenu()
        return
      }
      if (tryOpenCtxMenuAtPointer()) {
        e.preventDefault()
        return
      }
    }
    spacePan = true
    syncViewportPanningClass()
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'g') {
    if (isEditableKeyTarget(e.target)) return
    e.preventDefault()
    if (canGroupSelection.value) groupSelectedNodes()
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'u') {
    if (isEditableKeyTarget(e.target)) return
    e.preventDefault()
    if (canUngroupSelection.value) ungroupSelectedNodes()
    return
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'c') {
    if (isEditableKeyTarget(e.target)) return
    if (!pointerOverViewport.value && workspace.selectedGraphHostId !== graphHostId.value) return
    e.preventDefault()
    copySelectedNodes()
    return
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a') {
    if (isEditableKeyTarget(e.target)) return
    if (!pointerOverViewport.value && workspace.selectedGraphHostId !== graphHostId.value) return
    e.preventDefault()
    selectAllNodes()
    return
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'v') {
    if (isEditableKeyTarget(e.target)) return
    if (!pointerOverViewport.value && workspace.selectedGraphHostId !== graphHostId.value) return
    e.preventDefault()
    void pasteClipboardNodes()
    return
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (isEditableKeyTarget(e.target)) return
    if (selectedEdgeIds.value.size > 0) {
      deleteSelectedEdges()
      return
    }
    deleteSelectedNodes()
  }
}

function isGraphViewportVisible(): boolean {
  const el = viewportEl.value
  if (!el) return false
  return el.offsetParent !== null || el.getClientRects().length > 0
}

function onKeyUp(e: KeyboardEvent): void {
  if (e.code === 'Space') {
    spacePan = false
    syncViewportPanningClass()
  }
  if (e.code === 'KeyC' && radialMenu.value) {
    e.preventDefault()
    commitRadialMenu()
  }
}

function deleteSelectedEdges(): void {
  if (selectedEdgeIds.value.size === 0) return
  const before = buildGraphJson()
  const ids = selectedEdgeIds.value
  graph.edges = graph.edges.filter((edge) => !ids.has(edge.id))
  selectedEdgeIds.value = new Set()
  scheduleSave()
  recordGraphChange('delete-edges', before)
  graphEditorHosts.bumpRevision()
}

function deleteSelectedNodes(): void {
  if (selectedNodeIds.value.size === 0) return
  const ids = selectedNodeIds.value
  const deletableIds = new Set(
    graph.nodes.filter((node) => ids.has(node.id) && isNodeDeletable(node)).map((node) => node.id)
  )
  if (deletableIds.size === 0) return
  const before = buildGraphJson()
  const deletedDirectorIds = before.nodes
    .filter((node) => deletableIds.has(node.id) && isDirectorProcessingNode(node))
    .map((node) => node.id)
  graph.nodes = graph.nodes.filter((node) => !deletableIds.has(node.id))
  graph.edges = graph.edges.filter(
    (edge) => !deletableIds.has(edge.source) && !deletableIds.has(edge.target)
  )
  pruneGraphGroups()
  clearSelection()
  recordGraphChange('delete-nodes', before)
  graphEditorHosts.bumpRevision()
  if (deletedDirectorIds.length) {
    removeStagesForNodeIds(deletedDirectorIds, buildGraphJson())
    editor.documents.markDirty(activeDocumentId())
  } else {
    scheduleSave()
  }
}

function copySelectedNodes(): void {
  if (selectedNodeIds.value.size === 0) {
    showDropError(t('graph.context.copyEmpty'))
    return
  }
  const { payload } = buildGraphClipboardPayload(buildGraphJson(), selectedNodeIds.value)
  if (!payload) {
    showDropError(t('graph.context.copyNone'))
    return
  }
  setMemoryGraphClipboard(payload)
  graphClipboardEpoch.value += 1
  void navigator.clipboard?.writeText?.(serializeGraphClipboardPayload(payload)).catch(() => {
    /* 无权限时仅保留内存剪贴板 */
  })
}

async function resolvePastePayload(): Promise<GraphClipboardPayload | null> {
  const memory = getMemoryGraphClipboard()
  if (memory) return memory
  try {
    const text = await navigator.clipboard?.readText?.()
    if (!text) return null
    const parsed = parseGraphClipboardPayload(text)
    if (parsed) {
      setMemoryGraphClipboard(parsed)
      graphClipboardEpoch.value += 1
    }
    return parsed
  } catch {
    return null
  }
}

async function pasteClipboardNodes(): Promise<void> {
  const payload = await resolvePastePayload()
  if (!payload) {
    showDropError(t('graph.context.pasteEmpty'))
    return
  }
  const generation = bumpGraphPasteGeneration()
  const offset = {
    x: GRAPH_CLIPBOARD_PASTE_OFFSET * generation,
    y: GRAPH_CLIPBOARD_PASTE_OFFSET * generation
  }
  const before = buildGraphJson()
  const result = applyGraphClipboardPayload(before, payload, { offset })
  if (!result.pastedNodeIds.length) {
    if (result.skippedHostCount > 0) {
      showDropError(t('graph.context.pasteSkippedHost', { n: result.skippedHostCount }))
    } else {
      showDropError(t('graph.context.pasteEmpty'))
    }
    return
  }
  replaceGraphDocument(graph, result.document)
  setMarqueeSelection(result.pastedNodeIds, [])
  refreshGraphRenderWindow(true)
  requestPreviewVisibilityUpdate()
  requestEdgeRender()
  scheduleSave()
  recordGraphChange('paste-nodes', before)
  graphEditorHosts.bumpRevision()
  if (result.skippedHostCount > 0) {
    showDropError(t('graph.context.pasteSkippedHost', { n: result.skippedHostCount }))
  }
}

watch(
  () => graphAsset.value?.id,
  () => {
    loadGraphFromAsset()
    applyViewportTransform(true)
    requestPreviewVisibilityUpdate()
  }
)

/** 已打开的宿主面板再次激活（双击宿主 / 切回面板）时重新注入外层输入 */
watch(
  () => (props.assetId ? workspace.hostInputSlotSyncNonce[props.assetId] ?? 0 : 0),
  (nonce, prev) => {
    if (!nonce || nonce === prev) return
    syncHostInputSlotsFromParents()
  },
  { immediate: true }
)

let resizeObserver: ResizeObserver | null = null
let unregisterGraphDocument: (() => void) | null = null
let unregisterGraphHost: (() => void) | null = null
let unregisterGraphRunHost: (() => void) | null = null
let unregisterNodeTypes: (() => void) | null = null
let unregisterNodeTools: (() => void) | null = null

function registerNodeToolHost(): void {
  unregisterNodeTools?.()
  unregisterNodeTools = graphEditorNodeTools.register(graphHostId.value, {
    api: graphDialogsApi,
    openers: {
      'node.notepad': (nodeId) => onTextOpen(nodeId),
      'node.textsPreview': (nodeId) => onTextsOpen(nodeId),
      'node.selectImage': (nodeId) => onSelectImageOpen(nodeId),
      'node.selectVideo': (nodeId) => onSelectVideoOpen(nodeId),
      'node.selectVoice': (nodeId) => onSelectVoiceOpen(nodeId),
      'node.selectText': (nodeId) => onSelectTextOpen(nodeId),
      'node.multiAngle': (nodeId) => onMultiAngleOpen(nodeId),
      'node.lighting': (nodeId) => onLightingOpen(nodeId),
      'node.framePull': (nodeId) => onFramePullOpen(nodeId),
      'node.reshoot': (nodeId) => onReshootOpen(nodeId),
      'node.portraitTexture': (nodeId) => onPortraitTextureOpen(nodeId),
      'node.emotion': (nodeId) => onEmotionOpen(nodeId),
      'node.expand': (nodeId) => onExpandOpen(nodeId),
      'node.redraw': (nodeId) => onRedrawOpen(nodeId),
      'node.erase': (nodeId) => onEraseOpen(nodeId),
      'node.matte': (nodeId) => onMatteOpen(nodeId),
      'node.crop': (nodeId) => onCropOpen(nodeId),
      'node.gridSplit': (nodeId) => onGridSplitOpen(nodeId)
    }
  })
}

onMounted(() => {
  unregisterNodeTypes = onNodeTypeRegistryChanged(() => {
    nodeTypeRevision.value += 1
  })
  // 节点工具宿主先注册：即使后续加载/初始化抛错，双击 dive 工具仍可用
  registerNodeToolHost()
  try {
    loadGraphFromAsset()
  } catch (err) {
    console.error('[NodeGraphEditor] loadGraphFromAsset failed', err)
  }
  syncLiveViewportFromGraph()
  resizeEdgeCanvas()
  applyViewportTransform(true)
  updatePreviewVisibility()
  unregisterGraphDocument = editor.documents.register({
    id: graphDocumentId.value,
    save: () => persistGraph(),
    autoSaveEnabled: () => editorPreferences.autoSaveEnabled.value,
    autoSaveDelayMs: () => editorPreferences.autoSaveIntervalSec.value * 1000
  })
  resizeObserver = new ResizeObserver(() => {
    syncViewportHostSize()
    refreshGraphRenderWindow(true)
    resizeEdgeCanvas()
    renderEdgesNow()
    requestPreviewVisibilityUpdate()
  })
  if (viewportEl.value) {
    syncViewportHostSize()
    resizeObserver.observe(viewportEl.value)
  }
  unregisterGraphHost = graphEditorHosts.register(
    graphHostId.value,
    {
      getNode: (nodeId) => graph.nodes.find((n) => n.id === nodeId) ?? null,
      findNode: (predicate) => graph.nodes.find(predicate) ?? null,
      getDocument: () => cloneGraphDocument(buildGraphJson()),
      getGroup: (groupId) => graph.groups?.find((group) => group.id === groupId) ?? null,
      getGroupMemberIds: (groupId) =>
        graph.nodes.filter((node) => node.groupId === groupId).map((node) => node.id),
      listIncomingEdges: (nodeId, portId) =>
        buildIncomingEdgeRefs(graph.edges, nodeId, portId),
      removeEdge: (edgeId) => removeGraphEdge(edgeId),
      reorderIncomingEdges: (nodeId, orderedEdgeIds) =>
        reorderGraphIncomingEdges(nodeId, orderedEdgeIds),
      updateNode: (nodeId, params, title) => {
        const node = graph.nodes.find((n) => n.id === nodeId)
        if (!node) return
        const before = buildGraphJson()
        node.params = { ...node.params, ...params }
        if (title !== undefined) node.title = title
        scheduleSave()
        recordGraphChange('update-node', before)
      },
      updateGroup: (groupId, patch) => {
        const group = graph.groups?.find((item) => item.id === groupId)
        if (!group) return
        const before = buildGraphJson()
        if (patch.title !== undefined) group.title = patch.title
        scheduleSave()
        recordGraphChange('update-group', before)
      },
      setNodeAsset: (nodeId, asset) => setNodeAsset(nodeId, asset),
      applyExternalGraph: (document) => {
        applyGraphDocument(document)
        applyViewportTransform(true)
        requestPreviewVisibilityUpdate()
        commitAssetGraph()
      },
      flush: () => flushSave()
    },
  )
  unregisterGraphRunHost = graphRunHosts.register(graphHostId.value, {
    runStates,
    isRunning,
    runningTargetNodeId,
    runToNode: guardedRunToNode,
    stopWorkflow,
    toggleNodeRun: onNodeRunToggle
  })
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('mousedown', onWindowMouseDown)
  window.addEventListener('blur', closeRadialMenu)
  // 中键自动滚动由 mousedown 默认行为触发；pointerdown.preventDefault 对鼠标无效，
  // 必须在 mousedown 上拦截。用捕获阶段：若子元素（节点卡片/画布）在 mousedown 上
  // stopPropagation，冒泡阶段的拦截就收不到事件，Chromium 会进入自动滚动模式，
  // 表现为“按下中键后要等一会儿才变成手形可拖动”。捕获阶段可保证最先执行、稳定压制。
  rootEl.value?.addEventListener(
    'mousedown',
    (e) => {
      if (e.button === 1) e.preventDefault()
    },
    { passive: false, capture: true }
  )
  rootEl.value?.addEventListener(
    'pointerdown',
    (e) => {
      const target = e.target as HTMLElement | null
      // 顶栏/浮动工具条上的点击不进平移，避免切工具时误拖画布
      if (
        target?.closest(
          '.graph-toolbar, .layout-float, .graph-minimap, .ctx-menu, .radial-menu, .run-banner'
        )
      ) {
        return
      }
      if (e.button === 1 || (isLeftButtonPanArmed() && e.button === 0)) {
        beginViewportPan(e)
      }
    },
    { passive: false, capture: true }
  )
  // 部分环境中键抬起仍会触发 auxclick / 自动滚动入口
  rootEl.value?.addEventListener(
    'auxclick',
    (e) => {
      if (e.button === 1) e.preventDefault()
    },
    { passive: false, capture: true }
  )
})

onBeforeUnmount(() => {
  if (dropErrorTimer) clearTimeout(dropErrorTimer)
  if (isPanning) onPanEnd()
  // 切单元 / 关面板会销毁画布：先停跑，避免会话悬空表现为「运行卡死」
  stopWorkflow()
  if (viewportSaveTimer) {
    clearTimeout(viewportSaveTimer)
    viewportSaveTimer = null
  }
  if (viewportTransformRaf) {
    cancelAnimationFrame(viewportTransformRaf)
    viewportTransformRaf = 0
  }
  if (edgeRenderRaf) {
    cancelAnimationFrame(edgeRenderRaf)
    edgeRenderRaf = 0
  }
  if (edgeFlowRaf) {
    cancelAnimationFrame(edgeFlowRaf)
    edgeFlowRaf = 0
  }
  if (edgeHoverRaf) {
    cancelAnimationFrame(edgeHoverRaf)
    edgeHoverRaf = 0
  }
  if (viewportGestureIdleTimer) {
    clearTimeout(viewportGestureIdleTimer)
    viewportGestureIdleTimer = null
  }
  if (previewVisibilityRaf) {
    cancelAnimationFrame(previewVisibilityRaf)
    previewVisibilityRaf = 0
  }
  clearAssetUrlCaches()
  resizeObserver?.disconnect()
  graphNodeInteraction.dispose()
  if (workspace.selectedGraphHostId === graphHostId.value) {
    workspace.selectGraphNode(null, graphHostId.value)
  }
  unregisterNodeTools?.()
  unregisterNodeTools = null
  unregisterGraphHost?.()
  unregisterGraphHost = null
  unregisterGraphRunHost?.()
  unregisterGraphRunHost = null
  unregisterNodeTypes?.()
  unregisterNodeTypes = null
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('mousedown', onWindowMouseDown)
  window.removeEventListener('blur', closeRadialMenu)
  unregisterGraphDocument?.()
  unregisterGraphDocument = null
  // 工程已切换：丢弃本实例的落盘，避免旧参数污染新工程
  if (project.rootPath !== boundRootPath) return
  try {
    // 资产图（剧本等）：关闭前必定把含执行状态的 graphJson 落盘
    void persistGraph().catch((err) => {
      console.error('[NodeGraphEditor] unmount persist failed', err)
    })
  } catch (err) {
    console.error('[NodeGraphEditor] unmount commit failed', err)
  }
})

function getGraphDocument(): GraphDocument {
  return buildGraphJson()
}

defineExpose({
  flushSave,
  getGraphDocument,
  runWorkflow,
  runToNode: guardedRunToNode,
  stopWorkflow,
  lastRunResult
})
</script>

<style scoped>
.node-graph {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--graph-bg);
  overflow: hidden;
}

.graph-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
  flex-shrink: 0;
  min-width: 0;
}

.graph-toolbar > .hint {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.run-banner {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 4px 10px;
  font-size: 11px;
  border-bottom: 1px solid var(--border);
  background: var(--graph-run-banner-bg);
  color: var(--text-muted);
  cursor: pointer;
}

.run-banner-text {
  min-width: 0;
  flex: 1;
}

.run-banner-log {
  flex-shrink: 0;
  padding: 2px 8px;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  border-radius: 4px;
  background: var(--wash-04);
  color: inherit;
  font-size: 11px;
  cursor: pointer;
}

.run-banner-log:hover {
  background: var(--wash-08);
}

.run-banner.ok {
  color: #7dcea0;
  background: rgba(46, 125, 80, 0.12);
}

.run-banner.error {
  color: var(--danger-muted);
  background: rgba(140, 50, 50, 0.18);
}

.hint {
  font-size: 11px;
  color: var(--text-muted);
  min-width: 0;
}

.tools {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-shrink: 0;
}

.tools button {
  font-size: 11px;
  padding: 3px 8px;
}

.tools .edge-style-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
}

.tools .edge-style-btn .edge-style-label {
  line-height: 1;
  white-space: nowrap;
}

.tools .play-control {
  padding: 0;
  overflow: visible;
}

.play-control {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  width: 28px;
  height: 28px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 0;
  color: var(--text-muted);
  box-shadow: none;
  overflow: visible;
}

.play-control:hover:not(:disabled) {
  background: transparent;
  border-color: transparent;
  color: var(--text);
}

.play-control.playing,
.play-control.playing:hover:not(:disabled) {
  background: transparent;
  border-color: transparent;
  color: var(--text);
}

.play-glyph {
  box-sizing: border-box;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  flex-shrink: 0;
  overflow: visible;
}

.play-control:hover:not(:disabled) .play-glyph {
  border-color: var(--accent);
  background: var(--bg-hover);
}

.play-control.playing .play-glyph {
  border-color: var(--accent);
  background: var(--bg-hover);
}

.play-label {
  font-size: 11px;
  line-height: 24px;
  white-space: nowrap;
  color: var(--text);
}

.icon-play {
  display: block;
  width: 0;
  height: 0;
  margin-left: 2px;
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  border-left: 8px solid currentColor;
  opacity: 1;
}

.icon-stop {
  display: block;
  width: 9px;
  height: 9px;
  border-radius: 1px;
  background: currentColor;
  opacity: 1;
}

.tools button.active {
  border-color: var(--warning);
  color: var(--warning);
}

.tool-mode-group {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 1px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: color-mix(in srgb, var(--bg-panel) 72%, transparent);
}

.tool-mode-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 28px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: var(--text-muted);
}

.tool-mode-btn:hover:not(:disabled) {
  color: var(--text);
  background: var(--bg-hover);
  border-color: transparent;
}

.tools .tool-mode-btn.active {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.zoom {
  font-size: 11px;
  color: var(--text-muted);
  min-width: 36px;
  text-align: right;
}

.graph-viewport {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--graph-viewport-bg);
}

.graph-viewport.grid-off {
  background: var(--graph-viewport-bg);
}

.grid-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1;
  overflow: hidden;
}

.grid-layer.hidden {
  visibility: hidden;
}

.grid-pattern {
  position: absolute;
  /* 固定 overscan：相位靠 translate3d，缩放时不再改 left/top，避免逐帧 reflow */
  inset: -480px;
  pointer-events: none;
  will-change: transform;
  background-repeat: repeat;
}

.grid-pattern-minor {
  background-image: linear-gradient(
      to right,
      var(--graph-grid-minor) 1px,
      transparent 1px
    ),
    linear-gradient(to bottom, var(--graph-grid-minor) 1px, transparent 1px);
}

.grid-pattern-major {
  background-image: linear-gradient(
      to right,
      var(--graph-grid-major) 1px,
      transparent 1px
    ),
    linear-gradient(to bottom, var(--graph-grid-major) 1px, transparent 1px);
}

.graph-world {
  position: absolute;
  left: 0;
  top: 0;
  /* 0 尺寸 + overflow 可见：合成层边界仅为可见节点并集，杜绝超大 GPU 图层 */
  width: 0;
  height: 0;
  transform-origin: 0 0;
  z-index: 4;
  overflow: visible;
  will-change: transform;
}

/* 分组框层：位于边 Canvas 之下 */
.graph-world-back {
  z-index: 2;
}

/* 边绘制层：屏幕坐标 Canvas（带 overscan，left/top/尺寸由 JS 设定），
   位于分组之上、节点之下。纯平移时靠 transform 位移，故声明 will-change。 */
.edges-canvas {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  z-index: 3;
  will-change: transform;
}

.graph-group {
  position: absolute;
  border: 1px dashed rgba(100, 170, 255, 0.45);
  border-radius: 10px;
  background: rgba(70, 130, 210, 0.05);
  pointer-events: none;
  z-index: 0;
  transition:
    left 0.15s ease,
    top 0.15s ease,
    width 0.15s ease,
    height 0.15s ease;
}

.graph-group.live {
  transition: none;
}

.graph-group.selected {
  border-color: rgba(120, 190, 255, 0.88);
  background: rgba(80, 150, 255, 0.1);
  box-shadow: 0 0 0 1px rgba(80, 150, 255, 0.12) inset;
}

.graph-group-label {
  position: absolute;
  top: -18px;
  left: 10px;
  max-width: calc(100% - 20px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--text-muted);
  pointer-events: auto;
  cursor: grab;
  user-select: none;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--panel-glass);
  border: 1px solid rgba(100, 170, 255, 0.25);
}

.graph-group.selected .graph-group-label {
  color: var(--accent);
  border-color: rgba(120, 190, 255, 0.45);
}

.graph-group-label-input {
  position: absolute;
  top: -18px;
  left: 10px;
  width: min(180px, calc(100% - 20px));
  font-size: 11px;
  color: var(--text);
  pointer-events: auto;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--bg-panel);
  border: 1px solid rgba(120, 190, 255, 0.55);
  outline: none;
}

.graph-viewport.drop-over {
  outline: 2px dashed var(--accent);
  outline-offset: -2px;
}

.node-graph.tool-pan .graph-viewport {
  cursor: grab;
}

.node-graph.viewport-panning .graph-viewport {
  cursor: grabbing;
}

.graph-viewport.selecting {
  cursor: crosshair;
}

.graph-viewport.dragging-nodes,
.graph-viewport.dragging-nodes :deep(.graph-node) {
  cursor: grabbing;
}

/* 手势期进入低成本合成模式：动态视频、阴影和毛玻璃最容易迫使 Chromium 重栅格化。 */
.node-graph.viewport-gesturing :deep(.graph-node),
.node-graph.viewport-gesturing :deep(.graph-note) {
  box-shadow: none !important;
}

.node-graph.viewport-gesturing :deep(.graph-node video) {
  visibility: hidden;
}

.node-graph.viewport-gesturing :deep(.graph-node .transport) {
  backdrop-filter: none !important;
}

.selection-marquee {
  position: absolute;
  z-index: 20;
  pointer-events: none;
  border: 1px solid rgba(100, 170, 255, 0.95);
  background: rgba(80, 150, 255, 0.12);
  box-shadow: 0 0 0 1px rgba(20, 40, 80, 0.35) inset;
}

.ctx-menu {
  position: fixed;
  z-index: 4000;
  min-width: 168px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ctx-title {
  font-size: 10px;
  color: var(--text-muted);
  padding: 4px 10px 2px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.ctx-port-type,
.ctx-item-type {
  font-size: 10px;
  color: var(--accent);
  opacity: 0.9;
}

.ctx-item-type {
  margin-left: auto;
  flex-shrink: 0;
}

.ctx-empty {
  font-size: 11px;
  color: var(--text-muted);
  padding: 8px 10px;
}

.ctx-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  color: var(--text);
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.2;
  box-sizing: border-box;
}

.ctx-menu button:hover:not(:disabled),
.ctx-submenu-trigger.open {
  background: var(--bg-hover);
  border-color: transparent;
}

.ctx-menu button:disabled {
  opacity: 0.45;
  cursor: default;
}

.ctx-submenu-trigger.pinned {
  background: color-mix(in srgb, var(--accent) 18%, var(--bg-hover));
}

.ctx-submenu {
  position: relative;
}

.ctx-submenu-trigger {
  width: 100%;
}

.ctx-submenu-arrow {
  margin-left: auto;
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: 14px;
  line-height: 1;
}

.ctx-submenu-panel {
  position: absolute;
  left: 100%;
  top: -4px;
  min-width: 168px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 4001;
}

/* 桥接主菜单与子面板空隙，悬停移入时不易误关 */
.ctx-submenu-panel::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 10px;
  left: -10px;
}

.ctx-submenu-panel.open-left {
  left: auto;
  right: 100%;
}

.ctx-submenu-panel.open-left::before {
  left: auto;
  right: -10px;
}

.ctx-submenu-panel.open-up {
  top: auto;
  bottom: -4px;
}

.ctx-icon {
  flex: 0 0 18px;
  width: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  line-height: 1;
}

.ctx-label {
  flex: 1;
  min-width: 0;
  text-align: left;
}

.ctx-sep {
  height: 1px;
  background: var(--border);
  margin: 4px 6px;
}
</style>
