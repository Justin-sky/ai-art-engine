<template>
  <StudioFloatingWindow
    :open="open"
    :title="t('graph.adVariants.appMark')"
    :z-index="1200"
    :default-width="1180"
    :default-height="760"
    :min-width="780"
    :min-height="520"
    body-class="pad-none"
    @close="onClose"
  >
    <div class="editor-root">
      <div class="top-bar">
        <div class="summary-metrics">
          <div class="summary-item">
            <strong class="summary-value">{{ draft.dimensions.length }}</strong>
            <span class="summary-label">{{ t('graph.adVariants.dimensions') }}</span>
          </div>
          <span class="summary-sep">·</span>
          <div class="summary-item">
            <strong class="summary-value">{{ mergedCells.length }}</strong>
            <span class="summary-label">{{ t('graph.adVariants.preview') }}</span>
          </div>
          <span class="summary-sep">·</span>
          <div class="summary-item">
            <strong class="summary-value">{{ renderedCount }}/{{ mergedCells.length }}</strong>
            <span class="summary-label">{{ t('graph.adVariants.filterRendered') }}</span>
          </div>
          <span class="summary-sep">·</span>
          <div class="summary-item">
            <strong class="summary-value success">{{ selectedCells.length }}</strong>
            <span class="summary-label">{{ t('graph.adVariants.filterSelected') }}</span>
          </div>
        </div>

        <div class="top-actions">
          <div class="output-filter-group" :title="t('graph.adVariants.outputFilterHint')">
            <span class="output-filter-label">{{ t('graph.adVariants.outputFilter') }}</span>
            <button
              type="button"
              class="seg-mini-btn"
              :class="{ active: draft.outputFilter === 'all' }"
              @click="draft.outputFilter = 'all'"
            >
              {{ t('graph.adVariants.outputFilterAll') }}
            </button>
            <button
              type="button"
              class="seg-mini-btn"
              :class="{ active: draft.outputFilter === 'selectedOnly' }"
              @click="draft.outputFilter = 'selectedOnly'"
            >
              {{ t('graph.adVariants.outputFilterSelected') }}
            </button>
          </div>

          <template v-if="canRunInWorkbench">
            <button v-if="isNodeRunning" type="button" class="run-btn stop" @click="onStopRun">
              ■ {{ t('graph.adVariants.stopRun') }}
            </button>
            <template v-else>
              <button
                type="button"
                class="run-btn primary"
                :disabled="mergedCells.length === 0 || blocked || missingRunCount === 0"
                @click="onRunMatrix('missing')"
              >
                ▶ {{ t('graph.adVariants.runMissing', { n: missingRunCount }) }}
              </button>
              <button
                type="button"
                class="run-btn secondary"
                :disabled="mergedCells.length === 0 || blocked || unlockedRunCount === 0"
                @click="onRunMatrix('all')"
              >
                ↻ {{ t('graph.adVariants.runAll', { n: unlockedRunCount }) }}
              </button>
            </template>
          </template>
        </div>
      </div>

      <div class="editor-body">
        <div class="columns">
          <!-- Left Column: Campaign Brief + Presets + Dimensions -->
          <div class="column column-left">
            <section class="card">
              <header class="card-head">
                <span class="step-badge">1</span>
                <h3 class="card-title">
                  {{ t('graph.adVariants.briefSection') }}
                </h3>
              </header>
              <div class="card-body brief-body">
                <label class="field-block">
                  <span class="field-title">{{ t('graph.adVariants.product') }}</span>
                  <textarea
                    v-model="draft.product"
                    class="input textarea"
                    rows="2"
                    :placeholder="t('graph.adVariants.productPlaceholder')"
                  />
                </label>

                <div class="brief-two-col">
                  <label class="field-block">
                    <span class="field-title">{{ t('graph.adVariants.sellingPoints') }}</span>
                    <input
                      v-model="draft.sellingPoints"
                      class="input"
                      type="text"
                      :placeholder="t('graph.adVariants.sellingPointsPlaceholder')"
                    />
                  </label>
                  <label class="field-block">
                    <span class="field-title">{{ t('graph.adVariants.ctaText') }}</span>
                    <input
                      v-model="draft.ctaText"
                      class="input"
                      type="text"
                      :placeholder="t('graph.adVariants.ctaTextPlaceholder')"
                    />
                  </label>
                </div>

                <div class="brief-two-col">
                  <div class="field-block">
                    <span class="field-title">{{ t('graph.adVariants.aspectRatio') }}</span>
                    <div class="pill-row">
                      <button
                        v-for="ratio in AD_VARIANT_ASPECT_RATIOS"
                        :key="ratio"
                        type="button"
                        class="pill-btn"
                        :class="{ active: draft.aspectRatio === ratio }"
                        @click="draft.aspectRatio = draft.aspectRatio === ratio ? '' : ratio"
                      >
                        {{ ratio }}
                      </button>
                    </div>
                  </div>

                  <div class="field-block">
                    <span class="field-title">{{ t('graph.adVariants.quality') }}</span>
                    <div class="pill-row">
                      <button
                        v-for="tier in AD_VARIANT_QUALITY_TIERS"
                        :key="tier"
                        type="button"
                        class="pill-btn"
                        :class="{ active: draft.quality === tier }"
                        @click="draft.quality = draft.quality === tier ? '' : tier"
                      >
                        {{ tier }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section class="card">
              <header class="card-head">
                <span class="step-badge">2</span>
                <h3 class="card-title">
                  {{ t('graph.adVariants.dimensions') }}
                </h3>
                <button type="button" class="add-dim" @click="addDimension">
                  + {{ t('graph.adVariants.addDimension') }}
                </button>
              </header>

              <!-- Industry Preset Tabs -->
              <div class="preset-panel">
                <div class="preset-group-tabs">
                  <button
                    v-for="group in presetGroups"
                    :key="group.id"
                    type="button"
                    class="group-tab"
                    :class="{ active: activePresetGroup === group.id }"
                    @click="activePresetGroup = group.id"
                  >
                    {{ t(`graph.adVariants.presetGroups.${group.labelKey}`) }}
                  </button>
                </div>
                <div class="preset-group-items">
                  <button
                    v-for="preset in presetsForGroup(activePresetGroup)"
                    :key="preset.id"
                    type="button"
                    class="preset-btn"
                    :class="{ active: isPresetActive(preset.id) }"
                    @click="applyPreset(preset.id)"
                  >
                    {{ t(`graph.adVariants.presets.${preset.titleKey}`) }}
                  </button>
                </div>
              </div>

              <!-- Quick Dimension Templates -->
              <div class="quick-dims-bar">
                <span class="quick-dims-label">{{ t('graph.adVariants.quickAddDim') }}:</span>
                <button type="button" class="quick-dim-btn" @click="addQuickDimension('angle')">
                  + {{ t('graph.adVariants.quickDimAngle') }}
                </button>
                <button type="button" class="quick-dim-btn" @click="addQuickDimension('lighting')">
                  + {{ t('graph.adVariants.quickDimLighting') }}
                </button>
                <button type="button" class="quick-dim-btn" @click="addQuickDimension('hook')">
                  + {{ t('graph.adVariants.quickDimHook') }}
                </button>
                <button type="button" class="quick-dim-btn" @click="addQuickDimension('mood')">
                  + {{ t('graph.adVariants.quickDimMood') }}
                </button>
              </div>

              <p class="card-hint">
                {{ t('graph.adVariants.dimensionHint') }}
              </p>

              <div class="card-body dim-list">
                <div v-for="(dim, index) in draft.dimensions" :key="dim.id" class="dim-row">
                  <span class="dim-index">{{ index + 1 }}</span>
                  <input
                    v-model="dim.label"
                    class="input dim-label"
                    type="text"
                    :placeholder="t('graph.adVariants.dimensionLabelPlaceholder')"
                  />
                  <textarea
                    v-model="dim.valuesText"
                    class="input textarea dim-values"
                    rows="3"
                    :placeholder="t('graph.adVariants.dimensionValuesPlaceholder')"
                  />
                  <button
                    type="button"
                    class="remove-dim"
                    :title="t('graph.adVariants.removeDimension')"
                    @click="removeDimension(index)"
                  >
                    ×
                  </button>
                </div>
                <p v-if="!draft.dimensions.length" class="card-empty">
                  {{ t('graph.adVariants.dimensionEmpty') }}
                </p>
              </div>
            </section>
          </div>

          <!-- Right Column: Unified Variant Matrix & A/B Review Workbench -->
          <div class="column column-right">
            <section class="card matrix-card">
              <header class="card-head matrix-head">
                <span class="step-badge">3</span>
                <h3 class="card-title">
                  {{ t('graph.adVariants.compare') }}
                </h3>
                <div class="card-head-actions">
                  <button
                    type="button"
                    class="ab-toggle-btn"
                    :class="{ active: abMode }"
                    :disabled="renderedCount < 2"
                    @click="toggleAbMode"
                  >
                    ⚔
                    {{
                      abMode
                        ? t('graph.adVariants.exitAbCompare')
                        : t('graph.adVariants.abCompareMode')
                    }}
                  </button>
                  <button
                    type="button"
                    class="clear-all"
                    :disabled="unmarkedRenderedCount === 0"
                    @click="rejectAllUnmarked"
                  >
                    {{ t('graph.adVariants.rejectUnmarked') }}
                  </button>
                  <button
                    type="button"
                    class="clear-all"
                    :disabled="!hasVerdicts"
                    @click="clearAllVerdicts"
                  >
                    {{ t('graph.adVariants.clearAll') }}
                  </button>
                  <button
                    type="button"
                    class="export-btn"
                    :disabled="selectedCells.length === 0 || exporting"
                    @click="exportSelected"
                  >
                    {{
                      exporting
                        ? t('graph.adVariants.exporting')
                        : t('graph.adVariants.exportSelected')
                    }}
                  </button>
                </div>
              </header>

              <!-- Filter Bar -->
              <div class="filter-bar">
                <button
                  v-for="tab in filterTabs"
                  :key="tab.id"
                  type="button"
                  class="filter-tab"
                  :class="{ active: activeFilter === tab.id }"
                  @click="activeFilter = tab.id"
                >
                  <span>{{ tab.label }}</span>
                  <span class="filter-count">{{ tab.count }}</span>
                </button>
              </div>

              <p v-if="exportStatus" class="export-status">
                {{ exportStatus }}
              </p>

              <!-- A/B Side-by-Side PK Arena -->
              <div v-if="abMode" class="ab-arena">
                <div class="ab-arena-hint">
                  {{ t('graph.adVariants.abCompareHint') }}
                </div>
                <div class="ab-slots">
                  <div
                    v-for="(slotCell, slotIdx) in [abLeftCell, abRightCell]"
                    :key="slotIdx"
                    class="ab-slot"
                    :class="slotCell ? verdictClass(slotCell.id) : 'empty'"
                  >
                    <template v-if="slotCell">
                      <div class="ab-slot-head">
                        <span class="ab-slot-badge">{{ slotIdx === 0 ? 'A' : 'B' }}</span>
                        <div class="cell-tags">
                          <span v-for="(value, dimId) in slotCell.combo" :key="dimId" class="tag">{{
                            value
                          }}</span>
                        </div>
                      </div>
                      <div class="ab-slot-media" @click="openCellPreview(slotCell)">
                        <img
                          v-if="cellDisplayUrl(slotCell)"
                          :src="cellDisplayUrl(slotCell)"
                          class="ab-slot-img"
                          alt=""
                        />
                        <div v-else class="ab-slot-img placeholder">
                          {{ t('graph.adVariants.loading') }}
                        </div>
                      </div>
                      <div class="verdict-row">
                        <button
                          type="button"
                          class="verdict-btn"
                          :class="{ active: cellMeta[slotCell.id]?.verdict === 'selected' }"
                          @click="setVerdict(slotCell.id, 'selected')"
                        >
                          ✓ {{ t('graph.adVariants.select') }}
                        </button>
                        <button
                          type="button"
                          class="verdict-btn reject"
                          :class="{ active: cellMeta[slotCell.id]?.verdict === 'rejected' }"
                          @click="setVerdict(slotCell.id, 'rejected')"
                        >
                          × {{ t('graph.adVariants.reject') }}
                        </button>
                      </div>
                    </template>
                    <div v-else class="ab-slot-empty">
                      {{ t('graph.adVariants.abPickCandidate') }} ({{ slotIdx === 0 ? 'A' : 'B' }})
                    </div>
                  </div>
                </div>
              </div>

              <!-- Unified Variant Matrix Grid -->
              <div class="card-body matrix-body">
                <p v-if="filteredCells.length === 0" class="card-empty">
                  {{
                    mergedCells.length === 0
                      ? t('graph.adVariants.previewEmpty')
                      : t('graph.adVariants.compareEmptyHint')
                  }}
                </p>
                <div v-else class="matrix-grid">
                  <div
                    v-for="cell in filteredCells"
                    :key="cell.id"
                    class="variant-card"
                    :class="[
                      verdictClass(cell.id),
                      {
                        'is-locked': cell.locked,
                        'is-ab-picked': abLeftId === cell.id || abRightId === cell.id
                      }
                    ]"
                  >
                    <!-- Card Top Bar: Combo Tags + Lock + Single Run -->
                    <div class="variant-card-top">
                      <div class="cell-tags">
                        <span v-for="(value, dimId) in cell.combo" :key="dimId" class="tag">{{
                          value
                        }}</span>
                      </div>
                      <div class="cell-quick-tools">
                        <button
                          v-if="abMode && cell.outputRefs.length > 0"
                          type="button"
                          class="icon-tool-btn"
                          :class="{ active: abLeftId === cell.id || abRightId === cell.id }"
                          :title="t('graph.adVariants.abPickCandidate')"
                          @click="pickForAb(cell.id)"
                        >
                          {{ abLeftId === cell.id ? 'A' : abRightId === cell.id ? 'B' : '⚔' }}
                        </button>
                        <button
                          type="button"
                          class="icon-tool-btn"
                          :class="{ active: expandedPromptCellIds[cell.id] }"
                          :title="t('graph.adVariants.customPrompt')"
                          @click="togglePromptDrawer(cell.id)"
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          class="icon-tool-btn"
                          :class="{ active: cell.locked }"
                          :title="
                            cell.locked
                              ? t('graph.adVariants.unlockCell')
                              : t('graph.adVariants.lockCell')
                          "
                          @click="toggleLock(cell.id)"
                        >
                          {{ cell.locked ? '🔒' : '🔓' }}
                        </button>
                        <button
                          v-if="canRunInWorkbench"
                          type="button"
                          class="icon-tool-btn run-cell-btn"
                          :disabled="isNodeRunning || blocked || cell.locked"
                          :title="
                            cell.outputRefs.length > 0
                              ? t('graph.adVariants.rerollCell')
                              : t('graph.adVariants.runCell')
                          "
                          @click="onRunSingleCell(cell.id)"
                        >
                          {{ cell.outputRefs.length > 0 ? '↻' : '▶' }}
                        </button>
                      </div>
                    </div>

                    <!-- Media or Prompt Preview -->
                    <div
                      v-if="cell.outputRefs.length > 0"
                      class="compare-media"
                      @click="openCellPreview(cell)"
                    >
                      <img
                        v-if="cellDisplayUrl(cell)"
                        :src="cellDisplayUrl(cell)"
                        class="compare-img"
                        alt=""
                      />
                      <div v-else class="compare-img placeholder">
                        {{ t('graph.adVariants.loading') }}
                      </div>

                      <span v-if="cell.verdict === 'selected'" class="verdict-badge selected"
                        >✓</span
                      >
                      <span v-else-if="cell.verdict === 'rejected'" class="verdict-badge rejected"
                        >×</span
                      >

                      <!-- Version History Switcher (v1 / v2 / ...) -->
                      <div v-if="cell.outputRefs.length > 1" class="version-bar" @click.stop>
                        <button
                          v-for="(_, vIdx) in cell.outputRefs"
                          :key="vIdx"
                          type="button"
                          class="version-pill"
                          :class="{ active: getAdVariantCellActiveIndex(cell) === vIdx }"
                          @click="setActiveVersion(cell.id, vIdx)"
                        >
                          {{ t('graph.adVariants.versionBadge', { n: vIdx + 1 }) }}
                        </button>
                      </div>
                    </div>

                    <div v-else class="prompt-preview-box">
                      <p class="cell-prompt">
                        {{ getAdVariantCellEffectivePrompt(cell) }}
                      </p>
                      <span v-if="cell.customPrompt" class="custom-badge">
                        {{ t('graph.adVariants.customPrompt') }}
                      </span>
                    </div>

                    <!-- Expandable Custom Prompt & Note Drawer -->
                    <div v-if="expandedPromptCellIds[cell.id]" class="cell-drawer">
                      <div class="drawer-head">
                        <span class="drawer-label">{{ t('graph.adVariants.customPrompt') }}</span>
                        <button
                          v-if="cellMeta[cell.id]?.customPrompt"
                          type="button"
                          class="drawer-reset"
                          @click="resetCellCustomPrompt(cell.id)"
                        >
                          {{ t('graph.adVariants.resetPrompt') }}
                        </button>
                      </div>
                      <textarea
                        :value="cellMeta[cell.id]?.customPrompt ?? cell.prompt"
                        class="input textarea drawer-textarea"
                        rows="3"
                        :placeholder="t('graph.adVariants.customPromptPlaceholder')"
                        @input="
                          onCustomPromptInput(cell.id, ($event.target as HTMLTextAreaElement).value)
                        "
                      />
                      <input
                        :value="cellMeta[cell.id]?.note ?? ''"
                        class="input drawer-note"
                        type="text"
                        :placeholder="t('graph.adVariants.notePlaceholder')"
                        @input="onCellNoteInput(cell.id, ($event.target as HTMLInputElement).value)"
                      />
                    </div>
                    <p v-else-if="cell.note" class="cell-note-preview">
                      {{ cell.note }}
                    </p>

                    <!-- Verdict Controls -->
                    <div class="verdict-row">
                      <button
                        type="button"
                        class="verdict-btn"
                        :class="{ active: cell.verdict === 'selected' }"
                        @click="setVerdict(cell.id, 'selected')"
                      >
                        {{ t('graph.adVariants.select') }}
                      </button>
                      <button
                        type="button"
                        class="verdict-btn reject"
                        :class="{ active: cell.verdict === 'rejected' }"
                        @click="setVerdict(cell.id, 'rejected')"
                      >
                        {{ t('graph.adVariants.reject') }}
                      </button>
                      <button
                        type="button"
                        class="verdict-btn clear"
                        @click="setVerdict(cell.id, undefined)"
                      >
                        {{ t('graph.adVariants.clear') }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>

      <div class="editor-footer">
        <ImageGenerateModelField
          ref="modelFieldEl"
          :open="open"
          :generate-model="modelDraft.generateModel"
          :generate-provider-instance-id="modelDraft.generateProviderInstanceId"
          @change="onModelChange"
        />
        <button type="button" class="save-btn" :disabled="mergedCells.length === 0" @click="onSave">
          {{ t('graph.adVariants.save') }}
        </button>
      </div>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import {
  AD_VARIANT_ASPECT_RATIOS,
  AD_VARIANT_PRESET_GROUPS,
  AD_VARIANT_QUALITY_TIERS,
  applyAdVariantPreset,
  DEFAULT_AD_VARIANT_MATRIX,
  expandAdVariantMatrix,
  getAdVariantCellActiveIndex,
  getAdVariantCellActiveRef,
  getAdVariantCellEffectivePrompt,
  listAdVariantPresetsForGroup,
  normalizeAdVariantMatrix,
  normalizeAdVariantOutputFilter,
  readAdVariantMatrixFromNode,
  type AdVariantCell,
  type AdVariantMatrix,
  type AdVariantOutputFilter,
  type AdVariantPresetGroup,
  type AdVariantVerdict
} from '@shared/graph'
import ImageGenerateModelField from './ImageGenerateModelField.vue'
import StudioFloatingWindow from './StudioFloatingWindow.vue'
import { resolveAssetFileUrl } from '../features/media/assetUrlCache'
import { openFullImagePreview } from '../features/media/openFullImagePreview'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'

const { t, locale } = useStudioI18n()

const presetGroups = AD_VARIANT_PRESET_GROUPS
const activePresetGroup = ref<AdVariantPresetGroup>('general')

function presetsForGroup(group: AdVariantPresetGroup) {
  return listAdVariantPresetsForGroup(group)
}

interface DimensionDraft {
  id: string
  label: string
  valuesText: string
}

interface CellMetaDraft {
  outputRefs: string[]
  activeOutputIndex?: number
  verdict?: AdVariantVerdict
  customPrompt?: string
  locked?: boolean
  note?: string
}

type FilterTabId = 'all' | 'rendered' | 'selected' | 'unmarked' | 'rejected'

const props = defineProps<{
  open: boolean
  hostId?: string
  nodeId?: string
  matrix?: AdVariantMatrix | null
  generateModel?: string
  generateProviderInstanceId?: string
}>()

const emit = defineEmits<{
  close: []
  save: [
    payload: { matrix: AdVariantMatrix; generateModel: string; generateProviderInstanceId: string }
  ]
}>()

const liveNode = computed(() => {
  void graphEditorHosts.revision.value
  if (!props.hostId || !props.nodeId) return null
  const current = graphEditorHosts.getNode(props.hostId, props.nodeId)
  return current?.typeId === 'image.adVariants' ? current : null
})

const canRunInWorkbench = computed(() => Boolean(liveNode.value && props.hostId))
const { runStatus, blocked, toggleRun } = useGraphNodeRun(liveNode, () => props.hostId)
const isNodeRunning = computed(() => runStatus.value === 'running')

const draft = reactive({
  product: '',
  sellingPoints: '',
  ctaText: '',
  aspectRatio: '',
  quality: '',
  outputFilter: 'all' as AdVariantOutputFilter,
  dimensions: [] as DimensionDraft[]
})

const modelDraft = reactive({
  generateModel: '',
  generateProviderInstanceId: ''
})

/** Per-cell state keyed by stable cell.id */
const cellMeta = reactive<Record<string, CellMetaDraft>>({})

/** Resolved URLs keyed by `${cellId}::${relativePath}` */
const resolvedPathUrls = reactive<Record<string, string>>({})

/** Expanded prompt/note drawer state per cellId */
const expandedPromptCellIds = reactive<Record<string, boolean>>({})

const activeFilter = ref<FilterTabId>('all')
const abMode = ref(false)
const abLeftId = ref('')
const abRightId = ref('')

const modelFieldEl = ref<{
  currentSelection: () => { generateModel: string; generateProviderInstanceId: string }
}>()

function ensureCellMeta(cellId: string): CellMetaDraft {
  if (!cellMeta[cellId]) {
    cellMeta[cellId] = { outputRefs: [] }
  }
  return cellMeta[cellId]
}

function parseValues(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
}

function addDimension(): void {
  draft.dimensions.push({ id: `d${Date.now()}`, label: '', valuesText: '' })
}

function addQuickDimension(kind: 'angle' | 'lighting' | 'hook' | 'mood'): void {
  const uniqueSuffix = draft.dimensions.length + 1
  if (kind === 'angle') {
    draft.dimensions.push({
      id: `angle_${uniqueSuffix}`,
      label: t('graph.adVariants.quickDimAngle'),
      valuesText: t('graph.adVariants.quickDimAngleValues')
    })
  } else if (kind === 'lighting') {
    draft.dimensions.push({
      id: `lighting_${uniqueSuffix}`,
      label: t('graph.adVariants.quickDimLighting'),
      valuesText: t('graph.adVariants.quickDimLightingValues')
    })
  } else if (kind === 'hook') {
    draft.dimensions.push({
      id: `hook_${uniqueSuffix}`,
      label: t('graph.adVariants.quickDimHook'),
      valuesText: t('graph.adVariants.quickDimHookValues')
    })
  } else {
    draft.dimensions.push({
      id: `mood_${uniqueSuffix}`,
      label: t('graph.adVariants.quickDimMood'),
      valuesText: t('graph.adVariants.quickDimMoodValues')
    })
  }
}

function removeDimension(index: number): void {
  draft.dimensions.splice(index, 1)
}

function applyPreset(presetId: string): void {
  draft.dimensions = applyAdVariantPreset(presetId, String(locale.value)).map((dim) => ({
    id: dim.id,
    label: dim.label,
    valuesText: dim.values.join('\n')
  }))
}

function isPresetActive(presetId: string): boolean {
  const dims = applyAdVariantPreset(presetId, String(locale.value))
  if (!dims.length) return false
  return (
    draft.dimensions.length === dims.length &&
    draft.dimensions.every((d, index) => d.id === dims[index]?.id)
  )
}

const mergedCells = computed<AdVariantCell[]>(() => {
  const dims = draft.dimensions
    .map((d) => ({ id: d.id, label: d.label.trim(), values: parseValues(d.valuesText) }))
    .filter((d) => d.id)
  const expanded = expandAdVariantMatrix(draft.product, dims, {
    sellingPoints: draft.sellingPoints,
    ctaText: draft.ctaText,
    locale: String(locale.value)
  })
  return expanded.map((c) => {
    const meta = cellMeta[c.id]
    return {
      ...c,
      outputRefs: meta?.outputRefs ? [...meta.outputRefs] : [],
      activeOutputIndex: meta?.activeOutputIndex,
      verdict: meta?.verdict,
      customPrompt: meta?.customPrompt,
      locked: meta?.locked,
      note: meta?.note
    }
  })
})

const renderedCells = computed<AdVariantCell[]>(() =>
  mergedCells.value.filter((c) => c.outputRefs.length > 0)
)
const renderedCount = computed(() => renderedCells.value.length)

const missingRunCount = computed(
  () =>
    mergedCells.value.filter(
      (c) => !c.locked && c.verdict !== 'rejected' && c.outputRefs.length === 0
    ).length
)
const unlockedRunCount = computed(
  () => mergedCells.value.filter((c) => !c.locked && c.verdict !== 'rejected').length
)

const selectedCells = computed<AdVariantCell[]>(() =>
  mergedCells.value.filter((c) => c.verdict === 'selected' && c.outputRefs.length > 0)
)
const unmarkedRenderedCount = computed(() => renderedCells.value.filter((c) => !c.verdict).length)

const filterTabs = computed<Array<{ id: FilterTabId; label: string; count: number }>>(() => [
  { id: 'all', label: t('graph.adVariants.filterAll'), count: mergedCells.value.length },
  { id: 'rendered', label: t('graph.adVariants.filterRendered'), count: renderedCount.value },
  {
    id: 'selected',
    label: t('graph.adVariants.filterSelected'),
    count: mergedCells.value.filter((c) => c.verdict === 'selected').length
  },
  {
    id: 'unmarked',
    label: t('graph.adVariants.filterUnmarked'),
    count: mergedCells.value.filter((c) => !c.verdict).length
  },
  {
    id: 'rejected',
    label: t('graph.adVariants.filterRejected'),
    count: mergedCells.value.filter((c) => c.verdict === 'rejected').length
  }
])

const filteredCells = computed<AdVariantCell[]>(() => {
  switch (activeFilter.value) {
    case 'rendered':
      return mergedCells.value.filter((c) => c.outputRefs.length > 0)
    case 'selected':
      return mergedCells.value.filter((c) => c.verdict === 'selected')
    case 'unmarked':
      return mergedCells.value.filter((c) => !c.verdict)
    case 'rejected':
      return mergedCells.value.filter((c) => c.verdict === 'rejected')
    default:
      return mergedCells.value
  }
})

const abLeftCell = computed(() => mergedCells.value.find((c) => c.id === abLeftId.value) ?? null)
const abRightCell = computed(() => mergedCells.value.find((c) => c.id === abRightId.value) ?? null)

function toggleAbMode(): void {
  abMode.value = !abMode.value
  if (abMode.value) {
    const candidates = renderedCells.value
    if (!abLeftId.value && candidates[0]) abLeftId.value = candidates[0].id
    if (!abRightId.value && candidates[1]) abRightId.value = candidates[1].id
  }
}

function pickForAb(cellId: string): void {
  if (abLeftId.value === cellId) {
    abLeftId.value = ''
    return
  }
  if (abRightId.value === cellId) {
    abRightId.value = ''
    return
  }
  if (!abLeftId.value) {
    abLeftId.value = cellId
  } else {
    abRightId.value = cellId
  }
}

function cellDisplayUrl(cell: AdVariantCell): string {
  const rel = getAdVariantCellActiveRef(cell)
  if (!rel) return ''
  return resolvedPathUrls[rel] ?? ''
}

async function openCellPreview(cell: AdVariantCell): Promise<void> {
  const rel = getAdVariantCellActiveRef(cell)
  if (!rel) return
  const title = Object.values(cell.combo).join(' · ') || draft.product
  await openFullImagePreview({ relativePath: rel, title })
}

function setActiveVersion(cellId: string, index: number): void {
  const meta = ensureCellMeta(cellId)
  meta.activeOutputIndex = index
  syncToLiveNode()
}

function toggleLock(cellId: string): void {
  const meta = ensureCellMeta(cellId)
  meta.locked = !meta.locked
  syncToLiveNode()
}

function togglePromptDrawer(cellId: string): void {
  expandedPromptCellIds[cellId] = !expandedPromptCellIds[cellId]
}

function onCustomPromptInput(cellId: string, value: string): void {
  const meta = ensureCellMeta(cellId)
  const trimmed = value.trim()
  meta.customPrompt = trimmed ? value : undefined
}

function resetCellCustomPrompt(cellId: string): void {
  const meta = ensureCellMeta(cellId)
  meta.customPrompt = undefined
}

function onCellNoteInput(cellId: string, value: string): void {
  const meta = ensureCellMeta(cellId)
  meta.note = value.trim() ? value : undefined
}

const exporting = ref(false)
const exportStatus = ref('')

function buildCellFileName(cell: AdVariantCell): string {
  const base = [draft.product.trim() || 'variant', ...Object.values(cell.combo)]
    .map((s) => s.trim())
    .filter(Boolean)
    .join('-')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
  return (base || 'variant').slice(0, 120)
}

async function exportSelected(): Promise<void> {
  const cells = selectedCells.value
  if (!cells.length || exporting.value) return
  exporting.value = true
  exportStatus.value = ''
  try {
    const items = cells
      .map((c) => ({
        relativePath: getAdVariantCellActiveRef(c) ?? '',
        fileName: buildCellFileName(c)
      }))
      .filter((it) => it.relativePath)
    if (!items.length) {
      exportStatus.value = t('graph.adVariants.exportNoFiles')
      return
    }
    const res = await window.studio.exportAdVariants({ items })
    if (res.canceled) {
      exportStatus.value = ''
    } else if (res.ok) {
      const skipped = res.skipped ? t('graph.adVariants.exportSkipped', { n: res.skipped }) : ''
      exportStatus.value = t('graph.adVariants.exportDone', {
        copied: res.copied,
        skipped,
        directory: res.directory
      })
    } else {
      exportStatus.value = res.error ?? t('graph.adVariants.exportFailed')
    }
  } catch (err) {
    exportStatus.value = err instanceof Error ? err.message : String(err)
  } finally {
    exporting.value = false
  }
}

function setVerdict(cellId: string, verdict: AdVariantVerdict | undefined): void {
  const meta = ensureCellMeta(cellId)
  meta.verdict = verdict
  syncToLiveNode()
}

function verdictClass(cellId: string): string {
  const v = cellMeta[cellId]?.verdict
  return v === 'selected' ? 'is-selected' : v === 'rejected' ? 'is-rejected' : ''
}

const hasVerdicts = computed(() => mergedCells.value.some((c) => Boolean(c.verdict)))

function clearAllVerdicts(): void {
  for (const key of Object.keys(cellMeta)) {
    if (cellMeta[key]) cellMeta[key].verdict = undefined
  }
  syncToLiveNode()
}

function rejectAllUnmarked(): void {
  for (const cell of renderedCells.value) {
    const meta = ensureCellMeta(cell.id)
    if (!meta.verdict) {
      meta.verdict = 'rejected'
    }
  }
  syncToLiveNode()
}

async function resolveGeneratedImages(cells: AdVariantCell[]): Promise<void> {
  const paths = new Set<string>()
  for (const cell of cells) {
    for (const refPath of cell.outputRefs) {
      if (refPath && !resolvedPathUrls[refPath]) {
        paths.add(refPath)
      }
    }
  }
  if (!paths.size) return
  await Promise.all(
    Array.from(paths).map(async (rel) => {
      const url = await resolveAssetFileUrl(rel)
      if (url) resolvedPathUrls[rel] = url
    })
  )
}

function onModelChange(payload: {
  generateModel: string
  generateProviderInstanceId: string
}): void {
  modelDraft.generateModel = payload.generateModel
  modelDraft.generateProviderInstanceId = payload.generateProviderInstanceId
}

function buildMatrix(): AdVariantMatrix {
  const dims = draft.dimensions
    .map((d) => ({ id: d.id, label: d.label.trim(), values: parseValues(d.valuesText) }))
    .filter((d) => d.id)
  return normalizeAdVariantMatrix({
    product: draft.product,
    sellingPoints: draft.sellingPoints.trim() || undefined,
    ctaText: draft.ctaText.trim() || undefined,
    aspectRatio: draft.aspectRatio.trim() || undefined,
    quality: draft.quality.trim() || undefined,
    outputFilter: draft.outputFilter,
    dimensions: dims,
    cells: mergedCells.value
  })
}

function syncToLiveNode(extraParams?: {
  adVariantRunMode?: 'missing' | 'all'
  adVariantOnlyCellId?: string
}): void {
  if (!props.hostId || !props.nodeId || !liveNode.value) return
  const model = modelFieldEl.value?.currentSelection() ?? { ...modelDraft }
  graphEditorHosts.updateNode(props.hostId, props.nodeId, {
    adVariantMatrix: buildMatrix(),
    generateModel: model.generateModel,
    generateProviderInstanceId: model.generateProviderInstanceId,
    ...(extraParams ?? {})
  })
}

function onRunMatrix(mode: 'missing' | 'all'): void {
  if (!canRunInWorkbench.value || isNodeRunning.value || blocked.value) return
  syncToLiveNode({
    adVariantRunMode: mode,
    adVariantOnlyCellId: undefined
  })
  toggleRun()
}

function onRunSingleCell(cellId: string): void {
  if (!canRunInWorkbench.value || isNodeRunning.value || blocked.value) return
  syncToLiveNode({
    adVariantRunMode: 'all',
    adVariantOnlyCellId: cellId
  })
  toggleRun()
}

function onStopRun(): void {
  if (!canRunInWorkbench.value || !isNodeRunning.value) return
  toggleRun()
}

function onSave(): void {
  const model = modelFieldEl.value?.currentSelection() ?? { ...modelDraft }
  emit('save', {
    matrix: buildMatrix(),
    generateModel: model.generateModel,
    generateProviderInstanceId: model.generateProviderInstanceId
  })
}

function onClose(): void {
  syncToLiveNode()
  emit('close')
}

onBeforeUnmount(() => {
  syncToLiveNode()
})

function loadFromMatrix(matrix: AdVariantMatrix): void {
  draft.product = matrix.product
  draft.sellingPoints = matrix.sellingPoints ?? ''
  draft.ctaText = matrix.ctaText ?? ''
  draft.aspectRatio = matrix.aspectRatio ?? ''
  draft.quality = matrix.quality ?? ''
  draft.outputFilter = normalizeAdVariantOutputFilter(matrix.outputFilter)
  draft.dimensions = matrix.dimensions.map((d) => ({
    id: d.id,
    label: d.label,
    valuesText: d.values.join('\n')
  }))

  for (const key of Object.keys(cellMeta)) delete cellMeta[key]
  for (const cell of matrix.cells) {
    cellMeta[cell.id] = {
      outputRefs: [...cell.outputRefs],
      activeOutputIndex: cell.activeOutputIndex,
      verdict: cell.verdict,
      customPrompt: cell.customPrompt,
      locked: cell.locked,
      note: cell.note
    }
  }
  void resolveGeneratedImages(matrix.cells)
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    const sourceMatrix =
      (liveNode.value ? readAdVariantMatrixFromNode(liveNode.value.params) : null) ??
      props.matrix ??
      DEFAULT_AD_VARIANT_MATRIX
    modelDraft.generateModel = liveNode.value?.params.generateModel ?? props.generateModel ?? ''
    modelDraft.generateProviderInstanceId =
      liveNode.value?.params.generateProviderInstanceId ?? props.generateProviderInstanceId ?? ''
    loadFromMatrix(sourceMatrix)
  },
  { immediate: true }
)

