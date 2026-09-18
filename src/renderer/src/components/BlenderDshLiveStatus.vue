<template>
  <p v-if="phase" class="dsh-live" role="status">
    <span class="dsh-live-dot" aria-hidden="true" />
    <span>{{ t(`graph.inspector.blenderDsh.live.${phase}`) }}</span>
  </p>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useBlenderDshLiveStore } from '../stores/blenderDshLive'

const props = defineProps<{
  nodeId?: string | null
}>()

const { t } = useStudioI18n()
const live = useBlenderDshLiveStore()
const phase = computed(() => live.phaseOf(props.nodeId))
</script>

<style scoped>
.dsh-live {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 6px 8px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent) 8%, var(--bg-elevated));
  color: var(--text);
  font-size: 12px;
  line-height: 1.35;
}

.dsh-live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--accent);
  animation: dsh-live-pulse 1.2s ease-in-out infinite;
}

@keyframes dsh-live-pulse {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}
</style>
