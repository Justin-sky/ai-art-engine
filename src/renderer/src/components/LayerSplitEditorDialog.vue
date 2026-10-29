<template>
  <StudioFloatingWindow
    :open="open"
    :title="windowTitle"
    :z-index="1200"
    :default-width="980"
    :default-height="680"
    :min-width="720"
    :min-height="480"
    body-class="pad-none"
    @close="onClose"
  >
    <div class="editor-root">
      <div class="topbar">
        <div class="sel-meta">
          <strong>{{ selectedLayer?.name || t('graph.layerSplit.noSelection') }}</strong>
          <span v-if="selectedLayer" class="z-tag">z {{ selectedLayer.zIndex }}</span>
        </div>
        <button type="button" class="tool-btn" :disabled="!canReorder" @click="reorder('down')">
          {{ t('graph.layerSplit.sendBack') }}
        </button>
        <button type="button" class="tool-btn" :disabled="!canReorder" @click="reorder('up')">
          {{ t('graph.layerSplit.bringForward') }}
        </button>
        <button type="button" class="tool-btn" :disabled="!baseLayer" @click="toggleBaseVisible">
          {{
            baseLayer && !baseLayer.visible
              ? t('graph.layerSplit.showBase')
              : t('graph.layerSplit.hideBase')
          }}
        </button>
        <button
          type="button"
          class="tool-btn"
          :disabled="!selectedLayer || isBase(selectedLayer)"
          @click="resetSelected"
        >
          {{ t('graph.layerSplit.resetPos') }}
        </button>
        <button type="button" class="tool-btn" :disabled="!draft.layers.length" @click="resetAll">
          {{ t('graph.layerSplit.resetAll') }}
        </button>
        <button
          type="button"
          class="tool-btn"
          :class="{ active: boxSliceActive }"
          :disabled="!hasCanvas || splitting || slicing"
          :title="t('graph.layerSplit.boxSliceHint')"
          @click="toggleBoxSliceMode"
        >
          {{
            boxSliceActive ? t('graph.layerSplit.boxSliceActive') : t('graph.layerSplit.boxSlice')
          }}
        </button>
        <button
          type="button"
          class="tool-btn"
          :disabled="!canSplitSelected"
          :title="splitDisabledReason"
          @click="onSplitSelected"
        >
          {{ splitting ? t('graph.layerSplit.splitting') : t('graph.layerSplit.splitSelected') }}
        </button>
        <button
          type="button"
          class="tool-btn"
          :disabled="!canDecomposeControlParts"
          :title="
            isZhLocale
              ? '按 HTML5 / Unity UI Toolkit 标准控件规范拆解选中控件的子结构（按钮文字+常态底板+按下态、滑动条轨道+填充+手柄、面板底框+标题+词条）'
              : 'Decompose selected UI control into standard HTML5 / Unity UI Toolkit sub-parts (Button label/normal/hover/pressed, Slider track/fill/thumb, Panel frame/title)'
          "
          @click="onDecomposeSelectedControlParts"
        >
          🧩 {{ isZhLocale ? '控件结构拆解' : 'Decompose Control' }}
        </button>
        <button
          type="button"
          class="tool-btn"
          :disabled="!canMergeDown"
          :title="t('graph.layerSplit.mergeDownHint')"
          @click="onMergeDownSelected"
        >
          {{ t('graph.layerSplit.mergeDown') }}
        </button>
        <button
          type="button"
          class="tool-btn danger-btn"
          :disabled="!canDeleteLayer"
          :title="t('graph.layerSplit.deleteLayerHint')"
          @click="onDeleteSelectedLayer"
        >
          {{ t('graph.layerSplit.deleteLayer') }}
        </button>
        <button
          type="button"
          class="tool-btn"
          :disabled="!hasCanvas || splitting"
          :title="t('graph.layerSplit.autoUiGroupHint')"
          @click="onAutoGroupUiLayers"
        >
          {{ t('graph.layerSplit.autoUiGroup') }}
        </button>
        <button
          type="button"
          class="tool-btn explode-3d-btn"
          :class="{ active: exploded3d }"
          :disabled="!hasCanvas"
          :title="
            isZhLocale
              ? '3D 全息图层爆炸视图（在背景拖拽可旋转视角）'
              : '3D Holographic Exploded Layer Stack (drag stage to orbit)'
          "
          @click="toggleExploded3d"
        >
          🧊 {{ isZhLocale ? '3D 爆炸' : '3D Explode' }}
        </button>
        <label
          v-if="exploded3d"
          class="explode-gap-ctl"
          :title="isZhLocale ? 'Z 轴层间距' : 'Z-Depth Gap'"
        >
          <span>Z</span>
          <input
            v-model.number="explodeGap"
            type="range"
            min="10"
            max="84"
            step="2"
            class="explode-slider"
          />
        </label>
        <span class="layer-count">
          {{ t('graph.layerSplit.layerCount', { n: draft.layers.length }) }}
        </span>
      </div>

      <div class="workspace">
        <div
          ref="stageEl"
          class="stage"
          tabindex="0"
          :class="{
            'space-pan': spaceHeld && hasCanvas,
            panning: pan.active || orbitDrag.active,
            'stage-exploded-3d': exploded3d
          }"
          @keydown="onKeydown"
          @dblclick.self="resetView"
          @wheel.prevent="onStageWheel"
          @pointerdown="onStagePanStart"
        >
          <div v-if="sourceLoading" class="stage-empty">
            {{ t('graph.editor.loadingSource') }}
          </div>
          <div v-else-if="!hasCanvas" class="stage-empty">
            {{ t('graph.layerSplit.needRun') }}
          </div>
          <div
            v-else
            ref="canvasWrapEl"
            class="canvas-wrap"
            :class="{ 'box-slice-mode': boxSliceActive, 'exploded-3d': exploded3d }"
            :style="canvasWrapStyle"
            @pointerdown="onCanvasWrapPointerDown"
            @dblclick.self="resetView"
          >
            <div v-if="splitting" class="stage-mask">
              {{ t('graph.layerSplit.splitting') }}
            </div>
            <div
              v-for="layer in stackedLayers"
              v-show="layerOnCanvas(layer)"
              :key="layer.id"
              class="layer"
              :class="{
                selected: layer.id === draft.selectedId,
                base: isBase(layer),
                'layer-exploded-3d': exploded3d
              }"
              :style="layerStyle(layer)"
              @pointerdown.stop="onLayerPointerDown($event, layer)"
            >
              <div
                v-if="
                  layer.visible &&
                  layerUrl(layer) &&
                  !isBase(layer) &&
                  nineSliceStretchMode &&
                  layerHasNineSlice(layer) &&
                  isLayerResizedFromOriginal(layer)
                "
                class="nine-slice-render"
                :style="nineSliceRenderStyle(layer)"
              />
              <img
                v-else-if="layer.visible && layerUrl(layer)"
                :src="layerUrl(layer)"
                alt=""
                draggable="false"
                decoding="async"
              />
              <span v-if="exploded3d" class="layer-3d-badge">
                z{{ layer.zIndex }} · {{ layerLabel(layer) }}
              </span>
              <template v-if="layer.id === draft.selectedId && !isBase(layer) && !exploded3d">
                <template v-if="showNineSliceGuides && layerHasNineSlice(layer)">
                  <span
                    class="nine-slice-guide v left"
                    :style="{ left: `${nineSliceGuidePct(layer, 'left')}%` }"
                  />
                  <span
                    class="nine-slice-guide v right"
                    :style="{ right: `${nineSliceGuidePct(layer, 'right')}%` }"
                  />
                  <span
                    class="nine-slice-guide h top"
                    :style="{ top: `${nineSliceGuidePct(layer, 'top')}%` }"
                  />
                  <span
                    class="nine-slice-guide h bottom"
                    :style="{ bottom: `${nineSliceGuidePct(layer, 'bottom')}%` }"
                  />
                </template>
                <span
                  v-for="handle in handles"
                  :key="handle"
                  class="handle"
                  :class="handle"
                  @pointerdown.stop="onHandlePointerDown($event, layer, handle)"
                />
              </template>
            </div>
            <div v-if="boxSliceDrag.active" class="box-slice-rect" :style="boxSliceRectStyle" />
          </div>
        </div>

        <aside class="sidebar">
          <div class="side-head">
            <div class="side-title">{{ t('graph.layerSplit.layers') }}</div>
            <div class="side-actions">
              <button
                type="button"
                class="icon-btn"
                :disabled="!canExportSelected"
                :title="t('graph.layerSplit.exportSelected')"
                :aria-label="t('graph.layerSplit.exportSelected')"
                @click="exportSelectedLayer"
              >
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <rect
                    x="3.2"
                    y="1.8"
                    width="9.6"
                    height="7"
                    rx="1.1"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.3"
                  />
                  <path
                    d="M8 9.2v4.5M5.8 12.2 8 14.4 10.2 12.2"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.3"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                class="icon-btn"
                :disabled="!canExportGroup"
                :title="t('graph.layerSplit.exportGroup')"
                :aria-label="t('graph.layerSplit.exportGroup')"
                @click="exportSelectedGroup"
              >
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <path
                    d="M2.6 4.2h3.1l1 1.2h6.7v6.8H2.6z"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.25"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M8 7.4v5.2M6.1 10.6 8 12.6 9.9 10.6"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.3"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                class="icon-btn"
                :disabled="!canExportAll"
                :title="t('graph.layerSplit.exportAll')"
                :aria-label="t('graph.layerSplit.exportAll')"
                @click="exportAllLayers"
              >
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                  <rect
                    x="4.4"
                    y="1.4"
                    width="8.4"
                    height="4.8"
                    rx="1"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.2"
                  />
                  <rect
                    x="2.8"
                    y="3.8"
                    width="8.4"
                    height="4.8"
                    rx="1"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.2"
                  />
                  <path
                    d="M8 9.4v4.4M6 12.3 8 14.4 10 12.3"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.3"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                class="icon-btn psd-btn"
                :disabled="!canExportAll"
                :title="t('graph.layerSplit.exportPsd')"
                :aria-label="t('graph.layerSplit.exportPsd')"
                @click="exportPsd"
              >
                PSD
              </button>
              <button
                type="button"
                class="icon-btn psd-btn"
                :disabled="!canExportAll"
                :title="
                  isZhLocale
                    ? '导出可点击交互的 HTML5 游戏 UI 原型（含音效与 3D 爆炸视图）'
                    : 'Export interactive HTML5 Game UI prototype (with click SFX & 3D Explode)'
                "
                @click="exportInteractiveHtmlPrototype"
              >
                HTML5
              </button>
              <button
                type="button"
                class="icon-btn psd-btn"
                :disabled="!hasCanvas || exporting"
                :title="t('graph.layerSplit.exportManifest')"
                :aria-label="t('graph.layerSplit.exportManifest')"
                @click="exportManifestJson"
              >
                {{ t('graph.layerSplit.exportManifestShort') }}
              </button>
            </div>
          </div>
          <div v-if="selectedLayer && !isBase(selectedLayer)" class="side-rename">
            <input
              type="text"
              class="rename-input"
              :value="selectedLayer.name"
              :placeholder="t('graph.layerSplit.renamePlaceholder')"
              @change="onRenameSelectedLayer"
            />
            <div class="side-nine-slice">
              <div class="nine-slice-head">
                <span class="nine-slice-title">
                  {{
                    isZhLocale ? '📏 九宫格切边 (L/T/R/B)' : '📏 9-Slice (L/T/R/B)'
                  }}<!-- cjk-ok -->
                </span>
                <div class="nine-slice-tools">
                  <button
                    type="button"
                    class="mini-pill"
                    :class="{ active: showNineSliceGuides }"
                    :title="
                      isZhLocale
                        ? '在画布选中图层上显示/隐藏九宫格切线' // cjk-ok
                        : 'Toggle 9-slice guide lines on stage'
                    "
                    @click="showNineSliceGuides = !showNineSliceGuides"
                  >
                    {{ isZhLocale ? '📐 切线' : '📐 Guides' }}<!-- cjk-ok -->
                  </button>
                  <button
                    type="button"
                    class="mini-pill"
                    :disabled="slicing"
                    :title="
                      isZhLocale
                        ? '按当前图层真实像素自动测算九宫格安全边距' // cjk-ok
                        : 'Auto-detect 9-slice borders from layer pixels'
                    "
                    @click="onAutoDetectSelectedNineSlice"
                  >
                    {{ isZhLocale ? '🔄 自动' : '🔄 Auto' }}<!-- cjk-ok -->
                  </button>
                </div>
              </div>
              <div class="nine-slice-grid">
                <label class="ns-cell">
                  <span>L</span>
                  <input
                    type="number"
                    min="0"
                    :max="Math.max(0, Math.floor(selectedLayer.width / 2))"
                    :value="selectedLayer.nineSliceBorders?.[0] ?? 0"
                    @change="onNineSliceBorderInput(0, $event)"
                  />
                </label>
                <label class="ns-cell">
                  <span>T</span>
                  <input
                    type="number"
                    min="0"
                    :max="Math.max(0, Math.floor(selectedLayer.height / 2))"
                    :value="selectedLayer.nineSliceBorders?.[1] ?? 0"
                    @change="onNineSliceBorderInput(1, $event)"
                  />
                </label>
                <label class="ns-cell">
                  <span>R</span>
                  <input
                    type="number"
                    min="0"
                    :max="Math.max(0, Math.floor(selectedLayer.width / 2))"
                    :value="selectedLayer.nineSliceBorders?.[2] ?? 0"
                    @change="onNineSliceBorderInput(2, $event)"
                  />
                </label>
                <label class="ns-cell">
                  <span>B</span>
                  <input
                    type="number"
                    min="0"
                    :max="Math.max(0, Math.floor(selectedLayer.height / 2))"
                    :value="selectedLayer.nineSliceBorders?.[3] ?? 0"
                    @change="onNineSliceBorderInput(3, $event)"
                  />
                </label>
              </div>
            </div>
          </div>
          <p v-if="exportMessage" class="side-export" :class="{ error: exportFailed }">
            {{ exportMessage }}
          </p>
          <div class="side-list">
            <p v-if="!draft.layers.length" class="side-empty">
              {{ t('graph.layerSplit.emptyLayers') }}
            </p>
            <p v-else-if="splitError" class="side-error">
              {{ splitError }}
            </p>
            <template v-for="row in listRows" :key="row.id">
              <button
                v-if="row.kind === 'group'"
                type="button"
                class="layer-row group-row"
                :class="{
                  active: row.group.id === selectedGroupId,
                  dim: row.group.visible === false
                }"
                :style="{ paddingLeft: `${6 + row.depth * 14}px` }"
                @click="selectGroup(row.group.id)"
              >
                <span
                  class="chevron"
                  :title="
                    row.group.collapsed
                      ? t('graph.layerSplit.expandGroup')
                      : t('graph.layerSplit.collapseGroup')
                  "
                  @click.stop="toggleGroupCollapsed(row.group.id)"
                  >{{ row.group.collapsed ? '▸' : '▾' }}</span
                >
                <span
                  class="eye"
                  :class="{ off: row.group.visible === false }"
                  :title="
                    row.group.visible === false
                      ? t('graph.layerSplit.showGroup')
                      : t('graph.layerSplit.hideGroup')
                  "
                  @click.stop="toggleGroupVisible(row.group.id)"
                  >{{ row.group.visible === false ? '🚫' : '👁' }}</span
                >
                <span class="row-meta">
                  <span class="row-name">{{ row.group.name }}</span>
                  <span class="row-z">{{ t('graph.layerSplit.group') }}</span>
                </span>
              </button>
              <button
                v-else
                type="button"
                class="layer-row"
                :class="{ active: row.layer.id === draft.selectedId, dim: !row.layer.visible }"
                :style="{ paddingLeft: `${6 + row.depth * 14}px` }"
                @click="draft.selectedId = row.layer.id"
              >
                <span
                  class="eye"
                  :class="{ off: !row.layer.visible }"
                  :title="
                    row.layer.visible
                      ? t('graph.layerSplit.hideLayer')
                      : t('graph.layerSplit.showLayer')
                  "
                  @click.stop="toggleVisible(row.layer.id)"
                  >{{ row.layer.visible ? '👁' : '🚫' }}</span
                >
                <img v-if="layerUrl(row.layer)" class="thumb" :src="layerUrl(row.layer)" alt="" />
                <span v-else class="thumb placeholder" />
                <span class="row-meta">
                  <span class="row-name">{{ layerLabel(row.layer) }}</span>
                  <span class="row-z">z {{ row.layer.zIndex }}</span>
                </span>
              </button>
            </template>
          </div>
        </aside>
      </div>

      <div class="bottom">
        <div class="prompt-col">
          <div class="preset-bar">
            <span class="preset-title">{{ t('graph.layerSplit.presets') }}:</span>
            <button
              v-for="preset in presetOptions"
              :key="preset.id"
              type="button"
              class="preset-chip"
              :class="{ active: draft.prompt.trim() === preset.prompt.trim() }"
              @click="draft.prompt = preset.prompt"
            >
              {{ preset.label }}
            </button>
          </div>
          <textarea
            v-model="draft.prompt"
            class="prompt"
            rows="2"
            :placeholder="t('graph.layerSplit.promptPlaceholder')"
          />
        </div>
        <div class="toolbar">
          <label class="tool tool-mode">
            <span class="tool-label">{{ t('graph.layerSplit.splitMode') }}</span>
            <select v-model="draft.splitMode" class="select">
              <option v-for="m in splitModeOptions" :key="m.id" :value="m.id">
                {{ m.label }}
              </option>
            </select>
          </label>
          <label
            v-if="draft.splitMode !== 'local-slice'"
            class="tool tool-model"
            :title="t('graph.layerSplit.visionModelHint')"
          >
            <span class="tool-label">{{ t('graph.layerSplit.visionModelLabel') }}</span>
            <select v-model="visionSelectionKey" class="select" @change="onVisionModelChange">
              <option value="">{{ t('graph.layerSplit.visionModelAuto') }}</option>
              <option v-for="opt in visionModelOptions" :key="opt.key" :value="opt.key">
                {{ opt.label }}
              </option>
            </select>
          </label>
          <label v-if="draft.splitMode !== 'local-slice'" class="tool tool-model">
            <span class="tool-label">{{ t('graph.inspector.generate.imageModel') }}</span>
            <select v-model="selectionKey" class="select" @change="onModelChange">
              <option v-for="opt in modelOptions" :key="opt.key" :value="opt.key">
                {{ opt.label }}
              </option>
              <option v-if="modelOptions.length === 0" value="">
                {{ t('graph.inspector.generate.noModels') }}
              </option>
            </select>
          </label>
          <label v-if="draft.splitMode !== 'local-slice'" class="tool">
            <span class="tool-label">{{ t('graph.layerSplit.resolution') }}</span>
            <select v-model="draft.resolution" class="select">
              <option v-for="r in resolutions" :key="r" :value="r">{{ r }}</option>
            </select>
          </label>
        </div>
      </div>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import {
  DEFAULT_IMAGE_LAYER_SPLIT,
  LAYER_SPLIT_RESOLUTIONS,
  UI_LAYER_SPLIT_PRESETS,
  applyMergedLayerSplitPair,
  autoGroupLayersForGameUi,
  buildGodotSceneTscn,
  buildInteractiveUiPrototypeHtml,
  buildLayerSplitList,
  buildLayerSplitUiManifest,
  buildUnityUguiEditorScriptCs,
  buildUnityUiToolkitUss,
  buildUnityUiToolkitUxml,
  collectLayerSplitGroupLayers,
  computeNineSliceFromRgbaBuffer,
  findMergeDownTargetLayer,
  layerSplitExportFolderSegments,
  imageLayerSplitToNodePatch,
  isLayerSplitBase,
  isLayerSplitLayerDrawable,
  layerSplitGroupForSource,
  nudgeLayerSplit,
  normalizeImageLayerSplit,
  removeLayerSplitLayer,
  renameLayerSplitItem,
  reorderLayerSplit,
  resetLayerSplitRect,
  sortLayersForCompose,
  toggleLayerSplitGroupCollapsed,
  toggleLayerSplitGroupVisible,
  type GraphImageItem,
  type ImageLayerSplitLayer,
  type ImageLayerSplitNestedRequest,
  type ImageLayerSplitState,
  type UiLayerSplitMode,
  type UiLayerSplitPresetId
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import {
  decomposeSingleLayerUrlToControlParts,
  mergeTwoLayerImagesToDataUrl,
  sliceUiLayerFromSourceCanvas,
  uiRgbaCodec
} from '../features/graph/model/composeImageLayerStack'
import {
  loadGenerateModelOptions,
  loadVisionModelOptions,
  preferredModelKey,
  type GenerateModelOption
} from '../features/graph/model/generateModelOptions'
import { layerSplitToPsdUint8Array } from '../features/graph/model/layerSplitPsd'
import { diveEditorHistory } from '../features/graph/ui/diveEditorHistory'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

export type LayerSplitEditorSavePayload = ReturnType<typeof imageLayerSplitToNodePatch> & {
  generateModel: string
  generateProviderInstanceId: string
  visionModel?: string
  visionProviderInstanceId?: string
  extraGeneratedImages?: GraphImageItem[]
}

type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se'

const props = withDefaults(
  defineProps<{
    open: boolean
    setup?: Partial<ImageLayerSplitState> | null
    sourceUrl?: string
    sourceLoading?: boolean
    layerUrls?: Record<string, string>
    generateModel?: string
    generateProviderInstanceId?: string
    visionModel?: string
    visionProviderInstanceId?: string
    splitting?: boolean
    splitError?: string
  }>(),
  {
    setup: null,
    sourceUrl: '',
    sourceLoading: false,
    layerUrls: () => ({}),
    generateModel: '',
    generateProviderInstanceId: '',
    visionModel: '',
    visionProviderInstanceId: '',
    splitting: false,
    splitError: ''
  }
)

const emit = defineEmits<{
  close: []
  update: [payload: LayerSplitEditorSavePayload]
  save: [payload: LayerSplitEditorSavePayload]
  'split-selected': [payload: ImageLayerSplitNestedRequest]
}>()

const { t, locale } = useStudioI18n()
const isZhLocale = computed(() =>
  String(locale.value || '')
    .toLowerCase()
    .startsWith('zh')
)
const windowTitle = computed(() => t('graph.layerSplit.appMark'))
const draft = reactive<ImageLayerSplitState>(normalizeImageLayerSplit())
const stageEl = ref<HTMLElement | null>(null)
const canvasWrapEl = ref<HTMLElement | null>(null)
const display = reactive({ w: 480, h: 480 })
const ZOOM_MIN = 0.2
const ZOOM_MAX = 8
const ZOOM_STEP = 1.1
const STAGE_PAD = 16
const zoom = ref(1)
const spaceHeld = ref(false)
const panOffset = reactive({ x: 0, y: 0 })
const pan = reactive({
  active: false,
  startX: 0,
  startY: 0,
  originX: 0,
  originY: 0
})
const exploded3d = ref(false)
const explodeGap = ref(34)
const orbitRotX = ref(18)
const orbitRotY = ref(-24)
const orbitDrag = reactive({
  active: false,
  startX: 0,
  startY: 0,
  originRotX: 18,
  originRotY: -24
})
const hydrating = ref(false)
const exporting = ref(false)
const slicing = ref(false)
const boxSliceActive = ref(false)
const boxSliceDrag = reactive({
  active: false,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0
})
const localLayerUrls = reactive<Record<string, string>>({})
const extraImages = ref<GraphImageItem[]>([])
const exportMessage = ref('')
const exportFailed = ref(false)
const modelOptions = ref<GenerateModelOption[]>([])
const selectionKey = ref('')
const selectedModel = ref('')
const selectedProviderInstanceId = ref('')
const visionModelOptions = ref<GenerateModelOption[]>([])
const visionSelectionKey = ref('')
const selectedVisionModel = ref('')
const selectedVisionProviderInstanceId = ref('')
const handles: ResizeHandle[] = ['nw', 'ne', 'sw', 'se']
const resolutions = LAYER_SPLIT_RESOLUTIONS
let previewTimer: ReturnType<typeof setTimeout> | null = null
let exportMsgTimer: ReturnType<typeof setTimeout> | null = null
const localHistory = reactive({
  undo: [] as ImageLayerSplitState[],
  redo: [] as ImageLayerSplitState[],
  applying: false
})

const canUndo = computed(() => localHistory.undo.length > 0)
const canRedo = computed(() => localHistory.redo.length > 0)

type DragKind = 'move' | 'resize'
const drag = reactive<{
  kind: DragKind | null
  id: string
  handle: ResizeHandle | null
  startX: number
  startY: number
  origin: ImageLayerSplitLayer | null
}>({
  kind: null,
  id: '',
  handle: null,
  startX: 0,
  startY: 0,
  origin: null
})

const dirty = computed(() => {
  const a = normalizeImageLayerSplit(props.setup)
  const b = normalizeImageLayerSplit(draft)
  return (
    JSON.stringify(a) !== JSON.stringify(b) ||
    extraImages.value.length > 0 ||
    selectedModel.value !== (props.generateModel ?? '') ||
    selectedProviderInstanceId.value !== (props.generateProviderInstanceId ?? '') ||
    selectedVisionModel.value !== (props.visionModel ?? '') ||
    selectedVisionProviderInstanceId.value !== (props.visionProviderInstanceId ?? '')
  )
})

const hasCanvas = computed(
  () => draft.layers.length > 0 && draft.canvasWidth > 0 && draft.canvasHeight > 0
)
const stackedLayers = computed(() => sortLayersForCompose(draft.layers))
const listRows = computed(() => buildLayerSplitList(draft))
const selectedLayer = computed(
  () => draft.layers.find((layer) => layer.id === draft.selectedId) ?? null
)
const selectedGroupId = computed(() => {
  const layer = selectedLayer.value
  if (!layer) return ''
  return layer.groupId || layerSplitGroupForSource(draft, layer.id)?.id || ''
})
const baseLayer = computed(() => draft.layers.find((layer) => isLayerSplitBase(layer)) ?? null)
const canReorder = computed(() => {
  const layer = selectedLayer.value
  return !!layer && !isLayerSplitBase(layer)
})
const splitting = computed(() => props.splitting === true)
const splitError = computed(() => props.splitError?.trim() || '')
const alreadySplitSource = computed(() => {
  const layer = selectedLayer.value
  return !!layer && !!layerSplitGroupForSource(draft, layer.id)
})
const canSplitSelected = computed(() => {
  const layer = selectedLayer.value
  return (
    !!layer &&
    !splitting.value &&
    !slicing.value &&
    !alreadySplitSource.value &&
    hasCanvas.value &&
    !props.sourceLoading
  )
})
const canDeleteLayer = computed(() => {
  const layer = selectedLayer.value
  return !!layer && !isLayerSplitBase(layer) && !splitting.value && !slicing.value
})
const canDecomposeControlParts = computed(() => {
  const layer = selectedLayer.value
  return (
    !!layer && !isLayerSplitBase(layer) && !splitting.value && !slicing.value && !!layerUrl(layer)
  )
})
const mergeDownTarget = computed(() =>
  selectedLayer.value ? findMergeDownTargetLayer(draft, selectedLayer.value.id) : null
)
const canMergeDown = computed(() => {
  const upper = selectedLayer.value
  const lower = mergeDownTarget.value
  return (
    !splitting.value &&
    !slicing.value &&
    !!upper &&
    !!lower &&
    !!layerUrl(upper) &&
    !!layerUrl(lower)
  )
})
const splitDisabledReason = computed(() => {
  if (splitting.value) return t('graph.layerSplit.splitting')
  if (!selectedLayer.value) return t('graph.layerSplit.splitNeedLayer')
  if (alreadySplitSource.value) return t('graph.layerSplit.splitAlready')
  return ''
})
const canExportSelected = computed(() => {
  const layer = selectedLayer.value
  return !exporting.value && !!layer && !!layerUrl(layer)
})
const selectedGroupLayers = computed(() =>
  selectedGroupId.value ? collectLayerSplitGroupLayers(draft, selectedGroupId.value) : []
)
const canExportGroup = computed(
  () =>
    !exporting.value &&
    !!selectedGroupId.value &&
    selectedGroupLayers.value.some((layer) => !!layerUrl(layer))
)
const canExportAll = computed(
  () => !exporting.value && draft.layers.some((layer) => !!layerUrl(layer))
)

const canvasWrapStyle = computed(() => {
  const baseTransform = `translate(${Math.round(panOffset.x)}px, ${Math.round(panOffset.y)}px)`
  if (exploded3d.value) {
    return {
      width: `${Math.round(display.w * zoom.value)}px`,
      height: `${Math.round(display.h * zoom.value)}px`,
      transformStyle: 'preserve-3d' as const,
      transform: `${baseTransform} rotateX(${orbitRotX.value}deg) rotateY(${orbitRotY.value}deg) scale(0.84)`
    }
  }
  return {
    width: `${Math.round(display.w * zoom.value)}px`,
    height: `${Math.round(display.h * zoom.value)}px`,
    transform: baseTransform
  }
})

function toggleExploded3d(): void {
  exploded3d.value = !exploded3d.value
  if (exploded3d.value) {
    boxSliceActive.value = false
    orbitRotX.value = 18
    orbitRotY.value = -24
  }
}

const boxSliceRectStyle = computed(() => {
  const cw = Math.max(1, draft.canvasWidth)
  const ch = Math.max(1, draft.canvasHeight)
  const left = Math.min(boxSliceDrag.startX, boxSliceDrag.currentX)
  const top = Math.min(boxSliceDrag.startY, boxSliceDrag.currentY)
  const width = Math.max(1, Math.abs(boxSliceDrag.currentX - boxSliceDrag.startX))
  const height = Math.max(1, Math.abs(boxSliceDrag.currentY - boxSliceDrag.startY))
  return {
    left: `${(left / cw) * 100}%`,
    top: `${(top / ch) * 100}%`,
    width: `${(width / cw) * 100}%`,
    height: `${(height / ch) * 100}%`
  }
})

function isBase(layer: ImageLayerSplitLayer): boolean {
  return isLayerSplitBase(layer)
}

function layerLabel(layer: ImageLayerSplitLayer): string {
  if (isBase(layer)) return t('graph.layerSplit.baseLayer')
  return layer.name || layer.id
}

function layerOnCanvas(layer: ImageLayerSplitLayer): boolean {
  return isLayerSplitLayerDrawable(draft, layer)
}

function layerUrl(layer: ImageLayerSplitLayer): string {
  return (
    localLayerUrls[layer.imageId] ||
    localLayerUrls[layer.id] ||
    props.layerUrls[layer.imageId] ||
    props.layerUrls[layer.id] ||
    ''
  )
}

function sanitizeFileBase(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
  return cleaned || 'layer'
}

function layerFileBase(layer: ImageLayerSplitLayer): string {
  const name = isBase(layer) ? t('graph.layerSplit.baseLayer') : layer.name || layer.id
  return sanitizeFileBase(name)
}

function extensionFromMime(mime: string): string {
  const m = mime.toLowerCase()
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg'
  if (m.includes('webp')) return 'webp'
  if (m.includes('gif')) return 'gif'
  return 'png'
}

function flashExportMessage(message: string, failed = false): void {
  exportMessage.value = message
  exportFailed.value = failed
  if (exportMsgTimer) clearTimeout(exportMsgTimer)
  exportMsgTimer = setTimeout(() => {
    exportMessage.value = ''
    exportFailed.value = false
    exportMsgTimer = null
  }, 3200)
}

async function resolveLayerBytes(src: string): Promise<{ data: Uint8Array; ext: string }> {
  const url = src.trim()
  if (!url) throw new Error(t('graph.layerSplit.exportNeedImage'))
  if (url.startsWith('data:')) {
    const match = url.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/i)
    if (!match) throw new Error('invalid data URL')
    const mime = match[1] || 'image/png'
    const isBase64 = !!match[2]
    const payload = match[3] || ''
    const binary = isBase64 ? atob(payload) : decodeURIComponent(payload)
    const data = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) data[i] = binary.charCodeAt(i)
    return { data, ext: extensionFromMime(mime) }
  }
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = new Uint8Array(await response.arrayBuffer())
  const mime = response.headers.get('content-type') || ''
  return {
    data,
    ext: mime.startsWith('image/') ? extensionFromMime(mime) : 'png'
  }
}

