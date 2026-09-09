<template>
  <div class="inset-editor">
    <label
      v-for="side in sides"
      :key="side"
    >
      <span>{{ sideLabel(side) }}</span>
      <input
        type="number"
        min="0"
        :value="props.value[side]"
        @change="emitChange(side, toNum($event.target))"
      >
    </label>
  </div>
</template>

<script setup lang="ts">
import { useStudioI18n } from '../composables/useStudioI18n'
import type { UiKitInset } from '@shared/gameAssets'

const props = defineProps<{ value: UiKitInset }>()
const emit = defineEmits<{ (e: 'change', value: UiKitInset): void }>()

const { t } = useStudioI18n()

const sides = ['left', 'top', 'right', 'bottom'] as const

function sideLabel(side: (typeof sides)[number]): string {
  return t(`uiKitExtract.fields.${side}`)
}

function toNum(target: EventTarget | null): number {
  const el = target as HTMLInputElement | null
  const n = Number(el?.value)
  return Number.isFinite(n) ? n : 0
}

function emitChange(side: (typeof sides)[number], value: number): void {
  emit('change', { ...props.value, [side]: value })
}
</script>

<style scoped>
.inset-editor {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

label {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11px;
  color: var(--text-muted);
}

input {
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 12px;
  width: 100%;
  box-sizing: border-box;
}
</style>
