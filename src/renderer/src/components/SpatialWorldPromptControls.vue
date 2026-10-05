<template>
  <label class="world-pano" :title="panoTitle">
    <svg
      class="ctl-icon"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
    >
      <ellipse
        cx="8"
        cy="8"
        rx="6.25"
        ry="3.75"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
      />
      <path d="M8 4.25v7.5M1.75 8h12.5" fill="none" stroke="currentColor" stroke-width="1.1" />
    </svg>
    <select :value="panoMode" :aria-label="panoTitle" @change="onPanoChange">
      <option v-for="opt in panoOptions" :key="opt.value" :value="opt.value">
        {{ opt.value === panoMode ? '✓ ' : '' }}{{ opt.label }}
      </option>
    </select>
  </label>
  <label class="world-literal" :title="literalTitle">
    <input type="checkbox" :checked="disableRecaption" @change="onLiteralChange" />
    <span>{{ t('graph.inspector.generate.spatialWorldLiteralPrompt') }}</span>
  </label>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'

defineProps<{
  /** 单图参考的全景模式（官方 is_pano） */
  panoMode: 'auto' | 'always' | 'never'
  /** 关闭上游 recaption：指令原文直送 */
  disableRecaption: boolean
}>()

const emit = defineEmits<{
  'update:panoMode': [value: 'auto' | 'always' | 'never']
  'update:disableRecaption': [value: boolean]
}>()

const { t } = useStudioI18n()

const panoTitle = computed(() => t('graph.inspector.generate.spatialWorldPanoHint'))
const literalTitle = computed(() => t('graph.inspector.generate.spatialWorldLiteralPromptHint'))

const panoOptions = computed(() =>
  (
    [
      ['auto', 'graph.inspector.generate.spatialWorldPanoModes.auto'],
      ['always', 'graph.inspector.generate.spatialWorldPanoModes.always'],
      ['never', 'graph.inspector.generate.spatialWorldPanoModes.never']
    ] as const
  ).map(([value, key]) => ({ value, label: t(key) }))
)

function onPanoChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  emit('update:panoMode', value === 'always' || value === 'never' ? value : 'auto')
}

function onLiteralChange(event: Event): void {
  emit('update:disableRecaption', (event.target as HTMLInputElement).checked)
}
</script>

<style scoped>
.world-pano,
.world-literal {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  gap: 5px;
  flex: none;
  margin: 0;
  cursor: default;
}

.world-pano {
  max-width: 108px;
}

.ctl-icon {
  flex: none;
  color: var(--text-muted);
  display: block;
  pointer-events: none;
}

select {
  flex: 1;
  min-width: 0;
  max-width: 88px;
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

.world-literal {
  font-size: 11px;
  color: var(--text-muted);
}

.world-literal input {
  margin: 0;
  accent-color: var(--accent);
}

.world-literal:hover {
  color: var(--text);
}
</style>
