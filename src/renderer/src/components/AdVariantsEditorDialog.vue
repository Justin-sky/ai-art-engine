<template>
  <StudioFloatingWindow
    :open="open"
    :title="t('graph.adVariants.appMark')"
    :z-index="1200"
    :default-width="920"
    :default-height="640"
    :min-width="640"
    :min-height="440"
    body-class="pad-none"
    @close="onClose"
  >
    <div class="editor-root">
      <div class="editor-body">
        <div class="summary-bar">
          <div class="summary-item">
            <strong class="summary-value">{{ draft.dimensions.length }}</strong>
            <span class="summary-label">{{ t('graph.adVariants.dimensions') }}</span>
          </div>
          <span class="summary-sep">·</span>
          <div class="summary-item">
            <strong class="summary-value">{{ previewCells.length }}</strong>
            <span class="summary-label">{{ t('graph.adVariants.preview') }}</span>
          </div>
        </div>

        <div class="presets">
          <div
            v-for="group in presetGroups"
            :key="group.id"
            class="preset-group"
          >
            <span class="preset-group-label">
              {{ t(`graph.adVariants.presetGroups.${group.labelKey}`) }}
            </span>
            <div class="preset-group-items">
              <button
                v-for="preset in presetsForGroup(group.id)"
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
        </div>

        <div class="columns">
          <div class="column column-left">
            <section class="card">
              <header class="card-head">
                <span class="step-badge">1</span>
                <h3 class="card-title">
                  {{ t('graph.adVariants.dimensions') }}
                </h3>
                <button
                  type="button"
                  class="add-dim"
                  @click="addDimension"
                >
                  + {{ t('graph.adVariants.addDimension') }}
                </button>
              </header>
              <p class="card-hint">
                {{ t('graph.adVariants.dimensionHint') }}
              </p>
              <div class="card-body dim-list">
                <div
                  v-for="(dim, index) in draft.dimensions"
                  :key="dim.id"
                  class="dim-row"
                >
                  <span class="dim-index">{{ index + 1 }}</span>
                  <input
                    v-model="dim.label"
                    class="input dim-label"
                    type="text"
                    :placeholder="t('graph.adVariants.dimensionLabelPlaceholder')"
                  >
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
                <p
                  v-if="!draft.dimensions.length"
                  class="card-empty"
                >
                  {{ t('graph.adVariants.dimensionEmpty') }}
                </p>
              </div>
            </section>
          </div>

          <div class="column column-right">
            <section class="card">
              <header class="card-head">
                <span class="step-badge">2</span>
                <h3 class="card-title">
                  {{ t('graph.adVariants.preview') }}
                </h3>
                <span class="count-chip">{{ t('graph.adVariants.cellCount', { n: previewCells.length }) }}</span>
              </header>
              <div class="card-body">
                <div
                  v-if="previewCells.length"
                  class="cells-preview"
                >
                  <div
                    v-for="cell in previewCells"
                    :key="cell.id"
                    class="cell"
                  >
                    <div class="cell-tags">
                      <span
                        v-for="(value, dimId) in cell.combo"
                        :key="dimId"
                        class="tag"
                      >{{ value }}</span>
                    </div>
                    <p class="cell-prompt">
                      {{ cell.prompt }}
                    </p>
                  </div>
                </div>
                <p
                  v-else
                  class="card-empty"
                >
                  {{ t('graph.adVariants.previewEmpty') }}
                </p>
              </div>
            </section>

            <section class="card">
              <header class="card-head">
                <span class="step-badge">3</span>
                <h3 class="card-title">
                  {{ t('graph.adVariants.compare') }}
                </h3>
                <div class="card-head-actions">
                  <span class="count-chip">{{ t('graph.adVariants.selectedCount', { n: selectedCells.length }) }}</span>
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
                    {{ exporting ? t('graph.adVariants.exporting') : t('graph.adVariants.exportSelected') }}
                  </button>
                </div>
              </header>
              <p
                v-if="exportStatus"
                class="export-status"
              >
                {{ exportStatus }}
              </p>
              <div class="card-body">
                <p
                  v-if="generatedCells.length === 0"
                  class="card-empty"
                >
                  {{ t('graph.adVariants.compareEmptyHint') }}
                </p>
                <div
                  v-else
                  class="compare-grid"
                >
                  <div
                    v-for="cell in generatedCells"
                    :key="cell.id"
                    class="compare-card"
                    :class="verdictClass(cell.id)"
                  >
                    <div class="compare-media">
                      <img
                        v-if="resolvedUrls[cell.id]"
                        :src="resolvedUrls[cell.id]"
                        class="compare-img"
                        alt=""
                      >
                      <div
                        v-else
                        class="compare-img placeholder"
                      >
                        {{ t('graph.adVariants.loading') }}
                      </div>
                      <span
                        v-if="verdicts[cell.id] === 'selected'"
                        class="verdict-badge selected"
                      >✓</span>
                      <span
                        v-else-if="verdicts[cell.id] === 'rejected'"
                        class="verdict-badge rejected"
                      >×</span>
                    </div>
                    <div class="cell-tags">
                      <span
                        v-for="(value, dimId) in cell.combo"
                        :key="dimId"
                        class="tag"
                      >{{ value }}</span>
                    </div>
                    <div class="verdict-row">
                      <button
                        type="button"
                        class="verdict-btn"
                        :class="{ active: verdicts[cell.id] === 'selected' }"
                        @click="setVerdict(cell.id, 'selected')"
                      >
                        {{ t('graph.adVariants.select') }}
                      </button>
                      <button
                        type="button"
                        class="verdict-btn reject"
                        :class="{ active: verdicts[cell.id] === 'rejected' }"
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
          :generate-model="generateModel"
          :generate-provider-instance-id="generateProviderInstanceId"
          @change="onModelChange"
        />
        <button
          type="button"
          class="save-btn"
          :disabled="previewCells.length === 0"
          @click="onSave"
        >
          {{ t('graph.adVariants.save') }}
        </button>
      </div>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  AD_VARIANT_PRESET_GROUPS,
  applyAdVariantPreset,
  DEFAULT_AD_VARIANT_MATRIX,
  expandAdVariantMatrix,
  listAdVariantPresetsForGroup,
  normalizeAdVariantMatrix,
  type AdVariantCell,
  type AdVariantMatrix,
  type AdVariantPresetGroup,
  type AdVariantVerdict
} from '@shared/graph'
import ImageGenerateModelField from './ImageGenerateModelField.vue'
import StudioFloatingWindow from './StudioFloatingWindow.vue'
import { resolveAssetFileUrl } from '../features/media/assetUrlCache'
import { useStudioI18n } from '../composables/useStudioI18n'

