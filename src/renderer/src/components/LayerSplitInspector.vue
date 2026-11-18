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

    <ImageGenerateModelField
      :open="Boolean(node)"
      :label="t('graph.layerSplit.splitModelLabel')"
      :empty-label="t('graph.layerSplit.noSeedreamProModels')"
      :model-filter="isSeedreamSplitOption"
      :generate-model="node.params.generateModel ?? ''"
      :generate-provider-instance-id="node.params.generateProviderInstanceId ?? ''"
      @change="onModelChange"
    />

    <ImageGenerateModelField
      :open="Boolean(node)"
      :label="t('graph.layerSplit.repairModelLabel')"
      :generate-model="node.params.repairModel ?? ''"
      :generate-provider-instance-id="node.params.repairProviderInstanceId ?? ''"
      @change="onRepairModelChange"
    />

    <div class="field-row">
      <label class="field-block">
        <span class="field-label">{{ t('graph.layerSplit.resolution') }}</span>
        <select class="select" :value="state.resolution" @change="onResolutionChange">
          <option v-for="res in resolutions" :key="res" :value="res">{{ res }}</option>
        </select>
      </label>

      <label class="field-block">
        <span class="field-label">{{ t('graph.layerSplit.maxLayers') }}</span>
        <select class="select" :value="state.maxLayers ?? 0" @change="onMaxLayersChange">
          <option v-for="opt in maxLayersChoices" :key="opt" :value="opt">
            {{ formatMaxLayersLabel(opt) }}
          </option>
        </select>
      </label>
    </div>

    <div class="field-block">
      <div class="field-label-row">
        <span class="field-label">{{ t('graph.layerSplit.prompt') }}</span>
        <span class="field-sub">{{ t('graph.layerSplit.presets') }}</span>
      </div>
      <div class="preset-chips">
        <button
          v-for="preset in presetItems"
          :key="preset.id"
          type="button"
          class="preset-chip"
          :class="{ active: activePresetId === preset.id }"
          @click="applyPreset(preset.id)"
        >
          {{ preset.label }}
        </button>
      </div>
      <textarea
        class="textarea"
        rows="3"
        :value="state.prompt"
        :placeholder="t('graph.layerSplit.promptPlaceholder')"
        @input="onPromptInput"
      />
    </div>

    <dl class="meta">
      <div>
        <dt>{{ t('graph.layerSplit.resolution') }}</dt>
        <dd>{{ state.resolution }}</dd>
      </div>
      <div>
        <dt>{{ t('graph.layerSplit.maxLayers') }}</dt>
        <dd>{{ formatMaxLayersLabel(state.maxLayers ?? 0) }}</dd>
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
      <button type="button" class="clear-btn primary-btn" :disabled="exporting" @click="exportPsd">
        {{ t('graph.layerSplit.exportPsd') }}
      </button>
      <button
        type="button"
        class="clear-btn"
        :disabled="exporting"
        :title="t('graph.layerSplit.exportManifest')"
        @click="exportManifestJson"
      >
        {{ t('graph.layerSplit.exportManifestShort') }}
      </button>
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
    <p v-if="exportMessage" class="export-msg" :class="{ error: exportFailed }">
      {{ exportMessage }}
    </p>
  </div>
  <div v-else class="node-inspector empty">
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  LAYER_SPLIT_MAX_LAYERS_OPTIONS,
  LAYER_SPLIT_RESOLUTIONS,
  UI_LAYER_SPLIT_PRESETS,
  autoGroupLayersForGameUi,
  buildLayerSplitUiManifest,
  imageLayerSplitToNodePatch,
  isNativeLayerDecompositionModel,
  normalizeLayerSplitMaxLayers,
  normalizeLayerSplitResolution,
  readImageLayerSplitFromNode,
  type ImageLayerSplitState,
  type UiLayerSplitPresetId
} from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import ImageGenerateModelField from './ImageGenerateModelField.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import type { GenerateModelOption } from '../features/graph/model/generateModelOptions'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { layerSplitToPsdUint8Array } from '../features/graph/model/layerSplitPsd'

