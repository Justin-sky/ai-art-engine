<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    size?: number | string
  }>(),
  { size: 18 }
)

/** 相对传入 size 再放大，贴齐 emoji（🔊）视觉占位 */
const px = computed(() => {
  const n = typeof props.size === 'number' ? props.size : Number.parseFloat(String(props.size))
  const base = Number.isFinite(n) && n > 0 ? n : 18
  return Math.round(base * 1.2 * 10) / 10
})
</script>

<template>
  <!-- Windows 风格：紫色圆角方块 + 白色播放三角 -->
  <svg
    class="video-asset-icon"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    :width="px"
    :height="px"
    aria-hidden="true"
    focusable="false"
  >
    <rect x="0" y="0" width="24" height="24" rx="6" fill="#8B5CF6" />
    <path d="M8.6 6.6v10.8L18 12 8.6 6.6z" fill="#fff" />
  </svg>
</template>

<style scoped>
.video-asset-icon {
  display: block;
  flex: none;
  pointer-events: none;
}
</style>
