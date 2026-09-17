<template>
  <div v-if="node" class="node-inspector">
    <div class="head">
      <span class="type">{{ typeLabel }}</span>
      <h2>{{ displayTitle }}</h2>
    </div>
    <p class="hint">
      {{ t('graph.inspector.modelPose.hint') }}
    </p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <GraphNodeOutputPreview v-if="node && hostId" :node="node" :host-id="hostId" />

    <label>
      {{ t('graph.inspector.generate.model') }}
      <select v-model="modelKey" :disabled="isGraphRunning" @change="persistModel">
        <option value="" disabled>
          {{
            modelOptions.length
              ? t('graph.inspector.modelPose.modelPick')
              : t('graph.inspector.modelPose.modelEmpty')
          }}
        </option>
        <option v-for="opt in modelOptions" :key="opt.key" :value="opt.key">
          {{ opt.label }}
        </option>
      </select>
    </label>

    <div class="section-label">
      {{ t('graph.inspector.modelPose.presets') }}
    </div>
    <div class="presets" role="list">
      <button
        v-for="preset in presets"
        :key="preset.id"
        type="button"
        class="preset-chip"
        :class="{ active: activePresetId === preset.id }"
        :disabled="isGraphRunning"
        :title="resolveAiPosePresetInstruction(preset, locale)"
        role="listitem"
        @click="onPickPreset(preset)"
      >
        {{ t(preset.labelKey) }}
      </button>
    </div>

    <label>
      {{ t('graph.inspector.modelPose.instruction') }}
      <textarea
        v-model="instruction"
        rows="4"
        :disabled="isGraphRunning"
        :placeholder="t('graph.inspector.modelPose.instructionPlaceholder')"
        @input="onInstructionInput"
        @change="persistInstruction"
      />
    </label>
  </div>
  <div v-else class="node-inspector empty">
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import {
  loadGenerateModelOptions,
  parseModelKey,
  type GenerateModelOption
} from '../features/graph/model/generateModelOptions'
import {
  AI_POSE_INSTRUCTION_PRESETS,
  matchAiPosePresetId,
  resolveAiPosePresetInstruction,
  type AiPoseInstructionPreset
} from '../features/director/aiPosePresets'

const { t, locale, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'model.pose' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? (selection.hostId ?? '') : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

const typeLabel = computed(() => graphTypeLabel('model.pose'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)
const presets = AI_POSE_INSTRUCTION_PRESETS
const instruction = ref('')
const modelKey = ref('')
const modelOptions = ref<GenerateModelOption[]>([])
const activePresetId = ref<string | null>(null)
const loadedNodeId = ref<string | null>(null)

function persist(patch: Record<string, unknown>): void {
  if (!node.value) return
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(selection.hostId, node.value.id, patch)
}

async function refreshModels(preferred?: string): Promise<void> {
  const { options, selectedKey } = await loadGenerateModelOptions(
    'text',
    preferred,
    modelKey.value || undefined
  )
  modelOptions.value = options
  modelKey.value = selectedKey
}

function loadFromNode(): void {
  const current = node.value
  if (!current) {
    instruction.value = ''
    modelKey.value = ''
    activePresetId.value = null
    loadedNodeId.value = null
    return
  }
  loadedNodeId.value = current.id
  instruction.value = current.params.generateInstruction?.trim() ?? ''
  const parsed =
    current.params.generateProviderInstanceId && current.params.generateModel
      ? `${current.params.generateProviderInstanceId}::${current.params.generateModel}`
      : ''
  modelKey.value = parsed
  activePresetId.value =
    current.params.posePresetId?.trim() || matchAiPosePresetId(instruction.value, locale.value)
  void refreshModels(parsed)
}

watch(node, (current) => {
  if (!current) {
    loadFromNode()
    return
  }
  if (current.id !== loadedNodeId.value) loadFromNode()
}, { immediate: true })

function persistModel(): void {
  const parsed = parseModelKey(modelKey.value)
  persist({
    generateModel: parsed?.model ?? '',
    generateProviderInstanceId: parsed?.providerInstanceId ?? ''
  })
}

function persistInstruction(): void {
  persist({ generateInstruction: instruction.value })
}

function onInstructionInput(): void {
  activePresetId.value = matchAiPosePresetId(instruction.value, locale.value)
}

function onPickPreset(preset: AiPoseInstructionPreset): void {
  if (isGraphRunning.value) return
  instruction.value = resolveAiPosePresetInstruction(preset, locale.value)
  activePresetId.value = preset.id
  persist({
    generateInstruction: instruction.value,
    posePresetId: preset.id
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

.section-label {
  font-size: 11px;
  color: var(--text-muted);
}

.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.preset-chip {
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}

.preset-chip:hover:not(:disabled) {
  border-color: var(--accent, #6ea8ff);
}

.preset-chip.active {
  border-color: var(--accent, #6ea8ff);
  background: color-mix(in srgb, var(--accent, #6ea8ff) 18%, transparent);
}

.preset-chip:disabled {
  opacity: 0.55;
  cursor: default;
}

label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

label select,
label textarea {
  width: 100%;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  border-radius: 8px;
  padding: 8px 10px;
  font: inherit;
}
</style>