const { t, locale, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()
const resolutions = LAYER_SPLIT_RESOLUTIONS
const exporting = ref(false)
const exportMessage = ref('')
const exportFailed = ref(false)
let exportMsgTimer: ReturnType<typeof setTimeout> | null = null

const isZhLocale = computed(() =>
  String(locale.value || '')
    .toLowerCase()
    .startsWith('zh')
)

function isSeedreamSplitOption(opt: GenerateModelOption): boolean {
  return isNativeLayerDecompositionModel(opt.model, opt.label)
}

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

const isOpenRouterSplitModel = computed(() => {
  const model = node.value?.params.generateModel?.trim() ?? ''
  return /^bytedance-seed\//i.test(model)
})

const maxLayersChoices = computed(() => {
  const cur = normalizeLayerSplitMaxLayers(state.value.maxLayers)
  const list: number[] = [...LAYER_SPLIT_MAX_LAYERS_OPTIONS]
  if (cur >= 2 && !list.includes(cur)) {
    list.push(cur)
    list.sort((a, b) => a - b)
  }
  return list
})

function formatMaxLayersLabel(n: number): string {
  if (!n || n < 2) return t('graph.layerSplit.maxLayersAuto')
  if (isOpenRouterSplitModel.value && n > 16) {
    return t('graph.layerSplit.maxLayersOpenRouterCap', { n })
  }
  return t('graph.layerSplit.maxLayersCount', { n })
}

const presetLabelKeyMap: Record<UiLayerSplitPresetId, string> = {
  'auto-all': 'graph.layerSplit.presetAutoAll',
  'ui-standard': 'graph.layerSplit.presetStandard',
  'ui-hud': 'graph.layerSplit.presetHud',
  'ui-popup': 'graph.layerSplit.presetPopup',
  'ui-inventory': 'graph.layerSplit.presetInventory',
  'ui-card': 'graph.layerSplit.presetCard'
}

const presetItems = computed(() =>
  UI_LAYER_SPLIT_PRESETS.map((p) => ({
    id: p.id,
    label: t(presetLabelKeyMap[p.id]),
    prompt: isZhLocale.value ? p.promptZh : p.promptEn
  }))
)

const activePresetId = computed<UiLayerSplitPresetId | ''>(() => {
  const trimmed = state.value.prompt.trim()
  if (!trimmed) return ''
  const hit = UI_LAYER_SPLIT_PRESETS.find(
    (p) => p.promptZh.trim() === trimmed || p.promptEn.trim() === trimmed
  )
  return hit?.id ?? ''
})

function applyPreset(id: UiLayerSplitPresetId): void {
  const preset = UI_LAYER_SPLIT_PRESETS.find((p) => p.id === id)
  if (!preset) return
  const target = isZhLocale.value ? preset.promptZh : preset.promptEn
  const nextPrompt = activePresetId.value === id ? '' : target
  persist({
    ...state.value,
    prompt: nextPrompt
  })
}

function autoGroupUiLayers(): void {
  persist(autoGroupLayersForGameUi(state.value, isZhLocale.value ? 'zh-CN' : 'en-US'))
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

async function resolveInspectorLayerUrls(): Promise<Record<string, string>> {
  const urls: Record<string, string> = {}
  const items = node.value?.params.generatedImages ?? []
  for (const item of items) {
    const id = item.id?.trim()
    if (!id) continue
    if (item.dataUrl?.trim()) {
      urls[id] = item.dataUrl.trim()
      continue
    }
    const rel = item.relativePath?.trim()
    if (rel) {
      const fileUrl = await window.studio.getAssetFileUrl(rel).catch(() => '')
      if (fileUrl) urls[id] = fileUrl
    }
  }
  return urls
}

async function exportPsd(): Promise<void> {
  if (exporting.value || !state.value.layers.length) return
  exporting.value = true
  try {
    const layerUrls = await resolveInspectorLayerUrls()
    const data = await layerSplitToPsdUint8Array({
      state: state.value,
      layerUrls
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
  if (exporting.value || !state.value.layers.length) return
  exporting.value = true
  try {
    const manifest = buildLayerSplitUiManifest(state.value)
    const data = new TextEncoder().encode(JSON.stringify(manifest, null, 2))
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

function persist(next: ImageLayerSplitState): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return
  graphEditorHosts.updateNode(hid, current.id, imageLayerSplitToNodePatch(next))
}

function onResolutionChange(event: Event): void {
  const resolution = normalizeLayerSplitResolution((event.target as HTMLSelectElement).value)
  persist({
    ...state.value,
    resolution
  })
}

function onMaxLayersChange(event: Event): void {
  const maxLayers = normalizeLayerSplitMaxLayers((event.target as HTMLSelectElement).value)
  persist({
    ...state.value,
    maxLayers
  })
}

function onPromptInput(event: Event): void {
  const prompt = (event.target as HTMLTextAreaElement).value
  persist({
    ...state.value,
    prompt
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

function onRepairModelChange(payload: {
  generateModel: string
  generateProviderInstanceId: string
}): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return
  if (
    (current.params.repairModel ?? '') === payload.generateModel &&
    (current.params.repairProviderInstanceId ?? '') === payload.generateProviderInstanceId
  ) {
    return
  }
  graphEditorHosts.updateNode(hid, current.id, {
    repairModel: payload.generateModel,
    repairProviderInstanceId: payload.generateProviderInstanceId
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

.field-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr);
  gap: 8px;
}

.field-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.field-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.field-label {
  font-size: 12px;
  color: var(--text-muted);
}

.field-sub {
  font-size: 11px;
  color: var(--text-muted);
  opacity: 0.8;
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

.preset-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.preset-chip {
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg-hover);
  color: var(--text-muted);
  padding: 3px 8px;
  font-size: 11px;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    color 0.15s ease,
    background 0.15s ease;
}

.preset-chip:hover {
  border-color: var(--accent, #4a90e2);
  color: var(--text);
}

.preset-chip.active {
  border-color: #4a90e2;
  background: rgba(74, 144, 226, 0.16);
  color: #7ab8ff;
}

.textarea {
  width: 100%;
  box-sizing: border-box;
  min-height: 62px;
  max-height: 160px;
  resize: vertical;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text);
  padding: 7px 9px;
  font-size: 12px;
  line-height: 1.45;
  font-family: inherit;
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

.clear-btn.primary-btn {
  border-color: #4a90e2;
  background: rgba(74, 144, 226, 0.14);
  color: #4a90e2;
  font-weight: 600;
}

.export-msg {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.export-msg.error {
  color: #ff6b6b;
}
</style>
