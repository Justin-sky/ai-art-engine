<template>
  <nav
    v-if="frames.length"
    class="editor-dive-bar"
    :aria-label="t('studio.dive.up')"
  >
    <button
      type="button"
      class="dive-up"
      :title="t('studio.dive.up')"
      @click="emit('popTo', -1)"
    >
      {{ t('studio.dive.up') }}
    </button>
    <ol class="dive-crumbs">
      <li>
        <button
          type="button"
          class="dive-crumb"
          @click="emit('popTo', -1)"
        >
          {{ rootTitle || t('studio.dive.root') }}
        </button>
      </li>
      <li
        v-for="(frame, index) in frames"
        :key="frame.key"
        class="dive-crumb-item"
      >
        <span
          class="dive-sep"
          aria-hidden="true"
        >{{ t('studio.dive.sep') }}</span>
        <button
          type="button"
          class="dive-crumb"
          :class="{ current: index === frames.length - 1 }"
          :disabled="index === frames.length - 1"
          @click="emit('popTo', index)"
        >
          {{ frame.title }}
        </button>
      </li>
    </ol>
  </nav>
</template>

<script setup lang="ts">
import { useStudioI18n } from '../composables/useStudioI18n'
import type { EditorDiveFrame } from '../features/graph/model/editorDive'

defineProps<{
  rootTitle: string
  frames: EditorDiveFrame[]
}>()

const emit = defineEmits<{
  popTo: [index: number]
}>()

const { t } = useStudioI18n()
</script>

<style scoped>
.editor-dive-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.dive-up {
  flex-shrink: 0;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
}

.dive-up:hover {
  color: var(--text);
  border-color: var(--text-muted);
}

.dive-crumbs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  min-width: 0;
}

.dive-crumb-item {
  display: inline-flex;
  align-items: center;
  min-width: 0;
}

.dive-sep {
  margin: 0 6px;
  color: var(--text-muted);
  opacity: 0.6;
  font-size: 11px;
}

.dive-crumb {
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  padding: 0;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.dive-crumb:hover:not(:disabled) {
  color: var(--text);
  text-decoration: underline;
}

.dive-crumb.current,
.dive-crumb:disabled {
  color: var(--text);
  cursor: default;
  font-weight: 600;
}
</style>
