<template>
  <div v-if="node" class="node-inspector">
    <div class="head">
      <h2>{{ displayTitle }}</h2>
    </div>
    <p class="hint">
      {{ t('graph.inspector.layerSplit.hint') }}
    </p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <GraphNodeOutputPreview v-if="node && hostId" :node="node" :host-id="hostId" />

    <label class="field-block">
      <span class="field-label">{{ t('graph.layerSplit.splitMode') }}</span>
      <select class="select" :value="state.splitMode || 'auto'" @change="onSplitModeChange">
        <option v-for="mode in splitModeOptions" :key="mode.id" :value="mode.id">
          {{ mode.label }}
        </option>
      </select>
      <span class="mode-hint">{{ activeStrategyHint }}</span>
    </label>

    <template v-if="effectiveStrategy !== 'local-slice'">
      <ImageGenerateModelField
        :open="Boolean(node)"
        :generate-model="node.params.generateModel ?? ''"
        :generate-provider-instance-id="node.params.generateProviderInstanceId ?? ''"
        @change="onModelChange"
      />

      <label class="field-block">
        <span class="field-label">{{ t('graph.layerSplit.resolution') }}</span>
        <select class="select" :value="state.resolution" @change="onResolutionChange">
          <option v-for="res in resolutions" :key="res" :value="res">{{ res }}</option>
        </select>
      </label>
    </template>

    <label class="field-block">
      <span class="field-label">{{ t('graph.layerSplit.prompt') }}</span>
      <textarea
        class="prompt"
        :value="state.prompt"
        rows="4"
        :placeholder="t('graph.layerSplit.promptPlaceholder')"
        @change="onPromptChange"
      />
    </label>

    <div class="preset-block">
      <span class="preset-label">{{ t('graph.layerSplit.presets') }}</span>
      <div class="preset-chips">
        <button
          v-for="preset in presetOptions"
          :key="preset.id"
          type="button"
          class="preset-chip"
          :class="{ active: isPresetActive(preset.prompt) }"
          @click="applyPreset(preset.prompt)"
        >
          {{ preset.label }}
        </button>
      </div>
    </div>

    <dl class="meta">
      <div>
        <dt>{{ t('graph.layerSplit.resolution') }}</dt>
        <dd>{{ state.resolution }}</dd>
      </div>
      <div>
        <dt>{{ t('graph.layerSplit.layers') }}</dt>
        <dd>{{ state.layers.length || '—' }}</dd>
      </div>
      <div v-if="state.groups.length">
        <dt>{{ t('graph.layerSplit.group') }}</dt>
        <dd>{{ state.groups.length }}</dd>
      </div>
    </dl>

    <div v-if="state.layers.length" class="inspector-actions">
      <button
        type="button"
        class="clear-btn"
        :title="t('graph.layerSplit.autoUiGroupHint')"
        @click="autoGroupUiLayers"
      >
        {{ t('graph.layerSplit.autoUiGroup') }}
      </button>
      <button type="button" class="clear-btn" @click="clearLayers">
        {{ t('graph.layerSplit.redecompose') }}
      </button>
    </div>
  </div>
  <div v-else class="node-inspector empty">
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  LAYER_SPLIT_RESOLUTIONS,
  UI_LAYER_SPLIT_PRESETS,
  autoGroupLayersForGameUi,
  imageLayerSplitToNodePatch,
  normalizeLayerSplitMode,
  normalizeLayerSplitResolution,
  readImageLayerSplitFromNode,
  resolveEffectiveUiLayerSplitStrategy,
  type ImageLayerSplitState,
  type UiLayerSplitMode,
  type UiLayerSplitPresetId
} from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import ImageGenerateModelField from './ImageGenerateModelField.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'

