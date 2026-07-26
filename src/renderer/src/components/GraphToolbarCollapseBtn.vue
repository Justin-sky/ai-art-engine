<script setup lang="ts">
import { useStudioI18n } from '../composables/useStudioI18n'

const collapsed = defineModel<boolean>({ default: false })
const { t } = useStudioI18n()

function toggle(): void {
  collapsed.value = !collapsed.value
}
</script>

<template>
  <button
    type="button"
    class="graph-toolbar-collapse-btn"
    :title="collapsed ? t('graph.toolbar.expand') : t('graph.toolbar.collapse')"
    :aria-label="collapsed ? t('graph.toolbar.expand') : t('graph.toolbar.collapse')"
    :aria-expanded="!collapsed"
    @click="toggle"
  >
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        v-if="collapsed"
        fill="currentColor"
        d="M3.2 6.2 8 11l4.8-4.8-.9-.9L8 9.2 4.1 5.3z"
      />
      <path
        v-else
        fill="currentColor"
        d="M3.2 9.8 8 5l4.8 4.8-.9.9L8 6.8 4.1 10.7z"
      />
    </svg>
  </button>
</template>

<style scoped>
.graph-toolbar-collapse-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.graph-toolbar-collapse-btn:hover {
  border-color: var(--border);
  color: var(--text);
  background: var(--bg-hover);
}
</style>
