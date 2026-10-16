<template>
  <div v-if="node" class="node-inspector">
    <div class="head">
      <h2>{{ displayTitle }}</h2>
    </div>
    <p class="hint">
      {{ t('graph.uiGen.hint') }}
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
      :generate-model="node.params.generateModel ?? ''"
      :generate-provider-instance-id="node.params.generateProviderInstanceId ?? ''"
      @change="onModelChange"
    />

    <label class="field-block">
      <span class="field-label">{{ t('graph.uiGen.trackMode') }}</span>
      <select class="select" :value="trackMode" @change="onTrackModeChange">
        <option v-for="mode in trackModeOptions" :key="mode.id" :value="mode.id">
          {{ mode.label }}
        </option>
      </select>
      <span class="mode-hint">{{ activeTrackModeHint }}</span>
    </label>

    <div class="preset-block">
      <span class="preset-label">{{ t('graph.uiGen.stylePreset') }}</span>
      <div class="preset-chips">
        <button
          v-for="preset in stylePresetOptions"
          :key="preset.id"
          type="button"
          class="preset-chip"
          :class="{ active: stylePreset === preset.id }"
          @click="onStylePresetChange(preset.id)"
        >
          {{ preset.label }}
        </button>
      </div>
    </div>

    <div class="inline-row">
      <label class="field-block flex-1">
        <span class="field-label">{{ t('graph.uiGen.defaultAspectRatio') }}</span>
        <select class="select" :value="defaultAspectRatio" @change="onDefaultAspectChange">
          <option v-for="ratio in aspectOptions" :key="ratio" :value="ratio">{{ ratio }}</option>
        </select>
      </label>
    </div>

    <label class="check-row">
      <input
        type="checkbox"
        :checked="node.params.styleImagesUseGlobal !== false"
        @change="onGlobalStyleToggle"
      />
      <span>{{ t('graph.uiGen.useGlobalStyle') }}</span>
    </label>

    <div class="screens-section">
      <div class="screens-head">
        <span class="field-label">
          {{
            t('graph.uiGen.screensTitle', {
              active: activeScreenCount,
              total: screens.length
            })
          }}
        </span>
        <div class="screens-actions">
          <button
            v-if="hasIncomingEdges"
            type="button"
            class="mini-btn"
            @click="syncScreensFromUpstream"
          >
            {{ t('graph.uiGen.syncFromUpstream') }}
          </button>
          <button type="button" class="mini-btn" @click="addScreen">
            {{ t('graph.uiGen.addScreen') }}
          </button>
        </div>
      </div>

      <div v-if="!screens.length" class="empty-screens">
        {{ t('graph.uiGen.emptyScreens') }}
      </div>

      <div v-else class="screen-list">
        <div
          v-for="(screen, idx) in screens"
          :key="screen.id || idx"
          class="screen-card"
          :class="{ disabled: screen.enabled === false }"
        >
          <div class="screen-card-top">
            <input
              type="checkbox"
              class="screen-check"
              :checked="screen.enabled !== false"
              @change="onToggleScreenEnabled(idx, $event)"
            />
            <input
              type="text"
              class="screen-title-input"
              :value="screen.title"
              :placeholder="t('graph.uiGen.screenTitlePlaceholder')"
              @change="onScreenFieldChange(idx, 'title', ($event.target as HTMLInputElement).value)"
            />
            <select
              class="mini-select"
              :value="screen.screenKind || 'fullscreen'"
              @change="
                onScreenFieldChange(idx, 'screenKind', ($event.target as HTMLSelectElement).value)
              "
            >
              <option v-for="k in screenKindOptions" :key="k.id" :value="k.id">
                {{ k.label }}
              </option>
            </select>
            <select
              class="mini-select ratio-select"
              :value="screen.aspectRatio || defaultAspectRatio"
              @change="
                onScreenFieldChange(idx, 'aspectRatio', ($event.target as HTMLSelectElement).value)
              "
            >
              <option v-for="ratio in aspectOptions" :key="ratio" :value="ratio">
                {{ ratio }}
              </option>
            </select>
            <button
              type="button"
              class="icon-btn"
              :aria-expanded="expandedId === screen.id"
              @click="toggleExpand(screen.id)"
            >
              {{ expandedId === screen.id ? '▴' : '▾' }}
            </button>
            <button
              type="button"
              class="icon-btn danger"
              :title="t('graph.uiGen.removeScreen')"
              @click="removeScreen(idx)"
            >
              ×
            </button>
          </div>

          <div v-if="expandedId === screen.id" class="screen-card-body">
            <label class="field-block">
              <span class="sub-label">{{ t('graph.uiGen.screenPromptLabel') }}</span>
              <textarea
                class="prompt"
                rows="3"
                :value="screen.prompt"
                :placeholder="t('graph.uiGen.screenPromptPlaceholder')"
                @change="
                  onScreenFieldChange(idx, 'prompt', ($event.target as HTMLTextAreaElement).value)
                "
              />
            </label>
            <label class="field-block">
              <span class="sub-label">{{ t('graph.uiGen.screenCleanPromptLabel') }}</span>
              <textarea
                class="prompt"
                rows="2"
                :value="screen.cleanPrompt ?? ''"
                :placeholder="t('graph.uiGen.screenCleanPromptPlaceholder')"
                @change="
                  onScreenFieldChange(
                    idx,
                    'cleanPrompt',
                    ($event.target as HTMLTextAreaElement).value
                  )
                "
              />
            </label>
            <label class="field-block">
              <span class="sub-label">{{ t('graph.uiGen.screenLayerPromptLabel') }}</span>
              <textarea
                class="prompt"
                rows="2"
                :value="screen.layerPrompt ?? ''"
                :placeholder="t('graph.uiGen.screenLayerPromptPlaceholder')"
                @change="
                  onScreenFieldChange(
                    idx,
                    'layerPrompt',
                    ($event.target as HTMLTextAreaElement).value
                  )
                "
              />
            </label>
          </div>
        </div>
      </div>
    </div>

    <div v-if="screens.length" class="inspector-actions">
      <button type="button" class="dive-btn" @click="openDiveSubgraph">
        {{ t('graph.uiGen.openDiveSubgraph') }}
      </button>
    </div>
  </div>
  <div v-else class="node-inspector empty">
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  buildDefaultUiLayerSplitPrompt,
  normalizeUiGenStylePreset,
  normalizeUiGenTrackMode,
  normalizeUiScreenAspectRatio,
  normalizeUiScreenKind,
  screensFromUiGenIncoming,
  softResolveSourceOutput,
  type ResolveHostInputSlotsOptions,
  type UiGenStylePresetId,
  type UiGenTrackMode,
  type UiScreenAspectRatio,
  type UiScreenKind,
  type UiScreenPromptItem
} from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import ImageGenerateModelField from './ImageGenerateModelField.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { useProjectStore } from '../stores/project'
import { useWorkspaceStore } from '../stores/workspace'