/** Watch liveNode's adVariantMatrix so newly generated images appear immediately in workbench */
watch(
  () => liveNode.value?.params.adVariantMatrix,
  (raw) => {
    if (!raw || !props.open) return
    const latest = readAdVariantMatrixFromNode({ adVariantMatrix: raw })
    for (const cell of latest.cells) {
      const meta = ensureCellMeta(cell.id)
      if (cell.outputRefs.length > 0) {
        meta.outputRefs = [...cell.outputRefs]
        meta.activeOutputIndex = cell.activeOutputIndex
      }
      if (cell.verdict !== undefined) {
        meta.verdict = cell.verdict
      }
    }
    void resolveGeneratedImages(latest.cells)
  },
  { deep: true }
)
</script>

<style scoped>
.editor-root {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
  flex-shrink: 0;
}

.summary-metrics {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.summary-item {
  display: flex;
  align-items: baseline;
  gap: 5px;
}

.summary-value {
  font-size: 15px;
  font-weight: 700;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}

.summary-value.success {
  color: var(--success, #16a34a);
}

.summary-label {
  font-size: 12px;
  color: var(--text-muted);
}

.summary-sep {
  color: var(--border);
}

.top-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.output-filter-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--bg-input);
}

.output-filter-label {
  font-size: 11px;
  color: var(--text-muted);
  padding: 0 4px;
}

