<template>
  <label class="voice-select" :title="title" data-no-focus-steal>
    <svg
      class="voice-icon"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M8 1.5a2.5 2.5 0 0 0-2.5 2.5v4a2.5 2.5 0 0 0 5 0V4A2.5 2.5 0 0 0 8 1.5ZM3.5 7.5a.75.75 0 0 1 1.5 0v.5a3 3 0 0 0 6 0v-.5a.75.75 0 0 1 1.5 0v.5a4.5 4.5 0 0 1-3.75 4.44V14h1.75a.75.75 0 0 1 0 1.5h-5a.75.75 0 0 1 0-1.5h1.75v-1.56A4.5 4.5 0 0 1 3.5 8v-.5Z"
      />
    </svg>
    <!-- 自由输入 + datalist：聚合器的音色名穷举不完，候选只作提示 -->
    <input
      :value="modelValue ?? ''"
      type="text"
      spellcheck="false"
      :list="datalistId"
      :placeholder="placeholder"
      @change="onChange"
      @keydown.stop
      @pointerdown.stop
    />
    <datalist :id="datalistId">
      <option v-for="voice in options" :key="voice" :value="voice" />
    </datalist>
  </label>
</template>

<script setup lang="ts">
import { useId } from 'vue'

withDefaults(
  defineProps<{
    modelValue?: string
    options: string[]
    title: string
    placeholder: string
  }>(),
  { modelValue: '' }
)

const emit = defineEmits<{ change: [value: string] }>()

/**
 * datalist 的 id 必须全局唯一：同一画布上可能有多个声音指令面板同时挂载，
 * id 撞了候选会串到别的输入框上。Vue 的 useId 在 SSR / 多实例下都稳定。
 */
const datalistId = `tts-voice-${useId()}`

function onChange(event: Event): void {
  emit('change', (event.target as HTMLInputElement).value)
}
</script>

<style scoped>
.voice-select {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  gap: 5px;
  flex: none;
  max-width: 120px;
  margin: 0;
  cursor: default;
}

.voice-icon {
  flex: none;
  color: var(--text-muted);
  display: block;
  pointer-events: none;
}

input {
  flex: 1;
  min-width: 0;
  max-width: 96px;
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
