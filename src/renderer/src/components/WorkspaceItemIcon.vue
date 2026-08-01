<template>
  <FreeCanvasIcon v-if="isFreeCanvas" :size="size" />
  <span v-else class="emoji-icon" aria-hidden="true">{{ icon }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import FreeCanvasIcon from './icons/FreeCanvasIcon.vue'

const props = withDefaults(
  defineProps<{
    icon?: string
    /** 工具栏条目 id；freeCanvas 优先走专用 SVG */
    itemId?: string
    size?: number | string
  }>(),
  { size: 18 }
)

const FREE_CANVAS_ICON_KEYS = new Set(['free-canvas', 'icon:free-canvas', '⬜'])

const isFreeCanvas = computed(
  () => props.itemId === 'freeCanvas' || FREE_CANVAS_ICON_KEYS.has(props.icon || '')
)
</script>

<style scoped>
.emoji-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}
</style>
