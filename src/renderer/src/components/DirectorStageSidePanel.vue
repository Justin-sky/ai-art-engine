<template>
  <aside class="stage-side">
    <InspectorPanel :empty-none-message="t('director.stage.selectHint')" />
  </aside>
</template>

<script setup lang="ts">
import { useStudioI18n } from '../composables/useStudioI18n'
import InspectorPanel from './InspectorPanel.vue'

const { t } = useStudioI18n()
</script>

<style scoped>
.stage-side {
  display: flex;
  flex-direction: column;
  width: 300px;
  min-width: 260px;
  height: 100%;
  min-height: 0;
  border-left: 1px solid var(--border);
  background: var(--bg-panel);
  flex-shrink: 0;
  overflow: hidden;
}

.stage-side > :deep(.inspector-host) {
  flex: 1;
  min-height: 0;
  background: transparent;
}

.stage-side > :deep(.inspector) {
  width: 100%;
  min-width: 0;
  border: none;
  background: transparent;
}
</style>