.seg-mini-btn {
  padding: 3px 8px;
  font-size: 11px;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-radius: 5px;
  cursor: pointer;
}

.seg-mini-btn.active {
  color: var(--text);
  background: var(--bg-elevated);
  font-weight: 600;
}

.run-btn {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  border: 1px solid transparent;
}

.run-btn.primary {
  color: #fff;
  background: var(--accent);
}

.run-btn.secondary {
  color: var(--text);
  background: var(--bg-input);
  border-color: var(--border);
}

.run-btn.stop {
  color: #fff;
  background: var(--danger);
}

.run-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.editor-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
}

.columns {
  display: grid;
  grid-template-columns: minmax(340px, 0.85fr) minmax(0, 1.35fr);
  gap: 14px;
  align-items: start;
  flex: 1;
  min-height: 0;
}

.column {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  min-height: 0;
}

.card {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elevated);
  overflow: hidden;
}

.card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-elevated) 82%, var(--bg-input));
}

.matrix-head {
  flex-wrap: wrap;
}

.step-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}

.card-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  flex: 1;
  min-width: 0;
}

.card-head-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: auto;
}

.card-hint {
  margin: 0;
  padding: 6px 12px 0;
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-muted);
}

.card-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}

.brief-body {
  gap: 8px;
}

.field-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-title {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 500;
}

