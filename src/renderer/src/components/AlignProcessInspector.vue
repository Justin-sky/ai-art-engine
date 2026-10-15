<template>
  <div v-if="node" class="node-inspector">
    <div class="head">
      <h2>{{ displayTitle }}</h2>
      <span class="spec-badge">{{ state.canvasWidth }}×{{ state.canvasHeight }}</span>
    </div>
    <p class="hint">
      {{ t('graph.align.hint') }}
    </p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <!-- 1. 游戏精灵画布规格预设 -->
    <section class="panel-card">
      <div class="section-title">{{ t('align.sizePresets') }}</div>
      <div class="chip-grid">
        <button
          v-for="preset in IMAGE_ALIGN_SIZE_PRESETS"
          :key="preset.id"
          type="button"
          class="chip"
          :class="{
            active: state.canvasWidth === preset.width && state.canvasHeight === preset.height
          }"
          @click="applySizePreset(preset.width, preset.height)"
        >
          {{ preset.label }}
        </button>
      </div>

      <div class="grid2">
        <label class="field">
          <span>{{ t('graph.align.canvasWidth') }}</span>
          <input
            type="number"
            min="16"
            max="8192"
            step="16"
            :value="state.canvasWidth"
            @change="onCanvasDimChange('canvasWidth', $event)"
          />
        </label>
        <label class="field">
          <span>{{ t('graph.align.canvasHeight') }}</span>
          <input
            type="number"
            min="16"
            max="8192"
            step="16"
            :value="state.canvasHeight"
            @change="onCanvasDimChange('canvasHeight', $event)"
          />
        </label>
      </div>
    </section>

    <!-- 2. 锚点与占比控制 -->
    <section class="panel-card">
      <label class="field">
        <span>{{ t('graph.align.anchor') }}</span>
        <select :value="state.anchor" @change="onAnchorChange">
          <option value="ground">{{ t('graph.align.anchorGround') }}</option>
          <option value="center">{{ t('graph.align.anchorCenter') }}</option>
        </select>
      </label>

      <label class="slider-field">
        <div class="slider-head">
          <span>{{ t('graph.align.subjectHeight') }}</span>
          <b>{{ Math.round(state.contentHeightRatio * 100) }}%</b>
        </div>
        <input
          type="range"
          min="0.1"
          max="1"
          step="0.02"
          :value="state.contentHeightRatio"
          @change="onRatioChange('contentHeightRatio', $event)"
        />
      </label>

      <label v-if="state.anchor === 'ground'" class="slider-field">
        <div class="slider-head">
          <span>{{ t('graph.align.groundGap') }}</span>
          <b>{{ Math.round(state.groundRatio * 100) }}%</b>
        </div>
        <input
          type="range"
          min="0"
          max="0.5"
          step="0.01"
          :value="state.groundRatio"
          @change="onRatioChange('groundRatio', $event)"
        />
      </label>

      <label class="check-row">
        <input type="checkbox" :checked="state.fitWithinWidth" @change="onFitWidthChange" />
        <span>{{ t('graph.align.fitWidth') }}</span>
      </label>
    </section>

    <!-- 3. 背景预处理 + 镜像与像素微调 -->
    <section class="panel-card">
      <label class="field">
        <span>{{ t('align.bgKey') }}</span>
        <select :value="state.bgKey ?? ''" @change="onBgKeyChange">
          <option value="">{{ t('align.bgKeyNone') }}</option>
          <option value="auto">{{ t('align.bgKeyAuto') }}</option>
          <option value="black">{{ t('align.bgKeyBlack') }}</option>
          <option value="white">{{ t('align.bgKeyWhite') }}</option>
        </select>
      </label>

      <label v-if="state.bgKey" class="slider-field">
        <div class="slider-head">
          <span>{{ t('align.bgThreshold') }}</span>
          <b>{{ state.bgThreshold ?? 42 }}</b>
        </div>
        <input
          type="range"
          min="5"
          max="160"
          step="1"
          :value="state.bgThreshold ?? 42"
          @change="onBgThresholdChange"
        />
      </label>

      <label class="check-row">
        <input type="checkbox" :checked="Boolean(state.defringe)" @change="onDefringeChange" />
        <span>{{ t('align.defringe') }}</span>
      </label>

      <label class="check-row">
        <input
          type="checkbox"
          :checked="Boolean(state.tileSeamless)"
          @change="onTileSeamlessChange"
        />
        <span>{{ t('align.tileSeamless') }}</span>
      </label>

      <label v-if="state.tileSeamless" class="slider-field">
        <div class="slider-head">
          <span>{{ t('align.tileBlendRatio') }}</span>
          <b>{{ Math.round((state.tileBlendRatio ?? 0.15) * 100) }}%</b>
        </div>
        <input
          type="range"
          min="0.05"
          max="0.35"
          step="0.01"
          :value="state.tileBlendRatio ?? 0.15"
          @change="onTileBlendChange"
        />
      </label>

      <label class="slider-field">
        <div class="slider-head">
          <span>{{ t('align.nineSlice') }}</span>
          <b>{{ state.nineSlice ?? 0 }}px</b>
        </div>
        <input
          type="range"
          min="0"
          max="256"
          step="4"
          :value="state.nineSlice ?? 0"
          @change="onNineSliceChange"
        />
      </label>

      <label class="check-row">
        <input type="checkbox" :checked="Boolean(state.flipX)" @change="onFlipXChange" />
        <span>{{ t('align.flipX') }}</span>
      </label>

      <div class="grid2">
        <label class="field">
          <span>{{ t('align.offsetX') }}</span>
          <input
            type="number"
            step="1"
            :value="state.offsetX ?? 0"
            @change="onOffsetChange('offsetX', $event)"
          />
        </label>
        <label class="field">
          <span>{{ t('align.offsetY') }}</span>
          <input
            type="number"
            step="1"
            :value="state.offsetY ?? 0"
            @change="onOffsetChange('offsetY', $event)"
          />
        </label>
      </div>

      <button
        v-if="(state.offsetX ?? 0) !== 0 || (state.offsetY ?? 0) !== 0"
        type="button"
        class="secondary-btn"
        @click="resetOffset"
      >
        {{ t('align.resetOffset') }}
      </button>
    </section>

    <GraphNodeOutputPreview v-if="node && hostId" :node="node" :host-id="hostId" />
  </div>
  <div v-else class="node-inspector empty">
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  IMAGE_ALIGN_SIZE_PRESETS,
  imageAlignToNodePatch,
  readImageAlignFromNode,
  type ImageAlignBgKey,
  type ImageAlignState
} from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'

