<script setup lang="ts">
withDefaults(
  defineProps<{
    size?: number | string
    spinning?: boolean
  }>(),
  {
    size: 14,
    spinning: false
  }
)
</script>

<template>
  <svg
    class="refresh-icon"
    :class="{ spinning }"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    :width="size"
    :height="size"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M21 12a9 9 0 1 1-2.1-5.7" />
    <path d="M21 3v6h-6" />
  </svg>
</template>

<style scoped>
.refresh-icon {
  display: block;
  flex: none;
  pointer-events: none;
}

.refresh-icon.spinning {
  animation: refresh-spin 0.8s linear infinite;
}

@keyframes refresh-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