.brief-two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.pill-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.pill-btn {
  padding: 3px 8px;
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 999px;
  cursor: pointer;
}

.pill-btn.active {
  color: var(--accent);
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  font-weight: 600;
}

.preset-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-input) 50%, transparent);
}

.preset-group-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.group-tab {
  padding: 3px 8px;
  font-size: 11px;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
}

.group-tab.active {
  color: var(--text);
  background: var(--bg-elevated);
  border-color: var(--border);
  font-weight: 600;
}

.preset-group-items {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.preset-btn {
  padding: 4px 10px;
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 999px;
  cursor: pointer;
}

.preset-btn.active {
  color: var(--accent);
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.quick-dims-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  padding: 8px 12px 0;
}

.quick-dims-label {
  font-size: 11px;
  color: var(--text-muted);
}

.quick-dim-btn {
  padding: 2px 8px;
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-input);
  border: 1px dashed var(--border);
  border-radius: 6px;
  cursor: pointer;
}

.quick-dim-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.card-empty {
  margin: 0;
  padding: 20px 12px;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
  border: 1px dashed var(--border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-input) 60%, transparent);
}

.input {
  width: 100%;
  padding: 7px 9px;
  font-size: 12px;
  color: var(--text);
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-sizing: border-box;
}

.textarea {
  resize: vertical;
  line-height: 1.45;
}