const { t, locale, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()
const project = useProjectStore()
const workspace = useWorkspaceStore()

const aspectOptions: readonly UiScreenAspectRatio[] = ['9:16', '16:9', '1:1', '4:3', '3:4']
const expandedId = ref('')

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'ui.gen' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? (selection.hostId ?? '') : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)
const typeLabel = computed(() => graphTypeLabel('ui.gen'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const trackMode = computed<UiGenTrackMode>(() =>
  normalizeUiGenTrackMode(node.value?.params.uiGenTrackMode)
)

const stylePreset = computed<UiGenStylePresetId>(() =>
  normalizeUiGenStylePreset(node.value?.params.uiGenStylePreset)
)

const defaultAspectRatio = computed<UiScreenAspectRatio>(
  () => normalizeUiScreenAspectRatio(node.value?.params.generateAspectRatio) ?? '9:16'
)

const trackModeOptions = computed<Array<{ id: UiGenTrackMode; label: string }>>(() => [
  { id: 'dual', label: t('graph.uiGen.trackModeDual') },
  { id: 'clean-only', label: t('graph.uiGen.trackModeCleanOnly') },
  { id: 'preview-only', label: t('graph.uiGen.trackModePreviewOnly') }
])

const activeTrackModeHint = computed(() => {
  if (trackMode.value === 'clean-only') return t('graph.uiGen.trackModeHintCleanOnly')
  if (trackMode.value === 'preview-only') return t('graph.uiGen.trackModeHintPreviewOnly')
  return t('graph.uiGen.trackModeHintDual')
})

const stylePresetOptions = computed<Array<{ id: UiGenStylePresetId; label: string }>>(() => [
  { id: 'auto', label: t('graph.uiGen.presetAuto') },
  { id: 'anime-flat', label: t('graph.uiGen.presetAnimeFlat') },
  { id: 'dark-fantasy', label: t('graph.uiGen.presetDarkFantasy') },
  { id: 'eastern-xianxia', label: t('graph.uiGen.presetEasternXianxia') },
  { id: 'casual-cartoon', label: t('graph.uiGen.presetCasualCartoon') },
  { id: 'scifi-hud', label: t('graph.uiGen.presetScifiHud') }
])

const screenKindOptions = computed<Array<{ id: UiScreenKind; label: string }>>(() => [
  { id: 'fullscreen', label: t('graph.uiGen.kindFullscreen') },
  { id: 'hud', label: t('graph.uiGen.kindHud') },
  { id: 'popup', label: t('graph.uiGen.kindPopup') },
  { id: 'panel', label: t('graph.uiGen.kindPanel') },
  { id: 'component', label: t('graph.uiGen.kindComponent') }
])

const hasIncomingEdges = computed(() => {
  void graphEditorHosts.revision.value
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return false
  return graphEditorHosts.listIncomingEdges(hid, current.id, 'in').length > 0
})

function resolveIncomingScreens(hid: string, nodeId: string): UiScreenPromptItem[] {
  const doc = graphEditorHosts.getDocument(hid)
  if (!doc) return []
  const incoming = graphEditorHosts.listIncomingEdges(hid, nodeId, 'in')
  if (!incoming.length) return []
  const options: ResolveHostInputSlotsOptions = {
    resolveLiveAssetGraph: (id) => graphEditorHosts.getLiveAssetDocument(id) ?? undefined,
    resolveAssetGenParams: (id) => project.assets.find((a) => a.id === id)?.genParams
  }
  const values = incoming.map((edge) =>
    softResolveSourceOutput(doc, edge.sourceNodeId, edge.sourcePort ?? 'out', options)
  )
  return screensFromUiGenIncoming(values)
}

const screens = computed<UiScreenPromptItem[]>(() => {
  const stored = node.value?.params.uiScreens
  if (Array.isArray(stored) && stored.length > 0) {
    return stored
  }
  if (node.value && hostId.value) {
    return resolveIncomingScreens(hostId.value, node.value.id)
  }
  return []
})

const activeScreenCount = computed(
  () => screens.value.filter((item) => item.enabled !== false).length
)

// 当节点尚无已存 uiScreens 但上游已有拆分输出时，自动同步到节点参数以便用户直接勾选与微调
watch(
  () => [node.value?.id, hasIncomingEdges.value] as const,
  () => {
    const current = node.value
    const hid = hostId.value
    if (!current || !hid) return
    const stored = current.params.uiScreens
    if (!Array.isArray(stored) || stored.length === 0) {
      const incoming = resolveIncomingScreens(hid, current.id)
      if (incoming.length > 0) {
        persistScreens(incoming)
      }
    }
  },
  { immediate: true }
)

function persistScreens(nextScreens: UiScreenPromptItem[]): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return
  const summary = nextScreens.map((s, i) => `${i + 1}. ${s.title}`).join('\n')
  graphEditorHosts.updateNode(hid, current.id, {
    uiScreens: nextScreens,
    text: summary
  })
}

function syncScreensFromUpstream(): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return
  const incoming = resolveIncomingScreens(hid, current.id)
  if (!incoming.length) return
  const prev = Array.isArray(current.params.uiScreens) ? current.params.uiScreens : []
  const merged = incoming.map((item) => {
    const match = prev.find((p) => p.id === item.id || p.title === item.title)
    return match && match.enabled === false ? { ...item, enabled: false } : item
  })
  persistScreens(merged)
}

