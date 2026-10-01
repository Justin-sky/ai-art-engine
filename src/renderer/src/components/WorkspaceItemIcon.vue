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
  resolveWorkspaceIconKind,
  workspaceIconIsEnlarged
} from '../features/media/workspaceIconKind'
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
  { icon: '', itemId: '', size: 18 }
)

const kind = computed(() => resolveWorkspaceIconKind(props.icon, props.itemId))

const isFreeCanvas = computed(() => kind.value === 'freeCanvas')
const isVideo = computed(() => kind.value === 'video')
const isAnim2d = computed(() => kind.value === 'anim2d')
const isFrameAnimGen = computed(() => kind.value === 'frameAnimGen')

const isEnlargedEmoji = computed(() => workspaceIconIsEnlarged(props.icon, props.itemId))

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
