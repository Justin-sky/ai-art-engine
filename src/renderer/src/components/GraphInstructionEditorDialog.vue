<template>
  <StudioFloatingWindow
    :open="open"
    :close-title="t('common.cancel')"
    :z-index="2500"
    :default-width="920"
    :default-height="760"
    :min-width="480"
    :min-height="480"
    body-class="pad-none"
    @close="emit('close')"
  >
    <template #title>
      <div class="head-text">
        <span class="eyebrow">{{ t('graph.inspector.generate.instructionDialogMark') }}</span>
        <h2>{{ t('graph.inspector.generate.instructionDialogTitle') }}</h2>
      </div>
    </template>

    <div
      ref="dialogEl"
      class="dialog-body"
      tabindex="-1"
    >
      <GraphInstructionMentionEditor
        variant="dialog"
        :model-value="modelValue"
        :host-id="hostId"
        :node-id="nodeId"
        :preset-kind="presetKind"
        :placeholder="placeholder"
        :rows="18"
        @update:model-value="onUpdate"
        @change="emit('change')"
      />
    </div>

    <template #footer>
      <div class="foot-meta">
        <span class="hint">{{ t('graph.inspector.generate.instructionDialogHint') }}</span>
        <span class="stats">{{ statsText }}</span>
      </div>
      <button
        type="button"
        class="primary done-btn"
        @click="emit('close')"
      >
        {{ t('graph.inspector.generate.instructionDialogDone') }}
      </button>
    </template>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { InstructionPresetKind } from '@shared/graph/instructionPresets'
import { estimateTokenCount } from '@shared/textTokens'
import GraphInstructionMentionEditor from './GraphInstructionMentionEditor.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

const props = defineProps<{
  open: boolean
  modelValue: string
  hostId: string
  nodeId: string
  placeholder?: string
  presetKind?: InstructionPresetKind | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: []
  close: []
}>()

const { t } = useStudioI18n()
const dialogEl = ref<HTMLElement | null>(null)
const tokenCount = ref(0)
let tokenTimer: ReturnType<typeof setTimeout> | null = null

const lineCount = computed(() => {
  if (!props.modelValue) return 0
  return props.modelValue.split('\n').length
})
const charCount = computed(() => props.modelValue.length)
const statsText = computed(() =>
  t('graph.notepad.stats', {
    lines: lineCount.value,
    chars: charCount.value,
    tokens: tokenCount.value
  })
)

function scheduleTokenCount(text: string): void {
  if (tokenTimer) clearTimeout(tokenTimer)
  tokenTimer = setTimeout(() => {
    tokenCount.value = estimateTokenCount(text)
    tokenTimer = null
  }, 120)
}

watch(
  () => props.modelValue,
  (text) => scheduleTokenCount(text),
  { immediate: true }
)

watch(
  () => props.open,
  async (visible) => {
    if (!visible) return
    await nextTick()
    dialogEl.value?.focus()
  }
)

onBeforeUnmount(() => {
  if (tokenTimer) clearTimeout(tokenTimer)
})

function onUpdate(value: string): void {
  emit('update:modelValue', value)
}
</script>

<style scoped>
.head-text {
  min-width: 0;
}

.eyebrow {
  display: block;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.head-text h2 {
  margin: 4px 0 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
}

.dialog-body {
  flex: 1;
  min-height: 0;
  padding: 12px 14px;
  overflow: auto;
  outline: none;
  background: var(--bg-panel);
}

.dialog-body :deep(.instruction-box) {
  height: 100%;
  min-height: 360px;
}

.dialog-body :deep(.editor-area) {
  flex: 1;
  min-height: 280px;
}

.dialog-body :deep(.instruction-input textarea) {
  min-height: 280px;
}

.foot-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  margin-right: auto;
  text-align: left;
}

.hint {
  font-size: 11px;
  color: var(--text-muted);
}

.stats {
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.done-btn {
  flex: none;
}
</style>
