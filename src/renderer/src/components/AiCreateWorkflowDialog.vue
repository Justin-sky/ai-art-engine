<template>
  <StudioFloatingWindow
    :open="open"
    :title="t('aiWorkflow.title')"
    :subtitle="t('aiWorkflow.subtitle')"
    :close-title="t('common.close')"
    :z-index="2650"
    :default-width="640"
    :default-height="640"
    :min-width="480"
    :min-height="480"
    @close="onClose"
  >
    <div class="body">
      <div class="row">
        <span class="label">{{ t('aiWorkflow.presetsLabel') }}</span>
        <div
          class="presets"
          role="list"
        >
          <button
            v-for="id in presetIds"
            :key="id"
            type="button"
            class="preset"
            role="listitem"
            :class="{ active: selectedPresetId === id }"
            :disabled="busy"
            :title="t(`aiWorkflow.presets.${id}.desc`)"
            @click="emit('select-preset', id)"
          >
            {{ t(`aiWorkflow.presets.${id}.title`) }}
          </button>
        </div>
      </div>

      <div class="models">
        <div class="model-row">
          <span class="label">{{ t('aiWorkflow.textModelLabel') }}</span>
          <InstructionModelSelect
            class="model-select"
            :model-value="textModelKey"
            :options="textModelOptions"
            :title="t('aiWorkflow.textModelLabel')"
            :empty-label="t('aiWorkflow.modelEmpty')"
            @update:model-value="emit('update:textModelKey', $event)"
          />
        </div>
        <div class="model-row">
          <span class="label">{{ t('aiWorkflow.imageModelLabel') }}</span>
          <InstructionModelSelect
            class="model-select"
            :model-value="imageModelKey"
            :options="imageModelOptions"
            :title="t('aiWorkflow.imageModelLabel')"
            :empty-label="t('aiWorkflow.modelEmpty')"
            @update:model-value="emit('update:imageModelKey', $event)"
          />
        </div>
        <div class="model-row">
          <span class="label">{{ t('aiWorkflow.videoModelLabel') }}</span>
          <InstructionModelSelect
            class="model-select"
            :model-value="videoModelKey"
            :options="videoModelOptions"
            :title="t('aiWorkflow.videoModelLabel')"
            :empty-label="t('aiWorkflow.modelEmpty')"
            @update:model-value="emit('update:videoModelKey', $event)"
          />
        </div>
        <div class="model-row">
          <span class="label">{{ t('aiWorkflow.aspectRatioLabel') }}</span>
          <select
            class="aspect-ratio-select"
            :value="aspectRatio"
            :disabled="busy"
            :title="t('aiWorkflow.aspectRatioLabel')"
            @change="emit('update:aspectRatio', ($event.target as HTMLSelectElement).value)"
          >
            <option value="">
              {{ t('aiWorkflow.aspectRatioEmpty') }}
            </option>
            <option value="1:1">
              1:1
            </option>
            <option value="16:9">
              16:9
            </option>
            <option value="9:16">
              9:16
            </option>
            <option value="4:3">
              4:3
            </option>
            <option value="3:4">
              3:4
            </option>
            <option value="3:2">
              3:2
            </option>
            <option value="2:3">
              2:3
            </option>
            <option value="21:9">
              21:9
            </option>
            <option value="9:21">
              9:21
            </option>
          </select>
        </div>
      </div>

      <label
        class="label"
        for="ai-workflow-prompt"
      >{{ t('aiWorkflow.promptLabel') }}</label>
      <textarea
        id="ai-workflow-prompt"
        v-model="promptModel"
        class="prompt"
        rows="5"
        spellcheck="false"
        :disabled="busy"
        :placeholder="t('aiWorkflow.promptPlaceholder')"
        @keydown.ctrl.enter.prevent="onPlanAi"
        @keydown.meta.enter.prevent="onPlanAi"
      />

      <div
        v-if="preview"
        class="preview"
      >
        <div class="preview-head">
          <span class="label">{{ t('aiWorkflow.previewLabel') }}</span>
          <strong class="preview-title">{{ preview.title }}</strong>
          <span class="preview-meta">
            {{ t('aiWorkflow.previewMeta', { nodes: preview.nodes.length, edges: preview.edges.length }) }}
          </span>
        </div>
        <ul class="preview-nodes">
          <li
            v-for="node in preview.nodes"
            :key="node.key"
          >
            <span class="node-title">{{ previewNodeTitle(node) }}</span>
            <span class="node-type">{{ node.typeId }}</span>
          </li>
        </ul>
        <p
          v-if="preview.edges.length"
          class="preview-edges"
        >
          {{ preview.edges.map((e) => `${e.from}→${e.to}`).join(' · ') }}
        </p>
        <p
          v-if="previewWarnings.length"
          class="preview-warn"
        >
          {{ previewWarnings.slice(0, 4).join('；') }}
        </p>
      </div>

      <p
        v-if="error"
        class="error"
      >
        {{ error }}
      </p>
      <p
        v-else
        class="hint"
      >
        {{ t('aiWorkflow.hint') }}
      </p>
    </div>

    <template #footer>
      <button
        type="button"
        :disabled="busy"
        @click="onClose"
      >
        {{ t('common.cancel') }}
      </button>
      <button
        type="button"
        :disabled="busy || !canPlanAi"
        @click="onPlanAi"
      >
        {{ generating ? t('aiWorkflow.planning') : t('aiWorkflow.previewAi') }}
      </button>
      <button
        type="button"
        class="primary"
        :disabled="busy || !hasPreview"
        @click="emit('commit')"
      >
        {{ committing ? t('aiWorkflow.creating') : t('aiWorkflow.create') }}
      </button>
    </template>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { AiWorkflowPresetId } from '../features/aiWorkflow/presets'
