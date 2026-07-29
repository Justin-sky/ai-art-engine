<template>
  <div
    ref="rootEl"
    class="media-preview"
    tabindex="0"
    @wheel.prevent="onWheel"
  >
    <div class="viewport" :class="{ text: mediaKind === 'text' }" @click="onBackdropClick">
      <textarea
        v-if="mediaKind === 'text'"
        class="text-view"
        readonly
        spellcheck="false"
        :value="textContent"
        @click.stop
      />
      <p v-else-if="!resolvedUrl" class="empty">{{ emptyText }}</p>
      <img
        v-else-if="mediaKind === 'image'"
        :src="resolvedUrl"
        alt=""
        class="image"
        :class="{ grabbing: panning }"
        :style="imageStyle"
        draggable="false"
        @pointerdown="onPanStart"
        @pointermove="onPanMove"
        @pointerup="onPanEnd"
        @pointercancel="onPanEnd"
        @click.stop
      />
      <video
        v-else-if="mediaKind === 'video'"
        :src="resolvedUrl"
        class="av-player"
        controls
        autoplay
        @click.stop
      />
      <audio
        v-else
        :src="resolvedUrl"
        class="av-player audio"
        controls
        autoplay
        @click.stop
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useStudioI18n } from '../../composables/useStudioI18n'

const props = defineProps<{
  frameKey: string
  mediaKind: 'image' | 'video' | 'audio' | 'text'
  url: string
  relativePath?: string
  title?: string
  text?: string
}>()

const { t } = useStudioI18n()
const rootEl = ref<HTMLElement | null>(null)
const resolvedUrl = ref('')
const scale = ref(1)
const offsetX = ref(0)
const offsetY = ref(0)
const panning = ref(false)
let didPan = false
let panPointerId: number | null = null
let panStart = { x: 0, y: 0, ox: 0, oy: 0 }

const imageStyle = computed(() => ({
  transform: `translate(${offsetX.value}px, ${offsetY.value}px) scale(${scale.value})`
}))

const textContent = computed(() => props.text ?? props.url ?? '')

const emptyText = computed(() => {
  if (props.mediaKind === 'video') return t('director.stage.shotPreviewEmptyVideo')
  if (props.mediaKind === 'audio') return t('director.stage.shotPreviewEmptyVoice')
  if (props.mediaKind === 'text') return t('graph.notepad.emptyReadonly')
  return t('director.stage.shotPreviewEmpty')
})

async function resolveUrl(): Promise<void> {
  const relativePath = props.relativePath?.trim()
  if (relativePath) {
    try {
      const url = await window.studio.getAssetFileUrl(relativePath)
      if (url) {
        resolvedUrl.value = url
        return
      }
    } catch {
      /* fall through */
    }
  }
  resolvedUrl.value = props.url?.trim() || ''
}

watch(
  () => [props.url, props.relativePath] as const,
  () => {
    void resolveUrl()
  },
  { immediate: true }
)

onMounted(() => {
  rootEl.value?.focus()
})

function onWheel(e: WheelEvent): void {
  if (props.mediaKind !== 'image' || !resolvedUrl.value) return
  const next = scale.value * (e.deltaY < 0 ? 1.1 : 0.9)
  scale.value = Math.min(8, Math.max(0.2, next))
}

function onPanStart(e: PointerEvent): void {
  if (e.button !== 0) return
  panning.value = true
  didPan = false
  panPointerId = e.pointerId
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  panStart = { x: e.clientX, y: e.clientY, ox: offsetX.value, oy: offsetY.value }
}

function onPanMove(e: PointerEvent): void {
  if (!panning.value || panPointerId !== e.pointerId) return
  const dx = e.clientX - panStart.x
  const dy = e.clientY - panStart.y
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didPan = true
  offsetX.value = panStart.ox + dx
  offsetY.value = panStart.oy + dy
}

function onPanEnd(e: PointerEvent): void {
  if (panPointerId !== e.pointerId) return
  panning.value = false
  panPointerId = null
}

function onBackdropClick(): void {
  if (didPan) {
    didPan = false
    return
  }
  scale.value = 1
  offsetX.value = 0
  offsetY.value = 0
}
</script>

<style scoped>
.media-preview {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  outline: none;
  background: #0b0b0d;
}
.viewport {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.empty {
  color: var(--text-muted);
  font-size: 13px;
}
.image {
  max-width: none;
  max-height: none;
  transform-origin: center center;
  cursor: grab;
  user-select: none;
}
.image.grabbing {
  cursor: grabbing;
}
.av-player {
  max-width: 100%;
  max-height: 100%;
}
.av-player.audio {
  width: min(480px, 90%);
}
.viewport.text {
  align-items: stretch;
  justify-content: stretch;
  padding: 12px;
}
.text-view {
  flex: 1;
  width: 100%;
  min-height: 0;
  resize: none;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
  background: var(--bg-panel);
  color: var(--text);
  font: inherit;
  line-height: 1.5;
}
</style>