const { t } = useStudioI18n()

const presetGroups = AD_VARIANT_PRESET_GROUPS

function presetsForGroup(group: AdVariantPresetGroup) {
  return listAdVariantPresetsForGroup(group)
}

interface DimensionDraft {
  id: string
  label: string
  valuesText: string
}

const props = defineProps<{
  open: boolean
  matrix?: AdVariantMatrix | null
  generateModel?: string
  generateProviderInstanceId?: string
}>()

const emit = defineEmits<{
  close: []
  save: [payload: { matrix: AdVariantMatrix; generateModel: string; generateProviderInstanceId: string }]
}>()

const draft = reactive({
  product: '',
  aspectRatio: '',
  dimensions: [] as DimensionDraft[]
})

const modelDraft = reactive({
  generateModel: '',
  generateProviderInstanceId: ''
})

/** 对比结论：cellId → 入选/淘汰（未标记为缺省）。随保存落回 node.params */
const verdicts = reactive<Record<string, AdVariantVerdict | undefined>>({})

/** cellId → 第一张生成图的可显示 URL（懒解析，带缓存） */
const resolvedUrls = reactive<Record<string, string>>({})

const modelFieldEl = ref<{
  currentSelection: () => { generateModel: string; generateProviderInstanceId: string }
}>()

function parseValues(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
}