.add-dim {
  padding: 4px 10px;
  font-size: 11px;
  color: var(--accent);
  background: transparent;
  border: 1px solid var(--accent);
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}

.dim-list {
  gap: 8px;
}

.dim-row {
  display: grid;
  grid-template-columns: 20px minmax(0, 0.9fr) minmax(0, 1.6fr) 24px;
  gap: 6px;
  align-items: start;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-input);
}

.dim-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-top: 5px;
  border-radius: 50%;
  background: var(--bg-hover);
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 600;
}

.remove-dim {
  width: 24px;
  height: 24px;
  font-size: 15px;
  color: var(--text-muted);
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.remove-dim:hover {
  color: var(--danger);
  background: var(--bg-hover);
}

/* Filter Bar */
.filter-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}

.filter-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 999px;
  cursor: pointer;
}

.filter-tab.active {
  color: var(--accent);
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  font-weight: 600;
}

.filter-count {
  font-size: 10px;
  opacity: 0.8;
}

/* A/B PK Arena */
.ab-arena {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--accent) 5%, var(--bg-elevated));
}

.ab-arena-hint {
  font-size: 11px;
  color: var(--text-muted);
}

.ab-slots {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.ab-slot {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-input);
}

.ab-slot.is-selected {
  border-color: var(--success, #16a34a);
}

.ab-slot.is-rejected {
  border-color: var(--danger);
  opacity: 0.75;
}

.ab-slot-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ab-slot-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: var(--accent);
  flex-shrink: 0;
}