const PRESET_LABEL_KEYS: Record<UiLayerSplitPresetId, string> = {
  'ui-standard': 'graph.layerSplit.presetStandard',
  'ui-hud': 'graph.layerSplit.presetHud',
  'ui-popup': 'graph.layerSplit.presetPopup',
  'ui-inventory': 'graph.layerSplit.presetInventory',
  'ui-card': 'graph.layerSplit.presetCard'
}

const presetOptions = computed(() => {
  const isZh = String(locale.value || '')
    .toLowerCase()
    .startsWith('zh')
  return UI_LAYER_SPLIT_PRESETS.map((item) => ({
    id: item.id,
    label: t(PRESET_LABEL_KEYS[item.id]),
    prompt: isZh ? item.promptZh : item.promptEn
  }))
})

function onAutoGroupUiLayers(): void {
  if (!hasCanvas.value || splitting.value) return
  pushDraftHistory()
  const isZh = String(locale.value || '')
    .toLowerCase()
    .startsWith('zh')
  const grouped = autoGroupLayersForGameUi(draft, isZh ? 'zh-CN' : 'en-US')
  Object.assign(draft, grouped)
  flashExportMessage(t('graph.layerSplit.autoUiGroupDone', { n: grouped.groups.length }))
}

function onRenameSelectedLayer(event: Event): void {
  const layer = selectedLayer.value
  if (!layer || isBase(layer)) return
  const nextName = (event.target as HTMLInputElement).value.trim()
  if (!nextName || nextName === layer.name) return
  pushDraftHistory()
  Object.assign(draft, renameLayerSplitItem(draft, layer.id, nextName))
}

