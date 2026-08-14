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
  <!-- 帧动画序列图：青色圆角方块 + 2x2 精灵帧网格 + 右上角加号徽标 -->
  <svg
    class="frame-anim-gen-icon"
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
    <rect
      x="2.6"
      y="2.6"
      width="8.6"
      height="8.6"
      rx="1.5"
      fill="#fff"
      opacity="0.95"
    />
    <rect
      x="13.6"
      y="2.6"
      width="7.8"
      height="8.6"
      rx="1.5"
      fill="#fff"
      opacity="0.55"
    />
    <rect
      x="2.6"
      y="13.6"
      width="7.8"
      height="7.8"
      rx="1.5"
      fill="#fff"
      opacity="0.55"
    />
    <rect
      x="13.6"
      y="13.6"
      width="7.8"
      height="7.8"
      rx="1.5"
      fill="#fff"
      opacity="0.95"
    />
    <circle
      cx="20.4"
      cy="3.6"
      r="3.8"
      fill="#fff"
    />
    <path
      d="M20.4 2v3.2M18.8 3.6h3.2"
      stroke="#0EA5E9"
      stroke-width="1.7"
      stroke-linecap="round"
    />
  </svg>
</template>

<style scoped>
.frame-anim-gen-icon {
  display: block;
  flex: none;
  pointer-events: none;
}
</style>