.ab-slot-media {
  cursor: zoom-in;
}

.ab-slot-img {
  width: 100%;
  max-height: 260px;
  object-fit: contain;
  border-radius: 6px;
  background: var(--image-checker-bg);
  display: block;
}

.ab-slot-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 160px;
  font-size: 12px;
  color: var(--text-muted);
  border: 1px dashed var(--border);
  border-radius: 6px;
}

/* Unified Matrix Grid */
.matrix-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(215px, 1fr));
  gap: 10px;
}

.variant-card {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 9px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 9px;
  transition:
    border-color 0.12s ease,
    box-shadow 0.12s ease;
}

.variant-card.is-selected {
  border-color: var(--success, #16a34a);
  box-shadow: 0 0 0 1px var(--success, #16a34a);
}

.variant-card.is-rejected {
  border-color: var(--danger);
  opacity: 0.72;
}

.variant-card.is-ab-picked {
  box-shadow: 0 0 0 2px var(--accent);
}

.variant-card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px;
}

.cell-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}

.tag {
  padding: 1px 7px;
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-hover);
  border-radius: 10px;
}

.cell-quick-tools {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}

.icon-tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 4px;
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 5px;
  cursor: pointer;
}

.icon-tool-btn:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-muted);
}

.icon-tool-btn.active {
  color: var(--accent);
  border-color: var(--accent);
}