function encodeManifestBytes(): Uint8Array {
  const manifest = buildLayerSplitUiManifest(draft)
  return new TextEncoder().encode(JSON.stringify(manifest, null, 2))
}

async function exportLayerFiles(
  layers: ImageLayerSplitLayer[],
  options?: { nestGroups?: boolean; rootGroupId?: string; includeManifest?: boolean }
): Promise<number | null> {
  const counts = new Map<string, number>()
  const files: Array<{ fileName: string; data: Uint8Array }> = []
  const layerFileMap: Record<string, string> = {}
  for (const layer of layers) {
    const src = layerUrl(layer)
    if (!src) continue
    const { data, ext } = await resolveLayerBytes(src)
    let dirPrefix = ''
    let dirKey = ''
    if (options?.nestGroups) {
      const segs = layerSplitExportFolderSegments(draft, layer.groupId, options.rootGroupId).map(
        (name) => sanitizeFileBase(name)
      )
      dirKey = segs.join('/')
      dirPrefix = segs.length ? `${segs.join('/')}/` : ''
    }
    const n = (counts.get(dirKey) ?? 0) + 1
    counts.set(dirKey, n)
    const fileName = `${dirPrefix}${String(n).padStart(2, '0')}-${layerFileBase(layer)}.${ext}`
    layerFileMap[layer.id] = fileName
    files.push({
      fileName,
      data
    })
  }
  if (!files.length) {
    flashExportMessage(t('graph.layerSplit.exportNeedImage'), true)
    return null
  }
  const imageCount = files.length
  if (options?.includeManifest) {
    files.push({
      fileName: 'ui-layout-manifest.json',
      data: encodeManifestBytes()
    })
    files.push({
      fileName: 'GameUiScreen.uxml',
      data: new TextEncoder().encode(
        buildUnityUiToolkitUxml({
          state: draft,
          styleSheetName: 'GameUiScreen.uss',
          screenName: 'UILayerSplitRoot'
        })
      )
    })
    files.push({
      fileName: 'GameUiScreen.uss',
      data: new TextEncoder().encode(
        buildUnityUiToolkitUss({
          state: draft,
          layerFileNames: layerFileMap
        })
      )
    })
    files.push({
      fileName: 'UILayerSplitScene.tscn',
      data: new TextEncoder().encode(
        buildGodotSceneTscn({
          state: draft,
          sceneName: 'UILayerSplitRoot',
          layerFileNames: layerFileMap
        })
      )
    })
    files.push({
      fileName: 'UILayerSplitBuilder.cs',
      data: new TextEncoder().encode(buildUnityUguiEditorScriptCs())
    })
  }
  const result = await window.studio.saveBinaryFilesToDirectory({ files })
  if (result?.written == null) return null
  return options?.includeManifest ? imageCount : result.written
}

