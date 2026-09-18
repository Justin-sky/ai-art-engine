<template>
  <select
    class="model3d-rig-type"
    :value="rigType"
    :title="hint"
    :aria-label="hint"
    @change="onChange"
  >
    <option v-for="opt in options" :key="opt.value" :value="opt.value">
      {{ opt.value === rigType ? '✓ ' : '' }}{{ opt.label }}
    </option>
  </select>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'

defineProps<{
  rigType: string
}>()

const emit = defineEmits<{
  'update:rigType': [value: string]
}>()

const { t } = useStudioI18n()

const hint = computed(() => t('graph.inspector.generate.model3dRigType'))

const options = computed(() =>
  [
    ['humanoid', 'graph.inspector.generate.model3dRigTypes.humanoid'],
    ['quadruped', 'graph.inspector.generate.model3dRigTypes.quadruped'],
    ['bipedal', 'graph.inspector.generate.model3dRigTypes.bipedal'],
    ['creature', 'graph.inspector.generate.model3dRigTypes.creature']
  ].map(([value, key]) => ({ value, label: t(key) }))
)

function onChange(event: Event): void {
  emit('update:rigType', (event.target as HTMLSelectElement).value)
}
</script>

<style scoped>
.model3d-rig-type {
  flex: none;
  max-width: 140px;
  height: 26px;
  padding: 0 6px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  color: var(--text);
  font-size: 11px;
}
</style>
