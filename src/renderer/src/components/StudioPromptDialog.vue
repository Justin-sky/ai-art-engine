<template>
  <StudioFloatingWindow
    :open="!!current"
    :title="current?.title ?? ''"
    :show-close="false"
    :z-index="3200"
    :default-width="400"
    :default-height="current?.mode === 'prompt' ? 320 : 280"
    :min-width="320"
    :min-height="200"
    @close="onBackdrop"
  >
    <p
      v-if="current"
      class="message"
    >
      {{ current.message }}
    </p>
    <input
      v-if="current?.mode === 'prompt'"
      ref="inputEl"
      v-model="textValue"
      class="prompt-input"
      type="text"
      :placeholder="current.placeholder || ''"
      @keydown.enter.prevent="onConfirm"
      @keydown.escape.prevent="onCancel"
    >

    <template #footer>
      <button
        v-if="current?.mode === 'confirm' || current?.mode === 'prompt'"
        type="button"
        @click="onCancel"
      >
        {{ current.cancelLabel || t('common.cancel') }}
      </button>
      <button
        type="button"
        class="primary"
        @click="onConfirm"
      >
        {{
          current?.mode === 'confirm' || current?.mode === 'prompt'
            ? current.confirmLabel || t('common.confirm')
            : current?.confirmLabel || t('common.gotIt')
        }}
      </button>
    </template>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useStudioPromptHost } from '../composables/useStudioPrompt'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

const { t } = useStudioI18n()
const { current, confirm, cancel } = useStudioPromptHost()
const textValue = ref('')
const inputEl = ref<HTMLInputElement | null>(null)

watch(
  current,
  async (state) => {
    if (!state || state.mode !== 'prompt') {
      textValue.value = ''
      return
    }
    textValue.value = state.defaultValue ?? ''
    // StudioFloatingWindow 双 rAF 后才挂 body，需等到 input 真正出现
    for (let i = 0; i < 12; i++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      await nextTick()
      const el = inputEl.value
      if (!el) continue
      el.focus()
      el.select()
      return
    }
  },
  { immediate: true }
)

function onConfirm(): void {
  if (current.value?.mode === 'prompt') confirm(textValue.value)
  else confirm()
}

function onCancel(): void {
  cancel()
}

function onBackdrop(): void {
  // 确认/输入框点遮罩视为取消；提示框点遮罩等同知道了
  if (current.value?.mode === 'confirm' || current.value?.mode === 'prompt') cancel()
  else confirm()
}
</script>

<style scoped>
.message {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-muted);
  white-space: pre-wrap;
}

.prompt-input {
  display: block;
  width: 100%;
  box-sizing: border-box;
  margin-top: 12px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  --textarea-bg: var(--bg-panel);
  background: var(--textarea-bg);
  color: var(--text);
  font-size: 13px;
}

.prompt-input:focus {
  outline: none;
  border-color: var(--accent);
}
</style>
