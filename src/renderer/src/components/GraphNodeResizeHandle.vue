<template>
  <button
    type="button"
    class="resize-handle"
    :title="t('graph.resize')"
    @pointerdown.stop.prevent="onDown"
  />
</template>

<script setup lang="ts">
import { useStudioI18n } from '../composables/useStudioI18n'

const { t } = useStudioI18n()
const emit = defineEmits<{
  resizeStart: [event: PointerEvent]
}>()

function onDown(e: PointerEvent): void {
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  emit('resizeStart', e)
}
</script>

<style scoped>
.resize-handle {
  position: absolute;
  right: 1px;
  bottom: 1px;
  width: 14px;
  height: 14px;
  padding: 0;
  border: none;
  border-radius: 0 0 6px 0;
  background: linear-gradient(135deg, transparent 48%, var(--resize-grip) 48%);
  cursor: se-resize;
  z-index: 50;
  opacity: 0.7;
  pointer-events: auto;
}

.resize-handle:hover,
.resize-handle:active {
  opacity: 1;
}
</style>
