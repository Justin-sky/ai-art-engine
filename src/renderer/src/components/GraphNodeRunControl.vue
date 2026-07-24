<template>
  <button
    type="button"
    class="node-run-btn"
    :class="[mode, { compact }]"
    :disabled="disabled"
    :title="title"
    :aria-label="title"
    @pointerdown.stop
    @click.stop="onClick"
  >
    <span v-if="mode === 'stop'" class="icon-stop" />
    <span v-else-if="mode === 'rerun'" class="icon-rerun" />
    <span v-else class="icon-play" />
    <span v-if="!compact" class="label">{{ label }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { GraphNodeRunStatus } from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'

const props = withDefaults(
  defineProps<{
    status?: GraphNodeRunStatus
    isRunning?: boolean
    /** true 时仅图标，用于节点卡片头部 */
    compact?: boolean
    /** 其它节点正在跑时禁用本按钮 */
    blocked?: boolean
  }>(),
  {
    isRunning: false,
    compact: false,
    blocked: false
  }
)

const emit = defineEmits<{
  toggle: []
}>()

const { t } = useStudioI18n()

const activelyRunning = computed(
  () => props.isRunning && (props.status === 'pending' || props.status === 'running')
)

const mode = computed<'run' | 'rerun' | 'stop'>(() => {
  if (activelyRunning.value) return 'stop'
  if (props.status === 'done' || props.status === 'error') return 'rerun'
  return 'run'
})

const disabled = computed(() => props.blocked && !activelyRunning.value)

const title = computed(() => {
  if (mode.value === 'stop') return t('graph.nodeRun.stop')
  if (mode.value === 'rerun') return t('graph.nodeRun.rerun')
  return t('graph.nodeRun.execute')
})

const label = computed(() => title.value)

function onClick(): void {
  if (disabled.value) return
  emit('toggle')
}
</script>

<style scoped>
.node-run-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex-shrink: 0;
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
  background: var(--bg-elevated);
  color: var(--accent);
  cursor: pointer;
  padding: 0;
}

.node-run-btn.compact {
  width: 22px;
  height: 22px;
  border-radius: 50%;
}

.node-run-btn:not(.compact) {
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
}

.node-run-btn.rerun {
  color: var(--success);
  border-color: color-mix(in srgb, var(--success) 40%, var(--border));
}

.node-run-btn.stop {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 40%, var(--border));
}

.node-run-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 14%, var(--bg-elevated));
}

.node-run-btn.rerun:hover:not(:disabled) {
  background: color-mix(in srgb, var(--success) 14%, var(--bg-elevated));
}

.node-run-btn.stop:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger) 14%, var(--bg-elevated));
}

.node-run-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.icon-play {
  width: 0;
  height: 0;
  margin-left: 1px;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 7px solid currentColor;
}

.icon-stop {
  width: 8px;
  height: 8px;
  border-radius: 1px;
  background: currentColor;
}

.icon-rerun {
  width: 9px;
  height: 9px;
  border: 1.5px solid currentColor;
  border-radius: 50%;
  border-left-color: transparent;
  position: relative;
}

.icon-rerun::after {
  content: '';
  position: absolute;
  top: -3px;
  left: 3px;
  width: 0;
  height: 0;
  border-top: 3px solid transparent;
  border-bottom: 3px solid transparent;
  border-left: 4px solid currentColor;
  transform: rotate(-35deg);
}

.label {
  line-height: 1;
}
</style>
