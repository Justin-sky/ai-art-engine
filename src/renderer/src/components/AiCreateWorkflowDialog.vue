<template>
  <StudioFloatingWindow
    :open="open"
    :title="t('aiWorkflow.title')"
    :subtitle="t('aiWorkflow.subtitle')"
    :close-title="t('common.close')"
    :z-index="2650"
    :default-width="600"
    :default-height="520"
    :min-width="440"
    :min-height="400"
    @close="onClose"
  >
    <div class="body">
      <div class="row">
        <span class="label">{{ t('aiWorkflow.presetsLabel') }}</span>
        <div class="presets" role="list">
          <button
            v-for="id in presetIds"
            :key="id"
            type="button"
            class="preset"
            role="listitem"
            :class="{ active: selectedPresetId === id }"
            :disabled="generating"
            :title="t(`aiWorkflow.presets.${id}.desc`)"
            @click="emit('select-preset', id)"
          >
            {{ t(`aiWorkflow.presets.${id}.title`) }}
          </button>
        </div>
      </div>

      <div class="row model-row">
        <span class="label">{{ t('aiWorkflow.modelLabel') }}</span>
        <InstructionModelSelect
          class="model-select"
          :model-value="modelKey"
          :options="modelOptions"
          :title="t('aiWorkflow.modelLabel')"
          :empty-label="t('aiWorkflow.modelEmpty')"
          @update:model-value="emit('update:modelKey', $event)"
        />
      </div>

      <label class="label" for="ai-workflow-prompt">{{ t('aiWorkflow.promptLabel') }}</label>
      <textarea
        id="ai-workflow-prompt"
        v-model="promptModel"
        class="prompt"
        rows="8"
        spellcheck="false"
        :disabled="generating"
        :placeholder="t('aiWorkflow.promptPlaceholder')"
        @keydown.ctrl.enter.prevent="onGenerate"
        @keydown.meta.enter.prevent="onGenerate"
      />
      <p v-if="error" class="error">{{ error }}</p>
      <p v-else class="hint">{{ t('aiWorkflow.hint') }}</p>
    </div>

    <template #footer>
      <button type="button" :disabled="generating" @click="onClose">
        {{ t('common.cancel') }}
      </button>
      <button
        type="button"
        class="primary"
        :disabled="generating || !promptModel.trim() || !modelKey"
        @click="onGenerate"
      >
        {{ generating ? t('aiWorkflow.generating') : t('aiWorkflow.generate') }}
      </button>
    </template>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { AiWorkflowPresetId } from '../features/aiWorkflow/presets'
import type { GenerateModelOption } from '../features/graph/model/generateModelOptions'
import { useStudioI18n } from '../composables/useStudioI18n'
import InstructionModelSelect from './InstructionModelSelect.vue'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

const props = defineProps<{
  open: boolean
  generating: boolean
  error: string
  prompt: string
  modelKey: string
  modelOptions: GenerateModelOption[]
  presetIds: readonly AiWorkflowPresetId[]
  selectedPresetId: AiWorkflowPresetId | null
}>()

const emit = defineEmits<{
  'update:prompt': [value: string]
  'update:modelKey': [value: string]
  'select-preset': [id: AiWorkflowPresetId]
  close: []
  generate: []
}>()

const { t } = useStudioI18n()

const promptModel = computed({
  get: () => props.prompt,
  set: (value: string) => emit('update:prompt', value)
})

function onClose(): void {
  if (props.generating) return
  emit('close')
}

function onGenerate(): void {
  if (props.generating) return
  emit('generate')
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

.model-row {
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

.model-select :deep(select) {
  max-width: 100%;
  min-width: 160px;
}

.prompt {
  flex: 1 1 auto;
  min-height: 140px;
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

.primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