const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'image.align' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? (selection.hostId ?? '') : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

const typeLabel = computed(() => graphTypeLabel('image.align'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const state = computed(() =>
  node.value ? readImageAlignFromNode(node.value.params) : readImageAlignFromNode({})
)

function updateAlign(patch: Partial<ImageAlignState>): void {
  if (!node.value || !hostId.value) return
  const next = { ...state.value, ...patch }
  graphEditorHosts.updateNode(hostId.value, node.value.id, imageAlignToNodePatch(next))
}

function applySizePreset(width: number, height: number): void {
  updateAlign({ canvasWidth: width, canvasHeight: height })
}

function onCanvasDimChange(key: 'canvasWidth' | 'canvasHeight', event: Event): void {
  const raw = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(raw)) return
  updateAlign({ [key]: Math.min(8192, Math.max(16, Math.round(raw))) })
}

function onAnchorChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  updateAlign({ anchor: value === 'center' ? 'center' : 'ground' })
}

function onRatioChange(key: 'contentHeightRatio' | 'groundRatio', event: Event): void {
  const raw = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(raw)) return
  updateAlign({ [key]: raw })
}

function onFitWidthChange(event: Event): void {
  updateAlign({ fitWithinWidth: (event.target as HTMLInputElement).checked })
}

function onBgKeyChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value as ImageAlignBgKey
  updateAlign({ bgKey: value })
}

function onBgThresholdChange(event: Event): void {
  const raw = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(raw)) return
  updateAlign({ bgThreshold: raw })
}

function onDefringeChange(event: Event): void {
  updateAlign({ defringe: (event.target as HTMLInputElement).checked })
}

function onTileSeamlessChange(event: Event): void {
  const checked = (event.target as HTMLInputElement).checked
  updateAlign({
    tileSeamless: checked,
    ...(checked ? { anchor: 'center', contentHeightRatio: 1 } : {})
  })
}

function onTileBlendChange(event: Event): void {
  const raw = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(raw)) return
  updateAlign({ tileBlendRatio: raw })
}

function onNineSliceChange(event: Event): void {
  const raw = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(raw)) return
  updateAlign({ nineSlice: Math.max(0, Math.round(raw)) })
}

function onFlipXChange(event: Event): void {
  updateAlign({ flipX: (event.target as HTMLInputElement).checked })
}

function onOffsetChange(key: 'offsetX' | 'offsetY', event: Event): void {
  const raw = Number((event.target as HTMLInputElement).value)
  updateAlign({ [key]: Number.isFinite(raw) ? Math.round(raw) : 0 })
}

function resetOffset(): void {
  updateAlign({ offsetX: 0, offsetY: 0 })
}
</script>

<style scoped>
.node-inspector {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  height: 100%;
  overflow: auto;
}

.node-inspector.empty {
  color: var(--text-muted);
  align-items: center;
  justify-content: center;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.head h2 {
  margin: 0;
  font-size: 14px;
}

.spec-badge {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
}

.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

.panel-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-elevated, var(--bg)) 60%, transparent);
}

.section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary, var(--text));
}

.chip-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.chip {
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.chip.active {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent, #fff);
}

.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
  min-width: 0;
}

.field select,
.field input {
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 12px;
  min-width: 0;
}

.slider-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.slider-head {
  display: flex;
  justify-content: space-between;
}

.check-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary, var(--text));
  cursor: pointer;
}

.secondary-btn {
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}
</style>
