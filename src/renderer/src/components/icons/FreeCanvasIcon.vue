<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    size?: number | string
  }>(),
  { size: 18 }
)

const px = computed(() => {
  const n = typeof props.size === 'number' ? props.size : Number.parseFloat(String(props.size))
  const base = Number.isFinite(n) && n > 0 ? n : 18
  return Math.round(base * 1.2 * 10) / 10
})
</script>

<template>
  <!-- 左上裁切角（两端十字）+ 右下四角星；略放大以贴齐 emoji -->
  <svg
    class="free-canvas-icon"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    :width="px"
    :height="px"
    fill="none"
    stroke="currentColor"
    stroke-width="1.65"
    stroke-linecap="square"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M5.5 1.8v3.6M3.7 3.6h3.6" />
    <path d="M16.2 1.8v3.6M14.4 3.6h3.6" />
    <path d="M5.5 3.6v11.2M5.5 3.6h10.7" />
    <path
      fill="currentColor"
      stroke="none"
      d="M15.2 13.6 17.4 10.4l2.2 3.2 3.2 2.2-3.2 2.2-2.2 3.2-2.2-3.2-3.2-2.2z"
    />
  </svg>
</template>

<style scoped>
.free-canvas-icon {
  display: block;
  flex: none;
  color: var(--text, currentColor);
  pointer-events: none;
}
</style>
