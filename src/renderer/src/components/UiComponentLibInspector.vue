<template>
  <div v-if="node" class="node-inspector">
    <div class="head">
      <h2>{{ displayTitle }}</h2>
    </div>
    <p class="hint">
      {{ t('graph.uiComponentLib.hint') }}
    </p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <button v-if="canOpenWorkbench" type="button" class="open-wb-btn" @click="openWorkbench">
      🧩 {{ t('graph.uiComponentLib.openWorkbench') }}
    </button>

    <GraphNodeOutputPreview v-if="node && hostId" :node="node" :host-id="hostId" />

    <label class="field-block">
      <span class="field-label">{{ t('graph.uiComponentLib.extractMode') }}</span>
      <select class="select" :value="extractMode" @change="onExtractModeChange">
        <option value="auto">{{ t('graph.uiComponentLib.extractModeAuto') }}</option>
        <option value="repeated">{{ t('graph.uiComponentLib.extractModeRepeated') }}</option>
        <option value="all-controls">{{ t('graph.uiComponentLib.extractModeAllControls') }}</option>
      </select>
    </label>

    <label class="field-block" :title="t('graph.layerSplit.visionModelHint')">
      <span class="field-label">{{ t('graph.layerSplit.visionModelLabel') }}</span>
      <select class="select" :value="visionSelectionKey" @change="onVisionModelChange">
        <option value="">{{ t('graph.layerSplit.visionModelAuto') }}</option>
        <option v-for="opt in visionModelOptions" :key="opt.key" :value="opt.key">
          {{ opt.label }}
        </option>
      </select>
    </label>

    <ImageGenerateModelField
      :open="Boolean(node)"
      :generate-model="node.params.generateModel ?? ''"
      :generate-provider-instance-id="node.params.generateProviderInstanceId ?? ''"
      @change="onModelChange"
    />

    <label class="field-block">
      <span class="field-label">{{ t('graph.uiComponentLib.extractHintLabel') }}</span>
      <textarea
        class="prompt"
        :value="node.params.generateInstruction ?? ''"
        rows="3"
        :placeholder="t('graph.uiComponentLib.extractHintPlaceholder')"
        @change="onInstructionChange"
      />
    </label>

    <div class="comp-section">
      <div class="comp-section-head">
        <span class="field-label">{{ t('graph.uiComponentLib.componentsTitle') }}</span>
        <span class="comp-count-pill">
          {{ t('graph.uiComponentLib.componentCount', { n: items.length }) }}
        </span>
      </div>

      <p v-if="!items.length" class="empty-hint">
        {{ t('graph.uiComponentLib.emptyComponents') }}
      </p>

      <div v-else class="comp-list">
        <div
          v-for="item in items"
          :key="item.id"
          class="comp-card"
          :class="{ locked: item.locked }"
          :title="t('graph.uiComponentLib.psdSmartObjectTip', { guid: item.psdGuid })"
        >
          <div class="comp-thumb-wrap">
            <img
              v-if="thumbUrls[item.id]"
              :src="thumbUrls[item.id]"
              :alt="item.name"
              class="comp-thumb"
            />
            <span v-else class="comp-thumb-placeholder">🧩</span>
          </div>
          <div class="comp-meta">
            <div class="comp-row-top">
              <input
                type="text"
                class="comp-input"
                :value="item.name"
                @change="onItemNameChange(item.id, $event)"
              />
              <button
                type="button"
                class="icon-btn"
                :class="{ active: item.locked }"
                :title="
                  item.locked
                    ? t('graph.uiComponentLib.unlockItem')
                    : t('graph.uiComponentLib.lockItem')
                "
                @click="toggleLock(item.id)"
              >
                {{ item.locked ? '🔒' : '🔓' }}
              </button>
              <button
                type="button"
                class="icon-btn danger"
                :title="t('graph.uiComponentLib.removeItem')"
                @click="removeItem(item.id)"
              >
                ×
              </button>
            </div>
            <input
              type="text"
              class="comp-input mono"
              :value="item.exportName"
              :placeholder="t('graph.uiComponentLib.exportNamePlaceholder')"
              @change="onItemExportNameChange(item.id, $event)"
            />
            <div class="comp-tags">
              <span class="tag">{{ item.kind }}</span>
              <span class="tag">{{ item.canonicalWidth }}×{{ item.canonicalHeight }}</span>
              <span v-if="(item.sourceCount ?? 1) > 1" class="tag accent">
                {{ t('graph.uiComponentLib.sourceInstances', { n: item.sourceCount }) }}
              </span>
              <select
                class="mini-select"
                :value="item.scalePolicy"
                @change="onItemScalePolicyChange(item.id, $event)"
              >
                <option value="exact">{{ t('graph.uiComponentLib.scaleExact') }}</option>
                <option value="uniform">{{ t('graph.uiComponentLib.scaleUniform') }}</option>
                <option value="nine-slice">{{ t('graph.uiComponentLib.scaleNineSlice') }}</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="items.length || node.params.uiComponentLibSourceHash" class="inspector-actions">
      <button type="button" class="clear-btn" @click="forceReextract">
        {{ t('graph.uiComponentLib.reextract') }}
      </button>
    </div>
  </div>
  <div v-else class="node-inspector empty">
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  emptyUiComponentLibrary,
  parseUiComponentLibrary,
  sanitizeComponentExportName,
  stringifyUiComponentLibrary,
  type UiComponentLibrary,
  type UiComponentScalePolicy,
  type UiSharedComponentItem
} from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import ImageGenerateModelField from './ImageGenerateModelField.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import {
  loadVisionModelOptions,
  preferredModelKey,
  type GenerateModelOption
} from '../features/graph/model/generateModelOptions'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { useWorkspaceStore } from '../stores/workspace'