.icon-tool-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.compare-media {
  position: relative;
  cursor: zoom-in;
}

.compare-img {
  width: 100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  border-radius: 6px;
  background: var(--image-checker-bg);
  display: block;
}

.compare-img.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--text-muted);
  background: var(--bg-elevated);
}

.version-bar {
  position: absolute;
  left: 6px;
  bottom: 6px;
  display: flex;
  gap: 3px;
  padding: 2px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.65);
}

.version-pill {
  padding: 1px 6px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.8);
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.version-pill.active {
  color: #fff;
  background: var(--accent);
  font-weight: 700;
}

.prompt-preview-box {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  min-height: 84px;
  border-radius: 6px;
  border: 1px dashed var(--border);
  background: var(--bg-elevated);
}

.cell-prompt {
  margin: 0;
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}

.custom-badge {
  align-self: flex-start;
  padding: 1px 6px;
  font-size: 10px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border-radius: 4px;
}

.cell-drawer {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 7px;
  border-radius: 6px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
}

.drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.drawer-label {
  font-size: 10px;
  color: var(--text-muted);
}

.drawer-reset {
  padding: 1px 6px;
  font-size: 10px;
  color: var(--accent);
  background: transparent;
  border: none;
  cursor: pointer;
}

.drawer-textarea {
  font-size: 11px;
}