import { hasAiWorkflowPresetPlan } from '../features/aiWorkflow/presets'
import type { GenerateModelOption } from '../features/graph/model/generateModelOptions'
import type { AiWorkflowPreview } from '../composables/useAiCreateWorkflow'
import type { GraphNode } from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import { resolveGraphNodeDisplayTitle } from '../features/graph/model/graphNodeDisplayTitle'
import InstructionModelSelect from './InstructionModelSelect.vue'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

const props = defineProps<{
  open: boolean
  generating: boolean
  committing: boolean
  error: string
  prompt: string
  textModelKey: string
  imageModelKey: string
  videoModelKey: string
  aspectRatio: string
  textModelOptions: GenerateModelOption[]
  imageModelOptions: GenerateModelOption[]
  videoModelOptions: GenerateModelOption[]
  presetIds: readonly AiWorkflowPresetId[]
  selectedPresetId: AiWorkflowPresetId | null
  preview: AiWorkflowPreview | null
  previewWarnings: string[]
}>()

const emit = defineEmits<{
  'update:prompt': [value: string]
  'update:textModelKey': [value: string]
  'update:imageModelKey': [value: string]
  'update:videoModelKey': [value: string]
  'update:aspectRatio': [value: string]
  'select-preset': [id: AiWorkflowPresetId]
  'plan-ai': []
  commit: []
  close: []
}>()

const { t, graphTypeLabel } = useStudioI18n()

/** 预览节点：库存英文标题（剧集 Agent 阶段 / 复合审核标题）走 i18n，与节点卡片一致 */
function previewNodeTitle(node: { key: string; typeId: string; title: string }): string {
  return resolveGraphNodeDisplayTitle(
    { typeId: node.typeId, title: node.title } as GraphNode,
    { scope: undefined, t, graphTypeLabel }
  )
}

const busy = computed(() => props.generating || props.committing)
const hasPreview = computed(() => !!props.preview)
const canPlanAi = computed(() => {
  if (!props.textModelKey) return false
  if (props.prompt.trim()) return true
  return !!props.selectedPresetId && hasAiWorkflowPresetPlan(props.selectedPresetId)
})

const promptModel = computed({
  get: () => props.prompt,
  set: (value: string) => emit('update:prompt', value)
})

function onClose(): void {
  if (busy.value) return
  emit('close')
}

function onPlanAi(): void {
  if (busy.value || !canPlanAi.value) return
  emit('plan-ai')
}
</script>

<style scoped>
.body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  height: 100%;
  padding: 4px 2px;
}

.row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.models {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.model-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.label {
  font-size: 12px;
  color: var(--text-muted);
}

.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.preset {
  margin: 0;
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
  line-height: 1.3;
  cursor: pointer;
}

.preset:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
}

.preset.active {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  background: color-mix(in srgb, var(--accent) 16%, var(--bg-elevated));
}

.preset:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.model-select {
  max-width: min(320px, 70%);
  flex: 1 1 auto;
  justify-content: flex-end;
}

.model-select.instruction-model {
  max-width: min(320px, 70%);
}

.model-select :deep(select),
.aspect-ratio-select {
  max-width: 100%;
  min-width: 140px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 12px;
  line-height: 1.4;
  outline: none;
}

.aspect-ratio-select {
  max-width: min(320px, 70%);
  flex: 1 1 auto;
  justify-content: flex-end;
}

.aspect-ratio-select:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.prompt {
  flex: 0 1 auto;
  min-height: 96px;
  resize: none;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 13px;
  line-height: 1.5;
  outline: none;
  box-sizing: border-box;
}

.prompt:focus {
  border-color: var(--accent);
}

.prompt:disabled {
  opacity: 0.7;
}

.preview {
  flex: 1 1 auto;
  min-height: 100px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  background: color-mix(in srgb, var(--bg-elevated) 85%, var(--bg));
}

.preview-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
}

.preview-title {
  font-size: 13px;
  color: var(--text);
}

.preview-meta {
  font-size: 11px;
  color: var(--text-muted);
}

.preview-nodes {
  margin: 0;
  padding: 0 0 0 16px;
  font-size: 12px;
  color: var(--text);
}

.preview-nodes li {
  margin: 2px 0;
}

.node-title {
  margin-right: 8px;
}

.node-type {
  color: var(--text-muted);
  font-size: 11px;
}

.preview-edges {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--text-muted);
  word-break: break-all;
}

.preview-warn {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--warning, #c9a227);
}

.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.error {
  margin: 0;
  font-size: 12px;
  color: var(--danger, #e35d6a);
  white-space: pre-wrap;
}

.primary {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  background: color-mix(in srgb, var(--accent) 18%, var(--bg-elevated));
  color: var(--text);
}

.primary:disabled,
button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