const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()
const workspace = useWorkspaceStore()
const visionModelOptions = ref<GenerateModelOption[]>([])
const visionSelectionKey = ref('')
const thumbUrls = reactive<Record<string, string>>({})

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'ui.componentLib' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? (selection.hostId ?? '') : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)
const typeLabel = computed(() => graphTypeLabel('ui.componentLib'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const canOpenWorkbench = computed(() =>
  Boolean(node.value && hostId.value && workspace.activeDiveRootKey?.trim())
)

function openWorkbench(): void {
  const current = node.value
  const hid = hostId.value
  const rootKey = workspace.activeDiveRootKey?.trim()
  if (!current || !hid || !rootKey) return
  workspace.diveIntoView(
    rootKey,
    {
      viewId: 'ui.componentLib',
      hostId: hid,
      nodeId: current.id
    },
    current.title?.trim() || displayTitle.value
  )
}

const extractMode = computed(() => {
  const raw = node.value?.params.uiComponentExtractMode
  return raw === 'repeated' || raw === 'all-controls' ? raw : 'auto'
})

const library = computed<UiComponentLibrary>(
  () =>
    parseUiComponentLibrary(node.value?.params.uiComponentLibrary ?? '') ??
    emptyUiComponentLibrary()
)
const items = computed<UiSharedComponentItem[]>(() => library.value.items)

async function refreshThumbUrls(): Promise<void> {
  const current = node.value
  if (!current) return
  const genById = new Map<string, { dataUrl?: string; relativePath?: string }>()
  for (const g of current.params.generatedImages ?? []) {
    if (g.id?.trim()) genById.set(g.id.trim(), g)
  }
  for (const item of items.value) {
    if (item.imageUrl?.startsWith('data:')) {
      thumbUrls[item.id] = item.imageUrl
      continue
    }
    const gen = item.imageId ? genById.get(item.imageId) : undefined
    if (gen?.dataUrl?.startsWith('data:')) {
      thumbUrls[item.id] = gen.dataUrl
      continue
    }
    const rel = item.imageRelativePath?.trim() || gen?.relativePath?.trim() || ''
    if (rel) {
      const url = await window.studio.getAssetFileUrl(rel).catch(() => '')
      if (url) thumbUrls[item.id] = url
    }
  }
}

watch(
  () => [
    node.value?.id ?? '',
    node.value?.params.uiComponentLibrary ?? '',
    node.value?.params.generatedImages?.length ?? 0
  ],
  () => {
    void refreshThumbUrls()
  },
  { immediate: true }
)

async function refreshVisionModels(): Promise<void> {
  const current = node.value
  if (!current) {
    visionModelOptions.value = []
    visionSelectionKey.value = ''
    return
  }
  const preferred = preferredModelKey(
    current.params.visionProviderInstanceId,
    current.params.visionModel
  )
  const { options, selectedKey } = await loadVisionModelOptions(preferred)
  visionModelOptions.value = options
  visionSelectionKey.value = selectedKey
}

watch(
  () => [
    node.value?.id ?? '',
    node.value?.params.visionProviderInstanceId ?? '',
    node.value?.params.visionModel ?? ''
  ],
  () => {
    void refreshVisionModels()
  },
  { immediate: true }
)

function persistLibrary(
  nextItems: UiSharedComponentItem[],
  extraPatch?: Record<string, unknown>
): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return
  const nextDoc: UiComponentLibrary = {
    ...library.value,
    items: nextItems,
    updatedAt: new Date().toISOString()
  }
  graphEditorHosts.updateNode(hid, current.id, {
    uiComponentLibrary: stringifyUiComponentLibrary(nextDoc),
    ...(extraPatch ?? {})
  })
}

function onExtractModeChange(event: Event): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return
  const val = (event.target as HTMLSelectElement).value
  const mode = val === 'repeated' || val === 'all-controls' ? val : 'auto'
  graphEditorHosts.updateNode(hid, current.id, {
    uiComponentExtractMode: mode,
    uiComponentLibSourceHash: ''
  })
}

