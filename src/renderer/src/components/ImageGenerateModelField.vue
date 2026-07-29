<template>
  <label class="model-field">
    <span class="label">{{ t('graph.inspector.generate.imageModel') }}</span>
    <select v-model="selectionKey" class="select" @change="emitSelection">
      <option v-for="opt in selectionOptions" :key="opt.key || 'empty'" :value="opt.key">
        {{ opt.label }}
      </option>
    </select>
  </label>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import {
  loadGenerateModelOptions,
  preferredModelKey,
  type GenerateModelOption
} from '../features/graph/model/generateModelOptions'

const props = defineProps<{
  open: boolean
  generateModel?: string
  generateProviderInstanceId?: string
}>()

const emit = defineEmits<{
  change: [payload: { generateModel: string; generateProviderInstanceId: string }]
}>()

const { t } = useStudioI18n()
const modelOptions = ref<GenerateModelOption[]>([])
const selectionKey = ref('')

const selectionOptions = computed(() => {
  const models = modelOptions.value.map((opt) => ({ key: opt.key, label: opt.label }))
  if (models.length === 0) {
    return [{ key: '', label: t('graph.inspector.generate.noModels') }]
  }
  return models
})

watch(
  () => [props.open, props.generateModel, props.generateProviderInstanceId] as const,
  ([open]) => {
    if (!open) return
    void reloadSelection()
  },
  { immediate: true }
)

async function reloadSelection(): Promise<void> {
  const preferred = preferredModelKey(props.generateProviderInstanceId, props.generateModel)
  const { options, selectedKey } = await loadGenerateModelOptions('image', preferred)
  modelOptions.value = options
  selectionKey.value = selectedKey || options[0]?.key || ''
  emitSelection()
}

function emitSelection(): void {
  const opt = modelOptions.value.find((o) => o.key === selectionKey.value)
  emit('change', {
    generateModel: opt?.model ?? '',
    generateProviderInstanceId: opt?.providerInstanceId ?? ''
  })
}

function currentSelection(): { generateModel: string; generateProviderInstanceId: string } {
  const opt = modelOptions.value.find((o) => o.key === selectionKey.value)
  return {
    generateModel: opt?.model ?? '',
    generateProviderInstanceId: opt?.providerInstanceId ?? ''
  }
}

defineExpose({ currentSelection })
</script>

<style scoped>
.model-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 220px;
  flex: 1 1 auto;
}

.label {
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
  font-size: 13px;
}
</style>
