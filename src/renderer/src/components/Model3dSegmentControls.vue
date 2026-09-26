<template>
  <div class="model3d-segment-controls">
    <select
      class="model3d-segment-select"
      :value="mode"
      :title="t('graph.inspector.generate.model3dSegmentMode')"
      :aria-label="t('graph.inspector.generate.model3dSegmentMode')"
      @change="onModeChange"
    >
      <option v-for="opt in modeOptions" :key="opt.value" :value="opt.value">
        {{ opt.value === mode ? '✓ ' : '' }}{{ opt.label }}
      </option>
    </select>
    <select
      v-if="mode === 'smart'"
      class="model3d-segment-select"
      :value="smartGranularity"
      :title="t('graph.inspector.generate.model3dSegmentSmartGranularity')"
      :aria-label="t('graph.inspector.generate.model3dSegmentSmartGranularity')"
      @change="onSmartGranularityChange"
    >
      <option v-for="opt in smartGranularityOptions" :key="opt.value" :value="opt.value">
        {{ opt.value === smartGranularity ? '✓ ' : '' }}{{ opt.label }}
      </option>
    </select>
    <select
      v-else
      class="model3d-segment-select"
      :value="granularity"
      :title="t('graph.inspector.generate.model3dSegmentGranularity')"
      :aria-label="t('graph.inspector.generate.model3dSegmentGranularity')"
      @change="onGranularityChange"
    >
      <option v-for="opt in granularityOptions" :key="opt.value" :value="opt.value">
        {{ opt.value === granularity ? '✓ ' : '' }}{{ opt.label }}
      </option>
    </select>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'

defineProps<{
  mode: string
  granularity: string
  smartGranularity: string
}>()

const emit = defineEmits<{
  'update:mode': [value: string]
  'update:granularity': [value: string]
  'update:smartGranularity': [value: string]
}>()

const { t } = useStudioI18n()

const modeOptions = computed(() =>
  [
    ['mesh', 'graph.inspector.generate.model3dSegmentModes.mesh'],
    ['smart', 'graph.inspector.generate.model3dSegmentModes.smart']
  ].map(([value, key]) => ({ value, label: t(key) }))
)

const granularityOptions = computed(() =>
  [
    ['', 'graph.inspector.generate.model3dSegmentGranularities.v1'],
    ['simple', 'graph.inspector.generate.model3dSegmentGranularities.simple'],
    ['balanced', 'graph.inspector.generate.model3dSegmentGranularities.balanced'],
    ['detailed', 'graph.inspector.generate.model3dSegmentGranularities.detailed']
  ].map(([value, key]) => ({ value, label: t(key) }))
)

const smartGranularityOptions = computed(() =>
  [
    ['coarse', 'graph.inspector.generate.model3dSegmentSmartGranularities.coarse'],
    ['medium', 'graph.inspector.generate.model3dSegmentSmartGranularities.medium'],
    ['fine', 'graph.inspector.generate.model3dSegmentSmartGranularities.fine']
  ].map(([value, key]) => ({ value, label: t(key) }))
)

function onModeChange(event: Event): void {
  emit('update:mode', (event.target as HTMLSelectElement).value)
}

function onGranularityChange(event: Event): void {
  emit('update:granularity', (event.target as HTMLSelectElement).value)
}

function onSmartGranularityChange(event: Event): void {
  emit('update:smartGranularity', (event.target as HTMLSelectElement).value)
}
</script>

<style scoped>
.model3d-segment-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}

.model3d-segment-select {
  flex: none;
  max-width: 132px;
  height: 26px;
  padding: 0 6px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  color: var(--text);
  font-size: 11px;
}
</style>
