<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    size?: number | string
  }>(),
  { size: 18 }
)

/** 相对传入 size 再放大，贴齐 emoji 视觉占位 */
const px = computed(() => {
  const n = typeof props.size === 'number' ? props.size : Number.parseFloat(String(props.size))
  const base = Number.isFinite(n) && n > 0 ? n : 18
  return Math.round(base * 1.2 * 10) / 10
})
</script>

<template>
  <!-- 2D 帧动画：青色圆角方块 + 白色圆形播放按钮 -->
  <svg
    class="anim2d-icon"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    :width="px"
    :height="px"
    aria-hidden="true"
    focusable="false"
  >
    <rect
      x="0"
      y="0"
      width="24"
      height="24"
      rx="6"
      fill="#0EA5E9"
    />
    <circle
      cx="12"
      cy="12"
      r="6.4"
      fill="#fff"
    />
    <path
      d="M9.9 9.1v5.8l5-2.9-5-2.9z"
      fill="#0EA5E9"
    />
  </svg>
</template>

<style scoped>
.anim2d-icon {
  display: block;
  flex: none;
  pointer-events: none;
}
</style>
