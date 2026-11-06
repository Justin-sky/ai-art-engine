<template>
  <button
    type="button"
    class="ws-fullscreen-btn"
    :class="{ 'is-active': isWorkspaceFullscreen, 'is-compact': compact }"
    :title="buttonTitle"
    :aria-label="buttonTitle"
    :aria-pressed="isWorkspaceFullscreen"
    @click="onClick"
  >
    <svg
      class="ws-fs-svg"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      aria-hidden="true"
    >
      <path
        v-if="!isWorkspaceFullscreen"
        d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"
        stroke="currentColor"
        stroke-width="1.45"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path
        v-else
        d="M6 2.5V6H2.5M10 2.5V6h3.5M13.5 10H10v3.5M2.5 10H6v3.5"
        stroke="currentColor"
        stroke-width="1.45"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
    <span v-if="!compact" class="ws-fs-label">
      {{ isWorkspaceFullscreen ? t('studio.fullscreen.exit') : t('studio.fullscreen.enter') }}
    </span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useWorkspaceFullscreen } from '../composables/useWorkspaceFullscreen'

const props = withDefaults(
  defineProps<{
    compact?: boolean
    titleOverride?: string
  }>(),
  {
    compact: false,
    titleOverride: ''
  }
)

const emit = defineEmits<{
  toggle: [nextActive: boolean]
}>()

const { t } = useStudioI18n()
const { isWorkspaceFullscreen, toggleWorkspaceFullscreen } = useWorkspaceFullscreen()

const buttonTitle = computed(() => {
  if (props.titleOverride) return props.titleOverride
  return isWorkspaceFullscreen.value
    ? t('studio.fullscreen.exitTitle')
    : t('studio.fullscreen.enterTitle')
})

function onClick(): void {
  const next = toggleWorkspaceFullscreen()
  emit('toggle', next)
}
</script>

<style scoped>
.ws-fullscreen-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  flex-shrink: 0;
  cursor: pointer;
  transition:
    color 0.14s ease,
    background 0.14s ease,
    border-color 0.14s ease;
}

.ws-fullscreen-btn.is-compact {
  padding: 0 6px;
  min-width: 26px;
}

.ws-fullscreen-btn:hover {
  color: var(--text);
  background: var(--bg-hover);
  border-color: var(--border-strong, var(--text-muted));
}

.ws-fullscreen-btn.is-active {
  color: var(--accent, #3d8bfd);
  background: var(--accent-12, rgba(61, 139, 253, 0.14));
  border-color: var(--accent, #3d8bfd);
}

.ws-fs-svg {
  flex-shrink: 0;
  display: block;
}

.ws-fs-label {
  line-height: 1;
}
</style>