async function exportInteractiveHtmlPrototype(): Promise<void> {
  if (exporting.value) return
  const layers = sortLayersForCompose(draft.layers).filter((layer) => layerUrl(layer))
  if (!layers.length) {
    flashExportMessage(t('graph.layerSplit.exportNeedImage'), true)
    return
  }
  exporting.value = true
  try {
    const html = buildInteractiveUiPrototypeHtml({
      state: draft,
      title: isZhLocale.value ? 'AI 游戏 UI 交互原型' : 'AI Game UI Interactive Prototype',
      layerUrls: { ...props.layerUrls, ...localLayerUrls }
    })
    const data = new TextEncoder().encode(html)
    const saved = await window.studio.saveBinaryFile({
      data,
      defaultPath: 'ui-interactive-prototype.html',
      filters: [
        { name: 'HTML5 Prototype', extensions: ['html'] },
        { name: t('graph.output.exportFilterAll'), extensions: ['*'] }
      ]
    })
    if (!saved) return
    flashExportMessage(
      isZhLocale.value
        ? '已导出可点击交互的 HTML5 游戏 UI 原型'
        : 'Interactive HTML5 Game UI prototype exported'
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    flashExportMessage(t('graph.layerSplit.exportFailed', { error: message }), true)
  } finally {
    exporting.value = false
  }
}

async function exportSelectedLayer(): Promise<void> {
  const layer = selectedLayer.value
  const src = layer ? layerUrl(layer) : ''
  if (!layer || !src || exporting.value) return
  exporting.value = true
  try {
    const { data, ext } = await resolveLayerBytes(src)
    const saved = await window.studio.saveBinaryFile({
      data,
      defaultPath: `${layerFileBase(layer)}.${ext}`,
      filters: [
        { name: t('graph.layerSplit.exportFilterImage'), extensions: [ext, 'png', 'jpg', 'webp'] },
        { name: t('graph.output.exportFilterAll'), extensions: ['*'] }
      ]
    })
    if (!saved) return
    flashExportMessage(t('graph.layerSplit.exportSelectedDone'))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    flashExportMessage(t('graph.layerSplit.exportFailed', { error: message }), true)
  } finally {
    exporting.value = false
  }
}

async function exportSelectedGroup(): Promise<void> {
  if (!canExportGroup.value) return
  exporting.value = true
  try {
    const written = await exportLayerFiles(selectedGroupLayers.value, {
      nestGroups: true,
      rootGroupId: selectedGroupId.value
    })
    if (written == null) return
    flashExportMessage(t('graph.layerSplit.exportGroupDone', { n: written }))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    flashExportMessage(t('graph.layerSplit.exportFailed', { error: message }), true)
  } finally {
    exporting.value = false
  }
}

async function exportAllLayers(): Promise<void> {
  if (exporting.value) return
  const layers = sortLayersForCompose(draft.layers).filter((layer) => layerUrl(layer))
  if (!layers.length) {
    flashExportMessage(t('graph.layerSplit.exportNeedImage'), true)
    return
  }
  exporting.value = true
  try {
    const written = await exportLayerFiles(layers, { nestGroups: true, includeManifest: true })
    if (written == null) return
    flashExportMessage(t('graph.layerSplit.exportAllDone', { n: written }))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    flashExportMessage(t('graph.layerSplit.exportFailed', { error: message }), true)
  } finally {
    exporting.value = false
  }
}

async function exportPsd(): Promise<void> {
  if (exporting.value) return
  const layers = sortLayersForCompose(draft.layers).filter((layer) => layerUrl(layer))
  if (!layers.length) {
    flashExportMessage(t('graph.layerSplit.exportNeedImage'), true)
    return
  }
  exporting.value = true
  try {
    const data = await layerSplitToPsdUint8Array({
      state: draft,
      layerUrls: { ...props.layerUrls, ...localLayerUrls }
    })
    const saved = await window.studio.saveBinaryFile({
      data,
      defaultPath: 'ui-layer-split.psd',
      filters: [
        { name: t('graph.layerSplit.exportPsdFilter'), extensions: ['psd'] },
        { name: t('graph.output.exportFilterAll'), extensions: ['*'] }
      ]
    })
    if (!saved) return
    flashExportMessage(t('graph.layerSplit.exportPsdDone'))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    flashExportMessage(t('graph.layerSplit.exportFailed', { error: message }), true)
  } finally {
    exporting.value = false
  }
}

async function exportManifestJson(): Promise<void> {
  if (exporting.value || !hasCanvas.value) return
  exporting.value = true
  try {
    const data = encodeManifestBytes()
    const saved = await window.studio.saveBinaryFile({
      data,
      defaultPath: 'ui-layout-manifest.json',
      filters: [
        { name: t('graph.layerSplit.exportManifestFilter'), extensions: ['json'] },
        { name: t('graph.output.exportFilterAll'), extensions: ['*'] }
      ]
    })
    if (!saved) return
    flashExportMessage(t('graph.layerSplit.exportManifestDone'))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    flashExportMessage(t('graph.layerSplit.exportFailed', { error: message }), true)
  } finally {
    exporting.value = false
  }
}

function layerStyle(layer: ImageLayerSplitLayer): Record<string, string> {
  const cw = Math.max(1, draft.canvasWidth)
  const ch = Math.max(1, draft.canvasHeight)
  const zTranslate = exploded3d.value
    ? `translateZ(${Math.round(layer.zIndex * explodeGap.value)}px)`
    : ''
  if (isBase(layer)) {
    return {
      left: '0',
      top: '0',
      width: '100%',
      height: '100%',
      zIndex: String(layer.zIndex),
      ...(zTranslate ? { transform: zTranslate } : {})
    }
  }
  return {
    left: `${(layer.left / cw) * 100}%`,
    top: `${(layer.top / ch) * 100}%`,
    width: `${(layer.width / cw) * 100}%`,
    height: `${(layer.height / ch) * 100}%`,
    zIndex: String(layer.zIndex + 1),
    ...(zTranslate ? { transform: zTranslate } : {})
  }
}

function findLayer(id: string): ImageLayerSplitLayer | undefined {
  return draft.layers.find((layer) => layer.id === id)
}

function cloneDraft(state: ImageLayerSplitState = draft): ImageLayerSplitState {
  return normalizeImageLayerSplit(JSON.parse(JSON.stringify(state)) as ImageLayerSplitState)
}

function resetLocalHistory(): void {
  localHistory.undo.length = 0
  localHistory.redo.length = 0
}

function pushDraftHistory(): void {
  if (hydrating.value || localHistory.applying || splitting.value) return
  const snap = cloneDraft()
  const last = localHistory.undo.at(-1)
  if (last && JSON.stringify(last) === JSON.stringify(snap)) return
  localHistory.undo.push(snap)
  if (localHistory.undo.length > 80) localHistory.undo.shift()
  localHistory.redo.length = 0
}

function applyDraftState(next: ImageLayerSplitState): void {
  localHistory.applying = true
  hydrating.value = true
  Object.assign(draft, next)
  void nextTick(() => {
    hydrating.value = false
    localHistory.applying = false
    emitPreview()
  })
}

function undoDraft(): void {
  const prev = localHistory.undo.pop()
  if (!prev) return
  localHistory.redo.push(cloneDraft())
  applyDraftState(prev)
}

function redoDraft(): void {
  const next = localHistory.redo.pop()
  if (!next) return
  localHistory.undo.push(cloneDraft())
  applyDraftState(next)
}

// 打开时把本地草稿历史注册到 dive 历史桥，主窗口工具栏 ↶↷ 便代理到此编辑器。详见 diveEditorHistory。
let releaseDiveHistory: (() => void) | null = null

function bindDiveHistory(): void {
  releaseDiveHistory?.()
  releaseDiveHistory = diveEditorHistory.register({
    canUndo: () => canUndo.value,
    canRedo: () => canRedo.value,
    undo: undoDraft,
    redo: redoDraft
  })
}

function releaseDiveHistoryBridge(): void {
  releaseDiveHistory?.()
  releaseDiveHistory = null
}

function onWindowUndoKeydown(event: KeyboardEvent): void {
  if (!props.open) return
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return
  if (isEditableTarget(event.target)) return
  const key = event.key.toLowerCase()
  if (key === 'z' && !event.shiftKey) {
    event.preventDefault()
    event.stopImmediatePropagation()
    undoDraft()
    return
  }
  if (key === 'y' || (key === 'z' && event.shiftKey)) {
    event.preventDefault()
    event.stopImmediatePropagation()
    redoDraft()
  }
}

function replaceLayer(next: ImageLayerSplitLayer): void {
  const index = draft.layers.findIndex((layer) => layer.id === next.id)
  if (index < 0) return
  draft.layers.splice(index, 1, next)
}

function scaleFromDisplay(dx: number, dy: number): { dx: number; dy: number } {
  const cw = Math.max(1, draft.canvasWidth)
  const ch = Math.max(1, draft.canvasHeight)
  const zw = Math.max(1, display.w * zoom.value)
  const zh = Math.max(1, display.h * zoom.value)
  return {
    dx: Math.round((dx / zw) * cw),
    dy: Math.round((dy / zh) * ch)
  }
}

function clientToCanvasPoint(clientX: number, clientY: number): { x: number; y: number } {
  const wrap = canvasWrapEl.value
  const cw = Math.max(1, draft.canvasWidth)
  const ch = Math.max(1, draft.canvasHeight)
  if (!wrap) return { x: 0, y: 0 }
  const rect = wrap.getBoundingClientRect()
  const relX = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)))
  const relY = Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(1, rect.height)))
  return {
    x: Math.round(relX * cw),
    y: Math.round(relY * ch)
  }
}

