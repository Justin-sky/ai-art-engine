<template>
  <button
    v-if="canSave"
    type="button"
    class="save-chip"
    :class="{ saved, compact }"
    :disabled="saved || saving"
    :title="titleText"
    :aria-label="titleText"
    @click.stop="$emit('save')"
  >
    {{ labelText }}
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'

const props = withDefaults(
  defineProps<{
    canSave: boolean
    saved?: boolean
    saving?: boolean
    compact?: boolean
  }>(),
  { saved: false, saving: false, compact: false }
)

defineEmits<{
  save: []
}>()

const { t } = useStudioI18n()

const titleText = computed(() => t('studio.chat.saveToLibraryTitle'))
const labelText = computed(() => {
  if (props.saved) return t('studio.chat.savedToLibrary')
  if (props.saving) return t('common.saving')
  return t('studio.chat.saveToLibrary')
})
</script>

<style scoped>
.save-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  max-width: 100%;
  padding: 3px 8px;
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: 6px;
  background: color-mix(in srgb, var(--bg-elevated) 88%, transparent);
  color: var(--text);
  font-size: 11px;
  line-height: 1.2;
  white-space: nowrap;
  cursor: pointer;
}

.save-chip:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--bg-hover);
}

.save-chip:disabled {
  opacity: 0.72;
  cursor: default;
}

.save-chip.saved {
  color: var(--text-muted);
}

.save-chip.compact {
  padding: 2px 6px;
  font-size: 10px;
  border-radius: 4px;
}
</style>