function addDimension(): void {
  draft.dimensions.push({ id: `d${Date.now()}`, label: '', valuesText: '' })
}

function removeDimension(index: number): void {
  draft.dimensions.splice(index, 1)
}

function applyPreset(presetId: string): void {
  draft.dimensions = applyAdVariantPreset(presetId).map((dim) => ({
    id: dim.id,
    label: dim.label,
    valuesText: dim.values.join('\n')
  }))
}

function isPresetActive(presetId: string): boolean {
  const dims = applyAdVariantPreset(presetId)
  if (!dims.length) return false
  return (
    draft.dimensions.length === dims.length &&
    draft.dimensions.every((d, index) => d.id === dims[index]?.id)
  )
}

const previewCells = computed(() => {
  const dims = draft.dimensions
    .map((d) => ({ id: d.id, label: d.label.trim(), values: parseValues(d.valuesText) }))
    .filter((d) => d.id)
  return expandAdVariantMatrix(draft.product, dims)
})

/** 已生成（有 outputRefs）的持久化单元格，用于并排对比 */
const generatedCells = computed<AdVariantCell[]>(() => {
  const cells = props.matrix?.cells ?? []
  return cells.filter((c) => c.outputRefs.length > 0)
})

/** 已标记「入选」的单元格，作为导出对象 */
const selectedCells = computed<AdVariantCell[]>(() =>
  generatedCells.value.filter((c) => verdicts[c.id] === 'selected')
)

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
      .map((c) => ({ relativePath: c.outputRefs[0] ?? '', fileName: buildCellFileName(c) }))
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
  if (verdict) verdicts[cellId] = verdict
  else delete verdicts[cellId]
}

function verdictClass(cellId: string): string {
  const v = verdicts[cellId]
  return v === 'selected' ? 'is-selected' : v === 'rejected' ? 'is-rejected' : ''
}

const hasVerdicts = computed(() => Object.keys(verdicts).length > 0)

function clearAllVerdicts(): void {
  for (const key of Object.keys(verdicts)) delete verdicts[key]
}

async function resolveGeneratedImages(cells: AdVariantCell[]): Promise<void> {
  const next: Record<string, string> = {}
  await Promise.all(
    cells.map(async (c) => {
      const rel = c.outputRefs[0]
      if (rel) {
        const url = await resolveAssetFileUrl(rel)
        if (url) next[c.id] = url
      }
    })
  )
  Object.assign(resolvedUrls, next)
}

function onModelChange(payload: {
  generateModel: string
  generateProviderInstanceId: string
}): void {
  modelDraft.generateModel = payload.generateModel
  modelDraft.generateProviderInstanceId = payload.generateProviderInstanceId
}

function buildMatrix(): AdVariantMatrix {
  const existing = props.matrix ?? DEFAULT_AD_VARIANT_MATRIX
  const dims = draft.dimensions
    .map((d) => ({ id: d.id, label: d.label.trim(), values: parseValues(d.valuesText) }))
    .filter((d) => d.id)
  const cells = expandAdVariantMatrix(draft.product, dims)
  // 保留已生成单元格的 outputRefs（按稳定 cell id 对齐，避免编辑后丢失生成结果回填）
  const prevRefs = new Map(existing.cells.map((c) => [c.id, c.outputRefs]))
  const prevVerdicts = new Map(existing.cells.map((c) => [c.id, c.verdict]))
  return normalizeAdVariantMatrix({
    product: draft.product,
    aspectRatio: draft.aspectRatio.trim() || undefined,
    dimensions: dims,
    cells: cells.map((c) => ({
      ...c,
      outputRefs: prevRefs.get(c.id) ?? [],
      verdict: verdicts[c.id] ?? prevVerdicts.get(c.id)
    }))
  })
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
  emit('close')
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    const matrix = props.matrix ?? DEFAULT_AD_VARIANT_MATRIX
    draft.product = matrix.product
    draft.aspectRatio = matrix.aspectRatio ?? ''
    draft.dimensions = matrix.dimensions.map((d) => ({
      id: d.id,
      label: d.label,
      valuesText: d.values.join('\n')
    }))
    modelDraft.generateModel = props.generateModel ?? ''
    modelDraft.generateProviderInstanceId = props.generateProviderInstanceId ?? ''

    // 重置对比结论与已解析图 URL（按持久化单元格回填）
    for (const key of Object.keys(verdicts)) delete verdicts[key]
    for (const key of Object.keys(resolvedUrls)) delete resolvedUrls[key]
    for (const cell of matrix.cells) {
      if (cell.verdict) verdicts[cell.id] = cell.verdict
    }
    void resolveGeneratedImages(matrix.cells)
  },
  { immediate: true }
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
.editor-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.columns {
  display: grid;
  grid-template-columns: minmax(280px, 0.9fr) minmax(0, 1.1fr);
  gap: 14px;
  align-items: start;
  flex: 1;
  min-height: 0;
}
.column {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  min-height: 0;
}

