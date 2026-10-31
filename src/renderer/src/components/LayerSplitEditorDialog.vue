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
          <strong>
            {{
              selectedNonBaseLayers.length > 1
                ? isZhLocale
                  ? `已框选 ${selectedNonBaseLayers.length} 个图层` // cjk-ok
                  : `${selectedNonBaseLayers.length} layers selected`
                : selectedLayer?.name || t('graph.layerSplit.noSelection')
            }}
          </strong>
          <span v-if="selectedLayer && selectedNonBaseLayers.length <= 1" class="z-tag">
            z {{ selectedLayer.zIndex }}
          </span>
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
          :disabled="!selectedNonBaseLayers.length"
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
          :class="{ active: marqueeSelectActive }"
          :disabled="!hasCanvas || splitting || slicing || exploded3d"
          :title="
            isZhLocale
              ? '鼠标框选图层模式（也可直接在底板/空白区域拖拽或按住 Shift 拖拽框选多个图层）' // cjk-ok
              : 'Marquee box-select layers (or drag directly on base/empty area or hold Shift + drag)'
          "
          @click="toggleMarqueeSelectMode"
        >
          {{
            marqueeSelectActive
              ? isZhLocale
                ? '🔲 框选中…' // cjk-ok
                : '🔲 Selecting…'
              : isZhLocale
                ? '🔲 框选图层' // cjk-ok
                : '🔲 Box Select'
          }}
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
          :title="
            isZhLocale
              ? 'Z 轴层间距（图层多时自动自适应压缩总厚度）' // cjk-ok
              : 'Z-Depth Gap (auto-adapts total depth for many layers)'
          "
        >
          <span>Z</span>
          <input
            v-model.number="explodeGap"
            type="range"
            min="2"
            max="48"
            step="1"
            class="explode-slider"
          />
        </label>
        <button
          v-if="exploded3d"
          type="button"
          class="tool-btn explode-3d-btn"
          :class="{ active: explodeShowLabels }"
          :title="
            isZhLocale
              ? '在 3D 爆炸视图中显示/隐藏图层名称标签' // cjk-ok
              : 'Show/hide layer name badges in 3D Exploded View'
          "
          @click="explodeShowLabels = !explodeShowLabels"
        >
          🏷️ {{ isZhLocale ? '图层名' : 'Labels' }}<!-- cjk-ok -->
        </button>
        <button
          v-if="qaFlaggedLayers.length"
          type="button"
          class="tool-btn qa-review-btn"
          :title="
            isZhLocale
              ? '精准拆层质检发现问题的图层：点击依次定位到下一个需要复核的图层' // cjk-ok
              : 'Layers flagged by precise-split QA: click to jump to the next one to review'
          "
          @click="focusNextQaLayer"
        >
          ⚠ {{ qaFlaggedLayers.length }}
          {{ isZhLocale ? '个图层需复核' : 'to review' }}<!-- cjk-ok -->
        </button>
        <button
          type="button"
          class="tool-btn"
          :class="{ active: showQaOutlines }"
          :disabled="!qaFlaggedLayers.length"
          :title="
            isZhLocale
              ? '在画布上用红色虚线标出质检有问题的图层' // cjk-ok
              : 'Outline QA-flagged layers on the stage'
          "
          @click="showQaOutlines = !showQaOutlines"
        >
          {{ isZhLocale ? '🔍 质检标记' : '🔍 QA Marks' }}<!-- cjk-ok -->
        </button>
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
            :class="{
              'box-slice-mode': boxSliceActive,
              'marquee-select-mode': marqueeSelectActive,
              'exploded-3d': exploded3d
            }"
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
                selected: isLayerSelected(layer.id),
                'multi-selected': selectedNonBaseLayers.length > 1 && isLayerSelected(layer.id),
                base: isBase(layer),
                'layer-exploded-3d': exploded3d,
                'qa-flagged': showQaOutlines && !exploded3d && !!layer.qaIssues?.length
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
              <span v-if="exploded3d && explodeShowLabels" class="layer-3d-badge">
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
            <div
              v-if="marqueeDrag.active && marqueeDrag.moved"
              class="marquee-select-rect"
              :style="marqueeRectStyle"
            >
              <span v-if="selectedNonBaseLayers.length > 0" class="marquee-count-badge">
                {{ selectedNonBaseLayers.length }}
              </span>
            </div>
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
            <div class="side-export-name">
              <span class="export-name-label">
                {{ isZhLocale ? '导出名' : 'Export' }}<!-- cjk-ok -->
              </span>
              <input
                type="text"
                class="rename-input export-name-input"
                :value="selectedLayer.exportName ?? ''"
                :placeholder="
                  isZhLocale
                    ? '如 Btn_Confirm_01（字母/数字/下划线）' // cjk-ok
                    : 'e.g. Btn_Confirm_01'
                "
                :title="
                  isZhLocale
                    ? '引擎安全导出名：用作切图文件名与 Unity / Godot 节点名' // cjk-ok
                    : 'Engine-safe export name used for sliced file names and Unity / Godot nodes'
                "
                @change="onExportNameInput"
              />
              <span
                v-if="selectedLayer.prefabKey"
                class="prefab-chip"
                :title="
                  isZhLocale
                    ? `与 ${prefabSiblingCount(selectedLayer) - 1} 个同款控件共享同一份切图（预制体 ${selectedLayer.prefabKey}）` // cjk-ok
                    : `Shares one sliced asset with ${prefabSiblingCount(selectedLayer) - 1} identical control(s) (${selectedLayer.prefabKey})`
                "
                >🔗 ×{{ prefabSiblingCount(selectedLayer) }}</span
              >
            </div>
            <div v-if="selectedLayer.qaIssues?.length" class="side-qa">
              <div class="nine-slice-head">
                <span class="nine-slice-title qa-title">
                  ⚠ {{ isZhLocale ? '质检提示' : 'QA findings' }}<!-- cjk-ok -->
                </span>
                <button
                  type="button"
                  class="mini-pill"
                  :title="
                    isZhLocale
                      ? '确认该图层没问题，清除质检标记' // cjk-ok
                      : 'Accept this layer and clear its QA flags'
                  "
                  @click="markSelectedQaReviewed"
                >
                  {{ isZhLocale ? '✓ 已复核' : '✓ Reviewed' }}<!-- cjk-ok -->
                </button>
              </div>
              <div v-for="issue in selectedLayer.qaIssues" :key="issue" class="qa-issue-row">
                <span class="qa-issue-text">{{ qaIssueLabel(issue) }}</span>
                <button
                  v-if="qaIssueFix(issue)"
                  type="button"
                  class="mini-pill qa-fix-btn"
                  :disabled="slicing || splitting"
                  @click="applyQaFix(issue)"
                >
                  {{ qaIssueFix(issue)!.label }}
                </button>
              </div>
            </div>
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

            <div class="side-layer-repair">
              <div class="nine-slice-head">
                <span class="nine-slice-title">
                  {{
                    isZhLocale ? '🖌️ 单层画笔 / AI 修补' : '🖌️ Layer Brush & AI Repair'  // cjk-ok
                  }}<!-- cjk-ok -->
                </span>
                <div class="nine-slice-tools">
                  <button
                    type="button"
                    class="mini-pill"
                    :class="{ active: brushMode === 'erase' }"
                    :disabled="slicing"
                    :title="
                      isZhLocale
                        ? '在画布拖拽擦除当前图层的多余杂边像素' // cjk-ok
                        : 'Drag on canvas to erase stray pixels on selected layer'
                    "
                    @click="toggleBrushMode('erase')"
                  >
                    {{ isZhLocale ? '🧹 擦除' : '🧹 Erase' }}<!-- cjk-ok -->
                  </button>
                  <button
                    type="button"
                    class="mini-pill"
                    :class="{ active: brushMode === 'restore' }"
                    :disabled="slicing"
                    :title="
                      isZhLocale
                        ? '在画布拖拽从原图还原当前图层漏抠的边缘像素' // cjk-ok
                        : 'Drag on canvas to restore missing pixels from source image'
                    "
                    @click="toggleBrushMode('restore')"
                  >
                    {{ isZhLocale ? '✨ 还原' : '✨ Restore' }}<!-- cjk-ok -->
                  </button>
                  <button
                    type="button"
                    class="mini-pill"
                    :disabled="slicing"
                    :title="
                      isZhLocale
                        ? '自动检测并填补当前图层内部的闭合破洞' // cjk-ok
                        : 'Fill internal transparent holes on selected layer'
                    "
                    @click="onFillSelectedLayerHoles"
                  >
                    {{ isZhLocale ? '🩹 补洞' : '🩹 Fill' }}<!-- cjk-ok -->
                  </button>
                </div>
              </div>
              <div v-if="brushMode !== 'none'" class="brush-radius-row">
                <span>{{ isZhLocale ? '半径' : 'Radius' }} {{ brushRadius }}px<!-- cjk-ok --></span>
                <input
                  v-model.number="brushRadius"
                  type="range"
                  min="4"
                  max="60"
                  step="2"
                  class="brush-slider"
                />
              </div>
              <div class="ai-repair-row">
                <input
                  v-model="layerRepairPrompt"
                  type="text"
                  class="ai-repair-input"
                  :placeholder="
                    isZhLocale
                      ? '输入单层 AI 修补指令（留空自动补全遮挡纹理）' // cjk-ok
                      : 'Prompt to AI-repair this layer (blank = auto inpaint)'
                  "
                  @keydown.enter.prevent="onAiRepairSelectedLayer"
                />
                <button
                  type="button"
                  class="mini-pill ai-repair-btn"
                  :disabled="slicing || splitting"
                  @click="onAiRepairSelectedLayer"
                >
                  {{ isZhLocale ? '🤖 AI 修补' : '🤖 AI Fix' }}<!-- cjk-ok -->
                </button>
              </div>
            </div>
          </div>
          <p v-if="exportMessage" class="side-export" :class="{ error: exportFailed }">
            {{ exportMessage }}
          </p>
          <div ref="sideListEl" class="side-list">
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
                :data-layer-id="row.layer.id"
                :class="{ active: isLayerSelected(row.layer.id), dim: !row.layer.visible }"
                :style="{ paddingLeft: `${6 + row.depth * 14}px` }"
                @click="onSideLayerRowClick($event, row.layer.id)"
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
                  <span class="row-z"
                    >z {{ row.layer.zIndex
                    }}<template v-if="row.layer.exportName">
                      · {{ row.layer.exportName }}</template
                    ></span
                  >
                </span>
                <span
                  v-if="row.layer.prefabKey"
                  class="row-badge prefab"
                  :title="row.layer.prefabKey"
                  >🔗</span
                >
                <span
                  v-if="row.layer.qaIssues?.length"
                  class="row-badge qa"
                  :title="row.layer.qaIssues.map((i) => qaIssueLabel(i)).join('\n')"
                  >⚠</span
                >
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
import { nearestAspectRatio, resizeBilinear } from '@shared/graph/uiPreciseSplit'
import { useStudioI18n } from '../composables/useStudioI18n'
import {
  applyLayerBrushStrokeToDataUrl,
  decomposeSingleLayerUrlToControlParts,
  inpaintSingleLayerHolesToDataUrl,
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
const sideListEl = ref<HTMLElement | null>(null)
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
const explodeGap = ref(12)
const explodeShowLabels = ref(true)
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
const marqueeSelectActive = ref(false)
const selectedIds = ref<string[]>([])
const marqueeDrag = reactive({
  active: false,
  moved: false,
  additive: false,
  clickedLayerId: '',
  startClientX: 0,
  startClientY: 0,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
  initialSelectedIds: [] as string[]
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
  multiOrigins: ImageLayerSplitLayer[]
}>({
  kind: null,
  id: '',
  handle: null,
  startX: 0,
  startY: 0,
  origin: null,
  multiOrigins: []
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
function isLayerSelected(layerId: string): boolean {
  return layerId === draft.selectedId || selectedIds.value.includes(layerId)
}
const selectedNonBaseLayers = computed(() =>
  draft.layers.filter((layer) => !isLayerSplitBase(layer) && isLayerSelected(layer.id))
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
  return selectedNonBaseLayers.value.length > 0 && !splitting.value && !slicing.value
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
    marqueeSelectActive.value = false
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

const marqueeRectStyle = computed(() => {
  const cw = Math.max(1, draft.canvasWidth)
  const ch = Math.max(1, draft.canvasHeight)
  const left = Math.min(marqueeDrag.startX, marqueeDrag.currentX)
  const top = Math.min(marqueeDrag.startY, marqueeDrag.currentY)
  const width = Math.max(1, Math.abs(marqueeDrag.currentX - marqueeDrag.startX))
  const height = Math.max(1, Math.abs(marqueeDrag.currentY - marqueeDrag.startY))
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
  // 精准拆层给出的引擎安全导出名（Btn_Confirm_01）优先：可直接作为切图文件名 / 预制体节点名
  if (!isBase(layer) && layer.exportName) return layer.exportName
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
  // 同一预制体（重复控件）只导出一份切图，其余实例在清单 / UXML / tscn 中引用同一文件
  const prefabFileMap = new Map<string, string>()
  for (const layer of layers) {
    const src = layerUrl(layer)
    if (!src) continue
    if (layer.prefabKey && prefabFileMap.has(layer.prefabKey)) {
      layerFileMap[layer.id] = prefabFileMap.get(layer.prefabKey)!
      continue
    }
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
    if (layer.prefabKey) prefabFileMap.set(layer.prefabKey, fileName)
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

const explodedLayerZMap = computed<Record<string, number>>(() => {
  const map: Record<string, number> = {}
  if (!exploded3d.value) return map
  const visibleLayers = stackedLayers.value.filter((layer) => layerOnCanvas(layer))
  const count = visibleLayers.length
  if (count <= 1) {
    for (const layer of visibleLayers) map[layer.id] = 0
    return map
  }
  const baseGap = Math.max(1, explodeGap.value)
  const maxTotalDepth = baseGap * 9
  const effectiveStep = Math.min(baseGap, maxTotalDepth / (count - 1))
  const centerRank = (count - 1) / 2
  visibleLayers.forEach((layer, rank) => {
    map[layer.id] = Math.round((rank - centerRank) * effectiveStep)
  })
  return map
})

function layerStyle(layer: ImageLayerSplitLayer): Record<string, string> {
  const cw = Math.max(1, draft.canvasWidth)
  const ch = Math.max(1, draft.canvasHeight)
  const zOffset = explodedLayerZMap.value[layer.id] ?? 0
  const zTranslate = exploded3d.value ? `translateZ(${zOffset}px)` : ''
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
    marqueeSelectActive.value = false
    brushMode.value = 'none'
    flashExportMessage(t('graph.layerSplit.boxSliceHint'))
  }
}

function toggleMarqueeSelectMode(): void {
  if (!hasCanvas.value || splitting.value || slicing.value || exploded3d.value) return
  marqueeSelectActive.value = !marqueeSelectActive.value
  if (marqueeSelectActive.value) {
    boxSliceActive.value = false
    brushMode.value = 'none'
    flashExportMessage(
      isZhLocale.value
        ? '已开启鼠标框选图层模式：在画面中拖拽可框选多个图层（按住 Shift 可加选）' // cjk-ok
        : 'Box selection active: drag on stage to select multiple layers (hold Shift to add)'
    )
  }
}

function computeMarqueeMatchingLayerIds(rect: {
  left: number
  top: number
  right: number
  bottom: number
}): string[] {
  const candidates = stackedLayers.value.filter((layer) => !isBase(layer) && layerOnCanvas(layer))
  const mqW = Math.max(1, rect.right - rect.left)
  const mqH = Math.max(1, rect.bottom - rect.top)
  const mqArea = mqW * mqH

  const contained: ImageLayerSplitLayer[] = []
  const intersecting: ImageLayerSplitLayer[] = []

  for (const layer of candidates) {
    const l0 = layer.left
    const t0 = layer.top
    const r0 = layer.left + layer.width
    const b0 = layer.top + layer.height
    const ix0 = Math.max(l0, rect.left)
    const iy0 = Math.max(t0, rect.top)
    const ix1 = Math.min(r0, rect.right)
    const iy1 = Math.min(b0, rect.bottom)
    if (ix1 <= ix0 || iy1 <= iy0) continue

    const interArea = (ix1 - ix0) * (iy1 - iy0)
    const layerArea = Math.max(1, layer.width * layer.height)
    const coverage = interArea / layerArea

    if (coverage >= 0.5) {
      contained.push(layer)
    }
    intersecting.push(layer)
  }

  if (contained.length > 0) {
    return contained.map((l) => l.id)
  }

  if (intersecting.length > 1) {
    const nonEnclosing = intersecting.filter((layer) => {
      const layerArea = layer.width * layer.height
      const enclosesMarquee =
        layer.left <= rect.left &&
        layer.top <= rect.top &&
        layer.left + layer.width >= rect.right &&
        layer.top + layer.height >= rect.bottom
      return !(enclosesMarquee && layerArea > mqArea * 2.5)
    })
    if (nonEnclosing.length > 0) {
      return nonEnclosing.map((l) => l.id)
    }
  }

  return intersecting.map((l) => l.id)
}

function toggleLayerInSelection(layerId: string): void {
  const cur = selectedIds.value.filter((id) => {
    const l = findLayer(id)
    return l && !isBase(l)
  })
  if (cur.includes(layerId)) {
    const next = cur.filter((id) => id !== layerId)
    selectedIds.value = next
    draft.selectedId = next[next.length - 1] ?? ''
  } else {
    const next = [...cur, layerId]
    selectedIds.value = next
    selectAndRevealLayerFromStage(layerId)
  }
}

function onSideLayerRowClick(event: MouseEvent, layerId: string): void {
  const target = findLayer(layerId)
  if (!target) return
  if ((event.ctrlKey || event.metaKey || event.shiftKey) && !isBase(target)) {
    toggleLayerInSelection(layerId)
    return
  }
  selectedIds.value = [layerId]
  draft.selectedId = layerId
}

function startMarqueeSelect(
  event: PointerEvent,
  options?: { additive?: boolean; clickedLayerId?: string }
): void {
  if (!hasCanvas.value || splitting.value || slicing.value || exploded3d.value) return
  if (!event.isPrimary) return
  event.preventDefault()
  event.stopPropagation()
  stageEl.value?.focus()
  const pt = clientToCanvasPoint(event.clientX, event.clientY)
  marqueeDrag.active = true
  marqueeDrag.moved = false
  marqueeDrag.additive = !!options?.additive
  marqueeDrag.clickedLayerId = options?.clickedLayerId ?? ''
  marqueeDrag.startClientX = event.clientX
  marqueeDrag.startClientY = event.clientY
  marqueeDrag.startX = pt.x
  marqueeDrag.startY = pt.y
  marqueeDrag.currentX = pt.x
  marqueeDrag.currentY = pt.y
  marqueeDrag.initialSelectedIds = [...selectedIds.value]
  window.addEventListener('pointermove', onMarqueePointerMove)
  window.addEventListener('pointerup', onMarqueePointerUp)
}

function onMarqueePointerMove(event: PointerEvent): void {
  if (!marqueeDrag.active) return
  const dxClient = event.clientX - marqueeDrag.startClientX
  const dyClient = event.clientY - marqueeDrag.startClientY
  if (!marqueeDrag.moved && Math.hypot(dxClient, dyClient) < 4) return
  marqueeDrag.moved = true
  const pt = clientToCanvasPoint(event.clientX, event.clientY)
  marqueeDrag.currentX = pt.x
  marqueeDrag.currentY = pt.y

  const left = Math.min(marqueeDrag.startX, marqueeDrag.currentX)
  const right = Math.max(marqueeDrag.startX, marqueeDrag.currentX)
  const top = Math.min(marqueeDrag.startY, marqueeDrag.currentY)
  const bottom = Math.max(marqueeDrag.startY, marqueeDrag.currentY)
  if (right - left < 3 && bottom - top < 3) return

  const hitIds = computeMarqueeMatchingLayerIds({ left, top, right, bottom })
  const nextIds = marqueeDrag.additive
    ? Array.from(
        new Set([
          ...marqueeDrag.initialSelectedIds.filter((id) => {
            const l = findLayer(id)
            return l && !isBase(l)
          }),
          ...hitIds
        ])
      )
    : hitIds
  selectedIds.value = nextIds
  draft.selectedId = nextIds[nextIds.length - 1] ?? ''
}

function onMarqueePointerUp(): void {
  window.removeEventListener('pointermove', onMarqueePointerMove)
  window.removeEventListener('pointerup', onMarqueePointerUp)
  if (!marqueeDrag.active) return
  const wasMoved = marqueeDrag.moved
  const clickedId = marqueeDrag.clickedLayerId
  const additive = marqueeDrag.additive
  marqueeDrag.active = false
  marqueeDrag.moved = false

  if (!wasMoved) {
    if (clickedId) {
      const clickedLayer = findLayer(clickedId)
      if (additive && clickedLayer && !isBase(clickedLayer)) {
        toggleLayerInSelection(clickedId)
      } else {
        selectedIds.value = [clickedId]
        selectAndRevealLayerFromStage(clickedId)
      }
    } else if (!additive) {
      selectedIds.value = []
      draft.selectedId = ''
    }
    return
  }

  if (selectedIds.value.length > 0) {
    for (const id of selectedIds.value) {
      expandAncestorGroupsForLayer(id)
    }
    const primaryId = draft.selectedId || selectedIds.value[selectedIds.value.length - 1]!
    selectAndRevealLayerFromStage(primaryId)
  }
}

function onCanvasWrapPointerDown(event: PointerEvent): void {
  if (spaceHeld.value) {
    onStagePanStart(event)
    return
  }
  if (!boxSliceActive.value) {
    startMarqueeSelect(event, {
      additive: event.shiftKey || event.ctrlKey || event.metaKey
    })
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
  const targets = selectedNonBaseLayers.value
  if (!targets.length || !canDeleteLayer.value) return
  pushDraftHistory()
  let next: ImageLayerSplitState = draft
  for (const item of targets) {
    next = removeLayerSplitLayer(next, item.id)
  }
  selectedIds.value = next.selectedId ? [next.selectedId] : []
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

const brushMode = ref<'none' | 'erase' | 'restore'>('none')
const brushRadius = ref(14)
const layerRepairPrompt = ref('')
const brushDrag = reactive<{
  active: boolean
  points: Array<{ x: number; y: number }>
}>({
  active: false,
  points: []
})

function toggleBrushMode(mode: 'erase' | 'restore'): void {
  if (brushMode.value === mode) {
    brushMode.value = 'none'
    return
  }
  brushMode.value = mode
  boxSliceActive.value = false
  marqueeSelectActive.value = false
  exploded3d.value = false
  flashExportMessage(
    isZhLocale.value
      ? mode === 'erase'
        ? '已开启擦除画笔：在选中图层上拖拽可擦除多余杂边像素' // cjk-ok
        : '已开启原图还原画笔：在选中图层上拖拽可从原图恢复漏抠像素' // cjk-ok
      : mode === 'erase'
        ? 'Erase brush active: drag on selected layer to erase stray pixels'
        : 'Restore brush active: drag on selected layer to restore pixels from source'
  )
}

function startBrushStroke(event: PointerEvent): void {
  const target = selectedLayer.value
  if (!target || isBase(target) || slicing.value) return
  event.preventDefault()
  event.stopPropagation()
  const pt = clientToCanvasPoint(event.clientX, event.clientY)
  brushDrag.active = true
  brushDrag.points = [pt]
  window.addEventListener('pointermove', onBrushPointerMove)
  window.addEventListener('pointerup', onBrushPointerUp)
}

function onBrushPointerMove(event: PointerEvent): void {
  if (!brushDrag.active) return
  const pt = clientToCanvasPoint(event.clientX, event.clientY)
  brushDrag.points.push(pt)
}

async function onBrushPointerUp(): Promise<void> {
  window.removeEventListener('pointermove', onBrushPointerMove)
  window.removeEventListener('pointerup', onBrushPointerUp)
  if (!brushDrag.active) return
  const pts = [...brushDrag.points]
  brushDrag.active = false
  brushDrag.points = []
  const target = selectedLayer.value
  const mode = brushMode.value
  if (!target || isBase(target) || mode === 'none' || !pts.length) return
  const curUrl = layerUrl(target)
  if (!curUrl) return
  const base = baseLayer.value
  const srcUrl = props.sourceUrl?.trim() || (base ? layerUrl(base) : '')

  slicing.value = true
  try {
    pushDraftHistory()
    const nextUrl = await applyLayerBrushStrokeToDataUrl({
      layer: target,
      layerUrl: curUrl,
      sourceUrl: srcUrl || undefined,
      canvasWidth: draft.canvasWidth,
      canvasHeight: draft.canvasHeight,
      mode,
      radius: brushRadius.value,
      points: pts
    })
    commitUpdatedLayerTexture(target, nextUrl, 'brush')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    flashExportMessage(t('graph.layerSplit.exportFailed', { error: message }), true)
  } finally {
    slicing.value = false
  }
}

function commitUpdatedLayerTexture(
  target: ImageLayerSplitLayer,
  dataUrl: string,
  tag: string
): void {
  const newImageId = `${target.id}:${tag}:${Date.now()}`
  localLayerUrls[newImageId] = dataUrl
  extraImages.value = [
    ...extraImages.value,
    {
      id: newImageId,
      title: target.name || target.id,
      dataUrl,
      createdAt: new Date().toISOString()
    }
  ]
  // 修补动作对应的质检问题视为已处理（AI 修补 → 遮挡区；画笔 → 杂边 / 漏抠；补洞 → 漏抠）
  const resolved: Record<string, readonly string[]> = {
    aiFix: ['occluded_blurry', 'occluded_not_completed', 'edge_halo'],
    brush: ['edge_halo', 'under_extracted', 'base_residue'],
    fill: ['under_extracted']
  }
  replaceLayer(
    withQaIssues(
      { ...target, imageId: newImageId },
      (target.qaIssues ?? []).filter((i) => !(resolved[tag] ?? []).includes(i))
    )
  )
}

function withQaIssues(layer: ImageLayerSplitLayer, issues: string[]): ImageLayerSplitLayer {
  const next = { ...layer }
  if (issues.length) next.qaIssues = issues
  else delete next.qaIssues
  return next
}

// ── 精准拆层质检结果接入（P5）────────────────────────────────────
const showQaOutlines = ref(true)
const qaFlaggedLayers = computed(() =>
  [...stackedLayers.value]
    .reverse()
    .filter((layer) => !isBase(layer) && (layer.qaIssues?.length ?? 0) > 0)
)

function qaIssueLabel(issue: string): string {
  const zh: Record<string, string> = {
    edge_halo: '边缘带底色光晕 / 黑边', // cjk-ok
    base_residue: '下层底板残留本元素的边缘或外发光', // cjk-ok
    occluded_not_completed: '被遮挡区仍是上层元素像素（未补全）', // cjk-ok
    occluded_blurry: '被遮挡区补全模糊（糊块）', // cjk-ok
    under_extracted: '图层比元素轮廓小（疑似抠缺）' // cjk-ok
  }
  const en: Record<string, string> = {
    edge_halo: 'Edge halo / background tint',
    base_residue: 'Edge or glow residue left on the layer below',
    occluded_not_completed: 'Occluded area still shows the upper element',
    occluded_blurry: 'Occluded area completion is blurry',
    under_extracted: 'Layer smaller than the element outline (cut off)'
  }
  return (isZhLocale.value ? zh : en)[issue] ?? issue
}

function qaIssueFix(issue: string): { label: string; run: () => void } | null {
  const zh = isZhLocale.value
  switch (issue) {
    case 'edge_halo':
      return {
        label: zh ? '🧹 擦除杂边' : '🧹 Erase edge', // cjk-ok
        run: () => {
          if (brushMode.value !== 'erase') toggleBrushMode('erase')
        }
      }
    case 'under_extracted':
      return {
        label: zh ? '✨ 还原漏抠' : '✨ Restore', // cjk-ok
        run: () => {
          if (brushMode.value !== 'restore') toggleBrushMode('restore')
        }
      }
    case 'occluded_blurry':
    case 'occluded_not_completed':
      return {
        label: zh ? '🤖 AI 补全' : '🤖 AI complete', // cjk-ok
        run: () => void onAiRepairSelectedLayer()
      }
    case 'base_residue':
      return {
        label: zh ? '⬇ 定位下层' : '⬇ Layer below', // cjk-ok
        run: () => focusLayerBelowSelected()
      }
    default:
      return null
  }
}

function applyQaFix(issue: string): void {
  qaIssueFix(issue)?.run()
}

/** 选中当前图层正下方（画布上与之相交、绘制顺序更低）的图层，便于清理残留 */
function focusLayerBelowSelected(): void {
  const cur = selectedLayer.value
  if (!cur) return
  const below = [...stackedLayers.value]
    .reverse()
    .find(
      (l) =>
        l.id !== cur.id &&
        l.zIndex < cur.zIndex &&
        !isBase(l) &&
        l.left < cur.left + cur.width &&
        l.left + l.width > cur.left &&
        l.top < cur.top + cur.height &&
        l.top + l.height > cur.top
    )
  const target = below ?? baseLayer.value
  if (!target) return
  selectedIds.value = [target.id]
  selectAndRevealLayerFromStage(target.id)
  if (!isBase(target) && brushMode.value !== 'erase') toggleBrushMode('erase')
}

function focusNextQaLayer(): void {
  const list = qaFlaggedLayers.value
  if (!list.length) return
  const curIdx = list.findIndex((l) => l.id === draft.selectedId)
  const next = list[(curIdx + 1) % list.length]!
  exploded3d.value = false
  selectedIds.value = [next.id]
  selectAndRevealLayerFromStage(next.id)
  stageEl.value?.focus()
  flashExportMessage(
    `${next.name || next.id}：${(next.qaIssues ?? []).map((i) => qaIssueLabel(i)).join('；')}` // cjk-ok
  )
}

function markSelectedQaReviewed(): void {
  const layer = selectedLayer.value
  if (!layer?.qaIssues?.length) return
  pushDraftHistory()
  replaceLayer(withQaIssues(layer, []))
}

function prefabSiblingCount(layer: ImageLayerSplitLayer): number {
  if (!layer.prefabKey) return 1
  return draft.layers.filter((l) => l.prefabKey === layer.prefabKey).length
}

const EXPORT_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/

function onExportNameInput(event: Event): void {
  const layer = selectedLayer.value
  const input = event.target as HTMLInputElement
  if (!layer || isBase(layer)) return
  const value = input.value.trim()
  if (value === (layer.exportName ?? '')) return
  if (value && !EXPORT_NAME_RE.test(value)) {
    input.value = layer.exportName ?? ''
    flashExportMessage(
      isZhLocale.value
        ? '导出名只能包含英文字母、数字和下划线，且不能以数字开头' // cjk-ok
        : 'Export name may only contain letters, digits and underscores, and must not start with a digit',
      true
    )
    return
  }
  if (value && draft.layers.some((l) => l.id !== layer.id && l.exportName === value)) {
    input.value = layer.exportName ?? ''
    flashExportMessage(
      isZhLocale.value
        ? `导出名「${value}」已被其他图层使用` // cjk-ok
        : `Export name "${value}" is already used`, // cjk-ok
      true
    )
    return
  }
  pushDraftHistory()
  const next = { ...layer }
  if (value) next.exportName = value
  else delete next.exportName
  replaceLayer(next)
}

async function onFillSelectedLayerHoles(): Promise<void> {
  const target = selectedLayer.value
  if (!target || isBase(target) || slicing.value) return
  const curUrl = layerUrl(target)
  if (!curUrl) return
  slicing.value = true
  try {
    pushDraftHistory()
    const nextUrl = await inpaintSingleLayerHolesToDataUrl(curUrl)
    if (nextUrl === curUrl) {
      flashExportMessage(
        isZhLocale.value
          ? '当前图层内部未检测到闭合破洞' // cjk-ok
          : 'No internal closed holes detected on selected layer'
      )
      return
    }
    commitUpdatedLayerTexture(target, nextUrl, 'fill')
    flashExportMessage(
      isZhLocale.value
        ? `已修补「${target.name}」内部残缺孔洞` // cjk-ok
        : `Filled internal holes on "${target.name}"`
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    flashExportMessage(t('graph.layerSplit.exportFailed', { error: message }), true)
  } finally {
    slicing.value = false
  }
}

async function onAiRepairSelectedLayer(): Promise<void> {
  const target = selectedLayer.value
  if (!target || isBase(target) || slicing.value || splitting.value) return
  const curUrl = layerUrl(target)
  if (!curUrl) return
  slicing.value = true
  try {
    pushDraftHistory()
    const decoded = await uiRgbaCodec.decodeImageRgba(curUrl)
    const pngDataUrl = await uiRgbaCodec.encodeRgbaPng(decoded)
    const userInstruction = layerRepairPrompt.value.trim()
    const prompt = userInstruction
      ? isZhLocale.value
        ? `${userInstruction}。请直接在原生透明/半透明背景（RGBA 透明通道）上输出修补后的独立 UI 元件，严格保持元件原有的外轮廓、尺寸、材质、边框与半透明光效一致，外围背景直接生成透明通道（严禁填充纯色底或绘制灰白棋盘格纹理）。` // cjk-ok
        : `${userInstruction}. Directly output the repaired isolated UI element on a true transparent/semi-transparent background (RGBA alpha channel), strictly preserving the element silhouette, bounds, colors, borders, and translucent effects, with a transparent exterior background (no solid fill and strictly no drawn checkerboard pattern).`
      : isZhLocale.value
        ? `这是游戏 UI 元件「${target.name}」的独立图层。请直接在原生透明/半透明背景（RGBA 透明通道）上修补该元件因上层子控件剥离留下的残缺孔洞、遮挡痕迹或边缘缺失，延续元件原有的材质、边框、光影与半透明过渡效果，外围背景直接生成透明/半透明通道（严禁填充纯色底或绘制灰白棋盘格纹理），不要改变外轮廓与尺寸，不要新增任何文字或多余装饰。` // cjk-ok
        : `This is an isolated game UI element layer ("${target.name}"). Directly repair any occlusion holes, missing surface texture, or edge artifacts on a true transparent/semi-transparent background (RGBA alpha channel), strictly preserving its silhouette, borders, colors, lighting, and translucent alpha transitions. Generate the exterior background directly as transparent RGBA (no solid color fill and no checkerboard pattern), and do not add any new text or icons.`
    const res = await window.studio.generateImage({
      prompt,
      ...(selectedModel.value ? { model: selectedModel.value } : {}),
      ...(selectedProviderInstanceId.value
        ? { providerInstanceId: selectedProviderInstanceId.value }
        : {}),
      resolution: draft.resolution === 'auto' ? '2K' : draft.resolution,
      aspectRatio: nearestAspectRatio(target.width, target.height),
      transparentBackground: true,
      inputReferences: [pngDataUrl]
    })
    const outUrl = res?.layers?.[0]?.url?.trim() || res?.images?.[0]?.trim() || ''
    if (!outUrl) {
      throw new Error(isZhLocale.value ? '生图模型未返回修补结果' : 'No image returned from model') // cjk-ok
    }
    const genDecoded = await uiRgbaCodec.decodeImageRgba(outUrl)
    const resized = resizeBilinear(genDecoded, decoded.width, decoded.height)
    const finalDataUrl = await uiRgbaCodec.encodeRgbaPng(resized)
    commitUpdatedLayerTexture(target, finalDataUrl, 'aiFix')
    layerRepairPrompt.value = ''
    flashExportMessage(
      isZhLocale.value
        ? `已完成「${target.name}」的单层 AI 修补` // cjk-ok
        : `AI-repaired layer "${target.name}"`
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    flashExportMessage(t('graph.layerSplit.exportFailed', { error: message }), true)
  } finally {
    slicing.value = false
  }
}

function expandAncestorGroupsForLayer(layerId: string): void {
  const layer = findLayer(layerId)
  if (!layer?.groupId || !draft.groups.length) return
  const byId = new Map(draft.groups.map((g) => [g.id, g]))
  const toExpand = new Set<string>()
  let curId: string | undefined = layer.groupId
  const visited = new Set<string>()
  while (curId && !visited.has(curId)) {
    visited.add(curId)
    const grp = byId.get(curId)
    if (!grp) break
    if (grp.collapsed) toExpand.add(grp.id)
    curId = grp.parentGroupId
  }
  if (toExpand.size > 0) {
    draft.groups = draft.groups.map((g) => (toExpand.has(g.id) ? { ...g, collapsed: false } : g))
  }
}

function selectAndRevealLayerFromStage(layerId: string): void {
  draft.selectedId = layerId
  expandAncestorGroupsForLayer(layerId)
  void nextTick(() => {
    const listEl = sideListEl.value
    if (!listEl) return
    const target = Array.from(listEl.querySelectorAll<HTMLElement>('[data-layer-id]')).find(
      (el) => el.dataset.layerId === layerId
    )
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  })
}

function onLayerPointerDown(event: PointerEvent, layer: ImageLayerSplitLayer): void {
  if (spaceHeld.value) {
    onStagePanStart(event)
    return
  }
  if (exploded3d.value) {
    selectedIds.value = [layer.id]
    selectAndRevealLayerFromStage(layer.id)
    stageEl.value?.focus()
    startOrbitDrag(event)
    return
  }
  if (boxSliceActive.value) {
    onCanvasWrapPointerDown(event)
    return
  }
  if (brushMode.value !== 'none' && selectedLayer.value && !isBase(selectedLayer.value)) {
    startBrushStroke(event)
    return
  }
  const additive = event.shiftKey || event.ctrlKey || event.metaKey
  const isSelectedMulti =
    selectedNonBaseLayers.value.length > 1 && isLayerSelected(layer.id) && !isBase(layer)
  if (isBase(layer) || additive || (marqueeSelectActive.value && !isSelectedMulti)) {
    startMarqueeSelect(event, {
      additive,
      clickedLayerId: layer.id
    })
    return
  }
  if (!isLayerSelected(layer.id)) {
    selectedIds.value = [layer.id]
  }
  selectAndRevealLayerFromStage(layer.id)
  stageEl.value?.focus()
  if (!layer.visible) return
  pushDraftHistory()
  event.preventDefault()
  drag.kind = 'move'
  drag.id = layer.id
  drag.handle = null
  drag.startX = event.clientX
  drag.startY = event.clientY
  drag.origin = { ...layer }
  drag.multiOrigins =
    selectedNonBaseLayers.value.length > 1
      ? selectedNonBaseLayers.value.map((item) => ({ ...item }))
      : [{ ...layer }]
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
  selectedIds.value = [layer.id]
  selectAndRevealLayerFromStage(layer.id)
  pushDraftHistory()
  event.preventDefault()
  drag.kind = 'resize'
  drag.id = layer.id
  drag.handle = handle
  drag.startX = event.clientX
  drag.startY = event.clientY
  drag.origin = { ...layer }
  drag.multiOrigins = []
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
    if (drag.multiOrigins.length > 1) {
      const originById = new Map(drag.multiOrigins.map((item) => [item.id, item]))
      draft.layers = draft.layers.map((layer) => {
        const orig = originById.get(layer.id)
        if (!orig) return layer
        return {
          ...orig,
          left: orig.left + delta.dx,
          top: orig.top + delta.dy
        }
      })
      return
    }
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
  drag.multiOrigins = []
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
  const nextId = source?.id || firstChild?.id || draft.selectedId
  selectedIds.value = nextId ? [nextId] : []
  draft.selectedId = nextId
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
  const targets = selectedNonBaseLayers.value
  if (!targets.length) return
  pushDraftHistory()
  const targetIds = new Set(targets.map((l) => l.id))
  draft.layers = draft.layers.map((layer) =>
    targetIds.has(layer.id)
      ? resetLayerSplitRect(layer, draft.canvasWidth, draft.canvasHeight)
      : layer
  )
}

function resetAll(): void {
  pushDraftHistory()
  draft.layers = draft.layers.map((layer) =>
    resetLayerSplitRect(layer, draft.canvasWidth, draft.canvasHeight)
  )
}

function nudgeSelectedLayers(dx: number, dy: number): void {
  const targets = selectedNonBaseLayers.value
  if (!targets.length) return
  pushDraftHistory()
  const targetIds = new Set(targets.map((l) => l.id))
  draft.layers = draft.layers.map((layer) =>
    targetIds.has(layer.id) ? nudgeLayerSplit(layer, dx, dy) : layer
  )
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    if (marqueeSelectActive.value || boxSliceActive.value || brushMode.value !== 'none') {
      marqueeSelectActive.value = false
      boxSliceActive.value = false
      brushMode.value = 'none'
      event.preventDefault()
      return
    }
    if (selectedIds.value.length > 1) {
      selectedIds.value = draft.selectedId ? [draft.selectedId] : []
      event.preventDefault()
      return
    }
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
    const allDrawable = stackedLayers.value
      .filter((l) => !isBase(l) && layerOnCanvas(l))
      .map((l) => l.id)
    if (allDrawable.length > 0) {
      event.preventDefault()
      selectedIds.value = allDrawable
      draft.selectedId = allDrawable[allDrawable.length - 1]!
      return
    }
  }
  if (!selectedNonBaseLayers.value.length) return
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    onDeleteSelectedLayer()
    return
  }
  const step = event.shiftKey ? 10 : 1
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    nudgeSelectedLayers(-step, 0)
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    nudgeSelectedLayers(step, 0)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    nudgeSelectedLayers(0, -step)
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    nudgeSelectedLayers(0, step)
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
  if (
    !spaceHeld.value &&
    !boxSliceActive.value &&
    brushMode.value === 'none' &&
    hasCanvas.value &&
    event.isPrimary
  ) {
    startMarqueeSelect(event, {
      additive: event.shiftKey || event.ctrlKey || event.metaKey
    })
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
  () => draft.selectedId,
  (id) => {
    if (!id) {
      if (!marqueeDrag.active) selectedIds.value = []
      return
    }
    if (!selectedIds.value.includes(id)) {
      selectedIds.value = [id]
    }
  },
  { immediate: true }
)

watch(
  () => draft.layers.map((l) => l.id).join('|'),
  () => {
    const valid = new Set(draft.layers.map((l) => l.id))
    const filtered = selectedIds.value.filter((id) => valid.has(id))
    if (filtered.length !== selectedIds.value.length) {
      selectedIds.value = filtered
    }
    if (draft.selectedId && !valid.has(draft.selectedId)) {
      draft.selectedId = filtered[0] ?? ''
    } else if (!draft.selectedId && filtered.length > 0) {
      draft.selectedId = filtered[filtered.length - 1]!
    }
  }
)

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
      marqueeSelectActive.value = false
      marqueeDrag.active = false
      marqueeDrag.moved = false
      exploded3d.value = false
      return
    }
    resetLocalHistory()
    for (const k of Object.keys(localLayerUrls)) delete localLayerUrls[k]
    extraImages.value = []
    boxSliceActive.value = false
    boxSliceDrag.active = false
    marqueeSelectActive.value = false
    marqueeDrag.active = false
    marqueeDrag.moved = false
    window.addEventListener('keydown', onWindowUndoKeydown, true)
    window.addEventListener('keydown', onWindowSpaceKeydown, true)
    window.addEventListener('keyup', onWindowSpaceKeyup, true)
    window.addEventListener('blur', onWindowBlur)
    bindDiveHistory()
    hydrating.value = true
    Object.assign(draft, normalizeImageLayerSplit(props.setup ?? DEFAULT_IMAGE_LAYER_SPLIT))
    selectedIds.value = draft.selectedId ? [draft.selectedId] : []
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
    selectedIds.value = draft.selectedId ? [draft.selectedId] : []
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
  window.removeEventListener('pointermove', onMarqueePointerMove)
  window.removeEventListener('pointerup', onMarqueePointerUp)
  if (dirty.value) save()
  emit('close')
}

onBeforeUnmount(() => {
  onPointerUp()
  onOrbitDragEnd()
  window.removeEventListener('pointermove', onBoxSlicePointerMove)
  window.removeEventListener('pointerup', onBoxSlicePointerUp)
  window.removeEventListener('pointermove', onMarqueePointerMove)
  window.removeEventListener('pointerup', onMarqueePointerUp)
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
  background: transparent;
  box-shadow: none;
}

.canvas-wrap.box-slice-mode,
.canvas-wrap.box-slice-mode .layer,
.canvas-wrap.marquee-select-mode,
.canvas-wrap.marquee-select-mode .layer:not(.multi-selected) {
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

.marquee-select-rect {
  position: absolute;
  z-index: 9999;
  border: 1.5px dashed #38bdf8;
  background: rgba(56, 189, 248, 0.16);
  box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.35);
  pointer-events: none;
  box-sizing: border-box;
}

.marquee-count-badge {
  position: absolute;
  right: 4px;
  bottom: 4px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: #0284c7;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
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
  cursor: pointer;
}

.layer.layer-exploded-3d.selected .layer-3d-badge {
  background: rgba(120, 53, 15, 0.92);
  border-color: #f59e0b;
  color: #fde68a;
}

.layer.base {
  cursor: crosshair;
}

.layer.selected {
  outline: 2px solid #4a90e2;
  outline-offset: -1px;
}

.layer.multi-selected {
  outline: 2px solid #38bdf8;
  outline-offset: -1px;
  box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.22);
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

.row-badge {
  flex: 0 0 auto;
  margin-left: auto;
  font-size: 12px;
  line-height: 1;
}

.row-badge + .row-badge {
  margin-left: 2px;
}

.row-badge.qa {
  color: #f97316;
}

.qa-review-btn {
  border-color: #f97316;
  color: #fb923c;
  background: rgba(249, 115, 22, 0.12);
}

.layer.qa-flagged {
  outline: 2px dashed #f97316;
  outline-offset: 1px;
}

.layer.qa-flagged.selected {
  outline: 2px solid #f97316;
}

.side-export-name {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}

.export-name-label {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--text-muted);
}

.export-name-input {
  flex: 1 1 auto;
  min-width: 0;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.prefab-chip {
  flex: 0 0 auto;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 999px;
  border: 1px solid rgba(56, 189, 248, 0.45);
  color: #7dd3fc;
  background: rgba(56, 189, 248, 0.1);
}

.side-qa {
  margin-top: 6px;
  padding: 6px 8px;
  border: 1px solid rgba(249, 115, 22, 0.5);
  border-radius: 6px;
  background: rgba(249, 115, 22, 0.08);
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.qa-title {
  color: #fb923c;
}

.qa-issue-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.qa-issue-text {
  font-size: 11px;
  color: var(--text);
  min-width: 0;
}

.qa-fix-btn {
  flex: 0 0 auto;
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

.side-layer-repair {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.brush-radius-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: var(--text-muted);
}

.brush-slider {
  flex: 1 1 auto;
  height: 4px;
}

.ai-repair-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.ai-repair-input {
  flex: 1 1 auto;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  padding: 4px 6px;
  font-size: 11px;
}

.ai-repair-btn {
  flex: 0 0 auto;
  white-space: nowrap;
}
</style>