.drawer-note {
  font-size: 11px;
  padding: 5px 7px;
}

.cell-note-preview {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  font-style: italic;
}

.ab-toggle-btn,
.clear-all {
  padding: 4px 9px;
  font-size: 11px;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}

.ab-toggle-btn.active {
  color: var(--accent);
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.ab-toggle-btn:disabled,
.clear-all:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.export-btn {
  padding: 4px 11px;
  font-size: 11px;
  color: #fff;
  background: var(--accent);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}

.export-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.export-status {
  margin: 0;
  padding: 8px 12px 0;
  font-size: 12px;
  color: var(--success, #16a34a);
}

.verdict-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
}

.verdict-badge.selected {
  background: var(--success, #16a34a);
}

.verdict-badge.rejected {
  background: var(--danger);
}

.verdict-row {
  display: flex;
  gap: 4px;
  margin-top: auto;
}

.verdict-btn {
  flex: 1;
  padding: 4px 0;
  font-size: 11px;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 5px;
  cursor: pointer;
}

.verdict-btn:hover {
  color: var(--text);
  background: var(--bg-hover);
}

.verdict-btn.active {
  color: #fff;
  background: var(--success, #16a34a);
  border-color: var(--success, #16a34a);
}

.verdict-btn.reject.active {
  background: var(--danger);
  border-color: var(--danger);
}

.editor-footer {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}

.save-btn {
  padding: 8px 22px;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  background: var(--accent);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}

.save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@container (max-width: 820px) {
  .columns {
    grid-template-columns: 1fr;
  }
  .ab-slots {
    grid-template-columns: 1fr;
  }
}
</style>