.summary-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  flex-shrink: 0;
}
.summary-item {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.summary-value {
  font-size: 16px;
  font-weight: 700;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}
.summary-label {
  font-size: 12px;
  color: var(--text-muted);
}
.summary-sep {
  color: var(--border);
}

.presets {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}
.preset-group {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.preset-group-label {
  flex: none;
  width: 56px;
  padding-top: 5px;
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
}
.preset-group-items {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}
.preset-btn {
  padding: 5px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color 0.12s ease, color 0.12s ease, background 0.12s ease;
}
.preset-btn:hover {
  color: var(--text);
  border-color: var(--text-muted);
}
.preset-btn.active {
  color: var(--accent);
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
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
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-elevated) 82%, var(--bg-input));
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
  gap: 8px;
  margin-left: auto;
}
.card-hint {
  margin: 0;
  padding: 8px 12px 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-muted);
}
.card-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}
.card-empty {
  margin: 0;
  padding: 16px 12px;
  font-size: 12px;
  color: var(--text-muted);
  text-align: center;
  border: 1px dashed var(--border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-input) 60%, transparent);
}

.count-chip {
  padding: 2px 8px;
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: 999px;
  white-space: nowrap;
}

.input {
  width: 100%;
  padding: 8px 10px;
  font-size: 13px;
  color: var(--text);
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-sizing: border-box;
}
.textarea {
  resize: vertical;
  line-height: 1.5;
}

.add-dim {
  padding: 4px 10px;
  font-size: 12px;
  color: var(--accent);
  background: transparent;
  border: 1px solid var(--accent);
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}
.add-dim:hover {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.dim-list {
  gap: 8px;
}
.dim-row {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) minmax(0, 1.5fr) 28px;
  gap: 8px;
  align-items: start;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-input);
}
.dim-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-top: 5px;
  border-radius: 50%;
  background: var(--bg-hover);
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 600;
}
.remove-dim {
  width: 28px;
  height: 28px;
  font-size: 16px;
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

.cells-preview {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
  max-height: 280px;
  overflow-y: auto;
}
.cell {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px 10px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.cell-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.tag {
  padding: 1px 8px;
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-hover);
  border-radius: 10px;
}
.cell-prompt {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
}

.clear-all {
  padding: 4px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}
.clear-all:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-muted);
}
.clear-all:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.export-btn {
  padding: 4px 12px;
  font-size: 12px;
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
.compare-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 10px;
}
.compare-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 9px;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}
.compare-card.is-selected {
  border-color: var(--success, #16a34a);
  box-shadow: 0 0 0 1px var(--success, #16a34a);
}
.compare-card.is-rejected {
  border-color: var(--danger);
  box-shadow: 0 0 0 1px var(--danger);
  opacity: 0.72;
}
.compare-media {
  position: relative;
}
.compare-img {
  width: 100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  border-radius: 6px;
  background: var(--bg-elevated);
  display: block;
}
.compare-img.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--text-muted);
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
  padding: 12px 16px;
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

@container (max-width: 760px) {
  .columns {
    grid-template-columns: 1fr;
  }
}
</style>
