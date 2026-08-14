<script setup lang="ts">
withDefaults(
  defineProps<{
    rows?: number
    cols?: number
    size?: number | string
  }>(),
  {
    rows: 3,
    cols: 3,
    size: 14
  }
)
</script>

<template>
  <svg
    class="grid-icon"
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    :width="size"
    :height="size"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    aria-hidden="true"
    focusable="false"
  >
    <rect
      x="3"
      y="3"
      width="18"
      height="18"
      rx="2"
    />
    <line
      v-for="i in cols - 1"
      :key="`v${i}`"
      :x1="3 + (18 * i) / cols"
      y1="3"
      :x2="3 + (18 * i) / cols"
      y2="21"
    />
    <line
      v-for="i in rows - 1"
      :key="`h${i}`"
      x1="3"
      :y1="3 + (18 * i) / rows"
      x2="21"
      :y2="3 + (18 * i) / rows"
    />
  </svg>
</template>

<style scoped>
.grid-icon {
  display: block;
  flex: none;
  pointer-events: none;
}
</style>
