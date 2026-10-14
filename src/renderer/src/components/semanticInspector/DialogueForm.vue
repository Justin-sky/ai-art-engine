<template>
  <div class="si-form">
    <p v-if="line.text.trim() !== line.sourceText.trim()" class="si-note">
      {{ t('graph.semanticEdit.original') }}{{ line.sourceText }}
    </p>
    <label class="si-field">
      <span>{{ t('graph.semanticEdit.lineText') }}</span>
      <textarea
        :value="line.text"
        rows="3"
        @change="
          emit('edit', {
            op: 'dialogue.update',
            target: line.id,
            patch: { text: inputValue($event) }
          })
        "
      />
    </label>
    <label class="si-field">
      <span>{{ t('graph.semanticEdit.speaker') }}</span>
      <input
        :value="line.speaker ?? ''"
        @change="
          emit('edit', {
            op: 'dialogue.update',
            target: line.id,
            patch: { speaker: inputValue($event) }
          })
        "
      />
    </label>
  </div>
</template>

<script setup lang="ts">
import type { DialogueLine, SemanticEditInput } from '@shared/semanticTimeline'
import { useStudioI18n } from '../../composables/useStudioI18n'
import { inputValue } from './formUtils'

/** 台词：改文本 = 重建时重新配音（画面不动） */
defineProps<{ line: DialogueLine }>()
const emit = defineEmits<{ edit: [input: SemanticEditInput] }>()
const { t } = useStudioI18n()
</script>