const { t, locale, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()
const resolutions = LAYER_SPLIT_RESOLUTIONS

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'image.layerSplit' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? (selection.hostId ?? '') : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)
const typeLabel = computed(() => graphTypeLabel('image.layerSplit'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)
const state = computed(() =>
  node.value ? readImageLayerSplitFromNode(node.value.params) : readImageLayerSplitFromNode({})
)

const splitModeOptions = computed<Array<{ id: UiLayerSplitMode; label: string }>>(() => [
  { id: 'auto', label: t('graph.layerSplit.splitModeAuto') },
  { id: 'ai-inpaint-slice', label: t('graph.layerSplit.splitModeAiInpaintSlice') },
  { id: 'ai-layers', label: t('graph.layerSplit.splitModeAiLayers') },
  { id: 'local-slice', label: t('graph.layerSplit.splitModeLocalSlice') }
])

const effectiveStrategy = computed(() =>
  resolveEffectiveUiLayerSplitStrategy(state.value.splitMode, node.value?.params.generateModel)
)

const activeStrategyHint = computed(() => {
  if (effectiveStrategy.value === 'local-slice') {
    return t('graph.layerSplit.splitModeHintLocalSlice')
  }
  if (effectiveStrategy.value === 'ai-inpaint-slice') {
    return t('graph.layerSplit.splitModeHintAiInpaint')
  }
  return t('graph.layerSplit.splitModeHintAutoLayers')
})

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

function isPresetActive(promptText: string): boolean {
  return state.value.prompt.trim() === promptText.trim()
}

function applyPreset(promptText: string): void {
  persist({
    ...state.value,
    prompt: promptText
  })
}

function autoGroupUiLayers(): void {
  const isZh = String(locale.value || '')
    .toLowerCase()
    .startsWith('zh')
  persist(autoGroupLayersForGameUi(state.value, isZh ? 'zh-CN' : 'en-US'))
}

function persist(next: ImageLayerSplitState): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return
  graphEditorHosts.updateNode(hid, current.id, imageLayerSplitToNodePatch(next))
}

function onSplitModeChange(event: Event): void {
  const splitMode = normalizeLayerSplitMode((event.target as HTMLSelectElement).value)
  persist({
    ...state.value,
    splitMode
  })
}

function onResolutionChange(event: Event): void {
  const resolution = normalizeLayerSplitResolution((event.target as HTMLSelectElement).value)
  persist({
    ...state.value,
    resolution
  })
}

function onModelChange(payload: {
  generateModel: string
  generateProviderInstanceId: string
}): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return
  if (
    (current.params.generateModel ?? '') === payload.generateModel &&
    (current.params.generateProviderInstanceId ?? '') === payload.generateProviderInstanceId
  ) {
    return
  }
  graphEditorHosts.updateNode(hid, current.id, {
    generateModel: payload.generateModel,
    generateProviderInstanceId: payload.generateProviderInstanceId
  })
}

function onPromptChange(event: Event): void {
  const value = (event.target as HTMLTextAreaElement).value
  persist({
    ...state.value,
    prompt: value
  })
}

function clearLayers(): void {
  persist({
    ...state.value,
    layers: [],
    groups: [],
    sourceFingerprint: '',
    canvasWidth: 0,
    canvasHeight: 0,
    selectedId: ''
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

.head h2 {
  margin: 0;
  font-size: 14px;
}

.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

.field-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 12px;
  color: var(--text-muted);
}

.select {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text);
  padding: 8px 10px;
  font-size: 12px;
}

.mode-hint {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.35;
}

.prompt {
  display: block;
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  padding: 8px;
  font-size: 12px;
  resize: vertical;
}

.preset-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.preset-label {
  font-size: 11px;
  color: var(--text-muted);
}

.preset-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.preset-chip {
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg);
  color: var(--text);
  padding: 4px 10px;
  font-size: 11px;
  cursor: pointer;
}

.preset-chip.active,
.preset-chip:hover {
  border-color: #4a90e2;
  color: #4a90e2;
}

.meta {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
}

.meta div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.meta dt {
  color: var(--text-muted);
}

.meta dd {
  margin: 0;
  color: var(--text);
  text-align: right;
}

.inspector-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.clear-btn {
  align-self: flex-start;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-hover);
  color: var(--text);
  padding: 7px 12px;
  font-size: 12px;
  cursor: pointer;
}
</style>
