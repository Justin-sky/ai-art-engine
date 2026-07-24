<template>
  <label class="instruction-model" :title="title">
    <svg
      class="model-icon"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="4"
        y="4"
        width="8"
        height="8"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      />
      <path
        fill="currentColor"
        d="M7 1h2v2H7zm0 12h2v2H7zM1 7h2v2H1zm12 0h2v2h-2zM3.2 2.8l1.4 1.4-1.4 1.4-1.4-1.4zm9.6 0 1.4 1.4-1.4 1.4-1.4-1.4zM3.2 11.4l1.4 1.4-1.4 1.4-1.4-1.4zm9.6 0 1.4 1.4-1.4 1.4-1.4-1.4z"
      />
    </svg>
    <select
      :value="modelValue"
      :aria-label="title"
      @change="onChange"
    >
      <option v-if="options.length === 0" value="">{{ emptyLabel }}</option>
      <option v-for="opt in options" :key="opt.key" :value="opt.key">
        {{ opt.label }}
      </option>
    </select>
  </label>
</template>

<script setup lang="ts">
import type { GenerateModelOption } from '../features/graph/model/generateModelOptions'

defineProps<{
  modelValue: string
  options: GenerateModelOption[]
  title: string
  emptyLabel: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: []
}>()

function onChange(event: Event): void {
  emit('update:modelValue', (event.target as HTMLSelectElement).value)
  emit('change')
}
</script>

<style scoped>
.instruction-model {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: none;
  max-width: 110px;
  margin: 0;
  cursor: default;
}

.model-icon {
  flex: none;
  color: var(--text-muted);
  display: block;
  pointer-events: none;
}

select {
  flex: 1;
  min-width: 0;
  max-width: 90px;
  height: 24px;
  padding: 0 4px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 11px;
  line-height: 22px;
}

select:hover,
select:focus {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  outline: none;
}
</style>
