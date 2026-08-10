<template>
  <FreeCanvasIcon v-if="isFreeCanvas" :size="size" />
  <VideoAssetIcon v-else-if="isVideo" :size="size" />
  <Anim2dIcon v-else-if="isAnim2d" :size="size" />
  <FrameAnimGenIcon v-else-if="isFrameAnimGen" :size="size" />
  <span
    v-else
    class="emoji-icon"
    :class="{ 'emoji-icon-lg': isEnlargedEmoji }"
    :style="emojiStyle"
    aria-hidden="true"
    >{{ icon }}</span
  >
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  ANIM2D_ASSET_ICON,
  ASSET_TYPE_ICONS,
  FRAME_ANIM_GEN_ASSET_ICON,
  FREE_CANVAS_ICON,
  VIDEO_ASSET_ICON
} from '@shared/domain'
import Anim2dIcon from './icons/Anim2dIcon.vue'
import FrameAnimGenIcon from './icons/FrameAnimGenIcon.vue'
import FreeCanvasIcon from './icons/FreeCanvasIcon.vue'
import VideoAssetIcon from './icons/VideoAssetIcon.vue'

const props = withDefaults(
  defineProps<{
    icon?: string
    /** 工具栏条目 id；freeCanvas / video 优先走专用 SVG */
    itemId?: string
    size?: number | string
  }>(),
  { size: 18 }
)

const FREE_CANVAS_ICON_KEYS = new Set([FREE_CANVAS_ICON, `icon:${FREE_CANVAS_ICON}`, '⬜'])
const VIDEO_ICON_KEYS = new Set([VIDEO_ASSET_ICON, `icon:${VIDEO_ASSET_ICON}`, '🎞️'])
const ANIM2D_ICON_KEYS = new Set([ANIM2D_ASSET_ICON, `icon:${ANIM2D_ASSET_ICON}`])
const FRAME_ANIM_GEN_ICON_KEYS = new Set([
  FRAME_ANIM_GEN_ASSET_ICON,
  `icon:${FRAME_ANIM_GEN_ASSET_ICON}`
])
const MOTION_ICON_KEYS = new Set([ASSET_TYPE_ICONS.motion, '🎬'])
const WORLD_ICON_KEYS = new Set([ASSET_TYPE_ICONS.world, '🤺'])

const isFreeCanvas = computed(
  () => props.itemId === 'freeCanvas' || FREE_CANVAS_ICON_KEYS.has(props.icon || '')
)

const isVideo = computed(
  () => props.itemId === 'video' || VIDEO_ICON_KEYS.has(props.icon || '')
)

const isAnim2d = computed(() => ANIM2D_ICON_KEYS.has(props.icon || ''))

const isFrameAnimGen = computed(() => FRAME_ANIM_GEN_ICON_KEYS.has(props.icon || ''))

const isEnlargedEmoji = computed(
  () =>
    props.itemId === 'motion' ||
    props.itemId === 'world' ||
    MOTION_ICON_KEYS.has(props.icon || '') ||
    WORLD_ICON_KEYS.has(props.icon || '')
)

const emojiStyle = computed(() => {
  if (!isEnlargedEmoji.value) return undefined
  const n = typeof props.size === 'number' ? props.size : Number.parseFloat(String(props.size))
  const base = Number.isFinite(n) && n > 0 ? n : 18
  return { fontSize: `${Math.round(base * 1.2 * 10) / 10}px` }
})
</script>

<style scoped>
.emoji-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.emoji-icon-lg {
  transform: scale(1.08);
  transform-origin: center;
}
</style>