function addScreen(): void {
  const nextIdx = screens.value.length + 1
  const newId = `ui-manual-${Date.now()}-${nextIdx}`
  const title = t('graph.uiGen.newScreenDefaultTitle', { n: nextIdx })
  const newItem: UiScreenPromptItem = {
    id: newId,
    title,
    prompt: '',
    screenKind: 'fullscreen',
    aspectRatio: defaultAspectRatio.value,
    layerPrompt: buildDefaultUiLayerSplitPrompt(
      { title, prompt: '', screenKind: 'fullscreen' },
      locale.value
    ),
    enabled: true
  }
  expandedId.value = newId
  persistScreens([...screens.value, newItem])
}

function removeScreen(index: number): void {
  const next = screens.value.filter((_, idx) => idx !== index)
  persistScreens(next)
}

function toggleExpand(id: string): void {
  expandedId.value = expandedId.value === id ? '' : id
}

function onToggleScreenEnabled(index: number, event: Event): void {
  const checked = (event.target as HTMLInputElement).checked
  const next = screens.value.map((item, idx) =>
    idx === index ? { ...item, enabled: checked } : item
  )
  persistScreens(next)
}

function onScreenFieldChange(
  index: number,
  field: 'title' | 'prompt' | 'cleanPrompt' | 'layerPrompt' | 'screenKind' | 'aspectRatio',
  rawValue: string
): void {
  const next = screens.value.map((item, idx) => {
    if (idx !== index) return item
    if (field === 'screenKind') {
      return { ...item, screenKind: normalizeUiScreenKind(rawValue) ?? 'fullscreen' }
    }
    if (field === 'aspectRatio') {
      return {
        ...item,
        aspectRatio: normalizeUiScreenAspectRatio(rawValue) ?? defaultAspectRatio.value
      }
    }
    return {
      ...item,
      [field]: rawValue
    }
  })
  persistScreens(next)
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

function onTrackModeChange(event: Event): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return
  const nextMode = normalizeUiGenTrackMode((event.target as HTMLSelectElement).value)
  graphEditorHosts.updateNode(hid, current.id, {
    uiGenTrackMode: nextMode
  })
}

