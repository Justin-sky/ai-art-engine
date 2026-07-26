<template>
  <StudioFloatingWindow
    :open="!!current"
    :title="current?.title ?? ''"
    :show-close="false"
    :z-index="3200"
    :default-width="400"
    :default-height="280"
    :min-width="320"
    :min-height="200"
    @close="onBackdrop"
  >
    <p v-if="current" class="message">{{ current.message }}</p>

    <template #footer>
      <button v-if="current?.mode === 'confirm'" type="button" @click="onCancel">
        {{ current.cancelLabel || t('common.cancel') }}
      </button>
      <button type="button" class="primary" @click="onConfirm">
        {{
          current?.mode === 'confirm'
            ? current.confirmLabel || t('common.confirm')
            : current?.confirmLabel || t('common.gotIt')
        }}
      </button>
    </template>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { useStudioI18n } from '../composables/useStudioI18n'
import { useStudioPromptHost } from '../composables/useStudioPrompt'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

const { t } = useStudioI18n()
const { current, confirm, cancel } = useStudioPromptHost()

function onConfirm(): void {
  confirm()
}

function onCancel(): void {
  cancel()
}

function onBackdrop(): void {
  // 确认框点遮罩视为取消；提示框点遮罩等同知道了
  if (current.value?.mode === 'confirm') cancel()
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
</style>