function toggleBoxSliceMode(): void {
  if (!hasCanvas.value || splitting.value || slicing.value) return
  boxSliceActive.value = !boxSliceActive.value
  if (boxSliceActive.value) {
    flashExportMessage(t('graph.layerSplit.boxSliceHint'))
  }
}

function onCanvasWrapPointerDown(event: PointerEvent): void {
  if (spaceHeld.value) {
    onStagePanStart(event)
    return
  }
  if (!boxSliceActive.value) {
    if (event.target === canvasWrapEl.value) {
      draft.selectedId = ''
    }
    return
  }
  if (!hasCanvas.value || slicing.value) return
  event.preventDefault()
  event.stopPropagation()
  const pt = clientToCanvasPoint(event.clientX, event.clientY)
  boxSliceDrag.active = true
  boxSliceDrag.startX = pt.x
  boxSliceDrag.startY = pt.y
  boxSliceDrag.currentX = pt.x
  boxSliceDrag.currentY = pt.y
  window.addEventListener('pointermove', onBoxSlicePointerMove)
  window.addEventListener('pointerup', onBoxSlicePointerUp)
}

function onBoxSlicePointerMove(event: PointerEvent): void {
  if (!boxSliceDrag.active) return
  const pt = clientToCanvasPoint(event.clientX, event.clientY)
  boxSliceDrag.currentX = pt.x
  boxSliceDrag.currentY = pt.y
}

async function onBoxSlicePointerUp(): Promise<void> {
  window.removeEventListener('pointermove', onBoxSlicePointerMove)
  window.removeEventListener('pointerup', onBoxSlicePointerUp)
  if (!boxSliceDrag.active) return
  const left = Math.min(boxSliceDrag.startX, boxSliceDrag.currentX)
  const top = Math.min(boxSliceDrag.startY, boxSliceDrag.currentY)
  const width = Math.abs(boxSliceDrag.currentX - boxSliceDrag.startX)
  const height = Math.abs(boxSliceDrag.currentY - boxSliceDrag.startY)
  boxSliceDrag.active = false

  if (width < 6 || height < 6) return
  const base = baseLayer.value
  const baseUrl = base ? layerUrl(base) : ''
  const srcUrl = props.sourceUrl?.trim() || baseUrl
  if (!srcUrl) return

  slicing.value = true
  try {
    pushDraftHistory()
    const sliced = await sliceUiLayerFromSourceCanvas({
      sourceUrl: srcUrl,
      baseUrl: baseUrl || undefined,
      canvasWidth: draft.canvasWidth,
      canvasHeight: draft.canvasHeight,
      rect: { left, top, width, height },
      layerIndex: draft.layers.length
    })
    const maxZ = draft.layers.reduce((m, l) => Math.max(m, l.zIndex), 0)
    const stamp = Date.now()
    if (sliced.subParts && sliced.subParts.length >= 2) {
      const addedLayers: ImageLayerSplitLayer[] = []
      const newExtra: GraphImageItem[] = []
      sliced.subParts.forEach((part, idx) => {
        const partId = `layerSplit:slice:${stamp}:z${maxZ + idx + 1}`
        localLayerUrls[partId] = part.dataUrl
        newExtra.push({
          id: partId,
          title: part.name,
          dataUrl: part.dataUrl,
          createdAt: new Date().toISOString()
        })
        addedLayers.push({
          id: partId,
          imageId: partId,
          zIndex: maxZ + idx + 1,
          name: part.name,
          description: part.description,
          visible: part.visible,
          left: part.left,
          top: part.top,
          width: part.width,
          height: part.height,
          role: 'layer',
          originalAbsolute: [part.left, part.top, part.left + part.width, part.top + part.height],
          ...(part.uiControlId ? { uiControlId: part.uiControlId } : {}),
          ...(part.uiControlName ? { uiControlName: part.uiControlName } : {}),
          ...(part.uiControlType ? { uiControlType: part.uiControlType } : {}),
          ...(part.uiPartRole ? { uiPartRole: part.uiPartRole } : {}),
          ...(part.nineSliceBorders ? { nineSliceBorders: part.nineSliceBorders } : {}),
          ...(part.editableText ? { editableText: part.editableText } : {})
        })
      })
      extraImages.value = [...extraImages.value, ...newExtra]
      const nextState = autoGroupLayersForGameUi(
        {
          ...draft,
          layers: [...draft.layers, ...addedLayers],
          selectedId: addedLayers[addedLayers.length - 1]?.id || draft.selectedId
        },
        isZhLocale.value ? 'zh-CN' : 'en-US'
      )
      Object.assign(draft, nextState)
    } else {
      const newId = `layerSplit:slice:${stamp}:z${maxZ + 1}`
      localLayerUrls[newId] = sliced.dataUrl
      extraImages.value = [
        ...extraImages.value,
        {
          id: newId,
          title: sliced.name,
          dataUrl: sliced.dataUrl,
          createdAt: new Date().toISOString()
        }
      ]
      const newLayer: ImageLayerSplitLayer = {
        id: newId,
        imageId: newId,
        zIndex: maxZ + 1,
        name: sliced.name,
        description: sliced.description,
        visible: true,
        left: sliced.left,
        top: sliced.top,
        width: sliced.width,
        height: sliced.height,
        role: 'layer',
        originalAbsolute: [
          sliced.left,
          sliced.top,
          sliced.left + sliced.width,
          sliced.top + sliced.height
        ],
        ...(sliced.uiControlId ? { uiControlId: sliced.uiControlId } : {}),
        ...(sliced.uiControlName ? { uiControlName: sliced.uiControlName } : {}),
        ...(sliced.uiControlType ? { uiControlType: sliced.uiControlType } : {}),
        ...(sliced.nineSliceBorders ? { nineSliceBorders: sliced.nineSliceBorders } : {})
      }
      draft.layers = [...draft.layers, newLayer]
      draft.selectedId = newId
    }
    boxSliceActive.value = false
    flashExportMessage(t('graph.layerSplit.boxSliceDone', { name: sliced.name }))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    flashExportMessage(t('graph.layerSplit.exportFailed', { error: message }), true)
  } finally {
    slicing.value = false
  }
}

