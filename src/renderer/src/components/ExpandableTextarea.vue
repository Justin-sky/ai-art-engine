<template>
  <div class="expandable-textarea">
    <textarea
      :value="modelValue"
      :rows="rows"
      :placeholder="placeholder"
      :class="textareaClass"
      spellcheck="false"
      @input="onInput"
      @change="emit('change')"
    />
    <button
      type="button"
      class="expand-btn"
      :title="expandTitle || t('graph.inspector.generate.textExpand')"
      @click.stop.prevent="dialogOpen = true"
    >
      <ExpandArrowsIcon />
    </button>

    <GraphTextNotepadDialog
      :open="dialogOpen"
      :title="title"
      :text="modelValue"
      editable
      @close="dialogOpen = false"
      @save="onDialogSave"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import ExpandArrowsIcon from './icons/ExpandArrowsIcon.vue'
import GraphTextNotepadDialog from './GraphTextNotepadDialog.vue'
import { useStudioI18n } from '../composables/useStudioI18n'

withDefaults(
  defineProps<{
    modelValue: string
    title: string
    rows?: number
    placeholder?: string
    textareaClass?: string
    expandTitle?: string
  }>(),
  {
    rows: 4,
    placeholder: '',
    textareaClass: '',
    expandTitle: ''
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: []
}>()

const { t } = useStudioI18n()
const dialogOpen = ref(false)

function onInput(event: Event): void {
  const value = (event.target as HTMLTextAreaElement).value
  emit('update:modelValue', value)
}

function onDialogSave(text: string): void {
  emit('update:modelValue', text)
  emit('change')
}
</script>

<style scoped>
.expandable-textarea {
  position: relative;
  display: block;
}

.expandable-textarea textarea {
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 6px 28px 6px 8px;
  resize: vertical;
  background: var(--bg-input);
  color: var(--text);
}

.expandable-textarea textarea::-webkit-resizer {
  background-color: var(--bg-input);
  background-image: var(--resizer-grip);
  border: none;
}

.expand-btn {
  position: absolute;
  right: 4px;
  top: 4px;
  z-index: 5;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.expand-btn:hover {
  color: var(--accent);
  background: var(--bg-hover);
  border-color: var(--accent);
}
</style>
