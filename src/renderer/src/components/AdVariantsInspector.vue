<template>
  <div v-if="node" class="node-inspector">
    <div class="head">
      <span class="type">{{ typeLabel }}</span>
      <h2>{{ displayTitle }}</h2>
    </div>
    <p class="hint">
      {{ t('graph.inspector.adVariants.hint') }}
    </p>

    <div class="summary-card">
      <span class="summary-text">
        {{
          t('graph.inspector.adVariants.matrixSummary', {
            dims: matrixSummary.dims,
            cells: matrixSummary.cells,
            rendered: matrixSummary.rendered,
            selected: matrixSummary.selected
          })
        }}
      </span>
      <button type="button" class="workbench-btn" @click="openWorkbench">
        {{ t('graph.inspector.adVariants.openWorkbench') }}
      </button>
    </div>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <GraphNodeOutputPreview v-if="node && hostId" :node="node" :host-id="hostId" />

    <label>
      {{ t('graph.adVariants.product') }}
      <ExpandableTextarea
        :key="`product-${node.id}`"
        v-model="product"
        :title="t('graph.adVariants.product')"
        :rows="3"
        :placeholder="t('graph.adVariants.productPlaceholder')"
        @change="persistBrief"
      />
    </label>

    <label>
      {{ t('graph.adVariants.sellingPoints') }}
      <ExpandableTextarea
        :key="`selling-${node.id}`"
        v-model="sellingPoints"
        :title="t('graph.adVariants.sellingPoints')"
        :rows="2"
        :placeholder="t('graph.adVariants.sellingPointsPlaceholder')"
        @change="persistBrief"
      />
    </label>

    <label>
      {{ t('graph.adVariants.ctaText') }}
      <input
        v-model="ctaText"
        class="text-input"
        type="text"
        :placeholder="t('graph.adVariants.ctaTextPlaceholder')"
        @change="persistBrief"
      />
    </label>

    <div class="field-group">
      <span class="field-label">{{ t('graph.adVariants.aspectRatio') }}</span>
      <div class="pill-row">
        <button
          v-for="ratio in AD_VARIANT_ASPECT_RATIOS"
          :key="ratio"
          type="button"
          class="pill-btn"
          :class="{ active: aspectRatio === ratio }"
          @click="selectAspectRatio(ratio)"
        >
          {{ ratio }}
        </button>
      </div>
    </div>

    <div class="field-group">
      <span class="field-label">{{ t('graph.adVariants.quality') }}</span>
      <div class="pill-row">
        <button
          v-for="tier in AD_VARIANT_QUALITY_TIERS"
          :key="tier"
          type="button"
          class="pill-btn"
          :class="{ active: quality === tier }"
          @click="selectQuality(tier)"
        >
          {{ tier }}
        </button>
      </div>
    </div>

    <div class="field-group">
      <span class="field-label">{{ t('graph.adVariants.outputFilter') }}</span>
      <div class="seg-row">
        <button
          type="button"
          class="seg-btn"
          :class="{ active: outputFilter === 'all' }"
          @click="selectOutputFilter('all')"
        >
          {{ t('graph.adVariants.outputFilterAll') }}
        </button>
        <button
          type="button"
          class="seg-btn"
          :class="{ active: outputFilter === 'selectedOnly' }"
          @click="selectOutputFilter('selectedOnly')"
        >
          {{ t('graph.adVariants.outputFilterSelected') }}
        </button>
      </div>
      <span class="sub-hint">{{ t('graph.adVariants.outputFilterHint') }}</span>
    </div>

    <label>
      {{ t('graph.inspector.generate.systemPrompt') }}
      <ExpandableTextarea
        :key="`sys-${node.id}`"
        v-model="systemPrompt"
        :title="t('graph.inspector.generate.systemPrompt')"
        :rows="4"
        :placeholder="t('graph.inspector.generate.systemPromptPlaceholder')"
        @change="persistSystemPrompt"
      />
    </label>
  </div>
  <div v-else class="node-inspector empty">
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  AD_VARIANT_ASPECT_RATIOS,
  AD_VARIANT_QUALITY_TIERS,
  DEFAULT_AD_VARIANT_SYSTEM_PROMPT_EN,
  DEFAULT_AD_VARIANT_SYSTEM_PROMPT_ZH,
  defaultAdVariantSystemPrompt,
  expandAdVariantMatrix,
  getAdVariantCellActiveRef,
  mergeExpandedAdVariantCells,
  normalizeAdVariantOutputFilter,
  readAdVariantMatrixFromNode,
  resolveAdVariantSystemPrompt,
  type AdVariantMatrix,
  type AdVariantOutputFilter
} from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import ExpandableTextarea from './ExpandableTextarea.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { graphEditorNodeTools } from '../features/graph/ui/graphEditorNodeTools'
import { useWorkspaceStore } from '../stores/workspace'

const { t, locale, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()
const workspace = useWorkspaceStore()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'image.adVariants' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? (selection.hostId ?? '') : ''
})