async function onDecomposeSelectedControlParts(): Promise<void> {
  const target = selectedLayer.value
  if (!target || isBase(target) || !canDecomposeControlParts.value) return
  const src = layerUrl(target)
  if (!src) return

  slicing.value = true
  try {
    pushDraftHistory()
    const parts = await decomposeSingleLayerUrlToControlParts({
      layer: target,
      layerUrl: src,
      canvasWidth: draft.canvasWidth,
      canvasHeight: draft.canvasHeight,
      locale: isZhLocale.value ? 'zh-CN' : 'en-US'
    })
    if (!parts.length) return
    const stamp = Date.now()
    const newLayers: ImageLayerSplitLayer[] = []
    const newExtra: GraphImageItem[] = []
    parts.forEach((part, idx) => {
      const partId = `${target.id}:${part.idSuffix}:${stamp}:${idx}`
      localLayerUrls[partId] = part.dataUrl
      newExtra.push({
        id: partId,
        title: part.name,
        dataUrl: part.dataUrl,
        createdAt: new Date().toISOString()
      })
      newLayers.push({
        id: partId,
        imageId: partId,
        zIndex: target.zIndex + idx,
        name: part.name,
        description: part.description,
        visible: part.visible,
        left: part.left,
        top: part.top,
        width: part.width,
        height: part.height,
        role: 'layer',
        originalAbsolute: [part.left, part.top, part.left + part.width, part.top + part.height],
        uiControlId: part.uiControlId,
        uiControlName: part.uiControlName,
        uiControlType: part.uiControlType,
        uiPartRole: part.uiPartRole,
        ...(part.nineSliceBorders ? { nineSliceBorders: part.nineSliceBorders } : {}),
        ...(part.editableText ? { editableText: part.editableText } : {})
      })
    })
    extraImages.value = [...extraImages.value, ...newExtra]
    const remaining = draft.layers.filter((l) => l.id !== target.id)
    const grouped = autoGroupLayersForGameUi(
      {
        ...draft,
        layers: [...remaining, ...newLayers],
        selectedId: newLayers.find((l) => l.visible)?.id || newLayers[0]!.id
      },
      isZhLocale.value ? 'zh-CN' : 'en-US'
    )
    Object.assign(draft, grouped)
    flashExportMessage(
      isZhLocale.value
        ? `已将「${target.name}」按标准控件规范拆解为 ${parts.length} 个子图层`
        : `Decomposed "${target.name}" into ${parts.length} standard control sub-layers`
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    flashExportMessage(t('graph.layerSplit.exportFailed', { error: message }), true)
  } finally {
    slicing.value = false
  }
}

function onDeleteSelectedLayer(): void {
  const layer = selectedLayer.value
  if (!layer || isBase(layer) || !canDeleteLayer.value) return
  pushDraftHistory()
  const next = removeLayerSplitLayer(draft, layer.id)
  Object.assign(draft, next)
  flashExportMessage(t('graph.layerSplit.deleteLayerDone'))
}

async function onMergeDownSelected(): Promise<void> {
  const upper = selectedLayer.value
  const lower = mergeDownTarget.value
  if (!upper || !lower || !canMergeDown.value) return
  const upperUrl = layerUrl(upper)
  const lowerUrl = layerUrl(lower)
  if (!upperUrl || !lowerUrl) return

  slicing.value = true
  try {
    pushDraftHistory()
    const merged = await mergeTwoLayerImagesToDataUrl({
      upperLayer: upper,
      upperUrl,
      lowerLayer: lower,
      lowerUrl
    })
    const mergedImageId = `layerSplit:merge:${Date.now()}:${lower.id}`
    localLayerUrls[mergedImageId] = merged.dataUrl
    extraImages.value = [
      ...extraImages.value,
      {
        id: mergedImageId,
        title: lower.name || lower.id,
        dataUrl: merged.dataUrl,
        createdAt: new Date().toISOString()
      }
    ]
    const next = applyMergedLayerSplitPair({
      state: draft,
      upperId: upper.id,
      lowerId: lower.id,
      mergedImageId,
      mergedRect: merged.mergedRect
    })
    Object.assign(draft, next)
    flashExportMessage(t('graph.layerSplit.mergeDownDone', { name: lower.name || lower.id }))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    flashExportMessage(t('graph.layerSplit.exportFailed', { error: message }), true)
  } finally {
    slicing.value = false
  }
}

function onLayerPointerDown(event: PointerEvent, layer: ImageLayerSplitLayer): void {
  if (spaceHeld.value) {
    onStagePanStart(event)
    return
  }
  if (exploded3d.value) {
    draft.selectedId = layer.id
    stageEl.value?.focus()
    startOrbitDrag(event)
    return
  }
  if (boxSliceActive.value) {
    onCanvasWrapPointerDown(event)
    return
  }
  draft.selectedId = layer.id
  stageEl.value?.focus()
  if (isBase(layer) || !layer.visible) return
  pushDraftHistory()
  event.preventDefault()
  drag.kind = 'move'
  drag.id = layer.id
  drag.handle = null
  drag.startX = event.clientX
  drag.startY = event.clientY
  drag.origin = { ...layer }
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
}

function onHandlePointerDown(
  event: PointerEvent,
  layer: ImageLayerSplitLayer,
  handle: ResizeHandle
): void {
  if (spaceHeld.value) {
    onStagePanStart(event)
    return
  }
  draft.selectedId = layer.id
  pushDraftHistory()
  event.preventDefault()
  drag.kind = 'resize'
  drag.id = layer.id
  drag.handle = handle
  drag.startX = event.clientX
  drag.startY = event.clientY
  drag.origin = { ...layer }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
}

const showNineSliceGuides = ref(true)
const nineSliceStretchMode = ref(true)

function layerHasNineSlice(layer: ImageLayerSplitLayer | null | undefined): boolean {
  const b = layer?.nineSliceBorders
  return Array.isArray(b) && b.length === 4 && b.some((n) => Number(n) > 0)
}

function isLayerResizedFromOriginal(layer: ImageLayerSplitLayer): boolean {
  if (Array.isArray(layer.originalAbsolute) && layer.originalAbsolute.length === 4) {
    const origW = Math.max(1, layer.originalAbsolute[2] - layer.originalAbsolute[0])
    const origH = Math.max(1, layer.originalAbsolute[3] - layer.originalAbsolute[1])
    return Math.abs(layer.width - origW) > 1 || Math.abs(layer.height - origH) > 1
  }
  return false
}

function nineSliceRenderStyle(layer: ImageLayerSplitLayer): Record<string, string> {
  const [left, top, right, bottom] = layer.nineSliceBorders ?? [0, 0, 0, 0]
  const cw = Math.max(1, draft.canvasWidth)
  const zw = Math.max(1, display.w * zoom.value)
  const scale = zw / cw
  const lPx = Math.max(0, Math.round(left * scale))
  const tPx = Math.max(0, Math.round(top * scale))
  const rPx = Math.max(0, Math.round(right * scale))
  const bPx = Math.max(0, Math.round(bottom * scale))
  return {
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderWidth: `${tPx}px ${rPx}px ${bPx}px ${lPx}px`,
    borderImageSource: `url("${layerUrl(layer)}")`,
    borderImageSlice: `${top} ${right} ${bottom} ${left} fill`,
    borderImageRepeat: 'stretch'
  }
}

function nineSliceGuidePct(
  layer: ImageLayerSplitLayer,
  side: 'left' | 'top' | 'right' | 'bottom'
): number {
  const [left, top, right, bottom] = layer.nineSliceBorders ?? [0, 0, 0, 0]
  const w = Math.max(1, layer.width)
  const h = Math.max(1, layer.height)
  if (side === 'left') return Math.max(0, Math.min(100, (left / w) * 100))
  if (side === 'right') return Math.max(0, Math.min(100, (right / w) * 100))
  if (side === 'top') return Math.max(0, Math.min(100, (top / h) * 100))
  return Math.max(0, Math.min(100, (bottom / h) * 100))
}

function onNineSliceBorderInput(index: 0 | 1 | 2 | 3, event: Event): void {
  const layer = selectedLayer.value
  if (!layer || isBase(layer)) return
  const raw = Math.max(0, Math.round(Number((event.target as HTMLInputElement).value) || 0))
  const maxVal =
    index === 0 || index === 2
      ? Math.max(0, Math.floor(layer.width / 2))
      : Math.max(0, Math.floor(layer.height / 2))
  const clamped = Math.min(maxVal, raw)
  const current: [number, number, number, number] = layer.nineSliceBorders
    ? [...layer.nineSliceBorders]
    : [0, 0, 0, 0]
  current[index] = clamped
  pushDraftHistory()
  replaceLayer({
    ...layer,
    nineSliceBorders: current
  })
}

async function onAutoDetectSelectedNineSlice(): Promise<void> {
  const layer = selectedLayer.value
  if (!layer || isBase(layer)) return
  const src = layerUrl(layer)
  if (!src) return
  slicing.value = true
  try {
    const decoded = await uiRgbaCodec.decodeImageRgba(src)
    const borders = computeNineSliceFromRgbaBuffer(decoded.data, decoded.width, decoded.height) ?? [
      16, 16, 16, 16
    ]
    pushDraftHistory()
    replaceLayer({
      ...layer,
      nineSliceBorders: borders
    })
    showNineSliceGuides.value = true
    flashExportMessage(
      isZhLocale.value
        ? `已自动测算九宫格切边：L=${borders[0]} T=${borders[1]} R=${borders[2]} B=${borders[3]}px` // cjk-ok
        : `Auto-detected 9-slice borders: L=${borders[0]} T=${borders[1]} R=${borders[2]} B=${borders[3]}px`
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    flashExportMessage(t('graph.layerSplit.exportFailed', { error: message }), true)
  } finally {
    slicing.value = false
  }
}

function onPointerMove(event: PointerEvent): void {
  if (!drag.kind || !drag.origin) return
  const delta = scaleFromDisplay(event.clientX - drag.startX, event.clientY - drag.startY)
  if (drag.kind === 'move') {
    replaceLayer({
      ...drag.origin,
      left: drag.origin.left + delta.dx,
      top: drag.origin.top + delta.dy
    })
    return
  }
  const origin = drag.origin
  const handle = drag.handle
  if (!handle) return
  let left = origin.left
  let top = origin.top
  let width = origin.width
  let height = origin.height
  const ratio = origin.width / Math.max(1, origin.height)
  if (handle.includes('e')) width = Math.max(8, origin.width + delta.dx)
  if (handle.includes('s')) height = Math.max(8, origin.height + delta.dy)
  if (handle.includes('w')) {
    width = Math.max(8, origin.width - delta.dx)
    left = origin.left + origin.width - width
  }
  if (handle.includes('n')) {
    height = Math.max(8, origin.height - delta.dy)
    top = origin.top + origin.height - height
  }
  if (!layerHasNineSlice(origin) && handle.length === 2) {
    height = Math.max(8, Math.round(width / ratio))
    if (handle.includes('n')) top = origin.top + origin.height - height
    if (handle.includes('w')) left = origin.left + origin.width - width
  }
  replaceLayer({ ...origin, left, top, width, height })
}

function onPointerUp(): void {
  drag.kind = null
  drag.id = ''
  drag.handle = null
  drag.origin = null
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
}

function reorder(direction: 'up' | 'down'): void {
  if (!draft.selectedId) return
  pushDraftHistory()
  draft.layers = reorderLayerSplit(draft.layers, draft.selectedId, direction)
}

function toggleGroupCollapsed(groupId: string): void {
  pushDraftHistory()
  draft.groups = toggleLayerSplitGroupCollapsed(draft.groups, groupId)
}

function toggleGroupVisible(groupId: string): void {
  pushDraftHistory()
  draft.groups = toggleLayerSplitGroupVisible(draft.groups, groupId)
}

function selectGroup(groupId: string): void {
  const group = draft.groups.find((item) => item.id === groupId)
  if (!group) return
  const source = draft.layers.find((layer) => layer.id === group.sourceLayerId)
  const firstChild = draft.layers.find((layer) => layer.groupId === groupId)
  draft.selectedId = source?.id || firstChild?.id || draft.selectedId
}

const splitModeOptions = computed<Array<{ id: UiLayerSplitMode; label: string }>>(() => [
  { id: 'auto', label: t('graph.layerSplit.splitModeAuto') },
  { id: 'precise', label: t('graph.layerSplit.splitModePrecise') },
  { id: 'ai-inpaint-slice', label: t('graph.layerSplit.splitModeAiInpaintSlice') },
  { id: 'ai-layers', label: t('graph.layerSplit.splitModeAiLayers') },
  { id: 'local-slice', label: t('graph.layerSplit.splitModeLocalSlice') }
])

function onSplitSelected(): void {
  const layer = selectedLayer.value
  if (!layer || !canSplitSelected.value) return
  if (previewTimer) {
    clearTimeout(previewTimer)
    previewTimer = null
  }
  emit('split-selected', {
    layerId: layer.id,
    prompt: draft.prompt,
    resolution: draft.resolution,
    splitMode: draft.splitMode,
    generateModel: selectedModel.value,
    generateProviderInstanceId: selectedProviderInstanceId.value,
    visionModel: selectedVisionModel.value,
    visionProviderInstanceId: selectedVisionProviderInstanceId.value,
    imageLayerSplit: normalizeImageLayerSplit(draft)
  })
}

function toggleVisible(id: string): void {
  const layer = findLayer(id)
  if (!layer) return
  pushDraftHistory()
  replaceLayer({ ...layer, visible: !layer.visible })
}

function toggleBaseVisible(): void {
  const layer = baseLayer.value
  if (!layer) return
  toggleVisible(layer.id)
}

function resetSelected(): void {
  const layer = selectedLayer.value
  if (!layer) return
  pushDraftHistory()
  replaceLayer(resetLayerSplitRect(layer, draft.canvasWidth, draft.canvasHeight))
}

function resetAll(): void {
  pushDraftHistory()
  draft.layers = draft.layers.map((layer) =>
    resetLayerSplitRect(layer, draft.canvasWidth, draft.canvasHeight)
  )
}

function onKeydown(event: KeyboardEvent): void {
  const layer = selectedLayer.value
  if (!layer || isBase(layer)) return
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    onDeleteSelectedLayer()
    return
  }
  const step = event.shiftKey ? 10 : 1
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    pushDraftHistory()
    replaceLayer(nudgeLayerSplit(layer, -step, 0))
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    pushDraftHistory()
    replaceLayer(nudgeLayerSplit(layer, step, 0))
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    pushDraftHistory()
    replaceLayer(nudgeLayerSplit(layer, 0, -step))
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    pushDraftHistory()
    replaceLayer(nudgeLayerSplit(layer, 0, step))
  } else if (event.key === ']' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    reorder('up')
  } else if (event.key === '[' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    reorder('down')
  }
}

