<template>
  <div class="model3d-rig" :class="{ 'is-enabled': enabled }" :title="hint">
    <label class="rig-toggle">
      <input type="checkbox" :checked="enabled" @change="onToggle" :aria-label="label" />
      <span>{{ label }}</span>
    </label>
    <select
      v-if="enabled"
      :value="rigType"
      :title="rigTypeHint"
      :aria-label="rigTypeHint"
      @change="onRigTypeChange"
    >
      <option v-for="opt in rigTypeOptions" :key="opt.value" :value="opt.value">
        {{ opt.value === rigType ? '✓ ' : '' }}{{ opt.label }}
      </option>
    </select>
    <input
      v-if="enabled"
      type="text"
      class="rig-animation"
      :value="rigAnimation"
      :placeholder="animationPlaceholder"
      :title="animationHint"
      :aria-label="animationHint"
      @change="onAnimationChange"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'

defineProps<{
  enabled: boolean
  rigType: string
  rigAnimation: string
}>()

const emit = defineEmits<{
  'update:enabled': [value: boolean]
  'update:rigType': [value: string]
  'update:rigAnimation': [value: string]
}>()

const { t } = useStudioI18n()

const label = computed(() => t('graph.inspector.generate.model3dRig'))
const hint = computed(() => t('graph.inspector.generate.model3dRigHint'))
const rigTypeHint = computed(() => t('graph.inspector.generate.model3dRigType'))
const animationHint = computed(() => t('graph.inspector.generate.model3dRigAnimation'))
const animationPlaceholder = computed(() =>
  t('graph.inspector.generate.model3dRigAnimationPlaceholder')
)

const rigTypeOptions = computed(() =>
  [
    ['humanoid', 'graph.inspector.generate.model3dRigTypes.humanoid'],
    ['quadruped', 'graph.inspector.generate.model3dRigTypes.quadruped'],
    ['bipedal', 'graph.inspector.generate.model3dRigTypes.bipedal'],
    ['creature', 'graph.inspector.generate.model3dRigTypes.creature']
  ].map(([value, key]) => ({ value, label: t(key) }))
)

function onToggle(event: Event): void {
  emit('update:enabled', (event.target as HTMLInputElement).checked)
}
function onRigTypeChange(event: Event): void {
  emit('update:rigType', (event.target as HTMLSelectElement).value)
}
function onAnimationChange(event: Event): void {
  emit('update:rigAnimation', (event.target as HTMLInputElement).value)
}
</script>

<style scoped>
.model3d-rig {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px 8px;
  flex: none;
  margin: 0;
}
/* 启用蒙皮后控件较多，独占 footer 一整行，避免与模型选择挤在一行 */
.model3d-rig.is-enabled {
  display: flex;
  flex: 0 0 100%;
  max-width: 100%;
}
.rig-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
  cursor: default;
  transition: color 120ms ease;
}
.is-enabled .rig-toggle {
  color: var(--text);
  font-weight: 600;
}
.rig-toggle input {
  margin: 0;
}
select,
.rig-animation {
  height: 24px;
  padding: 0 4px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 11px;
  line-height: 22px;
}
select {
  max-width: 100px;
}
.rig-animation {
  flex: 1 1 auto;
  min-width: 80px;
  max-width: 180px;
}
select:hover,
select:focus,
.rig-animation:hover,
.rig-animation:focus {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  outline: none;
}
</style>
