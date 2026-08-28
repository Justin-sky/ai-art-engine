<template>
  <label
    class="model3d-style"
    :title="title"
  >
    <svg
      class="style-icon"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="8"
        cy="8"
        r="6.25"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      />
      <circle
        cx="5.5"
        cy="6.6"
        r="1"
        fill="currentColor"
      />
      <circle
        cx="8"
        cy="5.3"
        r="1"
        fill="currentColor"
      />
      <circle
        cx="10.5"
        cy="6.6"
        r="1"
        fill="currentColor"
      />
      <circle
        cx="8"
        cy="10.7"
        r="1"
        fill="currentColor"
      />
    </svg>
    <select
      :value="modelValue"
      :aria-label="title"
      @change="onChange"
    >
      <option
        v-for="opt in styleOptions"
        :key="opt.value"
        :value="opt.value"
      >
        {{ opt.value === modelValue ? '✓ ' : '' }}{{ opt.label }}
      </option>
    </select>
  </label>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'

defineProps<{
  modelValue: string
  title: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: []
}>()

const { t } = useStudioI18n()

/** Lux3D 文生3D 风格枚举（TextTo3dRequest.style），缺省 photorealistic */
const styleOptions = computed(() =>
  [
    ['photorealistic', 'graph.inspector.generate.model3dStyles.photorealistic'],
    ['cartoon', 'graph.inspector.generate.model3dStyles.cartoon'],
    ['anime', 'graph.inspector.generate.model3dStyles.anime'],
    ['hand_painted', 'graph.inspector.generate.model3dStyles.handPainted'],
    ['cyberpunk', 'graph.inspector.generate.model3dStyles.cyberpunk'],
    ['fantasy', 'graph.inspector.generate.model3dStyles.fantasy'],
    ['glass', 'graph.inspector.generate.model3dStyles.glass']
  ].map(([value, key]) => ({ value, label: t(key) }))
)

function onChange(event: Event): void {
  emit('update:modelValue', (event.target as HTMLSelectElement).value)
  emit('change')
}
</script>

<style scoped>
.model3d-style {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  gap: 5px;
  flex: none;
  max-width: 110px;
  margin: 0;
  cursor: default;
}

.style-icon {
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

select option:checked {
  color: var(--accent);
  font-weight: 600;
  background: color-mix(in srgb, var(--accent) 16%, transparent);
}
</style>