function onVisionModelChange(event: Event): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return
  const key = (event.target as HTMLSelectElement).value
  visionSelectionKey.value = key
  if (!key) {
    graphEditorHosts.updateNode(hid, current.id, {
      visionModel: '',
      visionProviderInstanceId: '',
      uiComponentLibSourceHash: ''
    })
    return
  }
  const opt = visionModelOptions.value.find((o) => o.key === key)
  if (!opt) return
  graphEditorHosts.updateNode(hid, current.id, {
    visionModel: opt.model,
    visionProviderInstanceId: opt.providerInstanceId,
    uiComponentLibSourceHash: ''
  })
}

function onModelChange(payload: {
  generateModel: string
  generateProviderInstanceId: string
}): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return
  const prevModel = current.params.generateModel ?? ''
  const prevProvider = current.params.generateProviderInstanceId ?? ''
  if (prevModel === payload.generateModel && prevProvider === payload.generateProviderInstanceId) {
    return
  }
  graphEditorHosts.updateNode(hid, current.id, {
    generateModel: payload.generateModel,
    generateProviderInstanceId: payload.generateProviderInstanceId,
    uiComponentLibSourceHash: ''
  })
}

function onInstructionChange(event: Event): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return
  graphEditorHosts.updateNode(hid, current.id, {
    generateInstruction: (event.target as HTMLTextAreaElement).value,
    uiComponentLibSourceHash: ''
  })
}

function onItemNameChange(itemId: string, event: Event): void {
  const nextName = (event.target as HTMLInputElement).value.trim()
  if (!nextName) return
  persistLibrary(
    items.value.map((item) => (item.id === itemId ? { ...item, name: nextName } : item))
  )
}

function onItemExportNameChange(itemId: string, event: Event): void {
  const raw = (event.target as HTMLInputElement).value.trim()
  const idx = items.value.findIndex((i) => i.id === itemId)
  const sanitized = sanitizeComponentExportName(raw, idx + 1)
  persistLibrary(
    items.value.map((item) => (item.id === itemId ? { ...item, exportName: sanitized } : item))
  )
}

function onItemScalePolicyChange(itemId: string, event: Event): void {
  const val = (event.target as HTMLSelectElement).value
  const policy: UiComponentScalePolicy = val === 'exact' || val === 'nine-slice' ? val : 'uniform'
  persistLibrary(
    items.value.map((item) => (item.id === itemId ? { ...item, scalePolicy: policy } : item))
  )
}

function toggleLock(itemId: string): void {
  persistLibrary(
    items.value.map((item) => (item.id === itemId ? { ...item, locked: !item.locked } : item))
  )
}

function removeItem(itemId: string): void {
  delete thumbUrls[itemId]
  persistLibrary(items.value.filter((item) => item.id !== itemId))
}

function forceReextract(): void {
  const lockedOnly = items.value.filter((item) => item.locked)
  persistLibrary(lockedOnly, { uiComponentLibSourceHash: '' })
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

.comp-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.comp-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.comp-count-pill {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  color: var(--text-muted);
}

.empty-hint {
  margin: 0;
  padding: 12px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

.comp-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.comp-card {
  display: flex;
  gap: 10px;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
}

.comp-card.locked {
  border-color: rgba(74, 144, 226, 0.55);
}

.comp-thumb-wrap {
  flex: 0 0 56px;
  width: 56px;
  height: 56px;
  border-radius: 6px;
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background-image:
    linear-gradient(45deg, rgba(128, 128, 128, 0.16) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(128, 128, 128, 0.16) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(128, 128, 128, 0.16) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(128, 128, 128, 0.16) 75%);
  background-size: 12px 12px;
  background-position:
    0 0,
    0 6px,
    6px -6px,
    -6px 0;
}

.comp-thumb {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.comp-thumb-placeholder {
  font-size: 18px;
  opacity: 0.65;
}

.comp-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.comp-row-top {
  display: flex;
  align-items: center;
  gap: 4px;
}

.comp-input {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  padding: 4px 6px;
  font-size: 11px;
}

.comp-input.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10.5px;
  color: var(--text-muted);
}

.icon-btn {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text-muted);
  padding: 3px 6px;
  font-size: 11px;
  cursor: pointer;
}

.icon-btn.active {
  border-color: #4a90e2;
  color: #4a90e2;
}

.icon-btn.danger:hover {
  border-color: #ff6b6b;
  color: #ff6b6b;
}

.comp-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-muted);
}

.tag.accent {
  border-color: rgba(74, 144, 226, 0.45);
  color: #4a90e2;
}

.mini-select {
  margin-left: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  padding: 2px 5px;
  font-size: 10.5px;
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

.open-wb-btn {
  width: 100%;
  border: 1px solid rgba(129, 140, 248, 0.45);
  border-radius: 8px;
  background: rgba(99, 102, 241, 0.14);
  color: var(--text);
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.open-wb-btn:hover {
  border-color: var(--accent, #818cf8);
  background: rgba(99, 102, 241, 0.22);
}
</style>