function fitDisplay(): void {
  const stage = stageEl.value
  const cw = Math.max(1, draft.canvasWidth)
  const ch = Math.max(1, draft.canvasHeight)
  const ar = cw / ch
  const maxW = Math.max(200, (stage?.clientWidth ?? 640) - 24)
  const maxH = Math.max(180, (stage?.clientHeight ?? 400) - 16)
  let w = maxW
  let h = w / ar
  if (h > maxH) {
    h = maxH
    w = h * ar
  }
  display.w = Math.max(80, Math.round(w))
  display.h = Math.max(80, Math.round(h))
  resetView()
}

function resetView(): void {
  zoom.value = 1
  panOffset.x = 0
  panOffset.y = 0
  orbitRotX.value = 18
  orbitRotY.value = -24
}

function onStageWheel(event: WheelEvent): void {
  if (!hasCanvas.value || !event.deltaY) return
  const stage = stageEl.value
  if (!stage) return
  const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom.value * factor))
  if (next === zoom.value) return
  const rect = stage.getBoundingClientRect()
  const prevGapX = Math.max((stage.clientWidth - display.w * zoom.value) / 2, STAGE_PAD)
  const prevGapY = Math.max((stage.clientHeight - display.h * zoom.value) / 2, STAGE_PAD)
  const cx = (event.clientX - rect.left - prevGapX - panOffset.x) / zoom.value
  const cy = (event.clientY - rect.top - prevGapY - panOffset.y) / zoom.value
  const gapX = Math.max((stage.clientWidth - display.w * next) / 2, STAGE_PAD)
  const gapY = Math.max((stage.clientHeight - display.h * next) / 2, STAGE_PAD)
  panOffset.x = event.clientX - rect.left - gapX - cx * next
  panOffset.y = event.clientY - rect.top - gapY - cy * next
  zoom.value = next
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el?.closest('input, textarea, select, [contenteditable="true"]')
}

function startOrbitDrag(event: PointerEvent): void {
  if (!event.isPrimary) return
  event.preventDefault()
  orbitDrag.active = true
  orbitDrag.startX = event.clientX
  orbitDrag.startY = event.clientY
  orbitDrag.originRotX = orbitRotX.value
  orbitDrag.originRotY = orbitRotY.value
  window.addEventListener('pointermove', onOrbitDragMove)
  window.addEventListener('pointerup', onOrbitDragEnd)
}

function onOrbitDragMove(event: PointerEvent): void {
  if (!orbitDrag.active) return
  const dx = event.clientX - orbitDrag.startX
  const dy = event.clientY - orbitDrag.startY
  orbitRotY.value = Math.max(-55, Math.min(55, Math.round(orbitDrag.originRotY + dx * 0.25)))
  orbitRotX.value = Math.max(-35, Math.min(48, Math.round(orbitDrag.originRotX - dy * 0.2)))
}

function onOrbitDragEnd(): void {
  orbitDrag.active = false
  window.removeEventListener('pointermove', onOrbitDragMove)
  window.removeEventListener('pointerup', onOrbitDragEnd)
}

function endStagePan(): void {
  pan.active = false
  onOrbitDragEnd()
  window.removeEventListener('pointermove', onStagePanMove)
  window.removeEventListener('pointerup', onStagePanEnd)
}

function onStagePanStart(event: PointerEvent): void {
  if (exploded3d.value && !spaceHeld.value && hasCanvas.value && event.isPrimary) {
    startOrbitDrag(event)
    return
  }
  if (!spaceHeld.value || !hasCanvas.value || !event.isPrimary) return
  event.preventDefault()
  pan.active = true
  pan.startX = event.clientX
  pan.startY = event.clientY
  pan.originX = panOffset.x
  pan.originY = panOffset.y
  window.addEventListener('pointermove', onStagePanMove)
  window.addEventListener('pointerup', onStagePanEnd)
}

function onStagePanMove(event: PointerEvent): void {
  if (!pan.active) return
  panOffset.x = pan.originX + (event.clientX - pan.startX)
  panOffset.y = pan.originY + (event.clientY - pan.startY)
}

function onStagePanEnd(): void {
  endStagePan()
}

function onWindowSpaceKeydown(event: KeyboardEvent): void {
  if (!props.open || event.code !== 'Space' || event.repeat) return
  if (isEditableTarget(event.target) || !hasCanvas.value) return
  event.preventDefault()
  spaceHeld.value = true
}

function onWindowSpaceKeyup(event: KeyboardEvent): void {
  if (event.code !== 'Space') return
  spaceHeld.value = false
  endStagePan()
}

function onWindowBlur(): void {
  spaceHeld.value = false
  endStagePan()
}

function buildSavePayload(): LayerSplitEditorSavePayload {
  return {
    ...imageLayerSplitToNodePatch(normalizeImageLayerSplit(draft)),
    generateModel: selectedModel.value,
    generateProviderInstanceId: selectedProviderInstanceId.value,
    visionModel: selectedVisionModel.value,
    visionProviderInstanceId: selectedVisionProviderInstanceId.value,
    ...(extraImages.value.length ? { extraGeneratedImages: [...extraImages.value] } : {})
  }
}

function emitPreview(): void {
  if (!props.open || hydrating.value || splitting.value) return
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(() => {
    previewTimer = null
    if (!props.open || hydrating.value) return
    emit('update', buildSavePayload())
  }, 48)
}

function onModelChange(): void {
  const opt = modelOptions.value.find((o) => o.key === selectionKey.value)
  selectedModel.value = opt?.model ?? ''
  selectedProviderInstanceId.value = opt?.providerInstanceId ?? ''
}

function onVisionModelChange(): void {
  if (!visionSelectionKey.value) {
    selectedVisionModel.value = ''
    selectedVisionProviderInstanceId.value = ''
    return
  }
  const opt = visionModelOptions.value.find((o) => o.key === visionSelectionKey.value)
  selectedVisionModel.value = opt?.model ?? ''
  selectedVisionProviderInstanceId.value = opt?.providerInstanceId ?? ''
}