const typeLabel = computed(() => graphTypeLabel('image.adVariants'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

const product = ref('')
const sellingPoints = ref('')
const ctaText = ref('')
const aspectRatio = ref('')
const quality = ref('')
const outputFilter = ref<AdVariantOutputFilter>('all')
const systemPrompt = ref('')

const matrixSummary = computed(() => {
  const current = node.value
  if (!current) return { dims: 0, cells: 0, rendered: 0, selected: 0 }
  const matrix = readAdVariantMatrixFromNode(current.params)
  const rendered = matrix.cells.filter((c) => Boolean(getAdVariantCellActiveRef(c))).length
  const selected = matrix.cells.filter((c) => c.verdict === 'selected').length
  return {
    dims: matrix.dimensions.length,
    cells: matrix.cells.length,
    rendered,
    selected
  }
})

async function openWorkbench(): Promise<void> {
  const current = node.value
  const rootKey = workspace.activeDiveRootKey?.trim()
  if (!current || !hostId.value || !rootKey) return
  await graphEditorNodeTools.open(hostId.value, 'node.adVariants', current.id)
  workspace.diveIntoView(
    rootKey,
    {
      viewId: 'node.adVariants',
      hostId: hostId.value,
      nodeId: current.id
    },
    displayTitle.value
  )
}

function loadConfig(current: NonNullable<typeof node.value>): void {
  const matrix = readAdVariantMatrixFromNode(current.params)
  product.value = matrix.product
  sellingPoints.value = matrix.sellingPoints ?? ''
  ctaText.value = matrix.ctaText ?? ''
  aspectRatio.value = matrix.aspectRatio ?? ''
  quality.value = matrix.quality ?? ''
  outputFilter.value = normalizeAdVariantOutputFilter(matrix.outputFilter)
  systemPrompt.value = resolveAdVariantSystemPrompt(
    current.params.generateSystemPrompt,
    String(locale.value)
  )
}

watch(
  () => [node.value?.id, hostId.value, node.value?.params.adVariantMatrix] as const,
  () => {
    const current = node.value
    if (!current) {
      product.value = ''
      sellingPoints.value = ''
      ctaText.value = ''
      aspectRatio.value = ''
      quality.value = ''
      outputFilter.value = 'all'
      systemPrompt.value = ''
      return
    }
    loadConfig(current)
  },
  { immediate: true }
)

watch(locale, (next) => {
  if (!node.value) return
  const current = systemPrompt.value.trim()
  if (!current || isDefaultSystemPrompt(current)) {
    systemPrompt.value = defaultAdVariantSystemPrompt(String(next))
  }
})

function isDefaultSystemPrompt(value: string): boolean {
  return (
    value === DEFAULT_AD_VARIANT_SYSTEM_PROMPT_EN || value === DEFAULT_AD_VARIANT_SYSTEM_PROMPT_ZH
  )
}

function persistMatrixPatch(patch: Partial<AdVariantMatrix>, reexpand = false): void {
  if (!node.value || !hostId.value) return
  const currentMatrix = readAdVariantMatrixFromNode(node.value.params)
  const nextProduct = patch.product !== undefined ? patch.product : currentMatrix.product
  const nextSelling =
    patch.sellingPoints !== undefined ? patch.sellingPoints : currentMatrix.sellingPoints
  const nextCta = patch.ctaText !== undefined ? patch.ctaText : currentMatrix.ctaText
  const nextCells = reexpand
    ? mergeExpandedAdVariantCells(
        currentMatrix.cells,
        expandAdVariantMatrix(nextProduct, currentMatrix.dimensions, {
          sellingPoints: nextSelling,
          ctaText: nextCta,
          locale: String(locale.value)
        })
      )
    : currentMatrix.cells

  graphEditorHosts.updateNode(hostId.value, node.value.id, {
    adVariantMatrix: {
      ...currentMatrix,
      ...patch,
      cells: nextCells
    }
  })
}

function persistBrief(): void {
  persistMatrixPatch(
    {
      product: product.value,
      sellingPoints: sellingPoints.value.trim() || undefined,
      ctaText: ctaText.value.trim() || undefined
    },
    true
  )
}

function selectAspectRatio(ratio: string): void {
  const next = aspectRatio.value === ratio ? '' : ratio
  aspectRatio.value = next
  persistMatrixPatch({ aspectRatio: next || undefined })
}

function selectQuality(tier: string): void {
  const next = quality.value === tier ? '' : tier
  quality.value = next
  persistMatrixPatch({ quality: next || undefined })
}

function selectOutputFilter(next: AdVariantOutputFilter): void {
  outputFilter.value = next
  persistMatrixPatch({ outputFilter: next })
}

function persistSystemPrompt(): void {
  if (!node.value || !hostId.value) return
  graphEditorHosts.updateNode(hostId.value, node.value.id, {
    generateSystemPrompt: systemPrompt.value
  })
}
</script>

<style scoped>
.node-inspector {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  height: 100%;
  overflow: auto;
}

.node-inspector.empty {
  color: var(--text-muted);
  align-items: center;
  justify-content: center;
}

.head .type {
  font-size: 11px;
  color: var(--text-muted);
}

.head h2 {
  margin: 4px 0 0;
  font-size: 14px;
}

.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

.summary-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
}

.summary-text {
  font-size: 11px;
  color: var(--text-secondary);
}

.workbench-btn {
  width: 100%;
  padding: 7px 10px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: var(--accent);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.workbench-btn:hover {
  opacity: 0.92;
}

label,
.field-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: var(--text-muted);
}

.field-label {
  font-size: 12px;
  color: var(--text-muted);
}

.sub-hint {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.35;
}

.text-input {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 10px;
  font-size: 12px;
  color: var(--text);
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.pill-row {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.pill-btn {
  padding: 4px 9px;
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 999px;
  cursor: pointer;
}

.pill-btn:hover {
  color: var(--text);
  border-color: var(--text-muted);
}

.pill-btn.active {
  color: var(--accent);
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  font-weight: 600;
}

.seg-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 3px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.seg-btn {
  padding: 5px 8px;
  font-size: 11px;
  color: var(--text-secondary);
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.seg-btn.active {
  color: var(--text);
  background: var(--bg-input);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
}
</style>
