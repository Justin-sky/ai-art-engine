<template>
  <div class="tabs" role="tablist">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      type="button"
      role="tab"
      class="tab"
      :class="{ active: model === tab.id }"
      :aria-selected="model === tab.id"
      @click="model = tab.id"
    >
      {{ tab.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { WORLD_ELEMENT_KINDS, type WorldElementKind } from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'

const model = defineModel<WorldElementKind>({ required: true })

const { t } = useStudioI18n()
const tabs = computed(() =>
  WORLD_ELEMENT_KINDS.map((id) => ({
    id,
    label: t(`world.tab.${id}`)
  }))
)
</script>

<style scoped>
.tabs {
  display: flex;
  gap: 4px;
}

.tab {
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
}

.tab:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--border);
  background: var(--bg-hover);
}

.tab.active {
  color: var(--text);
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.tab.active:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  background: color-mix(in srgb, var(--accent) 16%, transparent);
}
</style>
