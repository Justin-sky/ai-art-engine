<template>
  <div class="parts-picker">
    <div class="picker-head">
      <span class="picker-title">{{ t('graph.inspector.meshOpParts.title') }}</span>
      <span v-if="selected.length" class="picker-count">
        {{ t('graph.inspector.meshOpParts.selected', { n: selected.length }) }}
      </span>
    </div>
    <ul v-if="parts.length" class="chip-list">
      <li v-for="part in parts" :key="part">
        <button
          type="button"
          class="chip chip-btn"
          :class="{ active: selected.includes(part) }"
          @click="emit('toggle', part)"
        >
          {{ part }}
        </button>
      </li>
    </ul>
    <p v-else class="section-hint">{{ t('graph.inspector.meshOpParts.empty') }}</p>
    <p v-if="parts.length" class="section-hint">{{ t('graph.inspector.meshOpParts.hint') }}</p>
  </div>
</template>

<script setup lang="ts">
import { useStudioI18n } from '../composables/useStudioI18n'

defineProps<{
  /** 上游拆分节点解析出的部件名（= 拆分后 GLB 的 node 名） */
  parts: string[]
  /** 当前节点已选部件 */
  selected: string[]
}>()

const emit = defineEmits<{ toggle: [part: string] }>()

const { t } = useStudioI18n()
</script>

<style scoped>
.parts-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.picker-title {
  font-size: 12px;
  color: var(--text-2);
}

.picker-count {
  font-size: 11px;
  color: var(--text-muted);
}

.chip-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.chip {
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  border: 1px solid color-mix(in srgb, var(--border) 80%, transparent);
  font-size: 11px;
}

.chip-btn {
  cursor: pointer;
  color: var(--text);
}

.chip-btn.active {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.section-hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}
</style>
