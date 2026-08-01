<script setup lang="ts">
withDefaults(
  defineProps<{
    size?: number | string
  }>(),
  { size: 18 }
)
</script>

<template>
  <!-- 左上裁切角（两端十字）+ 右下四角星 -->
  <svg
    class="free-canvas-icon"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    :width="size"
    :height="size"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="square"
    aria-hidden="true"
    focusable="false"
  >
    <!-- 顶边十字 -->
    <path d="M7 2.6v3.2M5.4 4.2h3.2" />
    <!-- 右边十字 -->
    <path d="M15.8 2.6v3.2M14.2 4.2h3.2" />
    <!-- L：竖臂 + 横臂 -->
    <path d="M7 4.2v9.2M7 4.2h8.8" />
    <!-- 右下四角星 -->
    <path
      fill="currentColor"
      stroke="none"
      d="M15.6 14.2 17.5 11.4l1.9 2.8 2.8 1.9-2.8 1.9-1.9 2.8-1.9-2.8-2.8-1.9z"
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