function onStylePresetChange(presetId: UiGenStylePresetId): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return
  graphEditorHosts.updateNode(hid, current.id, {
    uiGenStylePreset: presetId
  })
}

function onDefaultAspectChange(event: Event): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return
  const ratio = normalizeUiScreenAspectRatio((event.target as HTMLSelectElement).value) ?? '9:16'
  graphEditorHosts.updateNode(hid, current.id, {
    generateAspectRatio: ratio
  })
}

function onGlobalStyleToggle(event: Event): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return
  graphEditorHosts.updateNode(hid, current.id, {
    styleImagesUseGlobal: (event.target as HTMLInputElement).checked
  })
}

function openDiveSubgraph(): void {
  const current = node.value
  const hid = hostId.value
  const rootKey = workspace.activeDiveRootKey
  if (!current || !hid || !rootKey) return
  workspace.diveIntoView(
    rootKey,
    {
      viewId: 'ui.split',
      hostId: hid,
      nodeId: current.id
    },
    current.title?.trim() || displayTitle.value
  )
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
  font-size: 11px;
  color: var(--text-muted);
}

.sub-label {
  font-size: 10px;
  color: var(--text-muted);
}

.mode-hint {
  font-size: 10px;
  color: var(--text-muted);
  line-height: 1.35;
}

.select,
.prompt {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
  font-family: inherit;
}

.prompt {
  resize: vertical;
  line-height: 1.4;
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
  padding: 4px 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    color 0.15s ease,
    background 0.15s ease;
}

.preset-chip:hover {
  border-color: var(--accent, #4ea1ff);
  color: var(--text);
}

.preset-chip.active {
  border-color: var(--accent, #4ea1ff);
  background: color-mix(in srgb, var(--accent, #4ea1ff) 16%, transparent);
  color: var(--text);
}

.inline-row {
  display: flex;
  gap: 8px;
}

.flex-1 {
  flex: 1;
}

.check-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text);
  cursor: pointer;
}

.screens-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid var(--border);
  padding-top: 10px;
}

.screens-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.screens-actions {
  display: flex;
  gap: 4px;
}

.mini-btn {
  padding: 3px 7px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.mini-btn:hover {
  border-color: var(--accent, #4ea1ff);
}

.empty-screens {
  padding: 10px;
  border-radius: 6px;
  border: 1px dashed var(--border);
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.4;
}

.screen-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.screen-card {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.screen-card.disabled {
  opacity: 0.55;
}

.screen-card-top {
  display: flex;
  align-items: center;
  gap: 4px;
}

.screen-check {
  margin: 0;
  cursor: pointer;
}

.screen-title-input {
  flex: 1;
  min-width: 0;
  padding: 3px 6px;
  border-radius: 4px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  font-weight: 500;
}

.screen-title-input:focus {
  border-color: var(--border);
  background: var(--bg);
}

.mini-select {
  padding: 2px 4px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text-muted);
  font-size: 10px;
}

.ratio-select {
  width: 48px;
}

.icon-btn {
  padding: 2px 5px;
  border-radius: 4px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}

.icon-btn:hover {
  color: var(--text);
  background: var(--bg);
}

.icon-btn.danger:hover {
  color: var(--danger, #ff5d5d);
}

.screen-card-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}

.inspector-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.dive-btn {
  padding: 7px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.dive-btn:hover {
  border-color: var(--accent, #4ea1ff);
}
</style>