async function refreshModels(): Promise<void> {
  const preferred = preferredModelKey(props.generateProviderInstanceId, props.generateModel)
  const preferredVision = preferredModelKey(props.visionProviderInstanceId, props.visionModel)
  const [{ options, selectedKey }, visionRes] = await Promise.all([
    loadGenerateModelOptions('image', preferred),
    loadVisionModelOptions(preferredVision)
  ])
  modelOptions.value = options
  selectionKey.value = selectedKey || options[0]?.key || ''
  onModelChange()
  visionModelOptions.value = visionRes.options
  visionSelectionKey.value = visionRes.selectedKey
  onVisionModelChange()
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      window.removeEventListener('keydown', onWindowUndoKeydown, true)
      window.removeEventListener('keydown', onWindowSpaceKeydown, true)
      window.removeEventListener('keyup', onWindowSpaceKeyup, true)
      window.removeEventListener('blur', onWindowBlur)
      onWindowBlur()
      releaseDiveHistoryBridge()
      resetLocalHistory()
      boxSliceActive.value = false
      boxSliceDrag.active = false
      exploded3d.value = false
      return
    }
    resetLocalHistory()
    for (const k of Object.keys(localLayerUrls)) delete localLayerUrls[k]
    extraImages.value = []
    boxSliceActive.value = false
    boxSliceDrag.active = false
    window.addEventListener('keydown', onWindowUndoKeydown, true)
    window.addEventListener('keydown', onWindowSpaceKeydown, true)
    window.addEventListener('keyup', onWindowSpaceKeyup, true)
    window.addEventListener('blur', onWindowBlur)
    bindDiveHistory()
    hydrating.value = true
    Object.assign(draft, normalizeImageLayerSplit(props.setup ?? DEFAULT_IMAGE_LAYER_SPLIT))
    selectedModel.value = props.generateModel ?? ''
    selectedProviderInstanceId.value = props.generateProviderInstanceId ?? ''
    selectedVisionModel.value = props.visionModel ?? ''
    selectedVisionProviderInstanceId.value = props.visionProviderInstanceId ?? ''
    void refreshModels()
    void nextTick(() => {
      fitDisplay()
      hydrating.value = false
      emitPreview()
    })
  },
  { immediate: true }
)

watch(
  () =>
    [
      props.setup?.sourceFingerprint ?? '',
      (props.setup?.layers ?? []).map((layer) => layer.id).join('|'),
      (props.setup?.groups ?? []).map((group) => group.id).join('|')
    ].join('::'),
  (key) => {
    if (!props.open || !key) return
    resetLocalHistory()
    hydrating.value = true
    Object.assign(draft, normalizeImageLayerSplit(props.setup ?? DEFAULT_IMAGE_LAYER_SPLIT))
    void nextTick(() => {
      fitDisplay()
      hydrating.value = false
    })
  }
)

watch(draft, () => emitPreview(), { deep: true })
watch(
  [
    selectedModel,
    selectedProviderInstanceId,
    selectedVisionModel,
    selectedVisionProviderInstanceId
  ],
  () => emitPreview()
)

watch(
  () => [props.open, draft.canvasWidth, draft.canvasHeight] as const,
  ([open]) => {
    if (open) fitDisplay()
  }
)

function save(): void {
  emit('save', buildSavePayload())
}

function onClose(): void {
  onPointerUp()
  onOrbitDragEnd()
  window.removeEventListener('pointermove', onBoxSlicePointerMove)
  window.removeEventListener('pointerup', onBoxSlicePointerUp)
  if (dirty.value) save()
  emit('close')
}

onBeforeUnmount(() => {
  onPointerUp()
  onOrbitDragEnd()
  window.removeEventListener('pointermove', onBoxSlicePointerMove)
  window.removeEventListener('pointerup', onBoxSlicePointerUp)
  window.removeEventListener('keydown', onWindowUndoKeydown, true)
  releaseDiveHistoryBridge()
  if (previewTimer) clearTimeout(previewTimer)
  if (exportMsgTimer) clearTimeout(exportMsgTimer)
})
</script>

<style scoped>
.editor-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--graph-preview-bg);
}

.topbar,
.bottom {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
}

.bottom {
  border-bottom: none;
  border-top: 1px solid var(--border);
}

.sel-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 13px;
}

.sel-meta strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.z-tag {
  font-size: 11px;
  color: var(--text-muted);
}

.tool-btn {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-hover);
  color: var(--text);
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
}

.tool-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.tool-btn.active {
  border-color: #4a90e2;
  background: rgba(74, 144, 226, 0.22);
  color: #7ab8ff;
}

.tool-btn.explode-3d-btn.active {
  border-color: #38bdf8;
  background: rgba(56, 189, 248, 0.2);
  color: #7dd3fc;
}

.explode-gap-ctl {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: #7dd3fc;
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(56, 189, 248, 0.1);
  border: 1px solid rgba(56, 189, 248, 0.28);
}

.explode-slider {
  width: 68px;
  accent-color: #38bdf8;
  cursor: pointer;
}

.tool-btn.danger-btn:hover:not(:disabled) {
  border-color: #e07070;
  color: #e07070;
}

.layer-count {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-muted);
}

.workspace {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
}

.stage {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  padding: 16px;
  overflow: hidden;
  outline: none;
  background: var(--image-checker-bg);
}

.stage.stage-exploded-3d {
  perspective: 1400px;
  cursor: grab;
  background: radial-gradient(circle at 50% 45%, rgba(56, 189, 248, 0.1), rgba(9, 13, 22, 0.92));
}

.stage.space-pan,
.stage.space-pan .layer,
.stage.space-pan .handle {
  cursor: grab;
}

.stage.panning,
.stage.panning .layer,
.stage.panning .handle {
  cursor: grabbing;
}

.stage-empty {
  margin: auto;
  color: var(--text-muted);
  font-size: 13px;
  max-width: 360px;
  text-align: center;
  line-height: 1.5;
}

.canvas-wrap {
  position: relative;
  flex: 0 0 auto;
  margin: auto;
  background: var(--image-checker-bg);
}

.canvas-wrap.exploded-3d {
  transform-style: preserve-3d;
  transition: transform 0.08s ease-out;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.65);
}

.canvas-wrap.box-slice-mode,
.canvas-wrap.box-slice-mode .layer {
  cursor: crosshair;
}

.box-slice-rect {
  position: absolute;
  z-index: 30;
  border: 2px dashed #4a90e2;
  background: rgba(74, 144, 226, 0.22);
  pointer-events: none;
  box-sizing: border-box;
}

.stage-mask {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 13px;
}

.layer {
  position: absolute;
  box-sizing: border-box;
  cursor: move;
  transition:
    transform 0.28s cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 0.28s ease;
}

.layer.layer-exploded-3d {
  cursor: grab;
  outline: 1px solid rgba(56, 189, 248, 0.55);
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.55);
}

.layer.layer-exploded-3d.selected {
  outline: 2px solid #f59e0b;
  box-shadow: 0 18px 40px rgba(245, 158, 11, 0.35);
}

.layer-3d-badge {
  position: absolute;
  left: 0;
  top: -20px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(10, 15, 28, 0.88);
  border: 1px solid rgba(56, 189, 248, 0.5);
  color: #bae6fd;
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
}

.layer.base {
  cursor: default;
}

.layer.selected {
  outline: 2px solid #4a90e2;
  outline-offset: -1px;
}

.layer img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
  -webkit-user-drag: none;
}

.handle {
  position: absolute;
  width: 10px;
  height: 10px;
  border: 1px solid #fff;
  background: #4a90e2;
  border-radius: 1px;
  z-index: 4;
}

.handle.nw {
  left: -5px;
  top: -5px;
  cursor: nwse-resize;
}
.handle.ne {
  right: -5px;
  top: -5px;
  cursor: nesw-resize;
}
.handle.sw {
  left: -5px;
  bottom: -5px;
  cursor: nesw-resize;
}
.handle.se {
  right: -5px;
  bottom: -5px;
  cursor: nwse-resize;
}

.sidebar {
  width: 276px;
  flex: 0 0 276px;
  box-sizing: border-box;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border);
  background: var(--bg-elevated);
  overflow: hidden;
  padding: 10px;
}

.side-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex: 0 0 auto;
  margin-bottom: 8px;
}

.side-title {
  flex: 0 0 auto;
  white-space: nowrap;
  font-size: 12px;
  color: var(--text-muted);
}

.side-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}

.icon-btn {
  width: 26px;
  height: 26px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-hover);
  color: var(--text);
  cursor: pointer;
}

.icon-btn:hover:not(:disabled) {
  border-color: #4a90e2;
  color: #4a90e2;
}

.icon-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.psd-btn {
  width: auto;
  padding: 0 5px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.side-rename {
  flex: 0 0 auto;
  margin-bottom: 8px;
}

.rename-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  padding: 5px 8px;
  font-size: 12px;
}

.side-nine-slice {
  margin-top: 6px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.nine-slice-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}

.nine-slice-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
}

.nine-slice-tools {
  display: flex;
  align-items: center;
  gap: 4px;
}

.mini-pill {
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 10px;
  padding: 1px 5px;
  cursor: pointer;
}

.mini-pill.active,
.mini-pill:hover:not(:disabled) {
  border-color: #38bdf8;
  color: #38bdf8;
}

.nine-slice-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
}

.ns-cell {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  color: var(--text-muted);
}

.ns-cell input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-elevated);
  color: var(--text);
  padding: 2px 4px;
  font-size: 11px;
}

.nine-slice-render {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  pointer-events: none;
}

.nine-slice-guide {
  position: absolute;
  pointer-events: none;
  z-index: 4;
}

.nine-slice-guide.v {
  top: 0;
  bottom: 0;
  width: 0;
  border-left: 1px dashed #38bdf8;
}

.nine-slice-guide.h {
  left: 0;
  right: 0;
  height: 0;
  border-top: 1px dashed #38bdf8;
}

.side-export {
  flex: 0 0 auto;
  margin: 0 0 8px;
  font-size: 11px;
  color: #7dcea0;
  line-height: 1.35;
}

.side-export.error {
  color: #e07070;
}

.side-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.side-empty,
.side-error {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.4;
}

.side-error {
  color: #e07070;
}

.layer-row.group-row {
  font-weight: 600;
}

.chevron {
  width: 14px;
  flex: 0 0 14px;
  font-size: 12px;
  opacity: 0.8;
}

.layer-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  padding: 6px;
  margin-bottom: 4px;
  text-align: left;
  cursor: pointer;
}

.layer-row.active {
  border-color: #4a90e2;
  background: var(--bg-hover);
}

.layer-row.dim {
  opacity: 0.55;
}

.eye {
  font-size: 12px;
  opacity: 0.85;
}

.eye.off {
  opacity: 0.28;
}

.thumb {
  width: 36px;
  height: 36px;
  object-fit: contain;
  border-radius: 4px;
  background: var(--image-checker-bg);
}

.thumb.placeholder {
  display: inline-block;
}

.row-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.row-name {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-z {
  font-size: 11px;
  color: var(--text-muted);
}

.prompt-col {
  flex: 1 1 280px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.preset-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.preset-title {
  font-size: 11px;
  color: var(--text-muted);
}

.preset-chip {
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg);
  color: var(--text);
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
}

.preset-chip.active,
.preset-chip:hover {
  border-color: #4a90e2;
  color: #4a90e2;
}

.prompt {
  width: 100%;
  box-sizing: border-box;
  min-height: 48px;
  resize: vertical;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  padding: 8px 10px;
  font-size: 13px;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.tool {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.tool-mode {
  min-width: 190px;
  max-width: 260px;
}

.tool-model {
  min-width: 200px;
}

.select {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  padding: 6px 8px;
}
</style>
