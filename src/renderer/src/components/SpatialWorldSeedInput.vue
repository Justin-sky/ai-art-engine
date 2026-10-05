<template>
  <label class="world-seed" :title="title">
    <svg
      class="seed-icon"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M8 1.75v3M8 11.25v3M1.75 8h3M11.25 8h3M3.6 3.6l2.1 2.1M10.3 10.3l2.1 2.1M12.4 3.6l-2.1 2.1M5.7 10.3l-2.1 2.1"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
      />
    </svg>
    <input
      :value="displayValue"
      type="text"
      inputmode="numeric"
      :aria-label="title"
      :placeholder="placeholder"
      @change="onChange"
    />
  </label>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  /** 种子值；0 表示未设置（交给上游随机） */
  modelValue: number
  title: string
  placeholder: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number]
  change: []
}>()

const displayValue = computed(() => (props.modelValue > 0 ? String(props.modelValue) : ''))

function onChange(event: Event): void {
  const raw = (event.target as HTMLInputElement).value.trim()
  const parsed = Number.parseInt(raw, 10)
  const next = Number.isFinite(parsed) && parsed > 0 ? Math.min(4294967295, parsed) : 0
  emit('update:modelValue', next)
  emit('change')
}
</script>

<style scoped>
.world-seed {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  gap: 5px;
  flex: none;
  max-width: 104px;
  margin: 0;
  cursor: default;
}

.seed-icon {
  flex: none;
  color: var(--text-muted);
  display: block;
  pointer-events: none;
}

input {
  flex: 1;
  min-width: 0;
  max-width: 84px;
  height: 24px;
  padding: 0 4px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 11px;
  line-height: 22px;
}

input:hover,
input:focus {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  outline: none;
}
</style>
